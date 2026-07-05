/**
 * Backtest Runner
 *
 * Simulates the strategy over historical data and compares
 * against benchmarks (buy & hold, simple DCA).
 */

import {
  BacktestConfig,
  BacktestResult,
  BenchmarkComparison,
  PortfolioState,
  Trade,
  StrategySignal,
  DEFAULT_BACKTEST_CONFIG,
} from './types';
import { FIFOLedger } from './fifo-ledger';
import {
  getRiskZone,
  HysteresisState,
  updateHysteresis,
  isRebalanceDay,
  interpolateTargetAllocation,
} from './risk-zones';
import { RiskDataPoint } from '../risk-metric-contract';

/**
 * Run backtest with the risk-based strategy
 */
export function runBacktest(
  data: RiskDataPoint[],
  config: BacktestConfig = DEFAULT_BACKTEST_CONFIG
): BacktestResult {
  // Filter data to date range
  const filteredData = data.filter(d => {
    const date = new Date(d.date);
    const start = new Date(config.startDate);
    const end = config.endDate ? new Date(config.endDate) : new Date();
    return date >= start && date <= end;
  });

  if (filteredData.length === 0) {
    throw new Error('No data in specified date range');
  }

  // Initialize
  const ledger = new FIFOLedger();
  let cashEUR = config.initialCashEUR;
  let btcQuantity = config.initialBTC;

  // Add initial BTC as a lot
  if (btcQuantity > 0) {
    ledger.buy(
      filteredData[0].date,
      btcQuantity,
      filteredData[0].price,
      0,
      'initial'
    );
  }

  // Initialize hysteresis
  let hysteresisState: HysteresisState = {
    currentZone: getRiskZone(filteredData[0].risk, config.strategy),
    daysInZone: 1,
    confirmedZone: getRiskZone(filteredData[0].risk, config.strategy),
  };

  const portfolioHistory: PortfolioState[] = [];
  const trades: Trade[] = [];
  const signals: StrategySignal[] = [];

  let maxPortfolioValue = 0;
  let maxDrawdown = 0;
  let lastDCADate: Date | null = null;

  // Track for metrics
  const dailyReturns: number[] = [];
  let previousValue = config.initialCashEUR + config.initialBTC * filteredData[0].price;

  for (let i = 0; i < filteredData.length; i++) {
    const point = filteredData[i];
    const price = point.price;
    const date = new Date(point.date);

    // Update hysteresis
    hysteresisState = updateHysteresis(hysteresisState, point.risk, config.strategy);

    // Current portfolio state
    const btcValue = btcQuantity * price;
    const totalValue = cashEUR + btcValue;
    const btcAllocation = totalValue > 0 ? btcValue / totalValue : 0;

    // Track max value and drawdown
    if (totalValue > maxPortfolioValue) {
      maxPortfolioValue = totalValue;
    }
    const currentDrawdown = (maxPortfolioValue - totalValue) / maxPortfolioValue;
    if (currentDrawdown > maxDrawdown) {
      maxDrawdown = currentDrawdown;
    }

    // Calculate daily return
    if (previousValue > 0) {
      dailyReturns.push((totalValue - previousValue) / previousValue);
    }
    previousValue = totalValue;

    // Create portfolio state
    const portfolioState: PortfolioState = {
      date: point.date,
      cashEUR,
      btcQuantity,
      btcValueEUR: btcValue,
      totalValueEUR: totalValue,
      btcAllocation,
      lots: ledger.getLots(),
      unrealizedPL: ledger.getUnrealizedPL(price),
    };
    portfolioHistory.push(portfolioState);

    // Get target allocation
    const targetAllocation = interpolateTargetAllocation(point.risk, config.strategy);
    const allocationDiff = targetAllocation - btcAllocation;

    // Determine action
    let action: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
    let tradeSize = 0;
    let reason = 'No action';

    // Check if it's a rebalance day
    const shouldRebalance = isRebalanceDay(point.date, config.strategy);

    // DCA logic (if configured)
    if (config.dcaAmount && config.dcaInterval) {
      const shouldDCA = shouldPerformDCA(date, lastDCADate, config.dcaInterval);

      if (shouldDCA && cashEUR >= config.dcaAmount) {
        // DCA buy
        action = 'BUY';
        tradeSize = config.dcaAmount;
        reason = `DCA buy (${config.dcaInterval})`;
        lastDCADate = date;
      }
    }

    // Rebalancing logic (override DCA if rebalancing)
    if (shouldRebalance && Math.abs(allocationDiff) >= 0.05) {
      if (allocationDiff > 0 && cashEUR > config.strategy.minTradeSize) {
        // Need more BTC
        const idealBuy = allocationDiff * totalValue;
        tradeSize = Math.min(
          idealBuy,
          cashEUR * 0.95,
          totalValue * config.strategy.maxTradePercent
        );

        if (tradeSize >= config.strategy.minTradeSize) {
          action = 'BUY';
          reason = `Rebalance: increase BTC to ${(targetAllocation * 100).toFixed(0)}%`;
        }
      } else if (allocationDiff < 0 && btcValue > config.strategy.minTradeSize) {
        // Need less BTC
        const idealSell = Math.abs(allocationDiff) * totalValue;
        tradeSize = Math.min(
          idealSell,
          btcValue * 0.95,
          totalValue * config.strategy.maxTradePercent
        );

        if (tradeSize >= config.strategy.minTradeSize) {
          // Check tax budget
          const btcToSell = tradeSize / price;
          const estimatedGain = ledger.estimateSalePL(btcToSell, price);
          const yearlyGains = ledger.getCurrentYearGains();

          if (
            config.strategy.annualTaxBudget !== undefined &&
            estimatedGain > 0 &&
            yearlyGains + estimatedGain > config.strategy.annualTaxBudget &&
            hysteresisState.confirmedZone !== 'defensive'
          ) {
            // Skip or reduce due to tax budget
            const remaining = Math.max(0, config.strategy.annualTaxBudget - yearlyGains);
            if (remaining < config.strategy.minTradeSize) {
              action = 'HOLD';
              reason = 'Tax budget exhausted';
            } else {
              tradeSize = Math.min(tradeSize, remaining * 1.5);
              action = 'SELL';
              reason = `Reduced sell (tax budget)`;
            }
          } else {
            action = 'SELL';
            reason = `Rebalance: decrease BTC to ${(targetAllocation * 100).toFixed(0)}%`;
          }
        }
      }
    }

    // Execute trade
    if (action === 'BUY' && tradeSize > 0) {
      const fee = tradeSize * (config.feePercent / 100);
      const slippage = tradeSize * (config.slippagePercent / 100);
      const effectivePrice = price * (1 + config.slippagePercent / 100);
      const btcBought = (tradeSize - fee) / effectivePrice;

      cashEUR -= tradeSize;
      btcQuantity += btcBought;

      const trade = ledger.buy(point.date, btcBought, effectivePrice, fee, 'buy');
      trades.push(trade);
    } else if (action === 'SELL' && tradeSize > 0) {
      const btcToSell = tradeSize / price;
      const fee = tradeSize * (config.feePercent / 100);
      const slippage = tradeSize * (config.slippagePercent / 100);
      const effectivePrice = price * (1 - config.slippagePercent / 100);
      const proceeds = btcToSell * effectivePrice - fee;

      btcQuantity -= btcToSell;
      cashEUR += proceeds;

      const trade = ledger.sell(point.date, btcToSell, effectivePrice, fee);
      trades.push(trade);
    }

    // Record signal
    signals.push({
      date: point.date,
      price,
      risk: point.risk,
      riskZone: hysteresisState.confirmedZone,
      targetAllocation,
      action,
      tradeSize,
      tradeSizePercent: totalValue > 0 ? tradeSize / totalValue : 0,
      reason,
    });
  }

  // Calculate final metrics
  const startValue = config.initialCashEUR + config.initialBTC * filteredData[0].price;
  const endValue = cashEUR + btcQuantity * filteredData[filteredData.length - 1].price;
  const totalReturn = (endValue - startValue) / startValue;

  const years =
    (new Date(filteredData[filteredData.length - 1].date).getTime() -
      new Date(filteredData[0].date).getTime()) /
    (365.25 * 24 * 60 * 60 * 1000);

  const cagr = Math.pow(endValue / startValue, 1 / years) - 1;

  // Sharpe proxy (using daily returns)
  const avgReturn = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
  const stdDev = Math.sqrt(
    dailyReturns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) /
      dailyReturns.length
  );
  const sharpeProxy = stdDev > 0 ? (avgReturn * Math.sqrt(252)) / (stdDev * Math.sqrt(252)) : 0;

  // Turnover
  const totalTraded = trades.reduce((sum, t) => sum + t.totalValue, 0);
  const avgPortfolioValue =
    portfolioHistory.reduce((sum, p) => sum + p.totalValueEUR, 0) / portfolioHistory.length;
  const turnover = avgPortfolioValue > 0 ? totalTraded / avgPortfolioValue : 0;

  // Tax summary
  const yearlySummaries = ledger.getAllYearlySummaries();
  const totalRealizedGains = yearlySummaries.reduce((sum, y) => sum + y.totalGains, 0);
  const totalRealizedLosses = yearlySummaries.reduce((sum, y) => sum + y.totalLosses, 0);

  let taxesPaid = 0;
  if (config.taxMode === 'paid' && config.capitalGainsTaxRate) {
    taxesPaid = Math.max(0, totalRealizedGains - totalRealizedLosses) * config.capitalGainsTaxRate;
  }

  // Final portfolio state
  const finalPortfolio: PortfolioState = {
    date: filteredData[filteredData.length - 1].date,
    cashEUR,
    btcQuantity,
    btcValueEUR: btcQuantity * filteredData[filteredData.length - 1].price,
    totalValueEUR: endValue,
    btcAllocation: endValue > 0 ? (btcQuantity * filteredData[filteredData.length - 1].price) / endValue : 0,
    lots: ledger.getLots(),
    unrealizedPL: ledger.getUnrealizedPL(filteredData[filteredData.length - 1].price),
  };

  return {
    config,
    startDate: filteredData[0].date,
    endDate: filteredData[filteredData.length - 1].date,
    finalPortfolio,
    metrics: {
      totalReturn: totalReturn * 100,
      cagr: cagr * 100,
      maxDrawdown: maxDrawdown * 100,
      sharpeProxy,
      turnover,
      numberOfTrades: trades.length,
      numberOfBuys: trades.filter(t => t.type === 'BUY').length,
      numberOfSells: trades.filter(t => t.type === 'SELL').length,
    },
    taxSummary: {
      totalRealizedGains,
      totalRealizedLosses,
      netRealizedPL: totalRealizedGains - totalRealizedLosses,
      taxesPaid,
      yearlyBreakdown: yearlySummaries,
    },
    portfolioHistory,
    trades,
    signals,
  };
}

/**
 * Run buy & hold benchmark
 */
export function runBuyAndHold(
  data: RiskDataPoint[],
  initialCashEUR: number,
  startDate: string,
  endDate?: string
): BenchmarkComparison {
  const filtered = data.filter(d => {
    const date = new Date(d.date);
    const start = new Date(startDate);
    const end = endDate ? new Date(endDate) : new Date();
    return date >= start && date <= end;
  });

  if (filtered.length === 0) {
    return { name: 'Buy & Hold', finalValue: 0, totalReturn: 0, cagr: 0, maxDrawdown: 0 };
  }

  const btcBought = initialCashEUR / filtered[0].price;
  const finalValue = btcBought * filtered[filtered.length - 1].price;
  const totalReturn = ((finalValue - initialCashEUR) / initialCashEUR) * 100;

  const years =
    (new Date(filtered[filtered.length - 1].date).getTime() -
      new Date(filtered[0].date).getTime()) /
    (365.25 * 24 * 60 * 60 * 1000);

  const cagr = (Math.pow(finalValue / initialCashEUR, 1 / years) - 1) * 100;

  // Calculate max drawdown
  let maxValue = initialCashEUR;
  let maxDrawdown = 0;
  for (const point of filtered) {
    const value = btcBought * point.price;
    if (value > maxValue) maxValue = value;
    const dd = (maxValue - value) / maxValue;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  return {
    name: 'Buy & Hold',
    finalValue,
    totalReturn,
    cagr,
    maxDrawdown: maxDrawdown * 100,
  };
}

/**
 * Run simple DCA benchmark
 */
export function runSimpleDCA(
  data: RiskDataPoint[],
  initialCashEUR: number,
  dcaAmount: number,
  interval: 'daily' | 'weekly' | 'monthly',
  startDate: string,
  endDate?: string
): BenchmarkComparison {
  const filtered = data.filter(d => {
    const date = new Date(d.date);
    const start = new Date(startDate);
    const end = endDate ? new Date(endDate) : new Date();
    return date >= start && date <= end;
  });

  if (filtered.length === 0) {
    return { name: 'Simple DCA', finalValue: 0, totalReturn: 0, cagr: 0, maxDrawdown: 0 };
  }

  let cash = initialCashEUR;
  let btc = 0;
  let lastDCADate: Date | null = null;
  let maxValue = initialCashEUR;
  let maxDrawdown = 0;

  for (const point of filtered) {
    const date = new Date(point.date);

    // Check if we should DCA
    if (shouldPerformDCA(date, lastDCADate, interval) && cash >= dcaAmount) {
      btc += dcaAmount / point.price;
      cash -= dcaAmount;
      lastDCADate = date;
    }

    // Track drawdown
    const value = cash + btc * point.price;
    if (value > maxValue) maxValue = value;
    const dd = (maxValue - value) / maxValue;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  const finalValue = cash + btc * filtered[filtered.length - 1].price;
  const totalReturn = ((finalValue - initialCashEUR) / initialCashEUR) * 100;

  const years =
    (new Date(filtered[filtered.length - 1].date).getTime() -
      new Date(filtered[0].date).getTime()) /
    (365.25 * 24 * 60 * 60 * 1000);

  const cagr = (Math.pow(finalValue / initialCashEUR, 1 / years) - 1) * 100;

  return {
    name: 'Simple DCA',
    finalValue,
    totalReturn,
    cagr,
    maxDrawdown: maxDrawdown * 100,
  };
}

/**
 * Helper: check if DCA should be performed
 */
function shouldPerformDCA(
  currentDate: Date,
  lastDCADate: Date | null,
  interval: 'daily' | 'weekly' | 'monthly'
): boolean {
  if (!lastDCADate) return true;

  const daysDiff = Math.floor(
    (currentDate.getTime() - lastDCADate.getTime()) / (1000 * 60 * 60 * 24)
  );

  switch (interval) {
    case 'daily':
      return daysDiff >= 1;
    case 'weekly':
      return daysDiff >= 7;
    case 'monthly':
      return daysDiff >= 28;
    default:
      return false;
  }
}

/**
 * Run full comparison backtest
 */
export function runComparison(
  data: RiskDataPoint[],
  config: BacktestConfig
): {
  strategy: BacktestResult;
  benchmarks: BenchmarkComparison[];
} {
  const strategy = runBacktest(data, config);

  const benchmarks: BenchmarkComparison[] = [
    runBuyAndHold(data, config.initialCashEUR, config.startDate, config.endDate),
    runSimpleDCA(
      data,
      config.initialCashEUR,
      config.dcaAmount || 100,
      config.dcaInterval || 'weekly',
      config.startDate,
      config.endDate
    ),
  ];

  return { strategy, benchmarks };
}

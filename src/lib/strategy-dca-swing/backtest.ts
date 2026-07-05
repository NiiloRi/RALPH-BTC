/**
 * Dynamic DCA + Swing Trading Backtest Runner
 *
 * Runs backtests of the strategy against historical data
 * and compares to benchmarks (Buy & Hold, Pure DCA).
 */

import {
  DCASwingConfig,
  DCASwingBacktestResult,
  DCASwingPortfolioState,
  BenchmarkResult,
  DCASwingComparisonResult,
  DEFAULT_DCA_SWING_CONFIG,
} from './types';
import { DCASwingFIFOLedger } from './fifo-ledger';
import { calculateDCAAmount, shouldPerformDCA } from './dca-engine';
import {
  createSwingState,
  updateSwingState,
  calculateSwingTradeSize,
  getSwingRiskZone,
  SwingState,
} from './swing-engine';
import { RiskDataPoint } from '../risk-metric-contract';

/**
 * Run full backtest with the Dynamic DCA + Swing strategy
 */
export function runDCASwingBacktest(
  data: RiskDataPoint[],
  config: DCASwingConfig = DEFAULT_DCA_SWING_CONFIG
): DCASwingBacktestResult {
  // Filter data to date range
  const filteredData = data.filter(d => {
    const date = new Date(d.date);
    const start = new Date(config.startDate);
    const end = config.endDate ? new Date(config.endDate) : new Date();
    return date >= start && date <= end;
  });

  if (filteredData.length === 0) {
    throw new Error(`No data in specified date range: ${config.startDate} to ${config.endDate || 'now'}`);
  }

  // Initialize
  const ledger = new DCASwingFIFOLedger(config.tax);
  let cashEUR = config.initialCashEUR;
  let btcQuantity = config.initialBTC;

  // Add initial BTC position
  if (config.initialBTC > 0) {
    ledger.buy(
      filteredData[0].date,
      config.initialBTC,
      filteredData[0].price,
      0,
      'initial',
      filteredData[0].risk
    );
  }

  // Initialize swing state
  let swingState: SwingState = createSwingState();

  // Track state
  const portfolioHistory: DCASwingPortfolioState[] = [];
  let lastDCADate: Date | null = null;

  // Metrics tracking
  let maxPortfolioValue = config.initialCashEUR + config.initialBTC * filteredData[0].price;
  let maxDrawdown = 0;
  const dailyReturns: number[] = [];
  let previousValue = maxPortfolioValue;

  // Process each day
  for (let i = 0; i < filteredData.length; i++) {
    const point = filteredData[i];
    const dateObj = new Date(point.date);
    const price = point.price;
    const risk = point.risk;

    // Current portfolio state
    const btcValue = btcQuantity * price;
    const totalValue = cashEUR + btcValue;
    const btcAllocation = totalValue > 0 ? btcValue / totalValue : 0;

    // Track drawdown
    if (totalValue > maxPortfolioValue) {
      maxPortfolioValue = totalValue;
    }
    const currentDrawdown = maxPortfolioValue > 0
      ? (maxPortfolioValue - totalValue) / maxPortfolioValue
      : 0;
    if (currentDrawdown > maxDrawdown) {
      maxDrawdown = currentDrawdown;
    }

    // Track daily returns
    if (previousValue > 0) {
      dailyReturns.push((totalValue - previousValue) / previousValue);
    }
    previousValue = totalValue;

    // Get zone
    const zone = getSwingRiskZone(risk, config);

    // Get YTD gains for tax tracking
    const year = dateObj.getFullYear();
    const ytdGains = ledger.getYearGains(year);
    const ytdLosses = ledger.getYearLosses(year);

    // Update swing state and check for swing action
    const { newState: updatedSwingState, decision } = updateSwingState(
      swingState,
      risk,
      point.date,
      config.swing
    );
    swingState = updatedSwingState;

    // Execute swing action if triggered
    if (decision.action === 'DERISK' && btcQuantity > 0) {
      const estimatedGain = ledger.estimateSalePL(btcQuantity * decision.percent, price);
      const { btcAmount, eurAmount, reason } = calculateSwingTradeSize(
        decision,
        totalValue,
        btcQuantity,
        price,
        cashEUR,
        estimatedGain,
        ytdGains,
        config.tax.annualTaxBudget
      );

      if (btcAmount > 0 && btcAmount * price >= config.minTradeSize) {
        const fee = eurAmount * (config.feePercent / 100);
        const slippage = eurAmount * (config.slippagePercent / 100);
        const effectivePrice = price * (1 - config.slippagePercent / 100);
        const proceeds = btcAmount * effectivePrice - fee;

        btcQuantity -= btcAmount;
        cashEUR += proceeds;

        ledger.sell(
          point.date,
          btcAmount,
          effectivePrice,
          fee,
          risk,
          'SWING_SELL',
          reason
        );
      }
    } else if (decision.action === 'RERISK' && cashEUR > config.minTradeSize) {
      const { btcAmount, eurAmount, reason } = calculateSwingTradeSize(
        decision,
        totalValue,
        btcQuantity,
        price,
        cashEUR,
        0,
        ytdGains,
        undefined
      );

      if (eurAmount >= config.minTradeSize && eurAmount <= cashEUR) {
        const fee = eurAmount * (config.feePercent / 100);
        const effectivePrice = price * (1 + config.slippagePercent / 100);
        const btcBought = (eurAmount - fee) / effectivePrice;

        cashEUR -= eurAmount;
        btcQuantity += btcBought;

        ledger.buy(
          point.date,
          btcBought,
          effectivePrice,
          fee,
          'rerisk',
          risk
        );
      }
    }

    // Check for DCA
    if (shouldPerformDCA(dateObj, lastDCADate, config.dca.interval)) {
      const dcaAmount = calculateDCAAmount(risk, config.dca);

      if (dcaAmount >= config.minTradeSize && dcaAmount <= cashEUR) {
        const fee = dcaAmount * (config.feePercent / 100);
        const effectivePrice = price * (1 + config.slippagePercent / 100);
        const btcBought = (dcaAmount - fee) / effectivePrice;

        const multiplier = dcaAmount / config.dca.baseAmount;

        cashEUR -= dcaAmount;
        btcQuantity += btcBought;

        ledger.buy(
          point.date,
          btcBought,
          effectivePrice,
          fee,
          'dca',
          risk,
          multiplier
        );

        lastDCADate = dateObj;
      }
    }

    // Tax loss harvesting (on monthly basis, if enabled)
    if (
      config.tax.enableLossHarvesting &&
      dateObj.getDate() === 1 && // First of month
      btcQuantity > 0
    ) {
      const lossLots = ledger.findLossHarvestingOpportunities(price);
      if (lossLots.length > 0) {
        // Sell up to 10% of holdings that are at a loss
        const maxHarvestBTC = btcQuantity * 0.10;
        let harvestBTC = 0;

        for (const lot of lossLots) {
          if (harvestBTC >= maxHarvestBTC) break;
          harvestBTC += Math.min(lot.remainingQuantity, maxHarvestBTC - harvestBTC);
        }

        if (harvestBTC * price >= config.minTradeSize) {
          const harvestValue = harvestBTC * price;
          const fee = harvestValue * (config.feePercent / 100);
          const effectivePrice = price * (1 - config.slippagePercent / 100);
          const proceeds = harvestBTC * effectivePrice - fee;

          btcQuantity -= harvestBTC;
          cashEUR += proceeds;

          ledger.sell(
            point.date,
            harvestBTC,
            effectivePrice,
            fee,
            risk,
            'TAX_HARVEST_SELL',
            'Tax loss harvesting'
          );
        }
      }
    }

    // Record portfolio state
    const newBtcValue = btcQuantity * price;
    const newTotalValue = cashEUR + newBtcValue;

    portfolioHistory.push({
      date: point.date,
      cashEUR,
      btcQuantity,
      btcPriceEUR: price,
      btcValueEUR: newBtcValue,
      totalValueEUR: newTotalValue,
      btcAllocation: newTotalValue > 0 ? newBtcValue / newTotalValue : 0,
      unrealizedPL: ledger.getUnrealizedPL(price),
      ytdRealizedGains: ledger.getYearGains(year),
      ytdRealizedLosses: ledger.getYearLosses(year),
      risk,
      zone,
      consecutiveHighRiskDays: swingState.consecutiveHighRiskDays,
      consecutiveLowRiskDays: swingState.consecutiveLowRiskDays,
      daysSinceLastDerisk: swingState.daysSinceLastDerisk,
      monthDeriskTotal: swingState.monthDeriskTotal,
    });
  }

  // Calculate final metrics
  const startValue = config.initialCashEUR + config.initialBTC * filteredData[0].price;
  const finalState = portfolioHistory[portfolioHistory.length - 1];
  const endValue = finalState.totalValueEUR;

  const years = (
    new Date(filteredData[filteredData.length - 1].date).getTime() -
    new Date(filteredData[0].date).getTime()
  ) / (365.25 * 24 * 60 * 60 * 1000);

  const totalReturn = ((endValue - startValue) / startValue) * 100;
  const cagr = (Math.pow(endValue / startValue, 1 / years) - 1) * 100;

  // Volatility and risk metrics
  const avgReturn = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
  const variance = dailyReturns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / dailyReturns.length;
  const dailyStdDev = Math.sqrt(variance);
  const annualizedVolatility = dailyStdDev * Math.sqrt(252) * 100;

  // Sharpe ratio (assuming 0% risk-free rate for simplicity)
  const sharpeRatio = dailyStdDev > 0 ? (avgReturn * Math.sqrt(252)) / (dailyStdDev * Math.sqrt(252)) : 0;

  // Sortino ratio (downside deviation)
  const negativeReturns = dailyReturns.filter(r => r < 0);
  const downsideVariance = negativeReturns.length > 0
    ? negativeReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) / negativeReturns.length
    : 0;
  const downsideDeviation = Math.sqrt(downsideVariance);
  const sortinoRatio = downsideDeviation > 0 ? (avgReturn * Math.sqrt(252)) / (downsideDeviation * Math.sqrt(252)) : 0;

  // Calmar ratio
  const calmarRatio = maxDrawdown > 0 ? cagr / (maxDrawdown * 100) : 0;

  // Trade stats
  const buyStats = ledger.getBuyStats();
  const sellStats = ledger.getSellStats();
  const trades = ledger.getTrades();

  // Tax metrics
  const yearlySummaries = ledger.getAllYearlySummaries();
  const totalRealizedGains = yearlySummaries.reduce((sum, y) => sum + y.totalGains, 0);
  const totalRealizedLosses = yearlySummaries.reduce((sum, y) => sum + y.totalLosses, 0);
  const totalTaxPaid = yearlySummaries.reduce((sum, y) => sum + y.estimatedTax, 0);

  // After-tax return (simplified: final value - taxes paid)
  const afterTaxEndValue = endValue - totalTaxPaid;
  const afterTaxReturn = ((afterTaxEndValue - startValue) / startValue) * 100;
  const afterTaxCAGR = (Math.pow(afterTaxEndValue / startValue, 1 / years) - 1) * 100;

  return {
    config,
    startDate: filteredData[0].date,
    endDate: filteredData[filteredData.length - 1].date,
    finalPortfolio: finalState,
    metrics: {
      totalReturn,
      cagr,
      maxDrawdown: maxDrawdown * 100,
      volatility: annualizedVolatility,
      sharpeRatio,
      sortinoRatio,
      calmarRatio,
      winRate: sellStats.winRate * 100,
      numberOfTrades: trades.length,
      numberOfDCABuys: buyStats.dcaBuys,
      numberOfSwingSells: sellStats.swingSells,
      numberOfReriskBuys: buyStats.reriskBuys,
      totalInvested: buyStats.totalInvested,
      avgBuyPrice: buyStats.avgBuyPrice,
    },
    taxMetrics: {
      totalRealizedGains,
      totalRealizedLosses,
      netRealizedPL: totalRealizedGains - totalRealizedLosses,
      totalTaxPaid,
      afterTaxReturn,
      afterTaxCAGR,
      yearlyBreakdown: yearlySummaries,
    },
    portfolioHistory,
    trades,
  };
}

/**
 * Run Buy & Hold benchmark
 *
 * Buys at start date, holds until end date
 * For 2017 bottom benchmark: use startDate='2017-12-17' (near peak for fair comparison)
 * or better: use the actual bottom date
 */
export function runBuyAndHoldBenchmark(
  data: RiskDataPoint[],
  initialCashEUR: number,
  startDate: string,
  endDate?: string,
  buyAtDate?: string, // Optional: buy at specific date instead of startDate
  taxRate: number = 0.30
): BenchmarkResult {
  const filtered = data.filter(d => {
    const date = new Date(d.date);
    const start = new Date(startDate);
    const end = endDate ? new Date(endDate) : new Date();
    return date >= start && date <= end;
  });

  if (filtered.length === 0) {
    return {
      name: 'Buy & Hold',
      description: 'Buy at start, hold forever',
      startDate,
      endDate: endDate || 'now',
      initialValue: initialCashEUR,
      finalValue: 0,
      totalReturn: 0,
      cagr: 0,
      maxDrawdown: 0,
      totalInvested: initialCashEUR,
    };
  }

  // Find buy date
  const buyDateStr = buyAtDate || startDate;
  const buyPoint = filtered.find(d => d.date >= buyDateStr) || filtered[0];
  const buyPrice = buyPoint.price;

  const btcBought = initialCashEUR / buyPrice;
  const finalPrice = filtered[filtered.length - 1].price;
  const finalValue = btcBought * finalPrice;

  const totalReturn = ((finalValue - initialCashEUR) / initialCashEUR) * 100;

  const years = (
    new Date(filtered[filtered.length - 1].date).getTime() -
    new Date(filtered[0].date).getTime()
  ) / (365.25 * 24 * 60 * 60 * 1000);

  const cagr = (Math.pow(finalValue / initialCashEUR, 1 / years) - 1) * 100;

  // Max drawdown
  let maxValue = initialCashEUR;
  let maxDrawdown = 0;
  const history: { date: string; value: number }[] = [];

  for (const point of filtered) {
    const value = point.date >= buyDateStr ? btcBought * point.price : initialCashEUR;
    history.push({ date: point.date, value });

    if (value > maxValue) maxValue = value;
    const dd = (maxValue - value) / maxValue;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  // After-tax (assuming sell at end)
  const gain = finalValue - initialCashEUR;
  const tax = gain > 0 ? gain * taxRate : 0;
  const afterTaxFinalValue = finalValue - tax;
  const afterTaxReturn = ((afterTaxFinalValue - initialCashEUR) / initialCashEUR) * 100;
  const afterTaxCAGR = (Math.pow(afterTaxFinalValue / initialCashEUR, 1 / years) - 1) * 100;

  return {
    name: 'Buy & Hold',
    description: `Buy at ${buyDateStr}, sell at end`,
    startDate,
    endDate: filtered[filtered.length - 1].date,
    initialValue: initialCashEUR,
    finalValue,
    totalReturn,
    cagr,
    maxDrawdown: maxDrawdown * 100,
    totalInvested: initialCashEUR,
    afterTaxReturn,
    afterTaxCAGR,
    history,
  };
}

/**
 * Run Pure DCA benchmark
 *
 * Fixed amount at fixed interval regardless of risk
 */
export function runPureDCABenchmark(
  data: RiskDataPoint[],
  initialCashEUR: number,
  dcaAmount: number,
  interval: 'daily' | 'weekly' | 'biweekly' | 'monthly',
  startDate: string,
  endDate?: string,
  taxRate: number = 0.30
): BenchmarkResult {
  const filtered = data.filter(d => {
    const date = new Date(d.date);
    const start = new Date(startDate);
    const end = endDate ? new Date(endDate) : new Date();
    return date >= start && date <= end;
  });

  if (filtered.length === 0) {
    return {
      name: 'Pure DCA',
      description: `DCA €${dcaAmount} ${interval}`,
      startDate,
      endDate: endDate || 'now',
      initialValue: initialCashEUR,
      finalValue: 0,
      totalReturn: 0,
      cagr: 0,
      maxDrawdown: 0,
      totalInvested: initialCashEUR,
    };
  }

  let cash = initialCashEUR;
  let btc = 0;
  let lastDCADate: Date | null = null;
  let maxValue = initialCashEUR;
  let maxDrawdown = 0;
  let totalInvested = 0;
  const history: { date: string; value: number }[] = [];

  for (const point of filtered) {
    const dateObj = new Date(point.date);

    if (shouldPerformDCA(dateObj, lastDCADate, interval) && cash >= dcaAmount) {
      btc += dcaAmount / point.price;
      cash -= dcaAmount;
      totalInvested += dcaAmount;
      lastDCADate = dateObj;
    }

    const value = cash + btc * point.price;
    history.push({ date: point.date, value });

    if (value > maxValue) maxValue = value;
    const dd = (maxValue - value) / maxValue;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  const finalValue = cash + btc * filtered[filtered.length - 1].price;
  const totalReturn = ((finalValue - initialCashEUR) / initialCashEUR) * 100;

  const years = (
    new Date(filtered[filtered.length - 1].date).getTime() -
    new Date(filtered[0].date).getTime()
  ) / (365.25 * 24 * 60 * 60 * 1000);

  const cagr = (Math.pow(finalValue / initialCashEUR, 1 / years) - 1) * 100;

  // After-tax (simplified: assume all BTC sold at end)
  const costBasis = totalInvested;
  const proceeds = btc * filtered[filtered.length - 1].price;
  const gain = proceeds - costBasis;
  const tax = gain > 0 ? gain * taxRate : 0;
  const afterTaxFinalValue = finalValue - tax;
  const afterTaxReturn = ((afterTaxFinalValue - initialCashEUR) / initialCashEUR) * 100;
  const afterTaxCAGR = (Math.pow(afterTaxFinalValue / initialCashEUR, 1 / years) - 1) * 100;

  return {
    name: 'Pure DCA',
    description: `DCA €${dcaAmount} ${interval}`,
    startDate,
    endDate: filtered[filtered.length - 1].date,
    initialValue: initialCashEUR,
    finalValue,
    totalReturn,
    cagr,
    maxDrawdown: maxDrawdown * 100,
    totalInvested,
    afterTaxReturn,
    afterTaxCAGR,
    history,
  };
}

/**
 * Run full comparison: Strategy vs Benchmarks
 */
export function runDCASwingComparison(
  data: RiskDataPoint[],
  config: DCASwingConfig = DEFAULT_DCA_SWING_CONFIG
): DCASwingComparisonResult {
  // Run strategy
  const strategy = runDCASwingBacktest(data, config);

  // Run benchmarks
  const benchmarks: BenchmarkResult[] = [
    // Buy & Hold from strategy start date
    runBuyAndHoldBenchmark(
      data,
      config.initialCashEUR,
      config.startDate,
      config.endDate,
      undefined,
      config.tax.taxRateBelow30k
    ),

    // Pure DCA with same parameters
    runPureDCABenchmark(
      data,
      config.initialCashEUR,
      config.dca.baseAmount,
      config.dca.interval,
      config.startDate,
      config.endDate,
      config.tax.taxRateBelow30k
    ),
  ];

  // Find best benchmark after-tax return
  const bestBenchmarkAfterTax = Math.max(
    ...benchmarks.map(b => b.afterTaxCAGR || b.cagr)
  );

  // Calculate summary
  const strategyAfterTax = strategy.taxMetrics.afterTaxCAGR;
  const afterTaxOutperformance = strategyAfterTax - bestBenchmarkAfterTax;

  // Risk-adjusted comparison (Sharpe)
  const strategyWins = strategyAfterTax > bestBenchmarkAfterTax;

  // Tax efficiency
  const taxEfficiency = strategy.metrics.totalReturn > 0
    ? strategy.taxMetrics.afterTaxReturn / strategy.metrics.totalReturn
    : 1;

  return {
    strategy,
    benchmarks,
    summary: {
      strategyWins,
      afterTaxOutperformance,
      riskAdjustedOutperformance: strategy.metrics.sharpeRatio, // vs benchmark Sharpe (not calculated)
      taxEfficiency,
    },
  };
}

/**
 * Find the 2017 bottom date in the data
 */
export function find2017BottomDate(data: RiskDataPoint[]): string {
  // Filter to 2017-2019 period (bear market bottom was around Dec 2018)
  const bearMarketData = data.filter(d => {
    const date = new Date(d.date);
    return date >= new Date('2017-12-01') && date <= new Date('2019-03-01');
  });

  if (bearMarketData.length === 0) {
    return '2018-12-15'; // Approximate bottom date
  }

  // Find lowest price
  let minPrice = Infinity;
  let bottomDate = bearMarketData[0].date;

  for (const point of bearMarketData) {
    if (point.price < minPrice) {
      minPrice = point.price;
      bottomDate = point.date;
    }
  }

  return bottomDate;
}

/**
 * Run special benchmark: Buy at 2017 bottom, sell at strategy end
 */
export function runBottomBuyBenchmark(
  data: RiskDataPoint[],
  initialCashEUR: number,
  endDate?: string,
  taxRate: number = 0.30
): BenchmarkResult {
  const bottomDate = find2017BottomDate(data);

  return {
    ...runBuyAndHoldBenchmark(
      data,
      initialCashEUR,
      bottomDate,
      endDate,
      bottomDate,
      taxRate
    ),
    name: 'Buy at 2017 Bottom',
    description: `Buy at ${bottomDate} (cycle bottom), hold until end`,
  };
}

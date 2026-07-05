/**
 * Strategy Signal Generator
 *
 * Generates buy/sell/hold signals based on risk metric
 * with tax-aware considerations.
 */

import {
  StrategySignal,
  StrategyConfig,
  StrategyAction,
  PortfolioState,
  DEFAULT_STRATEGY_CONFIG,
} from './types';
import {
  getRiskZone,
  getTargetAllocation,
  interpolateTargetAllocation,
  HysteresisState,
  updateHysteresis,
  isRebalanceDay,
} from './risk-zones';
import { FIFOLedger } from './fifo-ledger';

/**
 * Generate strategy signal for a single day
 */
export function generateSignal(
  date: string,
  price: number,
  risk: number,
  portfolio: PortfolioState,
  hysteresisState: HysteresisState,
  ledger: FIFOLedger,
  config: StrategyConfig = DEFAULT_STRATEGY_CONFIG,
  currentYearGains: number = 0
): StrategySignal {
  // Get risk zone with hysteresis
  const riskZone = hysteresisState.confirmedZone;

  // Get target allocation (using interpolation for smoother transitions)
  const targetAllocation = interpolateTargetAllocation(risk, config);

  // Calculate current allocation
  const currentAllocation = portfolio.btcAllocation;

  // Determine if we should rebalance today
  const shouldRebalance = isRebalanceDay(date, config);

  // Calculate allocation difference
  const allocationDiff = targetAllocation - currentAllocation;
  const allocationDiffPercent = Math.abs(allocationDiff);

  // Default to HOLD
  let action: StrategyAction = 'HOLD';
  let tradeSize = 0;
  let tradeSizePercent = 0;
  let reason = 'No action needed';

  // Check if rebalancing is needed
  const minRebalanceThreshold = 0.05; // 5% minimum difference to trigger rebalance

  if (shouldRebalance && allocationDiffPercent >= minRebalanceThreshold) {
    if (allocationDiff > 0) {
      // Need to BUY more BTC
      action = 'BUY';

      // Calculate trade size
      const targetBTCValue = targetAllocation * portfolio.totalValueEUR;
      const currentBTCValue = currentAllocation * portfolio.totalValueEUR;
      const idealTradeValue = targetBTCValue - currentBTCValue;

      // Apply constraints
      tradeSize = Math.min(
        idealTradeValue,
        portfolio.cashEUR * 0.95, // Leave 5% cash buffer
        portfolio.totalValueEUR * config.maxTradePercent
      );

      // Check minimum trade size
      if (tradeSize < config.minTradeSize) {
        action = 'HOLD';
        tradeSize = 0;
        reason = `Trade size (${tradeSize.toFixed(0)} EUR) below minimum (${config.minTradeSize} EUR)`;
      } else {
        tradeSizePercent = tradeSize / portfolio.totalValueEUR;
        reason = `Rebalancing: increasing BTC allocation from ${(currentAllocation * 100).toFixed(1)}% to ${(targetAllocation * 100).toFixed(1)}%`;
      }
    } else {
      // Need to SELL BTC
      action = 'SELL';

      // Calculate trade size
      const targetBTCValue = targetAllocation * portfolio.totalValueEUR;
      const currentBTCValue = currentAllocation * portfolio.totalValueEUR;
      const idealTradeValue = currentBTCValue - targetBTCValue;

      // Apply constraints
      tradeSize = Math.min(
        idealTradeValue,
        portfolio.btcValueEUR * 0.95, // Leave 5% buffer
        portfolio.totalValueEUR * config.maxTradePercent
      );

      // Check minimum trade size
      if (tradeSize < config.minTradeSize) {
        action = 'HOLD';
        tradeSize = 0;
        reason = `Trade size (${tradeSize.toFixed(0)} EUR) below minimum (${config.minTradeSize} EUR)`;
      } else {
        // Tax budget check
        if (config.annualTaxBudget !== undefined) {
          const btcToSell = tradeSize / price;
          const estimatedGain = ledger.estimateSalePL(btcToSell, price);

          if (estimatedGain > 0) {
            const projectedYearlyGains = currentYearGains + estimatedGain;

            if (projectedYearlyGains > config.annualTaxBudget) {
              // Would exceed tax budget
              if (riskZone !== 'defensive') {
                // Not in extreme risk zone - reduce or skip trade
                const remainingBudget = Math.max(0, config.annualTaxBudget - currentYearGains);

                if (remainingBudget < config.minTradeSize) {
                  action = 'HOLD';
                  tradeSize = 0;
                  reason = `Tax budget exhausted (${currentYearGains.toFixed(0)} / ${config.annualTaxBudget} EUR)`;
                } else {
                  // Reduce trade size to stay within budget
                  // This is approximate - actual gain depends on cost basis
                  tradeSize = Math.min(tradeSize, remainingBudget * 1.5);
                  tradeSizePercent = tradeSize / portfolio.totalValueEUR;
                  reason = `Reduced trade to stay within tax budget (${config.annualTaxBudget} EUR/year)`;
                }
              } else {
                // Defensive zone - allow exceeding budget
                tradeSizePercent = tradeSize / portfolio.totalValueEUR;
                reason = `Defensive zone: selling despite exceeding tax budget`;
              }
            } else {
              tradeSizePercent = tradeSize / portfolio.totalValueEUR;
              reason = `Rebalancing: decreasing BTC allocation from ${(currentAllocation * 100).toFixed(1)}% to ${(targetAllocation * 100).toFixed(1)}%`;
            }
          } else {
            // Would sell at a loss - allow for loss harvesting if enabled
            if (config.enableLossHarvesting) {
              tradeSizePercent = tradeSize / portfolio.totalValueEUR;
              reason = `Loss harvesting: selling at loss (estimated ${estimatedGain.toFixed(0)} EUR)`;
            } else {
              action = 'HOLD';
              tradeSize = 0;
              reason = `Skipping sale at loss (loss harvesting disabled)`;
            }
          }
        } else {
          tradeSizePercent = tradeSize / portfolio.totalValueEUR;
          reason = `Rebalancing: decreasing BTC allocation from ${(currentAllocation * 100).toFixed(1)}% to ${(targetAllocation * 100).toFixed(1)}%`;
        }
      }
    }
  } else if (!shouldRebalance) {
    reason = `Not a rebalance day (${config.rebalanceCadence})`;
  } else {
    reason = `Allocation difference (${(allocationDiffPercent * 100).toFixed(1)}%) below threshold (${(minRebalanceThreshold * 100).toFixed(0)}%)`;
  }

  return {
    date,
    price,
    risk,
    riskZone,
    targetAllocation,
    action,
    tradeSize,
    tradeSizePercent,
    reason,
  };
}

/**
 * Generate signals for an entire time series
 */
export function generateAllSignals(
  data: Array<{ date: string; price: number; risk: number }>,
  initialPortfolio: PortfolioState,
  config: StrategyConfig = DEFAULT_STRATEGY_CONFIG
): StrategySignal[] {
  if (data.length === 0) return [];

  const signals: StrategySignal[] = [];
  let hysteresisState: HysteresisState = {
    currentZone: getRiskZone(data[0].risk, config),
    daysInZone: 1,
    confirmedZone: getRiskZone(data[0].risk, config),
  };

  let portfolio = { ...initialPortfolio };
  const ledger = new FIFOLedger();

  // Add initial BTC as a lot if any
  if (initialPortfolio.btcQuantity > 0) {
    ledger.buy(
      data[0].date,
      initialPortfolio.btcQuantity,
      data[0].price,
      0,
      'initial'
    );
  }

  for (const point of data) {
    // Update hysteresis
    hysteresisState = updateHysteresis(hysteresisState, point.risk, config);

    // Update portfolio values
    portfolio = {
      ...portfolio,
      date: point.date,
      btcValueEUR: portfolio.btcQuantity * point.price,
      totalValueEUR: portfolio.cashEUR + portfolio.btcQuantity * point.price,
      btcAllocation:
        portfolio.btcQuantity * point.price /
        (portfolio.cashEUR + portfolio.btcQuantity * point.price) || 0,
    };

    // Generate signal
    const signal = generateSignal(
      point.date,
      point.price,
      point.risk,
      portfolio,
      hysteresisState,
      ledger,
      config,
      ledger.getCurrentYearGains()
    );

    signals.push(signal);

    // Simulate trade execution for next iteration
    if (signal.action === 'BUY' && signal.tradeSize > 0) {
      const btcToBuy = signal.tradeSize / point.price;
      portfolio.cashEUR -= signal.tradeSize;
      portfolio.btcQuantity += btcToBuy;
      ledger.buy(point.date, btcToBuy, point.price, 0, 'buy');
    } else if (signal.action === 'SELL' && signal.tradeSize > 0) {
      const btcToSell = signal.tradeSize / point.price;
      portfolio.cashEUR += signal.tradeSize;
      portfolio.btcQuantity -= btcToSell;
      ledger.sell(point.date, btcToSell, point.price, 0);
    }
  }

  return signals;
}

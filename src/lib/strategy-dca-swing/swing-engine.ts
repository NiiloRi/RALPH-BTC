/**
 * Swing Trading Engine
 *
 * Handles de-risking (selling) when risk is high for consecutive days,
 * and re-risking (buying back) when risk drops.
 */

import {
  SwingTradingConfig,
  SwingRiskZone,
  DCASwingConfig,
  DEFAULT_DCA_SWING_CONFIG,
} from './types';

/**
 * Swing trading state tracker
 */
export interface SwingState {
  // Consecutive days tracking
  consecutiveHighRiskDays: number;
  consecutiveLowRiskDays: number;

  // Cooldown tracking
  daysSinceLastDerisk: number;
  daysSinceLastRerisk: number;

  // Monthly de-risk tracking
  currentMonth: number;
  currentYear: number;
  monthDeriskTotal: number;  // Percentage of portfolio de-risked this month

  // Last action
  lastDeriskDate: string | null;
  lastReriskDate: string | null;
}

/**
 * Create initial swing state
 */
export function createSwingState(): SwingState {
  return {
    consecutiveHighRiskDays: 0,
    consecutiveLowRiskDays: 0,
    daysSinceLastDerisk: 999,
    daysSinceLastRerisk: 999,
    currentMonth: 0,
    currentYear: 0,
    monthDeriskTotal: 0,
    lastDeriskDate: null,
    lastReriskDate: null,
  };
}

/**
 * Get swing risk zone from risk value
 */
export function getSwingRiskZone(
  risk: number,
  config: DCASwingConfig = DEFAULT_DCA_SWING_CONFIG
): SwingRiskZone {
  const { zones } = config;

  if (risk <= zones.extremeBuy) return 'extreme_buy';
  if (risk <= zones.strongBuy) return 'strong_buy';
  if (risk <= zones.buy) return 'buy';
  if (risk <= zones.neutral) return 'neutral';
  if (risk <= zones.cautious) return 'cautious';
  if (risk <= zones.sell) return 'sell';
  return 'strong_sell';
}

/**
 * Get zone color for UI
 */
export function getSwingZoneColor(zone: SwingRiskZone): string {
  switch (zone) {
    case 'extreme_buy':
      return '#15803d'; // Dark green
    case 'strong_buy':
      return '#22c55e'; // Green
    case 'buy':
      return '#84cc16'; // Lime
    case 'neutral':
      return '#eab308'; // Yellow
    case 'cautious':
      return '#f97316'; // Orange
    case 'sell':
      return '#ef4444'; // Red
    case 'strong_sell':
      return '#991b1b'; // Dark red
  }
}

/**
 * Get zone description for UI
 */
export function getSwingZoneDescription(zone: SwingRiskZone): string {
  switch (zone) {
    case 'extreme_buy':
      return 'Extreme buy opportunity - maximum accumulation';
    case 'strong_buy':
      return 'Strong buy signal - aggressive DCA';
    case 'buy':
      return 'Normal buy zone - standard DCA';
    case 'neutral':
      return 'Neutral - reduced activity';
    case 'cautious':
      return 'Cautious - DCA paused';
    case 'sell':
      return 'De-risk zone - consider profit taking';
    case 'strong_sell':
      return 'Strong de-risk signal - reduce exposure';
  }
}

/**
 * Swing action decision
 */
export interface SwingDecision {
  action: 'NONE' | 'DERISK' | 'RERISK';
  percent: number;  // Percentage of holdings to sell, or cash to use
  reason: string;
  cannotExecute?: string;  // Reason why we can't execute even if triggered
}

/**
 * Update swing state and determine if action should be taken
 */
export function updateSwingState(
  state: SwingState,
  risk: number,
  date: string,
  config: SwingTradingConfig = DEFAULT_DCA_SWING_CONFIG.swing
): { newState: SwingState; decision: SwingDecision } {
  const dateObj = new Date(date);
  const month = dateObj.getMonth();
  const year = dateObj.getFullYear();

  // Create new state
  let newState: SwingState = { ...state };

  // Reset monthly counter if new month
  if (month !== state.currentMonth || year !== state.currentYear) {
    newState.currentMonth = month;
    newState.currentYear = year;
    newState.monthDeriskTotal = 0;
  }

  // Increment cooldown counters
  newState.daysSinceLastDerisk = state.daysSinceLastDerisk + 1;
  newState.daysSinceLastRerisk = state.daysSinceLastRerisk + 1;

  // Update consecutive day counters
  if (risk >= config.deriskThreshold) {
    newState.consecutiveHighRiskDays = state.consecutiveHighRiskDays + 1;
    newState.consecutiveLowRiskDays = 0;
  } else if (risk <= config.reriskThreshold) {
    newState.consecutiveLowRiskDays = state.consecutiveLowRiskDays + 1;
    newState.consecutiveHighRiskDays = 0;
  } else {
    // In neutral zone - decay both counters slowly
    newState.consecutiveHighRiskDays = Math.max(0, state.consecutiveHighRiskDays - 1);
    newState.consecutiveLowRiskDays = Math.max(0, state.consecutiveLowRiskDays - 1);
  }

  // Default decision
  let decision: SwingDecision = {
    action: 'NONE',
    percent: 0,
    reason: 'No swing action triggered',
  };

  if (!config.enabled) {
    return { newState, decision };
  }

  // Check for de-risk trigger
  if (newState.consecutiveHighRiskDays >= config.consecutiveDaysToTrigger) {
    // Check cooldown
    if (newState.daysSinceLastDerisk < config.cooldownDays) {
      decision = {
        action: 'NONE',
        percent: 0,
        reason: `De-risk triggered but in cooldown (${config.cooldownDays - newState.daysSinceLastDerisk} days remaining)`,
        cannotExecute: 'cooldown',
      };
    }
    // Check monthly limit
    else if (newState.monthDeriskTotal >= config.maxDeriskPerMonth) {
      decision = {
        action: 'NONE',
        percent: 0,
        reason: `De-risk triggered but monthly limit reached (${(config.maxDeriskPerMonth * 100).toFixed(0)}%)`,
        cannotExecute: 'monthly_limit',
      };
    }
    // Execute de-risk
    else {
      const deriskPercent = Math.min(
        config.deriskPercent,
        config.maxDeriskPerMonth - newState.monthDeriskTotal
      );

      decision = {
        action: 'DERISK',
        percent: deriskPercent,
        reason: `${config.consecutiveDaysToTrigger} consecutive days above ${(config.deriskThreshold * 100).toFixed(0)}% risk`,
      };

      // Update state
      newState.daysSinceLastDerisk = 0;
      newState.monthDeriskTotal += deriskPercent;
      newState.lastDeriskDate = date;
      newState.consecutiveHighRiskDays = 0; // Reset counter
    }
  }
  // Check for re-risk trigger
  else if (
    config.reriskEnabled &&
    newState.consecutiveLowRiskDays >= config.reriskConsecutiveDays
  ) {
    // Only re-risk if we've de-risked before
    if (newState.lastDeriskDate !== null) {
      decision = {
        action: 'RERISK',
        percent: config.reriskPercent,
        reason: `${config.reriskConsecutiveDays} consecutive days below ${(config.reriskThreshold * 100).toFixed(0)}% risk`,
      };

      // Update state
      newState.daysSinceLastRerisk = 0;
      newState.lastReriskDate = date;
      newState.consecutiveLowRiskDays = 0; // Reset counter
    }
  }

  return { newState, decision };
}

/**
 * Calculate position size for swing trade
 * Takes into account tax budget constraints
 */
export function calculateSwingTradeSize(
  decision: SwingDecision,
  portfolioValueEUR: number,
  btcQuantity: number,
  btcPrice: number,
  cashEUR: number,
  estimatedGain: number,
  yearlyGains: number,
  taxBudget: number | undefined
): { btcAmount: number; eurAmount: number; reason: string } {
  if (decision.action === 'DERISK') {
    const targetSellBTC = btcQuantity * decision.percent;
    const targetSellEUR = targetSellBTC * btcPrice;

    // Check tax budget
    if (taxBudget !== undefined && estimatedGain > 0) {
      const remainingBudget = Math.max(0, taxBudget - yearlyGains);

      if (estimatedGain > remainingBudget) {
        // Reduce sale to stay within tax budget
        const reducedGain = remainingBudget * 0.9; // 90% to leave buffer
        const costBasisRatio = (targetSellEUR - estimatedGain) / targetSellEUR;
        const maxSaleEUR = reducedGain / (1 - costBasisRatio);
        const maxSaleBTC = maxSaleEUR / btcPrice;

        if (maxSaleBTC < targetSellBTC * 0.3) {
          // Can only sell less than 30% of intended, skip
          return {
            btcAmount: 0,
            eurAmount: 0,
            reason: `Tax budget constraint prevents de-risk (budget: €${taxBudget.toFixed(0)})`,
          };
        }

        return {
          btcAmount: maxSaleBTC,
          eurAmount: maxSaleEUR,
          reason: `De-risk reduced for tax budget (${(maxSaleBTC / btcQuantity * 100).toFixed(1)}% instead of ${(decision.percent * 100).toFixed(1)}%)`,
        };
      }
    }

    return {
      btcAmount: targetSellBTC,
      eurAmount: targetSellEUR,
      reason: decision.reason,
    };
  }

  if (decision.action === 'RERISK') {
    const targetBuyEUR = cashEUR * decision.percent;
    const targetBuyBTC = targetBuyEUR / btcPrice;

    return {
      btcAmount: targetBuyBTC,
      eurAmount: targetBuyEUR,
      reason: decision.reason,
    };
  }

  return {
    btcAmount: 0,
    eurAmount: 0,
    reason: decision.reason,
  };
}

/**
 * Get swing trading summary for a given state
 */
export function getSwingSummary(state: SwingState, config: SwingTradingConfig): string {
  const parts: string[] = [];

  if (state.consecutiveHighRiskDays > 0) {
    parts.push(`${state.consecutiveHighRiskDays} high-risk days (trigger: ${config.consecutiveDaysToTrigger})`);
  }

  if (state.consecutiveLowRiskDays > 0 && config.reriskEnabled) {
    parts.push(`${state.consecutiveLowRiskDays} low-risk days (re-risk trigger: ${config.reriskConsecutiveDays})`);
  }

  if (state.daysSinceLastDerisk < config.cooldownDays) {
    parts.push(`Cooldown: ${config.cooldownDays - state.daysSinceLastDerisk} days`);
  }

  if (state.monthDeriskTotal > 0) {
    parts.push(`Month de-risk: ${(state.monthDeriskTotal * 100).toFixed(0)}% / ${(config.maxDeriskPerMonth * 100).toFixed(0)}%`);
  }

  return parts.length > 0 ? parts.join(' | ') : 'No swing activity';
}

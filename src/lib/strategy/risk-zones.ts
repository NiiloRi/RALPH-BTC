/**
 * Risk Zone Logic
 *
 * Implements risk zone classification with hysteresis
 * to avoid excessive regime switching.
 */

import {
  RiskZone,
  StrategyConfig,
  DEFAULT_STRATEGY_CONFIG,
} from './types';

/**
 * Get risk zone from risk value
 */
export function getRiskZone(
  risk: number,
  config: StrategyConfig = DEFAULT_STRATEGY_CONFIG
): RiskZone {
  const { zones } = config;

  if (risk <= zones.accumulate.max) return 'accumulate';
  if (risk <= zones.normal.max) return 'normal';
  if (risk <= zones.cautious.max) return 'cautious';
  if (risk <= zones.derisk.max) return 'derisk';
  return 'defensive';
}

/**
 * Get target allocation for a risk zone
 */
export function getTargetAllocation(
  zone: RiskZone,
  config: StrategyConfig = DEFAULT_STRATEGY_CONFIG
): number {
  const { zones } = config;

  switch (zone) {
    case 'accumulate':
      return zones.accumulate.targetAllocation;
    case 'normal':
      return zones.normal.targetAllocation;
    case 'cautious':
      return zones.cautious.targetAllocation;
    case 'derisk':
      return zones.derisk.targetAllocation;
    case 'defensive':
      return zones.defensive.targetAllocation;
    default:
      return 0.5; // Fallback
  }
}

/**
 * Hysteresis state tracker
 */
export interface HysteresisState {
  currentZone: RiskZone;
  daysInZone: number;
  confirmedZone: RiskZone;
}

/**
 * Initial hysteresis state
 */
export function createHysteresisState(initialRisk: number): HysteresisState {
  const zone = getRiskZone(initialRisk);
  return {
    currentZone: zone,
    daysInZone: 1,
    confirmedZone: zone,
  };
}

/**
 * Update hysteresis state with new risk value
 * Returns the confirmed zone (which may lag behind current zone)
 */
export function updateHysteresis(
  state: HysteresisState,
  risk: number,
  config: StrategyConfig = DEFAULT_STRATEGY_CONFIG
): HysteresisState {
  const newZone = getRiskZone(risk, config);

  if (newZone === state.currentZone) {
    // Same zone - increment counter
    const daysInZone = state.daysInZone + 1;
    const confirmedZone =
      daysInZone >= config.hysteresisDays ? newZone : state.confirmedZone;

    return {
      currentZone: newZone,
      daysInZone,
      confirmedZone,
    };
  } else {
    // Zone changed - reset counter
    return {
      currentZone: newZone,
      daysInZone: 1,
      confirmedZone: state.confirmedZone, // Keep old confirmed zone
    };
  }
}

/**
 * Check if it's a rebalance day based on cadence
 */
export function isRebalanceDay(
  date: string,
  config: StrategyConfig = DEFAULT_STRATEGY_CONFIG
): boolean {
  const d = new Date(date);
  const dayOfWeek = d.getDay(); // 0 = Sunday, 1 = Monday, etc.
  const dayOfMonth = d.getDate();

  switch (config.rebalanceCadence) {
    case 'daily':
      return true;
    case 'weekly':
      return dayOfWeek === (config.rebalanceDay ?? 1); // Default Monday
    case 'monthly':
      return dayOfMonth === (config.rebalanceDay ?? 1); // Default 1st
    default:
      return true;
  }
}

/**
 * Get zone description for UI
 */
export function getZoneDescription(zone: RiskZone): string {
  switch (zone) {
    case 'accumulate':
      return 'Accumulate Zone - Aggressive buying opportunity';
    case 'normal':
      return 'Normal Zone - Standard DCA / hold';
    case 'cautious':
      return 'Cautious Zone - Reduce new purchases';
    case 'derisk':
      return 'De-risk Zone - Consider profit-taking';
    case 'defensive':
      return 'Defensive Zone - Minimize exposure';
  }
}

/**
 * Get zone color for UI (CSS class or hex)
 */
export function getZoneColor(zone: RiskZone): string {
  switch (zone) {
    case 'accumulate':
      return '#22c55e'; // Green
    case 'normal':
      return '#84cc16'; // Lime
    case 'cautious':
      return '#eab308'; // Yellow
    case 'derisk':
      return '#f97316'; // Orange
    case 'defensive':
      return '#dc2626'; // Red
  }
}

/**
 * Interpolate target allocation based on continuous risk value
 * This provides smoother transitions than discrete zones
 */
export function interpolateTargetAllocation(
  risk: number,
  config: StrategyConfig = DEFAULT_STRATEGY_CONFIG
): number {
  const { zones } = config;

  // Define breakpoints
  const breakpoints = [
    { risk: 0, allocation: zones.accumulate.targetAllocation },
    { risk: zones.accumulate.max, allocation: zones.accumulate.targetAllocation },
    { risk: zones.normal.max, allocation: zones.normal.targetAllocation },
    { risk: zones.cautious.max, allocation: zones.cautious.targetAllocation },
    { risk: zones.derisk.max, allocation: zones.derisk.targetAllocation },
    { risk: 1.0, allocation: zones.defensive.targetAllocation },
  ];

  // Find the two breakpoints to interpolate between
  for (let i = 0; i < breakpoints.length - 1; i++) {
    if (risk <= breakpoints[i + 1].risk) {
      const lower = breakpoints[i];
      const upper = breakpoints[i + 1];

      if (upper.risk === lower.risk) return lower.allocation;

      const t = (risk - lower.risk) / (upper.risk - lower.risk);
      return lower.allocation + t * (upper.allocation - lower.allocation);
    }
  }

  return zones.defensive.targetAllocation;
}

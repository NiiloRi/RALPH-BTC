/**
 * RISK MOMENTUM MODULE
 *
 * Derives momentum indicators ONLY from the existing risk time series.
 * Provides first derivative (ΔRisk) and second derivative (acceleration).
 *
 * CRITICAL CONSTRAINT: This module NEVER feeds back into the base risk score.
 * It only READS from RiskOutput for EXPLANATORY purposes.
 *
 * Data Flow:
 *   RiskOutput[] (READ-ONLY) → RiskMomentum
 */

import { RiskOutput } from '../types';
import { RiskMomentum, MomentumDirection } from './types';

/**
 * Calculate first derivative of risk (daily change)
 * Uses simple backward difference
 *
 * @param risks - Risk history (most recent last)
 * @param index - Current index
 * @returns Daily rate of change
 */
export function calculateDeltaRisk(risks: number[], index: number): number {
  if (index < 1) return 0;

  return risks[index] - risks[index - 1];
}

/**
 * Calculate second derivative (acceleration)
 * Measures whether the rate of change is itself changing
 *
 * @param risks - Risk history (most recent last)
 * @param index - Current index
 * @returns Acceleration (change in rate of change)
 */
export function calculateAcceleration(risks: number[], index: number): number {
  if (index < 2) return 0;

  const currentDelta = risks[index] - risks[index - 1];
  const previousDelta = risks[index - 1] - risks[index - 2];

  return currentDelta - previousDelta;
}

/**
 * Calculate N-day change in risk
 *
 * @param risks - Risk history (most recent last)
 * @param index - Current index
 * @param days - Lookback period
 * @returns Change over N days
 */
export function calculateNDayDelta(
  risks: number[],
  index: number,
  days: number
): number {
  if (index < days) return 0;

  return risks[index] - risks[index - days];
}

/**
 * Determine momentum direction from recent changes
 * Uses a threshold to determine "stable" vs trending
 *
 * @param delta7d - 7-day change in risk
 * @param threshold - Minimum change to be considered trending (default 0.03)
 * @returns Direction indicator
 */
export function getMomentumDirection(
  delta7d: number,
  threshold: number = 0.03
): MomentumDirection {
  if (delta7d > threshold) return 'rising';
  if (delta7d < -threshold) return 'falling';
  return 'stable';
}

/**
 * Get direction symbol for display
 */
export function getDirectionSymbol(direction: MomentumDirection): '↑' | '→' | '↓' {
  switch (direction) {
    case 'rising':
      return '↑';
    case 'falling':
      return '↓';
    default:
      return '→';
  }
}

/**
 * Calculate momentum strength
 * Measures how strong/sustained the current trend is
 *
 * @param risks - Risk history (most recent last)
 * @param index - Current index
 * @param lookback - Number of days to analyze (default 14)
 * @returns Strength score [0, 1]
 */
export function calculateMomentumStrength(
  risks: number[],
  index: number,
  lookback: number = 14
): number {
  if (index < lookback) return 0;

  // Count consecutive days in same direction
  let consecutiveDays = 0;
  let currentSign = Math.sign(risks[index] - risks[index - 1]);

  for (let i = index - 1; i >= Math.max(0, index - lookback); i--) {
    const delta = risks[i + 1] - risks[i];
    if (Math.sign(delta) === currentSign && Math.abs(delta) > 0.001) {
      consecutiveDays++;
    } else {
      break;
    }
  }

  // Also consider magnitude of recent change
  const delta7d = Math.abs(calculateNDayDelta(risks, index, 7));
  const magnitudeScore = Math.min(1, delta7d / 0.15); // 15% change = max magnitude

  // Combine: consecutive days (persistence) + magnitude
  const persistenceScore = Math.min(1, consecutiveDays / 7);

  return persistenceScore * 0.5 + magnitudeScore * 0.5;
}

/**
 * Calculate Risk Momentum for a specific day
 *
 * @param risks - Array of RiskOutput (historical, most recent last)
 * @param currentIndex - Index of the current day
 * @returns RiskMomentum for the specified day
 */
export function calculateRiskMomentum(
  risks: RiskOutput[],
  currentIndex: number
): RiskMomentum {
  if (currentIndex < 0 || currentIndex >= risks.length) {
    throw new Error(`Invalid index ${currentIndex} for risks array of length ${risks.length}`);
  }

  // Use smoothedRisk for momentum calculations (less noise)
  const riskValues = risks.map(r => r.smoothedRisk);

  const deltaRisk = calculateDeltaRisk(riskValues, currentIndex);
  const acceleration = calculateAcceleration(riskValues, currentIndex);
  const delta7d = calculateNDayDelta(riskValues, currentIndex, 7);
  const delta30d = calculateNDayDelta(riskValues, currentIndex, 30);
  const direction = getMomentumDirection(delta7d);
  const strength = calculateMomentumStrength(riskValues, currentIndex);

  return {
    deltaRisk,
    acceleration,
    delta7d,
    delta30d,
    direction,
    directionSymbol: getDirectionSymbol(direction),
    strength,
  };
}

/**
 * Calculate Risk Momentum for all days in the series
 *
 * @param risks - Array of RiskOutput (historical, most recent last)
 * @param startIndex - Start index (to allow warmup period)
 * @returns Array of RiskMomentum
 */
export function calculateAllRiskMomentum(
  risks: RiskOutput[],
  startIndex: number = 30
): RiskMomentum[] {
  const results: RiskMomentum[] = [];

  for (let i = startIndex; i < risks.length; i++) {
    results.push(calculateRiskMomentum(risks, i));
  }

  return results;
}

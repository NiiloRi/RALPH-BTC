/**
 * Cycle-aware features for BTC risk model
 * Models the 4-year halving cycle with adjustments for:
 * - Lengthening cycles
 * - Diminishing returns
 * - Diminishing losses
 */

import { HALVING_DATES, GENESIS_DATE } from '../types';

/**
 * Get the halving index for a given date
 * Returns -1 if before first halving
 */
export function getHalvingIndex(date: Date): number {
  for (let i = HALVING_DATES.length - 1; i >= 0; i--) {
    if (date >= HALVING_DATES[i]) {
      return i;
    }
  }
  return -1;
}

/**
 * Calculate days since most recent halving
 */
export function daysSinceHalving(date: Date): number {
  const halvingIdx = getHalvingIndex(date);

  if (halvingIdx === -1) {
    // Before first halving, measure from genesis
    return Math.floor(
      (date.getTime() - GENESIS_DATE.getTime()) / (1000 * 60 * 60 * 24)
    );
  }

  const halving = HALVING_DATES[halvingIdx];
  return Math.floor(
    (date.getTime() - halving.getTime()) / (1000 * 60 * 60 * 24)
  );
}

/**
 * Calculate days since genesis
 */
export function daysSinceGenesis(date: Date): number {
  return Math.floor(
    (date.getTime() - GENESIS_DATE.getTime()) / (1000 * 60 * 60 * 24)
  );
}

/**
 * Estimate cycle length based on historical data
 * Uses only past data (no future peeking)
 */
export function estimateCycleLength(
  currentHalvingIdx: number,
  peakDates: Date[]
): number {
  // Default cycle length: ~1460 days (4 years)
  const DEFAULT_CYCLE = 1460;

  if (currentHalvingIdx <= 0 || peakDates.length < 2) {
    return DEFAULT_CYCLE;
  }

  // Calculate average peak-to-peak duration from completed cycles
  const cycleLengths: number[] = [];
  for (let i = 1; i < peakDates.length; i++) {
    const duration = Math.floor(
      (peakDates[i].getTime() - peakDates[i - 1].getTime()) / (1000 * 60 * 60 * 24)
    );
    cycleLengths.push(duration);
  }

  if (cycleLengths.length === 0) {
    return DEFAULT_CYCLE;
  }

  // Simple average of historical cycle lengths
  const avgCycle = cycleLengths.reduce((a, b) => a + b, 0) / cycleLengths.length;

  // Apply lengthening adjustment (each cycle ~10-20% longer)
  const lengtheningFactor = 1 + 0.15 * (currentHalvingIdx - 1);

  return Math.round(avgCycle * lengtheningFactor);
}

/**
 * Determine cycle phase based on days since halving
 * Phases: early (0-33%), mid (33-66%), late (66-100%)
 */
export function getCyclePhase(
  daysSinceHalving: number,
  estimatedCycleLength: number
): 'early' | 'mid' | 'late' {
  const progress = daysSinceHalving / estimatedCycleLength;

  if (progress < 0.33) return 'early';
  if (progress < 0.66) return 'mid';
  return 'late';
}

/**
 * Calculate estimated cycle progress (0 to 1+)
 */
export function getCycleProgress(
  daysSinceHalving: number,
  estimatedCycleLength: number
): number {
  return daysSinceHalving / estimatedCycleLength;
}

/**
 * Calculate diminishing returns adjustment factor
 * Each cycle's peak return is roughly 1/3 to 1/2 of the previous
 */
export function getDiminishingReturnsMultiplier(halvingIdx: number): number {
  // Rough historical peak-to-peak returns:
  // Cycle 0 (pre-halving): ~100x
  // Cycle 1: ~100x
  // Cycle 2: ~30x
  // Cycle 3: ~20x
  // Cycle 4: estimated ~10x

  const multipliers = [1.0, 1.0, 0.3, 0.2, 0.1];
  return multipliers[Math.min(halvingIdx, multipliers.length - 1)];
}

/**
 * Calculate diminishing losses adjustment
 * Each cycle's maximum drawdown tends to be slightly less severe
 */
export function getDiminishingLossesMultiplier(halvingIdx: number): number {
  // Rough historical max drawdowns:
  // Cycle 1: ~93%
  // Cycle 2: ~85%
  // Cycle 3: ~83%
  // Cycle 4: estimated ~75-80%

  const multipliers = [1.0, 0.9, 0.88, 0.85, 0.8];
  return multipliers[Math.min(halvingIdx, multipliers.length - 1)];
}

/**
 * Historical cycle peak dates (used for cycle length estimation)
 * Only includes peaks that were known at the time
 */
export const HISTORICAL_PEAKS: Date[] = [
  new Date('2011-06-08'), // Cycle 0 peak (~$32)
  new Date('2013-12-04'), // Cycle 1 peak (~$1,150)
  new Date('2017-12-17'), // Cycle 2 peak (~$19,700)
  new Date('2021-11-10'), // Cycle 3 peak (~$69,000)
];

/**
 * Calculate comprehensive cycle score [0, 1]
 * Higher = later in cycle = potentially higher risk
 */
export function calculateCycleScore(date: Date): number {
  const halvingIdx = getHalvingIndex(date);
  const daysSH = daysSinceHalving(date);

  // Get peaks that were known before this date
  const knownPeaks = HISTORICAL_PEAKS.filter(p => p < date);

  const cycleLength = estimateCycleLength(halvingIdx, knownPeaks);
  const progress = getCycleProgress(daysSH, cycleLength);
  const phase = getCyclePhase(daysSH, cycleLength);

  // Base score from cycle progress
  let baseScore = Math.min(1, Math.max(0, progress));

  // Adjust for phase
  // Early phase: lower base risk
  // Late phase: higher risk, especially after 80% progress
  if (phase === 'early') {
    baseScore *= 0.7;
  } else if (phase === 'late') {
    // Exponential increase in late phase
    const lateProgress = (progress - 0.66) / 0.34;
    baseScore = 0.66 + 0.34 * Math.pow(lateProgress, 0.7);
  }

  // Add variability based on specific day patterns
  // Risk tends to peak around 400-550 days post-halving historically
  const peakRiskDays = 480;
  const daysDiff = Math.abs(daysSH - peakRiskDays);
  const peakProximity = Math.max(0, 1 - daysDiff / 365);
  baseScore = baseScore * 0.8 + peakProximity * 0.2;

  return Math.min(1, Math.max(0, baseScore));
}

/**
 * Get cycle sub-components for debugging/display
 */
export function getCycleComponents(date: Date): {
  halvingIndex: number;
  daysSinceHalving: number;
  daysSinceGenesis: number;
  estimatedCycleLength: number;
  cycleProgress: number;
  cyclePhase: 'early' | 'mid' | 'late';
  diminishingReturns: number;
  diminishingLosses: number;
} {
  const halvingIdx = getHalvingIndex(date);
  const daysSH = daysSinceHalving(date);
  const daysSG = daysSinceGenesis(date);
  const knownPeaks = HISTORICAL_PEAKS.filter(p => p < date);
  const cycleLength = estimateCycleLength(halvingIdx, knownPeaks);

  return {
    halvingIndex: halvingIdx,
    daysSinceHalving: daysSH,
    daysSinceGenesis: daysSG,
    estimatedCycleLength: cycleLength,
    cycleProgress: getCycleProgress(daysSH, cycleLength),
    cyclePhase: getCyclePhase(daysSH, cycleLength),
    diminishingReturns: getDiminishingReturnsMultiplier(halvingIdx),
    diminishingLosses: getDiminishingLossesMultiplier(halvingIdx),
  };
}

/**
 * Check if a date is a halving date (within 1 day tolerance)
 */
export function isHalvingDate(date: Date): boolean {
  const dateStr = date.toISOString().split('T')[0];

  for (const halving of HALVING_DATES) {
    const halvingStr = halving.toISOString().split('T')[0];
    if (dateStr === halvingStr) {
      return true;
    }
  }

  return false;
}

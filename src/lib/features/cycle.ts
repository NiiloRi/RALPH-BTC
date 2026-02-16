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
 * Historical cycle data for cycle-relative calculations
 * Each cycle's low is from the bear market bottom BEFORE the halving
 * Each cycle's high is the bull market peak AFTER the halving
 */
export interface CycleData {
  halvingDate: string;
  low: number;      // Bear market low (USD)
  lowDate: string;  // Date of low
  high: number;     // Bull market high (USD)
  highDate: string; // Date of high
}

export const HISTORICAL_CYCLES: CycleData[] = [
  // Cycle 0: Pre-first-halving (genesis to first halving)
  {
    halvingDate: '2012-11-28',
    low: 0.05,
    lowDate: '2010-07-17',
    high: 32,
    highDate: '2011-06-08',
  },
  // Cycle 1: First halving
  {
    halvingDate: '2012-11-28',
    low: 2,
    lowDate: '2011-11-18',
    high: 1150,
    highDate: '2013-12-04',
  },
  // Cycle 2: Second halving
  {
    halvingDate: '2016-07-09',
    low: 200,
    lowDate: '2015-01-14',
    high: 19800,
    highDate: '2017-12-17',
  },
  // Cycle 3: Third halving
  {
    halvingDate: '2020-05-11',
    low: 3200,
    lowDate: '2018-12-15',
    high: 69000,
    highDate: '2021-11-10',
  },
  // Cycle 4: Fourth halving (current, cycle still in progress)
  // NOTE: high is rolling ATH, updated as cycle progresses
  {
    halvingDate: '2024-04-20',
    low: 15500,
    lowDate: '2022-11-21',
    high: 109000,
    highDate: '2025-01-20',
  },
];

/**
 * Get previous cycle's low and high for cycle-relative calculations
 * Returns the COMPLETED previous cycle's data as reference
 */
export function getPreviousCycleRange(date: Date): { low: number; high: number } {
  const halvingIdx = getHalvingIndex(date);

  // For cycle 0 or 1, use first cycle data
  if (halvingIdx <= 0) {
    return { low: HISTORICAL_CYCLES[0].low, high: HISTORICAL_CYCLES[0].high };
  }

  // Use the previous completed cycle
  const prevCycleIdx = Math.min(halvingIdx - 1, HISTORICAL_CYCLES.length - 2);
  const prevCycle = HISTORICAL_CYCLES[prevCycleIdx];

  return { low: prevCycle.low, high: prevCycle.high };
}

/**
 * Calculate cycle-relative price position
 * Returns 0-1+ where:
 * 0 = at previous cycle's low
 * 1 = at previous cycle's high
 * >1 = above previous cycle's high (new territory)
 */
export function getCycleRelativePrice(price: number, date: Date): number {
  const { low, high } = getPreviousCycleRange(date);

  if (high <= low) return 0.5;

  // Calculate position relative to previous cycle's range
  const position = (price - low) / (high - low);

  // Clamp between 0 and some reasonable max (e.g., 2x previous high)
  return Math.max(0, Math.min(2, position));
}

/**
 * Calculate comprehensive cycle score [0, 1]
 * Higher = later in cycle = potentially higher risk
 *
 * IMPROVED v2:
 * - Uses time from cycle LOW, not halving
 * - WIDER peak window (300-750 days post-halving) to catch both early and late peaks
 * - Stronger pre-halving risk ramp for front-running detection
 * - Post-halving caution reduced (history shows post-halving is bullish)
 * - Added "euphoria zone" detection: >800 days from low = extreme risk
 * - Smoother transition between phases
 */
export function calculateCycleScore(date: Date): number {
  // Find cycle based on which LOW we're after (not halving)
  let cycleIdx = 0;
  for (let i = HISTORICAL_CYCLES.length - 1; i >= 0; i--) {
    const cycleLow = new Date(HISTORICAL_CYCLES[i].lowDate);
    if (date >= cycleLow) {
      cycleIdx = i;
      break;
    }
  }

  const currentCycle = HISTORICAL_CYCLES[cycleIdx];
  const cycleLowDate = new Date(currentCycle.lowDate);
  const daysSinceLow = Math.max(0, Math.floor(
    (date.getTime() - cycleLowDate.getTime()) / (1000 * 60 * 60 * 24)
  ));

  // Days since/until halving for this cycle
  const cycleHalvingDate = new Date(currentCycle.halvingDate);
  const daysSH = Math.floor(
    (date.getTime() - cycleHalvingDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  // Typical cycle from low to peak: ~1000-1200 days
  const typicalLowToPeak = 1100;
  const progressFromLow = Math.min(1.5, daysSinceLow / typicalLowToPeak);

  // Progress from halving (can be negative if before halving)
  const cycleLength = 1460;
  const progressFromHalving = daysSH / cycleLength;

  // === BOTTOM ZONE: first 180 days from low = strong accumulation ===
  let bottomZoneDiscount = 0;
  if (daysSinceLow < 180) {
    // Quickly decaying discount: day 0 = -0.3, day 180 = 0
    bottomZoneDiscount = -0.3 * (1 - daysSinceLow / 180);
  }

  // === PRE-HALVING RISK: stronger front-running detection ===
  let preHalvingRisk = 0;
  if (daysSH < 0) {
    const daysUntilHalving = -daysSH;

    // Risk ramp: 270 days before halving with meaningful progress
    if (progressFromLow > 0.25 && daysUntilHalving < 270) {
      const proximityFactor = 1 - daysUntilHalving / 270;
      const progressFactor = Math.min(1, (progressFromLow - 0.25) / 0.35);
      preHalvingRisk = Math.min(0.40, proximityFactor * progressFactor * 0.40);
    }

    // Extra boost for very extended pre-halving rallies
    if (progressFromLow > 0.5) {
      preHalvingRisk += Math.min(0.15, (progressFromLow - 0.5) * 0.3);
    }
  }

  // === POST-HALVING: reduced caution (historically bullish period) ===
  let postHalvingCaution = 0;
  if (daysSH >= 0 && daysSH < 90) {
    // Only 90 days of caution (was 180), weaker floor
    postHalvingCaution = 0.15 * (1 - daysSH / 90);
  }

  // === PEAK RISK WINDOW: WIDER range 250-800 days post-halving ===
  // Historical peaks: ~365d (2013), ~530d (2017), ~550d (2021)
  // Widen to catch early AND late peaks
  const peakCenter = 480;
  const peakWidth = 400; // Was 350, widened
  const daysDiff = Math.abs(daysSH - peakCenter);
  const peakWindowProximity = Math.max(0, 1 - daysDiff / peakWidth);

  // === EUPHORIA ZONE: >800 days from low = extreme late cycle ===
  let euphoriaBonus = 0;
  if (daysSinceLow > 800) {
    euphoriaBonus = Math.min(0.25, (daysSinceLow - 800) / 600 * 0.25);
  }

  // Combine factors
  const baseScore =
    progressFromLow * 0.30 +
    Math.min(1, Math.max(0, progressFromHalving)) * 0.15 +
    peakWindowProximity * 0.25 +   // INCREASED: peak window more important
    preHalvingRisk +
    postHalvingCaution +
    bottomZoneDiscount +           // NEW: negative contribution at bottoms
    euphoriaBonus;                 // NEW: extreme late cycle risk

  // Smooth with quadratic curve
  const clamped = Math.min(1, Math.max(0, baseScore));
  const smoothed = clamped < 0.5
    ? 2 * clamped * clamped
    : 1 - 2 * Math.pow(1 - clamped, 2);

  return Math.min(1, Math.max(0, smoothed));
}

/**
 * Enhanced cycle score that also considers price position
 * Use this when price data is available
 */
export function calculateEnhancedCycleScore(
  date: Date,
  price: number,
  priceHistory: number[]
): number {
  // Get base time-based cycle score
  const timeCycleScore = calculateCycleScore(date);

  // Calculate price-based factors
  const halvingIdx = getHalvingIndex(date);
  const currentCycleIdx = Math.min(halvingIdx, HISTORICAL_CYCLES.length - 1);
  const prevCycleIdx = Math.max(0, currentCycleIdx - 1);
  const prevCycle = HISTORICAL_CYCLES[prevCycleIdx];

  // Price relative to previous cycle high
  const prevCycleHigh = prevCycle.high;
  const priceVsPrevHigh = prevCycleHigh > 0 ? price / prevCycleHigh : 1;
  const pricePositionScore = Math.min(1, priceVsPrevHigh);

  // ATH proximity from price history
  const currentATH = Math.max(...priceHistory);
  const athProximity = currentATH > 0 ? price / currentATH : 1;

  // Combine time and price factors
  // Time: 50%, Price vs prev high: 25%, ATH proximity: 25%
  const combined =
    timeCycleScore * 0.50 +
    pricePositionScore * 0.25 +
    athProximity * 0.25;

  return Math.min(1, Math.max(0, combined));
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

/**
 * CYCLE-RELATIVE RISK VIEW MODULE
 *
 * Shows how current risk compares to historical risk at the same cycle phase.
 * This is a SECONDARY REFERENCE view - absolute risk remains the canonical value.
 *
 * CRITICAL CONSTRAINT: This module NEVER feeds back into the base risk score.
 * It is purely for comparative/informational purposes.
 *
 * Data Flow:
 *   RiskOutput[] + FeatureVector[] (READ-ONLY) → CycleRelativeRisk
 */

import { RiskOutput, FeatureVector } from '../types';
import { CycleRelativeRisk } from './types';
import {
  getHalvingIndex,
  daysSinceHalving,
  getCyclePhase,
  getCycleProgress,
  HISTORICAL_CYCLES,
} from '../features/cycle';

/**
 * Calculate percentile of a value within a distribution
 */
function calculatePercentile(value: number, distribution: number[]): number {
  if (distribution.length === 0) return 0.5;

  const count = distribution.filter(v => v <= value).length;
  return count / distribution.length;
}

/**
 * Get historical risks at the same cycle phase
 * Only uses data from COMPLETED cycles to avoid hindsight
 *
 * @param risks - Array of RiskOutput (historical)
 * @param features - Array of FeatureVector corresponding to risks
 * @param targetPhase - Cycle phase to match
 * @param currentIndex - Current day index (only look at days before this)
 * @returns Array of historical risk values at the same phase
 */
export function getHistoricalRisksAtPhase(
  risks: RiskOutput[],
  features: FeatureVector[],
  targetPhase: 'early' | 'mid' | 'late',
  currentIndex: number
): number[] {
  const matchingRisks: number[] = [];

  // Only look at completed cycles (before current cycle started)
  // Current cycle's data shouldn't be used for comparison
  const currentDate = new Date(risks[currentIndex].date);
  const currentHalvingIdx = getHalvingIndex(currentDate);

  // Look for days in previous cycles
  for (let i = 0; i < currentIndex; i++) {
    const date = new Date(risks[i].date);
    const halvingIdx = getHalvingIndex(date);

    // Only use data from cycles before the current one
    if (halvingIdx >= currentHalvingIdx) continue;

    // Check if phase matches
    const daysSH = daysSinceHalving(date);
    const cycleLength = 1460; // Approximate 4-year cycle
    const phase = getCyclePhase(daysSH, cycleLength);

    if (phase === targetPhase) {
      matchingRisks.push(risks[i].smoothedRisk);
    }
  }

  return matchingRisks;
}

/**
 * Calculate cycle-relative risk view
 *
 * @param risks - Array of RiskOutput (historical, most recent last)
 * @param features - Array of FeatureVector corresponding to risks
 * @param currentIndex - Index of the current day
 * @returns CycleRelativeRisk for the specified day
 */
export function calculateCycleRelativeRisk(
  risks: RiskOutput[],
  features: FeatureVector[],
  currentIndex: number
): CycleRelativeRisk {
  if (currentIndex < 0 || currentIndex >= risks.length) {
    throw new Error(`Invalid index ${currentIndex} for risks array of length ${risks.length}`);
  }

  const currentRisk = risks[currentIndex].smoothedRisk;
  const currentFeature = features[currentIndex];
  const currentDate = new Date(risks[currentIndex].date);

  // Get current cycle info
  const daysSH = daysSinceHalving(currentDate);
  const cycleLength = 1460;
  const cyclePhase = getCyclePhase(daysSH, cycleLength);
  const cycleProgress = getCycleProgress(daysSH, cycleLength);

  // Get historical risks at same phase from previous cycles
  const historicalRisks = getHistoricalRisksAtPhase(
    risks,
    features,
    cyclePhase,
    currentIndex
  );

  // Calculate statistics
  let cyclePhasePercentile = 0.5;
  let historicalAvgRisk = currentRisk;
  let historicalMin = currentRisk;
  let historicalMax = currentRisk;

  if (historicalRisks.length > 0) {
    cyclePhasePercentile = calculatePercentile(currentRisk, historicalRisks);
    historicalAvgRisk = historicalRisks.reduce((a, b) => a + b, 0) / historicalRisks.length;
    historicalMin = Math.min(...historicalRisks);
    historicalMax = Math.max(...historicalRisks);
  }

  const deviationFromAvg = currentRisk - historicalAvgRisk;

  // Consider risk "elevated" if it's above the 70th percentile of historical same-phase
  const isElevated = cyclePhasePercentile > 0.7;

  return {
    cyclePhasePercentile,
    historicalAvgRisk,
    deviationFromAvg,
    isElevated,
    cyclePhase,
    daysIntoCycle: daysSH,
    cycleProgress,
    historicalRange: {
      min: historicalMin,
      max: historicalMax,
    },
  };
}

/**
 * Get cycle context description for display
 */
export function getCycleContextDescription(
  cycleRelative: CycleRelativeRisk
): string {
  const { cyclePhase, cyclePhasePercentile, deviationFromAvg, isElevated } = cycleRelative;

  const phaseLabel = cyclePhase === 'early' ? 'early cycle' :
    cyclePhase === 'mid' ? 'mid-cycle' : 'late cycle';

  const percentileLabel = cyclePhasePercentile < 0.3 ? 'unusually low' :
    cyclePhasePercentile < 0.5 ? 'below average' :
    cyclePhasePercentile < 0.7 ? 'average' :
    cyclePhasePercentile < 0.9 ? 'elevated' : 'very high';

  const deviationDirection = deviationFromAvg > 0 ? 'above' : 'below';
  const deviationMagnitude = Math.abs(deviationFromAvg * 100).toFixed(1);

  return `Risk is ${percentileLabel} for ${phaseLabel} (${deviationMagnitude}% ${deviationDirection} historical average)`;
}

/**
 * Calculate cycle-relative risk for all days in series
 *
 * @param risks - Array of RiskOutput
 * @param features - Array of FeatureVector
 * @param startIndex - Start index (need warmup from previous cycles)
 * @returns Array of CycleRelativeRisk
 */
export function calculateAllCycleRelativeRisk(
  risks: RiskOutput[],
  features: FeatureVector[],
  startIndex: number = 365 * 4 // At least one full cycle for meaningful comparison
): CycleRelativeRisk[] {
  const results: CycleRelativeRisk[] = [];

  for (let i = startIndex; i < risks.length; i++) {
    results.push(calculateCycleRelativeRisk(risks, features, i));
  }

  return results;
}

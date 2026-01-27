/**
 * RISK CONFIDENCE MODULE
 *
 * Measures agreement/disagreement between existing components and regime stability.
 * This is a META-SIGNAL that sits ABOVE the risk score.
 *
 * CRITICAL CONSTRAINT: This module NEVER feeds back into the base risk score.
 * It only READS from RiskOutput.
 *
 * Data Flow:
 *   RiskOutput[] (READ-ONLY) → RiskConfidence
 */

import { RiskOutput } from '../types';
import { RiskConfidence, ConfidenceLevel } from './types';

/**
 * Calculate standard deviation of an array
 */
function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;

  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squaredDiffs = values.map(v => (v - mean) ** 2);
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / (values.length - 1);

  return Math.sqrt(variance);
}

/**
 * Calculate component agreement score
 * Measures how much the 6 components agree with each other
 * High agreement (low dispersion) = high confidence in the signal
 *
 * @param components - The 6 component scores from RiskOutput
 * @returns Agreement score [0, 1] where 1 = perfect agreement
 */
export function calculateComponentAgreement(components: RiskOutput['components']): number {
  const scores = [
    components.valuation,
    components.momentum,
    components.volatility,
    components.cycle,
    components.macro,
    components.attention,
  ].filter(s => Number.isFinite(s));

  if (scores.length < 2) return 0.5;

  // Calculate dispersion (standard deviation)
  const dispersion = standardDeviation(scores);

  // Maximum possible dispersion for [0,1] bounded scores is ~0.5
  // Map dispersion to agreement: low dispersion = high agreement
  // dispersion of 0 → agreement of 1
  // dispersion of 0.3+ → agreement of ~0.2
  const agreement = Math.max(0, 1 - dispersion * 2.5);

  return agreement;
}

/**
 * Calculate regime stability score
 * Measures how stable the risk score has been over recent history
 *
 * @param riskHistory - Recent risk scores (most recent last)
 * @param lookbackDays - Number of days to look back (default 14)
 * @returns Stability score [0, 1] where 1 = very stable
 */
export function calculateRegimeStability(
  riskHistory: number[],
  lookbackDays: number = 14
): number {
  if (riskHistory.length < 2) return 0.5;

  // Take the last N days
  const recent = riskHistory.slice(-lookbackDays);

  if (recent.length < 2) return 0.5;

  // Calculate volatility of the risk series
  const riskVol = standardDeviation(recent);

  // Also check for trend consistency (are we moving in one direction?)
  let directionChanges = 0;
  for (let i = 2; i < recent.length; i++) {
    const prevDirection = recent[i - 1] - recent[i - 2];
    const currDirection = recent[i] - recent[i - 1];
    if (prevDirection * currDirection < 0) {
      directionChanges++;
    }
  }
  const directionConsistency = 1 - directionChanges / Math.max(1, recent.length - 2);

  // Combine: low volatility + consistent direction = high stability
  // Risk vol of 0.1 would be high → stability near 0
  // Risk vol of 0.01 would be low → stability near 1
  const volStability = Math.max(0, 1 - riskVol * 10);

  return volStability * 0.6 + directionConsistency * 0.4;
}

/**
 * Determine confidence level from numeric score
 */
export function getConfidenceLevel(confidence: number): ConfidenceLevel {
  if (confidence < 0.4) return 'low';
  if (confidence < 0.7) return 'medium';
  return 'high';
}

/**
 * Calculate Risk Confidence from a series of RiskOutputs
 *
 * @param risks - Array of RiskOutput (historical, most recent last)
 * @param currentIndex - Index of the current day to calculate confidence for
 * @returns RiskConfidence for the specified day
 */
export function calculateRiskConfidence(
  risks: RiskOutput[],
  currentIndex: number
): RiskConfidence {
  if (currentIndex < 0 || currentIndex >= risks.length) {
    throw new Error(`Invalid index ${currentIndex} for risks array of length ${risks.length}`);
  }

  const current = risks[currentIndex];

  // Calculate component agreement from current day's components
  const componentAgreement = calculateComponentAgreement(current.components);

  // Calculate regime stability from recent risk history
  // Use smoothedRisk for stability calculation (less noisy)
  const riskHistory = risks.slice(0, currentIndex + 1).map(r => r.smoothedRisk);
  const regimeStability = calculateRegimeStability(riskHistory, 14);

  // Calculate dispersion directly
  const componentScores = [
    current.components.valuation,
    current.components.momentum,
    current.components.volatility,
    current.components.cycle,
    current.components.macro,
    current.components.attention,
  ].filter(s => Number.isFinite(s));

  const componentDispersion = standardDeviation(componentScores);

  // Combined confidence score
  // Weight agreement more heavily than stability
  const confidence = componentAgreement * 0.6 + regimeStability * 0.4;

  return {
    value: Math.min(1, Math.max(0, confidence)),
    level: getConfidenceLevel(confidence),
    componentAgreement,
    regimeStability,
    componentDispersion,
    componentCount: componentScores.length,
  };
}

/**
 * Calculate Risk Confidence for all days in the series
 * Useful for batch processing
 *
 * @param risks - Array of RiskOutput (historical, most recent last)
 * @param startIndex - Start index (to allow warmup period)
 * @returns Array of RiskConfidence, one per day from startIndex
 */
export function calculateAllRiskConfidence(
  risks: RiskOutput[],
  startIndex: number = 14
): RiskConfidence[] {
  const results: RiskConfidence[] = [];

  for (let i = startIndex; i < risks.length; i++) {
    results.push(calculateRiskConfidence(risks, i));
  }

  return results;
}

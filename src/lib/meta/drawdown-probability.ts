/**
 * LEFT-TAIL / DRAWDOWN PROBABILITY MODULE
 *
 * Provides separate estimates of drawdown probability within various time horizons.
 * Uses existing volatility, fragility, and macro signals.
 *
 * CRITICAL CONSTRAINT: This module MUST NOT influence the main risk score.
 * It only READS from existing signals for its own separate calculation.
 *
 * Data Flow:
 *   FeatureVector + RiskOutput (READ-ONLY) → DrawdownProbability
 */

import { FeatureVector, RiskOutput, DailyData } from '../types';
import { DrawdownProbability } from './types';
import {
  calculateVolPercentile,
  calculateFragilityIndex,
  detectVolatilityRegime,
} from '../features/volatility';

/**
 * Volatility regime multipliers for drawdown probability
 * Higher volatility = higher probability of large drawdowns
 */
const REGIME_MULTIPLIERS: Record<string, number> = {
  low: 0.5,
  normal: 1.0,
  high: 1.5,
  extreme: 2.0,
};

/**
 * Base drawdown probabilities by risk level
 * These are rough empirical estimates from BTC history
 */
const BASE_PROBABILITIES = {
  // Risk bucket → base probability of ≥10% DD in 30 days
  dd10_30: {
    low: 0.15,      // Risk 0-30%
    medium: 0.25,   // Risk 30-60%
    high: 0.40,     // Risk 60-80%
    extreme: 0.55,  // Risk 80-100%
  },
  // Risk bucket → base probability of ≥20% DD in 30 days
  dd20_30: {
    low: 0.05,
    medium: 0.12,
    high: 0.22,
    extreme: 0.35,
  },
  // Risk bucket → base probability of ≥30% DD in 90 days
  dd30_90: {
    low: 0.08,
    medium: 0.18,
    high: 0.30,
    extreme: 0.45,
  },
  // Risk bucket → base probability of ≥50% DD in 180 days
  dd50_180: {
    low: 0.03,
    medium: 0.08,
    high: 0.15,
    extreme: 0.25,
  },
};

/**
 * Get risk bucket category
 */
function getRiskCategory(risk: number): 'low' | 'medium' | 'high' | 'extreme' {
  if (risk < 0.3) return 'low';
  if (risk < 0.6) return 'medium';
  if (risk < 0.8) return 'high';
  return 'extreme';
}

/**
 * Calculate macro stress indicator
 * Combines macro signals to estimate systemic stress
 *
 * @param features - Current feature vector
 * @returns Stress score [0, 1] where 1 = maximum stress
 */
export function calculateMacroStress(features: FeatureVector): number {
  // Invert bullish signals to get stress
  // Low M2 growth = stress, high fed funds = stress, inverted yield curve = stress
  const m2Stress = 1 - (features.m2Signal || 0.5);
  const fedStress = features.fedFundsSignal || 0.5; // Already high when rates high
  const yieldStress = 1 - (features.yieldCurveSignal || 0.5); // Inverted = stress
  const realRateStress = features.realRateSignal || 0.5; // High real rates = stress

  // Weighted combination
  const stress =
    m2Stress * 0.35 +
    fedStress * 0.25 +
    yieldStress * 0.25 +
    realRateStress * 0.15;

  return Math.min(1, Math.max(0, stress));
}

/**
 * Calculate left-tail risk score
 * Combines multiple factors into overall tail risk assessment
 */
export function calculateLeftTailRisk(
  risk: number,
  fragility: number,
  macroStress: number,
  volRegime: string
): number {
  const regimeMultiplier = REGIME_MULTIPLIERS[volRegime] || 1.0;

  // Base tail risk from current risk level
  const riskContribution = risk * 0.4;

  // Fragility contribution
  const fragilityContribution = fragility * 0.3;

  // Macro stress contribution
  const macroContribution = macroStress * 0.2;

  // Regime adjustment
  const baseScore = riskContribution + fragilityContribution + macroContribution;
  const adjustedScore = baseScore * (0.7 + regimeMultiplier * 0.3);

  return Math.min(1, Math.max(0, adjustedScore));
}

/**
 * Get risk level label for drawdown probability
 */
export function getDrawdownRiskLevel(
  leftTailRisk: number
): 'minimal' | 'low' | 'moderate' | 'elevated' | 'high' {
  if (leftTailRisk < 0.15) return 'minimal';
  if (leftTailRisk < 0.3) return 'low';
  if (leftTailRisk < 0.5) return 'moderate';
  if (leftTailRisk < 0.7) return 'elevated';
  return 'high';
}

/**
 * Calculate drawdown probability estimates
 *
 * @param features - Current feature vector
 * @param riskOutput - Current risk output
 * @param data - Daily data array for volatility calculations
 * @param dataIndex - Current index in data array
 * @returns DrawdownProbability estimates
 */
export function calculateDrawdownProbability(
  features: FeatureVector,
  riskOutput: RiskOutput,
  data: DailyData[],
  dataIndex: number
): DrawdownProbability {
  const risk = riskOutput.smoothedRisk;
  const riskCategory = getRiskCategory(risk);

  // Get volatility regime
  const vols = data.slice(0, dataIndex + 1).map(d => d.realizedVol30d || 0);
  const currentVol = data[dataIndex]?.realizedVol30d || 0;
  const volRegime = detectVolatilityRegime(currentVol, vols.slice(0, -1));
  const regimeMultiplier = REGIME_MULTIPLIERS[volRegime];

  // Calculate fragility
  const fragility = calculateFragilityIndex(data, dataIndex);

  // Calculate macro stress
  const macroStress = calculateMacroStress(features);

  // Calculate left-tail risk
  const leftTailRisk = calculateLeftTailRisk(risk, fragility, macroStress, volRegime);

  // Calculate individual probabilities
  // Start with base probability for risk category
  // Adjust by volatility regime, fragility, and macro stress

  const adjustmentFactor = (fragility + macroStress + (regimeMultiplier - 1)) / 3;

  const prob10pct30d = Math.min(
    0.95,
    BASE_PROBABILITIES.dd10_30[riskCategory] * (1 + adjustmentFactor)
  );

  const prob20pct30d = Math.min(
    0.90,
    BASE_PROBABILITIES.dd20_30[riskCategory] * (1 + adjustmentFactor * 1.2)
  );

  const prob30pct90d = Math.min(
    0.85,
    BASE_PROBABILITIES.dd30_90[riskCategory] * (1 + adjustmentFactor * 1.3)
  );

  const prob50pct180d = Math.min(
    0.80,
    BASE_PROBABILITIES.dd50_180[riskCategory] * (1 + adjustmentFactor * 1.5)
  );

  return {
    prob10pct30d,
    prob20pct30d,
    prob30pct90d,
    prob50pct180d,
    volatilityRegime: volRegime,
    fragilityIndex: fragility,
    macroStress,
    leftTailRisk,
    riskLevel: getDrawdownRiskLevel(leftTailRisk),
  };
}

/**
 * Calculate drawdown probability with minimal inputs
 * For cases where full data isn't available
 */
export function calculateSimpleDrawdownProbability(
  risk: number,
  volatilityScore: number,
  macroScore: number
): DrawdownProbability {
  const riskCategory = getRiskCategory(risk);

  // Estimate volatility regime from score
  let volRegime: 'low' | 'normal' | 'high' | 'extreme';
  if (volatilityScore < 0.3) volRegime = 'low';
  else if (volatilityScore < 0.5) volRegime = 'normal';
  else if (volatilityScore < 0.7) volRegime = 'high';
  else volRegime = 'extreme';

  const regimeMultiplier = REGIME_MULTIPLIERS[volRegime];

  // Use volatility score as fragility proxy
  const fragility = volatilityScore;

  // Invert macro score (high macro score in original = bullish = low stress)
  const macroStress = 1 - macroScore;

  const leftTailRisk = calculateLeftTailRisk(risk, fragility, macroStress, volRegime);
  const adjustmentFactor = (fragility + macroStress + (regimeMultiplier - 1)) / 3;

  return {
    prob10pct30d: Math.min(0.95, BASE_PROBABILITIES.dd10_30[riskCategory] * (1 + adjustmentFactor)),
    prob20pct30d: Math.min(0.90, BASE_PROBABILITIES.dd20_30[riskCategory] * (1 + adjustmentFactor * 1.2)),
    prob30pct90d: Math.min(0.85, BASE_PROBABILITIES.dd30_90[riskCategory] * (1 + adjustmentFactor * 1.3)),
    prob50pct180d: Math.min(0.80, BASE_PROBABILITIES.dd50_180[riskCategory] * (1 + adjustmentFactor * 1.5)),
    volatilityRegime: volRegime,
    fragilityIndex: fragility,
    macroStress,
    leftTailRisk,
    riskLevel: getDrawdownRiskLevel(leftTailRisk),
  };
}

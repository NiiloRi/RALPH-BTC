/**
 * Risk model implementation
 * Combines feature scores into final risk metric [0, 1]
 * Optimized for detecting cycle tops and bottoms
 */

import { FeatureVector, RiskOutput } from '../types';
import { getRiskBand, getRiskAction } from './bands';

/**
 * Default component weights - optimized for peak/bottom detection
 *
 * IMPROVED v2:
 * - Valuation raised to 0.28: strongest single predictor (MVRV + NVT + drawdown)
 * - Cycle raised to 0.22: halving cycle timing is critical for BTC
 * - Momentum kept at 0.18: good for extremes but noisy in ranging markets
 * - Attention raised to 0.12: captures retail FOMO at tops
 * - Volatility reduced to 0.06: background noise, less predictive alone
 * - Macro reduced to 0.14: useful for regime context but lagging
 */
export const DEFAULT_WEIGHTS: Record<string, number> = {
  valuation: 0.28,   // MVRV + NVT proxy + drawdown + power law
  momentum: 0.18,    // RSI + ROC + acceleration
  volatility: 0.06,  // Background context
  cycle: 0.22,       // Halving cycle timing - critical for BTC
  macro: 0.14,       // M2, Fed Funds, yield curve
  attention: 0.12,   // Retail FOMO/fear detection
};

/**
 * Default calibration
 *
 * IMPROVED v2:
 * - slope: 12 → 7  (was too steep, creating near-binary 0/1 output)
 *   slope=7 gives ~5% at bottoms, ~95% at peaks, with smooth gradations
 *   in between — critical for identifying "good buy" zones (0.2-0.4 risk)
 * - center: 0.45 → 0.48  (slightly higher to reduce false positives at tops)
 *   This means raw scores need to be slightly higher before risk rises,
 *   improving top precision without sacrificing bottom detection
 */
export const DEFAULT_CALIBRATION = {
  slope: 7,
  center: 0.48,
};

/**
 * Sigmoid function for smooth risk mapping
 */
export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Calculate raw ensemble score from feature vector
 * Uses weighted sum of component scores
 * Valuation score already incorporates Mayer multiple and drawdown
 */
export function calculateRawEnsemble(
  features: FeatureVector,
  weights: Record<string, number> = DEFAULT_WEIGHTS
): number {
  const components = {
    valuation: features.valuationScore,
    momentum: features.momentumScore,
    volatility: features.volatilityScore,
    cycle: features.cycleScore,
    macro: features.macroScore,
    attention: features.attentionScore,
  };

  let weightedSum = 0;
  let totalWeight = 0;

  for (const [key, weight] of Object.entries(weights)) {
    const score = components[key as keyof typeof components];
    if (score !== undefined && Number.isFinite(score)) {
      weightedSum += weight * score;
      totalWeight += weight;
    }
  }

  if (totalWeight === 0) return 0.5;

  return weightedSum / totalWeight;
}

/**
 * Apply calibration to raw ensemble score
 * Uses sigmoid transformation - slope=7 provides smooth 0-1 range
 * with good gradation in the mid-range for buy zone identification
 */
export function applyCalibration(
  rawScore: number,
  slope: number = DEFAULT_CALIBRATION.slope,
  center: number = DEFAULT_CALIBRATION.center
): number {
  // Transform raw score through sigmoid
  // slope=7 gives ~5% at bottoms, ~95% at peaks with smooth gradations
  const shifted = rawScore - center;
  const calibrated = sigmoid(slope * shifted);

  return calibrated;
}

/**
 * Apply smoothing to reduce day-to-day jitter
 */
export function applySmoothing(
  currentRisk: number,
  previousRisk: number,
  smoothingFactor: number = 0.3
): number {
  if (!Number.isFinite(previousRisk)) return currentRisk;

  // Exponential moving average
  return smoothingFactor * currentRisk + (1 - smoothingFactor) * previousRisk;
}

/**
 * Clamp value to [0, 1] range
 */
export function clampRisk(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Calculate final risk output from feature vector
 * @param useDynamicMacroWeight - If true, adjusts macro weight based on regime volatility
 */
export function calculateRisk(
  features: FeatureVector,
  weights: Record<string, number> = DEFAULT_WEIGHTS,
  calibrationParams: { slope: number; center: number } = DEFAULT_CALIBRATION,
  previousRisk?: number,
  smoothingFactor: number = 0.3,
  useDynamicMacroWeight: boolean = true
): RiskOutput {
  // Calculate raw ensemble - use dynamic weighting if enabled
  const rawScore = useDynamicMacroWeight
    ? calculateRawEnsembleWithDynamicMacro(features, weights)
    : calculateRawEnsemble(features, weights);

  // Apply calibration
  const calibrated = applyCalibration(
    rawScore,
    calibrationParams.slope,
    calibrationParams.center
  );

  // Clamp to valid range
  const risk = clampRisk(calibrated);

  // Apply smoothing if previous risk available
  const smoothedRisk = previousRisk !== undefined
    ? clampRisk(applySmoothing(risk, previousRisk, smoothingFactor))
    : risk;

  return {
    date: features.date,
    price: features.price,
    risk,
    components: {
      valuation: features.valuationScore,
      momentum: features.momentumScore,
      volatility: features.volatilityScore,
      cycle: features.cycleScore,
      macro: features.macroScore,
      attention: features.attentionScore,
    },
    smoothedRisk,
  };
}

/**
 * Calculate risk for entire feature array
 * @param useDynamicMacroWeight - If true, adjusts macro weight based on regime volatility
 */
export function calculateAllRisks(
  features: FeatureVector[],
  weights: Record<string, number> = DEFAULT_WEIGHTS,
  calibrationParams: { slope: number; center: number } = DEFAULT_CALIBRATION,
  smoothingFactor: number = 0.3,
  useDynamicMacroWeight: boolean = true
): RiskOutput[] {
  const results: RiskOutput[] = [];

  for (let i = 0; i < features.length; i++) {
    const previousRisk = i > 0 ? results[i - 1].smoothedRisk : undefined;

    const output = calculateRisk(
      features[i],
      weights,
      calibrationParams,
      previousRisk,
      smoothingFactor,
      useDynamicMacroWeight
    );

    results.push(output);
  }

  return results;
}

/**
 * Normalize weights to sum to 1
 */
export function normalizeWeights(
  weights: Record<string, number>
): Record<string, number> {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);

  if (total === 0) return weights;

  const normalized: Record<string, number> = {};
  for (const [key, value] of Object.entries(weights)) {
    normalized[key] = value / total;
  }

  return normalized;
}

/**
 * Adjust weights for dynamic macro weighting
 *
 * When macro conditions are unusual (high variance), we increase the macro
 * component's weight and proportionally reduce other weights.
 *
 * This ensures backward compatibility:
 * - In stable macro environments (2017-2021), macro weight stays at 5%
 * - In volatile macro environments (2022+), macro weight can increase to 15%
 *
 * @param baseWeights - The default weight configuration
 * @param dynamicMacroWeight - The calculated dynamic weight for macro (0.05-0.15)
 * @returns Adjusted weights that sum to 1
 */
export function adjustWeightsForDynamicMacro(
  baseWeights: Record<string, number>,
  dynamicMacroWeight: number
): Record<string, number> {
  const normalizedBase = normalizeWeights(baseWeights);
  const baseMacro = normalizedBase.macro || 0.05;

  // If dynamic weight is same as base, no adjustment needed
  if (Math.abs(dynamicMacroWeight - baseMacro) < 0.001) {
    return normalizedBase;
  }

  // Calculate how much macro weight is changing
  const delta = dynamicMacroWeight - baseMacro;

  // Reduce other weights proportionally to accommodate macro increase
  const otherWeights = 1 - baseMacro;
  const scaleFactor = (otherWeights - delta) / otherWeights;

  const adjusted: Record<string, number> = {};
  for (const [key, value] of Object.entries(normalizedBase)) {
    if (key === 'macro') {
      adjusted[key] = dynamicMacroWeight;
    } else {
      adjusted[key] = value * scaleFactor;
    }
  }

  return adjusted;
}

/**
 * Calculate raw ensemble score with optional dynamic macro weighting
 */
export function calculateRawEnsembleWithDynamicMacro(
  features: FeatureVector,
  weights: Record<string, number> = DEFAULT_WEIGHTS
): number {
  // Check if dynamic macro weight is available
  const dynamicMacroWeight = features.dynamicMacroWeight;

  // Adjust weights if dynamic macro weight is different from base
  const effectiveWeights = dynamicMacroWeight !== undefined && dynamicMacroWeight !== weights.macro
    ? adjustWeightsForDynamicMacro(weights, dynamicMacroWeight)
    : weights;

  return calculateRawEnsemble(features, effectiveWeights);
}

/**
 * Get risk level description
 * Delegates to the canonical band definitions in bands.ts so the model,
 * dashboard gauge, action label, and legend can never disagree.
 */
export function getRiskLevel(risk: number): {
  level: 'low' | 'moderate-low' | 'neutral' | 'moderate-high' | 'high';
  description: string;
} {
  const band = getRiskBand(risk);
  const action = getRiskAction(risk);
  return { level: band.level, description: action.desc };
}

/**
 * Export model state for reproducibility
 */
export function exportModelState(
  weights: Record<string, number>,
  calibrationParams: { slope: number; center: number },
  smoothingFactor: number
): {
  weights: Record<string, number>;
  calibration: { slope: number; center: number };
  smoothing: number;
  version: string;
  timestamp: string;
} {
  return {
    weights: normalizeWeights(weights),
    calibration: calibrationParams,
    smoothing: smoothingFactor,
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  };
}

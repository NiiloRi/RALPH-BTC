/**
 * Risk model implementation
 * Combines feature scores into final risk metric [0, 1]
 */

import { FeatureVector, RiskOutput } from '../types';

/**
 * Default component weights (learned from walk-forward optimization)
 */
export const DEFAULT_WEIGHTS: Record<string, number> = {
  valuation: 0.25,
  momentum: 0.15,
  volatility: 0.15,
  cycle: 0.2,
  macro: 0.1,
  attention: 0.15,
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
 * Uses sigmoid transformation with learned parameters
 */
export function applyCalibration(
  rawScore: number,
  slope: number = 4,
  center: number = 0.5
): number {
  // Transform raw score through sigmoid
  // This creates S-curve mapping that compresses extremes
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
 */
export function calculateRisk(
  features: FeatureVector,
  weights: Record<string, number> = DEFAULT_WEIGHTS,
  calibrationParams: { slope: number; center: number } = { slope: 4, center: 0.5 },
  previousRisk?: number,
  smoothingFactor: number = 0.3
): RiskOutput {
  // Calculate raw ensemble
  const rawScore = calculateRawEnsemble(features, weights);

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
 */
export function calculateAllRisks(
  features: FeatureVector[],
  weights: Record<string, number> = DEFAULT_WEIGHTS,
  calibrationParams: { slope: number; center: number } = { slope: 4, center: 0.5 },
  smoothingFactor: number = 0.3
): RiskOutput[] {
  const results: RiskOutput[] = [];

  for (let i = 0; i < features.length; i++) {
    const previousRisk = i > 0 ? results[i - 1].smoothedRisk : undefined;

    const output = calculateRisk(
      features[i],
      weights,
      calibrationParams,
      previousRisk,
      smoothingFactor
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
 * Get risk level description
 */
export function getRiskLevel(risk: number): {
  level: 'low' | 'moderate-low' | 'neutral' | 'moderate-high' | 'high';
  description: string;
} {
  if (risk < 0.2) {
    return { level: 'low', description: 'Strong accumulation zone' };
  }
  if (risk < 0.4) {
    return { level: 'moderate-low', description: 'Good buying opportunity' };
  }
  if (risk < 0.6) {
    return { level: 'neutral', description: 'Hold / DCA' };
  }
  if (risk < 0.8) {
    return { level: 'moderate-high', description: 'Consider taking profits' };
  }
  return { level: 'high', description: 'Extreme caution advised' };
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

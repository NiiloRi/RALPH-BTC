/**
 * Risk model implementation
 * Combines feature scores into final risk metric [0, 1]
 * Optimized for detecting cycle tops and bottoms
 */

import { FeatureVector, RiskOutput } from '../types';

/**
 * Default component weights - optimized for peak/bottom detection
 * Updated: Macro weight increased to 15% due to M2/Fed Funds indicators
 */
export const DEFAULT_WEIGHTS: Record<string, number> = {
  valuation: 0.22,   // Mayer multiple + drawdown
  momentum: 0.25,    // RSI + ROC - key for extremes
  volatility: 0.08,  // Background
  cycle: 0.15,       // Timing context
  macro: 0.15,       // M2, Fed Funds, yield curve, real rates
  attention: 0.15,   // Retail FOMO/fear (uses vol as proxy)
};

/**
 * Default calibration - slope=12, center=0.45 for optimal peak/bottom detection
 */
export const DEFAULT_CALIBRATION = {
  slope: 12,
  center: 0.45,
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
 * Uses sigmoid transformation - slope=10 provides full 0-1 range
 */
export function applyCalibration(
  rawScore: number,
  slope: number = DEFAULT_CALIBRATION.slope,
  center: number = DEFAULT_CALIBRATION.center
): number {
  // Transform raw score through sigmoid
  // slope=10 gives ~3-6% at bottoms, ~94-97% at peaks
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

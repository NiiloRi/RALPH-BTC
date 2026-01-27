/**
 * POSITION GUIDANCE LAYER MODULE (NON-DIRECTIVE)
 *
 * Provides position sizing and DCA pacing suggestions based on risk metrics.
 *
 * CRITICAL CONSTRAINTS:
 * - NEVER outputs buy/sell/exit signals
 * - Only outputs: size multiplier, DCA pacing, profit-taking aggressiveness
 * - Derived from: risk level, risk confidence, risk momentum
 * - This is NON-DIRECTIVE guidance, not financial advice
 *
 * Data Flow:
 *   RiskOutput + RiskConfidence + RiskMomentum + DrawdownProbability (READ-ONLY)
 *     → PositionGuidance
 */

import { RiskOutput } from '../types';
import {
  PositionGuidance,
  RiskConfidence,
  RiskMomentum,
  DrawdownProbability,
  MomentumDirection,
} from './types';

/**
 * Position size multiplier lookup based on risk level
 * Range: [0.25, 1.5] where 1.0 = baseline position size
 */
const SIZE_MULTIPLIER_TABLE: Record<string, number> = {
  // Very low risk → larger positions
  'risk_0-10': 1.5,
  'risk_10-20': 1.4,
  'risk_20-30': 1.25,
  'risk_30-40': 1.1,
  'risk_40-50': 1.0,
  'risk_50-60': 0.85,
  'risk_60-70': 0.7,
  'risk_70-80': 0.5,
  'risk_80-90': 0.35,
  'risk_90-100': 0.25,
};

/**
 * Get risk bucket key for lookup
 */
function getRiskBucketKey(risk: number): string {
  if (risk < 0.1) return 'risk_0-10';
  if (risk < 0.2) return 'risk_10-20';
  if (risk < 0.3) return 'risk_20-30';
  if (risk < 0.4) return 'risk_30-40';
  if (risk < 0.5) return 'risk_40-50';
  if (risk < 0.6) return 'risk_50-60';
  if (risk < 0.7) return 'risk_60-70';
  if (risk < 0.8) return 'risk_70-80';
  if (risk < 0.9) return 'risk_80-90';
  return 'risk_90-100';
}

/**
 * Calculate position size multiplier
 * Adjusts base multiplier by confidence and momentum
 *
 * @param risk - Current smoothed risk [0, 1]
 * @param confidence - Risk confidence score [0, 1]
 * @param momentum - Risk momentum direction
 * @param leftTailRisk - Left-tail risk score [0, 1]
 * @returns Size multiplier [0.1, 1.5]
 */
export function calculateSizeMultiplier(
  risk: number,
  confidence: number,
  momentum: MomentumDirection,
  leftTailRisk: number
): number {
  // Get base multiplier from risk level
  const baseMultiplier = SIZE_MULTIPLIER_TABLE[getRiskBucketKey(risk)] || 1.0;

  // Confidence adjustment: low confidence → more conservative
  // If confidence < 0.5, reduce position size
  const confidenceAdjustment = 0.8 + confidence * 0.4; // Range: [0.8, 1.2]

  // Momentum adjustment:
  // - Rising risk → slightly more conservative
  // - Falling risk → slightly more aggressive
  let momentumAdjustment = 1.0;
  if (momentum === 'rising') {
    momentumAdjustment = 0.9;
  } else if (momentum === 'falling') {
    momentumAdjustment = 1.1;
  }

  // Left-tail risk adjustment: high tail risk → more conservative
  const tailRiskAdjustment = 1.0 - leftTailRisk * 0.3; // Range: [0.7, 1.0]

  // Combine adjustments
  const finalMultiplier =
    baseMultiplier * confidenceAdjustment * momentumAdjustment * tailRiskAdjustment;

  // Clamp to valid range
  return Math.min(1.5, Math.max(0.1, finalMultiplier));
}

/**
 * Calculate DCA pacing suggestion
 *
 * @param risk - Current smoothed risk [0, 1]
 * @param momentum - Risk momentum direction
 * @returns DCA pacing factor and label
 */
export function calculateDCAPacing(
  risk: number,
  momentum: MomentumDirection
): { factor: number; pacing: 'accelerate' | 'normal' | 'decelerate' | 'pause' } {
  // Base pacing from risk level
  let baseFactor: number;
  if (risk < 0.2) {
    baseFactor = 1.5; // Low risk → accelerate DCA
  } else if (risk < 0.4) {
    baseFactor = 1.2;
  } else if (risk < 0.6) {
    baseFactor = 1.0; // Normal pace
  } else if (risk < 0.8) {
    baseFactor = 0.7;
  } else {
    baseFactor = 0.5; // High risk → slow down
  }

  // Momentum adjustment
  if (momentum === 'falling') {
    // Risk falling → opportunity → slightly accelerate
    baseFactor *= 1.15;
  } else if (momentum === 'rising') {
    // Risk rising → caution → slightly decelerate
    baseFactor *= 0.85;
  }

  // Clamp and determine label
  const factor = Math.min(2.0, Math.max(0.3, baseFactor));

  let pacing: 'accelerate' | 'normal' | 'decelerate' | 'pause';
  if (factor >= 1.3) {
    pacing = 'accelerate';
  } else if (factor >= 0.8) {
    pacing = 'normal';
  } else if (factor >= 0.4) {
    pacing = 'decelerate';
  } else {
    pacing = 'pause';
  }

  return { factor, pacing };
}

/**
 * Calculate profit-taking aggressiveness
 *
 * @param risk - Current smoothed risk [0, 1]
 * @param confidence - Risk confidence score [0, 1]
 * @param momentum - Risk momentum direction
 * @returns Profit-taking aggressiveness [0, 1] and label
 */
export function calculateProfitTaking(
  risk: number,
  confidence: number,
  momentum: MomentumDirection
): {
  aggressiveness: number;
  level: 'none' | 'light' | 'moderate' | 'aggressive';
} {
  // Base aggressiveness from risk level
  let baseAggressiveness: number;
  if (risk < 0.4) {
    baseAggressiveness = 0; // Low risk → no profit taking
  } else if (risk < 0.6) {
    baseAggressiveness = 0.2; // Moderate risk → light
  } else if (risk < 0.8) {
    baseAggressiveness = 0.5; // High risk → moderate
  } else {
    baseAggressiveness = 0.8; // Very high risk → aggressive
  }

  // Confidence adjustment: high confidence in high risk → more aggressive profit taking
  if (risk >= 0.6 && confidence > 0.7) {
    baseAggressiveness += 0.15;
  }

  // Momentum adjustment
  if (momentum === 'rising' && risk >= 0.5) {
    // Risk rising from already elevated → more aggressive
    baseAggressiveness += 0.1;
  } else if (momentum === 'falling' && risk >= 0.6) {
    // Risk falling from high → slightly less aggressive
    baseAggressiveness -= 0.1;
  }

  // Clamp
  const aggressiveness = Math.min(1.0, Math.max(0, baseAggressiveness));

  // Determine label
  let level: 'none' | 'light' | 'moderate' | 'aggressive';
  if (aggressiveness < 0.1) {
    level = 'none';
  } else if (aggressiveness < 0.4) {
    level = 'light';
  } else if (aggressiveness < 0.7) {
    level = 'moderate';
  } else {
    level = 'aggressive';
  }

  return { aggressiveness, level };
}

/**
 * Calculate complete position guidance
 *
 * @param riskOutput - Current risk output
 * @param confidence - Risk confidence
 * @param momentum - Risk momentum
 * @param drawdownProb - Drawdown probability (optional)
 * @returns PositionGuidance
 */
export function calculatePositionGuidance(
  riskOutput: RiskOutput,
  confidence: RiskConfidence,
  momentum: RiskMomentum,
  drawdownProb?: DrawdownProbability
): PositionGuidance {
  const risk = riskOutput.smoothedRisk;
  const leftTailRisk = drawdownProb?.leftTailRisk ?? risk * 0.8;

  // Calculate each component
  const sizeMultiplier = calculateSizeMultiplier(
    risk,
    confidence.value,
    momentum.direction,
    leftTailRisk
  );

  const dcaResult = calculateDCAPacing(risk, momentum.direction);

  const profitTakingResult = calculateProfitTaking(
    risk,
    confidence.value,
    momentum.direction
  );

  return {
    sizeMultiplier,
    dcaPacing: dcaResult.pacing,
    dcaPacingFactor: dcaResult.factor,
    profitTakingAggressiveness: profitTakingResult.aggressiveness,
    profitTakingLevel: profitTakingResult.level,
    inputs: {
      riskLevel: risk,
      riskConfidence: confidence.value,
      riskMomentumDirection: momentum.direction,
      leftTailRisk,
    },
    disclaimer:
      'NON-DIRECTIVE GUIDANCE ONLY. This is not financial advice. ' +
      'These suggestions are derived from quantitative risk metrics and do not constitute ' +
      'buy, sell, or exit signals. Always consult a qualified financial advisor before ' +
      'making investment decisions. Past performance does not guarantee future results.',
  };
}

/**
 * Get a human-readable summary of position guidance
 */
export function getGuidanceSummary(guidance: PositionGuidance): string {
  const parts: string[] = [];

  // Size multiplier
  if (guidance.sizeMultiplier > 1.1) {
    parts.push(`Position size: ${(guidance.sizeMultiplier * 100).toFixed(0)}% of baseline (favorable conditions)`);
  } else if (guidance.sizeMultiplier < 0.9) {
    parts.push(`Position size: ${(guidance.sizeMultiplier * 100).toFixed(0)}% of baseline (elevated caution)`);
  } else {
    parts.push(`Position size: baseline`);
  }

  // DCA pacing
  const pacingDescriptions = {
    accelerate: 'DCA: Consider accelerating accumulation',
    normal: 'DCA: Maintain normal pace',
    decelerate: 'DCA: Consider slowing accumulation',
    pause: 'DCA: Consider pausing new purchases',
  };
  parts.push(pacingDescriptions[guidance.dcaPacing]);

  // Profit taking
  const profitDescriptions = {
    none: 'Profit-taking: Not currently suggested',
    light: 'Profit-taking: Light profit-taking may be considered',
    moderate: 'Profit-taking: Moderate profit-taking suggested',
    aggressive: 'Profit-taking: Aggressive profit-taking suggested',
  };
  parts.push(profitDescriptions[guidance.profitTakingLevel]);

  return parts.join(' | ');
}

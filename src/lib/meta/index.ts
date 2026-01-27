/**
 * META-LAYERS UNIFIED INDEX
 *
 * Central integration point for all meta-layer calculations.
 * Provides a single function to compute all meta-layers from existing risk data.
 *
 * CRITICAL INVARIANT:
 * All meta-layers are ADDITIVE and ORTHOGONAL to the base risk calculation.
 * The base risk score (RiskOutput) is NEVER modified by this module.
 *
 * Data Flow (GUARANTEED):
 *   FeatureVector[] → calculateAllRisks() → RiskOutput[] (UNCHANGED)
 *                                                ↓
 *                                    calculateMetaLayers() → MetaLayersOutput[]
 *
 * The existing risk calculation pipeline remains COMPLETELY UNCHANGED.
 * Meta-layers only READ from RiskOutput and FeatureVector.
 */

// Re-export all types
export * from './types';

// Import implementations
import { RiskOutput, FeatureVector, DailyData, UIDataPoint } from '../types';
import {
  MetaLayersOutput,
  MetaLayersConfig,
  DEFAULT_META_CONFIG,
  UIDataPointWithMeta,
} from './types';

import { calculateRiskConfidence } from './confidence';
import { calculateRiskMomentum } from './momentum';
import { calculateHistoricalContext } from './historical-context';
import {
  calculateDrawdownProbability,
  calculateSimpleDrawdownProbability,
} from './drawdown-probability';
import { calculateCycleRelativeRisk } from './cycle-relative';
import { calculatePositionGuidance } from './position-guidance';

// Re-export individual module functions for direct access
export { calculateRiskConfidence, calculateAllRiskConfidence } from './confidence';
export {
  calculateRiskMomentum,
  calculateAllRiskMomentum,
  getMomentumDirection,
} from './momentum';
export {
  calculateHistoricalContext,
  buildHistoricalContext,
  getRiskBucket,
} from './historical-context';
export {
  calculateDrawdownProbability,
  calculateSimpleDrawdownProbability,
  calculateMacroStress,
} from './drawdown-probability';
export {
  calculateCycleRelativeRisk,
  calculateAllCycleRelativeRisk,
  getCycleContextDescription,
} from './cycle-relative';
export {
  calculatePositionGuidance,
  calculateSizeMultiplier,
  calculateDCAPacing,
  calculateProfitTaking,
  getGuidanceSummary,
} from './position-guidance';

/**
 * Calculate all meta-layers for a single day
 *
 * IMPORTANT: This function ONLY READS from the provided data.
 * It does NOT modify any existing risk values.
 *
 * @param risks - Array of RiskOutput (historical, READ-ONLY)
 * @param features - Array of FeatureVector (historical, READ-ONLY)
 * @param data - Array of DailyData for volatility calculations (READ-ONLY)
 * @param currentIndex - Index of the current day to calculate
 * @param config - Configuration for which layers to enable
 * @returns MetaLayersOutput for the specified day
 */
export function calculateMetaLayers(
  risks: RiskOutput[],
  features: FeatureVector[],
  data: DailyData[],
  currentIndex: number,
  config: MetaLayersConfig = DEFAULT_META_CONFIG
): MetaLayersOutput {
  if (currentIndex < 0 || currentIndex >= risks.length) {
    throw new Error(`Invalid index ${currentIndex} for array of length ${risks.length}`);
  }

  const currentRisk = risks[currentIndex];
  const currentFeature = features[currentIndex];

  // Base output with read-only references to original risk
  const output: MetaLayersOutput = {
    date: currentRisk.date,
    baseRisk: currentRisk.risk,
    baseSmoothedRisk: currentRisk.smoothedRisk,
  };

  // 1. Risk Confidence
  if (config.enableConfidence && currentIndex >= 14) {
    output.confidence = calculateRiskConfidence(risks, currentIndex);
  }

  // 2. Risk Momentum
  if (config.enableMomentum && currentIndex >= 30) {
    output.momentum = calculateRiskMomentum(risks, currentIndex);
  }

  // 3. Historical Context (requires significant history)
  if (config.enableHistoricalContext && currentIndex >= 365 * 2) {
    const prices = data.map(d => d.price);
    output.historicalContext = calculateHistoricalContext(
      risks,
      prices,
      currentIndex,
      currentFeature.cyclePhase
    );
  }

  // 4. Drawdown Probability
  if (config.enableDrawdownProbability && currentIndex >= 90) {
    output.drawdownProbability = calculateDrawdownProbability(
      currentFeature,
      currentRisk,
      data,
      currentIndex
    );
  }

  // 5. Cycle-Relative Risk (requires at least one full cycle)
  if (config.enableCycleRelativeRisk && currentIndex >= 365 * 4) {
    output.cycleRelativeRisk = calculateCycleRelativeRisk(risks, features, currentIndex);
  }

  // 6. Position Guidance (requires confidence and momentum)
  if (config.enablePositionGuidance && output.confidence && output.momentum) {
    output.positionGuidance = calculatePositionGuidance(
      currentRisk,
      output.confidence,
      output.momentum,
      output.drawdownProbability
    );
  }

  return output;
}

/**
 * Calculate meta-layers for all days in the series
 *
 * @param risks - Array of RiskOutput (historical, READ-ONLY)
 * @param features - Array of FeatureVector (READ-ONLY)
 * @param data - Array of DailyData (READ-ONLY)
 * @param config - Configuration for which layers to enable
 * @param startIndex - Starting index (default: 365*2 for meaningful context)
 * @returns Array of MetaLayersOutput
 */
export function calculateAllMetaLayers(
  risks: RiskOutput[],
  features: FeatureVector[],
  data: DailyData[],
  config: MetaLayersConfig = DEFAULT_META_CONFIG,
  startIndex: number = 365 * 2
): MetaLayersOutput[] {
  const results: MetaLayersOutput[] = [];

  for (let i = startIndex; i < risks.length; i++) {
    results.push(calculateMetaLayers(risks, features, data, i, config));
  }

  return results;
}

/**
 * Extend UIDataPoint with meta-layers
 * Creates a new object without modifying the original
 *
 * @param uiData - Original UIDataPoint array (READ-ONLY)
 * @param metaLayers - Calculated meta-layers array
 * @param startIndex - Index in uiData where meta-layers start
 * @returns Extended UI data with meta-layers
 */
export function extendUIDataWithMeta(
  uiData: UIDataPoint[],
  metaLayers: MetaLayersOutput[],
  startIndex: number = 0
): UIDataPointWithMeta[] {
  return uiData.map((point, index) => {
    const metaIndex = index - startIndex;
    const meta = metaIndex >= 0 && metaIndex < metaLayers.length
      ? metaLayers[metaIndex]
      : undefined;

    // Create new object - never mutate original
    return {
      ...point,
      meta,
    };
  });
}

/**
 * Calculate simplified meta-layers when full data isn't available
 * Useful for real-time calculations with limited history
 *
 * @param riskOutput - Current risk output (READ-ONLY)
 * @param recentRisks - Recent risk history for momentum (READ-ONLY)
 * @returns Partial MetaLayersOutput
 */
export function calculateSimplifiedMetaLayers(
  riskOutput: RiskOutput,
  recentRisks: RiskOutput[]
): Partial<MetaLayersOutput> {
  const output: Partial<MetaLayersOutput> = {
    date: riskOutput.date,
    baseRisk: riskOutput.risk,
    baseSmoothedRisk: riskOutput.smoothedRisk,
  };

  // Calculate confidence if we have enough history
  if (recentRisks.length >= 14) {
    output.confidence = calculateRiskConfidence(recentRisks, recentRisks.length - 1);
  }

  // Calculate momentum if we have enough history
  if (recentRisks.length >= 30) {
    output.momentum = calculateRiskMomentum(recentRisks, recentRisks.length - 1);
  }

  // Calculate simplified drawdown probability
  output.drawdownProbability = calculateSimpleDrawdownProbability(
    riskOutput.smoothedRisk,
    riskOutput.components.volatility,
    riskOutput.components.macro
  );

  // Calculate position guidance if we have confidence and momentum
  if (output.confidence && output.momentum) {
    output.positionGuidance = calculatePositionGuidance(
      riskOutput,
      output.confidence,
      output.momentum,
      output.drawdownProbability
    );
  }

  return output;
}

/**
 * VALIDATION: Verify that meta-layers calculation doesn't modify risk values
 * This is a runtime assertion for safety
 *
 * @param originalRisks - Original risk array
 * @param risks - Risk array after meta-layer calculation
 * @returns true if risks are unchanged, throws if modified
 */
export function validateRiskInvariant(
  originalRisks: RiskOutput[],
  risks: RiskOutput[]
): boolean {
  if (originalRisks.length !== risks.length) {
    throw new Error('INVARIANT VIOLATION: Risk array length changed');
  }

  for (let i = 0; i < originalRisks.length; i++) {
    const orig = originalRisks[i];
    const curr = risks[i];

    if (orig.risk !== curr.risk) {
      throw new Error(`INVARIANT VIOLATION: Risk value changed at index ${i}`);
    }
    if (orig.smoothedRisk !== curr.smoothedRisk) {
      throw new Error(`INVARIANT VIOLATION: SmoothedRisk changed at index ${i}`);
    }
    if (orig.date !== curr.date) {
      throw new Error(`INVARIANT VIOLATION: Date changed at index ${i}`);
    }
  }

  return true;
}

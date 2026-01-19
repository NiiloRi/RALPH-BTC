/**
 * Model calibration utilities
 * Optimizes weights and calibration parameters using walk-forward validation
 */

import { FeatureVector, RiskOutput } from '../types';
import {
  calculateRawEnsemble,
  applyCalibration,
  clampRisk,
  normalizeWeights,
  DEFAULT_WEIGHTS,
} from './model';

/**
 * Calculate future maximum drawdown for a given index
 * Used as calibration target (without leakage - only for training)
 */
export function calculateFutureDrawdown(
  prices: number[],
  startIndex: number,
  horizon: number
): number {
  if (startIndex >= prices.length - 1) return 0;

  const endIndex = Math.min(startIndex + horizon, prices.length - 1);
  const startPrice = prices[startIndex];

  let peak = startPrice;
  let maxDrawdown = 0;

  for (let i = startIndex; i <= endIndex; i++) {
    peak = Math.max(peak, prices[i]);
    const drawdown = (peak - prices[i]) / peak;
    maxDrawdown = Math.max(maxDrawdown, drawdown);
  }

  return maxDrawdown;
}

/**
 * Calculate correlation between risk scores and future drawdowns
 */
export function calculateRiskDrawdownCorrelation(
  riskOutputs: RiskOutput[],
  prices: number[],
  horizon: number
): number {
  if (riskOutputs.length < 10) return 0;

  const risks: number[] = [];
  const drawdowns: number[] = [];

  // Only use data points where we can calculate future drawdown
  for (let i = 0; i < riskOutputs.length - horizon; i++) {
    risks.push(riskOutputs[i].risk);
    drawdowns.push(calculateFutureDrawdown(prices, i, horizon));
  }

  if (risks.length < 10) return 0;

  // Pearson correlation
  const n = risks.length;
  const sumR = risks.reduce((a, b) => a + b, 0);
  const sumD = drawdowns.reduce((a, b) => a + b, 0);
  const sumRD = risks.reduce((sum, r, i) => sum + r * drawdowns[i], 0);
  const sumR2 = risks.reduce((sum, r) => sum + r * r, 0);
  const sumD2 = drawdowns.reduce((sum, d) => sum + d * d, 0);

  const numerator = n * sumRD - sumR * sumD;
  const denominator = Math.sqrt(
    (n * sumR2 - sumR * sumR) * (n * sumD2 - sumD * sumD)
  );

  if (denominator === 0) return 0;

  return numerator / denominator;
}

/**
 * Simple grid search for optimal weights
 * Uses correlation with future drawdowns as optimization target
 */
export function optimizeWeights(
  features: FeatureVector[],
  prices: number[],
  horizon: number = 90,
  gridSteps: number = 5
): Record<string, number> {
  // Use gridSteps in future for dynamic grid search
  void gridSteps;

  let bestWeights = { ...DEFAULT_WEIGHTS };
  let bestCorr = -1;

  // For efficiency, we'll try some predefined weight configurations
  const weightConfigs = [
    { valuation: 0.3, momentum: 0.15, volatility: 0.15, cycle: 0.2, macro: 0.1, attention: 0.1 },
    { valuation: 0.25, momentum: 0.15, volatility: 0.15, cycle: 0.25, macro: 0.1, attention: 0.1 },
    { valuation: 0.25, momentum: 0.2, volatility: 0.15, cycle: 0.2, macro: 0.1, attention: 0.1 },
    { valuation: 0.2, momentum: 0.15, volatility: 0.2, cycle: 0.25, macro: 0.1, attention: 0.1 },
    { valuation: 0.25, momentum: 0.15, volatility: 0.1, cycle: 0.25, macro: 0.1, attention: 0.15 },
    { valuation: 0.3, momentum: 0.1, volatility: 0.15, cycle: 0.25, macro: 0.05, attention: 0.15 },
    DEFAULT_WEIGHTS,
  ];

  for (const weights of weightConfigs) {
    // Calculate risk with these weights
    const riskOutputs = features.map(f => {
      const raw = calculateRawEnsemble(f, weights);
      const calibrated = applyCalibration(raw, 4, 0.5);
      return {
        date: f.date,
        price: f.price,
        risk: clampRisk(calibrated),
        components: {
          valuation: f.valuationScore,
          momentum: f.momentumScore,
          volatility: f.volatilityScore,
          cycle: f.cycleScore,
          macro: f.macroScore,
          attention: f.attentionScore,
        },
        smoothedRisk: clampRisk(calibrated),
      };
    });

    // Calculate correlation with future drawdowns
    const corr = calculateRiskDrawdownCorrelation(riskOutputs, prices, horizon);

    if (corr > bestCorr) {
      bestCorr = corr;
      bestWeights = weights;
    }
  }

  console.log(`Best correlation: ${bestCorr.toFixed(4)}`);
  return normalizeWeights(bestWeights);
}

/**
 * Optimize calibration parameters (slope and center)
 */
export function optimizeCalibration(
  features: FeatureVector[],
  prices: number[],
  weights: Record<string, number>,
  horizon: number = 90
): { slope: number; center: number } {
  let bestParams = { slope: 4, center: 0.5 };
  let bestCorr = -1;

  // Grid search over slope and center
  for (let slope = 2; slope <= 8; slope += 1) {
    for (let center = 0.4; center <= 0.6; center += 0.05) {
      const riskOutputs = features.map(f => {
        const raw = calculateRawEnsemble(f, weights);
        const calibrated = applyCalibration(raw, slope, center);
        return {
          date: f.date,
          price: f.price,
          risk: clampRisk(calibrated),
          components: {
            valuation: f.valuationScore,
            momentum: f.momentumScore,
            volatility: f.volatilityScore,
            cycle: f.cycleScore,
            macro: f.macroScore,
            attention: f.attentionScore,
          },
          smoothedRisk: clampRisk(calibrated),
        };
      });

      const corr = calculateRiskDrawdownCorrelation(riskOutputs, prices, horizon);

      if (corr > bestCorr) {
        bestCorr = corr;
        bestParams = { slope, center };
      }
    }
  }

  console.log(`Best calibration params: slope=${bestParams.slope}, center=${bestParams.center}`);
  return bestParams;
}

/**
 * Isotonic regression for monotonic calibration
 * Ensures higher raw scores map to higher calibrated risks
 */
export function isotonicRegression(
  rawScores: number[],
  targets: number[]
): number[] {
  if (rawScores.length !== targets.length || rawScores.length === 0) {
    return rawScores;
  }

  // Sort by raw scores
  const pairs = rawScores.map((r, i) => ({ raw: r, target: targets[i] }));
  pairs.sort((a, b) => a.raw - b.raw);

  // Pool Adjacent Violators Algorithm (PAVA)
  const result = pairs.map(p => p.target);

  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < result.length - 1; i++) {
      if (result[i] > result[i + 1]) {
        // Pool and average
        const avg = (result[i] + result[i + 1]) / 2;
        result[i] = avg;
        result[i + 1] = avg;
        changed = true;
      }
    }
  }

  // Map back to original order
  const sortedResults: number[] = new Array(rawScores.length);
  const sortedPairs = pairs.map((p, i) => ({ ...p, calibrated: result[i] }));

  for (let i = 0; i < sortedPairs.length; i++) {
    const originalIdx = rawScores.findIndex(
      (r, idx) =>
        r === sortedPairs[i].raw && sortedResults[idx] === undefined
    );
    if (originalIdx >= 0) {
      sortedResults[originalIdx] = sortedPairs[i].calibrated;
    }
  }

  return sortedResults;
}

/**
 * Calculate calibration error (Brier score-like)
 */
export function calculateCalibrationError(
  risks: number[],
  drawdowns: number[],
  numBins: number = 10
): number {
  if (risks.length === 0) return 1;

  // Bin risks and calculate average drawdown per bin
  const bins: { risks: number[]; drawdowns: number[] }[] = [];
  for (let i = 0; i < numBins; i++) {
    bins.push({ risks: [], drawdowns: [] });
  }

  for (let i = 0; i < risks.length; i++) {
    const binIdx = Math.min(
      numBins - 1,
      Math.floor(risks[i] * numBins)
    );
    bins[binIdx].risks.push(risks[i]);
    bins[binIdx].drawdowns.push(drawdowns[i]);
  }

  // Calculate calibration error
  let error = 0;
  let count = 0;

  for (const bin of bins) {
    if (bin.risks.length > 0) {
      const avgRisk = bin.risks.reduce((a, b) => a + b, 0) / bin.risks.length;
      const avgDrawdown = bin.drawdowns.reduce((a, b) => a + b, 0) / bin.drawdowns.length;
      // Normalize drawdown to [0, 1] range (assuming max 80% drawdown)
      const normalizedDrawdown = Math.min(1, avgDrawdown / 0.8);
      error += Math.pow(avgRisk - normalizedDrawdown, 2) * bin.risks.length;
      count += bin.risks.length;
    }
  }

  return count > 0 ? error / count : 1;
}

/**
 * Full calibration pipeline
 */
export function calibrateModel(
  trainFeatures: FeatureVector[],
  trainPrices: number[],
  horizon: number = 90
): {
  weights: Record<string, number>;
  calibration: { slope: number; center: number };
  calibrationError: number;
} {
  // Step 1: Optimize weights
  const weights = optimizeWeights(trainFeatures, trainPrices, horizon);

  // Step 2: Optimize calibration parameters
  const calibration = optimizeCalibration(trainFeatures, trainPrices, weights, horizon);

  // Step 3: Calculate final calibration error
  const riskOutputs = trainFeatures.map(f => {
    const raw = calculateRawEnsemble(f, weights);
    const calibrated = applyCalibration(raw, calibration.slope, calibration.center);
    return clampRisk(calibrated);
  });

  const futureDrawdowns = trainFeatures.map((_, i) =>
    calculateFutureDrawdown(trainPrices, i, horizon)
  );

  const calibrationError = calculateCalibrationError(riskOutputs, futureDrawdowns);

  return {
    weights,
    calibration,
    calibrationError,
  };
}

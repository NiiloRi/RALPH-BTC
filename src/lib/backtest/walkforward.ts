/**
 * Walk-forward backtesting implementation
 * Validates the risk model across multiple time periods
 */

import { FeatureVector, BacktestFold, BacktestMetrics, BacktestReport } from '../types';
import {
  calculateRawEnsemble,
  applyCalibration,
  clampRisk,
} from '../risk/model';
import {
  calibrateModel,
  calculateFutureDrawdown,
  calculateRiskDrawdownCorrelation,
  calculateCalibrationError,
} from '../risk/calibration';

/**
 * Create walk-forward folds for backtesting
 * Each fold trains on data up to a cut date, then tests on next period
 */
export function createWalkForwardFolds(
  startDate: string,
  endDate: string,
  numFolds: number = 3,
  testPeriodDays: number = 365
): BacktestFold[] {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const totalDays = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));

  const folds: BacktestFold[] = [];

  // Reserve test periods at the end
  const totalTestDays = testPeriodDays * numFolds;
  const trainableDays = totalDays - totalTestDays;

  if (trainableDays < 365) {
    // Not enough data, return single fold
    const midPoint = new Date(start.getTime() + (totalDays / 2) * 24 * 60 * 60 * 1000);
    return [{
      trainStart: startDate,
      trainEnd: midPoint.toISOString().split('T')[0],
      testStart: midPoint.toISOString().split('T')[0],
      testEnd: endDate,
    }];
  }

  for (let i = 0; i < numFolds; i++) {
    const trainStart = startDate;

    // Each fold's train end is progressively later
    const trainEndOffset = trainableDays + testPeriodDays * i;
    const trainEndDate = new Date(start.getTime() + trainEndOffset * 24 * 60 * 60 * 1000);
    const trainEnd = trainEndDate.toISOString().split('T')[0];

    const testStartDate = new Date(trainEndDate.getTime() + 24 * 60 * 60 * 1000);
    const testStart = testStartDate.toISOString().split('T')[0];

    const testEndOffset = trainEndOffset + testPeriodDays;
    const testEndDate = new Date(
      Math.min(
        start.getTime() + testEndOffset * 24 * 60 * 60 * 1000,
        end.getTime()
      )
    );
    const testEnd = testEndDate.toISOString().split('T')[0];

    folds.push({
      trainStart,
      trainEnd,
      testStart,
      testEnd,
    });
  }

  return folds;
}

/**
 * Detect market tops using local maxima
 * Returns indices of detected tops
 */
export function detectTops(
  prices: number[],
  confirmationDays: number = 60,
  minDrawdown: number = 0.2
): number[] {
  const tops: number[] = [];

  for (let i = confirmationDays; i < prices.length - confirmationDays; i++) {
    // Check if this is a local maximum
    let isLocalMax = true;

    for (let j = i - confirmationDays; j <= i + confirmationDays; j++) {
      if (j !== i && prices[j] > prices[i]) {
        isLocalMax = false;
        break;
      }
    }

    if (!isLocalMax) continue;

    // Check if there's significant drawdown after this point
    const futureDrawdown = calculateFutureDrawdown(prices, i, confirmationDays * 2);
    if (futureDrawdown >= minDrawdown) {
      tops.push(i);
    }
  }

  return tops;
}

/**
 * Calculate precision and recall for top detection
 */
export function calculateTopDetectionMetrics(
  riskOutputs: { date: string; risk: number }[],
  actualTops: number[],
  riskThreshold: number = 0.7,
  toleranceDays: number = 30
): { precision: number; recall: number } {
  // Find dates where risk exceeded threshold
  const highRiskDates: number[] = [];
  for (let i = 0; i < riskOutputs.length; i++) {
    if (riskOutputs[i].risk >= riskThreshold) {
      highRiskDates.push(i);
    }
  }

  if (highRiskDates.length === 0 || actualTops.length === 0) {
    return { precision: 0, recall: 0 };
  }

  // Calculate true positives (high risk within tolerance of actual top)
  let truePositives = 0;
  const matchedTops = new Set<number>();

  for (const highRiskIdx of highRiskDates) {
    for (const topIdx of actualTops) {
      if (Math.abs(highRiskIdx - topIdx) <= toleranceDays && !matchedTops.has(topIdx)) {
        truePositives++;
        matchedTops.add(topIdx);
        break;
      }
    }
  }

  const precision = truePositives / highRiskDates.length;
  const recall = truePositives / actualTops.length;

  return { precision, recall };
}

/**
 * Run backtest on a single fold
 */
export function runFoldBacktest(
  features: FeatureVector[],
  prices: number[],
  fold: BacktestFold,
  foldIndex: number
): BacktestMetrics {
  // Split data into train and test
  const trainFeatures: FeatureVector[] = [];
  const trainPrices: number[] = [];
  const testFeatures: FeatureVector[] = [];
  const testPrices: number[] = [];

  for (let i = 0; i < features.length; i++) {
    const date = features[i].date;
    if (date >= fold.trainStart && date <= fold.trainEnd) {
      trainFeatures.push(features[i]);
      trainPrices.push(prices[i]);
    }
    if (date >= fold.testStart && date <= fold.testEnd) {
      testFeatures.push(features[i]);
      testPrices.push(prices[i]);
    }
  }

  // Calibrate model on training data
  const { weights, calibration } = calibrateModel(
    trainFeatures,
    trainPrices,
    90
  );

  // Calculate risk on test data using calibrated model
  const testRiskOutputs = testFeatures.map(f => {
    const raw = calculateRawEnsemble(f, weights);
    const calibrated = applyCalibration(raw, calibration.slope, calibration.center);
    return {
      date: f.date,
      price: f.price,
      risk: clampRisk(calibrated),
    };
  });

  // Calculate metrics on test set
  const riskDrawdownCorr30d = calculateRiskDrawdownCorrelation(
    testRiskOutputs.map((r) => ({
      ...r,
      components: { valuation: 0, momentum: 0, volatility: 0, cycle: 0, macro: 0, attention: 0 },
      smoothedRisk: r.risk,
    })),
    testPrices,
    30
  );

  const riskDrawdownCorr90d = calculateRiskDrawdownCorrelation(
    testRiskOutputs.map((r) => ({
      ...r,
      components: { valuation: 0, momentum: 0, volatility: 0, cycle: 0, macro: 0, attention: 0 },
      smoothedRisk: r.risk,
    })),
    testPrices,
    90
  );

  const riskDrawdownCorr180d = calculateRiskDrawdownCorrelation(
    testRiskOutputs.map((r) => ({
      ...r,
      components: { valuation: 0, momentum: 0, volatility: 0, cycle: 0, macro: 0, attention: 0 },
      smoothedRisk: r.risk,
    })),
    testPrices,
    180
  );

  // Detect tops in test period
  const testTops = detectTops(testPrices);
  const { precision, recall } = calculateTopDetectionMetrics(
    testRiskOutputs,
    testTops
  );

  // Calculate calibration error on test set
  const testRisks = testRiskOutputs.map(r => r.risk);
  const testDrawdowns = testFeatures.map((_, i) =>
    calculateFutureDrawdown(testPrices, i, 90)
  );
  const calibrationError = calculateCalibrationError(testRisks, testDrawdowns);

  return {
    fold: foldIndex,
    trainPeriod: { start: fold.trainStart, end: fold.trainEnd },
    testPeriod: { start: fold.testStart, end: fold.testEnd },
    riskDrawdownCorr30d,
    riskDrawdownCorr90d,
    riskDrawdownCorr180d,
    topPrecision: precision,
    topRecall: recall,
    calibrationError,
    weights,
  };
}

/**
 * Run full walk-forward backtest
 */
export function runWalkForwardBacktest(
  features: FeatureVector[],
  prices: number[],
  numFolds: number = 3
): BacktestReport {
  if (features.length === 0) {
    throw new Error('No features provided for backtest');
  }

  const startDate = features[0].date;
  const endDate = features[features.length - 1].date;

  // Create folds
  const folds = createWalkForwardFolds(startDate, endDate, numFolds);

  // Run backtest on each fold
  const foldMetrics: BacktestMetrics[] = [];

  for (let i = 0; i < folds.length; i++) {
    console.log(`Running fold ${i + 1}/${folds.length}...`);
    const metrics = runFoldBacktest(features, prices, folds[i], i + 1);
    foldMetrics.push(metrics);
  }

  // Calculate aggregate metrics
  const avgRiskDrawdownCorr30d =
    foldMetrics.reduce((sum, m) => sum + m.riskDrawdownCorr30d, 0) / foldMetrics.length;
  const avgRiskDrawdownCorr90d =
    foldMetrics.reduce((sum, m) => sum + m.riskDrawdownCorr90d, 0) / foldMetrics.length;
  const avgRiskDrawdownCorr180d =
    foldMetrics.reduce((sum, m) => sum + m.riskDrawdownCorr180d, 0) / foldMetrics.length;
  const avgTopPrecision =
    foldMetrics.reduce((sum, m) => sum + m.topPrecision, 0) / foldMetrics.length;
  const avgTopRecall =
    foldMetrics.reduce((sum, m) => sum + m.topRecall, 0) / foldMetrics.length;
  const avgCalibrationError =
    foldMetrics.reduce((sum, m) => sum + m.calibrationError, 0) / foldMetrics.length;

  // Use weights from last fold as final weights
  const finalWeights = foldMetrics[foldMetrics.length - 1].weights;

  return {
    generatedAt: new Date().toISOString(),
    dataRange: { start: startDate, end: endDate },
    folds: foldMetrics,
    aggregateMetrics: {
      avgRiskDrawdownCorr30d,
      avgRiskDrawdownCorr90d,
      avgRiskDrawdownCorr180d,
      avgTopPrecision,
      avgTopRecall,
      avgCalibrationError,
    },
    finalWeights,
  };
}

/**
 * Generate markdown report from backtest results
 */
export function generateBacktestReport(report: BacktestReport): string {
  let md = `# BTC Risk Metric Backtest Report\n\n`;
  md += `Generated: ${report.generatedAt}\n\n`;
  md += `Data Range: ${report.dataRange.start} to ${report.dataRange.end}\n\n`;

  md += `## Aggregate Metrics\n\n`;
  md += `| Metric | Value |\n`;
  md += `|--------|-------|\n`;
  md += `| Avg Risk-Drawdown Corr (30d) | ${report.aggregateMetrics.avgRiskDrawdownCorr30d.toFixed(4)} |\n`;
  md += `| Avg Risk-Drawdown Corr (90d) | ${report.aggregateMetrics.avgRiskDrawdownCorr90d.toFixed(4)} |\n`;
  md += `| Avg Risk-Drawdown Corr (180d) | ${report.aggregateMetrics.avgRiskDrawdownCorr180d.toFixed(4)} |\n`;
  md += `| Avg Top Precision | ${(report.aggregateMetrics.avgTopPrecision * 100).toFixed(1)}% |\n`;
  md += `| Avg Top Recall | ${(report.aggregateMetrics.avgTopRecall * 100).toFixed(1)}% |\n`;
  md += `| Avg Calibration Error | ${report.aggregateMetrics.avgCalibrationError.toFixed(4)} |\n`;
  md += `\n`;

  md += `## Final Model Weights\n\n`;
  md += `| Component | Weight |\n`;
  md += `|-----------|--------|\n`;
  for (const [key, value] of Object.entries(report.finalWeights)) {
    md += `| ${key} | ${(value * 100).toFixed(1)}% |\n`;
  }
  md += `\n`;

  md += `## Fold Details\n\n`;
  for (const fold of report.folds) {
    md += `### Fold ${fold.fold}\n\n`;
    md += `- Train: ${fold.trainPeriod.start} to ${fold.trainPeriod.end}\n`;
    md += `- Test: ${fold.testPeriod.start} to ${fold.testPeriod.end}\n`;
    md += `- Risk-Drawdown Corr (90d): ${fold.riskDrawdownCorr90d.toFixed(4)}\n`;
    md += `- Top Precision: ${(fold.topPrecision * 100).toFixed(1)}%\n`;
    md += `- Top Recall: ${(fold.topRecall * 100).toFixed(1)}%\n`;
    md += `- Calibration Error: ${fold.calibrationError.toFixed(4)}\n`;
    md += `\n`;
  }

  md += `## Interpretation\n\n`;
  md += `- **Risk-Drawdown Correlation**: Higher is better. Indicates how well high risk scores predict future drawdowns.\n`;
  md += `- **Top Precision**: % of high-risk signals that occurred near actual tops.\n`;
  md += `- **Top Recall**: % of actual tops that were flagged by high risk.\n`;
  md += `- **Calibration Error**: Lower is better. Measures alignment between risk levels and actual outcomes.\n`;

  return md;
}

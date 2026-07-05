/**
 * Walk-Forward Validation and Parameter Sensitivity Analysis
 *
 * Validates that the strategy is robust and not overfit to historical data.
 */

import {
  DCASwingConfig,
  WalkForwardResult,
  SensitivityResult,
  DEFAULT_DCA_SWING_CONFIG,
} from './types';
import { runDCASwingBacktest } from './backtest';
import { RiskDataPoint } from '../risk-metric-contract';

/**
 * Create walk-forward folds for validation
 *
 * Each fold:
 * - Trains on data up to a certain date (in-sample)
 * - Tests on following period (out-of-sample)
 */
export function createWalkForwardFolds(
  startDate: string,
  endDate: string,
  numFolds: number = 4,
  testPeriodDays: number = 365
): { trainStart: string; trainEnd: string; testStart: string; testEnd: string }[] {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const totalDays = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));

  const folds: { trainStart: string; trainEnd: string; testStart: string; testEnd: string }[] = [];

  // Reserve test periods at the end
  const totalTestDays = testPeriodDays * numFolds;
  const trainableDays = totalDays - totalTestDays;

  if (trainableDays < 365) {
    // Not enough data - return single fold
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

    folds.push({ trainStart, trainEnd, testStart, testEnd });
  }

  return folds;
}

/**
 * Run walk-forward validation
 *
 * Tests strategy on multiple out-of-sample periods to verify robustness.
 */
export function runWalkForwardValidation(
  data: RiskDataPoint[],
  config: DCASwingConfig = DEFAULT_DCA_SWING_CONFIG,
  numFolds: number = 4
): WalkForwardResult {
  if (data.length === 0) {
    throw new Error('No data provided for walk-forward validation');
  }

  const startDate = data[0].date;
  const endDate = data[data.length - 1].date;

  const folds = createWalkForwardFolds(startDate, endDate, numFolds);

  const foldResults: WalkForwardResult['folds'] = [];

  for (let i = 0; i < folds.length; i++) {
    const fold = folds[i];

    // Run in-sample backtest
    const inSampleConfig: DCASwingConfig = {
      ...config,
      startDate: fold.trainStart,
      endDate: fold.trainEnd,
    };

    let inSampleCAGR = 0;
    try {
      const inSampleResult = runDCASwingBacktest(data, inSampleConfig);
      inSampleCAGR = inSampleResult.taxMetrics.afterTaxCAGR;
    } catch {
      // Not enough data, skip fold
      continue;
    }

    // Run out-of-sample backtest
    const outOfSampleConfig: DCASwingConfig = {
      ...config,
      startDate: fold.testStart,
      endDate: fold.testEnd,
    };

    let outOfSampleCAGR = 0;
    try {
      const outOfSampleResult = runDCASwingBacktest(data, outOfSampleConfig);
      outOfSampleCAGR = outOfSampleResult.taxMetrics.afterTaxCAGR;
    } catch {
      // Not enough data, skip fold
      continue;
    }

    // Calculate degradation
    const degradation = inSampleCAGR !== 0
      ? (inSampleCAGR - outOfSampleCAGR) / Math.abs(inSampleCAGR)
      : 0;

    foldResults.push({
      foldNumber: i + 1,
      trainStart: fold.trainStart,
      trainEnd: fold.trainEnd,
      testStart: fold.testStart,
      testEnd: fold.testEnd,
      inSampleCAGR,
      outOfSampleCAGR,
      degradation,
    });
  }

  if (foldResults.length === 0) {
    return {
      folds: [],
      avgInSampleCAGR: 0,
      avgOutOfSampleCAGR: 0,
      avgDegradation: 0,
      isRobust: false,
    };
  }

  // Calculate averages
  const avgInSampleCAGR = foldResults.reduce((sum, f) => sum + f.inSampleCAGR, 0) / foldResults.length;
  const avgOutOfSampleCAGR = foldResults.reduce((sum, f) => sum + f.outOfSampleCAGR, 0) / foldResults.length;
  const avgDegradation = foldResults.reduce((sum, f) => sum + f.degradation, 0) / foldResults.length;

  // Strategy is robust if OOS performance is at least 70% of IS
  const isRobust = avgOutOfSampleCAGR >= avgInSampleCAGR * 0.7 && avgOutOfSampleCAGR > 0;

  return {
    folds: foldResults,
    avgInSampleCAGR,
    avgOutOfSampleCAGR,
    avgDegradation,
    isRobust,
  };
}

/**
 * Run parameter sensitivity analysis
 *
 * Tests how the strategy performs with different parameter values.
 */
export function runParameterSensitivity(
  data: RiskDataPoint[],
  baseConfig: DCASwingConfig = DEFAULT_DCA_SWING_CONFIG,
  parameter: string,
  values: number[]
): SensitivityResult {
  const results: SensitivityResult['results'] = [];

  for (const value of values) {
    // Create config with modified parameter
    const testConfig = createConfigWithParameter(baseConfig, parameter, value);

    try {
      const result = runDCASwingBacktest(data, testConfig);

      results.push({
        value,
        afterTaxCAGR: result.taxMetrics.afterTaxCAGR,
        maxDrawdown: result.metrics.maxDrawdown,
        sharpeRatio: result.metrics.sharpeRatio,
      });
    } catch {
      // Skip this value if backtest fails
      results.push({
        value,
        afterTaxCAGR: 0,
        maxDrawdown: 100,
        sharpeRatio: 0,
      });
    }
  }

  // Find optimal value (highest after-tax CAGR)
  const optimalResult = results.reduce(
    (best, curr) => curr.afterTaxCAGR > best.afterTaxCAGR ? curr : best,
    results[0]
  );

  return {
    parameter,
    values,
    results,
    optimalValue: optimalResult?.value || values[Math.floor(values.length / 2)],
    optimalCAGR: optimalResult?.afterTaxCAGR || 0,
  };
}

/**
 * Create config with a specific parameter modified
 */
function createConfigWithParameter(
  baseConfig: DCASwingConfig,
  parameter: string,
  value: number
): DCASwingConfig {
  const config = JSON.parse(JSON.stringify(baseConfig)) as DCASwingConfig;

  switch (parameter) {
    // DCA parameters
    case 'dca.baseAmount':
      config.dca.baseAmount = value;
      break;
    case 'dca.maxMultiplier':
      config.dca.maxMultiplier = value;
      break;
    case 'dca.minMultiplier':
      config.dca.minMultiplier = value;
      break;
    case 'dca.exponent':
      config.dca.exponent = value;
      break;
    case 'dca.skipAboveRisk':
      config.dca.skipAboveRisk = value;
      break;

    // Swing parameters
    case 'swing.consecutiveDaysToTrigger':
      config.swing.consecutiveDaysToTrigger = value;
      break;
    case 'swing.deriskThreshold':
      config.swing.deriskThreshold = value;
      break;
    case 'swing.deriskPercent':
      config.swing.deriskPercent = value;
      break;
    case 'swing.cooldownDays':
      config.swing.cooldownDays = value;
      break;
    case 'swing.reriskThreshold':
      config.swing.reriskThreshold = value;
      break;

    // Zone thresholds
    case 'zones.extremeBuy':
      config.zones.extremeBuy = value;
      break;
    case 'zones.strongBuy':
      config.zones.strongBuy = value;
      break;
    case 'zones.cautious':
      config.zones.cautious = value;
      break;
    case 'zones.sell':
      config.zones.sell = value;
      break;

    default:
      console.warn(`Unknown parameter: ${parameter}`);
  }

  return config;
}

/**
 * Run full sensitivity analysis for all key parameters
 */
export function runFullSensitivityAnalysis(
  data: RiskDataPoint[],
  baseConfig: DCASwingConfig = DEFAULT_DCA_SWING_CONFIG
): SensitivityResult[] {
  const sensitivities: SensitivityResult[] = [];

  // DCA max multiplier
  sensitivities.push(
    runParameterSensitivity(data, baseConfig, 'dca.maxMultiplier', [1.5, 2.0, 2.5, 3.0, 3.5, 4.0])
  );

  // DCA exponent
  sensitivities.push(
    runParameterSensitivity(data, baseConfig, 'dca.exponent', [1.0, 1.25, 1.5, 1.75, 2.0])
  );

  // DCA skip threshold
  sensitivities.push(
    runParameterSensitivity(data, baseConfig, 'dca.skipAboveRisk', [0.60, 0.65, 0.70, 0.75, 0.80])
  );

  // Swing de-risk threshold
  sensitivities.push(
    runParameterSensitivity(data, baseConfig, 'swing.deriskThreshold', [0.65, 0.70, 0.75, 0.80, 0.85])
  );

  // Swing consecutive days
  sensitivities.push(
    runParameterSensitivity(data, baseConfig, 'swing.consecutiveDaysToTrigger', [2, 3, 4, 5, 7])
  );

  // Swing de-risk percent
  sensitivities.push(
    runParameterSensitivity(data, baseConfig, 'swing.deriskPercent', [0.05, 0.10, 0.15, 0.20, 0.25])
  );

  // Swing cooldown
  sensitivities.push(
    runParameterSensitivity(data, baseConfig, 'swing.cooldownDays', [7, 14, 21, 30])
  );

  return sensitivities;
}

/**
 * Generate sensitivity analysis report
 */
export function generateSensitivityReport(sensitivities: SensitivityResult[]): string {
  let report = '# Parameter Sensitivity Analysis\n\n';

  for (const s of sensitivities) {
    report += `## ${s.parameter}\n\n`;
    report += '| Value | After-Tax CAGR | Max Drawdown | Sharpe Ratio |\n';
    report += '|-------|----------------|--------------|-------------|\n';

    for (const r of s.results) {
      const isOptimal = r.value === s.optimalValue ? ' ⭐' : '';
      report += `| ${r.value}${isOptimal} | ${r.afterTaxCAGR.toFixed(2)}% | ${r.maxDrawdown.toFixed(1)}% | ${r.sharpeRatio.toFixed(3)} |\n`;
    }

    report += `\n**Optimal value:** ${s.optimalValue} (CAGR: ${s.optimalCAGR.toFixed(2)}%)\n\n`;
  }

  return report;
}

/**
 * Generate walk-forward report
 */
export function generateWalkForwardReport(result: WalkForwardResult): string {
  let report = '# Walk-Forward Validation Report\n\n';

  report += '## Summary\n\n';
  report += `- **Avg In-Sample CAGR:** ${result.avgInSampleCAGR.toFixed(2)}%\n`;
  report += `- **Avg Out-of-Sample CAGR:** ${result.avgOutOfSampleCAGR.toFixed(2)}%\n`;
  report += `- **Avg Degradation:** ${(result.avgDegradation * 100).toFixed(1)}%\n`;
  report += `- **Is Robust:** ${result.isRobust ? '✅ Yes' : '❌ No'}\n\n`;

  report += '## Fold Details\n\n';
  report += '| Fold | Train Period | Test Period | IS CAGR | OOS CAGR | Degradation |\n';
  report += '|------|--------------|-------------|---------|----------|------------|\n';

  for (const fold of result.folds) {
    report += `| ${fold.foldNumber} | ${fold.trainStart} to ${fold.trainEnd} | ${fold.testStart} to ${fold.testEnd} | ${fold.inSampleCAGR.toFixed(2)}% | ${fold.outOfSampleCAGR.toFixed(2)}% | ${(fold.degradation * 100).toFixed(1)}% |\n`;
  }

  report += '\n## Interpretation\n\n';
  report += '- **In-Sample (IS):** Performance on training data (potential overfit)\n';
  report += '- **Out-of-Sample (OOS):** Performance on unseen data (realistic expectation)\n';
  report += '- **Degradation:** How much worse OOS is vs IS (lower is better)\n';
  report += '- **Robust:** OOS performance should be at least 70% of IS\n';

  return report;
}

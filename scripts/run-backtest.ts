#!/usr/bin/env tsx
/**
 * Run walk-forward backtest
 * Usage: npm run backtest
 */

import * as fs from 'fs';
import * as path from 'path';
import { FeatureVector } from '../src/lib/types';
import { runWalkForwardBacktest, generateBacktestReport } from '../src/lib/backtest/walkforward';

function loadFeatures(): FeatureVector[] {
  const featuresPath = path.join(process.cwd(), 'data', 'processed', 'features.json');

  if (!fs.existsSync(featuresPath)) {
    throw new Error('Features not found. Run npm run build:features first.');
  }

  const content = fs.readFileSync(featuresPath, 'utf-8');
  return JSON.parse(content);
}

function loadPrices(): number[] {
  const featuresPath = path.join(process.cwd(), 'data', 'processed', 'features.json');
  const features: FeatureVector[] = JSON.parse(fs.readFileSync(featuresPath, 'utf-8'));

  return features.map(f => f.price);
}

async function main() {
  console.log('=== Walk-Forward Backtest ===\n');

  try {
    // Load data
    const features = loadFeatures();
    const prices = loadPrices();

    console.log(`Loaded ${features.length} feature vectors`);
    console.log(`Date range: ${features[0].date} to ${features[features.length - 1].date}`);

    // Run backtest
    console.log('\nRunning walk-forward backtest with 3 folds...\n');
    const report = runWalkForwardBacktest(features, prices, 3);

    // Display results
    console.log('\n=== Backtest Results ===\n');
    console.log('Aggregate Metrics:');
    console.log(`  Risk-Drawdown Corr (30d): ${report.aggregateMetrics.avgRiskDrawdownCorr30d.toFixed(4)}`);
    console.log(`  Risk-Drawdown Corr (90d): ${report.aggregateMetrics.avgRiskDrawdownCorr90d.toFixed(4)}`);
    console.log(`  Risk-Drawdown Corr (180d): ${report.aggregateMetrics.avgRiskDrawdownCorr180d.toFixed(4)}`);
    console.log(`  Top Precision: ${(report.aggregateMetrics.avgTopPrecision * 100).toFixed(1)}%`);
    console.log(`  Top Recall: ${(report.aggregateMetrics.avgTopRecall * 100).toFixed(1)}%`);
    console.log(`  Calibration Error: ${report.aggregateMetrics.avgCalibrationError.toFixed(4)}`);

    console.log('\nFinal Weights:');
    for (const [key, value] of Object.entries(report.finalWeights)) {
      console.log(`  ${key}: ${(value * 100).toFixed(1)}%`);
    }

    // Generate markdown report
    const reportMd = generateBacktestReport(report);

    // Save report
    const docsDir = path.join(process.cwd(), 'docs');
    if (!fs.existsSync(docsDir)) {
      fs.mkdirSync(docsDir, { recursive: true });
    }

    const reportPath = path.join(docsDir, 'backtest-report.md');
    fs.writeFileSync(reportPath, reportMd);
    console.log(`\nSaved report to: ${reportPath}`);

    // Also save raw JSON
    const jsonPath = path.join(process.cwd(), 'data', 'processed', 'backtest_results.json');
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
    console.log(`Saved raw results to: ${jsonPath}`);

    console.log('\n✓ Backtest complete');
  } catch (error) {
    console.error('Error running backtest:', error);
    process.exit(1);
  }
}

main();

#!/usr/bin/env tsx
/**
 * Export processed data for UI consumption
 * Usage: npm run export:ui
 */

import * as fs from 'fs';
import * as path from 'path';
import { FeatureVector, UIDataPoint } from '../src/lib/types';
import { calculateAllRisks, DEFAULT_WEIGHTS, DEFAULT_CALIBRATION } from '../src/lib/risk/model';
import { isHalvingDate } from '../src/lib/features/cycle';

function loadFeatures(): FeatureVector[] {
  const featuresPath = path.join(process.cwd(), 'data', 'processed', 'features.json');

  if (!fs.existsSync(featuresPath)) {
    throw new Error('Features not found. Run npm run build:features first.');
  }

  return JSON.parse(fs.readFileSync(featuresPath, 'utf-8'));
}

function loadModel(): {
  weights: Record<string, number>;
  calibration: { slope: number; center: number };
  smoothing: number;
} {
  const modelPath = path.join(process.cwd(), 'data', 'processed', 'model.json');

  if (fs.existsSync(modelPath)) {
    return JSON.parse(fs.readFileSync(modelPath, 'utf-8'));
  }

  // Use defaults — MUST match the model's DEFAULT_CALIBRATION so static
  // exports and the live API produce the same scores (previously {4, 0.5}
  // here vs {7, 0.48} in the API caused divergent fallback data)
  return {
    weights: DEFAULT_WEIGHTS,
    calibration: DEFAULT_CALIBRATION,
    smoothing: 0.3,
  };
}

async function main() {
  console.log('=== Export for UI ===\n');

  try {
    // Load data
    const features = loadFeatures();
    const model = loadModel();

    console.log(`Loaded ${features.length} feature vectors`);
    console.log(`Using model weights:`, model.weights);

    // Calculate risk for all data points
    console.log('\nCalculating risk scores...');
    const riskOutputs = calculateAllRisks(
      features,
      model.weights,
      model.calibration,
      model.smoothing
    );

    // Convert to UI format
    const uiData: UIDataPoint[] = riskOutputs.map((output, index) => ({
      date: output.date,
      price: output.price,
      risk: output.risk,
      smoothedRisk: output.smoothedRisk,
      components: output.components,
      cyclePhase: features[index].cyclePhase,
      isHalving: isHalvingDate(new Date(output.date)),
    }));

    // Save as JSON for direct import
    const publicDir = path.join(process.cwd(), 'public');
    if (!fs.existsSync(publicDir)) {
      fs.mkdirSync(publicDir, { recursive: true });
    }

    const jsonPath = path.join(publicDir, 'risk_data.json');
    fs.writeFileSync(jsonPath, JSON.stringify(uiData, null, 2));
    console.log(`Saved JSON to: ${jsonPath}`);

    // Also save as CSV for backward compatibility
    const csvPath = path.join(publicDir, 'btc_risk_complete.csv');
    const headers = 'date,price,risk,smoothedRisk,valuation,momentum,volatility,cycle,macro,attention,cyclePhase,isHalving';
    const rows = uiData.map(d =>
      `${d.date},${d.price},${d.risk.toFixed(4)},${d.smoothedRisk.toFixed(4)},` +
      `${d.components.valuation.toFixed(4)},${d.components.momentum.toFixed(4)},` +
      `${d.components.volatility.toFixed(4)},${d.components.cycle.toFixed(4)},` +
      `${d.components.macro.toFixed(4)},${d.components.attention.toFixed(4)},` +
      `${d.cyclePhase},${d.isHalving ? 1 : 0}`
    );
    fs.writeFileSync(csvPath, [headers, ...rows].join('\n'));
    console.log(`Saved CSV to: ${csvPath}`);

    // Summary stats
    const latestRisk = uiData[uiData.length - 1];
    console.log('\nLatest data point:');
    console.log(`  Date: ${latestRisk.date}`);
    console.log(`  Price: $${latestRisk.price.toLocaleString()}`);
    console.log(`  Risk: ${(latestRisk.risk * 100).toFixed(1)}%`);
    console.log(`  Smoothed Risk: ${(latestRisk.smoothedRisk * 100).toFixed(1)}%`);
    console.log(`  Cycle Phase: ${latestRisk.cyclePhase}`);

    console.log('\n✓ UI export complete');
  } catch (error) {
    console.error('Error exporting for UI:', error);
    process.exit(1);
  }
}

main();

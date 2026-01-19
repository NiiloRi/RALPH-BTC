#!/usr/bin/env tsx
/**
 * Train and calibrate the risk model
 * Usage: npm run train:model
 */

import * as fs from 'fs';
import * as path from 'path';
import { FeatureVector } from '../src/lib/types';
import { calibrateModel } from '../src/lib/risk/calibration';
import { exportModelState } from '../src/lib/risk/model';

function loadFeatures(): FeatureVector[] {
  const featuresPath = path.join(process.cwd(), 'data', 'processed', 'features.json');

  if (!fs.existsSync(featuresPath)) {
    throw new Error('Features not found. Run npm run build:features first.');
  }

  const content = fs.readFileSync(featuresPath, 'utf-8');
  return JSON.parse(content);
}

function loadPrices(): number[] {
  const dailyPath = path.join(process.cwd(), 'data', 'processed', 'daily_data.json');

  if (!fs.existsSync(dailyPath)) {
    throw new Error('Daily data not found. Run npm run build:features first.');
  }

  const content = fs.readFileSync(dailyPath, 'utf-8');
  const dailyData = JSON.parse(content);

  // Get prices for the feature date range
  const features = loadFeatures();
  const featureDates = new Set(features.map(f => f.date));

  return dailyData
    .filter((d: { date: string }) => featureDates.has(d.date))
    .map((d: { price: number }) => d.price);
}

async function main() {
  console.log('=== Model Training ===\n');

  try {
    // Load features and prices
    const features = loadFeatures();
    const prices = loadPrices();

    console.log(`Loaded ${features.length} feature vectors`);
    console.log(`Date range: ${features[0].date} to ${features[features.length - 1].date}`);

    // Use 80% for training
    const trainCutoff = Math.floor(features.length * 0.8);
    const trainFeatures = features.slice(0, trainCutoff);
    const trainPrices = prices.slice(0, trainCutoff);

    console.log(`\nTraining on ${trainFeatures.length} samples (80%)...`);

    // Calibrate model
    const { weights, calibration, calibrationError } = calibrateModel(
      trainFeatures,
      trainPrices,
      90
    );

    console.log('\nOptimized weights:');
    for (const [key, value] of Object.entries(weights)) {
      console.log(`  ${key}: ${(value * 100).toFixed(1)}%`);
    }

    console.log(`\nCalibration parameters:`);
    console.log(`  slope: ${calibration.slope}`);
    console.log(`  center: ${calibration.center}`);
    console.log(`  calibration error: ${calibrationError.toFixed(4)}`);

    // Export model state
    const modelState = exportModelState(weights, calibration, 0.3);

    const modelPath = path.join(process.cwd(), 'data', 'processed', 'model.json');
    fs.writeFileSync(modelPath, JSON.stringify(modelState, null, 2));
    console.log(`\nSaved model to: ${modelPath}`);

    console.log('\n✓ Model training complete');
  } catch (error) {
    console.error('Error training model:', error);
    process.exit(1);
  }
}

main();

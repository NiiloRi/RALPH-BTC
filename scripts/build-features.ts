#!/usr/bin/env tsx
/**
 * Build features from raw price data
 * Usage: npm run build:features
 */

import * as fs from 'fs';
import * as path from 'path';
import { PriceData, FeatureVector } from '../src/lib/types';
import { normalizeToDailyData, validateDailyData } from '../src/lib/data/normalizer';
import { buildAllFeatures, validateFeatureVector } from '../src/lib/features';

function loadPriceData(): PriceData[] {
  // Try raw data first
  const rawPath = path.join(process.cwd(), 'data', 'raw', 'btc_price_daily.csv');

  if (fs.existsSync(rawPath)) {
    console.log(`Loading from: ${rawPath}`);
    const content = fs.readFileSync(rawPath, 'utf-8');
    return parseCSV(content);
  }

  // Fall back to public folder
  const publicPath = path.join(process.cwd(), 'public', 'btc_risk_binance.csv');

  if (fs.existsSync(publicPath)) {
    console.log(`Loading from fallback: ${publicPath}`);
    const content = fs.readFileSync(publicPath, 'utf-8');
    return parseCSV(content, true);
  }

  throw new Error('No price data found. Run npm run fetch:data first.');
}

function parseCSV(content: string, isRiskFormat = false): PriceData[] {
  const lines = content.trim().split('\n');
  const header = lines[0].split(',');

  const dateIdx = header.indexOf('date');
  const priceIdx = isRiskFormat ? header.indexOf('price') : header.indexOf('close');
  const openIdx = header.indexOf('open');
  const highIdx = header.indexOf('high');
  const lowIdx = header.indexOf('low');

  return lines.slice(1).map(line => {
    const values = line.split(',');
    const price = parseFloat(values[priceIdx]);

    return {
      date: values[dateIdx],
      open: openIdx >= 0 ? parseFloat(values[openIdx]) : price,
      high: highIdx >= 0 ? parseFloat(values[highIdx]) : price,
      low: lowIdx >= 0 ? parseFloat(values[lowIdx]) : price,
      close: price,
    };
  });
}

function saveFeatures(features: FeatureVector[]): void {
  const processedDir = path.join(process.cwd(), 'data', 'processed');

  if (!fs.existsSync(processedDir)) {
    fs.mkdirSync(processedDir, { recursive: true });
  }

  // Save as JSON for easy loading
  const jsonPath = path.join(processedDir, 'features.json');
  fs.writeFileSync(jsonPath, JSON.stringify(features, null, 2));

  // Also save as CSV for inspection
  const csvPath = path.join(processedDir, 'features.csv');
  const headers = Object.keys(features[0]).join(',');
  const rows = features.map(f =>
    Object.values(f)
      .map(v => (typeof v === 'boolean' ? (v ? '1' : '0') : v))
      .join(',')
  );
  fs.writeFileSync(csvPath, [headers, ...rows].join('\n'));

  console.log(`Saved features to: ${jsonPath}`);
  console.log(`Saved features CSV to: ${csvPath}`);
}

async function main() {
  console.log('=== Feature Builder ===\n');

  try {
    // Load price data
    const priceData = loadPriceData();
    console.log(`Loaded ${priceData.length} price records`);

    // Normalize to daily data with computed fields
    console.log('\nNormalizing data...');
    const dailyData = normalizeToDailyData(priceData);
    console.log(`Created ${dailyData.length} daily records`);

    // Validate daily data
    const validation = validateDailyData(dailyData);
    if (!validation.valid) {
      console.error('Daily data validation errors:', validation.errors.slice(0, 5));
      if (validation.errors.length > 5) {
        console.error(`... and ${validation.errors.length - 5} more errors`);
      }
    }

    // Build features (starting from day 200 to have enough history)
    console.log('\nBuilding features...');
    const startIndex = Math.min(200, Math.floor(dailyData.length * 0.2));
    const features = buildAllFeatures(dailyData, startIndex);
    console.log(`Built ${features.length} feature vectors`);

    // Validate features
    let validCount = 0;
    const errors: string[] = [];

    for (const fv of features) {
      const result = validateFeatureVector(fv);
      if (result.valid) {
        validCount++;
      } else {
        errors.push(...result.errors);
      }
    }

    console.log(`Valid features: ${validCount}/${features.length}`);
    if (errors.length > 0) {
      console.warn(`Validation errors: ${errors.slice(0, 5).join(', ')}`);
    }

    // Save features
    console.log('\nSaving features...');
    saveFeatures(features);

    // Also save daily data for later use
    const dailyPath = path.join(process.cwd(), 'data', 'processed', 'daily_data.json');
    fs.writeFileSync(dailyPath, JSON.stringify(dailyData, null, 2));
    console.log(`Saved daily data to: ${dailyPath}`);

    console.log('\n✓ Feature build complete');
  } catch (error) {
    console.error('Error building features:', error);
    process.exit(1);
  }
}

main();

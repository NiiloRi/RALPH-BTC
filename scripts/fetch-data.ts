#!/usr/bin/env tsx
/**
 * Fetch BTC price data from available sources
 * Usage: npm run fetch:data
 */

import { getBTCPriceData } from '../src/lib/data/price-fetcher';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  console.log('=== BTC Data Fetcher ===\n');

  try {
    // Fetch price data
    console.log('Fetching BTC price data...');
    const priceData = await getBTCPriceData(true);

    console.log(`Fetched ${priceData.length} days of price data`);
    console.log(`Date range: ${priceData[0].date} to ${priceData[priceData.length - 1].date}`);

    // Save to data/raw directory
    const rawDir = path.join(process.cwd(), 'data', 'raw');
    if (!fs.existsSync(rawDir)) {
      fs.mkdirSync(rawDir, { recursive: true });
    }

    const outputPath = path.join(rawDir, 'btc_price_daily.csv');
    const header = 'date,open,high,low,close,volume';
    const rows = priceData.map(d =>
      `${d.date},${d.open},${d.high},${d.low},${d.close},${d.volume || 0}`
    );

    fs.writeFileSync(outputPath, [header, ...rows].join('\n'));
    console.log(`\nSaved to: ${outputPath}`);

    // Also copy fallback data if not enough data
    if (priceData.length < 365) {
      console.log('\nWarning: Less than 1 year of data. Consider using historical data source.');
    }

    console.log('\n✓ Data fetch complete');
  } catch (error) {
    console.error('Error fetching data:', error);
    process.exit(1);
  }
}

main();

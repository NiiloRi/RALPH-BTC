#!/usr/bin/env tsx
/**
 * Export the committed price fixture for round-4 acceptance tests.
 *
 * Companion to src/lib/adjusted/__fixtures__/risk-series.json: extracts the
 * daily close for each of its dates from the live /api/risk-data route (the
 * same served-model source that fixture declares). Prices are immutable
 * history, so the pull is reproducible for the fixture's date range.
 *
 * IMPORTANT: if risk-series.json is ever regenerated, this fixture MUST be
 * regenerated in the same change — the round-4 acceptance test asserts
 * per-index date equality between the two files and will fail loudly.
 *
 * Usage: npm run dev (in another terminal) → tsx scripts/export-price-fixture.ts
 */

import * as fs from 'fs';
import * as path from 'path';

const API_URL = process.env.RISK_API_URL ?? 'http://localhost:3000/api/risk-data';

const FIXTURES_DIR = path.join(process.cwd(), 'src', 'lib', 'adjusted', '__fixtures__');
const RISK_FIXTURE = path.join(FIXTURES_DIR, 'risk-series.json');
const PRICE_FIXTURE = path.join(FIXTURES_DIR, 'price-series.json');

interface RiskSeriesFixture {
  generatedFrom: string;
  schema: string[];
  count: number;
  range: { start: string; end: string };
  rows: (string | number)[][];
}

async function main(): Promise<void> {
  const riskFixture: RiskSeriesFixture = JSON.parse(fs.readFileSync(RISK_FIXTURE, 'utf-8'));
  const dates = riskFixture.rows.map(r => r[0] as string);

  console.log(`risk-series.json: ${dates.length} dates ${riskFixture.range.start} → ${riskFixture.range.end}`);
  console.log(`Fetching ${API_URL} ...`);

  const res = await fetch(API_URL);
  if (!res.ok) {
    throw new Error(`API returned ${res.status} ${res.statusText}`);
  }
  const payload = await res.json();
  const apiRows: { date: string; price: number }[] = payload.data;
  if (!Array.isArray(apiRows) || apiRows.length === 0) {
    throw new Error('API payload has no data[]');
  }

  const priceByDate = new Map<string, number>();
  for (const row of apiRows) priceByDate.set(row.date, row.price);

  // Fail loudly: every fixture date must have a finite positive price.
  const rows: (string | number)[][] = [];
  const missing: string[] = [];
  for (const date of dates) {
    const price = priceByDate.get(date);
    if (price === undefined) {
      missing.push(date);
      continue;
    }
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error(`Non-finite or non-positive price ${price} at ${date}`);
    }
    rows.push([date, price]);
  }
  if (missing.length > 0) {
    throw new Error(
      `${missing.length} fixture dates missing from API (first: ${missing.slice(0, 5).join(', ')})`
    );
  }

  const out = {
    generatedFrom:
      'live /api/risk-data (served route.ts model) — companion to risk-series.json; regenerate both together',
    schema: ['date', 'price'],
    count: rows.length,
    range: { start: rows[0][0], end: rows[rows.length - 1][0] },
    rows,
  };

  fs.writeFileSync(PRICE_FIXTURE, JSON.stringify(out));
  console.log(`Wrote ${PRICE_FIXTURE}: ${rows.length} rows ${out.range.start} → ${out.range.end}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

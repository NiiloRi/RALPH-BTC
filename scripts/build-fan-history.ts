#!/usr/bin/env tsx
/**
 * Build the expanding-window quantile-fan τ history cache.
 *
 * Writes public/fan_tau_history.json: for a monthly grid of past dates, the
 * fan position (τ) and Q1/Q50/Q99 bands as they would have been known at the
 * time (each point refit on data ≤ that date — walk-forward safe).
 *
 * Also REPORTS (does not act on) the round-2 gate: were expanding-window τ
 * values at the four cycle tops all comparably high (≥ 0.95)? If yes, τ is a
 * candidate cycle-adjusted valuation input for a later round; if no, the fan
 * stays contextual only.
 *
 * Usage: npm run build:fan-history
 */

import * as fs from 'fs';
import * as path from 'path';
import { expandingFanTau, fanTauAtDate } from '../src/lib/quantile-fan/expanding';

const BINANCE_START = '2017-08-17';
const CYCLE_TOPS = ['2013-12-04', '2017-12-17', '2021-11-10', '2025-01-20'];

type BinanceKline = [number, string, string, string, string, string, number, ...unknown[]];

function loadHistoricalCloses(): { date: string; close: number }[] {
  const p = path.join(process.cwd(), 'public', 'btc_historical.json');
  const raw = JSON.parse(fs.readFileSync(p, 'utf-8')) as { date: string; close: number }[];
  return raw.map(d => ({ date: d.date, close: d.close }));
}

async function fetchBinanceCloses(): Promise<{ date: string; close: number }[]> {
  const out: { date: string; close: number }[] = [];
  let startTime = new Date(BINANCE_START).getTime();
  const endTime = Date.now();
  while (startTime < endTime) {
    const url =
      `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&startTime=${startTime}&limit=1000`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Binance API error: ${res.status}`);
    const klines = (await res.json()) as BinanceKline[];
    if (klines.length === 0) break;
    for (const k of klines) {
      out.push({ date: new Date(k[0]).toISOString().split('T')[0], close: parseFloat(k[4]) });
    }
    startTime = klines[klines.length - 1][6] + 1;
    await new Promise(r => setTimeout(r, 60));
  }
  return out;
}

async function main() {
  console.log('=== Build expanding-window fan-τ history ===\n');

  const historical = loadHistoricalCloses();
  console.log(`Historical closes (pre-Binance): ${historical.length}`);
  const binance = await fetchBinanceCloses();
  console.log(`Binance closes (2017+): ${binance.length}`);

  // Combine: historical before Binance start, then Binance; dedupe by date
  const combined = [
    ...historical.filter(d => d.date < BINANCE_START),
    ...binance,
  ];
  const seen = new Set<string>();
  const series = combined
    .filter(d => (seen.has(d.date) ? false : (seen.add(d.date), true)))
    .filter(d => Number.isFinite(d.close) && d.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  const dates = series.map(d => d.date);
  const closes = series.map(d => d.close);
  console.log(`Combined: ${series.length} days (${dates[0]} → ${dates[dates.length - 1]})\n`);

  console.log('Refitting expanding-window fan on a monthly grid...');
  const t0 = Date.now();
  const grid = expandingFanTau(dates, closes);
  console.log(`  ${grid.length} grid points in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

  const outPath = path.join(process.cwd(), 'public', 'fan_tau_history.json');
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        note: 'Expanding-window (walk-forward-safe) quantile-fan τ. Each point refit on data ≤ its date.',
        range: { start: grid[0]?.date, end: grid[grid.length - 1]?.date },
        count: grid.length,
        grid,
      },
      null,
      0
    )
  );
  console.log(`Wrote ${outPath} (${(fs.statSync(outPath).size / 1024).toFixed(0)} KB)\n`);

  // ---- REPORT the round-2 gate (do NOT feed τ into anything) ----
  console.log('=== Round-2 gate: expanding-window τ at cycle tops (report only) ===');
  const taus: number[] = [];
  for (const top of CYCLE_TOPS) {
    const pt = fanTauAtDate(dates, closes, top);
    if (!pt) {
      console.log(`  ${top}: no data`);
      continue;
    }
    if (pt.tau !== null) taus.push(pt.tau);
    console.log(`  ${top}: τ = ${pt.tau === null ? pt.tauLabel : (pt.tau * 100).toFixed(1) + '%'} (${pt.tauLabel})`);
  }
  const allHigh = taus.length === CYCLE_TOPS.length && taus.every(t => t >= 0.95);
  console.log(
    `\n  Gate result: expanding-window τ at all four tops ≥ 95%? ${allHigh ? 'YES' : 'NO'}` +
    ` → ${allHigh ? 'τ is a candidate cycle-adjusted valuation input for a later round.' : 'fan stays CONTEXTUAL only; do not feed τ into the score.'}`
  );
  console.log('  (Reported only — this script does not modify the risk model.)');
}

main().catch(err => {
  console.error('build-fan-history failed:', err);
  process.exit(1);
});

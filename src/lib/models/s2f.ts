/**
 * STOCK-TO-FLOW valuation model (display layer).
 *
 * Supply schedule: piecewise-linear over subsidy eras. Era boundaries are the
 * ACTUAL halving dates; blocks/day within each past era is derived as
 * 210,000 / actual era length in days, which self-corrects for real
 * block-time variance (early eras ran faster than 144/day). The current and
 * projection eras assume the nominal 144 blocks/day.
 *
 *   supply(d) = era.startSupply + era.subsidy · era.blocksPerDay · daysInEra
 *   flow(d)   = era.subsidy · era.blocksPerDay · 365       (annualized issuance)
 *   S2F(d)    = supply / flow    — ramps slowly within an era, ~2× jump at halvings
 *
 * Model: ln(P) = a + b·ln(S2F), closed-form OLS on MONTHLY samples (last
 * observation per calendar month). Monthly because ln(S2F) is nearly constant
 * within an era — daily samples would be ~30× autocorrelated pseudo-replicates
 * that overweight long eras. Matches PlanB's reference methodology (2019
 * paper b ≈ 3.3; the 2026 tweet simplifies to S2F³) — reference values are
 * cited in docs/valuation-models.md, our own fitted parameters are reported
 * in the UI.
 *
 * NEXT_HALVING_ESTIMATE derivation: halvings occur every 210,000 blocks;
 * from 2024-04-19 at an assumed 144 blocks/day → 210,000/144 ≈ 1458 days
 * → 2028-04-16. An ESTIMATE (block times vary) — always label it as such.
 * Deliberately NOT added to types.ts HALVING_DATES: that array means actual
 * halvings and is consumed by frozen cycle code.
 */

import { GENESIS_DATE, HALVING_DATES } from '../types';

const MS_PER_DAY = 86_400_000;
const BLOCKS_PER_ERA = 210_000;
const ASSUMED_BLOCKS_PER_DAY = 144;
const MIN_POINTS = 24;

export const NEXT_HALVING_ESTIMATE = '2028-04-16';
/**
 * Second estimated halving: NEXT_HALVING_ESTIMATE + 210,000/144 ≈ 1458 days
 * → 2032-04-13 (the 2028→2032 span contains one Feb 29). Used by the long
 * projection horizon; even more uncertain than the first estimate.
 */
export const NEXT_HALVING_ESTIMATE_2 = '2032-04-13';

export interface Era {
  start: string;
  subsidy: number;
  blocksPerDay: number;
  startSupply: number;
}

function daysBetween(a: string | Date, b: string | Date): number {
  return (new Date(b).getTime() - new Date(a).getTime()) / MS_PER_DAY;
}

/** Build the era table from actual halving dates (see header). */
function buildEras(): Era[] {
  const eras: Era[] = [];
  let subsidy = 50;
  let startSupply = 0;
  let start = GENESIS_DATE.toISOString().split('T')[0];

  for (const halving of HALVING_DATES) {
    const end = halving.toISOString().split('T')[0];
    const days = daysBetween(start, end);
    eras.push({ start, subsidy, blocksPerDay: BLOCKS_PER_ERA / days, startSupply });
    startSupply += BLOCKS_PER_ERA * subsidy;
    subsidy /= 2;
    start = end;
  }
  // Current era (actual last halving → estimated next), assumed 144 blocks/day
  eras.push({ start, subsidy, blocksPerDay: ASSUMED_BLOCKS_PER_DAY, startSupply });
  startSupply += BLOCKS_PER_ERA * subsidy;
  subsidy /= 2;
  // Projection era beyond the estimated halving
  eras.push({
    start: NEXT_HALVING_ESTIMATE,
    subsidy,
    blocksPerDay: ASSUMED_BLOCKS_PER_DAY,
    startSupply,
  });
  startSupply += BLOCKS_PER_ERA * subsidy;
  subsidy /= 2;
  // Second projection era (long horizon ~2032) — keeps s2fAt correct there
  eras.push({
    start: NEXT_HALVING_ESTIMATE_2,
    subsidy,
    blocksPerDay: ASSUMED_BLOCKS_PER_DAY,
    startSupply,
  });
  return eras;
}

export const ERAS: Era[] = buildEras();

function eraFor(date: string): Era {
  let era = ERAS[0];
  for (const e of ERAS) {
    if (e.start <= date) era = e;
    else break;
  }
  return era;
}

/** Circulating BTC supply (piecewise-linear, continuous, exact at halvings). */
export function btcSupplyAt(date: string): number {
  const genesis = GENESIS_DATE.toISOString().split('T')[0];
  if (date <= genesis) return 0;
  const era = eraFor(date);
  const days = Math.max(0, daysBetween(era.start, date));
  return era.startSupply + era.subsidy * era.blocksPerDay * days;
}

/** Annualized issuance (BTC/year) — a step function halving at era boundaries. */
export function annualFlowAt(date: string): number {
  const era = eraFor(date);
  return era.subsidy * era.blocksPerDay * 365;
}

/** Stock-to-flow ratio. Ramps within an era, jumps ~2× at each halving. */
export function s2fAt(date: string): number {
  return btcSupplyAt(date) / annualFlowAt(date);
}

// ---- model fit ----------------------------------------------------------------

export interface S2FModel {
  /** ln(P) = a + b·ln(S2F) */
  a: number;
  b: number;
  r2: number;
  fittedN: number;
  fittedRange: { start: string; end: string };
}

/** Last observation per calendar month (see header for why monthly). */
export function monthlySamples(
  dates: string[],
  prices: number[]
): { date: string; price: number }[] {
  const byMonth = new Map<string, { date: string; price: number }>();
  for (let i = 0; i < dates.length; i++) {
    const p = prices[i];
    if (!Number.isFinite(p) || p <= 0) continue;
    byMonth.set(dates[i].slice(0, 7), { date: dates[i], price: p }); // last wins
  }
  return Array.from(byMonth.values()).sort((x, y) => (x.date < y.date ? -1 : 1));
}

export function fitS2F(dates: string[], prices: number[]): S2FModel {
  const samples = monthlySamples(dates, prices);
  const xs: number[] = [];
  const ys: number[] = [];
  for (const s of samples) {
    const s2f = s2fAt(s.date);
    if (!Number.isFinite(s2f) || s2f <= 0) continue;
    xs.push(Math.log(s2f));
    ys.push(Math.log(s.price));
  }
  const n = xs.length;
  if (n < MIN_POINTS) {
    throw new Error(`fitS2F: need >= ${MIN_POINTS} monthly samples, got ${n}`);
  }

  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i];
    sy += ys[i];
    sxy += xs[i] * ys[i];
    sxx += xs[i] * xs[i];
  }
  const b = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  const a = (sy - b * sx) / n;

  let ssRes = 0, ssTot = 0;
  const yMean = sy / n;
  for (let i = 0; i < n; i++) {
    const r = ys[i] - (a + b * xs[i]);
    ssRes += r * r;
    ssTot += (ys[i] - yMean) * (ys[i] - yMean);
  }

  return {
    a,
    b,
    r2: ssTot > 0 ? 1 - ssRes / ssTot : 1,
    fittedN: n,
    fittedRange: { start: samples[0].date, end: samples[samples.length - 1].date },
  };
}

/**
 * Model price for any date incl. future ones — past NEXT_HALVING_ESTIMATE the
 * flow halves and the model value steps up by 2^b (the projection's point).
 */
export function evaluateS2F(m: S2FModel, date: string): number {
  return Math.exp(m.a + m.b * Math.log(s2fAt(date)));
}

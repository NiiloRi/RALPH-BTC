/**
 * DIFFICULTY valuation model (display layer).
 *
 *   ln(P) = a + b·ln(difficulty)        — expect b ≈ 0.5
 *
 * Difficulty proxies bitcoin production cost (PlanB, Jul 2026:
 * "price = difficulty^0.5"; bitbo reference 0.002·D^0.51 — cited in
 * docs/valuation-models.md, our own OLS parameters reported in the UI).
 *
 * Join semantics: difficulty is literally a step function (changes only at
 * ~2-week retargets), so each price date carries the LAST difficulty
 * observation at or before it (forward fill). Fit on the full joined daily
 * series — unlike S2F, the regressor has real daily-scale information
 * (~hundreds of distinct levels since 2011).
 *
 * Deliberately NOT projectable: future difficulty is unknowable, so
 * evaluateDifficultyModel takes a difficulty VALUE, not a date — the type
 * system enforces the no-projection rule.
 */

import type { DifficultyPoint } from '../data/difficulty-fetcher';

const MIN_POINTS = 100;

export interface JoinedRow {
  date: string;
  close: number;
  difficulty: number;
}

/** Forward-fill difficulty onto price dates (two-pointer walk, both sorted). */
export function joinDifficultyToPrices(
  prices: { date: string; close: number }[],
  difficulty: DifficultyPoint[]
): JoinedRow[] {
  const valid = difficulty.filter(d => Number.isFinite(d.difficulty) && d.difficulty > 0);
  const out: JoinedRow[] = [];
  let j = -1;
  for (const p of prices) {
    while (j + 1 < valid.length && valid[j + 1].date <= p.date) j++;
    if (j < 0) continue; // price predates first difficulty observation
    if (!Number.isFinite(p.close) || p.close <= 0) continue;
    out.push({ date: p.date, close: p.close, difficulty: valid[j].difficulty });
  }
  return out;
}

export interface DifficultyModel {
  /** ln(P) = a + b·ln(D) */
  a: number;
  b: number;
  r2: number;
  fittedN: number;
  fittedRange: { start: string; end: string };
}

export function fitDifficultyModel(joined: JoinedRow[]): DifficultyModel {
  const n = joined.length;
  if (n < MIN_POINTS) {
    throw new Error(`fitDifficultyModel: need >= ${MIN_POINTS} joined rows, got ${n}`);
  }
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (const r of joined) {
    const x = Math.log(r.difficulty);
    const y = Math.log(r.close);
    sx += x;
    sy += y;
    sxy += x * y;
    sxx += x * x;
  }
  const b = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  const a = (sy - b * sx) / n;

  let ssRes = 0, ssTot = 0;
  const yMean = sy / n;
  for (const r of joined) {
    const resid = Math.log(r.close) - (a + b * Math.log(r.difficulty));
    ssRes += resid * resid;
    ssTot += (Math.log(r.close) - yMean) ** 2;
  }

  return {
    a,
    b,
    r2: ssTot > 0 ? 1 - ssRes / ssTot : 1,
    fittedN: n,
    fittedRange: { start: joined[0].date, end: joined[n - 1].date },
  };
}

/** Model price for a given difficulty VALUE (never a date — see header). */
export function evaluateDifficultyModel(m: DifficultyModel, difficulty: number): number {
  return Math.exp(m.a + m.b * Math.log(difficulty));
}

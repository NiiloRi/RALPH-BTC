/**
 * EXPANDING-WINDOW QUANTILE FAN — walk-forward-safe τ history.
 *
 * The dashboard's fan is a FULL-SAMPLE fit (fine for today's reading, but
 * lookahead-biased for any historical date). This module answers the
 * separate, walk-forward-safe question:
 *
 *   "What fan position (τ) would price have shown at each past date, using
 *    ONLY data known up to that date?"
 *
 * At each grid date t it refits `fitQuantileFan` on closes[0..t] and records
 * the implied quantile of close[t] plus the Q1/Q50/Q99 band values. Every
 * point is causal — τ[t] depends only on data ≤ t. This is the artifact the
 * round-2 gate needs: were expanding-window τ values at the four cycle tops
 * all comparably high (≥ ~0.95)? If yes, τ becomes a candidate cycle-adjusted
 * valuation input; if no, the fan stays contextual only.
 *
 * Pure and deterministic (the fit is deterministic IRLS). No IO here — the
 * build script feeds it data and writes the result.
 */

import { fitQuantileFan, evaluateFan, impliedQuantile } from './quantile-fan';

export interface FanTauPoint {
  date: string;
  /** Implied quantile of the day's close within the expanding-window fan */
  tau: number | null;
  /** Fan position label, e.g. "~Q97" / "> Q99" / "< Q1" */
  tauLabel: string;
  q01: number;
  q50: number;
  q99: number;
}

/** Minimum observations before a fit is attempted */
export const MIN_FIT_POINTS = 200;

/**
 * Fit the fan on closes[0..targetIndex] (inclusive) and return the implied
 * quantile + bands for the close at targetIndex. Causal by construction.
 * Returns null if too few points precede the target.
 */
export function fanTauAt(
  dates: string[],
  closes: number[],
  targetIndex: number
): FanTauPoint | null {
  if (targetIndex < MIN_FIT_POINTS || targetIndex >= dates.length) return null;
  const d = dates.slice(0, targetIndex + 1);
  const c = closes.slice(0, targetIndex + 1);
  let model;
  try {
    model = fitQuantileFan(d, c);
  } catch {
    return null;
  }
  const date = dates[targetIndex];
  const q = evaluateFan(model, date);
  const pos = impliedQuantile(model, date, closes[targetIndex]);
  return { date, tau: pos.tau, tauLabel: pos.label, q01: q[0], q50: q[3], q99: q[6] };
}

/**
 * Expanding-window τ series on a monthly grid (one point per calendar month,
 * once enough history exists). O(months × fitCost) — refits are ~60ms each.
 */
export function expandingFanTau(dates: string[], closes: number[]): FanTauPoint[] {
  const out: FanTauPoint[] = [];
  let lastMonth = '';
  for (let i = MIN_FIT_POINTS; i < dates.length; i++) {
    const month = dates[i].slice(0, 7); // YYYY-MM
    const isLast = i === dates.length - 1;
    if (month === lastMonth && !isLast) continue;
    lastMonth = month;
    const pt = fanTauAt(dates, closes, i);
    if (pt) out.push(pt);
  }
  return out;
}

/**
 * Expanding-window τ at a specific target date (nearest index ≤ date).
 * Used to report τ exactly at cycle tops.
 */
export function fanTauAtDate(
  dates: string[],
  closes: number[],
  targetDate: string
): FanTauPoint | null {
  let idx = -1;
  for (let i = 0; i < dates.length; i++) {
    if (dates[i] <= targetDate) idx = i;
    else break;
  }
  if (idx < 0) return null;
  return fanTauAt(dates, closes, idx);
}

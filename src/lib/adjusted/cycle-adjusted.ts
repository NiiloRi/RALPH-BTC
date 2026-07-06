/**
 * LAYER 1 — CYCLE-ADJUSTED RISK
 *
 * BTC cycle amplitude has structurally compressed (realized vol 102%→45%,
 * Mayer-at-top 5.7→1.4, quantile-fan Q99/Q50 11.7×→1.6×). Because the base
 * risk score (Layer 0) normalizes several components with FIXED constants
 * calibrated to 2011–2021 amplitudes, later cycle tops read lower on the
 * absolute scale (the Jan-2025 top registered only 59.7% vs 89–92% at the
 * 2013/2017/2021 tops). This layer answers a different question:
 *
 *   "How extreme is today RELATIVE TO WHAT THIS REGIME CAN PRODUCE?"
 *
 * Method: for the compression-sensitive, price-derived components
 * (valuation, momentum, volatility, attention) replace the raw component
 * value with its rank-percentile inside a trailing window (default 4y ≈ one
 * halving cycle). Keep `cycle` (a time-ramp — a rolling percentile of it is
 * meaningless) and `macro` (regime-level, not amplitude-level) RAW. Recompose
 * with the SAME weights and the SAME sigmoid calibration as Layer 0, then EMA
 * smooth identically.
 *
 * INVARIANT: this module only READS Layer 0. It never mutates the base score.
 *   It reuses Layer 0's exact primitives (sigmoid / clamp / smoothing /
 *   weights / calibration) imported from ../risk/model — Layer 0 stays frozen.
 *
 * HONESTY:
 * - Burn-in: the first BURN_IN valid points emit `adjusted: null` (never 0.5).
 * - Relativity artifact: after a long dull regime, mediocre readings can drift
 *   to high percentiles. Layer 0 must always be shown alongside; the
 *   divergence layer flags |L1−L0| > 25pp.
 * - Distribution-shape caveat: percentile-uniform components change the
 *   raw-ensemble distribution vs Layer 0, so reusing the same sigmoid is a
 *   pragmatic (empirically validated) choice, not a theoretically derived one.
 * - Walk-forward safe: every value at day t uses only data ≤ t (rolling window
 *   looks back; EMA is causal). Truncating future data does not change past
 *   values — enforced by test.
 */

import {
  DEFAULT_WEIGHTS,
  DEFAULT_CALIBRATION,
  sigmoid,
  clampRisk,
  applySmoothing,
} from '../risk/model';

/** Components re-expressed as trailing-window percentiles */
export const ADAPTIVE_KEYS = ['valuation', 'momentum', 'volatility', 'attention'] as const;
/** Components kept raw (time-ramp / regime-level) */
export const RAW_KEYS = ['cycle', 'macro'] as const;

export type ComponentKey =
  | 'valuation' | 'momentum' | 'volatility' | 'cycle' | 'macro' | 'attention';

/** Default trailing window: 4 years ≈ one halving cycle */
export const DEFAULT_WINDOW = 1460;
/** Minimum history before an adjusted value is emitted */
export const BURN_IN = 365;
/** EMA smoothing factor — identical to Layer 0 */
export const SMOOTHING = 0.3;

export interface AdjustedInput {
  date: string;
  /** Layer-0 smoothed risk (canonical absolute score) */
  smoothedRisk: number;
  components: Record<ComponentKey, number>;
}

export interface CycleAdjustedResult {
  date: string;
  /** Layer-0 passthrough (unchanged) */
  absolute: number;
  /** Layer-1 cycle-adjusted risk, or null during burn-in */
  adjusted: number | null;
  /** Pre-sigmoid recomposed score (debug), or null during burn-in */
  raw: number | null;
  /** Percentile used for each component (raw components report null) */
  perComponentPercentile: Record<ComponentKey, number | null>;
  burnIn: boolean;
  /** Actual number of observations in the trailing window at this point */
  windowUsed: number;
}

/**
 * Fraction of values in the trailing window [i−window+1 .. i] that are ≤
 * series[i]. Inclusive of i, ties counted as ≤ (so the current point counts
 * itself → result ∈ (0, 1]). Non-finite values in the window are skipped.
 * Returns 0.5 for a non-finite current value or an empty window.
 */
export function rollingPercentile(series: number[], i: number, window: number): number {
  const v = series[i];
  if (!Number.isFinite(v)) return 0.5;
  const start = Math.max(0, i - window + 1);
  let below = 0;
  let count = 0;
  for (let k = start; k <= i; k++) {
    if (!Number.isFinite(series[k])) continue;
    count++;
    if (series[k] <= v) below++;
  }
  return count > 0 ? below / count : 0.5;
}

/**
 * Single-day cycle-adjusted recomposition WITHOUT EMA smoothing.
 * Exposed for testing the core recomposition; the UI should use
 * calculateAllCycleAdjusted (which applies the causal EMA like Layer 0).
 * Returns null during burn-in or on non-finite base risk.
 */
export function calculateCycleAdjustedRaw(
  risks: AdjustedInput[],
  i: number,
  window: number = DEFAULT_WINDOW
): { raw: number; adjusted: number; perComponentPercentile: Record<ComponentKey, number | null> } | null {
  if (i < BURN_IN || i >= risks.length) return null;
  if (!Number.isFinite(risks[i].smoothedRisk)) return null;

  const pcp = {} as Record<ComponentKey, number | null>;
  let raw = 0;

  for (const key of ADAPTIVE_KEYS) {
    const series: number[] = [];
    for (let k = 0; k <= i; k++) series.push(risks[k].components[key]);
    const p = rollingPercentile(series, i, window);
    pcp[key] = p;
    raw += (DEFAULT_WEIGHTS[key] ?? 0) * p;
  }
  for (const key of RAW_KEYS) {
    const v = risks[i].components[key];
    pcp[key] = null;
    raw += (DEFAULT_WEIGHTS[key] ?? 0) * (Number.isFinite(v) ? v : 0.5);
  }

  const adjusted = clampRisk(
    sigmoid(DEFAULT_CALIBRATION.slope * (raw - DEFAULT_CALIBRATION.center))
  );
  return { raw, adjusted, perComponentPercentile: pcp };
}

/**
 * Full cycle-adjusted series with causal EMA smoothing (mirrors Layer 0).
 * Precomputes component columns once, then rolling-percentile per day.
 */
export function calculateAllCycleAdjusted(
  risks: AdjustedInput[],
  window: number = DEFAULT_WINDOW
): CycleAdjustedResult[] {
  const n = risks.length;

  // Precompute adaptive component columns once
  const cols: Record<string, number[]> = {};
  for (const key of ADAPTIVE_KEYS) {
    cols[key] = risks.map(r => r.components[key]);
  }

  const out: CycleAdjustedResult[] = [];
  let prevAdj: number | undefined;

  for (let i = 0; i < n; i++) {
    const absolute = risks[i].smoothedRisk;

    const burnIn = i < BURN_IN || !Number.isFinite(absolute);
    if (burnIn) {
      const pcp = {} as Record<ComponentKey, number | null>;
      for (const k of [...ADAPTIVE_KEYS, ...RAW_KEYS]) pcp[k] = null;
      out.push({
        date: risks[i].date,
        absolute,
        adjusted: null,
        raw: null,
        perComponentPercentile: pcp,
        burnIn: true,
        windowUsed: Math.min(window, i + 1),
      });
      continue;
    }

    const pcp = {} as Record<ComponentKey, number | null>;
    let raw = 0;
    for (const key of ADAPTIVE_KEYS) {
      const p = rollingPercentile(cols[key], i, window);
      pcp[key] = p;
      raw += (DEFAULT_WEIGHTS[key] ?? 0) * p;
    }
    for (const key of RAW_KEYS) {
      const v = risks[i].components[key];
      pcp[key] = null;
      raw += (DEFAULT_WEIGHTS[key] ?? 0) * (Number.isFinite(v) ? v : 0.5);
    }

    const unsmoothed = clampRisk(
      sigmoid(DEFAULT_CALIBRATION.slope * (raw - DEFAULT_CALIBRATION.center))
    );
    const adjusted =
      prevAdj === undefined ? unsmoothed : clampRisk(applySmoothing(unsmoothed, prevAdj, SMOOTHING));
    prevAdj = adjusted;

    out.push({
      date: risks[i].date,
      absolute,
      adjusted,
      raw,
      perComponentPercentile: pcp,
      burnIn: false,
      windowUsed: Math.min(window, i + 1),
    });
  }

  return out;
}

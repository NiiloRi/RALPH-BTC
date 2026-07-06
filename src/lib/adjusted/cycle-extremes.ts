/**
 * LAYER 2 (score-space) — PER-CYCLE EXTREMES TABLE
 *
 * For each historical halving cycle, the observed max risk near its price top
 * and min risk near its bottom, on BOTH the absolute (L0) and cycle-adjusted
 * (L1) scales. A robust Theil-Sen trend across cycles quantifies the decay of
 * the absolute scale and (ideally) the stability of the adjusted scale.
 *
 * HONESTY — this is the WEAK sub-estimate of "expected current-cycle range":
 * n is at most 4. It must be rendered "N observations — indicative only" and
 * NEVER as a point prediction ("next top = X%"). Anchor dates come from
 * HISTORICAL_CYCLES (known cycle events — legitimate inputs); every risk
 * number here is computed from the input series, none hardcoded.
 *
 * Read-only.
 */

import { HISTORICAL_CYCLES } from '../features/cycle';
import type { CycleAdjustedResult } from './cycle-adjusted';

/** ±window (days) around an anchor date to search for the extreme */
export const EXTREME_WINDOW_DAYS = 60;
/** Theil-Sen refuses to fit fewer than this many observations */
export const MIN_TREND_POINTS = 3;

export interface CycleExtreme {
  cycleIndex: number;
  label: string;
  anchorDate: string;
  kind: 'top' | 'bottom';
  /** Extreme of the absolute (L0) score in-window, or null if no data */
  absolute: number | null;
  /** Extreme of the cycle-adjusted (L1) score in-window, or null */
  adjusted: number | null;
  /** Number of in-window days that contributed */
  sampleDays: number;
}

export interface TrendResult {
  /** Risk-score change per cycle (Theil-Sen), or null if n < MIN_TREND_POINTS */
  slopePerCycle: number | null;
  /** Theil-Sen intercept in cycle-ordinal space, or null */
  intercept: number | null;
  n: number;
  note: string;
}

export interface CycleExtremesReport {
  tops: CycleExtreme[];
  bottoms: CycleExtreme[];
  trends: {
    absoluteTop: TrendResult;
    adjustedTop: TrendResult;
    absoluteBottom: TrendResult;
    adjustedBottom: TrendResult;
  };
}

const MS_PER_DAY = 86_400_000;

/** Extreme (max for tops, min for bottoms) of a value selector within ±window of anchor. */
function windowExtreme(
  series: CycleAdjustedResult[],
  anchorDate: string,
  windowDays: number,
  kind: 'top' | 'bottom',
  select: (r: CycleAdjustedResult) => number | null
): { value: number | null; sampleDays: number } {
  const anchor = new Date(anchorDate).getTime();
  let best: number | null = null;
  let sampleDays = 0;
  for (const r of series) {
    const t = new Date(r.date).getTime();
    if (Math.abs(t - anchor) > windowDays * MS_PER_DAY) continue;
    const v = select(r);
    if (v === null || !Number.isFinite(v)) continue;
    sampleDays++;
    if (best === null) best = v;
    else best = kind === 'top' ? Math.max(best, v) : Math.min(best, v);
  }
  return { value: best, sampleDays };
}

/** Median of a numeric array (empty → NaN). */
function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Theil-Sen robust line fit over (x, y) points. x = cycle ordinal (0,1,2,…).
 * Refuses (slope null) when fewer than MIN_TREND_POINTS observations.
 */
export function theilSen(points: { x: number; y: number }[]): TrendResult {
  const n = points.length;
  if (n < MIN_TREND_POINTS) {
    return {
      slopePerCycle: null,
      intercept: null,
      n,
      note: `insufficient data (n=${n} < ${MIN_TREND_POINTS})`,
    };
  }
  const slopes: number[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = points[j].x - points[i].x;
      if (dx !== 0) slopes.push((points[j].y - points[i].y) / dx);
    }
  }
  const slope = median(slopes);
  const intercept = median(points.map(p => p.y - slope * p.x));
  return {
    slopePerCycle: slope,
    intercept,
    n,
    note: `${n} observations — indicative only, not a prediction`,
  };
}

/**
 * Build the per-cycle extremes report from a cycle-adjusted series.
 * Cycles whose anchor window contains no data are recorded with null extremes
 * and excluded from the trend fits.
 */
export function buildCycleExtremes(
  series: CycleAdjustedResult[],
  windowDays: number = EXTREME_WINDOW_DAYS
): CycleExtremesReport {
  const tops: CycleExtreme[] = [];
  const bottoms: CycleExtreme[] = [];

  HISTORICAL_CYCLES.forEach((cyc, cycleIndex) => {
    const topYear = new Date(cyc.highDate).getUTCFullYear();
    const botYear = new Date(cyc.lowDate).getUTCFullYear();

    const topAbs = windowExtreme(series, cyc.highDate, windowDays, 'top', r => r.absolute);
    const topAdj = windowExtreme(series, cyc.highDate, windowDays, 'top', r => r.adjusted);
    tops.push({
      cycleIndex,
      label: `${topYear} top`,
      anchorDate: cyc.highDate,
      kind: 'top',
      absolute: topAbs.value,
      adjusted: topAdj.value,
      sampleDays: Math.max(topAbs.sampleDays, topAdj.sampleDays),
    });

    const botAbs = windowExtreme(series, cyc.lowDate, windowDays, 'bottom', r => r.absolute);
    const botAdj = windowExtreme(series, cyc.lowDate, windowDays, 'bottom', r => r.adjusted);
    bottoms.push({
      cycleIndex,
      label: `${botYear} bottom`,
      anchorDate: cyc.lowDate,
      kind: 'bottom',
      absolute: botAbs.value,
      adjusted: botAdj.value,
      sampleDays: Math.max(botAbs.sampleDays, botAdj.sampleDays),
    });
  });

  // Trend fits over observed extremes only. x = sequential ordinal among the
  // observed (non-null) extremes, so gaps from out-of-range cycles don't skew it.
  const fit = (rows: CycleExtreme[], key: 'absolute' | 'adjusted'): TrendResult => {
    const pts = rows
      .filter(r => r[key] !== null)
      .map((r, i) => ({ x: i, y: r[key] as number }));
    return theilSen(pts);
  };

  return {
    tops,
    bottoms,
    trends: {
      absoluteTop: fit(tops, 'absolute'),
      adjustedTop: fit(tops, 'adjusted'),
      absoluteBottom: fit(bottoms, 'absolute'),
      adjustedBottom: fit(bottoms, 'adjusted'),
    },
  };
}

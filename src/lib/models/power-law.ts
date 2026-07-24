/**
 * POWER LAW valuation model (display layer).
 *
 *   ln(P) = a + b · ln(daysSinceGenesis)
 *
 * Fit: closed-form OLS on the full daily price history. Bands: residual
 * quantiles (5th/95th percentile of ln-residuals) as parallel offsets —
 * by construction ~90% of the fitted sample's daily closes lie between
 * support and resistance (an IN-SAMPLE coverage statement, not a forecast
 * interval). Reference: Santostasi's power law P = A·days^5.8 with the
 * ÷3/×3 support/resistance convention — cited in docs/valuation-models.md,
 * not hardcoded; we report our own fitted parameters instead.
 *
 * NOTE: src/lib/features/valuation.ts (a=5.82, b=-41.0) and riskFormula.ts
 * carry FROZEN Layer-0 power-law parameterizations used by the risk score.
 * This module is display-only and must never be reconciled with them.
 */

import { GENESIS_DATE } from '../types';

const MS_PER_DAY = 86_400_000;
const MIN_POINTS = 100;

export interface PowerLawModel {
  /** ln(P) = a + b·ln(days) */
  a: number;
  b: number;
  /** 5th/95th percentile of ln-residuals (log space) */
  residQ05: number;
  residQ95: number;
  /**
   * Extreme ln-residuals — ENVELOPE offsets (Santostasi/bitbo-style corridor):
   * parallel lines through the single lowest/highest observation vs the fit,
   * i.e. they touch the historical cycle floor/ceiling by construction.
   */
  residMin: number;
  residMax: number;
  r2: number;
  fittedN: number;
  fittedRange: { start: string; end: string };
}

export function daysSinceGenesis(date: string): number {
  return (new Date(date).getTime() - GENESIS_DATE.getTime()) / MS_PER_DAY;
}

/** Sorted-array quantile with linear interpolation. */
function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function fitPowerLaw(dates: string[], prices: number[]): PowerLawModel {
  const xs: number[] = [];
  const ys: number[] = [];
  const kept: number[] = [];
  for (let i = 0; i < dates.length; i++) {
    const days = daysSinceGenesis(dates[i]);
    const p = prices[i];
    if (!Number.isFinite(p) || p <= 0 || days < 1) continue;
    xs.push(Math.log(days));
    ys.push(Math.log(p));
    kept.push(i);
  }
  const n = xs.length;
  if (n < MIN_POINTS) {
    throw new Error(`fitPowerLaw: need >= ${MIN_POINTS} valid points, got ${n}`);
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

  const residuals: number[] = [];
  let ssRes = 0, ssTot = 0;
  const yMean = sy / n;
  for (let i = 0; i < n; i++) {
    const r = ys[i] - (a + b * xs[i]);
    residuals.push(r);
    ssRes += r * r;
    ssTot += (ys[i] - yMean) * (ys[i] - yMean);
  }
  residuals.sort((p, q) => p - q);

  return {
    a,
    b,
    residQ05: quantile(residuals, 0.05),
    residQ95: quantile(residuals, 0.95),
    residMin: residuals[0],
    residMax: residuals[residuals.length - 1],
    r2: ssTot > 0 ? 1 - ssRes / ssTot : 1,
    fittedN: n,
    fittedRange: { start: dates[kept[0]], end: dates[kept[kept.length - 1]] },
  };
}

/** Works for any date incl. future ones (pure function of time). */
export function evaluatePowerLaw(
  m: PowerLawModel,
  date: string
): {
  fair: number;
  support: number;
  resistance: number;
  /** Envelope corridor — touches the historical cycle floor/ceiling */
  envelopeFloor: number;
  envelopeCeiling: number;
} {
  const days = Math.max(1, daysSinceGenesis(date));
  const fair = Math.exp(m.a + m.b * Math.log(days));
  return {
    fair,
    support: fair * Math.exp(m.residQ05),
    resistance: fair * Math.exp(m.residQ95),
    envelopeFloor: fair * Math.exp(m.residMin),
    envelopeCeiling: fair * Math.exp(m.residMax),
  };
}

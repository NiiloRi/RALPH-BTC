/**
 * Asymmetric quantile regression fan for BTC.
 *
 * Recreates the "Bitcoin Tail Risk and Asymmetric Quantile Dynamics"
 * Figure-1 style chart: quadratic quantile regression of ln(price) on
 * ln(days since genesis), fit independently at each quantile level with
 * pinball loss, then rearranged (Chernozhukov-style, pointwise sort) so
 * the quantile curves cannot cross.
 *
 *   ln(P_τ)(t) = β0(τ) + β1(τ)·z + β2(τ)·z²,   z = standardized ln(t)
 *
 * The "asymmetric" property is an empirical outcome, not an assumption:
 * the fitted upper-tail curvature β2(0.99) is more negative than the
 * lower-tail curvature β2(0.01), so the upper fan narrows over time
 * (diminishing blow-off tops) while the floor decays more slowly.
 *
 * HONESTY NOTES (also surfaced in the UI):
 * - This is a FULL-SAMPLE descriptive fit. Every band position uses all
 *   history, including data that is "future" relative to any past date
 *   shown. It is context, not a walk-forward signal and not a forecast.
 * - The model is refit from scratch on whatever price series is passed in.
 * - Solver: iteratively reweighted least squares on the pinball objective
 *   with best-iterate tracking — deterministic, no randomness.
 */

import { GENESIS_DATE } from '../types';

export const DEFAULT_QUANTILES = [0.01, 0.1, 0.25, 0.5, 0.75, 0.95, 0.99];

/**
 * Historical intraday-wick dislocation reference levels BELOW the Q1 band,
 * as discussed in the paper (fractions below the fitted 1st percentile).
 * These are static literature values, NOT derived from our fit — our daily
 * data cannot reproduce pre-2017 intraday wicks (close-only reconstruction).
 */
export const WICK_DISLOCATIONS: { pct: number; label: string }[] = [
  { pct: 0.0735, label: 'Nov 2022 wick' },
  { pct: 0.174, label: 'Mar 2020 wick' },
  { pct: 0.226, label: 'Aug 2015 wick' },
  { pct: 0.346, label: 'Aug 2010 wick' },
];

export interface QuantileFanModel {
  /** Ascending quantile levels, e.g. [0.01, ..., 0.99] */
  quantiles: number[];
  /** Per-quantile coefficients [b0, b1, b2] in standardized-z space */
  betas: number[][];
  /** Standardization of x = ln(daysSinceGenesis) */
  xMean: number;
  xStd: number;
  /** Mean pinball loss per quantile (fit diagnostics) */
  losses: number[];
  fittedN: number;
  fittedRange: { start: string; end: string };
}

const MS_PER_DAY = 86_400_000;
const MIN_POINTS = 100;

function daysSinceGenesis(dateStr: string): number {
  return (new Date(dateStr).getTime() - GENESIS_DATE.getTime()) / MS_PER_DAY;
}

/** Mean pinball (check) loss for residuals r = y − ŷ at level τ */
export function pinballLoss(residuals: number[], tau: number): number {
  let sum = 0;
  for (const r of residuals) {
    sum += r >= 0 ? tau * r : (tau - 1) * r;
  }
  return sum / Math.max(1, residuals.length);
}

/** Solve a symmetric 3×3 system A·x = b via Gaussian elimination with partial pivoting */
function solve3x3(A: number[][], b: number[]): number[] | null {
  const M = [
    [A[0][0], A[0][1], A[0][2], b[0]],
    [A[1][0], A[1][1], A[1][2], b[1]],
    [A[2][0], A[2][1], A[2][2], b[2]],
  ];
  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let r = col + 1; r < 3; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    if (Math.abs(M[pivot][col]) < 1e-12) return null;
    if (pivot !== col) [M[col], M[pivot]] = [M[pivot], M[col]];
    for (let r = col + 1; r < 3; r++) {
      const f = M[r][col] / M[col][col];
      for (let c = col; c < 4; c++) M[r][c] -= f * M[col][c];
    }
  }
  const x = [0, 0, 0];
  for (let r = 2; r >= 0; r--) {
    let s = M[r][3];
    for (let c = r + 1; c < 3; c++) s -= M[r][c] * x[c];
    x[r] = s / M[r][r];
  }
  return x;
}

/** Weighted least squares on basis [1, z, z²]: returns [b0, b1, b2] */
function weightedQuadFit(z: number[], y: number[], w: number[]): number[] | null {
  // Accumulate XᵀWX (symmetric) and XᵀWy
  let s00 = 0, s01 = 0, s02 = 0, s11 = 0, s12 = 0, s22 = 0;
  let t0 = 0, t1 = 0, t2 = 0;
  for (let i = 0; i < z.length; i++) {
    const zi = z[i];
    const z2 = zi * zi;
    const wi = w[i];
    s00 += wi;
    s01 += wi * zi;
    s02 += wi * z2;
    s11 += wi * z2;
    s12 += wi * zi * z2;
    s22 += wi * z2 * z2;
    t0 += wi * y[i];
    t1 += wi * zi * y[i];
    t2 += wi * z2 * y[i];
  }
  const ridge = 1e-9 * (s00 || 1);
  return solve3x3(
    [
      [s00 + ridge, s01, s02],
      [s01, s11 + ridge, s12],
      [s02, s12, s22 + ridge],
    ],
    [t0, t1, t2]
  );
}

function predict(beta: number[], zi: number): number {
  return beta[0] + beta[1] * zi + beta[2] * zi * zi;
}

/**
 * Fit one quantile level via IRLS on the pinball objective.
 * Deterministic; tracks and returns the best iterate by loss.
 */
export function fitQuantileIRLS(
  z: number[],
  y: number[],
  tau: number,
  maxIter: number = 200
): { beta: number[]; loss: number } {
  const n = z.length;
  const EPS = 1e-6;

  // Init: unweighted (OLS) fit
  let beta = weightedQuadFit(z, y, new Array(n).fill(1));
  if (!beta) throw new Error('quantile-fan: singular design matrix');

  const residuals = new Array<number>(n);
  const computeLoss = (b: number[]) => {
    for (let i = 0; i < n; i++) residuals[i] = y[i] - predict(b, z[i]);
    return pinballLoss(residuals, tau);
  };

  let bestBeta = beta.slice();
  let bestLoss = computeLoss(beta);
  let prevLoss = bestLoss;

  const w = new Array<number>(n);
  for (let iter = 0; iter < maxIter; iter++) {
    for (let i = 0; i < n; i++) {
      const r = y[i] - predict(beta, z[i]);
      w[i] = (r >= 0 ? tau : 1 - tau) / Math.max(Math.abs(r), EPS);
    }
    const next = weightedQuadFit(z, y, w);
    if (!next) break;
    // Mild damping stabilizes the LAD-style oscillation
    beta = [
      0.3 * beta[0] + 0.7 * next[0],
      0.3 * beta[1] + 0.7 * next[1],
      0.3 * beta[2] + 0.7 * next[2],
    ];
    const loss = computeLoss(beta);
    if (loss < bestLoss) {
      bestLoss = loss;
      bestBeta = beta.slice();
    }
    if (Math.abs(prevLoss - loss) < 1e-12) break;
    prevLoss = loss;
  }

  return { beta: bestBeta, loss: bestLoss };
}

/**
 * Fit the full fan on a daily price series.
 * @param dates ISO dates (YYYY-MM-DD), ascending
 * @param prices positive daily closes, same length
 */
export function fitQuantileFan(
  dates: string[],
  prices: number[],
  quantiles: number[] = DEFAULT_QUANTILES
): QuantileFanModel {
  if (dates.length !== prices.length) {
    throw new Error('quantile-fan: dates/prices length mismatch');
  }

  // Build regression arrays, skipping invalid rows
  const xs: number[] = [];
  const ys: number[] = [];
  let start = '';
  let end = '';
  for (let i = 0; i < dates.length; i++) {
    const p = prices[i];
    const t = daysSinceGenesis(dates[i]);
    if (!Number.isFinite(p) || p <= 0 || !Number.isFinite(t) || t < 1) continue;
    xs.push(Math.log(t));
    ys.push(Math.log(p));
    if (!start) start = dates[i];
    end = dates[i];
  }
  if (xs.length < MIN_POINTS) {
    throw new Error(`quantile-fan: need ≥${MIN_POINTS} valid points, got ${xs.length}`);
  }

  // Standardize x for numerical conditioning
  const xMean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const xVar = xs.reduce((s, v) => s + (v - xMean) ** 2, 0) / (xs.length - 1);
  const xStd = Math.sqrt(xVar) || 1;
  const z = xs.map(v => (v - xMean) / xStd);

  const sortedQ = [...quantiles].sort((a, b) => a - b);
  const betas: number[][] = [];
  const losses: number[] = [];
  for (const tau of sortedQ) {
    const { beta, loss } = fitQuantileIRLS(z, ys, tau);
    betas.push(beta);
    losses.push(loss);
  }

  return {
    quantiles: sortedQ,
    betas,
    xMean,
    xStd,
    losses,
    fittedN: xs.length,
    fittedRange: { start, end },
  };
}

/**
 * Evaluate the fan at a date. Returns PRICES per quantile level,
 * rearranged (sorted ascending) so curves never cross.
 */
export function evaluateFan(model: QuantileFanModel, dateStr: string): number[] {
  const t = daysSinceGenesis(dateStr);
  const tc = Math.max(1, t);
  const zi = (Math.log(tc) - model.xMean) / model.xStd;
  const values = model.betas.map(b => Math.exp(predict(b, zi)));
  // Rearrangement: pointwise sort maps monotonically onto ascending τ
  values.sort((a, b) => a - b);
  return values;
}

export interface ImpliedQuantile {
  /** Interpolated quantile level of the price within the fan, or null outside */
  tau: number | null;
  belowMin: boolean;
  aboveMax: boolean;
  label: string;
}

/**
 * Where does a price sit inside the fan on a given date?
 * Linear interpolation of τ in log-price space between bracketing bands.
 */
export function impliedQuantile(
  model: QuantileFanModel,
  dateStr: string,
  price: number
): ImpliedQuantile {
  const q = evaluateFan(model, dateStr);
  const taus = model.quantiles;
  const qMinPct = (taus[0] * 100).toFixed(0);
  const qMaxPct = (taus[taus.length - 1] * 100).toFixed(0);

  if (!Number.isFinite(price) || price <= 0) {
    return { tau: null, belowMin: false, aboveMax: false, label: 'n/a' };
  }
  if (price < q[0]) {
    return { tau: null, belowMin: true, aboveMax: false, label: `< Q${qMinPct}` };
  }
  if (price > q[q.length - 1]) {
    return { tau: null, belowMin: false, aboveMax: true, label: `> Q${qMaxPct}` };
  }
  for (let i = 0; i < q.length - 1; i++) {
    if (price >= q[i] && price <= q[i + 1]) {
      const lo = Math.log(q[i]);
      const hi = Math.log(q[i + 1]);
      const f = hi - lo < 1e-12 ? 0 : (Math.log(price) - lo) / (hi - lo);
      const tau = taus[i] + f * (taus[i + 1] - taus[i]);
      return { tau, belowMin: false, aboveMax: false, label: `~Q${(tau * 100).toFixed(0)}` };
    }
  }
  return { tau: null, belowMin: false, aboveMax: false, label: 'n/a' };
}

/**
 * Tail-curvature asymmetry diagnostic: β2 at the highest vs lowest τ,
 * in standardized-z space (comparable across quantiles).
 * upper < lower (more negative) ⇒ the upper fan narrows — the paper's
 * headline asymmetry.
 */
export function curvatureAsymmetry(model: QuantileFanModel): {
  upper: number;
  lower: number;
  isAsymmetric: boolean;
} {
  const upper = model.betas[model.betas.length - 1][2];
  const lower = model.betas[0][2];
  return { upper, lower, isAsymmetric: upper < lower };
}

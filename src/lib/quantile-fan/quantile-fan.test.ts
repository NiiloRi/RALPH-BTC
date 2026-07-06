import { describe, it, expect } from 'vitest';
import {
  fitQuantileFan,
  evaluateFan,
  impliedQuantile,
  pinballLoss,
  curvatureAsymmetry,
  DEFAULT_QUANTILES,
  WICK_DISLOCATIONS,
} from './quantile-fan';

/** Deterministic PRNG (mulberry32) so coverage tests can't be flaky */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Build a synthetic daily series: ln P = a + b·ln t + c·(ln t)² + noise */
function syntheticSeries(opts: {
  n: number;
  a: number;
  b: number;
  c: number;
  noise: (rng: () => number) => number;
  seed?: number;
}): { dates: string[]; prices: number[] } {
  const rng = mulberry32(opts.seed ?? 42);
  const dates: string[] = [];
  const prices: number[] = [];
  const start = new Date('2011-06-01').getTime();
  for (let i = 0; i < opts.n; i++) {
    const d = new Date(start + i * 86400000);
    const dateStr = d.toISOString().split('T')[0];
    const t = (d.getTime() - new Date('2009-01-03').getTime()) / 86400000;
    const x = Math.log(t);
    const lnP = opts.a + opts.b * x + opts.c * x * x + opts.noise(rng);
    dates.push(dateStr);
    prices.push(Math.exp(lnP));
  }
  return { dates, prices };
}

describe('pinballLoss', () => {
  it('is zero for zero residuals and positive otherwise', () => {
    expect(pinballLoss([0, 0, 0], 0.5)).toBe(0);
    expect(pinballLoss([1, -1], 0.5)).toBeGreaterThan(0);
  });

  it('penalizes under-prediction more at high tau', () => {
    // residual r = y - ŷ > 0 means we predicted too low
    expect(pinballLoss([1], 0.9)).toBeGreaterThan(pinballLoss([1], 0.1));
    expect(pinballLoss([-1], 0.9)).toBeLessThan(pinballLoss([-1], 0.1));
  });
});

describe('fitQuantileFan on noiseless data', () => {
  it('median curve recovers the true quadratic almost exactly', () => {
    const { dates, prices } = syntheticSeries({
      n: 1500, a: -30, b: 9, c: -0.45, noise: () => 0,
    });
    const model = fitQuantileFan(dates, prices, [0.5]);
    for (const i of [0, 500, 1000, 1499]) {
      const [q50] = evaluateFan(model, dates[i]);
      expect(q50 / prices[i]).toBeGreaterThan(0.995);
      expect(q50 / prices[i]).toBeLessThan(1.005);
    }
  });
});

describe('fitQuantileFan coverage (the correctness property)', () => {
  // Asymmetric heteroskedastic noise — harder than gaussian
  const { dates, prices } = syntheticSeries({
    n: 2500, a: -30, b: 9, c: -0.45, seed: 7,
    noise: rng => {
      const u = rng();
      // mixture: mostly mild, occasional big upside spikes (bubble-ish)
      return u < 0.85 ? (rng() - 0.5) * 0.8 : rng() * 2.2;
    },
  });
  const model = fitQuantileFan(dates, prices);

  it('each τ-curve leaves ≈τ of the data below it', () => {
    const below: number[] = model.quantiles.map(() => 0);
    for (let i = 0; i < dates.length; i++) {
      const q = evaluateFan(model, dates[i]);
      for (let k = 0; k < q.length; k++) {
        if (prices[i] <= q[k]) below[k]++;
      }
    }
    for (let k = 0; k < model.quantiles.length; k++) {
      const frac = below[k] / dates.length;
      const tau = model.quantiles[k];
      const tol = tau <= 0.05 || tau >= 0.95 ? 0.03 : 0.05;
      expect(Math.abs(frac - tau)).toBeLessThan(tol);
    }
  });

  it('curves never cross anywhere on the fitted range (rearrangement)', () => {
    for (let i = 0; i < dates.length; i += 25) {
      const q = evaluateFan(model, dates[i]);
      for (let k = 1; k < q.length; k++) {
        expect(q[k]).toBeGreaterThanOrEqual(q[k - 1]);
      }
    }
  });

  it('all fan values are finite and positive, including forward extrapolation', () => {
    const q = evaluateFan(model, '2027-06-01');
    for (const v of q) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThan(0);
    }
  });

  it('is deterministic: refitting gives identical coefficients', () => {
    const model2 = fitQuantileFan(dates, prices);
    expect(model2.betas).toEqual(model.betas);
  });
});

describe('impliedQuantile', () => {
  const { dates, prices } = syntheticSeries({
    n: 1200, a: -30, b: 9, c: -0.45, seed: 3,
    noise: rng => (rng() - 0.5) * 0.9,
  });
  const model = fitQuantileFan(dates, prices);
  const day = dates[900];
  const fan = evaluateFan(model, day);

  it('price exactly on the median band reads ~Q50', () => {
    const q50Idx = model.quantiles.indexOf(0.5);
    const r = impliedQuantile(model, day, fan[q50Idx]);
    expect(r.tau).not.toBeNull();
    expect(Math.abs((r.tau as number) - 0.5)).toBeLessThan(0.01);
  });

  it('price below the lowest band reports belowMin with < Q1 label', () => {
    const r = impliedQuantile(model, day, fan[0] * 0.5);
    expect(r.belowMin).toBe(true);
    expect(r.label).toBe('< Q1');
  });

  it('price above the highest band reports aboveMax', () => {
    const r = impliedQuantile(model, day, fan[fan.length - 1] * 2);
    expect(r.aboveMax).toBe(true);
    expect(r.label).toBe('> Q99');
  });

  it('interpolated tau is monotonic in price', () => {
    const p1 = impliedQuantile(model, day, fan[1] * 1.05).tau as number;
    const p2 = impliedQuantile(model, day, fan[2] * 1.05).tau as number;
    expect(p2).toBeGreaterThan(p1);
  });

  it('handles invalid price', () => {
    expect(impliedQuantile(model, day, NaN).label).toBe('n/a');
    expect(impliedQuantile(model, day, -5).label).toBe('n/a');
  });
});

describe('input guards', () => {
  it('rejects too-few points', () => {
    const { dates, prices } = syntheticSeries({ n: 50, a: -30, b: 9, c: -0.45, noise: () => 0 });
    expect(() => fitQuantileFan(dates, prices)).toThrow(/need/);
  });

  it('rejects length mismatch', () => {
    expect(() => fitQuantileFan(['2020-01-01'], [1, 2])).toThrow(/mismatch/);
  });

  it('skips non-positive and non-finite prices', () => {
    const { dates, prices } = syntheticSeries({
      n: 300, a: -30, b: 9, c: -0.45, seed: 9, noise: rng => (rng() - 0.5) * 0.5,
    });
    prices[10] = 0;
    prices[20] = -4;
    prices[30] = NaN;
    const model = fitQuantileFan(dates, prices);
    expect(model.fittedN).toBe(297);
    for (const b of model.betas) {
      for (const v of b) expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe('structure', () => {
  it('default quantiles are the paper set, ascending', () => {
    expect(DEFAULT_QUANTILES).toEqual([0.01, 0.1, 0.25, 0.5, 0.75, 0.95, 0.99]);
  });

  it('wick dislocations are the four paper reference levels', () => {
    expect(WICK_DISLOCATIONS.map(w => w.pct)).toEqual([0.0735, 0.174, 0.226, 0.346]);
  });

  it('curvatureAsymmetry compares top vs bottom quantile curvature', () => {
    const { dates, prices } = syntheticSeries({
      n: 800, a: -30, b: 9, c: -0.45, seed: 5, noise: rng => (rng() - 0.5),
    });
    const model = fitQuantileFan(dates, prices);
    const asym = curvatureAsymmetry(model);
    expect(Number.isFinite(asym.upper)).toBe(true);
    expect(Number.isFinite(asym.lower)).toBe(true);
  });
});

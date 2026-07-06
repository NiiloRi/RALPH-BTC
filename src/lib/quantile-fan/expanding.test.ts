import { describe, it, expect } from 'vitest';
import { fanTauAt, fanTauAtDate, expandingFanTau, MIN_FIT_POINTS } from './expanding';

/** Deterministic power-law-ish daily series with mild noise */
function series(n: number, seed = 5): { dates: string[]; closes: number[] } {
  let a = seed >>> 0;
  const rng = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const dates: string[] = [];
  const closes: number[] = [];
  const start = Date.UTC(2013, 0, 1);
  for (let i = 0; i < n; i++) {
    dates.push(new Date(start + i * 86400000).toISOString().split('T')[0]);
    const t = i + 800; // days since a pseudo-genesis
    const lnP = -18 + 5.5 * Math.log(t) + (rng() - 0.5) * 0.8;
    closes.push(Math.exp(lnP));
  }
  return { dates, closes };
}

describe('fanTauAt', () => {
  it('returns null before MIN_FIT_POINTS', () => {
    const { dates, closes } = series(400);
    expect(fanTauAt(dates, closes, MIN_FIT_POINTS - 1)).toBeNull();
  });

  it('returns finite bands and a tau in [0,1] (or null when outside)', () => {
    const { dates, closes } = series(600);
    const pt = fanTauAt(dates, closes, 599)!;
    expect(pt).not.toBeNull();
    expect(pt.q01).toBeLessThan(pt.q50);
    expect(pt.q50).toBeLessThan(pt.q99);
    if (pt.tau !== null) {
      expect(pt.tau).toBeGreaterThanOrEqual(0);
      expect(pt.tau).toBeLessThanOrEqual(1);
    }
  });
});

describe('expanding-window causality (walk-forward safety)', () => {
  it('tau at date t does not change when future data is appended', () => {
    const { dates, closes } = series(700);
    for (const t of [300, 450, 699]) {
      const short = fanTauAt(dates.slice(0, t + 1), closes.slice(0, t + 1), t);
      const long = fanTauAt(dates, closes, t); // same slice internally
      expect(short).not.toBeNull();
      expect(short!.date).toBe(dates[t]);
      // fanTauAt only ever fits closes[0..t]; appending future data is a no-op
      expect(short!.tau).toBeCloseTo(long!.tau ?? -1, 12);
      expect(short!.q50).toBeCloseTo(long!.q50, 6);
    }
  });

  it('is deterministic across repeated runs', () => {
    const { dates, closes } = series(500);
    expect(fanTauAt(dates, closes, 499)).toEqual(fanTauAt(dates, closes, 499));
  });
});

describe('expandingFanTau grid', () => {
  it('produces roughly one point per month, all causal and bounded', () => {
    const { dates, closes } = series(400); // ~13 months past warmup
    const grid = expandingFanTau(dates, closes);
    expect(grid.length).toBeGreaterThan(3);
    // strictly increasing dates; ~one per month (the forced final point may
    // share a month with the prior monthly point, hence >= length - 1)
    for (let i = 1; i < grid.length; i++) {
      expect(grid[i].date > grid[i - 1].date).toBe(true);
    }
    const months = new Set(grid.map(g => g.date.slice(0, 7)));
    expect(months.size).toBeGreaterThanOrEqual(grid.length - 1);
    for (const g of grid) {
      expect(g.q01).toBeLessThan(g.q99);
      expect(Number.isFinite(g.q50)).toBe(true);
    }
  });

  it('the final grid point equals a direct fit at the last index', () => {
    const { dates, closes } = series(365);
    const grid = expandingFanTau(dates, closes);
    const direct = fanTauAt(dates, closes, dates.length - 1)!;
    const last = grid[grid.length - 1];
    expect(last.date).toBe(direct.date);
    expect(last.tau).toBeCloseTo(direct.tau ?? -1, 12);
  });
});

describe('fanTauAtDate', () => {
  it('resolves the nearest index at or before the target date', () => {
    const { dates, closes } = series(500);
    const target = dates[400];
    const pt = fanTauAtDate(dates, closes, target)!;
    expect(pt.date).toBe(target);
  });

  it('returns null for a date before any data', () => {
    const { dates, closes } = series(300);
    expect(fanTauAtDate(dates, closes, '1999-01-01')).toBeNull();
  });
});

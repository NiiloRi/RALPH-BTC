import { describe, it, expect } from 'vitest';
import {
  calculateAllTopProximity,
  daysSinceCycleLow,
  topProximityLabel,
  defaultCycleLowDates,
  DD_REF,
  MIN_TOP_DAYS,
} from './top-proximity';

/** Build a daily series from monthly-ish anchors via linear interp is overkill;
 *  we just synthesize a controlled price path. */
function daily(from: string, prices: number[]): { date: string; price: number }[] {
  const start = new Date(from).getTime();
  return prices.map((price, i) => ({
    date: new Date(start + i * 86400000).toISOString().split('T')[0],
    price,
  }));
}

describe('daysSinceCycleLow', () => {
  const lows = ['2018-12-15', '2022-11-21'];
  it('uses the most recent low on or before the date', () => {
    expect(Math.round(daysSinceCycleLow('2021-11-10', lows))).toBe(1061);
    expect(Math.round(daysSinceCycleLow('2025-01-20', lows))).toBe(791);
  });
  it('returns 0 before any low', () => {
    expect(daysSinceCycleLow('2010-01-01', lows)).toBe(0);
  });
});

describe('calculateAllTopProximity — structure', () => {
  it('is 0 at (and below) DD_REF drawdown, 1 at ATH once in season', () => {
    // 800 flat days (to get past MIN_TOP_DAYS season), then a drawdown.
    const flat = new Array(800).fill(100);
    const series = daily('2020-01-01', [...flat, 100, 60]); // last: -40% from ATH 100
    const res = calculateAllTopProximity(series, ['2019-01-01']);
    const atHigh = res[799]; // day 800, at ATH, season≈1
    expect(atHigh.priceProx).toBeCloseTo(1);
    expect(atHigh.value).toBeGreaterThan(0.9);
    const deep = res[res.length - 1]; // -40% > DD_REF 35% → priceProx 0
    expect(deep.priceProx).toBe(0);
    expect(deep.value).toBe(0);
  });

  it('all values are finite and within [0,1]', () => {
    const series = daily('2019-01-01', Array.from({ length: 1200 }, (_, i) => 100 + 50 * Math.sin(i / 60)));
    for (const r of calculateAllTopProximity(series, ['2019-01-01'])) {
      for (const v of [r.value, r.priceProx, r.season]) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('is monotone non-increasing in drawdown (deeper ⇒ not higher)', () => {
    // rising then falling from a peak; once past the peak, value only falls
    const up = Array.from({ length: 900 }, (_, i) => 10 + i);
    const peak = up[up.length - 1];
    const down = Array.from({ length: 300 }, (_, i) => peak * (1 - i / 400));
    const res = calculateAllTopProximity(daily('2019-01-01', [...up, ...down]), ['2019-01-01']);
    for (let i = up.length + 1; i < res.length; i++) {
      expect(res[i].value).toBeLessThanOrEqual(res[i - 1].value + 1e-9);
    }
  });

  it('is causal: appending future data does not change past values', () => {
    const base = Array.from({ length: 900 }, (_, i) => 100 + i);
    const short = calculateAllTopProximity(daily('2019-01-01', base), ['2019-01-01']);
    const long = calculateAllTopProximity(daily('2019-01-01', [...base, 5000, 6000]), ['2019-01-01']);
    for (let i = 0; i < short.length; i++) {
      expect(long[i].value).toBeCloseTo(short[i].value, 12);
    }
  });

  it('handles non-finite prices without NaN', () => {
    const series = daily('2019-01-01', [100, NaN, 120, 90]);
    for (const r of calculateAllTopProximity(series, ['2019-01-01'])) {
      expect(Number.isFinite(r.value)).toBe(true);
    }
  });
});

describe('topProximityLabel', () => {
  it('maps ranges to honest labels', () => {
    expect(topProximityLabel(0.9)).toBe('near a cycle top');
    expect(topProximityLabel(0.6)).toContain('building');
    expect(topProximityLabel(0.3)).toBe('off the highs');
    expect(topProximityLabel(0.05)).toBe('far from a top');
  });
});

describe('constants', () => {
  it('DD_REF and MIN_TOP_DAYS are the documented values', () => {
    expect(DD_REF).toBe(0.35);
    expect(MIN_TOP_DAYS).toBe(700);
  });
  it('defaultCycleLowDates returns ascending confirmed lows', () => {
    const lows = defaultCycleLowDates();
    expect(lows.length).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < lows.length; i++) expect(lows[i] > lows[i - 1]).toBe(true);
  });
});

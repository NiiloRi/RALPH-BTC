import { describe, it, expect } from 'vitest';
import { theilSen, buildCycleExtremes, MIN_TREND_POINTS } from './cycle-extremes';
import { calculateAllCycleAdjusted, type AdjustedInput } from './cycle-adjusted';
import { HISTORICAL_CYCLES } from '../features/cycle';
import fixture from './__fixtures__/risk-series.json';

const FX_ROWS = (fixture as { rows: (string | number)[][] }).rows;
const RISKS: AdjustedInput[] = FX_ROWS.map(r => ({
  date: r[0] as string,
  smoothedRisk: r[1] as number,
  components: {
    valuation: r[2] as number, momentum: r[3] as number, volatility: r[4] as number,
    cycle: r[5] as number, macro: r[6] as number, attention: r[7] as number,
  },
}));

describe('theilSen', () => {
  it('refuses fewer than MIN_TREND_POINTS observations', () => {
    const r = theilSen([{ x: 0, y: 1 }, { x: 1, y: 2 }]);
    expect(r.slopePerCycle).toBeNull();
    expect(r.n).toBe(2);
    expect(r.note).toContain(`${MIN_TREND_POINTS}`);
  });

  it('recovers the slope of a clean line', () => {
    const pts = [0, 1, 2, 3, 4].map(x => ({ x, y: 2 * x + 1 }));
    const r = theilSen(pts);
    expect(r.slopePerCycle).toBeCloseTo(2);
    expect(r.intercept).toBeCloseTo(1);
  });

  it('is robust to a single mid-series outlier (median of pairwise slopes)', () => {
    // Five points on y=x with one gross outlier in the middle; the median of
    // the 10 pairwise slopes stays at the inlier slope of 1 (OLS would bend).
    const pts = [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 50 }, { x: 3, y: 3 }, { x: 4, y: 4 }];
    const r = theilSen(pts);
    expect(r.slopePerCycle!).toBeCloseTo(1, 5);
  });
});

describe('buildCycleExtremes on real served-model data', () => {
  const res = calculateAllCycleAdjusted(RISKS);
  const rep = buildCycleExtremes(res);

  it('produces one top and one bottom per historical cycle', () => {
    expect(rep.tops.length).toBe(HISTORICAL_CYCLES.length);
    expect(rep.bottoms.length).toBe(HISTORICAL_CYCLES.length);
  });

  it('records null for anchor windows outside the data range', () => {
    const t2011 = rep.tops.find(t => t.label === '2011 top')!;
    expect(t2011.absolute).toBeNull();
    expect(t2011.sampleDays).toBe(0);
  });

  it('captures the 2017 / 2021 / 2025 tops with data', () => {
    for (const yr of ['2017 top', '2021 top', '2025 top']) {
      const t = rep.tops.find(x => x.label === yr)!;
      expect(t.absolute).not.toBeNull();
      expect(t.adjusted).not.toBeNull();
      expect(t.sampleDays).toBeGreaterThan(60);
    }
  });

  it('all non-null extremes are finite and within [0,1]', () => {
    for (const e of [...rep.tops, ...rep.bottoms]) {
      for (const v of [e.absolute, e.adjusted]) {
        if (v === null) continue;
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('the absolute top scale DECAYS across cycles (the problem)', () => {
    expect(rep.trends.absoluteTop.slopePerCycle).not.toBeNull();
    expect(rep.trends.absoluteTop.slopePerCycle!).toBeLessThan(0);
    expect(rep.trends.absoluteTop.n).toBe(4);
  });

  it('the cycle-adjusted top scale decays LESS steeply (the fix works)', () => {
    // Both slopes negative; adjusted is less negative (flatter) than absolute.
    expect(rep.trends.adjustedTop.slopePerCycle!).toBeGreaterThan(
      rep.trends.absoluteTop.slopePerCycle!
    );
  });

  it('the 2025 top reads higher on the adjusted scale than the absolute scale', () => {
    const t = rep.tops.find(x => x.label === '2025 top')!;
    expect(t.adjusted!).toBeGreaterThan(t.absolute!);
  });

  it('adjusted bottoms are sharper (lower) than absolute bottoms', () => {
    for (const yr of ['2018 bottom', '2022 bottom']) {
      const b = rep.bottoms.find(x => x.label === yr)!;
      expect(b.adjusted!).toBeLessThan(b.absolute!);
    }
  });

  it('trend notes are honest about sample size', () => {
    expect(rep.trends.absoluteTop.note).toContain('indicative only');
  });
});

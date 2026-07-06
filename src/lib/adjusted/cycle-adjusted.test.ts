import { describe, it, expect } from 'vitest';
import {
  rollingPercentile,
  calculateAllCycleAdjusted,
  calculateCycleAdjustedRaw,
  ADAPTIVE_KEYS,
  RAW_KEYS,
  BURN_IN,
  DEFAULT_WINDOW,
  type AdjustedInput,
  type ComponentKey,
} from './cycle-adjusted';
import { DEFAULT_WEIGHTS, DEFAULT_CALIBRATION } from '../risk/model';
import fixture from './__fixtures__/risk-series.json';

// ---- Layer-0 FREEZE GUARD -------------------------------------------------
// If Layer 0's weights or calibration ever change, the cycle-adjusted layer
// (which deliberately reuses them) and this whole analysis break silently.
// Pin them so any change fails loudly.
describe('Layer-0 freeze guard', () => {
  it('DEFAULT_WEIGHTS are unchanged', () => {
    expect(DEFAULT_WEIGHTS).toEqual({
      valuation: 0.28, momentum: 0.18, volatility: 0.06,
      cycle: 0.22, macro: 0.14, attention: 0.12,
    });
  });
  it('DEFAULT_CALIBRATION is unchanged', () => {
    expect(DEFAULT_CALIBRATION).toEqual({ slope: 7, center: 0.48 });
  });
  it('adaptive + raw keys partition the six components', () => {
    expect([...ADAPTIVE_KEYS, ...RAW_KEYS].sort()).toEqual(
      ['attention', 'cycle', 'macro', 'momentum', 'valuation', 'volatility']
    );
  });
});

// ---- rollingPercentile ----------------------------------------------------
describe('rollingPercentile', () => {
  it('is 1.0 when the current value is the window max, counting ties as <=', () => {
    expect(rollingPercentile([1, 2, 3], 2, 10)).toBe(1);
    expect(rollingPercentile([3, 3, 3], 2, 10)).toBe(1); // ties <= self
  });
  it('is the fraction of window values <= current', () => {
    //  values [10,20,30,40,15]; at i=4 (15): {10,15} <= 15 → 2/5
    expect(rollingPercentile([10, 20, 30, 40, 15], 4, 10)).toBeCloseTo(2 / 5);
  });
  it('respects the trailing window bound', () => {
    // window 3 at i=4 → look at [30,40,15]; {15} <= 15 → 1/3
    expect(rollingPercentile([10, 20, 30, 40, 15], 4, 3)).toBeCloseTo(1 / 3);
  });
  it('skips non-finite values in the window', () => {
    expect(rollingPercentile([NaN, 5, 10], 2, 10)).toBeCloseTo(2 / 2); // count=2
  });
  it('returns 0.5 for a non-finite current value', () => {
    expect(rollingPercentile([1, 2, NaN], 2, 10)).toBe(0.5);
  });
  it('is monotonic in the current value', () => {
    const base = [0.2, 0.4, 0.6, 0.3];
    const lower = rollingPercentile([...base.slice(0, 3), 0.1], 3, 10);
    const higher = rollingPercentile([...base.slice(0, 3), 0.9], 3, 10);
    expect(higher).toBeGreaterThanOrEqual(lower);
  });
});

// ---- synthetic series helpers ---------------------------------------------
function synthetic(n: number, comp: (i: number) => Record<ComponentKey, number>): AdjustedInput[] {
  return Array.from({ length: n }, (_, i) => ({
    date: new Date(Date.UTC(2015, 0, 1 + i)).toISOString().split('T')[0],
    smoothedRisk: 0.5,
    components: comp(i),
  }));
}
const flat = (): Record<ComponentKey, number> => ({
  valuation: 0.5, momentum: 0.5, volatility: 0.5, cycle: 0.5, macro: 0.5, attention: 0.5,
});

describe('calculateAllCycleAdjusted — structure', () => {
  it('emits null (never 0.5) during the burn-in period', () => {
    const res = calculateAllCycleAdjusted(synthetic(BURN_IN + 10, flat));
    for (let i = 0; i < BURN_IN; i++) {
      expect(res[i].burnIn).toBe(true);
      expect(res[i].adjusted).toBeNull();
      expect(res[i].raw).toBeNull();
    }
    expect(res[BURN_IN].burnIn).toBe(false);
    expect(res[BURN_IN].adjusted).not.toBeNull();
  });

  it('never mutates Layer 0: absolute === input smoothedRisk and input is untouched', () => {
    const input = synthetic(BURN_IN + 50, i => ({ ...flat(), valuation: 0.3 + i * 0.001 }));
    const snapshot = JSON.parse(JSON.stringify(input));
    const res = calculateAllCycleAdjusted(input);
    expect(input).toEqual(snapshot); // no mutation
    for (let i = 0; i < input.length; i++) {
      expect(res[i].absolute).toBe(input[i].smoothedRisk);
    }
  });

  it('keeps all adjusted values within [0,1]', () => {
    const res = calculateAllCycleAdjusted(
      synthetic(BURN_IN + 500, i => ({
        valuation: (i * 7) % 100 / 100,
        momentum: (i * 13) % 100 / 100,
        volatility: (i * 29) % 100 / 100,
        cycle: (i * 3) % 100 / 100,
        macro: 0.5,
        attention: (i * 17) % 100 / 100,
      }))
    );
    for (const r of res) {
      if (r.adjusted === null) continue;
      expect(r.adjusted).toBeGreaterThanOrEqual(0);
      expect(r.adjusted).toBeLessThanOrEqual(1);
    }
  });

  it('marks non-finite base risk as burn-in and stays finite elsewhere', () => {
    const input = synthetic(BURN_IN + 20, flat);
    input[BURN_IN + 5].smoothedRisk = NaN;
    const res = calculateAllCycleAdjusted(input);
    expect(res[BURN_IN + 5].burnIn).toBe(true);
    expect(res[BURN_IN + 5].adjusted).toBeNull();
    expect(Number.isFinite(res[BURN_IN + 6].adjusted!)).toBe(true);
  });

  it('raw components report null percentile; adaptive report a number', () => {
    const res = calculateAllCycleAdjusted(synthetic(BURN_IN + 5, flat));
    const last = res[res.length - 1];
    for (const k of RAW_KEYS) expect(last.perComponentPercentile[k]).toBeNull();
    for (const k of ADAPTIVE_KEYS) expect(typeof last.perComponentPercentile[k]).toBe('number');
  });

  it('is deterministic', () => {
    const input = synthetic(BURN_IN + 100, i => ({ ...flat(), momentum: (i % 50) / 50 }));
    expect(calculateAllCycleAdjusted(input)).toEqual(calculateAllCycleAdjusted(input));
  });
});

describe('calculateAllCycleAdjusted — walk-forward safety', () => {
  it('truncation invariance: past values do not depend on future data', () => {
    const input = synthetic(BURN_IN + 400, i => ({
      valuation: 0.5 + 0.3 * Math.sin(i / 40),
      momentum: 0.5 + 0.3 * Math.cos(i / 55),
      volatility: 0.4 + 0.2 * Math.sin(i / 30),
      cycle: Math.min(1, i / (BURN_IN + 400)),
      macro: 0.5,
      attention: 0.5 + 0.3 * Math.sin(i / 25),
    }));
    const full = calculateAllCycleAdjusted(input);
    for (const t of [BURN_IN + 10, BURN_IN + 150, BURN_IN + 399]) {
      const truncated = calculateAllCycleAdjusted(input.slice(0, t + 1));
      const last = truncated[truncated.length - 1];
      expect(last.date).toBe(full[t].date);
      // EMA is causal + rolling window looks back → identical
      expect(last.adjusted).toBeCloseTo(full[t].adjusted!, 12);
    }
  });
});

// ---- fixture-based helpers ------------------------------------------------
const FX_ROWS = (fixture as { rows: (string | number)[][] }).rows;
const RISKS: AdjustedInput[] = FX_ROWS.map(r => ({
  date: r[0] as string,
  smoothedRisk: r[1] as number,
  components: {
    valuation: r[2] as number,
    momentum: r[3] as number,
    volatility: r[4] as number,
    cycle: r[5] as number,
    macro: r[6] as number,
    attention: r[7] as number,
  },
}));

function aggRange(res: ReturnType<typeof calculateAllCycleAdjusted>, a: string, b: string) {
  let maxA = -1, minA = 2, maxL0 = -1;
  for (const r of res) {
    if (r.adjusted === null) continue;
    if (r.date >= a && r.date <= b) {
      maxA = Math.max(maxA, r.adjusted);
      minA = Math.min(minA, r.adjusted);
      maxL0 = Math.max(maxL0, r.absolute);
    }
  }
  return { maxA, minA, maxL0 };
}

// ---- PRE-REGISTERED acceptance table (thresholds fixed before impl) -------
describe('cycle-adjusted acceptance (pre-registered, real served-model data)', () => {
  const res = calculateAllCycleAdjusted(RISKS);

  it('sanity: fixture covers the required cycles', () => {
    expect(RISKS.length).toBeGreaterThan(4000);
    expect(RISKS[0].date <= '2013-12-31').toBe(true);
    expect(RISKS[RISKS.length - 1].date >= '2026-01-01').toBe(true);
  });

  it('L1 >= 85% at the 2017-12 top (±60d max)', () => {
    expect(aggRange(res, '2017-10-18', '2018-02-15').maxA).toBeGreaterThanOrEqual(0.85);
  });
  it('L1 >= 85% at the 2021-11 top (±60d max)', () => {
    expect(aggRange(res, '2021-09-11', '2022-01-09').maxA).toBeGreaterThanOrEqual(0.85);
  });
  it('L1 at the 2025 top exceeds L0 by >= 10pp (the core thesis)', () => {
    const w = aggRange(res, '2024-10-15', '2025-02-15');
    expect(w.maxA).toBeGreaterThanOrEqual(w.maxL0 + 0.10);
  });
  it('L1 <= 12% at the 2018-12 bottom (±60d min)', () => {
    expect(aggRange(res, '2018-10-16', '2019-02-13').minA).toBeLessThanOrEqual(0.12);
  });
  it('L1 <= 12% at the 2022-11 bottom (±60d min)', () => {
    expect(aggRange(res, '2022-09-22', '2023-01-20').minA).toBeLessThanOrEqual(0.12);
  });
  it("today's L1 is within [25%, 50%]", () => {
    const last = res[res.length - 1];
    expect(last.adjusted).not.toBeNull();
    expect(last.adjusted!).toBeGreaterThanOrEqual(0.25);
    expect(last.adjusted!).toBeLessThanOrEqual(0.50);
  });
});

// ---- window sensitivity: conclusions robust across 3y/4y/5y ---------------
describe('window sensitivity (3y / 4y / 5y)', () => {
  for (const W of [1095, DEFAULT_WINDOW, 1825]) {
    it(`W=${W}: tops stay high, bottoms stay low, 2025 top lifts above L0`, () => {
      const res = calculateAllCycleAdjusted(RISKS, W);
      expect(aggRange(res, '2017-10-18', '2018-02-15').maxA).toBeGreaterThanOrEqual(0.80);
      expect(aggRange(res, '2021-09-11', '2022-01-09').maxA).toBeGreaterThanOrEqual(0.80);
      expect(aggRange(res, '2018-10-16', '2019-02-13').minA).toBeLessThanOrEqual(0.15);
      expect(aggRange(res, '2022-09-22', '2023-01-20').minA).toBeLessThanOrEqual(0.15);
      const t25 = aggRange(res, '2024-10-15', '2025-02-15');
      expect(t25.maxA).toBeGreaterThanOrEqual(t25.maxL0 + 0.08);
    });
  }
});

// ---- single-day raw recomposition -----------------------------------------
describe('calculateCycleAdjustedRaw', () => {
  it('returns null during burn-in', () => {
    expect(calculateCycleAdjustedRaw(RISKS, 10)).toBeNull();
  });
  it('agrees with the unsmoothed first post-burn-in adjusted value', () => {
    // At the very first non-burn-in index the EMA seeds with the unsmoothed
    // value, so the smoothed series equals the raw recomposition there.
    const raw = calculateCycleAdjustedRaw(RISKS, BURN_IN);
    const all = calculateAllCycleAdjusted(RISKS);
    expect(raw).not.toBeNull();
    expect(all[BURN_IN].adjusted!).toBeCloseTo(raw!.adjusted, 10);
  });
});

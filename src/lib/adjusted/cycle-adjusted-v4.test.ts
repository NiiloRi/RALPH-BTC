/**
 * ROUND 4 ACCEPTANCE — price-confirmed cycle in Layer 1 (shipped composition).
 *
 * Tests applyPriceConfirmedCycle → calculateAllCycleAdjusted, exactly the
 * pipeline RiskDashboard ships. Bounds pre-registered in
 * docs/cycle-adjusted-risk.md §14 on 2026-07-24, BEFORE measurement.
 * The round-2 tests in cycle-adjusted.test.ts keep guarding the raw-cycle
 * core as regression; nothing here supersedes them.
 */
import { describe, it, expect } from 'vitest';
import {
  calculateAllCycleAdjusted,
  DEFAULT_WINDOW,
  type AdjustedInput,
} from './cycle-adjusted';
import { applyPriceConfirmedCycle } from './price-confirmed-cycle';
import riskFixture from './__fixtures__/risk-series.json';
import priceFixture from './__fixtures__/price-series.json';

// ---- fixture loading --------------------------------------------------------
const RISKS: AdjustedInput[] = (riskFixture as { rows: (string | number)[][] }).rows.map(r => ({
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

const PRICES: { date: string; price: number }[] = (
  priceFixture as { rows: (string | number)[][] }
).rows.map(r => ({ date: r[0] as string, price: r[1] as number }));

const RISKS_V4 = applyPriceConfirmedCycle(RISKS, PRICES);
const res3 = calculateAllCycleAdjusted(RISKS);
const res4 = calculateAllCycleAdjusted(RISKS_V4);

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

// ---- fixture-join sanity ----------------------------------------------------
describe('fixture join sanity (price-series.json is a strict companion)', () => {
  it('same length and per-index date equality with risk-series.json', () => {
    expect(PRICES.length).toBe(RISKS.length);
    for (let i = 0; i < RISKS.length; i++) {
      expect(PRICES[i].date).toBe(RISKS[i].date);
    }
  });
  it('all prices finite and > 0', () => {
    for (const p of PRICES) {
      expect(Number.isFinite(p.price)).toBe(true);
      expect(p.price).toBeGreaterThan(0);
    }
  });
});

// ---- PRE-REGISTERED acceptance (§14, fixed 2026-07-24 before measurement) ---
describe('round-4 acceptance (pre-registered §14 bounds)', () => {
  it('1. L1v4 >= 85% at the 2017-12 top (±60d max)', () => {
    expect(aggRange(res4, '2017-10-18', '2018-02-15').maxA).toBeGreaterThanOrEqual(0.85);
  });
  it('2. L1v4 >= 85% at the 2021-11 top (±60d max)', () => {
    expect(aggRange(res4, '2021-09-11', '2022-01-09').maxA).toBeGreaterThanOrEqual(0.85);
  });
  it('3. NEW: L1v4 >= 85% at the 2025-01 top (±60d max) — the round-4 point', () => {
    expect(aggRange(res4, '2024-10-15', '2025-02-15').maxA).toBeGreaterThanOrEqual(0.85);
  });
  it('4. L1v4 <= 12% at the 2018-12 bottom (±60d min)', () => {
    expect(aggRange(res4, '2018-10-16', '2019-02-13').minA).toBeLessThanOrEqual(0.12);
  });
  it('5. L1v4 <= 12% at the 2022-11 bottom (±60d min)', () => {
    expect(aggRange(res4, '2022-09-22', '2023-01-20').minA).toBeLessThanOrEqual(0.12);
  });
  it("6. today's L1v4 within [25%, 50%] (fixture end 2026-07-06)", () => {
    const last = res4[res4.length - 1];
    expect(last.adjusted).not.toBeNull();
    expect(last.adjusted!).toBeGreaterThanOrEqual(0.25);
    expect(last.adjusted!).toBeLessThanOrEqual(0.50);
  });
});

// ---- unchanged where price says no ------------------------------------------
describe('unchanged where topProximity = 0 (structural §13 compliance)', () => {
  // The EMA never exactly forgets (0.7^n tail), so equality is asymptotic:
  // after months of topProximity = 0 the residual is ~1e-5; assert 1e-3.
  it('bottom windows match round-2 Layer 1 to within 1e-3', () => {
    for (const [a, b] of [['2018-10-16', '2019-02-13'], ['2022-09-22', '2023-01-20']]) {
      const w3 = aggRange(res3, a, b);
      const w4 = aggRange(res4, a, b);
      expect(Math.abs(w4.minA - w3.minA)).toBeLessThan(1e-3);
    }
  });
  it("today matches round-2 Layer 1 to within 1e-3 (today's topProximity is 0)", () => {
    const l3 = res3[res3.length - 1].adjusted!;
    const l4 = res4[res4.length - 1].adjusted!;
    expect(Math.abs(l4 - l3)).toBeLessThan(1e-3);
  });
});

// ---- structural invariant ----------------------------------------------------
describe('monotone lift (noisy-OR only ever raises the raw sum)', () => {
  it('res4.adjusted >= res3.adjusted on every non-burn-in day', () => {
    for (let i = 0; i < res4.length; i++) {
      if (res4[i].adjusted === null || res3[i].adjusted === null) continue;
      expect(res4[i].adjusted!).toBeGreaterThanOrEqual(res3[i].adjusted! - 1e-12);
    }
  });
});

// ---- window sensitivity (§14 criterion 7) ------------------------------------
describe('window sensitivity (3y / 4y / 5y)', () => {
  for (const W of [1095, DEFAULT_WINDOW, 1825]) {
    it(`W=${W}: tops >= 80% (incl. 2025), bottoms <= 15%`, () => {
      const res = calculateAllCycleAdjusted(RISKS_V4, W);
      expect(aggRange(res, '2017-10-18', '2018-02-15').maxA).toBeGreaterThanOrEqual(0.80);
      expect(aggRange(res, '2021-09-11', '2022-01-09').maxA).toBeGreaterThanOrEqual(0.80);
      expect(aggRange(res, '2024-10-15', '2025-02-15').maxA).toBeGreaterThanOrEqual(0.80);
      expect(aggRange(res, '2018-10-16', '2019-02-13').minA).toBeLessThanOrEqual(0.15);
      expect(aggRange(res, '2022-09-22', '2023-01-20').minA).toBeLessThanOrEqual(0.15);
    });
  }
});

// ---- walk-forward safety of the composed pipeline (§14 criterion 8) -----------
describe('truncation invariance of the composed pipeline', () => {
  it('past values do not depend on future data (12 decimals)', () => {
    const cut1 = RISKS.findIndex(r => r.date >= '2016-06-01');
    const cut2 = RISKS.findIndex(r => r.date >= '2021-11-10');
    for (const t of [cut1, cut2, RISKS.length - 1]) {
      const truncated = calculateAllCycleAdjusted(
        applyPriceConfirmedCycle(RISKS.slice(0, t + 1), PRICES.slice(0, t + 1))
      );
      const last = truncated[truncated.length - 1];
      expect(last.date).toBe(res4[t].date);
      expect(last.adjusted).toBeCloseTo(res4[t].adjusted!, 12);
    }
  });
});

// ---- §14 pre-declared honest cost: Dec-2020 intermediate ATH (finding) --------
describe('Dec-2020 intermediate-ATH finding (measured, NOT bounded — §14)', () => {
  it('measures max cycleV4 and max L1v4 over 2020-11-01..2021-01-31 (sanity only)', () => {
    let maxCycleV4 = -1, maxCycleRaw = -1;
    for (let i = 0; i < RISKS.length; i++) {
      const dte = RISKS[i].date;
      if (dte >= '2020-11-01' && dte <= '2021-01-31') {
        maxCycleV4 = Math.max(maxCycleV4, RISKS_V4[i].components.cycle);
        maxCycleRaw = Math.max(maxCycleRaw, RISKS[i].components.cycle);
      }
    }
    const w4 = aggRange(res4, '2020-11-01', '2021-01-31');
    const w3 = aggRange(res3, '2020-11-01', '2021-01-31');

    // Findings — transcribed into docs/cycle-adjusted-risk.md §14 results:
    console.log(
      `[§14 finding] Dec-2020 window: raw cycle max ${(maxCycleRaw * 100).toFixed(1)}%, ` +
      `cycleV4 max ${(maxCycleV4 * 100).toFixed(1)}%, ` +
      `L1 round-2 max ${(w3.maxA * 100).toFixed(1)}%, L1v4 max ${(w4.maxA * 100).toFixed(1)}%`
    );

    // Sanity only — the early-firing cost is pre-declared, not bounded.
    expect(Number.isFinite(maxCycleV4)).toBe(true);
    expect(maxCycleV4).toBeGreaterThanOrEqual(0);
    expect(maxCycleV4).toBeLessThanOrEqual(1);
    expect(maxCycleV4).toBeGreaterThan(maxCycleRaw);
    expect(w4.maxA).toBeGreaterThanOrEqual(w3.maxA);
  });
});

// ---- measured values for the §14 results table --------------------------------
describe('§14 results table (measured)', () => {
  it('prints the acceptance measurements', () => {
    const t17 = aggRange(res4, '2017-10-18', '2018-02-15');
    const t21 = aggRange(res4, '2021-09-11', '2022-01-09');
    const t25 = aggRange(res4, '2024-10-15', '2025-02-15');
    const t25v3 = aggRange(res3, '2024-10-15', '2025-02-15');
    const b18 = aggRange(res4, '2018-10-16', '2019-02-13');
    const b22 = aggRange(res4, '2022-09-22', '2023-01-20');
    const today = res4[res4.length - 1].adjusted!;
    const today3 = res3[res3.length - 1].adjusted!;
    console.log(
      `[§14 results] 2017 top ${(t17.maxA * 100).toFixed(1)}% | ` +
      `2021 top ${(t21.maxA * 100).toFixed(1)}% | ` +
      `2025 top ${(t25.maxA * 100).toFixed(1)}% (round-2: ${(t25v3.maxA * 100).toFixed(1)}%, L0: ${(t25.maxL0 * 100).toFixed(1)}%) | ` +
      `2018 bottom ${(b18.minA * 100).toFixed(1)}% | 2022 bottom ${(b22.minA * 100).toFixed(1)}% | ` +
      `today ${(today * 100).toFixed(1)}% (round-2: ${(today3 * 100).toFixed(1)}%)`
    );
    expect(today).toBeGreaterThan(0);
  });
});

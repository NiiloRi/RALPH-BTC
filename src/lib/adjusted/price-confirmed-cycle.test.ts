import { describe, it, expect } from 'vitest';
import {
  noisyOr,
  hardMax,
  COMBINE,
  applyPriceConfirmedCycle,
} from './price-confirmed-cycle';
import type { AdjustedInput, ComponentKey } from './cycle-adjusted';

// ---- combiners --------------------------------------------------------------
describe('noisyOr', () => {
  it('identity at p=0: noisyOr(c, 0) === c', () => {
    for (const c of [0, 0.27, 0.5, 0.83, 1]) expect(noisyOr(c, 0)).toBe(c);
  });
  it('identity at c=0: noisyOr(0, p) === p', () => {
    for (const p of [0, 0.3, 0.9, 1]) expect(noisyOr(0, p)).toBe(p);
  });
  it('saturates: noisyOr(1, p) === 1 and noisyOr(c, 1) === 1', () => {
    for (const x of [0, 0.5, 1]) {
      expect(noisyOr(1, x)).toBe(1);
      expect(noisyOr(x, 1)).toBe(1);
    }
  });
  it('is commutative', () => {
    for (const [c, p] of [[0.27, 0.9], [0.83, 0.1], [0.4, 0.4]]) {
      expect(noisyOr(c, p)).toBeCloseTo(noisyOr(p, c), 12);
    }
  });
  it('is monotone in both arguments', () => {
    expect(noisyOr(0.3, 0.5)).toBeGreaterThanOrEqual(noisyOr(0.2, 0.5));
    expect(noisyOr(0.3, 0.5)).toBeGreaterThanOrEqual(noisyOr(0.3, 0.4));
  });
  it('is >= max(c, p) and within [0, 1]', () => {
    for (const [c, p] of [[0.27, 0.9], [0.83, 0], [0.5, 0.5], [0, 0], [1, 1]]) {
      const v = noisyOr(c, p);
      expect(v).toBeGreaterThanOrEqual(Math.max(c, p) - 1e-12);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
  it('passes a non-finite cycle through unchanged (core guard stays in charge)', () => {
    expect(Number.isNaN(noisyOr(NaN, 0.9))).toBe(true);
    expect(noisyOr(Infinity, 0.9)).toBe(Infinity);
  });
  it('treats a non-finite topProximity as 0', () => {
    expect(noisyOr(0.4, NaN)).toBe(0.4);
  });
  it('clamps out-of-range finite inputs to [0, 1]', () => {
    expect(noisyOr(1.5, 0)).toBe(1);
    expect(noisyOr(-0.5, 0.3)).toBe(0.3);
    expect(noisyOr(0.5, 2)).toBe(1);
  });
  it('reproduces the §14 hand-computed table', () => {
    expect(noisyOr(0.27, 0.9)).toBeCloseTo(0.927, 10); // 2025 top
    expect(noisyOr(0.83, 0)).toBe(0.83);               // today
    expect(noisyOr(0, 0)).toBe(0);                     // bottoms
  });
});

describe('hardMax', () => {
  it('is max with the same guards', () => {
    expect(hardMax(0.27, 0.9)).toBe(0.9);
    expect(hardMax(0.83, 0)).toBe(0.83);
    expect(Number.isNaN(hardMax(NaN, 0.9))).toBe(true);
    expect(hardMax(0.4, NaN)).toBe(0.4);
  });
});

describe('COMBINE', () => {
  it('is pinned to noisyOr — a combiner swap must be a conscious edit', () => {
    expect(COMBINE).toBe(noisyOr);
  });
});

// ---- applyPriceConfirmedCycle ----------------------------------------------
const comp = (cycle: number): Record<ComponentKey, number> => ({
  valuation: 0.4, momentum: 0.3, volatility: 0.2, cycle, macro: 0.5, attention: 0.6,
});

/** days after 2015-01-01 → ISO date */
function d(days: number): string {
  return new Date(Date.UTC(2015, 0, 1 + days)).toISOString().split('T')[0];
}

function mkRisks(n: number, cycle: (i: number) => number, start = 0): AdjustedInput[] {
  return Array.from({ length: n }, (_, i) => ({
    date: d(start + i),
    smoothedRisk: 0.5,
    components: comp(cycle(i)),
  }));
}

const LOW = [d(0)]; // cycle low at 2015-01-01 → season saturates at day 700

describe('applyPriceConfirmedCycle', () => {
  it('returns [] for empty risks', () => {
    expect(applyPriceConfirmedCycle([], [{ date: d(0), price: 100 }])).toEqual([]);
  });

  it('never mutates its inputs and only components.cycle may differ', () => {
    const risks = mkRisks(30, () => 0.4, 800);
    const prices = risks.map(r => ({ date: r.date, price: 100 }));
    const riskSnap = JSON.parse(JSON.stringify(risks));
    const priceSnap = JSON.parse(JSON.stringify(prices));

    const out = applyPriceConfirmedCycle(risks, prices, { lowDates: LOW });

    expect(risks).toEqual(riskSnap);
    expect(prices).toEqual(priceSnap);
    for (let i = 0; i < risks.length; i++) {
      expect(out[i].date).toBe(risks[i].date);
      expect(out[i].smoothedRisk).toBe(risks[i].smoothedRisk);
      for (const k of ['valuation', 'momentum', 'volatility', 'macro', 'attention'] as const) {
        expect(out[i].components[k]).toBe(risks[i].components[k]);
      }
    }
  });

  it('empty prices → full raw-cycle passthrough (fresh copy)', () => {
    const risks = mkRisks(10, i => i / 10, 800);
    const out = applyPriceConfirmedCycle(risks, [], { lowDates: LOW });
    expect(out.map(r => r.components.cycle)).toEqual(risks.map(r => r.components.cycle));
    expect(out[0]).not.toBe(risks[0]); // new objects
  });

  it('risk dates absent from prices → passthrough on exactly those dates', () => {
    const risks = mkRisks(4, () => 0.4, 800);
    // prices only for the first two dates, flat at ATH → p = 1 there
    const prices = risks.slice(0, 2).map(r => ({ date: r.date, price: 100 }));
    const out = applyPriceConfirmedCycle(risks, prices, { lowDates: LOW });
    expect(out[0].components.cycle).toBe(1);   // 0.4 + 0.6·1
    expect(out[1].components.cycle).toBe(1);
    expect(out[2].components.cycle).toBe(0.4); // passthrough
    expect(out[3].components.cycle).toBe(0.4);
  });

  it('REGRESSION: a NaN price near the ATH does not fabricate priceProx=1', () => {
    // Without pre-filtering, calculateAllTopProximity reads drawdown 0 for a
    // non-finite price once ath > 0 → spurious top signal on that date.
    const risks = mkRisks(3, () => 0.2, 800);
    const prices = [
      { date: risks[0].date, price: 100 },
      { date: risks[1].date, price: NaN },  // dropped → passthrough that day
      { date: risks[2].date, price: 30 },   // −70% off ATH → p = 0
    ];
    const out = applyPriceConfirmedCycle(risks, prices, { lowDates: LOW });
    expect(out[1].components.cycle).toBe(0.2); // NOT lifted
    expect(out[2].components.cycle).toBe(0.2);
  });

  it('unsorted price input produces identical output to sorted input', () => {
    const risks = mkRisks(50, () => 0.3, 800);
    const sorted = risks.map((r, i) => ({ date: r.date, price: 100 + i }));
    const shuffled = [...sorted].reverse();
    const a = applyPriceConfirmedCycle(risks, sorted, { lowDates: LOW });
    const b = applyPriceConfirmedCycle(risks, shuffled, { lowDates: LOW });
    expect(a).toEqual(b);
  });

  it('lowDates: [] → season 0 everywhere → full passthrough', () => {
    const risks = mkRisks(10, () => 0.4, 800);
    const prices = risks.map(r => ({ date: r.date, price: 100 }));
    const out = applyPriceConfirmedCycle(risks, prices, { lowDates: [] });
    expect(out.map(r => r.components.cycle)).toEqual(risks.map(() => 0.4));
  });

  it('bull at ATH ≥700d post-low lifts the cycle; deep drawdown leaves it exact', () => {
    const risks = mkRisks(2, () => 0.27, 800);
    const bull = [
      { date: risks[0].date, price: 100 }, // at ATH → p = 1
      { date: risks[1].date, price: 55 },  // −45% > DD_REF → p = 0
    ];
    const out = applyPriceConfirmedCycle(risks, bull, { lowDates: LOW });
    expect(out[0].components.cycle).toBeGreaterThan(0.27);
    expect(out[1].components.cycle).toBe(0.27); // exact passthrough
  });

  it('honors the combiner option', () => {
    const risks = mkRisks(1, () => 0.27, 800);
    const prices = [{ date: risks[0].date, price: 100 }];
    const out = applyPriceConfirmedCycle(risks, prices, {
      lowDates: LOW,
      combiner: hardMax,
    });
    expect(out[0].components.cycle).toBe(1); // max(0.27, 1)
  });

  it('is deterministic', () => {
    const risks = mkRisks(100, i => (i % 10) / 10, 600);
    const prices = risks.map((r, i) => ({ date: r.date, price: 50 + (i % 40) }));
    expect(applyPriceConfirmedCycle(risks, prices, { lowDates: LOW }))
      .toEqual(applyPriceConfirmedCycle(risks, prices, { lowDates: LOW }));
  });
});

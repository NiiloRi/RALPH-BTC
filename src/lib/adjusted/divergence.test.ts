import { describe, it, expect } from 'vitest';
import {
  classifyDivergence,
  type DivergenceInput,
  CLOCK_HIGH,
  CLOCK_LOW,
  PRICE_LOW,
  PRICE_HIGH,
} from './divergence';
import type { ComponentKey } from './cycle-adjusted';

function comps(overrides: Partial<Record<ComponentKey, number>>): Record<ComponentKey, number> {
  return {
    valuation: 0.5, momentum: 0.5, volatility: 0.5, cycle: 0.5, macro: 0.5, attention: 0.5,
    ...overrides,
  };
}

function input(
  o: Omit<Partial<DivergenceInput>, 'components'> & { components?: Partial<Record<ComponentKey, number>> }
): DivergenceInput {
  return {
    absolute: 0.45,
    adjusted: 0.40,
    dataCompleteness: 1,
    ...o,
    components: comps(o.components ?? {}),
  };
}

describe('classifyDivergence — each state', () => {
  it('aligned when everything agrees', () => {
    const r = classifyDivergence(input({ components: { cycle: 0.5, valuation: 0.5, momentum: 0.5 } }));
    expect(r.state).toBe('aligned');
    expect(r.actionQualifier).toBeNull();
  });

  it('clock-vs-price: cycle high, price low (the current situation)', () => {
    const r = classifyDivergence(input({
      absolute: 0.45, adjusted: 0.36,
      components: { cycle: 0.83, valuation: 0.32, momentum: 0.38 },
    }));
    expect(r.state).toBe('clock-vs-price');
    expect(r.explanation).toContain('cycle timing is late');
    expect(r.actionQualifier).toBe('cycle-vs-price divergence');
  });

  it('price-vs-clock: cycle early, price stretched', () => {
    const r = classifyDivergence(input({
      components: { cycle: 0.20, valuation: 0.75, momentum: 0.70 },
    }));
    expect(r.state).toBe('price-vs-clock');
    expect(r.actionQualifier).toBe('price-vs-cycle divergence');
  });

  it('layers-diverge when |L1-L0| > 0.25 and no component divergence', () => {
    const r = classifyDivergence(input({
      absolute: 0.40, adjusted: 0.70,
      components: { cycle: 0.5, valuation: 0.5, momentum: 0.5 },
    }));
    expect(r.state).toBe('layers-diverge');
    expect(r.layerGap).toBeCloseTo(0.30);
    expect(r.actionQualifier).toContain('30pp');
  });

  it('data-degraded when completeness < 0.95 and nothing else fires', () => {
    const r = classifyDivergence(input({
      dataCompleteness: 0.86,
      components: { cycle: 0.5, valuation: 0.5, momentum: 0.5 },
    }));
    expect(r.state).toBe('data-degraded');
    expect(r.explanation).toContain('86%');
  });
});

describe('classifyDivergence — priority & edges', () => {
  it('assigns exactly one state across a sweep of inputs', () => {
    const states = new Set<string>();
    for (let cy = 0; cy <= 1.0001; cy += 0.1) {
      for (let vp = 0; vp <= 1.0001; vp += 0.1) {
        for (const adj of [null, 0.2, 0.8] as (number | null)[]) {
          for (const dc of [1, 0.86]) {
            const r = classifyDivergence({
              absolute: 0.5, adjusted: adj,
              components: comps({ cycle: cy, valuation: vp, momentum: vp }),
              dataCompleteness: dc,
            });
            expect([
              'aligned', 'clock-vs-price', 'price-vs-clock', 'layers-diverge', 'data-degraded',
            ]).toContain(r.state);
            states.add(r.state);
          }
        }
      }
    }
    // sanity: the sweep exercises several distinct states
    expect(states.size).toBeGreaterThanOrEqual(4);
  });

  it('component divergence takes priority over a large layer gap', () => {
    const r = classifyDivergence(input({
      absolute: 0.40, adjusted: 0.80, // 40pp gap
      components: { cycle: 0.83, valuation: 0.30, momentum: 0.35 },
    }));
    expect(r.state).toBe('clock-vs-price'); // not layers-diverge
  });

  it('handles burn-in (null adjusted): layerGap null, still classifies components', () => {
    const r = classifyDivergence(input({
      adjusted: null,
      components: { cycle: 0.83, valuation: 0.30, momentum: 0.35 },
    }));
    expect(r.layerGap).toBeNull();
    expect(r.state).toBe('clock-vs-price');
  });

  it('layers-diverge does not fire during burn-in', () => {
    const r = classifyDivergence(input({
      adjusted: null,
      components: { cycle: 0.5, valuation: 0.5, momentum: 0.5 },
      dataCompleteness: 1,
    }));
    expect(r.state).toBe('aligned');
  });

  it('clamps completeness to [0,1]', () => {
    expect(classifyDivergence(input({ dataCompleteness: 5 })).dataCompleteness).toBe(1);
    expect(classifyDivergence(input({ dataCompleteness: -1 })).dataCompleteness).toBe(0);
  });

  it('threshold constants are ordered sensibly', () => {
    expect(CLOCK_LOW).toBeLessThan(CLOCK_HIGH);
    expect(PRICE_LOW).toBeLessThan(PRICE_HIGH);
  });
});

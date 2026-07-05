import { describe, it, expect } from 'vitest';
import {
  calculateComponentAgreement,
  calculateRiskConfidence,
} from './confidence';
import { RiskOutput } from '../types';

function makeRisk(
  risk: number,
  components?: Partial<RiskOutput['components']>
): RiskOutput {
  return {
    date: '2024-01-01',
    price: 50000,
    risk,
    smoothedRisk: risk,
    components: {
      valuation: 0.5,
      momentum: 0.5,
      volatility: 0.5,
      cycle: 0.5,
      macro: 0.5,
      attention: 0.5,
      ...components,
    },
  };
}

/** A stable 30-day series of identical risk outputs */
function stableSeries(components?: Partial<RiskOutput['components']>): RiskOutput[] {
  return Array.from({ length: 30 }, () => makeRisk(0.45, components));
}

describe('data-completeness adjustment', () => {
  it('full completeness (default) leaves confidence unchanged and can be high', () => {
    const risks = stableSeries();
    const c = calculateRiskConfidence(risks, risks.length - 1);
    expect(c.dataCompleteness).toBe(1);
    expect(c.level).toBe('high'); // stable + agreeing components
  });

  it('missing macro data (completeness < 0.95) caps level at medium', () => {
    const risks = stableSeries();
    const c = calculateRiskConfidence(risks, risks.length - 1, { dataCompleteness: 0.86 });
    expect(c.level).not.toBe('high');
    expect(c.dataCompleteness).toBeCloseTo(0.86);
  });

  it('lower completeness reduces the confidence value monotonically', () => {
    const risks = stableSeries();
    const full = calculateRiskConfidence(risks, risks.length - 1, { dataCompleteness: 1 });
    const partial = calculateRiskConfidence(risks, risks.length - 1, { dataCompleteness: 0.8 });
    const half = calculateRiskConfidence(risks, risks.length - 1, { dataCompleteness: 0.5 });
    expect(partial.value).toBeLessThan(full.value);
    expect(half.value).toBeLessThan(partial.value);
  });

  it('all-neutral components (no real data) cannot yield high confidence when completeness is low', () => {
    // All components exactly 0.5 → zero dispersion → "perfect agreement".
    // Previously this manufactured high confidence from MISSING data.
    const risks = stableSeries();
    const c = calculateRiskConfidence(risks, risks.length - 1, { dataCompleteness: 0.5 });
    expect(c.level).not.toBe('high');
  });

  it('clamps completeness to [0, 1]', () => {
    const risks = stableSeries();
    const c = calculateRiskConfidence(risks, risks.length - 1, { dataCompleteness: 5 });
    expect(c.dataCompleteness).toBe(1);
    const c2 = calculateRiskConfidence(risks, risks.length - 1, { dataCompleteness: -1 });
    expect(c2.dataCompleteness).toBe(0);
  });

  it('confidence value stays within [0, 1] for all completeness inputs', () => {
    const risks = stableSeries();
    for (const dc of [0, 0.25, 0.5, 0.86, 1]) {
      const c = calculateRiskConfidence(risks, risks.length - 1, { dataCompleteness: dc });
      expect(c.value).toBeGreaterThanOrEqual(0);
      expect(c.value).toBeLessThanOrEqual(1);
    }
  });
});

describe('component agreement (regression)', () => {
  it('disagreeing components lower agreement', () => {
    const agreeing = calculateComponentAgreement(makeRisk(0.5).components);
    const disagreeing = calculateComponentAgreement(
      makeRisk(0.5, { valuation: 0.05, cycle: 0.95, momentum: 0.1, attention: 0.9 }).components
    );
    expect(disagreeing).toBeLessThan(agreeing);
  });
});

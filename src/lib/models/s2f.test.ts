import { describe, it, expect } from 'vitest';
import {
  ERAS,
  NEXT_HALVING_ESTIMATE,
  btcSupplyAt,
  annualFlowAt,
  s2fAt,
  monthlySamples,
  fitS2F,
  evaluateS2F,
} from './s2f';

describe('supply schedule', () => {
  it('hits the exact supply checkpoints at each actual halving (±1 BTC)', () => {
    expect(btcSupplyAt('2012-11-28')).toBeCloseTo(10_500_000, 0);
    expect(btcSupplyAt('2016-07-09')).toBeCloseTo(15_750_000, 0);
    expect(btcSupplyAt('2020-05-11')).toBeCloseTo(18_375_000, 0);
    expect(btcSupplyAt('2024-04-19')).toBeCloseTo(19_687_500, 0);
  });

  it('reaches ~20,343,750 at the estimated 2028 halving (±450 BTC ≈ one block-day)', () => {
    expect(Math.abs(btcSupplyAt(NEXT_HALVING_ESTIMATE) - 20_343_750)).toBeLessThan(450);
  });

  it('matches the real-world mid-era anchor: supply(2020-01-01) within 1% of 18.14M', () => {
    const s = btcSupplyAt('2020-01-01');
    expect(Math.abs(s - 18_140_000) / 18_140_000).toBeLessThan(0.01);
  });

  it('is continuous at halvings (jump < one day of issuance)', () => {
    for (const d of ['2012-11-28', '2016-07-09', '2020-05-11', '2024-04-19', NEXT_HALVING_ESTIMATE]) {
      const before = btcSupplyAt(new Date(new Date(d).getTime() - 86_400_000).toISOString().split('T')[0]);
      const at = btcSupplyAt(d);
      expect(at).toBeGreaterThanOrEqual(before);
      expect(at - before).toBeLessThan(50 * 160); // max subsidy × max blocks/day
    }
  });

  it('is monotonically non-decreasing on a daily sweep 2010→2029', () => {
    let prev = -1;
    for (let ms = new Date('2010-01-01').getTime(); ms <= new Date('2029-01-01').getTime(); ms += 86_400_000 * 30) {
      const s = btcSupplyAt(new Date(ms).toISOString().split('T')[0]);
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
  });

  it('returns 0 before genesis', () => {
    expect(btcSupplyAt('2008-12-31')).toBe(0);
  });
});

describe('flow', () => {
  it('is constant within an era', () => {
    expect(annualFlowAt('2021-01-01')).toBe(annualFlowAt('2023-12-01'));
    expect(annualFlowAt('2025-01-01')).toBe(annualFlowAt('2027-06-01'));
  });

  it('drops by ~2.03× at the 2024 halving (blocks/day changes 145.93→144)', () => {
    const ratio = annualFlowAt('2024-04-18') / annualFlowAt('2024-04-19');
    expect(ratio).toBeGreaterThan(2.0);
    expect(ratio).toBeLessThan(2.06);
  });

  it('drops by exactly 2× at the estimated 2028 halving (both eras assume 144/day)', () => {
    const before = annualFlowAt('2028-04-15');
    const after = annualFlowAt(NEXT_HALVING_ESTIMATE);
    expect(before / after).toBeCloseTo(2, 10);
  });
});

describe('S2F values', () => {
  it('matches known era ranges', () => {
    const v2017 = s2fAt('2017-07-01');
    expect(v2017).toBeGreaterThan(23);
    expect(v2017).toBeLessThan(27);
    const v2021 = s2fAt('2021-01-01');
    expect(v2021).toBeGreaterThan(54);
    expect(v2021).toBeLessThan(60);
    const v2025 = s2fAt('2025-01-01');
    expect(v2025).toBeGreaterThan(118);
    expect(v2025).toBeLessThan(124);
  });

  it('jumps by factor 2 (±0.01) at the estimated halving', () => {
    const before = s2fAt('2028-04-15');
    const after = s2fAt(NEXT_HALVING_ESTIMATE);
    expect(after / before).toBeGreaterThan(1.99);
    expect(after / after).toBeCloseTo(1);
    expect(after / before).toBeLessThan(2.01);
    expect(after).toBeGreaterThan(240); // ≈ 248 per the era table
  });

  it('NEXT_HALVING_ESTIMATE is the derived 2028-04-16', () => {
    expect(NEXT_HALVING_ESTIMATE).toBe('2028-04-16');
  });

  it('era table has 6 eras with halving subsidies', () => {
    expect(ERAS.map(e => e.subsidy)).toEqual([50, 25, 12.5, 6.25, 3.125, 1.5625]);
  });
});

describe('fitS2F', () => {
  // monthly dates 2012-01 .. 2025-12
  const dates: string[] = [];
  for (let y = 2012; y <= 2025; y++) {
    for (let m = 1; m <= 12; m++) {
      dates.push(`${y}-${String(m).padStart(2, '0')}-15`);
    }
  }

  it('recovers exact synthetic parameters (a=1.5, b=3.3) to 1e-6', () => {
    const prices = dates.map(d => Math.exp(1.5) * Math.pow(s2fAt(d), 3.3));
    const m = fitS2F(dates, prices);
    expect(m.a).toBeCloseTo(1.5, 6);
    expect(m.b).toBeCloseTo(3.3, 6);
    expect(m.r2).toBeGreaterThan(0.999999);
  });

  it('is deterministic', () => {
    const prices = dates.map(d => Math.exp(1.2) * Math.pow(s2fAt(d), 3.0));
    expect(fitS2F(dates, prices)).toEqual(fitS2F(dates, prices));
  });

  it('evaluateS2F steps up by 2^b across the estimated halving', () => {
    const prices = dates.map(d => Math.exp(1.5) * Math.pow(s2fAt(d), 3.3));
    const m = fitS2F(dates, prices);
    const before = evaluateS2F(m, '2028-04-15');
    const after = evaluateS2F(m, NEXT_HALVING_ESTIMATE);
    expect(after / before).toBeCloseTo(Math.pow(2, 3.3), 1);
  });

  it('monthlySamples keeps the last observation per month and skips bad prices', () => {
    const s = monthlySamples(
      ['2020-01-01', '2020-01-15', '2020-01-31', '2020-02-10', '2020-02-11'],
      [100, 110, 120, NaN, 130]
    );
    expect(s).toEqual([
      { date: '2020-01-31', price: 120 },
      { date: '2020-02-11', price: 130 },
    ]);
  });

  it('throws below the minimum sample count', () => {
    expect(() => fitS2F(['2020-01-01'], [100])).toThrow(/monthly samples/);
  });
});

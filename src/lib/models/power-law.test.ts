import { describe, it, expect } from 'vitest';
import { fitPowerLaw, evaluatePowerLaw, daysSinceGenesis } from './power-law';

function dailyDates(start: string, end: string, stepDays = 1): string[] {
  const out: string[] = [];
  for (let ms = new Date(start).getTime(); ms <= new Date(end).getTime(); ms += stepDays * 86_400_000) {
    out.push(new Date(ms).toISOString().split('T')[0]);
  }
  return out;
}

describe('fitPowerLaw', () => {
  const dates = dailyDates('2011-01-01', '2025-12-31', 3);

  it('recovers exact synthetic parameters (b=5.8) to 1e-6', () => {
    const A = Math.exp(2);
    const prices = dates.map(d => A * Math.pow(daysSinceGenesis(d), 5.8));
    const m = fitPowerLaw(dates, prices);
    expect(m.a).toBeCloseTo(2, 6);
    expect(m.b).toBeCloseTo(5.8, 6);
    expect(m.r2).toBeGreaterThan(0.999999);
    expect(m.residQ05).toBeCloseTo(0, 6);
    expect(m.residQ95).toBeCloseTo(0, 6);
  });

  it('residual bands cover ~90% of noisy in-sample points (by construction)', () => {
    // deterministic pseudo-noise (no Math.random — keep tests reproducible)
    const prices = dates.map((d, i) => {
      const noise = Math.sin(i * 12.9898) * 0.8; // ln-space noise in [-0.8, 0.8]
      return Math.exp(1 + noise) * Math.pow(daysSinceGenesis(d), 5.0);
    });
    const m = fitPowerLaw(dates, prices);
    let inside = 0;
    for (let i = 0; i < dates.length; i++) {
      const { support, resistance } = evaluatePowerLaw(m, dates[i]);
      if (prices[i] >= support && prices[i] <= resistance) inside++;
    }
    const coverage = inside / dates.length;
    expect(coverage).toBeGreaterThanOrEqual(0.85);
    expect(coverage).toBeLessThanOrEqual(0.95);
  });

  it('skips invalid rows (p<=0, pre-genesis) and still fits', () => {
    const ds = ['2008-01-01', ...dates];
    const ps = [123, ...dates.map(d => Math.exp(2) * Math.pow(daysSinceGenesis(d), 5.8))];
    ps[5] = -1;
    ps[10] = NaN;
    const m = fitPowerLaw(ds, ps);
    expect(m.b).toBeCloseTo(5.8, 4);
    expect(m.fittedN).toBe(dates.length - 2);
  });

  it('throws below MIN_POINTS', () => {
    expect(() => fitPowerLaw(['2020-01-01'], [100])).toThrow(/valid points/);
  });

  it('envelope lines touch the historical extremes by construction', () => {
    const prices = dates.map((d, i) => {
      const noise = Math.sin(i * 12.9898) * 0.8;
      return Math.exp(1 + noise) * Math.pow(daysSinceGenesis(d), 5.0);
    });
    const m = fitPowerLaw(dates, prices);
    let minRatio = Infinity;
    let maxRatio = -Infinity;
    let inside = 0;
    for (let i = 0; i < dates.length; i++) {
      const v = evaluatePowerLaw(m, dates[i]);
      // every observation within the envelope corridor
      expect(prices[i]).toBeGreaterThanOrEqual(v.envelopeFloor * (1 - 1e-9));
      expect(prices[i]).toBeLessThanOrEqual(v.envelopeCeiling * (1 + 1e-9));
      if (prices[i] >= v.envelopeFloor && prices[i] <= v.envelopeCeiling) inside++;
      minRatio = Math.min(minRatio, prices[i] / v.envelopeFloor);
      maxRatio = Math.max(maxRatio, prices[i] / v.envelopeCeiling);
    }
    expect(inside).toBe(dates.length); // 100% coverage
    expect(minRatio).toBeCloseTo(1, 6); // floor TOUCHES the lowest observation
    expect(maxRatio).toBeCloseTo(1, 6); // ceiling TOUCHES the highest observation
    // envelope strictly outside the quantile bands
    const v = evaluatePowerLaw(m, '2020-01-01');
    expect(v.envelopeFloor).toBeLessThan(v.support);
    expect(v.envelopeCeiling).toBeGreaterThan(v.resistance);
  });

  it('evaluates future dates: finite, positive, support < fair < resistance', () => {
    const prices = dates.map((d, i) => Math.exp(1 + Math.sin(i) * 0.3) * Math.pow(daysSinceGenesis(d), 5.5));
    const m = fitPowerLaw(dates, prices);
    const v = evaluatePowerLaw(m, '2028-04-16');
    expect(Number.isFinite(v.fair)).toBe(true);
    expect(v.support).toBeGreaterThan(0);
    expect(v.support).toBeLessThan(v.fair);
    expect(v.fair).toBeLessThan(v.resistance);
  });
});

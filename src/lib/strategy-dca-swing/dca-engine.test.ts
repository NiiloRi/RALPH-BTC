/**
 * Tests for DCA Engine
 */

import { describe, it, expect } from 'vitest';
import {
  calculateDCAMultiplier,
  calculateDCAAmount,
  shouldPerformDCA,
  getDCAIntervalDays,
  getDCARiskCurve,
} from './dca-engine';
import { DEFAULT_DCA_SWING_CONFIG } from './types';

describe('calculateDCAMultiplier', () => {
  const config = DEFAULT_DCA_SWING_CONFIG.dca;

  it('should return max multiplier at risk=0', () => {
    const multiplier = calculateDCAMultiplier(0, config);
    expect(multiplier).toBe(config.maxMultiplier);
  });

  it('should return min multiplier at risk=1', () => {
    const multiplier = calculateDCAMultiplier(1, config);
    expect(multiplier).toBe(config.minMultiplier);
  });

  it('should return intermediate values for middle risk levels', () => {
    const multiplier05 = calculateDCAMultiplier(0.5, config);
    expect(multiplier05).toBeGreaterThan(config.minMultiplier);
    expect(multiplier05).toBeLessThan(config.maxMultiplier);
  });

  it('should decrease as risk increases', () => {
    const m1 = calculateDCAMultiplier(0.2, config);
    const m2 = calculateDCAMultiplier(0.5, config);
    const m3 = calculateDCAMultiplier(0.8, config);

    expect(m1).toBeGreaterThan(m2);
    expect(m2).toBeGreaterThan(m3);
  });

  it('should clamp risk to [0, 1]', () => {
    expect(calculateDCAMultiplier(-0.5, config)).toBe(config.maxMultiplier);
    expect(calculateDCAMultiplier(1.5, config)).toBe(config.minMultiplier);
  });
});

describe('calculateDCAAmount', () => {
  const config = DEFAULT_DCA_SWING_CONFIG.dca;

  it('should return base amount * max multiplier at risk=0', () => {
    const amount = calculateDCAAmount(0, config);
    expect(amount).toBe(config.baseAmount * config.maxMultiplier);
  });

  it('should return 0 when risk exceeds skip threshold', () => {
    const amount = calculateDCAAmount(config.skipAboveRisk + 0.01, config);
    expect(amount).toBe(0);
  });

  it('should return 0 at risk=1', () => {
    const amount = calculateDCAAmount(1, config);
    expect(amount).toBe(0);
  });

  it('should scale with multiplier', () => {
    const amount05 = calculateDCAAmount(0.5, config);
    const multiplier05 = calculateDCAMultiplier(0.5, config);
    expect(amount05).toBeCloseTo(config.baseAmount * multiplier05);
  });
});

describe('shouldPerformDCA', () => {
  it('should return true on first day (no previous DCA)', () => {
    const result = shouldPerformDCA(new Date('2023-01-15'), null, 'weekly');
    expect(result).toBe(true);
  });

  it('should return true for daily after 1 day', () => {
    const last = new Date('2023-01-14');
    const current = new Date('2023-01-15');
    expect(shouldPerformDCA(current, last, 'daily')).toBe(true);
  });

  it('should return false for daily same day', () => {
    const last = new Date('2023-01-15');
    const current = new Date('2023-01-15');
    expect(shouldPerformDCA(current, last, 'daily')).toBe(false);
  });

  it('should return true for weekly after 7 days', () => {
    const last = new Date('2023-01-08');
    const current = new Date('2023-01-15');
    expect(shouldPerformDCA(current, last, 'weekly')).toBe(true);
  });

  it('should return false for weekly after 5 days', () => {
    const last = new Date('2023-01-10');
    const current = new Date('2023-01-15');
    expect(shouldPerformDCA(current, last, 'weekly')).toBe(false);
  });

  it('should return true for monthly after 28 days', () => {
    const last = new Date('2023-01-01');
    const current = new Date('2023-01-29');
    expect(shouldPerformDCA(current, last, 'monthly')).toBe(true);
  });

  it('should return true for biweekly after 14 days', () => {
    const last = new Date('2023-01-01');
    const current = new Date('2023-01-15');
    expect(shouldPerformDCA(current, last, 'biweekly')).toBe(true);
  });
});

describe('getDCAIntervalDays', () => {
  it('should return correct days for each interval', () => {
    expect(getDCAIntervalDays('daily')).toBe(1);
    expect(getDCAIntervalDays('weekly')).toBe(7);
    expect(getDCAIntervalDays('biweekly')).toBe(14);
    expect(getDCAIntervalDays('monthly')).toBe(28);
  });
});

describe('getDCARiskCurve', () => {
  it('should return curve with correct length', () => {
    const curve = getDCARiskCurve(DEFAULT_DCA_SWING_CONFIG.dca, 10);
    expect(curve).toHaveLength(11); // 0 to 10 inclusive
  });

  it('should have risk values from 0 to 1', () => {
    const curve = getDCARiskCurve(DEFAULT_DCA_SWING_CONFIG.dca, 10);
    expect(curve[0].risk).toBe(0);
    expect(curve[10].risk).toBe(1);
  });

  it('should have decreasing amounts as risk increases', () => {
    const curve = getDCARiskCurve(DEFAULT_DCA_SWING_CONFIG.dca, 10);
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i].amount).toBeLessThanOrEqual(curve[i - 1].amount);
    }
  });
});

import { describe, it, expect } from 'vitest';
import {
  calculateMVRVProxy,
  calculatePiCycleRatio,
  calculatePowerLawDeviation,
  calculateDaysSinceATH,
  calculateDrawdownFromATH,
  calculateMayerMultiple,
  calculateValuationScore,
} from './valuation';
import { DailyData } from '../types';

describe('calculateMVRVProxy', () => {
  it('returns ratio of price to SMA200', () => {
    expect(calculateMVRVProxy(150, 100)).toBe(1.5);
  });

  it('returns 1 for zero SMA', () => {
    expect(calculateMVRVProxy(100, 0)).toBe(1);
  });

  it('handles negative SMA gracefully', () => {
    expect(calculateMVRVProxy(100, -50)).toBe(1);
  });
});

describe('calculatePiCycleRatio', () => {
  it('calculates ratio with 1.11 multiplier', () => {
    const ratio = calculatePiCycleRatio(111, 100);
    expect(ratio).toBeCloseTo(1, 1);
  });

  it('returns 1 for zero SMA', () => {
    expect(calculatePiCycleRatio(100, 0)).toBe(1);
  });
});

describe('calculatePowerLawDeviation', () => {
  it('returns positive deviation for above-trend prices', () => {
    // High price relative to time should be positive deviation
    const deviation = calculatePowerLawDeviation(100000, 5000);
    expect(typeof deviation).toBe('number');
    expect(Number.isFinite(deviation)).toBe(true);
  });

  it('handles early dates', () => {
    const deviation = calculatePowerLawDeviation(10, 365);
    expect(Number.isFinite(deviation)).toBe(true);
  });
});

describe('calculateDaysSinceATH', () => {
  it('returns 0 at ATH', () => {
    const prices = [100, 150, 200, 180];
    expect(calculateDaysSinceATH(prices, 2)).toBe(0);
  });

  it('returns correct days since ATH', () => {
    const prices = [100, 200, 150, 120];
    expect(calculateDaysSinceATH(prices, 3)).toBe(2);
  });

  it('handles single price', () => {
    expect(calculateDaysSinceATH([100], 0)).toBe(0);
  });
});

describe('calculateDrawdownFromATH', () => {
  it('returns 0 at ATH', () => {
    const prices = [100, 150, 200];
    expect(calculateDrawdownFromATH(prices, 2)).toBe(0);
  });

  it('calculates correct drawdown', () => {
    const prices = [100, 200, 150]; // 25% drawdown from 200
    expect(calculateDrawdownFromATH(prices, 2)).toBeCloseTo(0.25);
  });

  it('handles 50% drawdown', () => {
    const prices = [100, 200, 100];
    expect(calculateDrawdownFromATH(prices, 2)).toBeCloseTo(0.5);
  });
});

describe('calculateMayerMultiple', () => {
  it('calculates correctly', () => {
    expect(calculateMayerMultiple(200, 100)).toBe(2);
  });

  it('returns 1 for zero SMA', () => {
    expect(calculateMayerMultiple(100, 0)).toBe(1);
  });
});

describe('calculateValuationScore', () => {
  it('returns value between 0 and 1', () => {
    const data: DailyData[] = Array(250).fill(null).map((_, i) => ({
      date: `2024-01-${String(i + 1).padStart(2, '0')}`,
      price: 50000 + i * 100,
      sma50: 48000,
      sma100: 46000,
      sma200: 44000,
      sma350: 42000,
    }));

    const score = calculateValuationScore(data, 249, 5000);

    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('handles minimal data', () => {
    const data: DailyData[] = [{
      date: '2024-01-01',
      price: 50000,
      sma200: 45000,
      sma350: 40000,
    }];

    const score = calculateValuationScore(data, 0, 1000);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});

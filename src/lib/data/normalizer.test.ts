import { describe, it, expect } from 'vitest';
import {
  calculateReturn,
  calculateRealizedVol,
  calculateSMA,
  fillMissingDates,
  handleOutliers,
  calculateZScore,
  validateDailyData,
} from './normalizer';
import { PriceData } from '../types';

describe('calculateReturn', () => {
  it('calculates positive return correctly', () => {
    expect(calculateReturn(110, 100)).toBeCloseTo(0.1);
  });

  it('calculates negative return correctly', () => {
    expect(calculateReturn(90, 100)).toBeCloseTo(-0.1);
  });

  it('returns 0 for zero previous price', () => {
    expect(calculateReturn(100, 0)).toBe(0);
  });

  it('returns 0 for negative previous price', () => {
    expect(calculateReturn(100, -10)).toBe(0);
  });
});

describe('calculateRealizedVol', () => {
  it('calculates volatility for sufficient data', () => {
    const prices = [100, 102, 98, 105, 103, 107, 104, 110, 108, 112];
    const vol = calculateRealizedVol(prices, 5);
    expect(vol).toBeGreaterThan(0);
    expect(vol).toBeLessThan(5); // Reasonable range for daily volatility
  });

  it('returns 0 for insufficient data', () => {
    const prices = [100, 102, 98];
    expect(calculateRealizedVol(prices, 10)).toBe(0);
  });

  it('handles flat prices (zero volatility)', () => {
    const prices = Array(20).fill(100);
    expect(calculateRealizedVol(prices, 10)).toBe(0);
  });
});

describe('calculateSMA', () => {
  it('calculates SMA correctly', () => {
    const prices = [10, 20, 30, 40, 50];
    expect(calculateSMA(prices, 5)).toBe(30);
  });

  it('handles window larger than data', () => {
    const prices = [10, 20, 30];
    expect(calculateSMA(prices, 10)).toBe(30); // Returns last price
  });

  it('calculates partial SMA for window equal to length', () => {
    const prices = [10, 20, 30];
    expect(calculateSMA(prices, 3)).toBe(20);
  });
});

describe('fillMissingDates', () => {
  it('fills gaps in date series', () => {
    const data: PriceData[] = [
      { date: '2024-01-01', open: 100, high: 110, low: 90, close: 105 },
      { date: '2024-01-03', open: 105, high: 115, low: 95, close: 110 },
    ];

    const filled = fillMissingDates(data);

    expect(filled.length).toBe(3);
    expect(filled[0].date).toBe('2024-01-01');
    expect(filled[1].date).toBe('2024-01-02');
    expect(filled[2].date).toBe('2024-01-03');
    // Missing date should use forward-fill
    expect(filled[1].close).toBe(105);
  });

  it('handles empty input', () => {
    expect(fillMissingDates([])).toEqual([]);
  });

  it('handles single record', () => {
    const data: PriceData[] = [
      { date: '2024-01-01', open: 100, high: 110, low: 90, close: 105 },
    ];
    expect(fillMissingDates(data).length).toBe(1);
  });
});

describe('handleOutliers', () => {
  it('caps extreme values', () => {
    const values = [10, 20, 30, 40, 50, 1000]; // 1000 is outlier
    const handled = handleOutliers(values);

    expect(handled[handled.length - 1]).toBeLessThan(1000);
  });

  it('preserves normal values', () => {
    const values = [10, 20, 30, 40, 50];
    const handled = handleOutliers(values);

    expect(handled).toEqual(values);
  });

  it('handles small arrays', () => {
    const values = [10, 20];
    expect(handleOutliers(values)).toEqual(values);
  });
});

describe('calculateZScore', () => {
  it('calculates z-score correctly', () => {
    const values = [100, 100, 100, 100, 200]; // Last value is 1 std above mean
    const zScore = calculateZScore(values, 4, 5);

    expect(zScore).toBeGreaterThan(0);
  });

  it('returns 0 for insufficient data', () => {
    const values = [100];
    expect(calculateZScore(values, 0, 10)).toBe(0);
  });

  it('returns 0 for zero standard deviation', () => {
    const values = [100, 100, 100, 100, 100];
    expect(calculateZScore(values, 4, 5)).toBe(0);
  });
});

describe('validateDailyData', () => {
  it('validates correct data', () => {
    const data = [
      { date: '2024-01-01', price: 100 },
      { date: '2024-01-02', price: 105 },
    ];

    const result = validateDailyData(data);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('catches invalid dates', () => {
    const data = [
      { date: 'invalid', price: 100 },
    ];

    const result = validateDailyData(data);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('catches invalid prices', () => {
    const data = [
      { date: '2024-01-01', price: -100 },
    ];

    const result = validateDailyData(data);
    expect(result.valid).toBe(false);
  });

  it('catches NaN prices', () => {
    const data = [
      { date: '2024-01-01', price: NaN },
    ];

    const result = validateDailyData(data);
    expect(result.valid).toBe(false);
  });
});

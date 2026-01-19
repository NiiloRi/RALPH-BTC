import { describe, it, expect } from 'vitest';
import {
  calculateVolPercentile,
  calculateVolZScore,
  calculateMaxDrawdown,
  calculateDrawdownDuration,
  calculateATR,
  detectVolatilityRegime,
  calculateFragilityIndex,
  calculateVolatilityScore,
  getVolatilityComponents,
} from './volatility';
import { DailyData } from '../types';

describe('calculateVolPercentile', () => {
  it('returns 0.5 for empty history', () => {
    expect(calculateVolPercentile(0.5, [])).toBe(0.5);
  });

  it('calculates percentile correctly', () => {
    const history = [0.1, 0.2, 0.3, 0.4, 0.5];
    expect(calculateVolPercentile(0.3, history)).toBe(0.6); // 3/5 are <= 0.3
  });

  it('returns 1 for highest vol', () => {
    const history = [0.1, 0.2, 0.3];
    expect(calculateVolPercentile(0.5, history)).toBe(1);
  });

  it('returns low percentile for lowest vol', () => {
    const history = [0.3, 0.4, 0.5];
    expect(calculateVolPercentile(0.1, history)).toBe(0);
  });
});

describe('calculateVolZScore', () => {
  it('returns 0 for insufficient data', () => {
    expect(calculateVolZScore(0.5, [0.5])).toBe(0);
  });

  it('returns 0 for zero std dev', () => {
    expect(calculateVolZScore(0.5, [0.5, 0.5, 0.5])).toBe(0);
  });

  it('calculates positive z-score for above mean', () => {
    const history = [0.1, 0.2, 0.3, 0.4, 0.5];
    const zScore = calculateVolZScore(0.6, history);
    expect(zScore).toBeGreaterThan(0);
  });
});

describe('calculateMaxDrawdown', () => {
  it('calculates drawdown correctly', () => {
    const prices = [100, 110, 120, 100, 80]; // Peak 120, trough 80
    expect(calculateMaxDrawdown(prices, 5)).toBeCloseTo(0.333, 2);
  });

  it('returns 0 for insufficient data', () => {
    expect(calculateMaxDrawdown([100], 5)).toBe(0);
  });

  it('returns 0 for uptrend', () => {
    const prices = [100, 110, 120, 130];
    expect(calculateMaxDrawdown(prices, 4)).toBe(0);
  });
});

describe('calculateDrawdownDuration', () => {
  it('returns 0 at peak', () => {
    const prices = [100, 110, 120];
    expect(calculateDrawdownDuration(prices)).toBe(0);
  });

  it('calculates days since peak', () => {
    const prices = [100, 120, 110, 100, 90]; // Peak at index 1
    expect(calculateDrawdownDuration(prices)).toBe(3);
  });

  it('handles empty array', () => {
    expect(calculateDrawdownDuration([])).toBe(0);
  });
});

describe('calculateATR', () => {
  it('returns 0 for insufficient data', () => {
    const data: DailyData[] = Array(5).fill(null).map((_, i) => ({
      date: `2024-01-0${i + 1}`,
      price: 100,
    }));
    expect(calculateATR(data, 14)).toBe(0);
  });

  it('calculates ATR for sufficient data', () => {
    const data: DailyData[] = Array(20).fill(null).map((_, i) => ({
      date: `2024-01-${String(i + 1).padStart(2, '0')}`,
      price: 100 + (i % 2 === 0 ? 5 : -5),
    }));
    const atr = calculateATR(data, 14);
    expect(atr).toBeGreaterThan(0);
  });
});

describe('detectVolatilityRegime', () => {
  it('returns low for bottom 20%', () => {
    const history = [0.2, 0.3, 0.4, 0.5, 0.6];
    expect(detectVolatilityRegime(0.1, history)).toBe('low');
  });

  it('returns normal for middle range', () => {
    const history = [0.1, 0.2, 0.3, 0.4, 0.5];
    expect(detectVolatilityRegime(0.25, history)).toBe('normal');
  });

  it('returns high for upper range', () => {
    const history = [0.1, 0.2, 0.3, 0.4, 0.5];
    expect(detectVolatilityRegime(0.45, history)).toBe('high');
  });

  it('returns extreme for top 10%', () => {
    const history = [0.1, 0.2, 0.3, 0.4, 0.5];
    expect(detectVolatilityRegime(0.9, history)).toBe('extreme');
  });
});

describe('calculateFragilityIndex', () => {
  it('returns 0.5 for insufficient data', () => {
    const data: DailyData[] = Array(50).fill(null).map((_, i) => ({
      date: `2024-01-${String(i + 1).padStart(2, '0')}`,
      price: 50000,
      realizedVol30d: 0.5,
    }));
    expect(calculateFragilityIndex(data, 49)).toBe(0.5);
  });

  it('returns value between 0 and 1', () => {
    const data: DailyData[] = Array(150).fill(null).map((_, i) => ({
      date: `2024-01-${String(i + 1).padStart(2, '0')}`,
      price: 50000 + i * 100,
      realizedVol30d: 0.5,
      return1d: 0.01,
    }));
    const fragility = calculateFragilityIndex(data, 149);
    expect(fragility).toBeGreaterThanOrEqual(0);
    expect(fragility).toBeLessThanOrEqual(1);
  });
});

describe('calculateVolatilityScore', () => {
  it('returns 0.5 for insufficient data', () => {
    const data: DailyData[] = Array(50).fill(null).map((_, i) => ({
      date: `2024-01-${String(i + 1).padStart(2, '0')}`,
      price: 50000,
    }));
    expect(calculateVolatilityScore(data, 49)).toBe(0.5);
  });

  it('returns value between 0 and 1 for sufficient data', () => {
    const data: DailyData[] = Array(200).fill(null).map((_, i) => ({
      date: `2024-01-${String(i + 1).padStart(2, '0')}`,
      price: 50000 + i * 50,
      realizedVol30d: 0.5,
      return1d: 0.01,
    }));
    const score = calculateVolatilityScore(data, 199);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});

describe('getVolatilityComponents', () => {
  it('returns all components', () => {
    const data: DailyData[] = Array(200).fill(null).map((_, i) => ({
      date: `2024-01-${String(i + 1).padStart(2, '0')}`,
      price: 50000 + i * 50,
      realizedVol30d: 0.5,
      return1d: 0.01,
    }));
    const components = getVolatilityComponents(data, 199);

    expect(components).toHaveProperty('realizedVol30d');
    expect(components).toHaveProperty('volPercentile');
    expect(components).toHaveProperty('volZScore');
    expect(components).toHaveProperty('maxDrawdown30d');
    expect(components).toHaveProperty('maxDrawdown90d');
    expect(components).toHaveProperty('drawdownDuration');
    expect(components).toHaveProperty('fragility');
    expect(components).toHaveProperty('volatilityRegime');
  });
});

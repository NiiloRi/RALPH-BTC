import { describe, it, expect } from 'vitest';
import {
  calculateDXYZScore,
  calculateRiskSentiment,
  calculateLiquidityProxy,
  calculateMacroScore,
  getMacroComponents,
} from './macro';
import { DailyData } from '../types';

describe('calculateDXYZScore', () => {
  it('returns 0 for insufficient data', () => {
    const values = [100, 101, 102];
    expect(calculateDXYZScore(values, 2, 365)).toBe(0);
  });

  it('returns 0 for undefined current value', () => {
    const values: (number | undefined)[] = [100, 101, 102, undefined];
    expect(calculateDXYZScore(values, 3, 365)).toBe(0);
  });

  it('calculates positive z-score for above-mean value', () => {
    const values = Array(100).fill(100);
    values[99] = 110; // Last value is above mean
    const zScore = calculateDXYZScore(values, 99, 100);
    expect(zScore).toBeGreaterThan(0);
  });

  it('calculates negative z-score for below-mean value', () => {
    const values = Array(100).fill(100);
    values[99] = 90; // Last value is below mean
    const zScore = calculateDXYZScore(values, 99, 100);
    expect(zScore).toBeLessThan(0);
  });
});

describe('calculateRiskSentiment', () => {
  it('returns positive for weak dollar and strong BTC', () => {
    const sentiment = calculateRiskSentiment(-1, 0.5);
    expect(sentiment).toBeGreaterThan(0);
  });

  it('returns negative for strong dollar and weak BTC', () => {
    const sentiment = calculateRiskSentiment(1, -0.3);
    expect(sentiment).toBeLessThan(0);
  });

  it('returns neutral for mixed signals', () => {
    const sentiment = calculateRiskSentiment(0, 0);
    expect(sentiment).toBe(0);
  });
});

describe('calculateLiquidityProxy', () => {
  it('returns 0.5 for insufficient data', () => {
    const data: DailyData[] = Array(50).fill(null).map((_, i) => ({
      date: `2024-01-${String(i + 1).padStart(2, '0')}`,
      price: 50000,
    }));
    expect(calculateLiquidityProxy(data, 49)).toBe(0.5);
  });

  it('returns value between 0 and 1', () => {
    const data: DailyData[] = Array(200).fill(null).map((_, i) => ({
      date: `2024-01-${String(i + 1).padStart(2, '0')}`,
      price: 50000 + i * 100,
      realizedVol30d: 0.5,
    }));
    const liquidity = calculateLiquidityProxy(data, 199);
    expect(liquidity).toBeGreaterThanOrEqual(0);
    expect(liquidity).toBeLessThanOrEqual(1);
  });
});

describe('calculateMacroScore', () => {
  it('returns 0.5 for insufficient data', () => {
    const data: DailyData[] = Array(10).fill(null).map((_, i) => ({
      date: `2024-01-${String(i + 1).padStart(2, '0')}`,
      price: 50000,
    }));
    expect(calculateMacroScore(data, 9)).toBe(0.5);
  });

  it('returns value between 0 and 1', () => {
    const data: DailyData[] = Array(200).fill(null).map((_, i) => ({
      date: `2024-01-${String(i + 1).padStart(2, '0')}`,
      price: 50000 + i * 50,
      realizedVol30d: 0.5,
      return90d: 0.2,
    }));
    const score = calculateMacroScore(data, 199);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('incorporates DXY when available', () => {
    const dataWithDXY: DailyData[] = Array(200).fill(null).map((_, i) => ({
      date: `2024-01-${String(i + 1).padStart(2, '0')}`,
      price: 50000,
      realizedVol30d: 0.5,
      return90d: 0,
      dxy: 100,
    }));

    const dataWithoutDXY: DailyData[] = Array(200).fill(null).map((_, i) => ({
      date: `2024-01-${String(i + 1).padStart(2, '0')}`,
      price: 50000,
      realizedVol30d: 0.5,
      return90d: 0,
    }));

    // Both should work and return valid values
    const scoreWithDXY = calculateMacroScore(dataWithDXY, 199);
    const scoreWithoutDXY = calculateMacroScore(dataWithoutDXY, 199);

    expect(scoreWithDXY).toBeGreaterThanOrEqual(0);
    expect(scoreWithDXY).toBeLessThanOrEqual(1);
    expect(scoreWithoutDXY).toBeGreaterThanOrEqual(0);
    expect(scoreWithoutDXY).toBeLessThanOrEqual(1);
  });
});

describe('getMacroComponents', () => {
  it('returns all components', () => {
    const data: DailyData[] = Array(200).fill(null).map((_, i) => ({
      date: `2024-01-${String(i + 1).padStart(2, '0')}`,
      price: 50000 + i * 50,
      realizedVol30d: 0.5,
      return90d: 0.1,
      dxy: 100 + (i % 10) * 0.1,
    }));
    const components = getMacroComponents(data, 199);

    expect(components).toHaveProperty('dxy');
    expect(components).toHaveProperty('dxyZScore');
    expect(components).toHaveProperty('liquidityProxy');
    expect(components).toHaveProperty('btcSentiment');
  });

  it('handles missing DXY', () => {
    const data: DailyData[] = Array(200).fill(null).map((_, i) => ({
      date: `2024-01-${String(i + 1).padStart(2, '0')}`,
      price: 50000 + i * 50,
      return90d: 0.1,
    }));
    const components = getMacroComponents(data, 199);

    expect(components.dxy).toBeUndefined();
    expect(components.dxyZScore).toBe(0);
  });
});

import { describe, it, expect } from 'vitest';
import {
  calculateAttentionProxy,
  calculateFearGreedProxy,
  calculateAttentionScore,
  getAttentionComponents,
} from './attention';
import { DailyData } from '../types';

describe('calculateAttentionProxy', () => {
  it('returns 0.5 for insufficient data', () => {
    const data: DailyData[] = Array(10).fill(null).map((_, i) => ({
      date: `2024-01-${String(i + 1).padStart(2, '0')}`,
      price: 50000,
    }));
    expect(calculateAttentionProxy(data, 9)).toBe(0.5);
  });

  it('returns value between 0 and 1 for sufficient data', () => {
    const data: DailyData[] = Array(100).fill(null).map((_, i) => ({
      date: `2024-01-${String(i + 1).padStart(2, '0')}`,
      price: 50000 + i * 100,
      return7d: 0.05,
      return30d: 0.15,
      realizedVol30d: 0.6,
    }));
    const proxy = calculateAttentionProxy(data, 99);
    expect(proxy).toBeGreaterThanOrEqual(0);
    expect(proxy).toBeLessThanOrEqual(1);
  });

  it('returns higher value for ATH proximity', () => {
    const data: DailyData[] = Array(100).fill(null).map((_, i) => ({
      date: `2024-01-${String(i + 1).padStart(2, '0')}`,
      price: i === 99 ? 60000 : 50000, // Last price is ATH
      return7d: 0.1,
      return30d: 0.2,
      realizedVol30d: 0.5,
    }));
    const atATH = calculateAttentionProxy(data, 99);

    const dataNotATH: DailyData[] = Array(100).fill(null).map((_, i) => ({
      date: `2024-01-${String(i + 1).padStart(2, '0')}`,
      price: i === 50 ? 60000 : 50000, // ATH in the middle
      return7d: 0.1,
      return30d: 0.2,
      realizedVol30d: 0.5,
    }));
    const notAtATH = calculateAttentionProxy(dataNotATH, 99);

    expect(atATH).toBeGreaterThan(notAtATH);
  });
});

describe('calculateFearGreedProxy', () => {
  it('returns 50 for insufficient data', () => {
    const data: DailyData[] = Array(50).fill(null).map((_, i) => ({
      date: `2024-01-${String(i + 1).padStart(2, '0')}`,
      price: 50000,
    }));
    expect(calculateFearGreedProxy(data, 49)).toBe(50);
  });

  it('returns value between 0 and 100', () => {
    const data: DailyData[] = Array(200).fill(null).map((_, i) => ({
      date: `2024-01-${String(i + 1).padStart(2, '0')}`,
      price: 50000 + i * 50,
      return30d: 0.1,
      realizedVol30d: 0.5,
      sma200: 48000,
    }));
    const fg = calculateFearGreedProxy(data, 199);
    expect(fg).toBeGreaterThanOrEqual(0);
    expect(fg).toBeLessThanOrEqual(100);
  });
});

describe('calculateAttentionScore', () => {
  it('returns 0.5 for insufficient data', () => {
    const data: DailyData[] = Array(10).fill(null).map((_, i) => ({
      date: `2024-01-${String(i + 1).padStart(2, '0')}`,
      price: 50000,
    }));
    expect(calculateAttentionScore(data, 9)).toBe(0.5);
  });

  it('uses googleTrends if available', () => {
    const data: DailyData[] = Array(100).fill(null).map((_, i) => ({
      date: `2024-01-${String(i + 1).padStart(2, '0')}`,
      price: 50000,
      googleTrends: 75,
    }));
    expect(calculateAttentionScore(data, 99)).toBe(0.75);
  });

  it('uses fearGreedIndex if googleTrends not available', () => {
    const data: DailyData[] = Array(100).fill(null).map((_, i) => ({
      date: `2024-01-${String(i + 1).padStart(2, '0')}`,
      price: 50000,
      fearGreedIndex: 80,
    }));
    expect(calculateAttentionScore(data, 99)).toBe(0.8);
  });

  it('falls back to proxy when no external data', () => {
    const data: DailyData[] = Array(100).fill(null).map((_, i) => ({
      date: `2024-01-${String(i + 1).padStart(2, '0')}`,
      price: 50000 + i * 50,
      return7d: 0.05,
      return30d: 0.1,
      realizedVol30d: 0.5,
    }));
    const score = calculateAttentionScore(data, 99);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});

describe('getAttentionComponents', () => {
  it('returns all components', () => {
    const data: DailyData[] = Array(200).fill(null).map((_, i) => ({
      date: `2024-01-${String(i + 1).padStart(2, '0')}`,
      price: 50000 + i * 50,
      return7d: 0.05,
      return30d: 0.1,
      realizedVol30d: 0.5,
      googleTrends: 60,
      fearGreedIndex: 55,
    }));
    const components = getAttentionComponents(data, 199);

    expect(components).toHaveProperty('googleTrends');
    expect(components).toHaveProperty('fearGreedIndex');
    expect(components).toHaveProperty('attentionProxy');
    expect(components).toHaveProperty('fearGreedProxy');
    expect(components).toHaveProperty('athProximity');
    expect(components.googleTrends).toBe(60);
    expect(components.fearGreedIndex).toBe(55);
  });
});

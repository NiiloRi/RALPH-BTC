import { describe, it, expect } from 'vitest';
import {
  calculateRSI,
  calculateROC,
  detectCrossover,
  isAboveMAs,
  distanceFromMA,
  calculateTrendStrength,
  calculateMomentumScore,
} from './momentum';
import { DailyData } from '../types';

describe('calculateRSI', () => {
  it('returns 50 for insufficient data', () => {
    const prices = [100, 102, 98];
    expect(calculateRSI(prices, 14)).toBe(50);
  });

  it('returns high RSI for uptrend', () => {
    // Prices going up consistently
    const prices = Array(20).fill(0).map((_, i) => 100 + i * 2);
    const rsi = calculateRSI(prices, 14);
    expect(rsi).toBeGreaterThan(50);
  });

  it('returns low RSI for downtrend', () => {
    // Prices going down consistently
    const prices = Array(20).fill(0).map((_, i) => 200 - i * 2);
    const rsi = calculateRSI(prices, 14);
    expect(rsi).toBeLessThan(50);
  });

  it('handles flat prices', () => {
    const prices = Array(20).fill(100);
    const rsi = calculateRSI(prices, 14);
    // With no losses, RSI is 100 (all gains are 0, avgLoss is 0)
    expect(rsi).toBe(100);
  });

  it('returns 100 for all gains', () => {
    const prices = Array(20).fill(0).map((_, i) => 100 + i);
    const rsi = calculateRSI(prices, 14);
    expect(rsi).toBe(100);
  });
});

describe('calculateROC', () => {
  it('calculates positive rate of change', () => {
    expect(calculateROC(110, 100)).toBe(10);
  });

  it('calculates negative rate of change', () => {
    expect(calculateROC(90, 100)).toBe(-10);
  });

  it('returns 0 for zero previous', () => {
    expect(calculateROC(100, 0)).toBe(0);
  });
});

describe('detectCrossover', () => {
  it('detects golden cross', () => {
    // SMA50 crosses above SMA200
    expect(detectCrossover(101, 100, 99, 100)).toBe(1);
  });

  it('detects death cross', () => {
    // SMA50 crosses below SMA200
    expect(detectCrossover(99, 100, 101, 100)).toBe(-1);
  });

  it('returns 0 for no crossover', () => {
    expect(detectCrossover(101, 100, 101, 100)).toBe(0);
    expect(detectCrossover(99, 100, 99, 100)).toBe(0);
  });
});

describe('isAboveMAs', () => {
  it('correctly identifies price above both MAs', () => {
    const result = isAboveMAs(110, 100, 90);
    expect(result.above50).toBe(true);
    expect(result.above200).toBe(true);
    expect(result.sma50Above200).toBe(true);
  });

  it('correctly identifies price below both MAs', () => {
    const result = isAboveMAs(80, 100, 90);
    expect(result.above50).toBe(false);
    expect(result.above200).toBe(false);
    expect(result.sma50Above200).toBe(true);
  });

  it('handles mixed conditions', () => {
    const result = isAboveMAs(95, 100, 90);
    expect(result.above50).toBe(false);
    expect(result.above200).toBe(true);
  });
});

describe('distanceFromMA', () => {
  it('calculates positive distance', () => {
    expect(distanceFromMA(110, 100)).toBe(10);
  });

  it('calculates negative distance', () => {
    expect(distanceFromMA(90, 100)).toBe(-10);
  });

  it('returns 0 for zero MA', () => {
    expect(distanceFromMA(100, 0)).toBe(0);
  });
});

describe('calculateTrendStrength', () => {
  it('returns high strength for strong trend', () => {
    // Strong uptrend
    const prices = Array(20).fill(0).map((_, i) => 100 + i * 5);
    const strength = calculateTrendStrength(prices, 14);
    expect(strength).toBeGreaterThan(0.5);
  });

  it('returns low strength for choppy market', () => {
    // Alternating up/down
    const prices = Array(20).fill(0).map((_, i) => 100 + (i % 2 === 0 ? 5 : -5));
    const strength = calculateTrendStrength(prices, 14);
    expect(strength).toBeLessThan(0.3);
  });

  it('returns 0 for insufficient data', () => {
    expect(calculateTrendStrength([100, 102], 14)).toBe(0);
  });
});

describe('calculateMomentumScore', () => {
  it('returns value between 0 and 1', () => {
    const data: DailyData[] = Array(250).fill(null).map((_, i) => ({
      date: `2024-01-${String(i + 1).padStart(2, '0')}`,
      price: 50000 + i * 50,
      return7d: 0.05,
      return30d: 0.15,
      return90d: 0.4,
      sma50: 48000,
      sma200: 45000,
    }));

    const score = calculateMomentumScore(data, 249);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('returns 0.5 for insufficient data', () => {
    const data: DailyData[] = Array(50).fill(null).map((_, i) => ({
      date: `2024-01-${String(i + 1).padStart(2, '0')}`,
      price: 50000,
    }));

    const score = calculateMomentumScore(data, 49);
    expect(score).toBe(0.5);
  });
});

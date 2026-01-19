import { describe, it, expect } from 'vitest';
import {
  buildFeatureVector,
  buildAllFeatures,
  validateFeatureVector,
  getAllFeatureComponents,
} from './index';
import { DailyData, FeatureVector } from '../types';

// Helper to create mock daily data
function createMockDailyData(count: number): DailyData[] {
  return Array(count).fill(null).map((_, i) => ({
    date: `2024-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
    price: 50000 + i * 50,
    return1d: 0.01,
    return7d: 0.05,
    return30d: 0.15,
    return90d: 0.4,
    return365d: 1.0,
    sma50: 49000,
    sma100: 48000,
    sma200: 45000,
    sma350: 40000,
    realizedVol30d: 0.5,
    realizedVol90d: 0.55,
  }));
}

describe('buildFeatureVector', () => {
  it('builds complete feature vector', () => {
    const data = createMockDailyData(250);
    const fv = buildFeatureVector(data, 249);

    expect(fv.date).toBe(data[249].date);
    expect(fv.price).toBe(data[249].price);
    expect(fv.valuationScore).toBeGreaterThanOrEqual(0);
    expect(fv.valuationScore).toBeLessThanOrEqual(1);
    expect(fv.momentumScore).toBeGreaterThanOrEqual(0);
    expect(fv.momentumScore).toBeLessThanOrEqual(1);
    expect(fv.volatilityScore).toBeGreaterThanOrEqual(0);
    expect(fv.volatilityScore).toBeLessThanOrEqual(1);
    expect(fv.cycleScore).toBeGreaterThanOrEqual(0);
    expect(fv.cycleScore).toBeLessThanOrEqual(1);
  });

  it('includes cycle phase', () => {
    const data = createMockDailyData(250);
    const fv = buildFeatureVector(data, 249);

    expect(['early', 'mid', 'late']).toContain(fv.cyclePhase);
  });
});

describe('buildAllFeatures', () => {
  it('builds features starting from specified index', () => {
    const data = createMockDailyData(300);
    const features = buildAllFeatures(data, 200);

    expect(features.length).toBe(100); // 300 - 200 = 100
    expect(features[0].date).toBe(data[200].date);
  });

  it('defaults to starting at index 200', () => {
    const data = createMockDailyData(300);
    const features = buildAllFeatures(data);

    expect(features.length).toBe(100);
  });
});

describe('validateFeatureVector', () => {
  it('validates correct feature vector', () => {
    const data = createMockDailyData(250);
    const fv = buildFeatureVector(data, 249);
    const result = validateFeatureVector(fv);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('catches invalid scores', () => {
    const fv: FeatureVector = {
      date: '2024-01-01',
      valuationScore: 1.5, // Invalid: > 1
      priceToSma200Ratio: 1,
      priceToSma350x111Ratio: 1,
      daysSinceATH: 0,
      drawdownFromATH: 0,
      momentumScore: 0.5,
      return30d: 0,
      return90d: 0,
      sma50Above200: true,
      volatilityScore: 0.5,
      realizedVol30d: 0.5,
      volZScore: 0,
      cycleScore: 0.5,
      daysSinceHalving: 100,
      cyclePhase: 'mid',
      estimatedCycleProgress: 0.5,
      prevCycleLow: 3200,
      prevCycleHigh: 69000,
      cycleRelativePrice: 0.7,
      macroScore: 0.5,
      dxyZScore: 0,
      attentionScore: 0.5,
      price: 50000,
    };

    const result = validateFeatureVector(fv);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('catches invalid price', () => {
    const fv: FeatureVector = {
      date: '2024-01-01',
      valuationScore: 0.5,
      priceToSma200Ratio: 1,
      priceToSma350x111Ratio: 1,
      daysSinceATH: 0,
      drawdownFromATH: 0,
      momentumScore: 0.5,
      return30d: 0,
      return90d: 0,
      sma50Above200: true,
      volatilityScore: 0.5,
      realizedVol30d: 0.5,
      volZScore: 0,
      cycleScore: 0.5,
      daysSinceHalving: 100,
      cyclePhase: 'mid',
      estimatedCycleProgress: 0.5,
      prevCycleLow: 3200,
      prevCycleHigh: 69000,
      cycleRelativePrice: 0.7,
      macroScore: 0.5,
      dxyZScore: 0,
      attentionScore: 0.5,
      price: -100, // Invalid
    };

    const result = validateFeatureVector(fv);
    expect(result.valid).toBe(false);
  });

  it('catches invalid date format', () => {
    const fv: FeatureVector = {
      date: 'invalid-date',
      valuationScore: 0.5,
      priceToSma200Ratio: 1,
      priceToSma350x111Ratio: 1,
      daysSinceATH: 0,
      drawdownFromATH: 0,
      momentumScore: 0.5,
      return30d: 0,
      return90d: 0,
      sma50Above200: true,
      volatilityScore: 0.5,
      realizedVol30d: 0.5,
      volZScore: 0,
      cycleScore: 0.5,
      daysSinceHalving: 100,
      cyclePhase: 'mid',
      estimatedCycleProgress: 0.5,
      prevCycleLow: 3200,
      prevCycleHigh: 69000,
      cycleRelativePrice: 0.7,
      macroScore: 0.5,
      dxyZScore: 0,
      attentionScore: 0.5,
      price: 50000,
    };

    const result = validateFeatureVector(fv);
    expect(result.valid).toBe(false);
  });
});

describe('getAllFeatureComponents', () => {
  it('returns all component categories', () => {
    const data = createMockDailyData(250);
    const components = getAllFeatureComponents(data, 249);

    expect(components).toHaveProperty('valuation');
    expect(components).toHaveProperty('momentum');
    expect(components).toHaveProperty('volatility');
    expect(components).toHaveProperty('cycle');
    expect(components).toHaveProperty('macro');
    expect(components).toHaveProperty('attention');
  });
});

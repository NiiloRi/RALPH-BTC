import { describe, it, expect } from 'vitest';
import {
  sigmoid,
  calculateRawEnsemble,
  applyCalibration,
  applySmoothing,
  clampRisk,
  calculateRisk,
  calculateAllRisks,
  normalizeWeights,
  getRiskLevel,
  DEFAULT_WEIGHTS,
} from './model';
import { FeatureVector } from '../types';

describe('sigmoid', () => {
  it('returns 0.5 for input 0', () => {
    expect(sigmoid(0)).toBeCloseTo(0.5);
  });

  it('approaches 1 for large positive inputs', () => {
    expect(sigmoid(10)).toBeCloseTo(1, 3);
  });

  it('approaches 0 for large negative inputs', () => {
    expect(sigmoid(-10)).toBeCloseTo(0, 3);
  });

  it('is monotonically increasing', () => {
    expect(sigmoid(1)).toBeGreaterThan(sigmoid(0));
    expect(sigmoid(0)).toBeGreaterThan(sigmoid(-1));
  });
});

describe('calculateRawEnsemble', () => {
  const mockFeatures: FeatureVector = {
    date: '2024-01-01',
    valuationScore: 0.6,
    priceToSma200Ratio: 1.2,
    priceToSma350x111Ratio: 1.1,
    daysSinceATH: 30,
    drawdownFromATH: 0.1,
    momentumScore: 0.5,
    return30d: 0.1,
    return90d: 0.2,
    sma50Above200: true,
    volatilityScore: 0.4,
    realizedVol30d: 0.5,
    volZScore: 0.5,
    cycleScore: 0.7,
    daysSinceHalving: 200,
    cyclePhase: 'mid',
    estimatedCycleProgress: 0.4,
    prevCycleLow: 3200,
    prevCycleHigh: 69000,
    cycleRelativePrice: 0.7,
    macroScore: 0.5,
    dxyZScore: 0,
    m2Signal: 0.5,
    fedFundsSignal: 0.5,
    yieldCurveSignal: 0.5,
    realRateSignal: 0.5,
    dynamicMacroWeight: 0.14,
    attentionScore: 0.6,
    price: 50000,
  };

  it('calculates weighted average correctly', () => {
    const result = calculateRawEnsemble(mockFeatures);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(1);
  });

  it('respects custom weights', () => {
    const highValWeight = { ...DEFAULT_WEIGHTS, valuation: 1, momentum: 0 };
    const highMomWeight = { ...DEFAULT_WEIGHTS, valuation: 0, momentum: 1 };

    const valResult = calculateRawEnsemble(mockFeatures, normalizeWeights(highValWeight));
    const momResult = calculateRawEnsemble(mockFeatures, normalizeWeights(highMomWeight));

    // Higher valuation weight should give result closer to valuation score
    expect(Math.abs(valResult - 0.6)).toBeLessThan(Math.abs(momResult - 0.6));
  });

  it('returns 0.5 for zero total weight', () => {
    const zeroWeights = { valuation: 0, momentum: 0, volatility: 0, cycle: 0, macro: 0, attention: 0 };
    expect(calculateRawEnsemble(mockFeatures, zeroWeights)).toBe(0.5);
  });
});

describe('applyCalibration', () => {
  it('returns 0.5 for input at center', () => {
    expect(applyCalibration(0.5, 4, 0.5)).toBeCloseTo(0.5);
  });

  it('returns higher value for input above center', () => {
    expect(applyCalibration(0.7, 4, 0.5)).toBeGreaterThan(0.5);
  });

  it('returns lower value for input below center', () => {
    expect(applyCalibration(0.3, 4, 0.5)).toBeLessThan(0.5);
  });

  it('steeper slope compresses range more', () => {
    const gentle = applyCalibration(0.8, 2, 0.5);
    const steep = applyCalibration(0.8, 8, 0.5);
    expect(steep).toBeGreaterThan(gentle);
  });
});

describe('applySmoothing', () => {
  it('returns current value when no previous', () => {
    expect(applySmoothing(0.6, NaN, 0.3)).toBe(0.6);
  });

  it('applies EMA correctly', () => {
    const result = applySmoothing(0.8, 0.4, 0.3);
    // EMA = 0.3 * 0.8 + 0.7 * 0.4 = 0.24 + 0.28 = 0.52
    expect(result).toBeCloseTo(0.52);
  });

  it('higher smoothing factor means faster response', () => {
    const fast = applySmoothing(0.8, 0.4, 0.9);
    const slow = applySmoothing(0.8, 0.4, 0.1);
    expect(fast).toBeGreaterThan(slow);
  });
});

describe('clampRisk', () => {
  it('clamps values above 1', () => {
    expect(clampRisk(1.5)).toBe(1);
  });

  it('clamps values below 0', () => {
    expect(clampRisk(-0.5)).toBe(0);
  });

  it('preserves values in range', () => {
    expect(clampRisk(0.5)).toBe(0.5);
  });
});

describe('calculateRisk', () => {
  const mockFeatures: FeatureVector = {
    date: '2024-01-01',
    valuationScore: 0.6,
    priceToSma200Ratio: 1.2,
    priceToSma350x111Ratio: 1.1,
    daysSinceATH: 30,
    drawdownFromATH: 0.1,
    momentumScore: 0.5,
    return30d: 0.1,
    return90d: 0.2,
    sma50Above200: true,
    volatilityScore: 0.4,
    realizedVol30d: 0.5,
    volZScore: 0.5,
    cycleScore: 0.7,
    daysSinceHalving: 200,
    cyclePhase: 'mid',
    estimatedCycleProgress: 0.4,
    prevCycleLow: 3200,
    prevCycleHigh: 69000,
    cycleRelativePrice: 0.7,
    macroScore: 0.5,
    dxyZScore: 0,
    m2Signal: 0.5,
    fedFundsSignal: 0.5,
    yieldCurveSignal: 0.5,
    realRateSignal: 0.5,
    dynamicMacroWeight: 0.14,
    attentionScore: 0.6,
    price: 50000,
  };

  it('returns RiskOutput with all required fields', () => {
    const result = calculateRisk(mockFeatures);

    expect(result.date).toBe('2024-01-01');
    expect(result.price).toBe(50000);
    expect(result.risk).toBeGreaterThanOrEqual(0);
    expect(result.risk).toBeLessThanOrEqual(1);
    expect(result.smoothedRisk).toBeGreaterThanOrEqual(0);
    expect(result.smoothedRisk).toBeLessThanOrEqual(1);
    expect(result.components).toBeDefined();
  });

  it('applies smoothing when previous risk provided', () => {
    const result = calculateRisk(mockFeatures, DEFAULT_WEIGHTS, { slope: 4, center: 0.5 }, 0.2, 0.3);
    // Smoothed should be closer to 0.2 than unsmoothed
    expect(Math.abs(result.smoothedRisk - 0.2)).toBeLessThan(Math.abs(result.risk - 0.2));
  });
});

describe('calculateAllRisks', () => {
  const mockFeatures: FeatureVector[] = [
    {
      date: '2024-01-01',
      valuationScore: 0.3,
      priceToSma200Ratio: 0.9,
      priceToSma350x111Ratio: 0.85,
      daysSinceATH: 100,
      drawdownFromATH: 0.3,
      momentumScore: 0.4,
      return30d: -0.1,
      return90d: -0.15,
      sma50Above200: false,
      volatilityScore: 0.5,
      realizedVol30d: 0.6,
      volZScore: 0.8,
      cycleScore: 0.5,
      daysSinceHalving: 600,
      cyclePhase: 'late',
      estimatedCycleProgress: 0.7,
      prevCycleLow: 3200,
      prevCycleHigh: 69000,
      cycleRelativePrice: 0.56,
      macroScore: 0.4,
      dxyZScore: 0.5,
    m2Signal: 0.5,
    fedFundsSignal: 0.5,
    yieldCurveSignal: 0.5,
    realRateSignal: 0.5,
    dynamicMacroWeight: 0.14,
      attentionScore: 0.3,
      price: 40000,
    },
    {
      date: '2024-01-02',
      valuationScore: 0.7,
      priceToSma200Ratio: 1.3,
      priceToSma350x111Ratio: 1.2,
      daysSinceATH: 5,
      drawdownFromATH: 0.05,
      momentumScore: 0.8,
      return30d: 0.3,
      return90d: 0.5,
      sma50Above200: true,
      volatilityScore: 0.6,
      realizedVol30d: 0.7,
      volZScore: 1.2,
      cycleScore: 0.8,
      daysSinceHalving: 601,
      cyclePhase: 'late',
      estimatedCycleProgress: 0.71,
      prevCycleLow: 3200,
      prevCycleHigh: 69000,
      cycleRelativePrice: 0.79,
      macroScore: 0.6,
      dxyZScore: -0.3,
    m2Signal: 0.5,
    fedFundsSignal: 0.5,
    yieldCurveSignal: 0.5,
    realRateSignal: 0.5,
    dynamicMacroWeight: 0.14,
      attentionScore: 0.8,
      price: 55000,
    },
  ];

  it('processes all features', () => {
    const results = calculateAllRisks(mockFeatures);
    expect(results.length).toBe(2);
  });

  it('applies smoothing across sequence', () => {
    const results = calculateAllRisks(mockFeatures, DEFAULT_WEIGHTS, { slope: 4, center: 0.5 }, 0.3);

    // First point: smoothed = risk (no previous)
    expect(results[0].smoothedRisk).toBe(results[0].risk);

    // Second point: smoothed should be influenced by first
    expect(results[1].smoothedRisk).not.toBe(results[1].risk);
  });
});

describe('normalizeWeights', () => {
  it('normalizes to sum of 1', () => {
    const weights = { a: 2, b: 3, c: 5 };
    const normalized = normalizeWeights(weights);
    const sum = Object.values(normalized).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1);
  });

  it('handles zero total', () => {
    const weights = { a: 0, b: 0 };
    const normalized = normalizeWeights(weights);
    expect(normalized).toEqual(weights);
  });

  it('preserves relative proportions', () => {
    const weights = { a: 10, b: 20 };
    const normalized = normalizeWeights(weights);
    expect(normalized.b / normalized.a).toBeCloseTo(2);
  });
});

describe('getRiskLevel', () => {
  it('returns correct levels for all ranges', () => {
    expect(getRiskLevel(0.1).level).toBe('low');
    expect(getRiskLevel(0.3).level).toBe('moderate-low');
    expect(getRiskLevel(0.5).level).toBe('neutral');
    expect(getRiskLevel(0.7).level).toBe('moderate-high');
    expect(getRiskLevel(0.9).level).toBe('high');
  });

  it('includes description', () => {
    const result = getRiskLevel(0.1);
    expect(result.description).toBeTruthy();
    expect(typeof result.description).toBe('string');
  });
});

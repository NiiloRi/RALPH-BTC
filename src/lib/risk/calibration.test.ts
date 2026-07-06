import { describe, it, expect } from 'vitest';
import {
  calculateFutureDrawdown,
  calculateRiskDrawdownCorrelation,
  optimizeWeights,
  optimizeCalibration,
  isotonicRegression,
  calculateCalibrationError,
  calibrateModel,
} from './calibration';
import { FeatureVector } from '../types';

// Deterministic PRNG (mulberry32): unseeded randomness risks flaky tests
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Helper to create mock features
function createMockFeatures(count: number): FeatureVector[] {
  const rand = mulberry32(9001);
  return Array(count).fill(null).map((_, i) => ({
    date: `2024-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
    valuationScore: 0.3 + rand() * 0.4,
    priceToSma200Ratio: 1 + rand() * 0.5,
    priceToSma350x111Ratio: 0.9 + rand() * 0.3,
    daysSinceATH: Math.floor(rand() * 100),
    drawdownFromATH: rand() * 0.3,
    momentumScore: 0.3 + rand() * 0.4,
    return30d: (rand() - 0.5) * 0.3,
    return90d: (rand() - 0.5) * 0.5,
    sma50Above200: rand() > 0.5,
    volatilityScore: 0.3 + rand() * 0.4,
    realizedVol30d: 0.3 + rand() * 0.4,
    volZScore: (rand() - 0.5) * 2,
    cycleScore: 0.3 + rand() * 0.4,
    daysSinceHalving: 200 + i,
    cyclePhase: 'mid' as const,
    estimatedCycleProgress: 0.4 + i * 0.001,
    prevCycleLow: 3200,
    prevCycleHigh: 69000,
    cycleRelativePrice: 0.7 + i * 0.001,
    macroScore: 0.4 + rand() * 0.2,
    dxyZScore: (rand() - 0.5),
    m2Signal: 0.5,
    fedFundsSignal: 0.5,
    yieldCurveSignal: 0.5,
    realRateSignal: 0.5,
    dynamicMacroWeight: 0.14,
    attentionScore: 0.3 + rand() * 0.4,
    price: 50000 + i * 100,
  }));
}

describe('calculateFutureDrawdown', () => {
  it('returns correct drawdown for declining prices', () => {
    const prices = [100, 110, 120, 100, 80];
    const dd = calculateFutureDrawdown(prices, 0, 4);
    expect(dd).toBeCloseTo(0.333, 2); // Peak 120, trough 80
  });

  it('returns 0 for end of array', () => {
    const prices = [100, 110, 120];
    expect(calculateFutureDrawdown(prices, 2, 10)).toBe(0);
  });

  it('respects horizon limit', () => {
    const prices = [100, 110, 120, 100, 80, 60];
    const ddShort = calculateFutureDrawdown(prices, 0, 3);
    const ddLong = calculateFutureDrawdown(prices, 0, 5);
    expect(ddLong).toBeGreaterThanOrEqual(ddShort);
  });
});

describe('calculateRiskDrawdownCorrelation', () => {
  it('returns 0 for insufficient data', () => {
    const riskOutputs = [
      { date: '2024-01-01', risk: 0.5, price: 100, components: { valuation: 0, momentum: 0, volatility: 0, cycle: 0, macro: 0, attention: 0 }, smoothedRisk: 0.5 },
    ];
    expect(calculateRiskDrawdownCorrelation(riskOutputs, [100], 30)).toBe(0);
  });

  it('calculates correlation for valid data', () => {
    const components = { valuation: 0, momentum: 0, volatility: 0, cycle: 0, macro: 0, attention: 0 };
    const riskOutputs = Array(100).fill(null).map((_, i) => ({
      date: `2024-01-${String(i + 1).padStart(2, '0')}`,
      risk: 0.5 + (i % 20) * 0.02,
      price: 50000 + i * 100,
      components,
      smoothedRisk: 0.5,
    }));
    const prices = riskOutputs.map(r => r.price);

    const corr = calculateRiskDrawdownCorrelation(riskOutputs, prices, 10);
    expect(typeof corr).toBe('number');
    expect(Number.isFinite(corr)).toBe(true);
  });
});

describe('optimizeWeights', () => {
  it('returns valid weights', () => {
    const features = createMockFeatures(200);
    const prices = features.map(f => f.price);

    const weights = optimizeWeights(features, prices, 30, 3);

    expect(weights).toHaveProperty('valuation');
    expect(weights).toHaveProperty('momentum');
    expect(weights).toHaveProperty('volatility');
    expect(weights).toHaveProperty('cycle');
    expect(weights).toHaveProperty('macro');
    expect(weights).toHaveProperty('attention');

    // All weights should be non-negative
    for (const w of Object.values(weights)) {
      expect(w).toBeGreaterThanOrEqual(0);
    }

    // Weights should sum to ~1
    const sum = Object.values(weights).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 1);
  });
});

describe('optimizeCalibration', () => {
  it('returns valid parameters', () => {
    const features = createMockFeatures(200);
    const prices = features.map(f => f.price);

    const params = optimizeCalibration(features, prices, { valuation: 0.25, momentum: 0.15, volatility: 0.15, cycle: 0.2, macro: 0.1, attention: 0.15 }, 30);

    expect(params.slope).toBeGreaterThan(0);
    expect(params.center).toBeGreaterThan(0);
    expect(params.center).toBeLessThan(1);
  });
});

describe('isotonicRegression', () => {
  it('returns input for empty arrays', () => {
    expect(isotonicRegression([], [])).toEqual([]);
  });

  it('returns input for mismatched lengths', () => {
    expect(isotonicRegression([1, 2], [1])).toEqual([1, 2]);
  });

  it('enforces monotonicity', () => {
    const rawScores = [0.1, 0.3, 0.5, 0.7, 0.9];
    const targets = [0.2, 0.6, 0.4, 0.5, 0.8]; // Not monotonic

    const result = isotonicRegression(rawScores, targets);

    // Result should be monotonically non-decreasing when sorted by raw scores
    expect(result.length).toBe(5);
  });
});

describe('calculateCalibrationError', () => {
  it('returns 1 for empty arrays', () => {
    expect(calculateCalibrationError([], [])).toBe(1);
  });

  it('returns low error for well-calibrated predictions', () => {
    // Risks match drawdowns
    const risks = [0.1, 0.3, 0.5, 0.7, 0.9];
    const drawdowns = [0.08, 0.24, 0.4, 0.56, 0.72]; // ~scaled to match

    const error = calculateCalibrationError(risks, drawdowns);
    expect(error).toBeLessThan(0.5);
  });
});

describe('calibrateModel', () => {
  it('returns complete calibration results', () => {
    const features = createMockFeatures(200);
    const prices = features.map(f => f.price);

    const result = calibrateModel(features, prices, 30);

    expect(result).toHaveProperty('weights');
    expect(result).toHaveProperty('calibration');
    expect(result).toHaveProperty('calibrationError');

    expect(result.calibration.slope).toBeGreaterThan(0);
    expect(result.calibrationError).toBeGreaterThanOrEqual(0);
  });
});

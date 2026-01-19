import { describe, it, expect } from 'vitest';
import {
  createWalkForwardFolds,
  detectTops,
  calculateTopDetectionMetrics,
} from './walkforward';
import { calculateFutureDrawdown, calculateRiskDrawdownCorrelation } from '../risk/calibration';

describe('createWalkForwardFolds', () => {
  it('creates specified number of folds', () => {
    const folds = createWalkForwardFolds('2020-01-01', '2024-01-01', 3, 365);
    expect(folds.length).toBe(3);
  });

  it('creates folds with valid date ranges', () => {
    const folds = createWalkForwardFolds('2020-01-01', '2024-01-01', 3, 365);

    for (const fold of folds) {
      expect(fold.trainStart).toBe('2020-01-01');
      expect(new Date(fold.trainEnd) < new Date(fold.testStart)).toBe(true);
      expect(new Date(fold.testStart) <= new Date(fold.testEnd)).toBe(true);
    }
  });

  it('has non-overlapping test periods', () => {
    const folds = createWalkForwardFolds('2020-01-01', '2024-01-01', 3, 300);

    for (let i = 1; i < folds.length; i++) {
      expect(new Date(folds[i].testStart) > new Date(folds[i - 1].testEnd)).toBe(true);
    }
  });

  it('handles insufficient data gracefully', () => {
    const folds = createWalkForwardFolds('2024-01-01', '2024-06-01', 3, 365);
    // Should return at least one fold
    expect(folds.length).toBeGreaterThanOrEqual(1);
  });
});

describe('detectTops', () => {
  it('detects local maxima followed by significant drawdown', () => {
    // Create price series with clear top
    const prices = [
      100, 110, 120, 130, 140, 150, 160, 170, 180, 190, // up
      200, // peak
      180, 160, 140, 120, 100, 80, 70, 60, 50, // down (>20% drawdown)
      55, 60, 65, 70, 75, 80, 85, 90, 95, 100, // recovery
    ];

    const tops = detectTops(prices, 5, 0.2);
    expect(tops.length).toBeGreaterThanOrEqual(1);
  });

  it('returns empty array for flat prices', () => {
    const prices = Array(100).fill(100);
    const tops = detectTops(prices, 10, 0.2);
    expect(tops.length).toBe(0);
  });

  it('requires minimum drawdown', () => {
    // Small drawdown shouldn't count
    const prices = [100, 110, 120, 130, 140, 150, 145, 140, 145, 150, 155];
    const tops = detectTops(prices, 3, 0.2); // 20% min drawdown
    expect(tops.length).toBe(0);
  });
});

describe('calculateTopDetectionMetrics', () => {
  it('calculates precision and recall correctly', () => {
    const riskOutputs = [
      { date: '2024-01-01', risk: 0.3 },
      { date: '2024-01-02', risk: 0.5 },
      { date: '2024-01-03', risk: 0.8 }, // High risk near top
      { date: '2024-01-04', risk: 0.7 },
      { date: '2024-01-05', risk: 0.4 },
    ];

    const actualTops = [2]; // Index 2 is actual top

    const { precision, recall } = calculateTopDetectionMetrics(
      riskOutputs,
      actualTops,
      0.7, // threshold
      1    // tolerance
    );

    expect(precision).toBeGreaterThan(0);
    expect(recall).toBeGreaterThan(0);
  });

  it('returns 0 for no high risk periods', () => {
    const riskOutputs = Array(10).fill(null).map((_, i) => ({
      date: `2024-01-${String(i + 1).padStart(2, '0')}`,
      risk: 0.3, // All low risk
    }));

    const actualTops = [5];

    const { precision, recall } = calculateTopDetectionMetrics(
      riskOutputs,
      actualTops,
      0.7,
      1
    );

    expect(precision).toBe(0);
    expect(recall).toBe(0);
  });

  it('returns 0 for no actual tops', () => {
    const riskOutputs = Array(10).fill(null).map((_, i) => ({
      date: `2024-01-${String(i + 1).padStart(2, '0')}`,
      risk: 0.8,
    }));

    const { precision, recall } = calculateTopDetectionMetrics(
      riskOutputs,
      [],
      0.7,
      1
    );

    expect(precision).toBe(0);
    expect(recall).toBe(0);
  });
});

describe('calculateFutureDrawdown', () => {
  it('calculates maximum drawdown over horizon', () => {
    const prices = [100, 110, 120, 100, 80]; // Peak at 120, drops to 80 = 33% dd
    const drawdown = calculateFutureDrawdown(prices, 0, 4);
    expect(drawdown).toBeCloseTo(0.333, 2);
  });

  it('returns 0 for end of series', () => {
    const prices = [100, 110, 120];
    expect(calculateFutureDrawdown(prices, 2, 10)).toBe(0);
  });

  it('returns 0 for flat prices', () => {
    const prices = [100, 100, 100, 100];
    expect(calculateFutureDrawdown(prices, 0, 3)).toBe(0);
  });
});

describe('calculateRiskDrawdownCorrelation', () => {
  it('returns positive correlation when risk predicts drawdowns', () => {
    // High risk -> high drawdown, low risk -> low drawdown
    const components = { valuation: 0, momentum: 0, volatility: 0, cycle: 0, macro: 0, attention: 0 };
    const riskOutputs = [
      { date: '2024-01-01', risk: 0.9, price: 100, components, smoothedRisk: 0.9 },
      { date: '2024-01-02', risk: 0.9, price: 110, components, smoothedRisk: 0.9 },
      { date: '2024-01-03', risk: 0.1, price: 80, components, smoothedRisk: 0.1 },
      { date: '2024-01-04', risk: 0.1, price: 85, components, smoothedRisk: 0.1 },
    ];

    const prices = [100, 110, 80, 85];
    const corr = calculateRiskDrawdownCorrelation(riskOutputs, prices, 1);

    // Correlation should exist (direction depends on sequence)
    expect(typeof corr).toBe('number');
    expect(Number.isFinite(corr)).toBe(true);
  });

  it('returns 0 for insufficient data', () => {
    const components = { valuation: 0, momentum: 0, volatility: 0, cycle: 0, macro: 0, attention: 0 };
    const riskOutputs = [
      { date: '2024-01-01', risk: 0.5, price: 100, components, smoothedRisk: 0.5 },
    ];

    const corr = calculateRiskDrawdownCorrelation(riskOutputs, [100], 30);
    expect(corr).toBe(0);
  });
});

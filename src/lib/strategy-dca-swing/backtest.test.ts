/**
 * Tests for Backtest Runner
 */

import { describe, it, expect } from 'vitest';
import {
  runDCASwingBacktest,
  runBuyAndHoldBenchmark,
  runPureDCABenchmark,
  runDCASwingComparison,
  find2017BottomDate,
} from './backtest';
import { DEFAULT_DCA_SWING_CONFIG } from './types';
import { RiskDataPoint } from '../risk-metric-contract';

// Generate test data
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

function generateTestData(days: number, startPrice: number = 40000): RiskDataPoint[] {
  const rng = mulberry32(4242);
  const data: RiskDataPoint[] = [];
  let price = startPrice;

  for (let i = 0; i < days; i++) {
    const date = new Date(2020, 0, 1 + i);
    const dateStr = date.toISOString().split('T')[0];

    // Simulate price movement with cycle
    const cycleProgress = i / days;
    const cycleFactor = Math.sin(cycleProgress * Math.PI * 2);
    price = startPrice * (1 + cycleFactor * 0.5 + (rng() - 0.5) * 0.02);

    // Risk inversely correlated with cycle (high price = high risk)
    const risk = 0.3 + 0.4 * (cycleFactor + 1) / 2 + (rng() - 0.5) * 0.1;

    data.push({
      date: dateStr,
      price: Math.max(1000, price),
      risk: Math.max(0, Math.min(1, risk)),
      smoothedRisk: Math.max(0, Math.min(1, risk)),
      components: {
        valuation: 0.5,
        momentum: 0.5,
        volatility: 0.5,
        cycle: 0.5,
        macro: 0.5,
        attention: 0.5,
      },
      cyclePhase: cycleProgress < 0.33 ? 'early' : cycleProgress < 0.66 ? 'mid' : 'late',
      isHalving: false,
    });
  }

  return data;
}

describe('runDCASwingBacktest', () => {
  const testData = generateTestData(365);

  it('should run backtest successfully', () => {
    const config = {
      ...DEFAULT_DCA_SWING_CONFIG,
      startDate: testData[0].date,
      endDate: testData[testData.length - 1].date,
      initialCashEUR: 10000,
    };

    const result = runDCASwingBacktest(testData, config);

    expect(result.startDate).toBe(testData[0].date);
    expect(result.endDate).toBe(testData[testData.length - 1].date);
    expect(result.portfolioHistory).toHaveLength(365);
  });

  it('should have valid metrics', () => {
    const config = {
      ...DEFAULT_DCA_SWING_CONFIG,
      startDate: testData[0].date,
      initialCashEUR: 10000,
    };

    const result = runDCASwingBacktest(testData, config);

    expect(result.metrics.maxDrawdown).toBeGreaterThanOrEqual(0);
    expect(result.metrics.maxDrawdown).toBeLessThanOrEqual(100);
    expect(Number.isFinite(result.metrics.cagr)).toBe(true);
    expect(Number.isFinite(result.metrics.sharpeRatio)).toBe(true);
  });

  it('should execute DCA buys', () => {
    const config = {
      ...DEFAULT_DCA_SWING_CONFIG,
      startDate: testData[0].date,
      initialCashEUR: 50000, // Enough for many buys
      dca: {
        ...DEFAULT_DCA_SWING_CONFIG.dca,
        baseAmount: 100,
        interval: 'weekly' as const,
      },
    };

    const result = runDCASwingBacktest(testData, config);

    expect(result.metrics.numberOfDCABuys).toBeGreaterThan(0);
    expect(result.metrics.totalInvested).toBeGreaterThan(0);
  });

  it('should execute swing sells when conditions met', () => {
    // Generate data with a clear high-risk period
    const highRiskData = generateTestData(100);
    // Make days 30-40 consistently high risk
    for (let i = 30; i < 40; i++) {
      highRiskData[i].risk = 0.85;
    }

    const config = {
      ...DEFAULT_DCA_SWING_CONFIG,
      startDate: highRiskData[0].date,
      initialCashEUR: 5000,
      initialBTC: 0.5, // Start with BTC to sell
      swing: {
        ...DEFAULT_DCA_SWING_CONFIG.swing,
        enabled: true,
        consecutiveDaysToTrigger: 3,
        deriskThreshold: 0.75,
      },
    };

    const result = runDCASwingBacktest(highRiskData, config);

    // Should have at least one swing sell
    expect(result.metrics.numberOfSwingSells).toBeGreaterThan(0);
  });

  it('should track tax correctly', () => {
    const config = {
      ...DEFAULT_DCA_SWING_CONFIG,
      startDate: testData[0].date,
      initialCashEUR: 10000,
    };

    const result = runDCASwingBacktest(testData, config);

    expect(Number.isFinite(result.taxMetrics.totalRealizedGains)).toBe(true);
    expect(Number.isFinite(result.taxMetrics.totalRealizedLosses)).toBe(true);
    expect(Number.isFinite(result.taxMetrics.afterTaxCAGR)).toBe(true);
  });

  it('should throw on empty date range', () => {
    const config = {
      ...DEFAULT_DCA_SWING_CONFIG,
      startDate: '2099-01-01',
      initialCashEUR: 10000,
    };

    expect(() => runDCASwingBacktest(testData, config)).toThrow(/No data/);
  });
});

describe('runBuyAndHoldBenchmark', () => {
  const testData = generateTestData(365);

  it('should calculate buy and hold correctly', () => {
    const result = runBuyAndHoldBenchmark(testData, 10000, testData[0].date);

    expect(result.name).toBe('Buy & Hold');
    expect(result.finalValue).toBeGreaterThan(0);
    expect(Number.isFinite(result.totalReturn)).toBe(true);
    expect(Number.isFinite(result.cagr)).toBe(true);
    expect(result.maxDrawdown).toBeGreaterThanOrEqual(0);
  });

  it('should handle empty data', () => {
    const result = runBuyAndHoldBenchmark([], 10000, '2023-01-01');

    expect(result.finalValue).toBe(0);
    expect(result.totalReturn).toBe(0);
  });

  it('should calculate after-tax return', () => {
    const result = runBuyAndHoldBenchmark(testData, 10000, testData[0].date, undefined, undefined, 0.30);

    expect(result.afterTaxReturn).toBeDefined();
    expect(result.afterTaxCAGR).toBeDefined();
  });
});

describe('runPureDCABenchmark', () => {
  const testData = generateTestData(365);

  it('should run DCA strategy', () => {
    const result = runPureDCABenchmark(
      testData,
      10000,
      100,
      'weekly',
      testData[0].date
    );

    expect(result.name).toBe('Pure DCA');
    expect(result.finalValue).toBeGreaterThan(0);
    expect(Number.isFinite(result.totalReturn)).toBe(true);
  });

  it('should have different results for different intervals', () => {
    const daily = runPureDCABenchmark(testData, 50000, 100, 'daily', testData[0].date);
    const weekly = runPureDCABenchmark(testData, 50000, 100, 'weekly', testData[0].date);
    const monthly = runPureDCABenchmark(testData, 50000, 100, 'monthly', testData[0].date);

    // Should have different final values due to timing
    // Note: they might be similar but not exactly equal
    expect(daily.totalInvested).toBeGreaterThan(weekly.totalInvested);
    expect(weekly.totalInvested).toBeGreaterThan(monthly.totalInvested);
  });

  it('should handle empty data', () => {
    const result = runPureDCABenchmark([], 10000, 100, 'weekly', '2023-01-01');

    expect(result.finalValue).toBe(0);
  });
});

describe('runDCASwingComparison', () => {
  const testData = generateTestData(365);

  it('should return strategy and benchmarks', () => {
    const config = {
      ...DEFAULT_DCA_SWING_CONFIG,
      startDate: testData[0].date,
      initialCashEUR: 10000,
    };

    const { strategy, benchmarks, summary } = runDCASwingComparison(testData, config);

    expect(strategy).toBeDefined();
    expect(strategy.finalPortfolio).toBeDefined();

    expect(benchmarks).toHaveLength(2);
    expect(benchmarks[0].name).toBe('Buy & Hold');
    expect(benchmarks[1].name).toBe('Pure DCA');

    expect(summary).toBeDefined();
    expect(typeof summary.strategyWins).toBe('boolean');
    expect(typeof summary.afterTaxOutperformance).toBe('number');
  });
});

describe('find2017BottomDate', () => {
  it('should find bottom date in bear market period', () => {
    // Generate data with a clear bottom
    const data: RiskDataPoint[] = [];
    const startDate = new Date('2017-12-01');

    for (let i = 0; i < 500; i++) {
      const date = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
      const dateStr = date.toISOString().split('T')[0];

      // Simulate 2018 bear market with bottom around day 380 (Dec 2018)
      let price: number;
      if (i < 30) {
        price = 19000 - i * 100; // Peak declining
      } else if (i < 380) {
        price = 16000 - (i - 30) * 35; // Bear market
      } else {
        price = 3200 + (i - 380) * 50; // Recovery
      }

      data.push({
        date: dateStr,
        price: Math.max(3000, price),
        risk: 0.5,
        smoothedRisk: 0.5,
        components: {
          valuation: 0.5,
          momentum: 0.5,
          volatility: 0.5,
          cycle: 0.5,
          macro: 0.5,
          attention: 0.5,
        },
        cyclePhase: 'mid',
        isHalving: false,
      });
    }

    const bottomDate = find2017BottomDate(data);

    // Should find a date in late 2018
    expect(bottomDate).toMatch(/^2018-/);
  });

  it('should return default date for empty data', () => {
    const bottomDate = find2017BottomDate([]);
    expect(bottomDate).toBe('2018-12-15');
  });
});

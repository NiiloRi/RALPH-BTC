/**
 * Tests for Backtest Runner
 */

import { describe, it, expect } from 'vitest';
import {
  runBacktest,
  runBuyAndHold,
  runSimpleDCA,
  runComparison,
} from './backtest';
import { DEFAULT_BACKTEST_CONFIG } from './types';
import { RiskDataPoint } from '../risk-metric-contract';

// Deterministic PRNG (mulberry32) — unseeded Math.random() made these tests
// flaky: assertions passed or failed depending on the generated price path.
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

// Generate test data
function generateTestData(days: number, startPrice: number = 40000): RiskDataPoint[] {
  const data: RiskDataPoint[] = [];
  let price = startPrice;
  const rng = mulberry32(1337);

  for (let i = 0; i < days; i++) {
    const date = new Date(2023, 0, 1 + i);
    const dateStr = date.toISOString().split('T')[0];

    // Simulate price movement
    price = price * (1 + (rng() - 0.5) * 0.05);

    // Generate varying risk levels
    const risk = 0.3 + 0.4 * Math.sin((i / days) * Math.PI * 2);

    data.push({
      date: dateStr,
      price,
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
      cyclePhase: 'mid',
      isHalving: false,
    });
  }

  return data;
}

describe('runBacktest', () => {
  const testData = generateTestData(365);

  it('should run backtest successfully', () => {
    const config = {
      ...DEFAULT_BACKTEST_CONFIG,
      startDate: testData[0].date,
      endDate: testData[testData.length - 1].date,
      initialCashEUR: 10000,
    };

    const result = runBacktest(testData, config);

    expect(result.startDate).toBe(testData[0].date);
    expect(result.endDate).toBe(testData[testData.length - 1].date);
    expect(result.portfolioHistory).toHaveLength(365);
    expect(result.metrics.numberOfTrades).toBeGreaterThanOrEqual(0);
  });

  it('should have valid metrics', () => {
    const config = {
      ...DEFAULT_BACKTEST_CONFIG,
      startDate: testData[0].date,
      initialCashEUR: 10000,
    };

    const result = runBacktest(testData, config);

    expect(result.metrics.maxDrawdown).toBeGreaterThanOrEqual(0);
    expect(result.metrics.maxDrawdown).toBeLessThanOrEqual(100);
    expect(Number.isFinite(result.metrics.cagr)).toBe(true);
    expect(Number.isFinite(result.metrics.sharpeProxy)).toBe(true);
  });

  it('should track FIFO tax correctly', () => {
    const config = {
      ...DEFAULT_BACKTEST_CONFIG,
      startDate: testData[0].date,
      initialCashEUR: 10000,
      taxMode: 'tracked' as const,
    };

    const result = runBacktest(testData, config);

    // Tax summary should exist
    expect(result.taxSummary).toBeDefined();
    expect(Number.isFinite(result.taxSummary.totalRealizedGains)).toBe(true);
    expect(Number.isFinite(result.taxSummary.totalRealizedLosses)).toBe(true);
  });

  it('should generate signals for each day', () => {
    const config = {
      ...DEFAULT_BACKTEST_CONFIG,
      startDate: testData[0].date,
      initialCashEUR: 10000,
    };

    const result = runBacktest(testData, config);

    expect(result.signals).toHaveLength(365);

    for (const signal of result.signals) {
      expect(['BUY', 'SELL', 'HOLD']).toContain(signal.action);
      expect(signal.risk).toBeGreaterThanOrEqual(0);
      expect(signal.risk).toBeLessThanOrEqual(1);
      expect(signal.targetAllocation).toBeGreaterThanOrEqual(0);
      expect(signal.targetAllocation).toBeLessThanOrEqual(1);
    }
  });

  it('should respect tax budget constraint', () => {
    // NOTE: the budget caps realized GAINS per year, not the number of sells.
    // A low budget REDUCES each sell's size, so the strategy can end up making
    // MORE (smaller) sells than an unconstrained run — the old sell-count
    // assertion tested the wrong invariant and failed intermittently.
    const budget = 100; // Very low budget (EUR realized gains / year)
    const config = {
      ...DEFAULT_BACKTEST_CONFIG,
      startDate: testData[0].date,
      initialCashEUR: 10000,
      strategy: {
        ...DEFAULT_BACKTEST_CONFIG.strategy,
        annualTaxBudget: budget,
      },
    };

    const constrained = runBacktest(testData, config);
    const unconstrained = runBacktest(testData, {
      ...config,
      strategy: { ...config.strategy, annualTaxBudget: undefined },
    });

    // True invariant: realized gains per calendar year stay near the budget.
    // Enforcement is approximate by design (reduced trades are sized at
    // remaining*1.5, assuming gains ≈ 2/3 of proceeds), so allow the
    // documented worst-case overshoot: budget + 1.5*budget = 2.5x.
    for (const y of constrained.taxSummary.yearlyBreakdown) {
      expect(y.totalGains).toBeLessThanOrEqual(budget * 2.5 + 1);
    }

    // And the budget must actually bind: total realized gains under the low
    // budget cannot exceed the unconstrained run's.
    expect(constrained.taxSummary.totalRealizedGains).toBeLessThanOrEqual(
      unconstrained.taxSummary.totalRealizedGains + 1e-6
    );
  });

  it('should throw on empty date range', () => {
    const config = {
      ...DEFAULT_BACKTEST_CONFIG,
      startDate: '2099-01-01', // Future date
      initialCashEUR: 10000,
    };

    expect(() => runBacktest(testData, config)).toThrow(/No data/);
  });
});

describe('runBuyAndHold', () => {
  const testData = generateTestData(365);

  it('should calculate buy and hold correctly', () => {
    const result = runBuyAndHold(testData, 10000, testData[0].date);

    expect(result.name).toBe('Buy & Hold');
    expect(result.finalValue).toBeGreaterThan(0);
    expect(Number.isFinite(result.totalReturn)).toBe(true);
    expect(Number.isFinite(result.cagr)).toBe(true);
    expect(result.maxDrawdown).toBeGreaterThanOrEqual(0);
  });

  it('should handle empty data', () => {
    const result = runBuyAndHold([], 10000, '2023-01-01');

    expect(result.finalValue).toBe(0);
    expect(result.totalReturn).toBe(0);
  });
});

describe('runSimpleDCA', () => {
  const testData = generateTestData(365);

  it('should run DCA strategy', () => {
    const result = runSimpleDCA(
      testData,
      10000,
      100,
      'weekly',
      testData[0].date
    );

    expect(result.name).toBe('Simple DCA');
    expect(result.finalValue).toBeGreaterThan(0);
    expect(Number.isFinite(result.totalReturn)).toBe(true);
  });

  it('should work with different intervals', () => {
    const daily = runSimpleDCA(testData, 10000, 100, 'daily', testData[0].date);
    const weekly = runSimpleDCA(testData, 10000, 100, 'weekly', testData[0].date);
    const monthly = runSimpleDCA(testData, 10000, 100, 'monthly', testData[0].date);

    // Daily should have more trades than monthly
    expect(daily.finalValue).not.toBe(monthly.finalValue);
    expect(weekly.finalValue).not.toBe(daily.finalValue);
  });

  it('should handle empty data', () => {
    const result = runSimpleDCA([], 10000, 100, 'weekly', '2023-01-01');

    expect(result.finalValue).toBe(0);
  });
});

describe('runComparison', () => {
  const testData = generateTestData(365);

  it('should return strategy and benchmarks', () => {
    const config = {
      ...DEFAULT_BACKTEST_CONFIG,
      startDate: testData[0].date,
      initialCashEUR: 10000,
    };

    const { strategy, benchmarks } = runComparison(testData, config);

    expect(strategy).toBeDefined();
    expect(strategy.finalPortfolio).toBeDefined();

    expect(benchmarks).toHaveLength(2);
    expect(benchmarks[0].name).toBe('Buy & Hold');
    expect(benchmarks[1].name).toBe('Simple DCA');
  });

  it('should use same date range for all strategies', () => {
    const config = {
      ...DEFAULT_BACKTEST_CONFIG,
      startDate: testData[100].date,
      endDate: testData[200].date,
      initialCashEUR: 10000,
    };

    const { strategy, benchmarks } = runComparison(testData, config);

    expect(strategy.startDate).toBe(testData[100].date);
    expect(strategy.endDate).toBe(testData[200].date);
  });
});

describe('Portfolio State', () => {
  const testData = generateTestData(100);

  it('should track portfolio history correctly', () => {
    const config = {
      ...DEFAULT_BACKTEST_CONFIG,
      startDate: testData[0].date,
      initialCashEUR: 10000,
      initialBTC: 0.1,
    };

    const result = runBacktest(testData, config);

    // First state should have initial values
    const first = result.portfolioHistory[0];
    expect(first.cashEUR).toBeLessThanOrEqual(10000); // May have bought
    expect(first.btcQuantity).toBeGreaterThanOrEqual(0.1); // At least initial

    // Portfolio values should be positive
    for (const state of result.portfolioHistory) {
      expect(state.totalValueEUR).toBeGreaterThan(0);
      expect(state.btcAllocation).toBeGreaterThanOrEqual(0);
      expect(state.btcAllocation).toBeLessThanOrEqual(1);
    }
  });

  it('should calculate unrealized P/L', () => {
    const config = {
      ...DEFAULT_BACKTEST_CONFIG,
      startDate: testData[0].date,
      initialCashEUR: 10000,
    };

    const result = runBacktest(testData, config);
    const lastState = result.finalPortfolio;

    // Unrealized P/L should be a number
    expect(Number.isFinite(lastState.unrealizedPL)).toBe(true);
  });
});

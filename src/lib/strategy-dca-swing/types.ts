/**
 * Dynamic DCA + Swing Trading Strategy Types
 *
 * This strategy combines:
 * 1. Dynamic DCA - buy sizing scales inversely with risk: f(risk)
 * 2. Swing Trading - partial de-risking on consecutive high-risk days
 * 3. FIFO Tax Tracking - Finnish tax compliant
 */

import { RiskDataPoint } from '../risk-metric-contract';

/**
 * Risk zones with more granular definitions for swing trading
 */
export type SwingRiskZone =
  | 'extreme_buy'    // 0.00-0.10: Maximum accumulation
  | 'strong_buy'     // 0.10-0.25: Strong accumulation
  | 'buy'            // 0.25-0.40: Normal buying
  | 'neutral'        // 0.40-0.60: Hold / reduced buying
  | 'cautious'       // 0.60-0.75: Stop new buys
  | 'sell'           // 0.75-0.85: Start de-risking
  | 'strong_sell';   // 0.85-1.00: Aggressive de-risking

/**
 * Dynamic DCA configuration
 */
export interface DynamicDCAConfig {
  // Base DCA amount (EUR)
  baseAmount: number;

  // DCA interval
  interval: 'daily' | 'weekly' | 'biweekly' | 'monthly';

  // Risk-based multiplier function parameters
  // Multiplier = maxMultiplier when risk=0, minMultiplier when risk=1
  // Formula: multiplier = maxMultiplier - (maxMultiplier - minMultiplier) * risk^exponent
  minMultiplier: number;  // e.g., 0.0 (skip at high risk)
  maxMultiplier: number;  // e.g., 3.0 (3x at very low risk)
  exponent: number;       // e.g., 1.5 (concave curve)

  // Risk threshold above which we skip DCA entirely
  skipAboveRisk: number;  // e.g., 0.70
}

/**
 * Swing trading configuration
 */
export interface SwingTradingConfig {
  // Enabled
  enabled: boolean;

  // Days of consecutive risk above threshold to trigger de-risk
  consecutiveDaysToTrigger: number;  // e.g., 3

  // Risk threshold for triggering de-risk
  deriskThreshold: number;  // e.g., 0.75

  // De-risk percentage per trigger (of BTC holdings)
  deriskPercent: number;  // e.g., 0.10 (10%)

  // Max de-risk per month (to avoid over-trading)
  maxDeriskPerMonth: number;  // e.g., 0.30 (30%)

  // Cooldown days after de-risk before another can trigger
  cooldownDays: number;  // e.g., 14

  // Re-risk (buy back) configuration
  reriskEnabled: boolean;
  reriskThreshold: number;       // Risk below this triggers re-risk, e.g., 0.30
  reriskConsecutiveDays: number; // Days needed, e.g., 5
  reriskPercent: number;         // % of cash to use, e.g., 0.20
}

/**
 * Tax configuration (Finnish system)
 */
export interface TaxConfig {
  // Annual tax budget (max realized gains per year)
  annualTaxBudget?: number;

  // Capital gains tax rate (30% up to €30k, 34% above)
  taxRateBelow30k: number;
  taxRateAbove30k: number;

  // Enable loss harvesting
  enableLossHarvesting: boolean;

  // Minimum holding period for preferential treatment (days)
  // Note: Finland doesn't have this, but useful for other jurisdictions
  minHoldingPeriod?: number;
}

/**
 * Complete strategy configuration
 */
export interface DCASwingConfig {
  // Date range
  startDate: string;
  endDate?: string;

  // Initial portfolio
  initialCashEUR: number;
  initialBTC: number;

  // Trading costs
  feePercent: number;      // 0.1 = 0.1%
  slippagePercent: number; // 0.05 = 0.05%

  // Strategy components
  dca: DynamicDCAConfig;
  swing: SwingTradingConfig;
  tax: TaxConfig;

  // Risk zone thresholds
  zones: {
    extremeBuy: number;   // Upper bound, e.g., 0.10
    strongBuy: number;    // e.g., 0.25
    buy: number;          // e.g., 0.40
    neutral: number;      // e.g., 0.60
    cautious: number;     // e.g., 0.75
    sell: number;         // e.g., 0.85
  };

  // Minimum trade size (EUR)
  minTradeSize: number;
}

/**
 * Default configuration
 */
export const DEFAULT_DCA_SWING_CONFIG: DCASwingConfig = {
  startDate: '2017-12-17', // Near 2017 peak for testing
  initialCashEUR: 10000,
  initialBTC: 0,
  feePercent: 0.10,
  slippagePercent: 0.05,

  dca: {
    baseAmount: 100,
    interval: 'weekly',
    minMultiplier: 0.0,
    maxMultiplier: 3.0,
    exponent: 1.5,
    skipAboveRisk: 0.70,
  },

  swing: {
    enabled: true,
    consecutiveDaysToTrigger: 3,
    deriskThreshold: 0.75,
    deriskPercent: 0.10,
    maxDeriskPerMonth: 0.30,
    cooldownDays: 14,
    reriskEnabled: true,
    reriskThreshold: 0.30,
    reriskConsecutiveDays: 5,
    reriskPercent: 0.20,
  },

  tax: {
    annualTaxBudget: undefined, // No limit by default
    taxRateBelow30k: 0.30,
    taxRateAbove30k: 0.34,
    enableLossHarvesting: true,
  },

  zones: {
    extremeBuy: 0.10,
    strongBuy: 0.25,
    buy: 0.40,
    neutral: 0.60,
    cautious: 0.75,
    sell: 0.85,
  },

  minTradeSize: 20,
};

/**
 * FIFO Lot for tax tracking
 */
export interface FIFOLot {
  id: string;
  acquisitionDate: string;
  quantity: number;
  unitCostEUR: number;
  totalCostEUR: number;
  feesEUR: number;
  remainingQuantity: number;
  source: 'dca' | 'rerisk' | 'initial';
}

/**
 * Trade record
 */
export interface DCASwingTrade {
  id: string;
  date: string;
  type: 'DCA_BUY' | 'SWING_SELL' | 'RERISK_BUY' | 'TAX_HARVEST_SELL';
  btcAmount: number;
  priceEUR: number;
  totalEUR: number;
  feesEUR: number;

  // For sells
  realizedGainEUR?: number;
  costBasisEUR?: number;
  holdingDays?: number;

  // Context
  riskAtTrade: number;
  multiplierUsed?: number;  // For DCA buys
  reason: string;
}

/**
 * Daily portfolio state
 */
export interface DCASwingPortfolioState {
  date: string;
  cashEUR: number;
  btcQuantity: number;
  btcPriceEUR: number;
  btcValueEUR: number;
  totalValueEUR: number;
  btcAllocation: number;

  // Tax tracking
  unrealizedPL: number;
  ytdRealizedGains: number;
  ytdRealizedLosses: number;

  // Risk context
  risk: number;
  zone: SwingRiskZone;

  // Swing state
  consecutiveHighRiskDays: number;
  consecutiveLowRiskDays: number;
  daysSinceLastDerisk: number;
  monthDeriskTotal: number;
}

/**
 * Realized gain for tax reporting
 */
export interface DCASwingRealizedGain {
  tradeId: string;
  date: string;
  year: number;
  btcSold: number;
  salePriceEUR: number;
  costBasisEUR: number;
  gainEUR: number;
  holdingDays: number;
  taxableGain: number;  // After any adjustments
}

/**
 * Yearly tax summary
 */
export interface DCASwingYearlyTax {
  year: number;
  totalGains: number;
  totalLosses: number;
  netGain: number;
  numberOfSales: number;
  avgHoldingDays: number;
  estimatedTax: number;
  afterTaxGain: number;
  trades: DCASwingRealizedGain[];
}

/**
 * Backtest result
 */
export interface DCASwingBacktestResult {
  config: DCASwingConfig;
  startDate: string;
  endDate: string;

  // Final state
  finalPortfolio: DCASwingPortfolioState;

  // Pre-tax metrics
  metrics: {
    totalReturn: number;           // %
    cagr: number;                  // %
    maxDrawdown: number;           // %
    volatility: number;            // Annualized std dev
    sharpeRatio: number;           // Risk-adjusted return
    sortinoRatio: number;          // Downside risk-adjusted
    calmarRatio: number;           // CAGR / max drawdown
    winRate: number;               // % of profitable sells
    numberOfTrades: number;
    numberOfDCABuys: number;
    numberOfSwingSells: number;
    numberOfReriskBuys: number;
    totalInvested: number;         // Total EUR put in
    avgBuyPrice: number;           // DCA average price
  };

  // Tax metrics
  taxMetrics: {
    totalRealizedGains: number;
    totalRealizedLosses: number;
    netRealizedPL: number;
    totalTaxPaid: number;
    afterTaxReturn: number;        // %
    afterTaxCAGR: number;          // %
    yearlyBreakdown: DCASwingYearlyTax[];
  };

  // Time series
  portfolioHistory: DCASwingPortfolioState[];
  trades: DCASwingTrade[];
}

/**
 * Benchmark result for comparison
 */
export interface BenchmarkResult {
  name: string;
  description: string;
  startDate: string;
  endDate: string;

  initialValue: number;
  finalValue: number;
  totalReturn: number;          // %
  cagr: number;                 // %
  maxDrawdown: number;          // %

  // For fair comparison with strategy
  totalInvested: number;
  afterTaxReturn?: number;      // %
  afterTaxCAGR?: number;        // %

  // Time series (optional)
  history?: { date: string; value: number }[];
}

/**
 * Full comparison result
 */
export interface DCASwingComparisonResult {
  strategy: DCASwingBacktestResult;
  benchmarks: BenchmarkResult[];

  // Summary comparison
  summary: {
    strategyWins: boolean;
    afterTaxOutperformance: number;  // % points vs best benchmark
    riskAdjustedOutperformance: number;  // Sharpe difference
    taxEfficiency: number;  // (after-tax return) / (pre-tax return)
  };
}

/**
 * Parameter sensitivity result
 */
export interface SensitivityResult {
  parameter: string;
  values: number[];
  results: {
    value: number;
    afterTaxCAGR: number;
    maxDrawdown: number;
    sharpeRatio: number;
  }[];
  optimalValue: number;
  optimalCAGR: number;
}

/**
 * Walk-forward validation result
 */
export interface WalkForwardResult {
  folds: {
    foldNumber: number;
    trainStart: string;
    trainEnd: string;
    testStart: string;
    testEnd: string;
    inSampleCAGR: number;
    outOfSampleCAGR: number;
    degradation: number;  // How much worse OOS vs IS
  }[];

  avgInSampleCAGR: number;
  avgOutOfSampleCAGR: number;
  avgDegradation: number;
  isRobust: boolean;  // OOS performance > 70% of IS
}

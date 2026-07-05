/**
 * Strategy Module Types
 *
 * Types for the tax-aware investment strategy that consumes
 * the risk metric (treated as a frozen dependency).
 */

/**
 * Risk zone definitions for strategy signals
 */
export type RiskZone =
  | 'accumulate'      // 0.00-0.20: Aggressive DCA
  | 'normal'          // 0.20-0.50: Normal DCA / hold
  | 'cautious'        // 0.50-0.70: Reduce accumulation
  | 'derisk'          // 0.70-0.85: Gradual profit-taking
  | 'defensive';      // 0.85-1.00: Cap allocation, larger de-risk

/**
 * Strategy action for each day
 */
export type StrategyAction = 'BUY' | 'SELL' | 'HOLD';

/**
 * Strategy signal output
 */
export interface StrategySignal {
  date: string;
  price: number;
  risk: number;
  riskZone: RiskZone;
  targetAllocation: number;  // 0-1, target BTC allocation
  action: StrategyAction;
  tradeSize: number;         // EUR amount or % of portfolio
  tradeSizePercent: number;  // As % of portfolio
  reason: string;            // Human-readable explanation
}

/**
 * Strategy configuration parameters
 */
export interface StrategyConfig {
  // Risk zone thresholds
  zones: {
    accumulate: { max: number; targetAllocation: number };  // 0.20, 0.90
    normal: { max: number; targetAllocation: number };      // 0.50, 0.70
    cautious: { max: number; targetAllocation: number };    // 0.70, 0.50
    derisk: { max: number; targetAllocation: number };      // 0.85, 0.30
    defensive: { targetAllocation: number };                // 0.15
  };

  // Hysteresis settings
  hysteresisDays: number;  // Days risk must stay in zone before switching

  // Rebalancing cadence
  rebalanceCadence: 'daily' | 'weekly' | 'monthly';
  rebalanceDay?: number;  // 0=Monday for weekly, 1-28 for monthly

  // Tax settings
  annualTaxBudget?: number;  // Max realized gains per year (EUR)
  enableLossHarvesting: boolean;

  // Trade settings
  minTradeSize: number;     // Minimum trade size (EUR)
  maxTradePercent: number;  // Max single trade as % of portfolio
}

/**
 * Default strategy configuration
 */
export const DEFAULT_STRATEGY_CONFIG: StrategyConfig = {
  zones: {
    accumulate: { max: 0.20, targetAllocation: 0.90 },
    normal: { max: 0.50, targetAllocation: 0.70 },
    cautious: { max: 0.70, targetAllocation: 0.50 },
    derisk: { max: 0.85, targetAllocation: 0.30 },
    defensive: { targetAllocation: 0.15 },
  },
  hysteresisDays: 7,
  rebalanceCadence: 'weekly',
  rebalanceDay: 0,  // Monday
  annualTaxBudget: undefined,  // No limit
  enableLossHarvesting: true,
  minTradeSize: 50,
  maxTradePercent: 0.25,
};

/**
 * FIFO Lot - a single acquisition of BTC
 */
export interface FIFOLot {
  id: string;
  acquisitionDate: string;
  quantity: number;       // BTC amount
  unitCost: number;       // EUR per BTC at acquisition
  totalCost: number;      // EUR total cost including fees
  fees: number;           // EUR fees paid
  source: 'buy' | 'dca' | 'initial';
  remainingQuantity: number;  // How much is left (after partial sales)
}

/**
 * Trade record
 */
export interface Trade {
  id: string;
  date: string;
  type: 'BUY' | 'SELL';
  quantity: number;       // BTC amount
  price: number;          // EUR per BTC
  totalValue: number;     // EUR total value
  fees: number;           // EUR fees
  // For SELL trades
  realizedPL?: number;    // EUR profit/loss
  costBasis?: number;     // EUR cost basis (FIFO)
  lotsConsumed?: string[]; // IDs of lots consumed
}

/**
 * Realized gain/loss for tax reporting
 */
export interface RealizedGain {
  year: number;
  tradeId: string;
  date: string;
  quantity: number;
  salePrice: number;
  costBasis: number;
  gain: number;           // Can be negative (loss)
  holdingPeriodDays: number;
}

/**
 * Yearly tax summary
 */
export interface YearlyTaxSummary {
  year: number;
  totalGains: number;
  totalLosses: number;
  netGain: number;
  numberOfSales: number;
  avgHoldingPeriod: number;
  trades: RealizedGain[];
}

/**
 * Portfolio state at a point in time
 */
export interface PortfolioState {
  date: string;
  cashEUR: number;
  btcQuantity: number;
  btcValueEUR: number;
  totalValueEUR: number;
  btcAllocation: number;  // 0-1
  lots: FIFOLot[];
  unrealizedPL: number;
}

/**
 * Backtest configuration
 */
export interface BacktestConfig {
  startDate: string;
  endDate?: string;
  initialCashEUR: number;
  initialBTC: number;
  feePercent: number;      // Trading fee as %
  slippagePercent: number; // Estimated slippage as %
  dcaAmount?: number;      // Optional DCA amount per interval
  dcaInterval?: 'daily' | 'weekly' | 'monthly';
  taxMode: 'tracked' | 'paid';  // Track only or simulate payment
  capitalGainsTaxRate?: number; // e.g., 0.30 for 30%
  strategy: StrategyConfig;
}

/**
 * Default backtest configuration
 */
export const DEFAULT_BACKTEST_CONFIG: BacktestConfig = {
  startDate: '2018-01-01',
  initialCashEUR: 10000,
  initialBTC: 0,
  feePercent: 0.1,
  slippagePercent: 0.05,
  dcaAmount: 100,
  dcaInterval: 'weekly',
  taxMode: 'tracked',
  capitalGainsTaxRate: 0.30,
  strategy: DEFAULT_STRATEGY_CONFIG,
};

/**
 * Backtest results
 */
export interface BacktestResult {
  config: BacktestConfig;
  startDate: string;
  endDate: string;
  // Final state
  finalPortfolio: PortfolioState;
  // Performance metrics
  metrics: {
    totalReturn: number;        // %
    cagr: number;               // Compound annual growth rate %
    maxDrawdown: number;        // %
    sharpeProxy: number;        // Risk-adjusted return proxy
    turnover: number;           // Total traded / avg portfolio value
    numberOfTrades: number;
    numberOfBuys: number;
    numberOfSells: number;
  };
  // Tax summary
  taxSummary: {
    totalRealizedGains: number;
    totalRealizedLosses: number;
    netRealizedPL: number;
    taxesPaid: number;  // If taxMode='paid'
    yearlyBreakdown: YearlyTaxSummary[];
  };
  // Time series
  portfolioHistory: PortfolioState[];
  trades: Trade[];
  signals: StrategySignal[];
}

/**
 * Benchmark comparison result
 */
export interface BenchmarkComparison {
  name: string;
  finalValue: number;
  totalReturn: number;
  cagr: number;
  maxDrawdown: number;
}

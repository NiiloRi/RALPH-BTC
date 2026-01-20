import { z } from 'zod';

// Bitcoin halving dates (block heights converted to approximate dates)
export const HALVING_DATES: Date[] = [
  new Date('2012-11-28'), // Block 210,000
  new Date('2016-07-09'), // Block 420,000
  new Date('2020-05-11'), // Block 630,000
  new Date('2024-04-19'), // Block 840,000 (estimated)
];

export const GENESIS_DATE = new Date('2009-01-03');

// Schema for raw price data
export const PriceDataSchema = z.object({
  date: z.string(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number().optional(),
});

export type PriceData = z.infer<typeof PriceDataSchema>;

// Schema for daily data record with all available fields
export const DailyDataSchema = z.object({
  date: z.string(),
  price: z.number(),
  // Volatility
  realizedVol30d: z.number().optional(),
  realizedVol90d: z.number().optional(),
  // Returns
  return1d: z.number().optional(),
  return7d: z.number().optional(),
  return30d: z.number().optional(),
  return90d: z.number().optional(),
  return365d: z.number().optional(),
  // Moving averages
  sma50: z.number().optional(),
  sma100: z.number().optional(),
  sma200: z.number().optional(),
  sma350: z.number().optional(),
  // Macro
  dxy: z.number().optional(),
  treasury10y: z.number().optional(),
  treasury2y: z.number().optional(),
  yieldSpread: z.number().optional(),    // 10Y - 2Y spread
  realRate: z.number().optional(),       // 10Y TIPS yield
  m2: z.number().optional(),             // M2 money supply (billions)
  m2YoY: z.number().optional(),          // M2 year-over-year change (decimal, e.g., 0.05 = 5%)
  fedFunds: z.number().optional(),       // Fed Funds effective rate (%)
  // Derivatives (optional - may not be available)
  fundingRate: z.number().optional(),
  openInterest: z.number().optional(),
  // Sentiment
  fearGreedIndex: z.number().optional(),
  googleTrends: z.number().optional(),
});

export type DailyData = z.infer<typeof DailyDataSchema>;

// Feature vector for risk model
export interface FeatureVector {
  date: string;
  // Valuation features
  valuationScore: number;
  priceToSma200Ratio: number;
  priceToSma350x111Ratio: number;
  daysSinceATH: number;
  drawdownFromATH: number;
  // Momentum features
  momentumScore: number;
  return30d: number;
  return90d: number;
  sma50Above200: boolean;
  // Volatility features
  volatilityScore: number;
  realizedVol30d: number;
  volZScore: number;
  // Cycle features
  cycleScore: number;
  daysSinceHalving: number;
  cyclePhase: 'early' | 'mid' | 'late';
  estimatedCycleProgress: number;
  // Cycle-relative features (based on previous cycle's range)
  prevCycleLow: number;
  prevCycleHigh: number;
  cycleRelativePrice: number;  // 0 = at prev low, 1 = at prev high, >1 = new territory
  // Macro features (optional)
  macroScore: number;
  dxyZScore: number;
  m2Signal: number;
  fedFundsSignal: number;
  yieldCurveSignal: number;
  realRateSignal: number;
  dynamicMacroWeight: number;  // Dynamic weight based on macro regime volatility
  // Retail attention features (optional)
  attentionScore: number;
  // Raw price for reference
  price: number;
}

// Risk model output
export interface RiskOutput {
  date: string;
  price: number;
  risk: number;
  components: {
    valuation: number;
    momentum: number;
    volatility: number;
    cycle: number;
    macro: number;
    attention: number;
  };
  smoothedRisk: number;
}

// Backtest fold definition
export interface BacktestFold {
  trainStart: string;
  trainEnd: string;
  testStart: string;
  testEnd: string;
}

// Backtest metrics
export interface BacktestMetrics {
  fold: number;
  trainPeriod: { start: string; end: string };
  testPeriod: { start: string; end: string };
  // Risk-return correlation
  riskDrawdownCorr30d: number;
  riskDrawdownCorr90d: number;
  riskDrawdownCorr180d: number;
  // Top detection
  topPrecision: number;
  topRecall: number;
  // Calibration
  calibrationError: number;
  // Weights used
  weights: Record<string, number>;
}

// Complete backtest report
export interface BacktestReport {
  generatedAt: string;
  dataRange: { start: string; end: string };
  folds: BacktestMetrics[];
  aggregateMetrics: {
    avgRiskDrawdownCorr30d: number;
    avgRiskDrawdownCorr90d: number;
    avgRiskDrawdownCorr180d: number;
    avgTopPrecision: number;
    avgTopRecall: number;
    avgCalibrationError: number;
  };
  finalWeights: Record<string, number>;
}

// UI data format
export interface UIDataPoint {
  date: string;
  price: number;
  risk: number;
  smoothedRisk: number;
  components: {
    valuation: number;
    momentum: number;
    volatility: number;
    cycle: number;
    macro: number;
    attention: number;
  };
  cyclePhase: 'early' | 'mid' | 'late';
  isHalving: boolean;
}

// Macro data bundle from FRED API
export interface MacroDataBundle {
  m2: Map<string, number>;           // M2 money supply by date
  fedFunds: Map<string, number>;     // Fed Funds rate by date
  treasury10y: Map<string, number>;  // 10Y Treasury by date
  treasury2y: Map<string, number>;   // 2Y Treasury by date
  yieldSpread: Map<string, number>;  // 10Y-2Y spread by date
  realRate: Map<string, number>;     // 10Y TIPS by date
  dxy: Map<string, number>;          // Dollar index by date
}

// Macro component breakdown for analysis
export interface MacroComponents {
  m2Signal: number;
  fedFundsSignal: number;
  yieldCurveSignal: number;
  realRateSignal: number;
  dxySignal: number;
  liquidityProxy: number;
}

// Data cache metadata
export interface CacheMetadata {
  lastFetch: string;
  etag?: string;
  source: string;
}

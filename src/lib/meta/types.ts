/**
 * META-LAYERS TYPE DEFINITIONS
 *
 * These types define the meta-layers that sit ABOVE the existing risk metric.
 * CRITICAL: These layers are READ-ONLY consumers of RiskOutput.
 * They NEVER feed back into the base risk score calculation.
 *
 * Data Flow:
 *   FeatureVector → RiskOutput (UNCHANGED)
 *                       ↓
 *              MetaLayersOutput (NEW, additive only)
 */

import { RiskOutput, FeatureVector } from '../types';

// ============================================================================
// 1. RISK CONFIDENCE (Meta-Signal)
// ============================================================================

/**
 * Confidence level labels
 */
export type ConfidenceLevel = 'low' | 'medium' | 'high';

/**
 * Risk Confidence measures agreement between components and regime stability
 * Higher confidence = components agree and regime is stable
 */
export interface RiskConfidence {
  /** Numeric confidence score [0, 1] */
  value: number;
  /** Categorical label */
  level: ConfidenceLevel;
  /** Component agreement score (how much components agree with each other) */
  componentAgreement: number;
  /** Regime stability score (how stable the risk has been recently) */
  regimeStability: number;
  /** Dispersion of component scores (lower = more agreement) */
  componentDispersion: number;
  /** Number of components contributing */
  componentCount: number;
}

// ============================================================================
// 2. RISK MOMENTUM
// ============================================================================

/**
 * Risk momentum direction
 */
export type MomentumDirection = 'rising' | 'stable' | 'falling';

/**
 * Risk Momentum derived ONLY from the existing risk time series
 * Provides first and second derivatives of the risk score
 */
export interface RiskMomentum {
  /** First derivative: rate of change (ΔRisk per day) */
  deltaRisk: number;
  /** Second derivative: acceleration (ΔΔRisk per day) */
  acceleration: number;
  /** 7-day change in risk */
  delta7d: number;
  /** 30-day change in risk */
  delta30d: number;
  /** Direction indicator */
  direction: MomentumDirection;
  /** Direction symbol for display */
  directionSymbol: '↑' | '→' | '↓';
  /** Momentum strength [0, 1] - how strong the current trend is */
  strength: number;
}

// ============================================================================
// 3. CONDITIONAL HISTORICAL CONTEXT (Read-Only)
// ============================================================================

/**
 * Forward return distribution statistics
 * CLEARLY LABELED: This is HISTORICAL context, NOT prediction
 */
export interface ForwardReturnStats {
  /** Number of historical observations in this bucket */
  sampleCount: number;
  /** Median forward return */
  median: number;
  /** Mean forward return */
  mean: number;
  /** 10th percentile (worst case) */
  p10: number;
  /** 25th percentile */
  p25: number;
  /** 75th percentile */
  p75: number;
  /** 90th percentile (best case) */
  p90: number;
  /** Standard deviation */
  stdDev: number;
  /** Percentage of positive outcomes */
  positiveRate: number;
}

/**
 * Drawdown statistics for historical context
 */
export interface DrawdownStats {
  /** Number of observations */
  sampleCount: number;
  /** Median max drawdown in period */
  medianDrawdown: number;
  /** Mean max drawdown */
  meanDrawdown: number;
  /** Worst observed drawdown */
  maxDrawdown: number;
  /** 90th percentile drawdown (worse than 90% of observations) */
  p90Drawdown: number;
  /** Average days to recovery from drawdown */
  avgRecoveryDays: number;
}

/**
 * Historical context conditioned on current state
 * READ-ONLY: For informational purposes only
 */
export interface HistoricalContext {
  /** Current risk bucket (e.g., "60-70%") */
  riskBucket: string;
  /** Current cycle phase */
  cyclePhase: 'early' | 'mid' | 'late';
  /** Current momentum direction */
  momentumDirection: MomentumDirection;
  /** Forward returns at various horizons */
  forwardReturns: {
    days30: ForwardReturnStats;
    days90: ForwardReturnStats;
    days180: ForwardReturnStats;
    days365: ForwardReturnStats;
  };
  /** Drawdown statistics */
  drawdownStats: {
    days30: DrawdownStats;
    days90: DrawdownStats;
    days180: DrawdownStats;
  };
  /** DISCLAIMER: Always display this with the data */
  disclaimer: string;
}

// ============================================================================
// 4. LEFT-TAIL / DRAWDOWN PROBABILITY MODULE
// ============================================================================

/**
 * Drawdown probability estimate
 * Uses existing volatility/fragility/macro signals
 * NEVER influences the main risk score
 */
export interface DrawdownProbability {
  /** Probability of >=10% drawdown within 30 days */
  prob10pct30d: number;
  /** Probability of >=20% drawdown within 30 days */
  prob20pct30d: number;
  /** Probability of >=30% drawdown within 90 days */
  prob30pct90d: number;
  /** Probability of >=50% drawdown within 180 days */
  prob50pct180d: number;
  /** Current volatility regime */
  volatilityRegime: 'low' | 'normal' | 'high' | 'extreme';
  /** Fragility index from volatility module */
  fragilityIndex: number;
  /** Macro stress indicator */
  macroStress: number;
  /** Overall left-tail risk score [0, 1] */
  leftTailRisk: number;
  /** Risk level label */
  riskLevel: 'minimal' | 'low' | 'moderate' | 'elevated' | 'high';
}

// ============================================================================
// 5. CYCLE-RELATIVE RISK VIEW
// ============================================================================

/**
 * Cycle-relative risk comparison
 * Shows how current risk compares to historical risk at same cycle phase
 * SECONDARY REFERENCE: Absolute risk remains the canonical value
 */
export interface CycleRelativeRisk {
  /** Percentile of current risk within same cycle phase historically */
  cyclePhasePercentile: number;
  /** Average risk at this cycle phase historically */
  historicalAvgRisk: number;
  /** Current risk minus historical average at this phase */
  deviationFromAvg: number;
  /** Is current risk elevated vs historical same-phase? */
  isElevated: boolean;
  /** Current cycle phase */
  cyclePhase: 'early' | 'mid' | 'late';
  /** Days into current cycle */
  daysIntoCycle: number;
  /** Estimated cycle progress (0-1+) */
  cycleProgress: number;
  /** Historical risk range at this phase [min, max] */
  historicalRange: { min: number; max: number };
}

// ============================================================================
// 6. POSITION GUIDANCE LAYER (NON-DIRECTIVE)
// ============================================================================

/**
 * Position guidance outputs
 * CRITICAL: These are NON-DIRECTIVE suggestions
 * NEVER outputs buy/sell/exit signals
 */
export interface PositionGuidance {
  /** Position size multiplier [0, 1.5] where 1.0 = baseline */
  sizeMultiplier: number;
  /** DCA pacing suggestion */
  dcaPacing: 'accelerate' | 'normal' | 'decelerate' | 'pause';
  /** DCA pacing factor [0.5, 2.0] where 1.0 = normal pace */
  dcaPacingFactor: number;
  /** Profit-taking aggressiveness [0, 1] where 0 = none, 1 = aggressive */
  profitTakingAggressiveness: number;
  /** Suggested profit-taking level description */
  profitTakingLevel: 'none' | 'light' | 'moderate' | 'aggressive';
  /** Inputs used (for transparency) */
  inputs: {
    riskLevel: number;
    riskConfidence: number;
    riskMomentumDirection: MomentumDirection;
    leftTailRisk: number;
  };
  /** DISCLAIMER: Always display */
  disclaimer: string;
}

// ============================================================================
// COMBINED META-LAYERS OUTPUT
// ============================================================================

/**
 * Complete meta-layers output
 * All fields are OPTIONAL and can be toggled independently
 */
export interface MetaLayersOutput {
  /** Source date */
  date: string;
  /** Reference to original risk (read-only, never modified) */
  baseRisk: number;
  /** Reference to smoothed risk (read-only, never modified) */
  baseSmoothedRisk: number;

  /** Risk Confidence meta-signal */
  confidence?: RiskConfidence;
  /** Risk Momentum indicators */
  momentum?: RiskMomentum;
  /** Historical context (read-only) */
  historicalContext?: HistoricalContext;
  /** Drawdown probability estimates */
  drawdownProbability?: DrawdownProbability;
  /** Cycle-relative risk view */
  cycleRelativeRisk?: CycleRelativeRisk;
  /** Position guidance (non-directive) */
  positionGuidance?: PositionGuidance;
}

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Configuration for which meta-layers to compute
 */
export interface MetaLayersConfig {
  enableConfidence: boolean;
  enableMomentum: boolean;
  enableHistoricalContext: boolean;
  enableDrawdownProbability: boolean;
  enableCycleRelativeRisk: boolean;
  enablePositionGuidance: boolean;
}

/**
 * Default configuration: all layers enabled
 */
export const DEFAULT_META_CONFIG: MetaLayersConfig = {
  enableConfidence: true,
  enableMomentum: true,
  enableHistoricalContext: true,
  enableDrawdownProbability: true,
  enableCycleRelativeRisk: true,
  enablePositionGuidance: true,
};

// ============================================================================
// EXTENDED UI DATA POINT
// ============================================================================

/**
 * Extended UI data point that includes meta-layers
 * Extends the existing UIDataPoint without modifying it
 */
export interface UIDataPointWithMeta {
  // Original UIDataPoint fields (unchanged)
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

  // NEW: Meta-layers (optional, toggleable)
  meta?: MetaLayersOutput;
}

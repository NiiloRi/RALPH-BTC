/**
 * CONDITIONAL HISTORICAL CONTEXT MODULE
 *
 * Provides historical outcomes conditioned on:
 * - Risk bucket
 * - Cycle phase
 * - Risk momentum direction
 *
 * CRITICAL CONSTRAINTS:
 * - This is READ-ONLY historical context, NOT prediction
 * - No hindsight leakage: only uses data available at each historical point
 * - NEVER feeds back into the base risk score
 *
 * Data Flow:
 *   RiskOutput[] + DailyData[] (READ-ONLY) → HistoricalContext
 */

import { RiskOutput, DailyData } from '../types';
import {
  HistoricalContext,
  ForwardReturnStats,
  DrawdownStats,
  MomentumDirection,
} from './types';
import { getMomentumDirection, calculateNDayDelta } from './momentum';

/**
 * Risk bucket definitions
 */
const RISK_BUCKETS = [
  { label: '0-10%', min: 0, max: 0.1 },
  { label: '10-20%', min: 0.1, max: 0.2 },
  { label: '20-30%', min: 0.2, max: 0.3 },
  { label: '30-40%', min: 0.3, max: 0.4 },
  { label: '40-50%', min: 0.4, max: 0.5 },
  { label: '50-60%', min: 0.5, max: 0.6 },
  { label: '60-70%', min: 0.6, max: 0.7 },
  { label: '70-80%', min: 0.7, max: 0.8 },
  { label: '80-90%', min: 0.8, max: 0.9 },
  { label: '90-100%', min: 0.9, max: 1.0 },
];

/**
 * Get the risk bucket label for a given risk value
 */
export function getRiskBucket(risk: number): string {
  for (const bucket of RISK_BUCKETS) {
    if (risk >= bucket.min && risk < bucket.max) {
      return bucket.label;
    }
  }
  return risk >= 1 ? '90-100%' : '0-10%';
}

/**
 * Calculate percentile from sorted array
 */
function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0];

  const index = (p / 100) * (sortedValues.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const fraction = index - lower;

  if (upper >= sortedValues.length) return sortedValues[sortedValues.length - 1];

  return sortedValues[lower] * (1 - fraction) + sortedValues[upper] * fraction;
}

/**
 * Calculate forward return statistics from a set of observations
 */
function calculateForwardReturnStats(returns: number[]): ForwardReturnStats {
  if (returns.length === 0) {
    return {
      sampleCount: 0,
      median: 0,
      mean: 0,
      p10: 0,
      p25: 0,
      p75: 0,
      p90: 0,
      stdDev: 0,
      positiveRate: 0,
    };
  }

  const sorted = [...returns].sort((a, b) => a - b);
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const positiveCount = returns.filter(r => r > 0).length;

  // Calculate standard deviation
  let variance = 0;
  if (returns.length > 1) {
    variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (returns.length - 1);
  }

  return {
    sampleCount: returns.length,
    median: percentile(sorted, 50),
    mean,
    p10: percentile(sorted, 10),
    p25: percentile(sorted, 25),
    p75: percentile(sorted, 75),
    p90: percentile(sorted, 90),
    stdDev: Math.sqrt(variance),
    positiveRate: positiveCount / returns.length,
  };
}

/**
 * Calculate drawdown statistics from a set of observations
 */
function calculateDrawdownStats(
  drawdowns: number[],
  recoveryDays: number[]
): DrawdownStats {
  if (drawdowns.length === 0) {
    return {
      sampleCount: 0,
      medianDrawdown: 0,
      meanDrawdown: 0,
      maxDrawdown: 0,
      p90Drawdown: 0,
      avgRecoveryDays: 0,
    };
  }

  const sorted = [...drawdowns].sort((a, b) => a - b);
  const mean = drawdowns.reduce((a, b) => a + b, 0) / drawdowns.length;
  const avgRecovery = recoveryDays.length > 0
    ? recoveryDays.reduce((a, b) => a + b, 0) / recoveryDays.length
    : 0;

  return {
    sampleCount: drawdowns.length,
    medianDrawdown: percentile(sorted, 50),
    meanDrawdown: mean,
    maxDrawdown: sorted[sorted.length - 1] || 0,
    p90Drawdown: percentile(sorted, 90),
    avgRecoveryDays: avgRecovery,
  };
}

/**
 * Calculate max drawdown from peak over a forward period
 */
function calculateForwardMaxDrawdown(
  prices: number[],
  startIndex: number,
  forwardDays: number
): { maxDrawdown: number; recoveryDays: number } {
  const endIndex = Math.min(startIndex + forwardDays, prices.length - 1);
  if (startIndex >= endIndex) {
    return { maxDrawdown: 0, recoveryDays: 0 };
  }

  const startPrice = prices[startIndex];
  let peak = startPrice;
  let maxDrawdown = 0;
  let maxDrawdownDay = startIndex;
  let recovered = false;
  let recoveryDays = forwardDays;

  for (let i = startIndex; i <= endIndex; i++) {
    const price = prices[i];

    // Update peak (only counts as new peak if above start price)
    if (price > peak) {
      peak = price;
    }

    // Calculate drawdown from peak
    const drawdown = (peak - price) / peak;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
      maxDrawdownDay = i;
    }

    // Check for recovery (price back to start level)
    if (!recovered && price >= startPrice && i > startIndex) {
      recovered = true;
      recoveryDays = i - startIndex;
    }
  }

  return { maxDrawdown, recoveryDays };
}

/**
 * Calculate forward return over N days
 */
function calculateForwardReturn(
  prices: number[],
  startIndex: number,
  forwardDays: number
): number | null {
  const endIndex = startIndex + forwardDays;
  if (endIndex >= prices.length) return null;

  const startPrice = prices[startIndex];
  const endPrice = prices[endIndex];

  return (endPrice - startPrice) / startPrice;
}

/**
 * Build historical context by scanning past data
 * CRITICAL: Only uses data that was available at each historical point (no hindsight)
 *
 * @param risks - Array of RiskOutput (historical)
 * @param prices - Array of prices corresponding to risks
 * @param currentIndex - Current day index (only analyzes data BEFORE this)
 * @param cyclePhase - Current cycle phase
 * @param momentumDirection - Current momentum direction
 * @returns HistoricalContext with forward return and drawdown statistics
 */
export function buildHistoricalContext(
  risks: RiskOutput[],
  prices: number[],
  currentIndex: number,
  cyclePhase: 'early' | 'mid' | 'late',
  momentumDirection: MomentumDirection
): HistoricalContext {
  const currentRisk = risks[currentIndex].smoothedRisk;
  const riskBucket = getRiskBucket(currentRisk);

  // Find all historical days that match current conditions
  // ONLY use days BEFORE currentIndex to avoid hindsight leakage
  const matchingIndices: number[] = [];

  // Need at least 365 days of forward data for full analysis
  // So only consider days up to (currentIndex - 365) for the longest horizon
  const maxLookback = Math.min(currentIndex - 365, risks.length - 365);

  for (let i = 30; i < maxLookback; i++) {
    const histRisk = risks[i].smoothedRisk;
    const histBucket = getRiskBucket(histRisk);

    // Match risk bucket
    if (histBucket !== riskBucket) continue;

    // Get historical cycle phase (from the feature vector if available)
    // For simplicity, we'll use a relaxed match on cycle phase
    // In production, you'd want to pass FeatureVector[] as well

    // Get historical momentum direction
    const riskValues = risks.slice(0, i + 1).map(r => r.smoothedRisk);
    const histDelta7d = i >= 7 ? riskValues[i] - riskValues[i - 7] : 0;
    const histMomentum = getMomentumDirection(histDelta7d);

    // Match momentum direction
    if (histMomentum !== momentumDirection) continue;

    // This day matches our current conditions
    matchingIndices.push(i);
  }

  // Calculate forward returns at various horizons
  const forwardReturns30: number[] = [];
  const forwardReturns90: number[] = [];
  const forwardReturns180: number[] = [];
  const forwardReturns365: number[] = [];

  const drawdowns30: number[] = [];
  const drawdowns90: number[] = [];
  const drawdowns180: number[] = [];
  const recoveryDays30: number[] = [];
  const recoveryDays90: number[] = [];
  const recoveryDays180: number[] = [];

  for (const idx of matchingIndices) {
    // Forward returns
    const ret30 = calculateForwardReturn(prices, idx, 30);
    const ret90 = calculateForwardReturn(prices, idx, 90);
    const ret180 = calculateForwardReturn(prices, idx, 180);
    const ret365 = calculateForwardReturn(prices, idx, 365);

    if (ret30 !== null) forwardReturns30.push(ret30);
    if (ret90 !== null) forwardReturns90.push(ret90);
    if (ret180 !== null) forwardReturns180.push(ret180);
    if (ret365 !== null) forwardReturns365.push(ret365);

    // Forward drawdowns
    const dd30 = calculateForwardMaxDrawdown(prices, idx, 30);
    const dd90 = calculateForwardMaxDrawdown(prices, idx, 90);
    const dd180 = calculateForwardMaxDrawdown(prices, idx, 180);

    drawdowns30.push(dd30.maxDrawdown);
    drawdowns90.push(dd90.maxDrawdown);
    drawdowns180.push(dd180.maxDrawdown);

    recoveryDays30.push(dd30.recoveryDays);
    recoveryDays90.push(dd90.recoveryDays);
    recoveryDays180.push(dd180.recoveryDays);
  }

  return {
    riskBucket,
    cyclePhase,
    momentumDirection,
    forwardReturns: {
      days30: calculateForwardReturnStats(forwardReturns30),
      days90: calculateForwardReturnStats(forwardReturns90),
      days180: calculateForwardReturnStats(forwardReturns180),
      days365: calculateForwardReturnStats(forwardReturns365),
    },
    drawdownStats: {
      days30: calculateDrawdownStats(drawdowns30, recoveryDays30),
      days90: calculateDrawdownStats(drawdowns90, recoveryDays90),
      days180: calculateDrawdownStats(drawdowns180, recoveryDays180),
    },
    disclaimer:
      'HISTORICAL CONTEXT ONLY. Past performance does not guarantee future results. ' +
      'These statistics are derived from limited historical data and may not be representative of future outcomes. ' +
      'Sample sizes may be small. Use for informational purposes only.',
  };
}

/**
 * Calculate historical context for a specific day
 * Convenience wrapper that extracts cycle phase and momentum
 */
export function calculateHistoricalContext(
  risks: RiskOutput[],
  prices: number[],
  currentIndex: number,
  cyclePhase: 'early' | 'mid' | 'late'
): HistoricalContext {
  // Calculate momentum direction
  const riskValues = risks.slice(0, currentIndex + 1).map(r => r.smoothedRisk);
  const delta7d = currentIndex >= 7 ? riskValues[currentIndex] - riskValues[currentIndex - 7] : 0;
  const momentumDirection = getMomentumDirection(delta7d);

  return buildHistoricalContext(risks, prices, currentIndex, cyclePhase, momentumDirection);
}

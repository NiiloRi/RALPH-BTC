/**
 * Macro/liquidity features for BTC risk model
 * Measures broader market risk-on/risk-off conditions
 */

import { DailyData, MacroComponents } from '../types';

/**
 * Calculate DXY z-score relative to historical mean
 * Higher DXY = stronger dollar = risk-off = lower BTC risk appetite
 */
export function calculateDXYZScore(
  dxyValues: (number | undefined)[],
  index: number,
  lookback: number = 365
): number {
  const values: number[] = [];

  for (let i = Math.max(0, index - lookback); i <= index; i++) {
    if (dxyValues[i] !== undefined) {
      values.push(dxyValues[i]!);
    }
  }

  if (values.length < 10) return 0;

  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
  const std = Math.sqrt(variance);

  if (std === 0) return 0;

  const current = dxyValues[index];
  if (current === undefined) return 0;

  return (current - mean) / std;
}

/**
 * Calculate simple risk-on/risk-off indicator
 * Based on available macro data
 */
export function calculateRiskSentiment(
  dxyZScore: number,
  btcReturn90d: number
): number {
  // DXY z-score: negative = weak dollar = risk-on
  // BTC 90d return: positive = bullish sentiment

  const dxyComponent = -dxyZScore; // Invert so negative DXY = positive risk-on
  const btcComponent = btcReturn90d > 0 ? 1 : btcReturn90d < -0.2 ? -1 : 0;

  // Combine signals
  return (dxyComponent + btcComponent) / 2;
}

/**
 * Calculate liquidity proxy
 * Without direct M2 data, use BTC's correlation with price as proxy
 * High prices with low vol = liquidity abundant
 */
export function calculateLiquidityProxy(
  data: DailyData[],
  index: number
): number {
  if (index < 90) return 0.5;

  const current = data[index];
  const prices = data.slice(0, index + 1).map(d => d.price);

  // Price percentile in last year
  const yearPrices = prices.slice(Math.max(0, index - 365));
  const pricePercentile =
    yearPrices.filter(p => p <= current.price).length / yearPrices.length;

  // Inverse volatility (low vol = stable liquidity)
  const vol = current.realizedVol30d || 0.5;
  const avgVol = data
    .slice(Math.max(0, index - 365), index)
    .reduce((sum, d) => sum + (d.realizedVol30d || 0), 0) / Math.min(365, index);

  const volRatio = avgVol > 0 ? vol / avgVol : 1;
  const volComponent = Math.max(0, Math.min(1, 1 - (volRatio - 0.5)));

  // Combine: high price percentile + low vol = abundant liquidity
  return pricePercentile * 0.6 + volComponent * 0.4;
}

/**
 * Calculate M2 signal from year-over-year M2 change
 * Positive M2 YoY = expanding liquidity = risk-on for BTC
 * Negative M2 YoY = contracting liquidity = risk-off (rare but happened in 2022-2023)
 * Returns normalized score [0, 1] where 0 = bearish, 1 = bullish
 */
export function calculateM2Signal(data: DailyData[], index: number): number {
  const current = data[index];
  const m2YoY = current.m2YoY;

  if (m2YoY === undefined) return 0.5; // Neutral if unavailable

  // M2 YoY historical range: roughly -3% to +25%
  // -3% or lower = 0 (max bearish - contracting liquidity)
  // +12% or higher = 1 (max bullish - rapidly expanding)
  // Note: M2 going negative is extremely rare and very bearish for BTC
  const normalized = (m2YoY + 0.03) / 0.15;
  return Math.max(0, Math.min(1, normalized));
}

/**
 * Calculate Fed Funds Rate signal
 * Lower rates = easier money = risk-on = higher BTC
 * Higher rates = tighter money = risk-off = lower BTC
 * Returns normalized score [0, 1] where 0 = bearish (high rates), 1 = bullish (low rates)
 */
export function calculateFedFundsSignal(data: DailyData[], index: number): number {
  const current = data[index];
  const fedFunds = current.fedFunds;

  if (fedFunds === undefined) return 0.5; // Neutral if unavailable

  // Fed Funds historical range: 0% to ~6%
  // High rates (6%+) = 0 (bearish)
  // Low rates (0-1%) = 1 (bullish)
  const normalized = 1 - (fedFunds / 6);
  return Math.max(0, Math.min(1, normalized));
}

/**
 * Calculate yield curve signal from 10Y-2Y spread
 * Positive spread (normal curve) = healthy economy = risk-on
 * Negative spread (inverted curve) = recession risk = risk-off for crypto
 * Returns normalized score [0, 1] where 0 = bearish, 1 = bullish
 */
export function calculateYieldCurveSignal(data: DailyData[], index: number): number {
  const current = data[index];
  const spread = current.yieldSpread;

  if (spread === undefined) return 0.5; // Neutral if unavailable

  // Spread range: roughly -1% to +2.5%
  // -1% or lower (deep inversion) = 0 (very bearish)
  // +2% or higher = 1 (very bullish)
  const normalized = (spread + 1) / 3;
  return Math.max(0, Math.min(1, normalized));
}

/**
 * Calculate real rate signal from 10Y TIPS yield
 * Negative real rates = financial repression = bullish for hard assets like BTC
 * Positive real rates = real cost to holding non-yielding assets = bearish for BTC
 * Returns normalized score [0, 1] where 0 = bearish (positive real rates), 1 = bullish
 */
export function calculateRealRateSignal(data: DailyData[], index: number): number {
  const current = data[index];
  const realRate = current.realRate;

  if (realRate === undefined) return 0.5; // Neutral if unavailable

  // Real rate range: roughly -2% to +2.5%
  // +2.5% or higher = 0 (very bearish - high real cost of capital)
  // -1.5% or lower = 1 (very bullish - financial repression)
  const normalized = (-realRate + 2) / 4;
  return Math.max(0, Math.min(1, normalized));
}

/**
 * Calculate DXY signal (normalized)
 * Returns score [0, 1] where 0 = strong dollar (bearish for BTC), 1 = weak dollar (bullish)
 */
export function calculateDXYSignal(data: DailyData[], index: number): number {
  if (index < 30) return 0.5;

  const current = data[index];
  if (current.dxy === undefined) return 0.5;

  const dxyValues = data.slice(0, index + 1).map(d => d.dxy);
  const dxyZScore = calculateDXYZScore(dxyValues, index);

  // Negative z-score (weak dollar) = bullish for BTC
  // Positive z-score (strong dollar) = bearish for BTC
  // Map z-score from [-2, +3] to [1, 0]
  const normalized = Math.max(0, Math.min(1, 0.5 - dxyZScore * 0.2));
  return normalized;
}

/**
 * Calculate macro regime volatility
 * Higher volatility in macro indicators = more unusual conditions = higher predictive power
 * Used for dynamic weighting of the macro component
 */
export function calculateMacroRegimeVolatility(
  data: DailyData[],
  index: number,
  lookback: number = 365
): number {
  if (index < 90) return 0;

  const startIdx = Math.max(0, index - lookback);
  const slice = data.slice(startIdx, index + 1);

  // Calculate variance of each available macro indicator
  let totalVariance = 0;
  let indicatorCount = 0;

  // M2 YoY variance
  const m2Values = slice.map(d => d.m2YoY).filter((v): v is number => v !== undefined);
  if (m2Values.length >= 30) {
    const m2Mean = m2Values.reduce((a, b) => a + b, 0) / m2Values.length;
    const m2Var = m2Values.reduce((sum, v) => sum + (v - m2Mean) ** 2, 0) / m2Values.length;
    totalVariance += m2Var * 100; // Scale up since M2 YoY is in decimal form
    indicatorCount++;
  }

  // Fed Funds variance
  const ffValues = slice.map(d => d.fedFunds).filter((v): v is number => v !== undefined);
  if (ffValues.length >= 30) {
    const ffMean = ffValues.reduce((a, b) => a + b, 0) / ffValues.length;
    const ffVar = ffValues.reduce((sum, v) => sum + (v - ffMean) ** 2, 0) / ffValues.length;
    totalVariance += ffVar;
    indicatorCount++;
  }

  // Yield spread variance
  const ysValues = slice.map(d => d.yieldSpread).filter((v): v is number => v !== undefined);
  if (ysValues.length >= 30) {
    const ysMean = ysValues.reduce((a, b) => a + b, 0) / ysValues.length;
    const ysVar = ysValues.reduce((sum, v) => sum + (v - ysMean) ** 2, 0) / ysValues.length;
    totalVariance += ysVar;
    indicatorCount++;
  }

  if (indicatorCount === 0) return 0;

  // Average variance across indicators
  const avgVariance = totalVariance / indicatorCount;

  // Historical average variance (approximate baseline from 2017-2021 period)
  const historicalAvgVariance = 0.5;

  // Return ratio: >1 means more volatile than normal
  return Math.min(3, avgVariance / historicalAvgVariance);
}

/**
 * Calculate dynamic macro weight based on regime volatility
 * When macro conditions are unusual (high variance), give macro component more weight
 * When macro is stable (low variance), reduce weight since it's less predictive
 */
export function calculateDynamicMacroWeight(
  data: DailyData[],
  index: number,
  baseWeight: number = 0.05,
  maxWeight: number = 0.15
): number {
  const regimeVol = calculateMacroRegimeVolatility(data, index);

  // Scale from base to max based on regime volatility
  // regimeVol = 0-1: use base weight
  // regimeVol = 1-2: scale up linearly
  // regimeVol >= 2: use max weight
  if (regimeVol <= 1) {
    return baseWeight;
  } else if (regimeVol >= 2) {
    return maxWeight;
  } else {
    // Linear interpolation
    return baseWeight + (maxWeight - baseWeight) * (regimeVol - 1);
  }
}

/**
 * Calculate comprehensive macro score [0, 1]
 * Higher = more risk-on environment = potentially higher risk (extended)
 *
 * Now uses expanded macro indicators:
 * - M2 YoY (35% when available) - strongest leading indicator
 * - Fed Funds Rate (25% when available)
 * - Yield Curve (15% when available)
 * - Real Rates (15% when available)
 * - DXY (10% when available)
 */
export function calculateMacroScore(
  data: DailyData[],
  index: number
): number {
  if (index < 30) return 0.5;

  // Calculate all available signals
  const m2Signal = calculateM2Signal(data, index);
  const fedFundsSignal = calculateFedFundsSignal(data, index);
  const yieldCurveSignal = calculateYieldCurveSignal(data, index);
  const realRateSignal = calculateRealRateSignal(data, index);
  const dxySignal = calculateDXYSignal(data, index);
  const liquidityProxy = calculateLiquidityProxy(data, index);

  const current = data[index];

  // Define weights for each component
  // These weights reflect the relative importance and leading nature of each indicator
  const weights = {
    m2: 0.35,           // Strongest leading indicator
    fedFunds: 0.25,     // Important but somewhat lagging
    yieldCurve: 0.15,   // Good recession predictor
    realRate: 0.15,     // Important for BTC valuation
    dxy: 0.10,          // Still useful but reduced weight
  };

  // Track which components are available
  let score = 0;
  let totalWeight = 0;

  // M2 YoY
  if (current.m2YoY !== undefined) {
    score += m2Signal * weights.m2;
    totalWeight += weights.m2;
  }

  // Fed Funds
  if (current.fedFunds !== undefined) {
    score += fedFundsSignal * weights.fedFunds;
    totalWeight += weights.fedFunds;
  }

  // Yield Curve
  if (current.yieldSpread !== undefined) {
    score += yieldCurveSignal * weights.yieldCurve;
    totalWeight += weights.yieldCurve;
  }

  // Real Rate
  if (current.realRate !== undefined) {
    score += realRateSignal * weights.realRate;
    totalWeight += weights.realRate;
  }

  // DXY
  if (current.dxy !== undefined) {
    score += dxySignal * weights.dxy;
    totalWeight += weights.dxy;
  }

  // If we have some real macro data, use it
  if (totalWeight > 0) {
    return score / totalWeight;
  }

  // Fallback to liquidity proxy + BTC sentiment when no macro data available
  const btcReturn = current.return90d || 0;
  const btcSentiment = Math.min(1, Math.max(0, 0.5 + btcReturn));

  return liquidityProxy * 0.5 + btcSentiment * 0.5;
}

/**
 * Get macro sub-components for debugging/display
 */
export function getMacroComponents(
  data: DailyData[],
  index: number
): MacroComponents {
  return {
    m2Signal: calculateM2Signal(data, index),
    fedFundsSignal: calculateFedFundsSignal(data, index),
    yieldCurveSignal: calculateYieldCurveSignal(data, index),
    realRateSignal: calculateRealRateSignal(data, index),
    dxySignal: calculateDXYSignal(data, index),
    liquidityProxy: calculateLiquidityProxy(data, index),
  };
}

/**
 * Get enhanced macro result including score, dynamic weight, and components
 */
export function calculateEnhancedMacroScore(
  data: DailyData[],
  index: number
): { score: number; weight: number; components: MacroComponents } {
  const score = calculateMacroScore(data, index);
  const weight = calculateDynamicMacroWeight(data, index);
  const components = getMacroComponents(data, index);

  return { score, weight, components };
}

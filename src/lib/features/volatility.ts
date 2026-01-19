/**
 * Volatility and fragility features for BTC risk model
 * Measures market stability and drawdown risk
 */

import { DailyData } from '../types';

/**
 * Calculate realized volatility percentile
 * Higher volatility historically associated with tops/bottoms
 */
export function calculateVolPercentile(
  currentVol: number,
  historicalVols: number[]
): number {
  if (historicalVols.length === 0) return 0.5;

  const count = historicalVols.filter(v => v <= currentVol).length;
  return count / historicalVols.length;
}

/**
 * Calculate volatility z-score relative to historical mean
 */
export function calculateVolZScore(
  currentVol: number,
  historicalVols: number[]
): number {
  if (historicalVols.length < 2) return 0;

  const mean = historicalVols.reduce((a, b) => a + b, 0) / historicalVols.length;
  const variance =
    historicalVols.reduce((sum, v) => sum + (v - mean) ** 2, 0) /
    (historicalVols.length - 1);
  const std = Math.sqrt(variance);

  if (std === 0) return 0;

  return (currentVol - mean) / std;
}

/**
 * Calculate maximum drawdown over a period
 */
export function calculateMaxDrawdown(
  prices: number[],
  period: number
): number {
  if (prices.length < period) return 0;

  const slice = prices.slice(-period);
  let maxDrawdown = 0;
  let peak = slice[0];

  for (const price of slice) {
    if (price > peak) {
      peak = price;
    }
    const drawdown = (peak - price) / peak;
    maxDrawdown = Math.max(maxDrawdown, drawdown);
  }

  return maxDrawdown;
}

/**
 * Calculate drawdown duration (days since local peak)
 */
export function calculateDrawdownDuration(prices: number[]): number {
  if (prices.length === 0) return 0;

  let peak = prices[0];
  let peakIdx = 0;

  for (let i = 0; i < prices.length; i++) {
    if (prices[i] > peak) {
      peak = prices[i];
      peakIdx = i;
    }
  }

  return prices.length - 1 - peakIdx;
}

/**
 * Calculate average true range (simplified - using daily range)
 */
export function calculateATR(
  data: DailyData[],
  period: number = 14
): number {
  if (data.length < period) return 0;

  let sum = 0;
  const slice = data.slice(-period);

  for (let i = 1; i < slice.length; i++) {
    const current = slice[i];
    const prev = slice[i - 1];

    // Simplified: use absolute daily return as proxy for true range
    const dailyRange = Math.abs(current.price - prev.price) / prev.price;
    sum += dailyRange;
  }

  return sum / (period - 1);
}

/**
 * Volatility regime detection
 * Returns: 'low', 'normal', 'high', 'extreme'
 */
export function detectVolatilityRegime(
  currentVol: number,
  historicalVols: number[]
): 'low' | 'normal' | 'high' | 'extreme' {
  const percentile = calculateVolPercentile(currentVol, historicalVols);

  if (percentile < 0.2) return 'low';
  if (percentile < 0.6) return 'normal';
  if (percentile < 0.9) return 'high';
  return 'extreme';
}

/**
 * Calculate fragility index
 * Combines multiple indicators of market stress
 */
export function calculateFragilityIndex(
  data: DailyData[],
  index: number
): number {
  if (index < 90) return 0.5;

  const prices = data.slice(0, index + 1).map(d => d.price);
  const current = data[index];

  // Max drawdown in last 30 days
  const dd30 = calculateMaxDrawdown(prices, 30);

  // Max drawdown in last 90 days
  const dd90 = calculateMaxDrawdown(prices, 90);

  // Volatility level
  const vol = current.realizedVol30d || 0;
  const historicalVols = data.slice(0, index).map(d => d.realizedVol30d || 0);
  const volPercentile = calculateVolPercentile(vol, historicalVols);

  // Recent large moves (days with >5% move in last 30 days)
  let largeMoves = 0;
  for (let i = Math.max(0, index - 30); i <= index; i++) {
    const dailyReturn = Math.abs(data[i].return1d || 0);
    if (dailyReturn > 0.05) largeMoves++;
  }
  const largeMoveRatio = largeMoves / 30;

  // Combine into fragility index
  return (dd30 * 0.25 + dd90 * 0.25 + volPercentile * 0.3 + largeMoveRatio * 0.2);
}

/**
 * Calculate comprehensive volatility score [0, 1]
 * Higher = higher volatility/fragility = potentially higher risk
 * Note: High vol at tops = risky, but high vol at bottoms = opportunity
 */
export function calculateVolatilityScore(
  data: DailyData[],
  index: number
): number {
  if (index < 90) return 0.5;

  const current = data[index];
  const prices = data.slice(0, index + 1).map(d => d.price);
  const vols = data.slice(0, index + 1).map(d => d.realizedVol30d || 0);

  // Current volatility percentile
  const volPercentile = calculateVolPercentile(
    current.realizedVol30d || 0,
    vols.slice(0, -1)
  );

  // Volatility z-score
  const volZScore = calculateVolZScore(
    current.realizedVol30d || 0,
    vols.slice(0, -1)
  );
  // Normalize z-score to [0, 1] range (typically -2 to +3)
  const volZScoreNorm = Math.min(1, Math.max(0, (volZScore + 2) / 5));

  // Recent drawdown
  const dd30 = calculateMaxDrawdown(prices, 30);
  const dd30Score = Math.min(1, dd30 / 0.4); // Normalize: 40% dd -> 1

  // Drawdown duration
  const ddDuration = calculateDrawdownDuration(prices);
  // Long drawdowns (>90 days) indicate consolidation, not high risk
  const durationScore = Math.min(1, Math.max(0, 1 - ddDuration / 90));

  // Fragility
  const fragility = calculateFragilityIndex(data, index);

  // ATR (14-day)
  const atr = calculateATR(data.slice(0, index + 1), 14);
  const historicalATRs = [];
  for (let i = 14; i < index; i++) {
    historicalATRs.push(calculateATR(data.slice(0, i + 1), 14));
  }
  const atrPercentile = calculateVolPercentile(atr, historicalATRs);

  // Weighted combination
  const weights = {
    volPercentile: 0.25,
    volZScore: 0.15,
    dd30: 0.15,
    duration: 0.1,
    fragility: 0.2,
    atr: 0.15,
  };

  const score =
    weights.volPercentile * volPercentile +
    weights.volZScore * volZScoreNorm +
    weights.dd30 * dd30Score +
    weights.duration * durationScore +
    weights.fragility * fragility +
    weights.atr * atrPercentile;

  return Math.min(1, Math.max(0, score));
}

/**
 * Get volatility sub-components for debugging/display
 */
export function getVolatilityComponents(
  data: DailyData[],
  index: number
): {
  realizedVol30d: number;
  volPercentile: number;
  volZScore: number;
  maxDrawdown30d: number;
  maxDrawdown90d: number;
  drawdownDuration: number;
  fragility: number;
  volatilityRegime: 'low' | 'normal' | 'high' | 'extreme';
} {
  const current = data[index];
  const prices = data.slice(0, index + 1).map(d => d.price);
  const vols = data.slice(0, index + 1).map(d => d.realizedVol30d || 0);

  return {
    realizedVol30d: current.realizedVol30d || 0,
    volPercentile: calculateVolPercentile(current.realizedVol30d || 0, vols.slice(0, -1)),
    volZScore: calculateVolZScore(current.realizedVol30d || 0, vols.slice(0, -1)),
    maxDrawdown30d: calculateMaxDrawdown(prices, 30),
    maxDrawdown90d: calculateMaxDrawdown(prices, 90),
    drawdownDuration: calculateDrawdownDuration(prices),
    fragility: calculateFragilityIndex(data, index),
    volatilityRegime: detectVolatilityRegime(current.realizedVol30d || 0, vols.slice(0, -1)),
  };
}

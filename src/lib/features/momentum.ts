/**
 * Momentum and trend features for BTC risk model
 * Measures price momentum and trend strength
 */

import { DailyData } from '../types';

/**
 * Calculate RSI (Relative Strength Index)
 * RSI > 70 typically indicates overbought (higher risk)
 * RSI < 30 typically indicates oversold (lower risk)
 */
export function calculateRSI(prices: number[], period: number = 14): number {
  if (prices.length < period + 1) return 50;

  let gains = 0;
  let losses = 0;

  for (let i = prices.length - period; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) {
      gains += change;
    } else {
      losses -= change;
    }
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;

  if (avgLoss === 0) return 100;

  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * Calculate rate of change (momentum)
 */
export function calculateROC(current: number, previous: number): number {
  if (previous <= 0) return 0;
  return ((current - previous) / previous) * 100;
}

/**
 * Golden cross / Death cross detection
 * Returns 1 for golden cross (bullish), -1 for death cross (bearish)
 */
export function detectCrossover(
  sma50: number,
  sma200: number,
  prevSma50: number,
  prevSma200: number
): number {
  const currentAbove = sma50 > sma200;
  const prevAbove = prevSma50 > prevSma200;

  if (currentAbove && !prevAbove) return 1; // Golden cross
  if (!currentAbove && prevAbove) return -1; // Death cross
  return 0;
}

/**
 * Check if price is above key moving averages
 */
export function isAboveMAs(
  price: number,
  sma50: number,
  sma200: number
): { above50: boolean; above200: boolean; sma50Above200: boolean } {
  return {
    above50: price > sma50,
    above200: price > sma200,
    sma50Above200: sma50 > sma200,
  };
}

/**
 * Calculate distance from moving average as percentage
 */
export function distanceFromMA(price: number, ma: number): number {
  if (ma <= 0) return 0;
  return ((price - ma) / ma) * 100;
}

/**
 * Trend strength using ADX-like calculation (simplified)
 * Uses directional movement over a period
 */
export function calculateTrendStrength(
  prices: number[],
  period: number = 14
): number {
  if (prices.length < period + 1) return 0;

  let upMoves = 0;
  let downMoves = 0;
  let totalMoves = 0;

  for (let i = prices.length - period; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    const absChange = Math.abs(change);
    totalMoves += absChange;

    if (change > 0) {
      upMoves += absChange;
    } else {
      downMoves += absChange;
    }
  }

  if (totalMoves === 0) return 0;

  // Directional index: difference between up and down moves
  const di = Math.abs(upMoves - downMoves) / totalMoves;

  return di;
}

/**
 * Calculate comprehensive momentum score [0, 1]
 * Higher = stronger upward momentum = potentially higher risk (overextended)
 *
 * IMPROVED:
 * - TIGHTER normalization ranges → more sensitive to extremes
 * - Added momentum acceleration (2nd derivative) for blow-off top detection
 * - RSI uses extended overbought zone (>75 = extreme)
 * - ROC ranges narrowed to amplify signal at extremes
 * - Distance from 200MA range tightened
 */
export function calculateMomentumScore(
  data: DailyData[],
  index: number
): number {
  if (index < 200) return 0.5; // Not enough data

  const current = data[index];
  const prices = data.slice(0, index + 1).map(d => d.price);

  // RSI (14-day) with non-linear scaling at extremes
  const rsi = calculateRSI(prices, 14);
  // Non-linear: 25→0.0, 45→0.3, 55→0.5, 70→0.8, 80→0.95, 90→1.0
  let rsiScore: number;
  if (rsi <= 30) rsiScore = rsi / 30 * 0.15;           // 0-30 → 0.0-0.15 (oversold)
  else if (rsi <= 50) rsiScore = 0.15 + (rsi - 30) / 20 * 0.25;  // 30-50 → 0.15-0.40
  else if (rsi <= 70) rsiScore = 0.40 + (rsi - 50) / 20 * 0.35;  // 50-70 → 0.40-0.75
  else rsiScore = 0.75 + (rsi - 70) / 30 * 0.25;       // 70-100 → 0.75-1.0 (overbought)

  // Short-term momentum (7-day) - TIGHTER: -15% to +15%
  const roc7 = current.return7d ? current.return7d * 100 : 0;
  const roc7Score = (roc7 + 15) / 30;

  // Medium-term momentum (30-day) - TIGHTER: -30% to +50%
  const roc30 = current.return30d ? current.return30d * 100 : 0;
  const roc30Score = (roc30 + 30) / 80;

  // Long-term momentum (90-day) - TIGHTER: -40% to +100%
  const roc90 = current.return90d ? current.return90d * 100 : 0;
  const roc90Score = (roc90 + 40) / 140;

  // Distance from 200MA - TIGHTER: -30% to +80%
  const dist200 = distanceFromMA(current.price, current.sma200 || current.price);
  const dist200Score = (dist200 + 30) / 110;

  // MA alignment (bullish structure = higher risk when extended)
  const maAlignment = isAboveMAs(
    current.price,
    current.sma50 || current.price,
    current.sma200 || current.price
  );
  const maScore = (
    (maAlignment.above50 ? 1 : 0) +
    (maAlignment.above200 ? 1 : 0) +
    (maAlignment.sma50Above200 ? 1 : 0)
  ) / 3;

  // Trend strength
  const trendStrength = calculateTrendStrength(prices, 14);
  const isUptrend = current.price > (current.sma50 || current.price);
  const trendScore = isUptrend ? trendStrength : 1 - trendStrength;

  // NEW: Momentum acceleration (blow-off top detector)
  // Compare recent 7d ROC vs 30d average ROC
  let accelerationScore = 0.5;
  if (index >= 37) {
    const prev30d = data[index - 30];
    const prevRoc7 = prev30d?.return7d ? prev30d.return7d * 100 : 0;
    const acceleration = roc7 - prevRoc7;
    // Normalize: -20 → 0, 0 → 0.5, +20 → 1.0
    accelerationScore = Math.min(1, Math.max(0, (acceleration + 20) / 40));
  }

  // Rebalanced weights with acceleration
  const weights = {
    rsi: 0.20,
    roc7: 0.08,
    roc30: 0.18,
    roc90: 0.12,
    dist200: 0.15,
    ma: 0.08,
    trend: 0.09,
    accel: 0.10,   // NEW: momentum acceleration
  };

  const score =
    weights.rsi * Math.min(1, Math.max(0, rsiScore)) +
    weights.roc7 * Math.min(1, Math.max(0, roc7Score)) +
    weights.roc30 * Math.min(1, Math.max(0, roc30Score)) +
    weights.roc90 * Math.min(1, Math.max(0, roc90Score)) +
    weights.dist200 * Math.min(1, Math.max(0, dist200Score)) +
    weights.ma * maScore +
    weights.trend * trendScore +
    weights.accel * accelerationScore;

  return Math.min(1, Math.max(0, score));
}

/**
 * Get momentum sub-components for debugging/display
 */
export function getMomentumComponents(
  data: DailyData[],
  index: number
): {
  rsi: number;
  roc7: number;
  roc30: number;
  roc90: number;
  distanceFrom200MA: number;
  aboveSMA50: boolean;
  aboveSMA200: boolean;
  sma50Above200: boolean;
  trendStrength: number;
} {
  const current = data[index];
  const prices = data.slice(0, index + 1).map(d => d.price);
  const maAlignment = isAboveMAs(
    current.price,
    current.sma50 || current.price,
    current.sma200 || current.price
  );

  return {
    rsi: calculateRSI(prices, 14),
    roc7: (current.return7d || 0) * 100,
    roc30: (current.return30d || 0) * 100,
    roc90: (current.return90d || 0) * 100,
    distanceFrom200MA: distanceFromMA(current.price, current.sma200 || current.price),
    aboveSMA50: maAlignment.above50,
    aboveSMA200: maAlignment.above200,
    sma50Above200: maAlignment.sma50Above200,
    trendStrength: calculateTrendStrength(prices, 14),
  };
}

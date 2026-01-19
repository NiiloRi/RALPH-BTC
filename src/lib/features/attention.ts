/**
 * Retail attention features for BTC risk model
 * Measures public interest and sentiment
 */

import { DailyData } from '../types';

/**
 * Google Trends proxy using price momentum
 * Strong price moves typically correlate with search interest
 */
export function calculateAttentionProxy(
  data: DailyData[],
  index: number
): number {
  if (index < 30) return 0.5;

  const current = data[index];

  // Strong recent returns = likely high attention
  const return7d = Math.abs(current.return7d || 0);
  const return30d = Math.abs(current.return30d || 0);

  // ATH proximity = high attention
  const prices = data.slice(0, index + 1).map(d => d.price);
  let athPrice = 0;
  for (let i = 0; i <= index; i++) {
    athPrice = Math.max(athPrice, prices[i]);
  }
  const athProximity = current.price / athPrice;

  // Volatility spike = attention spike
  const vols = data.slice(0, index + 1).map(d => d.realizedVol30d || 0);
  const avgVol = vols.slice(0, -1).reduce((a, b) => a + b, 0) / Math.max(1, vols.length - 1);
  const volRatio = avgVol > 0 ? (current.realizedVol30d || 0) / avgVol : 1;

  // Combine signals
  const returnScore = Math.min(1, (return7d + return30d) * 3);
  const athScore = athProximity; // 1 at ATH, lower otherwise
  const volScore = Math.min(1, volRatio / 2);

  return returnScore * 0.3 + athScore * 0.5 + volScore * 0.2;
}

/**
 * Calculate Fear & Greed proxy
 * Uses multiple signals to estimate market sentiment
 */
export function calculateFearGreedProxy(
  data: DailyData[],
  index: number
): number {
  if (index < 90) return 50;

  const current = data[index];
  const prices = data.slice(0, index + 1).map(d => d.price);

  // Momentum (weighted recent returns)
  const return30d = current.return30d || 0;
  const momentum = Math.min(1, Math.max(-1, return30d * 2));
  const momentumScore = (momentum + 1) / 2 * 100;

  // Volatility (higher vol = more fear typically)
  const vol = current.realizedVol30d || 0;
  const vols = data.slice(Math.max(0, index - 365), index).map(d => d.realizedVol30d || 0);
  const avgVol = vols.reduce((a, b) => a + b, 0) / Math.max(1, vols.length);
  const volRatio = avgVol > 0 ? vol / avgVol : 1;
  // High vol = fear (lower score), low vol = greed (higher score)
  const volScore = Math.min(100, Math.max(0, 100 - volRatio * 50));

  // Price vs MA (above MA = greed, below = fear)
  const sma200 = current.sma200 || current.price;
  const maDeviation = (current.price - sma200) / sma200;
  const maScore = Math.min(100, Math.max(0, 50 + maDeviation * 100));

  // Drawdown (deep drawdown = fear)
  let athPrice = 0;
  for (const p of prices) athPrice = Math.max(athPrice, p);
  const drawdown = (athPrice - current.price) / athPrice;
  const ddScore = Math.min(100, Math.max(0, 100 - drawdown * 200));

  // Combine (equal weights for simplicity)
  return (momentumScore + volScore + maScore + ddScore) / 4;
}

/**
 * Calculate comprehensive attention score [0, 1]
 * Higher = more retail attention = potentially higher risk (euphoria)
 */
export function calculateAttentionScore(
  data: DailyData[],
  index: number
): number {
  if (index < 30) return 0.5;

  const current = data[index];

  // Use actual Google Trends if available
  if (current.googleTrends !== undefined) {
    // Normalize 0-100 to 0-1
    return current.googleTrends / 100;
  }

  // Use Fear & Greed if available
  if (current.fearGreedIndex !== undefined) {
    // Normalize 0-100 to 0-1
    return current.fearGreedIndex / 100;
  }

  // Fall back to proxy
  const attentionProxy = calculateAttentionProxy(data, index);
  const fearGreedProxy = calculateFearGreedProxy(data, index) / 100;

  // Weight attention proxy more (it's more direct)
  return attentionProxy * 0.6 + fearGreedProxy * 0.4;
}

/**
 * Get attention sub-components for debugging/display
 */
export function getAttentionComponents(
  data: DailyData[],
  index: number
): {
  googleTrends: number | undefined;
  fearGreedIndex: number | undefined;
  attentionProxy: number;
  fearGreedProxy: number;
  athProximity: number;
} {
  const current = data[index];
  const prices = data.slice(0, index + 1).map(d => d.price);

  let athPrice = 0;
  for (const p of prices) athPrice = Math.max(athPrice, p);

  return {
    googleTrends: current.googleTrends,
    fearGreedIndex: current.fearGreedIndex,
    attentionProxy: calculateAttentionProxy(data, index),
    fearGreedProxy: calculateFearGreedProxy(data, index),
    athProximity: current.price / athPrice,
  };
}

/**
 * Macro/liquidity features for BTC risk model
 * Measures broader market risk-on/risk-off conditions
 */

import { DailyData } from '../types';

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
 * Calculate comprehensive macro score [0, 1]
 * Higher = more risk-on environment = potentially higher risk (extended)
 */
export function calculateMacroScore(
  data: DailyData[],
  index: number
): number {
  if (index < 30) return 0.5;

  const current = data[index];
  const dxyValues = data.slice(0, index + 1).map(d => d.dxy);

  // DXY z-score (if available)
  let dxyComponent = 0.5;
  if (current.dxy !== undefined) {
    const dxyZScore = calculateDXYZScore(dxyValues, index);
    // Negative z-score (weak dollar) = risk-on = higher BTC risk
    dxyComponent = Math.min(1, Math.max(0, 0.5 - dxyZScore * 0.2));
  }

  // Liquidity proxy
  const liquidity = calculateLiquidityProxy(data, index);

  // BTC sentiment based on recent returns
  const btcReturn = current.return90d || 0;
  const btcSentiment = Math.min(1, Math.max(0, 0.5 + btcReturn));

  // Weight components based on availability
  const hasDXY = current.dxy !== undefined;

  if (hasDXY) {
    return dxyComponent * 0.4 + liquidity * 0.3 + btcSentiment * 0.3;
  } else {
    return liquidity * 0.5 + btcSentiment * 0.5;
  }
}

/**
 * Get macro sub-components for debugging/display
 */
export function getMacroComponents(
  data: DailyData[],
  index: number
): {
  dxy: number | undefined;
  dxyZScore: number;
  liquidityProxy: number;
  btcSentiment: number;
} {
  const current = data[index];
  const dxyValues = data.slice(0, index + 1).map(d => d.dxy);

  return {
    dxy: current.dxy,
    dxyZScore: current.dxy !== undefined ? calculateDXYZScore(dxyValues, index) : 0,
    liquidityProxy: calculateLiquidityProxy(data, index),
    btcSentiment: current.return90d !== undefined
      ? Math.min(1, Math.max(0, 0.5 + current.return90d))
      : 0.5,
  };
}

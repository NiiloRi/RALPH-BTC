/**
 * Valuation features for BTC risk model
 * Measures price relative to long-term fair value estimates
 */

import { DailyData } from '../types';

/**
 * MVRV-like proxy using price relative to long-term moving averages
 * Since we don't have on-chain realized cap data, we use 200-day and 350-day MAs
 * as proxies for "fair value" (similar concept to Pi Cycle indicators)
 */
export function calculateMVRVProxy(price: number, sma200: number): number {
  if (sma200 <= 0) return 1;
  return price / sma200;
}

/**
 * Price vs 350-day MA * 1.11 (used in Pi Cycle top indicator)
 */
export function calculatePiCycleRatio(price: number, sma350: number): number {
  if (sma350 <= 0) return 1;
  return price / (sma350 * 1.11);
}

/**
 * Power-law regression deviation
 * BTC price roughly follows: ln(price) = a * ln(days) + b
 * We measure deviation from this trend
 */
export function calculatePowerLawDeviation(
  price: number,
  daysSinceGenesis: number
): number {
  // Empirically fitted parameters (from historical data)
  // These are approximate values based on BTC price history
  const a = 5.82; // Slope
  const b = -41.0; // Intercept

  const expectedLnPrice = a * Math.log(daysSinceGenesis) + b;
  const actualLnPrice = Math.log(price);

  return actualLnPrice - expectedLnPrice;
}

/**
 * Calculate days since all-time high
 */
export function calculateDaysSinceATH(
  prices: number[],
  currentIndex: number
): number {
  let athIndex = 0;
  let athPrice = 0;

  for (let i = 0; i <= currentIndex; i++) {
    if (prices[i] > athPrice) {
      athPrice = prices[i];
      athIndex = i;
    }
  }

  return currentIndex - athIndex;
}

/**
 * Calculate drawdown from ATH
 */
export function calculateDrawdownFromATH(
  prices: number[],
  currentIndex: number
): number {
  let athPrice = 0;

  for (let i = 0; i <= currentIndex; i++) {
    athPrice = Math.max(athPrice, prices[i]);
  }

  if (athPrice <= 0) return 0;

  return (athPrice - prices[currentIndex]) / athPrice;
}

/**
 * Mayer Multiple: Price / 200-day MA
 * Historically, values above 2.4 indicate overvaluation
 */
export function calculateMayerMultiple(price: number, sma200: number): number {
  if (sma200 <= 0) return 1;
  return price / sma200;
}

/**
 * Calculate comprehensive valuation score [0, 1]
 * Higher = more overvalued = higher risk
 */
export function calculateValuationScore(
  data: DailyData[],
  index: number,
  daysSinceGenesis: number
): number {
  const current = data[index];
  const prices = data.slice(0, index + 1).map(d => d.price);

  // Components
  const mvrvProxy = calculateMVRVProxy(current.price, current.sma200 || 0);
  const piCycleRatio = calculatePiCycleRatio(current.price, current.sma350 || 0);
  const powerLawDev = calculatePowerLawDeviation(current.price, daysSinceGenesis);
  const mayerMultiple = calculateMayerMultiple(current.price, current.sma200 || 0);
  const drawdown = calculateDrawdownFromATH(prices, index);
  const daysSinceATH = calculateDaysSinceATH(prices, index);

  // Normalize each component to [0, 1]
  // MVRV proxy: typical range 0.5-3.0
  const mvrvScore = Math.min(1, Math.max(0, (mvrvProxy - 0.5) / 2.5));

  // Pi cycle ratio: typically 0.6-1.4
  const piScore = Math.min(1, Math.max(0, (piCycleRatio - 0.6) / 0.8));

  // Power law deviation: typically -1 to +2
  const plScore = Math.min(1, Math.max(0, (powerLawDev + 1) / 3));

  // Mayer multiple: typically 0.5-3.0
  const mayerScore = Math.min(1, Math.max(0, (mayerMultiple - 0.5) / 2.5));

  // Drawdown: 0 = at ATH (high risk), 0.8+ = deep drawdown (low risk)
  // Invert so high drawdown = low risk
  const drawdownScore = Math.min(1, Math.max(0, 1 - drawdown));

  // Days since ATH: 0-30 days = high risk, 365+ days = lower risk
  const athScore = Math.min(1, Math.max(0, 1 - daysSinceATH / 365));

  // Weighted average
  const weights = {
    mvrv: 0.25,
    pi: 0.15,
    pl: 0.2,
    mayer: 0.15,
    drawdown: 0.15,
    ath: 0.1,
  };

  const score =
    weights.mvrv * mvrvScore +
    weights.pi * piScore +
    weights.pl * plScore +
    weights.mayer * mayerScore +
    weights.drawdown * drawdownScore +
    weights.ath * athScore;

  return Math.min(1, Math.max(0, score));
}

/**
 * Get valuation sub-components for debugging/display
 */
export function getValuationComponents(
  data: DailyData[],
  index: number,
  daysSinceGenesis: number
): {
  mvrvProxy: number;
  piCycleRatio: number;
  powerLawDeviation: number;
  mayerMultiple: number;
  drawdownFromATH: number;
  daysSinceATH: number;
} {
  const current = data[index];
  const prices = data.slice(0, index + 1).map(d => d.price);

  return {
    mvrvProxy: calculateMVRVProxy(current.price, current.sma200 || 0),
    piCycleRatio: calculatePiCycleRatio(current.price, current.sma350 || 0),
    powerLawDeviation: calculatePowerLawDeviation(current.price, daysSinceGenesis),
    mayerMultiple: calculateMayerMultiple(current.price, current.sma200 || 0),
    drawdownFromATH: calculateDrawdownFromATH(prices, index),
    daysSinceATH: calculateDaysSinceATH(prices, index),
  };
}

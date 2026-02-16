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
 * Cycle-relative valuation: where is current price relative to previous cycle's range
 * This provides context that absolute metrics miss at cycle bottoms
 *
 * @param price Current price
 * @param prevCycleLow Previous cycle's lowest price
 * @param prevCycleHigh Previous cycle's highest price
 * @returns Score 0-1 where:
 *   0 = at or below previous cycle low (extreme opportunity)
 *   0.5 = midway between prev low and high
 *   1 = at previous cycle high
 *   >1 possible if in new price territory (clamped to 1 for risk)
 */
export function calculateCycleRelativeValuation(
  price: number,
  prevCycleLow: number,
  prevCycleHigh: number
): number {
  if (prevCycleHigh <= prevCycleLow || prevCycleLow <= 0) {
    return 0.5; // Default neutral if invalid data
  }

  const position = (price - prevCycleLow) / (prevCycleHigh - prevCycleLow);

  // Clamp to [0, 1] for risk purposes
  // Being above previous high = max risk from valuation perspective
  return Math.max(0, Math.min(1, position));
}

/**
 * NVT-like proxy: speculative premium detector
 * High short-term / long-term MA ratio = speculative bubble
 */
export function calculateNVTProxy(
  price: number,
  sma100: number,
  sma200: number
): number {
  if (sma100 <= 0 || sma200 <= 0) return 1;
  return (price / sma100) * (price / sma200);
}

/**
 * Calculate comprehensive valuation score [0, 1]
 * Higher = more overvalued = higher risk
 *
 * IMPROVED:
 * - Removed Mayer Multiple (was identical to MVRV proxy = price/sma200)
 * - Added NVT proxy for speculative premium detection
 * - Tighter normalization ranges for sharper top/bottom signals
 * - Drawdown weight INCREASED for stronger bottom detection
 * - Added 365d return percentile for cycle context
 * - Non-linear ATH proximity (sqrt) for faster risk decay
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
  const nvtProxy = calculateNVTProxy(current.price, current.sma100 || 0, current.sma200 || 0);
  const drawdown = calculateDrawdownFromATH(prices, index);
  const daysSinceATH = calculateDaysSinceATH(prices, index);

  // Normalize with TIGHTER ranges for more decisive signals

  // MVRV proxy: 0.7 = undervalued, 2.0+ = overvalued
  const mvrvScore = Math.min(1, Math.max(0, (mvrvProxy - 0.7) / 1.3));

  // Pi cycle ratio: >1.0 is danger zone
  const piScore = Math.min(1, Math.max(0, (piCycleRatio - 0.7) / 0.6));

  // Power law deviation: tightened to -0.5 to +1.5
  const plScore = Math.min(1, Math.max(0, (powerLawDev + 0.5) / 2.0));

  // NVT proxy: 1.0 = fair, 2.5+ = speculative
  const nvtScore = Math.min(1, Math.max(0, (nvtProxy - 0.8) / 1.7));

  // Drawdown: strong bottom detector with non-linear scaling
  // At ATH (dd=0) → 1.0, at -30% → 0.55, at -50% → 0.25, at -80% → 0.0
  const drawdownScore = Math.min(1, Math.max(0, 1 - drawdown * 1.5));

  // Days since ATH: non-linear (sqrt) → faster decay from ATH
  const athDays = Math.min(1, Math.max(0, 1 - Math.sqrt(daysSinceATH / 365)));

  // 365d return percentile: annual cycle context
  let yearReturnScore = 0.5;
  if (index >= 365) {
    const yearReturn = (current.price - prices[index - 365]) / prices[index - 365];
    // -60% → 0.0, 0% → 0.3, +100% → 0.7, +300% → 1.0
    yearReturnScore = Math.min(1, Math.max(0, (yearReturn + 0.6) / 3.6));
  }

  // Rebalanced weights for better top AND bottom detection
  const weights = {
    mvrv: 0.20,       // Core valuation metric
    pi: 0.15,          // Historically accurate top detector
    pl: 0.15,          // Long-term regression anchor
    nvt: 0.10,         // Speculative premium (NEW)
    drawdown: 0.20,    // INCREASED: critical for bottom detection
    ath: 0.10,         // ATH proximity
    yearReturn: 0.10,  // Annual return context (NEW)
  };

  const score =
    weights.mvrv * mvrvScore +
    weights.pi * piScore +
    weights.pl * plScore +
    weights.nvt * nvtScore +
    weights.drawdown * drawdownScore +
    weights.ath * athDays +
    weights.yearReturn * yearReturnScore;

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

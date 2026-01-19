/**
 * Data normalization utilities
 * Handles missing data, gaps, and creates a consistent daily dataset
 */

import { PriceData, DailyData } from '../types';

/**
 * Calculate daily returns
 */
export function calculateReturn(current: number, previous: number): number {
  if (previous <= 0) return 0;
  return (current - previous) / previous;
}

/**
 * Calculate realized volatility using standard deviation of log returns
 */
export function calculateRealizedVol(prices: number[], window: number): number {
  if (prices.length < window + 1) return 0;

  const logReturns: number[] = [];
  for (let i = prices.length - window; i < prices.length; i++) {
    if (prices[i] > 0 && prices[i - 1] > 0) {
      logReturns.push(Math.log(prices[i] / prices[i - 1]));
    }
  }

  if (logReturns.length < 2) return 0;

  const mean = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
  const variance =
    logReturns.reduce((sum, r) => sum + (r - mean) ** 2, 0) /
    (logReturns.length - 1);

  // Annualized volatility
  return Math.sqrt(variance * 365);
}

/**
 * Calculate simple moving average
 */
export function calculateSMA(prices: number[], window: number): number {
  if (prices.length < window) return prices[prices.length - 1] || 0;

  const slice = prices.slice(-window);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

/**
 * Forward-fill missing dates in price data
 */
export function fillMissingDates(data: PriceData[]): PriceData[] {
  if (data.length === 0) return [];

  const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date));
  const result: PriceData[] = [];

  let lastRecord = sorted[0];
  const startDate = new Date(sorted[0].date);
  const endDate = new Date(sorted[sorted.length - 1].date);

  const current = new Date(startDate);
  let dataIdx = 0;

  while (current <= endDate) {
    const dateStr = current.toISOString().split('T')[0];

    // Find matching record
    while (dataIdx < sorted.length && sorted[dataIdx].date < dateStr) {
      lastRecord = sorted[dataIdx];
      dataIdx++;
    }

    if (dataIdx < sorted.length && sorted[dataIdx].date === dateStr) {
      result.push(sorted[dataIdx]);
      lastRecord = sorted[dataIdx];
    } else {
      // Forward fill with last known price
      result.push({
        ...lastRecord,
        date: dateStr,
      });
    }

    current.setDate(current.getDate() + 1);
  }

  return result;
}

/**
 * Remove outliers using IQR method
 * Returns data with extreme values capped
 */
export function handleOutliers(
  values: number[],
  multiplier: number = 3
): number[] {
  if (values.length < 4) return values;

  const sorted = [...values].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const iqr = q3 - q1;

  const lower = q1 - multiplier * iqr;
  const upper = q3 + multiplier * iqr;

  return values.map(v => Math.max(lower, Math.min(upper, v)));
}

/**
 * Normalize price data to daily format with computed fields
 */
export function normalizeToDailyData(
  priceData: PriceData[],
  dxyData?: Map<string, number>
): DailyData[] {
  // Fill missing dates
  const filled = fillMissingDates(priceData);

  if (filled.length === 0) return [];

  // Build price array for calculations
  const prices: number[] = filled.map(d => d.close);

  const result: DailyData[] = [];

  for (let i = 0; i < filled.length; i++) {
    const record = filled[i];
    const price = record.close;

    // Calculate returns (handle early days gracefully)
    const return1d = i >= 1 ? calculateReturn(price, prices[i - 1]) : 0;
    const return7d = i >= 7 ? calculateReturn(price, prices[i - 7]) : 0;
    const return30d = i >= 30 ? calculateReturn(price, prices[i - 30]) : 0;
    const return90d = i >= 90 ? calculateReturn(price, prices[i - 90]) : 0;
    const return365d = i >= 365 ? calculateReturn(price, prices[i - 365]) : 0;

    // Calculate moving averages
    const pricesUpToNow = prices.slice(0, i + 1);
    const sma50 = calculateSMA(pricesUpToNow, 50);
    const sma100 = calculateSMA(pricesUpToNow, 100);
    const sma200 = calculateSMA(pricesUpToNow, 200);
    const sma350 = calculateSMA(pricesUpToNow, 350);

    // Calculate realized volatility
    const realizedVol30d = calculateRealizedVol(pricesUpToNow, 30);
    const realizedVol90d = calculateRealizedVol(pricesUpToNow, 90);

    // Add macro data if available
    const dxy = dxyData?.get(record.date);

    result.push({
      date: record.date,
      price,
      return1d,
      return7d,
      return30d,
      return90d,
      return365d,
      sma50,
      sma100,
      sma200,
      sma350,
      realizedVol30d,
      realizedVol90d,
      dxy,
    });
  }

  return result;
}

/**
 * Validate daily data - check for NaN, missing values
 */
export function validateDailyData(data: DailyData[]): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  for (let i = 0; i < data.length; i++) {
    const record = data[i];

    if (!record.date || !/^\d{4}-\d{2}-\d{2}$/.test(record.date)) {
      errors.push(`Invalid date at index ${i}: ${record.date}`);
    }

    if (!Number.isFinite(record.price) || record.price <= 0) {
      errors.push(`Invalid price at ${record.date}: ${record.price}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Calculate z-score relative to historical data
 * Only uses data up to current index (no future leakage)
 */
export function calculateZScore(
  values: number[],
  index: number,
  window: number
): number {
  const startIdx = Math.max(0, index - window);
  const slice = values.slice(startIdx, index + 1);

  if (slice.length < 2) return 0;

  const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
  const variance =
    slice.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (slice.length - 1);
  const std = Math.sqrt(variance);

  if (std === 0) return 0;

  return (values[index] - mean) / std;
}

/**
 * Export daily data to CSV
 */
export function exportToCSV(data: DailyData[], filepath: string): void {
  // Dynamic imports for Node.js fs module
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('path');

  const dir = path.dirname(filepath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const headers = Object.keys(data[0]).join(',');
  const rows = data.map(d =>
    Object.values(d)
      .map(v => (v === undefined ? '' : v))
      .join(',')
  );

  fs.writeFileSync(filepath, [headers, ...rows].join('\n'));
}

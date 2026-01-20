/**
 * Data normalization utilities
 * Handles missing data, gaps, and creates a consistent daily dataset
 */

import { PriceData, DailyData, MacroDataBundle } from '../types';

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
 * Interpolate monthly data to daily using linear interpolation
 * This is useful for M2 and Fed Funds which are released monthly
 */
export function interpolateMonthlyToDaily(
  monthlyData: Map<string, number>,
  startDate: string,
  endDate: string
): Map<string, number> {
  const result = new Map<string, number>();

  if (monthlyData.size === 0) return result;

  // Sort the monthly dates
  const sortedDates = Array.from(monthlyData.keys()).sort();

  const start = new Date(startDate);
  const end = new Date(endDate);
  const current = new Date(start);

  while (current <= end) {
    const dateStr = current.toISOString().split('T')[0];

    // Find the surrounding monthly data points
    let prevDate: string | null = null;
    let nextDate: string | null = null;

    for (const mDate of sortedDates) {
      if (mDate <= dateStr) {
        prevDate = mDate;
      }
      if (mDate >= dateStr && !nextDate) {
        nextDate = mDate;
      }
    }

    if (prevDate && nextDate && prevDate !== nextDate) {
      // Linear interpolation
      const prevValue = monthlyData.get(prevDate)!;
      const nextValue = monthlyData.get(nextDate)!;
      const prevTime = new Date(prevDate).getTime();
      const nextTime = new Date(nextDate).getTime();
      const currentTime = current.getTime();

      const ratio = (currentTime - prevTime) / (nextTime - prevTime);
      const interpolatedValue = prevValue + ratio * (nextValue - prevValue);
      result.set(dateStr, interpolatedValue);
    } else if (prevDate) {
      // Use last known value (forward fill)
      result.set(dateStr, monthlyData.get(prevDate)!);
    } else if (nextDate) {
      // Use next available value (backward fill for very early dates)
      result.set(dateStr, monthlyData.get(nextDate)!);
    }

    current.setDate(current.getDate() + 1);
  }

  return result;
}

/**
 * Calculate M2 year-over-year change
 * Returns a decimal (e.g., 0.05 for 5% growth)
 */
export function calculateM2YoY(
  m2Daily: Map<string, number>,
  date: string
): number | undefined {
  const currentM2 = m2Daily.get(date);
  if (currentM2 === undefined) return undefined;

  // Get date from one year ago
  const currentDate = new Date(date);
  currentDate.setFullYear(currentDate.getFullYear() - 1);
  const yearAgoDate = currentDate.toISOString().split('T')[0];

  // Find closest date to year ago (within a week)
  let yearAgoM2: number | undefined;
  for (let i = 0; i <= 7; i++) {
    const checkDate = new Date(yearAgoDate);
    checkDate.setDate(checkDate.getDate() + i);
    const checkDateStr = checkDate.toISOString().split('T')[0];
    yearAgoM2 = m2Daily.get(checkDateStr);
    if (yearAgoM2 !== undefined) break;

    // Also check backwards
    checkDate.setDate(checkDate.getDate() - 2 * i);
    const checkDateStr2 = checkDate.toISOString().split('T')[0];
    yearAgoM2 = m2Daily.get(checkDateStr2);
    if (yearAgoM2 !== undefined) break;
  }

  if (yearAgoM2 === undefined || yearAgoM2 === 0) return undefined;

  return (currentM2 - yearAgoM2) / yearAgoM2;
}

/**
 * Get closest value from a map, looking back up to maxDays
 */
export function getClosestValue(
  data: Map<string, number>,
  date: string,
  maxDays: number = 7
): number | undefined {
  // Try exact match first
  const exact = data.get(date);
  if (exact !== undefined) return exact;

  // Look backwards
  const current = new Date(date);
  for (let i = 1; i <= maxDays; i++) {
    current.setDate(current.getDate() - 1);
    const checkDate = current.toISOString().split('T')[0];
    const value = data.get(checkDate);
    if (value !== undefined) return value;
  }

  return undefined;
}

/**
 * Normalize price data to daily format with computed fields
 */
export function normalizeToDailyData(
  priceData: PriceData[],
  macroData?: MacroDataBundle | Map<string, number>
): DailyData[] {
  // Fill missing dates
  const filled = fillMissingDates(priceData);

  if (filled.length === 0) return [];

  // Build price array for calculations
  const prices: number[] = filled.map(d => d.close);

  // Determine date range
  const startDate = filled[0].date;
  const endDate = filled[filled.length - 1].date;

  // Handle macro data - either MacroDataBundle or legacy Map<string, number> for DXY
  let dxyData: Map<string, number> | undefined;
  let m2Daily: Map<string, number> | undefined;
  let fedFundsDaily: Map<string, number> | undefined;
  let treasury10yData: Map<string, number> | undefined;
  let treasury2yData: Map<string, number> | undefined;
  let yieldSpreadData: Map<string, number> | undefined;
  let realRateData: Map<string, number> | undefined;

  if (macroData) {
    if (macroData instanceof Map) {
      // Legacy: just DXY data as a Map
      dxyData = macroData;
    } else {
      // Full MacroDataBundle
      dxyData = macroData.dxy;
      treasury10yData = macroData.treasury10y;
      treasury2yData = macroData.treasury2y;
      yieldSpreadData = macroData.yieldSpread;
      realRateData = macroData.realRate;

      // Interpolate monthly data (M2, Fed Funds) to daily
      if (macroData.m2.size > 0) {
        m2Daily = interpolateMonthlyToDaily(macroData.m2, startDate, endDate);
      }
      if (macroData.fedFunds.size > 0) {
        fedFundsDaily = interpolateMonthlyToDaily(macroData.fedFunds, startDate, endDate);
      }
    }
  }

  const result: DailyData[] = [];

  for (let i = 0; i < filled.length; i++) {
    const record = filled[i];
    const price = record.close;
    const date = record.date;

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

    // Get macro data for this date
    const dxy = getClosestValue(dxyData || new Map(), date);
    const treasury10y = getClosestValue(treasury10yData || new Map(), date);
    const treasury2y = getClosestValue(treasury2yData || new Map(), date);
    const yieldSpread = getClosestValue(yieldSpreadData || new Map(), date);
    const realRate = getClosestValue(realRateData || new Map(), date);
    const m2 = m2Daily?.get(date);
    const fedFunds = fedFundsDaily?.get(date);

    // Calculate M2 YoY if we have M2 data
    const m2YoY = m2Daily ? calculateM2YoY(m2Daily, date) : undefined;

    result.push({
      date,
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
      treasury10y,
      treasury2y,
      yieldSpread,
      realRate,
      m2,
      m2YoY,
      fedFunds,
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

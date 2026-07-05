/**
 * API Route: Fetch fresh BTC risk data from Binance
 * GET /api/risk-data
 *
 * Fetches ALL historical data from Binance (2017+) and calculates risk
 * Now with cycle-relative valuation for accurate bottom detection
 * Enhanced with macro indicators (M2, Fed Funds, Treasury yields)
 */

import { NextResponse } from 'next/server';
import { fetchAllMacroData, loadMacroCache, saveMacroCache } from '@/lib/data/price-fetcher';
import { calculateCycleScore, HISTORICAL_CYCLES } from '@/lib/features/cycle';
import type { MacroDataBundle } from '@/lib/types';

// Binance kline format
type BinanceKline = [number, string, string, string, string, string, number, string, number, string, string, string];

interface PriceData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface RiskDataPoint {
  date: string;
  price: number;
  risk: number;
  smoothedRisk: number;
  components: {
    valuation: number;
    momentum: number;
    volatility: number;
    cycle: number;
    macro: number;
    attention: number;
  };
  macroComponents?: {
    m2Signal: number;
    fedFundsSignal: number;
    yieldCurveSignal: number;
    realRateSignal: number;
  };
  cyclePhase: 'early' | 'mid' | 'late';
  isHalving: boolean;
}

// Halving dates for cycle calculation
const HALVING_DATES = [
  new Date('2012-11-28'),
  new Date('2016-07-09'),
  new Date('2020-05-11'),
  new Date('2024-04-20'),
];

// NOTE on cycle anchors: HISTORICAL_CYCLES (imported from @/lib/features/cycle)
// contains cycle lows that were only CONFIRMABLE months after they occurred.
// Today's reading is fine (all anchors are long past), but HISTORICAL chart
// values in the first ~6 months after each cycle low are more favorable than
// a real-time model could have produced. Known limitation, documented in UI.

// Component weights - optimized for peak/bottom detection (v2 improved)
const DEFAULT_WEIGHTS = {
  valuation: 0.28,   // MVRV + NVT proxy + drawdown + power law
  momentum: 0.18,    // RSI + ROC + acceleration
  volatility: 0.06,  // Background context
  cycle: 0.22,       // Halving cycle timing - critical for BTC
  macro: 0.14,       // M2, Fed Funds, yield curve
  attention: 0.12,   // Retail FOMO/fear detection
};

// Calibration params - slope=7 for smooth gradations, center=0.48 to reduce false positives
const DEFAULT_CALIBRATION = {
  slope: 7,
  center: 0.48,
};

// Historical data stored as static JSON (2010-2017, before Binance)
import historicalData from '../../../../public/btc_historical.json';

interface HistoricalDataPoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Load pre-Binance historical data (2010-2017)
 */
function loadHistoricalData(): PriceData[] {
  return (historicalData as HistoricalDataPoint[]).map(d => ({
    date: d.date,
    open: d.open,
    high: d.high,
    low: d.low,
    close: d.close,
    volume: d.volume,
  }));
}

/**
 * Fetch ALL BTC data from Binance (from 2017-08-17 onwards)
 * Paginates through the API to get complete history
 */
async function fetchAllBinanceData(): Promise<PriceData[]> {
  const allData: PriceData[] = [];
  const symbol = 'BTCUSDT';
  const interval = '1d';
  const limit = 1000;

  // Start from BTCUSDT listing date
  let startTime = new Date('2017-08-17').getTime();
  const endTime = Date.now();

  while (startTime < endTime) {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${startTime}&limit=${limit}`;

    const fetchController = new AbortController();
    const fetchTimeout = setTimeout(() => fetchController.abort(), 10000);

    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: fetchController.signal,
    });
    clearTimeout(fetchTimeout);

    if (!response.ok) {
      throw new Error(`Binance API error: ${response.status}`);
    }

    const klines: BinanceKline[] = await response.json();

    if (klines.length === 0) break;

    for (const kline of klines) {
      const [openTime, open, high, low, close, volume] = kline;
      allData.push({
        date: new Date(openTime).toISOString().split('T')[0],
        open: parseFloat(open),
        high: parseFloat(high),
        low: parseFloat(low),
        close: parseFloat(close),
        volume: parseFloat(volume),
      });
    }

    // Move to next batch
    const lastKline = klines[klines.length - 1];
    startTime = lastKline[6] + 1; // closeTime + 1ms

    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  // Remove duplicates
  const seen = new Set<string>();
  return allData.filter(d => {
    if (seen.has(d.date)) return false;
    seen.add(d.date);
    return true;
  });
}

/**
 * Calculate SMA
 */
function calculateSMA(prices: number[], period: number): number {
  if (prices.length < period) return prices[prices.length - 1] || 0;
  const slice = prices.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

/**
 * Calculate RSI
 */
function calculateRSI(prices: number[], period: number = 14): number {
  if (prices.length < period + 1) return 50;

  let gains = 0;
  let losses = 0;

  for (let i = prices.length - period; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

/**
 * Calculate realized volatility
 */
function calculateVolatility(prices: number[], period: number = 30): number {
  if (prices.length < period + 1) return 0.5;

  const returns: number[] = [];
  for (let i = prices.length - period; i < prices.length; i++) {
    if (prices[i - 1] > 0) {
      returns.push(Math.log(prices[i] / prices[i - 1]));
    }
  }

  if (returns.length === 0) return 0.5;

  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length;
  return Math.sqrt(variance) * Math.sqrt(365); // Annualized
}

/**
 * Get cycle phase and score for a date.
 *
 * UNIFIED MODEL FIX: the cycle score previously used an older inline formula
 * that diverged from the tested library implementation (different peak
 * window, no bottom-zone discount, no euphoria detection). The dashboard was
 * therefore displaying a different model than the one covered by tests and
 * the walk-forward backtest code. The score now comes from
 * calculateCycleScore() in @/lib/features/cycle (v2, 27 unit tests).
 */
function getCycleInfo(date: Date): {
  daysSinceHalving: number;
  daysSinceLow: number;
  phase: 'early' | 'mid' | 'late';
  cycleScore: number;
} {
  // Find the current cycle based on which cycle LOW we're after
  let cycleIdx = 0;
  for (let i = HISTORICAL_CYCLES.length - 1; i >= 0; i--) {
    const cycleLow = new Date(HISTORICAL_CYCLES[i].lowDate);
    if (date >= cycleLow) {
      cycleIdx = i;
      break;
    }
  }

  const currentCycle = HISTORICAL_CYCLES[cycleIdx];
  const cycleLowDate = new Date(currentCycle.lowDate);
  const daysSinceLow = Math.max(0, Math.floor(
    (date.getTime() - cycleLowDate.getTime()) / (1000 * 60 * 60 * 24)
  ));

  const cycleHalvingDate = new Date(currentCycle.halvingDate);
  const daysSinceHalving = Math.floor(
    (date.getTime() - cycleHalvingDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  // Phase from progress since cycle low (typical low→peak ≈ 1100 days)
  const progressFromLow = Math.min(1.5, daysSinceLow / 1100);
  let phase: 'early' | 'mid' | 'late' = 'early';
  if (progressFromLow > 0.75) phase = 'late';
  else if (progressFromLow > 0.40) phase = 'mid';

  return {
    daysSinceHalving,
    daysSinceLow,
    phase,
    cycleScore: calculateCycleScore(date),
  };
}

/**
 * Check if date is a halving date
 */
function isHalvingDate(date: Date): boolean {
  const dateStr = date.toISOString().split('T')[0];
  return HALVING_DATES.some(h => h.toISOString().split('T')[0] === dateStr);
}

/**
 * Sigmoid function for smooth risk mapping
 */
function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Apply calibration (sigmoid, slope=7, center=0.48 — see DEFAULT_CALIBRATION)
 */
function applyCalibration(rawScore: number): number {
  const shifted = rawScore - DEFAULT_CALIBRATION.center;
  return sigmoid(DEFAULT_CALIBRATION.slope * shifted);
}

/**
 * Calculate rate of change over a period
 */
function calculateROC(prices: number[], period: number): number {
  if (prices.length < period + 1) return 0;
  const current = prices[prices.length - 1];
  const past = prices[prices.length - 1 - period];
  if (past <= 0) return 0;
  return (current - past) / past;
}

/**
 * Find ATH and calculate distance from it
 */
function calculateATHInfo(prices: number[]): { ath: number; drawdown: number; athProximity: number } {
  const ath = Math.max(...prices);
  const current = prices[prices.length - 1];
  const drawdown = ath > 0 ? (ath - current) / ath : 0;
  const athProximity = ath > 0 ? current / ath : 1;
  return { ath, drawdown, athProximity };
}

/**
 * Calculate attention proxy based on price action
 * Strong moves and ATH proximity = high retail attention
 */
function calculateAttentionProxy(
  prices: number[],
  index: number,
  vol30d: number,
  avgVol: number
): number {
  if (index < 30) return 0.5;

  const current = prices[index];

  // Calculate returns
  const price7dAgo = index >= 7 ? prices[index - 7] : prices[0];
  const price30dAgo = index >= 30 ? prices[index - 30] : prices[0];
  const return7d = price7dAgo > 0 ? (current - price7dAgo) / price7dAgo : 0;
  const return30d = price30dAgo > 0 ? (current - price30dAgo) / price30dAgo : 0;

  // Strong recent returns = likely high attention
  const returnScore = Math.min(1, (Math.abs(return7d) + Math.abs(return30d)) * 3);

  // ATH proximity = high attention
  const priceHistory = prices.slice(0, index + 1);
  const ath = Math.max(...priceHistory);
  const athProximity = ath > 0 ? current / ath : 1;
  const athScore = athProximity; // 1 at ATH, lower otherwise

  // Volatility spike = attention spike
  const volRatio = avgVol > 0 ? vol30d / avgVol : 1;
  const volScore = Math.min(1, volRatio / 2);

  return returnScore * 0.3 + athScore * 0.5 + volScore * 0.2;
}

/**
 * Calculate Fear & Greed proxy
 */
function calculateFearGreedProxy(
  prices: number[],
  index: number,
  sma200: number,
  vol30d: number,
  avgVol: number
): number {
  if (index < 90) return 0.5;

  const current = prices[index];
  const price30dAgo = index >= 30 ? prices[index - 30] : prices[0];
  const return30d = price30dAgo > 0 ? (current - price30dAgo) / price30dAgo : 0;

  // Momentum score (0-100)
  const momentum = Math.min(1, Math.max(-1, return30d * 2));
  const momentumScore = (momentum + 1) / 2 * 100;

  // Volatility score (high vol = fear = lower score)
  const volRatio = avgVol > 0 ? vol30d / avgVol : 1;
  const volScore = Math.min(100, Math.max(0, 100 - volRatio * 50));

  // Price vs MA (above MA = greed, below = fear)
  const maDeviation = sma200 > 0 ? (current - sma200) / sma200 : 0;
  const maScore = Math.min(100, Math.max(0, 50 + maDeviation * 100));

  // Drawdown (deep drawdown = fear)
  const priceHistory = prices.slice(0, index + 1);
  const ath = Math.max(...priceHistory);
  const drawdown = ath > 0 ? (ath - current) / ath : 0;
  const ddScore = Math.min(100, Math.max(0, 100 - drawdown * 200));

  // Combine (equal weights)
  return ((momentumScore + volScore + maScore + ddScore) / 4) / 100;
}

/**
 * Calculate full attention score combining proxy and fear/greed
 */
function calculateAttentionScore(
  prices: number[],
  index: number,
  sma200: number,
  vol30d: number,
  avgVol: number
): number {
  const attentionProxy = calculateAttentionProxy(prices, index, vol30d, avgVol);
  const fearGreedProxy = calculateFearGreedProxy(prices, index, sma200, vol30d, avgVol);

  // Weight attention proxy more (it's more direct)
  return attentionProxy * 0.6 + fearGreedProxy * 0.4;
}

// ============================================================
// MACRO SIGNAL CALCULATIONS
// ============================================================

/**
 * Calculate M2 year-over-year change
 */
function calculateM2YoY(
  m2Daily: Map<string, number>,
  date: string
): number | undefined {
  const currentM2 = m2Daily.get(date);
  if (currentM2 === undefined) return undefined;

  // Get date from one year ago
  const currentDate = new Date(date);
  currentDate.setFullYear(currentDate.getFullYear() - 1);
  const yearAgoDate = currentDate.toISOString().split('T')[0];

  // Find closest date within a week
  for (let i = 0; i <= 7; i++) {
    const checkDate = new Date(yearAgoDate);
    checkDate.setDate(checkDate.getDate() + i);
    const checkDateStr = checkDate.toISOString().split('T')[0];
    const yearAgoM2 = m2Daily.get(checkDateStr);
    if (yearAgoM2 !== undefined && yearAgoM2 > 0) {
      return (currentM2 - yearAgoM2) / yearAgoM2;
    }
  }
  return undefined;
}

/**
 * Expand monthly data to daily — WALK-FORWARD SAFE.
 *
 * LOOKAHEAD FIX: the old version linearly interpolated toward the NEXT
 * month's value (not yet published on that day) and back-filled early dates
 * from the future. Each day now gets the latest observation that was at
 * least `publicationLagDays` old (M2 releases ~4 weeks after month end,
 * Fed Funds ~1 week). Days before the first usable observation stay
 * missing, which downstream code already treats as neutral.
 */
function interpolateMonthlyToDaily(
  monthlyData: Map<string, number>,
  dates: string[],
  publicationLagDays: number = 0
): Map<string, number> {
  const result = new Map<string, number>();
  if (monthlyData.size === 0) return result;

  const sortedMonthlyDates = Array.from(monthlyData.keys()).sort();
  const lagMs = publicationLagDays * 24 * 60 * 60 * 1000;

  for (const dateStr of dates) {
    const knowableCutoff = new Date(new Date(dateStr).getTime() - lagMs)
      .toISOString()
      .split('T')[0];

    let prevDate: string | null = null;
    for (const mDate of sortedMonthlyDates) {
      if (mDate <= knowableCutoff) prevDate = mDate;
      else break;
    }

    if (prevDate) {
      result.set(dateStr, monthlyData.get(prevDate)!);
    }
  }
  return result;
}

/**
 * Calculate M2 signal (0 = bearish, 1 = bullish)
 */
function calculateM2Signal(m2YoY: number | undefined): number {
  if (m2YoY === undefined) return 0.5;
  // M2 YoY range: -3% to +15%
  const normalized = (m2YoY + 0.03) / 0.18;
  return Math.max(0, Math.min(1, normalized));
}

/**
 * Calculate Fed Funds signal (0 = bearish/high rates, 1 = bullish/low rates)
 */
function calculateFedFundsSignal(fedFunds: number | undefined): number {
  if (fedFunds === undefined) return 0.5;
  const normalized = 1 - (fedFunds / 6);
  return Math.max(0, Math.min(1, normalized));
}

/**
 * Calculate yield curve signal (0 = inverted/bearish, 1 = normal/bullish)
 */
function calculateYieldCurveSignal(spread: number | undefined): number {
  if (spread === undefined) return 0.5;
  const normalized = (spread + 1) / 3;
  return Math.max(0, Math.min(1, normalized));
}

/**
 * Calculate real rate signal (0 = positive rates/bearish, 1 = negative rates/bullish)
 */
function calculateRealRateSignal(realRate: number | undefined): number {
  if (realRate === undefined) return 0.5;
  const normalized = (-realRate + 2) / 4;
  return Math.max(0, Math.min(1, normalized));
}

/**
 * Calculate composite macro score from all signals
 */
function calculateMacroScoreFromSignals(
  m2YoY: number | undefined,
  fedFunds: number | undefined,
  yieldSpread: number | undefined,
  realRate: number | undefined
): number {
  const weights = { m2: 0.35, fedFunds: 0.25, yieldCurve: 0.20, realRate: 0.20 };
  let score = 0;
  let totalWeight = 0;

  if (m2YoY !== undefined) {
    score += calculateM2Signal(m2YoY) * weights.m2;
    totalWeight += weights.m2;
  }
  if (fedFunds !== undefined) {
    score += calculateFedFundsSignal(fedFunds) * weights.fedFunds;
    totalWeight += weights.fedFunds;
  }
  if (yieldSpread !== undefined) {
    score += calculateYieldCurveSignal(yieldSpread) * weights.yieldCurve;
    totalWeight += weights.yieldCurve;
  }
  if (realRate !== undefined) {
    score += calculateRealRateSignal(realRate) * weights.realRate;
    totalWeight += weights.realRate;
  }

  return totalWeight > 0 ? score / totalWeight : 0.5;
}

/**
 * Get closest value from a map, looking back up to maxDays
 */
function getClosestValue(
  data: Map<string, number>,
  date: string,
  maxDays: number = 7
): number | undefined {
  const exact = data.get(date);
  if (exact !== undefined) return exact;

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
 * Prepared macro data for a single date
 */
interface MacroDataForDate {
  m2YoY: number | undefined;
  fedFunds: number | undefined;
  yieldSpread: number | undefined;
  realRate: number | undefined;
}

/**
 * Calculate risk score for a single data point
 * Optimized for detecting cycle peaks and bottoms
 * Now includes macro indicators for improved cycle detection
 */
function calculateRisk(
  prices: number[],
  index: number,
  date: Date,
  avgVol: number,
  macroData?: MacroDataForDate
): { risk: number; components: RiskDataPoint['components']; macroComponents?: RiskDataPoint['macroComponents']; cyclePhase: 'early' | 'mid' | 'late' } {
  const price = prices[index];
  const priceHistory = prices.slice(0, index + 1);

  // Get cycle info
  const cycleInfo = getCycleInfo(date);

  // Valuation: Price relative to 200 SMA (Mayer Multiple)
  const sma200 = calculateSMA(priceHistory, Math.min(200, priceHistory.length));
  const mayerMultiple = sma200 > 0 ? price / sma200 : 1;
  const mayerScore = Math.min(Math.max((mayerMultiple - 0.5) / 2.5, 0), 1);

  // Drawdown from ATH: low drawdown = near peak = HIGH risk
  const { drawdown } = calculateATHInfo(priceHistory);
  const drawdownScore = 1 - drawdown; // 0% drawdown = 1.0, 80% drawdown = 0.2

  // Blend Mayer and Drawdown for valuation
  const valuationScore = 0.5 * mayerScore + 0.5 * drawdownScore;

  // Momentum: RSI + Rate of Change
  const rsi = calculateRSI(priceHistory, 14);
  const rsiScore = rsi / 100;

  // Rate of change over 90 days (captures sustained bull/bear moves)
  const roc90 = calculateROC(priceHistory, 90);
  // Normalize: -50% = 0, 0% = 0.5, +100% = 1
  const rocScore = Math.min(Math.max((roc90 + 0.5) / 1.5, 0), 1);

  // Blend RSI and ROC for momentum
  const momentumScore = 0.6 * rsiScore + 0.4 * rocScore;

  // Volatility
  const vol30d = calculateVolatility(priceHistory, 30);
  const volatilityScore = Math.min(vol30d / 1.5, 1);

  // Cycle score - uses improved calculation from getCycleInfo
  // (Based on time from LOW, not just halving, with front-running detection)
  const cycleScore = cycleInfo.cycleScore;

  // Macro score - now using real data when available
  // Calculate individual signals
  const m2Signal = calculateM2Signal(macroData?.m2YoY);
  const fedFundsSignal = calculateFedFundsSignal(macroData?.fedFunds);
  const yieldCurveSignal = calculateYieldCurveSignal(macroData?.yieldSpread);
  const realRateSignal = calculateRealRateSignal(macroData?.realRate);

  const macroScore = macroData
    ? calculateMacroScoreFromSignals(
        macroData.m2YoY,
        macroData.fedFunds,
        macroData.yieldSpread,
        macroData.realRate
      )
    : 0.5;

  // Store individual macro components
  const macroComponents = macroData ? {
    m2Signal,
    fedFundsSignal,
    yieldCurveSignal,
    realRateSignal,
  } : undefined;

  // Attention: full calculation with ATH proximity, returns, fear/greed
  const attentionScore = calculateAttentionScore(prices, index, sma200, vol30d, avgVol);

  const components = {
    valuation: valuationScore,
    momentum: momentumScore,
    volatility: volatilityScore,
    cycle: cycleScore,
    macro: macroScore,
    attention: attentionScore,
  };

  // Weighted ensemble
  const rawScore =
    components.valuation * DEFAULT_WEIGHTS.valuation +
    components.momentum * DEFAULT_WEIGHTS.momentum +
    components.volatility * DEFAULT_WEIGHTS.volatility +
    components.cycle * DEFAULT_WEIGHTS.cycle +
    components.macro * DEFAULT_WEIGHTS.macro +
    components.attention * DEFAULT_WEIGHTS.attention;

  // Apply calibration
  const calibrated = applyCalibration(rawScore);
  const risk = Math.max(0, Math.min(1, calibrated));

  return { risk, components, macroComponents, cyclePhase: cycleInfo.phase };
}

/**
 * Apply EMA smoothing
 */
function smoothRisks(risks: number[], alpha: number = 0.3): number[] {
  if (risks.length === 0) return [];
  const smoothed: number[] = [risks[0]];
  for (let i = 1; i < risks.length; i++) {
    smoothed.push(alpha * risks[i] + (1 - alpha) * smoothed[i - 1]);
  }
  return smoothed;
}

export async function GET() {
  try {
    // Load historical data (2010-2017, static)
    const historicalPriceData = loadHistoricalData();
    console.log(`Loaded ${historicalPriceData.length} days of historical data (2010-2017)`);

    // Fetch live data from Binance (2017+)
    const binancePriceData = await fetchAllBinanceData();
    console.log(`Loaded ${binancePriceData.length} days from Binance (2017+)`);

    // Combine: historical + Binance (avoid duplicates)
    const binanceStartDate = binancePriceData[0]?.date || '2017-08-17';
    const uniqueHistorical = historicalPriceData.filter(d => d.date < binanceStartDate);
    const priceData = [...uniqueHistorical, ...binancePriceData];

    console.log(`Combined total: ${priceData.length} days (${priceData[0]?.date} to ${priceData[priceData.length-1]?.date})`);

    if (priceData.length === 0) {
      return NextResponse.json({ error: 'No data available' }, { status: 500 });
    }

    const prices = priceData.map(d => d.close);
    const allDates = priceData.map(d => d.date);
    const startDate = allDates[0];
    const endDate = allDates[allDates.length - 1];

    // Fetch macro data from FRED (in parallel conceptually, uses cache)
    let macroBundle: MacroDataBundle | null = null;
    let m2Daily: Map<string, number> = new Map();
    let fedFundsDaily: Map<string, number> = new Map();

    try {
      // Try cache first, then fetch if needed
      macroBundle = loadMacroCache(168); // 7 day cache
      if (!macroBundle) {
        macroBundle = await fetchAllMacroData(startDate, endDate);
        if (macroBundle) {
          saveMacroCache(macroBundle);
        }
      }

      if (macroBundle) {
        // Expand monthly data to daily with publication lags (no lookahead)
        m2Daily = interpolateMonthlyToDaily(macroBundle.m2, allDates, 28);
        fedFundsDaily = interpolateMonthlyToDaily(macroBundle.fedFunds, allDates, 7);
      }
    } catch (macroError) {
      console.warn('Failed to fetch macro data, continuing without:', macroError);
    }

    // Calculate risk for each data point (skip first 200 for enough history)
    const startIdx = Math.min(200, Math.floor(priceData.length * 0.1));
    const riskData: RiskDataPoint[] = [];
    const rawRisks: number[] = [];

    // Pre-calculate average volatility for attention score
    // Use rolling 365-day average volatility
    const volatilities: number[] = [];
    for (let i = 30; i < prices.length; i++) {
      volatilities.push(calculateVolatility(prices.slice(0, i + 1), 30));
    }
    const overallAvgVol = volatilities.length > 0
      ? volatilities.reduce((a, b) => a + b, 0) / volatilities.length
      : 0.5;

    for (let i = startIdx; i < priceData.length; i++) {
      const date = new Date(priceData[i].date);
      const dateStr = priceData[i].date;

      // Calculate rolling average vol (last 365 days or available)
      const volStartIdx = Math.max(0, i - 365 - 30);
      const volEndIdx = i - 30;
      let avgVol = overallAvgVol;
      if (volEndIdx > volStartIdx && volEndIdx < volatilities.length) {
        const recentVols = volatilities.slice(volStartIdx, volEndIdx);
        avgVol = recentVols.length > 0
          ? recentVols.reduce((a, b) => a + b, 0) / recentVols.length
          : overallAvgVol;
      }

      // Get macro data for this date
      const macroDataForDate: MacroDataForDate | undefined = macroBundle
        ? {
            m2YoY: calculateM2YoY(m2Daily, dateStr),
            fedFunds: fedFundsDaily.get(dateStr),
            yieldSpread: getClosestValue(macroBundle.yieldSpread, dateStr),
            realRate: getClosestValue(macroBundle.realRate, dateStr),
          }
        : undefined;

      const { risk, components, macroComponents, cyclePhase } = calculateRisk(prices, i, date, avgVol, macroDataForDate);

      rawRisks.push(risk);
      riskData.push({
        date: priceData[i].date,
        price: priceData[i].close,
        risk,
        smoothedRisk: risk,
        components,
        macroComponents,
        cyclePhase,
        isHalving: isHalvingDate(date),
      });
    }

    // Apply smoothing
    const smoothedRisks = smoothRisks(rawRisks);
    for (let i = 0; i < riskData.length; i++) {
      riskData[i].smoothedRisk = smoothedRisks[i];
    }

    return NextResponse.json({
      data: riskData,
      lastUpdated: new Date().toISOString(),
      source: 'binance',
      totalDays: priceData.length,
      dataRange: {
        start: priceData[0]?.date,
        end: priceData[priceData.length - 1]?.date,
      },
      macroDataAvailable: macroBundle !== null,
    });
  } catch (error) {
    console.error('Error fetching risk data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch data', details: String(error) },
      { status: 500 }
    );
  }
}

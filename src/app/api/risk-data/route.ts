/**
 * API Route: Fetch fresh BTC risk data from Binance
 * GET /api/risk-data
 *
 * Fetches ALL historical data from Binance (2017+) and calculates risk
 * Now with cycle-relative valuation for accurate bottom detection
 */

import { NextResponse } from 'next/server';

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

// Historical cycle data for cycle-relative calculations
interface CycleData {
  halvingDate: string;
  low: number;
  high: number;
}

const HISTORICAL_CYCLES: CycleData[] = [
  { halvingDate: '2012-11-28', low: 2, high: 1150 },
  { halvingDate: '2016-07-09', low: 200, high: 19800 },
  { halvingDate: '2020-05-11', low: 3200, high: 69000 },
  { halvingDate: '2024-04-20', low: 15500, high: 73800 },
];

// Component weights - optimized for peak/bottom detection
const DEFAULT_WEIGHTS = {
  valuation: 0.25,   // Mayer multiple
  momentum: 0.30,    // RSI/momentum - key for extremes (increased)
  volatility: 0.10,  // Background
  cycle: 0.15,       // Timing context
  macro: 0.05,       // Background factor
  attention: 0.15,   // Retail FOMO/fear
};

// Calibration params - slope=12, center=0.45 for better peak detection
const DEFAULT_CALIBRATION = {
  slope: 12,
  center: 0.45,
};

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

    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
    });

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
 * Get halving index for a given date
 */
function getHalvingIndex(date: Date): number {
  for (let i = HALVING_DATES.length - 1; i >= 0; i--) {
    if (date >= HALVING_DATES[i]) return i;
  }
  return -1;
}

/**
 * Get previous cycle's low and high for cycle-relative calculations
 */
function getPreviousCycleRange(date: Date): { low: number; high: number } {
  const halvingIdx = getHalvingIndex(date);

  // For cycle 0 or 1, use first cycle data
  if (halvingIdx <= 0) {
    return { low: HISTORICAL_CYCLES[0].low, high: HISTORICAL_CYCLES[0].high };
  }

  // Use the previous completed cycle
  const prevCycleIdx = Math.min(halvingIdx - 1, HISTORICAL_CYCLES.length - 2);
  return { low: HISTORICAL_CYCLES[prevCycleIdx].low, high: HISTORICAL_CYCLES[prevCycleIdx].high };
}

/**
 * Calculate cycle-relative valuation (0-1)
 * Where is current price relative to previous cycle's range
 */
function calculateCycleRelativeValuation(
  price: number,
  prevCycleLow: number,
  prevCycleHigh: number
): number {
  if (prevCycleHigh <= prevCycleLow || prevCycleLow <= 0) {
    return 0.5;
  }
  const position = (price - prevCycleLow) / (prevCycleHigh - prevCycleLow);
  return Math.max(0, Math.min(1, position));
}

/**
 * Get cycle phase based on days since halving
 */
function getCycleInfo(date: Date): { daysSinceHalving: number; phase: 'early' | 'mid' | 'late'; progress: number } {
  let lastHalving = HALVING_DATES[0];
  for (const halving of HALVING_DATES) {
    if (date >= halving) lastHalving = halving;
  }

  const daysSince = Math.floor((date.getTime() - lastHalving.getTime()) / (1000 * 60 * 60 * 24));
  const cycleLength = 1460; // ~4 years
  const progress = Math.min(daysSince / cycleLength, 1);

  let phase: 'early' | 'mid' | 'late' = 'early';
  if (progress > 0.66) phase = 'late';
  else if (progress > 0.33) phase = 'mid';

  return { daysSinceHalving: daysSince, phase, progress };
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
 * Apply calibration - slope=10 for full 0-1 range
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

/**
 * Calculate risk score for a single data point
 * Optimized for detecting cycle peaks and bottoms
 */
function calculateRisk(
  prices: number[],
  index: number,
  date: Date,
  avgVol: number
): { risk: number; components: RiskDataPoint['components']; cyclePhase: 'early' | 'mid' | 'late' } {
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

  // Cycle score based on progress
  const cycleScore = cycleInfo.progress;

  // Macro (placeholder)
  const macroScore = 0.5;

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

  return { risk, components, cyclePhase: cycleInfo.phase };
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
    // Fetch ALL data from Binance (2017+)
    const priceData = await fetchAllBinanceData();

    if (priceData.length === 0) {
      return NextResponse.json({ error: 'No data available' }, { status: 500 });
    }

    const prices = priceData.map(d => d.close);

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

      const { risk, components, cyclePhase } = calculateRisk(prices, i, date, avgVol);

      rawRisks.push(risk);
      riskData.push({
        date: priceData[i].date,
        price: priceData[i].close,
        risk,
        smoothedRisk: risk,
        components,
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
    });
  } catch (error) {
    console.error('Error fetching risk data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch data', details: String(error) },
      { status: 500 }
    );
  }
}

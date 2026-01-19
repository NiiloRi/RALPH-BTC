/**
 * API Route: Fetch fresh BTC risk data from Binance
 * GET /api/risk-data
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
  cyclePhase: string;
  isHalving: boolean;
}

// Halving dates for cycle calculation
const HALVING_DATES = [
  new Date('2012-11-28'),
  new Date('2016-07-09'),
  new Date('2020-05-11'),
  new Date('2024-04-20'),
];

/**
 * Fetch recent BTC data from Binance (last 400 days for calculations)
 */
async function fetchBinanceData(days: number = 400): Promise<PriceData[]> {
  const symbol = 'BTCUSDT';
  const interval = '1d';
  const endTime = Date.now();
  const startTime = endTime - days * 24 * 60 * 60 * 1000;

  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${startTime}&endTime=${endTime}&limit=1000`;

  const response = await fetch(url, {
    headers: { 'Accept': 'application/json' },
    next: { revalidate: 3600 }, // Cache for 1 hour
  });

  if (!response.ok) {
    throw new Error(`Binance API error: ${response.status}`);
  }

  const klines: BinanceKline[] = await response.json();

  return klines.map(kline => {
    const [openTime, open, high, low, close, volume] = kline;
    return {
      date: new Date(openTime).toISOString().split('T')[0],
      open: parseFloat(open),
      high: parseFloat(high),
      low: parseFloat(low),
      close: parseFloat(close),
      volume: parseFloat(volume),
    };
  });
}

/**
 * Calculate SMA
 */
function calculateSMA(prices: number[], period: number): number {
  if (prices.length < period) return prices[prices.length - 1];
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
    returns.push(Math.log(prices[i] / prices[i - 1]));
  }

  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length;
  return Math.sqrt(variance) * Math.sqrt(365); // Annualized
}

/**
 * Get cycle phase based on days since halving
 */
function getCycleInfo(date: Date): { daysSinceHalving: number; phase: string; progress: number } {
  let lastHalving = HALVING_DATES[0];
  for (const halving of HALVING_DATES) {
    if (date >= halving) lastHalving = halving;
  }

  const daysSince = Math.floor((date.getTime() - lastHalving.getTime()) / (1000 * 60 * 60 * 24));
  const cycleLength = 1400; // ~4 years adjusted
  const progress = Math.min(daysSince / cycleLength, 1);

  let phase = 'early';
  if (progress > 0.6) phase = 'late';
  else if (progress > 0.3) phase = 'mid';

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
 * Calculate risk score for a single data point
 */
function calculateRisk(
  prices: number[],
  index: number,
  date: Date
): { risk: number; components: RiskDataPoint['components'] } {
  const price = prices[index];
  const priceHistory = prices.slice(0, index + 1);

  // Valuation: Price relative to 200 SMA
  const sma200 = calculateSMA(priceHistory, Math.min(200, priceHistory.length));
  const mayerMultiple = price / sma200;
  const valuationScore = Math.min(Math.max((mayerMultiple - 0.5) / 2, 0), 1);

  // Momentum: RSI-based
  const rsi = calculateRSI(priceHistory, 14);
  const momentumScore = rsi / 100;

  // Volatility
  const vol = calculateVolatility(priceHistory, 30);
  const volatilityScore = Math.min(vol / 1.5, 1);

  // Cycle
  const cycleInfo = getCycleInfo(date);
  const cycleScore = cycleInfo.progress;

  // Macro (placeholder - would need external data)
  const macroScore = 0.5;

  // Attention (using volume as proxy)
  const attentionScore = 0.5;

  const components = {
    valuation: valuationScore,
    momentum: momentumScore,
    volatility: volatilityScore,
    cycle: cycleScore,
    macro: macroScore,
    attention: attentionScore,
  };

  // Weighted ensemble
  const weights = {
    valuation: 0.30,
    momentum: 0.10,
    volatility: 0.15,
    cycle: 0.25,
    macro: 0.05,
    attention: 0.15,
  };

  const rawScore =
    components.valuation * weights.valuation +
    components.momentum * weights.momentum +
    components.volatility * weights.volatility +
    components.cycle * weights.cycle +
    components.macro * weights.macro +
    components.attention * weights.attention;

  // Sigmoid calibration
  const slope = 8;
  const center = 0.4;
  const calibrated = 1 / (1 + Math.exp(-slope * (rawScore - center)));
  const risk = Math.max(0, Math.min(1, calibrated));

  return { risk, components };
}

/**
 * Apply EMA smoothing
 */
function smoothRisks(risks: number[], alpha: number = 0.3): number[] {
  const smoothed: number[] = [risks[0]];
  for (let i = 1; i < risks.length; i++) {
    smoothed.push(alpha * risks[i] + (1 - alpha) * smoothed[i - 1]);
  }
  return smoothed;
}

export async function GET() {
  try {
    // Fetch data from Binance
    const priceData = await fetchBinanceData(400);

    if (priceData.length === 0) {
      return NextResponse.json({ error: 'No data available' }, { status: 500 });
    }

    const prices = priceData.map(d => d.close);

    // Calculate risk for each data point (skip first 50 for enough history)
    const startIdx = Math.min(50, Math.floor(priceData.length * 0.1));
    const riskData: RiskDataPoint[] = [];
    const rawRisks: number[] = [];

    for (let i = startIdx; i < priceData.length; i++) {
      const date = new Date(priceData[i].date);
      const { risk, components } = calculateRisk(prices, i, date);
      const cycleInfo = getCycleInfo(date);

      rawRisks.push(risk);
      riskData.push({
        date: priceData[i].date,
        price: priceData[i].close,
        risk,
        smoothedRisk: risk, // Will be updated after smoothing
        components,
        cyclePhase: cycleInfo.phase,
        isHalving: isHalvingDate(date),
      });
    }

    // Apply smoothing
    const smoothedRisks = smoothRisks(rawRisks);
    for (let i = 0; i < riskData.length; i++) {
      riskData[i].smoothedRisk = smoothedRisks[i];
    }

    // Return last 365 days for UI
    const last365 = riskData.slice(-365);

    return NextResponse.json({
      data: last365,
      lastUpdated: new Date().toISOString(),
      source: 'binance',
      totalDays: priceData.length,
    });
  } catch (error) {
    console.error('Error fetching risk data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch data', details: String(error) },
      { status: 500 }
    );
  }
}

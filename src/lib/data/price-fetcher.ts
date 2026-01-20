/**
 * Bitcoin price data fetcher
 * Uses free public APIs with caching
 */

import { PriceData, CacheMetadata, MacroDataBundle } from '../types';
import * as fs from 'fs';
import * as path from 'path';

const CACHE_DIR = path.join(process.cwd(), 'data', 'raw');

// FRED API series IDs for macro indicators
export const FRED_SERIES = {
  M2: 'M2SL',           // M2 Money Stock (monthly, seasonally adjusted)
  FEDFUNDS: 'FEDFUNDS', // Effective Federal Funds Rate (monthly)
  DGS10: 'DGS10',       // 10-Year Treasury Constant Maturity (daily)
  DGS2: 'DGS2',         // 2-Year Treasury Constant Maturity (daily)
  T10Y2Y: 'T10Y2Y',     // 10-Year minus 2-Year Treasury Spread (daily)
  DFII10: 'DFII10',     // 10-Year Treasury Inflation-Indexed (TIPS, daily)
  DXY: 'DTWEXBGS',      // Trade Weighted U.S. Dollar Index (daily)
} as const;

interface CoinGeckoOHLC {
  prices: [number, number][];
  market_caps: [number, number][];
  total_volumes: [number, number][];
}

// Binance kline format: [openTime, open, high, low, close, volume, closeTime, ...]
type BinanceKline = [number, string, string, string, string, string, number, string, number, string, string, string];

/**
 * Fetch BTC price history from Binance (free public API, no auth required)
 * Returns daily OHLCV data from BTCUSDT pair (available since Aug 2017)
 */
export async function fetchBinanceHistory(
  startDate?: Date,
  endDate?: Date
): Promise<PriceData[]> {
  const allData: PriceData[] = [];
  const symbol = 'BTCUSDT';
  const interval = '1d';
  const limit = 1000; // Max per request

  // Default start: Aug 17, 2017 (BTCUSDT listing date)
  let startTime = startDate?.getTime() || new Date('2017-08-17').getTime();
  const endTime = endDate?.getTime() || Date.now();

  console.log(`Fetching Binance data from ${new Date(startTime).toISOString().split('T')[0]}...`);

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
      const date = new Date(openTime);

      allData.push({
        date: date.toISOString().split('T')[0],
        open: parseFloat(open),
        high: parseFloat(high),
        low: parseFloat(low),
        close: parseFloat(close),
        volume: parseFloat(volume),
      });
    }

    // Move to next batch (last candle's close time + 1ms)
    const lastKline = klines[klines.length - 1];
    startTime = lastKline[6] + 1;

    // Rate limit protection
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  // Remove duplicates and sort
  const seen = new Set<string>();
  const unique = allData.filter(d => {
    if (seen.has(d.date)) return false;
    seen.add(d.date);
    return true;
  });

  return unique.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Fetch BTC price history from CoinGecko (free API)
 * Rate limited to 10-30 calls/minute
 */
export async function fetchCoinGeckoHistory(
  days: number = 'max' as unknown as number
): Promise<PriceData[]> {
  const url = `https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=${days}&interval=daily`;

  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`CoinGecko API error: ${response.status}`);
  }

  const data: CoinGeckoOHLC = await response.json();

  return data.prices.map(([timestamp, price], index) => {
    const date = new Date(timestamp);
    const volume = data.total_volumes[index]?.[1];

    return {
      date: date.toISOString().split('T')[0],
      open: price,
      high: price,
      low: price,
      close: price,
      volume: volume || 0,
    };
  });
}

/**
 * Load existing CSV data from public folder (fallback/sample data)
 */
export function loadExistingCSV(filename: string): PriceData[] {
  const publicPath = path.join(process.cwd(), 'public', filename);

  if (!fs.existsSync(publicPath)) {
    return [];
  }

  const content = fs.readFileSync(publicPath, 'utf-8');
  const lines = content.trim().split('\n');
  const header = lines[0].split(',');

  const dateIdx = header.indexOf('date');
  const priceIdx = header.indexOf('price');

  if (dateIdx === -1 || priceIdx === -1) {
    throw new Error('Invalid CSV format');
  }

  return lines.slice(1).map(line => {
    const values = line.split(',');
    const price = parseFloat(values[priceIdx]);

    return {
      date: values[dateIdx],
      open: price,
      high: price,
      low: price,
      close: price,
    };
  });
}

/**
 * Fetch DXY (US Dollar Index) data from free source
 * Returns null if unavailable
 */
export async function fetchDXYData(
  startDate: string,
  endDate: string
): Promise<Map<string, number> | null> {
  // FRED API for DXY requires an API key
  // For now, return null - can be extended with API key from env
  const apiKey = process.env.FRED_API_KEY;

  if (!apiKey) {
    console.warn('DXY data unavailable - FRED_API_KEY not set');
    return null;
  }

  try {
    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=DTWEXBGS&api_key=${apiKey}&file_type=json&observation_start=${startDate}&observation_end=${endDate}`;

    const response = await fetch(url);
    if (!response.ok) return null;

    const data = await response.json();
    const result = new Map<string, number>();

    for (const obs of data.observations || []) {
      if (obs.value !== '.') {
        result.set(obs.date, parseFloat(obs.value));
      }
    }

    return result;
  } catch {
    return null;
  }
}

/**
 * Fetch a single FRED series
 * Returns a Map of date -> value
 */
export async function fetchFREDSeries(
  seriesId: string,
  startDate: string,
  endDate: string
): Promise<Map<string, number> | null> {
  const apiKey = process.env.FRED_API_KEY;

  if (!apiKey) {
    return null;
  }

  try {
    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${apiKey}&file_type=json&observation_start=${startDate}&observation_end=${endDate}`;

    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`FRED API error for ${seriesId}: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const result = new Map<string, number>();

    for (const obs of data.observations || []) {
      if (obs.value !== '.' && obs.value !== '') {
        result.set(obs.date, parseFloat(obs.value));
      }
    }

    return result;
  } catch (error) {
    console.warn(`FRED fetch failed for ${seriesId}:`, error);
    return null;
  }
}

/**
 * Fetch all macro data from FRED API
 * Returns a MacroDataBundle with all available indicators
 */
export async function fetchAllMacroData(
  startDate: string,
  endDate: string
): Promise<MacroDataBundle | null> {
  const apiKey = process.env.FRED_API_KEY;

  if (!apiKey) {
    console.warn('Macro data unavailable - FRED_API_KEY not set');
    return null;
  }

  console.log('Fetching macro data from FRED...');

  // Fetch all series in parallel
  const [m2Data, fedFundsData, treasury10yData, treasury2yData, yieldSpreadData, realRateData, dxyData] = await Promise.all([
    fetchFREDSeries(FRED_SERIES.M2, startDate, endDate),
    fetchFREDSeries(FRED_SERIES.FEDFUNDS, startDate, endDate),
    fetchFREDSeries(FRED_SERIES.DGS10, startDate, endDate),
    fetchFREDSeries(FRED_SERIES.DGS2, startDate, endDate),
    fetchFREDSeries(FRED_SERIES.T10Y2Y, startDate, endDate),
    fetchFREDSeries(FRED_SERIES.DFII10, startDate, endDate),
    fetchFREDSeries(FRED_SERIES.DXY, startDate, endDate),
  ]);

  // Check if we got any data
  const hasData = m2Data || fedFundsData || treasury10yData || treasury2yData || yieldSpreadData || realRateData || dxyData;

  if (!hasData) {
    console.warn('No macro data fetched from FRED');
    return null;
  }

  const bundle: MacroDataBundle = {
    m2: m2Data || new Map(),
    fedFunds: fedFundsData || new Map(),
    treasury10y: treasury10yData || new Map(),
    treasury2y: treasury2yData || new Map(),
    yieldSpread: yieldSpreadData || new Map(),
    realRate: realRateData || new Map(),
    dxy: dxyData || new Map(),
  };

  console.log(`Fetched macro data: M2=${bundle.m2.size}, FedFunds=${bundle.fedFunds.size}, ` +
    `10Y=${bundle.treasury10y.size}, 2Y=${bundle.treasury2y.size}, Spread=${bundle.yieldSpread.size}, ` +
    `RealRate=${bundle.realRate.size}, DXY=${bundle.dxy.size} data points`);

  return bundle;
}

/**
 * Save macro data bundle to cache
 */
export function saveMacroCache(bundle: MacroDataBundle): void {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }

  const cachePath = path.join(CACHE_DIR, 'macro_fred.json');

  // Convert Maps to arrays for JSON serialization
  const serializable = {
    m2: Array.from(bundle.m2.entries()),
    fedFunds: Array.from(bundle.fedFunds.entries()),
    treasury10y: Array.from(bundle.treasury10y.entries()),
    treasury2y: Array.from(bundle.treasury2y.entries()),
    yieldSpread: Array.from(bundle.yieldSpread.entries()),
    realRate: Array.from(bundle.realRate.entries()),
    dxy: Array.from(bundle.dxy.entries()),
    lastFetch: new Date().toISOString(),
  };

  fs.writeFileSync(cachePath, JSON.stringify(serializable, null, 2));
  console.log('Macro data cached successfully');
}

/**
 * Load macro data bundle from cache
 */
export function loadMacroCache(maxAgeHours: number = 168): MacroDataBundle | null {
  const cachePath = path.join(CACHE_DIR, 'macro_fred.json');

  if (!fs.existsSync(cachePath)) {
    return null;
  }

  try {
    const content = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));

    // Check age
    const lastFetch = new Date(content.lastFetch);
    const ageHours = (Date.now() - lastFetch.getTime()) / (1000 * 60 * 60);

    if (ageHours > maxAgeHours) {
      console.log('Macro cache expired');
      return null;
    }

    // Convert arrays back to Maps
    const bundle: MacroDataBundle = {
      m2: new Map(content.m2),
      fedFunds: new Map(content.fedFunds),
      treasury10y: new Map(content.treasury10y),
      treasury2y: new Map(content.treasury2y),
      yieldSpread: new Map(content.yieldSpread),
      realRate: new Map(content.realRate),
      dxy: new Map(content.dxy),
    };

    console.log(`Loaded macro data from cache (age: ${ageHours.toFixed(1)}h)`);
    return bundle;
  } catch (error) {
    console.warn('Failed to load macro cache:', error);
    return null;
  }
}

/**
 * Get macro data - from cache if fresh, otherwise fetch
 */
export async function getMacroData(
  startDate: string,
  endDate: string,
  forceRefresh = false
): Promise<MacroDataBundle | null> {
  if (!forceRefresh) {
    const cached = loadMacroCache();
    if (cached) {
      return cached;
    }
  }

  const fresh = await fetchAllMacroData(startDate, endDate);

  if (fresh) {
    saveMacroCache(fresh);
  }

  return fresh;
}

/**
 * Save data to cache with metadata
 */
export function saveToCache(
  filename: string,
  data: PriceData[],
  source: string
): void {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }

  const dataPath = path.join(CACHE_DIR, filename);
  const metaPath = path.join(CACHE_DIR, `${filename}.meta.json`);

  // Write data as CSV
  const header = 'date,open,high,low,close,volume';
  const rows = data.map(d =>
    `${d.date},${d.open},${d.high},${d.low},${d.close},${d.volume || 0}`
  );
  fs.writeFileSync(dataPath, [header, ...rows].join('\n'));

  // Write metadata
  const meta: CacheMetadata = {
    lastFetch: new Date().toISOString(),
    source,
  };
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
}

/**
 * Load cached data if still fresh
 */
export function loadFromCache(
  filename: string,
  maxAgeHours: number = 24
): PriceData[] | null {
  const dataPath = path.join(CACHE_DIR, filename);
  const metaPath = path.join(CACHE_DIR, `${filename}.meta.json`);

  if (!fs.existsSync(dataPath) || !fs.existsSync(metaPath)) {
    return null;
  }

  const meta: CacheMetadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  const lastFetch = new Date(meta.lastFetch);
  const ageHours = (Date.now() - lastFetch.getTime()) / (1000 * 60 * 60);

  if (ageHours > maxAgeHours) {
    return null;
  }

  // Parse CSV
  const content = fs.readFileSync(dataPath, 'utf-8');
  const lines = content.trim().split('\n');

  return lines.slice(1).map(line => {
    const [date, open, high, low, close, volume] = line.split(',');
    return {
      date,
      open: parseFloat(open),
      high: parseFloat(high),
      low: parseFloat(low),
      close: parseFloat(close),
      volume: parseFloat(volume),
    };
  });
}

/**
 * Main function to get BTC price data
 * Uses cache if fresh, otherwise fetches new data
 * Priority: Binance (best OHLCV) -> CoinGecko -> Fallback CSV
 */
export async function getBTCPriceData(forceRefresh = false): Promise<PriceData[]> {
  const cacheFile = 'btc_price_daily.csv';

  if (!forceRefresh) {
    const cached = loadFromCache(cacheFile);
    if (cached && cached.length > 0) {
      console.log(`Loaded ${cached.length} days from cache`);
      return cached;
    }
  }

  // Try Binance first (free, no API key, best OHLCV data)
  try {
    console.log('Fetching from Binance...');
    const data = await fetchBinanceHistory();

    if (data.length > 0) {
      saveToCache(cacheFile, data, 'binance');
      console.log(`Fetched ${data.length} days from Binance`);
      return data;
    }
  } catch (error) {
    console.warn('Binance fetch failed:', error);
  }

  // Fallback to CoinGecko
  try {
    console.log('Fetching from CoinGecko...');
    const data = await fetchCoinGeckoHistory('max' as unknown as number);

    if (data.length > 0) {
      saveToCache(cacheFile, data, 'coingecko');
      console.log(`Fetched ${data.length} days from CoinGecko`);
      return data;
    }
  } catch (error) {
    console.warn('CoinGecko fetch failed:', error);
  }

  // Fallback to existing CSV in public folder
  console.log('Using fallback data from public folder...');
  const fallback = loadExistingCSV('btc_risk_binance.csv');

  if (fallback.length === 0) {
    throw new Error('No price data available');
  }

  return fallback;
}

/**
 * Merge multiple data sources, preferring the first source
 */
export function mergeDataSources(
  primary: PriceData[],
  secondary: PriceData[]
): PriceData[] {
  const dateMap = new Map<string, PriceData>();

  // Add secondary first (will be overwritten by primary)
  for (const record of secondary) {
    dateMap.set(record.date, record);
  }

  // Add primary (takes precedence)
  for (const record of primary) {
    dateMap.set(record.date, record);
  }

  // Sort by date
  const sorted = Array.from(dateMap.values()).sort(
    (a, b) => a.date.localeCompare(b.date)
  );

  return sorted;
}

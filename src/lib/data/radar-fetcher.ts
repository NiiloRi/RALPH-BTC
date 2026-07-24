/**
 * Cycle Low Radar — external data: Nasdaq 100 & gold weekly closes (Yahoo
 * Finance chart API) and BTC realized price (bitcoin-data.com).
 *
 * Follows the difficulty-fetcher pattern: combined JSON disk cache with a
 * 24h TTL and a stale-cache fallback when any upstream is unreachable.
 * RADAR_CACHE_DIR env override (function, not module const) for tests.
 */

import * as fs from 'fs';
import * as path from 'path';

const DEFAULT_TTL_HOURS = 24;
const YAHOO_UA = 'Mozilla/5.0 (compatible; btc-risk-dashboard)';

export interface SeriesPoint {
  date: string;
  value: number;
}

export interface RadarData {
  /** Nasdaq 100 weekly closes */
  ndx: SeriesPoint[];
  /** Gold (COMEX front-month, GC=F) weekly closes */
  gold: SeriesPoint[];
  /** BTC realized price, daily */
  realized: SeriesPoint[];
}

interface CacheFile extends RadarData {
  lastFetch: string;
}

function cacheDir(): string {
  return process.env.RADAR_CACHE_DIR ?? path.join(process.cwd(), 'data', 'raw');
}
function cachePath(): string {
  return path.join(cacheDir(), 'radar.json');
}

/** Yahoo v8 chart API — weekly closes, full history.
 *  NOTE: `range=max` silently coarsens 1wk to 3mo bars; explicit
 *  period1/period2 keeps true weekly granularity. */
export async function fetchYahooWeekly(symbol: string): Promise<SeriesPoint[]> {
  const period2 = Math.floor(Date.now() / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol
  )}?interval=1wk&period1=315532800&period2=${period2}`;
  const res = await fetch(url, { headers: { 'User-Agent': YAHOO_UA } });
  if (!res.ok) throw new Error(`yahoo ${symbol}: ${res.status}`);
  const json = (await res.json()) as {
    chart?: {
      result?: Array<{
        timestamp?: number[];
        indicators?: { quote?: Array<{ close?: (number | null)[] }> };
      }>;
    };
  };
  const r = json.chart?.result?.[0];
  const ts = r?.timestamp;
  const closes = r?.indicators?.quote?.[0]?.close;
  if (!ts || !closes || ts.length === 0) throw new Error(`yahoo ${symbol}: empty payload`);
  const out: SeriesPoint[] = [];
  for (let i = 0; i < ts.length; i++) {
    const v = closes[i];
    if (v == null || !Number.isFinite(v) || v <= 0) continue;
    out.push({ date: new Date(ts[i] * 1000).toISOString().split('T')[0], value: v });
  }
  if (out.length === 0) throw new Error(`yahoo ${symbol}: no valid closes`);
  return out;
}

/** bitcoin-data.com — BTC realized price, daily, full history. */
export async function fetchRealizedPrice(): Promise<SeriesPoint[]> {
  const res = await fetch('https://bitcoin-data.com/v1/realized-price?startday=2010-07-17');
  if (!res.ok) throw new Error(`bitcoin-data realized-price: ${res.status}`);
  const json = (await res.json()) as Array<{ d: string; realizedPrice: number }>;
  if (!Array.isArray(json) || json.length === 0) {
    throw new Error('bitcoin-data realized-price: empty payload');
  }
  return json
    .filter(p => Number.isFinite(p.realizedPrice) && p.realizedPrice > 0)
    .map(p => ({ date: p.d, value: p.realizedPrice }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

export function saveRadarCache(data: RadarData): void {
  fs.mkdirSync(cacheDir(), { recursive: true });
  const file: CacheFile = { ...data, lastFetch: new Date().toISOString() };
  fs.writeFileSync(cachePath(), JSON.stringify(file));
}

export function loadRadarCacheStale(): RadarData | null {
  try {
    const raw = JSON.parse(fs.readFileSync(cachePath(), 'utf-8')) as CacheFile;
    if (!Array.isArray(raw.ndx) || !Array.isArray(raw.gold) || !Array.isArray(raw.realized)) {
      return null;
    }
    if (raw.ndx.length === 0 || raw.gold.length === 0 || raw.realized.length === 0) return null;
    return { ndx: raw.ndx, gold: raw.gold, realized: raw.realized };
  } catch {
    return null;
  }
}

export function loadRadarCache(maxAgeHours = DEFAULT_TTL_HOURS): RadarData | null {
  const stale = loadRadarCacheStale();
  if (!stale) return null;
  const raw = JSON.parse(fs.readFileSync(cachePath(), 'utf-8')) as CacheFile;
  const ageHours = (Date.now() - new Date(raw.lastFetch).getTime()) / 3_600_000;
  return ageHours <= maxAgeHours ? stale : null;
}

/** Cache-first: fresh cache → fetch all three + save → stale fallback → throw. */
export async function getRadarData(
  forceRefresh = false
): Promise<{ data: RadarData; stale: boolean }> {
  if (!forceRefresh) {
    const cached = loadRadarCache();
    if (cached) return { data: cached, stale: false };
  }
  try {
    const [ndx, gold, realized] = await Promise.all([
      fetchYahooWeekly('^NDX'),
      fetchYahooWeekly('GC=F'),
      fetchRealizedPrice(),
    ]);
    const data: RadarData = { ndx, gold, realized };
    saveRadarCache(data);
    return { data, stale: false };
  } catch (err) {
    const stale = loadRadarCacheStale();
    if (stale) {
      console.warn('[radar] fetch failed, serving stale cache:', err);
      return { data: stale, stale: true };
    }
    throw err;
  }
}

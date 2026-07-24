/**
 * Bitcoin network difficulty history — fetch + disk cache.
 *
 * Source: blockchain.info charts API (free, no key):
 *   https://api.blockchain.info/charts/difficulty?timespan=all&format=json&sampled=false
 *
 * Mirrors the FRED macro-cache pattern in price-fetcher.ts: JSON file under
 * data/raw with a lastFetch stamp and a TTL check; on fetch failure we fall
 * back to a stale cache rather than failing the page. DIFFICULTY_CACHE_DIR
 * env override (function, not module const) makes tests hermetic — same
 * pattern as AUTH_DATA_DIR in auth/user-store.ts.
 *
 * Data notes: the first days of Jan 2009 come back as y = 0 — filtered at
 * ingest (difficulty is ≥ 1 from the genesis block onward). Points are
 * deduped by date and sorted ascending.
 */

import * as fs from 'fs';
import * as path from 'path';

const API_URL =
  'https://api.blockchain.info/charts/difficulty?timespan=all&format=json&sampled=false';
const DEFAULT_TTL_HOURS = 24;

export interface DifficultyPoint {
  date: string;
  difficulty: number; // > 0
}

interface CacheFile {
  lastFetch: string;
  points: DifficultyPoint[];
}

function cacheDir(): string {
  return process.env.DIFFICULTY_CACHE_DIR ?? path.join(process.cwd(), 'data', 'raw');
}
function cachePath(): string {
  return path.join(cacheDir(), 'difficulty.json');
}

export async function fetchDifficultyHistory(): Promise<DifficultyPoint[]> {
  const res = await fetch(API_URL);
  if (!res.ok) throw new Error(`blockchain.info difficulty API: ${res.status}`);
  const payload = (await res.json()) as { values?: { x: number; y: number }[] };
  if (!Array.isArray(payload.values) || payload.values.length === 0) {
    throw new Error('blockchain.info difficulty API: empty payload');
  }
  const byDate = new Map<string, number>();
  for (const v of payload.values) {
    if (!Number.isFinite(v.y) || v.y <= 0) continue; // Jan-2009 zero rows etc.
    const date = new Date(v.x * 1000).toISOString().split('T')[0];
    byDate.set(date, v.y); // last wins on duplicate dates
  }
  return Array.from(byDate.entries())
    .map(([date, difficulty]) => ({ date, difficulty }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

export function saveDifficultyCache(points: DifficultyPoint[]): void {
  fs.mkdirSync(cacheDir(), { recursive: true });
  const file: CacheFile = { lastFetch: new Date().toISOString(), points };
  fs.writeFileSync(cachePath(), JSON.stringify(file));
}

export function loadDifficultyCache(maxAgeHours = DEFAULT_TTL_HOURS): DifficultyPoint[] | null {
  const stale = loadDifficultyCacheStale();
  if (!stale) return null;
  const raw = JSON.parse(fs.readFileSync(cachePath(), 'utf-8')) as CacheFile;
  const ageHours = (Date.now() - new Date(raw.lastFetch).getTime()) / 3_600_000;
  return ageHours <= maxAgeHours ? stale : null;
}

/** Ignores TTL — the fetch-failure fallback. */
export function loadDifficultyCacheStale(): DifficultyPoint[] | null {
  try {
    const raw = JSON.parse(fs.readFileSync(cachePath(), 'utf-8')) as CacheFile;
    return Array.isArray(raw.points) && raw.points.length > 0 ? raw.points : null;
  } catch {
    return null;
  }
}

/**
 * Cache-first orchestration (same control flow as getMacroData):
 * fresh cache → fetch+save → stale-cache fallback → throw.
 */
export async function getDifficultyData(
  forceRefresh = false
): Promise<{ points: DifficultyPoint[]; stale: boolean }> {
  if (!forceRefresh) {
    const cached = loadDifficultyCache();
    if (cached) return { points: cached, stale: false };
  }
  try {
    const points = await fetchDifficultyHistory();
    saveDifficultyCache(points);
    return { points, stale: false };
  } catch (err) {
    const stale = loadDifficultyCacheStale();
    if (stale) {
      console.warn('[difficulty] fetch failed, serving stale cache:', err);
      return { points: stale, stale: true };
    }
    throw err;
  }
}

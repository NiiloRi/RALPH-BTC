import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  fetchDifficultyHistory,
  saveDifficultyCache,
  loadDifficultyCache,
  loadDifficultyCacheStale,
  getDifficultyData,
} from './difficulty-fetcher';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'difficulty-test-'));
  process.env.DIFFICULTY_CACHE_DIR = dir;
});

afterEach(() => {
  delete process.env.DIFFICULTY_CACHE_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

const POINTS = [
  { date: '2020-01-01', difficulty: 100 },
  { date: '2020-01-02', difficulty: 200 },
];

function mockFetchOk() {
  const mock = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      values: [
        { x: 1230940800, y: 0 }, // Jan-2009 zero row → filtered
        { x: 1577836800, y: 100 }, // 2020-01-01
        { x: 1577923200, y: 150 }, // 2020-01-02 (duplicated below — last wins)
        { x: 1577923200, y: 200 },
      ],
    }),
  }));
  vi.stubGlobal('fetch', mock);
  return mock;
}

describe('cache save/load', () => {
  it('save → load round-trips', () => {
    saveDifficultyCache(POINTS);
    expect(loadDifficultyCache()).toEqual(POINTS);
  });

  it('expired cache returns null, stale loader still returns points', () => {
    saveDifficultyCache(POINTS);
    const file = path.join(dir, 'difficulty.json');
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    raw.lastFetch = new Date(Date.now() - 25 * 3_600_000).toISOString();
    fs.writeFileSync(file, JSON.stringify(raw));
    expect(loadDifficultyCache(24)).toBeNull();
    expect(loadDifficultyCacheStale()).toEqual(POINTS);
  });

  it('missing cache → null from both loaders', () => {
    expect(loadDifficultyCache()).toBeNull();
    expect(loadDifficultyCacheStale()).toBeNull();
  });
});

describe('fetchDifficultyHistory mapping', () => {
  it('filters zeros, dedupes by date (last wins), sorts ascending, ISO dates', async () => {
    mockFetchOk();
    const points = await fetchDifficultyHistory();
    expect(points).toEqual([
      { date: '2020-01-01', difficulty: 100 },
      { date: '2020-01-02', difficulty: 200 },
    ]);
  });

  it('throws on non-OK response and empty payload', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 502 })));
    await expect(fetchDifficultyHistory()).rejects.toThrow(/502/);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ values: [] }) })));
    await expect(fetchDifficultyHistory()).rejects.toThrow(/empty/);
  });
});

describe('getDifficultyData orchestration', () => {
  it('fresh cache short-circuits (fetch not called)', async () => {
    saveDifficultyCache(POINTS);
    const spy = mockFetchOk();
    const res = await getDifficultyData();
    expect(res).toEqual({ points: POINTS, stale: false });
    expect(spy).not.toHaveBeenCalled();
  });

  it('no cache → fetches and writes the cache', async () => {
    mockFetchOk();
    const res = await getDifficultyData();
    expect(res.stale).toBe(false);
    expect(res.points).toHaveLength(2);
    expect(loadDifficultyCacheStale()).toHaveLength(2);
  });

  it('expired cache + failing fetch → stale points with stale: true', async () => {
    saveDifficultyCache(POINTS);
    const file = path.join(dir, 'difficulty.json');
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    raw.lastFetch = new Date(Date.now() - 25 * 3_600_000).toISOString();
    fs.writeFileSync(file, JSON.stringify(raw));
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    const res = await getDifficultyData();
    expect(res).toEqual({ points: POINTS, stale: true });
  });

  it('no cache + failing fetch → throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    await expect(getDifficultyData()).rejects.toThrow(/network down/);
  });

  it('forceRefresh bypasses a fresh cache', async () => {
    saveDifficultyCache(POINTS);
    const spy = mockFetchOk();
    await getDifficultyData(true);
    expect(spy).toHaveBeenCalled();
  });
});

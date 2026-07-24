import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  fetchYahooWeekly,
  fetchRealizedPrice,
  saveRadarCache,
  loadRadarCache,
  loadRadarCacheStale,
  getRadarData,
  type RadarData,
} from './radar-fetcher';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-test-'));
  process.env.RADAR_CACHE_DIR = dir;
});
afterEach(() => {
  delete process.env.RADAR_CACHE_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

const DATA: RadarData = {
  ndx: [{ date: '2020-01-06', value: 9000 }],
  gold: [{ date: '2020-01-06', value: 1550 }],
  realized: [{ date: '2020-01-06', value: 5000 }],
};

function yahooPayload() {
  return {
    chart: {
      result: [
        {
          timestamp: [1578268800, 1578873600], // 2020-01-06, 2020-01-13
          indicators: { quote: [{ close: [9000, null] }] },
        },
      ],
    },
  };
}

function mockFetchByUrl() {
  const mock = vi.fn(async (url: string) => {
    if (String(url).includes('yahoo')) {
      return { ok: true, json: async () => yahooPayload() };
    }
    return {
      ok: true,
      json: async () => [
        { d: '2020-01-06', realizedPrice: 5000 },
        { d: '2020-01-07', realizedPrice: 0 }, // filtered
      ],
    };
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

describe('fetchYahooWeekly', () => {
  it('maps timestamps to ISO dates and drops null closes', async () => {
    mockFetchByUrl();
    const pts = await fetchYahooWeekly('^NDX');
    expect(pts).toEqual([{ date: '2020-01-06', value: 9000 }]);
  });
  it('requests explicit period1/period2, never range=max (weekly stays weekly)', async () => {
    const mock = mockFetchByUrl();
    await fetchYahooWeekly('^NDX');
    const url = String(mock.mock.calls[0][0]);
    expect(url).toContain('period1=');
    expect(url).not.toContain('range=max');
  });
  it('throws on empty payload', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ chart: { result: [{}] } }) })));
    await expect(fetchYahooWeekly('^NDX')).rejects.toThrow(/empty/);
  });
});

describe('fetchRealizedPrice', () => {
  it('maps and filters non-positive values', async () => {
    mockFetchByUrl();
    expect(await fetchRealizedPrice()).toEqual([{ date: '2020-01-06', value: 5000 }]);
  });
});

describe('cache + orchestration', () => {
  it('save → load round-trips; TTL expiry → null; stale loader survives', () => {
    saveRadarCache(DATA);
    expect(loadRadarCache()).toEqual(DATA);
    const file = path.join(dir, 'radar.json');
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    raw.lastFetch = new Date(Date.now() - 25 * 3_600_000).toISOString();
    fs.writeFileSync(file, JSON.stringify(raw));
    expect(loadRadarCache(24)).toBeNull();
    expect(loadRadarCacheStale()).toEqual(DATA);
  });

  it('fresh cache short-circuits fetch', async () => {
    saveRadarCache(DATA);
    const mock = mockFetchByUrl();
    const res = await getRadarData();
    expect(res).toEqual({ data: DATA, stale: false });
    expect(mock).not.toHaveBeenCalled();
  });

  it('no cache → fetches all three and saves', async () => {
    const mock = mockFetchByUrl();
    const res = await getRadarData();
    expect(res.stale).toBe(false);
    expect(mock).toHaveBeenCalledTimes(3);
    expect(loadRadarCacheStale()).not.toBeNull();
  });

  it('fetch failure → stale fallback; no cache + failure → throws', async () => {
    saveRadarCache(DATA);
    const file = path.join(dir, 'radar.json');
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    raw.lastFetch = new Date(Date.now() - 25 * 3_600_000).toISOString();
    fs.writeFileSync(file, JSON.stringify(raw));
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    expect(await getRadarData()).toEqual({ data: DATA, stale: true });
    fs.rmSync(file);
    await expect(getRadarData()).rejects.toThrow(/down/);
  });
});

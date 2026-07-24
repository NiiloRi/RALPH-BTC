import { describe, it, expect } from 'vitest';
import { buildScenarioEnsemble, DEFAULT_HORIZON_WEEKS } from './scenario-ensemble';
import type { Point } from './cycle-low-radar';

function daily(start: string, n: number, fn: (i: number) => number): Point[] {
  const t0 = new Date(start).getTime();
  return Array.from({ length: n }, (_, i) => ({
    date: new Date(t0 + i * 86_400_000).toISOString().split('T')[0],
    value: fn(i),
  }));
}

/**
 * Synthetic world with ONE completed episode: BTC crashes hard mid-history
 * (driving the NAS/BTC ratio RSI deep overbought), then recovers strongly —
 * then stays flat long enough for the episode to complete and a full 3-year
 * forward trajectory to exist.
 */
function syntheticWorld() {
  const n = 5200;
  const crashStart = 1400; // ~2016 in day-index terms
  const crashEnd = 1700;
  const btc = daily('2012-01-02', n, i => {
    if (i < crashStart) return 1000 + i;
    if (i < crashEnd) return 2400 - (i - crashStart) * 5; // deep crash → ratio RSI spikes
    return 900 + (i - crashEnd) * 2; // strong multi-year recovery
  });
  const nas = daily('2012-01-02', n, i => 4000 + i).filter((_, i) => i % 7 === 0);
  return { btc, nas };
}

describe('buildScenarioEnsemble', () => {
  const { btc, nas } = syntheticWorld();

  it('builds bands from completed episodes only, anchored at spot', () => {
    const e = buildScenarioEnsemble(btc, nas);
    expect(e).not.toBeNull();
    expect(e!.anchors.length).toBeGreaterThan(0);
    expect(e!.pathCount).toBe(e!.anchors.length * 6);
    expect(e!.bands).toHaveLength(DEFAULT_HORIZON_WEEKS + 1);
    // w=0: every path equals spot → all percentiles identical
    const w0 = e!.bands[0];
    expect(w0.p10).toBeCloseTo(w0.p90, 6);
  });

  it('percentiles are ordered p10 <= p25 <= p75 <= p90 at every week', () => {
    const e = buildScenarioEnsemble(btc, nas)!;
    for (const b of e.bands) {
      expect(b.p10).toBeLessThanOrEqual(b.p25 + 1e-9);
      expect(b.p25).toBeLessThanOrEqual(b.p75 + 1e-9);
      expect(b.p75).toBeLessThanOrEqual(b.p90 + 1e-9);
      expect(b.p10).toBeGreaterThan(0);
    }
  });

  it('strength 1.0 replays the historical trajectory exactly', () => {
    const e = buildScenarioEnsemble(btc, nas, { strengths: [1.0] })!;
    // recovery was ~linear at +2/day from the anchor: after 156 weeks the
    // single-path band must equal spot * historical 3y multiple (p10 == p90)
    const lastBand = e.bands[e.bands.length - 1];
    expect(lastBand.p10).toBeCloseTo(lastBand.p90, 6);
    expect(lastBand.p10).toBeGreaterThan(e.bands[0].p10); // recovery path rises
  });

  it('lower strengths compress the band toward spot', () => {
    const strong = buildScenarioEnsemble(btc, nas, { strengths: [0.8] })!;
    const weak = buildScenarioEnsemble(btc, nas, { strengths: [0.33] })!;
    const wS = strong.bands[strong.bands.length - 1].p90;
    const wW = weak.bands[weak.bands.length - 1].p90;
    const spot = strong.bands[0].p10;
    expect(Math.abs(Math.log(wW / spot))).toBeLessThan(Math.abs(Math.log(wS / spot)));
  });

  it('returns null when no completed episodes exist', () => {
    // steady world → ratio RSI never spikes → no episodes
    const flatBtc = daily('2012-01-02', 5200, i => 1000 + i);
    const flatNas = daily('2012-01-02', 5200, i => 4000 + i).filter((_, i) => i % 7 === 0);
    expect(buildScenarioEnsemble(flatBtc, flatNas)).toBeNull();
  });

  it('returns null on insufficient history', () => {
    expect(buildScenarioEnsemble(daily('2024-01-01', 100, i => 100 + i), [])).toBeNull();
  });
});

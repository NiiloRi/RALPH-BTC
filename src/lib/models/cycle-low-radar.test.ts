import { describe, it, expect } from 'vitest';
import {
  weeklyCloses,
  wilderRsi,
  sma,
  ratioRsiMa,
  findEpisodes,
  pctTimeAbove,
  realizedPriceStats,
  cycleClock,
  computeRadar,
  type Point,
} from './cycle-low-radar';

function daily(start: string, n: number, fn: (i: number) => number): Point[] {
  const t0 = new Date(start).getTime();
  return Array.from({ length: n }, (_, i) => ({
    date: new Date(t0 + i * 86_400_000).toISOString().split('T')[0],
    value: fn(i),
  }));
}

describe('weeklyCloses', () => {
  it('keeps the last observation per Monday-anchored week', () => {
    const d = daily('2024-01-01', 21, i => 100 + i); // 2024-01-01 is a Monday
    const w = weeklyCloses(d);
    expect(w).toHaveLength(3);
    expect(w.map(p => p.date)).toEqual(['2024-01-07', '2024-01-14', '2024-01-21']);
    expect(w.map(p => p.value)).toEqual([106, 113, 120]);
  });
  it('skips non-finite and non-positive values', () => {
    const d = daily('2024-01-01', 7, i => (i === 6 ? NaN : 100 + i));
    expect(weeklyCloses(d)[0].value).toBe(105);
  });
});

describe('wilderRsi', () => {
  it('is 100 for monotone gains and ~0 for monotone losses', () => {
    expect(wilderRsi(Array.from({ length: 30 }, (_, i) => i + 1)).every(v => v === 100)).toBe(true);
    const falling = wilderRsi(Array.from({ length: 30 }, (_, i) => 100 - i));
    expect(falling.every(v => v < 1)).toBe(true);
  });
  it('is ~50 for a symmetric alternating series', () => {
    const vals = Array.from({ length: 60 }, (_, i) => 100 + (i % 2 === 0 ? 1 : -1));
    const rsi = wilderRsi(vals);
    const last = rsi[rsi.length - 1];
    expect(last).toBeGreaterThan(40);
    expect(last).toBeLessThan(60);
  });
  it('output length = input length - period', () => {
    expect(wilderRsi(Array.from({ length: 30 }, (_, i) => i), 14)).toHaveLength(16);
  });
});

describe('sma', () => {
  it('computes the running mean with correct alignment', () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([2, 3, 4]);
  });
  it('returns [] when input shorter than window', () => {
    expect(sma([1, 2], 3)).toEqual([]);
  });
});

describe('ratioRsiMa', () => {
  it('elevated when the numerator persistently outperforms', () => {
    // numerator doubles while denominator halves → ratio rises every week
    const num = daily('2020-01-06', 700, i => 100 * Math.pow(1.01, i)).filter((_, i) => i % 7 === 0);
    const den = daily('2020-01-06', 700, i => 100 * Math.pow(0.995, i)).filter((_, i) => i % 7 === 0);
    const s = ratioRsiMa(num, den);
    expect(s.length).toBeGreaterThan(20);
    expect(s[s.length - 1].value).toBeGreaterThan(90);
  });
  it('aligns by week and dates come from the numerator series', () => {
    const num = daily('2020-01-06', 350, i => 100 + i).filter((_, i) => i % 7 === 0);
    const den = daily('2020-01-08', 350, i => 200 - (i % 5)).filter((_, i) => i % 7 === 0);
    const s = ratioRsiMa(num, den);
    expect(s.length).toBeGreaterThan(0);
    for (const p of s) expect(num.some(n => n.date === p.date)).toBe(true);
  });
});

describe('findEpisodes / pctTimeAbove', () => {
  const series: Point[] = [55, 60, 67, 70, 68, 50, 40, 66, 71].map((v, i) => ({
    date: `2020-0${(i % 9) + 1}-01`.slice(0, 10),
    value: v,
  }));
  it('finds contiguous runs and marks the trailing one active', () => {
    const eps = findEpisodes(series, 66);
    expect(eps).toHaveLength(2);
    expect(eps[0]).toMatchObject({ weeks: 3, peak: 70, active: false });
    expect(eps[1]).toMatchObject({ weeks: 2, peak: 71, active: true });
  });
  it('pctTimeAbove counts inclusively', () => {
    expect(pctTimeAbove(series, 66)).toBeCloseTo(5 / 9);
  });
});

describe('realizedPriceStats', () => {
  it('forward-fills realized price and computes below-fraction', () => {
    const spot = daily('2020-01-01', 10, i => (i < 5 ? 80 : 120));
    const realized = [
      { date: '2020-01-01', value: 100 },
      { date: '2020-01-08', value: 110 },
    ];
    const s = realizedPriceStats(spot, realized)!;
    expect(s.joined).toHaveLength(10);
    expect(s.joined[0].realized).toBe(100);
    expect(s.joined[9].realized).toBe(110);
    expect(s.pctHistoryBelow).toBeCloseTo(5 / 10); // first five days spot 80 < 100
    expect(s.multiple).toBeCloseTo(120 / 110);
  });
  it('returns null for empty inputs', () => {
    expect(realizedPriceStats([], [])).toBeNull();
  });
});

describe('cycleClock', () => {
  // synthetic: rise to ATH at 2021-11-10 region then decline
  const prices = daily('2013-01-01', 5000, i => {
    const athIdx = 3235; // ≈ 2021-11
    return i <= athIdx ? 100 + i : 100 + athIdx - (i - athIdx) * 0.4;
  });
  it('locates the ATH and measures weeks/drawdown from it', () => {
    const c = cycleClock(prices)!;
    expect(c.current.athDate).toBe(prices[3235].date);
    expect(c.weeksSinceATH).toBeGreaterThan(200);
    expect(c.drawdownNow).toBeGreaterThan(0.1);
    expect(c.week60Date > c.current.athDate).toBe(true);
  });
  it('builds prior-cycle paths with monotone non-decreasing max-drawdown', () => {
    const c = cycleClock(prices)!;
    for (const p of c.priors) {
      for (let i = 1; i < p.drawdownByWeek.length; i++) {
        expect(p.drawdownByWeek[i]).toBeGreaterThanOrEqual(p.drawdownByWeek[i - 1] - 1e-12);
      }
    }
  });
});

describe('computeRadar', () => {
  it('produces four signals on synthetic data', () => {
    const btc = daily('2013-01-01', 4900, i => 100 + i * 0.5 + 30 * Math.sin(i / 90));
    const ndx = weeklyClosesOf(daily('2013-01-01', 4900, i => 1000 + i));
    const gold = weeklyClosesOf(daily('2013-01-01', 4900, i => 1500 + 0.2 * i));
    const realized = daily('2013-01-01', 4900, i => 80 + i * 0.45);
    const r = computeRadar(btc, ndx, gold, realized);
    expect(r).not.toBeNull();
    expect(r!.signals).toHaveLength(4);
    for (const s of r!.signals) {
      expect(typeof s.reading).toBe('string');
      expect(typeof s.inTail).toBe('boolean');
    }
  });
});

function weeklyClosesOf(d: Point[]): Point[] {
  return weeklyCloses(d);
}

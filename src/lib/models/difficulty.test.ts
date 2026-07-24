import { describe, it, expect } from 'vitest';
import {
  joinDifficultyToPrices,
  fitDifficultyModel,
  evaluateDifficultyModel,
  type JoinedRow,
} from './difficulty';

describe('joinDifficultyToPrices (forward fill — step semantics)', () => {
  const difficulty = [
    { date: '2020-01-01', difficulty: 100 },
    { date: '2020-01-05', difficulty: 200 },
    { date: '2020-01-09', difficulty: 400 },
  ];
  const prices = Array.from({ length: 12 }, (_, i) => ({
    date: `2020-01-${String(i + 1).padStart(2, '0')}`,
    close: 1000 + i,
  }));

  it('each price date carries the last difficulty at or before it', () => {
    const joined = joinDifficultyToPrices(prices, difficulty);
    expect(joined).toHaveLength(12);
    for (const r of joined) {
      if (r.date < '2020-01-05') expect(r.difficulty).toBe(100);
      else if (r.date < '2020-01-09') expect(r.difficulty).toBe(200);
      else expect(r.difficulty).toBe(400);
    }
  });

  it('drops price rows before the first difficulty observation', () => {
    const joined = joinDifficultyToPrices(
      [{ date: '2019-12-30', close: 900 }, ...prices],
      difficulty
    );
    expect(joined[0].date).toBe('2020-01-01');
  });

  it('filters non-positive difficulty and non-positive prices', () => {
    const joined = joinDifficultyToPrices(
      [
        { date: '2020-01-02', close: -5 },
        { date: '2020-01-03', close: 1000 },
      ],
      [{ date: '2020-01-01', difficulty: 0 }, { date: '2020-01-02', difficulty: 100 }]
    );
    expect(joined).toEqual([{ date: '2020-01-03', close: 1000, difficulty: 100 }]);
  });
});

describe('fitDifficultyModel', () => {
  function synthetic(b: number, a = Math.log(0.002)): JoinedRow[] {
    const rows: JoinedRow[] = [];
    for (let i = 0; i < 400; i++) {
      const difficulty = 1e6 * Math.pow(1.02, i); // growing difficulty
      rows.push({
        date: new Date(Date.UTC(2015, 0, 1 + i * 10)).toISOString().split('T')[0],
        close: Math.exp(a) * Math.pow(difficulty, b),
        difficulty,
      });
    }
    return rows;
  }

  it('recovers b = 0.51 to 1e-6 on exact synthetic data (bitbo reference form)', () => {
    const m = fitDifficultyModel(synthetic(0.51));
    expect(m.b).toBeCloseTo(0.51, 6);
    expect(m.a).toBeCloseTo(Math.log(0.002), 6);
    expect(m.r2).toBeGreaterThan(0.999999);
  });

  it('evaluate round-trips a fitted row', () => {
    const rows = synthetic(0.5);
    const m = fitDifficultyModel(rows);
    const r = rows[123];
    expect(evaluateDifficultyModel(m, r.difficulty)).toBeCloseTo(r.close, 6);
  });

  it('throws below MIN_POINTS', () => {
    expect(() => fitDifficultyModel([])).toThrow(/joined rows/);
  });
});

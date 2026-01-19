import { describe, it, expect } from 'vitest';
import {
  getHalvingIndex,
  daysSinceHalving,
  daysSinceGenesis,
  estimateCycleLength,
  getCyclePhase,
  getCycleProgress,
  getDiminishingReturnsMultiplier,
  getDiminishingLossesMultiplier,
  calculateCycleScore,
  isHalvingDate,
  HISTORICAL_PEAKS,
} from './cycle';
import { HALVING_DATES, GENESIS_DATE } from '../types';

describe('getHalvingIndex', () => {
  it('returns -1 before first halving', () => {
    expect(getHalvingIndex(new Date('2011-01-01'))).toBe(-1);
  });

  it('returns 0 after first halving', () => {
    expect(getHalvingIndex(new Date('2013-01-01'))).toBe(0);
  });

  it('returns 1 after second halving', () => {
    expect(getHalvingIndex(new Date('2017-01-01'))).toBe(1);
  });

  it('returns 2 after third halving', () => {
    expect(getHalvingIndex(new Date('2021-01-01'))).toBe(2);
  });

  it('returns 3 after fourth halving', () => {
    expect(getHalvingIndex(new Date('2025-01-01'))).toBe(3);
  });
});

describe('daysSinceHalving', () => {
  it('calculates days since genesis before first halving', () => {
    const date = new Date('2010-01-03'); // 1 year after genesis
    const days = daysSinceHalving(date);
    expect(days).toBeCloseTo(365, -1);
  });

  it('calculates days since halving correctly', () => {
    // First halving was 2012-11-28
    const date = new Date('2012-12-28'); // 30 days after
    const days = daysSinceHalving(date);
    expect(days).toBe(30);
  });

  it('returns 0 on halving date', () => {
    const days = daysSinceHalving(HALVING_DATES[0]);
    expect(days).toBe(0);
  });
});

describe('daysSinceGenesis', () => {
  it('returns 0 on genesis date', () => {
    expect(daysSinceGenesis(GENESIS_DATE)).toBe(0);
  });

  it('calculates correct days', () => {
    const oneYearLater = new Date('2010-01-03');
    const days = daysSinceGenesis(oneYearLater);
    expect(days).toBe(365);
  });
});

describe('estimateCycleLength', () => {
  it('returns default for first cycle', () => {
    const length = estimateCycleLength(0, []);
    expect(length).toBe(1460);
  });

  it('estimates from historical peaks', () => {
    const peaks = [new Date('2013-12-04'), new Date('2017-12-17')];
    const length = estimateCycleLength(2, peaks);
    expect(length).toBeGreaterThan(1400);
    expect(length).toBeLessThan(1800);
  });

  it('applies lengthening adjustment for later cycles', () => {
    const peaks = [new Date('2013-12-04'), new Date('2017-12-17')];
    const length2 = estimateCycleLength(2, peaks);
    const length3 = estimateCycleLength(3, peaks);
    expect(length3).toBeGreaterThan(length2);
  });
});

describe('getCyclePhase', () => {
  it('returns early for first third', () => {
    expect(getCyclePhase(100, 1000)).toBe('early');
  });

  it('returns mid for middle third', () => {
    expect(getCyclePhase(500, 1000)).toBe('mid');
  });

  it('returns late for final third', () => {
    expect(getCyclePhase(800, 1000)).toBe('late');
  });
});

describe('getCycleProgress', () => {
  it('calculates progress correctly', () => {
    expect(getCycleProgress(500, 1000)).toBe(0.5);
  });

  it('can exceed 1 for extended cycles', () => {
    expect(getCycleProgress(1500, 1000)).toBe(1.5);
  });
});

describe('getDiminishingReturnsMultiplier', () => {
  it('returns 1 for early cycles', () => {
    expect(getDiminishingReturnsMultiplier(0)).toBe(1);
    expect(getDiminishingReturnsMultiplier(1)).toBe(1);
  });

  it('returns decreasing values for later cycles', () => {
    const m2 = getDiminishingReturnsMultiplier(2);
    const m3 = getDiminishingReturnsMultiplier(3);
    expect(m2).toBeGreaterThan(m3);
  });
});

describe('getDiminishingLossesMultiplier', () => {
  it('returns decreasing values for later cycles', () => {
    const m1 = getDiminishingLossesMultiplier(1);
    const m2 = getDiminishingLossesMultiplier(2);
    expect(m1).toBeGreaterThanOrEqual(m2);
  });
});

describe('calculateCycleScore', () => {
  it('returns value between 0 and 1', () => {
    const score = calculateCycleScore(new Date('2024-06-01'));
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('increases in late cycle', () => {
    // Early in cycle (shortly after halving)
    const earlyScore = calculateCycleScore(new Date('2024-05-01'));
    // Late in cycle
    const lateScore = calculateCycleScore(new Date('2025-06-01'));

    expect(lateScore).toBeGreaterThan(earlyScore);
  });
});

describe('isHalvingDate', () => {
  it('returns true for halving dates', () => {
    expect(isHalvingDate(HALVING_DATES[0])).toBe(true);
    expect(isHalvingDate(HALVING_DATES[1])).toBe(true);
  });

  it('returns false for non-halving dates', () => {
    expect(isHalvingDate(new Date('2024-01-01'))).toBe(false);
  });
});

describe('HISTORICAL_PEAKS', () => {
  it('contains valid dates', () => {
    expect(HISTORICAL_PEAKS.length).toBeGreaterThanOrEqual(3);

    for (const peak of HISTORICAL_PEAKS) {
      expect(peak instanceof Date).toBe(true);
      expect(peak.getTime()).toBeGreaterThan(GENESIS_DATE.getTime());
    }
  });

  it('is sorted chronologically', () => {
    for (let i = 1; i < HISTORICAL_PEAKS.length; i++) {
      expect(HISTORICAL_PEAKS[i].getTime()).toBeGreaterThan(
        HISTORICAL_PEAKS[i - 1].getTime()
      );
    }
  });
});

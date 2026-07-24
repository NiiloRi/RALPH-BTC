import { describe, it, expect } from 'vitest';
import { projectionDates, addDays } from './projection';

describe('projectionDates', () => {
  const last = '2026-07-24';
  const end = '2028-10-16';

  it('is strictly ascending, starts at last+7d, ends exactly at endDate', () => {
    const rows = projectionDates(last, end, ['2028-04-16']);
    expect(rows[0]).toBe('2026-07-31');
    expect(rows[rows.length - 1]).toBe(end);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i] > rows[i - 1]).toBe(true);
    }
  });

  it('includes each mustInclude date exactly once', () => {
    const rows = projectionDates(last, end, ['2028-04-16']);
    expect(rows.filter(d => d === '2028-04-16')).toHaveLength(1);
  });

  it('ignores mustInclude dates outside (lastDataDate, endDate]', () => {
    const rows = projectionDates(last, end, ['2020-01-01', '2030-01-01']);
    expect(rows).not.toContain('2020-01-01');
    expect(rows).not.toContain('2030-01-01');
  });

  it('produces ~116-119 weekly rows for 2026-07→2028-10', () => {
    const rows = projectionDates(last, end, ['2028-04-16']);
    expect(rows.length).toBeGreaterThanOrEqual(116);
    expect(rows.length).toBeLessThanOrEqual(119);
  });

  it('returns [] when endDate <= lastDataDate or dates invalid', () => {
    expect(projectionDates('2028-01-01', '2027-01-01', [])).toEqual([]);
    expect(projectionDates('garbage', end, [])).toEqual([]);
  });

  it('never emits dates <= lastDataDate', () => {
    for (const d of projectionDates(last, end, [last])) {
      expect(d > last).toBe(true);
    }
  });
});

describe('addDays', () => {
  it('adds calendar days across month/leap boundaries', () => {
    expect(addDays('2028-04-16', 183)).toBe('2028-10-16');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29'); // 2028 is a leap year
  });
});

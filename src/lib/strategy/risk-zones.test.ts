/**
 * Tests for risk zones and hysteresis
 */

import { describe, it, expect } from 'vitest';
import {
  getRiskZone,
  getTargetAllocation,
  interpolateTargetAllocation,
  createHysteresisState,
  updateHysteresis,
  isRebalanceDay,
  getZoneDescription,
  getZoneColor,
} from './risk-zones';
import { DEFAULT_STRATEGY_CONFIG } from './types';

describe('getRiskZone', () => {
  it('should return accumulate for risk <= 0.20', () => {
    expect(getRiskZone(0)).toBe('accumulate');
    expect(getRiskZone(0.10)).toBe('accumulate');
    expect(getRiskZone(0.20)).toBe('accumulate');
  });

  it('should return normal for 0.20 < risk <= 0.50', () => {
    expect(getRiskZone(0.21)).toBe('normal');
    expect(getRiskZone(0.35)).toBe('normal');
    expect(getRiskZone(0.50)).toBe('normal');
  });

  it('should return cautious for 0.50 < risk <= 0.70', () => {
    expect(getRiskZone(0.51)).toBe('cautious');
    expect(getRiskZone(0.60)).toBe('cautious');
    expect(getRiskZone(0.70)).toBe('cautious');
  });

  it('should return derisk for 0.70 < risk <= 0.85', () => {
    expect(getRiskZone(0.71)).toBe('derisk');
    expect(getRiskZone(0.80)).toBe('derisk');
    expect(getRiskZone(0.85)).toBe('derisk');
  });

  it('should return defensive for risk > 0.85', () => {
    expect(getRiskZone(0.86)).toBe('defensive');
    expect(getRiskZone(0.95)).toBe('defensive');
    expect(getRiskZone(1.0)).toBe('defensive');
  });
});

describe('getTargetAllocation', () => {
  it('should return correct allocations for each zone', () => {
    expect(getTargetAllocation('accumulate')).toBe(0.90);
    expect(getTargetAllocation('normal')).toBe(0.70);
    expect(getTargetAllocation('cautious')).toBe(0.50);
    expect(getTargetAllocation('derisk')).toBe(0.30);
    expect(getTargetAllocation('defensive')).toBe(0.15);
  });
});

describe('interpolateTargetAllocation', () => {
  it('should return max allocation at 0 risk', () => {
    expect(interpolateTargetAllocation(0)).toBe(0.90);
  });

  it('should return min allocation at 1.0 risk', () => {
    expect(interpolateTargetAllocation(1.0)).toBe(0.15);
  });

  it('should interpolate smoothly between zones', () => {
    const mid = interpolateTargetAllocation(0.10);
    expect(mid).toBe(0.90); // Still in accumulate zone

    const transition = interpolateTargetAllocation(0.35);
    expect(transition).toBeGreaterThan(0.70);
    expect(transition).toBeLessThan(0.90);
  });
});

describe('Hysteresis', () => {
  it('should create initial state correctly', () => {
    const state = createHysteresisState(0.15);
    expect(state.currentZone).toBe('accumulate');
    expect(state.confirmedZone).toBe('accumulate');
    expect(state.daysInZone).toBe(1);
  });

  it('should not change confirmed zone immediately', () => {
    let state = createHysteresisState(0.15);

    // Move to normal zone
    state = updateHysteresis(state, 0.35);

    expect(state.currentZone).toBe('normal');
    expect(state.confirmedZone).toBe('accumulate'); // Still accumulate
    expect(state.daysInZone).toBe(1);
  });

  it('should confirm zone after hysteresis days', () => {
    let state = createHysteresisState(0.15);
    const config = { ...DEFAULT_STRATEGY_CONFIG, hysteresisDays: 3 };

    // Stay in normal zone for 3 days
    for (let i = 0; i < 3; i++) {
      state = updateHysteresis(state, 0.35, config);
    }

    expect(state.confirmedZone).toBe('normal');
    expect(state.daysInZone).toBe(3);
  });

  it('should reset counter when zone changes', () => {
    let state = createHysteresisState(0.15);

    // Move to normal
    state = updateHysteresis(state, 0.35);
    state = updateHysteresis(state, 0.35);

    expect(state.daysInZone).toBe(2);

    // Move back to accumulate
    state = updateHysteresis(state, 0.10);

    expect(state.currentZone).toBe('accumulate');
    expect(state.daysInZone).toBe(1);
    expect(state.confirmedZone).toBe('accumulate'); // Original confirmed
  });
});

describe('isRebalanceDay', () => {
  it('should return true for daily cadence', () => {
    const config = { ...DEFAULT_STRATEGY_CONFIG, rebalanceCadence: 'daily' as const };
    expect(isRebalanceDay('2024-01-15', config)).toBe(true);
    expect(isRebalanceDay('2024-01-16', config)).toBe(true);
  });

  it('should check day of week for weekly cadence', () => {
    const config = {
      ...DEFAULT_STRATEGY_CONFIG,
      rebalanceCadence: 'weekly' as const,
      rebalanceDay: 1, // Monday
    };

    // 2024-01-15 is Monday
    expect(isRebalanceDay('2024-01-15', config)).toBe(true);
    // 2024-01-16 is Tuesday
    expect(isRebalanceDay('2024-01-16', config)).toBe(false);
  });

  it('should check day of month for monthly cadence', () => {
    const config = {
      ...DEFAULT_STRATEGY_CONFIG,
      rebalanceCadence: 'monthly' as const,
      rebalanceDay: 1,
    };

    expect(isRebalanceDay('2024-01-01', config)).toBe(true);
    expect(isRebalanceDay('2024-01-15', config)).toBe(false);
    expect(isRebalanceDay('2024-02-01', config)).toBe(true);
  });
});

describe('Zone descriptions and colors', () => {
  it('should return descriptions for all zones', () => {
    expect(getZoneDescription('accumulate')).toContain('Accumulate');
    expect(getZoneDescription('normal')).toContain('Normal');
    expect(getZoneDescription('cautious')).toContain('Cautious');
    expect(getZoneDescription('derisk')).toContain('De-risk');
    expect(getZoneDescription('defensive')).toContain('Defensive');
  });

  it('should return colors for all zones', () => {
    expect(getZoneColor('accumulate')).toMatch(/^#[0-9a-f]{6}$/i);
    expect(getZoneColor('defensive')).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

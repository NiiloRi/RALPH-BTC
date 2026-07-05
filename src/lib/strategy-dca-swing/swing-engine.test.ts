/**
 * Tests for Swing Trading Engine
 */

import { describe, it, expect } from 'vitest';
import {
  createSwingState,
  getSwingRiskZone,
  updateSwingState,
  getSwingZoneColor,
  getSwingZoneDescription,
} from './swing-engine';
import { DEFAULT_DCA_SWING_CONFIG } from './types';

describe('createSwingState', () => {
  it('should create initial state with zeroed counters', () => {
    const state = createSwingState();
    expect(state.consecutiveHighRiskDays).toBe(0);
    expect(state.consecutiveLowRiskDays).toBe(0);
    expect(state.daysSinceLastDerisk).toBe(999);
    expect(state.monthDeriskTotal).toBe(0);
  });
});

describe('getSwingRiskZone', () => {
  it('should return extreme_buy for very low risk', () => {
    expect(getSwingRiskZone(0.05)).toBe('extreme_buy');
  });

  it('should return strong_buy for low risk', () => {
    expect(getSwingRiskZone(0.15)).toBe('strong_buy');
  });

  it('should return buy for moderate-low risk', () => {
    expect(getSwingRiskZone(0.30)).toBe('buy');
  });

  it('should return neutral for middle risk', () => {
    expect(getSwingRiskZone(0.50)).toBe('neutral');
  });

  it('should return cautious for elevated risk', () => {
    expect(getSwingRiskZone(0.65)).toBe('cautious');
  });

  it('should return sell for high risk', () => {
    expect(getSwingRiskZone(0.80)).toBe('sell');
  });

  it('should return strong_sell for very high risk', () => {
    expect(getSwingRiskZone(0.90)).toBe('strong_sell');
  });
});

describe('updateSwingState', () => {
  const config = DEFAULT_DCA_SWING_CONFIG.swing;

  it('should increment consecutive high risk days', () => {
    let state = createSwingState();

    // First high risk day
    const result1 = updateSwingState(state, 0.80, '2023-01-01', config);
    expect(result1.newState.consecutiveHighRiskDays).toBe(1);

    // Second high risk day
    const result2 = updateSwingState(result1.newState, 0.82, '2023-01-02', config);
    expect(result2.newState.consecutiveHighRiskDays).toBe(2);
  });

  it('should reset consecutive days on zone change', () => {
    let state = createSwingState();
    state.consecutiveHighRiskDays = 2;

    // Low risk day
    const result = updateSwingState(state, 0.20, '2023-01-01', config);
    expect(result.newState.consecutiveHighRiskDays).toBeLessThan(2);
    expect(result.newState.consecutiveLowRiskDays).toBe(1);
  });

  it('should trigger derisk after consecutive days', () => {
    let state = createSwingState();

    // Simulate consecutive high risk days
    for (let i = 0; i < config.consecutiveDaysToTrigger; i++) {
      const result = updateSwingState(state, 0.80, `2023-01-0${i + 1}`, config);
      state = result.newState;

      if (i < config.consecutiveDaysToTrigger - 1) {
        expect(result.decision.action).toBe('NONE');
      } else {
        expect(result.decision.action).toBe('DERISK');
        expect(result.decision.percent).toBe(config.deriskPercent);
      }
    }
  });

  it('should respect cooldown period', () => {
    let state = createSwingState();
    state.daysSinceLastDerisk = 5; // Recent derisk
    state.consecutiveHighRiskDays = config.consecutiveDaysToTrigger;

    const result = updateSwingState(state, 0.80, '2023-01-01', config);
    expect(result.decision.action).toBe('NONE');
    expect(result.decision.cannotExecute).toBe('cooldown');
  });

  it('should trigger rerisk when enabled and conditions met', () => {
    let state = createSwingState();
    state.lastDeriskDate = '2022-12-01'; // Previous derisk

    // Simulate consecutive low risk days
    for (let i = 0; i < config.reriskConsecutiveDays; i++) {
      const result = updateSwingState(state, 0.20, `2023-01-0${i + 1}`, config);
      state = result.newState;

      if (i < config.reriskConsecutiveDays - 1) {
        expect(result.decision.action).toBe('NONE');
      } else {
        expect(result.decision.action).toBe('RERISK');
        expect(result.decision.percent).toBe(config.reriskPercent);
      }
    }
  });

  it('should reset monthly counter on new month', () => {
    let state = createSwingState();
    state.currentMonth = 0; // January
    state.currentYear = 2023;
    state.monthDeriskTotal = 0.25;

    // February
    const result = updateSwingState(state, 0.80, '2023-02-01', config);
    expect(result.newState.monthDeriskTotal).toBe(0);
    expect(result.newState.currentMonth).toBe(1);
  });
});

describe('getSwingZoneColor', () => {
  it('should return valid colors for all zones', () => {
    const zones = ['extreme_buy', 'strong_buy', 'buy', 'neutral', 'cautious', 'sell', 'strong_sell'] as const;

    for (const zone of zones) {
      const color = getSwingZoneColor(zone);
      expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe('getSwingZoneDescription', () => {
  it('should return descriptions for all zones', () => {
    const zones = ['extreme_buy', 'strong_buy', 'buy', 'neutral', 'cautious', 'sell', 'strong_sell'] as const;

    for (const zone of zones) {
      const desc = getSwingZoneDescription(zone);
      expect(desc).toBeTruthy();
      expect(typeof desc).toBe('string');
    }
  });
});

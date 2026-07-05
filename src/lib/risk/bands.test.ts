import { describe, it, expect } from 'vitest';
import {
  RISK_BANDS,
  RISK_ACTIONS,
  getRiskBand,
  getRiskAction,
  qualifyAction,
} from './bands';
import { getRiskLevel } from './model';

describe('RISK_BANDS structure', () => {
  it('covers [0, 1] contiguously with no gaps or overlaps', () => {
    expect(RISK_BANDS[0].min).toBe(0);
    expect(RISK_BANDS[RISK_BANDS.length - 1].max).toBe(1);
    for (let i = 1; i < RISK_BANDS.length; i++) {
      expect(RISK_BANDS[i].min).toBe(RISK_BANDS[i - 1].max);
    }
  });

  it('has strictly increasing thresholds', () => {
    for (const b of RISK_BANDS) {
      expect(b.max).toBeGreaterThan(b.min);
    }
  });
});

describe('RISK_ACTIONS structure', () => {
  it('covers [0, 1] contiguously', () => {
    expect(RISK_ACTIONS[0].min).toBe(0);
    expect(RISK_ACTIONS[RISK_ACTIONS.length - 1].max).toBe(1);
    for (let i = 1; i < RISK_ACTIONS.length; i++) {
      expect(RISK_ACTIONS[i].min).toBe(RISK_ACTIONS[i - 1].max);
    }
  });

  it('every action boundary nests inside a single band (actions can never contradict bands)', () => {
    for (const a of RISK_ACTIONS) {
      // The action's range must be fully contained in exactly one band
      const containing = RISK_BANDS.filter(b => a.min >= b.min && a.max <= b.max);
      expect(containing.length).toBe(1);
    }
  });
});

describe('getRiskBand / getRiskAction', () => {
  it('maps every risk value to exactly one band and one action', () => {
    for (let r = 0; r <= 1.0001; r += 0.01) {
      const band = getRiskBand(r);
      const action = getRiskAction(r);
      expect(band).toBeDefined();
      expect(action).toBeDefined();
      // consistency: the action must live inside the returned band
      expect(action.min).toBeGreaterThanOrEqual(band.min);
      expect(action.max).toBeLessThanOrEqual(band.max);
    }
  });

  it('agrees with model.getRiskLevel at every threshold', () => {
    for (const r of [0, 0.1, 0.19, 0.2, 0.39, 0.4, 0.42, 0.59, 0.6, 0.79, 0.8, 0.99, 1]) {
      expect(getRiskBand(r).level).toBe(getRiskLevel(r).level);
    }
  });

  it('resolves the original 42.4% contradiction: band Neutral ⇒ action Hold, not Moderate Buy', () => {
    const band = getRiskBand(0.424);
    const action = getRiskAction(0.424);
    expect(band.level).toBe('neutral');
    expect(action.text).toBe('Hold / Neutral');
  });

  it('handles out-of-range and non-finite input safely', () => {
    expect(getRiskBand(-0.5).level).toBe('low');
    expect(getRiskBand(1.5).level).toBe('high');
    expect(getRiskBand(NaN).level).toBe('neutral');
    expect(getRiskAction(Infinity).text).toBe('Hold / Neutral'); // NaN/∞ → neutral fallback
    expect(getRiskAction(-1).text).toBe('Strong Buy Zone');
  });

  it('is monotonic: higher risk never maps to a lower band', () => {
    const order = ['low', 'moderate-low', 'neutral', 'moderate-high', 'high'];
    let prevIdx = 0;
    for (let r = 0; r <= 1; r += 0.005) {
      const idx = order.indexOf(getRiskBand(r).level);
      expect(idx).toBeGreaterThanOrEqual(prevIdx);
      prevIdx = idx;
    }
  });
});

describe('qualifyAction', () => {
  it('adds no qualifier at high confidence', () => {
    expect(qualifyAction(getRiskAction(0.3), 'high').qualifier).toBeNull();
    expect(qualifyAction(getRiskAction(0.3), undefined).qualifier).toBeNull();
  });

  it('qualifies medium and low confidence', () => {
    expect(qualifyAction(getRiskAction(0.3), 'medium').qualifier).toContain('medium');
    expect(qualifyAction(getRiskAction(0.3), 'low').qualifier).toContain('low confidence');
  });
});

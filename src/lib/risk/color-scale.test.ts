import { describe, it, expect } from 'vitest';
import {
  SCALE_ANCHORS,
  riskToColor,
  riskCategory,
  riskScaleCssGradient,
  buildRiskGradientStops,
  MUTED_COLOR,
  MUTED_OPACITY,
} from './color-scale';
import { RISK_BANDS, getRiskBand } from './bands';

function hexToRgbString(hex: string): string {
  const h = hex.replace('#', '');
  return `rgb(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(
    h.slice(4, 6),
    16
  )})`;
}

describe('riskToColor', () => {
  it('matches the canonical band color exactly at every band midpoint', () => {
    // The continuous scale must never contradict the categorical chips.
    const midpoints = [0.1, 0.3, 0.5, 0.7, 0.9];
    midpoints.forEach((m, i) => {
      expect(riskToColor(m)).toBe(hexToRgbString(RISK_BANDS[i].color));
    });
  });

  it('is cool (blue-dominant) at 0 and deep red at 1', () => {
    const low = riskToColor(0).match(/\d+/g)!.map(Number);
    expect(low[2]).toBeGreaterThan(low[0]); // blue > red channel
    expect(riskToColor(1)).toBe(hexToRgbString('#991b1b'));
  });

  it('clamps out-of-range values', () => {
    expect(riskToColor(-0.5)).toBe(riskToColor(0));
    expect(riskToColor(1.5)).toBe(riskToColor(1));
  });

  it('maps non-finite input to the neutral color (bands.ts convention)', () => {
    expect(riskToColor(NaN)).toBe(riskToColor(0.5));
    expect(riskToColor(Infinity)).toBe(riskToColor(0.5));
    expect(riskToColor(-Infinity)).toBe(riskToColor(0.5));
  });

  it('progression is perceptually ordered: warms monotonically, then darkens', () => {
    // Cool→warm half: blue channel falls monotonically over [0, 0.3]
    let prevBlue = 256;
    for (let r = 0; r <= 0.3001; r += 0.02) {
      const blue = Number(riskToColor(r).match(/\d+/g)![2]);
      expect(blue).toBeLessThanOrEqual(prevBlue + 1);
      prevBlue = blue;
    }
    // Warm half: green channel falls monotonically over [0.5, 1] (yellow→red→deep red)
    let prevGreen = 256;
    for (let r = 0.5; r <= 1.0001; r += 0.02) {
      const green = Number(riskToColor(r).match(/\d+/g)![1]);
      expect(green).toBeLessThanOrEqual(prevGreen + 1);
      prevGreen = green;
    }
  });

  it('anchors are sorted and span [0,1]', () => {
    expect(SCALE_ANCHORS[0][0]).toBe(0);
    expect(SCALE_ANCHORS[SCALE_ANCHORS.length - 1][0]).toBe(1);
    for (let i = 1; i < SCALE_ANCHORS.length; i++) {
      expect(SCALE_ANCHORS[i][0]).toBeGreaterThan(SCALE_ANCHORS[i - 1][0]);
    }
  });
});

describe('riskCategory', () => {
  it('delegates to canonical bands (labels and colors cannot drift)', () => {
    expect(riskCategory(0.05)).toEqual({
      label: 'Low Risk',
      action: 'Accumulate',
      color: RISK_BANDS[0].color,
    });
    expect(riskCategory(0.95).label).toBe('High Risk');
    expect(riskCategory(0.5).label).toBe(getRiskBand(0.5).label);
  });
});

describe('riskScaleCssGradient', () => {
  it('samples the same scale (contains the exact band midpoint colors)', () => {
    const css = riskScaleCssGradient(21); // includes t=0.1..0.9 steps
    expect(css.startsWith('linear-gradient(90deg,')).toBe(true);
    expect(css).toContain(riskToColor(0.5));
    expect(css).toContain(riskToColor(0));
    expect(css).toContain(riskToColor(1));
  });
});

describe('buildRiskGradientStops', () => {
  it('returns [] for empty input and a single stop for n=1', () => {
    expect(buildRiskGradientStops([])).toEqual([]);
    const one = buildRiskGradientStops([0.42]);
    expect(one).toHaveLength(1);
    expect(one[0]).toEqual({ offset: 0, color: riskToColor(0.42), opacity: 1 });
  });

  it('offsets are monotonically non-decreasing from 0 to 1', () => {
    const risks = Array.from({ length: 500 }, (_, i) => (i % 100) / 100);
    const stops = buildRiskGradientStops(risks);
    expect(stops[0].offset).toBe(0);
    expect(stops[stops.length - 1].offset).toBe(1);
    for (let i = 1; i < stops.length; i++) {
      expect(stops[i].offset).toBeGreaterThanOrEqual(stops[i - 1].offset);
    }
  });

  it('each stop uses that observation’s own risk color (no lookahead)', () => {
    const risks = [0.1, 0.1, 0.9, 0.9];
    const stops = buildRiskGradientStops(risks);
    // first stop must be low-risk colored regardless of the future spike
    expect(stops[0].color).toBe(riskToColor(0.1));
    expect(stops[stops.length - 1].color).toBe(riskToColor(0.9));
  });

  it('downsamples below maxStops but keeps band crossings', () => {
    // 10k points, one band crossing in the middle
    const risks = Array.from({ length: 10_000 }, (_, i) => (i < 5000 ? 0.1 : 0.9));
    const stops = buildRiskGradientStops(risks, { maxStops: 300 });
    expect(stops.length).toBeLessThanOrEqual(320); // budget + mandatory points
    // crossing indices 4999/5000 must both be present
    const offsets = stops.map(s => s.offset);
    expect(offsets).toContain(4999 / 9999);
    expect(offsets).toContain(5000 / 9999);
  });

  it('marks excluded points muted and inserts a hard edge at the boundary', () => {
    const risks = [0.1, 0.1, 0.9, 0.9];
    const stops = buildRiskGradientStops(risks, { included: i => i >= 2 });
    const muted = stops.filter(s => s.color === MUTED_COLOR);
    expect(muted.length).toBeGreaterThan(0);
    for (const m of muted) expect(m.opacity).toBe(MUTED_OPACITY);
    // hard edge: two stops share the same offset with different colors
    const dup = stops.some(
      (s, i) => i > 0 && s.offset === stops[i - 1].offset && s.color !== stops[i - 1].color
    );
    expect(dup).toBe(true);
    // selected points keep full opacity + true color
    expect(stops[stops.length - 1]).toMatchObject({ color: riskToColor(0.9), opacity: 1 });
  });

  it('handles all-excluded input without throwing', () => {
    const stops = buildRiskGradientStops([0.2, 0.5, 0.8], { included: () => false });
    expect(stops.every(s => s.color === MUTED_COLOR)).toBe(true);
  });

  it('keeps stop count bounded on the full historical dataset size', () => {
    const risks = Array.from({ length: 5500 }, (_, i) => 0.5 + 0.4 * Math.sin(i / 60));
    const stops = buildRiskGradientStops(risks, { maxStops: 1200 });
    expect(stops.length).toBeLessThanOrEqual(1400); // budget + crossings margin
    expect(stops.length).toBeGreaterThan(100);
  });
});

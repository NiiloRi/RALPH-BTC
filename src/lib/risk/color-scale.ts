/**
 * SHARED risk→color scale — the single mapping used by the risk-colored price
 * curve, the chart risk legend, tooltip chips, and filter styling.
 *
 * Anchored to the canonical RISK_BANDS colors at each band's MIDPOINT so the
 * continuous scale can never contradict the categorical band chips used
 * elsewhere (gauge, legend, verdict). Below the low band's midpoint the ramp
 * cools into a deep teal-blue: it reads "very low risk" intuitively on a dark
 * background and adds a lightness step that helps common red-green color
 * deficiencies at the accumulation end. Risk semantics come from bands.ts —
 * this module only interpolates presentation colors between those anchors.
 *
 * Purely presentational: no analytical logic, no data transformation.
 */

import { RISK_BANDS, getRiskBand } from './bands';

/** [risk in 0..1, hex color] — band-midpoint anchors + cool low end / deep top */
export const SCALE_ANCHORS: ReadonlyArray<readonly [number, string]> = [
  [0.0, '#0e7490'], // deep cool teal-blue — very low risk
  [0.1, RISK_BANDS[0].color], // #22c55e green   — Low Risk midpoint
  [0.3, RISK_BANDS[1].color], // #84cc16 lime    — Moderate-Low midpoint
  [0.5, RISK_BANDS[2].color], // #eab308 yellow  — Neutral midpoint
  [0.7, RISK_BANDS[3].color], // #f97316 orange  — Moderate-High midpoint
  [0.9, RISK_BANDS[4].color], // #dc2626 red     — High Risk midpoint
  [1.0, '#991b1b'], // controlled deep red — extreme
];

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/**
 * Continuous risk→color mapping (linear RGB interpolation between anchors).
 * Non-finite input maps to the neutral anchor (0.5) — same convention as
 * bands.getRiskBand.
 */
export function riskToColor(risk: number): string {
  const r = Number.isFinite(risk) ? clamp01(risk) : 0.5;
  for (let i = 1; i < SCALE_ANCHORS.length; i++) {
    const [x1, c1] = SCALE_ANCHORS[i - 1];
    const [x2, c2] = SCALE_ANCHORS[i];
    if (r <= x2) {
      const t = x2 === x1 ? 0 : (r - x1) / (x2 - x1);
      const [r1, g1, b1] = hexToRgb(c1);
      const [r2, g2, b2] = hexToRgb(c2);
      return `rgb(${Math.round(r1 + (r2 - r1) * t)}, ${Math.round(
        g1 + (g2 - g1) * t
      )}, ${Math.round(b1 + (b2 - b1) * t)})`;
    }
  }
  return SCALE_ANCHORS[SCALE_ANCHORS.length - 1][1];
}

/** Category label + band color for tooltips/chips (delegates to bands.ts). */
export function riskCategory(risk: number): { label: string; action: string; color: string } {
  const band = getRiskBand(risk);
  return { label: band.label, action: band.action, color: band.color };
}

/**
 * CSS linear-gradient stop list sampled from the SAME scale — used by the
 * horizontal risk-legend bar so legend and curve can never diverge.
 */
export function riskScaleCssGradient(samples = 21): string {
  const stops: string[] = [];
  for (let i = 0; i < samples; i++) {
    const t = i / (samples - 1);
    stops.push(`${riskToColor(t)} ${Math.round(t * 100)}%`);
  }
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

// ---- SVG gradient stops for the risk-colored price curve ---------------------

export interface GradientStop {
  /** 0..1 position along the x extent (category axis → i/(n-1) is exact) */
  offset: number;
  color: string;
  opacity: number;
}

/** Muted appearance for observations outside the active risk filter. */
export const MUTED_COLOR = 'rgb(110, 112, 118)';
export const MUTED_OPACITY = 0.3;

/**
 * Build SVG linearGradient stops for a price line colored by per-observation
 * risk. Each stop uses ONLY that observation's own risk value (no lookahead;
 * SVG interpolates linearly between adjacent stops, i.e. between neighboring
 * observations' colors).
 *
 * `included(i)` marks points inside the active risk filter; excluded points
 * render muted (gray, low opacity) so the historical trajectory stays visible
 * without implying selection. Inclusion boundaries insert paired stops at the
 * midpoint between neighbors so the muted region does not bleed into the
 * selected one.
 *
 * Downsampling: at most ~maxStops evenly-strided samples, ALWAYS keeping the
 * first/last points, every band crossing, and every filter-inclusion edge —
 * risk transitions stay visible at full-history zoom levels.
 */
export function buildRiskGradientStops(
  risks: ReadonlyArray<number>,
  options: {
    included?: (index: number) => boolean;
    maxStops?: number;
  } = {}
): GradientStop[] {
  const n = risks.length;
  if (n === 0) return [];
  const { included, maxStops = 1200 } = options;

  if (n === 1) {
    const inc = included ? included(0) : true;
    return [
      {
        offset: 0,
        color: inc ? riskToColor(risks[0]) : MUTED_COLOR,
        opacity: inc ? 1 : MUTED_OPACITY,
      },
    ];
  }

  // Indices we must keep: ends, band crossings, filter edges.
  const keep = new Set<number>([0, n - 1]);
  let prevBand = getRiskBand(risks[0]).level;
  let prevInc = included ? included(0) : true;
  for (let i = 1; i < n; i++) {
    const b = getRiskBand(risks[i]).level;
    if (b !== prevBand) {
      keep.add(i - 1);
      keep.add(i);
      prevBand = b;
    }
    const inc = included ? included(i) : true;
    if (inc !== prevInc) {
      keep.add(i - 1);
      keep.add(i);
      prevInc = inc;
    }
  }

  // Even stride to fill the budget left after mandatory points.
  const stride = Math.max(1, Math.ceil(n / Math.max(2, maxStops - keep.size)));
  const indices: number[] = [];
  for (let i = 0; i < n; i += stride) indices.push(i);
  for (const k of keep) indices.push(k);
  const sorted = Array.from(new Set(indices)).sort((a, b) => a - b);

  const stops: GradientStop[] = [];
  let lastInc: boolean | null = null;
  for (const i of sorted) {
    const offset = i / (n - 1);
    const inc = included ? included(i) : true;

    // Hard edge between muted and selected regions: duplicate the boundary
    // offset midway so SVG does not smear the two states into each other.
    if (lastInc !== null && inc !== lastInc && stops.length > 0) {
      const prev = stops[stops.length - 1];
      const mid = (prev.offset + offset) / 2;
      stops.push({ offset: mid, color: prev.color, opacity: prev.opacity });
      stops.push({
        offset: mid,
        color: inc ? riskToColor(risks[i]) : MUTED_COLOR,
        opacity: inc ? 1 : MUTED_OPACITY,
      });
    }

    stops.push({
      offset,
      color: inc ? riskToColor(risks[i]) : MUTED_COLOR,
      opacity: inc ? 1 : MUTED_OPACITY,
    });
    lastInc = inc;
  }
  return stops;
}

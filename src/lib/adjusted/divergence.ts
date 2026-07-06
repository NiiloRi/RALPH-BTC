/**
 * LAYER 3 — DIVERGENCE / CONFIDENCE STATE
 *
 * Names the interpretive state of the day instead of a bare dispersion
 * number, so the action label can be qualified honestly. Every day maps to
 * exactly ONE primary state (priority-ordered below); secondary numeric
 * signals are also returned for the UI.
 *
 * States (priority order):
 *   1. clock-vs-price  — cycle timing high but price-derived risk low
 *                        (the current situation: cycle 83% vs valuation 32%)
 *   2. price-vs-clock  — price stretched but cycle clock early
 *   3. layers-diverge  — |L1 − L0| > 0.25 (compression gap is large)
 *   4. data-degraded   — input completeness < 0.95 (neutral fallbacks present)
 *   5. aligned         — none of the above
 *
 * Read-only: consumes Layer-0 / Layer-1 outputs and completeness; changes
 * nothing.
 */

import type { ComponentKey } from './cycle-adjusted';

export type DivergenceState =
  | 'aligned'
  | 'clock-vs-price'
  | 'price-vs-clock'
  | 'layers-diverge'
  | 'data-degraded';

/** cycle ≥ this counts as "clock says late" */
export const CLOCK_HIGH = 0.65;
/** cycle ≤ this counts as "clock says early" */
export const CLOCK_LOW = 0.35;
/** avg(valuation, momentum) ≤ this counts as "price says cheap" */
export const PRICE_LOW = 0.40;
/** avg(valuation, momentum) ≥ this counts as "price says stretched" */
export const PRICE_HIGH = 0.60;
/** |L1 − L0| beyond this is a layer divergence */
export const LAYER_GAP = 0.25;
/** completeness below this is degraded */
export const COMPLETENESS_MIN = 0.95;

export interface DivergenceInput {
  /** Layer-0 absolute risk (smoothed) */
  absolute: number;
  /** Layer-1 cycle-adjusted risk, or null during burn-in */
  adjusted: number | null;
  components: Record<ComponentKey, number>;
  /** Fraction of inputs backed by real data (1 = all live) */
  dataCompleteness?: number;
}

export interface DivergenceResult {
  state: DivergenceState;
  /** One-sentence explanation for display */
  explanation: string;
  /** Short qualifier to append to an action label, or null when aligned */
  actionQualifier: string | null;
  /** L1 − L0 (null during burn-in) */
  layerGap: number | null;
  /** cycle − avg(valuation, momentum): positive = clock hotter than price */
  cycleVsPriceGap: number;
  dataCompleteness: number;
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

/**
 * Classify one day. Priority order resolves overlaps to exactly one state.
 */
export function classifyDivergence(input: DivergenceInput): DivergenceResult {
  const { absolute, adjusted, components } = input;
  const completeness = Math.min(1, Math.max(0, input.dataCompleteness ?? 1));

  const cycle = components.cycle;
  const priceLens = (components.valuation + components.momentum) / 2;
  const cycleVsPriceGap = cycle - priceLens;
  const layerGap = adjusted === null ? null : adjusted - absolute;

  const base = {
    layerGap,
    cycleVsPriceGap,
    dataCompleteness: completeness,
  };

  // 1. clock-vs-price
  if (cycle >= CLOCK_HIGH && priceLens <= PRICE_LOW) {
    return {
      ...base,
      state: 'clock-vs-price',
      explanation:
        `Clock vs price: cycle timing is late (${pct(cycle)}) while price-derived risk is low ` +
        `(valuation ${pct(components.valuation)}, momentum ${pct(components.momentum)}). ` +
        `Historically this state resolved slowly — lean on the price lens for entries.`,
      actionQualifier: 'cycle-vs-price divergence',
    };
  }

  // 2. price-vs-clock
  if (cycle <= CLOCK_LOW && priceLens >= PRICE_HIGH) {
    return {
      ...base,
      state: 'price-vs-clock',
      explanation:
        `Price vs clock: price looks stretched (valuation ${pct(components.valuation)}, ` +
        `momentum ${pct(components.momentum)}) but the cycle clock is early (${pct(cycle)}). ` +
        `Momentum can extend — don't assume safety from cycle timing alone.`,
      actionQualifier: 'price-vs-cycle divergence',
    };
  }

  // 3. layers-diverge
  if (layerGap !== null && Math.abs(layerGap) > LAYER_GAP) {
    const dir = layerGap > 0 ? 'higher' : 'lower';
    return {
      ...base,
      state: 'layers-diverge',
      explanation:
        `Cycle-adjusted risk is ${Math.round(Math.abs(layerGap) * 100)}pp ${dir} than the ` +
        `absolute score — this cycle's amplitude compression is large. Read both numbers, not one.`,
      actionQualifier: `absolute/adjusted gap ${Math.round(Math.abs(layerGap) * 100)}pp`,
    };
  }

  // 4. data-degraded
  if (completeness < COMPLETENESS_MIN) {
    return {
      ...base,
      state: 'data-degraded',
      explanation:
        `Inputs incomplete (${pct(completeness)} complete) — some components are neutral ` +
        `fallbacks (e.g. macro without FRED data). Treat the score as provisional.`,
      actionQualifier: 'incomplete data',
    };
  }

  // 5. aligned
  return {
    ...base,
    state: 'aligned',
    explanation: 'Layers and components broadly agree — no divergence caveat.',
    actionQualifier: null,
  };
}

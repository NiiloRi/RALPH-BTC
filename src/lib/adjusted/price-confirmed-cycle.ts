/**
 * ROUND 4 — PRICE-CONFIRMED CYCLE (Layer 1 input substitution)
 *
 * WHY: the base cycle component is a pure TIME clock. It read 27% at the
 * actual Jan-2025 top (which came ~275 days post-halving, before the clock's
 * 480-day peak window) — the sole reason Layer 1 read only 75% there vs
 * 92–94% at the 2017/2021 tops (docs/cycle-adjusted-risk.md §12, §14).
 *
 * FIX: combine the clock with the round-3 Top Proximity signal as two
 * independent pieces of late-cycle evidence (noisy-OR):
 *
 *   cycleV4 = cycle + (1 − cycle) · topProximity
 *
 * OR only ever RAISES the clock when price independently confirms top-like
 * conditions; it never lowers it. Where topProximity = 0 (today at −49% off
 * ATH, every bear market, every bottom window) cycleV4 ≡ cycle and Layer 1 is
 * unchanged — this structurally avoids §13's rejected hard gating (which
 * zeroed the maturity information and dropped today's L1 to ~15%).
 * Zero new tunable parameters.
 *
 * SCOPE / INVARIANTS:
 * - Used ONLY inside Layer 1's recomposition, via input substitution — the
 *   calculateAllCycleAdjusted core and frozen Layer 0 are untouched.
 * - The divergence classifier must keep consuming the RAW cycle: its job is
 *   precisely to name the clock-vs-price state that this module papers over.
 * - Walk-forward safe: topProximity uses a causal running ATH; the combine is
 *   pointwise. Truncation invariance is asserted in cycle-adjusted-v4.test.ts.
 *
 * HONEST COST (pre-declared in §14): an intermediate ATH ≥ 700 days after the
 * cycle low (Dec-2020, 11 months before the real top) lifts cycleV4 toward
 * ~1.0 early. Measured and reported as a finding, not bounded.
 */

import { calculateAllTopProximity, defaultCycleLowDates } from './top-proximity';
import type { AdjustedInput } from './cycle-adjusted';

/** Pointwise combiner: (cycle clock, top proximity) → cycleV4 */
export type CycleCombiner = (cycle: number, topProximity: number) => number;

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/**
 * Noisy-OR of two independent late-cycle evidence sources.
 * Commutative, monotone in both args, ≥ max(c, p), identity at p = 0,
 * saturates at 1. Non-finite cycle passes through unchanged so the core's
 * own `!isFinite → 0.5` guard (cycle-adjusted.ts) stays in charge.
 */
export function noisyOr(cycle: number, topProximity: number): number {
  if (!Number.isFinite(cycle)) return cycle;
  const c = clamp01(cycle);
  const p = Number.isFinite(topProximity) ? clamp01(topProximity) : 0;
  return c + (1 - c) * p;
}

/** Documented one-line alternative combiner (§14). Same guards as noisyOr. */
export function hardMax(cycle: number, topProximity: number): number {
  if (!Number.isFinite(cycle)) return cycle;
  const p = Number.isFinite(topProximity) ? clamp01(topProximity) : 0;
  return Math.max(clamp01(cycle), p);
}

/** ACTIVE combiner for the shipped composition — swap in ONE place only. */
export const COMBINE: CycleCombiner = noisyOr;

export interface PriceConfirmedOptions {
  /** Cycle-low anchor dates, forwarded to calculateAllTopProximity */
  lowDates?: string[];
  /** Combiner override (defaults to COMBINE) */
  combiner?: CycleCombiner;
}

/**
 * Returns a NEW AdjustedInput[] with components.cycle replaced by
 * combiner(cycle, topProximity(date)). Everything else is copied unchanged;
 * inputs are never mutated.
 *
 * Semantics:
 * - Price rows with a non-finite or non-positive price are dropped BEFORE the
 *   top-proximity pass (a non-finite price with ath > 0 would read drawdown 0
 *   → priceProx 1 inside calculateAllTopProximity — a spurious top signal).
 * - Prices are defensively sorted ascending by date (the running ATH assumes
 *   ascending order and would silently corrupt otherwise).
 * - A risk date with no surviving price row gets p = 0 → raw-cycle
 *   passthrough (conservative and causal).
 */
export function applyPriceConfirmedCycle(
  risks: AdjustedInput[],
  prices: { date: string; price: number }[],
  options: PriceConfirmedOptions = {}
): AdjustedInput[] {
  if (risks.length === 0) return [];

  const combiner = options.combiner ?? COMBINE;
  const lowDates = options.lowDates ?? defaultCycleLowDates();

  const cleanPrices = prices
    .filter(
      p => typeof p.date === 'string' && Number.isFinite(p.price) && p.price > 0
    )
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const proxByDate = new Map<string, number>();
  if (cleanPrices.length > 0) {
    for (const r of calculateAllTopProximity(cleanPrices, lowDates)) {
      proxByDate.set(r.date, r.value);
    }
  }

  return risks.map(r => ({
    ...r,
    components: {
      ...r.components,
      cycle: combiner(r.components.cycle, proxByDate.get(r.date) ?? 0),
    },
  }));
}

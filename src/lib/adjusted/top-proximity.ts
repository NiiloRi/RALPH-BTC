/**
 * CYCLE TOP PROXIMITY — "how close are we to a cycle price top, right now?"
 *
 * WHY THIS EXISTS: the base cycle component is a pure TIME clock. It conflates
 * "the cycle is mature" (many days since the low) with "we are near the top".
 * Those decoupled badly this cycle: the clock read 19% at the actual Jan-2025
 * top (which came early, before its peak window) and reads ~83% now — 18
 * months AFTER the top, with price 40%+ below its high. For a "when are we
 * near the top?" question the clock is worse than useless.
 *
 * Top Proximity answers that question directly and is dominated by the single
 * most honest fact about a top: at a top, price is AT its all-time high
 * (drawdown ≈ 0). It never touches the absolute score (Layer 0) — fed raw
 * into a score it would fire on every intermediate ATH, not just the final
 * one. Since round 4 it price-confirms the cycle clock inside Layer 1 via
 * price-confirmed-cycle.ts (noisy-OR — it can only RAISE the clock, and the
 * intermediate-ATH cost is measured and documented in §14). It also sits
 * beside the score as decision context.
 *
 *   priceProx = clamp(1 − drawdownFromATH / DD_REF, 0, 1)   // dominant term
 *   season    = clamp(daysSinceLow / MIN_TOP_DAYS, 0, 1)    // tops form ≥~2y
 *   topProximity = priceProx × season
 *
 * WALK-FORWARD SAFE: ATH is a running max over past closes; daysSinceLow uses
 * the most recent cycle low ON OR BEFORE the date (each was confirmed within
 * months of occurring). No future data.
 *
 * HONEST LIMITATION: near ANY all-time high in the top half of a cycle this
 * reads high — an intermediate ATH (e.g. Dec-2020, ~11 months before the
 * Nov-2021 top) is indistinguishable in real time from the final one. Top
 * Proximity measures "how top-LIKE conditions are", not "this is THE top".
 */

import { HISTORICAL_CYCLES } from '../features/cycle';

/** Drawdown at/beyond this fraction below ATH ⇒ not near a top (priceProx 0) */
export const DD_REF = 0.35;
/** A cycle top forms no sooner than ~2 years after the cycle low */
export const MIN_TOP_DAYS = 700;

export interface TopProximityResult {
  date: string;
  /** 0..1 — how top-like conditions are */
  value: number;
  /** Price-confirmation term (near ATH → 1) */
  priceProx: number;
  /** Cycle-season term (enough time since the low → 1) */
  season: number;
  /** Drawdown from the running (known-at-the-time) all-time high */
  drawdownFromATH: number;
  daysSinceLow: number;
}

const MS_PER_DAY = 86_400_000;

/** Default cycle-low anchor dates (confirmed lows from HISTORICAL_CYCLES). */
export function defaultCycleLowDates(): string[] {
  return HISTORICAL_CYCLES.map(c => c.lowDate).sort();
}

/** Days since the most recent cycle low on or before `date` (0 if none yet). */
export function daysSinceCycleLow(date: string, lowDates: string[]): number {
  let latest: string | null = null;
  for (const d of lowDates) {
    if (d <= date && (latest === null || d > latest)) latest = d;
  }
  if (latest === null) return 0;
  return Math.max(0, (new Date(date).getTime() - new Date(latest).getTime()) / MS_PER_DAY);
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

/**
 * Top Proximity for the whole series. Running ATH makes it causal.
 * @param series ascending {date, price}
 * @param lowDates cycle-low anchor dates (defaults to HISTORICAL_CYCLES)
 */
export function calculateAllTopProximity(
  series: { date: string; price: number }[],
  lowDates: string[] = defaultCycleLowDates()
): TopProximityResult[] {
  const out: TopProximityResult[] = [];
  let ath = 0;
  for (const point of series) {
    const price = point.price;
    if (Number.isFinite(price) && price > ath) ath = price;
    const drawdown = ath > 0 && Number.isFinite(price) ? (ath - price) / ath : 0;

    const priceProx = clamp01(1 - drawdown / DD_REF);
    const dsl = daysSinceCycleLow(point.date, lowDates);
    const season = clamp01(dsl / MIN_TOP_DAYS);
    const value = clamp01(priceProx * season);

    out.push({
      date: point.date,
      value,
      priceProx,
      season,
      drawdownFromATH: drawdown,
      daysSinceLow: dsl,
    });
  }
  return out;
}

/** Human label for a Top Proximity value. */
export function topProximityLabel(value: number): string {
  if (value >= 0.8) return 'near a cycle top';
  if (value >= 0.5) return 'top-like conditions building';
  if (value >= 0.2) return 'off the highs';
  return 'far from a top';
}

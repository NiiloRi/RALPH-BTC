/**
 * SCENARIO ENSEMBLE — the Blockworks report's "Path Forward" construction.
 *
 * Each ensemble path takes BTC's realized 3-year weekly log-trajectory after
 * one of the COMPLETED NAS100/BTC relative-strength episodes (the report's
 * anchor signal; historically Feb-2015, Feb-2019, Aug-2022), scales it down
 * by a strength factor s ∈ [0.33, 0.80] (cycle-over-cycle return
 * compression), and replays it from today's price:
 *
 *   path(w) = P_now · exp( s · ln(P(anchor + w·week) / P(anchor)) )
 *
 * Weekly percentile bands (10/25/75/90) across all paths form the fan.
 *
 * HONESTY (the report's own words apply): these are scaled-down replays of
 * historical post-signal paths, ALL of which resolved favorably. They
 * describe what a repetition of history would look like — they contain NO
 * distribution for a failed signal, and are not a prediction.
 */

import {
  weeklyCloses,
  ratioRsiMa,
  findEpisodes,
  type Point,
} from './cycle-low-radar';

const MS_PER_WEEK = 7 * 86_400_000;

/** Report: "scaled down at various strengths between 0.33 - 0.80" */
export const DEFAULT_STRENGTHS = [0.33, 0.4, 0.5, 0.6, 0.7, 0.8];
export const DEFAULT_HORIZON_WEEKS = 156; // 3 years

export interface EnsembleBands {
  date: string;
  p10: number;
  p25: number;
  p75: number;
  p90: number;
}

export interface ScenarioEnsemble {
  /** completed-episode anchor dates the paths replay from */
  anchors: string[];
  pathCount: number;
  /**
   * The FIXED point the ensemble is anchored at. When a NAS100/BTC episode is
   * active, this is its first weekly close >= threshold — the same marking
   * rule the report uses for its forward-return tables. The anchor does not
   * move as new data arrives, so the realized price advances INTO the bands
   * and projection tracking can be studied. Fallback (no active episode):
   * the latest observation.
   */
  anchorDate: string;
  anchorPrice: number;
  anchorType: 'active-episode' | 'latest';
  /** weekly bands from the anchor (w=0, all == anchorPrice) forward */
  bands: EnsembleBands[];
}

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function buildScenarioEnsemble(
  btcDaily: Point[],
  nasWeekly: Point[],
  options: {
    threshold?: number;
    strengths?: number[];
    horizonWeeks?: number;
  } = {}
): ScenarioEnsemble | null {
  const {
    threshold = 66,
    strengths = DEFAULT_STRENGTHS,
    horizonWeeks = DEFAULT_HORIZON_WEEKS,
  } = options;

  const btcWeekly = weeklyCloses(btcDaily);
  if (btcWeekly.length < horizonWeeks + 60) return null;

  // Episodes on the NAS100/BTC RSI-MA: completed ones supply the replayed
  // trajectories; an ACTIVE one supplies the fixed anchor point.
  const rsiMa = ratioRsiMa(nasWeekly, btcWeekly);
  const allEpisodes = findEpisodes(rsiMa, threshold);
  const completed = allEpisodes.filter(e => !e.active);
  const active = allEpisodes.find(e => e.active);
  if (completed.length === 0) return null;

  // Historical weekly log-trajectories from each anchor, full horizon required
  const trajectories: number[][] = [];
  const anchors: string[] = [];
  for (const ep of completed) {
    const startIdx = btcWeekly.findIndex(p => p.date >= ep.start);
    if (startIdx < 0 || startIdx + horizonWeeks >= btcWeekly.length) continue;
    const base = btcWeekly[startIdx].value;
    const traj: number[] = [];
    for (let w = 0; w <= horizonWeeks; w++) {
      traj.push(Math.log(btcWeekly[startIdx + w].value / base));
    }
    trajectories.push(traj);
    anchors.push(ep.start);
  }
  if (trajectories.length === 0) return null;

  // Fixed anchor: the active episode's first weekly close >= threshold,
  // else the latest observation (previous behavior).
  let anchorIdx = btcWeekly.length - 1;
  let anchorType: ScenarioEnsemble['anchorType'] = 'latest';
  if (active) {
    const idx = btcWeekly.findIndex(p => p.date >= active.start);
    if (idx >= 0) {
      anchorIdx = idx;
      anchorType = 'active-episode';
    }
  }
  const anchor = btcWeekly[anchorIdx];
  const anchorMs = new Date(anchor.date).getTime();
  const lastIdx = btcWeekly.length - 1;

  const bands: EnsembleBands[] = [];
  for (let w = 0; w <= horizonWeeks; w++) {
    const values: number[] = [];
    for (const traj of trajectories) {
      for (const s of strengths) {
        values.push(anchor.value * Math.exp(s * traj[w]));
      }
    }
    values.sort((a, b) => a - b);
    // Elapsed weeks reuse the ACTUAL weekly-close dates so the realized price
    // rows join the band rows exactly; future weeks step by calendar weeks.
    const date =
      anchorIdx + w <= lastIdx
        ? btcWeekly[anchorIdx + w].date
        : new Date(anchorMs + w * MS_PER_WEEK).toISOString().split('T')[0];
    bands.push({
      date,
      p10: quantile(values, 0.1),
      p25: quantile(values, 0.25),
      p75: quantile(values, 0.75),
      p90: quantile(values, 0.9),
    });
  }

  return {
    anchors,
    pathCount: trajectories.length * strengths.length,
    anchorDate: anchor.date,
    anchorPrice: anchor.value,
    anchorType,
    bands,
  };
}

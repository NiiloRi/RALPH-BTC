/**
 * CYCLE LOW RADAR — a basket of high-timeframe cycle-low condition signals,
 * recreating the methodology of the Blockworks research note (Luke Leasure /
 * @0xMether, Jul 2026):
 *
 *  1. NAS100/BTC relative strength: 14-week Wilder RSI of the weekly ratio,
 *     smoothed with a 14-week SMA. Readings > 65–70 are tail events that have
 *     historically coincided with BTC high-timeframe lows (BTC maximally
 *     oversold vs the Nasdaq).
 *  2. Gold/BTC relative strength: identical construction on the Gold/BTC ratio.
 *  3. Realized price: BTC spot vs the aggregate onchain cost basis. Every
 *     historical bear low traded below realized price; only ~12% of history
 *     has spot below it.
 *  4. Cycle drawdown clock: drawdown by weeks-from-ATH vs the 2013/2017/2021
 *     paths — historical troughs were set by week 60.
 *
 * All display-layer, descriptive statistics recomputed from data on load —
 * no trading logic, no changes to the frozen risk model. The source report's
 * own limitations apply and are surfaced in the UI: n ≈ 3–4 episodes, the
 * signals are NOT independent (all largely measure "BTC fell hard and long"),
 * and the four-year-cycle framing may be a narrative fitted to few samples.
 */

import { HISTORICAL_PEAKS } from '../features/cycle';

const MS_PER_DAY = 86_400_000;
const MS_PER_WEEK = 7 * MS_PER_DAY;

export interface Point {
  date: string;
  value: number;
}

// ---- series primitives -------------------------------------------------------

/** Last observation per calendar week (Monday-anchored bins). */
export function weeklyCloses(daily: Point[]): Point[] {
  const byWeek = new Map<number, Point>();
  for (const p of daily) {
    if (!Number.isFinite(p.value) || p.value <= 0) continue;
    const t = new Date(p.date).getTime();
    if (!Number.isFinite(t)) continue;
    // 1970-01-05 was a Monday → Monday-aligned week index
    const week = Math.floor((t - 4 * MS_PER_DAY) / MS_PER_WEEK);
    const prev = byWeek.get(week);
    if (!prev || prev.date < p.date) byWeek.set(week, p);
  }
  return Array.from(byWeek.values()).sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** Wilder's RSI (the standard smoothed RSI). Output aligned to input[period..]. */
export function wilderRsi(values: number[], period = 14): number[] {
  if (values.length <= period) return [];
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  const out: number[] = [rsiFrom(avgGain, avgLoss)];
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(0, d)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -d)) / period;
    out.push(rsiFrom(avgGain, avgLoss));
  }
  return out;
}

function rsiFrom(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

/** Simple moving average; output aligned to input[n-1..]. */
export function sma(values: number[], n: number): number[] {
  if (values.length < n) return [];
  const out: number[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= n) sum -= values[i - n];
    if (i >= n - 1) out.push(sum / n);
  }
  return out;
}

/**
 * The report's core construction: weekly ratio numerator/denominator on
 * common weeks → 14-week Wilder RSI → 14-week SMA. Elevated = numerator
 * overbought vs denominator = denominator (BTC) oversold.
 */
export function ratioRsiMa(
  numerator: Point[],
  denominator: Point[],
  rsiPeriod = 14,
  maPeriod = 14
): Point[] {
  const denomByDate = new Map(denominator.map(p => [weekKey(p.date), p.value]));
  const ratio: Point[] = [];
  for (const p of numerator) {
    const d = denomByDate.get(weekKey(p.date));
    if (d !== undefined && d > 0 && p.value > 0) ratio.push({ date: p.date, value: p.value / d });
  }
  const rsi = wilderRsi(ratio.map(r => r.value), rsiPeriod);
  const smoothed = sma(rsi, maPeriod);
  const offset = ratio.length - smoothed.length;
  return smoothed.map((v, i) => ({ date: ratio[offset + i].date, value: v }));
}

function weekKey(date: string): number {
  return Math.floor((new Date(date).getTime() - 4 * MS_PER_DAY) / MS_PER_WEEK);
}

// ---- episode statistics --------------------------------------------------------

export interface Episode {
  start: string;
  end: string;
  weeks: number;
  peak: number;
  /** true when the episode extends to the last observation */
  active: boolean;
}

/** Contiguous runs where value >= threshold. */
export function findEpisodes(series: Point[], threshold: number): Episode[] {
  const out: Episode[] = [];
  let current: { start: string; end: string; weeks: number; peak: number } | null = null;
  for (const p of series) {
    if (p.value >= threshold) {
      if (!current) current = { start: p.date, end: p.date, weeks: 1, peak: p.value };
      else {
        current.end = p.date;
        current.weeks++;
        current.peak = Math.max(current.peak, p.value);
      }
    } else if (current) {
      out.push({ ...current, active: false });
      current = null;
    }
  }
  if (current) out.push({ ...current, active: true });
  return out;
}

/** Fraction of observations at or above threshold. */
export function pctTimeAbove(series: Point[], threshold: number): number {
  if (series.length === 0) return 0;
  return series.filter(p => p.value >= threshold).length / series.length;
}

// ---- realized price -------------------------------------------------------------

export interface RealizedStats {
  spotNow: number;
  realizedNow: number;
  /** spot / realized (multiple; < 1 = spot below cost basis) */
  multiple: number;
  /** fraction of joined history with spot below realized price */
  pctHistoryBelow: number;
  /** joined daily rows for charting */
  joined: { date: string; spot: number; realized: number }[];
}

/** Forward-fill realized price onto spot dates (realized updates daily anyway). */
export function realizedPriceStats(
  spotDaily: Point[],
  realizedDaily: Point[]
): RealizedStats | null {
  const valid = realizedDaily.filter(p => p.value > 0);
  if (valid.length === 0 || spotDaily.length === 0) return null;
  const joined: RealizedStats['joined'] = [];
  let j = -1;
  let below = 0;
  for (const p of spotDaily) {
    while (j + 1 < valid.length && valid[j + 1].date <= p.date) j++;
    if (j < 0 || !Number.isFinite(p.value) || p.value <= 0) continue;
    joined.push({ date: p.date, spot: p.value, realized: valid[j].value });
    if (p.value < valid[j].value) below++;
  }
  if (joined.length === 0) return null;
  const last = joined[joined.length - 1];
  return {
    spotNow: last.spot,
    realizedNow: last.realized,
    multiple: last.spot / last.realized,
    pctHistoryBelow: below / joined.length,
    joined,
  };
}

// ---- cycle drawdown clock ---------------------------------------------------------

export interface CyclePath {
  label: string;
  athDate: string;
  /** drawdown (fraction, >= 0) per week since ATH; index = week */
  drawdownByWeek: number[];
}

export interface CycleClock {
  current: CyclePath;
  priors: CyclePath[];
  weeksSinceATH: number;
  drawdownNow: number;
  /** report's empirical bound: prior troughs were set by week 60 from ATH */
  week60Date: string;
}

/** Max drawdown-to-date per week following each ATH (from our own history). */
function pathFrom(prices: Point[], athDate: string, weeks: number, label: string): CyclePath {
  const athMs = new Date(athDate).getTime();
  const athIdx = prices.findIndex(p => p.date >= athDate);
  const athPrice = athIdx >= 0 ? prices[athIdx].value : NaN;
  const drawdownByWeek: number[] = [];
  let minSoFar = athPrice;
  let i = athIdx;
  for (let w = 0; w <= weeks; w++) {
    const cutoff = athMs + w * MS_PER_WEEK;
    while (i < prices.length && new Date(prices[i].date).getTime() <= cutoff) {
      minSoFar = Math.min(minSoFar, prices[i].value);
      i++;
    }
    if (i >= prices.length && new Date(prices[prices.length - 1].date).getTime() < cutoff) break;
    drawdownByWeek.push(athPrice > 0 ? 1 - minSoFar / athPrice : 0);
  }
  return { label, athDate, drawdownByWeek };
}

export function cycleClock(prices: Point[], maxWeeks = 110): CycleClock | null {
  if (prices.length < 100) return null;

  // Current-cycle ATH = argmax over the whole series
  let athIdx = 0;
  for (let i = 1; i < prices.length; i++) {
    if (prices[i].value > prices[athIdx].value) athIdx = i;
  }
  const athDate = prices[athIdx].date;
  const lastDate = prices[prices.length - 1].date;
  const weeksSinceATH = Math.floor(
    (new Date(lastDate).getTime() - new Date(athDate).getTime()) / MS_PER_WEEK
  );

  const current = pathFrom(prices, athDate, weeksSinceATH, 'current');
  const priors = HISTORICAL_PEAKS
    // our price history starts 2011 — the 2011 peak lacks pre-history context
    .filter(p => p.getFullYear() >= 2013)
    .map(p => {
      const d = p.toISOString().split('T')[0];
      return pathFrom(prices, d, maxWeeks, String(p.getFullYear()));
    })
    .filter(p => p.drawdownByWeek.length > 10);

  return {
    current,
    priors,
    weeksSinceATH,
    drawdownNow: 1 - prices[prices.length - 1].value / prices[athIdx].value,
    week60Date: new Date(new Date(athDate).getTime() + 60 * MS_PER_WEEK)
      .toISOString()
      .split('T')[0],
  };
}

// ---- composite -----------------------------------------------------------------

export interface RadarSignal {
  key: 'nasdaq' | 'gold' | 'realized' | 'clock';
  label: string;
  /** human-readable current reading */
  reading: string;
  /** signal in its historical tail zone */
  inTail: boolean;
  detail: string;
}

export interface RadarResult {
  nas: { series: Point[]; current: number; pctAbove65: number; pctAbove70: number; episodes: Episode[] };
  gold: { series: Point[]; current: number; pctAbove65: number; pctAbove70: number; episodes: Episode[] };
  realized: RealizedStats;
  clock: CycleClock;
  signals: RadarSignal[];
}

export function computeRadar(
  btcDaily: Point[],
  ndxWeekly: Point[],
  goldWeekly: Point[],
  realizedDaily: Point[]
): RadarResult | null {
  const btcWeekly = weeklyCloses(btcDaily);
  if (btcWeekly.length < 60) return null;

  const nasSeries = ratioRsiMa(ndxWeekly, btcWeekly);
  const goldSeries = ratioRsiMa(goldWeekly, btcWeekly);
  const realized = realizedPriceStats(btcDaily, realizedDaily);
  const clock = cycleClock(btcDaily);
  if (nasSeries.length < 60 || goldSeries.length < 60 || !realized || !clock) return null;

  const nasEpisodes = findEpisodes(nasSeries, 66);
  const goldEpisodes = findEpisodes(goldSeries, 66);
  const nasNow = nasSeries[nasSeries.length - 1].value;
  const goldNow = goldSeries[goldSeries.length - 1].value;
  const nasActive = nasEpisodes.find(e => e.active);
  const goldActive = goldEpisodes.find(e => e.active);

  const signals: RadarSignal[] = [
    {
      key: 'nasdaq',
      label: 'NAS100/BTC RSI-MA',
      reading: nasNow.toFixed(1),
      inTail: nasNow >= 66,
      detail: nasActive
        ? `episode ${nasActive.weeks}w and running · BTC max-oversold vs Nasdaq`
        : 'not in tail territory',
    },
    {
      key: 'gold',
      label: 'Gold/BTC RSI-MA',
      reading: goldNow.toFixed(1),
      inTail: goldNow >= 66,
      detail: goldActive
        ? `episode ${goldActive.weeks}w and running · BTC max-oversold vs gold`
        : 'not in tail territory',
    },
    {
      key: 'realized',
      label: 'Spot / realized price',
      reading: `${realized.multiple.toFixed(2)}×`,
      inTail: realized.multiple <= 1.25,
      detail: `realized $${Math.round(realized.realizedNow / 1000)}K · ${(realized.pctHistoryBelow * 100).toFixed(0)}% of joined history below it`,
    },
    {
      key: 'clock',
      label: 'Cycle clock',
      reading: `wk ${clock.weeksSinceATH} · −${(clock.drawdownNow * 100).toFixed(0)}%`,
      inTail: clock.weeksSinceATH >= 30 && clock.weeksSinceATH <= 70,
      detail: `prior troughs set by week 60 → ${clock.week60Date}`,
    },
  ];

  return {
    nas: {
      series: nasSeries,
      current: nasNow,
      pctAbove65: pctTimeAbove(nasSeries, 65),
      pctAbove70: pctTimeAbove(nasSeries, 70),
      episodes: nasEpisodes,
    },
    gold: {
      series: goldSeries,
      current: goldNow,
      pctAbove65: pctTimeAbove(goldSeries, 65),
      pctAbove70: pctTimeAbove(goldSeries, 70),
      episodes: goldEpisodes,
    },
    realized,
    clock,
    signals,
  };
}

'use client';

/**
 * VerdictHero — the 3-second answer.
 *
 * Verdict-first hero: instrument-dial gauge, the action verdict in a large
 * editorial serif, a one-line driver summary, and a quiet stat rail.
 * Honesty features (stale/fallback badges, confidence qualifiers, component
 * disagreement) surface HERE, at the top, only when they trigger.
 */

import { useMemo } from 'react';
import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { getRiskBand, getRiskAction, qualifyAction, combineActions } from '@/lib/risk/bands';
import { DEFAULT_WEIGHTS } from '@/lib/risk/model';
import type { MetaLayersOutput } from '@/lib/meta';
import type { DivergenceResult } from '@/lib/adjusted/divergence';
import { topProximityLabel, type TopProximityResult } from '@/lib/adjusted/top-proximity';

export interface HeroDataPoint {
  date: string;
  price: number;
  risk: number;
  smoothedRisk: number;
  components: {
    valuation: number;
    momentum: number;
    volatility: number;
    cycle: number;
    macro: number;
    attention: number;
  };
  cyclePhase: 'early' | 'mid' | 'late';
}

interface VerdictHeroProps {
  latest: HeroDataPoint;
  prev7d: HeroDataPoint | null;
  meta: MetaLayersOutput | undefined;
  macroAvailable: boolean | null;
  isLiveSource: boolean;
  isStale: boolean;
  staleDays: number;
  dataSource: string;
  lastUpdated: string | null;
  sma200wRatio: number | null;
  /** Trailing ~12 months of the quantile fan (price + Q1..Q99 bands, log) */
  fanYear?: FanYearRow[];
  /** Layer-1 cycle-adjusted risk for the latest day (null during burn-in) */
  adjusted?: number | null;
  /** Layer-3 divergence state for the latest day */
  divergence?: DivergenceResult | null;
  /** Cycle top proximity for the latest day (read-only context) */
  topProximity?: TopProximityResult | null;
}

export interface FanYearRow {
  date: string;
  price: number;
  /** Fan position label for the day, e.g. "~Q23" */
  tauLabel: string;
  q01: number; q10: number; q25: number; q50: number; q75: number; q95: number; q99: number;
  hiBand: [number, number];
  loBand: [number, number];
}

const COMPONENT_LABELS: Record<string, string> = {
  valuation: 'Valuation',
  momentum: 'Momentum',
  volatility: 'Volatility',
  cycle: 'Cycle',
  macro: 'Macro',
  attention: 'Attention',
};

/** Weighted pull of each component on the raw ensemble, vs neutral 0.5.
 *  Exact identity: raw = 0.5 + Σ pulls (weights sum to 1). */
export function computePulls(components: HeroDataPoint['components']) {
  return Object.entries(components)
    .map(([key, score]) => ({
      key,
      label: COMPONENT_LABELS[key] ?? key,
      score,
      weight: DEFAULT_WEIGHTS[key] ?? 0,
      pull: (DEFAULT_WEIGHTS[key] ?? 0) * (score - 0.5),
    }))
    .sort((a, b) => Math.abs(b.pull) - Math.abs(a.pull));
}

/* ---------- dial geometry (270° instrument arc) ---------- */

const CX = 110;
const CY = 110;
const R = 88;
const START = 135; // degrees; sweep 270° clockwise to 405°
const SWEEP = 270;

function polar(angleDeg: number, radius: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: CX + radius * Math.cos(rad), y: CY + radius * Math.sin(rad) };
}

function arcPath(fromDeg: number, toDeg: number, radius: number) {
  const s = polar(fromDeg, radius);
  const e = polar(toDeg, radius);
  const large = toDeg - fromDeg > 180 ? 1 : 0;
  return `M ${s.x} ${s.y} A ${radius} ${radius} 0 ${large} 1 ${e.x} ${e.y}`;
}

function Dial({ value, raw, color, bandLabel, adjusted }: { value: number; raw: number; color: string; bandLabel: string; adjusted: number | null }) {
  const end = START + SWEEP * Math.max(0, Math.min(1, value));
  const arcLen = ((end - START) / 360) * 2 * Math.PI * R;
  const marker = polar(end, R);

  // Second marker for the cycle-adjusted (Layer-1) reading, on the same dial
  const adjAngle = adjusted === null ? null : START + SWEEP * Math.max(0, Math.min(1, adjusted));
  const adjInner = adjAngle === null ? null : polar(adjAngle, R - 11);
  const adjOuter = adjAngle === null ? null : polar(adjAngle, R + 3);

  // Band boundary ticks at 0/20/40/60/80/100
  const ticks = [0, 0.2, 0.4, 0.6, 0.8, 1].map(t => {
    const a = START + SWEEP * t;
    return { o: polar(a, R + 8), i: polar(a, R + 15), t };
  });

  return (
    <svg viewBox="0 0 220 220" className="w-44 h-44 sm:w-56 sm:h-56 lg:w-64 lg:h-64" role="img" aria-label={`Risk ${(value * 100).toFixed(1)} percent, ${bandLabel}`}>
      {/* track */}
      <path d={arcPath(START, START + SWEEP, R)} fill="none" stroke="var(--hairline)" strokeWidth="3" />
      {/* boundary ticks */}
      {ticks.map(({ o, i, t }) => (
        <line key={t} x1={o.x} y1={o.y} x2={i.x} y2={i.y} stroke="var(--faint)" strokeWidth="1" />
      ))}
      {/* value arc */}
      <path
        d={arcPath(START, Math.max(START + 0.5, end), R)}
        fill="none"
        stroke={color}
        strokeWidth="5"
        strokeLinecap="round"
        className="draw"
        style={{
          strokeDasharray: arcLen,
          ['--arc-len' as string]: `${arcLen}`,
        }}
      />
      {/* cycle-adjusted (Layer-1) needle — a violet tick across the arc */}
      {adjInner && adjOuter && (
        <line
          x1={adjInner.x} y1={adjInner.y} x2={adjOuter.x} y2={adjOuter.y}
          stroke="#a855f7" strokeWidth="2.5" strokeLinecap="round"
        >
          <title>Cycle-adjusted risk {(adjusted! * 100).toFixed(1)}%</title>
        </line>
      )}
      {/* marker dot (absolute) */}
      <circle cx={marker.x} cy={marker.y} r="6" fill={color}>
        <animate attributeName="opacity" values="1;0.35;1" dur="2.4s" repeatCount="indefinite" />
      </circle>
      {/* center readout */}
      <text x={CX} y={CY - 4} textAnchor="middle" fill="var(--foreground)" fontSize="40" fontWeight="600" style={{ fontFamily: 'var(--font-data)' }}>
        {(value * 100).toFixed(1)}
      </text>
      <text x={CX} y={CY + 18} textAnchor="middle" fill="var(--muted)" fontSize="11" style={{ fontFamily: 'var(--font-data)' }}>
        % RISK · {bandLabel.toUpperCase()}
      </text>
      <text x={CX} y={CY + 36} textAnchor="middle" fill="var(--faint)" fontSize="9" style={{ fontFamily: 'var(--font-data)' }}>
        raw {(raw * 100).toFixed(1)}%
      </text>
    </svg>
  );
}

/* ---------- small pieces ---------- */

function Chip({ tone, children }: { tone: 'ok' | 'warn' | 'alert'; children: React.ReactNode }) {
  const styles = {
    ok: 'text-emerald-400/90 border-emerald-500/25 bg-emerald-500/5',
    warn: 'text-yellow-400/90 border-yellow-500/25 bg-yellow-500/5',
    alert: 'text-orange-400/90 border-orange-500/25 bg-orange-500/5',
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 border rounded-full px-2.5 py-0.5 text-[10px] tracking-wide uppercase ${styles}`}>
      {children}
    </span>
  );
}

function RailStat({ label, value, sub, subTone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; subTone?: string }) {
  return (
    <div className="py-2.5 border-b last:border-b-0" style={{ borderColor: 'var(--hairline)' }}>
      <div className="text-[10px] uppercase tracking-[0.14em]" style={{ color: 'var(--faint)' }}>{label}</div>
      <div className="text-base mt-0.5" style={{ color: 'var(--foreground)' }}>{value}</div>
      {sub && <div className={`text-[11px] mt-0.5 ${subTone ?? ''}`} style={subTone ? undefined : { color: 'var(--muted)' }}>{sub}</div>}
    </div>
  );
}

/* ---------- hero ---------- */

export default function VerdictHero(props: VerdictHeroProps) {
  const {
    latest, prev7d, meta, macroAvailable,
    isLiveSource, isStale, staleDays, dataSource, lastUpdated, sma200wRatio,
    fanYear, adjusted = null, divergence = null, topProximity = null,
  } = props;

  // 12-month price range for the mini-fan microlabel
  const yearRange = useMemo(() => {
    if (!fanYear || fanYear.length < 30) return null;
    let lo = Infinity;
    let hi = -Infinity;
    for (const d of fanYear) {
      if (d.price < lo) lo = d.price;
      if (d.price > hi) hi = d.price;
    }
    return { lo, hi };
  }, [fanYear]);

  const headlineRisk = latest.smoothedRisk;
  const band = getRiskBand(headlineRisk);
  const action = getRiskAction(headlineRisk);

  // Combine absolute (Layer-0) with cycle-adjusted (Layer-1) for the verdict.
  const combined = combineActions(headlineRisk, adjusted);
  // If the two lenses are ≥2 bands apart, cap displayed confidence at medium.
  const rawConfidence = meta?.confidence?.level;
  const confidenceLevel: 'low' | 'medium' | 'high' | undefined =
    combined.divergent && rawConfidence === 'high' ? 'medium' : rawConfidence;
  const qualified = qualifyAction(action, confidenceLevel);

  const pulls = useMemo(() => computePulls(latest.components), [latest.components]);
  const up = pulls.find(p => p.pull > 0.005);
  const down = pulls.find(p => p.pull < -0.005);

  const riskChange7d = prev7d ? latest.smoothedRisk - prev7d.smoothedRisk : 0;
  const priceChange7d = prev7d && prev7d.price > 0 ? (latest.price - prev7d.price) / prev7d.price : 0;

  const fmtPull = (p: number) => `${p > 0 ? '+' : ''}${(p * 100).toFixed(1)}pp`;

  return (
    <section
      className="relative overflow-hidden rounded-2xl border grain"
      style={{
        borderColor: 'var(--hairline)',
        background: 'var(--surface)',
        ['--accent' as string]: band.color,
      }}
    >
      {/* band-tinted atmosphere, top-left */}
      <div
        aria-hidden
        className="absolute -top-32 -left-24 w-[480px] h-[480px] rounded-full pointer-events-none"
        style={{ background: `radial-gradient(closest-side, ${band.color}14, transparent)` }}
      />

      {/* status line */}
      <div className="relative flex flex-wrap items-center gap-2 px-4 sm:px-6 pt-5">
        <span className="text-[11px] tracking-[0.2em] uppercase" style={{ color: 'var(--faint)' }}>
          BTC Risk Metric
        </span>
        <span className="text-[11px]" style={{ color: 'var(--faint)' }}>
          {new Date(latest.date).toLocaleDateString('fi-FI', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {isLiveSource && !isStale && (
            <Chip tone="ok"><span className="w-1 h-1 rounded-full bg-emerald-400 inline-block" />live · binance{lastUpdated ? ` · ${new Date(lastUpdated).toLocaleTimeString('fi-FI', { hour: '2-digit', minute: '2-digit' })}` : ''}</Chip>
          )}
          {!isLiveSource && <Chip tone="warn">fallback · {dataSource} · last {latest.date}</Chip>}
          {isStale && <Chip tone="alert">stale · {staleDays}d old</Chip>}
          {macroAvailable === false && <Chip tone="warn">macro n/a</Chip>}
        </div>
      </div>

      <div className="relative grid grid-cols-1 lg:grid-cols-[auto_1fr_240px] gap-6 lg:gap-10 px-4 sm:px-6 pb-7 pt-2 items-center">
        {/* dial */}
        <div className="rise flex justify-center" style={{ animationDelay: '0.05s' }}>
          <Dial value={headlineRisk} raw={latest.risk} color={band.color} bandLabel={band.label} adjusted={adjusted} />
        </div>

        {/* verdict */}
        <div className="rise text-center lg:text-left" style={{ animationDelay: '0.15s' }}>
          <div className="text-[11px] uppercase tracking-[0.22em] mb-2" style={{ color: 'var(--faint)' }}>
            Today&rsquo;s verdict
          </div>
          <h2 className="font-display text-4xl sm:text-5xl lg:text-6xl leading-[0.95]" style={{ color: band.color }}>
            {qualified.text}
            {combined.leansSuffix && (
              <span className="font-display italic text-xl sm:text-2xl lg:text-3xl ml-2" style={{ color: 'var(--muted)' }}>
                · {combined.leansSuffix}
              </span>
            )}
          </h2>
          <p className="font-display italic text-lg mt-3" style={{ color: 'var(--muted)' }}>
            {action.desc}.
          </p>

          {/* absolute vs cycle-adjusted readout */}
          <div className="mt-3 flex flex-wrap items-center gap-2 justify-center lg:justify-start text-[12px]">
            <span style={{ color: 'var(--muted)' }}>
              absolute <span style={{ color: band.color }}>{(headlineRisk * 100).toFixed(1)}%</span>
            </span>
            {adjusted !== null && (
              <span
                className="inline-flex items-center gap-1.5 border rounded-full px-2.5 py-0.5"
                style={{ color: '#a855f7', borderColor: 'rgba(168,85,247,0.3)' }}
                title="Cycle-adjusted risk: how extreme today is relative to what this compressed regime can produce; the cycle clock is price-confirmed by top proximity"
              >
                cycle-adjusted {(adjusted * 100).toFixed(1)}%
              </span>
            )}
          </div>

          {/* driver line — why, in one sentence */}
          <p className="text-[12px] mt-4" style={{ color: 'var(--muted)' }}>
            {up && (
              <>
                <span style={{ color: '#f97316' }}>▲ {up.label} {(up.score * 100).toFixed(0)}%</span>
                <span style={{ color: 'var(--faint)' }}> pulls risk {fmtPull(up.pull)}</span>
              </>
            )}
            {up && down && <span style={{ color: 'var(--faint)' }}> · </span>}
            {down && (
              <>
                <span style={{ color: '#22c55e' }}>▼ {down.label} {(down.score * 100).toFixed(0)}%</span>
                <span style={{ color: 'var(--faint)' }}> pulls {fmtPull(down.pull)}</span>
              </>
            )}
          </p>

          {/* warnings appear only when they trigger */}
          {(qualified.qualifier || (divergence && divergence.state !== 'aligned')) && (
            <div className="flex flex-wrap gap-1.5 mt-4 justify-center lg:justify-start">
              {qualified.qualifier && <Chip tone="warn">⚠ {qualified.qualifier}</Chip>}
              {divergence && divergence.state !== 'aligned' && (
                <Chip tone={divergence.state === 'layers-diverge' ? 'alert' : 'warn'}>
                  ⚠ {divergence.actionQualifier ?? divergence.state}
                </Chip>
              )}
            </div>
          )}
          {divergence && divergence.state !== 'aligned' && (
            <p className="text-[11px] mt-2 max-w-xl" style={{ color: 'var(--faint)' }}>
              {divergence.explanation}
            </p>
          )}
        </div>

        {/* stat rail */}
        <div className="rise lg:border-l lg:pl-6" style={{ animationDelay: '0.25s', borderColor: 'var(--hairline)' }}>
          <RailStat
            label="BTC Price"
            value={`$${latest.price.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
            sub={prev7d ? `${priceChange7d >= 0 ? '+' : ''}${(priceChange7d * 100).toFixed(1)}% · 7d` : undefined}
            subTone={priceChange7d >= 0 ? 'text-emerald-400/80' : 'text-red-400/80'}
          />
          <RailStat
            label="Risk 7d"
            value={`${riskChange7d >= 0 ? '+' : ''}${(riskChange7d * 100).toFixed(1)}pp`}
            sub={riskChange7d > 0.02 ? 'rising' : riskChange7d < -0.02 ? 'falling' : 'stable'}
          />
          <RailStat
            label="Cycle phase"
            value={<span className="capitalize">{latest.cyclePhase}</span>}
            sub="time-anchor heuristic"
          />
          {sma200wRatio !== null && (
            <RailStat label="P / 200W MA" value={`${sma200wRatio.toFixed(2)}×`} sub="long-cycle context" />
          )}
          {adjusted !== null && (
            <RailStat
              label="Cycle-adjusted"
              value={<span style={{ color: '#a855f7' }}>{(adjusted * 100).toFixed(1)}%</span>}
              sub={`${adjusted >= headlineRisk ? '+' : ''}${((adjusted - headlineRisk) * 100).toFixed(1)}pp vs absolute`}
            />
          )}
          {topProximity && (
            <div title="How top-like conditions are: near an all-time high, deep enough into the cycle. Price-confirms the cycle clock inside the cycle-adjusted layer; never touches the absolute score. Cannot distinguish an intermediate ATH from the final one.">
              <RailStat
                label="Top proximity"
                value={
                  <span style={{ color: topProximity.value >= 0.6 ? '#dc2626' : topProximity.value >= 0.3 ? '#eab308' : 'var(--muted)' }}>
                    {(topProximity.value * 100).toFixed(0)}%
                  </span>
                }
                sub={topProximityLabel(topProximity.value)}
              />
            </div>
          )}
          {meta?.confidence && (
            <RailStat
              label="Confidence"
              value={<span className="uppercase text-sm">{meta.confidence.level}</span>}
              sub={meta.confidence.dataCompleteness !== undefined && meta.confidence.dataCompleteness < 0.95
                ? `data ${(meta.confidence.dataCompleteness * 100).toFixed(0)}% complete`
                : 'signal agreement, not validation'}
            />
          )}
        </div>
      </div>

      {/* 12-month mini quantile fan: where price sits in the Q1–Q99 bands,
          one glance. Same deterministic full-sample fit as the big fan chart. */}
      {fanYear && fanYear.length >= 30 && (
        <div className="relative border-t px-4 sm:px-6 pt-3 pb-4 rise" style={{ borderColor: 'var(--hairline)', animationDelay: '0.35s' }}>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-1 text-[10px] uppercase tracking-[0.14em]" style={{ color: 'var(--faint)' }}>
            <span>Quantile fan · last 12 months · log scale</span>
            {yearRange && (
              <span>
                range ${(yearRange.lo / 1000).toFixed(1)}K – ${(yearRange.hi / 1000).toFixed(1)}K
              </span>
            )}
            <span className="ml-auto flex items-center gap-3 normal-case tracking-normal text-[10px]">
              <span className="flex items-center gap-1" style={{ color: '#60a5fa' }}>
                <span className="w-3 h-0.5 rounded" style={{ background: '#60a5fa' }} />price
              </span>
              <span className="flex items-center gap-1" style={{ color: '#9ca3af' }}>
                <span className="w-3 h-0.5 rounded" style={{ background: '#9ca3af' }} />median
              </span>
              <span style={{ color: 'var(--faint)' }}>bands Q1–Q99 · full-sample fit</span>
            </span>
          </div>
          <div className="h-[130px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={fanYear} margin={{ top: 4, right: 2, left: 2, bottom: 0 }}>
                <XAxis
                  dataKey="date"
                  tickFormatter={(d: string) =>
                    new Date(d).toLocaleDateString('en-US', { month: 'short' })
                  }
                  interval={Math.max(0, Math.floor(fanYear.length / 8) - 1)}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#55534d', fontSize: 9 }}
                  height={14}
                />
                <YAxis scale="log" domain={['auto', 'auto']} hide />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload || payload.length === 0) return null;
                    const p = payload[0].payload as FanYearRow;
                    return (
                      <div className="rounded border px-2.5 py-1.5 text-[10px]" style={{ borderColor: 'var(--hairline)', background: 'var(--surface)', color: 'var(--muted)' }}>
                        <div style={{ color: 'var(--foreground)' }}>
                          {new Date(p.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </div>
                        <div style={{ color: '#60a5fa' }}>
                          ${p.price.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                          <span style={{ color: 'var(--muted)' }}> · {p.tauLabel}</span>
                        </div>
                        <div style={{ color: '#9ca3af' }}>Q50 ${(p.q50 / 1000).toFixed(1)}K</div>
                      </div>
                    );
                  }}
                />
                {/* tail fills */}
                <Area dataKey="hiBand" stroke="none" fill="#dc2626" fillOpacity={0.08} isAnimationActive={false} />
                <Area dataKey="loBand" stroke="none" fill="#22c55e" fillOpacity={0.07} isAnimationActive={false} />
                {/* fan curves */}
                <Line dataKey="q99" stroke="#dc2626" strokeWidth={1} dot={false} isAnimationActive={false} />
                <Line dataKey="q95" stroke="#ef4444" strokeWidth={1} dot={false} isAnimationActive={false} />
                <Line dataKey="q75" stroke="#f472b6" strokeWidth={1} dot={false} isAnimationActive={false} />
                <Line dataKey="q50" stroke="#9ca3af" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                <Line dataKey="q25" stroke="#86efac" strokeWidth={1} dot={false} isAnimationActive={false} />
                <Line dataKey="q10" stroke="#22c55e" strokeWidth={1} dot={false} isAnimationActive={false} />
                <Line dataKey="q01" stroke="#15803d" strokeWidth={1} dot={false} isAnimationActive={false} />
                {/* price */}
                <Line dataKey="price" stroke="#60a5fa" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </section>
  );
}

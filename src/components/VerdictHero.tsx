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
import { getRiskBand, getRiskAction, qualifyAction } from '@/lib/risk/bands';
import { DEFAULT_WEIGHTS } from '@/lib/risk/model';
import type { MetaLayersOutput } from '@/lib/meta';

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

function Dial({ value, raw, color, bandLabel }: { value: number; raw: number; color: string; bandLabel: string }) {
  const end = START + SWEEP * Math.max(0, Math.min(1, value));
  const arcLen = ((end - START) / 360) * 2 * Math.PI * R;
  const marker = polar(end, R);

  // Band boundary ticks at 0/20/40/60/80/100
  const ticks = [0, 0.2, 0.4, 0.6, 0.8, 1].map(t => {
    const a = START + SWEEP * t;
    return { o: polar(a, R + 8), i: polar(a, R + 15), t };
  });

  return (
    <svg viewBox="0 0 220 220" className="w-56 h-56 lg:w-64 lg:h-64" role="img" aria-label={`Risk ${(value * 100).toFixed(1)} percent, ${bandLabel}`}>
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
      {/* marker dot */}
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
  } = props;

  const headlineRisk = latest.smoothedRisk;
  const band = getRiskBand(headlineRisk);
  const action = getRiskAction(headlineRisk);
  const confidenceLevel = meta?.confidence?.level;
  const qualified = qualifyAction(action, confidenceLevel);
  const dispersion = meta?.confidence?.componentDispersion ?? 0;
  const componentsDisagree = dispersion > 0.25;

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
      <div className="relative flex flex-wrap items-center gap-2 px-6 pt-5">
        <span className="text-[11px] tracking-[0.2em] uppercase" style={{ color: 'var(--faint)' }}>
          Ralph · BTC Risk
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

      <div className="relative grid grid-cols-1 lg:grid-cols-[auto_1fr_240px] gap-6 lg:gap-10 px-6 pb-7 pt-2 items-center">
        {/* dial */}
        <div className="rise flex justify-center" style={{ animationDelay: '0.05s' }}>
          <Dial value={headlineRisk} raw={latest.risk} color={band.color} bandLabel={band.label} />
        </div>

        {/* verdict */}
        <div className="rise text-center lg:text-left" style={{ animationDelay: '0.15s' }}>
          <div className="text-[11px] uppercase tracking-[0.22em] mb-2" style={{ color: 'var(--faint)' }}>
            Today&rsquo;s verdict
          </div>
          <h2 className="font-display text-5xl lg:text-6xl leading-[0.95]" style={{ color: band.color }}>
            {qualified.text}
          </h2>
          <p className="font-display italic text-lg mt-3" style={{ color: 'var(--muted)' }}>
            {action.desc}.
          </p>

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
          {(qualified.qualifier || componentsDisagree) && (
            <div className="flex flex-wrap gap-1.5 mt-4 justify-center lg:justify-start">
              {qualified.qualifier && <Chip tone="warn">⚠ {qualified.qualifier}</Chip>}
              {componentsDisagree && <Chip tone="alert">⚠ components disagree — read the breakdown below</Chip>}
            </div>
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
    </section>
  );
}

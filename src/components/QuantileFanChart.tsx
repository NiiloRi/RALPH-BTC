'use client';

/**
 * QuantileFanChart — Bitcoin asymmetric quantile regression fan.
 *
 * Quadratic quantile regression of ln(price) on ln(days since genesis) at
 * τ = 1/10/25/50/75/95/99%, rearranged so curves cannot cross. Fit
 * client-side on the FULL untrimmed close series (~60ms), refit on load.
 *
 * Interactions:
 * - Drag-select to zoom a date window (the fit does NOT change with zoom —
 *   it stays the full-sample fit; zooming only changes the viewport).
 * - Optional risk-metric overlay (right axis, 0–100%) on the same time
 *   axis, for studying how the risk score co-moves with fan position.
 *
 * Honesty: this is a full-sample descriptive fit — bands at any past date
 * use data from that date's future. Context, not a forecast. The dashed
 * wick-dislocation reference levels are literature values from the paper,
 * not derived from our fit (our pre-2017 data has no intraday wicks).
 */

import { useMemo, useState } from 'react';
import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts';
import {
  fitQuantileFan,
  evaluateFan,
  impliedQuantile,
  curvatureAsymmetry,
  WICK_DISLOCATIONS,
  type QuantileFanModel,
} from '@/lib/quantile-fan/quantile-fan';
import { NEXT_HALVING_ESTIMATE } from '@/lib/models/s2f';
import { projectionDates, addDays } from '@/lib/models/projection';
import { C } from './chart-ui';

interface SeriesPoint {
  date: string;
  close: number;
}

interface RiskPoint {
  date: string;
  risk: number;
}

interface QuantileFanChartProps {
  series: SeriesPoint[];
  /** Smoothed risk metric series for the optional overlay */
  riskSeries?: RiskPoint[];
}

interface FanRow {
  date: string;
  price?: number;
  risk?: number;
  q01: number; q10: number; q25: number; q50: number; q75: number; q95: number; q99: number;
  hiBand: [number, number];
  loBand: [number, number];
  w0: number; w1: number; w2: number; w3: number;
  rowTau?: string;
}

const Q_STYLE: { key: 'q99' | 'q95' | 'q75' | 'q50' | 'q25' | 'q10' | 'q01'; label: string; color: string; width?: number }[] = [
  { key: 'q99', label: '99th', color: '#dc2626' },
  { key: 'q95', label: '95th', color: '#ef4444' },
  { key: 'q75', label: '75th', color: '#f472b6' },
  { key: 'q50', label: 'Median (50th)', color: '#9ca3af', width: 2 },
  { key: 'q25', label: '25th', color: '#86efac' },
  { key: 'q10', label: '10th', color: '#22c55e' },
  { key: 'q01', label: '1st', color: '#15803d' },
];

const WICK_COLOR = '#ca8a04';
const RISK_COLOR = '#a855f7';

function fmtPrice(v: number): string {
  if (!Number.isFinite(v)) return '';
  if (v >= 1000) return `$${(v / 1000).toFixed(v >= 100_000 ? 0 : 1)}K`;
  if (v >= 10) return `$${v.toFixed(0)}`;
  if (v >= 1) return `$${v.toFixed(1)}`;
  return `$${v.toFixed(2)}`;
}

function fmtK(v: number): string {
  return v >= 1000 ? `$${(v / 1000).toFixed(2)}K` : `$${v.toFixed(2)}`;
}

interface FanTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: FanRow }>;
  showWicks?: boolean;
}

function FanTooltip({ active, payload, showWicks }: FanTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  const qRows: { label: string; color: string; value: number }[] = Q_STYLE.map(q => ({
    label: q.label === 'Median (50th)' ? 'Median (50th)' : `${q.label} percentile`,
    color: q.color,
    value: row[q.key],
  }));
  return (
    <div className="rounded-lg border p-3 shadow-lg min-w-[230px]" style={{ borderColor: 'var(--hairline)', background: 'var(--surface)' }}>
      <p className="text-sm mb-2" style={{ color: 'var(--foreground)' }}>
        {new Date(row.date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
      </p>
      <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 text-[11px]">
        {row.price !== undefined && (
          <>
            <span style={{ color: '#60a5fa' }}>Bitcoin price</span>
            <span className="text-right" style={{ color: 'var(--foreground)' }}>{fmtK(row.price)}</span>
            <span style={{ color: 'var(--muted)' }}>Fan position</span>
            <span className="text-right" style={{ color: 'var(--foreground)' }}>{row.rowTau}</span>
          </>
        )}
        {row.risk !== undefined && (
          <>
            <span style={{ color: RISK_COLOR }}>Risk metric</span>
            <span className="text-right" style={{ color: RISK_COLOR }}>{(row.risk * 100).toFixed(1)}%</span>
          </>
        )}
        {qRows.map(q => (
          <span key={q.label} style={{ color: q.color, display: 'contents' }}>
            <span style={{ color: q.color }}>{q.label}</span>
            <span className="text-right" style={{ color: 'var(--foreground)' }}>{fmtK(q.value)}</span>
          </span>
        ))}
        {showWicks && WICK_DISLOCATIONS.map((w, i) => (
          <span key={w.label} style={{ display: 'contents' }}>
            <span style={{ color: WICK_COLOR }}>Q1% − {(w.pct * 100).toFixed(w.pct < 0.1 ? 2 : 1)}% ({w.label})</span>
            <span className="text-right" style={{ color: 'var(--foreground)' }}>
              {fmtK(row[`w${i}` as 'w0' | 'w1' | 'w2' | 'w3'])}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

export default function QuantileFanChart({ series, riskSeries }: QuantileFanChartProps) {
  const [showWicks, setShowWicks] = useState(true);
  const [showRisk, setShowRisk] = useState(false);
  // Projection: extend the fan curves to the estimated next halving + 6 months
  // (default off keeps the original 26-week forward extension).
  const [project, setProject] = useState(false);

  // Drag-to-zoom viewport (does NOT refit the model)
  const [zoom, setZoom] = useState<{ start: number; end: number } | null>(null);
  const [refAreaLeft, setRefAreaLeft] = useState<string | null>(null);
  const [refAreaRight, setRefAreaRight] = useState<string | null>(null);

  // Fit the fan on the FULL series (deterministic IRLS, ~60ms on 5.5k points)
  const model: QuantileFanModel | null = useMemo(() => {
    if (series.length < 200) return null;
    try {
      return fitQuantileFan(series.map(s => s.date), series.map(s => s.close));
    } catch {
      return null;
    }
  }, [series]);

  const riskByDate = useMemo(() => {
    const m = new Map<string, number>();
    if (riskSeries) for (const r of riskSeries) m.set(r.date, r.risk);
    return m;
  }, [riskSeries]);

  // Visible slice (zoom window), then downsample — so zooming into a short
  // window shows full daily granularity instead of the global downsample.
  const rows: FanRow[] = useMemo(() => {
    if (!model || series.length === 0) return [];

    let visible = series;
    if (zoom) {
      visible = series.filter(p => {
        const t = new Date(p.date).getTime();
        return t >= zoom.start && t <= zoom.end;
      });
      if (visible.length < 2) visible = series;
    }

    const step = Math.max(1, Math.ceil(visible.length / 1100));
    const out: FanRow[] = [];

    const push = (date: string, price?: number) => {
      const q = evaluateFan(model, date);
      const [q01, q10, q25, q50, q75, q95, q99] = q;
      const row: FanRow = {
        date, price,
        q01, q10, q25, q50, q75, q95, q99,
        hiBand: [q95, q99],
        loBand: [q01, q10],
        w0: q01 * (1 - WICK_DISLOCATIONS[0].pct),
        w1: q01 * (1 - WICK_DISLOCATIONS[1].pct),
        w2: q01 * (1 - WICK_DISLOCATIONS[2].pct),
        w3: q01 * (1 - WICK_DISLOCATIONS[3].pct),
      };
      if (price !== undefined) {
        row.rowTau = impliedQuantile(model, date, price).label;
        const risk = riskByDate.get(date);
        if (risk !== undefined) row.risk = risk;
      }
      out.push(row);
    };

    for (let i = 0; i < visible.length; i += step) {
      push(visible[i].date, visible[i].close);
    }
    const lastVisible = visible[visible.length - 1];
    if (out[out.length - 1]?.date !== lastVisible.date) push(lastVisible.date, lastVisible.close);

    // Forward extension (curves only) — full view only. Default: 26 weeks;
    // projection toggle: to the estimated next halving + 6 months, with the
    // halving date guaranteed to be a row so its ReferenceLine renders.
    if (!zoom) {
      if (project) {
        for (const d of projectionDates(
          lastVisible.date,
          addDays(NEXT_HALVING_ESTIMATE, 183),
          [NEXT_HALVING_ESTIMATE],
          step
        )) {
          push(d);
        }
      } else {
        const lastMs = new Date(lastVisible.date).getTime();
        for (let w = 1; w <= 26; w++) {
          push(new Date(lastMs + w * 7 * 86_400_000).toISOString().split('T')[0]);
        }
      }
    }
    return out;
  }, [model, series, zoom, riskByDate, project]);

  // Adaptive X labels: months when zoomed tight, years otherwise
  const spanDays = rows.length > 1
    ? (new Date(rows[rows.length - 1].date).getTime() - new Date(rows[0].date).getTime()) / 86_400_000
    : 0;
  const fmtX = (d: string) =>
    spanDays < 1000
      ? new Date(d).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
      : String(new Date(d).getFullYear());

  // Drag handlers (same pattern as the main risk chart)
  const handleMouseDown = (e: { activeLabel?: string | number }) => {
    if (e?.activeLabel !== undefined) {
      setRefAreaLeft(String(e.activeLabel));
      setRefAreaRight(null);
    }
  };
  const handleMouseMove = (e: { activeLabel?: string | number }) => {
    if (refAreaLeft && e?.activeLabel !== undefined) setRefAreaRight(String(e.activeLabel));
  };
  const handleMouseUp = () => {
    if (refAreaLeft && refAreaRight) {
      const a = new Date(refAreaLeft).getTime();
      const b = new Date(refAreaRight).getTime();
      const start = Math.min(a, b);
      const end = Math.max(a, b);
      if (end - start >= 5 * 86_400_000) setZoom({ start, end });
    }
    setRefAreaLeft(null);
    setRefAreaRight(null);
  };

  const latest = series[series.length - 1];
  const latestStats = useMemo(() => {
    if (!model || !latest) return null;
    const fan = evaluateFan(model, latest.date);
    const pos = impliedQuantile(model, latest.date, latest.close);
    const asym = curvatureAsymmetry(model);
    return { fan, pos, asym };
  }, [model, latest]);

  if (!model || !latestStats || rows.length === 0) {
    return null;
  }

  const { fan, pos, asym } = latestStats;
  const cheap = pos.belowMin || (pos.tau !== null && pos.tau < 0.1);
  const expensive = pos.aboveMax || (pos.tau !== null && pos.tau > 0.9);
  const posColor = cheap ? '#22c55e' : expensive ? '#dc2626' : 'var(--foreground)';

  return (
    <section className="rounded-2xl border px-4 sm:px-6 py-5" style={{ borderColor: 'var(--hairline)', background: 'var(--surface)' }}>
      {/* Header */}
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
        <h3 className="font-display text-2xl" style={{ color: 'var(--foreground)' }}>
          Asymmetric quantile regression fan
        </h3>
        <div className="flex items-center gap-3">
          {zoom && (
            <button
              onClick={() => setZoom(null)}
              className="rounded border px-3 py-1 text-[11px] transition-colors hover:bg-white/5"
              style={{ borderColor: 'var(--hairline)', color: 'var(--foreground)' }}
            >
              Reset zoom
            </button>
          )}
          <span className="text-[10px] uppercase tracking-[0.14em]" style={{ color: 'var(--faint)' }}>
            full-sample fit · context, not a forecast
          </span>
        </div>
      </div>

      {/* Stat strip */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[12px] mb-4" style={{ color: 'var(--muted)' }}>
        <span>Latest close <span style={{ color: '#60a5fa' }}>{fmtK(latest.close)}</span></span>
        <span>Q1 <span style={{ color: '#15803d' }}>{fmtK(fan[0])}</span></span>
        <span>Q50 <span style={{ color: '#9ca3af' }}>{fmtK(fan[3])}</span></span>
        <span>Q99 <span style={{ color: '#dc2626' }}>{fmtK(fan[6])}</span></span>
        <span
          className="inline-flex items-center gap-1.5 border rounded-full px-2.5 py-0.5 text-[10px] uppercase tracking-wide"
          style={{ color: posColor, borderColor: 'var(--hairline)' }}
        >
          price sits at {pos.label}{cheap ? ' · historically depressed vs trend' : expensive ? ' · historically stretched vs trend' : ''}
        </span>
        <span className="ml-auto flex items-center gap-4">
          <label
            className="flex items-center gap-2 cursor-pointer text-[11px]"
            style={{ color: project ? C.halvingLabel : 'var(--muted)' }}
            title="Extend the fan curves to the estimated next halving (2028-04-16, block-schedule estimate) plus six months"
          >
            <input
              type="checkbox"
              checked={project}
              onChange={e => setProject(e.target.checked)}
              className="rounded bg-gray-700 border-gray-600"
              disabled={!!zoom}
            />
            project to est. 2028 halving
          </label>
          {riskSeries && riskSeries.length > 0 && (
            <label className="flex items-center gap-2 cursor-pointer text-[11px]" style={{ color: showRisk ? RISK_COLOR : 'var(--muted)' }}>
              <input
                type="checkbox"
                checked={showRisk}
                onChange={e => setShowRisk(e.target.checked)}
                className="rounded bg-gray-700 border-gray-600"
              />
              risk metric overlay
            </label>
          )}
          <label className="flex items-center gap-2 cursor-pointer text-[11px]" style={{ color: 'var(--muted)' }}>
            <input
              type="checkbox"
              checked={showWicks}
              onChange={e => setShowWicks(e.target.checked)}
              className="rounded bg-gray-700 border-gray-600"
            />
            wick reference levels
          </label>
        </span>
      </div>

      {/* Chart */}
      <div className="h-[340px] sm:h-[460px] cursor-crosshair select-none">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={rows}
            margin={{ top: 8, right: 16, left: 8, bottom: 4 }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
          >
            <XAxis
              dataKey="date"
              tickFormatter={fmtX}
              stroke="#4b5563"
              tick={{ fill: '#8a877f', fontSize: 11 }}
              interval="preserveStartEnd"
              minTickGap={40}
            />
            <YAxis
              yAxisId="price"
              scale="log"
              domain={['auto', 'auto']}
              tickFormatter={fmtPrice}
              stroke="#4b5563"
              tick={{ fill: '#8a877f', fontSize: 11 }}
              width={62}
            />
            {showRisk && (
              <YAxis
                yAxisId="risk"
                orientation="right"
                domain={[0, 1]}
                tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
                stroke={RISK_COLOR}
                tick={{ fill: RISK_COLOR, fontSize: 11 }}
                width={44}
              />
            )}
            <Tooltip content={<FanTooltip showWicks={showWicks} />} />

            {project && !zoom && (
              <ReferenceLine
                yAxisId="price"
                x={NEXT_HALVING_ESTIMATE}
                stroke={C.halving}
                strokeDasharray="3 5"
                label={{ value: 'HALVING · EST', fill: C.halvingLabel, fontSize: 9, position: 'insideTop' }}
              />
            )}

            {/* soft tail fills */}
            <Area yAxisId="price" dataKey="hiBand" stroke="none" fill="#dc2626" fillOpacity={0.08} isAnimationActive={false} />
            <Area yAxisId="price" dataKey="loBand" stroke="none" fill="#22c55e" fillOpacity={0.07} isAnimationActive={false} />

            {/* quantile curves */}
            {Q_STYLE.map(q => (
              <Line
                key={q.key}
                yAxisId="price"
                dataKey={q.key}
                stroke={q.color}
                strokeWidth={q.width ?? 1.25}
                dot={false}
                isAnimationActive={false}
              />
            ))}

            {/* wick dislocation reference levels (paper values) */}
            {showWicks && ['w0', 'w1', 'w2', 'w3'].map((k, i) => (
              <Line
                key={k}
                yAxisId="price"
                dataKey={k}
                stroke={WICK_COLOR}
                strokeWidth={1}
                strokeDasharray="4 4"
                strokeOpacity={0.8 - i * 0.15}
                dot={false}
                isAnimationActive={false}
              />
            ))}

            {/* price */}
            <Line
              yAxisId="price"
              dataKey="price"
              stroke="#60a5fa"
              strokeWidth={1.5}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />

            {/* risk metric overlay (right axis) */}
            {showRisk && (
              <Line
                yAxisId="risk"
                dataKey="risk"
                stroke={RISK_COLOR}
                strokeWidth={1.5}
                dot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
            )}

            {/* drag selection */}
            {refAreaLeft && refAreaRight && (
              <ReferenceArea
                yAxisId="price"
                x1={refAreaLeft}
                x2={refAreaRight}
                strokeOpacity={0.3}
                fill="#ffffff"
                fillOpacity={0.15}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-1 text-[10px] text-center" style={{ color: 'var(--faint)' }}>
        Drag on chart to zoom{zoom ? ` · showing ${rows.length} days · zoom is a viewport — the fit stays full-sample` : ''}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 justify-center text-[11px]" style={{ color: 'var(--muted)' }}>
        <span className="flex items-center gap-1.5"><span className="w-4 h-0.5 rounded" style={{ background: '#60a5fa' }} />Bitcoin price</span>
        {showRisk && (
          <span className="flex items-center gap-1.5" style={{ color: RISK_COLOR }}>
            <span className="w-4 h-0.5 rounded" style={{ background: RISK_COLOR }} />Risk metric (right axis)
          </span>
        )}
        {Q_STYLE.map(q => (
          <span key={q.key} className="flex items-center gap-1.5">
            <span className="w-4 h-0.5 rounded" style={{ background: q.color }} />{q.label}
          </span>
        ))}
        {showWicks && WICK_DISLOCATIONS.map(w => (
          <span key={w.label} className="flex items-center gap-1.5" style={{ color: WICK_COLOR }}>
            <span className="w-4 border-t border-dashed" style={{ borderColor: WICK_COLOR }} />
            Q1 − {(w.pct * 100).toFixed(w.pct < 0.1 ? 2 : 1)}% ({w.label})
          </span>
        ))}
      </div>

      {/* Description / usage / honesty */}
      <div className="mt-4 grid gap-2 text-[12px] leading-relaxed border-t pt-4" style={{ color: 'var(--muted)', borderColor: 'var(--hairline)' }}>
        <div>
          <span className="uppercase text-[10px] tracking-[0.14em]" style={{ color: 'var(--faint)' }}>what · </span>
          Quadratic quantile regression of ln(price) on ln(days since genesis), fit independently at
          τ = 1/10/25/50/75/95/99% with pinball loss, then rearranged so curves cannot cross
          (recreates the &ldquo;Bitcoin Tail Risk and Asymmetric Quantile Dynamics&rdquo; Figure-1 fan).
        </div>
        <div>
          <span className="uppercase text-[10px] tracking-[0.14em]" style={{ color: 'var(--faint)' }}>asymmetry · </span>
          The upper fan narrows because the fitted upper-tail curvature is more negative than the
          lower-tail curvature (this fit: β₂ = {asym.upper.toFixed(2)} at Q99 vs {asym.lower.toFixed(2)} at Q1)
          — blow-off tops diminish faster than the floor decays.
        </div>
        <div>
          <span className="uppercase text-[10px] tracking-[0.14em]" style={{ color: 'var(--faint)' }}>honesty · </span>
          Full-sample descriptive fit refit on each load ({model.fittedN.toLocaleString()} closes,
          {' '}{model.fittedRange.start} → {model.fittedRange.end}): band positions at past dates use data
          from their future, so this is context, not a walk-forward signal or a price target. Zooming
          never refits. Dashed wick levels are the paper&rsquo;s reference values, not derived from this
          fit. The risk-metric overlay shares only the time axis — its 0–100% scale is unrelated to price.
        </div>
      </div>
    </section>
  );
}

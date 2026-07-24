'use client';

/**
 * PowerLawChart — ln(price) vs ln(days since genesis), OLS fair-value line
 * with residual-quantile support/resistance bands (Q05/Q95 of ln-residuals:
 * ~90% of fitted daily closes sit between the bands BY CONSTRUCTION —
 * in-sample coverage, not a forecast interval).
 *
 * Projection: the model is a pure function of time, so the toggle extends
 * the curves to the estimated 2028 halving + 6 months. Extrapolation of a
 * descriptive fit — never a forecast; the UI says so.
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
import { fitPowerLaw, evaluatePowerLaw, type PowerLawModel } from '@/lib/models/power-law';
import { NEXT_HALVING_ESTIMATE } from '@/lib/models/s2f';
import { projectionDates, addDays } from '@/lib/models/projection';
import { C, Toggle } from './chart-ui';

interface SeriesPoint {
  date: string;
  close: number;
}

interface Row {
  date: string;
  price?: number;
  fair: number;
  support: number;
  resistance: number;
  band: [number, number];
}

const PRICE_COLOR = '#60a5fa';
const FAIR_COLOR = '#eab308';
const SUPPORT_COLOR = '#22c55e';
const RESISTANCE_COLOR = '#dc2626';

function fmtPrice(v: number): string {
  if (!Number.isFinite(v)) return '';
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1000) return `$${(v / 1000).toFixed(v >= 100_000 ? 0 : 1)}K`;
  if (v >= 10) return `$${v.toFixed(0)}`;
  return `$${v.toFixed(2)}`;
}

function PLTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: Row }> }) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  const dev = row.price !== undefined ? row.price / row.fair - 1 : null;
  return (
    <div className="rounded-lg border p-3 shadow-lg min-w-[210px]" style={{ borderColor: 'var(--hairline)', background: 'var(--surface)' }}>
      <p className="text-sm mb-2" style={{ color: 'var(--foreground)' }}>
        {new Date(row.date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
      </p>
      <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 text-[11px]">
        {row.price !== undefined && (
          <>
            <span style={{ color: PRICE_COLOR }}>Bitcoin price</span>
            <span className="text-right" style={{ color: 'var(--foreground)' }}>{fmtPrice(row.price)}</span>
          </>
        )}
        <span style={{ color: FAIR_COLOR }}>Power-law fair</span>
        <span className="text-right" style={{ color: 'var(--foreground)' }}>{fmtPrice(row.fair)}</span>
        <span style={{ color: RESISTANCE_COLOR }}>Resistance (Q95)</span>
        <span className="text-right" style={{ color: 'var(--foreground)' }}>{fmtPrice(row.resistance)}</span>
        <span style={{ color: SUPPORT_COLOR }}>Support (Q05)</span>
        <span className="text-right" style={{ color: 'var(--foreground)' }}>{fmtPrice(row.support)}</span>
        {dev !== null && (
          <>
            <span style={{ color: 'var(--muted)' }}>vs fair value</span>
            <span className="text-right" style={{ color: dev >= 0 ? RESISTANCE_COLOR : SUPPORT_COLOR }}>
              {dev >= 0 ? '+' : ''}{(dev * 100).toFixed(0)}%
            </span>
          </>
        )}
      </div>
    </div>
  );
}

export default function PowerLawChart({ series }: { series: SeriesPoint[] }) {
  const [project, setProject] = useState(false);
  const [zoom, setZoom] = useState<{ start: number; end: number } | null>(null);
  const [refAreaLeft, setRefAreaLeft] = useState<string | null>(null);
  const [refAreaRight, setRefAreaRight] = useState<string | null>(null);

  const model: PowerLawModel | null = useMemo(() => {
    if (series.length < 200) return null;
    try {
      return fitPowerLaw(series.map(s => s.date), series.map(s => s.close));
    } catch {
      return null;
    }
  }, [series]);

  const rows: Row[] = useMemo(() => {
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
    const out: Row[] = [];
    const push = (date: string, price?: number) => {
      const v = evaluatePowerLaw(model, date);
      out.push({ date, price, ...v, band: [v.support, v.resistance] });
    };
    for (let i = 0; i < visible.length; i += step) push(visible[i].date, visible[i].close);
    const last = visible[visible.length - 1];
    if (out[out.length - 1]?.date !== last.date) push(last.date, last.close);

    if (!zoom && project) {
      for (const d of projectionDates(last.date, addDays(NEXT_HALVING_ESTIMATE, 183), [NEXT_HALVING_ESTIMATE])) {
        push(d);
      }
    }
    return out;
  }, [model, series, zoom, project]);

  const spanDays = rows.length > 1
    ? (new Date(rows[rows.length - 1].date).getTime() - new Date(rows[0].date).getTime()) / 86_400_000
    : 0;
  const fmtX = (d: string) =>
    spanDays < 1000
      ? new Date(d).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
      : String(new Date(d).getFullYear());

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
      if (Math.max(a, b) - Math.min(a, b) >= 5 * 86_400_000) {
        setZoom({ start: Math.min(a, b), end: Math.max(a, b) });
      }
    }
    setRefAreaLeft(null);
    setRefAreaRight(null);
  };

  if (!model || rows.length === 0) return null;

  const latest = series[series.length - 1];
  const latestFair = evaluatePowerLaw(model, latest.date);
  const dev = latest.close / latestFair.fair - 1;

  return (
    <section className="rounded-2xl border px-4 sm:px-6 py-5" style={{ borderColor: 'var(--hairline)', background: 'var(--surface)' }}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
        <h3 className="font-display text-2xl" style={{ color: 'var(--foreground)' }}>
          Power law
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
            in-sample OLS fit · context, not a forecast
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[12px] mb-4" style={{ color: 'var(--muted)' }}>
        <span>P = A·days^<span style={{ color: 'var(--foreground)' }}>{model.b.toFixed(2)}</span></span>
        <span>R² <span style={{ color: 'var(--foreground)' }}>{model.r2.toFixed(3)}</span></span>
        <span>fair <span style={{ color: FAIR_COLOR }}>{fmtPrice(latestFair.fair)}</span></span>
        <span>
          price vs fair{' '}
          <span style={{ color: dev >= 0 ? RESISTANCE_COLOR : SUPPORT_COLOR }}>
            {dev >= 0 ? '+' : ''}{(dev * 100).toFixed(0)}%
          </span>
        </span>
        <span className="ml-auto">
          <Toggle
            checked={project}
            onChange={setProject}
            label={`Project to est. ${NEXT_HALVING_ESTIMATE.slice(0, 4)} halving +6mo`}
            accent={C.halvingLabel}
            title="Extend the fitted curves to the estimated next halving (2028-04-16, block-schedule estimate) plus six months"
            disabled={!!zoom}
          />
        </span>
      </div>

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
              scale="log"
              domain={['auto', 'auto']}
              tickFormatter={fmtPrice}
              stroke="#4b5563"
              tick={{ fill: '#8a877f', fontSize: 11 }}
              width={62}
            />
            <Tooltip content={<PLTooltip />} />

            {/* support→resistance band */}
            <Area dataKey="band" stroke="none" fill={FAIR_COLOR} fillOpacity={0.06} isAnimationActive={false} />

            {project && !zoom && (
              <ReferenceLine
                x={NEXT_HALVING_ESTIMATE}
                stroke={C.halving}
                strokeDasharray="3 5"
                label={{ value: 'HALVING · EST', fill: C.halvingLabel, fontSize: 9, position: 'insideTop' }}
              />
            )}

            <Line dataKey="resistance" stroke={RESISTANCE_COLOR} strokeWidth={1} strokeOpacity={0.8} dot={false} isAnimationActive={false} />
            <Line dataKey="fair" stroke={FAIR_COLOR} strokeWidth={1.75} dot={false} isAnimationActive={false} />
            <Line dataKey="support" stroke={SUPPORT_COLOR} strokeWidth={1} strokeOpacity={0.8} dot={false} isAnimationActive={false} />
            <Line dataKey="price" stroke={PRICE_COLOR} strokeWidth={1.5} dot={false} connectNulls={false} isAnimationActive={false} />

            {refAreaLeft && refAreaRight && (
              <ReferenceArea x1={refAreaLeft} x2={refAreaRight} strokeOpacity={0.3} fill="#ffffff" fillOpacity={0.15} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-1 text-[10px] text-center" style={{ color: 'var(--faint)' }}>
        Drag on chart to zoom{project && !zoom ? ' · dashed line = block-schedule ESTIMATE of the next halving' : ''}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 justify-center text-[11px]" style={{ color: 'var(--muted)' }}>
        <span className="flex items-center gap-1.5"><span className="w-4 h-0.5 rounded" style={{ background: PRICE_COLOR }} />Bitcoin price</span>
        <span className="flex items-center gap-1.5"><span className="w-4 h-0.5 rounded" style={{ background: FAIR_COLOR }} />Power-law fair value</span>
        <span className="flex items-center gap-1.5"><span className="w-4 h-0.5 rounded" style={{ background: RESISTANCE_COLOR }} />Resistance (residual Q95)</span>
        <span className="flex items-center gap-1.5"><span className="w-4 h-0.5 rounded" style={{ background: SUPPORT_COLOR }} />Support (residual Q05)</span>
      </div>

      <div className="mt-4 grid gap-2 text-[12px] leading-relaxed border-t pt-4" style={{ color: 'var(--muted)', borderColor: 'var(--hairline)' }}>
        <div>
          <span className="uppercase text-[10px] tracking-[0.14em]" style={{ color: 'var(--faint)' }}>what · </span>
          Ordinary least squares of ln(price) on ln(days since the 2009-01-03 genesis block):
          P = A·days^b. This fit: b = {model.b.toFixed(3)}, {model.fittedN.toLocaleString()} daily closes,
          {' '}{model.fittedRange.start} → {model.fittedRange.end}. Reference: Santostasi&rsquo;s power law
          (b ≈ 5.8) with a ÷3/×3 support/resistance convention — we report our own fitted parameters
          and use residual quantiles instead.
        </div>
        <div>
          <span className="uppercase text-[10px] tracking-[0.14em]" style={{ color: 'var(--faint)' }}>bands · </span>
          Support/resistance are the 5th/95th percentiles of the fit&rsquo;s ln-residuals, so ~90% of the
          fitted sample lies between them by construction — an in-sample coverage statement, not a
          forecast interval.
        </div>
        <div>
          <span className="uppercase text-[10px] tracking-[0.14em]" style={{ color: 'var(--faint)' }}>honesty · </span>
          Full-sample descriptive fit refit on each load; the exponent is sensitive to the sample start
          date. The projection extrapolates the fitted curve to the estimated next halving
          ({NEXT_HALVING_ESTIMATE}, derived from 210,000 blocks at an assumed 144 blocks/day) plus six
          months — an extrapolation, not a forecast.
        </div>
      </div>
    </section>
  );
}

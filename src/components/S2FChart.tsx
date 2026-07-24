'use client';

/**
 * S2FChart — Stock-to-Flow valuation model.
 *
 * S2F = circulating supply / annualized issuance, computed deterministically
 * from the block-subsidy schedule (see lib/models/s2f.ts). Model:
 * ln(P) = a + b·ln(S2F), OLS on monthly samples. Because supply is a pure
 * function of the block schedule, the model line projects deterministically —
 * across the estimated 2028 halving the flow halves and the model value
 * steps up by 2^b. That visible step IS the projection's point.
 */

import { useMemo, useState } from 'react';
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts';
import {
  fitS2F,
  evaluateS2F,
  s2fAt,
  NEXT_HALVING_ESTIMATE,
  type S2FModel,
} from '@/lib/models/s2f';
import { projectionDates, addDays } from '@/lib/models/projection';
import { C, Toggle } from './chart-ui';

interface SeriesPoint {
  date: string;
  close: number;
}

interface Row {
  date: string;
  price?: number;
  model: number;
  s2f: number;
}

const PRICE_COLOR = '#60a5fa';
const MODEL_COLOR = '#34d399';

function fmtPrice(v: number): string {
  if (!Number.isFinite(v)) return '';
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1000) return `$${(v / 1000).toFixed(v >= 100_000 ? 0 : 1)}K`;
  if (v >= 10) return `$${v.toFixed(0)}`;
  return `$${v.toFixed(2)}`;
}

function S2FTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: Row }> }) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  const dev = row.price !== undefined ? row.price / row.model - 1 : null;
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
        <span style={{ color: MODEL_COLOR }}>S2F model</span>
        <span className="text-right" style={{ color: 'var(--foreground)' }}>{fmtPrice(row.model)}</span>
        <span style={{ color: 'var(--muted)' }}>Stock-to-flow</span>
        <span className="text-right" style={{ color: 'var(--foreground)' }}>{row.s2f.toFixed(1)}</span>
        {dev !== null && (
          <>
            <span style={{ color: 'var(--muted)' }}>price vs model</span>
            <span className="text-right" style={{ color: dev >= 0 ? '#dc2626' : '#22c55e' }}>
              {dev >= 0 ? '+' : ''}{(dev * 100).toFixed(0)}%
            </span>
          </>
        )}
      </div>
    </div>
  );
}

export default function S2FChart({ series }: { series: SeriesPoint[] }) {
  const [project, setProject] = useState(false);
  const [zoom, setZoom] = useState<{ start: number; end: number } | null>(null);
  const [refAreaLeft, setRefAreaLeft] = useState<string | null>(null);
  const [refAreaRight, setRefAreaRight] = useState<string | null>(null);

  const model: S2FModel | null = useMemo(() => {
    if (series.length < 200) return null;
    try {
      return fitS2F(series.map(s => s.date), series.map(s => s.close));
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
      out.push({ date, price, model: evaluateS2F(model, date), s2f: s2fAt(date) });
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
  const latestModel = evaluateS2F(model, latest.date);
  const dev = latest.close / latestModel - 1;

  return (
    <section className="rounded-2xl border px-4 sm:px-6 py-5" style={{ borderColor: 'var(--hairline)', background: 'var(--surface)' }}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
        <h3 className="font-display text-2xl" style={{ color: 'var(--foreground)' }}>
          Stock-to-flow
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
        <span>P ∝ S2F^<span style={{ color: 'var(--foreground)' }}>{model.b.toFixed(2)}</span></span>
        <span>R² <span style={{ color: 'var(--foreground)' }}>{model.r2.toFixed(3)}</span></span>
        <span>S2F now <span style={{ color: 'var(--foreground)' }}>{s2fAt(latest.date).toFixed(0)}</span></span>
        <span>model <span style={{ color: MODEL_COLOR }}>{fmtPrice(latestModel)}</span></span>
        <span>
          price vs model{' '}
          <span style={{ color: dev >= 0 ? '#dc2626' : '#22c55e' }}>
            {dev >= 0 ? '+' : ''}{(dev * 100).toFixed(0)}%
          </span>
        </span>
        <span className="ml-auto">
          <Toggle
            checked={project}
            onChange={setProject}
            label={`Project to est. ${NEXT_HALVING_ESTIMATE.slice(0, 4)} halving +6mo`}
            accent={C.halvingLabel}
            title="Supply is deterministic — the model value steps up by 2^b at the estimated halving"
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
            <Tooltip content={<S2FTooltip />} />

            {project && !zoom && (
              <ReferenceLine
                x={NEXT_HALVING_ESTIMATE}
                stroke={C.halving}
                strokeDasharray="3 5"
                label={{ value: 'HALVING · EST', fill: C.halvingLabel, fontSize: 9, position: 'insideTop' }}
              />
            )}

            <Line dataKey="model" stroke={MODEL_COLOR} strokeWidth={1.75} dot={false} isAnimationActive={false} />
            <Line dataKey="price" stroke={PRICE_COLOR} strokeWidth={1.5} dot={false} connectNulls={false} isAnimationActive={false} />

            {refAreaLeft && refAreaRight && (
              <ReferenceArea x1={refAreaLeft} x2={refAreaRight} strokeOpacity={0.3} fill="#ffffff" fillOpacity={0.15} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-1 text-[10px] text-center" style={{ color: 'var(--faint)' }}>
        Drag on chart to zoom{project && !zoom ? ` · the step at the dashed line is the 2^${model.b.toFixed(1)} flow-halving jump` : ''}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 justify-center text-[11px]" style={{ color: 'var(--muted)' }}>
        <span className="flex items-center gap-1.5"><span className="w-4 h-0.5 rounded" style={{ background: PRICE_COLOR }} />Bitcoin price</span>
        <span className="flex items-center gap-1.5"><span className="w-4 h-0.5 rounded" style={{ background: MODEL_COLOR }} />S2F model value</span>
      </div>

      <div className="mt-4 grid gap-2 text-[12px] leading-relaxed border-t pt-4" style={{ color: 'var(--muted)', borderColor: 'var(--hairline)' }}>
        <div>
          <span className="uppercase text-[10px] tracking-[0.14em]" style={{ color: 'var(--faint)' }}>what · </span>
          Stock-to-flow = circulating supply / annualized issuance, computed from the block-subsidy
          schedule (era boundaries at actual halving dates; blocks/day derived from actual era
          lengths). Model: ln(P) = a + b·ln(S2F), OLS on monthly samples ({model.fittedN} months,
          {' '}{model.fittedRange.start} → {model.fittedRange.end}); this fit b = {model.b.toFixed(3)}.
          Reference: PlanB&rsquo;s 2019 paper (b ≈ 3.3) and the simplified S2F³ variant.
        </div>
        <div>
          <span className="uppercase text-[10px] tracking-[0.14em]" style={{ color: 'var(--faint)' }}>honesty · </span>
          Monthly sampling because ln(S2F) is nearly constant within a subsidy era — daily samples
          would be autocorrelated pseudo-replicates. S2F is widely criticized as a predictive model
          (the regressor is deterministic; any price path fits some exponent). The projection uses the
          deterministic supply schedule through the estimated halving ({NEXT_HALVING_ESTIMATE},
          block-schedule estimate) + 6 months — extrapolation, not a forecast.
        </div>
      </div>
    </section>
  );
}

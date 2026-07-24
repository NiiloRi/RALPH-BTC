'use client';

/**
 * DifficultyChart — difficulty-based valuation (PlanB, Jul 2026: difficulty
 * as a proxy for bitcoin production cost).
 *
 * Model: ln(P) = a + b·ln(difficulty), OLS on the daily price series joined
 * to the difficulty history by forward fill (difficulty is a step function —
 * it changes only at ~2-week retargets).
 *
 * Deliberately NOT projectable: future difficulty is unknowable (it follows
 * hashrate, which follows economics), unlike the deterministic supply
 * schedule or pure time. The footnote says so.
 */

import { useMemo, useState } from 'react';
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceArea,
  ResponsiveContainer,
} from 'recharts';
import {
  joinDifficultyToPrices,
  fitDifficultyModel,
  evaluateDifficultyModel,
} from '@/lib/models/difficulty';
import type { DifficultyPoint } from '@/lib/data/difficulty-fetcher';

interface SeriesPoint {
  date: string;
  close: number;
}

interface Row {
  date: string;
  price: number;
  model: number;
  difficulty: number;
}

const PRICE_COLOR = '#60a5fa';
const MODEL_COLOR = '#f472b6';

function fmtPrice(v: number): string {
  if (!Number.isFinite(v)) return '';
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1000) return `$${(v / 1000).toFixed(v >= 100_000 ? 0 : 1)}K`;
  if (v >= 10) return `$${v.toFixed(0)}`;
  return `$${v.toFixed(2)}`;
}

function fmtDifficulty(d: number): string {
  if (d >= 1e12) return `${(d / 1e12).toFixed(1)} T`;
  if (d >= 1e9) return `${(d / 1e9).toFixed(1)} G`;
  if (d >= 1e6) return `${(d / 1e6).toFixed(1)} M`;
  return d.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function DiffTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: Row }> }) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  const dev = row.price / row.model - 1;
  return (
    <div className="rounded-lg border p-3 shadow-lg min-w-[210px]" style={{ borderColor: 'var(--hairline)', background: 'var(--surface)' }}>
      <p className="text-sm mb-2" style={{ color: 'var(--foreground)' }}>
        {new Date(row.date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
      </p>
      <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 text-[11px]">
        <span style={{ color: PRICE_COLOR }}>Bitcoin price</span>
        <span className="text-right" style={{ color: 'var(--foreground)' }}>{fmtPrice(row.price)}</span>
        <span style={{ color: MODEL_COLOR }}>Difficulty model</span>
        <span className="text-right" style={{ color: 'var(--foreground)' }}>{fmtPrice(row.model)}</span>
        <span style={{ color: 'var(--muted)' }}>Difficulty</span>
        <span className="text-right" style={{ color: 'var(--foreground)' }}>{fmtDifficulty(row.difficulty)}</span>
        <span style={{ color: 'var(--muted)' }}>price vs model</span>
        <span className="text-right" style={{ color: dev >= 0 ? '#dc2626' : '#22c55e' }}>
          {dev >= 0 ? '+' : ''}{(dev * 100).toFixed(0)}%
        </span>
      </div>
    </div>
  );
}

export default function DifficultyChart({
  series,
  difficulty,
}: {
  series: SeriesPoint[];
  difficulty: DifficultyPoint[] | null;
}) {
  const [zoom, setZoom] = useState<{ start: number; end: number } | null>(null);
  const [refAreaLeft, setRefAreaLeft] = useState<string | null>(null);
  const [refAreaRight, setRefAreaRight] = useState<string | null>(null);

  const fitted = useMemo(() => {
    if (!difficulty || difficulty.length === 0 || series.length < 200) return null;
    try {
      const joined = joinDifficultyToPrices(series, difficulty);
      return { joined, model: fitDifficultyModel(joined) };
    } catch {
      return null;
    }
  }, [series, difficulty]);

  const rows: Row[] = useMemo(() => {
    if (!fitted) return [];
    let visible = fitted.joined;
    if (zoom) {
      visible = visible.filter(p => {
        const t = new Date(p.date).getTime();
        return t >= zoom.start && t <= zoom.end;
      });
      if (visible.length < 2) visible = fitted.joined;
    }
    const step = Math.max(1, Math.ceil(visible.length / 1100));
    const out: Row[] = [];
    for (let i = 0; i < visible.length; i += step) {
      const r = visible[i];
      out.push({
        date: r.date,
        price: r.close,
        model: evaluateDifficultyModel(fitted.model, r.difficulty),
        difficulty: r.difficulty,
      });
    }
    const last = visible[visible.length - 1];
    if (out[out.length - 1]?.date !== last.date) {
      out.push({
        date: last.date,
        price: last.close,
        model: evaluateDifficultyModel(fitted.model, last.difficulty),
        difficulty: last.difficulty,
      });
    }
    return out;
  }, [fitted, zoom]);

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

  if (!difficulty) {
    return (
      <section className="rounded-2xl border px-4 sm:px-6 py-5" style={{ borderColor: 'var(--hairline)', background: 'var(--surface)' }}>
        <h3 className="font-display text-2xl" style={{ color: 'var(--foreground)' }}>Difficulty</h3>
        <p className="text-[12px] mt-3" style={{ color: 'var(--faint)' }}>
          Difficulty history loading / unavailable — the model needs the network-difficulty series
          from blockchain.info. Reload later if this persists.
        </p>
      </section>
    );
  }
  if (!fitted || rows.length === 0) return null;

  const last = fitted.joined[fitted.joined.length - 1];
  const latestModel = evaluateDifficultyModel(fitted.model, last.difficulty);
  const dev = last.close / latestModel - 1;
  const m = fitted.model;

  return (
    <section className="rounded-2xl border px-4 sm:px-6 py-5" style={{ borderColor: 'var(--hairline)', background: 'var(--surface)' }}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
        <h3 className="font-display text-2xl" style={{ color: 'var(--foreground)' }}>
          Difficulty
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
        <span>P ∝ difficulty^<span style={{ color: 'var(--foreground)' }}>{m.b.toFixed(2)}</span></span>
        <span>R² <span style={{ color: 'var(--foreground)' }}>{m.r2.toFixed(3)}</span></span>
        <span>difficulty <span style={{ color: 'var(--foreground)' }}>{fmtDifficulty(last.difficulty)}</span></span>
        <span>model <span style={{ color: MODEL_COLOR }}>{fmtPrice(latestModel)}</span></span>
        <span>
          price vs model{' '}
          <span style={{ color: dev >= 0 ? '#dc2626' : '#22c55e' }}>
            {dev >= 0 ? '+' : ''}{(dev * 100).toFixed(0)}%
          </span>
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
            <Tooltip content={<DiffTooltip />} />

            <Line dataKey="model" stroke={MODEL_COLOR} strokeWidth={1.75} dot={false} isAnimationActive={false} />
            <Line dataKey="price" stroke={PRICE_COLOR} strokeWidth={1.5} dot={false} connectNulls={false} isAnimationActive={false} />

            {refAreaLeft && refAreaRight && (
              <ReferenceArea x1={refAreaLeft} x2={refAreaRight} strokeOpacity={0.3} fill="#ffffff" fillOpacity={0.15} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-1 text-[10px] text-center" style={{ color: 'var(--faint)' }}>
        Drag on chart to zoom
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 justify-center text-[11px]" style={{ color: 'var(--muted)' }}>
        <span className="flex items-center gap-1.5"><span className="w-4 h-0.5 rounded" style={{ background: PRICE_COLOR }} />Bitcoin price</span>
        <span className="flex items-center gap-1.5"><span className="w-4 h-0.5 rounded" style={{ background: MODEL_COLOR }} />Difficulty model value</span>
      </div>

      <div className="mt-4 grid gap-2 text-[12px] leading-relaxed border-t pt-4" style={{ color: 'var(--muted)', borderColor: 'var(--hairline)' }}>
        <div>
          <span className="uppercase text-[10px] tracking-[0.14em]" style={{ color: 'var(--faint)' }}>what · </span>
          Network difficulty as a proxy for bitcoin production cost: ln(P) = a + b·ln(difficulty),
          OLS on {m.fittedN.toLocaleString()} daily closes joined to the difficulty history by
          forward fill ({m.fittedRange.start} → {m.fittedRange.end}); this fit b = {m.b.toFixed(3)}.
          Reference: PlanB (Jul 2026) &ldquo;price = difficulty^0.5&rdquo;; bitbo&rsquo;s 0.002·D^0.51.
          Data: blockchain.info, cached 24h server-side.
        </div>
        <div>
          <span className="uppercase text-[10px] tracking-[0.14em]" style={{ color: 'var(--faint)' }}>honesty · </span>
          No projection on this chart, deliberately: future difficulty is unknowable (it follows
          hashrate, which follows mining economics), unlike the deterministic supply schedule or pure
          time. Causality is also contested — difficulty follows price at least as much as it leads
          it. In-sample descriptive fit, refit on each load.
        </div>
      </div>
    </section>
  );
}

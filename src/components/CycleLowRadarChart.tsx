'use client';

/**
 * CycleLowRadarChart — the "Cycle Low Radar" tab.
 *
 * Recreates the Blockworks (Luke Leasure / @0xMether, Jul 2026) basket of
 * high-timeframe cycle-low condition signals: NAS100/BTC and Gold/BTC
 * RSI-MA relative-strength oscillators, spot vs realized price, and the
 * cycle drawdown clock. All statistics recomputed from data on load
 * (lib/models/cycle-low-radar.ts); external series come from /api/radar.
 *
 * Honesty: descriptive, tiny samples (n ≈ 3–4 episodes), and the signals are
 * NOT independent — the footnotes carry the source report's own limitations.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts';
import { computeRadar, type Point, type RadarResult } from '@/lib/models/cycle-low-radar';

interface SeriesPoint {
  date: string;
  close: number;
}

const NAS_COLOR = '#38bdf8';
const GOLD_COLOR = '#eab308';
const SPOT_COLOR = '#60a5fa';
const REALIZED_COLOR = '#34d399';
const CURRENT_COLOR = '#f47c6a';
const PRIOR_COLORS = ['#55534d', '#6d6a63', '#8a877f'];

function fmtPrice(v: number): string {
  if (!Number.isFinite(v)) return '';
  if (v >= 1000) return `$${(v / 1000).toFixed(v >= 100_000 ? 0 : 1)}K`;
  if (v >= 10) return `$${v.toFixed(0)}`;
  return `$${v.toFixed(2)}`;
}

interface RadarApi {
  ndx: Point[];
  gold: Point[];
  realized: Point[];
  stale?: boolean;
}

export default function CycleLowRadarChart({ series }: { series: SeriesPoint[] }) {
  const [external, setExternal] = useState<RadarApi | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/radar')
      .then(res => (res.ok ? res.json() : null))
      .then(json => {
        if (cancelled) return;
        if (json && Array.isArray(json.ndx)) setExternal(json);
        else setFailed(true);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, []);

  const radar: RadarResult | null = useMemo(() => {
    if (!external || series.length < 200) return null;
    try {
      return computeRadar(
        series.map(s => ({ date: s.date, value: s.close })),
        external.ndx,
        external.gold,
        external.realized
      );
    } catch {
      return null;
    }
  }, [external, series]);

  // RSI chart rows: NAS + Gold aligned on NAS dates
  const rsiRows = useMemo(() => {
    if (!radar) return [];
    const goldByDate = new Map(radar.gold.series.map(p => [p.date, p.value]));
    return radar.nas.series.map(p => ({
      date: p.date,
      nas: p.value,
      gold: goldByDate.get(p.date),
    }));
  }, [radar]);

  // Realized-price rows, downsampled
  const realizedRows = useMemo(() => {
    if (!radar) return [];
    const j = radar.realized.joined;
    const step = Math.max(1, Math.ceil(j.length / 1100));
    const out = [];
    for (let i = 0; i < j.length; i += step) out.push(j[i]);
    if (out[out.length - 1]?.date !== j[j.length - 1].date) out.push(j[j.length - 1]);
    return out;
  }, [radar]);

  // Cycle-clock rows: week index → drawdown per path
  const clockRows = useMemo(() => {
    if (!radar) return [];
    const maxW = Math.max(
      radar.clock.current.drawdownByWeek.length,
      ...radar.clock.priors.map(p => p.drawdownByWeek.length)
    );
    const rows = [];
    for (let w = 0; w < maxW; w++) {
      const row: Record<string, number> = { week: w };
      radar.clock.priors.forEach(p => {
        if (w < p.drawdownByWeek.length) row[p.label] = -p.drawdownByWeek[w] * 100;
      });
      if (w < radar.clock.current.drawdownByWeek.length) {
        row.current = -radar.clock.current.drawdownByWeek[w] * 100;
      }
      rows.push(row);
    }
    return rows;
  }, [radar]);

  const fmtYear = (d: string) => String(new Date(d).getFullYear());

  if (failed) {
    return (
      <section className="rounded-2xl border px-4 sm:px-6 py-5" style={{ borderColor: 'var(--hairline)', background: 'var(--surface)' }}>
        <h3 className="font-display text-2xl" style={{ color: 'var(--foreground)' }}>Cycle Low Radar</h3>
        <p className="text-[12px] mt-3" style={{ color: 'var(--faint)' }}>
          External series unavailable (Nasdaq/gold via Yahoo Finance, realized price via
          bitcoin-data.com). Reload later if this persists.
        </p>
      </section>
    );
  }
  if (!radar) {
    return (
      <section className="rounded-2xl border px-4 sm:px-6 py-5" style={{ borderColor: 'var(--hairline)', background: 'var(--surface)' }}>
        <h3 className="font-display text-2xl" style={{ color: 'var(--foreground)' }}>Cycle Low Radar</h3>
        <p className="text-[12px] mt-3" style={{ color: 'var(--faint)' }}>
          {external
            ? 'External series arrived but were too short to compute the signals — the server cache may be malformed; reload later.'
            : 'Loading external series…'}
        </p>
      </section>
    );
  }

  const tailCount = radar.signals.filter(s => s.inTail).length;

  return (
    <section className="rounded-2xl border px-4 sm:px-6 py-5" style={{ borderColor: 'var(--hairline)', background: 'var(--surface)' }}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
        <h3 className="font-display text-2xl" style={{ color: 'var(--foreground)' }}>
          Cycle Low Radar
        </h3>
        <span className="text-[10px] uppercase tracking-[0.14em]" style={{ color: 'var(--faint)' }}>
          condition basket · descriptive, not a signal service
        </span>
      </div>
      <p className="text-[12px] mb-4" style={{ color: 'var(--muted)' }}>
        High-timeframe cycle-low conditions after the Blockworks methodology —{' '}
        <span style={{ color: 'var(--foreground)' }}>{tailCount} of 4</span> signals in their
        historical tail zone{external?.stale ? ' · external data from stale cache' : ''}.
      </p>

      {/* signal chips */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 mb-6">
        {radar.signals.map(s => (
          <div
            key={s.key}
            className="rounded-lg border px-3 py-2"
            style={{
              borderColor: s.inTail ? 'rgba(234,179,8,0.45)' : 'var(--hairline)',
              background: s.inTail ? 'rgba(234,179,8,0.06)' : 'var(--control-bg)',
            }}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--faint)' }}>
                {s.label}
              </span>
              {s.inTail && (
                <span className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--accent)' }}>
                  tail
                </span>
              )}
            </div>
            <div className="text-[17px] tabular-nums mt-0.5" style={{ color: s.inTail ? 'var(--accent)' : 'var(--foreground)' }}>
              {s.reading}
            </div>
            <div className="text-[10px] mt-0.5" style={{ color: 'var(--muted)' }}>{s.detail}</div>
          </div>
        ))}
      </div>

      {/* 1 · relative-strength oscillators */}
      <div className="text-[10px] uppercase tracking-[0.14em] mb-1" style={{ color: 'var(--faint)' }}>
        NAS100/BTC & Gold/BTC · 14w RSI smoothed with 14w SMA · weekly
      </div>
      <div className="h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rsiRows} margin={{ top: 6, right: 12, left: 0, bottom: 2 }}>
            <XAxis dataKey="date" tickFormatter={fmtYear} stroke="#4b5563" tick={{ fill: '#8a877f', fontSize: 10 }} interval="preserveStartEnd" minTickGap={44} />
            <YAxis domain={[0, 100]} stroke="#4b5563" tick={{ fill: '#8a877f', fontSize: 10 }} width={30} />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload || payload.length === 0) return null;
                const row = payload[0].payload as { date: string; nas: number; gold?: number };
                return (
                  <div className="rounded border px-2.5 py-1.5 text-[11px]" style={{ borderColor: 'var(--hairline)', background: 'var(--surface)' }}>
                    <div style={{ color: 'var(--foreground)' }}>{row.date}</div>
                    <div style={{ color: NAS_COLOR }}>NAS100/BTC {row.nas?.toFixed(1)}</div>
                    {row.gold !== undefined && <div style={{ color: GOLD_COLOR }}>Gold/BTC {row.gold.toFixed(1)}</div>}
                  </div>
                );
              }}
            />
            <ReferenceLine y={65} stroke="rgba(234,179,8,0.35)" strokeDasharray="4 4" label={{ value: '65', fill: 'rgba(234,179,8,0.6)', fontSize: 9, position: 'right' }} />
            <ReferenceLine y={70} stroke="rgba(220,38,38,0.4)" strokeDasharray="4 4" label={{ value: '70', fill: 'rgba(220,38,38,0.7)', fontSize: 9, position: 'right' }} />
            <Line dataKey="nas" stroke={NAS_COLOR} strokeWidth={1.5} dot={false} isAnimationActive={false} />
            <Line dataKey="gold" stroke={GOLD_COLOR} strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 mb-6 justify-center text-[11px]" style={{ color: 'var(--muted)' }}>
        <span className="flex items-center gap-1.5"><span className="w-4 h-0.5 rounded" style={{ background: NAS_COLOR }} />NAS100/BTC ({radar.nas.current.toFixed(1)} · {(radar.nas.pctAbove65 * 100).toFixed(1)}% of history ≥65)</span>
        <span className="flex items-center gap-1.5"><span className="w-4 h-0.5 rounded" style={{ background: GOLD_COLOR }} />Gold/BTC ({radar.gold.current.toFixed(1)} · {(radar.gold.pctAbove65 * 100).toFixed(1)}% ≥65)</span>
      </div>

      {/* 2 · spot vs realized price */}
      <div className="text-[10px] uppercase tracking-[0.14em] mb-1" style={{ color: 'var(--faint)' }}>
        BTC spot vs realized price (onchain cost basis) · log
      </div>
      <div className="h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={realizedRows} margin={{ top: 6, right: 12, left: 0, bottom: 2 }}>
            <XAxis dataKey="date" tickFormatter={fmtYear} stroke="#4b5563" tick={{ fill: '#8a877f', fontSize: 10 }} interval="preserveStartEnd" minTickGap={44} />
            <YAxis scale="log" domain={['auto', 'auto']} tickFormatter={fmtPrice} stroke="#4b5563" tick={{ fill: '#8a877f', fontSize: 10 }} width={52} />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload || payload.length === 0) return null;
                const row = payload[0].payload as { date: string; spot: number; realized: number };
                return (
                  <div className="rounded border px-2.5 py-1.5 text-[11px]" style={{ borderColor: 'var(--hairline)', background: 'var(--surface)' }}>
                    <div style={{ color: 'var(--foreground)' }}>{row.date}</div>
                    <div style={{ color: SPOT_COLOR }}>spot {fmtPrice(row.spot)}</div>
                    <div style={{ color: REALIZED_COLOR }}>realized {fmtPrice(row.realized)}</div>
                    <div style={{ color: 'var(--muted)' }}>multiple {(row.spot / row.realized).toFixed(2)}×</div>
                  </div>
                );
              }}
            />
            <Line dataKey="spot" stroke={SPOT_COLOR} strokeWidth={1.4} dot={false} isAnimationActive={false} />
            <Line dataKey="realized" stroke={REALIZED_COLOR} strokeWidth={1.6} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 mb-6 justify-center text-[11px]" style={{ color: 'var(--muted)' }}>
        <span className="flex items-center gap-1.5"><span className="w-4 h-0.5 rounded" style={{ background: SPOT_COLOR }} />BTC spot ({fmtPrice(radar.realized.spotNow)})</span>
        <span className="flex items-center gap-1.5"><span className="w-4 h-0.5 rounded" style={{ background: REALIZED_COLOR }} />Realized price ({fmtPrice(radar.realized.realizedNow)} · {(radar.realized.pctHistoryBelow * 100).toFixed(0)}% of shown window below)</span>
      </div>

      {/* 3 · cycle drawdown clock */}
      <div className="text-[10px] uppercase tracking-[0.14em] mb-1" style={{ color: 'var(--faint)' }}>
        Cycle drawdown clock · max drawdown by weeks from ATH
      </div>
      <div className="h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={clockRows} margin={{ top: 6, right: 12, left: 0, bottom: 2 }}>
            <XAxis dataKey="week" type="number" domain={[0, 'dataMax']} stroke="#4b5563" tick={{ fill: '#8a877f', fontSize: 10 }} tickFormatter={(w: number) => `w${w}`} />
            <YAxis domain={['auto', 0]} tickFormatter={(v: number) => `${v.toFixed(0)}%`} stroke="#4b5563" tick={{ fill: '#8a877f', fontSize: 10 }} width={40} />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload || payload.length === 0) return null;
                return (
                  <div className="rounded border px-2.5 py-1.5 text-[11px]" style={{ borderColor: 'var(--hairline)', background: 'var(--surface)' }}>
                    <div style={{ color: 'var(--foreground)' }}>week {String(label)}</div>
                    {payload.map(p => (
                      <div key={String(p.dataKey)} style={{ color: String(p.color) }}>
                        {String(p.dataKey)} {Number(p.value).toFixed(0)}%
                      </div>
                    ))}
                  </div>
                );
              }}
            />
            <ReferenceLine x={60} stroke="rgba(167,139,250,0.38)" strokeDasharray="3 5" label={{ value: 'WK 60 · PRIOR TROUGHS SET BY HERE', fill: 'rgba(196,181,253,0.75)', fontSize: 9, position: 'insideTopRight' }} />
            {radar.clock.priors.map((p, i) => (
              <Line key={p.label} dataKey={p.label} stroke={PRIOR_COLORS[i % PRIOR_COLORS.length]} strokeWidth={1.1} dot={false} isAnimationActive={false} />
            ))}
            <Line dataKey="current" stroke={CURRENT_COLOR} strokeWidth={2} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 justify-center text-[11px]" style={{ color: 'var(--muted)' }}>
        <span className="flex items-center gap-1.5"><span className="w-4 h-0.5 rounded" style={{ background: CURRENT_COLOR }} />current cycle (wk {radar.clock.weeksSinceATH}, −{(radar.clock.drawdownNow * 100).toFixed(0)}%)</span>
        {radar.clock.priors.map((p, i) => (
          <span key={p.label} className="flex items-center gap-1.5"><span className="w-4 h-0.5 rounded" style={{ background: PRIOR_COLORS[i % PRIOR_COLORS.length] }} />{p.label} cycle</span>
        ))}
      </div>

      {/* honesty footnotes */}
      <div className="mt-5 grid gap-2 text-[12px] leading-relaxed border-t pt-4" style={{ color: 'var(--muted)', borderColor: 'var(--hairline)' }}>
        <div>
          <span className="uppercase text-[10px] tracking-[0.14em]" style={{ color: 'var(--faint)' }}>what · </span>
          Recreation of the Blockworks &ldquo;cycle low&rdquo; condition basket (Luke Leasure,
          Jul 2026): 14-week Wilder RSI of the NAS100/BTC and Gold/BTC weekly ratios smoothed with a
          14-week SMA (readings ≥65–70 are historical tail events characteristic of BTC
          high-timeframe lows), BTC spot vs the onchain realized price, and the drawdown-by-weeks
          cycle clock against the 2013/2017/2021 paths. Data: Yahoo Finance (^NDX, GC=F),
          bitcoin-data.com (realized price — its free tier serves only the trailing 4 years, so
          the below-realized share here covers that window; the source report&rsquo;s full-history
          figure is ~12%), cached 24h server-side.
        </div>
        <div>
          <span className="uppercase text-[10px] tracking-[0.14em]" style={{ color: 'var(--faint)' }}>honesty · </span>
          The source report&rsquo;s own limitations apply in full: effective sample sizes are tiny
          (≈3–4 episodes each), forward-return tables are descriptive of history, and the signals are
          NOT independent corroboration — relative-strength extremes, realized-price proximity and
          the cycle clock all largely measure the same fact (a deep, persistent drawdown). Structural
          change (ETFs, treasuries, derivatives depth) could break every relationship shown. These are
          conditions coincident with past lows, not mechanisms that cause them — context, not advice.
        </div>
      </div>
    </section>
  );
}

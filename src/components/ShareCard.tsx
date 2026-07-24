'use client';

/**
 * ShareCard — the auto-composed, phone-readable snapshot frame.
 *
 * Rendered off-screen at a FIXED 720px width and captured to PNG by
 * SharePanel (html-to-image, pixelRatio 2 → 1440px output). Everything is
 * sized for a phone screen: large numerals, high contrast, vertical layout.
 * Purely presentational — all values come from props (the same data the
 * hero renders); no analytical logic here.
 */

import { useMemo } from 'react';
import { ComposedChart, Line, Area, XAxis, YAxis } from 'recharts';
import { getRiskBand, getRiskAction } from '@/lib/risk/bands';
import {
  riskToColor,
  riskScaleCssGradient,
  buildRiskGradientStops,
} from '@/lib/risk/color-scale';
import type { FanYearRow } from './VerdictHero';

export const SHARE_CARD_WIDTH = 720;
const CHART_W = 656; // card width − 2×32 padding

export interface ShareCardProps {
  date: string;
  price: number;
  smoothedRisk: number;
  adjusted: number | null;
  priceChange7d: number | null;
  fanYear: FanYearRow[];
  riskYear: { date: string; price: number; adjusted: number | null }[];
}

/** Plain-text summary for message forwarding (Telegram/WhatsApp text share). */
export function buildShareText(p: ShareCardProps): string {
  const band = getRiskBand(p.smoothedRisk);
  const action = getRiskAction(p.smoothedRisk);
  const last = p.fanYear[p.fanYear.length - 1];
  const lines = [
    `BTC Risk Metric · ${new Date(p.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`,
    `Risk ${(p.smoothedRisk * 100).toFixed(1)}% — ${band.label} · ${action.text}`,
  ];
  if (p.adjusted != null) lines.push(`Cycle-adjusted ${(p.adjusted * 100).toFixed(1)}%`);
  lines.push(
    `BTC $${p.price.toLocaleString(undefined, { maximumFractionDigits: 0 })}` +
      (p.priceChange7d != null ? ` (${p.priceChange7d >= 0 ? '+' : ''}${(p.priceChange7d * 100).toFixed(1)}% · 7d)` : '')
  );
  if (last) {
    lines.push(
      `Fan today: ${last.tauLabel} · Q50 $${(last.q50 / 1000).toFixed(1)}K · Q99 $${(last.q99 / 1000).toFixed(1)}K · Q01 $${(last.q01 / 1000).toFixed(1)}K`
    );
  }
  return lines.join('\n');
}

const fmtK = (v: number) => (v >= 1000 ? `$${(v / 1000).toFixed(1)}K` : `$${v.toFixed(0)}`);

const monthTick = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short' });

export default function ShareCard(props: ShareCardProps) {
  const { date, price, smoothedRisk, adjusted, priceChange7d, fanYear, riskYear } = props;
  const band = getRiskBand(smoothedRisk);
  const action = getRiskAction(smoothedRisk);
  const last = fanYear[fanYear.length - 1];

  const gradientStops = useMemo(() => {
    const risks = riskYear.map(d => d.adjusted ?? NaN);
    return buildRiskGradientStops(risks, { included: i => Number.isFinite(risks[i]) });
  }, [riskYear]);

  const fanRows = useMemo(() => {
    if (!last) return [];
    return [
      { label: 'Q99', value: last.q99, color: '#dc2626', bold: false },
      { label: 'Q95', value: last.q95, color: '#ef4444', bold: false },
      { label: 'Q75', value: last.q75, color: '#f472b6', bold: false },
      { label: 'Q50', value: last.q50, color: '#9ca3af', bold: false },
      { label: 'Q25', value: last.q25, color: '#86efac', bold: false },
      { label: 'Q10', value: last.q10, color: '#22c55e', bold: false },
      { label: 'Q01', value: last.q01, color: '#15803d', bold: false },
      { label: 'price', value: last.price, color: '#60a5fa', bold: true },
    ].sort((a, b) => b.value - a.value);
  }, [last]);

  return (
    <div
      style={{
        width: SHARE_CARD_WIDTH,
        background: '#0b0b0d',
        color: '#e8e6e1',
        padding: 32,
        fontFamily: 'var(--font-data), ui-monospace, monospace',
        fontVariantNumeric: 'tabular-nums',
        border: '1px solid rgba(232,230,225,0.14)',
        borderRadius: 16,
      }}
    >
      {/* header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: 15, letterSpacing: '0.16em', color: '#8a877f' }}>
          BTC RISK METRIC
        </span>
        <span style={{ fontSize: 15, color: '#8a877f' }}>
          {new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
        </span>
      </div>

      {/* verdict block */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 20, marginTop: 18 }}>
        <span style={{ fontSize: 64, fontWeight: 700, lineHeight: 1, color: band.color }}>
          {(smoothedRisk * 100).toFixed(1)}%
        </span>
        <div>
          <div style={{ fontSize: 26, color: band.color }}>{band.label}</div>
          <div style={{ fontSize: 17, color: '#b5b2aa', marginTop: 2 }}>{action.text}</div>
        </div>
      </div>

      {/* key stats row */}
      <div
        style={{
          display: 'flex',
          gap: 28,
          marginTop: 18,
          paddingTop: 14,
          borderTop: '1px solid rgba(232,230,225,0.1)',
          fontSize: 17,
        }}
      >
        <div>
          <div style={{ fontSize: 12, letterSpacing: '0.12em', color: '#55534d' }}>BTC PRICE</div>
          <div style={{ marginTop: 2 }}>
            ${price.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            {priceChange7d != null && (
              <span style={{ color: priceChange7d >= 0 ? '#22c55e' : '#ef4444', fontSize: 14, marginLeft: 8 }}>
                {priceChange7d >= 0 ? '+' : ''}
                {(priceChange7d * 100).toFixed(1)}% · 7d
              </span>
            )}
          </div>
        </div>
        {adjusted != null && (
          <div>
            <div style={{ fontSize: 12, letterSpacing: '0.12em', color: '#55534d' }}>CYCLE-ADJUSTED</div>
            <div style={{ marginTop: 2, color: riskToColor(adjusted) }}>{(adjusted * 100).toFixed(1)}%</div>
          </div>
        )}
        {last && (
          <div>
            <div style={{ fontSize: 12, letterSpacing: '0.12em', color: '#55534d' }}>FAN POSITION</div>
            <div style={{ marginTop: 2, color: '#60a5fa' }}>{last.tauLabel}</div>
          </div>
        )}
      </div>

      {/* risk-colored strip */}
      <div style={{ marginTop: 22 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <span style={{ fontSize: 12, letterSpacing: '0.12em', color: '#55534d' }}>
            RISK-COLORED PRICE · CYCLE-ADJUSTED · 12 MONTHS · LOG
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#8a877f' }}>
            <span
              style={{ display: 'inline-block', width: 64, height: 5, borderRadius: 3, background: riskScaleCssGradient(9) }}
            />
            low → high
          </span>
        </div>
        <ComposedChart width={CHART_W} height={170} data={riskYear} margin={{ top: 4, right: 14, left: 14, bottom: 0 }}>
          <defs>
            <linearGradient id="shareRiskGradient" x1="0" y1="0" x2="1" y2="0">
              {gradientStops.map((s, i) => (
                <stop key={i} offset={`${(s.offset * 100).toFixed(3)}%`} stopColor={s.color} stopOpacity={s.opacity} />
              ))}
            </linearGradient>
          </defs>
          <XAxis
            dataKey="date"
            tickFormatter={monthTick}
            interval={Math.max(0, Math.floor(riskYear.length / 6) - 1)}
            axisLine={false}
            tickLine={false}
            tick={{ fill: '#8a877f', fontSize: 13 }}
            height={20}
          />
          <YAxis scale="log" domain={['auto', 'auto']} hide />
          <Line
            dataKey="price"
            stroke="url(#shareRiskGradient)"
            strokeWidth={3}
            strokeLinecap="round"
            dot={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </div>

      {/* quantile fan + value rail */}
      {fanYear.length >= 30 && last && (
        <div style={{ marginTop: 20 }}>
          <div style={{ fontSize: 12, letterSpacing: '0.12em', color: '#55534d', marginBottom: 4 }}>
            QUANTILE FAN · 12 MONTHS · LOG · Q1–Q99
          </div>
          <div style={{ display: 'flex', gap: 14 }}>
            <ComposedChart
              width={CHART_W - 128}
              height={190}
              data={fanYear}
              margin={{ top: 4, right: 14, left: 14, bottom: 0 }}
            >
              <XAxis
                dataKey="date"
                tickFormatter={monthTick}
                interval={Math.max(0, Math.floor(fanYear.length / 6) - 1)}
                axisLine={false}
                tickLine={false}
                tick={{ fill: '#8a877f', fontSize: 13 }}
                height={20}
              />
              <YAxis scale="log" domain={['auto', 'auto']} hide />
              <Area dataKey="hiBand" stroke="none" fill="#dc2626" fillOpacity={0.08} isAnimationActive={false} />
              <Area dataKey="loBand" stroke="none" fill="#22c55e" fillOpacity={0.07} isAnimationActive={false} />
              <Line dataKey="q99" stroke="#dc2626" strokeWidth={1.2} dot={false} isAnimationActive={false} />
              <Line dataKey="q95" stroke="#ef4444" strokeWidth={1.2} dot={false} isAnimationActive={false} />
              <Line dataKey="q75" stroke="#f472b6" strokeWidth={1.2} dot={false} isAnimationActive={false} />
              <Line dataKey="q50" stroke="#9ca3af" strokeWidth={1.8} dot={false} isAnimationActive={false} />
              <Line dataKey="q25" stroke="#86efac" strokeWidth={1.2} dot={false} isAnimationActive={false} />
              <Line dataKey="q10" stroke="#22c55e" strokeWidth={1.2} dot={false} isAnimationActive={false} />
              <Line dataKey="q01" stroke="#15803d" strokeWidth={1.2} dot={false} isAnimationActive={false} />
              <Line dataKey="price" stroke="#60a5fa" strokeWidth={2.4} dot={false} isAnimationActive={false} />
            </ComposedChart>
            <div
              style={{
                width: 114,
                height: 190,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                padding: '2px 0 20px',
                fontSize: 15,
              }}
            >
              {fanRows.map(r => (
                <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', lineHeight: 1 }}>
                  <span style={{ color: r.color, fontWeight: r.bold ? 700 : 400 }}>{r.label}</span>
                  <span style={{ color: r.bold ? '#60a5fa' : '#8a877f', fontWeight: r.bold ? 700 : 400 }}>
                    {fmtK(r.value)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* footer */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginTop: 20,
          paddingTop: 12,
          borderTop: '1px solid rgba(232,230,225,0.1)',
          fontSize: 12,
          color: '#55534d',
        }}
      >
        <span>btc.dataniilo.fi</span>
        <span>personal decision-support · not financial advice</span>
      </div>
    </div>
  );
}

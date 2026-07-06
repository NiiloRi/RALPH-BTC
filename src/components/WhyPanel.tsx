'use client';

/**
 * WhyPanel — "why this score?", ordered by what actually matters.
 *
 * Component rows sorted by |weighted pull| on the raw ensemble (exact
 * identity: raw = 0.5 + Σ pulls). Each row expands into a plain-language
 * explanation of what the component measures, how it is computed in the
 * SERVED model, and its known caveats — the honesty layer as first-class UI.
 */

import { useState, useMemo } from 'react';
import { computePulls, type HeroDataPoint } from './VerdictHero';

interface MacroComponents {
  m2Signal: number;
  fedFundsSignal: number;
  yieldCurveSignal: number;
  realRateSignal: number;
}

interface WhyPanelProps {
  latest: HeroDataPoint & { macroComponents?: MacroComponents };
  macroAvailable: boolean | null;
}

const EXPLAIN: Record<string, { what: string; how: string; caveat: string }> = {
  valuation: {
    what: 'Is price expensive relative to its own long-term trend?',
    how: 'Mayer Multiple (price ÷ 200-day MA, 50%) blended with ATH proximity (1 − drawdown, 50%).',
    caveat: 'Shares the ATH input with Attention — near all-time highs these two rise together.',
  },
  cycle: {
    what: 'Where are we in the ~4-year halving cycle?',
    how: 'Time since confirmed cycle low + halving timing + historical peak window + euphoria zone (>800d from low). Library v2, 27 unit tests.',
    caveat: 'Fitted to 3–4 past cycles. Anchored on lows only confirmable in hindsight, and it cannot know if the top is already in — a pure clock, price-blind.',
  },
  momentum: {
    what: 'Is price moving up too fast?',
    how: 'RSI-14 (60%) blended with 90-day rate of change (40%).',
    caveat: 'Noisy in ranging markets; RSI-14 on daily data reacts to short squeezes.',
  },
  macro: {
    what: 'Is the liquidity environment fueling risk-taking?',
    how: 'M2 YoY 35%, Fed Funds 25%, yield curve 20%, real rate 20% — from FRED, publication-lagged.',
    caveat: 'Contrarian direction: LOOSE money raises this risk score (top-fuel logic). Monthly data, slow.',
  },
  attention: {
    what: 'Is retail attention/euphoria elevated?',
    how: 'Price-action proxy: return magnitude, ATH proximity and break frequency, volatility spikes, fear/greed blend.',
    caveat: 'A proxy, not measured attention — no live Trends/F&G feed wired in yet.',
  },
  volatility: {
    what: 'How unstable is the market right now?',
    how: '30-day realized volatility, annualized, capped at 150%.',
    caveat: 'High vol happens at bottoms too — direction is ambiguous, hence only 6% weight.',
  },
};

const MACRO_SUBS: { key: keyof MacroComponents; label: string; note: string }[] = [
  { key: 'm2Signal', label: 'M2 YoY', note: 'money supply growth' },
  { key: 'fedFundsSignal', label: 'Fed Funds', note: 'low rates = bullish signal' },
  { key: 'yieldCurveSignal', label: 'Yield curve', note: '10y−2y spread' },
  { key: 'realRateSignal', label: 'Real rate', note: 'TIPS 10y, inverted' },
];

export default function WhyPanel({ latest, macroAvailable }: WhyPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const pulls = useMemo(() => computePulls(latest.components), [latest.components]);
  const maxAbs = Math.max(...pulls.map(p => Math.abs(p.pull)), 0.001);

  // Top up/down driver for the collapsed teaser
  const up = pulls.find(p => p.pull > 0.005);
  const down = pulls.find(p => p.pull < -0.005);

  return (
    <section className="rounded-2xl border px-6 py-5" style={{ borderColor: 'var(--hairline)', background: 'var(--surface)' }}>
      {/* Collapsible header */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-left"
        aria-expanded={expanded}
      >
        <div className="flex items-baseline gap-3">
          <h3 className="font-display text-2xl" style={{ color: 'var(--foreground)' }}>Why this score?</h3>
          {!expanded && (up || down) && (
            <span className="text-[12px]" style={{ color: 'var(--faint)' }}>
              {up && <span style={{ color: '#f97316' }}>▲ {up.label}</span>}
              {up && down && <span> · </span>}
              {down && <span style={{ color: '#22c55e' }}>▼ {down.label}</span>}
            </span>
          )}
        </div>
        <span className="flex items-center gap-3">
          <span className="text-[10px] uppercase tracking-[0.14em]" style={{ color: 'var(--faint)' }}>
            {expanded ? 'sorted by influence · raw = 50% + Σ pull' : 'component breakdown'}
          </span>
          <span className="text-lg leading-none w-4 text-center" style={{ color: 'var(--muted)' }}>
            {expanded ? '−' : '+'}
          </span>
        </span>
      </button>

      {expanded && (
        <>
      <p className="text-[11px] mb-4 mt-3" style={{ color: 'var(--faint)' }}>
        Pull = weight × (component − 50%), in raw-score points before sigmoid calibration. Click a row for method &amp; caveats.
      </p>

      <div>
        {pulls.map((p, i) => {
          const isFallback = p.key === 'macro' && macroAvailable === false;
          const isOpen = open === p.key;
          const pullColor = Math.abs(p.pull) < 0.005 ? 'var(--faint)' : p.pull > 0 ? '#f97316' : '#22c55e';
          const ex = EXPLAIN[p.key];
          return (
            <div key={p.key} className="rise border-b last:border-b-0" style={{ borderColor: 'var(--hairline)', animationDelay: `${0.1 + i * 0.05}s` }}>
              <button
                onClick={() => setOpen(isOpen ? null : p.key)}
                className="w-full grid grid-cols-[7.5rem_1fr_4.5rem_5rem_1.5rem] items-center gap-3 py-3 text-left hover:bg-white/[0.02] transition-colors"
                aria-expanded={isOpen}
              >
                <div>
                  <span className="text-sm" style={{ color: 'var(--foreground)' }}>{p.label}</span>
                  <span className="block text-[10px]" style={{ color: 'var(--faint)' }}>w {(p.weight * 100).toFixed(0)}%</span>
                </div>
                {/* score bar with neutral tick at 50% */}
                <div className="relative h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(232,230,225,0.06)' }}>
                  <div
                    className="absolute inset-y-0 left-0 rounded-full transition-all duration-700"
                    style={{ width: `${p.score * 100}%`, background: isFallback ? 'var(--faint)' : 'var(--muted)' }}
                  />
                  <div className="absolute inset-y-0 left-1/2 w-px" style={{ background: 'var(--faint)' }} />
                </div>
                <div className="text-sm text-right" style={{ color: isFallback ? 'var(--faint)' : 'var(--foreground)' }}>
                  {isFallback ? 'n/a' : `${(p.score * 100).toFixed(0)}%`}
                </div>
                <div className="text-sm text-right" style={{ color: pullColor }}>
                  {p.pull > 0 ? '+' : ''}{(p.pull * 100).toFixed(1)}pp
                  <span
                    className="block h-0.5 mt-1 ml-auto rounded-full"
                    style={{ width: `${(Math.abs(p.pull) / maxAbs) * 100}%`, background: pullColor, opacity: 0.6 }}
                  />
                </div>
                <div className="text-right text-xs" style={{ color: 'var(--faint)' }}>{isOpen ? '−' : '+'}</div>
              </button>

              {isOpen && ex && (
                <div className="pb-4 pl-1 pr-8 grid gap-2 text-[12px] leading-relaxed" style={{ color: 'var(--muted)' }}>
                  <div><span className="uppercase text-[10px] tracking-[0.14em]" style={{ color: 'var(--faint)' }}>measures · </span>{ex.what}</div>
                  <div><span className="uppercase text-[10px] tracking-[0.14em]" style={{ color: 'var(--faint)' }}>method · </span>{ex.how}</div>
                  <div><span className="uppercase text-[10px] tracking-[0.14em]" style={{ color: 'var(--faint)' }}>caveat · </span>{ex.caveat}</div>

                  {p.key === 'macro' && latest.macroComponents && macroAvailable && (
                    <div className="mt-1 grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {MACRO_SUBS.map(s => (
                        <div key={s.key} className="rounded-lg border px-2.5 py-2" style={{ borderColor: 'var(--hairline)' }}>
                          <div className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--faint)' }}>{s.label}</div>
                          <div className="text-sm" style={{ color: 'var(--foreground)' }}>{(latest.macroComponents![s.key] * 100).toFixed(0)}%</div>
                          <div className="text-[10px]" style={{ color: 'var(--faint)' }}>{s.note}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {p.key === 'macro' && macroAvailable === false && (
                    <div className="text-[11px] text-yellow-500/80">
                      No FRED data — held at neutral 0.5 in the score, contributing 0pp. Set FRED_API_KEY to activate.
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
        </>
      )}
    </section>
  );
}

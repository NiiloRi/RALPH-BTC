'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Brush,
  ReferenceArea,
  CartesianGrid,
} from 'recharts';
import { HALVING_DATES } from '@/lib/types';
import {
  riskToColor,
  riskCategory,
  riskScaleCssGradient,
  buildRiskGradientStops,
} from '@/lib/risk/color-scale';
import { C, Segmented, Toggle } from './chart-ui';
import MetaLayersPanel from './MetaLayersPanel';
import { calculateSimplifiedMetaLayers, MetaLayersOutput } from '@/lib/meta';
import { getRiskBand, RISK_BANDS } from '@/lib/risk/bands';
import VerdictHero, { type FanYearRow } from './VerdictHero';
import { fitQuantileFan, evaluateFan, impliedQuantile } from '@/lib/quantile-fan/quantile-fan';
import WhyPanel from './WhyPanel';
import QuantileFanChart from './QuantileFanChart';
import { DEFAULT_WEIGHTS } from '@/lib/risk/model';
import { calculateAllCycleAdjusted } from '@/lib/adjusted/cycle-adjusted';
import { applyPriceConfirmedCycle } from '@/lib/adjusted/price-confirmed-cycle';
import { classifyDivergence } from '@/lib/adjusted/divergence';
import { calculateAllTopProximity } from '@/lib/adjusted/top-proximity';
import PowerLawChart from './PowerLawChart';
import S2FChart from './S2FChart';
import DifficultyChart from './DifficultyChart';
import CycleLowRadarChart from './CycleLowRadarChart';
import { fitPowerLaw, evaluatePowerLaw } from '@/lib/models/power-law';
import { fitS2F, evaluateS2F } from '@/lib/models/s2f';
import {
  joinDifficultyToPrices,
  fitDifficultyModel,
  evaluateDifficultyModel,
} from '@/lib/models/difficulty';
import type { DifficultyPoint } from '@/lib/data/difficulty-fetcher';
import type { ModelsYearRow } from './VerdictHero';
import { type OverviewCardPrefs } from '@/lib/auth/types';

interface UIDataPoint {
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
  macroComponents?: {
    m2Signal: number;
    fedFundsSignal: number;
    yieldCurveSignal: number;
    realRateSignal: number;
  };
  cyclePhase: 'early' | 'mid' | 'late';
  isHalving: boolean;
}

type TimeRange = 'all' | '1y' | '2y' | '3y' | '5y' | 'ytd';

/**
 * Chart display modes. 'colored' and 'combined' render the BTC price curve
 * with a per-observation risk-colored gradient (shared scale in
 * lib/risk/color-scale). This system SUPERSEDES the old "Heat Map" checkbox,
 * which drew the risk line as thousands of individual colored dots.
 */
type ChartMode = 'dual' | 'colored' | 'combined';

const CHART_MODES: { id: ChartMode; label: string; hint: string }[] = [
  { id: 'dual', label: 'Price + Risk', hint: 'BTC price with a separate risk series' },
  { id: 'colored', label: 'Risk-colored', hint: 'BTC price curve colored by its risk value' },
  { id: 'combined', label: 'Combined', hint: 'Risk-colored price plus the risk series' },
];


interface RiskFilter {
  min: number;
  max: number;
  enabled: boolean;
}

interface TooltipProps {
  active?: boolean;
  payload?: Array<{ payload: UIDataPoint & { adjusted?: number | null } }>;
  showAdjusted?: boolean;
}

/** Nearest halving within ±14 days of the given date, or null. */
function nearestHalvingContext(date: string): string | null {
  const t = new Date(date).getTime();
  for (const h of HALVING_DATES) {
    const diff = Math.round((t - h.getTime()) / 86400000);
    if (Math.abs(diff) <= 14) {
      if (diff === 0) return 'Halving day';
      return diff > 0 ? `${diff}d after halving` : `${-diff}d before halving`;
    }
  }
  return null;
}

function TooltipRow({
  label,
  value,
  swatch,
  valueColor,
}: {
  label: string;
  value: string;
  swatch?: string;
  valueColor?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-6 text-[12px] leading-5">
      <span className="flex items-center gap-1.5" style={{ color: 'var(--muted)' }}>
        {swatch && (
          <span
            aria-hidden
            className="inline-block w-2 h-2 rounded-[2px]"
            style={{ background: swatch }}
          />
        )}
        {label}
      </span>
      <span className="font-medium tabular-nums" style={{ color: valueColor ?? 'var(--foreground)' }}>
        {value}
      </span>
    </div>
  );
}

function CustomTooltip({ active, payload, showAdjusted }: TooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  const point = payload[0].payload;
  const cat = riskCategory(point.smoothedRisk);
  const halvingCtx = nearestHalvingContext(point.date);

  return (
    <div
      className="rounded-md border p-3 shadow-xl min-w-[210px]"
      style={{ background: 'rgba(16,16,19,0.96)', borderColor: 'var(--hairline)' }}
    >
      <div className="flex items-center justify-between gap-4 mb-2">
        <p className="text-[12px] font-medium" style={{ color: 'var(--foreground)' }}>
          {new Date(point.date).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          })}
        </p>
        <span
          className="rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider whitespace-nowrap"
          style={{ background: `${cat.color}22`, color: cat.color }}
        >
          {cat.label}
        </span>
      </div>
      <div className="space-y-0.5">
        <TooltipRow
          label="BTC price"
          value={`$${point.price.toLocaleString(undefined, { maximumFractionDigits: point.price < 10 ? 2 : 0 })}`}
          swatch={C.price}
        />
        <TooltipRow
          label="Risk"
          value={`${(point.risk * 100).toFixed(1)}%`}
          swatch={riskToColor(point.risk)}
          valueColor={riskToColor(point.risk)}
        />
        <TooltipRow
          label="Smoothed"
          value={`${(point.smoothedRisk * 100).toFixed(1)}%`}
          swatch={riskToColor(point.smoothedRisk)}
          valueColor={riskToColor(point.smoothedRisk)}
        />
        {showAdjusted && (
          <TooltipRow
            label="Cycle-adjusted"
            value={point.adjusted != null ? `${(point.adjusted * 100).toFixed(1)}%` : 'n/a'}
            swatch={C.adjusted}
            valueColor={C.adjusted}
          />
        )}
        <TooltipRow label="Phase" value={point.cyclePhase} />
      </div>
      {halvingCtx && (
        <p
          className="mt-2 pt-1.5 border-t text-[10px] uppercase tracking-wider"
          style={{ borderColor: 'var(--hairline)', color: C.halvingLabel }}
        >
          {halvingCtx}
        </p>
      )}
    </div>
  );
}


function ComponentsTooltip({ active, payload }: TooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  const point = payload[0].payload;
  const components = [
    { key: 'valuation', label: 'Valuation', color: '#3b82f6' },
    { key: 'momentum', label: 'Momentum', color: '#22c55e' },
    { key: 'volatility', label: 'Volatility', color: '#f97316' },
    { key: 'cycle', label: 'Cycle', color: '#a855f7' },
    { key: 'macro', label: 'Macro', color: '#06b6d4' },
    { key: 'attention', label: 'Attention', color: '#eab308' },
  ];

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-900 p-3 shadow-lg min-w-[180px]">
      <p className="font-medium text-white mb-2 text-sm">
        {new Date(point.date).toLocaleDateString()}
      </p>
      <div className="space-y-1">
        {components.map(({ key, label, color }) => (
          <div key={key} className="flex justify-between text-sm">
            <span style={{ color }}>{label}:</span>
            <span className="text-white">
              {((point.components[key as keyof typeof point.components]) * 100).toFixed(0)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

type Tab = 'overview' | 'risk' | 'fan' | 'powerlaw' | 's2f' | 'difficulty' | 'radar';

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'risk', label: 'Risk metric' },
  { id: 'fan', label: 'Quantile fan' },
  { id: 'powerlaw', label: 'Power law' },
  { id: 's2f', label: 'Stock-to-flow' },
  { id: 'difficulty', label: 'Difficulty' },
  { id: 'radar', label: 'Cycle low radar' },
];

function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  return (
    <div className="flex items-center gap-1.5 sm:gap-2" role="tablist" aria-label="Dashboard views">
      {TABS.map(t => {
        const on = t.id === active;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.id)}
            className="flex-1 sm:flex-none rounded-xl border px-2 py-2.5 sm:px-4 sm:py-2 text-[10px] sm:text-[11px] uppercase tracking-[0.1em] sm:tracking-[0.14em] transition-colors"
            style={{
              borderColor: on ? 'var(--muted)' : 'var(--hairline)',
              background: on ? 'rgba(232,230,225,0.05)' : 'transparent',
              color: on ? 'var(--foreground)' : 'var(--faint)',
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

export default function RiskDashboard() {
  const [data, setData] = useState<UIDataPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [dataSource, setDataSource] = useState<string>('');
  const [isLiveSource, setIsLiveSource] = useState(false);
  const [loadedAtMs, setLoadedAtMs] = useState<number | null>(null);
  const [macroAvailable, setMacroAvailable] = useState<boolean | null>(null);
  const [priceSeries, setPriceSeries] = useState<{ date: string; close: number }[] | null>(null);
  // Network difficulty history (blockchain.info via our cached API route).
  // Non-blocking: charts and hero minis degrade gracefully while null.
  const [difficultySeries, setDifficultySeries] = useState<DifficultyPoint[] | null>(null);
  // Per-user overview-card preferences (null until loaded → hero uses defaults)
  const [overviewCards, setOverviewCards] = useState<OverviewCardPrefs | null>(null);
  // Default to the last year on mobile (the full 5000+ day view is illegible
  // on a phone); desktop shows all history. Applied via a matchMedia listener
  // (robust to load-time viewport timing) until the user picks a range.
  const [timeRange, setTimeRange] = useState<TimeRange>('all');
  const userPickedRange = useRef(false);
  const [showSmoothed, setShowSmoothed] = useState(true);
  // Simple moving average (days) applied to the risk line. Default 7d so the
  // curve is legible out of the box; 1 = off. Numeric — replaced the old slider.
  const [smoothingDays, setSmoothingDays] = useState(7);
  const [showComponents, setShowComponents] = useState(false);
  const [showMacroComponents, setShowMacroComponents] = useState(false);
  const [showHalvings, setShowHalvings] = useState(true);
  const [logScale, setLogScale] = useState(true);
  // Chart display mode — supersedes the old "Heat Map" checkbox (which drew
  // the risk line as per-point dots); risk-by-color now lives on the price
  // curve itself in 'colored'/'combined' modes.
  const [chartMode, setChartMode] = useState<ChartMode>('dual');
  const [riskFilter, setRiskFilter] = useState<RiskFilter>({
    min: 0,
    max: 100,
    enabled: false,
  });
  const [showMetaLayers, setShowMetaLayers] = useState(true);
  const [showAdjusted, setShowAdjusted] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('overview');

  // Zoom state
  const [zoomStart, setZoomStart] = useState<number | null>(null);
  const [zoomEnd, setZoomEnd] = useState<number | null>(null);
  const [refAreaLeft, setRefAreaLeft] = useState<string | null>(null);
  const [refAreaRight, setRefAreaRight] = useState<string | null>(null);

  // Apply the mobile (≤640px) default range of 1Y until the user picks one.
  // A matchMedia listener re-applies on viewport changes, so it's correct
  // regardless of when the viewport settles at load.
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    const apply = () => {
      if (!userPickedRange.current) setTimeRange(mq.matches ? '1y' : 'all');
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  // Load data - fetch fresh from Binance API on every page load
  useEffect(() => {
    async function loadData() {
      setLoading(true);
      setError(null);

      try {
        // First, try to fetch fresh data from API (Binance) with 15s timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        const apiResponse = await fetch('/api/risk-data', {
          cache: 'no-store',
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (apiResponse.ok) {
          const apiData = await apiResponse.json();
          setLoadedAtMs(Date.now());
          setData(apiData.data);
          setLastUpdated(apiData.lastUpdated);
          setDataSource(`Live from ${apiData.source}`);
          setIsLiveSource(true);
          setMacroAvailable(apiData.macroDataAvailable === true);
          setPriceSeries(Array.isArray(apiData.priceSeries) ? apiData.priceSeries : null);
          setLoading(false);
          return;
        }

        // Session expired mid-tab: the static fallbacks would also 401 —
        // go straight to a clean re-login instead of a confusing error state.
        if (apiResponse.status === 401) {
          window.location.assign('/login');
          return;
        }
      } catch (apiError) {
        console.warn('API fetch failed, falling back to static data:', apiError);
      }

      // Fallback to static files
      try {
        let response = await fetch('/risk_data.json');

        if (!response.ok) {
          response = await fetch('/btc_risk_complete.csv');
          if (!response.ok) {
            response = await fetch('/btc_risk_binance.csv');
          }
        }

        if (response.status === 401) {
          // Session expired (API path timed out first) — clean re-login.
          window.location.assign('/login');
          return;
        }

        const text = await response.text();

        if (text.startsWith('[')) {
          setData(JSON.parse(text));
          setDataSource('Static JSON');
          setLoadedAtMs(Date.now());
          setIsLiveSource(false);
          setMacroAvailable(null); // unknown for static exports
        } else {
          const lines = text.trim().split('\n');
          const header = lines[0].split(',');
          const dateIdx = header.indexOf('date');
          const priceIdx = header.indexOf('price');
          const riskIdx = header.indexOf('risk');

          const parsed: UIDataPoint[] = lines.slice(1).map(line => {
            const values = line.split(',');
            return {
              date: values[dateIdx],
              price: parseFloat(values[priceIdx]),
              risk: parseFloat(values[riskIdx]),
              smoothedRisk: parseFloat(values[header.indexOf('smoothedRisk')] || values[riskIdx]),
              components: {
                valuation: parseFloat(values[header.indexOf('valuation')] || '0.5'),
                momentum: parseFloat(values[header.indexOf('momentum')] || '0.5'),
                volatility: parseFloat(values[header.indexOf('volatility')] || '0.5'),
                cycle: parseFloat(values[header.indexOf('cycle')] || '0.5'),
                macro: parseFloat(values[header.indexOf('macro')] || '0.5'),
                attention: parseFloat(values[header.indexOf('attention')] || '0.5'),
              },
              cyclePhase: (values[header.indexOf('cyclePhase')] as 'early' | 'mid' | 'late') || 'mid',
              isHalving: values[header.indexOf('isHalving')] === '1',
            };
          });

          setData(parsed);
          setDataSource('Static CSV');
          setLoadedAtMs(Date.now());
          setIsLiveSource(false);
          setMacroAvailable(null);
        }

        setLoading(false);
      } catch {
        setError('Failed to load data');
        setLoading(false);
      }
    }

    loadData();
  }, []);

  // Per-user card preferences — non-blocking; defaults apply until loaded.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/preferences')
      .then(res => (res.ok ? res.json() : null))
      .then(json => {
        if (!cancelled && json?.overviewCards) setOverviewCards(json.overviewCards);
      })
      .catch(() => {
        /* defaults (all cards visible) apply */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Fire-and-forget difficulty fetch — must never gate the main loading state.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/difficulty')
      .then(res => (res.ok ? res.json() : null))
      .then(json => {
        if (!cancelled && json && Array.isArray(json.points)) {
          setDifficultySeries(json.points);
        }
      })
      .catch(() => {
        /* difficulty chart + mini degrade to their absent states */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Filter data by time range and risk level
  // Layer 1 — cycle-adjusted risk series (read-only over the full dataset).
  // Round 4: the cycle clock is price-confirmed (noisy-OR with Top Proximity)
  // before recomposition — see docs/cycle-adjusted-risk.md §14.
  // Declared before the chart memos because chartData overlays it.
  const adjustedSeries = useMemo(() => {
    if (data.length < 30) return null;
    const inputs = applyPriceConfirmedCycle(
      data.map(d => ({ date: d.date, smoothedRisk: d.smoothedRisk, components: d.components })),
      data.map(d => ({ date: d.date, price: d.price }))
    );
    return calculateAllCycleAdjusted(inputs);
  }, [data]);
  const latestAdjusted = adjustedSeries ? adjustedSeries[adjustedSeries.length - 1].adjusted : null;
  const adjustedByDate = useMemo(() => {
    const m = new Map<string, number>();
    if (adjustedSeries) for (const r of adjustedSeries) if (r.adjusted !== null) m.set(r.date, r.adjusted);
    return m;
  }, [adjustedSeries]);

  // Cycle Top Proximity — "how close are we to a cycle top?" Never touches
  // the absolute score (Layer 0); since round 4 it price-confirms the cycle
  // clock inside Layer 1 (see adjustedSeries above). Answers the late-cycle
  // "near the top?" question that the time-only cycle component cannot.
  const topProximity = useMemo(() => {
    if (data.length < 30) return null;
    const res = calculateAllTopProximity(data.map(d => ({ date: d.date, price: d.price })));
    return res[res.length - 1];
  }, [data]);

  // Layer 3 — divergence state for the latest day.
  // RAW components on purpose — divergence exists to NAME the clock-vs-price
  // state; feeding it the price-confirmed cycle would hide what it reports.
  const divergence = useMemo(() => {
    if (data.length === 0) return null;
    const last = data[data.length - 1];
    const dataCompleteness = macroAvailable === true ? 1 : 0.86;
    return classifyDivergence({
      absolute: last.smoothedRisk,
      adjusted: latestAdjusted,
      components: last.components,
      dataCompleteness,
    });
  }, [data, latestAdjusted, macroAvailable]);

  const filteredData = useMemo(() => {
    if (data.length === 0) return [];

    let result = data;

    // Custom zoom takes precedence for time filtering
    if (zoomStart !== null && zoomEnd !== null) {
      result = result.filter(d => {
        const ts = new Date(d.date).getTime();
        return ts >= zoomStart && ts <= zoomEnd;
      });
    } else if (timeRange !== 'all') {
      const now = new Date();
      let startDate: Date;

      switch (timeRange) {
        case '1y':
          startDate = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
          break;
        case '2y':
          startDate = new Date(now.getFullYear() - 2, now.getMonth(), now.getDate());
          break;
        case '3y':
          startDate = new Date(now.getFullYear() - 3, now.getMonth(), now.getDate());
          break;
        case '5y':
          startDate = new Date(now.getFullYear() - 5, now.getMonth(), now.getDate());
          break;
        case 'ytd':
          startDate = new Date(now.getFullYear(), 0, 1);
          break;
        default:
          startDate = new Date(0);
      }
      result = result.filter(d => new Date(d.date) >= startDate);
    }

    // Note: risk level filter is NOT applied here - it's applied as null masking
    // in chartData so the price line and time axis stay intact

    return result;
  }, [data, timeRange, zoomStart, zoomEnd]);

  // Zoom handlers
  const handleMouseDown = (e: { activeLabel?: string | number }) => {
    if (e?.activeLabel !== undefined) {
      setRefAreaLeft(String(e.activeLabel));
      setRefAreaRight(null);
    }
  };

  const handleMouseMove = (e: { activeLabel?: string | number }) => {
    if (refAreaLeft && e?.activeLabel !== undefined) {
      setRefAreaRight(String(e.activeLabel));
    }
  };

  const handleMouseUp = () => {
    if (refAreaLeft && refAreaRight) {
      const left = new Date(refAreaLeft).getTime();
      const right = new Date(refAreaRight).getTime();

      if (left !== right) {
        setZoomStart(Math.min(left, right));
        setZoomEnd(Math.max(left, right));
      }
    }
    setRefAreaLeft(null);
    setRefAreaRight(null);
  };

  const resetZoom = () => {
    setZoomStart(null);
    setZoomEnd(null);
  };

  // Format functions
  const formatDate = (date: string) => {
    const d = new Date(date);
    return d.toLocaleDateString('en-US', { year: '2-digit', month: 'short' });
  };

  const formatPrice = (price: number) => {
    if (price >= 1000) return `$${(price / 1000).toFixed(0)}k`;
    return `$${price.toFixed(0)}`;
  };

  // Apply extra smoothing if requested. Carries the cycle-adjusted (Layer-1)
  // value alongside the absolute risk so both get the same SMA treatment.
  const extraSmoothedData = useMemo((): (UIDataPoint & { adjusted: number | null })[] => {
    const N = Math.round(smoothingDays);
    const withAdj = filteredData.map(d => ({ ...d, adjusted: adjustedByDate.get(d.date) ?? null }));
    if (N <= 1) return withAdj;

    // Trailing simple moving average over N days on the risk lines + adjusted
    const result: (UIDataPoint & { adjusted: number | null })[] = [];
    for (let i = 0; i < withAdj.length; i++) {
      const start = Math.max(0, i - N + 1);
      let sumRisk = 0, sumSmoothed = 0, sumAdj = 0, adjCount = 0, count = 0;
      for (let k = start; k <= i; k++) {
        sumRisk += withAdj[k].risk;
        sumSmoothed += withAdj[k].smoothedRisk;
        count++;
        const a = withAdj[k].adjusted;
        if (a !== null) { sumAdj += a; adjCount++; }
      }
      result.push({
        ...withAdj[i],
        risk: sumRisk / count,
        smoothedRisk: sumSmoothed / count,
        adjusted: adjCount > 0 ? sumAdj / adjCount : null,
      });
    }
    return result;
  }, [filteredData, smoothingDays, adjustedByDate]);

  // Build chart data: apply risk filter as null-masking.
  // This keeps the price line and time axis intact while hiding risk segments
  const chartData = useMemo(() => {
    return extraSmoothedData.map(d => {
      const riskValue = showSmoothed ? d.smoothedRisk : d.risk;

      // If risk filter is active, null out values outside the range
      let maskedRisk: number | null = d.risk;
      let maskedSmoothedRisk: number | null = d.smoothedRisk;
      let maskedAdjusted: number | null = d.adjusted;

      if (riskFilter.enabled) {
        const minRisk = riskFilter.min / 100;
        const maxRisk = riskFilter.max / 100;
        if (riskValue < minRisk || riskValue > maxRisk) {
          maskedRisk = null;
          maskedSmoothedRisk = null;
        }
        if (d.adjusted !== null && (d.adjusted < minRisk || d.adjusted > maxRisk)) {
          maskedAdjusted = null;
        }
      }

      return {
        ...d,
        filteredRisk: maskedRisk,
        filteredSmoothedRisk: maskedSmoothedRisk,
        filteredAdjusted: maskedAdjusted,
      };
    });
  }, [extraSmoothedData, showSmoothed, riskFilter]);

  // Gradient stops for the risk-colored price curve ('colored'/'combined').
  // ALIGNMENT: price and risk are fields of the SAME observation row, so the
  // color at each point is exactly that day's risk value. The coloring follows
  // the selected risk LENS: cycle-adjusted (Layer-1) values when that toggle
  // is on, otherwise the absolute risk (smoothed/raw per its toggle). Burn-in
  // days with no adjusted value render muted gray — never a fake neutral.
  // The gradient interpolates between adjacent observations only — no
  // lookahead. When the risk filter is on, out-of-range observations render
  // muted so the historical trajectory stays intact instead of being cut.
  const priceGradientStops = useMemo(() => {
    if (chartMode === 'dual' || chartData.length === 0) return null;
    const risks = chartData.map(d =>
      showAdjusted ? (d.adjusted ?? NaN) : showSmoothed ? d.smoothedRisk : d.risk
    );
    const included = (i: number) => {
      const r = risks[i];
      if (!Number.isFinite(r)) return false; // adjusted burn-in → muted
      if (!riskFilter.enabled) return true;
      return r >= riskFilter.min / 100 && r <= riskFilter.max / 100;
    };
    return buildRiskGradientStops(risks, { included });
  }, [chartData, chartMode, showSmoothed, showAdjusted, riskFilter]);

  // Get halving dates within visible range
  const visibleHalvings = useMemo(() => {
    if (!showHalvings || filteredData.length === 0) return [];

    const startDate = new Date(filteredData[0].date);
    const endDate = new Date(filteredData[filteredData.length - 1].date);

    return HALVING_DATES.filter(h => h >= startDate && h <= endDate)
      .map(h => h.toISOString().split('T')[0]);
  }, [filteredData, showHalvings]);

  // Calculate meta-layers for the latest data point.
  //
  // FIX: previously computed from `extraSmoothedData` (the display-filtered,
  // display-smoothed series), so zooming, the time-range buttons, and the
  // EMA slider silently CHANGED the reported confidence/momentum/guidance.
  // Meta-layers now always use the full raw dataset, so they describe the
  // model, not the current chart view.
  const currentMetaLayers = useMemo((): MetaLayersOutput | undefined => {
    if (data.length < 30) return undefined;

    const recentRisks = data.slice(-60).map(d => ({
      date: d.date,
      price: d.price,
      risk: d.risk,
      smoothedRisk: d.smoothedRisk,
      components: d.components,
    }));

    // When macro data is unavailable the macro component is a neutral 0.5
    // fallback (14% of the model), so data completeness drops accordingly.
    const dataCompleteness = macroAvailable === true ? 1 : 0.86;

    try {
      const meta = calculateSimplifiedMetaLayers(
        recentRisks[recentRisks.length - 1],
        recentRisks,
        { dataCompleteness }
      );
      return meta as MetaLayersOutput;
    } catch {
      return undefined;
    }
  }, [data, macroAvailable]);

  // Price vs 200-week SMA — classic long-horizon cycle context metric.
  // Display-only: NOT part of the risk score. Walk-forward safe (average of
  // the trailing 1400 daily closes).
  const sma200wRatio = useMemo((): number | null => {
    if (data.length < 200) return null;
    const closes = data.slice(-1400).map(d => d.price);
    const sma = closes.reduce((a, b) => a + b, 0) / closes.length;
    return sma > 0 ? data[data.length - 1].price / sma : null;
  }, [data]);


  // Quantile-fan inputs (stable references so the fan only refits on new data)
  const fanSeries = useMemo(
    () => priceSeries ?? data.map(d => ({ date: d.date, close: d.price })),
    [priceSeries, data]
  );
  const fanRiskSeries = useMemo(
    () => data.map(d => ({ date: d.date, risk: d.smoothedRisk })),
    [data]
  );

  // Hero risk-colored price strip: last 12 months, colored by the
  // cycle-adjusted (Layer-1) risk — rendered above the hero mini-fan.
  const heroRiskYear = useMemo(() => {
    if (data.length < 30) return [];
    return data.slice(-365).map(d => ({
      date: d.date,
      price: d.price,
      adjusted: adjustedByDate.get(d.date) ?? null,
    }));
  }, [data, adjustedByDate]);

  // Hero model minis: 12 months of price vs each valuation model. Full-history
  // fits (closed-form OLS, microseconds — same refit-duplication pattern as
  // heroFanYear below). Difficulty stays null until /api/difficulty lands;
  // the hero renders that cell only when values exist.
  const heroModelsYear = useMemo((): ModelsYearRow[] => {
    if (fanSeries.length < 300) return [];
    try {
      const dates = fanSeries.map(s => s.date);
      const closes = fanSeries.map(s => s.close);
      const pl = fitPowerLaw(dates, closes);
      const s2fModel = fitS2F(dates, closes);
      let diffByDate: Map<string, number> | null = null;
      let dm: ReturnType<typeof fitDifficultyModel> | null = null;
      if (difficultySeries && difficultySeries.length > 0) {
        const joined = joinDifficultyToPrices(fanSeries, difficultySeries);
        if (joined.length >= 100) {
          dm = fitDifficultyModel(joined);
          diffByDate = new Map(joined.map(r => [r.date, r.difficulty]));
        }
      }
      return fanSeries.slice(-365).map(p => {
        const d = diffByDate?.get(p.date);
        return {
          date: p.date,
          price: p.close,
          powerLaw: evaluatePowerLaw(pl, p.date).fair,
          s2f: evaluateS2F(s2fModel, p.date),
          difficulty: dm && d !== undefined ? evaluateDifficultyModel(dm, d) : null,
        };
      });
    } catch {
      return [];
    }
  }, [fanSeries, difficultySeries]);

  // Hero mini-fan: last 12 months of the quantile fan. Same deterministic
  // full-sample fit as the big fan chart (fit is ~60ms, memoized on data).
  const heroFanYear = useMemo((): FanYearRow[] => {
    if (fanSeries.length < 300) return [];
    try {
      const model = fitQuantileFan(fanSeries.map(s => s.date), fanSeries.map(s => s.close));
      return fanSeries.slice(-365).map(p => {
        const [q01, q10, q25, q50, q75, q95, q99] = evaluateFan(model, p.date);
        return {
          date: p.date,
          price: p.close,
          tauLabel: impliedQuantile(model, p.date, p.close).label,
          q01, q10, q25, q50, q75, q95, q99,
          hiBand: [q95, q99] as [number, number],
          loBand: [q01, q10] as [number, number],
        };
      });
    } catch {
      return [];
    }
  }, [fanSeries]);

  if (loading) {
    return (
      <div className="flex h-[600px] items-center justify-center">
        <div className="text-lg text-gray-500">Loading chart data...</div>
      </div>
    );
  }

  if (error || data.length === 0) {
    return (
      <div className="flex h-[600px] items-center justify-center">
        <div className="text-lg text-red-500">{error || 'No data available'}</div>
      </div>
    );
  }

  // Use full unfiltered data for the verdict so it always shows current values.
  // Headline = smoothed risk (canonical model output); VerdictHero derives
  // band/action/qualifiers from the canonical bands module internally.
  const latestData = data[data.length - 1];
  const band = getRiskBand(latestData.smoothedRisk); // legend highlight

  // Data freshness: warn when the newest data point is old (silent staleness
  // was previously possible via the static-file fallback).
  const staleDays = loadedAtMs === null
    ? 0
    : Math.max(0, Math.floor((loadedAtMs - new Date(latestData.date).getTime()) / 86400000));
  const isStale = staleDays > 2;
  const prev7d = data.length >= 8 ? data[data.length - 8] : null;

  const timeRangeButtons: { label: string; value: TimeRange }[] = [
    { label: 'YTD', value: 'ytd' },
    { label: '1Y', value: '1y' },
    { label: '2Y', value: '2y' },
    { label: '3Y', value: '3y' },
    { label: '5Y', value: '5y' },
    { label: 'All', value: 'all' },
  ];

  return (
    <div className="w-full space-y-6">
      {/* Tab bar — sits above the front-page card */}
      <TabBar active={activeTab} onChange={setActiveTab} />

      {/* Quantile fan — its own tab */}
      {activeTab === 'fan' && (
        <QuantileFanChart series={fanSeries} riskSeries={fanRiskSeries} />
      )}

      {/* Valuation models — own tabs */}
      {activeTab === 'powerlaw' && <PowerLawChart series={fanSeries} />}
      {activeTab === 's2f' && <S2FChart series={fanSeries} />}
      {activeTab === 'difficulty' && (
        <DifficultyChart series={fanSeries} difficulty={difficultySeries} />
      )}
      {activeTab === 'radar' && <CycleLowRadarChart series={fanSeries} />}

      {/* Overview (front page): verdict hero + collapsible breakdown */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
      {/* Verdict-first hero (UI v2) */}
      <VerdictHero
        latest={latestData}
        prev7d={prev7d}
        meta={currentMetaLayers}
        macroAvailable={macroAvailable}
        isLiveSource={isLiveSource}
        isStale={isStale}
        staleDays={staleDays}
        dataSource={dataSource}
        lastUpdated={lastUpdated}
        sma200wRatio={sma200wRatio}
        fanYear={heroFanYear}
        riskYear={heroRiskYear}
        modelsYear={heroModelsYear}
        cards={overviewCards ?? undefined}
        adjusted={latestAdjusted}
        divergence={divergence}
        topProximity={topProximity}
      />

      {/* Why this score — collapsible breakdown */}
      <WhyPanel latest={latestData} macroAvailable={macroAvailable} />
        </div>
      )}

      {/* Risk metric — its own tab: detailed price/risk chart + components */}
      {activeTab === 'risk' && (
        <div className="space-y-6">
      {/* Controls — primary row: range + display mode; secondary row: grouped toggles */}
      <div className="space-y-2.5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-2">
            <span className="ui-label">Range</span>
            <Segmented
              ariaLabel="Time range"
              options={timeRangeButtons.map(b => ({ value: b.value, label: b.label }))}
              value={zoomStart === null ? timeRange : ('zoom' as TimeRange)}
              onChange={v => {
                userPickedRange.current = true;
                setTimeRange(v);
                resetZoom();
              }}
            />
            {zoomStart !== null && (
              <button
                onClick={resetZoom}
                className="ctl rounded-md border px-2.5 py-1 text-[12px] font-medium transition-colors"
                style={{
                  borderColor: 'rgba(234,179,8,0.4)',
                  background: 'rgba(234,179,8,0.08)',
                  color: 'var(--accent)',
                }}
              >
                Reset zoom
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="ui-label">Mode</span>
            <Segmented
              ariaLabel="Chart mode"
              options={CHART_MODES.map(m => ({ value: m.id, label: m.label, title: m.hint }))}
              value={chartMode}
              onChange={setChartMode}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="ui-label">Display</span>
            <Toggle checked={logScale} onChange={setLogScale} label="Log scale" />
            <Toggle checked={showHalvings} onChange={setShowHalvings} label="Halvings" />
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="ui-label">Risk model</span>
            <Toggle checked={showSmoothed} onChange={setShowSmoothed} label="Smoothed" />
            <div
              className="flex items-center gap-1.5 rounded-md border px-2 py-1"
              style={{ borderColor: 'var(--control-border)', background: 'var(--control-bg)' }}
              title="Simple moving average window (days) on the risk line. 1 = off."
            >
              <span className="text-[12px]" style={{ color: 'var(--control-text)' }}>SMA</span>
              <input
                type="number"
                min="1"
                max="200"
                value={smoothingDays}
                aria-label="Risk SMA window in days"
                onChange={e => setSmoothingDays(Math.max(1, Math.min(200, parseInt(e.target.value) || 1)))}
                className="ctl w-11 bg-transparent text-[12px] tabular-nums outline-none"
                style={{ color: 'var(--control-text-active)' }}
              />
              <span className="text-[10px]" style={{ color: 'var(--faint)' }}>
                {smoothingDays <= 1 ? 'off' : 'd'}
              </span>
            </div>
            <Toggle
              checked={showAdjusted}
              onChange={setShowAdjusted}
              label="Cycle-adjusted"
              accent={C.adjusted}
              title="Replace the legacy risk line with the cycle-adjusted (Layer-1) line"
            />
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="ui-label">Overlays</span>
            <Toggle checked={showComponents} onChange={setShowComponents} label="Components" />
            <Toggle checked={showMacroComponents} onChange={setShowMacroComponents} label="Macro details" />
          </div>
        </div>
      </div>

      {/* Risk Filter — quiet advanced panel; quick-filter chips use the shared risk palette */}
      <div
        className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3 rounded-md border px-3 py-2"
        style={{ borderColor: 'var(--control-border)', background: 'var(--control-bg)' }}
      >
        <Toggle
          checked={riskFilter.enabled}
          onChange={v => setRiskFilter(prev => ({ ...prev, enabled: v }))}
          label="Filter by risk"
        />

        <div className="flex flex-wrap items-center gap-3">
          {(['min', 'max'] as const).map(field => (
            <div key={field} className="flex items-center gap-1.5">
              <span
                className="text-[11px] uppercase tracking-wider"
                style={{ color: riskFilter.enabled ? 'var(--control-text)' : 'var(--faint)' }}
              >
                {field}
              </span>
              <input
                type="number"
                min="0"
                max="100"
                value={riskFilter[field]}
                aria-label={`Risk filter ${field} percent`}
                onChange={e =>
                  setRiskFilter(prev => ({
                    ...prev,
                    [field]: Math.max(0, Math.min(100, parseInt(e.target.value) || (field === 'min' ? 0 : 100))),
                  }))
                }
                disabled={!riskFilter.enabled}
                className="ctl w-14 rounded-md border bg-transparent px-2 py-1 text-[12px] tabular-nums outline-none disabled:cursor-not-allowed"
                style={{
                  borderColor: 'var(--control-border)',
                  color: riskFilter.enabled ? 'var(--control-text-active)' : 'var(--faint)',
                }}
              />
              <span className="text-[11px]" style={{ color: 'var(--faint)' }}>%</span>
            </div>
          ))}

          {/* Quick presets — colors derived from the shared risk scale */}
          <div className="flex items-center gap-1.5">
            {(
              [
                { label: 'Low', min: 0, max: 30, color: riskToColor(0.15) },
                { label: 'Mid', min: 30, max: 60, color: riskToColor(0.45) },
                { label: 'High', min: 60, max: 100, color: riskToColor(0.8) },
              ] as const
            ).map(p => (
              <button
                key={p.label}
                onClick={() => setRiskFilter({ min: p.min, max: p.max, enabled: true })}
                disabled={!riskFilter.enabled}
                className="ctl rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors disabled:cursor-not-allowed"
                style={{
                  borderColor: riskFilter.enabled ? p.color.replace('rgb', 'rgba').replace(')', ', 0.45)') : 'var(--control-border)',
                  color: riskFilter.enabled ? p.color : 'var(--faint)',
                  background: 'transparent',
                }}
              >
                {p.label}
              </button>
            ))}
            <button
              onClick={() => setRiskFilter({ min: 0, max: 100, enabled: false })}
              className="ctl rounded-md border px-2 py-0.5 text-[11px] transition-colors"
              style={{ borderColor: 'var(--control-border)', color: 'var(--control-text)' }}
            >
              Reset
            </button>
          </div>
        </div>

        {riskFilter.enabled && (
          <span className="text-[11px] tabular-nums sm:ml-auto" style={{ color: 'var(--muted)' }}>
            {chartData.filter(d => d.filteredRisk !== null).length} days in {riskFilter.min}–{riskFilter.max}%
            {chartMode !== 'dual' && ' · other periods muted'}
          </span>
        )}
      </div>

      {/* Main Chart — the central analytical workspace */}
      <div
        className="rounded-xl border p-2 sm:p-5"
        style={{ borderColor: 'var(--hairline)', background: 'var(--surface-raised)' }}
      >
        {/* Card header: title + compact series legend */}
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-1 pb-3">
          <div className="flex items-baseline gap-3">
            <h3 className="text-[13px] font-medium" style={{ color: 'var(--foreground)' }}>
              BTC price & risk history
            </h3>
            <span className="ui-label hidden sm:inline">
              {CHART_MODES.find(m => m.id === chartMode)?.hint}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]" style={{ color: 'var(--muted)' }}>
            {chartMode === 'dual' ? (
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="inline-block w-4 h-[2px] rounded" style={{ background: C.price }} />
                BTC price · left
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="inline-block w-4 h-[3px] rounded"
                  style={{ background: riskScaleCssGradient(9) }}
                />
                BTC price · colored by {showAdjusted ? 'cycle-adjusted risk' : 'risk'} · left
              </span>
            )}
            {chartMode !== 'colored' &&
              (showAdjusted ? (
                <span className="flex items-center gap-1.5">
                  <span aria-hidden className="inline-block w-4 h-[2px] rounded" style={{ background: C.adjusted }} />
                  Cycle-adjusted · right
                </span>
              ) : (
                <span className="flex items-center gap-1.5">
                  <span aria-hidden className="inline-block w-4 h-[2px] rounded" style={{ background: C.risk }} />
                  Risk · right
                </span>
              ))}
          </div>
        </div>

        <div className="h-[360px] sm:h-[500px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={chartData}
              margin={{ top: 12, right: chartMode === 'colored' ? 12 : 6, left: 0, bottom: 8 }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
            >
              <defs>
                {/* Vertical fill under the risk line — same scale, low opacity */}
                <linearGradient id="riskAreaGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={riskToColor(1)} stopOpacity={0.22} />
                  <stop offset="50%" stopColor={riskToColor(0.5)} stopOpacity={0.09} />
                  <stop offset="100%" stopColor={riskToColor(0)} stopOpacity={0.03} />
                </linearGradient>
                {/* Horizontal per-observation gradient for the risk-colored price curve */}
                {priceGradientStops && (
                  <linearGradient id="priceRiskGradient" x1="0" y1="0" x2="1" y2="0">
                    {priceGradientStops.map((s, i) => (
                      <stop
                        key={i}
                        offset={`${(s.offset * 100).toFixed(3)}%`}
                        stopColor={s.color}
                        stopOpacity={s.opacity}
                      />
                    ))}
                  </linearGradient>
                )}
              </defs>

              <CartesianGrid horizontal vertical={false} stroke={C.grid} />

              <XAxis
                dataKey="date"
                tickFormatter={formatDate}
                stroke={C.axisLine}
                tick={{ fill: C.axisText, fontSize: 11 }}
                tickLine={{ stroke: C.axisLine }}
                interval="preserveStartEnd"
                minTickGap={44}
              />

              {/* Price axis (left) — neutral, matches the BTC price series */}
              <YAxis
                yAxisId="price"
                orientation="left"
                scale={logScale ? 'log' : 'linear'}
                domain={['auto', 'auto']}
                tickFormatter={formatPrice}
                stroke={C.axisLine}
                tick={{ fill: C.axisText, fontSize: 11 }}
                tickLine={{ stroke: C.axisLine }}
                width={44}
              />

              {/* Risk axis (right) — soft series tint; hidden entirely in
                  colored mode (the gradient legend replaces it) */}
              <YAxis
                yAxisId="risk"
                orientation="right"
                domain={[0, 1]}
                hide={chartMode === 'colored'}
                tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
                stroke={C.axisLine}
                tick={{
                  fill: showAdjusted ? 'rgba(168,85,247,0.75)' : 'rgba(244,124,106,0.7)',
                  fontSize: 11,
                }}
                tickLine={{ stroke: C.axisLine }}
                width={36}
              />

              <Tooltip
                content={<CustomTooltip showAdjusted={showAdjusted} />}
                cursor={{ stroke: 'rgba(232,230,225,0.25)', strokeWidth: 1, strokeDasharray: '3 3' }}
              />

              {/* Halving markers — visible but secondary to the data */}
              {visibleHalvings.map(date => (
                <ReferenceLine
                  key={date}
                  x={date}
                  yAxisId="price"
                  stroke={C.halving}
                  strokeDasharray="3 5"
                  label={{
                    value: 'HALVING',
                    fill: C.halvingLabel,
                    fontSize: 9,
                    position: 'insideTop',
                  }}
                />
              ))}

              {/* Risk area fill — dual mode only, under the separate risk line */}
              {chartMode === 'dual' && !showAdjusted && (
                <Area
                  yAxisId="risk"
                  type="monotone"
                  dataKey={showSmoothed ? 'filteredSmoothedRisk' : 'filteredRisk'}
                  stroke="none"
                  fill="url(#riskAreaGradient)"
                  isAnimationActive={false}
                  connectNulls={false}
                />
              )}

              {/* BTC price — neutral in dual mode, risk-colored gradient otherwise */}
              <Line
                yAxisId="price"
                type="monotone"
                dataKey="price"
                stroke={chartMode === 'dual' ? C.price : 'url(#priceRiskGradient)'}
                strokeWidth={chartMode === 'dual' ? 1.4 : 2.2}
                strokeLinecap="round"
                strokeLinejoin="round"
                dot={false}
                isAnimationActive={false}
              />

              {/* Separate risk series — dual + combined; hidden in colored mode.
                  In combined it is thinner and translucent so it cannot
                  overpower the colored price curve. */}
              {chartMode !== 'colored' && !showAdjusted && (
                <Line
                  yAxisId="risk"
                  type="monotone"
                  dataKey={showSmoothed ? 'filteredSmoothedRisk' : 'filteredRisk'}
                  stroke={chartMode === 'dual' ? C.risk : C.riskCombined}
                  strokeWidth={chartMode === 'dual' ? 1.4 : 1.2}
                  connectNulls={false}
                  dot={false}
                  isAnimationActive={false}
                />
              )}

              {/* Cycle-adjusted (Layer-1) risk — REPLACES the legacy line when on */}
              {chartMode !== 'colored' && showAdjusted && (
                <Line
                  yAxisId="risk"
                  type="monotone"
                  dataKey="filteredAdjusted"
                  stroke={C.adjusted}
                  strokeWidth={chartMode === 'dual' ? 1.4 : 1.2}
                  strokeOpacity={chartMode === 'dual' ? 1 : 0.75}
                  dot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              )}

              {/* Zoom selection */}
              {refAreaLeft && refAreaRight && (
                <ReferenceArea
                  yAxisId="price"
                  x1={refAreaLeft}
                  x2={refAreaRight}
                  stroke="rgba(232,230,225,0.3)"
                  strokeOpacity={0.4}
                  fill="#e8e6e1"
                  fillOpacity={0.08}
                />
              )}

              {/* Navigator — simplified neutral price shape inside the brush */}
              <Brush
                dataKey="date"
                height={34}
                travellerWidth={8}
                stroke={C.brushStroke}
                fill={C.brushFill}
                tickFormatter={formatDate}
              >
                <ComposedChart>
                  <Line
                    dataKey="price"
                    stroke={C.price}
                    strokeOpacity={0.55}
                    strokeWidth={1}
                    dot={false}
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </Brush>
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Risk color legend — the axis replacement for colored/combined modes */}
        {chartMode !== 'dual' && (
          <div className="px-1 pt-3">
            <div className="flex items-center gap-3">
              <span className="ui-label whitespace-nowrap">Low risk</span>
              <div className="flex-1">
                <div
                  className="h-1.5 rounded-full"
                  style={{ background: riskScaleCssGradient() }}
                  aria-hidden
                />
                <div
                  className="flex justify-between mt-1 text-[10px] tabular-nums"
                  style={{ color: 'var(--faint)' }}
                >
                  {[0, 25, 50, 75, 100].map(v => (
                    <span key={v}>{v}%</span>
                  ))}
                </div>
              </div>
              <span className="ui-label whitespace-nowrap">High risk</span>
            </div>
          </div>
        )}

        {/* Footer: interaction hint left, dataset metadata right */}
        <div
          className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-1 pt-2 mt-1 border-t text-[11px]"
          style={{ borderColor: 'var(--hairline)', color: 'var(--faint)' }}
        >
          <span>Drag on chart to zoom · drag the navigator to pan</span>
          <span className="tabular-nums" style={{ color: 'var(--muted)' }}>
            {chartData.length.toLocaleString()} days · {chartData[0]?.date} → {chartData[chartData.length - 1]?.date}
          </span>
        </div>
      </div>

      {/* Components Chart (optional) */}
      {showComponents && (
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
          <h3 className="text-white font-medium mb-4">Risk Components</h3>
          <div className="h-[240px] sm:h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={filteredData}
                margin={{ top: 10, right: 20, left: 20, bottom: 10 }}
              >
                <XAxis
                  dataKey="date"
                  tickFormatter={formatDate}
                  stroke="#6b7280"
                  tick={{ fill: '#9ca3af', fontSize: 10 }}
                  interval="preserveStartEnd"
                  minTickGap={44}
                />
                <YAxis
                  domain={[0, 1]}
                  tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
                  stroke="#6b7280"
                  tick={{ fill: '#9ca3af', fontSize: 10 }}
                />
                <Tooltip content={<ComponentsTooltip />} />

                <Line
                  type="monotone"
                  dataKey="components.valuation"
                  stroke="#3b82f6"
                  strokeWidth={1}
                  dot={false}
                  name="Valuation"
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="components.momentum"
                  stroke="#22c55e"
                  strokeWidth={1}
                  dot={false}
                  name="Momentum"
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="components.volatility"
                  stroke="#f97316"
                  strokeWidth={1}
                  dot={false}
                  name="Volatility"
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="components.cycle"
                  stroke="#a855f7"
                  strokeWidth={1}
                  dot={false}
                  name="Cycle"
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="components.macro"
                  stroke="#06b6d4"
                  strokeWidth={1}
                  dot={false}
                  name="Macro"
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="components.attention"
                  stroke="#eab308"
                  strokeWidth={1}
                  dot={false}
                  name="Attention"
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-4 mt-4 justify-center text-sm">
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded-full bg-blue-500"></div>
              <span className="text-gray-400">Valuation</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded-full bg-green-500"></div>
              <span className="text-gray-400">Momentum</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded-full bg-orange-500"></div>
              <span className="text-gray-400">Volatility</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded-full bg-purple-500"></div>
              <span className="text-gray-400">Cycle</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded-full bg-cyan-500"></div>
              <span className="text-gray-400">Macro</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
              <span className="text-gray-400">Attention</span>
            </div>
          </div>
        </div>
      )}

      {/* Macro Components Chart */}
      {showMacroComponents && (
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
          <h3 className="text-white font-medium mb-4">Macro Indicators (0% = Bearish, 100% = Bullish)</h3>
          <div className="h-[240px] sm:h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={filteredData}
                margin={{ top: 10, right: 20, left: 20, bottom: 10 }}
              >
                <XAxis
                  dataKey="date"
                  tickFormatter={formatDate}
                  stroke="#6b7280"
                  tick={{ fill: '#9ca3af', fontSize: 10 }}
                  interval="preserveStartEnd"
                  minTickGap={44}
                />
                <YAxis
                  domain={[0, 1]}
                  tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
                  stroke="#6b7280"
                  tick={{ fill: '#9ca3af', fontSize: 10 }}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload || payload.length === 0) return null;
                    const point = payload[0].payload as UIDataPoint;
                    if (!point.macroComponents) return null;
                    return (
                      <div className="rounded-lg border border-gray-700 bg-gray-900 p-3 shadow-lg min-w-[180px]">
                        <p className="font-medium text-white mb-2 text-sm">
                          {new Date(point.date).toLocaleDateString()}
                        </p>
                        <div className="space-y-1">
                          <div className="flex justify-between text-sm">
                            <span style={{ color: '#10b981' }}>M2 YoY:</span>
                            <span className="text-white">
                              {(point.macroComponents.m2Signal * 100).toFixed(0)}%
                            </span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span style={{ color: '#f59e0b' }}>Fed Funds:</span>
                            <span className="text-white">
                              {(point.macroComponents.fedFundsSignal * 100).toFixed(0)}%
                            </span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span style={{ color: '#8b5cf6' }}>Yield Curve:</span>
                            <span className="text-white">
                              {(point.macroComponents.yieldCurveSignal * 100).toFixed(0)}%
                            </span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span style={{ color: '#ec4899' }}>Real Rate:</span>
                            <span className="text-white">
                              {(point.macroComponents.realRateSignal * 100).toFixed(0)}%
                            </span>
                          </div>
                          <div className="flex justify-between text-sm border-t border-gray-700 pt-1 mt-1">
                            <span style={{ color: '#06b6d4' }}>Combined:</span>
                            <span className="text-white font-medium">
                              {(point.components.macro * 100).toFixed(0)}%
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  }}
                />

                <Line
                  type="monotone"
                  dataKey="macroComponents.m2Signal"
                  stroke="#10b981"
                  strokeWidth={1.5}
                  dot={false}
                  name="M2 YoY"
                  isAnimationActive={false}
                  connectNulls
                />
                <Line
                  type="monotone"
                  dataKey="macroComponents.fedFundsSignal"
                  stroke="#f59e0b"
                  strokeWidth={1.5}
                  dot={false}
                  name="Fed Funds"
                  isAnimationActive={false}
                  connectNulls
                />
                <Line
                  type="monotone"
                  dataKey="macroComponents.yieldCurveSignal"
                  stroke="#8b5cf6"
                  strokeWidth={1.5}
                  dot={false}
                  name="Yield Curve"
                  isAnimationActive={false}
                  connectNulls
                />
                <Line
                  type="monotone"
                  dataKey="macroComponents.realRateSignal"
                  stroke="#ec4899"
                  strokeWidth={1.5}
                  dot={false}
                  name="Real Rate"
                  isAnimationActive={false}
                  connectNulls
                />

                {/* Combined macro score as reference */}
                <Line
                  type="monotone"
                  dataKey="components.macro"
                  stroke="#06b6d4"
                  strokeWidth={2}
                  strokeDasharray="5 5"
                  dot={false}
                  name="Combined Macro"
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-4 mt-4 justify-center text-sm">
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#10b981' }}></div>
              <span className="text-gray-400">M2 YoY (Money Supply)</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#f59e0b' }}></div>
              <span className="text-gray-400">Fed Funds Rate</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#8b5cf6' }}></div>
              <span className="text-gray-400">Yield Curve (10Y-2Y)</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#ec4899' }}></div>
              <span className="text-gray-400">Real Rate (TIPS)</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-8 h-0.5" style={{ backgroundColor: '#06b6d4', borderStyle: 'dashed' }}></div>
              <span className="text-gray-400">Combined ({Math.round((DEFAULT_WEIGHTS.macro ?? 0) * 100)}% weight)</span>
            </div>
          </div>

          {/* Explanation */}
          <div className="mt-4 p-3 bg-gray-800/50 rounded-lg text-xs text-gray-400">
            <p className="mb-2"><strong className="text-white">Interpretation:</strong></p>
            <ul className="list-disc list-inside space-y-1">
              <li><strong className="text-emerald-400">M2 YoY:</strong> Higher = money supply growing = bullish for BTC</li>
              <li><strong className="text-amber-400">Fed Funds:</strong> Lower rates = bullish for risk assets</li>
              <li><strong className="text-violet-400">Yield Curve:</strong> Normal curve (positive) = bullish, inverted = bearish</li>
              <li><strong className="text-pink-400">Real Rate:</strong> Negative real rates = bullish for hard assets</li>
            </ul>
            <p className="mt-2 text-gray-500">
              Direction note: in this model, <em>bullish</em> macro (loose liquidity) INCREASES the
              risk score — easy money fuels late-cycle euphoria, tight money coincides with bottoms.
              A high macro reading means &ldquo;conditions that historically preceded tops&rdquo;, not &ldquo;bad for BTC&rdquo;.
            </p>
          </div>
        </div>
      )}

      {/* Meta-Layers Panel */}
      <MetaLayersPanel
        meta={currentMetaLayers}
        isExpanded={showMetaLayers}
        onToggle={() => setShowMetaLayers(!showMetaLayers)}
      />

      {/* Risk Legend — rendered from the canonical bands so it can never
          drift from the gauge/action labels */}
      <div className="grid grid-cols-5 gap-2">
        {RISK_BANDS.map((b, i) => {
          const bandClasses = [
            { bg: 'bg-green-900/30', title: 'text-green-400', sub: 'text-green-300' },
            { bg: 'bg-lime-900/30', title: 'text-lime-400', sub: 'text-lime-300' },
            { bg: 'bg-yellow-900/30', title: 'text-yellow-400', sub: 'text-yellow-300' },
            { bg: 'bg-orange-900/30', title: 'text-orange-400', sub: 'text-orange-300' },
            { bg: 'bg-red-900/30', title: 'text-red-400', sub: 'text-red-300' },
          ][i];
          const isCurrent = band.level === b.level;
          return (
            <div
              key={b.level}
              className={`rounded-lg ${bandClasses.bg} p-3 text-center ${isCurrent ? 'ring-1 ring-white/40' : ''}`}
            >
              <p className={`text-lg font-bold ${bandClasses.title}`}>
                {Math.round(b.min * 100)}-{Math.round(b.max * 100)}%
              </p>
              <p className={`text-sm ${bandClasses.sub}`}>{b.label}</p>
              <p className="text-xs text-gray-400">{b.action}</p>
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-gray-600 leading-relaxed">
        Band thresholds are heuristic quintiles of the calibrated score, not validated trade
        signals — personal decision-support vocabulary only. Historical risk values near past
        cycle bottoms are more favorable than a real-time model could have shown, because cycle
        anchors use lows that were only confirmable months later. Component weights and
        calibration were tuned on full history (in-sample).
      </p>
        </div>
      )}
    </div>
  );
}

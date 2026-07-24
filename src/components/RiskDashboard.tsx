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
} from 'recharts';
import { HALVING_DATES } from '@/lib/types';
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

/**
 * Get color from dark blue (low risk) to bright red (high risk)
 */
function getRiskHeatColor(risk: number): string {
  // Clamp risk between 0 and 1
  const r = Math.max(0, Math.min(1, risk));

  // Color stops: dark blue -> cyan -> green -> yellow -> orange -> red
  if (r < 0.2) {
    // Dark blue to cyan (0-20%)
    const t = r / 0.2;
    return `rgb(${Math.round(30 + t * 0)}, ${Math.round(60 + t * 140)}, ${Math.round(180 + t * 75)})`;
  } else if (r < 0.4) {
    // Cyan to green (20-40%)
    const t = (r - 0.2) / 0.2;
    return `rgb(${Math.round(30 + t * 70)}, ${Math.round(200 - t * 20)}, ${Math.round(255 - t * 175)})`;
  } else if (r < 0.6) {
    // Green to yellow (40-60%)
    const t = (r - 0.4) / 0.2;
    return `rgb(${Math.round(100 + t * 155)}, ${Math.round(180 + t * 20)}, ${Math.round(80 - t * 60)})`;
  } else if (r < 0.8) {
    // Yellow to orange (60-80%)
    const t = (r - 0.6) / 0.2;
    return `rgb(${Math.round(255)}, ${Math.round(200 - t * 100)}, ${Math.round(20)})`;
  } else {
    // Orange to bright red (80-100%)
    const t = (r - 0.8) / 0.2;
    return `rgb(${Math.round(255 - t * 35)}, ${Math.round(100 - t * 70)}, ${Math.round(20 + t * 10)})`;
  }
}

function CustomTooltip({ active, payload, showAdjusted }: TooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  const point = payload[0].payload;
  const riskColor =
    point.risk < 0.3 ? '#22c55e' :
    point.risk < 0.5 ? '#eab308' :
    point.risk < 0.7 ? '#f97316' : '#dc2626';

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-900 p-3 shadow-lg min-w-[200px]">
      <p className="font-medium text-white mb-2">
        {new Date(point.date).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        })}
      </p>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <span className="text-gray-400">Price:</span>
        <span className="text-white font-medium text-right">
          ${point.price.toLocaleString()}
        </span>
        {showAdjusted ? (
          <>
            <span className="text-gray-400">Cycle-adjusted:</span>
            <span style={{ color: '#a855f7' }} className="font-medium text-right">
              {point.adjusted != null ? `${(point.adjusted * 100).toFixed(1)}%` : 'n/a'}
            </span>
          </>
        ) : (
          <>
            <span className="text-gray-400">Risk:</span>
            <span style={{ color: riskColor }} className="font-medium text-right">
              {(point.risk * 100).toFixed(1)}%
            </span>
            <span className="text-gray-400">Smoothed:</span>
            <span style={{ color: riskColor }} className="text-right">
              {(point.smoothedRisk * 100).toFixed(1)}%
            </span>
          </>
        )}
        <span className="text-gray-400">Phase:</span>
        <span className="text-gray-300 text-right capitalize">{point.cyclePhase}</span>
      </div>
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

type Tab = 'overview' | 'risk' | 'fan';

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'risk', label: 'Risk metric' },
  { id: 'fan', label: 'Quantile fan' },
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
  const [showHeatColors, setShowHeatColors] = useState(false);
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

  // Build chart data: apply risk filter as null-masking + heat colors
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
        ...(showHeatColors ? { heatColor: getRiskHeatColor(riskValue) } : {}),
      };
    });
  }, [extraSmoothedData, showHeatColors, showSmoothed, riskFilter]);

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
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        {/* Time range */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-gray-500">Range:</span>
          {timeRangeButtons.map(({ label, value }) => (
            <button
              key={value}
              onClick={() => {
                userPickedRange.current = true;
                setTimeRange(value);
                resetZoom();
              }}
              className={`rounded px-3 py-1 text-sm font-medium transition-colors ${
                timeRange === value && zoomStart === null
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
          {(timeRange !== 'all' || zoomStart !== null) && (
            <button
              onClick={() => { userPickedRange.current = true; setTimeRange('all'); resetZoom(); }}
              className="rounded px-3 py-1 text-sm font-medium bg-blue-900/40 text-blue-300 hover:bg-blue-900/70 transition-colors"
            >
              Show all data
            </button>
          )}
        </div>

        {/* Toggles — wrap into a 2-col grid on mobile so nothing overflows */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:flex sm:flex-wrap sm:items-center sm:ml-auto w-full sm:w-auto">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={logScale}
              onChange={e => setLogScale(e.target.checked)}
              className="rounded bg-gray-700 border-gray-600"
            />
            <span className="text-sm text-gray-400">Log Scale</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showSmoothed}
              onChange={e => setShowSmoothed(e.target.checked)}
              className="rounded bg-gray-700 border-gray-600"
            />
            <span className="text-sm text-gray-400">Smoothed</span>
          </label>
          <div className="flex items-center gap-2" title="Simple moving average window (days) on the risk line. 1 = off.">
            <span className="text-sm text-gray-500">SMA:</span>
            <input
              type="number"
              min="1"
              max="200"
              value={smoothingDays}
              onChange={e => setSmoothingDays(Math.max(1, Math.min(200, parseInt(e.target.value) || 1)))}
              className="w-14 rounded bg-gray-700 border-gray-600 text-white text-sm px-2 py-1"
            />
            <span className="text-xs text-gray-400">{smoothingDays <= 1 ? 'off' : 'd'}</span>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showHalvings}
              onChange={e => setShowHalvings(e.target.checked)}
              className="rounded bg-gray-700 border-gray-600"
            />
            <span className="text-sm text-gray-400">Halvings</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showComponents}
              onChange={e => setShowComponents(e.target.checked)}
              className="rounded bg-gray-700 border-gray-600"
            />
            <span className="text-sm text-gray-400">Components</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showMacroComponents}
              onChange={e => setShowMacroComponents(e.target.checked)}
              className="rounded bg-gray-700 border-gray-600"
            />
            <span className="text-sm text-gray-400">Macro Details</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showHeatColors}
              onChange={e => setShowHeatColors(e.target.checked)}
              className="rounded bg-gray-700 border-gray-600"
            />
            <span className="text-sm text-gray-400">Heat Map</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer" title="Replace the legacy risk line with the cycle-adjusted (Layer-1) line">
            <input
              type="checkbox"
              checked={showAdjusted}
              onChange={e => setShowAdjusted(e.target.checked)}
              className="rounded bg-gray-700 border-gray-600"
            />
            <span className="text-sm" style={{ color: showAdjusted ? '#a855f7' : '#9ca3af' }}>Cycle-adjusted</span>
          </label>
        </div>

        {zoomStart !== null && (
          <button
            onClick={resetZoom}
            className="rounded bg-gray-700 px-3 py-1 text-sm font-medium text-white hover:bg-gray-600"
          >
            Reset Zoom
          </button>
        )}
      </div>

      {/* Risk Filter */}
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3 sm:gap-4 bg-gray-800/50 rounded-lg p-3">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={riskFilter.enabled}
            onChange={e => setRiskFilter(prev => ({ ...prev, enabled: e.target.checked }))}
            className="rounded bg-gray-700 border-gray-600"
          />
          <span className="text-sm text-gray-400">Filter by Risk Level</span>
        </label>

        <div className={`flex flex-wrap items-center gap-3 sm:gap-4 ${!riskFilter.enabled ? 'opacity-50' : ''}`}>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">Min:</span>
            <input
              type="number"
              min="0"
              max="100"
              value={riskFilter.min}
              onChange={e => setRiskFilter(prev => ({
                ...prev,
                min: Math.max(0, Math.min(100, parseInt(e.target.value) || 0))
              }))}
              disabled={!riskFilter.enabled}
              className="w-16 rounded bg-gray-700 border-gray-600 text-white text-sm px-2 py-1"
            />
            <span className="text-sm text-gray-500">%</span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">Max:</span>
            <input
              type="number"
              min="0"
              max="100"
              value={riskFilter.max}
              onChange={e => setRiskFilter(prev => ({
                ...prev,
                max: Math.max(0, Math.min(100, parseInt(e.target.value) || 100))
              }))}
              disabled={!riskFilter.enabled}
              className="w-16 rounded bg-gray-700 border-gray-600 text-white text-sm px-2 py-1"
            />
            <span className="text-sm text-gray-500">%</span>
          </div>

          {/* Quick presets */}
          <div className="flex items-center gap-1 ml-0 sm:ml-2">
            <button
              onClick={() => setRiskFilter({ min: 0, max: 30, enabled: true })}
              disabled={!riskFilter.enabled}
              className="rounded px-2 py-1 text-xs bg-green-800/50 text-green-400 hover:bg-green-800 disabled:opacity-50"
            >
              Low
            </button>
            <button
              onClick={() => setRiskFilter({ min: 30, max: 60, enabled: true })}
              disabled={!riskFilter.enabled}
              className="rounded px-2 py-1 text-xs bg-yellow-800/50 text-yellow-400 hover:bg-yellow-800 disabled:opacity-50"
            >
              Mid
            </button>
            <button
              onClick={() => setRiskFilter({ min: 60, max: 100, enabled: true })}
              disabled={!riskFilter.enabled}
              className="rounded px-2 py-1 text-xs bg-red-800/50 text-red-400 hover:bg-red-800 disabled:opacity-50"
            >
              High
            </button>
            <button
              onClick={() => setRiskFilter({ min: 0, max: 100, enabled: false })}
              className="rounded px-2 py-1 text-xs bg-gray-700 text-gray-400 hover:bg-gray-600 ml-2"
            >
              Reset
            </button>
          </div>
        </div>

        {riskFilter.enabled && (
          <span className="text-xs sm:text-sm text-gray-400 sm:ml-auto">
            Highlighting {chartData.filter(d => d.filteredRisk !== null).length} days in {riskFilter.min}-{riskFilter.max}% risk range
          </span>
        )}
      </div>

      {/* Main Chart */}
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-1 sm:p-4">
        <div className="h-[360px] sm:h-[500px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={chartData}
              margin={{ top: 16, right: 34, left: 0, bottom: 12 }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
            >
              {/* Gradient for risk area */}
              <defs>
                <linearGradient id="riskGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#dc2626" stopOpacity={0.6} />
                  <stop offset="50%" stopColor="#eab308" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#22c55e" stopOpacity={0.1} />
                </linearGradient>
              </defs>

              <XAxis
                dataKey="date"
                tickFormatter={formatDate}
                stroke="#6b7280"
                tick={{ fill: '#9ca3af', fontSize: 11 }}
                tickLine={{ stroke: '#4b5563' }}
                interval="preserveStartEnd"
                minTickGap={44}
              />

              {/* Price axis (left) */}
              <YAxis
                yAxisId="price"
                orientation="left"
                scale={logScale ? 'log' : 'linear'}
                domain={['auto', 'auto']}
                tickFormatter={formatPrice}
                stroke="#6b7280"
                tick={{ fill: '#9ca3af', fontSize: 11 }}
                tickLine={{ stroke: '#4b5563' }}
                width={40}
              />

              {/* Risk axis (right) — violet when showing the cycle-adjusted line */}
              <YAxis
                yAxisId="risk"
                orientation="right"
                domain={[0, 1]}
                tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
                stroke={showAdjusted ? '#a855f7' : showHeatColors ? '#6b7280' : '#dc2626'}
                tick={{ fill: showAdjusted ? '#a855f7' : showHeatColors ? '#9ca3af' : '#dc2626', fontSize: 11 }}
                tickLine={{ stroke: showAdjusted ? '#a855f7' : showHeatColors ? '#4b5563' : '#dc2626' }}
                width={34}
              />

              <Tooltip content={<CustomTooltip showAdjusted={showAdjusted} />} />

              {/* Halving reference lines */}
              {visibleHalvings.map(date => (
                <ReferenceLine
                  key={date}
                  x={date}
                  yAxisId="price"
                  stroke="#a855f7"
                  strokeDasharray="5 5"
                  label={{
                    value: 'Halving',
                    fill: '#a855f7',
                    fontSize: 10,
                    position: 'top',
                  }}
                />
              ))}

              {/* Price line */}
              <Line
                yAxisId="price"
                type="monotone"
                dataKey="price"
                stroke="#9ca3af"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />

              {/* Absolute (legacy) risk area — hidden when the cycle-adjusted
                  line replaces it */}
              {!showHeatColors && !showAdjusted && (
                <Area
                  yAxisId="risk"
                  type="monotone"
                  dataKey={showSmoothed ? 'filteredSmoothedRisk' : 'filteredRisk'}
                  stroke="none"
                  fill="url(#riskGradient)"
                  fillOpacity={0.4}
                  isAnimationActive={false}
                  connectNulls={false}
                />
              )}

              {/* Absolute (legacy) risk line — hidden when cycle-adjusted is on */}
              {!showAdjusted && (
                <Line
                  yAxisId="risk"
                  type="monotone"
                  dataKey={showSmoothed ? 'filteredSmoothedRisk' : 'filteredRisk'}
                  stroke={showHeatColors ? 'transparent' : '#dc2626'}
                  strokeWidth={1.5}
                  connectNulls={false}
                  dot={showHeatColors ? (props) => {
                    const { cx, cy, payload } = props as { cx?: number; cy?: number; payload?: UIDataPoint & { filteredRisk: number | null; filteredSmoothedRisk: number | null } };
                    if (cx === undefined || cy === undefined || !payload) return null;
                    const risk = showSmoothed ? payload.filteredSmoothedRisk : payload.filteredRisk;
                    if (risk === null) return null;
                    return (
                      <circle
                        key={`dot-${cx}-${cy}`}
                        cx={cx}
                        cy={cy}
                        r={3}
                        fill={getRiskHeatColor(risk)}
                        stroke="none"
                      />
                    );
                  } : false}
                  isAnimationActive={false}
                />
              )}

              {/* Cycle-adjusted (Layer-1) risk — REPLACES the legacy line when on */}
              {showAdjusted && (
                <Line
                  yAxisId="risk"
                  type="monotone"
                  dataKey="filteredAdjusted"
                  stroke="#a855f7"
                  strokeWidth={1.5}
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
                  strokeOpacity={0.3}
                  fill="#ffffff"
                  fillOpacity={0.2}
                />
              )}

              {/* Brush for mini-map */}
              <Brush
                dataKey="date"
                height={30}
                stroke="#4b5563"
                fill="#1f2937"
                tickFormatter={formatDate}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="mt-2 text-xs text-gray-500 text-center">
          Drag on chart to zoom • {chartData.length} days •{' '}
          {chartData[0]?.date} - {chartData[chartData.length - 1]?.date}
          {showHeatColors && ' • Heat Map: Blue (low risk) → Red (high risk)'}
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

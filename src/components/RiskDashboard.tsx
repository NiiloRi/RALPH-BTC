'use client';

import { useEffect, useState, useMemo } from 'react';
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
  payload?: Array<{ payload: UIDataPoint }>;
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

function CustomTooltip({ active, payload }: TooltipProps) {
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
        <span className="text-gray-400">Risk:</span>
        <span style={{ color: riskColor }} className="font-medium text-right">
          {(point.risk * 100).toFixed(1)}%
        </span>
        <span className="text-gray-400">Smoothed:</span>
        <span style={{ color: riskColor }} className="text-right">
          {(point.smoothedRisk * 100).toFixed(1)}%
        </span>
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

export default function RiskDashboard() {
  const [data, setData] = useState<UIDataPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [dataSource, setDataSource] = useState<string>('');
  const [timeRange, setTimeRange] = useState<TimeRange>('all');
  const [showSmoothed, setShowSmoothed] = useState(true);
  const [showComponents, setShowComponents] = useState(false);
  const [showHalvings, setShowHalvings] = useState(true);
  const [logScale, setLogScale] = useState(true);
  const [showHeatColors, setShowHeatColors] = useState(false);
  const [riskFilter, setRiskFilter] = useState<RiskFilter>({
    min: 0,
    max: 100,
    enabled: false,
  });

  // Zoom state
  const [zoomStart, setZoomStart] = useState<number | null>(null);
  const [zoomEnd, setZoomEnd] = useState<number | null>(null);
  const [refAreaLeft, setRefAreaLeft] = useState<string | null>(null);
  const [refAreaRight, setRefAreaRight] = useState<string | null>(null);

  // Load data - fetch fresh from Binance API on every page load
  useEffect(() => {
    async function loadData() {
      setLoading(true);
      setError(null);

      try {
        // First, try to fetch fresh data from API (Binance)
        const apiResponse = await fetch('/api/risk-data', {
          cache: 'no-store', // Always fetch fresh data
        });

        if (apiResponse.ok) {
          const apiData = await apiResponse.json();
          setData(apiData.data);
          setLastUpdated(apiData.lastUpdated);
          setDataSource(`Live from ${apiData.source}`);
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

    // Apply risk level filter
    if (riskFilter.enabled) {
      const minRisk = riskFilter.min / 100;
      const maxRisk = riskFilter.max / 100;
      result = result.filter(d => {
        const riskValue = showSmoothed ? d.smoothedRisk : d.risk;
        return riskValue >= minRisk && riskValue <= maxRisk;
      });
    }

    return result;
  }, [data, timeRange, zoomStart, zoomEnd, riskFilter, showSmoothed]);

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

  // Add heat colors to data when enabled
  const chartData = useMemo(() => {
    if (!showHeatColors) return filteredData;

    return filteredData.map(d => ({
      ...d,
      heatColor: getRiskHeatColor(showSmoothed ? d.smoothedRisk : d.risk),
    }));
  }, [filteredData, showHeatColors, showSmoothed]);

  // Get halving dates within visible range
  const visibleHalvings = useMemo(() => {
    if (!showHalvings || filteredData.length === 0) return [];

    const startDate = new Date(filteredData[0].date);
    const endDate = new Date(filteredData[filteredData.length - 1].date);

    return HALVING_DATES.filter(h => h >= startDate && h <= endDate)
      .map(h => h.toISOString().split('T')[0]);
  }, [filteredData, showHalvings]);

  // Risk color gradient
  const getRiskColor = (risk: number) => {
    if (risk < 0.2) return '#22c55e';
    if (risk < 0.4) return '#84cc16';
    if (risk < 0.6) return '#eab308';
    if (risk < 0.8) return '#f97316';
    return '#dc2626';
  };

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

  const latestData = filteredData[filteredData.length - 1];
  const riskLevel =
    latestData.risk < 0.2 ? 'Low' :
    latestData.risk < 0.4 ? 'Moderate-Low' :
    latestData.risk < 0.6 ? 'Neutral' :
    latestData.risk < 0.8 ? 'Moderate-High' : 'High';

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
      {/* Stats Bar */}
      <div className="flex flex-wrap gap-4 items-center text-sm">
        <div className="bg-gray-800 rounded-lg px-4 py-2">
          <span className="text-gray-400">Date: </span>
          <span className="text-white font-medium">{latestData.date}</span>
        </div>
        <div className="bg-gray-800 rounded-lg px-4 py-2">
          <span className="text-gray-400">Price: </span>
          <span className="text-white font-medium">
            ${latestData.price.toLocaleString()}
          </span>
        </div>
        <div className="bg-gray-800 rounded-lg px-4 py-2">
          <span className="text-gray-400">Risk: </span>
          <span
            style={{ color: getRiskColor(latestData.risk) }}
            className="font-medium"
          >
            {(latestData.risk * 100).toFixed(1)}% ({riskLevel})
          </span>
        </div>
        <div className="bg-gray-800 rounded-lg px-4 py-2">
          <span className="text-gray-400">Phase: </span>
          <span className="text-white capitalize">{latestData.cyclePhase}</span>
        </div>
        {dataSource && (
          <div className="bg-green-900/30 rounded-lg px-4 py-2 ml-auto">
            <span className="text-green-400 font-medium">{dataSource}</span>
            {lastUpdated && (
              <span className="text-gray-400 ml-2 text-xs">
                {new Date(lastUpdated).toLocaleTimeString()}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-4">
        {/* Time range */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">Range:</span>
          {timeRangeButtons.map(({ label, value }) => (
            <button
              key={value}
              onClick={() => {
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
        </div>

        {/* Toggles */}
        <div className="flex items-center gap-4 ml-auto">
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
              checked={showHeatColors}
              onChange={e => setShowHeatColors(e.target.checked)}
              className="rounded bg-gray-700 border-gray-600"
            />
            <span className="text-sm text-gray-400">Heat Map</span>
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
      <div className="flex flex-wrap items-center gap-4 bg-gray-800/50 rounded-lg p-3">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={riskFilter.enabled}
            onChange={e => setRiskFilter(prev => ({ ...prev, enabled: e.target.checked }))}
            className="rounded bg-gray-700 border-gray-600"
          />
          <span className="text-sm text-gray-400">Filter by Risk Level</span>
        </label>

        <div className={`flex items-center gap-4 ${!riskFilter.enabled ? 'opacity-50' : ''}`}>
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
          <div className="flex items-center gap-1 ml-2">
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
          <span className="text-sm text-gray-400 ml-auto">
            Showing {filteredData.length} days in {riskFilter.min}-{riskFilter.max}% range
          </span>
        )}
      </div>

      {/* Main Chart */}
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
        <div className="h-[500px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={chartData}
              margin={{ top: 20, right: 60, left: 20, bottom: 20 }}
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
                interval={Math.max(0, Math.floor(chartData.length / 10) - 1)}
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
              />

              {/* Risk axis (right) */}
              <YAxis
                yAxisId="risk"
                orientation="right"
                domain={[0, 1]}
                tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
                stroke={showHeatColors ? '#6b7280' : '#dc2626'}
                tick={{ fill: showHeatColors ? '#9ca3af' : '#dc2626', fontSize: 11 }}
                tickLine={{ stroke: showHeatColors ? '#4b5563' : '#dc2626' }}
              />

              <Tooltip content={<CustomTooltip />} />

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

              {/* Risk area - hidden when heat map enabled */}
              {!showHeatColors && (
                <Area
                  yAxisId="risk"
                  type="monotone"
                  dataKey={showSmoothed ? 'smoothedRisk' : 'risk'}
                  stroke="none"
                  fill="url(#riskGradient)"
                  fillOpacity={0.4}
                  isAnimationActive={false}
                />
              )}

              {/* Risk line - normal red or heat colored dots */}
              <Line
                yAxisId="risk"
                type="monotone"
                dataKey={showSmoothed ? 'smoothedRisk' : 'risk'}
                stroke={showHeatColors ? 'transparent' : '#dc2626'}
                strokeWidth={1.5}
                dot={showHeatColors ? (props) => {
                  const { cx, cy, payload } = props as { cx?: number; cy?: number; payload?: UIDataPoint };
                  if (cx === undefined || cy === undefined || !payload) return null;
                  const risk = showSmoothed ? payload.smoothedRisk : payload.risk;
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
          <div className="h-[300px]">
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
                  interval={Math.max(0, Math.floor(filteredData.length / 8) - 1)}
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

      {/* Risk Legend */}
      <div className="grid grid-cols-5 gap-2">
        <div className="rounded-lg bg-green-900/30 p-3 text-center">
          <p className="text-lg font-bold text-green-400">0-20%</p>
          <p className="text-sm text-green-300">Low Risk</p>
          <p className="text-xs text-gray-400">Accumulate</p>
        </div>
        <div className="rounded-lg bg-lime-900/30 p-3 text-center">
          <p className="text-lg font-bold text-lime-400">20-40%</p>
          <p className="text-sm text-lime-300">Moderate-Low</p>
          <p className="text-xs text-gray-400">DCA</p>
        </div>
        <div className="rounded-lg bg-yellow-900/30 p-3 text-center">
          <p className="text-lg font-bold text-yellow-400">40-60%</p>
          <p className="text-sm text-yellow-300">Neutral</p>
          <p className="text-xs text-gray-400">Hold</p>
        </div>
        <div className="rounded-lg bg-orange-900/30 p-3 text-center">
          <p className="text-lg font-bold text-orange-400">60-80%</p>
          <p className="text-sm text-orange-300">Moderate-High</p>
          <p className="text-xs text-gray-400">Take Profits</p>
        </div>
        <div className="rounded-lg bg-red-900/30 p-3 text-center">
          <p className="text-lg font-bold text-red-400">80-100%</p>
          <p className="text-sm text-red-300">High Risk</p>
          <p className="text-xs text-gray-400">Caution</p>
        </div>
      </div>
    </div>
  );
}

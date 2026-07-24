'use client';

import { useEffect, useState, useMemo } from 'react';
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Area,
  Brush,
  ReferenceArea,
} from 'recharts';

interface DataPoint {
  date: string;
  price: number;
  risk: number;
  timestamp: number;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: DataPoint }>;
}

function CustomTooltip({ active, payload }: CustomTooltipProps) {
  if (active && payload && payload.length > 0 && payload[0].payload) {
    const point = payload[0].payload;

    // Risk color based on value
    const riskColor = point.risk < 0.3 ? '#22c55e' :
                      point.risk < 0.5 ? '#eab308' :
                      point.risk < 0.7 ? '#f97316' : '#dc2626';

    return (
      <div className="rounded-lg border border-gray-700 bg-gray-900 p-3 shadow-lg">
        <p className="font-medium text-white">{new Date(point.date).toLocaleDateString()}</p>
        <p className="text-gray-400">
          Price: <span className="text-white font-medium">${point.price.toLocaleString()}</span>
        </p>
        <p className="text-gray-400">
          Risk: <span style={{ color: riskColor }} className="font-medium">{(point.risk * 100).toFixed(1)}%</span>
        </p>
      </div>
    );
  }
  return null;
}

type TimeRange = 'all' | '1y' | '2y' | '3y' | '5y' | 'ytd';

export default function BTCRiskChart() {
  const [data, setData] = useState<DataPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>('all');

  const [refAreaLeft, setRefAreaLeft] = useState<string | null>(null);
  const [refAreaRight, setRefAreaRight] = useState<string | null>(null);
  const [zoomStart, setZoomStart] = useState<number | null>(null);
  const [zoomEnd, setZoomEnd] = useState<number | null>(null);

  useEffect(() => {
    async function loadData() {
      try {
        const response = await fetch('/btc_risk_binance.csv');
        if (response.status === 401) {
          // Session expired — re-login instead of parsing a 401 body as CSV.
          window.location.assign('/login');
          return;
        }
        const text = await response.text();
        const lines = text.trim().split('\n');

        const parsedData: DataPoint[] = [];

        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(',');
          const date = values[0];
          const price = parseFloat(values[1]);
          const risk = parseFloat(values[2]);

          parsedData.push({
            date,
            price,
            risk,
            timestamp: new Date(date).getTime(),
          });
        }

        setData(parsedData);
        setLoading(false);
      } catch {
        setError('Failed to load data');
        setLoading(false);
      }
    }

    loadData();
  }, []);

  const filteredData = useMemo(() => {
    if (data.length === 0) return [];

    if (zoomStart !== null && zoomEnd !== null) {
      return data.filter(d => d.timestamp >= zoomStart && d.timestamp <= zoomEnd);
    }

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
        return data;
    }

    return data.filter(d => new Date(d.date) >= startDate);
  }, [data, timeRange, zoomStart, zoomEnd]);

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

  if (loading) {
    return (
      <div className="flex h-[600px] items-center justify-center">
        <div className="text-lg text-gray-500">Loading chart data...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-[600px] items-center justify-center">
        <div className="text-lg text-red-500">{error}</div>
      </div>
    );
  }

  const formatDate = (date: string) => {
    const d = new Date(date);
    return d.toLocaleDateString('en-US', { year: '2-digit', month: 'short' });
  };

  const formatPrice = (price: number) => {
    if (price >= 1000) {
      return `$${(price / 1000).toFixed(0)}k`;
    }
    return `$${price.toFixed(0)}`;
  };

  const timeRangeButtons: { label: string; value: TimeRange }[] = [
    { label: 'YTD', value: 'ytd' },
    { label: '1Y', value: '1y' },
    { label: '2Y', value: '2y' },
    { label: '3Y', value: '3y' },
    { label: '5Y', value: '5y' },
    { label: 'All', value: 'all' },
  ];

  // Calculate current stats
  const latestData = data[data.length - 1];
  const riskLevel = latestData?.risk < 0.3 ? 'Low' :
                    latestData?.risk < 0.5 ? 'Moderate' :
                    latestData?.risk < 0.7 ? 'Elevated' : 'High';

  return (
    <div className="w-full">
      {/* Current stats */}
      {latestData && (
        <div className="mb-4 flex gap-6 text-sm">
          <div>
            <span className="text-gray-500">Latest:</span>{' '}
            <span className="text-white font-medium">{latestData.date}</span>
          </div>
          <div>
            <span className="text-gray-500">Price:</span>{' '}
            <span className="text-white font-medium">${latestData.price.toLocaleString()}</span>
          </div>
          <div>
            <span className="text-gray-500">Risk:</span>{' '}
            <span className={`font-medium ${
              latestData.risk < 0.3 ? 'text-green-400' :
              latestData.risk < 0.5 ? 'text-yellow-400' :
              latestData.risk < 0.7 ? 'text-orange-400' : 'text-red-400'
            }`}>
              {(latestData.risk * 100).toFixed(1)}% ({riskLevel})
            </span>
          </div>
        </div>
      )}

      {/* Time range buttons */}
      <div className="mb-4 flex items-center gap-2">
        <span className="text-sm text-gray-500">Time Range:</span>
        {timeRangeButtons.map(({ label, value }) => (
          <button
            key={value}
            onClick={() => {
              setTimeRange(value);
              resetZoom();
            }}
            className={`rounded px-3 py-1 text-sm font-medium transition-colors ${
              timeRange === value && zoomStart === null
                ? 'bg-red-800 text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'
            }`}
          >
            {label}
          </button>
        ))}
        {zoomStart !== null && (
          <button
            onClick={resetZoom}
            className="ml-4 rounded bg-gray-700 px-3 py-1 text-sm font-medium text-white hover:bg-gray-600"
          >
            Reset Zoom
          </button>
        )}
        <span className="ml-4 text-xs text-gray-500">
          Drag on chart to zoom
        </span>
      </div>

      <div className="h-[550px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={filteredData}
            margin={{ top: 20, right: 60, left: 20, bottom: 40 }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
          >
            <XAxis
              dataKey="date"
              tickFormatter={formatDate}
              stroke="#6b7280"
              tick={{ fill: '#9ca3af', fontSize: 11 }}
              tickLine={{ stroke: '#4b5563' }}
              interval={Math.max(0, Math.floor(filteredData.length / 12) - 1)}
            />
            <YAxis
              yAxisId="price"
              orientation="left"
              scale="log"
              domain={['auto', 'auto']}
              tickFormatter={formatPrice}
              stroke="#6b7280"
              tick={{ fill: '#9ca3af', fontSize: 11 }}
              tickLine={{ stroke: '#4b5563' }}
            />
            <YAxis
              yAxisId="risk"
              orientation="right"
              domain={[0, 1]}
              tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
              stroke="#dc2626"
              tick={{ fill: '#dc2626', fontSize: 11 }}
              tickLine={{ stroke: '#dc2626' }}
            />
            <Tooltip content={<CustomTooltip />} />

            {/* Price line - gray */}
            <Line
              yAxisId="price"
              type="linear"
              dataKey="price"
              stroke="#9ca3af"
              strokeWidth={1.5}
              dot={false}
              name="BTC Price"
              isAnimationActive={false}
            />

            {/* Risk line - deep red */}
            <Line
              yAxisId="risk"
              type="linear"
              dataKey="risk"
              stroke="#dc2626"
              strokeWidth={1.5}
              dot={false}
              name="Risk Metric"
              isAnimationActive={false}
            />

            {/* Risk area fill */}
            <Area
              yAxisId="risk"
              type="linear"
              dataKey="risk"
              stroke="none"
              fill="url(#riskGradient)"
              fillOpacity={0.3}
              isAnimationActive={false}
            />

            {/* Zoom selection area */}
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

            {/* Brush for navigation */}
            <Brush
              dataKey="date"
              height={30}
              stroke="#4b5563"
              fill="#1f2937"
              tickFormatter={formatDate}
            />

            <defs>
              <linearGradient id="riskGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#dc2626" stopOpacity={0.6} />
                <stop offset="100%" stopColor="#7f1d1d" stopOpacity={0.1} />
              </linearGradient>
            </defs>
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-2 text-xs text-gray-500 text-center">
        Data source: Binance API | {data.length} days | {data[0]?.date} - {data[data.length-1]?.date}
      </div>
    </div>
  );
}

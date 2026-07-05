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
  Scatter,
  Legend,
} from 'recharts';
import {
  runComparison,
  DEFAULT_BACKTEST_CONFIG,
  DEFAULT_STRATEGY_CONFIG,
  BacktestResult,
  BenchmarkComparison,
  getZoneColor,
  getZoneDescription,
} from '@/lib/strategy';
import { RiskDataPoint } from '@/lib/risk-metric-contract';

type TabType = 'backtest' | 'signals' | 'tax';

interface BacktestFormState {
  startDate: string;
  endDate: string;
  initialCash: number;
  dcaAmount: number;
  dcaInterval: 'daily' | 'weekly' | 'monthly';
  feePercent: number;
  slippagePercent: number;
  hysteresisDays: number;
  rebalanceCadence: 'daily' | 'weekly' | 'monthly';
  taxMode: 'tracked' | 'paid';
  annualTaxBudget: number | undefined;
}

export default function StrategyPage() {
  const [riskData, setRiskData] = useState<RiskDataPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('backtest');

  const [backtestResult, setBacktestResult] = useState<BacktestResult | null>(null);
  const [benchmarks, setBenchmarks] = useState<BenchmarkComparison[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  const [formState, setFormState] = useState<BacktestFormState>({
    startDate: '2018-01-01',
    endDate: '',
    initialCash: 10000,
    dcaAmount: 100,
    dcaInterval: 'weekly',
    feePercent: 0.1,
    slippagePercent: 0.05,
    hysteresisDays: 7,
    rebalanceCadence: 'weekly',
    taxMode: 'tracked',
    annualTaxBudget: undefined,
  });

  // Load risk data
  useEffect(() => {
    async function loadData() {
      try {
        const response = await fetch('/api/risk-data');
        if (!response.ok) throw new Error('Failed to fetch risk data');

        const result = await response.json();
        setRiskData(result.data);
        setLoading(false);
      } catch (err) {
        // Fallback to static file
        try {
          const response = await fetch('/risk_data.json');
          const data = await response.json();
          setRiskData(data);
          setLoading(false);
        } catch {
          setError('Failed to load risk data');
          setLoading(false);
        }
      }
    }

    loadData();
  }, []);

  // Run backtest
  const runBacktest = () => {
    if (riskData.length === 0) return;

    setIsRunning(true);

    setTimeout(() => {
      try {
        const config = {
          ...DEFAULT_BACKTEST_CONFIG,
          startDate: formState.startDate,
          endDate: formState.endDate || undefined,
          initialCashEUR: formState.initialCash,
          initialBTC: 0,
          feePercent: formState.feePercent,
          slippagePercent: formState.slippagePercent,
          dcaAmount: formState.dcaAmount,
          dcaInterval: formState.dcaInterval,
          taxMode: formState.taxMode,
          strategy: {
            ...DEFAULT_STRATEGY_CONFIG,
            hysteresisDays: formState.hysteresisDays,
            rebalanceCadence: formState.rebalanceCadence,
            annualTaxBudget: formState.annualTaxBudget,
          },
        };

        const { strategy, benchmarks: bmks } = runComparison(riskData, config);
        setBacktestResult(strategy);
        setBenchmarks(bmks);
      } catch (err) {
        console.error('Backtest error:', err);
        setError(err instanceof Error ? err.message : 'Backtest failed');
      } finally {
        setIsRunning(false);
      }
    }, 100);
  };

  // Chart data
  const chartData = useMemo(() => {
    if (!backtestResult) return [];

    return backtestResult.portfolioHistory.map((p, i) => ({
      date: p.date,
      portfolioValue: p.totalValueEUR,
      btcAllocation: p.btcAllocation * 100,
      risk: backtestResult.signals[i]?.risk ?? 0,
      targetAllocation: (backtestResult.signals[i]?.targetAllocation ?? 0) * 100,
      riskZone: backtestResult.signals[i]?.riskZone,
    }));
  }, [backtestResult]);

  // Trade markers for chart
  const tradeMarkers = useMemo(() => {
    if (!backtestResult) return { buys: [], sells: [] };

    const buys: Array<{ date: string; value: number }> = [];
    const sells: Array<{ date: string; value: number }> = [];

    for (const trade of backtestResult.trades) {
      const portfolioPoint = backtestResult.portfolioHistory.find(p => p.date === trade.date);
      const value = portfolioPoint?.totalValueEUR ?? 0;

      if (trade.type === 'BUY') {
        buys.push({ date: trade.date, value });
      } else {
        sells.push({ date: trade.date, value });
      }
    }

    return { buys, sells };
  }, [backtestResult]);

  // Format helpers
  const formatDate = (date: string) => {
    const d = new Date(date);
    return d.toLocaleDateString('fi-FI', { year: '2-digit', month: 'short' });
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('fi-FI', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const formatPercent = (value: number) => `${value.toFixed(1)}%`;

  // Export trades as CSV
  const exportTradesCSV = () => {
    if (!backtestResult) return;

    const headers = ['Date', 'Type', 'Quantity BTC', 'Price EUR', 'Total EUR', 'Fees EUR', 'Realized P/L EUR'];
    const rows = backtestResult.trades.map(t => [
      t.date,
      t.type,
      t.quantity.toFixed(8),
      t.price.toFixed(2),
      t.totalValue.toFixed(2),
      t.fees.toFixed(2),
      t.realizedPL?.toFixed(2) ?? '',
    ]);

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ralph-trades-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  // Export tax summary as JSON
  const exportTaxSummary = () => {
    if (!backtestResult) return;

    const summary = {
      generatedAt: new Date().toISOString(),
      disclaimer: 'This is a decision-support tool, not tax advice. Consult Verohallinto for official guidance.',
      totalRealizedGains: backtestResult.taxSummary.totalRealizedGains,
      totalRealizedLosses: backtestResult.taxSummary.totalRealizedLosses,
      netRealizedPL: backtestResult.taxSummary.netRealizedPL,
      yearlyBreakdown: backtestResult.taxSummary.yearlyBreakdown,
    };

    const json = JSON.stringify(summary, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ralph-tax-summary-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-950">
        <div className="text-lg text-gray-400">Loading strategy module...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-950">
        <div className="text-lg text-red-500">{error}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">RALPH Strategy Backtest</h1>
            <p className="text-gray-400 text-sm mt-1">
              Tax-aware investment strategy using risk metric
            </p>
          </div>
          <a
            href="/dashboard"
            className="px-4 py-2 bg-gray-800 text-gray-300 rounded-lg hover:bg-gray-700"
          >
            Back to Dashboard
          </a>
        </div>

        {/* Disclaimer */}
        <div className="bg-yellow-900/30 border border-yellow-700 rounded-lg p-4">
          <p className="text-yellow-400 text-sm">
            <strong>Disclaimer:</strong> This is a decision-support tool, not financial or tax advice.
            For Finnish tax guidance, consult{' '}
            <a
              href="https://www.vero.fi/henkiloasiakkaat/omaisuus/virtuaalivaluutat/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-yellow-300"
            >
              Verohallinto
            </a>
            . FIFO calculations are simplified and may not reflect all tax rules.
          </p>
        </div>

        {/* Configuration Panel */}
        <div className="bg-gray-900 rounded-lg p-6 border border-gray-800">
          <h2 className="text-lg font-semibold mb-4">Backtest Configuration</h2>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Start Date</label>
              <input
                type="date"
                value={formState.startDate}
                onChange={e => setFormState(s => ({ ...s, startDate: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">End Date (optional)</label>
              <input
                type="date"
                value={formState.endDate}
                onChange={e => setFormState(s => ({ ...s, endDate: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">Initial Capital (EUR)</label>
              <input
                type="number"
                value={formState.initialCash}
                onChange={e => setFormState(s => ({ ...s, initialCash: Number(e.target.value) }))}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">DCA Amount (EUR)</label>
              <input
                type="number"
                value={formState.dcaAmount}
                onChange={e => setFormState(s => ({ ...s, dcaAmount: Number(e.target.value) }))}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">DCA Interval</label>
              <select
                value={formState.dcaInterval}
                onChange={e => setFormState(s => ({ ...s, dcaInterval: e.target.value as any }))}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white"
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">Rebalance Cadence</label>
              <select
                value={formState.rebalanceCadence}
                onChange={e => setFormState(s => ({ ...s, rebalanceCadence: e.target.value as any }))}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white"
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">Fee %</label>
              <input
                type="number"
                step="0.01"
                value={formState.feePercent}
                onChange={e => setFormState(s => ({ ...s, feePercent: Number(e.target.value) }))}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">Hysteresis Days</label>
              <input
                type="number"
                value={formState.hysteresisDays}
                onChange={e => setFormState(s => ({ ...s, hysteresisDays: Number(e.target.value) }))}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">Tax Mode</label>
              <select
                value={formState.taxMode}
                onChange={e => setFormState(s => ({ ...s, taxMode: e.target.value as any }))}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white"
              >
                <option value="tracked">Tracked (reporting only)</option>
                <option value="paid">Paid (simulate payment)</option>
              </select>
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">Annual Tax Budget (EUR)</label>
              <input
                type="number"
                placeholder="No limit"
                value={formState.annualTaxBudget ?? ''}
                onChange={e =>
                  setFormState(s => ({
                    ...s,
                    annualTaxBudget: e.target.value ? Number(e.target.value) : undefined,
                  }))
                }
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white"
              />
            </div>
          </div>

          <div className="mt-4 flex gap-4">
            <button
              onClick={runBacktest}
              disabled={isRunning}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {isRunning ? 'Running...' : 'Run Backtest'}
            </button>

            {backtestResult && (
              <>
                <button
                  onClick={exportTradesCSV}
                  className="px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600"
                >
                  Export Trades CSV
                </button>
                <button
                  onClick={exportTaxSummary}
                  className="px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600"
                >
                  Export Tax Summary
                </button>
              </>
            )}
          </div>
        </div>

        {/* Results */}
        {backtestResult && (
          <>
            {/* Tabs */}
            <div className="flex gap-2 border-b border-gray-800">
              {(['backtest', 'signals', 'tax'] as TabType[]).map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-4 py-2 capitalize ${
                    activeTab === tab
                      ? 'text-blue-400 border-b-2 border-blue-400'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  {tab === 'tax' ? 'Tax Summary' : tab}
                </button>
              ))}
            </div>

            {/* Backtest Tab */}
            {activeTab === 'backtest' && (
              <div className="space-y-6">
                {/* Metrics Grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
                    <p className="text-gray-400 text-sm">Final Value</p>
                    <p className="text-2xl font-bold text-white">
                      {formatCurrency(backtestResult.finalPortfolio.totalValueEUR)}
                    </p>
                  </div>
                  <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
                    <p className="text-gray-400 text-sm">Total Return</p>
                    <p
                      className={`text-2xl font-bold ${
                        backtestResult.metrics.totalReturn >= 0 ? 'text-green-400' : 'text-red-400'
                      }`}
                    >
                      {formatPercent(backtestResult.metrics.totalReturn)}
                    </p>
                  </div>
                  <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
                    <p className="text-gray-400 text-sm">CAGR</p>
                    <p className="text-2xl font-bold text-white">
                      {formatPercent(backtestResult.metrics.cagr)}
                    </p>
                  </div>
                  <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
                    <p className="text-gray-400 text-sm">Max Drawdown</p>
                    <p className="text-2xl font-bold text-red-400">
                      -{formatPercent(backtestResult.metrics.maxDrawdown)}
                    </p>
                  </div>
                  <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
                    <p className="text-gray-400 text-sm">Sharpe Proxy</p>
                    <p className="text-2xl font-bold text-white">
                      {backtestResult.metrics.sharpeProxy.toFixed(2)}
                    </p>
                  </div>
                  <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
                    <p className="text-gray-400 text-sm">Total Trades</p>
                    <p className="text-2xl font-bold text-white">
                      {backtestResult.metrics.numberOfTrades}
                    </p>
                  </div>
                  <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
                    <p className="text-gray-400 text-sm">Buys / Sells</p>
                    <p className="text-2xl font-bold text-white">
                      {backtestResult.metrics.numberOfBuys} / {backtestResult.metrics.numberOfSells}
                    </p>
                  </div>
                  <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
                    <p className="text-gray-400 text-sm">Turnover</p>
                    <p className="text-2xl font-bold text-white">
                      {(backtestResult.metrics.turnover * 100).toFixed(0)}%
                    </p>
                  </div>
                </div>

                {/* Benchmark Comparison */}
                <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
                  <h3 className="font-semibold mb-4">Benchmark Comparison</h3>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-gray-400 border-b border-gray-800">
                        <th className="text-left py-2">Strategy</th>
                        <th className="text-right py-2">Final Value</th>
                        <th className="text-right py-2">Total Return</th>
                        <th className="text-right py-2">CAGR</th>
                        <th className="text-right py-2">Max Drawdown</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-gray-800 bg-blue-900/20">
                        <td className="py-2 font-medium">Risk-Based Strategy</td>
                        <td className="text-right">{formatCurrency(backtestResult.finalPortfolio.totalValueEUR)}</td>
                        <td className="text-right">{formatPercent(backtestResult.metrics.totalReturn)}</td>
                        <td className="text-right">{formatPercent(backtestResult.metrics.cagr)}</td>
                        <td className="text-right text-red-400">-{formatPercent(backtestResult.metrics.maxDrawdown)}</td>
                      </tr>
                      {benchmarks.map(b => (
                        <tr key={b.name} className="border-b border-gray-800">
                          <td className="py-2">{b.name}</td>
                          <td className="text-right">{formatCurrency(b.finalValue)}</td>
                          <td className="text-right">{formatPercent(b.totalReturn)}</td>
                          <td className="text-right">{formatPercent(b.cagr)}</td>
                          <td className="text-right text-red-400">-{formatPercent(b.maxDrawdown)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Portfolio Chart */}
                <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
                  <h3 className="font-semibold mb-4">Portfolio Value Over Time</h3>
                  <div className="h-[400px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={chartData}>
                        <XAxis
                          dataKey="date"
                          tickFormatter={formatDate}
                          stroke="#6b7280"
                          tick={{ fill: '#9ca3af', fontSize: 10 }}
                          interval={Math.floor(chartData.length / 10)}
                        />
                        <YAxis
                          yAxisId="value"
                          orientation="left"
                          tickFormatter={v => formatCurrency(v)}
                          stroke="#6b7280"
                          tick={{ fill: '#9ca3af', fontSize: 10 }}
                        />
                        <YAxis
                          yAxisId="percent"
                          orientation="right"
                          domain={[0, 100]}
                          tickFormatter={v => `${v}%`}
                          stroke="#6b7280"
                          tick={{ fill: '#9ca3af', fontSize: 10 }}
                        />
                        <Tooltip
                          contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151' }}
                          formatter={(value, name) => {
                            const v = value as number;
                            if (name === 'portfolioValue') return [formatCurrency(v), 'Portfolio'];
                            if (name === 'btcAllocation') return [`${v.toFixed(1)}%`, 'BTC Allocation'];
                            if (name === 'risk') return [`${(v * 100).toFixed(1)}%`, 'Risk'];
                            return [v, name];
                          }}
                        />
                        <Legend />
                        <Line
                          yAxisId="value"
                          type="monotone"
                          dataKey="portfolioValue"
                          stroke="#3b82f6"
                          strokeWidth={2}
                          dot={false}
                          name="Portfolio Value"
                        />
                        <Area
                          yAxisId="percent"
                          type="monotone"
                          dataKey="btcAllocation"
                          stroke="#22c55e"
                          fill="#22c55e"
                          fillOpacity={0.2}
                          name="BTC Allocation %"
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            )}

            {/* Signals Tab */}
            {activeTab === 'signals' && (
              <div className="space-y-6">
                {/* Recent Signals Table */}
                <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
                  <h3 className="font-semibold mb-4">Recent Signals (Last 30)</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-gray-400 border-b border-gray-800">
                          <th className="text-left py-2">Date</th>
                          <th className="text-right py-2">Price</th>
                          <th className="text-right py-2">Risk</th>
                          <th className="text-left py-2">Zone</th>
                          <th className="text-right py-2">Target Alloc.</th>
                          <th className="text-center py-2">Action</th>
                          <th className="text-right py-2">Trade Size</th>
                          <th className="text-left py-2">Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {backtestResult.signals.slice(-30).reverse().map((s, i) => (
                          <tr key={i} className="border-b border-gray-800">
                            <td className="py-2">{s.date}</td>
                            <td className="text-right">{formatCurrency(s.price)}</td>
                            <td className="text-right">{formatPercent(s.risk * 100)}</td>
                            <td>
                              <span
                                className="px-2 py-1 rounded text-xs"
                                style={{ backgroundColor: getZoneColor(s.riskZone) + '30', color: getZoneColor(s.riskZone) }}
                              >
                                {s.riskZone}
                              </span>
                            </td>
                            <td className="text-right">{formatPercent(s.targetAllocation * 100)}</td>
                            <td className="text-center">
                              <span
                                className={`px-2 py-1 rounded text-xs ${
                                  s.action === 'BUY'
                                    ? 'bg-green-900/50 text-green-400'
                                    : s.action === 'SELL'
                                    ? 'bg-red-900/50 text-red-400'
                                    : 'bg-gray-800 text-gray-400'
                                }`}
                              >
                                {s.action}
                              </span>
                            </td>
                            <td className="text-right">{s.tradeSize > 0 ? formatCurrency(s.tradeSize) : '-'}</td>
                            <td className="text-gray-400 text-xs max-w-xs truncate">{s.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Zone Legend */}
                <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
                  <h3 className="font-semibold mb-4">Risk Zone Legend</h3>
                  <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                    {(['accumulate', 'normal', 'cautious', 'derisk', 'defensive'] as const).map(zone => (
                      <div
                        key={zone}
                        className="p-3 rounded"
                        style={{ backgroundColor: getZoneColor(zone) + '20', borderColor: getZoneColor(zone), borderWidth: 1 }}
                      >
                        <p className="font-medium capitalize" style={{ color: getZoneColor(zone) }}>
                          {zone}
                        </p>
                        <p className="text-gray-400 text-xs mt-1">{getZoneDescription(zone)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Tax Tab */}
            {activeTab === 'tax' && (
              <div className="space-y-6">
                {/* Tax Summary */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
                    <p className="text-gray-400 text-sm">Total Realized Gains</p>
                    <p className="text-2xl font-bold text-green-400">
                      {formatCurrency(backtestResult.taxSummary.totalRealizedGains)}
                    </p>
                  </div>
                  <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
                    <p className="text-gray-400 text-sm">Total Realized Losses</p>
                    <p className="text-2xl font-bold text-red-400">
                      {formatCurrency(backtestResult.taxSummary.totalRealizedLosses)}
                    </p>
                  </div>
                  <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
                    <p className="text-gray-400 text-sm">Net Realized P/L</p>
                    <p
                      className={`text-2xl font-bold ${
                        backtestResult.taxSummary.netRealizedPL >= 0 ? 'text-green-400' : 'text-red-400'
                      }`}
                    >
                      {formatCurrency(backtestResult.taxSummary.netRealizedPL)}
                    </p>
                  </div>
                  <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
                    <p className="text-gray-400 text-sm">Taxes Paid (if applicable)</p>
                    <p className="text-2xl font-bold text-yellow-400">
                      {formatCurrency(backtestResult.taxSummary.taxesPaid)}
                    </p>
                  </div>
                </div>

                {/* Yearly Breakdown */}
                <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
                  <h3 className="font-semibold mb-4">Yearly Tax Breakdown (FIFO)</h3>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-gray-400 border-b border-gray-800">
                        <th className="text-left py-2">Year</th>
                        <th className="text-right py-2">Gains</th>
                        <th className="text-right py-2">Losses</th>
                        <th className="text-right py-2">Net</th>
                        <th className="text-right py-2">Sales</th>
                        <th className="text-right py-2">Avg Holding (days)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {backtestResult.taxSummary.yearlyBreakdown.map(y => (
                        <tr key={y.year} className="border-b border-gray-800">
                          <td className="py-2 font-medium">{y.year}</td>
                          <td className="text-right text-green-400">{formatCurrency(y.totalGains)}</td>
                          <td className="text-right text-red-400">{formatCurrency(y.totalLosses)}</td>
                          <td
                            className={`text-right ${y.netGain >= 0 ? 'text-green-400' : 'text-red-400'}`}
                          >
                            {formatCurrency(y.netGain)}
                          </td>
                          <td className="text-right">{y.numberOfSales}</td>
                          <td className="text-right">{y.avgHoldingPeriod.toFixed(0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Tax Info */}
                <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
                  <h3 className="font-semibold mb-4">Finnish Tax Information</h3>
                  <div className="text-gray-400 text-sm space-y-2">
                    <p>
                      <strong>FIFO (First In, First Out):</strong> When selling cryptocurrency, the oldest
                      acquired units are considered sold first. This is the default method required by
                      Finnish Tax Administration.
                    </p>
                    <p>
                      <strong>Hankintameno-olettama:</strong> If you cannot prove the actual acquisition
                      cost, you may use a deemed acquisition cost (20% of sale price, or 40% if held
                      {'>'}10 years). This tool calculates FIFO by default.
                    </p>
                    <p>
                      <strong>References:</strong>
                    </p>
                    <ul className="list-disc list-inside ml-4">
                      <li>
                        <a
                          href="https://www.vero.fi/henkiloasiakkaat/omaisuus/virtuaalivaluutat/"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-400 hover:underline"
                        >
                          Verohallinto: Virtuaalivaluutat
                        </a>
                      </li>
                      <li>
                        <a
                          href="https://www.vero.fi/syventavat-vero-ohjeet/ohje-hakusivu/48411/virtuaalivaluuttojen-verotus3/"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-400 hover:underline"
                        >
                          Syventävä vero-ohje: Virtuaalivaluutat
                        </a>
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

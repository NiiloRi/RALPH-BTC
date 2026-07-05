'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
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
  Bar,
  BarChart,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import {
  runDCASwingComparison,
  runWalkForwardValidation,
  runFullSensitivityAnalysis,
  DEFAULT_DCA_SWING_CONFIG,
  DCASwingBacktestResult,
  DCASwingComparisonResult,
  BenchmarkResult,
  WalkForwardResult,
  SensitivityResult,
  getSwingZoneColor,
  getSwingZoneDescription,
  getDCARiskCurve,
  DCASwingConfig,
} from '@/lib/strategy-dca-swing';
import { RiskDataPoint } from '@/lib/risk-metric-contract';

type TabType = 'backtest' | 'comparison' | 'validation' | 'sensitivity' | 'trades' | 'tax';

interface FormState {
  startDate: string;
  endDate: string;
  initialCash: number;
  dcaBaseAmount: number;
  dcaInterval: 'daily' | 'weekly' | 'biweekly' | 'monthly';
  dcaMaxMultiplier: number;
  dcaExponent: number;
  dcaSkipAboveRisk: number;
  swingEnabled: boolean;
  swingConsecutiveDays: number;
  swingDeriskThreshold: number;
  swingDeriskPercent: number;
  swingCooldownDays: number;
  swingReriskEnabled: boolean;
  swingReriskThreshold: number;
  feePercent: number;
  annualTaxBudget: number | undefined;
}

export default function StrategyDCASwingPage() {
  const [riskData, setRiskData] = useState<RiskDataPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('backtest');

  const [comparisonResult, setComparisonResult] = useState<DCASwingComparisonResult | null>(null);
  const [walkForwardResult, setWalkForwardResult] = useState<WalkForwardResult | null>(null);
  const [sensitivityResults, setSensitivityResults] = useState<SensitivityResult[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  const [formState, setFormState] = useState<FormState>({
    startDate: '2018-01-01',
    endDate: '',
    initialCash: 10000,
    dcaBaseAmount: 100,
    dcaInterval: 'weekly',
    dcaMaxMultiplier: 3.0,
    dcaExponent: 1.5,
    dcaSkipAboveRisk: 0.70,
    swingEnabled: true,
    swingConsecutiveDays: 3,
    swingDeriskThreshold: 0.75,
    swingDeriskPercent: 0.10,
    swingCooldownDays: 14,
    swingReriskEnabled: true,
    swingReriskThreshold: 0.30,
    feePercent: 0.10,
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
      } catch {
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

  // Build config from form state
  const buildConfig = useCallback((): DCASwingConfig => {
    return {
      ...DEFAULT_DCA_SWING_CONFIG,
      startDate: formState.startDate,
      endDate: formState.endDate || undefined,
      initialCashEUR: formState.initialCash,
      feePercent: formState.feePercent,
      dca: {
        ...DEFAULT_DCA_SWING_CONFIG.dca,
        baseAmount: formState.dcaBaseAmount,
        interval: formState.dcaInterval,
        maxMultiplier: formState.dcaMaxMultiplier,
        exponent: formState.dcaExponent,
        skipAboveRisk: formState.dcaSkipAboveRisk,
      },
      swing: {
        ...DEFAULT_DCA_SWING_CONFIG.swing,
        enabled: formState.swingEnabled,
        consecutiveDaysToTrigger: formState.swingConsecutiveDays,
        deriskThreshold: formState.swingDeriskThreshold,
        deriskPercent: formState.swingDeriskPercent,
        cooldownDays: formState.swingCooldownDays,
        reriskEnabled: formState.swingReriskEnabled,
        reriskThreshold: formState.swingReriskThreshold,
      },
      tax: {
        ...DEFAULT_DCA_SWING_CONFIG.tax,
        annualTaxBudget: formState.annualTaxBudget,
      },
    };
  }, [formState]);

  // Run backtest
  const runBacktest = useCallback(() => {
    if (riskData.length === 0) return;

    setIsRunning(true);
    setError(null);

    setTimeout(() => {
      try {
        const config = buildConfig();
        const result = runDCASwingComparison(riskData, config);
        setComparisonResult(result);
      } catch (err) {
        console.error('Backtest error:', err);
        setError(err instanceof Error ? err.message : 'Backtest failed');
      } finally {
        setIsRunning(false);
      }
    }, 100);
  }, [riskData, buildConfig]);

  // Run walk-forward validation
  const runValidation = useCallback(() => {
    if (riskData.length === 0) return;

    setIsRunning(true);
    setError(null);

    setTimeout(() => {
      try {
        const config = buildConfig();
        const result = runWalkForwardValidation(riskData, config, 4);
        setWalkForwardResult(result);
      } catch (err) {
        console.error('Validation error:', err);
        setError(err instanceof Error ? err.message : 'Validation failed');
      } finally {
        setIsRunning(false);
      }
    }, 100);
  }, [riskData, buildConfig]);

  // Run sensitivity analysis
  const runSensitivity = useCallback(() => {
    if (riskData.length === 0) return;

    setIsRunning(true);
    setError(null);

    setTimeout(() => {
      try {
        const config = buildConfig();
        const results = runFullSensitivityAnalysis(riskData, config);
        setSensitivityResults(results);
      } catch (err) {
        console.error('Sensitivity error:', err);
        setError(err instanceof Error ? err.message : 'Sensitivity analysis failed');
      } finally {
        setIsRunning(false);
      }
    }, 100);
  }, [riskData, buildConfig]);

  // Chart data
  const chartData = useMemo(() => {
    if (!comparisonResult) return [];

    return comparisonResult.strategy.portfolioHistory.map((p) => ({
      date: p.date,
      portfolioValue: p.totalValueEUR,
      btcAllocation: p.btcAllocation * 100,
      risk: p.risk * 100,
      zone: p.zone,
      cashEUR: p.cashEUR,
      btcValueEUR: p.btcValueEUR,
    }));
  }, [comparisonResult]);

  // DCA curve data for visualization
  const dcaCurveData = useMemo(() => {
    return getDCARiskCurve({
      ...DEFAULT_DCA_SWING_CONFIG.dca,
      maxMultiplier: formState.dcaMaxMultiplier,
      exponent: formState.dcaExponent,
      skipAboveRisk: formState.dcaSkipAboveRisk,
    });
  }, [formState.dcaMaxMultiplier, formState.dcaExponent, formState.dcaSkipAboveRisk]);

  // Trade markers
  const tradeMarkers = useMemo(() => {
    if (!comparisonResult) return { dcaBuys: [], swingSells: [], reriskBuys: [] };

    const trades = comparisonResult.strategy.trades;
    const history = comparisonResult.strategy.portfolioHistory;

    const findValue = (date: string) => {
      const point = history.find(h => h.date === date);
      return point?.totalValueEUR || 0;
    };

    return {
      dcaBuys: trades.filter(t => t.type === 'DCA_BUY').map(t => ({
        date: t.date,
        value: findValue(t.date),
        amount: t.totalEUR,
      })),
      swingSells: trades.filter(t => t.type === 'SWING_SELL').map(t => ({
        date: t.date,
        value: findValue(t.date),
        amount: t.totalEUR,
        gain: t.realizedGainEUR,
      })),
      reriskBuys: trades.filter(t => t.type === 'RERISK_BUY').map(t => ({
        date: t.date,
        value: findValue(t.date),
        amount: t.totalEUR,
      })),
    };
  }, [comparisonResult]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-900">
        <div className="text-white text-xl">Loading risk data...</div>
      </div>
    );
  }

  const strategy = comparisonResult?.strategy;
  const benchmarks = comparisonResult?.benchmarks || [];

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Dynamic DCA + Swing Trading</h1>
          <p className="text-gray-400">
            Risk-based DCA sizing with swing trading de-risking. Finnish FIFO tax tracking.
          </p>
        </div>

        {/* Error display */}
        {error && (
          <div className="bg-red-900/50 border border-red-500 rounded-lg p-4 mb-6">
            <p className="text-red-300">{error}</p>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-2 mb-6 flex-wrap">
          {(['backtest', 'comparison', 'validation', 'sensitivity', 'trades', 'tax'] as TabType[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-lg transition-colors ${
                activeTab === tab
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {/* Configuration Panel */}
        <div className="bg-gray-800 rounded-lg p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Configuration</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Date Range */}
            <div>
              <label className="block text-sm text-gray-400 mb-1">Start Date</label>
              <input
                type="date"
                value={formState.startDate}
                onChange={(e) => setFormState(s => ({ ...s, startDate: e.target.value }))}
                className="w-full bg-gray-700 rounded px-3 py-2 text-white"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">End Date (optional)</label>
              <input
                type="date"
                value={formState.endDate}
                onChange={(e) => setFormState(s => ({ ...s, endDate: e.target.value }))}
                className="w-full bg-gray-700 rounded px-3 py-2 text-white"
              />
            </div>

            {/* Initial Cash */}
            <div>
              <label className="block text-sm text-gray-400 mb-1">Initial Cash (EUR)</label>
              <input
                type="number"
                value={formState.initialCash}
                onChange={(e) => setFormState(s => ({ ...s, initialCash: Number(e.target.value) }))}
                className="w-full bg-gray-700 rounded px-3 py-2 text-white"
              />
            </div>

            {/* DCA Settings */}
            <div>
              <label className="block text-sm text-gray-400 mb-1">DCA Base Amount (EUR)</label>
              <input
                type="number"
                value={formState.dcaBaseAmount}
                onChange={(e) => setFormState(s => ({ ...s, dcaBaseAmount: Number(e.target.value) }))}
                className="w-full bg-gray-700 rounded px-3 py-2 text-white"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">DCA Interval</label>
              <select
                value={formState.dcaInterval}
                onChange={(e) => setFormState(s => ({ ...s, dcaInterval: e.target.value as 'daily' | 'weekly' | 'biweekly' | 'monthly' }))}
                className="w-full bg-gray-700 rounded px-3 py-2 text-white"
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="biweekly">Bi-weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">DCA Max Multiplier</label>
              <input
                type="number"
                step="0.5"
                value={formState.dcaMaxMultiplier}
                onChange={(e) => setFormState(s => ({ ...s, dcaMaxMultiplier: Number(e.target.value) }))}
                className="w-full bg-gray-700 rounded px-3 py-2 text-white"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">Skip DCA Above Risk</label>
              <input
                type="number"
                step="0.05"
                min="0"
                max="1"
                value={formState.dcaSkipAboveRisk}
                onChange={(e) => setFormState(s => ({ ...s, dcaSkipAboveRisk: Number(e.target.value) }))}
                className="w-full bg-gray-700 rounded px-3 py-2 text-white"
              />
            </div>

            {/* Swing Settings */}
            <div>
              <label className="block text-sm text-gray-400 mb-1">Swing Trading</label>
              <select
                value={formState.swingEnabled ? 'enabled' : 'disabled'}
                onChange={(e) => setFormState(s => ({ ...s, swingEnabled: e.target.value === 'enabled' }))}
                className="w-full bg-gray-700 rounded px-3 py-2 text-white"
              >
                <option value="enabled">Enabled</option>
                <option value="disabled">Disabled</option>
              </select>
            </div>

            {formState.swingEnabled && (
              <>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">De-risk Trigger Days</label>
                  <input
                    type="number"
                    min="1"
                    max="14"
                    value={formState.swingConsecutiveDays}
                    onChange={(e) => setFormState(s => ({ ...s, swingConsecutiveDays: Number(e.target.value) }))}
                    className="w-full bg-gray-700 rounded px-3 py-2 text-white"
                  />
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-1">De-risk Threshold</label>
                  <input
                    type="number"
                    step="0.05"
                    min="0.5"
                    max="0.95"
                    value={formState.swingDeriskThreshold}
                    onChange={(e) => setFormState(s => ({ ...s, swingDeriskThreshold: Number(e.target.value) }))}
                    className="w-full bg-gray-700 rounded px-3 py-2 text-white"
                  />
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-1">De-risk %</label>
                  <input
                    type="number"
                    step="0.05"
                    min="0.05"
                    max="0.50"
                    value={formState.swingDeriskPercent}
                    onChange={(e) => setFormState(s => ({ ...s, swingDeriskPercent: Number(e.target.value) }))}
                    className="w-full bg-gray-700 rounded px-3 py-2 text-white"
                  />
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-1">Cooldown Days</label>
                  <input
                    type="number"
                    min="7"
                    max="60"
                    value={formState.swingCooldownDays}
                    onChange={(e) => setFormState(s => ({ ...s, swingCooldownDays: Number(e.target.value) }))}
                    className="w-full bg-gray-700 rounded px-3 py-2 text-white"
                  />
                </div>
              </>
            )}

            {/* Fee */}
            <div>
              <label className="block text-sm text-gray-400 mb-1">Fee %</label>
              <input
                type="number"
                step="0.01"
                min="0"
                max="1"
                value={formState.feePercent}
                onChange={(e) => setFormState(s => ({ ...s, feePercent: Number(e.target.value) }))}
                className="w-full bg-gray-700 rounded px-3 py-2 text-white"
              />
            </div>

            {/* Tax Budget */}
            <div>
              <label className="block text-sm text-gray-400 mb-1">Annual Tax Budget (EUR)</label>
              <input
                type="number"
                value={formState.annualTaxBudget || ''}
                onChange={(e) => setFormState(s => ({
                  ...s,
                  annualTaxBudget: e.target.value ? Number(e.target.value) : undefined
                }))}
                placeholder="No limit"
                className="w-full bg-gray-700 rounded px-3 py-2 text-white"
              />
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-4 mt-6">
            <button
              onClick={runBacktest}
              disabled={isRunning || riskData.length === 0}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 rounded-lg font-semibold transition-colors"
            >
              {isRunning ? 'Running...' : 'Run Backtest'}
            </button>
            <button
              onClick={runValidation}
              disabled={isRunning || riskData.length === 0}
              className="px-6 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 rounded-lg font-semibold transition-colors"
            >
              Walk-Forward Validation
            </button>
            <button
              onClick={runSensitivity}
              disabled={isRunning || riskData.length === 0}
              className="px-6 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 rounded-lg font-semibold transition-colors"
            >
              Sensitivity Analysis
            </button>
          </div>
        </div>

        {/* Tab Content */}
        {activeTab === 'backtest' && strategy && (
          <div className="space-y-6">
            {/* Metrics Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
              <MetricCard label="Total Return" value={`${strategy.metrics.totalReturn.toFixed(1)}%`} />
              <MetricCard label="CAGR" value={`${strategy.metrics.cagr.toFixed(1)}%`} />
              <MetricCard
                label="After-Tax CAGR"
                value={`${strategy.taxMetrics.afterTaxCAGR.toFixed(1)}%`}
                highlight
              />
              <MetricCard label="Max Drawdown" value={`${strategy.metrics.maxDrawdown.toFixed(1)}%`} negative />
              <MetricCard label="Sharpe Ratio" value={strategy.metrics.sharpeRatio.toFixed(2)} />
              <MetricCard label="Sortino Ratio" value={strategy.metrics.sortinoRatio.toFixed(2)} />
              <MetricCard label="Total Trades" value={strategy.metrics.numberOfTrades.toString()} />
              <MetricCard label="DCA Buys" value={strategy.metrics.numberOfDCABuys.toString()} />
              <MetricCard label="Swing Sells" value={strategy.metrics.numberOfSwingSells.toString()} />
              <MetricCard label="Win Rate" value={`${strategy.metrics.winRate.toFixed(0)}%`} />
              <MetricCard label="Total Invested" value={`€${strategy.metrics.totalInvested.toFixed(0)}`} />
              <MetricCard label="Avg Buy Price" value={`€${strategy.metrics.avgBuyPrice.toFixed(0)}`} />
            </div>

            {/* Portfolio Chart */}
            <div className="bg-gray-800 rounded-lg p-6">
              <h3 className="text-lg font-semibold mb-4">Portfolio Value Over Time</h3>
              <div className="h-96">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData}>
                    <XAxis
                      dataKey="date"
                      tick={{ fill: '#9ca3af', fontSize: 10 }}
                      tickFormatter={(d) => d.slice(0, 7)}
                    />
                    <YAxis
                      yAxisId="value"
                      tick={{ fill: '#9ca3af' }}
                      tickFormatter={(v) => `€${(v / 1000).toFixed(0)}k`}
                    />
                    <YAxis
                      yAxisId="percent"
                      orientation="right"
                      tick={{ fill: '#9ca3af' }}
                      domain={[0, 100]}
                    />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: '8px' }}
                      formatter={(value, name) => {
                        const v = value as number;
                        if (name === 'portfolioValue') return [`€${v.toFixed(0)}`, 'Portfolio'];
                        if (name === 'risk') return [`${v.toFixed(0)}%`, 'Risk'];
                        if (name === 'btcAllocation') return [`${v.toFixed(0)}%`, 'BTC Allocation'];
                        return [v, name];
                      }}
                    />
                    <Legend />
                    <Area
                      yAxisId="value"
                      type="monotone"
                      dataKey="portfolioValue"
                      fill="#3b82f6"
                      fillOpacity={0.3}
                      stroke="#3b82f6"
                      name="Portfolio Value"
                    />
                    <Line
                      yAxisId="percent"
                      type="monotone"
                      dataKey="risk"
                      stroke="#ef4444"
                      strokeWidth={1}
                      dot={false}
                      name="Risk %"
                    />
                    <Line
                      yAxisId="percent"
                      type="monotone"
                      dataKey="btcAllocation"
                      stroke="#22c55e"
                      strokeWidth={1}
                      dot={false}
                      name="BTC Allocation %"
                    />
                    {/* Trade markers */}
                    <Scatter
                      yAxisId="value"
                      data={tradeMarkers.swingSells}
                      fill="#ef4444"
                      name="Swing Sells"
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* DCA Multiplier Curve */}
            <div className="bg-gray-800 rounded-lg p-6">
              <h3 className="text-lg font-semibold mb-4">DCA Multiplier Curve</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={dcaCurveData}>
                    <XAxis
                      dataKey="risk"
                      tick={{ fill: '#9ca3af' }}
                      tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
                    />
                    <YAxis
                      tick={{ fill: '#9ca3af' }}
                      domain={[0, formState.dcaMaxMultiplier + 0.5]}
                    />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: '8px' }}
                      formatter={(value, name) => {
                        const v = value as number;
                        if (name === 'multiplier') return [`${v.toFixed(2)}x`, 'Multiplier'];
                        if (name === 'amount') return [`€${v.toFixed(0)}`, 'DCA Amount'];
                        return [v, name];
                      }}
                      labelFormatter={(label) => `Risk: ${((label as number) * 100).toFixed(0)}%`}
                    />
                    <ReferenceLine
                      x={formState.dcaSkipAboveRisk}
                      stroke="#ef4444"
                      strokeDasharray="5 5"
                      label={{ value: 'Skip', fill: '#ef4444', position: 'top' }}
                    />
                    <Area
                      type="monotone"
                      dataKey="multiplier"
                      fill="#22c55e"
                      fillOpacity={0.3}
                      stroke="#22c55e"
                      name="Multiplier"
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <p className="text-gray-400 text-sm mt-2">
                At low risk (green zone), DCA amounts are multiplied by up to {formState.dcaMaxMultiplier}x.
                At high risk (above {(formState.dcaSkipAboveRisk * 100).toFixed(0)}%), DCA is skipped.
              </p>
            </div>
          </div>
        )}

        {activeTab === 'comparison' && comparisonResult && (
          <div className="space-y-6">
            {/* Comparison Table */}
            <div className="bg-gray-800 rounded-lg p-6">
              <h3 className="text-lg font-semibold mb-4">Strategy vs Benchmarks</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-gray-700">
                      <th className="py-3 px-4">Strategy</th>
                      <th className="py-3 px-4">Final Value</th>
                      <th className="py-3 px-4">Total Return</th>
                      <th className="py-3 px-4">CAGR</th>
                      <th className="py-3 px-4">After-Tax CAGR</th>
                      <th className="py-3 px-4">Max Drawdown</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-gray-700 bg-blue-900/20">
                      <td className="py-3 px-4 font-semibold">Dynamic DCA + Swing</td>
                      <td className="py-3 px-4">€{comparisonResult.strategy.finalPortfolio.totalValueEUR.toFixed(0)}</td>
                      <td className="py-3 px-4">{comparisonResult.strategy.metrics.totalReturn.toFixed(1)}%</td>
                      <td className="py-3 px-4">{comparisonResult.strategy.metrics.cagr.toFixed(1)}%</td>
                      <td className="py-3 px-4 font-semibold text-green-400">
                        {comparisonResult.strategy.taxMetrics.afterTaxCAGR.toFixed(1)}%
                      </td>
                      <td className="py-3 px-4 text-red-400">
                        {comparisonResult.strategy.metrics.maxDrawdown.toFixed(1)}%
                      </td>
                    </tr>
                    {benchmarks.map((b, i) => (
                      <tr key={i} className="border-b border-gray-700">
                        <td className="py-3 px-4">{b.name}</td>
                        <td className="py-3 px-4">€{b.finalValue.toFixed(0)}</td>
                        <td className="py-3 px-4">{b.totalReturn.toFixed(1)}%</td>
                        <td className="py-3 px-4">{b.cagr.toFixed(1)}%</td>
                        <td className="py-3 px-4">{b.afterTaxCAGR?.toFixed(1) || '-'}%</td>
                        <td className="py-3 px-4 text-red-400">{b.maxDrawdown.toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Summary */}
              <div className="mt-6 p-4 bg-gray-700 rounded-lg">
                <h4 className="font-semibold mb-2">Summary</h4>
                <p className={comparisonResult.summary.strategyWins ? 'text-green-400' : 'text-red-400'}>
                  {comparisonResult.summary.strategyWins
                    ? `Strategy outperforms by ${comparisonResult.summary.afterTaxOutperformance.toFixed(1)} percentage points (after-tax CAGR)`
                    : `Strategy underperforms by ${Math.abs(comparisonResult.summary.afterTaxOutperformance).toFixed(1)} percentage points`
                  }
                </p>
                <p className="text-gray-400 mt-1">
                  Tax efficiency: {(comparisonResult.summary.taxEfficiency * 100).toFixed(0)}% of pre-tax returns retained
                </p>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'validation' && walkForwardResult && (
          <div className="space-y-6">
            <div className="bg-gray-800 rounded-lg p-6">
              <h3 className="text-lg font-semibold mb-4">Walk-Forward Validation Results</h3>

              {/* Summary */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <MetricCard label="Avg In-Sample CAGR" value={`${walkForwardResult.avgInSampleCAGR.toFixed(1)}%`} />
                <MetricCard label="Avg Out-of-Sample CAGR" value={`${walkForwardResult.avgOutOfSampleCAGR.toFixed(1)}%`} />
                <MetricCard label="Avg Degradation" value={`${(walkForwardResult.avgDegradation * 100).toFixed(0)}%`} negative={walkForwardResult.avgDegradation > 0.3} />
                <MetricCard
                  label="Is Robust"
                  value={walkForwardResult.isRobust ? 'Yes' : 'No'}
                  highlight={walkForwardResult.isRobust}
                  negative={!walkForwardResult.isRobust}
                />
              </div>

              {/* Fold Details */}
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-gray-700">
                      <th className="py-3 px-4">Fold</th>
                      <th className="py-3 px-4">Train Period</th>
                      <th className="py-3 px-4">Test Period</th>
                      <th className="py-3 px-4">In-Sample CAGR</th>
                      <th className="py-3 px-4">Out-of-Sample CAGR</th>
                      <th className="py-3 px-4">Degradation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {walkForwardResult.folds.map((fold) => (
                      <tr key={fold.foldNumber} className="border-b border-gray-700">
                        <td className="py-3 px-4">{fold.foldNumber}</td>
                        <td className="py-3 px-4 text-sm">{fold.trainStart} to {fold.trainEnd}</td>
                        <td className="py-3 px-4 text-sm">{fold.testStart} to {fold.testEnd}</td>
                        <td className="py-3 px-4">{fold.inSampleCAGR.toFixed(1)}%</td>
                        <td className="py-3 px-4">{fold.outOfSampleCAGR.toFixed(1)}%</td>
                        <td className={`py-3 px-4 ${fold.degradation > 0.3 ? 'text-red-400' : 'text-green-400'}`}>
                          {(fold.degradation * 100).toFixed(0)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="text-gray-400 text-sm mt-4">
                Walk-forward validation tests the strategy on unseen future data.
                A robust strategy should retain at least 70% of in-sample performance.
              </p>
            </div>
          </div>
        )}

        {activeTab === 'sensitivity' && sensitivityResults.length > 0 && (
          <div className="space-y-6">
            {sensitivityResults.map((s) => (
              <div key={s.parameter} className="bg-gray-800 rounded-lg p-6">
                <h3 className="text-lg font-semibold mb-4">{s.parameter}</h3>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={s.results}>
                      <XAxis dataKey="value" tick={{ fill: '#9ca3af' }} />
                      <YAxis tick={{ fill: '#9ca3af' }} />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: '8px' }}
                      />
                      <Bar dataKey="afterTaxCAGR" name="After-Tax CAGR %">
                        {s.results.map((entry, index) => (
                          <Cell
                            key={`cell-${index}`}
                            fill={entry.value === s.optimalValue ? '#22c55e' : '#3b82f6'}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <p className="text-gray-400 text-sm mt-2">
                  Optimal value: <span className="text-green-400 font-semibold">{s.optimalValue}</span>
                  {' '}(CAGR: {s.optimalCAGR.toFixed(1)}%)
                </p>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'trades' && strategy && (
          <div className="bg-gray-800 rounded-lg p-6">
            <h3 className="text-lg font-semibold mb-4">Trade History ({strategy.trades.length} trades)</h3>
            <div className="overflow-x-auto max-h-96">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-gray-800">
                  <tr className="border-b border-gray-700">
                    <th className="py-2 px-3">Date</th>
                    <th className="py-2 px-3">Type</th>
                    <th className="py-2 px-3">BTC</th>
                    <th className="py-2 px-3">Price</th>
                    <th className="py-2 px-3">Total EUR</th>
                    <th className="py-2 px-3">P/L</th>
                    <th className="py-2 px-3">Risk</th>
                    <th className="py-2 px-3">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {strategy.trades.slice().reverse().map((trade, i) => (
                    <tr key={i} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                      <td className="py-2 px-3">{trade.date}</td>
                      <td className={`py-2 px-3 ${
                        trade.type.includes('BUY') ? 'text-green-400' : 'text-red-400'
                      }`}>
                        {trade.type.replace('_', ' ')}
                      </td>
                      <td className="py-2 px-3">{trade.btcAmount.toFixed(6)}</td>
                      <td className="py-2 px-3">€{trade.priceEUR.toFixed(0)}</td>
                      <td className="py-2 px-3">€{trade.totalEUR.toFixed(0)}</td>
                      <td className={`py-2 px-3 ${
                        (trade.realizedGainEUR || 0) >= 0 ? 'text-green-400' : 'text-red-400'
                      }`}>
                        {trade.realizedGainEUR !== undefined ? `€${trade.realizedGainEUR.toFixed(0)}` : '-'}
                      </td>
                      <td className="py-2 px-3">{(trade.riskAtTrade * 100).toFixed(0)}%</td>
                      <td className="py-2 px-3 text-gray-400 text-xs">{trade.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'tax' && strategy && (
          <div className="space-y-6">
            {/* Tax Summary */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <MetricCard label="Total Realized Gains" value={`€${strategy.taxMetrics.totalRealizedGains.toFixed(0)}`} />
              <MetricCard label="Total Realized Losses" value={`€${strategy.taxMetrics.totalRealizedLosses.toFixed(0)}`} negative />
              <MetricCard label="Net Realized P/L" value={`€${strategy.taxMetrics.netRealizedPL.toFixed(0)}`} />
              <MetricCard label="Total Tax Paid" value={`€${strategy.taxMetrics.totalTaxPaid.toFixed(0)}`} negative />
            </div>

            {/* Yearly Breakdown */}
            <div className="bg-gray-800 rounded-lg p-6">
              <h3 className="text-lg font-semibold mb-4">Yearly Tax Breakdown</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-gray-700">
                      <th className="py-3 px-4">Year</th>
                      <th className="py-3 px-4">Gains</th>
                      <th className="py-3 px-4">Losses</th>
                      <th className="py-3 px-4">Net</th>
                      <th className="py-3 px-4"># Sales</th>
                      <th className="py-3 px-4">Avg Holding</th>
                      <th className="py-3 px-4">Tax</th>
                      <th className="py-3 px-4">After-Tax</th>
                    </tr>
                  </thead>
                  <tbody>
                    {strategy.taxMetrics.yearlyBreakdown.map((y) => (
                      <tr key={y.year} className="border-b border-gray-700">
                        <td className="py-3 px-4 font-semibold">{y.year}</td>
                        <td className="py-3 px-4 text-green-400">€{y.totalGains.toFixed(0)}</td>
                        <td className="py-3 px-4 text-red-400">€{y.totalLosses.toFixed(0)}</td>
                        <td className={`py-3 px-4 ${y.netGain >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          €{y.netGain.toFixed(0)}
                        </td>
                        <td className="py-3 px-4">{y.numberOfSales}</td>
                        <td className="py-3 px-4">{y.avgHoldingDays} days</td>
                        <td className="py-3 px-4 text-red-400">€{y.estimatedTax.toFixed(0)}</td>
                        <td className="py-3 px-4">€{y.afterTaxGain.toFixed(0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-gray-400 text-sm mt-4">
                Finnish tax rates: 30% on capital gains up to €30,000, 34% above.
                Losses can offset gains in the same year.
              </p>
            </div>
          </div>
        )}

        {/* No results message */}
        {!comparisonResult && !isRunning && (
          <div className="bg-gray-800 rounded-lg p-12 text-center">
            <p className="text-gray-400 text-lg mb-4">Configure parameters above and run a backtest to see results.</p>
            <button
              onClick={runBacktest}
              disabled={riskData.length === 0}
              className="px-8 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 rounded-lg font-semibold transition-colors"
            >
              Run Backtest
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// Metric Card Component
function MetricCard({
  label,
  value,
  highlight = false,
  negative = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  negative?: boolean;
}) {
  return (
    <div className={`bg-gray-800 rounded-lg p-4 ${highlight ? 'ring-2 ring-green-500' : ''}`}>
      <div className="text-gray-400 text-sm mb-1">{label}</div>
      <div className={`text-xl font-semibold ${
        negative ? 'text-red-400' : highlight ? 'text-green-400' : 'text-white'
      }`}>
        {value}
      </div>
    </div>
  );
}

'use client';

import { useMemo } from 'react';
import type {
  MetaLayersOutput,
  RiskConfidence,
  RiskMomentum,
  DrawdownProbability,
  CycleRelativeRisk,
  PositionGuidance,
  HistoricalContext,
} from '@/lib/meta/types';

interface MetaLayersPanelProps {
  meta: MetaLayersOutput | undefined;
  isExpanded: boolean;
  onToggle: () => void;
}

/**
 * Get color for confidence level
 */
function getConfidenceColor(level: string): string {
  switch (level) {
    case 'high': return '#22c55e';
    case 'medium': return '#eab308';
    case 'low': return '#ef4444';
    default: return '#9ca3af';
  }
}

/**
 * Get color for momentum direction
 */
function getMomentumColor(direction: string): string {
  switch (direction) {
    case 'rising': return '#ef4444';
    case 'falling': return '#22c55e';
    case 'stable': return '#9ca3af';
    default: return '#9ca3af';
  }
}

/**
 * Get color for drawdown risk level
 */
function getDrawdownRiskColor(level: string): string {
  switch (level) {
    case 'minimal': return '#22c55e';
    case 'low': return '#84cc16';
    case 'moderate': return '#eab308';
    case 'elevated': return '#f97316';
    case 'high': return '#ef4444';
    default: return '#9ca3af';
  }
}

/**
 * Risk Confidence Card
 */
function ConfidenceCard({ confidence }: { confidence: RiskConfidence }) {
  return (
    <div className="bg-gray-800/50 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-medium text-white">Risk Confidence</h4>
        <span
          className="px-2 py-1 rounded text-xs font-medium uppercase"
          style={{
            backgroundColor: `${getConfidenceColor(confidence.level)}20`,
            color: getConfidenceColor(confidence.level),
          }}
        >
          {confidence.level}
        </span>
      </div>

      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-gray-400">Confidence Score</span>
          <span className="text-white font-medium">
            {(confidence.value * 100).toFixed(0)}%
          </span>
        </div>

        <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{
              width: `${confidence.value * 100}%`,
              backgroundColor: getConfidenceColor(confidence.level),
            }}
          />
        </div>

        <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
          <div>
            <span className="text-gray-500">Component Agreement</span>
            <p className="text-gray-300">{(confidence.componentAgreement * 100).toFixed(0)}%</p>
          </div>
          <div>
            <span className="text-gray-500">Regime Stability</span>
            <p className="text-gray-300">{(confidence.regimeStability * 100).toFixed(0)}%</p>
          </div>
        </div>
      </div>

      <p className="mt-3 text-xs text-gray-500">
        Measures agreement between risk components and regime stability
      </p>
    </div>
  );
}

/**
 * Risk Momentum Card
 */
function MomentumCard({ momentum }: { momentum: RiskMomentum }) {
  return (
    <div className="bg-gray-800/50 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-medium text-white">Risk Momentum</h4>
        <span
          className="text-2xl"
          style={{ color: getMomentumColor(momentum.direction) }}
        >
          {momentum.directionSymbol}
        </span>
      </div>

      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-gray-400">Direction</span>
          <span
            className="font-medium capitalize"
            style={{ color: getMomentumColor(momentum.direction) }}
          >
            {momentum.direction}
          </span>
        </div>

        <div className="flex justify-between text-sm">
          <span className="text-gray-400">7-Day Change</span>
          <span className={momentum.delta7d > 0 ? 'text-red-400' : momentum.delta7d < 0 ? 'text-green-400' : 'text-gray-400'}>
            {momentum.delta7d > 0 ? '+' : ''}{(momentum.delta7d * 100).toFixed(1)}%
          </span>
        </div>

        <div className="flex justify-between text-sm">
          <span className="text-gray-400">30-Day Change</span>
          <span className={momentum.delta30d > 0 ? 'text-red-400' : momentum.delta30d < 0 ? 'text-green-400' : 'text-gray-400'}>
            {momentum.delta30d > 0 ? '+' : ''}{(momentum.delta30d * 100).toFixed(1)}%
          </span>
        </div>

        <div className="flex justify-between text-sm">
          <span className="text-gray-400">Momentum Strength</span>
          <span className="text-white">{(momentum.strength * 100).toFixed(0)}%</span>
        </div>
      </div>

      <p className="mt-3 text-xs text-gray-500">
        Derived from risk time series (first derivative)
      </p>
    </div>
  );
}

/**
 * Drawdown Probability Card
 */
function DrawdownCard({ drawdown }: { drawdown: DrawdownProbability }) {
  const probabilities = [
    { label: '10% DD (30d)', value: drawdown.prob10pct30d },
    { label: '20% DD (30d)', value: drawdown.prob20pct30d },
    { label: '30% DD (90d)', value: drawdown.prob30pct90d },
    { label: '50% DD (180d)', value: drawdown.prob50pct180d },
  ];

  return (
    <div className="bg-gray-800/50 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-medium text-white">Drawdown Probability</h4>
        <span
          className="px-2 py-1 rounded text-xs font-medium uppercase"
          style={{
            backgroundColor: `${getDrawdownRiskColor(drawdown.riskLevel)}20`,
            color: getDrawdownRiskColor(drawdown.riskLevel),
          }}
        >
          {drawdown.riskLevel}
        </span>
      </div>

      <div className="space-y-2">
        {probabilities.map(({ label, value }) => (
          <div key={label} className="flex items-center gap-2">
            <span className="text-xs text-gray-400 w-24">{label}</span>
            <div className="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${value * 100}%`,
                  backgroundColor: value > 0.5 ? '#ef4444' : value > 0.3 ? '#f97316' : value > 0.15 ? '#eab308' : '#22c55e',
                }}
              />
            </div>
            <span className="text-xs text-white w-10 text-right">
              {(value * 100).toFixed(0)}%
            </span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
        <div>
          <span className="text-gray-500">Vol Regime</span>
          <p className="text-gray-300 capitalize">{drawdown.volatilityRegime}</p>
        </div>
        <div>
          <span className="text-gray-500">Left-Tail Risk</span>
          <p className="text-gray-300">{(drawdown.leftTailRisk * 100).toFixed(0)}%</p>
        </div>
      </div>

      <p className="mt-3 text-xs text-gray-500">
        Separate estimate - does NOT influence base risk
      </p>
    </div>
  );
}

/**
 * Cycle-Relative Risk Card
 */
function CycleRelativeCard({ cycleRelative }: { cycleRelative: CycleRelativeRisk }) {
  return (
    <div className="bg-gray-800/50 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-medium text-white">Cycle-Relative Risk</h4>
        {cycleRelative.isElevated && (
          <span className="px-2 py-1 rounded text-xs font-medium uppercase bg-orange-900/30 text-orange-400">
            Elevated
          </span>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-gray-400">Phase Percentile</span>
          <span className="text-white font-medium">
            {(cycleRelative.cyclePhasePercentile * 100).toFixed(0)}%
          </span>
        </div>

        <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{
              width: `${cycleRelative.cyclePhasePercentile * 100}%`,
              backgroundColor: cycleRelative.isElevated ? '#f97316' : '#3b82f6',
            }}
          />
        </div>

        <div className="flex justify-between text-sm">
          <span className="text-gray-400">vs. Historical Avg</span>
          <span className={cycleRelative.deviationFromAvg > 0 ? 'text-orange-400' : 'text-blue-400'}>
            {cycleRelative.deviationFromAvg > 0 ? '+' : ''}{(cycleRelative.deviationFromAvg * 100).toFixed(1)}%
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2 mt-1 text-xs">
          <div>
            <span className="text-gray-500">Cycle Phase</span>
            <p className="text-gray-300 capitalize">{cycleRelative.cyclePhase}</p>
          </div>
          <div>
            <span className="text-gray-500">Days Into Cycle</span>
            <p className="text-gray-300">{cycleRelative.daysIntoCycle}</p>
          </div>
        </div>
      </div>

      <p className="mt-3 text-xs text-gray-500">
        Comparison view only - absolute risk remains canonical
      </p>
    </div>
  );
}

/**
 * Position Guidance Card
 */
function GuidanceCard({ guidance }: { guidance: PositionGuidance }) {
  const dcaPacingColors: Record<string, string> = {
    accelerate: '#22c55e',
    normal: '#3b82f6',
    decelerate: '#f97316',
    pause: '#ef4444',
  };

  const profitColors: Record<string, string> = {
    none: '#22c55e',
    light: '#84cc16',
    moderate: '#eab308',
    aggressive: '#ef4444',
  };

  return (
    <div className="bg-gray-800/50 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-medium text-white">Position Guidance</h4>
        <span className="text-xs text-gray-500">NON-DIRECTIVE</span>
      </div>

      <div className="space-y-3">
        {/* Size Multiplier */}
        <div>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-gray-400">Size Multiplier</span>
            <span className="text-white font-medium">
              {guidance.sizeMultiplier.toFixed(2)}x
            </span>
          </div>
          <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.min(100, (guidance.sizeMultiplier / 1.5) * 100)}%`,
                backgroundColor: guidance.sizeMultiplier > 1 ? '#22c55e' : guidance.sizeMultiplier < 0.7 ? '#ef4444' : '#eab308',
              }}
            />
          </div>
        </div>

        {/* DCA Pacing */}
        <div className="flex justify-between text-sm">
          <span className="text-gray-400">DCA Pacing</span>
          <span
            className="font-medium capitalize"
            style={{ color: dcaPacingColors[guidance.dcaPacing] }}
          >
            {guidance.dcaPacing} ({guidance.dcaPacingFactor.toFixed(1)}x)
          </span>
        </div>

        {/* Profit Taking */}
        <div className="flex justify-between text-sm">
          <span className="text-gray-400">Profit Taking</span>
          <span
            className="font-medium capitalize"
            style={{ color: profitColors[guidance.profitTakingLevel] }}
          >
            {guidance.profitTakingLevel}
          </span>
        </div>
      </div>

      <div className="mt-4 p-2 bg-yellow-900/20 rounded border border-yellow-800/30">
        <p className="text-xs text-yellow-500/80">
          {guidance.disclaimer.split('.')[0]}.
        </p>
      </div>
    </div>
  );
}

/**
 * Historical Context Card
 */
function HistoricalContextCard({ context }: { context: HistoricalContext }) {
  const { forwardReturns, drawdownStats } = context;

  return (
    <div className="bg-gray-800/50 rounded-lg p-4 col-span-2">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-medium text-white">Historical Context</h4>
        <span className="text-xs text-gray-500">READ-ONLY</span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Forward Returns */}
        <div>
          <h5 className="text-xs text-gray-400 mb-2">Forward Returns (Median)</h5>
          <div className="space-y-1">
            {[
              { label: '30 days', stats: forwardReturns.days30 },
              { label: '90 days', stats: forwardReturns.days90 },
              { label: '180 days', stats: forwardReturns.days180 },
              { label: '365 days', stats: forwardReturns.days365 },
            ].map(({ label, stats }) => (
              <div key={label} className="flex justify-between text-xs">
                <span className="text-gray-500">{label}</span>
                <span className={stats.median > 0 ? 'text-green-400' : 'text-red-400'}>
                  {stats.median > 0 ? '+' : ''}{(stats.median * 100).toFixed(1)}%
                  <span className="text-gray-600 ml-1">({stats.sampleCount})</span>
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Drawdown Stats */}
        <div>
          <h5 className="text-xs text-gray-400 mb-2">Max Drawdown (Median)</h5>
          <div className="space-y-1">
            {[
              { label: '30 days', stats: drawdownStats.days30 },
              { label: '90 days', stats: drawdownStats.days90 },
              { label: '180 days', stats: drawdownStats.days180 },
            ].map(({ label, stats }) => (
              <div key={label} className="flex justify-between text-xs">
                <span className="text-gray-500">{label}</span>
                <span className="text-red-400">
                  -{(stats.medianDrawdown * 100).toFixed(1)}%
                  <span className="text-gray-600 ml-1">({stats.sampleCount})</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-3 text-xs text-gray-500">
        Conditions: {context.riskBucket} risk, {context.cyclePhase} cycle, {context.momentumDirection} momentum
      </div>

      <div className="mt-2 p-2 bg-blue-900/20 rounded border border-blue-800/30">
        <p className="text-xs text-blue-500/80">
          Historical context only. Past performance does not guarantee future results.
        </p>
      </div>
    </div>
  );
}

/**
 * Main Meta-Layers Panel Component
 */
export default function MetaLayersPanel({ meta, isExpanded, onToggle }: MetaLayersPanelProps) {
  const hasAnyData = meta && (
    meta.confidence ||
    meta.momentum ||
    meta.drawdownProbability ||
    meta.cycleRelativeRisk ||
    meta.positionGuidance ||
    meta.historicalContext
  );

  return (
    <div className="rounded-lg border border-purple-800/30 bg-gray-900/50">
      {/* Header - Always visible */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 hover:bg-gray-800/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-purple-500" />
          <span className="text-white font-medium">Meta-Layers</span>
          <span className="text-xs text-purple-400 bg-purple-900/30 px-2 py-0.5 rounded">
            ADDITIVE / ORTHOGONAL
          </span>
        </div>
        <div className="flex items-center gap-2">
          {meta?.confidence && (
            <span
              className="text-xs px-2 py-0.5 rounded"
              style={{
                backgroundColor: `${getConfidenceColor(meta.confidence.level)}20`,
                color: getConfidenceColor(meta.confidence.level),
              }}
            >
              Confidence: {meta.confidence.level}
            </span>
          )}
          {meta?.momentum && (
            <span
              className="text-lg"
              style={{ color: getMomentumColor(meta.momentum.direction) }}
            >
              {meta.momentum.directionSymbol}
            </span>
          )}
          <span className="text-gray-500">{isExpanded ? '−' : '+'}</span>
        </div>
      </button>

      {/* Expandable Content */}
      {isExpanded && (
        <div className="border-t border-gray-800 p-4">
          {!hasAnyData ? (
            <div className="text-center py-8 text-gray-500">
              <p>Meta-layers data not available</p>
              <p className="text-xs mt-1">Requires sufficient historical data for calculation</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Info Banner */}
              <div className="bg-gray-800/30 rounded p-3 text-xs text-gray-400">
                <p>
                  <strong className="text-white">Important:</strong> These meta-layers are{' '}
                  <span className="text-purple-400">additive</span> and{' '}
                  <span className="text-purple-400">orthogonal</span> to the base risk score.
                  They provide additional context but{' '}
                  <span className="text-yellow-400">never feed back</span> into the core risk calculation.
                </p>
              </div>

              {/* Cards Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {meta?.confidence && (
                  <ConfidenceCard confidence={meta.confidence} />
                )}
                {meta?.momentum && (
                  <MomentumCard momentum={meta.momentum} />
                )}
                {meta?.drawdownProbability && (
                  <DrawdownCard drawdown={meta.drawdownProbability} />
                )}
                {meta?.cycleRelativeRisk && (
                  <CycleRelativeCard cycleRelative={meta.cycleRelativeRisk} />
                )}
                {meta?.positionGuidance && (
                  <GuidanceCard guidance={meta.positionGuidance} />
                )}
                {meta?.historicalContext && (
                  <HistoricalContextCard context={meta.historicalContext} />
                )}
              </div>

              {/* Base Risk Reference */}
              <div className="flex items-center justify-between text-sm bg-gray-800/30 rounded p-3">
                <span className="text-gray-400">Base Risk (unchanged):</span>
                <span className="text-white font-mono">
                  {(meta.baseSmoothedRisk * 100).toFixed(2)}%
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

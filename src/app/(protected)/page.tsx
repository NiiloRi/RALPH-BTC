'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';

const RiskDashboard = dynamic(() => import('@/components/RiskDashboard'), {
  ssr: false,
  loading: () => (
    <div className="flex h-[600px] items-center justify-center">
      <div className="text-lg text-gray-500">Loading dashboard...</div>
    </div>
  ),
});

export default function Home() {
  return (
    <div className="min-h-screen bg-black">
      <main className="container mx-auto px-3 sm:px-4 py-6 sm:py-8 max-w-7xl">
        <header className="mb-6 sm:mb-8">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-white">BTC Risk Metric</h1>
              <p className="mt-1.5 sm:mt-2 text-sm sm:text-base text-gray-400">
                Cycle-aware Bitcoin risk heuristic — private decision-support tool
              </p>
            </div>
            <Link
              href="/dashboard"
              className="self-start sm:self-auto rounded-lg bg-blue-600 px-4 py-2 text-sm sm:text-base text-white hover:bg-blue-700 transition-colors"
            >
              Open Dashboard
            </Link>
          </div>
        </header>

        <RiskDashboard />

        <section className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="rounded-lg border border-gray-800 bg-gray-900 p-6">
            <h2 className="text-xl font-semibold text-white mb-4">Risk Components</h2>
            <ul className="space-y-3 text-sm">
              <li className="flex items-start gap-2">
                <span className="text-blue-400 font-medium">Valuation:</span>
                <span className="text-gray-400">
                  Price relative to moving averages and power-law trend
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-400 font-medium">Momentum:</span>
                <span className="text-gray-400">
                  RSI, returns, MA alignment, and trend strength
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-orange-400 font-medium">Volatility:</span>
                <span className="text-gray-400">
                  Realized vol, drawdowns, and fragility indicators
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-purple-400 font-medium">Cycle:</span>
                <span className="text-gray-400">
                  Halving-aware position with lengthening cycle adjustment
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-cyan-400 font-medium">Macro:</span>
                <span className="text-gray-400">
                  DXY, liquidity proxy, and risk sentiment
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-yellow-400 font-medium">Attention:</span>
                <span className="text-gray-400">
                  Retail interest proxy and fear/greed indicators
                </span>
              </li>
            </ul>
          </div>

          <div className="rounded-lg border border-gray-800 bg-gray-900 p-6">
            <h2 className="text-xl font-semibold text-white mb-4">Methodology</h2>
            <ul className="space-y-3 text-sm text-gray-400">
              <li className="flex items-start gap-2">
                <span className="text-gray-500">•</span>
                <span>
                  <strong className="text-white">Mostly walk-forward safe:</strong> price-derived
                  features (MAs, drawdown, RSI, ATH, volatility) use only past data. Known
                  exception: cycle anchors use historical lows that were only confirmable months
                  after the fact, so historical readings near past bottoms are optimistic.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-gray-500">•</span>
                <span>
                  <strong className="text-white">Validation status:</strong> a walk-forward backtest
                  framework exists in the repo, but the displayed weights and calibration were
                  tuned on full history (in-sample). Treat the score as a structured heuristic,
                  not a validated predictor.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-gray-500">•</span>
                <span>
                  <strong className="text-white">Cycle-aware:</strong> halving-cycle timing heuristics
                  fitted to 3-4 past cycles — a small sample; the current cycle may differ.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-gray-500">•</span>
                <span>
                  <strong className="text-white">Calibrated output:</strong> sigmoid-mapped 0-100%
                  score. It is a relative ranking, not a probability of anything.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-gray-500">•</span>
                <span>
                  <strong className="text-white">Data honesty:</strong> stale or fallback data is
                  flagged in the dashboard; missing macro data is held at neutral and marked n/a.
                </span>
              </li>
            </ul>
          </div>
        </section>

        <footer className="mt-8 text-center text-xs text-gray-600">
          <p>Private personal-use analytics. Not financial advice, no return promises. Action labels are personal decision-support vocabulary. Use at your own risk.</p>
        </footer>
      </main>
    </div>
  );
}

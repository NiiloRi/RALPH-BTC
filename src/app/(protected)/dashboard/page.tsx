'use client';

import dynamic from 'next/dynamic';

const RiskDashboard = dynamic(() => import('@/components/RiskDashboard'), {
  ssr: false,
  loading: () => (
    <div className="flex h-[600px] items-center justify-center">
      <div className="text-lg text-gray-500">Loading dashboard...</div>
    </div>
  ),
});

export default function DashboardPage() {
  return (
    <div className="min-h-screen bg-black">
      <main className="container mx-auto px-4 py-8 max-w-7xl">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-white">BTC Risk Dashboard</h1>
          <p className="mt-2 text-gray-400">
            Comprehensive Bitcoin risk assessment with cycle-aware analysis
          </p>
        </header>

        <RiskDashboard />

        <footer className="mt-8 text-center text-xs text-gray-600">
          <p>
            Risk metric combines valuation, momentum, volatility, cycle position,
            macro, and retail attention indicators.
          </p>
          <p className="mt-1">
            Model validated via walk-forward backtesting. Not financial advice.
          </p>
        </footer>
      </main>
    </div>
  );
}

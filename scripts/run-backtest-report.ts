/**
 * Generate backtest report for Dynamic DCA + Swing Strategy
 */

import {
  runDCASwingComparison,
  runWalkForwardValidation,
  runBottomBuyBenchmark,
  DEFAULT_DCA_SWING_CONFIG,
  find2017BottomDate,
} from '../src/lib/strategy-dca-swing';

// Fetch risk data from API
async function fetchRiskData() {
  const response = await fetch('http://localhost:3000/api/risk-data');
  if (!response.ok) {
    throw new Error('Failed to fetch risk data');
  }
  const result = await response.json();
  return result.data;
}

async function main() {
  console.log('='.repeat(80));
  console.log('RALPH Dynamic DCA + Swing Trading Strategy - Performance Report');
  console.log('='.repeat(80));
  console.log();

  // Fetch data
  console.log('Fetching risk data...');
  const riskData = await fetchRiskData();
  console.log(`Loaded ${riskData.length} data points`);
  console.log(`Date range: ${riskData[0].date} to ${riskData[riskData.length - 1].date}`);
  console.log();

  // Find 2017 bottom
  const bottomDate = find2017BottomDate(riskData);
  console.log(`2017-2018 cycle bottom detected: ${bottomDate}`);
  console.log();

  // Run main comparison
  const config = {
    ...DEFAULT_DCA_SWING_CONFIG,
    startDate: '2018-01-01',
    endDate: riskData[riskData.length - 1].date,
    initialCashEUR: 10000,
    dca: {
      ...DEFAULT_DCA_SWING_CONFIG.dca,
      baseAmount: 100,
      interval: 'weekly' as const,
      maxMultiplier: 3.0,
      exponent: 1.5,
      skipAboveRisk: 0.70,
    },
    swing: {
      ...DEFAULT_DCA_SWING_CONFIG.swing,
      enabled: true,
      consecutiveDaysToTrigger: 3,
      deriskThreshold: 0.75,
      deriskPercent: 0.10,
      cooldownDays: 14,
    },
  };

  console.log('Running backtest...');
  console.log(`Configuration:`);
  console.log(`  - Start Date: ${config.startDate}`);
  console.log(`  - End Date: ${config.endDate}`);
  console.log(`  - Initial Cash: €${config.initialCashEUR}`);
  console.log(`  - DCA Base: €${config.dca.baseAmount}/week`);
  console.log(`  - DCA Max Multiplier: ${config.dca.maxMultiplier}x`);
  console.log(`  - Skip DCA Above Risk: ${config.dca.skipAboveRisk}`);
  console.log(`  - De-risk Threshold: ${config.swing.deriskThreshold}`);
  console.log(`  - De-risk %: ${config.swing.deriskPercent * 100}%`);
  console.log();

  const comparison = runDCASwingComparison(riskData, config);
  const { strategy, benchmarks, summary } = comparison;

  // Also run buy at bottom benchmark
  const bottomBenchmark = runBottomBuyBenchmark(
    riskData,
    config.initialCashEUR,
    config.endDate,
    0.30
  );

  console.log('='.repeat(80));
  console.log('PERFORMANCE COMPARISON');
  console.log('='.repeat(80));
  console.log();

  // Strategy results
  console.log('📊 DYNAMIC DCA + SWING STRATEGY');
  console.log('-'.repeat(40));
  console.log(`  Final Portfolio Value: €${strategy.finalPortfolio.totalValueEUR.toFixed(2)}`);
  console.log(`  Total Return: ${strategy.metrics.totalReturn.toFixed(2)}%`);
  console.log(`  CAGR: ${strategy.metrics.cagr.toFixed(2)}%`);
  console.log(`  After-Tax CAGR: ${strategy.taxMetrics.afterTaxCAGR.toFixed(2)}%`);
  console.log(`  Max Drawdown: ${strategy.metrics.maxDrawdown.toFixed(2)}%`);
  console.log(`  Sharpe Ratio: ${strategy.metrics.sharpeRatio.toFixed(3)}`);
  console.log(`  Sortino Ratio: ${strategy.metrics.sortinoRatio.toFixed(3)}`);
  console.log(`  Total Trades: ${strategy.metrics.numberOfTrades}`);
  console.log(`    - DCA Buys: ${strategy.metrics.numberOfDCABuys}`);
  console.log(`    - Swing Sells: ${strategy.metrics.numberOfSwingSells}`);
  console.log(`    - Re-risk Buys: ${strategy.metrics.numberOfReriskBuys}`);
  console.log(`  Total Invested: €${strategy.metrics.totalInvested.toFixed(2)}`);
  console.log(`  Avg Buy Price: €${strategy.metrics.avgBuyPrice.toFixed(2)}`);
  console.log(`  Win Rate: ${strategy.metrics.winRate.toFixed(1)}%`);
  console.log();

  // Tax summary
  console.log('💰 TAX SUMMARY (Finnish FIFO)');
  console.log('-'.repeat(40));
  console.log(`  Total Realized Gains: €${strategy.taxMetrics.totalRealizedGains.toFixed(2)}`);
  console.log(`  Total Realized Losses: €${strategy.taxMetrics.totalRealizedLosses.toFixed(2)}`);
  console.log(`  Net Realized P/L: €${strategy.taxMetrics.netRealizedPL.toFixed(2)}`);
  console.log(`  Total Tax Paid: €${strategy.taxMetrics.totalTaxPaid.toFixed(2)}`);
  console.log(`  Tax Efficiency: ${(summary.taxEfficiency * 100).toFixed(1)}%`);
  console.log();

  // Yearly breakdown
  if (strategy.taxMetrics.yearlyBreakdown.length > 0) {
    console.log('📅 YEARLY TAX BREAKDOWN');
    console.log('-'.repeat(40));
    console.log('  Year    Gains      Losses     Net        Tax');
    for (const year of strategy.taxMetrics.yearlyBreakdown) {
      console.log(`  ${year.year}    €${year.totalGains.toFixed(0).padStart(8)}  €${year.totalLosses.toFixed(0).padStart(8)}  €${year.netGain.toFixed(0).padStart(8)}  €${year.estimatedTax.toFixed(0).padStart(8)}`);
    }
    console.log();
  }

  // Benchmarks
  console.log('📈 BENCHMARKS');
  console.log('-'.repeat(40));
  for (const b of benchmarks) {
    console.log(`  ${b.name}:`);
    console.log(`    Final Value: €${b.finalValue.toFixed(2)}`);
    console.log(`    Total Return: ${b.totalReturn.toFixed(2)}%`);
    console.log(`    CAGR: ${b.cagr.toFixed(2)}%`);
    console.log(`    After-Tax CAGR: ${b.afterTaxCAGR?.toFixed(2) || 'N/A'}%`);
    console.log(`    Max Drawdown: ${b.maxDrawdown.toFixed(2)}%`);
    console.log();
  }

  // Bottom buy benchmark
  console.log(`  ${bottomBenchmark.name}:`);
  console.log(`    Buy Date: ${bottomBenchmark.startDate}`);
  console.log(`    Final Value: €${bottomBenchmark.finalValue.toFixed(2)}`);
  console.log(`    Total Return: ${bottomBenchmark.totalReturn.toFixed(2)}%`);
  console.log(`    CAGR: ${bottomBenchmark.cagr.toFixed(2)}%`);
  console.log(`    After-Tax CAGR: ${bottomBenchmark.afterTaxCAGR?.toFixed(2) || 'N/A'}%`);
  console.log(`    Max Drawdown: ${bottomBenchmark.maxDrawdown.toFixed(2)}%`);
  console.log();

  // Summary comparison
  console.log('='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log();

  const strategyAfterTax = strategy.taxMetrics.afterTaxCAGR;
  const buyHoldAfterTax = benchmarks[0].afterTaxCAGR || benchmarks[0].cagr;
  const dcaAfterTax = benchmarks[1].afterTaxCAGR || benchmarks[1].cagr;

  console.log('After-Tax CAGR Comparison:');
  console.log(`  Strategy:     ${strategyAfterTax.toFixed(2)}%`);
  console.log(`  Buy & Hold:   ${buyHoldAfterTax.toFixed(2)}%`);
  console.log(`  Pure DCA:     ${dcaAfterTax.toFixed(2)}%`);
  console.log();

  const vsBuyHold = strategyAfterTax - buyHoldAfterTax;
  const vsDCA = strategyAfterTax - dcaAfterTax;

  console.log('Outperformance:');
  console.log(`  vs Buy & Hold: ${vsBuyHold >= 0 ? '+' : ''}${vsBuyHold.toFixed(2)} pp ${vsBuyHold >= 0 ? '✅' : '❌'}`);
  console.log(`  vs Pure DCA:   ${vsDCA >= 0 ? '+' : ''}${vsDCA.toFixed(2)} pp ${vsDCA >= 0 ? '✅' : '❌'}`);
  console.log();

  if (summary.strategyWins) {
    console.log('🏆 STRATEGY OUTPERFORMS BENCHMARKS');
  } else {
    console.log('⚠️  Strategy underperforms at least one benchmark');
  }
  console.log();

  // Run walk-forward validation
  console.log('='.repeat(80));
  console.log('WALK-FORWARD VALIDATION');
  console.log('='.repeat(80));
  console.log();

  try {
    const validation = runWalkForwardValidation(riskData, config, 3);

    console.log(`Avg In-Sample CAGR: ${validation.avgInSampleCAGR.toFixed(2)}%`);
    console.log(`Avg Out-of-Sample CAGR: ${validation.avgOutOfSampleCAGR.toFixed(2)}%`);
    console.log(`Avg Degradation: ${(validation.avgDegradation * 100).toFixed(1)}%`);
    console.log(`Is Robust: ${validation.isRobust ? '✅ Yes' : '❌ No'}`);
    console.log();

    console.log('Fold Details:');
    for (const fold of validation.folds) {
      console.log(`  Fold ${fold.foldNumber}: IS=${fold.inSampleCAGR.toFixed(1)}% OOS=${fold.outOfSampleCAGR.toFixed(1)}% Deg=${(fold.degradation * 100).toFixed(0)}%`);
    }
  } catch (e) {
    console.log('Could not run walk-forward validation (insufficient data)');
  }
  console.log();

  console.log('='.repeat(80));
  console.log('Report generated:', new Date().toISOString());
  console.log('='.repeat(80));
}

main().catch(console.error);

/**
 * Optimize Dynamic DCA + Swing Strategy with profit reinvestment
 */

import { RiskDataPoint } from '../src/lib/risk-metric-contract';

interface OptimizedConfig {
  // DCA
  dcaBaseAmount: number;
  dcaMaxMultiplier: number;
  dcaExponent: number;
  dcaSkipAboveRisk: number;

  // Swing
  swingEnabled: boolean;
  deriskThreshold: number;
  deriskPercent: number;
  consecutiveDays: number;
  cooldownDays: number;
  reriskThreshold: number;
  reriskPercent: number;

  // Reinvestment
  reinvestProfits: boolean;
  reinvestPercent: number; // % of profits to add to DCA base

  // Tax
  taxBudget?: number;
}

interface FIFOLot {
  date: string;
  quantity: number;
  costEUR: number;
}

interface BacktestResult {
  finalValue: number;
  totalReturn: number;
  cagr: number;
  afterTaxCAGR: number;
  maxDrawdown: number;
  sharpe: number;
  trades: number;
  taxPaid: number;
}

// Fetch risk data
async function fetchRiskData(): Promise<RiskDataPoint[]> {
  const response = await fetch('http://localhost:3000/api/risk-data');
  const result = await response.json();
  return result.data;
}

// Run optimized backtest with profit reinvestment
function runOptimizedBacktest(
  data: RiskDataPoint[],
  config: OptimizedConfig,
  initialCash: number,
  startDate: string
): BacktestResult {
  const filtered = data.filter(d => d.date >= startDate);
  if (filtered.length === 0) throw new Error('No data');

  let cash = initialCash;
  let btc = 0;
  const lots: FIFOLot[] = [];

  let lastDCADate: Date | null = null;
  let consecutiveHighRiskDays = 0;
  let consecutiveLowRiskDays = 0;
  let daysSinceLastDerisk = 999;
  let daysSinceLastRerisk = 999;
  let currentMonth = -1;
  let monthDeriskTotal = 0;

  // Profit tracking for reinvestment
  let cumulativeRealizedProfit = 0;
  let currentDCABase = config.dcaBaseAmount;

  // Tax tracking
  let totalTaxPaid = 0;
  const yearlyGains: Map<number, number> = new Map();
  const yearlyLosses: Map<number, number> = new Map();

  // Metrics
  let maxValue = initialCash;
  let maxDrawdown = 0;
  const dailyReturns: number[] = [];
  let prevValue = initialCash;

  for (const point of filtered) {
    const date = new Date(point.date);
    const price = point.price;
    const risk = point.risk;
    const year = date.getFullYear();
    const month = date.getMonth();

    // Reset monthly counter
    if (month !== currentMonth) {
      currentMonth = month;
      monthDeriskTotal = 0;
    }

    // Update counters
    daysSinceLastDerisk++;
    daysSinceLastRerisk++;

    // Track consecutive days
    if (risk >= config.deriskThreshold) {
      consecutiveHighRiskDays++;
      consecutiveLowRiskDays = 0;
    } else if (risk <= config.reriskThreshold) {
      consecutiveLowRiskDays++;
      consecutiveHighRiskDays = 0;
    } else {
      consecutiveHighRiskDays = Math.max(0, consecutiveHighRiskDays - 1);
      consecutiveLowRiskDays = Math.max(0, consecutiveLowRiskDays - 1);
    }

    // Current value
    const btcValue = btc * price;
    const totalValue = cash + btcValue;

    // Drawdown
    if (totalValue > maxValue) maxValue = totalValue;
    const dd = (maxValue - totalValue) / maxValue;
    if (dd > maxDrawdown) maxDrawdown = dd;

    // Daily return
    if (prevValue > 0) {
      dailyReturns.push((totalValue - prevValue) / prevValue);
    }
    prevValue = totalValue;

    // === SWING SELL ===
    if (config.swingEnabled &&
        consecutiveHighRiskDays >= config.consecutiveDays &&
        daysSinceLastDerisk >= config.cooldownDays &&
        monthDeriskTotal < 0.30 &&
        btc > 0) {

      const sellPercent = Math.min(config.deriskPercent, 0.30 - monthDeriskTotal);
      const sellBTC = btc * sellPercent;
      const sellEUR = sellBTC * price * 0.999; // 0.1% fee

      // FIFO gain calculation
      let remaining = sellBTC;
      let costBasis = 0;
      while (remaining > 0 && lots.length > 0) {
        const lot = lots[0];
        const take = Math.min(remaining, lot.quantity);
        costBasis += take * (lot.costEUR / lot.quantity) * lot.quantity / lot.quantity;
        costBasis += (take / lot.quantity) * lot.costEUR;
        lot.quantity -= take;
        remaining -= take;
        if (lot.quantity <= 0.00000001) lots.shift();
      }

      // Simplified: recalculate
      costBasis = 0;
      remaining = sellBTC;
      const lotsCopy = [...lots];
      lots.length = 0;
      for (const lot of lotsCopy) {
        if (remaining <= 0) {
          lots.push(lot);
          continue;
        }
        const take = Math.min(remaining, lot.quantity);
        costBasis += take * (lot.costEUR / lot.quantity);
        remaining -= take;
        lot.quantity -= take;
        if (lot.quantity > 0.00000001) lots.push(lot);
      }

      const gain = sellEUR - costBasis;

      // Track gains/losses
      if (gain > 0) {
        yearlyGains.set(year, (yearlyGains.get(year) || 0) + gain);
        cumulativeRealizedProfit += gain;
      } else {
        yearlyLosses.set(year, (yearlyLosses.get(year) || 0) + Math.abs(gain));
      }

      btc -= sellBTC;
      cash += sellEUR;
      monthDeriskTotal += sellPercent;
      daysSinceLastDerisk = 0;
      consecutiveHighRiskDays = 0;

      // Reinvest profits by increasing DCA base
      if (config.reinvestProfits && gain > 0) {
        currentDCABase = config.dcaBaseAmount + (cumulativeRealizedProfit * config.reinvestPercent / 52);
      }
    }

    // === RE-RISK BUY ===
    if (config.swingEnabled &&
        consecutiveLowRiskDays >= 5 &&
        daysSinceLastRerisk >= config.cooldownDays &&
        cash > 100) {

      const buyEUR = cash * config.reriskPercent;
      if (buyEUR >= 50) {
        const buyBTC = buyEUR * 0.999 / price;
        lots.push({ date: point.date, quantity: buyBTC, costEUR: buyEUR });
        btc += buyBTC;
        cash -= buyEUR;
        daysSinceLastRerisk = 0;
        consecutiveLowRiskDays = 0;
      }
    }

    // === DYNAMIC DCA ===
    const daysSinceDCA = lastDCADate
      ? Math.floor((date.getTime() - lastDCADate.getTime()) / (1000 * 60 * 60 * 24))
      : 999;

    if (daysSinceDCA >= 7) {
      // Calculate multiplier
      let multiplier = 0;
      if (risk < config.dcaSkipAboveRisk) {
        multiplier = config.dcaMaxMultiplier -
          (config.dcaMaxMultiplier - 0) * Math.pow(risk, config.dcaExponent);
      }

      const dcaAmount = currentDCABase * multiplier;

      if (dcaAmount >= 20 && cash >= dcaAmount) {
        const buyBTC = dcaAmount * 0.999 / price;
        lots.push({ date: point.date, quantity: buyBTC, costEUR: dcaAmount });
        btc += buyBTC;
        cash -= dcaAmount;
        lastDCADate = date;
      }
    }
  }

  // Final value
  const finalPrice = filtered[filtered.length - 1].price;
  const finalValue = cash + btc * finalPrice;

  // Calculate taxes
  for (const [year, gains] of yearlyGains) {
    const losses = yearlyLosses.get(year) || 0;
    const net = Math.max(0, gains - losses);
    if (net > 0) {
      const tax = net <= 30000 ? net * 0.30 : 30000 * 0.30 + (net - 30000) * 0.34;
      totalTaxPaid += tax;
    }
  }

  // Metrics
  const years = filtered.length / 365;
  const totalReturn = (finalValue - initialCash) / initialCash * 100;
  const cagr = (Math.pow(finalValue / initialCash, 1 / years) - 1) * 100;

  const afterTaxFinal = finalValue - totalTaxPaid;
  const afterTaxCAGR = (Math.pow(afterTaxFinal / initialCash, 1 / years) - 1) * 100;

  const avgReturn = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
  const stdDev = Math.sqrt(dailyReturns.reduce((s, r) => s + (r - avgReturn) ** 2, 0) / dailyReturns.length);
  const sharpe = stdDev > 0 ? avgReturn * Math.sqrt(252) / stdDev : 0;

  return {
    finalValue,
    totalReturn,
    cagr,
    afterTaxCAGR,
    maxDrawdown: maxDrawdown * 100,
    sharpe,
    trades: lots.length,
    taxPaid: totalTaxPaid,
  };
}

// Run Pure DCA benchmark
function runPureDCA(data: RiskDataPoint[], initialCash: number, dcaAmount: number, startDate: string): BacktestResult {
  const filtered = data.filter(d => d.date >= startDate);
  let cash = initialCash;
  let btc = 0;
  let totalInvested = 0;
  let lastDCA: Date | null = null;
  let maxValue = initialCash;
  let maxDrawdown = 0;

  for (const point of filtered) {
    const date = new Date(point.date);
    const days = lastDCA ? Math.floor((date.getTime() - lastDCA.getTime()) / 86400000) : 999;

    if (days >= 7 && cash >= dcaAmount) {
      btc += dcaAmount / point.price;
      cash -= dcaAmount;
      totalInvested += dcaAmount;
      lastDCA = date;
    }

    const value = cash + btc * point.price;
    if (value > maxValue) maxValue = value;
    const dd = (maxValue - value) / maxValue;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  const finalValue = cash + btc * filtered[filtered.length - 1].price;
  const years = filtered.length / 365;
  const gain = btc * filtered[filtered.length - 1].price - totalInvested;
  const tax = gain > 0 ? (gain <= 30000 ? gain * 0.30 : 30000 * 0.30 + (gain - 30000) * 0.34) : 0;

  return {
    finalValue,
    totalReturn: (finalValue - initialCash) / initialCash * 100,
    cagr: (Math.pow(finalValue / initialCash, 1 / years) - 1) * 100,
    afterTaxCAGR: (Math.pow((finalValue - tax) / initialCash, 1 / years) - 1) * 100,
    maxDrawdown: maxDrawdown * 100,
    sharpe: 0,
    trades: 0,
    taxPaid: tax,
  };
}

async function main() {
  console.log('='.repeat(80));
  console.log('STRATEGY OPTIMIZATION WITH PROFIT REINVESTMENT');
  console.log('='.repeat(80));
  console.log();

  const data = await fetchRiskData();
  console.log(`Loaded ${data.length} data points`);
  console.log();

  const initialCash = 10000;
  const startDate = '2018-01-01';

  // Grid search for optimal parameters
  const results: { config: OptimizedConfig; result: BacktestResult }[] = [];

  console.log('Running parameter optimization...');
  console.log();

  // Parameter ranges
  const maxMultipliers = [2.5, 3.0, 3.5, 4.0];
  const exponents = [1.0, 1.5, 2.0];
  const skipThresholds = [0.60, 0.65, 0.70, 0.75];
  const deriskThresholds = [0.70, 0.75, 0.80];
  const deriskPercents = [0.08, 0.10, 0.12, 0.15];
  const reriskPercents = [0.15, 0.20, 0.25, 0.30];
  const reinvestPercents = [0.05, 0.10, 0.15, 0.20];

  let bestResult: { config: OptimizedConfig; result: BacktestResult } | null = null;
  let count = 0;
  const total = maxMultipliers.length * exponents.length * skipThresholds.length *
                deriskThresholds.length * deriskPercents.length * 2; // simplified

  // Focused optimization
  for (const maxMult of maxMultipliers) {
    for (const exp of exponents) {
      for (const skip of skipThresholds) {
        for (const derisk of deriskThresholds) {
          for (const deriskPct of deriskPercents) {
            for (const reinvest of reinvestPercents) {
              count++;

              const config: OptimizedConfig = {
                dcaBaseAmount: 100,
                dcaMaxMultiplier: maxMult,
                dcaExponent: exp,
                dcaSkipAboveRisk: skip,
                swingEnabled: true,
                deriskThreshold: derisk,
                deriskPercent: deriskPct,
                consecutiveDays: 3,
                cooldownDays: 14,
                reriskThreshold: 0.30,
                reriskPercent: 0.20,
                reinvestProfits: true,
                reinvestPercent: reinvest,
              };

              try {
                const result = runOptimizedBacktest(data, config, initialCash, startDate);
                results.push({ config, result });

                if (!bestResult || result.afterTaxCAGR > bestResult.result.afterTaxCAGR) {
                  bestResult = { config, result };
                }
              } catch (e) {
                // Skip failed configs
              }
            }
          }
        }
      }
    }
  }

  console.log(`Tested ${results.length} configurations`);
  console.log();

  // Also test without reinvestment for comparison
  const noReinvestConfig: OptimizedConfig = {
    ...bestResult!.config,
    reinvestProfits: false,
  };
  const noReinvestResult = runOptimizedBacktest(data, noReinvestConfig, initialCash, startDate);

  // Pure DCA benchmark
  const dcaBenchmark = runPureDCA(data, initialCash, 100, startDate);

  // Best config with low drawdown preference
  const lowDDResults = results
    .filter(r => r.result.maxDrawdown < 55)
    .sort((a, b) => b.result.afterTaxCAGR - a.result.afterTaxCAGR);

  const bestLowDD = lowDDResults[0] || bestResult;

  console.log('='.repeat(80));
  console.log('OPTIMAL CONFIGURATION FOUND');
  console.log('='.repeat(80));
  console.log();

  console.log('📊 BEST PARAMETERS (Highest After-Tax CAGR):');
  console.log('-'.repeat(40));
  console.log(`  DCA Max Multiplier: ${bestResult!.config.dcaMaxMultiplier}x`);
  console.log(`  DCA Exponent: ${bestResult!.config.dcaExponent}`);
  console.log(`  Skip Above Risk: ${bestResult!.config.dcaSkipAboveRisk}`);
  console.log(`  De-risk Threshold: ${bestResult!.config.deriskThreshold}`);
  console.log(`  De-risk %: ${bestResult!.config.deriskPercent * 100}%`);
  console.log(`  Reinvest %: ${bestResult!.config.reinvestPercent * 100}%`);
  console.log();

  console.log('='.repeat(80));
  console.log('PERFORMANCE COMPARISON');
  console.log('='.repeat(80));
  console.log();

  console.log('| Strategy                    | Final €    | CAGR    | After-Tax | Max DD  |');
  console.log('|-----------------------------|------------|---------|-----------|---------|');
  console.log(`| Optimized + Reinvest        | ${bestResult!.result.finalValue.toFixed(0).padStart(10)} | ${bestResult!.result.cagr.toFixed(1).padStart(6)}% | ${bestResult!.result.afterTaxCAGR.toFixed(1).padStart(8)}% | ${bestResult!.result.maxDrawdown.toFixed(1).padStart(6)}% |`);
  console.log(`| Optimized (no reinvest)     | ${noReinvestResult.finalValue.toFixed(0).padStart(10)} | ${noReinvestResult.cagr.toFixed(1).padStart(6)}% | ${noReinvestResult.afterTaxCAGR.toFixed(1).padStart(8)}% | ${noReinvestResult.maxDrawdown.toFixed(1).padStart(6)}% |`);
  console.log(`| Best Low Drawdown (<55%)    | ${bestLowDD!.result.finalValue.toFixed(0).padStart(10)} | ${bestLowDD!.result.cagr.toFixed(1).padStart(6)}% | ${bestLowDD!.result.afterTaxCAGR.toFixed(1).padStart(8)}% | ${bestLowDD!.result.maxDrawdown.toFixed(1).padStart(6)}% |`);
  console.log(`| Pure DCA (€100/week)        | ${dcaBenchmark.finalValue.toFixed(0).padStart(10)} | ${dcaBenchmark.cagr.toFixed(1).padStart(6)}% | ${dcaBenchmark.afterTaxCAGR.toFixed(1).padStart(8)}% | ${dcaBenchmark.maxDrawdown.toFixed(1).padStart(6)}% |`);
  console.log();

  const vsDCA = bestResult!.result.afterTaxCAGR - dcaBenchmark.afterTaxCAGR;
  console.log(`🎯 vs Pure DCA: ${vsDCA >= 0 ? '+' : ''}${vsDCA.toFixed(2)} pp ${vsDCA >= 0 ? '✅' : '❌'}`);
  console.log();

  console.log('💡 REINVESTMENT IMPACT:');
  const reinvestImpact = bestResult!.result.afterTaxCAGR - noReinvestResult.afterTaxCAGR;
  console.log(`   With reinvestment: +${reinvestImpact.toFixed(2)} pp after-tax CAGR`);
  console.log();

  // Top 5 configurations
  const top5 = results
    .sort((a, b) => b.result.afterTaxCAGR - a.result.afterTaxCAGR)
    .slice(0, 5);

  console.log('='.repeat(80));
  console.log('TOP 5 CONFIGURATIONS');
  console.log('='.repeat(80));
  console.log();
  console.log('| # | MaxMult | Exp  | Skip  | Derisk | %    | Reinv | CAGR   | Max DD |');
  console.log('|---|---------|------|-------|--------|------|-------|--------|--------|');

  top5.forEach((r, i) => {
    console.log(`| ${i+1} | ${r.config.dcaMaxMultiplier.toFixed(1).padStart(7)} | ${r.config.dcaExponent.toFixed(1).padStart(4)} | ${r.config.dcaSkipAboveRisk.toFixed(2).padStart(5)} | ${r.config.deriskThreshold.toFixed(2).padStart(6)} | ${(r.config.deriskPercent*100).toFixed(0).padStart(3)}% | ${(r.config.reinvestPercent*100).toFixed(0).padStart(4)}% | ${r.result.afterTaxCAGR.toFixed(1).padStart(5)}% | ${r.result.maxDrawdown.toFixed(1).padStart(5)}% |`);
  });
  console.log();

  // Sensitivity analysis
  console.log('='.repeat(80));
  console.log('PARAMETER SENSITIVITY (around optimal)');
  console.log('='.repeat(80));
  console.log();

  const optConfig = bestResult!.config;

  // Test small changes
  const sensTests = [
    { name: 'MaxMult -0.5', change: { dcaMaxMultiplier: optConfig.dcaMaxMultiplier - 0.5 } },
    { name: 'MaxMult +0.5', change: { dcaMaxMultiplier: optConfig.dcaMaxMultiplier + 0.5 } },
    { name: 'Skip -0.05', change: { dcaSkipAboveRisk: optConfig.dcaSkipAboveRisk - 0.05 } },
    { name: 'Skip +0.05', change: { dcaSkipAboveRisk: optConfig.dcaSkipAboveRisk + 0.05 } },
    { name: 'Derisk -0.05', change: { deriskThreshold: optConfig.deriskThreshold - 0.05 } },
    { name: 'Derisk +0.05', change: { deriskThreshold: optConfig.deriskThreshold + 0.05 } },
  ];

  console.log('| Change         | After-Tax CAGR | Difference |');
  console.log('|----------------|----------------|------------|');
  console.log(`| Optimal        | ${bestResult!.result.afterTaxCAGR.toFixed(2).padStart(13)}% | baseline   |`);

  for (const test of sensTests) {
    const testConfig = { ...optConfig, ...test.change };
    try {
      const testResult = runOptimizedBacktest(data, testConfig, initialCash, startDate);
      const diff = testResult.afterTaxCAGR - bestResult!.result.afterTaxCAGR;
      console.log(`| ${test.name.padEnd(14)} | ${testResult.afterTaxCAGR.toFixed(2).padStart(13)}% | ${diff >= 0 ? '+' : ''}${diff.toFixed(2).padStart(9)} |`);
    } catch {
      console.log(`| ${test.name.padEnd(14)} | Error          |            |`);
    }
  }
  console.log();

  console.log('='.repeat(80));
  console.log('FINAL RECOMMENDATION');
  console.log('='.repeat(80));
  console.log();
  console.log('Optimaaliset parametrit voiton uudelleensijoituksella:');
  console.log();
  console.log('```typescript');
  console.log('const config = {');
  console.log(`  dca: {`);
  console.log(`    baseAmount: 100,`);
  console.log(`    maxMultiplier: ${bestResult!.config.dcaMaxMultiplier},`);
  console.log(`    exponent: ${bestResult!.config.dcaExponent},`);
  console.log(`    skipAboveRisk: ${bestResult!.config.dcaSkipAboveRisk},`);
  console.log(`  },`);
  console.log(`  swing: {`);
  console.log(`    deriskThreshold: ${bestResult!.config.deriskThreshold},`);
  console.log(`    deriskPercent: ${bestResult!.config.deriskPercent},`);
  console.log(`    cooldownDays: 14,`);
  console.log(`  },`);
  console.log(`  reinvestPercent: ${bestResult!.config.reinvestPercent}, // Voitoista lisätään DCA:han`);
  console.log('};');
  console.log('```');
  console.log();
}

main().catch(console.error);

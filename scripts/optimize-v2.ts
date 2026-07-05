/**
 * Advanced Strategy Optimization v2
 * - Test higher derisk thresholds
 * - Test DCA-only mode
 * - Compare with/without swing
 */

import { RiskDataPoint } from '../src/lib/risk-metric-contract';

interface Config {
  dcaBase: number;
  dcaMaxMult: number;
  dcaExp: number;
  dcaSkip: number;
  swingEnabled: boolean;
  deriskThreshold: number;
  deriskPct: number;
  cooldown: number;
  reriskThreshold: number;
  reriskPct: number;
  reinvestPct: number;
}

interface Lot { date: string; qty: number; cost: number; }

async function fetchData(): Promise<RiskDataPoint[]> {
  const r = await fetch('http://localhost:3000/api/risk-data');
  return (await r.json()).data;
}

function backtest(data: RiskDataPoint[], cfg: Config, cash0: number, start: string) {
  const filtered = data.filter(d => d.date >= start);
  if (!filtered.length) return null;

  let cash = cash0, btc = 0;
  const lots: Lot[] = [];
  let lastDCA: Date | null = null;
  let highDays = 0, lowDays = 0;
  let lastDerisk = 999, lastRerisk = 999;
  let curMonth = -1, monthDerisk = 0;
  let profits = 0, dcaBase = cfg.dcaBase;

  const yearGains = new Map<number, number>();
  const yearLosses = new Map<number, number>();
  let maxVal = cash0, maxDD = 0;
  const rets: number[] = [];
  let prev = cash0;

  for (const p of filtered) {
    const dt = new Date(p.date);
    const yr = dt.getFullYear();
    const mo = dt.getMonth();

    if (mo !== curMonth) { curMonth = mo; monthDerisk = 0; }
    lastDerisk++; lastRerisk++;

    if (p.risk >= cfg.deriskThreshold) { highDays++; lowDays = 0; }
    else if (p.risk <= cfg.reriskThreshold) { lowDays++; highDays = 0; }
    else { highDays = Math.max(0, highDays - 1); lowDays = Math.max(0, lowDays - 1); }

    const val = cash + btc * p.price;
    if (val > maxVal) maxVal = val;
    const dd = (maxVal - val) / maxVal;
    if (dd > maxDD) maxDD = dd;
    if (prev > 0) rets.push((val - prev) / prev);
    prev = val;

    // SWING SELL
    if (cfg.swingEnabled && highDays >= 3 && lastDerisk >= cfg.cooldown && monthDerisk < 0.3 && btc > 0) {
      const sellPct = Math.min(cfg.deriskPct, 0.3 - monthDerisk);
      const sellBTC = btc * sellPct;
      const sellEUR = sellBTC * p.price * 0.999;

      let rem = sellBTC, cost = 0;
      const newLots: Lot[] = [];
      for (const lot of lots) {
        if (rem <= 0) { newLots.push(lot); continue; }
        const take = Math.min(rem, lot.qty);
        cost += take * (lot.cost / lot.qty);
        rem -= take;
        if (lot.qty - take > 1e-8) newLots.push({ ...lot, qty: lot.qty - take, cost: lot.cost * (1 - take/lot.qty) });
      }
      lots.length = 0; lots.push(...newLots);

      const gain = sellEUR - cost;
      if (gain > 0) { yearGains.set(yr, (yearGains.get(yr)||0) + gain); profits += gain; }
      else yearLosses.set(yr, (yearLosses.get(yr)||0) + Math.abs(gain));

      btc -= sellBTC; cash += sellEUR;
      monthDerisk += sellPct; lastDerisk = 0; highDays = 0;

      if (cfg.reinvestPct > 0 && gain > 0) {
        dcaBase = cfg.dcaBase + (profits * cfg.reinvestPct / 52);
      }
    }

    // RE-RISK
    if (cfg.swingEnabled && lowDays >= 5 && lastRerisk >= cfg.cooldown && cash > 100) {
      const buyEUR = cash * cfg.reriskPct;
      if (buyEUR >= 50) {
        const buyBTC = buyEUR * 0.999 / p.price;
        lots.push({ date: p.date, qty: buyBTC, cost: buyEUR });
        btc += buyBTC; cash -= buyEUR;
        lastRerisk = 0; lowDays = 0;
      }
    }

    // DCA
    const days = lastDCA ? Math.floor((dt.getTime() - lastDCA.getTime()) / 86400000) : 999;
    if (days >= 7) {
      let mult = p.risk < cfg.dcaSkip ? cfg.dcaMaxMult - cfg.dcaMaxMult * Math.pow(p.risk, cfg.dcaExp) : 0;
      const amt = dcaBase * mult;
      if (amt >= 20 && cash >= amt) {
        const buyBTC = amt * 0.999 / p.price;
        lots.push({ date: p.date, qty: buyBTC, cost: amt });
        btc += buyBTC; cash -= amt;
        lastDCA = dt;
      }
    }
  }

  const finalPrice = filtered[filtered.length - 1].price;
  const finalVal = cash + btc * finalPrice;
  const yrs = filtered.length / 365;

  let totalTax = 0;
  for (const [y, g] of yearGains) {
    const l = yearLosses.get(y) || 0;
    const net = Math.max(0, g - l);
    totalTax += net <= 30000 ? net * 0.3 : 30000 * 0.3 + (net - 30000) * 0.34;
  }

  const cagr = (Math.pow(finalVal / cash0, 1 / yrs) - 1) * 100;
  const afterTax = (Math.pow((finalVal - totalTax) / cash0, 1 / yrs) - 1) * 100;

  const avgRet = rets.reduce((a, b) => a + b, 0) / rets.length;
  const std = Math.sqrt(rets.reduce((s, r) => s + (r - avgRet) ** 2, 0) / rets.length);
  const sharpe = std > 0 ? avgRet * Math.sqrt(252) / std : 0;

  return { finalVal, cagr, afterTax, maxDD: maxDD * 100, sharpe, tax: totalTax };
}

async function main() {
  const data = await fetchData();
  const cash0 = 10000, start = '2018-01-01';

  console.log('='.repeat(80));
  console.log('ADVANCED STRATEGY OPTIMIZATION');
  console.log('='.repeat(80));
  console.log();

  // ======= 1. PURE DCA BENCHMARK =======
  const pureDCA = backtest(data, {
    dcaBase: 100, dcaMaxMult: 1.0, dcaExp: 1, dcaSkip: 1.0,
    swingEnabled: false, deriskThreshold: 1, deriskPct: 0, cooldown: 999,
    reriskThreshold: 0, reriskPct: 0, reinvestPct: 0
  }, cash0, start)!;

  // ======= 2. DYNAMIC DCA ONLY (NO SWING) =======
  let bestDCAOnly: any = null;
  for (const mult of [2.0, 2.5, 3.0, 3.5, 4.0]) {
    for (const exp of [0.5, 1.0, 1.5, 2.0]) {
      for (const skip of [0.6, 0.65, 0.7, 0.75, 0.8, 0.85]) {
        const r = backtest(data, {
          dcaBase: 100, dcaMaxMult: mult, dcaExp: exp, dcaSkip: skip,
          swingEnabled: false, deriskThreshold: 1, deriskPct: 0, cooldown: 999,
          reriskThreshold: 0, reriskPct: 0, reinvestPct: 0
        }, cash0, start);
        if (r && (!bestDCAOnly || r.afterTax > bestDCAOnly.result.afterTax)) {
          bestDCAOnly = { cfg: { mult, exp, skip }, result: r };
        }
      }
    }
  }

  // ======= 3. DYNAMIC DCA + SWING (various thresholds) =======
  let bestFull: any = null;
  let bestLowDD: any = null;

  for (const mult of [2.0, 2.5, 3.0]) {
    for (const exp of [0.5, 1.0, 1.5]) {
      for (const skip of [0.7, 0.75, 0.8, 0.85]) {
        for (const derisk of [0.75, 0.80, 0.85, 0.90]) {
          for (const pct of [0.05, 0.08, 0.10, 0.15]) {
            for (const reinv of [0, 0.05, 0.10]) {
              const r = backtest(data, {
                dcaBase: 100, dcaMaxMult: mult, dcaExp: exp, dcaSkip: skip,
                swingEnabled: true, deriskThreshold: derisk, deriskPct: pct,
                cooldown: 14, reriskThreshold: 0.30, reriskPct: 0.20, reinvestPct: reinv
              }, cash0, start);

              if (r) {
                if (!bestFull || r.afterTax > bestFull.result.afterTax) {
                  bestFull = { cfg: { mult, exp, skip, derisk, pct, reinv }, result: r };
                }
                if (r.maxDD < 55 && (!bestLowDD || r.afterTax > bestLowDD.result.afterTax)) {
                  bestLowDD = { cfg: { mult, exp, skip, derisk, pct, reinv }, result: r };
                }
              }
            }
          }
        }
      }
    }
  }

  // ======= RESULTS =======
  console.log('📊 COMPARISON TABLE');
  console.log('='.repeat(80));
  console.log();
  console.log('| Strategy                     | Final €   | CAGR   | After-Tax | Max DD  | Tax €   |');
  console.log('|------------------------------|-----------|--------|-----------|---------|---------|');
  console.log(`| Pure DCA (€100/week)         | ${pureDCA.finalVal.toFixed(0).padStart(9)} | ${pureDCA.cagr.toFixed(1).padStart(5)}% | ${pureDCA.afterTax.toFixed(1).padStart(8)}% | ${pureDCA.maxDD.toFixed(1).padStart(6)}% | ${pureDCA.tax.toFixed(0).padStart(7)} |`);
  console.log(`| Dynamic DCA (no swing)       | ${bestDCAOnly.result.finalVal.toFixed(0).padStart(9)} | ${bestDCAOnly.result.cagr.toFixed(1).padStart(5)}% | ${bestDCAOnly.result.afterTax.toFixed(1).padStart(8)}% | ${bestDCAOnly.result.maxDD.toFixed(1).padStart(6)}% | ${bestDCAOnly.result.tax.toFixed(0).padStart(7)} |`);
  console.log(`| Dynamic DCA + Swing (best)   | ${bestFull.result.finalVal.toFixed(0).padStart(9)} | ${bestFull.result.cagr.toFixed(1).padStart(5)}% | ${bestFull.result.afterTax.toFixed(1).padStart(8)}% | ${bestFull.result.maxDD.toFixed(1).padStart(6)}% | ${bestFull.result.tax.toFixed(0).padStart(7)} |`);
  if (bestLowDD) {
    console.log(`| Best Low Drawdown (<55%)     | ${bestLowDD.result.finalVal.toFixed(0).padStart(9)} | ${bestLowDD.result.cagr.toFixed(1).padStart(5)}% | ${bestLowDD.result.afterTax.toFixed(1).padStart(8)}% | ${bestLowDD.result.maxDD.toFixed(1).padStart(6)}% | ${bestLowDD.result.tax.toFixed(0).padStart(7)} |`);
  }
  console.log();

  // Outperformance
  const vsPureDCA = bestFull.result.afterTax - pureDCA.afterTax;
  const vsDCAOnly = bestFull.result.afterTax - bestDCAOnly.result.afterTax;
  console.log('📈 OUTPERFORMANCE (vs Pure DCA):');
  console.log(`   Dynamic DCA only: ${(bestDCAOnly.result.afterTax - pureDCA.afterTax) >= 0 ? '+' : ''}${(bestDCAOnly.result.afterTax - pureDCA.afterTax).toFixed(2)} pp`);
  console.log(`   DCA + Swing:      ${vsPureDCA >= 0 ? '+' : ''}${vsPureDCA.toFixed(2)} pp ${vsPureDCA >= 0 ? '✅' : '❌'}`);
  console.log();

  // Best configs
  console.log('🏆 BEST CONFIGURATIONS:');
  console.log();
  console.log('Dynamic DCA Only:');
  console.log(`  maxMultiplier: ${bestDCAOnly.cfg.mult}, exponent: ${bestDCAOnly.cfg.exp}, skipAbove: ${bestDCAOnly.cfg.skip}`);
  console.log();
  console.log('DCA + Swing (best after-tax):');
  console.log(`  maxMult: ${bestFull.cfg.mult}, exp: ${bestFull.cfg.exp}, skip: ${bestFull.cfg.skip}`);
  console.log(`  derisk: ${bestFull.cfg.derisk}, deriskPct: ${bestFull.cfg.pct}, reinvest: ${bestFull.cfg.reinv}`);
  console.log();

  if (bestLowDD) {
    console.log('DCA + Swing (best with low drawdown <55%):');
    console.log(`  maxMult: ${bestLowDD.cfg.mult}, exp: ${bestLowDD.cfg.exp}, skip: ${bestLowDD.cfg.skip}`);
    console.log(`  derisk: ${bestLowDD.cfg.derisk}, deriskPct: ${bestLowDD.cfg.pct}, reinvest: ${bestLowDD.cfg.reinv}`);
    console.log();
  }

  // DD comparison
  console.log('🛡️ DRAWDOWN COMPARISON:');
  console.log(`   Pure DCA:       ${pureDCA.maxDD.toFixed(1)}%`);
  console.log(`   Dynamic DCA:    ${bestDCAOnly.result.maxDD.toFixed(1)}%`);
  console.log(`   DCA + Swing:    ${bestFull.result.maxDD.toFixed(1)}%`);
  if (bestLowDD) console.log(`   Best Low DD:    ${bestLowDD.result.maxDD.toFixed(1)}%`);
  console.log();

  // Final recommendation
  console.log('='.repeat(80));
  console.log('💡 FINAL RECOMMENDATION');
  console.log('='.repeat(80));
  console.log();

  const winner = bestFull.result.afterTax > bestDCAOnly.result.afterTax ? 'DCA + Swing' : 'Dynamic DCA Only';
  const winResult = bestFull.result.afterTax > bestDCAOnly.result.afterTax ? bestFull : bestDCAOnly;

  console.log(`Paras strategia: ${winner}`);
  console.log(`After-Tax CAGR: ${winResult.result.afterTax.toFixed(2)}%`);
  console.log(`Max Drawdown: ${winResult.result.maxDD.toFixed(1)}%`);
  console.log();

  if (bestLowDD && bestLowDD.result.afterTax > pureDCA.afterTax * 0.95) {
    console.log('Konservatiivisempi vaihtoehto (pienempi riski):');
    console.log(`  After-Tax CAGR: ${bestLowDD.result.afterTax.toFixed(2)}%`);
    console.log(`  Max Drawdown: ${bestLowDD.result.maxDD.toFixed(1)}%`);
  }
}

main().catch(console.error);

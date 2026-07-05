/**
 * Cycle Trading Strategy Test
 *
 * Idea: Sell at tops, buy at bottoms, repeat.
 * Even with taxes, avoiding 70-80% drawdowns should be profitable.
 */

import { RiskDataPoint } from '../src/lib/risk-metric-contract';

interface Lot { date: string; qty: number; cost: number; }

async function fetchData(): Promise<RiskDataPoint[]> {
  const r = await fetch('http://localhost:3000/api/risk-data');
  return (await r.json()).data;
}

interface CycleConfig {
  // When to sell (de-risk)
  sellThreshold: number;      // e.g., 0.85 = sell when risk > 85%
  sellConsecutiveDays: number; // e.g., 3 days above threshold
  sellPercent: number;         // e.g., 0.30 = sell 30% of position
  maxSellPerCycle: number;     // e.g., 0.80 = max 80% sold per cycle

  // When to buy (re-risk)
  buyThreshold: number;        // e.g., 0.25 = buy when risk < 25%
  buyConsecutiveDays: number;  // e.g., 3 days below threshold
  buyPercent: number;          // e.g., 0.50 = use 50% of cash

  // DCA during accumulation
  dcaBase: number;
  dcaMaxMult: number;
  dcaSkip: number;

  // Cooldown
  cooldownDays: number;
}

function runCycleTrading(
  data: RiskDataPoint[],
  cfg: CycleConfig,
  cash0: number,
  startDate: string
) {
  const filtered = data.filter(d => d.date >= startDate);
  if (!filtered.length) return null;

  let cash = cash0;
  let btc = 0;
  const lots: Lot[] = [];

  let highDays = 0, lowDays = 0;
  let lastSell = -999, lastBuy = -999;
  let cycleSellTotal = 0;
  let inAccumulationMode = true;

  // Tracking
  let totalInvested = 0;
  let totalSold = 0;
  let totalTax = 0;
  const yearlyGains = new Map<number, number>();
  const yearlyLosses = new Map<number, number>();

  let maxVal = cash0, maxDD = 0;
  const history: { date: string; value: number; btc: number; cash: number; risk: number; action: string }[] = [];

  let sellCount = 0, buyCount = 0, dcaCount = 0;
  let lastDCA: Date | null = null;

  for (let i = 0; i < filtered.length; i++) {
    const p = filtered[i];
    const dt = new Date(p.date);
    const yr = dt.getFullYear();
    let action = 'HOLD';

    // Track consecutive days
    if (p.risk >= cfg.sellThreshold) {
      highDays++;
      if (p.risk < cfg.buyThreshold) lowDays = 0;
    } else {
      highDays = Math.max(0, highDays - 1);
    }

    if (p.risk <= cfg.buyThreshold) {
      lowDays++;
      if (p.risk > cfg.sellThreshold) highDays = 0;
    } else {
      lowDays = Math.max(0, lowDays - 1);
    }

    // Current value
    const btcVal = btc * p.price;
    const totalVal = cash + btcVal;

    if (totalVal > maxVal) maxVal = totalVal;
    const dd = maxVal > 0 ? (maxVal - totalVal) / maxVal : 0;
    if (dd > maxDD) maxDD = dd;

    // ========== SELL LOGIC ==========
    if (highDays >= cfg.sellConsecutiveDays &&
        (i - lastSell) >= cfg.cooldownDays &&
        cycleSellTotal < cfg.maxSellPerCycle &&
        btc > 0) {

      const sellPct = Math.min(cfg.sellPercent, cfg.maxSellPerCycle - cycleSellTotal);
      const sellBTC = btc * sellPct;
      const sellEUR = sellBTC * p.price * 0.999; // 0.1% fee

      // FIFO cost basis
      let rem = sellBTC, costBasis = 0;
      const newLots: Lot[] = [];
      for (const lot of lots) {
        if (rem <= 0) { newLots.push(lot); continue; }
        const take = Math.min(rem, lot.qty);
        costBasis += take * (lot.cost / lot.qty);
        rem -= take;
        const remaining = lot.qty - take;
        if (remaining > 1e-8) {
          newLots.push({ ...lot, qty: remaining, cost: lot.cost * (remaining / lot.qty) });
        }
      }
      lots.length = 0;
      lots.push(...newLots);

      const gain = sellEUR - costBasis;
      if (gain > 0) {
        yearlyGains.set(yr, (yearlyGains.get(yr) || 0) + gain);
      } else {
        yearlyLosses.set(yr, (yearlyLosses.get(yr) || 0) + Math.abs(gain));
      }

      btc -= sellBTC;
      cash += sellEUR;
      totalSold += sellEUR;
      cycleSellTotal += sellPct;
      lastSell = i;
      sellCount++;
      inAccumulationMode = false;
      action = `SELL ${(sellPct * 100).toFixed(0)}%`;
    }

    // ========== BUY LOGIC (Re-entry after selling) ==========
    if (!inAccumulationMode &&
        lowDays >= cfg.buyConsecutiveDays &&
        (i - lastBuy) >= cfg.cooldownDays &&
        cash > 100) {

      const buyEUR = cash * cfg.buyPercent;
      if (buyEUR >= 50) {
        const buyBTC = buyEUR * 0.999 / p.price;
        lots.push({ date: p.date, qty: buyBTC, cost: buyEUR });
        btc += buyBTC;
        cash -= buyEUR;
        totalInvested += buyEUR;
        lastBuy = i;
        buyCount++;
        cycleSellTotal = 0; // Reset cycle
        inAccumulationMode = true;
        action = `BUY ${(cfg.buyPercent * 100).toFixed(0)}%`;
      }
    }

    // ========== DCA LOGIC (During accumulation) ==========
    if (inAccumulationMode) {
      const daysSinceDCA = lastDCA
        ? Math.floor((dt.getTime() - lastDCA.getTime()) / 86400000)
        : 999;

      if (daysSinceDCA >= 7 && p.risk < cfg.dcaSkip && cash >= cfg.dcaBase) {
        const mult = cfg.dcaMaxMult * (1 - Math.pow(p.risk, 0.8));
        const dcaAmt = Math.min(cfg.dcaBase * mult, cash);

        if (dcaAmt >= 20) {
          const buyBTC = dcaAmt * 0.999 / p.price;
          lots.push({ date: p.date, qty: buyBTC, cost: dcaAmt });
          btc += buyBTC;
          cash -= dcaAmt;
          totalInvested += dcaAmt;
          lastDCA = dt;
          dcaCount++;
          if (action === 'HOLD') action = 'DCA';
        }
      }
    }

    history.push({ date: p.date, value: totalVal, btc, cash, risk: p.risk, action });
  }

  // Calculate taxes
  for (const [yr, gains] of yearlyGains) {
    const losses = yearlyLosses.get(yr) || 0;
    const net = Math.max(0, gains - losses);
    if (net > 0) {
      const tax = net <= 30000 ? net * 0.30 : 30000 * 0.30 + (net - 30000) * 0.34;
      totalTax += tax;
    }
  }

  const finalPrice = filtered[filtered.length - 1].price;
  const finalVal = cash + btc * finalPrice;
  const years = filtered.length / 365;

  const cagr = (Math.pow(finalVal / cash0, 1 / years) - 1) * 100;
  const afterTaxVal = finalVal - totalTax;
  const afterTaxCAGR = (Math.pow(afterTaxVal / cash0, 1 / years) - 1) * 100;

  // Unrealized gains at end
  let totalCostBasis = lots.reduce((s, l) => s + l.cost, 0);
  const unrealizedGain = btc * finalPrice - totalCostBasis;
  const unrealizedTax = unrealizedGain > 0
    ? (unrealizedGain <= 30000 ? unrealizedGain * 0.30 : 30000 * 0.30 + (unrealizedGain - 30000) * 0.34)
    : 0;

  const fullyTaxedVal = finalVal - totalTax - unrealizedTax;
  const fullyTaxedCAGR = (Math.pow(fullyTaxedVal / cash0, 1 / years) - 1) * 100;

  return {
    finalVal,
    cagr,
    afterTaxCAGR,
    fullyTaxedCAGR,
    maxDD: maxDD * 100,
    totalTax,
    unrealizedTax,
    sellCount,
    buyCount,
    dcaCount,
    totalInvested,
    totalSold,
    finalBTC: btc,
    finalCash: cash,
    history,
  };
}

async function main() {
  const data = await fetchData();
  const cash0 = 10000;
  const start = '2018-01-01';

  console.log('='.repeat(80));
  console.log('CYCLE TRADING STRATEGY TEST');
  console.log('Idea: Myy huipuilla, osta pohjilla, toista. Voittaako verot?');
  console.log('='.repeat(80));
  console.log();

  // Test various configurations
  const configs: { name: string; cfg: CycleConfig }[] = [
    {
      name: 'Aggressive Cycle (sell 50% @ 0.85, buy 70% @ 0.20)',
      cfg: {
        sellThreshold: 0.85, sellConsecutiveDays: 3, sellPercent: 0.50, maxSellPerCycle: 0.90,
        buyThreshold: 0.20, buyConsecutiveDays: 3, buyPercent: 0.70,
        dcaBase: 100, dcaMaxMult: 3, dcaSkip: 0.70, cooldownDays: 7
      }
    },
    {
      name: 'Very Aggressive (sell 70% @ 0.80, buy 80% @ 0.25)',
      cfg: {
        sellThreshold: 0.80, sellConsecutiveDays: 2, sellPercent: 0.70, maxSellPerCycle: 0.95,
        buyThreshold: 0.25, buyConsecutiveDays: 2, buyPercent: 0.80,
        dcaBase: 100, dcaMaxMult: 4, dcaSkip: 0.65, cooldownDays: 5
      }
    },
    {
      name: 'Conservative Cycle (sell 30% @ 0.90, buy 50% @ 0.15)',
      cfg: {
        sellThreshold: 0.90, sellConsecutiveDays: 5, sellPercent: 0.30, maxSellPerCycle: 0.70,
        buyThreshold: 0.15, buyConsecutiveDays: 5, buyPercent: 0.50,
        dcaBase: 100, dcaMaxMult: 3, dcaSkip: 0.75, cooldownDays: 14
      }
    },
    {
      name: 'Extreme Cycle (sell 80% @ 0.85, buy 90% @ 0.20)',
      cfg: {
        sellThreshold: 0.85, sellConsecutiveDays: 2, sellPercent: 0.80, maxSellPerCycle: 0.95,
        buyThreshold: 0.20, buyConsecutiveDays: 2, buyPercent: 0.90,
        dcaBase: 100, dcaMaxMult: 4, dcaSkip: 0.60, cooldownDays: 3
      }
    },
    {
      name: 'Multi-Tranche (sell 25% x4 @ 0.80, buy 60% @ 0.25)',
      cfg: {
        sellThreshold: 0.80, sellConsecutiveDays: 2, sellPercent: 0.25, maxSellPerCycle: 0.90,
        buyThreshold: 0.25, buyConsecutiveDays: 3, buyPercent: 0.60,
        dcaBase: 100, dcaMaxMult: 3.5, dcaSkip: 0.70, cooldownDays: 7
      }
    },
  ];

  // Pure DCA baseline
  const pureDCA = runCycleTrading(data, {
    sellThreshold: 2, sellConsecutiveDays: 999, sellPercent: 0, maxSellPerCycle: 0,
    buyThreshold: -1, buyConsecutiveDays: 999, buyPercent: 0,
    dcaBase: 100, dcaMaxMult: 1, dcaSkip: 1.1, cooldownDays: 999
  }, cash0, start)!;

  // Dynamic DCA only
  const dynDCA = runCycleTrading(data, {
    sellThreshold: 2, sellConsecutiveDays: 999, sellPercent: 0, maxSellPerCycle: 0,
    buyThreshold: -1, buyConsecutiveDays: 999, buyPercent: 0,
    dcaBase: 100, dcaMaxMult: 4, dcaSkip: 0.70, cooldownDays: 999
  }, cash0, start)!;

  console.log('📊 RESULTS COMPARISON');
  console.log('='.repeat(80));
  console.log();
  console.log('| Strategy                        | Final €   | CAGR   | After-Tax | Full Tax | Max DD  | Sells | Buys |');
  console.log('|---------------------------------|-----------|--------|-----------|----------|---------|-------|------|');
  console.log(`| Pure DCA (baseline)             | ${pureDCA.finalVal.toFixed(0).padStart(9)} | ${pureDCA.cagr.toFixed(1).padStart(5)}% | ${pureDCA.afterTaxCAGR.toFixed(1).padStart(8)}% | ${pureDCA.fullyTaxedCAGR.toFixed(1).padStart(7)}% | ${pureDCA.maxDD.toFixed(1).padStart(6)}% | ${String(pureDCA.sellCount).padStart(5)} | ${String(pureDCA.buyCount).padStart(4)} |`);
  console.log(`| Dynamic DCA only                | ${dynDCA.finalVal.toFixed(0).padStart(9)} | ${dynDCA.cagr.toFixed(1).padStart(5)}% | ${dynDCA.afterTaxCAGR.toFixed(1).padStart(8)}% | ${dynDCA.fullyTaxedCAGR.toFixed(1).padStart(7)}% | ${dynDCA.maxDD.toFixed(1).padStart(6)}% | ${String(dynDCA.sellCount).padStart(5)} | ${String(dynDCA.buyCount).padStart(4)} |`);

  const results: { name: string; result: ReturnType<typeof runCycleTrading> }[] = [];

  for (const { name, cfg } of configs) {
    const result = runCycleTrading(data, cfg, cash0, start);
    if (result) {
      results.push({ name, result });
      console.log(`| ${name.substring(0, 31).padEnd(31)} | ${result.finalVal.toFixed(0).padStart(9)} | ${result.cagr.toFixed(1).padStart(5)}% | ${result.afterTaxCAGR.toFixed(1).padStart(8)}% | ${result.fullyTaxedCAGR.toFixed(1).padStart(7)}% | ${result.maxDD.toFixed(1).padStart(6)}% | ${String(result.sellCount).padStart(5)} | ${String(result.buyCount).padStart(4)} |`);
    }
  }
  console.log();

  // Find best
  const best = results.reduce((a, b) =>
    (b.result?.afterTaxCAGR || 0) > (a.result?.afterTaxCAGR || 0) ? b : a
  );

  console.log('='.repeat(80));
  console.log('📈 ANALYSIS');
  console.log('='.repeat(80));
  console.log();

  const vsPureDCA = (best.result?.afterTaxCAGR || 0) - pureDCA.afterTaxCAGR;
  const vsDynDCA = (best.result?.afterTaxCAGR || 0) - dynDCA.afterTaxCAGR;

  console.log(`Best Cycle Strategy: ${best.name}`);
  console.log(`  After-Tax CAGR: ${best.result?.afterTaxCAGR.toFixed(2)}%`);
  console.log(`  Max Drawdown: ${best.result?.maxDD.toFixed(1)}%`);
  console.log(`  Sells: ${best.result?.sellCount}, Buys: ${best.result?.buyCount}`);
  console.log();
  console.log(`vs Pure DCA: ${vsPureDCA >= 0 ? '+' : ''}${vsPureDCA.toFixed(2)} pp ${vsPureDCA > 0 ? '✅' : '❌'}`);
  console.log(`vs Dynamic DCA only: ${vsDynDCA >= 0 ? '+' : ''}${vsDynDCA.toFixed(2)} pp ${vsDynDCA > 0 ? '✅' : '❌'}`);
  console.log();

  // Drawdown comparison
  console.log('🛡️ DRAWDOWN REDUCTION:');
  console.log(`  Pure DCA: ${pureDCA.maxDD.toFixed(1)}%`);
  console.log(`  Dynamic DCA: ${dynDCA.maxDD.toFixed(1)}%`);
  console.log(`  Best Cycle: ${best.result?.maxDD.toFixed(1)}%`);
  const ddReduction = pureDCA.maxDD - (best.result?.maxDD || 0);
  console.log(`  Reduction: ${ddReduction.toFixed(1)} percentage points`);
  console.log();

  // Tax analysis
  console.log('💰 TAX IMPACT:');
  console.log(`  Dynamic DCA taxes paid: €${dynDCA.totalTax.toFixed(0)}`);
  console.log(`  Best Cycle taxes paid: €${best.result?.totalTax.toFixed(0)}`);
  console.log(`  Tax cost: €${((best.result?.totalTax || 0) - dynDCA.totalTax).toFixed(0)}`);
  console.log();

  // Is cycle trading worth it?
  console.log('='.repeat(80));
  console.log('💡 CONCLUSION');
  console.log('='.repeat(80));
  console.log();

  if (vsDynDCA > 0) {
    console.log('✅ CYCLE TRADING VOITTAA!');
    console.log(`   Vaikka maksat veroja, huippujen myynti ja pohjien osto kannattaa.`);
    console.log(`   Extra tuotto: +${vsDynDCA.toFixed(2)} pp CAGR`);
    console.log(`   Drawdown reduction: ${ddReduction.toFixed(1)} pp`);
  } else {
    console.log('❌ Dynamic DCA ilman myyntejä on silti paras.');
    console.log(`   Verot syövät liikaa cycle tradingin tuotoista.`);
    console.log(`   Mutta drawdown on pienempi: ${ddReduction.toFixed(1)} pp`);
  }
  console.log();

  // Show trade history for best
  if (best.result) {
    const trades = best.result.history.filter(h => h.action !== 'HOLD' && h.action !== 'DCA');
    if (trades.length > 0 && trades.length <= 30) {
      console.log('📋 CYCLE TRADES:');
      console.log('-'.repeat(60));
      for (const t of trades) {
        console.log(`  ${t.date} | Risk: ${(t.risk * 100).toFixed(0)}% | ${t.action.padEnd(12)} | Value: €${t.value.toFixed(0)}`);
      }
      console.log();
    }
  }
}

main().catch(console.error);

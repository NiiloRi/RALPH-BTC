# Valuation models — Power law, Stock-to-flow, Difficulty

*Added 2026-07-24. Three descriptive valuation overlays, each on its own dashboard
tab with a 12-month mini strip on the Overview hero. Display layer only
(`src/lib/models/`) — the frozen Layer-0 risk formula is untouched (its own
power-law parameterizations in `src/lib/features/valuation.ts` and
`src/lib/riskFormula.ts` are a different, frozen concern and are never
reconciled with these fits).*

## Reporting convention

Every model refits on page load from the live price series via closed-form OLS
and reports its **own fitted parameters** in the chart's stat strip: exponent
`b`, `R²`, sample size, fitted range, and the current price-vs-model deviation.
Reference exponents from the literature are cited below but never hardcoded.
All fits are **full-sample and in-sample** — context, not forecasts.

## 1 · Power law

**Model:** `ln(P) = a + b·ln(daysSinceGenesis)`, i.e. `P = A·days^b`, OLS on the
full daily history (the regressor moves meaningfully every day, so daily
sampling is appropriate).

**Bands:** the 5th/95th percentiles of the fit's ln-residuals as parallel
offsets: `support = fair·e^Q05`, `resistance = fair·e^Q95`. By construction
~90% of the fitted sample's daily closes lie between the bands — an in-sample
coverage statement, not a forecast interval.

**Reference:** Giovanni Santostasi's power-law theory, `P = A·days^5.8`, with a
÷3/×3 support/resistance convention (we use residual quantiles instead — the
fixed ÷3/×3 width is an aesthetic convention our data may not support).

**Projectable:** yes — the model is a pure function of time.

## 2 · Stock-to-flow (S2F)

**Supply schedule** (deterministic, `src/lib/models/s2f.ts`): piecewise-linear
over subsidy eras. Era boundaries are the actual halving dates; blocks/day
within each past era is derived as `210,000 / actual era days`, which
self-corrects for real block-time variance. Current + projection eras assume
the nominal 144 blocks/day.

| Era | Start | Subsidy | Blocks/day | End supply |
|---|---|---|---|---|
| 1 | 2009-01-03 | 50 | 147.37 | 10,500,000 |
| 2 | 2012-11-28 | 25 | 159.21 | 15,750,000 |
| 3 | 2016-07-09 | 12.5 | 149.79 | 18,375,000 |
| 4 | 2020-05-11 | 6.25 | 145.93 | 19,687,500 |
| 5 | 2024-04-19 | 3.125 | 144 (assumed) | ~20,343,750 |
| 6 (projection) | **2028-04-16 (EST)** | 1.5625 | 144 (assumed) | — |

- `supply(d)` = era start supply + subsidy × blocks/day × days into the era
  (continuous, exact at each halving; sanity: supply(2020-01-01) = 18.13M vs
  real 18.14M).
- `flow(d)` = subsidy × blocks/day × 365 (annualized issuance — a step function).
- `S2F(d)` = supply / flow — ramps slowly within an era, jumps ~2× at halvings
  (era 3 ≈ 23→27, era 4 ≈ 55→59, era 5 ≈ 120→124, era 6 ≈ 248).

**Model:** `ln(P) = a + b·ln(S2F)`, OLS on **monthly** samples (last close per
calendar month). Monthly because ln(S2F) is nearly constant within an era —
daily samples would be ~30× autocorrelated pseudo-replicates overweighting
long eras. Matches PlanB's reference methodology.

**Reference:** PlanB 2019 ("Modeling Bitcoin Value with Scarcity"), b ≈ 3.3;
the Jul-2026 tweet simplifies to `S2F³`.

**Projectable:** yes — supply is deterministic. Across the estimated halving
the flow halves and the model value steps up by `2^b`; that visible step is
the projection's point.

## 3 · Difficulty

**Model:** `ln(P) = a + b·ln(difficulty)` — difficulty as a proxy for bitcoin
production cost. OLS on the full daily price series joined to the difficulty
history by **forward fill** (difficulty is literally a step function changing
only at ~2-week retargets, so each price date carries the last difficulty at
or before it). Expect `b ≈ 0.5`.

**Data:** blockchain.info charts API (`charts/difficulty?timespan=all`,
free, no key), fetched server-side by `src/lib/data/difficulty-fetcher.ts`
with a 24-hour disk cache (`data/raw/difficulty.json`, inside the persistent
volume) and a stale-cache fallback when the API is unreachable. The first days
of Jan 2009 come back as difficulty 0 and are filtered at ingest. Served to
the client by `GET /api/difficulty` (auth-gated like everything else).

**Reference:** PlanB (Jul 2026): "Bitcoin price is currently best estimated by
bitcoin difficulty… price = difficulty^0.5"; bitbo's chart uses
`0.002·difficulty^0.51`.

**Projectable: no, deliberately.** Future difficulty is unknowable (it follows
hashrate, which follows mining economics). `evaluateDifficultyModel` takes a
difficulty *value*, not a date — the type signature enforces the rule.

## Projection ("Project to est. 2028 halving +6mo")

Available on the Power law, Stock-to-flow and Quantile fan charts (the risk
metric cannot be projected; difficulty deliberately isn't).

- **Next-halving estimate:** halvings occur every 210,000 blocks; from the
  actual 2024-04-19 halving at an assumed 144 blocks/day →
  210,000/144 ≈ 1458 days → **2028-04-16**. An estimate — block times vary —
  and always labeled `HALVING · EST` (dashed line) in the UI.
- **Horizon:** estimated halving + 6 months (2028-10-16), weekly rows.
- The price line simply stops at the last real observation
  (`connectNulls={false}`); only fitted curves extend.
- **This is extrapolation of an in-sample descriptive fit, not a forecast.**

## Caveats (also shown as chart footnotes)

- All three are in-sample descriptive fits, refit on load; like the quantile
  fan, values at past dates use data from their future.
- S2F is widely criticized as a predictive model (deterministic regressor;
  cointegration/spurious-regression critiques). The power-law exponent is
  sensitive to the sample start date. Difficulty↔price causality is contested —
  difficulty follows price at least as much as it leads it.
- Personal decision-support context, not financial advice.

## 4 · Cycle Low Radar (separate tab)

Recreation of the Blockworks "cycle low" condition basket (Luke Leasure /
@0xMether, Jul 2026) in `src/lib/models/cycle-low-radar.ts` + `/api/radar`:

- **NAS100/BTC & Gold/BTC relative strength**: weekly ratio → 14-week Wilder
  RSI → 14-week SMA. Readings ≥65–70 are historical tail events (≈6% / <1% of
  history) characteristic of BTC high-timeframe lows.
- **Realized price**: BTC spot vs onchain cost basis (bitcoin-data.com; its
  free tier serves the trailing 4 years — labeled in the UI).
- **Cycle drawdown clock**: max drawdown by weeks-from-ATH vs the
  2013/2017/2021 paths; prior troughs were set by week 60.
- Data: Yahoo Finance (^NDX, GC=F — explicit period1/period2, `range=max`
  silently coarsens weekly bars to 3-month bars), cached 24h
  (`data/raw/radar.json`, `RADAR_CACHE_DIR` test override).
- Limitations surfaced in the UI verbatim from the source report: n ≈ 3–4
  episodes, signals are not independent (all measure "deep persistent
  drawdown"), structural change may break every relationship.

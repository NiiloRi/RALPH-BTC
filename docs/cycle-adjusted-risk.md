# Cycle-Amplitude-Adjusted Risk — Architecture & Research Report

*Research round 2026-07-06. Architecture only — no implementation yet. Written as the
specification for the next coding round; an executor prompt is included at the end.*

*Empirical numbers in this document were computed from the live `/api/risk-data` series
(5,569 closes, 2011-02 → 2026-07-06) with read-only analysis scripts on 2026-07-06.*

---

## 1 · Executive answer

**Yes — add a cycle-adjusted risk layer. The hypothesis is measurably true in this
model's own output.** The Jan-2025 cycle top registered **59.7%** ("Neutral/Moderate-High
boundary") on the absolute scale, versus **89–92%** at the 2013/2017/2021 tops. The model
said *Hold* at the top of the cycle.

**Safest architecture: hybrid, built as read-only layers over a frozen base** — the same
pattern the meta-layers already use:

- **Layer 0 — Absolute Historical Risk**: the current score, *frozen and relabeled
  honestly*. Remains the canonical, comparable-across-time record.
- **Layer 1 — Cycle-Adjusted Risk**: per-component rolling-window percentile
  renormalization, recomposed with the same weights and calibration. Prototype validated:
  2025 top 59.7% → **76.0%**, bottoms sharpen (11% → 6–7%), today 44.8% → **35.3%**.
- **Layer 2 — Expected Current-Cycle Range**: derived from the quantile fan (which
  *already is* a compression model — its negative upper curvature is amplitude decay),
  shown as price-space context, never as a point prediction.
- **Layer 3 — Divergence/Confidence**: extend the existing confidence module with a named
  cycle-vs-valuation divergence state (the current situation: cycle 82% vs valuation 30%).

Do **not** replace the absolute score. Do **not** re-tune Layer 0's constants. Additive
layers preserve auditability and the existing mental model.

## 2 · Where the current model is structurally wrong

Evidence measured from the live API series:

| Compression measure | 2013 era | 2017 era | 2021 era | Current cycle |
|---|---|---|---|---|
| Median 30d realized vol | 102% (p90 317%) | 62% | 65% | **45%** (p90 72%) |
| Max drawdown top→bottom | 85% | 83% | 77% | **53%** so far |
| Mayer multiple at top | 5.72 | 3.60 | 1.42 | **1.36** |
| Fan Q99/Q50 ratio | 11.7× | 6.2× | 3.2× | **1.6–2.0×** |
| Fan Q50/Q1 ratio | 2.24× | 2.16× | 2.06× | **1.94×** |
| **Absolute risk at cycle top** | **89.3%** | **92.4%** | **87.7%** | **59.7%** |
| Absolute risk at cycle bottom | 18.4% ('15) | 11.2% ('18) | 11.2% ('22) | — |

**Mechanism — the score mixes compression-blind and compression-frozen parts:**

1. **Fixed-constant normalizations encode 2011–2021 amplitudes.** `route.ts`: Mayer
   `(mm−0.5)/2.5` → a 2021/2025-style top (Mayer 1.4) scores 0.36 where 2017 scored 1.0.
   Same disease in momentum ROC ranges (−50%..+100%), volatility `vol/1.5` (45% vol reads
   0.30 forever), and the lib valuation constants (`(mvrv−0.7)/1.3`, NVT, Pi-cycle
   ranges). These constants silently assert "future cycles look like 2013–2021."
2. **The cycle clock is compression-blind the other way** — it *always* reaches ~0.8+
   late-cycle regardless of price. Its template also failed in 2025: the cycle topped
   ~275 days post-halving vs the 480-day peak-window center, so **cycle read 19% at the
   actual top** while it reads **82% today**, 18 months after the top. The clock missed
   the top and is loudest after it.
3. **Asymmetry: tops compress, floors barely do.** Q50/Q1 is stable (~2.0–2.2×) across
   all cycles and score bottoms are flat (18→11→11%). The distortion concentrates in the
   **upper half of the scale** — where "Take Profits / Caution" actions live. The
   80–100% band may be unreachable going forward; the 0–20% band is still live.
4. **Already in the repo, never wired:** `getDiminishingReturnsMultiplier` /
   `getDiminishingLossesMultiplier` (`src/lib/features/cycle.ts:118-142`) encode this
   thesis with hardcoded per-cycle multipliers — display-only, used in no score.
   (Correctly so: hardcoded multipliers bake in the answer; the right fix estimates
   compression from data.)
5. **Is fixed 0–100% misleading?** As a *historical* scale, no. As a *decision* scale,
   yes: "80–100% = Caution" implicitly promises those readings are attainable. On current
   amplitude they may never trigger again, making the top bands dead zones and "Hold" the
   default verdict straight through a cycle top — the most expensive failure mode for a
   take-profits tool.

## 3 · Proposed architecture

```
FeatureVector / components (unchanged)
        │
        ▼
Layer 0  ABSOLUTE HISTORICAL RISK  = current score, frozen        [exists]
        │  (read-only input to layers below — never modified)
        ├──────────────► Layer 1  CYCLE-ADJUSTED RISK              [new]
        │                per-component rolling percentile → recompose
        ├──────────────► Layer 2  EXPECTED CURRENT-CYCLE RANGE     [new]
        │                fan-derived price envelope + per-cycle extremes table
        └──────────────► Layer 3  DIVERGENCE / CONFIDENCE          [extend]
                         existing confidence + named divergence states
```

Same invariant as `src/lib/meta/`: layers **read** `RiskOutput[]`, never feed back.
`validateRiskInvariant` applies.

## 4 · Formula-level design

### Layer 1 — Cycle-Adjusted Risk (primary deliverable)

- **Purpose:** answer "how extreme is today *relative to what this market regime can
  produce*," restoring decision-usefulness of the upper bands.
- **Inputs:** the six daily component series (already in `RiskOutput.components`),
  weights, calibration constants. No new data sources.
- **Calculation:**
  1. For each *compression-sensitive* component
     `k ∈ {valuation, momentum, volatility, attention}`:
     `adj_k[t] = rank-percentile of comp_k[t] within comp_k[t−W .. t]`
     (inclusive of t, ties counted ≤).
  2. Keep `cycle` and `macro` **raw** (a time-ramp's rolling percentile is meaningless;
     macro is regime-level, not amplitude-level).
  3. Recompose: `rawAdj[t] = Σ w_k · v_k[t]` with the **unchanged** weights;
     `riskAdj[t] = σ(7·(rawAdj−0.48))`, same clamp, same EMA smoothing α=0.3.
- **Window W:** default **1460 d (4y ≈ one halving cycle)**. Ship with a sensitivity
  table for W ∈ {1095, 1460, 1825}; conclusions must be stable across all three.
- **Burn-in:** emit `null` (not 0.5) for the first 365 valid points; UI shows
  "warming up."
- **Bounds:** construction guarantees [0,1].
- **Failure modes (document in code + UI):**
  - *Relativity artifact:* after a long flat bear, mediocre readings drift toward high
    percentiles. Mitigation: Layer 0 always shown alongside; divergence flag when
    |L1−L0| > 25pp.
  - *Distribution shape shift:* percentile-uniform components change the raw-ensemble
    distribution vs Layer 0; reusing the sigmoid is a pragmatic choice validated
    empirically, not theoretically derived. Say so in the method note.
  - *2013-era readings* have short windows — mark first ~2.5y as burn-in-degraded.
- **Prototype evidence (same weights/sigmoid, computed 2026-07-06):**

| Event | Absolute (L0) | Cycle-adjusted (L1 prototype) |
|---|---|---|
| 2013 top | 89.3% | 88.3% (short-window burn-in) |
| 2017 top | 92.4% | **94.1%** |
| 2021 top | 87.7% | **92.8%** |
| **2025 top** | **59.7%** | **76.0%** (67.2% at exact top date) |
| 2015 / 2018 / 2022 bottoms | 18.4 / 11.2 / 11.2% | **11.3 / 6.3 / 6.8%** |
| **Today (2026-07-06)** | **44.8%** | **35.3%** |

  The residual 2025 shortfall (76 vs ~90) is **not** amplitude — it is the cycle clock
  reading 19% at the top (weight 0.22, kept raw). A separate, honestly-documented
  limitation; do **not** patch by down-weighting cycle in L1 tuned on this single event
  (n=1 curve-fit). Round-3 research item: price-confirmation gating of the clock.
- **Tests:** bounds/NaN; burn-in nulls; truncation invariance (computing L1 on data[0..t]
  equals full-series value at t — pattern already in `normalizer.test.ts`); monotonicity
  (raising a component value never lowers its percentile); window-sensitivity harness;
  the pre-registered cycle-by-cycle acceptance table (§9).

### Layer 2 — Expected Current-Cycle Range

- **Purpose:** replace the implicit "tops = 90–100%" promise with a data-estimated
  envelope; refuse point predictions.
- **Two sub-estimates, clearly separated:**
  - **(a) Price-space envelope from the fan** (primary, robust): today's Q1..Q99 fan
    values *are* the compressed plausible range — the fitted upper-curvature asymmetry
    (β₂ = −0.23 vs +0.01) is the compression model, estimated from 5,569 points, not
    from n=4 cycle anecdotes. Display: current Q1/Q50/Q99 + where historical tops/bottoms
    sat in τ terms.
  - **(b) Score-space extremes table** (secondary, explicitly n=4): per-cycle observed
    max/min of L0 and L1 with a Theil-Sen trend line and *wide* uncertainty band, labeled
    "4 observations — indicative only." Never rendered as "next top = X%."
- **Failure modes:** current-cycle drawdown (53%) may still deepen — the table must
  recompute, not freeze; the fan sub-estimate inherits the full-sample caveat for
  historical dates (fine for *today's* envelope since today is the sample end).
- **Tests:** table regenerates from data (no hardcoded per-cycle numbers besides anchor
  dates already in `HISTORICAL_CYCLES`); trend fit refuses n<3; NaN guards.

### Layer 3 — Divergence / Confidence (extension)

- **Purpose:** name the states instead of a bare dispersion number.
- **Inputs:** existing `RiskConfidence` + component values + L0/L1 gap.
- **Logic:** pure classifier returning one of: `aligned`, `clock-vs-price` (cycle high &
  valuation+momentum low — the current state), `price-vs-clock` (inverse),
  `layers-diverge` (|L1−L0| > 25pp), `data-degraded` (completeness < 0.95). Each state
  carries a one-line explanation string and an action-label qualifier.
- **Tests:** each state constructible from synthetic components; exactly one state per
  day; qualifier text stable.

## 5 · Regression-fan integration

- **Today:** full-sample fit, **display-only** — verified it does not touch the score.
  Correct for *today's* reading (today is the sample end), **lookahead-biased for any
  historical series** derived from it.
- **Plan:** keep the fan **out of the risk score in this round**. Use it as Layer 2(a)
  context and add one new *walk-forward-safe* artifact: an **expanding-window fan-τ
  series** — refit `fitQuantileFan` on data[0..t] at a monthly grid (~180 refits × 60 ms
  ≈ 11 s, precomputed by a script into cached JSON, not per-request), producing "fan
  position τ as it would have been known at the time." Validation question it must answer
  before τ may ever enter the score (round-2 gate): *were expanding-window τ values at
  the four tops comparable (all ≥ ~0.95)?* If yes, τ is a naturally cycle-adjusted
  valuation input candidate; if no, it stays context.
- **Expanding-window (not rolling) for the fan:** the power-law-style trend is a
  whole-history object; rolling windows would let the trend forget old cycles and
  double-count compression already handled by the quantile curvature.

## 6 · Volatility-compression measurement plan

Measure, don't assume: a small analysis module producing (1) rolling 4y median/p90 of
30d realized vol, (2) per-cycle max drawdown, (3) Mayer-at-top series, (4) fan Q99/Q50
by year — the tables above, regenerated from data at test time. These become
**regression tests for the thesis itself**: if compression reverses (vol regime
doubles), tests flag it and the L1 window choice gets revisited — the guard against
hardcoding desired results.

## 7 · Risk-band & action-label plan

- **Keep the five fixed bands on Layer 0** — historical vocabulary; `bands.ts` stays the
  single source of truth.
- **Parallel adjusted readout, never a silent replacement:** verdict shows both —
  *"Hold / Neutral (absolute 44.8%) · adjusted 35.3% → leans DCA"*. Deterministic label
  rule: same band → normal label; adjacent bands → L0 label with "leans ⟨adjacent
  action⟩" suffix; ≥2 bands apart → divergence qualifier + confidence capped medium.
- **Asymmetry rule (evidence-based):** compression is top-heavy, so the adjusted lens
  matters most for Take-Profits/Caution decisions; bottom-band actions may trust the
  absolute scale. Encode as documentation + a hint shown only in the top half.
- Labels stay action-oriented and private; all gating runs through the existing
  `qualifyAction` path.

## 8 · UI plan (exact)

1. **Hero gauge:** absolute stays primary; add a second thin arc or tick-marker on the
   same dial for L1 + an "adjusted X%" chip next to the verdict; verdict sentence per §7.
2. **Stat rail:** add "Cycle-adjusted" row with the L0↔L1 gap.
3. **Divergence chip:** replace the generic "components disagree" with the Layer-3 state
   string, e.g. *"clock-vs-price: cycle timing high, price-derived risk low."*
4. **Risk tab:** optional L1 overlay line on the main chart (toggle, default off), plus
   the per-cycle extremes table under the legend.
5. **Fan tab:** annotate historical top/bottom markers with τ values; "expected range"
   strip showing today's Q1/Q50/Q99.
6. **Methodology text:** one added paragraph — scale compression, what adjusted means,
   n=4 caveat.

## 9 · Validation plan (pre-registered)

- **Purity:** truncation-invariance tests for L1 and expanding-τ (value at t must not
  change when future data is deleted).
- **Cycle-by-cycle acceptance table (go/no-go), thresholds fixed now, before
  implementation — no post-hoc tuning:**
  - L1 ≥ 85% at the 2017-12 ±60d and 2021-11 ±60d maxima
  - L1 at the 2024-11/2025-01 top ≥ L0 + 10pp
  - L1 ≤ 12% at the 2018-12 and 2022-11 minima
  - Today's L1 within [25%, 50%]
  - If a criterion fails, report it as a finding — do not adjust constants to pass.
- **Sensitivity:** conclusions must hold for W ∈ {3y, 4y, 5y}; report the table.
- **Anti-curve-fit:** any parameter beyond the defaults above must be chosen on cycles
  1–3 only and validated on cycle 4.
- **Mechanical:** bounds, NaN/∞, burn-in nulls, monotonicity, inverted-risk check,
  determinism.
- **UI sanity:** with layers agreeing the dashboard must look unchanged except the new
  chip; divergence states screenshot-checked manually.

## 10 · Option comparison & implementation order

| Option | Interpretability | Defensibility | Overfit risk | Complexity | Verdict |
|---|---|---|---|---|---|
| A · fix normalization in place | poor (rewrites history) | medium | medium | low | ✗ breaks comparability |
| B · separate cycle-adjusted score | good | **high** (rank-based, no new params) | low | low-med | ✓ core |
| C · dynamic expected range only | good | high (fan) / weak (n=4 table) | low | low | ✓ as context |
| D · confidence only | good | high | none | trivial | ✓ but insufficient alone |
| E · replace fixed bands | poor (moving goalposts) | low | **high** | medium | ✗ |
| **F · hybrid B+C+D over frozen base** | **good** | **high** | **low** | **medium** | **✓ recommended** |

**Coding order** (each step lands green before the next):

1. `src/lib/adjusted/cycle-adjusted.ts` — `rollingPercentile(series, i, window)`,
   `calculateCycleAdjustedRisk(risks, i, {window=1460, adaptiveKeys})`,
   `calculateAllCycleAdjusted(...)` → `{value, band, perComponentPercentiles, burnIn}`
   + `cycle-adjusted.test.ts` (purity/bounds/monotonic/burn-in/sensitivity + the
   pre-registered acceptance table).
2. `src/lib/adjusted/divergence.ts` — state classifier + tests.
3. `src/lib/adjusted/cycle-extremes.ts` — per-cycle max/min table + Theil-Sen (n≥3
   guard) + tests.
4. `scripts/build-fan-history.ts` — expanding-window τ cache (monthly grid) →
   `public/fan_tau_history.json`; truncation test on 3 sample dates.
5. UI wiring per §8 (`VerdictHero`, `RiskDashboard`, plus a `combineActions(l0Band,
   l1Band)` helper in `src/lib/risk/bands.ts` with tests).
6. Update methodology text; record acceptance results in this document.

**Files to inspect first:** `src/lib/risk/model.ts`, `src/lib/risk/bands.ts`,
`src/lib/meta/{confidence,index}.ts`, `src/app/api/risk-data/route.ts` (component series
shape), `src/components/{VerdictHero,RiskDashboard,WhyPanel}.tsx`,
`src/lib/quantile-fan/quantile-fan.ts`.

**Acceptance:** all §9 criteria green · existing tests untouched-green · tsc/eslint
clean · Layer 0 byte-identical (invariant test) · UI unchanged when layers agree.

## 11 · Executor prompt (copy-paste for the coding model)

```
Implement the cycle-adjusted risk layers for the BTC risk dashboard at ~/ralph-crypto,
following docs/cycle-adjusted-risk.md. Rules:

- Layer 0 (existing risk score) is FROZEN: no changes to src/lib/risk/model.ts values,
  src/app/api/risk-data/route.ts formulas, weights, or calibration. Add a test asserting
  Layer-0 outputs are unchanged on a fixture.
- Build, in order, each step green (tsc, eslint, vitest) before the next:
  1. src/lib/adjusted/cycle-adjusted.ts: rollingPercentile(series, i, window) counting
     ties as <=, inclusive of i, null before 365 valid points; calculateCycleAdjustedRisk
     over RiskOutput[]: percentile-ize ONLY valuation, momentum, volatility, attention
     over trailing 1460d; keep cycle and macro raw; recompose with the existing
     DEFAULT_WEIGHTS and sigmoid(7*(raw-0.48)); EMA alpha 0.3. Tests: bounds, NaN,
     burn-in nulls, monotonicity, truncation-invariance (deleting future data must not
     change past values), window sensitivity {1095,1460,1825}, and this PRE-REGISTERED
     acceptance table on real exported data: L1>=0.85 at 2017-12+-60d and 2021-11+-60d
     maxima; L1 at 2024-11/2025-01 top >= L0+0.10; L1<=0.12 at 2018-12 and 2022-11
     minima. Do NOT tune parameters to pass; if a criterion fails, report it as a
     finding instead of adjusting constants.
  2. src/lib/adjusted/divergence.ts: classify each day into exactly one of aligned |
     clock-vs-price | price-vs-clock | layers-diverge (|L1-L0|>0.25) | data-degraded
     (completeness<0.95), each with a short explanation string. Tests per state.
  3. src/lib/adjusted/cycle-extremes.ts: per-cycle max/min of L0 and L1 using
     HISTORICAL_CYCLES anchor dates +-60d; Theil-Sen trend refusing n<3; no hardcoded
     result numbers. Tests.
  4. scripts/build-fan-history.ts: expanding-window refits of fitQuantileFan on a
     monthly grid writing public/fan_tau_history.json {date, tau, q01,q50,q99};
     truncation test on 3 dates. Report (do not act on) whether expanding-window tau
     at the four cycle tops was >=0.95.
  5. UI: VerdictHero gains an "adjusted X%" chip + second dial tick; verdict label rule:
     same band -> unchanged; adjacent bands -> suffix "leans <action>"; >=2 bands apart
     -> divergence qualifier + confidence capped medium (route through
     bands.qualifyAction / new combineActions in src/lib/risk/bands.ts with tests).
     Stat rail row "Cycle-adjusted". Divergence chip shows the classifier string.
     Risk tab: optional L1 overlay toggle (default off). No other visual changes when
     layers agree.
  6. Update docs/cycle-adjusted-risk.md with the acceptance results table.
- Honesty requirements: burn-in shows "warming up", never 0.5; all new UI numbers carry
  the adjusted/absolute distinction; never render a "next top will be X%" claim.
- Finish with: full vitest run, tsc, eslint, production build, and a summary table of
  the acceptance criteria with PASS/FAIL each.
```

---

**Bottom line:** the absolute scale is a good historian and a decaying advisor — it
scored the last top "Hold." Compression is real (vol 102→45%, Mayer 5.7→1.4, fan upper
band 11.7×→1.6×), the fix is a rank-based adjusted layer with *zero* new tunable
parameters, and the honest residual limitation is the cycle clock itself, which no
renormalization can save — it must be named in the UI, not hidden.

---

## 12 · Implementation results (2026-07-06)

Implemented per the plan. Layer 0 frozen (weights/calibration pinned by a guard test).
New modules: `src/lib/adjusted/{cycle-adjusted,divergence,cycle-extremes}.ts`,
`src/lib/quantile-fan/expanding.ts`, `scripts/build-fan-history.ts`,
`src/lib/risk/bands.ts::combineActions`. UI: adjusted chip + second dial needle +
"Cycle-adjusted" stat-rail row + divergence chip in `VerdictHero`, optional L1 overlay
toggle on the risk chart. **435 tests pass** (was 370); tsc/eslint/production-build clean.
Acceptance computed on a committed served-model fixture (`src/lib/adjusted/__fixtures__/
risk-series.json`, 5,369 days).

### Pre-registered acceptance table — all PASS

| Criterion | Threshold | Measured | Result |
|---|---|---|---|
| 2017 top L1 (±60d max) | ≥ 85% | 94.1% | ✅ PASS |
| 2021 top L1 (±60d max) | ≥ 85% | 92.6% | ✅ PASS |
| 2025 top L1 vs L0 | ≥ L0 + 10pp | 75.2% vs 59.7% (+15.5pp) | ✅ PASS |
| 2018 bottom L1 (±60d min) | ≤ 12% | 6.5% | ✅ PASS |
| 2022 bottom L1 (±60d min) | ≤ 12% | 7.2% | ✅ PASS |
| Today L1 | ∈ [25%, 50%] | 35.6% | ✅ PASS |
| Window sensitivity 3y/4y/5y | conclusions hold | tops 91–94%, bottoms 6–7%, today 27–36% | ✅ PASS |

### Cycle-extremes trend (Theil-Sen, n=4)

- Absolute top scale decays **−7.2 pp/cycle** — the structural problem, confirmed.
- Cycle-adjusted top scale decays **−3.1 pp/cycle** — 57% flatter; the fix works.
- Absolute bottoms near-flat (−1.8 pp/cycle) — floors barely compress, as predicted.

### Round-2 gate — expanding-window fan τ: **FAILED (as a score input)**

Expanding-window (walk-forward-safe) τ at the four cycle tops: **80.9% / >Q99 / 90.0% /
76.2%** — NOT consistently ≥ 95%. At the 2025 top the walk-forward τ read only 76%, no
better than the absolute scale. **Finding: the quantile fan is NOT a reliable
cycle-adjustment mechanism and must stay contextual only.** The rank-percentile component
layer (Layer 1) is the correct mechanism. `public/fan_tau_history.json` is cached for
display use, not fed into any score.

### Known residual limitation (unchanged, documented in UI)

Layer 1 lifts the 2025 top to 75% (from 60%) but not to the ~90% of earlier tops. The
gap is the **cycle clock** (weight 0.22, kept raw): it read 19% at the actual top and
82% eighteen months later. No renormalization fixes a broken clock. Round-3 research
item: price-confirmation gating of the cycle component. Until then the divergence layer
names the `clock-vs-price` state in the UI rather than hiding it.

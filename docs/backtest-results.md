# Backtest Results

This document provides guidelines for interpreting backtest results and expected performance characteristics of the Dynamic DCA + Swing Trading strategy.

## Performance Expectations

### Expected Behavior by Market Phase

| Market Phase | Risk Level | DCA Behavior | Swing Behavior |
|--------------|------------|--------------|----------------|
| Bear Market Bottom | 0.10-0.30 | Maximum buys (3× base) | Potential re-risk |
| Early Recovery | 0.20-0.40 | Strong buys (2-2.5×) | No action |
| Bull Market | 0.40-0.60 | Normal buys (1.5-2×) | Monitor |
| Euphoria | 0.60-0.80 | Reduced/skipped | De-risk triggers |
| Cycle Top | 0.80-1.00 | Skipped | Active de-risking |

### Typical Performance Characteristics

**Advantages over Pure DCA:**
- Accumulates more BTC during low-risk periods (bear markets)
- Avoids buying near cycle tops
- Takes profits during euphoric phases
- Better risk-adjusted returns

**Advantages over Buy & Hold:**
- Lower maximum drawdown
- More tax-efficient (realizes gains gradually)
- Doesn't require perfect timing

**Trade-offs:**
- More complex than simple DCA
- Requires active monitoring
- May underperform in relentless bull markets
- Tax events from selling

## Interpreting Results

### After-Tax CAGR

The primary metric for comparison. Finnish tax rates:
- 30% on capital gains up to €30,000/year
- 34% on gains above €30,000/year

Example interpretation:
```
Pre-tax CAGR: 45%
After-tax CAGR: 38%
Tax Efficiency: 84% (38/45)
```

### Maximum Drawdown

Lower is better. Compare against:
- BTC buy & hold: ~80% (2017-2018, 2021-2022)
- S&P 500: ~35% (2020 COVID crash)

Strategy should have lower drawdown than pure buy & hold due to de-risking.

### Sharpe Ratio

Risk-adjusted return. Interpretation:
- < 0: Losing money on average
- 0-0.5: Poor risk-adjusted returns
- 0.5-1.0: Acceptable
- 1.0-2.0: Good
- > 2.0: Excellent (rare for crypto)

### Walk-Forward Degradation

Measures how much worse out-of-sample performance is vs in-sample.

Interpretation:
- < 20%: Excellent (likely not overfit)
- 20-30%: Good
- 30-50%: Acceptable
- > 50%: Possible overfitting

## Sample Backtest Scenarios

### Scenario 1: Full Cycle (2018-2024)

**Configuration:**
- Start: 2018-01-01
- End: 2024-10-01
- Initial Cash: €10,000
- DCA: €100/week, 3× max multiplier

**Expected Results:**
| Strategy | After-Tax CAGR | Max DD |
|----------|----------------|--------|
| Dynamic DCA + Swing | ~35-50% | ~40-55% |
| Pure DCA | ~25-40% | ~50-65% |
| Buy & Hold (from start) | ~20-35% | ~70-80% |

### Scenario 2: Bear Market Start (2022-2024)

**Configuration:**
- Start: 2022-01-01
- End: 2024-10-01
- Initial Cash: €10,000

**Expected Results:**
| Strategy | After-Tax CAGR | Max DD |
|----------|----------------|--------|
| Dynamic DCA + Swing | ~40-60% | ~30-40% |
| Pure DCA | ~30-50% | ~40-50% |
| Buy & Hold | ~25-45% | ~50-60% |

### Scenario 3: Bull Market Only (2020-2021)

**Configuration:**
- Start: 2020-01-01
- End: 2021-12-31
- Initial Cash: €10,000

**Expected Results:**

The strategy may slightly underperform buy & hold during pure bull markets because:
1. DCA buys are smaller as risk increases
2. De-risking sells before the absolute top

However, it protects against the subsequent crash.

## Sensitivity Analysis Insights

### DCA Max Multiplier

Typical findings:
- 2.5-3.5× usually optimal
- Too low (< 2×): Doesn't capitalize enough on lows
- Too high (> 4×): Over-concentrates at specific times

### De-risk Threshold

Typical findings:
- 0.70-0.80 usually optimal
- Too low (< 0.65): Sells too early, misses gains
- Too high (> 0.85): Doesn't protect enough

### Consecutive Days Trigger

Typical findings:
- 3-5 days usually optimal
- Too few (1-2): False signals, over-trading
- Too many (7+): Reacts too slowly

### Cooldown Period

Typical findings:
- 14-21 days usually optimal
- Too short (< 7): Over-trading, transaction costs
- Too long (> 30): Misses secondary tops

## Common Pitfalls

### 1. Overfitting to Past Data

**Symptom:** In-sample CAGR much higher than out-of-sample

**Solution:** Use walk-forward validation, conservative parameters

### 2. Insufficient Cash for DCA

**Symptom:** Strategy runs out of cash before bear market ends

**Solution:** Ensure enough initial capital for extended DCA periods

### 3. Tax Budget Constraints

**Symptom:** Strategy can't de-risk due to tax budget

**Solution:** Set appropriate annual tax budget or accept higher taxes

### 4. Ignoring Transaction Costs

**Symptom:** Backtest looks great but real trading loses money

**Solution:** Include realistic fees (0.1-0.2%) and slippage (0.05%)

## Validation Checklist

Before trusting backtest results:

- [ ] Walk-forward validation shows < 30% degradation
- [ ] Parameter sensitivity shows stable returns across ranges
- [ ] Strategy outperforms benchmarks after tax
- [ ] Results make logical sense (buys at low risk, sells at high)
- [ ] Sufficient data (multiple years, multiple cycles)
- [ ] Transaction costs are realistic
- [ ] Tax calculations match expected Finnish rates

## Export and Reporting

### Trade Export (CSV)

The UI exports trades with columns:
- Date, Type, BTC Amount, Price, Total EUR
- Realized Gain, Cost Basis, Holding Days
- Risk at Trade, Reason

### Tax Report (JSON)

The UI exports yearly tax summaries:
- Year, Total Gains, Total Losses
- Net Gain, Number of Sales
- Estimated Tax, After-Tax Gain

Use these for tax filing reference (consult Verohallinto for official guidance).

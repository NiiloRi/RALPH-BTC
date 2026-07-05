# Dynamic DCA + Swing Trading Strategy

## Overview

This strategy combines **risk-based dynamic DCA** (Dollar Cost Averaging) with **swing trading de-risking** to optimize Bitcoin accumulation and profit-taking based on the RALPH risk metric.

Key features:
- **Dynamic DCA**: Buy amounts scale inversely with risk (buy more at low risk, less at high risk)
- **Swing Trading**: Automatically de-risk when risk is high for consecutive days
- **FIFO Tax Tracking**: Finnish-compliant capital gains tax calculations
- **Walk-Forward Validation**: Ensures strategy is robust across time periods

## Strategy Components

### 1. Dynamic DCA

Instead of fixed periodic purchases, the DCA amount is scaled by a risk-based multiplier:

```
DCA Amount = Base Amount × Multiplier(risk)
```

Where:
```
Multiplier = maxMultiplier - (maxMultiplier - minMultiplier) × risk^exponent
```

**Default parameters:**
| Parameter | Value | Description |
|-----------|-------|-------------|
| Base Amount | €100 | Base DCA amount per interval |
| Max Multiplier | 3.0 | Multiplier at risk=0 (3× base) |
| Min Multiplier | 0.0 | Multiplier at risk=1 (skip) |
| Exponent | 1.5 | Curve shape (>1 = more conservative) |
| Skip Above Risk | 0.70 | No DCA when risk exceeds this |
| Interval | Weekly | DCA frequency |

**Example amounts at different risk levels:**
| Risk Level | Multiplier | Amount |
|------------|------------|--------|
| 0.00 | 3.00× | €300 |
| 0.20 | 2.73× | €273 |
| 0.40 | 2.24× | €224 |
| 0.50 | 1.94× | €194 |
| 0.60 | 1.61× | €161 |
| 0.70+ | 0.00× | €0 (skipped) |

### 2. Swing Trading

The swing trading component triggers de-risking (selling) when risk remains elevated for multiple consecutive days.

**De-risk triggers:**
- Risk above threshold (default 75%) for N consecutive days (default 3)
- Sells a percentage of BTC holdings (default 10%)
- Subject to monthly cap (default 30% max per month)
- Cooldown period after each trigger (default 14 days)

**Re-risk triggers (optional):**
- Risk below threshold (default 30%) for M consecutive days (default 5)
- Uses a percentage of cash to buy back (default 20%)
- Only triggers if there was a previous de-risk

### 3. Risk Zones

| Zone | Risk Range | DCA Behavior | Swing Behavior |
|------|------------|--------------|----------------|
| Extreme Buy | 0.00-0.10 | 3× base | No sells |
| Strong Buy | 0.10-0.25 | 2.5-2.7× | No sells |
| Buy | 0.25-0.40 | 2-2.5× | No sells |
| Neutral | 0.40-0.60 | 1.5-2× | Monitor |
| Cautious | 0.60-0.75 | 0.5-1.5× | Monitor |
| Sell | 0.75-0.85 | Skip DCA | May de-risk |
| Strong Sell | 0.85-1.00 | Skip DCA | De-risk likely |

## Configuration

### Full Configuration Object

```typescript
const config: DCASwingConfig = {
  // Date range
  startDate: '2018-01-01',
  endDate: '2024-10-01',  // Optional

  // Initial portfolio
  initialCashEUR: 10000,
  initialBTC: 0,

  // Trading costs
  feePercent: 0.10,      // 0.1%
  slippagePercent: 0.05, // 0.05%

  // Dynamic DCA
  dca: {
    baseAmount: 100,
    interval: 'weekly',
    maxMultiplier: 3.0,
    minMultiplier: 0.0,
    exponent: 1.5,
    skipAboveRisk: 0.70,
  },

  // Swing Trading
  swing: {
    enabled: true,
    consecutiveDaysToTrigger: 3,
    deriskThreshold: 0.75,
    deriskPercent: 0.10,
    maxDeriskPerMonth: 0.30,
    cooldownDays: 14,
    reriskEnabled: true,
    reriskThreshold: 0.30,
    reriskConsecutiveDays: 5,
    reriskPercent: 0.20,
  },

  // Tax Configuration
  tax: {
    annualTaxBudget: undefined,  // No limit
    taxRateBelow30k: 0.30,       // 30% up to €30k
    taxRateAbove30k: 0.34,       // 34% above €30k
    enableLossHarvesting: true,
  },

  // Zone thresholds
  zones: {
    extremeBuy: 0.10,
    strongBuy: 0.25,
    buy: 0.40,
    neutral: 0.60,
    cautious: 0.75,
    sell: 0.85,
  },

  minTradeSize: 20,
};
```

## Benchmarks

The strategy is compared against:

### 1. Buy & Hold
- Buys all BTC at start date
- Holds until end date
- Represents "perfect market timing" if bought at bottom

### 2. Pure DCA
- Fixed amount at fixed interval
- No risk-based adjustments
- Represents traditional DCA approach

### 3. Buy at 2017 Bottom (Special)
- Buys all BTC at December 2018 cycle low
- Best possible outcome (hindsight benchmark)

## Metrics

### Performance Metrics
| Metric | Description |
|--------|-------------|
| Total Return | (Final - Initial) / Initial × 100% |
| CAGR | Compound Annual Growth Rate |
| After-Tax CAGR | CAGR after Finnish capital gains tax |
| Max Drawdown | Largest peak-to-trough decline |
| Sharpe Ratio | Risk-adjusted return (excess return / volatility) |
| Sortino Ratio | Downside risk-adjusted return |
| Calmar Ratio | CAGR / Max Drawdown |
| Win Rate | % of profitable sells |

### Tax Metrics
| Metric | Description |
|--------|-------------|
| Total Realized Gains | Sum of profitable sales |
| Total Realized Losses | Sum of loss-making sales |
| Net Realized P/L | Gains - Losses |
| Total Tax Paid | Finnish capital gains tax |
| Tax Efficiency | After-tax return / Pre-tax return |

## Validation

### Walk-Forward Validation

The strategy uses walk-forward validation to ensure robustness:

1. **In-Sample (Training)**: Optimize on historical data
2. **Out-of-Sample (Testing)**: Test on unseen future data
3. **Multiple Folds**: Repeat across different time periods

A robust strategy should retain at least 70% of in-sample performance when tested out-of-sample.

### Parameter Sensitivity

The UI includes sensitivity analysis for key parameters:
- DCA max multiplier
- DCA exponent
- Skip threshold
- De-risk threshold
- Consecutive days trigger
- Cooldown period

Optimal parameters may vary based on market conditions.

## Usage

### Web UI

Navigate to `/strategy-dca-swing` to:
1. Configure strategy parameters
2. Run backtests
3. Compare against benchmarks
4. View walk-forward validation
5. Analyze parameter sensitivity
6. Export trade history and tax reports

### Programmatic Usage

```typescript
import {
  runDCASwingComparison,
  runWalkForwardValidation,
  DEFAULT_DCA_SWING_CONFIG,
} from '@/lib/strategy-dca-swing';
import { RiskDataPoint } from '@/lib/risk-metric-contract';

// Load risk data
const riskData: RiskDataPoint[] = await fetchRiskData();

// Run comparison
const config = {
  ...DEFAULT_DCA_SWING_CONFIG,
  startDate: '2018-01-01',
  initialCashEUR: 10000,
};

const { strategy, benchmarks, summary } = runDCASwingComparison(riskData, config);

console.log('Strategy After-Tax CAGR:', strategy.taxMetrics.afterTaxCAGR);
console.log('Outperforms Benchmarks:', summary.strategyWins);

// Run validation
const validation = runWalkForwardValidation(riskData, config, 4);
console.log('Is Robust:', validation.isRobust);
```

## Important Notes

1. **Past performance does not guarantee future results**
2. **Tax calculations are estimates** - consult Verohallinto for official guidance
3. **The strategy requires sufficient starting capital** for weekly DCA over years
4. **Walk-forward validation helps detect overfitting** but isn't foolproof
5. **Real trading involves additional costs** (spread, slippage, tax filing)

## Files

| File | Description |
|------|-------------|
| `src/lib/strategy-dca-swing/types.ts` | Type definitions |
| `src/lib/strategy-dca-swing/dca-engine.ts` | DCA multiplier calculations |
| `src/lib/strategy-dca-swing/swing-engine.ts` | Swing trading logic |
| `src/lib/strategy-dca-swing/fifo-ledger.ts` | FIFO tax tracking |
| `src/lib/strategy-dca-swing/backtest.ts` | Backtest runner |
| `src/lib/strategy-dca-swing/validation.ts` | Walk-forward validation |
| `src/app/strategy-dca-swing/page.tsx` | Web UI |

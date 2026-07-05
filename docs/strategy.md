# RALPH Investment Strategy Module

## Overview

The RALPH Strategy module provides a **tax-aware investment strategy** that consumes the risk metric and generates actionable signals for BTC allocation decisions. It is designed specifically for Finnish individual investors using FIFO (First In, First Out) cost basis accounting.

## Key Features

- **Risk-based allocation**: Automatically adjusts target BTC allocation based on the risk metric
- **Hysteresis**: Prevents excessive regime switching by requiring risk to stay in a zone for N days
- **Tax budget management**: Optional annual capital gains limit to control tax liability
- **Loss harvesting**: Opportunistic selling at losses when de-risking is needed
- **FIFO accounting**: Full lot tracking with realized gain/loss calculations
- **Backtesting**: Compare strategy against buy & hold and simple DCA benchmarks

## Risk Zones

The strategy divides the risk spectrum into five zones:

| Zone       | Risk Range | Target Allocation | Description                    |
|------------|------------|-------------------|--------------------------------|
| Accumulate | 0.00-0.20  | 90%               | Aggressive buying opportunity  |
| Normal     | 0.20-0.50  | 70%               | Standard DCA / hold            |
| Cautious   | 0.50-0.70  | 50%               | Reduce new purchases           |
| De-risk    | 0.70-0.85  | 30%               | Gradual profit-taking          |
| Defensive  | 0.85-1.00  | 15%               | Minimize exposure              |

## Configuration Parameters

### Strategy Parameters

| Parameter          | Default | Description                                    |
|--------------------|---------|------------------------------------------------|
| `hysteresisDays`   | 7       | Days risk must stay in zone before switching   |
| `rebalanceCadence` | weekly  | How often to rebalance (daily/weekly/monthly)  |
| `minTradeSize`     | 50 EUR  | Minimum trade size to execute                  |
| `maxTradePercent`  | 25%     | Maximum single trade as % of portfolio         |
| `annualTaxBudget`  | none    | Optional cap on realized gains per year        |
| `enableLossHarvesting` | true | Allow selling at loss for tax optimization |

### Backtest Parameters

| Parameter        | Default | Description                           |
|------------------|---------|---------------------------------------|
| `initialCashEUR` | 10,000  | Starting capital in EUR               |
| `initialBTC`     | 0       | Starting BTC quantity                 |
| `feePercent`     | 0.1%    | Trading fee percentage                |
| `slippagePercent`| 0.05%   | Estimated slippage                    |
| `dcaAmount`      | 100 EUR | Amount per DCA interval               |
| `dcaInterval`    | weekly  | DCA frequency (daily/weekly/monthly)  |
| `taxMode`        | tracked | tracked (report only) or paid (simulate) |

## Signal Logic

1. **Daily risk assessment**: Read risk metric from frozen contract
2. **Hysteresis check**: Only confirm zone change after N consecutive days
3. **Rebalance day check**: Only trade on scheduled rebalance days
4. **Allocation calculation**: Interpolate target allocation based on risk
5. **Trade decision**:
   - If current allocation < target: BUY (subject to cash constraints)
   - If current allocation > target: SELL (subject to tax budget)
   - If within 5% threshold: HOLD

## Tax Budget Logic

When `annualTaxBudget` is set:

1. Before selling, estimate realized gain from FIFO lots
2. If projected yearly gains would exceed budget:
   - In normal zones: reduce or skip trade
   - In defensive zone (>85% risk): allow exceeding budget for safety
3. Track cumulative gains per calendar year

## Loss Harvesting

When `enableLossHarvesting` is true:

- If a SELL signal occurs and the FIFO lots would result in a loss:
- Execute the sale anyway to realize the loss
- Losses can offset gains in the same tax year (per Finnish rules)

## Output Metrics

### Performance Metrics
- **Total Return**: Percentage gain/loss over the period
- **CAGR**: Compound Annual Growth Rate
- **Max Drawdown**: Largest peak-to-trough decline
- **Sharpe Proxy**: Risk-adjusted return (annualized daily returns / volatility)
- **Turnover**: Total traded value / average portfolio value

### Tax Metrics
- **Total Realized Gains**: Sum of all positive P/L
- **Total Realized Losses**: Sum of all negative P/L
- **Net Realized P/L**: Gains minus losses
- **Number of Taxable Events**: Count of SELL trades
- **Average Holding Period**: Mean days held before selling

## Export Formats

### Trades CSV
```csv
Date,Type,Quantity BTC,Price EUR,Total EUR,Fees EUR,Realized P/L EUR
2024-01-15,BUY,0.05000000,42000.00,2100.00,2.10,
2024-03-20,SELL,0.02000000,55000.00,1100.00,1.10,340.00
```

### Tax Summary JSON
```json
{
  "generatedAt": "2024-12-15T10:30:00Z",
  "disclaimer": "This is a decision-support tool...",
  "totalRealizedGains": 5000.00,
  "totalRealizedLosses": 1200.00,
  "netRealizedPL": 3800.00,
  "yearlyBreakdown": [
    {
      "year": 2024,
      "totalGains": 5000.00,
      "totalLosses": 1200.00,
      "netGain": 3800.00,
      "numberOfSales": 12,
      "avgHoldingPeriod": 180
    }
  ]
}
```

## Limitations

1. **Not real-time**: Uses end-of-day data only
2. **No order book simulation**: Assumes instant fills at daily close
3. **Simplified fees**: Flat percentage, no tiered structures
4. **No margin/leverage**: Long-only spot positions
5. **Single asset**: BTC only, no portfolio diversification
6. **Tax approximations**: Real tax rules are more complex

## Disclaimer

**This is a decision-support tool, not financial or tax advice.**

- Consult a qualified tax advisor for your specific situation
- Past performance does not guarantee future results
- The risk metric is a model that may not predict actual market conditions
- For Finnish tax guidance, see [Verohallinto](https://www.vero.fi/henkiloasiakkaat/omaisuus/virtuaalivaluutat/)

## Usage

### UI
Navigate to `/strategy` to access the backtest interface.

### Programmatic
```typescript
import { runBacktest, DEFAULT_BACKTEST_CONFIG } from '@/lib/strategy';
import { RiskDataPoint } from '@/lib/risk-metric-contract';

const data: RiskDataPoint[] = [...]; // Load from API or file
const config = {
  ...DEFAULT_BACKTEST_CONFIG,
  startDate: '2020-01-01',
  initialCashEUR: 50000,
};

const result = runBacktest(data, config);
console.log(result.metrics);
console.log(result.taxSummary);
```

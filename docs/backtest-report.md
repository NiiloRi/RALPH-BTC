# BTC Risk Metric Backtest Report

Generated: 2026-01-19T19:02:53.130Z

Data Range: 2018-03-05 to 2026-01-18

## Aggregate Metrics

| Metric | Value |
|--------|-------|
| Avg Risk-Drawdown Corr (30d) | 0.0362 |
| Avg Risk-Drawdown Corr (90d) | 0.3571 |
| Avg Risk-Drawdown Corr (180d) | 0.6494 |
| Avg Top Precision | 1.2% |
| Avg Top Recall | 66.7% |
| Avg Calibration Error | 0.1980 |

## Final Model Weights

| Component | Weight |
|-----------|--------|
| valuation | 30.0% |
| momentum | 10.0% |
| volatility | 15.0% |
| cycle | 25.0% |
| macro | 5.0% |
| attention | 15.0% |

## Fold Details

### Fold 1

- Train: 2018-03-05 to 2023-01-19
- Test: 2023-01-20 to 2024-01-19
- Risk-Drawdown Corr (90d): 0.5218
- Top Precision: 0.8%
- Top Recall: 100.0%
- Calibration Error: 0.2258

### Fold 2

- Train: 2018-03-05 to 2024-01-19
- Test: 2024-01-20 to 2025-01-18
- Risk-Drawdown Corr (90d): 0.3718
- Top Precision: 0.0%
- Top Recall: 0.0%
- Calibration Error: 0.2008

### Fold 3

- Train: 2018-03-05 to 2025-01-18
- Test: 2025-01-19 to 2026-01-18
- Risk-Drawdown Corr (90d): 0.1777
- Top Precision: 2.7%
- Top Recall: 100.0%
- Calibration Error: 0.1674

## Interpretation

- **Risk-Drawdown Correlation**: Higher is better. Indicates how well high risk scores predict future drawdowns.
- **Top Precision**: % of high-risk signals that occurred near actual tops.
- **Top Recall**: % of actual tops that were flagged by high risk.
- **Calibration Error**: Lower is better. Measures alignment between risk levels and actual outcomes.

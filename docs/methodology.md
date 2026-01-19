# BTC Risk Metric Methodology

## Overview

This document describes the methodology behind the Bitcoin risk metric, a cycle-aware indicator designed to estimate the probability of being at an elevated risk level in BTC markets.

## Data Sources

### Free / Included (Base Model)
- **BTC Price**: Daily OHLCV data from CoinGecko API or local CSV
- **Derived On-Chain Proxies**: MVRV-like and NUPL-like indicators computed from price/MA relationships

### Optional Premium Feeds
- **DXY (US Dollar Index)**: Via FRED API (requires free API key)
- **Google Trends**: Search interest for "bitcoin"
- **Fear & Greed Index**: Alternative.me API

The model is designed with a layered architecture so the base model works fully with free data, while optional premium feeds can enhance accuracy.

## Feature Definitions

### 1. Valuation Score (0-1)
Measures price relative to long-term fair value estimates.

**Components:**
- **MVRV Proxy**: `price / SMA200` - Historically, values > 2.4 indicate overvaluation
- **Pi Cycle Ratio**: `price / (SMA350 * 1.11)` - Based on Pi Cycle top indicator
- **Power Law Deviation**: `ln(price) - (5.82 * ln(days_since_genesis) - 41)` - Deviation from long-term power law
- **Mayer Multiple**: `price / SMA200` - Classic overvaluation indicator
- **Drawdown from ATH**: `(ATH - price) / ATH` - Inverted so low drawdown = high risk
- **Days Since ATH**: Proximity to all-time high

**Mathematical Intuition:** Higher valuation scores indicate price is extended above historical fair value estimates.

### 2. Momentum Score (0-1)
Measures price momentum and trend strength.

**Components:**
- **RSI (14-day)**: `100 - 100 / (1 + RS)` where RS = avg_gain / avg_loss
- **Rate of Change**: 7d, 30d, 90d percentage returns
- **Distance from 200MA**: `(price - SMA200) / SMA200 * 100`
- **MA Alignment**: Whether price > SMA50 > SMA200 (bullish structure)
- **Trend Strength**: Simplified ADX using directional movement

**Mathematical Intuition:** High momentum = overextended price action = higher risk.

### 3. Volatility Score (0-1)
Measures market stability and fragility.

**Components:**
- **Realized Volatility (30d)**: `std(ln(price_t / price_{t-1})) * sqrt(365)`
- **Vol Percentile**: Current vol rank in historical distribution
- **Vol Z-Score**: `(vol - mean_vol) / std_vol`
- **Max Drawdown (30d, 90d)**: Peak-to-trough decline
- **Fragility Index**: Combination of drawdown, volatility, and large moves

**Mathematical Intuition:** Extreme volatility (high or low) often precedes regime changes.

### 4. Cycle Score (0-1)
Models the 4-year halving cycle with adjustments.

**Key Features:**
- **Days Since Halving**: Primary cycle position indicator
- **Cycle Phase**: early (0-33%), mid (33-66%), late (66-100%)
- **Estimated Cycle Length**: Learned from historical peak-to-peak durations
- **Lengthening Cycles**: Each cycle is ~15% longer than previous
- **Diminishing Returns**: Each cycle's peak return is ~30-50% of previous

**Halving Dates:**
- 2012-11-28 (Block 210,000)
- 2016-07-09 (Block 420,000)
- 2020-05-11 (Block 630,000)
- 2024-04-19 (Block 840,000)

**Mathematical Intuition:** Risk increases as we progress through the cycle, especially after ~400-550 days post-halving.

### 5. Macro Score (0-1)
Measures broader market risk-on/risk-off conditions.

**Components:**
- **DXY Z-Score**: Weak dollar (negative z) = risk-on = higher BTC risk
- **Liquidity Proxy**: Price percentile * inverse volatility
- **BTC Sentiment**: Based on 90-day returns

**Mathematical Intuition:** Risk-on macro environment = extended BTC prices = higher risk.

### 6. Attention Score (0-1)
Measures retail interest and sentiment.

**Components:**
- **Google Trends Proxy**: Strong returns + ATH proximity + vol spikes
- **Fear & Greed Proxy**: Momentum + volatility + MA position + drawdown

**Mathematical Intuition:** High retail attention typically coincides with cycle tops.

## Risk Aggregation

### Weighted Ensemble
```
raw_risk = Σ(weight_i * score_i) / Σ(weight_i)
```

**Default Weights:**
| Component | Weight |
|-----------|--------|
| Valuation | 25% |
| Momentum | 15% |
| Volatility | 15% |
| Cycle | 20% |
| Macro | 10% |
| Attention | 15% |

### Calibration
```
calibrated_risk = sigmoid(slope * (raw_risk - center))
```

The calibration layer maps raw ensemble output to probability-like values using sigmoid transformation with parameters learned from walk-forward optimization.

### Smoothing
```
smoothed_risk = α * current_risk + (1-α) * previous_risk
```

EMA smoothing (α = 0.3) reduces noise while preserving meaningful signals.

## Backtest Methodology

### Walk-Forward Validation
- **No Hindsight Leakage**: All features computed using only data available at time t
- **Rolling Training**: Train on data up to cut date, test on next period
- **3+ Folds**: Multiple validation windows for robust assessment

### Evaluation Metrics
1. **Risk-Drawdown Correlation**: Does high risk predict future drawdowns?
2. **Top Detection Precision/Recall**: Does high risk flag actual market tops?
3. **Calibration Error**: Do risk levels match actual outcome distributions?

### Top Detection
Tops are detected operationally using:
- Local maxima over ±60 day window
- Followed by >20% drawdown
- Confirmation window excluded from training to prevent leakage

## Leakage Avoidance

Critical measures to prevent future data leakage:

1. **Feature Computation**: All features use `data[0:t]` only
2. **Target Definition**: Future drawdowns computed only in training folds
3. **Walk-Forward**: Strict train/test separation by time
4. **Cycle Estimation**: Uses only past peak dates for cycle length estimation
5. **Calibration**: Fitted on training data only

## Limitations

1. **Model Risk**: Past patterns may not repeat exactly
2. **Data Quality**: Dependent on accurate price data
3. **Extrapolation**: Less reliable for prices far outside historical range
4. **Black Swan Events**: Cannot predict unprecedented events
5. **Self-Fulfilling**: Widespread use could affect market behavior

## Extending with Premium Feeds

To add premium data sources:

1. Create new data fetcher in `src/lib/data/`
2. Add fields to `DailyData` type in `src/lib/types.ts`
3. Update normalizer to merge new data
4. Create feature calculator in `src/lib/features/`
5. Add component to risk model
6. Re-run backtest to validate improvement

## References

- Bitcoin Halving Cycle Analysis
- MVRV Ratio (Murad Mahmudov, David Puell)
- Pi Cycle Top Indicator (Philip Swift)
- Mayer Multiple (Trace Mayer)
- Stock-to-Flow Model (PlanB)

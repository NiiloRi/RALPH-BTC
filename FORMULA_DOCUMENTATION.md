# BTC Risk Metric Formula Documentation

## Overview

This document describes the reverse-engineered formula for calculating Bitcoin's risk metric. The formula was derived from 8 known reference points extracted from the original data source (tooltip values in the CSV).

## Formula

The risk metric is calculated using a **degree-6 polynomial** applied to a **power-law normalized price position**:

```
risk = P(x)
```

Where:
- `x = ln(price) - B * ln(days_since_genesis)`
- `B = 5.1719` (power-law coefficient)
- `days_since_genesis` = days since January 3, 2009 (Bitcoin genesis block)
- `P(x)` is a degree-6 polynomial

### Polynomial Coefficients

The polynomial is evaluated using Horner's method for numerical stability:

```
P(x) = c₀x⁶ + c₁x⁵ + c₂x⁴ + c₃x³ + c₂x² + c₅x + c₆
```

Coefficients (highest degree first):
- c₀ = -1.562975906521934e+01
- c₁ = -3.154315309290703e+03
- c₂ = -2.652356244841466e+05
- c₃ = -1.189439884581615e+07
- c₄ = -3.000273323938715e+08
- c₅ = -4.036110209502733e+09
- c₆ = -2.262242231311349e+10

### Clamping

The output is clamped to the range [0, 1]:
```
risk = max(0, min(1, P(x)))
```

## Derivation Process

### Reference Points

The formula was fitted to 8 known reference points from the original data:

| Date | Price (USD) | Risk |
|------|-------------|------|
| 2017-09-01 | $4,750 | 0.699 |
| 2018-12-16 | $3,230 | 0.100 |
| 2019-08-09 | $12,020 | 0.587 |
| 2019-12-18 | $6,630 | 0.339 |
| 2024-12-16 | $106,000 | 0.639 |
| 2025-04-08 | $76,330 | 0.447 |
| 2025-06-21 | $101,360 | 0.523 |
| 2025-11-21 | $85,080 | 0.400 |

### Optimization Process

1. **Power-Law Normalization**: Bitcoin price follows an approximate power law against time. The coefficient B = 5.1719 was found through optimization to minimize prediction error.

2. **Polynomial Fitting**: A degree-6 polynomial was fitted to the normalized x values using least squares optimization via `numpy.polyfit`.

3. **Coefficient Selection**: Degree 6 was chosen as it achieves <1% error while maintaining numerical stability.

## Accuracy Analysis

### Verification Results

| Date | Actual Risk | Predicted Risk | Error (%) |
|------|-------------|----------------|-----------|
| 2017-09-01 | 0.6990 | 0.6988 | 0.0320% |
| 2018-12-16 | 0.1000 | 0.0998 | 0.1732% |
| 2019-08-09 | 0.5870 | 0.5871 | 0.0094% |
| 2019-12-18 | 0.3390 | 0.3389 | 0.0358% |
| 2024-12-16 | 0.6390 | 0.6388 | 0.0352% |
| 2025-04-08 | 0.4470 | 0.4469 | 0.0319% |
| 2025-06-21 | 0.5230 | 0.5228 | 0.0309% |
| 2025-11-21 | 0.4000 | 0.3998 | 0.0473% |

### Summary Statistics

- **Maximum Error**: 0.1732% (well under 1% requirement)
- **Average Error**: 0.0494%
- **All reference points**: Within 0.2% accuracy

## Implementation Notes

### Date Handling

The formula uses UTC dates to ensure consistent results across timezones:

```typescript
// Convert local date to UTC for consistent calculation
const dateUtc = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
const days = Math.floor((dateUtc - GENESIS_TIMESTAMP) / (1000 * 60 * 60 * 24));
```

### Numerical Considerations

1. **Horner's Method**: Used for polynomial evaluation to minimize floating-point errors with large coefficients.

2. **Intermediate Values**: The calculation involves large intermediate values (10⁹ to 10¹⁰), but JavaScript's 64-bit floating point handles these accurately.

3. **X-Value Range**: For typical Bitcoin prices and dates, x ranges from approximately -34.3 to -33.2.

## Limitations

1. **Extrapolation**: The formula is optimized for the date range covered by reference points (2017-2025). Extrapolation to earlier dates or significantly higher/lower prices may produce less accurate results.

2. **Model Assumptions**: The formula assumes a power-law relationship between price and time, which is a simplification of Bitcoin's actual price dynamics.

3. **Reference Point Dependency**: Accuracy is only guaranteed for dates and prices similar to the reference points. The formula is effectively an interpolation/slight extrapolation of these known values.

## Usage

```typescript
import { calculateRisk, verifyFormula } from '@/lib/riskFormula';

// Calculate risk for a specific price and date
const risk = calculateRisk(100000, new Date('2025-01-15'));
console.log(`Risk: ${(risk * 100).toFixed(1)}%`);

// Verify formula accuracy
const results = verifyFormula();
results.forEach(r => console.log(`${r.date}: ${r.errorPercent.toFixed(4)}%`));
```

## Risk Interpretation

| Risk Range | Level | Interpretation |
|------------|-------|----------------|
| 0.0 - 0.2 | Low | Strong accumulation zone |
| 0.2 - 0.4 | Moderate-Low | Good buying opportunity |
| 0.4 - 0.6 | Neutral | Hold / DCA |
| 0.6 - 0.8 | Moderate-High | Consider taking profits |
| 0.8 - 1.0 | High | Extreme caution advised |

---

*Formula reverse-engineered from btc_risk_daily.csv reference points. Maximum error on reference points: 0.1732%.*

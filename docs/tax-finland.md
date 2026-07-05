# Finnish Cryptocurrency Tax Guide for RALPH Users

## Disclaimer

**This document is for educational purposes only and does not constitute tax or legal advice.**

For official guidance on cryptocurrency taxation in Finland, please consult:
- [Verohallinto: Virtuaalivaluutat](https://www.vero.fi/henkiloasiakkaat/omaisuus/virtuaalivaluutat/)
- [Syventävä vero-ohje: Virtuaalivaluuttojen verotus](https://www.vero.fi/syventavat-vero-ohjeet/ohje-hakusivu/48411/virtuaalivaluuttojen-verotus3/)
- A qualified tax advisor

## Overview

In Finland, cryptocurrency is treated as property (omaisuus) and gains from selling are taxable as capital income (pääomatulo). The RALPH strategy module implements FIFO accounting to help track cost basis for tax purposes.

## Key Tax Concepts

### FIFO (First In, First Out)

When you sell cryptocurrency, the **oldest acquired units** are considered sold first. This is the standard method required by Finnish Tax Administration.

**Example:**
```
Buy 1: 0.5 BTC @ €30,000 (Jan 2023)
Buy 2: 0.3 BTC @ €40,000 (Jun 2023)
Sell:  0.4 BTC @ €50,000 (Dec 2023)

FIFO calculation:
- First 0.4 BTC comes from Buy 1
- Cost basis: 0.4 × €30,000 = €12,000
- Sale proceeds: 0.4 × €50,000 = €20,000
- Taxable gain: €20,000 - €12,000 = €8,000
```

### Hankintameno-olettama (Deemed Acquisition Cost)

If you **cannot prove** the actual acquisition cost (e.g., lost records), you may use a deemed acquisition cost:

- **Holdings < 10 years**: 20% of sale price
- **Holdings ≥ 10 years**: 40% of sale price

**Important notes:**
- This is an alternative when actual costs are unknown
- You should use FIFO with actual costs when records are available
- The deemed cost method may be more favorable in some cases
- Consult Verohallinto for current rules as they may change

**Example (using deemed cost):**
```
Sell: 1 BTC @ €50,000 (held for 5 years, no purchase records)
Deemed cost (20%): €50,000 × 0.20 = €10,000
Taxable gain: €50,000 - €10,000 = €40,000
```

### Capital Gains Tax Rates

As of 2024 (verify current rates with Verohallinto):

| Capital Income | Tax Rate |
|----------------|----------|
| Up to €30,000  | 30%      |
| Over €30,000   | 34%      |

### Loss Deduction

- Capital losses can be **deducted from capital gains** in the same tax year
- Unused losses can be carried forward for **5 years**
- Losses cannot be deducted from earned income (ansiotulo)

## RALPH Strategy Tax Features

### FIFO Lot Tracking

The strategy module maintains a ledger of all BTC acquisitions:

```typescript
interface FIFOLot {
  acquisitionDate: string;  // When purchased
  quantity: number;         // BTC amount
  unitCost: number;         // EUR per BTC
  totalCost: number;        // Including fees
  remainingQuantity: number; // After partial sales
}
```

When selling, lots are consumed oldest-first automatically.

### Annual Tax Budget

Set `annualTaxBudget` to limit realized gains per calendar year:

```typescript
const config = {
  strategy: {
    annualTaxBudget: 10000, // Max €10,000 gains per year
  }
};
```

The strategy will reduce or skip trades that would exceed this budget, except in defensive (high risk) zones where capital preservation takes priority.

### Loss Harvesting

When `enableLossHarvesting` is true:

- The strategy may sell at a loss to realize tax-deductible losses
- This is only done when de-risking is already indicated by the risk metric
- Losses can offset gains, reducing overall tax liability

### Tax Reporting Export

Export a JSON summary for your records:

```json
{
  "yearlyBreakdown": [
    {
      "year": 2024,
      "totalGains": 15000.00,
      "totalLosses": 3000.00,
      "netGain": 12000.00,
      "numberOfSales": 8,
      "avgHoldingPeriod": 245
    }
  ]
}
```

## Reporting to Verohallinto

### What to Report

1. **Total capital gains** from cryptocurrency sales
2. **Total capital losses** (for deduction)
3. **Individual transactions** if requested

### OmaVero

Use the [OmaVero](https://www.vero.fi/omavero/) service to report:
- Navigate to "Pääomatulot" (Capital income)
- Report cryptocurrency gains under "Luovutusvoitot" (Capital gains)

### Documentation to Keep

- Purchase records (date, amount, price, fees)
- Sale records (date, amount, price, fees)
- Exchange/wallet statements
- Bank transfers related to crypto

Keep records for at least **6 years** after the tax year.

## Limitations of RALPH Tax Calculations

1. **Simplified model**: Real tax rules have nuances not captured
2. **No mining/staking**: Only covers trading gains
3. **No crypto-to-crypto**: Assumes EUR pairs only
4. **No DeFi**: Complex transactions not modeled
5. **Rates may change**: Tax rates and rules evolve

## Useful Resources

- [Verohallinto: Virtuaalivaluutat](https://www.vero.fi/henkiloasiakkaat/omaisuus/virtuaalivaluutat/)
- [Verohallinto: Pääomatulot](https://www.vero.fi/henkiloasiakkaat/verokortti-ja-veroilmoitus/tulot/paaomatulot/)
- [Finnish Tax Calculator for Crypto](https://www.vero.fi/henkiloasiakkaat/omaisuus/virtuaalivaluutat/virtuaalivaluuttalaskuri/)

## Contact Verohallinto

For official guidance:
- **Phone**: 029 497 000
- **Website**: [vero.fi](https://www.vero.fi)
- **OmaVero**: [omavero.fi](https://www.vero.fi/omavero/)

---

**Remember: This tool is for planning and decision support only. Always verify with official sources and consider consulting a tax professional for your specific situation.**

# How to Run

## Prerequisites

- Node.js 18+
- npm or yarn

## Setup

1. **Clone the repository**
   ```bash
   git clone <repo-url>
   cd btc-risk-metric
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Optional: Configure environment variables**
   Create `.env.local` for optional premium data:
   ```bash
   # Optional: FRED API for DXY data
   FRED_API_KEY=your_api_key_here
   ```

## Running the Pipeline

### Quick Start (Use Existing Data)
If the `public/btc_risk_binance.csv` file exists, you can skip data fetching:

```bash
# Build features from existing data
npm run build:features

# Train the model
npm run train:model

# Run backtest
npm run backtest

# Export for UI
npm run export:ui

# Start the app
npm run dev
```

Then open http://localhost:3000

### Full Pipeline

Run all steps in sequence:
```bash
npm run pipeline
```

Or run individual steps:

```bash
# Step 1: Fetch price data (or use existing)
npm run fetch:data

# Step 2: Build features
npm run build:features

# Step 3: Train and calibrate model
npm run train:model

# Step 4: Run walk-forward backtest
npm run backtest

# Step 5: Export processed data for UI
npm run export:ui
```

## Running Tests

```bash
# Run all tests
npm run test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage report
npm run test:coverage
```

## Development

```bash
# Start development server
npm run dev

# Build for production
npm run build

# Start production server
npm run start

# Run linter
npm run lint

# Run type checker
npm run typecheck
```

## Project Structure

```
btc-risk-metric/
├── src/
│   ├── app/              # Next.js pages
│   │   ├── page.tsx      # Main page
│   │   └── dashboard/    # Dashboard page
│   ├── components/       # React components
│   │   └── RiskDashboard.tsx
│   └── lib/
│       ├── types.ts      # Type definitions
│       ├── data/         # Data fetching & normalization
│       ├── features/     # Feature engineering
│       ├── risk/         # Risk model & calibration
│       └── backtest/     # Walk-forward backtesting
├── scripts/              # CLI pipeline scripts
├── data/
│   ├── raw/             # Raw fetched data
│   └── processed/       # Processed features & model
├── public/              # Static files & UI data
└── docs/                # Documentation
```

## Output Files

After running the pipeline:

| File | Location | Description |
|------|----------|-------------|
| `btc_price_daily.csv` | `data/raw/` | Raw price data |
| `features.json` | `data/processed/` | Feature vectors |
| `daily_data.json` | `data/processed/` | Daily data with calculations |
| `model.json` | `data/processed/` | Trained model parameters |
| `backtest_results.json` | `data/processed/` | Backtest metrics |
| `risk_data.json` | `public/` | UI-ready risk data |
| `backtest-report.md` | `docs/` | Backtest report |

## Troubleshooting

### "No price data found"
Run `npm run fetch:data` first, or ensure `public/btc_risk_binance.csv` exists.

### "Features not found"
Run `npm run build:features` before training or exporting.

### Tests failing
Ensure you have the latest dependencies: `npm install`

### Build errors
Clear Next.js cache: `rm -rf .next && npm run build`

## Customization

### Adjusting Model Weights
Edit `src/lib/risk/model.ts`:
```typescript
export const DEFAULT_WEIGHTS = {
  valuation: 0.25,
  momentum: 0.15,
  volatility: 0.15,
  cycle: 0.2,
  macro: 0.1,
  attention: 0.15,
};
```

### Changing Smoothing
Edit `scripts/export-for-ui.ts` or pass custom smoothing to `calculateAllRisks()`.

### Adding New Features
1. Create feature calculator in `src/lib/features/`
2. Add to `buildFeatureVector()` in `src/lib/features/index.ts`
3. Add to risk model aggregation
4. Write tests
5. Re-run backtest to validate

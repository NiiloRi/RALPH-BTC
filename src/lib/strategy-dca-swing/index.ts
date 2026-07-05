/**
 * Dynamic DCA + Swing Trading Strategy Module
 *
 * Exports all strategy components.
 */

// Types
export * from './types';

// DCA Engine
export {
  calculateDCAMultiplier,
  calculateDCAAmount,
  shouldPerformDCA,
  getDCAIntervalDays,
  getDCAZoneDescription,
  getDCARiskCurve,
  estimateTotalDCAInvestment,
} from './dca-engine';

// Swing Engine
export {
  createSwingState,
  getSwingRiskZone,
  getSwingZoneColor,
  getSwingZoneDescription,
  updateSwingState,
  calculateSwingTradeSize,
  getSwingSummary,
  type SwingState,
  type SwingDecision,
} from './swing-engine';

// FIFO Ledger
export { DCASwingFIFOLedger } from './fifo-ledger';

// Backtest
export {
  runDCASwingBacktest,
  runBuyAndHoldBenchmark,
  runPureDCABenchmark,
  runDCASwingComparison,
  find2017BottomDate,
  runBottomBuyBenchmark,
} from './backtest';

// Validation
export {
  createWalkForwardFolds,
  runWalkForwardValidation,
  runParameterSensitivity,
  runFullSensitivityAnalysis,
  generateSensitivityReport,
  generateWalkForwardReport,
} from './validation';

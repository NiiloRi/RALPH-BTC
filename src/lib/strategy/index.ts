/**
 * Strategy Module
 *
 * Tax-aware investment strategy that consumes the risk metric.
 * The risk metric is treated as a frozen dependency - see risk-metric-contract.
 */

// Types
export * from './types';

// Risk zones
export {
  getRiskZone,
  getTargetAllocation,
  interpolateTargetAllocation,
  createHysteresisState,
  updateHysteresis,
  isRebalanceDay,
  getZoneDescription,
  getZoneColor,
  type HysteresisState,
} from './risk-zones';

// FIFO Ledger
export {
  FIFOLedger,
  calculateDeemedAcquisitionCost,
} from './fifo-ledger';

// Signal Generator
export {
  generateSignal,
  generateAllSignals,
} from './signal-generator';

// Backtest
export {
  runBacktest,
  runBuyAndHold,
  runSimpleDCA,
  runComparison,
} from './backtest';

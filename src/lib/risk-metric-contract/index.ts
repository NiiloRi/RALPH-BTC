/**
 * Risk Metric Contract
 *
 * Public API for consuming the risk metric as a frozen dependency.
 * Strategy modules should import from this module only.
 */

export {
  RiskComponentsSchema,
  RiskDataPointSchema,
  RiskDatasetSchema,
  validateRiskDataset,
  isValidRiskDataset,
  RISK_METRIC_CONTRACT_VERSION,
  type RiskComponents,
  type RiskDataPoint,
  type RiskDataset,
} from './schema';

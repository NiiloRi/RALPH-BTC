/**
 * Risk Metric Contract Schema
 *
 * This file defines the immutable contract for the risk metric output.
 * Any changes to this schema or the metric calculation logic should fail CI.
 *
 * DO NOT MODIFY - This is a frozen dependency for downstream consumers.
 */

import { z } from 'zod';

/**
 * Schema for risk metric components
 */
export const RiskComponentsSchema = z.object({
  valuation: z.number().min(0).max(1),
  momentum: z.number().min(0).max(1),
  volatility: z.number().min(0).max(1),
  cycle: z.number().min(0).max(1),
  macro: z.number().min(0).max(1),
  attention: z.number().min(0).max(1),
});

/**
 * Schema for a single risk data point
 */
export const RiskDataPointSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  price: z.number().positive(),
  risk: z.number().min(0).max(1),
  smoothedRisk: z.number().min(0).max(1),
  components: RiskComponentsSchema,
  cyclePhase: z.enum(['early', 'mid', 'late']),
  isHalving: z.boolean(),
});

/**
 * Schema for the complete risk dataset
 */
export const RiskDatasetSchema = z.array(RiskDataPointSchema);

/**
 * TypeScript types derived from schemas
 */
export type RiskComponents = z.infer<typeof RiskComponentsSchema>;
export type RiskDataPoint = z.infer<typeof RiskDataPointSchema>;
export type RiskDataset = z.infer<typeof RiskDatasetSchema>;

/**
 * Contract version - bump this if making breaking changes
 * (which should fail tests and require explicit approval)
 */
export const RISK_METRIC_CONTRACT_VERSION = '1.0.0';

/**
 * Validate a risk dataset against the contract schema
 */
export function validateRiskDataset(data: unknown): RiskDataset {
  return RiskDatasetSchema.parse(data);
}

/**
 * Check if data conforms to contract (returns boolean instead of throwing)
 */
export function isValidRiskDataset(data: unknown): data is RiskDataset {
  return RiskDatasetSchema.safeParse(data).success;
}

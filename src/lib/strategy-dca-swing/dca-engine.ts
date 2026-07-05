/**
 * Dynamic DCA Engine
 *
 * Calculates DCA buy amounts based on risk level.
 * Lower risk = larger buys, higher risk = smaller/no buys.
 */

import { DynamicDCAConfig, DEFAULT_DCA_SWING_CONFIG } from './types';

/**
 * Calculate DCA multiplier based on risk
 *
 * Formula: multiplier = maxMultiplier - (maxMultiplier - minMultiplier) * risk^exponent
 *
 * Examples with default config (min=0, max=3, exp=1.5):
 * - risk=0.00 → multiplier=3.00 (3x base amount)
 * - risk=0.20 → multiplier=2.73 (2.73x)
 * - risk=0.40 → multiplier=2.24 (2.24x)
 * - risk=0.50 → multiplier=1.94 (1.94x)
 * - risk=0.60 → multiplier=1.61 (1.61x)
 * - risk=0.70 → multiplier=1.24 (1.24x)
 * - risk=0.80 → multiplier=0.85 (0.85x)
 * - risk=0.90 → multiplier=0.44 (0.44x)
 * - risk=1.00 → multiplier=0.00 (no buy)
 */
export function calculateDCAMultiplier(
  risk: number,
  config: DynamicDCAConfig = DEFAULT_DCA_SWING_CONFIG.dca
): number {
  // Clamp risk to [0, 1]
  const r = Math.max(0, Math.min(1, risk));

  const { minMultiplier, maxMultiplier, exponent } = config;

  // Apply formula with exponential curve
  const multiplier = maxMultiplier - (maxMultiplier - minMultiplier) * Math.pow(r, exponent);

  return Math.max(0, multiplier);
}

/**
 * Calculate DCA amount for a given risk level
 *
 * @param risk Current risk level (0-1)
 * @param config DCA configuration
 * @returns EUR amount to buy, or 0 if skipped
 */
export function calculateDCAAmount(
  risk: number,
  config: DynamicDCAConfig = DEFAULT_DCA_SWING_CONFIG.dca
): number {
  // Skip if risk is above threshold
  if (risk >= config.skipAboveRisk) {
    return 0;
  }

  const multiplier = calculateDCAMultiplier(risk, config);
  return config.baseAmount * multiplier;
}

/**
 * Check if DCA should be performed on this date
 *
 * @param currentDate Current date
 * @param lastDCADate Last DCA date (or null if never)
 * @param interval DCA interval
 * @returns true if DCA should be performed
 */
export function shouldPerformDCA(
  currentDate: Date,
  lastDCADate: Date | null,
  interval: 'daily' | 'weekly' | 'biweekly' | 'monthly'
): boolean {
  if (!lastDCADate) return true;

  const daysDiff = Math.floor(
    (currentDate.getTime() - lastDCADate.getTime()) / (1000 * 60 * 60 * 24)
  );

  switch (interval) {
    case 'daily':
      return daysDiff >= 1;
    case 'weekly':
      return daysDiff >= 7;
    case 'biweekly':
      return daysDiff >= 14;
    case 'monthly':
      return daysDiff >= 28;
    default:
      return daysDiff >= 7;
  }
}

/**
 * Get DCA interval in days
 */
export function getDCAIntervalDays(
  interval: 'daily' | 'weekly' | 'biweekly' | 'monthly'
): number {
  switch (interval) {
    case 'daily':
      return 1;
    case 'weekly':
      return 7;
    case 'biweekly':
      return 14;
    case 'monthly':
      return 28;
    default:
      return 7;
  }
}

/**
 * Get DCA zone description for UI
 */
export function getDCAZoneDescription(risk: number, config: DynamicDCAConfig): string {
  if (risk >= config.skipAboveRisk) {
    return 'DCA skipped - risk too high';
  }

  const multiplier = calculateDCAMultiplier(risk, config);

  if (multiplier >= 2.5) {
    return `Maximum accumulation (${multiplier.toFixed(1)}x base)`;
  } else if (multiplier >= 1.5) {
    return `Strong accumulation (${multiplier.toFixed(1)}x base)`;
  } else if (multiplier >= 1.0) {
    return `Normal DCA (${multiplier.toFixed(1)}x base)`;
  } else if (multiplier >= 0.5) {
    return `Reduced DCA (${multiplier.toFixed(1)}x base)`;
  } else {
    return `Minimal DCA (${multiplier.toFixed(1)}x base)`;
  }
}

/**
 * Calculate expected DCA amounts for a range of risk values
 * Useful for visualization
 */
export function getDCARiskCurve(
  config: DynamicDCAConfig = DEFAULT_DCA_SWING_CONFIG.dca,
  steps: number = 20
): { risk: number; amount: number; multiplier: number }[] {
  const curve: { risk: number; amount: number; multiplier: number }[] = [];

  for (let i = 0; i <= steps; i++) {
    const risk = i / steps;
    const multiplier = calculateDCAMultiplier(risk, config);
    const amount = calculateDCAAmount(risk, config);

    curve.push({ risk, amount, multiplier });
  }

  return curve;
}

/**
 * Estimate total DCA investment over a period
 * Assumes weekly interval and average risk of 0.5
 */
export function estimateTotalDCAInvestment(
  config: DynamicDCAConfig,
  weeks: number,
  avgRisk: number = 0.5
): number {
  const avgMultiplier = calculateDCAMultiplier(avgRisk, config);
  const avgAmount = config.baseAmount * avgMultiplier;

  // Adjust for skip threshold
  const skipProbability = avgRisk > config.skipAboveRisk ? 0.3 : 0;

  return avgAmount * weeks * (1 - skipProbability);
}

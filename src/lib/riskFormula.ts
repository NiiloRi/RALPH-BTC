/**
 * BTC Risk Metric Calculator
 *
 * This module implements a reverse-engineered formula for calculating Bitcoin's
 * risk metric based on price and time. The formula was derived from 8 reference
 * data points with known risk values.
 *
 * Formula: risk = P(x)
 * where:
 *   x = ln(price) - B_POWER * ln(days_since_genesis)
 *   P(x) is a polynomial of degree 6
 *
 * The formula achieves <1% error on the reference points.
 */

// Bitcoin genesis block date (January 3, 2009) - use UTC midnight
const GENESIS_TIMESTAMP = Date.UTC(2009, 0, 3);  // January 3, 2009 UTC

// Power law coefficient for normalizing price against time
const B_POWER = 5.1719;

// Polynomial coefficients for degree 6 (achieves <1% error on reference points)
// P(x) = c0*x^6 + c1*x^5 + c2*x^4 + c3*x^3 + c4*x^2 + c5*x + c6
const COEFFICIENTS = [
  -1.56297591e+01,
  -3.15431531e+03,
  -2.65235624e+05,
  -1.18943988e+07,
  -3.00027332e+08,
  -4.03611021e+09,
  -2.26224223e+10,
];

/**
 * Calculate the number of days since Bitcoin genesis
 * Uses UTC to avoid timezone issues
 */
export function daysSinceGenesis(date: Date): number {
  // Get UTC midnight for the given date
  const dateUtc = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const diffMs = dateUtc - GENESIS_TIMESTAMP;
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Evaluate polynomial using Horner's method for numerical stability
 */
function evaluatePolynomial(x: number, coeffs: number[]): number {
  let result = 0;
  for (let i = 0; i < coeffs.length; i++) {
    result = result * x + coeffs[i];
  }
  return result;
}

/**
 * Calculate the BTC risk metric for a given price and date
 *
 * @param price - The BTC price in USD
 * @param date - The date for the calculation
 * @returns Risk value between 0 and 1, where:
 *   - 0-0.2: Low risk (good buying opportunity)
 *   - 0.2-0.4: Moderate-low risk
 *   - 0.4-0.6: Neutral
 *   - 0.6-0.8: Moderate-high risk
 *   - 0.8-1.0: High risk (consider taking profits)
 */
export function calculateRisk(price: number, date: Date): number {
  const days = daysSinceGenesis(date);

  if (days <= 0 || price <= 0) {
    return 0;
  }

  // Calculate normalized position: x = ln(price) - b * ln(days)
  const x = Math.log(price) - B_POWER * Math.log(days);

  // Evaluate polynomial
  const risk = evaluatePolynomial(x, COEFFICIENTS);

  // Clamp to valid range [0, 1]
  return Math.max(0, Math.min(1, risk));
}

/**
 * Reference points used to derive the formula
 * These are the "tooltip" values from the original data
 */
export const REFERENCE_POINTS = [
  { date: '2017-09-01', price: 4750.0, risk: 0.699 },
  { date: '2018-12-16', price: 3230.0, risk: 0.1 },
  { date: '2019-08-09', price: 12020.0, risk: 0.587 },
  { date: '2019-12-18', price: 6630.0, risk: 0.339 },
  { date: '2024-12-16', price: 106000.0, risk: 0.639 },
  { date: '2025-04-08', price: 76330.0, risk: 0.447 },
  { date: '2025-06-21', price: 101360.0, risk: 0.523 },
  { date: '2025-11-21', price: 85080.0, risk: 0.4 },
];

/**
 * Verify the formula accuracy against reference points
 * Returns an array of verification results with actual vs predicted risk
 */
export function verifyFormula(): Array<{
  date: string;
  price: number;
  actualRisk: number;
  predictedRisk: number;
  errorPercent: number;
}> {
  return REFERENCE_POINTS.map(point => {
    const date = new Date(point.date);
    const predictedRisk = calculateRisk(point.price, date);
    const errorPercent = Math.abs(predictedRisk - point.risk) / point.risk * 100;

    return {
      date: point.date,
      price: point.price,
      actualRisk: point.risk,
      predictedRisk,
      errorPercent,
    };
  });
}

export { B_POWER, COEFFICIENTS };

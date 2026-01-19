/**
 * Feature engineering module
 * Builds feature vectors from daily data for the risk model
 */

export * from './valuation';
export * from './momentum';
export * from './volatility';
export * from './cycle';
export * from './macro';
export * from './attention';

import { DailyData, FeatureVector } from '../types';
import { calculateValuationScore, getValuationComponents } from './valuation';
import { calculateMomentumScore, getMomentumComponents } from './momentum';
import { calculateVolatilityScore, getVolatilityComponents } from './volatility';
import {
  calculateCycleScore,
  getCycleComponents,
  daysSinceGenesis,
  daysSinceHalving,
  getCyclePhase,
  estimateCycleLength,
  getHalvingIndex,
  HISTORICAL_PEAKS,
} from './cycle';
import { calculateMacroScore, getMacroComponents } from './macro';
import { calculateAttentionScore, getAttentionComponents } from './attention';

/**
 * Build feature vector for a single data point
 */
export function buildFeatureVector(
  data: DailyData[],
  index: number
): FeatureVector {
  const current = data[index];
  const date = new Date(current.date);
  const daysGenesis = daysSinceGenesis(date);
  const daysHalving = daysSinceHalving(date);

  // Get cycle info
  const halvingIdx = getHalvingIndex(date);
  const knownPeaks = HISTORICAL_PEAKS.filter(p => p < date);
  const cycleLength = estimateCycleLength(halvingIdx, knownPeaks);
  const phase = getCyclePhase(daysHalving, cycleLength);
  const cycleProgress = daysHalving / cycleLength;

  // Calculate all scores
  const valuationScore = calculateValuationScore(data, index, daysGenesis);
  const momentumScore = calculateMomentumScore(data, index);
  const volatilityScore = calculateVolatilityScore(data, index);
  const cycleScore = calculateCycleScore(date);
  const macroScore = calculateMacroScore(data, index);
  const attentionScore = calculateAttentionScore(data, index);

  // Get sub-components for additional features
  const valComponents = getValuationComponents(data, index, daysGenesis);
  const momComponents = getMomentumComponents(data, index);
  const volComponents = getVolatilityComponents(data, index);

  return {
    date: current.date,
    // Component scores
    valuationScore,
    priceToSma200Ratio: valComponents.mvrvProxy,
    priceToSma350x111Ratio: valComponents.piCycleRatio,
    daysSinceATH: valComponents.daysSinceATH,
    drawdownFromATH: valComponents.drawdownFromATH,
    momentumScore,
    return30d: current.return30d || 0,
    return90d: current.return90d || 0,
    sma50Above200: momComponents.sma50Above200,
    volatilityScore,
    realizedVol30d: current.realizedVol30d || 0,
    volZScore: volComponents.volZScore,
    cycleScore,
    daysSinceHalving: daysHalving,
    cyclePhase: phase,
    estimatedCycleProgress: cycleProgress,
    macroScore,
    dxyZScore: getMacroComponents(data, index).dxyZScore,
    attentionScore,
    price: current.price,
  };
}

/**
 * Build feature vectors for entire dataset
 * Starts from index where we have enough history (200 days)
 */
export function buildAllFeatures(
  data: DailyData[],
  startIndex: number = 200
): FeatureVector[] {
  const features: FeatureVector[] = [];

  for (let i = startIndex; i < data.length; i++) {
    features.push(buildFeatureVector(data, i));
  }

  return features;
}

/**
 * Get all feature component values for debugging/analysis
 */
export function getAllFeatureComponents(
  data: DailyData[],
  index: number
): {
  valuation: ReturnType<typeof getValuationComponents>;
  momentum: ReturnType<typeof getMomentumComponents>;
  volatility: ReturnType<typeof getVolatilityComponents>;
  cycle: ReturnType<typeof getCycleComponents>;
  macro: ReturnType<typeof getMacroComponents>;
  attention: ReturnType<typeof getAttentionComponents>;
} {
  const date = new Date(data[index].date);
  const daysGenesis = daysSinceGenesis(date);

  return {
    valuation: getValuationComponents(data, index, daysGenesis),
    momentum: getMomentumComponents(data, index),
    volatility: getVolatilityComponents(data, index),
    cycle: getCycleComponents(date),
    macro: getMacroComponents(data, index),
    attention: getAttentionComponents(data, index),
  };
}

/**
 * Validate feature vector (no NaN, within expected ranges)
 */
export function validateFeatureVector(fv: FeatureVector): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // Check scores are in [0, 1]
  const scores = [
    'valuationScore',
    'momentumScore',
    'volatilityScore',
    'cycleScore',
    'macroScore',
    'attentionScore',
  ];

  for (const score of scores) {
    const value = fv[score as keyof FeatureVector] as number;
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      errors.push(`${score} out of range: ${value}`);
    }
  }

  // Check price is positive
  if (!Number.isFinite(fv.price) || fv.price <= 0) {
    errors.push(`Invalid price: ${fv.price}`);
  }

  // Check date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fv.date)) {
    errors.push(`Invalid date: ${fv.date}`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

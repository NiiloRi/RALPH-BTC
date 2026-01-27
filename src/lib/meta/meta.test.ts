/**
 * META-LAYERS VALIDATION TESTS
 *
 * These tests verify the CRITICAL INVARIANT:
 * Meta-layers are READ-ONLY and NEVER modify the base risk calculation.
 */

import { describe, it, expect } from 'vitest';

import { RiskOutput, FeatureVector, DailyData } from '../types';
import { calculateRisk, calculateAllRisks, DEFAULT_WEIGHTS, DEFAULT_CALIBRATION } from '../risk/model';
import {
  calculateMetaLayers,
  calculateAllMetaLayers,
  validateRiskInvariant,
  DEFAULT_META_CONFIG,
} from './index';
import { calculateRiskConfidence } from './confidence';
import { calculateRiskMomentum } from './momentum';

// Helper to create mock feature vectors
function createMockFeatureVector(overrides: Partial<FeatureVector> = {}): FeatureVector {
  return {
    date: '2024-01-01',
    valuationScore: 0.5,
    priceToSma200Ratio: 1.0,
    priceToSma350x111Ratio: 0.9,
    daysSinceATH: 30,
    drawdownFromATH: 0.1,
    momentumScore: 0.5,
    return30d: 0.05,
    return90d: 0.1,
    sma50Above200: true,
    volatilityScore: 0.4,
    realizedVol30d: 0.5,
    volZScore: 0,
    cycleScore: 0.5,
    daysSinceHalving: 200,
    cyclePhase: 'mid',
    estimatedCycleProgress: 0.5,
    prevCycleLow: 15500,
    prevCycleHigh: 69000,
    cycleRelativePrice: 0.7,
    macroScore: 0.5,
    dxyZScore: 0,
    m2Signal: 0.5,
    fedFundsSignal: 0.5,
    yieldCurveSignal: 0.5,
    realRateSignal: 0.5,
    dynamicMacroWeight: 0.15,
    attentionScore: 0.5,
    price: 50000,
    ...overrides,
  };
}

// Helper to create mock daily data
function createMockDailyData(overrides: Partial<DailyData> = {}): DailyData {
  return {
    date: '2024-01-01',
    price: 50000,
    realizedVol30d: 0.5,
    realizedVol90d: 0.45,
    return1d: 0.01,
    return7d: 0.05,
    return30d: 0.1,
    return90d: 0.15,
    return365d: 0.5,
    sma50: 48000,
    sma100: 46000,
    sma200: 45000,
    sma350: 42000,
    ...overrides,
  };
}

// Generate a series of mock data for testing
function generateMockSeries(length: number): {
  features: FeatureVector[];
  risks: RiskOutput[];
  data: DailyData[];
} {
  const features: FeatureVector[] = [];
  const data: DailyData[] = [];

  for (let i = 0; i < length; i++) {
    const date = new Date('2020-01-01');
    date.setDate(date.getDate() + i);
    const dateStr = date.toISOString().split('T')[0];

    // Vary scores over time to create realistic patterns
    const cyclePosition = (i % 1460) / 1460;
    const valuationScore = 0.3 + cyclePosition * 0.4 + Math.sin(i / 30) * 0.1;
    const momentumScore = 0.4 + Math.sin(i / 20) * 0.3;
    const volatilityScore = 0.3 + Math.abs(Math.sin(i / 50)) * 0.3;

    features.push(
      createMockFeatureVector({
        date: dateStr,
        valuationScore: Math.min(1, Math.max(0, valuationScore)),
        momentumScore: Math.min(1, Math.max(0, momentumScore)),
        volatilityScore: Math.min(1, Math.max(0, volatilityScore)),
        cycleScore: cyclePosition,
        price: 30000 + i * 20 + Math.sin(i / 10) * 5000,
      })
    );

    data.push(
      createMockDailyData({
        date: dateStr,
        price: 30000 + i * 20 + Math.sin(i / 10) * 5000,
        realizedVol30d: 0.4 + Math.abs(Math.sin(i / 50)) * 0.3,
      })
    );
  }

  // Calculate risks using the ORIGINAL model (not meta-layers)
  const risks = calculateAllRisks(features, DEFAULT_WEIGHTS, DEFAULT_CALIBRATION);

  return { features, risks, data };
}

describe('Meta-Layers Invariant Tests', () => {
  describe('Risk Values Unchanged', () => {
    it('should not modify risk values when calculating meta-layers', () => {
      const { features, risks, data } = generateMockSeries(1000);

      // Deep copy original risks
      const originalRisks = risks.map(r => ({
        ...r,
        components: { ...r.components },
      }));

      // Calculate meta-layers
      const metaLayers = calculateAllMetaLayers(
        risks,
        features,
        data,
        DEFAULT_META_CONFIG,
        365 * 2
      );

      // Verify risks are unchanged
      expect(() => validateRiskInvariant(originalRisks, risks)).not.toThrow();

      // Double-check specific values
      for (let i = 0; i < originalRisks.length; i++) {
        expect(risks[i].risk).toBe(originalRisks[i].risk);
        expect(risks[i].smoothedRisk).toBe(originalRisks[i].smoothedRisk);
        expect(risks[i].date).toBe(originalRisks[i].date);
        expect(risks[i].components.valuation).toBe(originalRisks[i].components.valuation);
        expect(risks[i].components.momentum).toBe(originalRisks[i].components.momentum);
      }

      // Verify meta-layers were actually calculated
      expect(metaLayers.length).toBeGreaterThan(0);
    });

    it('should preserve exact risk values through multiple meta-layer calculations', () => {
      const { features, risks, data } = generateMockSeries(500);

      const originalRisk = risks[400].risk;
      const originalSmoothedRisk = risks[400].smoothedRisk;

      // Calculate meta-layers multiple times
      for (let i = 0; i < 5; i++) {
        calculateAllMetaLayers(risks, features, data, DEFAULT_META_CONFIG, 365);
      }

      // Risk should be bit-for-bit identical
      expect(risks[400].risk).toBe(originalRisk);
      expect(risks[400].smoothedRisk).toBe(originalSmoothedRisk);
    });
  });

  describe('Meta-Layers Independence', () => {
    it('should produce meta-layers that do not influence risk calculation', () => {
      const { features, risks, data } = generateMockSeries(800);

      // Calculate meta-layers
      const metaLayers = calculateAllMetaLayers(
        risks,
        features,
        data,
        DEFAULT_META_CONFIG,
        365 * 2
      );

      // Recalculate risks from scratch
      const freshRisks = calculateAllRisks(features, DEFAULT_WEIGHTS, DEFAULT_CALIBRATION);

      // Fresh calculation should match original
      for (let i = 0; i < risks.length; i++) {
        expect(risks[i].risk).toBeCloseTo(freshRisks[i].risk, 10);
        expect(risks[i].smoothedRisk).toBeCloseTo(freshRisks[i].smoothedRisk, 10);
      }
    });

    it('should reference but not modify base risk values', () => {
      const { features, risks, data } = generateMockSeries(800);

      const metaLayers = calculateAllMetaLayers(
        risks,
        features,
        data,
        DEFAULT_META_CONFIG,
        365 * 2
      );

      // Each meta-layer output should correctly reference its base risk
      for (let i = 0; i < metaLayers.length; i++) {
        const riskIndex = i + 365 * 2;
        expect(metaLayers[i].baseRisk).toBe(risks[riskIndex].risk);
        expect(metaLayers[i].baseSmoothedRisk).toBe(risks[riskIndex].smoothedRisk);
      }
    });
  });

  describe('Risk Confidence Module', () => {
    it('should calculate confidence without modifying risk', () => {
      const { risks } = generateMockSeries(100);

      const originalRisk = risks[50].risk;
      const confidence = calculateRiskConfidence(risks, 50);

      expect(risks[50].risk).toBe(originalRisk);
      expect(confidence.value).toBeGreaterThanOrEqual(0);
      expect(confidence.value).toBeLessThanOrEqual(1);
      expect(['low', 'medium', 'high']).toContain(confidence.level);
    });

    it('should produce valid confidence values', () => {
      const { risks } = generateMockSeries(100);

      const confidence = calculateRiskConfidence(risks, 50);

      expect(confidence.componentAgreement).toBeGreaterThanOrEqual(0);
      expect(confidence.componentAgreement).toBeLessThanOrEqual(1);
      expect(confidence.regimeStability).toBeGreaterThanOrEqual(0);
      expect(confidence.regimeStability).toBeLessThanOrEqual(1);
      expect(confidence.componentCount).toBe(6);
    });
  });

  describe('Risk Momentum Module', () => {
    it('should calculate momentum without modifying risk', () => {
      const { risks } = generateMockSeries(100);

      const originalRisks = risks.map(r => r.smoothedRisk);
      const momentum = calculateRiskMomentum(risks, 50);

      // Verify risks unchanged
      for (let i = 0; i < risks.length; i++) {
        expect(risks[i].smoothedRisk).toBe(originalRisks[i]);
      }

      // Verify momentum calculated
      expect(['rising', 'stable', 'falling']).toContain(momentum.direction);
      expect(['↑', '→', '↓']).toContain(momentum.directionSymbol);
    });

    it('should derive momentum only from risk time series', () => {
      const { risks } = generateMockSeries(100);

      const momentum = calculateRiskMomentum(risks, 50);

      // Delta7d should match actual 7-day change
      const expected7dChange = risks[50].smoothedRisk - risks[43].smoothedRisk;
      expect(momentum.delta7d).toBeCloseTo(expected7dChange, 5);
    });
  });

  describe('Component Weights Unchanged', () => {
    it('should not modify DEFAULT_WEIGHTS', () => {
      const originalWeights = { ...DEFAULT_WEIGHTS };
      const { features, risks, data } = generateMockSeries(500);

      calculateAllMetaLayers(risks, features, data, DEFAULT_META_CONFIG, 365);

      expect(DEFAULT_WEIGHTS).toEqual(originalWeights);
    });

    it('should not modify DEFAULT_CALIBRATION', () => {
      const originalCalibration = { ...DEFAULT_CALIBRATION };
      const { features, risks, data } = generateMockSeries(500);

      calculateAllMetaLayers(risks, features, data, DEFAULT_META_CONFIG, 365);

      expect(DEFAULT_CALIBRATION).toEqual(originalCalibration);
    });
  });

  describe('No Hindsight Leakage', () => {
    it('should only use data available at calculation time', () => {
      const { features, risks, data } = generateMockSeries(800);

      // Calculate meta-layers at index 400
      const metaAtIndex400 = calculateMetaLayers(
        risks.slice(0, 401),
        features.slice(0, 401),
        data.slice(0, 401),
        400,
        DEFAULT_META_CONFIG
      );

      // Calculate with full data
      const metaWithFullData = calculateMetaLayers(
        risks,
        features,
        data,
        400,
        DEFAULT_META_CONFIG
      );

      // Results should be identical (no future data used)
      if (metaAtIndex400.confidence && metaWithFullData.confidence) {
        expect(metaAtIndex400.confidence.value).toBe(metaWithFullData.confidence.value);
      }
      if (metaAtIndex400.momentum && metaWithFullData.momentum) {
        expect(metaAtIndex400.momentum.delta7d).toBe(metaWithFullData.momentum.delta7d);
      }
    });
  });

  describe('Toggleable Configuration', () => {
    it('should respect disabled layers in config', () => {
      const { features, risks, data } = generateMockSeries(800);

      const partialConfig = {
        enableConfidence: true,
        enableMomentum: false,
        enableHistoricalContext: false,
        enableDrawdownProbability: false,
        enableCycleRelativeRisk: false,
        enablePositionGuidance: false,
      };

      const meta = calculateMetaLayers(risks, features, data, 400, partialConfig);

      expect(meta.confidence).toBeDefined();
      expect(meta.momentum).toBeUndefined();
      expect(meta.historicalContext).toBeUndefined();
      expect(meta.drawdownProbability).toBeUndefined();
      expect(meta.cycleRelativeRisk).toBeUndefined();
      expect(meta.positionGuidance).toBeUndefined();
    });
  });
});

describe('Validation Function', () => {
  it('should pass for unchanged risks', () => {
    const { risks } = generateMockSeries(100);
    const copy = risks.map(r => ({ ...r, components: { ...r.components } }));

    expect(() => validateRiskInvariant(copy, risks)).not.toThrow();
  });

  it('should throw for modified risk values', () => {
    const { risks } = generateMockSeries(100);
    const copy = risks.map(r => ({ ...r, components: { ...r.components } }));

    // Modify one value
    risks[50].risk = 0.999;

    expect(() => validateRiskInvariant(copy, risks)).toThrow('INVARIANT VIOLATION');
  });

  it('should throw for modified smoothedRisk values', () => {
    const { risks } = generateMockSeries(100);
    const copy = risks.map(r => ({ ...r, components: { ...r.components } }));

    // Modify one value
    risks[50].smoothedRisk = 0.999;

    expect(() => validateRiskInvariant(copy, risks)).toThrow('INVARIANT VIOLATION');
  });
});

/**
 * Tests for FIFO Ledger
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { FIFOLedger, calculateDeemedAcquisitionCost } from './fifo-ledger';

describe('FIFOLedger', () => {
  let ledger: FIFOLedger;

  beforeEach(() => {
    ledger = new FIFOLedger();
  });

  describe('buy', () => {
    it('should create a lot when buying', () => {
      ledger.buy('2024-01-01', 0.5, 40000, 10);

      const lots = ledger.getLots();
      expect(lots).toHaveLength(1);
      expect(lots[0].quantity).toBe(0.5);
      expect(lots[0].unitCost).toBe(40000);
      expect(lots[0].totalCost).toBe(20010); // 0.5 * 40000 + 10
      expect(lots[0].remainingQuantity).toBe(0.5);
    });

    it('should track multiple buys as separate lots', () => {
      ledger.buy('2024-01-01', 0.5, 40000);
      ledger.buy('2024-01-15', 0.3, 42000);

      const lots = ledger.getLots();
      expect(lots).toHaveLength(2);
      expect(ledger.getTotalQuantity()).toBe(0.8);
    });

    it('should record trade on buy', () => {
      ledger.buy('2024-01-01', 0.5, 40000, 10);

      const trades = ledger.getTrades();
      expect(trades).toHaveLength(1);
      expect(trades[0].type).toBe('BUY');
      expect(trades[0].quantity).toBe(0.5);
    });
  });

  describe('sell (FIFO)', () => {
    beforeEach(() => {
      // Setup: buy 0.5 BTC at 40k, then 0.3 BTC at 42k
      ledger.buy('2024-01-01', 0.5, 40000);
      ledger.buy('2024-01-15', 0.3, 42000);
    });

    it('should consume oldest lot first (FIFO)', () => {
      // Sell 0.3 BTC at 50k
      ledger.sell('2024-02-01', 0.3, 50000);

      const lots = ledger.getActiveLots();
      expect(lots[0].remainingQuantity).toBe(0.2); // First lot reduced
      expect(lots[1].remainingQuantity).toBe(0.3); // Second lot untouched
    });

    it('should calculate correct realized P/L', () => {
      // Buy: 0.3 BTC at 40k = 12,000 cost basis
      // Sell: 0.3 BTC at 50k = 15,000 proceeds
      // P/L = 3,000
      const trade = ledger.sell('2024-02-01', 0.3, 50000);

      expect(trade.realizedPL).toBeCloseTo(3000, 0);
      expect(trade.costBasis).toBe(12000);
    });

    it('should consume multiple lots if needed', () => {
      // Sell 0.6 BTC (needs both lots)
      ledger.sell('2024-02-01', 0.6, 50000);

      const lots = ledger.getActiveLots();
      expect(lots).toHaveLength(1);
      expect(lots[0].remainingQuantity).toBe(0.2); // 0.3 - 0.1 from second lot
    });

    it('should throw if selling more than available', () => {
      expect(() => ledger.sell('2024-02-01', 1.0, 50000)).toThrow(/Insufficient/);
    });

    it('should track realized gains', () => {
      ledger.sell('2024-02-01', 0.3, 50000);

      const gains = ledger.getRealizedGains();
      expect(gains).toHaveLength(1);
      expect(gains[0].gain).toBe(3000);
      expect(gains[0].holdingPeriodDays).toBe(31); // Jan 1 to Feb 1
    });

    it('should handle loss correctly', () => {
      // Sell at loss
      const trade = ledger.sell('2024-02-01', 0.3, 35000);

      expect(trade.realizedPL).toBeLessThan(0);
      expect(ledger.wouldSellAtLoss(0.1, 35000)).toBe(true);
    });
  });

  describe('getters', () => {
    beforeEach(() => {
      ledger.buy('2024-01-01', 0.5, 40000, 100);
      ledger.buy('2024-01-15', 0.3, 42000, 50);
    });

    it('should calculate total quantity', () => {
      expect(ledger.getTotalQuantity()).toBe(0.8);
    });

    it('should calculate total cost basis', () => {
      // 0.5 * 40000 + 100 + 0.3 * 42000 + 50 = 20100 + 12650 = 32750
      expect(ledger.getTotalCostBasis()).toBe(32750);
    });

    it('should calculate average cost', () => {
      // 32750 / 0.8 = 40937.5
      expect(ledger.getAverageCost()).toBeCloseTo(40937.5, 0);
    });

    it('should calculate unrealized P/L', () => {
      // Current value: 0.8 * 50000 = 40000
      // Cost basis: 32750
      // Unrealized P/L: 7250
      expect(ledger.getUnrealizedPL(50000)).toBeCloseTo(7250, 0);
    });
  });

  describe('yearly tax summary', () => {
    it('should group gains by year', () => {
      ledger.buy('2023-01-01', 1.0, 20000);
      ledger.sell('2023-12-15', 0.3, 40000); // 2023 sale
      ledger.sell('2024-01-15', 0.2, 45000); // 2024 sale

      const summary2023 = ledger.getYearlyTaxSummary(2023);
      const summary2024 = ledger.getYearlyTaxSummary(2024);

      expect(summary2023.numberOfSales).toBe(1);
      expect(summary2024.numberOfSales).toBe(1);
      expect(summary2023.totalGains).toBeGreaterThan(0);
    });

    it('should calculate net gain correctly', () => {
      ledger.buy('2024-01-01', 1.0, 40000);
      ledger.sell('2024-06-01', 0.5, 50000); // Gain
      ledger.sell('2024-07-01', 0.3, 35000); // Loss

      const summary = ledger.getYearlyTaxSummary(2024);
      expect(summary.netGain).toBe(summary.totalGains - summary.totalLosses);
    });
  });

  describe('export/import', () => {
    it('should export and import state correctly', () => {
      ledger.buy('2024-01-01', 0.5, 40000);
      ledger.sell('2024-02-01', 0.2, 50000);

      const exported = ledger.export();
      const imported = FIFOLedger.import(exported);

      expect(imported.getTotalQuantity()).toBe(ledger.getTotalQuantity());
      expect(imported.getTrades()).toHaveLength(2);
      expect(imported.getRealizedGains()).toHaveLength(1);
    });

    it('should create independent clone', () => {
      ledger.buy('2024-01-01', 0.5, 40000);

      const clone = ledger.clone();
      clone.buy('2024-02-01', 0.3, 45000);

      expect(ledger.getTotalQuantity()).toBe(0.5);
      expect(clone.getTotalQuantity()).toBe(0.8);
    });
  });
});

describe('calculateDeemedAcquisitionCost', () => {
  it('should return 20% for holdings < 10 years', () => {
    const cost = calculateDeemedAcquisitionCost(10000, 5);
    expect(cost).toBe(2000);
  });

  it('should return 40% for holdings >= 10 years', () => {
    const cost = calculateDeemedAcquisitionCost(10000, 10);
    expect(cost).toBe(4000);
  });
});

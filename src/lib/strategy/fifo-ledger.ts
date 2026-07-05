/**
 * FIFO Ledger Implementation
 *
 * Implements First-In-First-Out cost basis tracking for Finnish tax compliance.
 *
 * DISCLAIMER: This is a decision-support tool, not tax advice.
 * Consult Verohallinto (Finnish Tax Administration) for official guidance.
 * https://www.vero.fi/henkiloasiakkaat/omaisuus/virtuaalivaluutat/
 */

import { v4 as uuidv4 } from 'uuid';
import {
  FIFOLot,
  Trade,
  RealizedGain,
  YearlyTaxSummary,
} from './types';

/**
 * FIFO Ledger class for managing BTC lots
 */
export class FIFOLedger {
  private lots: FIFOLot[] = [];
  private trades: Trade[] = [];
  private realizedGains: RealizedGain[] = [];

  constructor(initialLots: FIFOLot[] = []) {
    this.lots = [...initialLots];
  }

  /**
   * Get all lots (sorted by acquisition date, oldest first)
   */
  getLots(): FIFOLot[] {
    return [...this.lots].sort(
      (a, b) => new Date(a.acquisitionDate).getTime() - new Date(b.acquisitionDate).getTime()
    );
  }

  /**
   * Get lots with remaining quantity
   */
  getActiveLots(): FIFOLot[] {
    return this.getLots().filter(lot => lot.remainingQuantity > 0);
  }

  /**
   * Get all trades
   */
  getTrades(): Trade[] {
    return [...this.trades];
  }

  /**
   * Get all realized gains
   */
  getRealizedGains(): RealizedGain[] {
    return [...this.realizedGains];
  }

  /**
   * Get total BTC quantity
   */
  getTotalQuantity(): number {
    return this.lots.reduce((sum, lot) => sum + lot.remainingQuantity, 0);
  }

  /**
   * Get total cost basis (for remaining quantities)
   */
  getTotalCostBasis(): number {
    return this.lots.reduce((sum, lot) => {
      const fraction = lot.remainingQuantity / lot.quantity;
      return sum + lot.totalCost * fraction;
    }, 0);
  }

  /**
   * Get average cost per BTC
   */
  getAverageCost(): number {
    const totalQuantity = this.getTotalQuantity();
    if (totalQuantity === 0) return 0;
    return this.getTotalCostBasis() / totalQuantity;
  }

  /**
   * Get unrealized P/L at current price
   */
  getUnrealizedPL(currentPrice: number): number {
    const totalQuantity = this.getTotalQuantity();
    const totalCostBasis = this.getTotalCostBasis();
    const currentValue = totalQuantity * currentPrice;
    return currentValue - totalCostBasis;
  }

  /**
   * Add a BUY trade - creates a new lot
   */
  buy(
    date: string,
    quantity: number,
    price: number,
    fees: number = 0,
    source: 'buy' | 'dca' | 'initial' = 'buy'
  ): Trade {
    const totalCost = quantity * price + fees;

    const lot: FIFOLot = {
      id: uuidv4(),
      acquisitionDate: date,
      quantity,
      unitCost: price,
      totalCost,
      fees,
      source,
      remainingQuantity: quantity,
    };

    this.lots.push(lot);

    const trade: Trade = {
      id: uuidv4(),
      date,
      type: 'BUY',
      quantity,
      price,
      totalValue: quantity * price,
      fees,
    };

    this.trades.push(trade);

    return trade;
  }

  /**
   * Execute a SELL trade using FIFO
   *
   * Returns the trade with realized P/L calculated
   */
  sell(
    date: string,
    quantity: number,
    price: number,
    fees: number = 0
  ): Trade {
    const activeLots = this.getActiveLots();
    const totalAvailable = activeLots.reduce((sum, l) => sum + l.remainingQuantity, 0);

    if (quantity > totalAvailable) {
      throw new Error(
        `Insufficient BTC: trying to sell ${quantity} but only ${totalAvailable} available`
      );
    }

    let remainingToSell = quantity;
    let totalCostBasis = 0;
    const lotsConsumed: string[] = [];

    // FIFO: consume lots from oldest to newest
    for (const lot of activeLots) {
      if (remainingToSell <= 0) break;

      const toTakeFromLot = Math.min(remainingToSell, lot.remainingQuantity);
      const fractionOfLot = toTakeFromLot / lot.quantity;
      const costBasisForPortion = lot.totalCost * fractionOfLot;

      // Calculate holding period
      const acquisitionDate = new Date(lot.acquisitionDate);
      const saleDate = new Date(date);
      const holdingPeriodDays = Math.floor(
        (saleDate.getTime() - acquisitionDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      // Record realized gain for this portion
      const saleProceeds = toTakeFromLot * price;
      const gain = saleProceeds - costBasisForPortion;

      this.realizedGains.push({
        year: saleDate.getFullYear(),
        tradeId: '', // Will be set after trade is created
        date,
        quantity: toTakeFromLot,
        salePrice: saleProceeds,
        costBasis: costBasisForPortion,
        gain,
        holdingPeriodDays,
      });

      // Update lot
      lot.remainingQuantity -= toTakeFromLot;
      totalCostBasis += costBasisForPortion;
      remainingToSell -= toTakeFromLot;

      lotsConsumed.push(lot.id);
    }

    const saleValue = quantity * price;
    const realizedPL = saleValue - totalCostBasis - fees;

    const trade: Trade = {
      id: uuidv4(),
      date,
      type: 'SELL',
      quantity,
      price,
      totalValue: saleValue,
      fees,
      realizedPL,
      costBasis: totalCostBasis,
      lotsConsumed,
    };

    // Update trade IDs in realized gains
    const recentGains = this.realizedGains.filter(g => g.tradeId === '');
    for (const gain of recentGains) {
      gain.tradeId = trade.id;
    }

    this.trades.push(trade);

    return trade;
  }

  /**
   * Get realized gains for a specific year
   */
  getYearlyGains(year: number): RealizedGain[] {
    return this.realizedGains.filter(g => g.year === year);
  }

  /**
   * Get yearly tax summary
   */
  getYearlyTaxSummary(year: number): YearlyTaxSummary {
    const yearGains = this.getYearlyGains(year);

    const gains = yearGains.filter(g => g.gain > 0);
    const losses = yearGains.filter(g => g.gain < 0);

    const totalGains = gains.reduce((sum, g) => sum + g.gain, 0);
    const totalLosses = Math.abs(losses.reduce((sum, g) => sum + g.gain, 0));
    const netGain = totalGains - totalLosses;

    const totalHoldingDays = yearGains.reduce((sum, g) => sum + g.holdingPeriodDays, 0);
    const avgHoldingPeriod = yearGains.length > 0 ? totalHoldingDays / yearGains.length : 0;

    return {
      year,
      totalGains,
      totalLosses,
      netGain,
      numberOfSales: yearGains.length,
      avgHoldingPeriod,
      trades: yearGains,
    };
  }

  /**
   * Get all yearly summaries
   */
  getAllYearlySummaries(): YearlyTaxSummary[] {
    const years = [...new Set(this.realizedGains.map(g => g.year))].sort();
    return years.map(year => this.getYearlyTaxSummary(year));
  }

  /**
   * Get total realized P/L
   */
  getTotalRealizedPL(): number {
    return this.realizedGains.reduce((sum, g) => sum + g.gain, 0);
  }

  /**
   * Get total realized gains for the current year
   */
  getCurrentYearGains(): number {
    const currentYear = new Date().getFullYear();
    return this.getYearlyGains(currentYear)
      .filter(g => g.gain > 0)
      .reduce((sum, g) => sum + g.gain, 0);
  }

  /**
   * Check if selling would result in a loss (for loss harvesting)
   */
  wouldSellAtLoss(quantity: number, currentPrice: number): boolean {
    const activeLots = this.getActiveLots();
    let remainingToCheck = quantity;
    let totalCostBasis = 0;

    for (const lot of activeLots) {
      if (remainingToCheck <= 0) break;

      const toCheck = Math.min(remainingToCheck, lot.remainingQuantity);
      const fractionOfLot = toCheck / lot.quantity;
      totalCostBasis += lot.totalCost * fractionOfLot;
      remainingToCheck -= toCheck;
    }

    const saleValue = quantity * currentPrice;
    return saleValue < totalCostBasis;
  }

  /**
   * Estimate realized P/L if selling a quantity at current price
   */
  estimateSalePL(quantity: number, currentPrice: number): number {
    const activeLots = this.getActiveLots();
    let remainingToCheck = Math.min(quantity, this.getTotalQuantity());
    let totalCostBasis = 0;

    for (const lot of activeLots) {
      if (remainingToCheck <= 0) break;

      const toCheck = Math.min(remainingToCheck, lot.remainingQuantity);
      const fractionOfLot = toCheck / lot.quantity;
      totalCostBasis += lot.totalCost * fractionOfLot;
      remainingToCheck -= toCheck;
    }

    const saleValue = quantity * currentPrice;
    return saleValue - totalCostBasis;
  }

  /**
   * Export ledger state for persistence
   */
  export(): {
    lots: FIFOLot[];
    trades: Trade[];
    realizedGains: RealizedGain[];
  } {
    return {
      lots: this.lots,
      trades: this.trades,
      realizedGains: this.realizedGains,
    };
  }

  /**
   * Import ledger state
   */
  static import(data: {
    lots: FIFOLot[];
    trades: Trade[];
    realizedGains: RealizedGain[];
  }): FIFOLedger {
    const ledger = new FIFOLedger(data.lots);
    ledger.trades = data.trades;
    ledger.realizedGains = data.realizedGains;
    return ledger;
  }

  /**
   * Create a clone of this ledger
   */
  clone(): FIFOLedger {
    return FIFOLedger.import(JSON.parse(JSON.stringify(this.export())));
  }
}

/**
 * Hankintameno-olettama (Deemed Acquisition Cost) Calculator
 *
 * In Finland, if you cannot prove the actual acquisition cost,
 * you may use a deemed acquisition cost (hankintameno-olettama).
 *
 * NOTE: This is simplified for educational purposes.
 * Actual rules depend on holding period and other factors.
 * Always consult Verohallinto for official guidance.
 */
export function calculateDeemedAcquisitionCost(
  saleProceeds: number,
  holdingPeriodYears: number
): number {
  // Per Finnish tax rules (simplified):
  // - If held < 10 years: 20% of sale price can be used as deemed cost
  // - If held >= 10 years: 40% of sale price can be used as deemed cost
  //
  // IMPORTANT: This is a simplification. The actual rules are more complex
  // and may have changed. Consult Verohallinto.
  //
  // Reference: https://www.vero.fi/henkiloasiakkaat/omaisuus/virtuaalivaluutat/

  const deemedPercentage = holdingPeriodYears >= 10 ? 0.40 : 0.20;
  return saleProceeds * deemedPercentage;
}

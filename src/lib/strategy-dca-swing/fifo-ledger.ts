/**
 * FIFO Ledger for Tax Tracking
 *
 * Implements Finnish FIFO (First In, First Out) accounting
 * for cryptocurrency tax calculations.
 */

import { v4 as uuidv4 } from 'uuid';
import {
  FIFOLot,
  DCASwingTrade,
  DCASwingRealizedGain,
  DCASwingYearlyTax,
  TaxConfig,
  DEFAULT_DCA_SWING_CONFIG,
} from './types';

/**
 * FIFO Ledger class
 */
export class DCASwingFIFOLedger {
  private lots: FIFOLot[] = [];
  private trades: DCASwingTrade[] = [];
  private realizedGains: DCASwingRealizedGain[] = [];
  private taxConfig: TaxConfig;

  constructor(taxConfig: TaxConfig = DEFAULT_DCA_SWING_CONFIG.tax) {
    this.taxConfig = taxConfig;
  }

  /**
   * Get current lots
   */
  getLots(): FIFOLot[] {
    return this.lots.filter(lot => lot.remainingQuantity > 0);
  }

  /**
   * Get all trades
   */
  getTrades(): DCASwingTrade[] {
    return [...this.trades];
  }

  /**
   * Get realized gains
   */
  getRealizedGains(): DCASwingRealizedGain[] {
    return [...this.realizedGains];
  }

  /**
   * Get total BTC quantity
   */
  getTotalBTC(): number {
    return this.lots.reduce((sum, lot) => sum + lot.remainingQuantity, 0);
  }

  /**
   * Get total cost basis (for remaining BTC)
   */
  getTotalCostBasis(): number {
    return this.lots.reduce(
      (sum, lot) => sum + lot.remainingQuantity * lot.unitCostEUR,
      0
    );
  }

  /**
   * Get average cost basis per BTC
   */
  getAverageCostBasis(): number {
    const totalBTC = this.getTotalBTC();
    if (totalBTC === 0) return 0;
    return this.getTotalCostBasis() / totalBTC;
  }

  /**
   * Get unrealized P/L at current price
   */
  getUnrealizedPL(currentPrice: number): number {
    const totalBTC = this.getTotalBTC();
    const currentValue = totalBTC * currentPrice;
    const costBasis = this.getTotalCostBasis();
    return currentValue - costBasis;
  }

  /**
   * Buy BTC - creates a new lot
   */
  buy(
    date: string,
    btcAmount: number,
    priceEUR: number,
    feesEUR: number,
    source: 'dca' | 'rerisk' | 'initial',
    risk: number,
    multiplier?: number
  ): DCASwingTrade {
    const totalCostEUR = btcAmount * priceEUR + feesEUR;

    // Create lot
    const lot: FIFOLot = {
      id: uuidv4(),
      acquisitionDate: date,
      quantity: btcAmount,
      unitCostEUR: (btcAmount * priceEUR + feesEUR) / btcAmount,
      totalCostEUR,
      feesEUR,
      remainingQuantity: btcAmount,
      source,
    };
    this.lots.push(lot);

    // Create trade record
    const trade: DCASwingTrade = {
      id: uuidv4(),
      date,
      type: source === 'dca' ? 'DCA_BUY' : source === 'rerisk' ? 'RERISK_BUY' : 'DCA_BUY',
      btcAmount,
      priceEUR,
      totalEUR: totalCostEUR,
      feesEUR,
      riskAtTrade: risk,
      multiplierUsed: multiplier,
      reason: source === 'dca'
        ? `DCA buy (${multiplier?.toFixed(2) || 1}x)`
        : source === 'rerisk'
        ? 'Re-risk buy'
        : 'Initial position',
    };
    this.trades.push(trade);

    return trade;
  }

  /**
   * Sell BTC - consumes lots FIFO style
   */
  sell(
    date: string,
    btcAmount: number,
    priceEUR: number,
    feesEUR: number,
    risk: number,
    tradeType: 'SWING_SELL' | 'TAX_HARVEST_SELL',
    reason: string
  ): DCASwingTrade {
    let remainingToSell = btcAmount;
    let totalCostBasis = 0;
    let totalHoldingDays = 0;
    let lotsUsed = 0;

    // Consume lots FIFO
    for (const lot of this.lots) {
      if (remainingToSell <= 0) break;
      if (lot.remainingQuantity <= 0) continue;

      const sellFromLot = Math.min(remainingToSell, lot.remainingQuantity);
      const lotCostBasis = sellFromLot * lot.unitCostEUR;

      totalCostBasis += lotCostBasis;

      // Calculate holding period
      const acquisitionDate = new Date(lot.acquisitionDate);
      const saleDate = new Date(date);
      const holdingDays = Math.floor(
        (saleDate.getTime() - acquisitionDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      totalHoldingDays += holdingDays * sellFromLot;

      // Update lot
      lot.remainingQuantity -= sellFromLot;
      remainingToSell -= sellFromLot;
      lotsUsed++;
    }

    const saleProceeds = btcAmount * priceEUR - feesEUR;
    const realizedGain = saleProceeds - totalCostBasis;
    const avgHoldingDays = lotsUsed > 0 ? totalHoldingDays / btcAmount : 0;

    // Record realized gain
    const year = new Date(date).getFullYear();
    const gain: DCASwingRealizedGain = {
      tradeId: uuidv4(),
      date,
      year,
      btcSold: btcAmount,
      salePriceEUR: priceEUR,
      costBasisEUR: totalCostBasis,
      gainEUR: realizedGain,
      holdingDays: Math.round(avgHoldingDays),
      taxableGain: realizedGain, // Could apply adjustments here
    };
    this.realizedGains.push(gain);

    // Create trade record
    const trade: DCASwingTrade = {
      id: gain.tradeId,
      date,
      type: tradeType,
      btcAmount,
      priceEUR,
      totalEUR: saleProceeds,
      feesEUR,
      realizedGainEUR: realizedGain,
      costBasisEUR: totalCostBasis,
      holdingDays: Math.round(avgHoldingDays),
      riskAtTrade: risk,
      reason,
    };
    this.trades.push(trade);

    return trade;
  }

  /**
   * Estimate P/L for a potential sale without executing
   */
  estimateSalePL(btcAmount: number, priceEUR: number): number {
    let remaining = btcAmount;
    let costBasis = 0;

    for (const lot of this.lots) {
      if (remaining <= 0) break;
      if (lot.remainingQuantity <= 0) continue;

      const sellFromLot = Math.min(remaining, lot.remainingQuantity);
      costBasis += sellFromLot * lot.unitCostEUR;
      remaining -= sellFromLot;
    }

    const proceeds = btcAmount * priceEUR;
    return proceeds - costBasis;
  }

  /**
   * Get current year realized gains
   */
  getCurrentYearGains(): number {
    const currentYear = new Date().getFullYear();
    return this.realizedGains
      .filter(g => g.year === currentYear && g.gainEUR > 0)
      .reduce((sum, g) => sum + g.gainEUR, 0);
  }

  /**
   * Get current year realized losses
   */
  getCurrentYearLosses(): number {
    const currentYear = new Date().getFullYear();
    return this.realizedGains
      .filter(g => g.year === currentYear && g.gainEUR < 0)
      .reduce((sum, g) => sum + Math.abs(g.gainEUR), 0);
  }

  /**
   * Get year-to-date realized P/L for a specific year
   */
  getYearGains(year: number): number {
    return this.realizedGains
      .filter(g => g.year === year && g.gainEUR > 0)
      .reduce((sum, g) => sum + g.gainEUR, 0);
  }

  getYearLosses(year: number): number {
    return this.realizedGains
      .filter(g => g.year === year && g.gainEUR < 0)
      .reduce((sum, g) => sum + Math.abs(g.gainEUR), 0);
  }

  /**
   * Calculate tax for a year using Finnish rates
   */
  calculateYearTax(year: number): number {
    const gains = this.getYearGains(year);
    const losses = this.getYearLosses(year);
    const netGain = Math.max(0, gains - losses);

    if (netGain <= 0) return 0;

    // Finnish capital gains tax: 30% up to €30,000, 34% above
    const threshold = 30000;
    if (netGain <= threshold) {
      return netGain * this.taxConfig.taxRateBelow30k;
    } else {
      const taxBelow = threshold * this.taxConfig.taxRateBelow30k;
      const taxAbove = (netGain - threshold) * this.taxConfig.taxRateAbove30k;
      return taxBelow + taxAbove;
    }
  }

  /**
   * Get yearly tax summary
   */
  getYearlySummary(year: number): DCASwingYearlyTax {
    const yearGains = this.realizedGains.filter(g => g.year === year);
    const totalGains = yearGains
      .filter(g => g.gainEUR > 0)
      .reduce((sum, g) => sum + g.gainEUR, 0);
    const totalLosses = yearGains
      .filter(g => g.gainEUR < 0)
      .reduce((sum, g) => sum + Math.abs(g.gainEUR), 0);
    const netGain = totalGains - totalLosses;
    const estimatedTax = this.calculateYearTax(year);
    const afterTaxGain = netGain - estimatedTax;

    const totalHoldingDays = yearGains.reduce((sum, g) => sum + g.holdingDays, 0);
    const avgHoldingDays = yearGains.length > 0 ? totalHoldingDays / yearGains.length : 0;

    return {
      year,
      totalGains,
      totalLosses,
      netGain,
      numberOfSales: yearGains.length,
      avgHoldingDays: Math.round(avgHoldingDays),
      estimatedTax,
      afterTaxGain,
      trades: yearGains,
    };
  }

  /**
   * Get all yearly summaries
   */
  getAllYearlySummaries(): DCASwingYearlyTax[] {
    const years = new Set(this.realizedGains.map(g => g.year));
    return Array.from(years)
      .sort()
      .map(year => this.getYearlySummary(year));
  }

  /**
   * Get total tax paid across all years
   */
  getTotalTaxPaid(): number {
    const summaries = this.getAllYearlySummaries();
    return summaries.reduce((sum, s) => sum + s.estimatedTax, 0);
  }

  /**
   * Find lots that would result in a loss if sold at current price
   * Useful for tax loss harvesting
   */
  findLossHarvestingOpportunities(currentPrice: number): FIFOLot[] {
    return this.lots.filter(
      lot => lot.remainingQuantity > 0 && lot.unitCostEUR > currentPrice
    );
  }

  /**
   * Get buy statistics
   */
  getBuyStats(): {
    totalBuys: number;
    totalInvested: number;
    avgBuyPrice: number;
    dcaBuys: number;
    reriskBuys: number;
  } {
    const buys = this.trades.filter(
      t => t.type === 'DCA_BUY' || t.type === 'RERISK_BUY'
    );

    const totalInvested = buys.reduce((sum, t) => sum + t.totalEUR, 0);
    const totalBTC = buys.reduce((sum, t) => sum + t.btcAmount, 0);

    return {
      totalBuys: buys.length,
      totalInvested,
      avgBuyPrice: totalBTC > 0 ? totalInvested / totalBTC : 0,
      dcaBuys: buys.filter(t => t.type === 'DCA_BUY').length,
      reriskBuys: buys.filter(t => t.type === 'RERISK_BUY').length,
    };
  }

  /**
   * Get sell statistics
   */
  getSellStats(): {
    totalSells: number;
    totalProceeds: number;
    avgSellPrice: number;
    swingSells: number;
    taxHarvestSells: number;
    winRate: number;
  } {
    const sells = this.trades.filter(
      t => t.type === 'SWING_SELL' || t.type === 'TAX_HARVEST_SELL'
    );

    const totalProceeds = sells.reduce((sum, t) => sum + t.totalEUR, 0);
    const totalBTC = sells.reduce((sum, t) => sum + t.btcAmount, 0);
    const profitableSells = sells.filter(t => (t.realizedGainEUR || 0) > 0).length;

    return {
      totalSells: sells.length,
      totalProceeds,
      avgSellPrice: totalBTC > 0 ? totalProceeds / totalBTC : 0,
      swingSells: sells.filter(t => t.type === 'SWING_SELL').length,
      taxHarvestSells: sells.filter(t => t.type === 'TAX_HARVEST_SELL').length,
      winRate: sells.length > 0 ? profitableSells / sells.length : 0,
    };
  }

  /**
   * Clone the ledger (for simulation)
   */
  clone(): DCASwingFIFOLedger {
    const newLedger = new DCASwingFIFOLedger(this.taxConfig);
    newLedger.lots = JSON.parse(JSON.stringify(this.lots));
    newLedger.trades = JSON.parse(JSON.stringify(this.trades));
    newLedger.realizedGains = JSON.parse(JSON.stringify(this.realizedGains));
    return newLedger;
  }

  /**
   * Reset the ledger
   */
  reset(): void {
    this.lots = [];
    this.trades = [];
    this.realizedGains = [];
  }
}

/**
 * utils/ratingSignals.ts
 *
 * ONE place that turns a scan's canonical (v1) fields into the extra risk
 * signals the recommendation engine uses.
 *
 * Why this exists: four screens rate items — results, Hunt Discovery Analysis,
 * Deep Analysis and the Flip Record. Only results passed these signals, so the
 * same item could be RISKY BUY on results and BUY in Deep Analysis or Hunt
 * (basic item, obvious damage, narrow buyer pool, unconfirmed era, low price
 * confidence were simply ignored). Every screen now reads them from here, so
 * the four cannot drift apart again.
 *
 * Pure: no React, no storage, no network.
 */

export interface RatingSignals {
    buyerPool?:        string;
    basicItem?:        boolean;
    hasObviousDamage?: boolean;
    eraUnconfirmed?:   boolean;
    priceConfidence?:  number;
    confidenceTier?:   'high' | 'medium' | 'low' | null;
  }
  
  /** The canonical v1 block, wherever this object keeps it. */
  export function v1Of(entry: unknown): any {
    const e = entry as any;
    if (!e) return undefined;
    return e.structured?.v1           // FlipResult (results snapshot, saved flips, hunt projections)
      ?? e.identification?.v1         // ScanResult (fresh scans, hunt scan snapshots)
      ?? e.scanSnapshot?.identification?.v1  // HuntItem / HuntBundleItem
      ?? undefined;
  }
  
  /** The risk signals for computeFlipCalc / findBuyUnderPrice. Empty for v0 scans. */
  export function ratingSignalsFromV1(v1: any): RatingSignals {
    if (!v1 || typeof v1 !== 'object') return {};
    return {
      buyerPool:        v1.buyerPool,
      basicItem:        v1.basicItem === true,
      hasObviousDamage: (v1.obviousDamage?.length ?? 0) > 0,
      eraUnconfirmed:   (v1.eraStatus ?? '') === 'unknown',
      priceConfidence:  v1.priceConfidence,
      confidenceTier:   v1.confidenceTier,
    };
  }
  
  /** Convenience: signals straight from a FlipResult, ScanResult or hunt item. */
  export function ratingSignalsFor(entry: unknown): RatingSignals {
    return ratingSignalsFromV1(v1Of(entry));
  }
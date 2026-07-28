/**
 * huntItemToFlip — project a nested HuntBundleItem into a FlipResult.
 *
 * Kept hunt items get the same Flip Record as a normal scan, but they are NOT
 * top-level flips: they live inside HuntBundle.keptItems so that hunt finds
 * never appear as their own rows in Scan History. Screens that render a
 * FlipResult therefore need a projection rather than a store lookup.
 *
 * This was previously inlined in hunt-history.tsx purely to feed Deep Analysis.
 * It lives here now because scan-detail needs the identical shape — two copies
 * would drift, and a drift between them shows up as a Flip Record that
 * disagrees with the Deep Analysis opened from the same item.
 *
 * Writes never go through this projection. Mutations must call
 * useFlipStore.updateHuntItem(bundleId, huntItemId, updates), which patches the
 * item inside its bundle and re-syncs. updateFlip() cannot reach a hunt item —
 * it filters bundles out before syncing, so the write would silently no-op.
 */
import type {
  FlipResult, HuntBundleItem, HistoryEntry, BuyLabel, Platform,
} from '@/types/flip';
import { isHuntBundle } from '@/types/flip';

/**
 * A FlipResult projected out of a hunt bundle, tagged with where it came from.
 *
 * The tag exists because a hunt item is not addressable by id alone: it lives
 * inside a bundle, so any screen that lets the user open one has to pass
 * bundleId + huntItemId through to scan-detail. Structural typing means these
 * pass anywhere a plain FlipResult is expected.
 */
export type SourcedFlip = FlipResult & {
  huntSource?: { bundleId: string; huntItemId: string };
};

export function huntItemToFlip(item: HuntBundleItem, timestamp?: number): FlipResult {
  const snap = item.scanSnapshot;
  const id   = snap?.identification;
  const md   = snap?.market_data;
  const ra   = snap?.risk_analysis;

  const thriftPrice = item.thriftPrice ?? 0;
  const profit      = item.profit ?? 0;

  return {
    id:        item.scanId,
    imageUri:  item.imageUri,
    timestamp: timestamp ?? Date.now(),

    // Identification — prefer the full AI snapshot, fall back to the summary
    // fields denormalised onto the bundle item.
    itemName:    id?.item_name      ?? item.itemName,
    brand:       id?.brand          ?? item.brand,
    category:    id?.category       ?? item.category,
    era:         id?.estimated_era  ?? '',
    styleLabels: id?.style_labels   ?? [],
    material:    id?.material_guess ?? '',
    structured:  id as FlipResult['structured'],

    // Market data
    resaleValue:      md?.adjusted_estimated_value ?? 0,
    resaleRangeLow:   md?.estimated_resale_range?.low  ?? 0,
    resaleRangeHigh:  md?.estimated_resale_range?.high ?? 0,
    avgSoldPrice:     md?.average_sold_price ?? 0,
    demand:           md?.demand     ?? 'Medium',
    sellSpeed:        md?.sell_speed ?? 'Moderate',
    competitionLevel: md?.competition_level ?? '',
    matchConfidence:  ra?.match_confidence ?? 0,
    riskFlags:        ra?.risk_flags ?? [],

    // User-confirmed + derived
    thriftPrice,
    fees:   0,
    profit,
    roi:    item.roi ?? (thriftPrice > 0 ? Math.round((profit / thriftPrice) * 100) : 0),

    // Legacy System A fields. Retained only because FlipResult still requires
    // them; nothing on the Flip Record reads them for a hunt item. They go away
    // with the System A deletion.
    buyScore:     0,
    buyLabel:     '✅ BUY' as BuyLabel,
    stars:        3,
    bestPlatform: 'eBay' as Platform,

    // ── Flip Record state ─────────────────────────────────────────────────────
    // Persisted on the bundle item. Absent on bundles saved before Flip Record
    // support existed, hence the defaults — no migration needed.
    status:            item.status ?? 'scanned',
    soldPrice:         item.soldPrice,
    soldAt:            item.soldAt,
    listingsGenerated: item.listingsGenerated ?? false,
    generatedAt:       item.generatedAt ?? null,
    listingData:       item.listingData ?? null,
  };
}


/**
 * Every KEPT hunt item across all bundles, projected into FlipResults.
 *
 * Kept only. Removed items were passed on — counting them would inflate scan
 * counts and profit with things the user explicitly decided not to buy.
 */
export function keptHuntFlips(entries: HistoryEntry[]): SourcedFlip[] {
  const out: SourcedFlip[] = [];
  for (const entry of entries) {
    if (!isHuntBundle(entry)) continue;
    for (const item of entry.keptItems) {
      out.push({
        ...huntItemToFlip(item, entry.endedAt),
        huntSource: { bundleId: entry.id, huntItemId: item.huntItemId },
      });
    }
  }
  return out;
}

/**
 * Standalone scans plus kept hunt items, as one flat list.
 *
 * Use for any user-facing lifetime stat — profit, ROI, scan count, realized
 * profit. A hunt find is a real find and should count exactly like any other.
 *
 * Do NOT use for:
 *   - useFlipStore.globalStats — it already aggregates bundles separately,
 *     so this would double-count.
 *   - lib/achievements.ts totalScans — hunt has its own achievement track,
 *     and folding it in would award the same activity twice.
 */
export function allScanFlips(entries: HistoryEntry[]): SourcedFlip[] {
  const normal = entries.filter((e): e is FlipResult => !isHuntBundle(e));
  return [...normal, ...keptHuntFlips(entries)];
}
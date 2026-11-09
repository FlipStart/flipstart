/**
 * server/monetization/scanPacks.ts
 *
 * THE authoritative scan-pack catalog.
 *
 * ── One map, server-owned ───────────────────────────────────────────────────
 * Scan counts are derived from the STORE SKU and nothing else. Never from price,
 * localized price, package order, display name, RevenueCat's internal product id,
 * or anything the client sends. A phone must never be able to say "grant me 1200
 * scans", and a price change must never silently change a grant.
 *
 * Frozen so a runtime mutation cannot alter a grant.
 *
 * ── Pack pricing V2 (Nov 2026) ───────────────────────────────────────────────
 * The App Store product ids are permanent, so they keep their original names;
 * the number in an id is NOT its scan count any more:
 *
 *   id                         pack         scans   price
 *   flipstart_scan_pack_40     FlipNoob        40   $1.99
 *   flipstart_scan_pack_110    FlipStarter    150   $4.99
 *   flipstart_scan_pack_300    FlipPro        400   $9.99
 *   flipstart_scan_pack_700    FlipLegend   1,200  $24.99
 *   flipstart_scan_pack_1200   FlipGod      2,000  $39.99
 *
 * Prices live in App Store Connect only. The counts before V2 are kept in
 * SCAN_PACK_SKUS_V1 for the founder dashboard's history and nothing else.
 */
export const SCAN_PACK_SKUS = Object.freeze({
  flipstart_scan_pack_40:   40,
  flipstart_scan_pack_110:  150,
  flipstart_scan_pack_300:  400,
  flipstart_scan_pack_700:  1200,
  flipstart_scan_pack_1200: 2000,
} as const);

/** What each pack granted before pricing V2. History only — never used to grant. */
export const SCAN_PACK_SKUS_V1 = Object.freeze({
  flipstart_scan_pack_40:   40,
  flipstart_scan_pack_110:  110,
  flipstart_scan_pack_300:  300,
  flipstart_scan_pack_700:  700,
  flipstart_scan_pack_1200: 1200,
} as const);

export type ScanPackSku = keyof typeof SCAN_PACK_SKUS;

/**
 * Namespace for FlipStart scan packs.
 *
 * Used to tell two very different situations apart:
 *   - an unrelated product we simply do not handle  -> ignore quietly
 *   - something that LOOKS like our scan pack but is not in the map
 *     -> configuration drift, and a real customer may have paid for it
 */
export const SCAN_PACK_PREFIX = "flipstart_scan_pack_";

export function isKnownScanPack(sku: string | null | undefined): sku is ScanPackSku {
  return !!sku && Object.prototype.hasOwnProperty.call(SCAN_PACK_SKUS, sku);
}

/** Looks like ours but is not in the map — catalog/code drift. */
export function looksLikeScanPack(sku: string | null | undefined): boolean {
  return !!sku && sku.startsWith(SCAN_PACK_PREFIX) && !isKnownScanPack(sku);
}

export function scansForSku(sku: string): number | null {
  return isKnownScanPack(sku) ? SCAN_PACK_SKUS[sku] : null;
}

export type PackResolution =
  | { kind: "known"; sku: ScanPackSku; scans: number }
  /** Not ours. Safe to acknowledge and ignore. */
  | { kind: "unrelated" }
  /**
   * Ours by naming but absent from the map. NEVER acknowledged as done:
   * a paying customer would be silently granted zero scans. Retryable, so the
   * catalog can be fixed and the event reprocessed.
   */
  | { kind: "drift"; sku: string };

export function resolveScanPack(storeIdentifier: string | null | undefined): PackResolution {
  if (isKnownScanPack(storeIdentifier)) {
    return { kind: "known", sku: storeIdentifier, scans: SCAN_PACK_SKUS[storeIdentifier] };
  }
  if (looksLikeScanPack(storeIdentifier)) return { kind: "drift", sku: storeIdentifier as string };
  return { kind: "unrelated" };
}
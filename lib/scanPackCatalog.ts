/**
 * lib/scanPackCatalog.ts
 *
 * The five Scan Packs, as display metadata. Pure — no React, no SDK, no server.
 *
 * ── This file is not the authority on anything that costs money ─────────────
 * The quantities below are what the CARD SAYS. They are not what gets granted.
 * The server resolves the real quantity from the canonical RevenueCat V2
 * purchase against its own frozen SKU map, so a tampered client that edits
 * `scans: 40` to `scans: 99999` changes a label and nothing else.
 *
 * Prices are never here at all. They come from live RevenueCat products, in the
 * user's own currency. A hardcoded "$1.99" would be correct in exactly one
 * storefront and a lie in every other.
 *
 * ── Why quantities live here at all ─────────────────────────────────────────
 * The user has to know what they are buying before they buy it, and the price
 * sheet cannot tell them — RevenueCat returns a price and a title, not a scan
 * count. So the count is product metadata, mirrored from the server SKU map,
 * and a test pins the two together.
 */

/** No imports, by design — see the module comment. */

/**
 * Store product identifiers. Must match server/monetization's frozen SKU map
 * and App Store Connect exactly.
 */
export const PACK_SKUS = [
    "flipstart_scan_pack_40",
    "flipstart_scan_pack_110",
    "flipstart_scan_pack_300",
    "flipstart_scan_pack_700",
    "flipstart_scan_pack_1200",
  ] as const;
  
  export type PackSku = (typeof PACK_SKUS)[number];
  
  export interface ScanPack {
    sku: PackSku;
    /** RevenueCat custom package identifier inside the `scan_packs` offering. */
    packageId: string;
    /** Display name. Playful on purpose — but never the primary information. */
    name: string;
    /** Scans this pack adds. Mirrors the server SKU map; never sent to the server. */
    scans: number;
  }
  
  /**
   * The catalog, in ascending order.
   *
   * Ordered smallest-first so the cheapest entry point is the first thing a
   * hesitant buyer sees, rather than being led with the most expensive.
   */
  export const SCAN_PACKS: ScanPack[] = [
    { sku: "flipstart_scan_pack_40",   packageId: "scans-40",   name: "FlipNoob",    scans: 40 },
    { sku: "flipstart_scan_pack_110",  packageId: "scans-110",  name: "FlipStarter", scans: 110 },
    { sku: "flipstart_scan_pack_300",  packageId: "scans-300",  name: "FlipPro",     scans: 300 },
    { sku: "flipstart_scan_pack_700",  packageId: "scans-700",  name: "FlipLegend",  scans: 700 },
    { sku: "flipstart_scan_pack_1200", packageId: "scans-1200", name: "FlipGod",     scans: 1200 },
  ];
  
  /** The RevenueCat offering packs live in. Deliberately not the current offering. */
  export const SCAN_PACK_OFFERING_ID = "scan_packs";
  
  export function packBySku(sku: string): ScanPack | null {
    return SCAN_PACKS.find(p => p.sku === sku) ?? null;
  }
  
  // ── Best value ──────────────────────────────────────────────────────────────
  
  export interface PackPricing {
    sku: PackSku;
    /** Numeric amount, for arithmetic only. Never rendered. */
    priceAmount: number | null;
    currencyCode: string | null;
  }
  
  /**
   * Which pack genuinely offers the most scans per unit of currency.
   *
   * Returns null — meaning show NO badge — whenever the claim cannot be made
   * honestly:
   *
   *   • fewer than all five priced      → an incomplete comparison is not a
   *                                       comparison
   *   • any currency missing or mixed   → comparing 39.99 USD against 4.99 EUR is
   *                                       an exchange rate, not a better deal, and
   *                                       storefronts really do differ
   *   • a tie                           → "BEST VALUE" on one of two equals is
   *                                       arbitrary and therefore misleading
   *
   * Computed rather than hardcoded on FlipGod. At the intended prices FlipGod
   * does win, but pricing is configuration: it can change in App Store Connect
   * without anyone touching this file, and a stale badge is a false claim about
   * money.
   */
  export function bestValueSku(pricing: PackPricing[]): PackSku | null {
    if (pricing.length !== SCAN_PACKS.length) return null;
  
    const currencies = new Set<string>();
    const rates: { sku: PackSku; perScan: number }[] = [];
  
    for (const p of pricing) {
      const pack = packBySku(p.sku);
      if (!pack) return null;
      if (p.priceAmount === null || !Number.isFinite(p.priceAmount) || p.priceAmount <= 0) return null;
      if (!p.currencyCode) return null;
      currencies.add(p.currencyCode);
      rates.push({ sku: p.sku, perScan: p.priceAmount / pack.scans });
    }
  
    if (currencies.size !== 1) return null;
  
    rates.sort((a, b) => a.perScan - b.perScan);
    const [best, runnerUp] = rates;
    // A tie makes the badge arbitrary. Say nothing instead.
    if (runnerUp && best.perScan === runnerUp.perScan) return null;
    return best.sku;
  }
  
  /**
   * Thousands separator for scan counts.
   *
   * Local rather than imported so this module stays import-free and testable in a
   * bare runner. It mirrors `fmt` in lib/scanBalanceDisplay.ts.
   */
  export function formatScans(n: number): string {
    return n.toLocaleString("en-US");
  }
/**
 * __tests__/monetization/scan-store.test.ts
 *
 * Phase 8 — the real Scan Store.
 *
 * The catalog and intent rules are pure and executed here. The store screen's
 * guarantees — no optimistic balance, one purchase in flight, server-confirmed
 * counts — are source assertions, which is the honest tool for "this file must
 * never contain that arithmetic".
 */
import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  PACK_SKUS, SCAN_PACKS, SCAN_PACK_OFFERING_ID,
  bestValueSku, formatScans, packBySku, type PackPricing,
} from "@/lib/scanPackCatalog";
import {
  __resetScanStoreIntent, clearScanStoreIntent, consumeScanStoreIntent,
  peekScanStoreIntent, scanStoreEntryMode, setScanStoreIntent,
} from "@/lib/scanStoreIntent";

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

/** Strip comments before asserting ABSENCE. Learned the hard way in Phase 2. */
function stripComments(src: string): string {
  let out = ""; let mode: "code"|"line"|"block"|"sq"|"dq"|"tpl" = "code"; let i = 0;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (mode === "code") {
      if (c === "/" && n === "/") { mode = "line"; i += 2; continue; }
      if (c === "/" && n === "*") { mode = "block"; i += 2; continue; }
      if (c === "'") mode = "sq"; else if (c === '"') mode = "dq"; else if (c === "`") mode = "tpl";
      out += c; i++; continue;
    }
    if (mode === "line") { if (c === "\n") { mode = "code"; out += c; } i++; continue; }
    if (mode === "block") { if (c === "*" && n === "/") { mode = "code"; i += 2; } else i++; continue; }
    if (c === "\\") { out += c + (src[i + 1] ?? ""); i += 2; continue; }
    if ((mode === "sq" && c === "'") || (mode === "dq" && c === '"') || (mode === "tpl" && c === "`")) mode = "code";
    out += c; i++;
  }
  return out;
}
const code = (src: string) => stripComments(src);

const STORE = read("app/scan-store.tsx");
const GATE = read("lib/useScanGate.ts");
const PURCHASES = read("lib/purchases.ts");

// ── 1-7. Catalog ────────────────────────────────────────────────────────────

describe("scan pack catalog", () => {
  it("has exactly five packs", () => {
    expect(SCAN_PACKS).toHaveLength(5);
    expect(PACK_SKUS).toHaveLength(5);
  });

  /** Requirement 2. Wrong id = a purchase that resolves nothing. */
  it("uses the canonical product ids", () => {
    expect(SCAN_PACKS.map(p => p.sku)).toEqual([
      "flipstart_scan_pack_40",
      "flipstart_scan_pack_110",
      "flipstart_scan_pack_300",
      "flipstart_scan_pack_700",
      "flipstart_scan_pack_1200",
    ]);
  });

  /** Requirement 3. */
  it("uses the canonical package ids and offering", () => {
    expect(SCAN_PACKS.map(p => p.packageId)).toEqual([
      "scans-40", "scans-110", "scans-300", "scans-700", "scans-1200",
    ]);
    expect(SCAN_PACK_OFFERING_ID).toBe("scan_packs");
  });

  /** Requirements 4-5. */
  it("uses the exact quantities and names", () => {
    expect(SCAN_PACKS.map(p => p.scans)).toEqual([40, 110, 300, 700, 1200]);
    expect(SCAN_PACKS.map(p => p.name)).toEqual([
      "FlipNoob", "FlipStarter", "FlipPro", "FlipLegend", "FlipGod",
    ]);
  });

  /**
   * Requirement 26. The catalog's SKUs must match the purchase service's,
   * because that is what actually resolves the package.
   */
  it("matches the purchase service's SKU list exactly", () => {
    for (const sku of PACK_SKUS) expect(PURCHASES).toContain(`"${sku}"`);
  });

  /** Requirements 6-7. Consumables carry no entitlement and never expire. */
  it("carries no entitlement or expiry metadata", () => {
    const src = code(read("lib/scanPackCatalog.ts"));
    expect(src).not.toMatch(/entitlement|"pro"|expir|renew|subscription/i);
    // And the file stays importable from a bare runner.
    expect(src).not.toMatch(/^\s*import /m);
  });

  it("formats large counts readably", () => {
    expect(formatScans(1200)).toBe("1,200");
    expect(formatScans(40)).toBe("40");
  });

  it("resolves a pack by sku", () => {
    expect(packBySku("flipstart_scan_pack_700")?.name).toBe("FlipLegend");
    expect(packBySku("nope")).toBeNull();
  });
});

// ── 8. Best value ───────────────────────────────────────────────────────────

describe("best value", () => {
  const usd = (amounts: number[]): PackPricing[] =>
    SCAN_PACKS.map((p, i) => ({ sku: p.sku, priceAmount: amounts[i], currencyCode: "USD" }));

  /** At the intended prices FlipGod genuinely wins — computed, not assumed. */
  it("picks FlipGod at the intended pricing", () => {
    expect(bestValueSku(usd([1.99, 4.99, 11.99, 24.99, 39.99]))).toBe("flipstart_scan_pack_1200");
  });

  /**
   * The badge follows the DATA, not the biggest pack. If App Store pricing
   * changed so FlipPro won, a hardcoded FlipGod badge would be a false claim
   * about money.
   */
  it("follows the pricing rather than the pack size", () => {
    expect(bestValueSku(usd([1.99, 4.99, 1.00, 24.99, 39.99]))).toBe("flipstart_scan_pack_300");
  });

  it("refuses across mixed currencies", () => {
    const mixed = usd([1.99, 4.99, 11.99, 24.99, 39.99]);
    mixed[4] = { ...mixed[4], currencyCode: "EUR" };
    expect(bestValueSku(mixed)).toBeNull();
  });

  it("refuses on an incomplete set", () => {
    expect(bestValueSku(usd([1.99, 4.99, 11.99, 24.99, 39.99]).slice(0, 4))).toBeNull();
  });

  it("refuses when any price is missing or invalid", () => {
    const noPrice = usd([1.99, 4.99, 11.99, 24.99, 39.99]);
    noPrice[2] = { ...noPrice[2], priceAmount: null };
    expect(bestValueSku(noPrice)).toBeNull();
    const zero = usd([1.99, 4.99, 0, 24.99, 39.99]);
    expect(bestValueSku(zero)).toBeNull();
  });

  /** A tie makes the badge arbitrary. Say nothing. */
  it("refuses on a tie", () => {
    // 40 @ 2.00 and 110 @ 5.50 are both exactly 0.05/scan.
    const tie = usd([2.00, 5.50, 99, 99, 99]);
    expect(bestValueSku(tie)).toBeNull();
  });
});

// ── 41-58. Entry modes and intent ───────────────────────────────────────────

describe("store entry intent", () => {
  beforeEach(() => __resetScanStoreIntent());

  /** Requirement 41. No intent armed = browse. */
  it("defaults to browse", () => {
    expect(scanStoreEntryMode()).toBe("browse");
    expect(peekScanStoreIntent()).toBeNull();
  });

  it("switches to resume mode once an intent is armed", () => {
    setScanStoreIntent({ origin: "home", uid: "A", resume: () => {} });
    expect(scanStoreEntryMode()).toBe("resume_scan");
  });

  /** Requirements 48, 50. Exactly once, structurally. */
  it("hands the intent out only once", () => {
    let fired = 0;
    setScanStoreIntent({ origin: "home", uid: "A", resume: () => { fired += 1; } });
    const first = consumeScanStoreIntent("A");
    expect(first).not.toBeNull();
    first!.resume();
    expect(consumeScanStoreIntent("A")).toBeNull();
    expect(fired).toBe(1);
  });

  /** Requirements 49, 51. Hunt must resume as Hunt. */
  it("preserves the origin it was armed with", () => {
    setScanStoreIntent({ origin: "hunt", uid: "A", resume: () => {} });
    expect(consumeScanStoreIntent("A")?.origin).toBe("hunt");
  });

  /** Requirements 60-62. */
  it("refuses to hand A's intent to B, and discards it", () => {
    let fired = 0;
    setScanStoreIntent({ origin: "home", uid: "A", resume: () => { fired += 1; } });
    expect(consumeScanStoreIntent("B")).toBeNull();
    // Discarded, not left lying around for A to pick up later.
    expect(consumeScanStoreIntent("A")).toBeNull();
    expect(fired).toBe(0);
  });

  /** Requirements 56-57. Backing out abandons the scan for good. */
  it("clears on abandonment and cannot resume later", () => {
    setScanStoreIntent({ origin: "home", uid: "A", resume: () => {} });
    clearScanStoreIntent();
    expect(scanStoreEntryMode()).toBe("browse");
    expect(consumeScanStoreIntent("A")).toBeNull();
  });

  /** A newer attempt is the one the user wants resumed. */
  it("replaces an older intent rather than queueing", () => {
    setScanStoreIntent({ origin: "home", uid: "A", resume: () => {} });
    setScanStoreIntent({ origin: "hunt", uid: "A", resume: () => {} });
    expect(consumeScanStoreIntent("A")?.origin).toBe("hunt");
  });

  /** A null uid on both sides still matches — signed-out is a real state. */
  it("matches a null uid consistently", () => {
    setScanStoreIntent({ origin: "home", uid: null, resume: () => {} });
    expect(consumeScanStoreIntent(null)).not.toBeNull();
  });

  it("stays importable from a bare runner and persists nothing", () => {
    const src = code(read("lib/scanStoreIntent.ts"));
    expect(src).not.toMatch(/^\s*import /m);
    expect(src).not.toMatch(/AsyncStorage|SecureStore|localStorage/);
  });
});

// ── 22-31. Purchase flow ────────────────────────────────────────────────────

describe("purchase flow", () => {
  /** Requirement 23. One service, reused — no second grant path. */
  it("uses the centralized Phase 3 purchase service", () => {
    expect(STORE).toMatch(/purchaseScanPack\(sku, startedUid, \(\) => uidRef\.current \?\? null\)/);
    expect(STORE).toMatch(/recoverPacksOnServer\(\)/);
    const c = code(STORE);
    expect(c).not.toMatch(/react-native-purchases|purchasePackage\(/);
    // "granting" and "scansGranted" are legitimate here — the leak worth
    // catching is the store computing or naming a grant itself.
    expect(c).not.toMatch(/purchase_ledger|rc_purchase_id|grantScanPack|SKU_MAP/i);
  });

  /**
   * Requirement 27, and the single most important assertion in this file.
   *
   * No optimistic arithmetic anywhere. A RevenueCat success is not scans; the
   * server reconciling a canonical V2 purchase is.
   */
  it("never adds to the balance locally", () => {
    const c = code(STORE);
    expect(c).not.toMatch(/setPackBalance|packBalance\s*\+|balance\s*\+=|\+\s*pack\.scans|\+\s*scans\b/);
    // The displayed number comes straight from the authoritative read model.
    expect(c).toMatch(/const packBalance = ent\.packScansRemaining;/);
  });

  /** Requirement 26. The card's number is a label, never a grant request. */
  it("never sends a quantity to the server", () => {
    const c = code(STORE);
    expect(c).not.toMatch(/quantity:/);
    // The confirmed count is the server's.
    expect(c).toMatch(/const granted = r\.scansGranted \?\? null;/);
  });

  /** Requirements 24-25. */
  it("allows only one purchase in flight", () => {
    expect(STORE).toMatch(/if \(busy\) return;\s*\/\/ one purchase at a time/);
    expect(STORE).toMatch(/const busy = phase !== 'idle';/);
    // Every Buy button is disabled while any purchase runs.
    expect(STORE).toMatch(/disabled=\{!available \|\| busy\}/);
  });

  /** Requirement 30. Cancellation is benign — no notice at all. */
  it("treats cancellation as benign", () => {
    expect(STORE).toMatch(/if \(r\.status === 'cancelled'\)/);
    expect(STORE).toMatch(/return;\s*\/\/ benign — no notice at all/);
  });

  /** Requirement 31. Sanitized, never a raw store code. */
  it("sanitizes failures", () => {
    expect(STORE).toMatch(/text: r\.message \?\?/);
    expect(code(STORE)).not.toMatch(/SKErrorDomain|RCPurchases|errorCode/);
  });

  /** Requirement 14. No fake price before RevenueCat resolves. */
  it("shows no hardcoded price", () => {
    const c = code(STORE);
    for (const p of ["$1.99", "$4.99", "$11.99", "$24.99", "$39.99"]) {
      expect(c).not.toContain(p);
    }
    expect(STORE).toMatch(/priceString \?\? 'Currently unavailable'/);
  });

  /** Requirement 11. A false zero reads as a lost balance. */
  it("uses a neutral skeleton while the balance is unresolved", () => {
    expect(STORE).toMatch(/const balanceReady = ent\.status === 'ready';/);
    expect(STORE).toMatch(/balanceReady \? \(/);
    expect(STORE).toMatch(/<Skeleton width=\{104\}/);
  });

  /** Requirements 36-40. One invalidation refreshes every consumer. */
  it("refreshes authoritative state after every grant", () => {
    expect(STORE).toMatch(/useRefreshEntitlement/);
    expect((STORE.match(/invalidateEntitlement\(\)/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});

// ── 15-16. Product loading ──────────────────────────────────────────────────

describe("product loading", () => {
  /** Requirement 15. One bad product must not take down the store. */
  it("reports missing products without failing the rest", () => {
    expect(PURCHASES).toMatch(/const missing: ScanPackSku\[\] = \[\];/);
    expect(PURCHASES).toMatch(/if \(products\.length === 0\)/);
    expect(PURCHASES).toMatch(/status: "ready", products, missing/);
  });

  /** Requirement 16. */
  it("offers a retry when the whole offering fails", () => {
    expect(STORE).toContain("Scan Store is temporarily unavailable.");
    expect(STORE).toMatch(/onPress=\{\(\) => setAttempt\(n => n \+ 1\)\}/);
    expect(STORE).toMatch(/accessibilityLabel="Retry loading the Scan Store"/);
  });

  /** Reuses the one resolver, so display and purchase cannot disagree. */
  it("resolves products through the existing package resolver", () => {
    expect(PURCHASES).toMatch(/SCAN_PACK_SKUS\.map\(async sku => \(\{ sku, \.\.\.\(await resolvePackPackage\(sdk, sku\)\) \}\)\)/);
  });
});

// ── 45-55. Resume behaviour ─────────────────────────────────────────────────

describe("resume behaviour", () => {
  /** Requirements 46, 54. Payment is not scans. */
  it("requires an authoritative usable balance before resuming", () => {
    expect(STORE).toMatch(/if \(!\(typeof total === 'number' && total > 0\)\) return false;/);
    expect(STORE).toMatch(/await invalidateEntitlement\(\)\.catch\(\(\) => null\)/);
  });

  /** Requirements 43, 42. Browse never opens the camera. */
  it("resumes only in resume mode", () => {
    expect(STORE).toMatch(/if \(entryMode !== 'resume_scan' \|\| resumedRef\.current\) return false;/);
  });

  /** Requirement 48. */
  it("resumes exactly once", () => {
    expect(STORE).toMatch(/resumedRef\.current = true;/);
    expect(STORE).toMatch(/const resumedRef = useRef\(false\);/);
  });

  /** Requirement 62. A stale continuation is not a failed purchase. */
  it("keeps a purchase successful when the continuation is stale", () => {
    const c = code(STORE);
    const fn = c.slice(c.indexOf("const maybeResume"), c.indexOf("const buy ="));
    expect(fn).toMatch(/if \(!intent\) return false;/);
    // No error surfaced on that path.
    expect(fn).not.toMatch(/tone: 'error'/);
  });

  /** Requirement 56. */
  it("discards the intent when the user backs out", () => {
    expect(STORE).toMatch(/const goBack = useCallback\(\(\) => \{\s*\r?\n\s*clearScanStoreIntent\(\);/);
  });

  /** Requirement 59-60. */
  it("clears store state and intent on an account switch", () => {
    expect(STORE).toMatch(/lastUid\.current = uid;\s*\r?\n\s*clearScanStoreIntent\(\);/);
  });

  /** The gate arms the intent for BOTH exhausted paths. */
  it("arms the intent from the scan gate, not from route params", () => {
    expect(GATE).toMatch(/setScanStoreIntent\(\{ origin: attempt\.origin, uid: openedUid, resume: runOnce \}\)/);
    expect((GATE.match(/armStoreIntent\(\);/g) ?? []).length).toBe(2);
    // The continuation shares the gate's one-shot guard.
    expect(GATE).toMatch(/resume: runOnce/);
  });

  /** Requirement 41. Voluntary entry must not inherit an old intent. */
  it("clears the intent on voluntary entry from the balance sheet", () => {
    const home = read("app/(tabs)/index.tsx");
    expect(home).toMatch(/clearScanStoreIntent\(\);\s*\r?\n\s*router\.push\('\/scan-store' as any\)/);
  });
});

// ── 63-67. Recovery ─────────────────────────────────────────────────────────

describe("recovery", () => {
  /** Requirement 63. Consumables are recovered, not restored. */
  it("offers Recover Scan Purchases, not Restore Purchases", () => {
    expect(STORE).toContain("Recover Scan Purchases");
    expect(code(STORE)).not.toContain("Restore Purchases");
  });

  /** Requirements 64-65. */
  it("uses the existing server recovery flow", () => {
    expect(STORE).toMatch(/const r = await recoverPacksOnServer\(\);/);
    expect(STORE).toMatch(/await invalidateEntitlement\(\)\.catch\(\(\) => \{\}\)/);
  });

  /** Requirements 66-67. Counts are the server's; repeats add zero. */
  it("reports the server's count and stays calm when there is nothing", () => {
    expect(STORE).toMatch(/r\.totalScansGranted > 0/);
    expect(STORE).toContain("Your Scan Packs are already up to date.");
    expect(STORE).toMatch(/Recovered \$\{formatScans\(r\.totalScansGranted\)\} Pack Scans\./);
  });
});

// ── 8-10, 68-73, 79-85. Store content and regression ────────────────────────

describe("store content", () => {
  it("uses the exact title and subtitle", () => {
    expect(STORE).toMatch(/<Text style=\{s\.headerTitle\}>Scan Store<\/Text>/);
    expect(STORE).toContain("Stock up on extra scans whenever you need them.");
    expect(STORE).toContain("Pack Scans never expire and are used after your included scans.");
  });

  /** The sentence that prevents the most expensive misunderstanding. */
  it("states that packs do not unlock Pro", () => {
    expect(STORE).toContain("Scan Packs add scan quantity only and do not unlock FlipStart Pro.");
  });

  /** No Pro upsell inside the store. */
  it("sells no subscription", () => {
    const c = code(STORE);
    expect(c).not.toMatch(/Upgrade to Pro|Unlock Pro|Monthly Pro|Annual Pro|openProPaywall|Subscribe/);
  });

  /** Requirement 27. No expiry language anywhere. */
  it("promises no expiry", () => {
    expect(code(STORE)).not.toMatch(/expires|valid for|30 days|renew/i);
  });

  /**
   * The redesign's hierarchy: the name is the serif headline, the scan count
   * is a strong tracked line directly under it (never a footnote — it is what
   * they are buying), and the price is the largest figure on the row, since
   * it is the one thing a buyer compares across cards.
   */
  it("leads with the name, keeps the scan count strong, and makes the price the largest figure", () => {
    expect(STORE).toMatch(/packName: \{[^}]*fontSize: 17/);
    expect(STORE).toMatch(/packScans: \{[^}]*fontSize: 12[^}]*letterSpacing: 1\.6/);
    expect(STORE).toMatch(/packPrice: \{[^}]*fontSize: 19/);
    expect(STORE).toMatch(/\{formatScans\(scans\)\} SCANS/);
  });

  it("labels every purchase action accessibly", () => {
    expect(STORE).toMatch(/accessibilityLabel=\{working \? `Adding \$\{formatScans\(scans\)\} scans` : `Buy \$\{label\}`\}/);
    expect(STORE).toMatch(/accessibilityLabel=\{`\$\{formatScans\(packBalance\)\} pack scans remaining`\}/);
    expect(STORE).toMatch(/minHeight: 44/);
  });
});

describe("regression", () => {
  /** Requirements 74-78. Consumption order and accounting untouched. */
  it("leaves consumption order and allowances alone", () => {
    const policy = read("server/monetization/policy.ts");
    expect(policy).toMatch(/case "monthly":\s*\n\s*case "annual":\s*return \["subscription", "pack"\]/);
    expect(policy).toMatch(/case "free":\s*\n\s*default:\s*return \["free", "pack"\]/);
    expect(policy).toMatch(/export const FREE_LIFETIME_SCANS = 15;/);
  });

  /** Requirements 68-73. Packs never grant Pro. */
  it("keeps capability derived from plan alone", () => {
    const policy = read("server/monetization/policy.ts");
    expect(policy).toMatch(/case "scan_photo_3":/);
    expect(policy).toMatch(/Pack ownership is not a parameter here/);
  });

  /** Requirements 79-85. */
  it("leaves all five contextual paywalls intact", () => {
    expect(read("lib/useGenerateListingsGate.ts")).toMatch(/openProPaywall\("generate_listings"/);
    expect(read("lib/useDeepAnalysisGate.ts")).toMatch(/openProPaywall\("deep_analysis"/);
    const cam = read("app/camera.tsx");
    expect(cam).toMatch(/openProPaywall\('third_photo'/);
    expect(cam).toMatch(/openProPaywall\('camera_context'/);
    expect(GATE).toMatch(/openProPaywall\("scan_limit"/);
  });

  /** Requirements 84-85. */
  it("shows the Store alternative only on scan_limit", () => {
    const cfg = read("lib/paywallConfig.ts");
    expect(cfg).toMatch(/showScanStoreAlternative: true,/);
    expect((cfg.match(/showScanStoreAlternative: true,/g) ?? []).length).toBe(1);
  });

  /** Requirements 86-90. Server grant architecture untouched. */
  it("leaves the Phase 3 server grant path unchanged", () => {
    const routers = read("server/routers.ts");
    expect(routers).toMatch(/rpc\("consume_deep_analysis_preview"/);
    expect(PURCHASES).toMatch(/monetization\.recoverScanPacks\.mutate\(\)/);
    // The client still never names a quantity.
    expect(code(PURCHASES)).not.toMatch(/scansToGrant|quantity:\s*\d/);
  });
});
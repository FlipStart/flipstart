/**
 * server/monetization/revenuecatV2.ts
 *
 * RevenueCat V2 REST client. Server-only, read-only.
 *
 * ── Why V2 and not V1 ───────────────────────────────────────────────────────
 * Exactly-once granting needs ONE identifier that both grant paths see. V1's
 * `non_subscriptions[].id` and the webhook's `transaction_id` are different
 * namespaces, and keying on both would eventually double-grant.
 *
 * V2 gives a RevenueCat-owned canonical `purchase.id`. The webhook resolves it
 * by searching `store_purchase_identifier`; recovery reads it straight from the
 * customer purchases list. Same object, same id, one namespace.
 *
 * ── The store transaction id is a HINT ──────────────────────────────────────
 * `event.transaction_id` from the webhook is only ever used to LOOK UP the
 * purchase. It never becomes ledger identity, and it is never trusted as proof
 * that a purchase happened — V2 is the authority.
 */
import {
    SCAN_PACK_PREFIX, resolveScanPack, type PackResolution,
  } from "./scanPacks.js";
  
  const V2_BASE = "https://api.revenuecat.com/v2";
  const TIMEOUT_MS = 10_000;
  
  /** RevenueCat V2 purchase, trimmed to the fields FlipStart depends on. */
  export interface V2Purchase {
    id: string;                          // "purch..." — canonical identity
    customer_id?: string;
    product_id?: string;                 // RevenueCat INTERNAL id ("prod...")
    store_purchase_identifier?: string;  // the store's transaction id
    environment?: string;                // "production" | "sandbox"
    purchased_at?: number | string;
    status?: string;
    store?: string;
  }
  
  export interface V2Product {
    id: string;
    store_identifier?: string;           // the real SKU, e.g. flipstart_scan_pack_110
    type?: string;
  }
  
  export function isV2Configured(): boolean {
    return Boolean(
      (process.env.REVENUECAT_V2_SECRET_API_KEY ?? "").trim() &&
      (process.env.REVENUECAT_PROJECT_ID ?? "").trim(),
    );
  }
  
  export type PurchaseEnvironment = "sandbox" | "production";
  
  /**
   * The environment FlipStart operates in. Must be set EXPLICITLY.
   *
   * ── Why unset is not allowed ────────────────────────────────────────────────
   * V2's customer purchases endpoint treats an omitted `environment` as BOTH
   * environments. Leaving it unset in production would list sandbox purchases
   * alongside real ones, and the recovery path would happily grant scans for test
   * transactions. So an absent or malformed value fails configuration rather than
   * quietly querying everything.
   */
  export function purchaseEnvironment(): PurchaseEnvironment | null {
    const raw = (process.env.REVENUECAT_PURCHASE_ENVIRONMENT ?? "").trim().toLowerCase();
    if (raw === "sandbox" || raw === "production") return raw;
    if (raw) {
      console.error(
        `[rc-v2] REVENUECAT_PURCHASE_ENVIRONMENT="${raw}" is invalid — ` +
        `must be exactly "sandbox" or "production". Refusing to query both.`,
      );
    } else {
      console.error(
        "[rc-v2] REVENUECAT_PURCHASE_ENVIRONMENT not set — refusing to query both " +
        "environments. Set it to \"sandbox\" or \"production\".",
      );
    }
    return null;
  }
  
  type Fetched<T> = { ok: true; data: T } | { ok: false; reason: "not_configured" | "unavailable" | "not_found" };
  
  async function v2Get<T>(path: string): Promise<Fetched<T>> {
    const key = (process.env.REVENUECAT_V2_SECRET_API_KEY ?? "").trim();
    const project = (process.env.REVENUECAT_PROJECT_ID ?? "").trim();
    if (!key || !project) return { ok: false, reason: "not_configured" };
  
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${V2_BASE}/projects/${encodeURIComponent(project)}${path}`, {
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        signal: ctrl.signal,
      });
      if (res.status === 404) return { ok: false, reason: "not_found" };
      if (!res.ok) {
        // Everything non-2xx is "unavailable", NOT "no purchase". Treating a 500
        // or a 403 as absence would silently skip a real paid grant.
        console.warn(`[rc-v2] GET ${path} -> ${res.status}`);
        return { ok: false, reason: "unavailable" };
      }
      return { ok: true, data: await res.json() as T };
    } catch (e) {
      console.warn(`[rc-v2] GET ${path} failed:`, (e as Error).message);
      return { ok: false, reason: "unavailable" };
    } finally {
      clearTimeout(timer);
    }
  }
  
  /**
   * Find a purchase by the store transaction id from a webhook.
   *
   * Returns `unavailable` rather than `not_found` on any transport or auth
   * failure, because the caller must retry rather than acknowledge.
   */
  export type SearchResult =
    | { kind: "found"; purchase: V2Purchase }
    | { kind: "none" }
    /** Several purchases share the store id. Never resolved by guessing. */
    | { kind: "ambiguous"; count: number };
  
  export async function findPurchaseByStoreId(
    storePurchaseIdentifier: string,
  ): Promise<Fetched<SearchResult>> {
    const r = await v2Get<{ items?: V2Purchase[] }>(
      `/purchases?store_purchase_identifier=${encodeURIComponent(storePurchaseIdentifier)}`,
    );
    if (!r.ok) return r;
    const items = Array.isArray(r.data?.items) ? r.data.items : [];
  
    if (items.length === 0) return { ok: true, data: { kind: "none" } };
    /**
     * Taking items[0] would be a guess.
     *
     * A store transaction id is expected to identify one purchase, so more than
     * one match means something is wrong — a sandbox id collision, a data issue,
     * or an assumption of ours that is false. Granting on the first row could
     * credit the wrong purchase or the wrong customer.
     */
    if (items.length > 1) {
      console.error(
        `[rc-v2] AMBIGUOUS: ${items.length} purchases share one store id — not granting`,
      );
      return { ok: true, data: { kind: "ambiguous", count: items.length } };
    }
    return { ok: true, data: { kind: "found", purchase: items[0] } };
  }
  
  /**
   * All one-time purchases for a customer. Used by the recovery path.
   *
   * `environment=sandbox` is requested explicitly when configured, because Test
   * Store purchases are reported as sandbox data and would otherwise be filtered
   * out of a production-default listing.
   */
  export async function listCustomerPurchases(
    customerId: string,
  ): Promise<Fetched<V2Purchase[]>> {
    // Never omitted — see purchaseEnvironment().
    const env = purchaseEnvironment();
    if (!env) return { ok: false, reason: "not_configured" };
  
    const r = await v2Get<{ items?: V2Purchase[] }>(
      `/customers/${encodeURIComponent(customerId)}/purchases?environment=${env}`,
    );
    if (!r.ok) return r;
    return { ok: true, data: Array.isArray(r.data?.items) ? r.data.items : [] };
  }
  
  /**
   * RevenueCat internal product id -> store SKU.
   *
   * V2 purchase objects carry `prod...`, not the SKU, so the grant amount cannot
   * be resolved without this hop.
   *
   * Cached because the mapping is immutable for a given product and the alternative
   * is a second network call on every purchase. Bounded, and cleared wholesale
   * rather than aged — the map is tiny and staleness would require someone editing
   * a product's store identifier, which invalidates far more than this cache.
   */
  const productCache = new Map<string, string | null>();
  
  export async function resolveStoreIdentifier(
    internalProductId: string,
  ): Promise<Fetched<string | null>> {
    if (productCache.has(internalProductId)) {
      return { ok: true, data: productCache.get(internalProductId) ?? null };
    }
    const r = await v2Get<V2Product>(`/products/${encodeURIComponent(internalProductId)}`);
    if (!r.ok) return r;
    const sku = r.data?.store_identifier ?? null;
    if (productCache.size > 200) productCache.clear();
    productCache.set(internalProductId, sku);
    return { ok: true, data: sku };
  }
  
  export interface ResolvedPackPurchase {
    purchase: V2Purchase;
    storeIdentifier: string | null;
    resolution: PackResolution;
  }
  
  /** Attach the store SKU and the pack resolution to a V2 purchase. */
  export async function resolvePurchaseProduct(
    purchase: V2Purchase,
  ): Promise<Fetched<ResolvedPackPurchase>> {
    if (!purchase.product_id) {
      return { ok: true, data: { purchase, storeIdentifier: null, resolution: { kind: "unrelated" } } };
    }
    const p = await resolveStoreIdentifier(purchase.product_id);
    if (!p.ok) return p;
    return {
      ok: true,
      data: { purchase, storeIdentifier: p.data, resolution: resolveScanPack(p.data) },
    };
  }
  
  /** Quick pre-filter for the recovery path, before spending a product lookup. */
  export function couldBeScanPack(storeIdentifier: string | null | undefined): boolean {
    return !!storeIdentifier && storeIdentifier.startsWith(SCAN_PACK_PREFIX);
  }
  
  /** Test seam. */
  export function __resetV2Cache(): void { productCache.clear(); }
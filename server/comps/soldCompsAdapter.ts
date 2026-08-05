/**
 * server/comps/soldCompsAdapter.ts
 *
 * SoldComps implementation of SoldCompsProvider.
 *
 * Every request parameter and response field below is taken from the official
 * documentation at https://sold-comps.com/docs. Nothing here is inferred from
 * earlier planning documents — the docs are the contract, and guessing a
 * parameter name would either be silently ignored or 400 the request.
 *
 * The API key is read from process.env at call time and never leaves this file:
 * not in a log line, not in an error, not in a cache key, not in telemetry.
 */
import {
    CompsError, type CompsProviderResult, type CompsSearchRequest,
    type NormalizedSoldComp, type SoldCompsProvider,
  } from "./types.js";
  
  const BASE_URL = "https://api.sold-comps.com/v1/scrape";
  const DEFAULT_TIMEOUT_MS = 12_000;
  const MAX_RETRIES = 2;
  
  /** Documented enum values. Kept explicit so a typo cannot reach the wire. */
  const EBAY_SITE_US = "ebay.com";
  const SORT_ENDED_RECENTLY = "endedRecently";
  
  /** Documented bounds. count 1-240, daysToScrape 1-365. */
  const clampCount = (n: number) => Math.max(1, Math.min(240, Math.round(n)));
  const clampDays  = (n: number) => Math.max(1, Math.min(365, Math.round(n)));
  
  function parseMoney(v: unknown): number | null {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v !== "string") return null;
    const n = Number.parseFloat(v.replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  
  /**
   * Map one documented item to the neutral shape.
   *
   * Returns a reason string instead of throwing so a single malformed record
   * cannot discard an otherwise good page of results.
   */
  function normalizeItem(raw: unknown, provider: string): NormalizedSoldComp | string {
    if (!raw || typeof raw !== "object") return "NOT_AN_OBJECT";
    const r = raw as Record<string, unknown>;
  
    // Guard against active-listing records if `sold` were ever flipped: those
    // carry currentPrice instead of soldPrice and must never enter comps stats.
    if (r.listingType === "active") return "ACTIVE_LISTING";
  
    const title = typeof r.title === "string" ? r.title.trim() : "";
    if (!title) return "MISSING_TITLE";
  
    const soldPrice = parseMoney(r.soldPrice);
    if (soldPrice == null || soldPrice <= 0) return "MISSING_SOLD_PRICE";
  
    const externalId = typeof r.itemId === "string" ? r.itemId : "";
    if (!externalId) return "MISSING_ITEM_ID";
  
    const shippingPrice = parseMoney(r.shippingPrice);
    // totalPrice is documented as soldPrice + shippingPrice when BOTH are known.
    // Deriving it ourselves when shipping is null would invent a number.
    const buyerPaidTotal = parseMoney(r.totalPrice)
      ?? (shippingPrice != null ? soldPrice + shippingPrice : null);
  
    return {
      provider,
      externalId,
      title,
      soldPrice,
      shippingPrice,
      buyerPaidTotal,
      currency: typeof r.soldCurrency === "string" ? r.soldCurrency : "USD",
      condition: typeof r.condition === "string" ? r.condition : null,
      soldAt: typeof r.endedAt === "string" ? r.endedAt : null,
      listingUrl: typeof r.url === "string" ? r.url : null,
      imageUrl: typeof r.thumbnailUrl === "string" ? r.thumbnailUrl : null,
      bestOfferAccepted: typeof r.bestOfferAccepted === "boolean" ? r.bestOfferAccepted : null,
    };
  }
  
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
  
  export class SoldCompsAdapter implements SoldCompsProvider {
    readonly providerName = "soldcomps";
  
    constructor(private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS) {}
  
    async searchSold(
      req: CompsSearchRequest,
      options?: { signal?: AbortSignal },
    ): Promise<CompsProviderResult> {
      const key = (process.env.SOLDCOMPS_API_KEY ?? "").trim();
      if (!key) throw new CompsError("PROVIDER_NOT_CONFIGURED", "SOLDCOMPS_API_KEY is not set");
      if (!req.keyword.trim()) throw new CompsError("INVALID_REQUEST", "keyword is empty");
      if (req.marketplace !== "ebay_us") {
        throw new CompsError("INVALID_REQUEST", `unsupported marketplace ${req.marketplace}`);
      }
  
      // Only documented parameters. `sold` and `includeCompleteListing` both
      // default to true; setting them explicitly documents the intent at the call
      // site and protects against a future default change.
      const params = new URLSearchParams({
        keyword: req.keyword,
        ebaySite: EBAY_SITE_US,
        page: "1",
        count: String(clampCount(req.count ?? 120)),
        daysToScrape: String(clampDays(req.historyDays)),
        sortOrder: SORT_ENDED_RECENTLY,
        sold: "true",
        includeCompleteListing: "true",
      });
      if (req.condition === "used") params.set("itemCondition", "used");
      if (req.categoryId && req.categoryId !== "0") params.set("categoryId", req.categoryId);
  
      const started = Date.now();
      let lastErr: CompsError | null = null;
  
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), this.timeoutMs);
        const onOuterAbort = () => ac.abort();
        options?.signal?.addEventListener("abort", onOuterAbort);
  
        try {
          const res = await fetch(`${BASE_URL}?${params.toString()}`, {
            method: "GET",
            headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
            signal: ac.signal,
          });
  
          // Documented status semantics.
          if (res.status === 401) {
            // Configuration error — retrying cannot help and wastes a request.
            throw new CompsError("UNAUTHORIZED", "provider rejected the API key");
          }
          if (res.status === 403) {
            throw new CompsError("QUOTA_EXHAUSTED", "monthly quota exhausted");
          }
          if (res.status === 429) {
            const ra = Number.parseInt(res.headers.get("Retry-After") ?? "", 10);
            throw new CompsError("RATE_LIMITED", "per-minute rate limit",
              Number.isFinite(ra) ? ra * 1000 : 2000);
          }
          if (res.status === 400) {
            throw new CompsError("INVALID_REQUEST", "provider rejected the parameters");
          }
          if (res.status === 502 || res.status === 500) {
            throw new CompsError("PROVIDER_UNAVAILABLE", `provider returned ${res.status}`, 1500);
          }
          if (!res.ok) {
            throw new CompsError("PROVIDER_UNAVAILABLE", `unexpected status ${res.status}`);
          }
  
          let body: unknown;
          try {
            body = await res.json();
          } catch {
            throw new CompsError("INVALID_PROVIDER_RESPONSE", "response was not valid JSON");
          }
          const items = (body as { items?: unknown })?.items;
          if (!Array.isArray(items)) {
            throw new CompsError("INVALID_PROVIDER_RESPONSE", "response had no items array");
          }
  
          const out: NormalizedSoldComp[] = [];
          const malformed: Array<{ reason: string; sample: string }> = [];
          for (const raw of items) {
            const n = normalizeItem(raw, this.providerName);
            if (typeof n === "string") {
              // Title only, truncated — never the whole record.
              const t = (raw as { title?: unknown })?.title;
              malformed.push({ reason: n, sample: typeof t === "string" ? t.slice(0, 60) : "" });
            } else out.push(n);
          }
          return { items: out, malformed, rawCount: items.length, latencyMs: Date.now() - started };
  
        } catch (err) {
          const ce = err instanceof CompsError
            ? err
            : (err as Error)?.name === "AbortError"
              ? new CompsError("PROVIDER_TIMEOUT", `no response within ${this.timeoutMs}ms`)
              : new CompsError("PROVIDER_UNAVAILABLE", "network failure");
          lastErr = ce;
  
          // Retry only transient classes. Auth, quota and bad-request are
          // permanent for this call and retrying burns quota for nothing.
          const transient = ce.code === "RATE_LIMITED" ||
                            ce.code === "PROVIDER_UNAVAILABLE" ||
                            ce.code === "PROVIDER_TIMEOUT";
          if (!transient || attempt === MAX_RETRIES) throw ce;
          await sleep(ce.retryAfterMs ?? 1000 * (attempt + 1));
        } finally {
          clearTimeout(timer);
          options?.signal?.removeEventListener("abort", onOuterAbort);
        }
      }
      throw lastErr ?? new CompsError("INTERNAL_ERROR", "retry loop exited unexpectedly");
    }
  }
/**
 * server/comps/types.ts
 *
 * Vendor-neutral sold-comps contracts.
 *
 * Everything downstream — query building, filtering, scoring, statistics,
 * caching, and eventually pricing and UI — depends on THESE shapes, never on
 * SoldComps field names. The provider is one adapter behind this interface, so
 * replacing it is a new file rather than a rewrite. That matters more than
 * usual here: the provider is a scraper, and scrapers break.
 */

export type CompsMarketplace = "ebay_us";

/** Stable internal failure codes. Never carries a provider response body. */
export type CompsErrorCode =
  | "PROVIDER_NOT_CONFIGURED"
  | "FEATURE_DISABLED"
  | "FOUNDER_ONLY"
  | "INVALID_REQUEST"
  | "UNAUTHORIZED"
  | "QUOTA_EXHAUSTED"
  | "RATE_LIMITED"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_UNAVAILABLE"
  | "INVALID_PROVIDER_RESPONSE"
  | "INTERNAL_ERROR";

export type CompsIneligibleReason =
  | "ITEM_TYPE_UNKNOWN"
  | "IDENTITY_TOO_WEAK"
  | "QUERY_TOO_GENERIC"
  | "UNRESOLVED_IDENTITY_CONFLICT"
  | "INVALID_ANALYSIS"
  | "UNSUPPORTED_MARKETPLACE";

export interface CompsSearchRequest {
  keyword: string;
  marketplace: CompsMarketplace;
  /** Mapped to the documented `daysToScrape` (1-365). */
  historyDays: number;
  condition?: "used";
  categoryId?: string;
  /** Documented `count`, 1-240. */
  count?: number;
}

/**
 * One sold listing, provider-neutral.
 *
 * soldPrice and shippingPrice are kept SEPARATE on purpose. Folding shipping
 * into the sale price is the classic comps error: a $20 tee with $6 shipping is
 * not a $26 tee, and mixing them silently inflates every median.
 */
export interface NormalizedSoldComp {
  provider: string;
  externalId: string;
  title: string;
  soldPrice: number;
  shippingPrice: number | null;
  buyerPaidTotal: number | null;
  currency: string;
  condition: string | null;
  /** ISO date. eBay never exposes a time of day. */
  soldAt: string | null;
  listingUrl: string | null;
  imageUrl: string | null;
  /** When true the docs guarantee soldPrice IS the accepted amount, not the
   *  strikethrough asking price. */
  bestOfferAccepted: boolean | null;
}

export interface CompsProviderResult {
  items: NormalizedSoldComp[];
  /** Records rejected during normalization, with a reason. Debug only. */
  malformed: Array<{ reason: string; sample: string }>;
  rawCount: number;
  latencyMs: number;
}

export interface SoldCompsProvider {
  readonly providerName: string;
  searchSold(
    request: CompsSearchRequest,
    options?: { signal?: AbortSignal },
  ): Promise<CompsProviderResult>;
}

/** Thrown by adapters. Carries a stable code, never a provider body. */
export class CompsError extends Error {
  constructor(
    public readonly code: CompsErrorCode,
    message: string,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "CompsError";
  }
}
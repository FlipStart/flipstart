/**
 * server/comps/publicContract.ts
 *
 * Vendor-neutral public contract for a displayable sold comp.
 *
 * ── What the provider actually gives us ───────────────────────────────────────
 * Confirmed against the adapter and the SoldComps docs:
 *   itemId, url, thumbnailUrl, title, condition, bestOfferAccepted, endedAt,
 *   soldPrice, soldCurrency, shippingPrice, totalPrice, listingType
 *
 * Two gaps worth naming rather than papering over:
 *   - There is ONE image field, `thumbnailUrl`. No array, no high-resolution
 *     variant. The future carousel wants large product images; a thumbnail is
 *     what exists. `imageUrls` is modelled anyway so a future provider that
 *     supplies several needs no UI change, but today it will hold at most one.
 *   - There is NO marketplace field on the item. It is derived from the request's
 *     ebaySite parameter, which is why `marketplace` is passed in rather than
 *     read — claiming eBay from a field that does not exist would be a guess.
 *
 * ── Why this file exists at all ───────────────────────────────────────────────
 * So the UI never touches a provider field name. Adding a second marketplace
 * later should be a new adapter, not a screen rewrite.
 */
import type { NormalizedSoldComp } from "./types.js";
import type { ScoredComp } from "./matching.js";

/** Bumped when the shape of a display match changes. */
export const COMP_CONTRACT_VERSION = "comp-contract-1";

export type Marketplace = "ebay" | "unknown";
export type ImageStatus = "available" | "missing" | "invalid" | "unsupported";

export interface Money { amount: number; currency: string }

/**
 * eBay's documented image-size selector.
 *
 * ── Why the images were blurry ────────────────────────────────────────────────
 * eBay serves every listing photo from i.ebayimg.com at a size chosen by the
 * `s-l{N}` path segment. SoldComps returns `thumbnailUrl`, which is a SMALL
 * derivative — typically s-l140 or s-l225. The card renders at up to 210pt,
 * which on a 3x iPhone is 630 real pixels, so a 140px source is being upscaled
 * four-fold. That is the blur: nothing to do with resize mode, the Image
 * component, or the provider's data quality.
 *
 * ── Why this is safe ─────────────────────────────────────────────────────────
 * The size segment is a stable, long-standing eBay CDN convention, not a guess.
 * The transformation is applied ONLY to i.ebayimg.com hosts whose path already
 * matches the pattern — a non-eBay URL, or an eBay URL in an unexpected shape,
 * is returned untouched rather than blindly string-replaced.
 *
 * ── Why 800 and not 1600 ─────────────────────────────────────────────────────
 * 800px clears the 630px worst case with headroom. 1600 would roughly quadruple
 * the bytes for pixels a 210pt card physically cannot show, on a screen someone
 * is using in a shop on mobile data.
 *
 * The original thumbnail is always preserved as a fallback: if the larger
 * derivative 404s for a particular listing, the card silently uses what the
 * provider gave us rather than showing a hole.
 */
const EBAY_IMAGE_HOST = /(^|\.)ebayimg\.com$/i;
const EBAY_SIZE_SEGMENT = /\/s-l\d+(\.[a-z]+)$/i;
const TARGET_SIZE = 800;

export function upgradeEbayImageUrl(raw: string | null): string | null {
  if (!raw) return null;
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  // Never apply eBay-specific logic to a non-eBay host.
  if (!EBAY_IMAGE_HOST.test(u.hostname)) return null;
  if (!EBAY_SIZE_SEGMENT.test(u.pathname)) return null;

  const upgraded = u.pathname.replace(EBAY_SIZE_SEGMENT, `/s-l${TARGET_SIZE}$1`);
  if (upgraded === u.pathname) return null;   // already at target
  u.pathname = upgraded;
  return u.toString();
}

export interface PublicSoldCompMatch {
  /** Stable and safe to use as a list key. Derived from provider + external id,
   *  never from the title — titles are not unique. */
  id: string;
  provider: string;
  marketplace: Marketplace;
  externalId: string | null;

  /** COMPLETE title. Whitespace collapsed for display, never truncated with an
   *  ellipsis. Phase 4 decides how many lines to show. */
  fullTitle: string;

  /** Highest safe resolution. Falls back to the provider thumbnail when no
   *  upgrade is available. */
  primaryImageUrl: string | null;
  /** The untouched provider thumbnail. The client falls back to this if the
   *  upgraded URL fails to load. Null when it IS the primary. */
  fallbackImageUrl: string | null;
  imageUrls: string[];
  imageStatus: ImageStatus;

  listingUrl: string | null;

  soldPrice: Money;
  shippingPrice: Money | null;
  buyerPaidTotal: Money | null;

  soldAt: string | null;
  bestOfferAccepted: boolean | null;

  matchScore: number;
  matchClass: "strong" | "moderate";
}

/** Founder-only. Never returned by the app endpoint. */
export interface DebugSoldCompMatch extends PublicSoldCompMatch {
  titleLength: number;
  titleBounded: boolean;
  imageHost: string | null;
  rejectedImageCount: number;
  imageStatusReason: string | null;
  normalizationWarnings: string[];
  positives: string[];
  penalties: string[];
  detected: { closure: string | null; specialty: Array<{ kind: string; match: string }> };
  scoreComponents: Record<string, number>;
}

/**
 * Title ceiling.
 *
 * A serialization safeguard, not a display decision. eBay titles cap at 80
 * characters, so 500 leaves enormous headroom for any legitimate listing while
 * bounding a malicious or malformed payload. Bounding is recorded in debug so a
 * genuinely long title is visible as a data problem rather than silently cut.
 */
const MAX_TITLE = 500;
/** At most this many secondary images survive into the payload. */
const MAX_IMAGES = 3;

/**
 * Collapse whitespace for display without destroying content.
 *
 * Deliberately preserves apostrophes, hyphens, slashes and digits: "Levi's
 * 559", "1/4 Zip" and "NF0A4QYJ" all depend on characters a more aggressive
 * cleaner would strip.
 */
export function displayTitle(raw: string): { title: string; bounded: boolean } {
  const clean = (raw ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (clean.length <= MAX_TITLE) return { title: clean, bounded: false };
  return { title: clean.slice(0, MAX_TITLE), bounded: true };
}

const PRIVATE_HOST =
  /^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?)/i;

/**
 * Validate an image URL without fetching it.
 *
 * No network call happens here, deliberately: probing a provider-supplied URL
 * from the server is an SSRF path, and blocking a response on image reachability
 * would trade the 1-2 second experience for cosmetics. The URL is handed to the
 * client, which fetches it in the normal way a browser or RN Image does.
 */
export function validateImageUrl(raw: unknown): { url: string | null; reason: string | null } {
  if (typeof raw !== "string" || !raw.trim()) return { url: null, reason: "empty" };
  const s = raw.trim();
  let u: URL;
  try { u = new URL(s); } catch { return { url: null, reason: "malformed" }; }
  // Only https. http would downgrade the connection and data:/javascript:/file:
  // have no business being rendered as a remote listing photo.
  if (u.protocol !== "https:") return { url: null, reason: `protocol ${u.protocol}` };
  if (PRIVATE_HOST.test(u.hostname)) return { url: null, reason: "private host" };
  // 1x1 tracking pixels render as nothing and are not listing photos.
  if (/(^|\/)(1x1|pixel|spacer|blank)\.(gif|png)$/i.test(u.pathname)) {
    return { url: null, reason: "tracking pixel" };
  }
  return { url: s, reason: null };
}

/**
 * Deterministic primary-image selection.
 *
 * Order: provider-designated primary, then first valid remaining. Today the
 * provider supplies one field so this is trivial, but encoding the priority now
 * means a provider returning an array needs no new logic.
 */
export function selectImages(comp: NormalizedSoldComp): {
  primary: string | null; extras: string[]; status: ImageStatus;
  host: string | null; rejected: number; reason: string | null;
} {
  const candidates: unknown[] = [
    comp.imageUrl,
    ...((comp as unknown as { imageUrls?: unknown[] }).imageUrls ?? []),
  ];
  if (candidates.every(c => c == null || c === "")) {
    return { primary: null, extras: [], status: "missing", host: null, rejected: 0, reason: "no image field" };
  }

  const valid: string[] = [];
  let rejected = 0;
  let firstReason: string | null = null;
  for (const c of candidates) {
    const { url, reason } = validateImageUrl(c);
    if (url) { if (!valid.includes(url)) valid.push(url); }
    else if (c != null && c !== "") { rejected++; firstReason ??= reason; }
  }

  if (valid.length === 0) {
    return { primary: null, extras: [], status: "invalid", host: null, rejected, reason: firstReason };
  }
  let host: string | null = null;
  try { host = new URL(valid[0]).hostname; } catch { host = null; }
  return {
    primary: valid[0],
    extras: valid.slice(1, 1 + MAX_IMAGES),
    status: "available",
    host, rejected, reason: null,
  };
}

/** eBay, ebay, EBAY -> one key. Unknown stays honest rather than defaulting. */
export function normalizeMarketplace(raw: string | null | undefined): Marketplace {
  const s = (raw ?? "").trim().toLowerCase();
  if (s === "ebay" || s === "ebay.com" || s === "ebay_us") return "ebay";
  return "unknown";
}

/** Stable public id. External id first; a URL fingerprint only as a fallback,
 *  because a title is not unique and a price is not identity. */
function stableId(provider: string, comp: NormalizedSoldComp): string {
  if (comp.externalId) return `${provider}:${comp.externalId}`;
  if (comp.listingUrl) {
    try {
      const u = new URL(comp.listingUrl);
      return `${provider}:url:${u.hostname}${u.pathname}`;
    } catch { /* fall through */ }
  }
  return `${provider}:fp:${comp.soldPrice}:${(comp.soldAt ?? "").slice(0, 10)}`;
}

function money(amount: number | null, currency: string): Money | null {
  if (amount == null || !Number.isFinite(amount) || amount < 0) return null;
  return { amount: Math.round(amount * 100) / 100, currency };
}

/** ISO date, or null. Never substitutes the fetch time for a sale date. */
function isoDate(raw: string | null): { iso: string | null; warning: string | null } {
  if (!raw) return { iso: null, warning: null };
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) return { iso: null, warning: `unparseable soldAt "${raw.slice(0, 24)}"` };
  return { iso: new Date(t).toISOString().slice(0, 10), warning: null };
}

export function toPublicMatch(
  s: ScoredComp,
  marketplace: Marketplace,
): { pub: PublicSoldCompMatch; dbg: DebugSoldCompMatch } {
  const c = s.comp;
  const { title, bounded } = displayTitle(c.title);
  const img = selectImages(c);
  const date = isoDate(c.soldAt);
  const warnings: string[] = [];
  if (bounded) warnings.push("title bounded to 500 chars");
  if (date.warning) warnings.push(date.warning);
  if (img.rejected > 0) warnings.push(`${img.rejected} image URL(s) rejected: ${img.reason}`);

  const { url: safeListing, reason: listingReason } = (() => {
    if (!c.listingUrl) return { url: null, reason: null };
    try {
      const u = new URL(c.listingUrl);
      if (u.protocol !== "https:") return { url: null, reason: `listing protocol ${u.protocol}` };
      if (PRIVATE_HOST.test(u.hostname)) return { url: null, reason: "listing private host" };
      return { url: c.listingUrl, reason: null };
    } catch { return { url: null, reason: "listing URL malformed" }; }
  })();
  if (listingReason) warnings.push(listingReason);

  // Upgrade only when the URL is a recognised eBay image in the expected shape.
  const upgraded = img.primary ? upgradeEbayImageUrl(img.primary) : null;

  const pub: PublicSoldCompMatch = {
    id: stableId(c.provider, c),
    provider: c.provider,
    marketplace,
    externalId: c.externalId || null,
    fullTitle: title,
    primaryImageUrl: upgraded ?? img.primary,
    fallbackImageUrl: upgraded ? img.primary : null,
    imageUrls: img.extras,
    imageStatus: img.status,
    listingUrl: safeListing,
    soldPrice: { amount: Math.round(c.soldPrice * 100) / 100, currency: c.currency || "USD" },
    shippingPrice: money(c.shippingPrice, c.currency || "USD"),
    buyerPaidTotal: money(c.buyerPaidTotal, c.currency || "USD"),
    soldAt: date.iso,
    bestOfferAccepted: c.bestOfferAccepted,
    matchScore: s.score,
    matchClass: s.matchClass === "strong" ? "strong" : "moderate",
  };

  return {
    pub,
    dbg: {
      ...pub,
      titleLength: c.title.length,
      titleBounded: bounded,
      imageHost: img.host,
      rejectedImageCount: img.rejected,
      imageStatusReason: img.reason,
      normalizationWarnings: warnings,
      positives: s.positives,
      penalties: s.penalties,
      detected: s.detected,
      scoreComponents: s.components,
    },
  };
}
/**
 * server/comps/probe.ts
 *
 * Minimal live provider check.
 *
 * Bypasses eligibility and the query builder on purpose: those need a canonical
 * analysis, and the question here is narrower — does the SoldComps integration
 * work at all? Key, header, documented parameter names, response shape,
 * normalisation, statistics.
 *
 * Budget and cache still apply. This is a real metered request.
 */
import { SoldCompsAdapter } from "./soldCompsAdapter.js";
import { CompsError } from "./types.js";
import { computeStats } from "./stats.js";
import { compsCacheKey, getCachedComps, putCachedComps } from "./cache.js";
import { reserveRequest, releaseRequest, budgetState } from "./budget.js";
import { normalizeText } from "./normalize.js";

export interface ProbeResult {
  ok: boolean;
  errorCode?: string;
  detail?: string;
  keyword: string;
  historyDays: number;
  cacheHit?: boolean;
  rawCount?: number;
  kept?: number;
  malformed?: Array<{ reason: string; sample: string }>;
  median?: number | null;
  p25?: number | null;
  p75?: number | null;
  medianShipping?: number | null;
  spanDays?: number | null;
  /** First few titles, so a founder can eyeball whether the search was sane. */
  sampleTitles?: string[];
  budget: ReturnType<typeof budgetState>;
  totalMs: number;
}

export async function probeCompsKeyword(keyword: string, historyDays: number): Promise<ProbeResult> {
  const t0 = Date.now();
  const base = { keyword, historyDays, budget: budgetState(), totalMs: 0 };

  const key = compsCacheKey(normalizeText(keyword), historyDays, "ebay_us");
  const cached = getCachedComps(key);
  if (cached) {
    const s = computeStats(cached.items);
    return {
      ...base, ok: true, cacheHit: true, rawCount: cached.items.length, kept: s?.sampleSize ?? 0,
      median: s?.median ?? null, p25: s?.p25 ?? null, p75: s?.p75 ?? null,
      medianShipping: s?.medianShipping ?? null, spanDays: s?.spanDays ?? null,
      sampleTitles: cached.items.slice(0, 5).map(i => i.title),
      budget: budgetState(), totalMs: Date.now() - t0,
    };
  }

  const res = reserveRequest();
  if (!res.allowed) {
    return { ...base, ok: false, errorCode: "COMPS_BUDGET_EXHAUSTED",
             detail: `${res.window} budget reached`, budget: res.state, totalMs: Date.now() - t0 };
  }

  try {
    const provider = new SoldCompsAdapter();
    const out = await provider.searchSold({
      keyword, marketplace: "ebay_us", historyDays, condition: "used", count: 60,
    });
    putCachedComps(key, { items: out.items, fetchedAt: Date.now(),
                          provider: provider.providerName, historyDays });
    const s = computeStats(out.items);
    return {
      ...base, ok: true, cacheHit: false,
      rawCount: out.rawCount, kept: s?.sampleSize ?? 0,
      malformed: out.malformed.slice(0, 5),
      median: s?.median ?? null, p25: s?.p25 ?? null, p75: s?.p75 ?? null,
      medianShipping: s?.medianShipping ?? null, spanDays: s?.spanDays ?? null,
      sampleTitles: out.items.slice(0, 5).map(i => i.title),
      budget: budgetState(), totalMs: Date.now() - t0,
    };
  } catch (err) {
    const code = err instanceof CompsError ? err.code : "INTERNAL_ERROR";
    // Nothing reached eBay on a config or auth failure, so return the reservation.
    if (code === "PROVIDER_NOT_CONFIGURED" || code === "UNAUTHORIZED" || code === "INVALID_REQUEST") {
      releaseRequest();
    }
    return { ...base, ok: false, errorCode: code, detail: (err as Error).message,
             budget: budgetState(), totalMs: Date.now() - t0 };
  }
}
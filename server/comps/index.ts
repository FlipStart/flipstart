/**
 * server/comps/index.ts
 *
 * Phase 0 orchestrator: eligibility -> query -> cache -> provider -> filter ->
 * score -> statistics -> full record.
 *
 * PHASE 0 ONLY. Nothing here touches pricing, ratings, listings or the UI. The
 * scan pipeline does not import this file. Its sole purpose is to let a founder
 * run comps by hand and see, per item, whether the data is good enough to trust
 * before any of it is wired into a buy/skip decision.
 */
import type { CanonicalAnalysisV1 } from "../../shared/canonical.types.js";
import { buildCompsQuery } from "./queryBuilder.js";
import { scoreComp, type ScoredComp, type RejectionReason } from "./matching.js";
import { summarize, type CompsSummary } from "./stats.js";
import { evaluateComps, STATS_VERSION, type CompsEvaluation } from "./evaluate.js";
import {
  toPublicMatch, normalizeMarketplace, COMP_CONTRACT_VERSION,
  type PublicSoldCompMatch, type DebugSoldCompMatch,
} from "./publicContract.js";
import { compsCacheKey, getCachedComps, putCachedComps } from "./cache.js";
import { SoldCompsAdapter } from "./soldCompsAdapter.js";
import { CompsError, type SoldCompsProvider, type CompsIneligibleReason } from "./types.js";
import { QUERY_BUILDER_VERSION, MATCH_ALGO_VERSION } from "./normalize.js";
import { reserveRequest, releaseRequest, type BudgetState } from "./budget.js";

export interface CompsRunRecord {
  ok: boolean;
  errorCode?: string;
  ineligibleReason?: CompsIneligibleReason;
  detail?: string;
  /** Present whenever a provider request was attempted or blocked. */
  budget?: BudgetState;
  query?: { text: string; historyDays: number; components: unknown[]; candidates: string[] };
  provider?: { name: string; rawCount: number; latencyMs: number; cacheHit: boolean; malformed: number };
  accepted?: Array<Record<string, unknown>>;
  topMatches?: Array<Record<string, unknown>>;
  weak?: Array<Record<string, unknown>>;
  weakCount?: number;
  rejected?: Array<{ title: string; reason: RejectionReason; detail: string | null; score: number }>;
  matchMs?: number;
  rejectionCounts?: Record<string, number>;
  /** Phase 1 shape, retained for backward compatibility. New consumers should
   *  read `evaluation.public` — a suppressed median is null there, so it cannot
   *  be rendered by accident. */
  summary?: CompsSummary;
  /** Phase 2. Owns which numbers may be shown. */
  evaluation?: CompsEvaluation;
  versions: { queryBuilder: string; matchAlgo: string; stats: string; compContract: string };
  /** Honest source attribution. `marketplaces` lists only what was actually
   *  queried — never Depop, Poshmark or Mercari, which are not searched. */
  source?: {
    provider: string;
    marketplaces: string[];
    fetchedAt: string;
    historyDays: number;
    cacheStatus: "hit" | "miss";
  };
  /** At most three, fully normalised for the future carousel. */
  displayMatches?: PublicSoldCompMatch[];
  /** Founder-only twin of displayMatches. */
  debugMatches?: DebugSoldCompMatch[];
  totalMs: number;
}

let defaultProvider: SoldCompsProvider | null = null;
const provider = (): SoldCompsProvider => (defaultProvider ??= new SoldCompsAdapter());
/** Test seam. */
export function __setCompsProvider(p: SoldCompsProvider | null) { defaultProvider = p; }

export interface CompsRunContext {
  /** Step 2 result, decided by the caller. Passed in rather than read here so
   *  this module never has to know how founders are identified. */
  founderAuthorised: boolean;
}

/**
 * The gate order is fixed and enforced HERE, not at the call site.
 *
 *   1. feature flag
 *   2. founder authorisation
 *   3. eligibility
 *   4. cache
 *   5. daily budget
 *   6. monthly budget
 *   7. provider
 *
 * Every cheap check runs before every expensive one, so a disabled flag, an
 * unauthorised caller, an ineligible item or a cache hit all cost zero provider
 * requests. Putting this in one function means a future caller cannot reorder
 * it by accident.
 *
 * Exactly ONE provider request per invocation. There is no fallback query and
 * no retry-with-a-different-keyword: a miss is recorded as a miss, because a
 * second speculative search doubles the metered cost of every failure.
 */
export async function runCompsForAnalysis(
  c: CanonicalAnalysisV1,
  ctx: CompsRunContext,
): Promise<CompsRunRecord> {
  const t0 = Date.now();
  const versions = { queryBuilder: QUERY_BUILDER_VERSION, matchAlgo: MATCH_ALGO_VERSION,
                     stats: STATS_VERSION, compContract: COMP_CONTRACT_VERSION };

  // 1. Feature flag.
  if ((process.env.COMPS_ENABLED ?? "").trim() !== "true") {
    return { ok: false, errorCode: "FEATURE_DISABLED", versions, totalMs: Date.now() - t0 };
  }
  // 2. Founder authorisation. Ordinary users never reach the provider in Phase 0.
  if (!ctx.founderAuthorised) {
    return { ok: false, errorCode: "FOUNDER_ONLY", versions, totalMs: Date.now() - t0 };
  }

  // 3. Eligibility — free, and skips the majority of wasteful searches.
  const built = buildCompsQuery(c);
  if (!built.eligible) {
    return { ok: false, ineligibleReason: built.reason, detail: built.detail,
             versions, totalMs: Date.now() - t0 };
  }

  // 4. Cache. Checked before the budget so a repeat view, a reopen or a refresh
  //    costs nothing — there is deliberately no forceRefresh parameter, because
  //    a UI refresh button that silently spends quota is exactly the accident
  //    this phase is meant to prevent.
  const key = compsCacheKey(built.normalizedQuery, built.historyDays, "ebay_us");
  let items; let cacheHit = false; let rawCount = 0; let latencyMs = 0; let malformed = 0;
  let budget: BudgetState | undefined;

  const cached = getCachedComps(key);
  if (cached) {
    items = cached.items; cacheHit = true; rawCount = cached.items.length;
  } else {
    // 5 + 6. Daily then monthly. Reserved BEFORE the call so two concurrent
    //        requests cannot both pass a check that only one of them fits.
    const res = reserveRequest();
    budget = res.state;
    if (!res.allowed) {
      return { ok: false, errorCode: "COMPS_BUDGET_EXHAUSTED",
               detail: `${res.window} budget reached`,
               query: { text: built.query, historyDays: built.historyDays,
                        components: built.components, candidates: built.candidates },
               budget: res.state, versions, totalMs: Date.now() - t0 };
    }
    // 7. Provider.
    try {
      const res = await provider().searchSold({
        keyword: built.query, marketplace: "ebay_us",
        historyDays: built.historyDays, condition: "used", count: 120,
      });
      items = res.items; rawCount = res.rawCount; latencyMs = res.latencyMs; malformed = res.malformed.length;
      // Saved durably and shared: the next person who scans anything producing
      // this same query gets these listings for free.
      putCachedComps(key, { items, fetchedAt: Date.now(), provider: provider().providerName,
                            historyDays: built.historyDays });
    } catch (err) {
      const code = err instanceof CompsError ? err.code : "INTERNAL_ERROR";
      // Configuration and authorisation failures never reached eBay, so the
      // reservation is returned. Transient failures DID consume provider
      // capacity and are left counted — assuming otherwise is how a retry loop
      // quietly overruns the budget.
      if (code === "PROVIDER_NOT_CONFIGURED" || code === "UNAUTHORIZED" ||
          code === "INVALID_REQUEST") {
        releaseRequest();
      }
      // A comps failure is never fatal — Phase 0 records it and moves on.
      return { ok: false, errorCode: code, detail: (err as Error).message,
               budget,
               query: { text: built.query, historyDays: built.historyDays,
                        components: built.components, candidates: built.candidates },
               versions, totalMs: Date.now() - t0 };
    }
  }

  const seen = new Set<string>();
  const matchStart = Date.now();
  const scored: ScoredComp[] = items.map(i => scoreComp(c, i, seen));

  /**
   * Ranked by SIMILARITY, with deterministic tie-breakers.
   *
   * Never by price. A $100 listing outranking a $30 one because it is expensive
   * is how a plain hoodie ends up with a $65 median.
   */
  const accepted = scored.filter(s => s.accepted).sort((a, b) =>
    b.score - a.score ||
    a.penalties.length - b.penalties.length ||
    b.positives.length - a.positives.length ||
    (b.comp.soldAt ?? "").localeCompare(a.comp.soldAt ?? "") ||
    a.comp.externalId.localeCompare(b.comp.externalId),
  );
  // Cleared the hard rules but under the score floor. Debug only — never shown,
  // never in the median. Retained because "why was nothing accepted" is
  // otherwise unanswerable.
  const weak = scored.filter(s => s.weak);
  const rejected = scored.filter(s => !s.accepted && !s.weak);
  const matchMs = Date.now() - matchStart;
  const rejectionCounts: Record<string, number> = {};
  for (const r of rejected) if (r.rejection) rejectionCounts[r.rejection] = (rejectionCounts[r.rejection] ?? 0) + 1;

  const marketplace = normalizeMarketplace("ebay");

  return {
    ok: true,
    source: {
      provider: provider().providerName,
      // Only what was actually searched. The screen's Depop / Poshmark / Mercari
      // logos were implying coverage that does not exist.
      marketplaces: [marketplace],
      fetchedAt: new Date(cached?.fetchedAt ?? Date.now()).toISOString(),
      historyDays: built.historyDays,
      cacheStatus: cacheHit ? "hit" : "miss",
    },
    query: { text: built.query, historyDays: built.historyDays,
             components: built.components, candidates: built.candidates },
    provider: { name: provider().providerName, rawCount, latencyMs, cacheHit, malformed },
    budget,
    accepted: accepted.map(s => ({
      // FULL title, never truncated in storage. The UI clips it visually with
      // numberOfLines, which does not mutate the value.
      title: s.comp.title, soldPrice: s.comp.soldPrice, shipping: s.comp.shippingPrice,
      buyerPaidTotal: s.comp.buyerPaidTotal,
      soldAt: s.comp.soldAt, score: s.score, matchClass: s.matchClass,
      positives: s.positives, penalties: s.penalties,
      url: s.comp.listingUrl, imageUrl: s.comp.imageUrl,
      externalId: s.comp.externalId, provider: s.comp.provider,
      bestOfferAccepted: s.comp.bestOfferAccepted,
      detected: s.detected,
    })),
    /** Phase 1 shape, retained so existing consumers keep working. */
    topMatches: accepted.slice(0, 3).map(s => ({
      title: s.comp.title, soldPrice: s.comp.soldPrice, shipping: s.comp.shippingPrice,
      soldAt: s.comp.soldAt, score: s.score, matchClass: s.matchClass,
      url: s.comp.listingUrl, imageUrl: s.comp.imageUrl,
      provider: s.comp.provider, positives: s.positives, penalties: s.penalties,
    })),
    /**
     * Phase 3 contract. At most three, ordered by similarity.
     *
     * Image presence deliberately plays no part in selection or ordering: a
     * strong comp with no photo outranks a weaker one that has one, because the
     * point is accuracy and a prettier carousel built from worse comps is a
     * worse product.
     */
    displayMatches: accepted.slice(0, 3).map(s => toPublicMatch(s, marketplace).pub),
    debugMatches: accepted.slice(0, 3).map(s => toPublicMatch(s, marketplace).dbg),
    weak: weak.map(s => ({ title: s.comp.title, soldPrice: s.comp.soldPrice,
                           score: s.score, penalties: s.penalties })),
    weakCount: weak.length,
    rejected: rejected.map(s => ({ title: s.comp.title, reason: s.rejection!,
                                   detail: s.rejectionDetail, score: s.score })),
    rejectionCounts,
    matchMs,
    summary: summarize(scored),
    // Decides eligibility. summarize() returned a $65 median alongside
    // "insufficient" and the screen rendered it — this is the layer that makes
    // that impossible, because a suppressed value is null rather than hidden.
    evaluation: evaluateComps(scored, rawCount),
    versions,
    totalMs: Date.now() - t0,
  };
}
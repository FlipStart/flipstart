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
import { scoreComp, TIER_RANK, type ScoredComp, type RejectionReason, type Tier } from "./matching.js";
import { summarize, type CompsSummary } from "./stats.js";
import { evaluateComps, dedupeComps, byRelevance, STATS_VERSION, type CompsEvaluation } from "./evaluate.js";
import { buildSearchPlan, displayQuery, type SearchStep, type SearchTier } from "./searchPlan.js";
import {
  toPublicMatch, normalizeMarketplace, COMP_CONTRACT_VERSION,
  type PublicSoldCompMatch, type DebugSoldCompMatch,
} from "./publicContract.js";
import { compsCacheKey, getCachedComps, putCachedComps } from "./cache.js";
import { SoldCompsAdapter } from "./soldCompsAdapter.js";
import { CompsError, type SoldCompsProvider, type CompsIneligibleReason, type NormalizedSoldComp } from "./types.js";
import { QUERY_BUILDER_VERSION, MATCH_ALGO_VERSION } from "./normalize.js";
import { reserveRequest, releaseRequest, perUserRemaining, sharedRemaining, type BudgetState } from "./budget.js";

/**
 * How many sold listings to pull before ranking.
 *
 * THIS is where recency was winning. The provider returns the newest N within
 * the history window, so with N=120 and a 365-day window a genuinely better
 * comp from four months ago was frequently never in the set — no ranking
 * function can promote a listing it was never shown. Ranking was already
 * similarity-first; the candidate pool was not.
 *
 * 240 is the provider's documented maximum. It is also the slowest: the
 * provider scrapes eBay live, and a deeper pull takes longer and times out
 * more. 120 recent sales is plenty for the matcher to pick from.
 * COMPS_CANDIDATE_COUNT (1-240) overrides it.
 */
function candidatePool(): number {
  const n = Number.parseInt(process.env.COMPS_CANDIDATE_COUNT ?? "", 10);
  return Number.isFinite(n) && n >= 1 && n <= 240 ? n : 120;
}
/**
 * A PAID fallback search starts only if the scan's comps have taken less than
 * this so far, so a slow first search is never followed by a second slow one.
 * Cached fallbacks always run. Exception to "reopening is free": on a reopen the
 * first search is cached (instant), so a fallback skipped the first time can
 * run and be paid for once; it is cached like any other after that.
 * COMPS_FALLBACK_START_LIMIT_MS overrides.
 */
function fallbackStartLimitMs(): number {
  const n = Number.parseInt(process.env.COMPS_FALLBACK_START_LIMIT_MS ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? n : 10_000;
}

/**
 * Fallback searches (Phase 3). B and C run only while fewer than MIN_CORE
 * Exact/Strong comps have been found.
 *
 * MAX_SEARCHES counts EVERY search, cached or paid. Counting only paid calls
 * made the path depend on the cache: each reopen of a miss got one step
 * further and bought more searches. Counted this way, a scan always runs the
 * same searches, so reopening it is free.
 */
const MIN_CORE = 3;
const MAX_SEARCHES = 3;
/**
 * A PAID fallback is refused while the user has this many searches or fewer
 * left today, or the shared pool is down to its reserve — a run of misses can
 * never use up the precise searches the next scans (theirs or anyone's) need.
 * The precise search is never held back, and cached fallbacks always run.
 */
const FALLBACK_USER_RESERVE = 3;
const fallbackSharedReserve = (limit: number) => Math.max(3, Math.ceil(limit * 0.1));

/**
 * Searches in flight right now, by cache key. Two scans of the same item at
 * the same moment share one provider call instead of paying twice.
 */
const inflight = new Map<string, Promise<{ items: NormalizedSoldComp[]; rawCount: number; latencyMs: number; malformed: number }>>();

/** One search as run. Founder record and inspector only. */
export interface SearchRun {
  tier: SearchTier;
  query: string;
  categoryId: string | null;
  why: string;
  outcome: "ok" | "budget" | "error";
  cacheHit: boolean;
  /** A paid provider call was made (or attempted). */
  calledProvider: boolean;
  rawCount: number;
  latencyMs: number;
  errorCode?: string;
}

export interface CompsRunRecord {
  ok: boolean;
  errorCode?: string;
  ineligibleReason?: CompsIneligibleReason;
  detail?: string;
  /** Present whenever a provider request was attempted or blocked. */
  budget?: BudgetState;
  query?: { text: string; historyDays: number; components: unknown[]; candidates: string[] };
  /** Every search run, in order (Phase 3). */
  searches?: SearchRun[];
  /** The deepest search that ran, or "D" when nothing could be shown. */
  searchTier?: SearchTier | "D";
  provider?: { name: string; rawCount: number; latencyMs: number; cacheHit: boolean; malformed: number };
  accepted?: Array<Record<string, unknown>>;
  topMatches?: Array<Record<string, unknown>>;
  weak?: Array<Record<string, unknown>>;
  weakCount?: number;
  rejected?: Array<{ title: string; reason: RejectionReason; detail: string | null; score: number; price: number }>;
  /** Days between the oldest and newest sale the provider returned — the
   *  history actually searched, which can be shorter than `historyDays`. */
  historySpanDays?: number | null;
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
  /** Charged against this user's per-user daily cap. Absent means global-only,
   *  which is correct for founder tooling but never for a user-facing scan. */
  userId?: string | null;
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
 * Searches (Phase 3): the precise search first, then — only while fewer than
 * three Exact/Strong comps have been found — a relaxed and a broad search, at
 * most two extra paid calls. Each one goes through cache → daily budget →
 * monthly budget → provider on its own, so a repeat costs nothing and a budget
 * refusal stops the fallbacks without failing the scan.
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

  // 4-7, once per search. The cache is checked before the budget so a repeat
  //    view, a reopen or a refresh costs nothing — there is deliberately no
  //    forceRefresh parameter, because a UI refresh button that silently spends
  //    quota is exactly the accident this is meant to prevent.
  const plan = buildSearchPlan(c, built.query, { unbranded: built.unbranded });
  const queryRecord = { text: displayQuery(plan[0]?.query ?? built.query), historyDays: built.historyDays,
                        components: built.components, candidates: built.candidates };
  let budget: BudgetState | undefined;

  type Fetched = SearchRun & { items: NormalizedSoldComp[]; fetchedAt: number | null; malformed: number; detail?: string };
  const runSearch = async (step: SearchStep, categoryId: string | null, fallback: boolean): Promise<Fetched> => {
    const base = { tier: step.tier, query: step.query, categoryId, why: step.why };
    const key = compsCacheKey(step.normalizedQuery, built.historyDays, "ebay_us", categoryId);
    const cached = getCachedComps(key);
    if (cached) {
      return { ...base, outcome: "ok", cacheHit: true, calledProvider: false, rawCount: cached.items.length,
               latencyMs: 0, malformed: 0, items: cached.items, fetchedAt: cached.fetchedAt };
    }
    // The same search already running for another scan: wait for it, pay nothing.
    const running = inflight.get(key);
    if (running) {
      try {
        const r = await running;
        return { ...base, outcome: "ok", cacheHit: true, calledProvider: false, rawCount: r.rawCount,
                 latencyMs: 0, malformed: 0, items: r.items, fetchedAt: Date.now() };
      } catch { /* that call failed; fall through and try our own */ }
    }
    // A PAID fallback after a slow start is skipped (a cached or in-flight one,
    // above, costs no time and still runs).
    if (fallback && Date.now() - t0 >= fallbackStartLimitMs()) {
      return { ...base, outcome: "budget", cacheHit: false, calledProvider: false, rawCount: 0, latencyMs: 0,
               malformed: 0, items: [], fetchedAt: null, errorCode: "FALLBACK_TIME_LIMIT",
               detail: "the first search was slow; not making the user wait for another" };
    }
    if (fallback) {
      const shared = sharedRemaining();
      if ((ctx.userId && perUserRemaining(ctx.userId) <= FALLBACK_USER_RESERVE) ||
          shared.remaining <= fallbackSharedReserve(shared.limit)) {
        return { ...base, outcome: "budget", cacheHit: false, calledProvider: false, rawCount: 0, latencyMs: 0,
                 malformed: 0, items: [], fetchedAt: null, errorCode: "FALLBACK_RESERVE",
                 detail: "kept in reserve for precise searches" };
      }
    }
    // 5 + 6. Daily then monthly. Reserved BEFORE the call so two concurrent
    //        requests cannot both pass a check that only one of them fits.
    const res = reserveRequest(ctx.userId ?? null);
    budget = res.state;
    if (!res.allowed) {
      return { ...base, outcome: "budget", cacheHit: false, calledProvider: false, rawCount: 0, latencyMs: 0,
               malformed: 0, items: [], fetchedAt: null, errorCode: "COMPS_BUDGET_EXHAUSTED",
               detail: `${res.window} budget reached` };
    }
    // 7. Provider.
    const call = provider().searchSold({
      keyword: step.query, marketplace: "ebay_us",
      historyDays: built.historyDays, condition: "used", count: candidatePool(),
      ...(categoryId ? { categoryId } : {}),
    }).then(r => {
      // Saved durably and shared: the next person whose scan produces this same
      // search gets these listings for free.
      putCachedComps(key, { items: r.items, fetchedAt: Date.now(), provider: provider().providerName,
                            historyDays: built.historyDays });
      return { items: r.items, rawCount: r.rawCount, latencyMs: r.latencyMs, malformed: r.malformed.length };
    });
    inflight.set(key, call);
    try {
      const r = await call;
      return { ...base, outcome: "ok", cacheHit: false, calledProvider: true, rawCount: r.rawCount,
               latencyMs: r.latencyMs, malformed: r.malformed, items: r.items, fetchedAt: Date.now() };
    } catch (err) {
      const code = err instanceof CompsError ? err.code : "INTERNAL_ERROR";
      // Configuration and authorisation failures never reached eBay, so the
      // reservation is returned. Transient failures DID consume provider
      // capacity and are left counted — assuming otherwise is how a retry loop
      // quietly overruns the budget.
      const neverSent = code === "PROVIDER_NOT_CONFIGURED" || code === "UNAUTHORIZED" || code === "INVALID_REQUEST";
      if (neverSent) releaseRequest(ctx.userId ?? null);
      return { ...base, outcome: "error", cacheHit: false, calledProvider: !neverSent, rawCount: 0, latencyMs: 0,
               malformed: 0, items: [], fetchedAt: null, errorCode: code, detail: (err as Error).message };
    } finally {
      inflight.delete(key);
    }
  };

  /** Exact + Strong comps found so far, after dedupe — what decides a miss. */
  const coreSoFar = (pool: Map<string, NormalizedSoldComp>) => {
    const seenIds = new Set<string>();
    const s = [...pool.values()].map(i => scoreComp(c, i, seenIds))
      .filter(x => x.tier === "exact" || x.tier === "strong").sort(byRelevance);
    return dedupeComps(s).kept.length;
  };

  const pool = new Map<string, NormalizedSoldComp>();
  const searches: SearchRun[] = [];
  const strip = ({ items: _i, fetchedAt: _f, malformed: _m, detail: _d, ...run }: Fetched): SearchRun => run;
  let malformed = 0; let latencyMs = 0;
  let fetchedAt: number | null = null;
  let firstFailure: Fetched | null = null;
  /**
   * A categorised search that found NOTHING: the category may not fit this
   * item, so the remaining searches go without it. When the plan has a spare
   * search, the empty one is also repeated without the category; when it
   * doesn't, the broader searches are the better use of the slot.
   */
  let dropCategory = false;
  const queue: SearchStep[] = [...plan];

  while (queue.length > 0 && searches.length < MAX_SEARCHES) {
    const step = queue.shift() as SearchStep;
    const fallback = searches.length > 0;
    if (fallback && coreSoFar(pool) >= MIN_CORE) break;
    const categoryId = dropCategory ? null : step.categoryId;
    const run = await runSearch(step, categoryId, fallback);
    searches.push(strip(run));
    if (run.outcome !== "ok") {
      firstFailure ??= run;
      break;              // a refused or failed fallback never costs the scan what it already has
    }
    if (run.rawCount === 0 && categoryId) {
      dropCategory = true;
      if (searches.length + queue.length < MAX_SEARCHES) queue.unshift(step);
    }
    for (const it of run.items) if (!pool.has(it.externalId)) pool.set(it.externalId, it);
    malformed += run.malformed; latencyMs += run.latencyMs;
    if (run.fetchedAt != null) fetchedAt = fetchedAt == null ? run.fetchedAt : Math.min(fetchedAt, run.fetchedAt);
  }

  // The first search itself failed and nothing was found: same failure record
  // as before Phase 3, so callers and the availability states are unchanged.
  if (pool.size === 0 && firstFailure && !searches.some(s => s.outcome === "ok")) {
    return { ok: false, errorCode: firstFailure.errorCode, detail: firstFailure.detail,
             budget, query: queryRecord, searches, versions, totalMs: Date.now() - t0 };
  }
  // "Matched using …" on the screen names the broadest search that ran — the
  // cards may have come from it — without its excluded words.
  const lastOk = [...searches].reverse().find(s => s.outcome === "ok");
  if (lastOk) queryRecord.text = displayQuery(lastOk.query);

  const items = [...pool.values()];
  const rawCount = items.length;
  const cacheHit = searches.length > 0 && searches.every(s => s.cacheHit);

  const seen = new Set<string>();
  const matchStart = Date.now();
  const scored: ScoredComp[] = items.map(i => scoreComp(c, i, seen));

  /**
   * Ranked by TIER, then similarity, with deterministic tie-breakers.
   *
   * Tier first: an Exact comp always outranks a Strong one, whatever their
   * scores. Never by price. A $100 listing outranking a $30 one because it is
   * expensive is how a plain hoodie ends up with a $65 median.
   */
  const accepted = scored.filter(s => s.accepted).sort((a, b) =>
    TIER_RANK[a.tier as Tier] - TIER_RANK[b.tier as Tier] ||
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
  // The cards come from the SAME deduped list the statistics use, so one sale
  // can never fill all three cards.
  const display = dedupeComps(accepted, { near: true }).kept;
  const saleDays = items.map(i => (i.soldAt ? Date.parse(i.soldAt) : NaN)).filter(Number.isFinite).sort((a, b) => a - b);
  const historySpanDays = saleDays.length >= 2
    ? Math.round((saleDays[saleDays.length - 1] - saleDays[0]) / 86_400_000) : null;
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
      fetchedAt: new Date(fetchedAt ?? Date.now()).toISOString(),
      historyDays: built.historyDays,
      cacheStatus: cacheHit ? "hit" : "miss",
    },
    query: queryRecord,
    searches,
    searchTier: display.length === 0 ? "D"
      : ([...searches].reverse().find(s => s.outcome === "ok")?.tier ?? "A"),
    provider: { name: provider().providerName, rawCount, latencyMs, cacheHit, malformed },
    budget,
    accepted: accepted.map(s => ({
      // FULL title, never truncated in storage. The UI clips it visually with
      // numberOfLines, which does not mutate the value.
      title: s.comp.title, soldPrice: s.comp.soldPrice, shipping: s.comp.shippingPrice,
      buyerPaidTotal: s.comp.buyerPaidTotal,
      soldAt: s.comp.soldAt, score: s.score, matchClass: s.matchClass, tier: s.tier, reason: s.reason,
      positives: s.positives, penalties: s.penalties,
      url: s.comp.listingUrl, imageUrl: s.comp.imageUrl,
      externalId: s.comp.externalId, provider: s.comp.provider,
      bestOfferAccepted: s.comp.bestOfferAccepted,
      detected: s.detected,
    })),
    /** Phase 1 shape, retained so existing consumers keep working. */
    topMatches: display.slice(0, 3).map(s => ({
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
    displayMatches: display.slice(0, 3).map(s => toPublicMatch(s, marketplace).pub),
    debugMatches: display.slice(0, 3).map(s => toPublicMatch(s, marketplace).dbg),
    weak: weak.map(s => ({ title: s.comp.title, soldPrice: s.comp.soldPrice,
                           score: s.score, penalties: s.penalties, reason: s.reason })),
    weakCount: weak.length,
    rejected: rejected.map(s => ({ title: s.comp.title, reason: s.rejection!,
                                   detail: s.rejectionDetail, score: s.score, price: s.comp.soldPrice })),
    historySpanDays,
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
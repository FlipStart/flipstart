/**
 * server/comps/availability.ts
 *
 * Internal reason → safe public category.
 *
 * ── Why this is server-side ───────────────────────────────────────────────────
 * The endpoint was returning raw internal codes — COMPS_BUDGET_EXHAUSTED,
 * PROVIDER_TIMEOUT, PROVIDER_NOT_CONFIGURED, FOUNDER_ONLY — straight to the
 * client. Even if the UI never printed them, they were in the payload, one
 * console.log or error-boundary dump away from telling a user about our billing
 * arrangements. Mapping here means the internal vocabulary never crosses the
 * wire at all.
 *
 * ── Why the categories are coarse ────────────────────────────────────────────
 * A user cannot act on the difference between a rate limit and an exhausted
 * monthly budget. Both mean "not now, try later". Collapsing them is honest
 * rather than evasive: the distinction is real but it belongs in our logs, not
 * in their results screen.
 */

export type PublicAvailability =
  | "available"
  | "limited"
  | "no_reliable_matches"
  | "insufficient_item_details"
  | "temporarily_unavailable"
  | "legacy_unavailable";

export interface AvailabilityView {
  state: PublicAvailability;
  /** Only when a real search happened AND the counts are trustworthy. */
  reviewedCount: number | null;
  filteredOutCount: number | null;
  /** Whether any marketplace was genuinely searched. Drives the source badge:
   *  a failed or never-attempted search must not imply eBay was consulted. */
  searchPerformed: boolean;
}

/** Reasons meaning "we could not build a search from this item at all". */
const IDENTITY_REASONS = new Set([
  "ITEM_TYPE_UNKNOWN", "IDENTITY_TOO_WEAK", "QUERY_TOO_GENERIC",
  "UNRESOLVED_IDENTITY_CONFLICT", "INVALID_ANALYSIS",
]);

/**
 * Everything a user cannot act on collapses to one message.
 *
 * Deliberately includes the money reasons. "Daily budget exhausted" is our
 * problem, not theirs, and telling them would be both confusing and a small
 * disclosure of how the product is operated.
 */
const TEMPORARY_REASONS = new Set([
  "PROVIDER_TIMEOUT", "PROVIDER_UNAVAILABLE", "RATE_LIMITED", "QUOTA_EXHAUSTED",
  "INVALID_PROVIDER_RESPONSE", "PROVIDER_NOT_CONFIGURED", "UNAUTHORIZED",
  "COMPS_BUDGET_EXHAUSTED", "FEATURE_DISABLED", "FOUNDER_ONLY", "NOT_AVAILABLE",
  "INVALID_REQUEST", "INTERNAL_ERROR", "ANALYSIS_NOT_FOUND",
]);

export interface AvailabilityInput {
  ok: boolean;
  errorCode?: string | null;
  ineligibleReason?: string | null;
  reliableMatchCount: number;
  displayMatchCount: number;
  rawCount: number | null;
  filteredOutCount: number | null;
}

export function resolveAvailability(i: AvailabilityInput): AvailabilityView {
  const none = { reviewedCount: null, filteredOutCount: null, searchPerformed: false };

  // Identity failures short-circuit BEFORE any provider call, so there is
  // nothing honest to say about listings reviewed. Claiming "100 reviewed" here
  // would be a straightforward lie.
  if (i.ineligibleReason && IDENTITY_REASONS.has(i.ineligibleReason)) {
    return { state: "insufficient_item_details", ...none };
  }

  if (!i.ok) {
    const code = i.errorCode ?? "";
    // Unknown codes fall through to the safe category rather than leaking.
    if (TEMPORARY_REASONS.has(code) || code) {
      return { state: "temporarily_unavailable", ...none };
    }
    return { state: "temporarily_unavailable", ...none };
  }

  // Provider succeeded. Counts are trustworthy from here.
  const counts = {
    reviewedCount: i.rawCount,
    filteredOutCount: i.filteredOutCount,
    searchPerformed: true,
  };

  if (i.displayMatchCount === 0) return { state: "no_reliable_matches", ...counts };
  // 1-4 reliable matches: real cards exist, so this is NOT a failure state and
  // must never show the sad face.
  if (i.reliableMatchCount < 5) return { state: "limited", ...counts };
  return { state: "available", ...counts };
}

/** A stored analysis with no Phase 2/3 contract cannot be re-evaluated without
 *  paying for a new request, so it gets its own honest category. */
export function legacyAvailability(): AvailabilityView {
  return { state: "legacy_unavailable", reviewedCount: null, filteredOutCount: null, searchPerformed: false };
}

/**
 * Founder-only diagnostic.
 *
 * The public payload deliberately carries no internal code, so this is the ONLY
 * place the real reason survives. It goes to the server log and never to the
 * app — a fact worth stating plainly, because "we removed the leak" is only
 * safe if the information still exists somewhere we can read it.
 *
 * `stage` matters as much as the code: PROVIDER_NOT_CONFIGURED at the provider
 * stage means a bad key, at the budget stage it means we never tried. Same
 * public message, very different fix.
 */
export type DiagnosticStage =
  | "eligibility" | "authorization" | "budget" | "provider" | "normalization" | "evaluation";

export interface CompsDiagnostic {
  internalCode: string;
  stage: DiagnosticStage;
  /** True only when a request actually left for the provider. */
  providerReached: boolean;
  searchPerformed: boolean;
  /** True when budget was reserved — distinguishes a spend from a free failure. */
  requestReserved: boolean;
  /** Free-text internal detail, e.g. "daily budget reached". Never public. */
  detail: string | null;
}

const STAGE_OF: Record<string, DiagnosticStage> = {
  ITEM_TYPE_UNKNOWN: "eligibility", IDENTITY_TOO_WEAK: "eligibility",
  QUERY_TOO_GENERIC: "eligibility", UNRESOLVED_IDENTITY_CONFLICT: "eligibility",
  INVALID_ANALYSIS: "eligibility",
  FOUNDER_ONLY: "authorization", NOT_AVAILABLE: "authorization",
  UNAUTHORIZED: "authorization", ANALYSIS_NOT_FOUND: "authorization",
  FEATURE_DISABLED: "authorization",
  COMPS_BUDGET_EXHAUSTED: "budget",
  PROVIDER_TIMEOUT: "provider", PROVIDER_UNAVAILABLE: "provider",
  RATE_LIMITED: "provider", QUOTA_EXHAUSTED: "provider",
  PROVIDER_NOT_CONFIGURED: "provider", INVALID_REQUEST: "provider",
  INVALID_PROVIDER_RESPONSE: "normalization",
  NO_RELIABLE_MATCHES: "evaluation",
};

export function buildDiagnostic(i: {
  ok: boolean;
  errorCode?: string | null;
  ineligibleReason?: string | null;
  detail?: string | null;
  reliableMatchCount: number;
  providerCalled: boolean;
}): CompsDiagnostic {
  const code = i.ineligibleReason ?? i.errorCode ??
    (i.ok && i.reliableMatchCount === 0 ? "NO_RELIABLE_MATCHES" : "OK");
  const stage = STAGE_OF[code] ?? (i.ok ? "evaluation" : "provider");
  return {
    internalCode: code,
    stage,
    providerReached: i.providerCalled && stage !== "eligibility" &&
                     stage !== "authorization" && stage !== "budget",
    searchPerformed: i.ok && i.providerCalled,
    // A budget refusal never reserved anything; a provider timeout did.
    requestReserved: i.providerCalled && stage !== "budget" &&
                     stage !== "eligibility" && stage !== "authorization",
    detail: i.detail ?? null,
  };
}
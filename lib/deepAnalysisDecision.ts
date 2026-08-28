/**
 * lib/deepAnalysisDecision.ts
 *
 * What should a Deep Analysis tap DO? Pure, and answerable without React.
 *
 * ── Why this is its own module ──────────────────────────────────────────────
 * lib/useDeepAnalysisGate.ts must be a hook: it reads entitlement, calls a tRPC
 * mutation and opens a modal. That puts its rules out of reach of a bare test
 * runner, and the rules are the part worth protecting — they decide whether a
 * paywall appears, whether a one-time lifetime preview is spent, and whether a
 * Free user reaches paid content.
 *
 * Same split as lib/generateListingsDecision.ts.
 *
 * ── Three outcomes, not two ─────────────────────────────────────────────────
 * Deep Analysis is the only gated feature with a middle tier. Free users hold
 * ONE lifetime preview, consumed atomically server-side, and that funnel is
 * deliberately kept ahead of the paywall: someone who has never seen Deep
 * Analysis converts far better after looking at it once than after being asked
 * to pay for something they have never seen.
 *
 * So the order is: Pro runs, preview-holder is offered the preview, and only an
 * exhausted Free user reaches the contextual paywall.
 */

/** No imports, by design — see the module comment. */

export type DeepAnalysisAction =
  /** Authoritatively Pro. Open it. */
  | "open"
  /**
   * Free, preview still unused. Show the EXISTING preview offer — not the
   * paywall. Accepting consumes the preview server-side; dismissing costs the
   * user nothing and must not open the paywall either.
   */
  | "offer_preview"
  /** Free, preview already spent. Open the contextual Deep Analysis paywall. */
  | "paywall"
  /** Entitlement not known yet. Resolve once, then decide again. */
  | "resolve_then_decide";

export type EntitlementReadiness = "unresolved" | "ready" | "error";

export interface DeepAnalysisInput {
  entitlementStatus: EntitlementReadiness;
  /**
   * The server's answer for THIS capability — `ent.can("deep_analysis")`.
   * Meaningful only when entitlementStatus is "ready".
   */
  canDeepAnalysis: boolean;
  /** The user still holds their one lifetime preview. Server-tracked. */
  previewAvailable: boolean;
}

/**
 * The decision for a tap.
 *
 * Note what this interface does NOT contain: any scan balance. Pack scans,
 * subscription scans and free scans are all absent, so no quantity of them can
 * change the outcome. "Packs buy quantity, never capability" expressed as a
 * type rather than as a comment someone has to remember.
 */
export function decideDeepAnalysisAction(i: DeepAnalysisInput): DeepAnalysisAction {
  /**
   * Fail closed while unknown.
   *
   * Never assume Free — that paywalls a subscriber. Never assume Pro — that
   * opens paid content. And critically, never assume the preview is available
   * on an unresolved read: offering a preview we cannot confirm they still hold
   * would consume a lifetime grant on a guess.
   */
  if (i.entitlementStatus !== "ready") return "resolve_then_decide";

  if (i.canDeepAnalysis) return "open";

  /**
   * Preview BEFORE paywall, deliberately.
   *
   * Asking someone to buy a feature they have never seen is the weaker funnel,
   * and they were already promised this look. The paywall waits until the
   * preview is genuinely spent.
   */
  if (i.previewAvailable) return "offer_preview";

  return "paywall";
}

/**
 * The decision once a single entitlement refetch has come back.
 *
 * `plan` is the SERVER's plan for the current user, read straight off the
 * refetch result. An unknown plan returns null — do nothing rather than guess,
 * and the next tap tries again.
 *
 * `previewAvailable` is read from the same authoritative payload, so a Free
 * user resolving out of the unknown state still reaches their preview rather
 * than skipping straight to the paywall.
 */
export function decideAfterResolve(
  plan: string | null | undefined,
  previewAvailable: boolean,
): DeepAnalysisAction | null {
  if (plan === "monthly" || plan === "annual") return "open";
  if (plan === "free") return previewAvailable ? "offer_preview" : "paywall";
  return null;
}

/**
 * What to do with the server's answer after the preview is consumed.
 *
 * The consume RPC is atomic, so a double-tap cannot yield two previews. Only an
 * explicit `granted: true` opens anything.
 *
 * Everything else — already used on another device, a race, a network failure,
 * a malformed response — returns false and opens NOTHING. An unverified grant
 * for a paid-tier feature is worse than making the user tap again.
 */
export function previewConsumeOpens(response: unknown): boolean {
  if (!response || typeof response !== "object") return false;
  return (response as { granted?: unknown }).granted === true;
}
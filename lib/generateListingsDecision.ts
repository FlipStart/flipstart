/**
 * lib/generateListingsDecision.ts
 *
 * What should a Generate Listings tap DO? Pure, and answerable without React.
 *
 * ── Why this is its own module ──────────────────────────────────────────────
 * lib/useGenerateListingsGate.ts has to be a hook — it reads entitlement, auth
 * and the paywall context. That makes its rules unreachable from a bare test
 * runner, and the rules are the part worth protecting: they decide whether a
 * Free user sees a paywall, whether an AI call happens, and whether someone
 * gets charged to look at something they already own.
 *
 * Extracting the decision means every one of those is asserted by a test that
 * runs in plain Node with no native modules — the same split that made the
 * Phase 2 purchase machine testable.
 *
 * ── The rule that shapes this file ──────────────────────────────────────────
 * Generating a listing is a Pro capability. VIEWING one that already exists is
 * not. Those are different actions with different costs, and conflating them is
 * what produced the bug this module fixes: a Free user with a button reading
 * "View Listings" was shown a paywall for content already stored on the device.
 */

/** No imports, by design — see the module comment. */

export type GenerateListingsAction =
  /** Show the listings that already exist. No gate, no server, no cost. */
  | "view_existing"
  /** Authoritatively Pro with nothing generated yet: do the work. */
  | "run"
  /** Authoritatively Free with nothing generated yet: open the paywall. */
  | "paywall"
  /** Entitlement not known yet. Resolve once, then decide again. */
  | "resolve_then_decide";

export type EntitlementReadiness = "unresolved" | "ready" | "error";

export interface GenerateListingsInput {
  /** Generated content already exists for this item. */
  hasExisting: boolean;
  entitlementStatus: EntitlementReadiness;
  /**
   * The server's answer for THIS capability — `ent.can("generate_listings")`.
   *
   * Meaningful only when entitlementStatus is "ready".
   *
   * Note what this interface does NOT contain: any scan balance. Pack scans,
   * subscription scans and free scans are all absent, so no amount of them can
   * influence the outcome. That is the "packs buy quantity, never capability"
   * rule expressed as a type rather than as a comment somebody has to remember.
   */
  canGenerateListings: boolean;
}

/**
 * The decision for a tap.
 *
 * Order matters and is the whole point:
 *
 *   1. Existing content wins over everything, including an unresolved or failed
 *      entitlement read. Viewing costs nothing, so there is nothing to fail
 *      closed about — and it keeps working offline.
 *   2. A resolved answer is acted on directly.
 *   3. Anything else resolves first. Never assume Free (that paywalls a
 *      subscriber), never assume Pro (that lets a Free user fire a mutation).
 */
export function decideGenerateListingsAction(i: GenerateListingsInput): GenerateListingsAction {
  if (i.hasExisting) return "view_existing";
  if (i.entitlementStatus === "ready") return i.canGenerateListings ? "run" : "paywall";
  return "resolve_then_decide";
}

/**
 * The decision once a single entitlement refetch has come back.
 *
 * `plan` is the SERVER's plan for the current user, read straight off the
 * refetch result. Only "monthly" and "annual" permit the work.
 *
 * An unknown plan returns null, meaning "do nothing": no generation and no
 * paywall. Failing closed on an unknown is the only safe direction, and the
 * next tap tries again — the guess is never cached.
 */
export function decideAfterResolve(plan: string | null | undefined): "run" | "paywall" | null {
  if (plan === "monthly" || plan === "annual") return "run";
  if (plan === "free") return "paywall";
  return null;
}
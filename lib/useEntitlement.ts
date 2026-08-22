/**
 * lib/useEntitlement.ts
 *
 * ONE hook. Every screen that shows a scan count or gates a Pro feature reads
 * from here.
 *
 * ── Why a single hook ───────────────────────────────────────────────────────
 * Four screens gate on Pro and two show balances. Six independent queries would
 * drift — one screen unlocking a feature another still blocks, or a pill showing
 * a stale number after a purchase. React Query dedupes by key, so every consumer
 * shares one fetch and one cache entry.
 *
 * ── The client NEVER decides ────────────────────────────────────────────────
 * This reads the server's read model. It is used to draw UI, never as
 * authorization — every gated action is independently enforced server-side, so
 * a tampered client gets a nicer-looking screen and no extra capability.
 */
import { useCallback, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/lib/auth-context";

/** FlipStart has three capability states. There is no trial. */
export type Plan = "free" | "monthly" | "annual";

export type GatedFeature =
  | "scan_photo_3" | "camera_context" | "generate_listings"
  | "deep_analysis" | "sold_comps" | "hunt_mode" | "premium_stats";

/**
 * Resolution status.
 *
 * ── Why this replaced a boolean ─────────────────────────────────────────────
 * `loading: boolean` forced every consumer to pick a plan to render while
 * waiting, and the previous choice was "free". That mislabels a paying
 * subscriber as Free on every cold start — the one thing this UI must not do.
 *
 * "unresolved" is a THIRD state, not a flavour of free. Consumers render a
 * neutral placeholder for it and infer nothing.
 */
export type EntitlementStatus = "unresolved" | "ready" | "error";

export interface EntitlementView {
  status: EntitlementStatus;
  /** True only when authoritative state for the CURRENT user is available. */
  resolved: boolean;
  /** @deprecated Prefer `status`. Retained so existing callers keep compiling. */
  loading: boolean;
  /**
   * Meaningful ONLY when status === "ready". While unresolved it is "free" as a
   * type placeholder and must never be displayed.
   */
  plan: Plan;
  isPro: boolean;
  /** Scans this account can actually spend right now, across every bucket. */
  totalUsableScans: number;
  freeScansRemaining: number;
  subscriptionScansRemaining: number;
  packScansRemaining: number;
  maxPhotoSlots: 2 | 3;
  /** Free user still holds their one-time Deep Analysis preview. */
  deepAnalysisPreviewAvailable: boolean;
  /** ISO date the current subscription period ends. Null for Free.
   *  Used to tell the user WHEN their scans reset, rather than just that they do. */
  subscriptionPeriodEnd: string | null;
  /** True when nothing is left in ANY bucket. */
  outOfScans: boolean;
  can: (f: GatedFeature) => boolean;
  refresh: () => Promise<unknown>;
}

/**
 * Conservative defaults for the pre-load window.
 *
 * Free, zero scans, no Pro. Assuming Pro while loading would flash unlocked
 * features and then snatch them away; assuming scans remain would let someone
 * tap into a scan that is refused server-side. Under-promising is the safer
 * error in both directions.
 */
/**
 * The unresolved shape.
 *
 * Numeric fields are 0 and plan is "free" ONLY as type placeholders — every
 * consumer must branch on `status` before reading them. Capability stays false
 * throughout, which keeps the DISPLAY fail-closed without claiming the user is
 * on the Free plan.
 */
const UNRESOLVED: Omit<EntitlementView, "can" | "refresh"> = {
  status: "unresolved", resolved: false, loading: true,
  plan: "free", isPro: false,
  totalUsableScans: 0, freeScansRemaining: 0,
  subscriptionScansRemaining: 0, packScansRemaining: 0,
  maxPhotoSlots: 2, deepAnalysisPreviewAvailable: false,
  subscriptionPeriodEnd: null, outOfScans: false,
};

export function useEntitlement(): EntitlementView {
  const { user } = useAuth();
  const utils = trpc.useUtils();

  /**
   * Account-switch guard.
   *
   * tRPC keys this query on the procedure alone, so the cache entry is NOT
   * scoped to a user. Without this, account A logs out with 2,435 scans,
   * account B logs in, and B sees A's balance and A's membership status from
   * cache until the refetch lands.
   *
   * Two defences, because one alone is not enough:
   *   1. invalidate on uid change, so the stale entry is dropped
   *   2. refuse to RETURN data attributed to a different uid, which covers the
   *      render that happens before the invalidation takes effect
   */
  const uidRef = useRef<string | null>(null);
  const uidAtFetch = useRef<string | null>(null);

  useEffect(() => {
    const uid = user?.id ?? null;
    if (uidRef.current === uid) return;
    uidRef.current = uid;
    // Drop the previous account's entry rather than racing it.
    void utils.monetization.entitlement.invalidate();
  }, [user?.id, utils]);
  const q = trpc.monetization.entitlement.useQuery(undefined, {
    enabled: !!user?.id,
    // Entitlement changes on purchase and on scan, both of which invalidate
    // explicitly. A short stale window avoids refetching on every screen focus
    // while still self-healing if an invalidation is ever missed.
    staleTime: 30_000,
    retry: 1,
  });

  const refresh = useCallback(() => q.refetch(), [q]);
  const ent = (q.data as any)?.entitlement;

  // Record which account the current data belongs to.
  if (ent && q.isSuccess) uidAtFetch.current = user?.id ?? null;

  /**
   * Data from a DIFFERENT account is treated as absent, not shown.
   *
   * The conservative loading view (free, zero scans, nothing unlocked) is the
   * right thing to render during a switch: showing nothing is recoverable,
   * showing the previous user's Pro status is not.
   */
  const stale = !!ent && uidAtFetch.current !== (user?.id ?? null);
  if (stale && __DEV__) {
    console.warn("[entitlement] data belongs to a previous account — not displaying");
  }

  /**
   * A failed fetch is NOT free.
   *
   * Calling a paying subscriber Free because a request failed shows the wrong
   * membership and, once gating is live, would lock them out of what they paid
   * for. Given its own status so the UI can say "unavailable" instead.
   */
  if (!ent && q.isError) {
    return { ...UNRESOLVED, status: "error", can: () => false, refresh };
  }

  /**
   * Unresolved covers first load and data belonging to a different account.
   *
   * Note what is NOT here — a same-user background refetch. React Query keeps
   * `data` populated while refetching, so `ent` stays truthy and the view stays
   * "ready". Verified state for the current uid is retained rather than
   * skeletoned on every refresh.
   */
  if (!ent || stale) {
    return { ...UNRESOLVED, can: () => false, refresh };
  }

  const b = ent.balances ?? {};
  const features = ent.features ?? {};

  return {
    status: "ready",
    resolved: true,
    loading: false,
    plan: ent.plan ?? "free",
    isPro: Boolean(ent.isPro),
    totalUsableScans: b.totalUsableScans ?? 0,
    freeScansRemaining: b.freeScansRemaining ?? 0,
    subscriptionScansRemaining: b.subscriptionScansRemaining ?? 0,
    packScansRemaining: b.packScansRemaining ?? 0,
    maxPhotoSlots: ent.maxPhotoSlots === 3 ? 3 : 2,
    deepAnalysisPreviewAvailable: Boolean(ent.deepAnalysisPreviewAvailable),
    subscriptionPeriodEnd: ent.subscriptionPeriodEnd ?? null,
    outOfScans: (b.totalUsableScans ?? 0) <= 0,
    // Unknown feature -> false. A new gate is locked until deliberately opened.
    can: (f: GatedFeature) => Boolean(features[f]),
    refresh,
  };
}

/**
 * Invalidate entitlement after anything that changes it.
 *
 * Purchases and scans both move balances, and a stale pill after a purchase is
 * the single most alarming thing a paying user can see.
 */
export function useRefreshEntitlement(): () => Promise<void> {
  const utils = trpc.useUtils();
  return useCallback(async () => {
    await utils.monetization.entitlement.invalidate();
  }, [utils]);
}

/** Copy for a locked feature. Temporary, plain, no paywall design — Phase 4
 *  owns presentation. */
export const PRO_REQUIRED_COPY: Record<GatedFeature, string> = {
  scan_photo_3:      "A third photo is a Pro feature.",
  camera_context:    "Adding details about your item is a Pro feature.",
  generate_listings: "Generate Listings is a Pro feature.",
  deep_analysis:     "Deep Analysis is a Pro feature.",
  sold_comps:        "",
  hunt_mode:         "",
  premium_stats:     "Detailed stats are a Pro feature.",
};

export const OUT_OF_SCANS_COPY =
  "You're out of scans. Buy a scan pack or subscribe to keep scanning.";
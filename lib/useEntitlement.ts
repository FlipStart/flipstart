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
import { useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/lib/auth-context";

export type Plan = "free" | "trial" | "monthly" | "annual";

export type GatedFeature =
  | "scan_photo_3" | "camera_context" | "generate_listings"
  | "deep_analysis" | "sold_comps" | "hunt_mode" | "premium_stats";

export interface EntitlementView {
  loading: boolean;
  plan: Plan;
  isPro: boolean;
  /** Scans this account can actually spend right now, across every bucket. */
  totalUsableScans: number;
  freeScansRemaining: number;
  trialScansRemaining: number;
  subscriptionScansRemaining: number;
  packScansRemaining: number;
  maxPhotoSlots: 2 | 3;
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
const LOADING_VIEW: Omit<EntitlementView, "can" | "refresh"> = {
  loading: true, plan: "free", isPro: false,
  totalUsableScans: 0, freeScansRemaining: 0, trialScansRemaining: 0,
  subscriptionScansRemaining: 0, packScansRemaining: 0,
  maxPhotoSlots: 2, outOfScans: false,   // not "out" — simply unknown yet
};

export function useEntitlement(): EntitlementView {
  const { user } = useAuth();
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

  if (!ent) {
    return { ...LOADING_VIEW, loading: q.isLoading, can: () => false, refresh };
  }

  const b = ent.balances ?? {};
  const features = ent.features ?? {};

  return {
    loading: false,
    plan: ent.plan ?? "free",
    isPro: Boolean(ent.isPro),
    totalUsableScans: b.totalUsableScans ?? 0,
    freeScansRemaining: b.freeScansRemaining ?? 0,
    trialScansRemaining: b.trialScansRemaining ?? 0,
    subscriptionScansRemaining: b.subscriptionScansRemaining ?? 0,
    packScansRemaining: b.packScansRemaining ?? 0,
    maxPhotoSlots: ent.maxPhotoSlots === 3 ? 3 : 2,
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
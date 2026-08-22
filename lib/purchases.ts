/**
 * lib/purchases.ts
 *
 * The ONE place FlipStart initiates a subscription purchase or restore.
 *
 * Screens never call `Purchases.purchasePackage` directly. Everything — package
 * resolution, the in-flight guard, identity capture, error sanitization and the
 * authoritative server sync — lives here, so a future paywall is a rendering
 * job rather than a second copy of purchase logic.
 *
 * ── The client is never the authority ───────────────────────────────────────
 * A successful `purchasePackage` tells us what the STORE thinks. Pro access is
 * decided by the server independently asking RevenueCat about the verified
 * Supabase uid. This module therefore never sends `isPro`, a product id, or a
 * plan to the server — it sends "please reconcile me" and nothing else.
 */
import {
  PRODUCT_MONTHLY, annualProductId, planFromCustomerInfo, type RcPlanKind,
} from "@/lib/revenuecat";
import { sanitizePurchaseError, type PurchaseErrorKind } from "@/lib/purchaseErrors";

export type PurchaseStatus =
  | "idle" | "purchasing" | "syncing"
  | "success" | "cancelled" | "pending" | "sync_pending" | "error"
  | "unavailable"           // Expo Go: no native purchase support
  /**
   * The signed-in account changed while the store sheet was open.
   *
   * Its OWN status, deliberately not folded into sync_pending. sync_pending
   * means "your purchase is being applied to your account"; this means "your
   * purchase belongs to a different account and we are not touching this one".
   * Conflating them would eventually produce code that treats the second case
   * like the first and syncs under the wrong session.
   */
  | "account_changed";

export type PurchaseTarget = "monthly" | "annual";

/**
 * Scan pack SKUs, for PACKAGE RESOLUTION ONLY.
 *
 * Display and package lookup. The scan COUNT is never read from here — the
 * server resolves it from the store SKU via its own frozen map, so a tampered
 * client cannot ask for 1200 scans.
 */
export const SCAN_PACK_SKUS = [
  "flipstart_scan_pack_40",
  "flipstart_scan_pack_110",
  "flipstart_scan_pack_300",
  "flipstart_scan_pack_700",
  "flipstart_scan_pack_1200",
] as const;
export type ScanPackSku = typeof SCAN_PACK_SKUS[number];

/** Dedicated offering. Deliberately NOT the current offering — subscriptions
 *  keep that, and making packs current would change the paywall. */
export const SCAN_PACK_OFFERING = "scan_packs";

export interface PackPurchaseResult {
  status: PurchaseStatus;
  sku?: ScanPackSku;
  /** Scans the SERVER confirmed. Never a client-side number. */
  scansGranted?: number;
  packBalance?: number;
  message?: string;
  errorKind?: PurchaseErrorKind;
}

export interface PurchaseResult {
  status: PurchaseStatus;
  target?: PurchaseTarget;
  /** Plan the SERVER confirmed. Absent unless authoritative sync succeeded. */
  serverPlan?: RcPlanKind | null;
  /** What the local SDK reported. Presentation only, never authorization. */
  clientPlan?: RcPlanKind;
  message?: string;
  errorKind?: PurchaseErrorKind;
}

export type RestoreStatus =
  | "restored" | "nothing_to_restore" | "error" | "unavailable"
  | "sync_pending" | "account_changed"
  /**
   * The receipt is held by another FlipStart account with an ACTIVE
   * subscription. Under "Transfer if there are no active subscriptions" this is
   * the setting doing its job, not a fault — so it must not read as one.
   */
  | "owned_by_another_account";

export interface RestoreResult {
  status: RestoreStatus;
  serverPlan?: RcPlanKind | null;
  clientPlan?: RcPlanKind;
  message?: string;
}

// ── In-flight guard ─────────────────────────────────────────────────────────
// Module-level, not screen state. Two screens, or one screen re-rendering, must
// not each hold their own idea of whether a purchase is running — that is how
// rapid taps become two store requests.
let inFlight = false;
export function isPurchaseInProgress(): boolean { return inFlight; }

async function loadSdk(): Promise<any | null> {
  try {
    const mod = await import("react-native-purchases");
    return (mod as { default?: unknown }).default ?? mod;
  } catch {
    // Not installed, or no native module (Expo Go). Never a crash.
    return null;
  }
}

/**
 * Resolve a package by its STORE PRODUCT identifier.
 *
 * Deliberately not `offering.monthly` / `offering.annual`, and never by array
 * index: those are ordering- and convention-dependent, and a reordered offering
 * would silently sell the wrong plan. The product id is the contract.
 *
 * Missing offering or missing package returns a configuration error rather than
 * falling back to "the first package", because guessing here charges someone for
 * something they did not choose.
 */
export async function resolvePackage(
  sdk: any, target: PurchaseTarget,
): Promise<{ pkg: any | null; error?: string }> {
  /**
   * Resolved at call time, not at import.
   *
   * annualProductId() reads the configured key, and a module-level constant
   * would capture whatever it was when the module first loaded — before
   * configuration in some startup orders.
   */
  const wanted = target === "monthly" ? PRODUCT_MONTHLY : annualProductId();
  let offerings: any;
  try {
    offerings = await sdk.getOfferings();
  } catch {
    return { pkg: null, error: "Could not load subscription options." };
  }
  const current = offerings?.current;
  if (!current) return { pkg: null, error: "No subscription offering is configured." };

  const pkgs: any[] = current.availablePackages ?? [];
  const match = pkgs.find(p => p?.product?.identifier === wanted);
  if (!match) {
    console.warn(
      `[purchase] package for "${wanted}" not in offering "${current.identifier}". ` +
      `Available: ${pkgs.map(p => p?.product?.identifier).join(", ") || "none"}`,
    );
    return { pkg: null, error: "That plan isn't available right now." };
  }
  // Belt and braces: confirm what we matched is what we asked for.
  if (match.product?.identifier !== wanted) {
    return { pkg: null, error: "Subscription configuration mismatch." };
  }
  return { pkg: match };
}

/**
 * Authoritative reconciliation, with bounded retry.
 *
 * Three attempts with linear backoff. NOT an infinite loop: a purchase that
 * succeeded is already safe on RevenueCat's side, and hammering Railway would
 * make an outage worse. If all attempts fail the caller reports `sync_pending`,
 * and the next app launch or webhook reconciles.
 */
async function syncWithServer(attempts = 3): Promise<{ ok: boolean; plan: RcPlanKind | null }> {
  /**
   * tRPC is imported LAZILY, matching the project's lazy-Supabase convention.
   *
   * A module-level import would pull the whole client stack — and transitively
   * supabase and expo-secure-store — into anything that touches purchase logic,
   * which is the pattern that has broken iOS standalone startup before. It also
   * keeps this module unit-testable without the native tree.
   *
   * Built per call rather than cached: the client resolves auth headers at
   * request time, so a fresh one always carries the current session.
   */
  const { createTRPCClient } = await import("@/lib/trpc");
  const client = createTRPCClient();
  for (let i = 0; i < attempts; i++) {
    try {
      const res: any = await (client as any).monetization.syncSubscription.mutate();
      if (res?.ok) return { ok: true, plan: res?.entitlement?.plan ?? null };
      // Not ok but responded — e.g. RevenueCat unavailable server-side. Retry.
    } catch {
      // Transport failure. Retry.
    }
    if (i < attempts - 1) await new Promise(r => setTimeout(r, 800 * (i + 1)));
  }
  return { ok: false, plan: null };
}

/**
 * Buy a subscription.
 *
 * `expectedUserId` is captured by the caller BEFORE the store sheet opens and
 * re-checked after. If the signed-in account changed mid-purchase, User A's
 * result must never be applied to User B's local state.
 */
export async function purchase(
  target: PurchaseTarget,
  expectedUserId: string | null,
  currentUserId: () => string | null,
): Promise<PurchaseResult> {
  if (!expectedUserId) {
    return { status: "error", target, message: "Please sign in before subscribing." };
  }
  // Controlled result, not a second store request.
  if (inFlight) {
    return { status: "error", target, message: "A purchase is already in progress." };
  }

  const sdk = await loadSdk();
  if (!sdk || typeof sdk.purchasePackage !== "function") {
    // Expo Go. Explicit, and never a fabricated success.
    return {
      status: "unavailable", target,
      message: "Purchase testing requires a development build.",
    };
  }

  inFlight = true;
  try {
    const { pkg, error } = await resolvePackage(sdk, target);
    if (!pkg) return { status: "error", target, message: error, errorKind: "configuration" };

    let info: unknown;
    try {
      const res = await sdk.purchasePackage(pkg);
      info = res?.customerInfo ?? res;
    } catch (e) {
      const s = sanitizePurchaseError(e);
      // Cancellation and pending are NOT failures: nothing is granted, nothing
      // is synced, no balance moves.
      if (s.kind === "cancelled") return { status: "cancelled", target, message: s.userMessage };
      if (s.kind === "pending")   return { status: "pending", target, message: s.userMessage };
      // Buying while another account holds an active subscription on this Apple
      // Account. Blocked by design; surfaced with its own message so the user is
      // told which account to sign into rather than "something went wrong".
      if (s.kind === "owned_by_another_account") {
        return { status: "error", target, message: s.userMessage, errorKind: s.kind };
      }
      return { status: "error", target, message: s.userMessage, errorKind: s.kind };
    }

    /**
     * ── IDENTITY CHECK — before ANY result is read or applied ────────────────
     *
     * Placed above `planFromCustomerInfo` and above `syncWithServer` on purpose,
     * so on a mismatch A's CustomerInfo is never even mapped to a plan, let
     * alone returned or synced.
     *
     * We do NOT call the sync endpoint here. That endpoint derives identity
     * exclusively from the currently verified Supabase session, so calling it
     * now would reconcile B — and there is no client-supplied uid parameter to
     * "correct" that with, by design.
     *
     * A's purchase is not lost. RevenueCat holds it against A's appUserID, and
     * it reaches FlipStart through the webhook, or through A's own authenticated
     * reconciliation on next sign-in. Both derive identity server-side.
     */
    if (currentUserId() !== expectedUserId) {
      console.warn(
        "[purchase] account changed mid-purchase — NOT syncing, NOT applying to the new account",
      );
      return {
        status: "account_changed", target,
        // No clientPlan, no serverPlan: A's entitlement must not travel with a
        // result handed back while B is signed in.
        message: "That purchase belongs to a different account. Sign in to it to see the subscription.",
      };
    }

    const clientPlan = planFromCustomerInfo(info).planKind;

    // The store said yes. The server still decides.
    const sync = await syncWithServer();
    if (!sync.ok) {
      // CRITICAL: never reported as a purchase failure. They paid.
      return {
        status: "sync_pending", target, clientPlan,
        message: "Purchase complete. Finishing setup — this will finish shortly.",
      };
    }
    return { status: "success", target, clientPlan, serverPlan: sync.plan };
  } finally {
    // Cleared on EVERY terminal path, including throws.
    inFlight = false;
  }
}

/**
 * Restore.
 *
 * Shares the in-flight guard with purchase, because a restore racing a purchase
 * would produce two CustomerInfo updates and two syncs for the same account.
 */
export async function restorePurchases(
  expectedUserId: string | null,
  currentUserId: () => string | null,
): Promise<RestoreResult> {
  if (!expectedUserId) return { status: "error", message: "Please sign in first." };
  if (inFlight) return { status: "error", message: "Please wait for the current operation to finish." };

  const sdk = await loadSdk();
  if (!sdk || typeof sdk.restorePurchases !== "function") {
    return { status: "unavailable", message: "Restore requires a development build." };
  }

  inFlight = true;
  try {
    let info: unknown;
    try {
      info = await sdk.restorePurchases();
    } catch (e) {
      const s = sanitizePurchaseError(e);
      // A blocked transfer is the expected, correct outcome when someone else
      // holds an active subscription on this Apple Account. Reporting it as a
      // generic error would make working protection look like a bug.
      if (s.kind === "owned_by_another_account") {
        return { status: "owned_by_another_account", message: s.userMessage };
      }
      return { status: "error", message: s.userMessage };
    }

    /**
     * Same rule for restore, and for the same reason: the sync endpoint would
     * reconcile whoever is signed in NOW.
     */
    if (currentUserId() !== expectedUserId) {
      console.warn("[restore] account changed mid-restore — NOT syncing, NOT applying");
      return {
        status: "account_changed",
        message: "The account changed. Sign in to the original account to restore it.",
      };
    }

    const clientPlan = planFromCustomerInfo(info).planKind;

    // Always reconcile, even when nothing was found: the server may know about
    // an expiry the client has not seen.
    const sync = await syncWithServer();

    // "Nothing to restore" is a clean, ordinary answer — never an error.
    if (clientPlan === "free" && (sync.plan === "free" || sync.plan === null)) {
      return { status: "nothing_to_restore", clientPlan, serverPlan: sync.plan };
    }
    if (!sync.ok) {
      return { status: "sync_pending", clientPlan, message: "Restored. Finishing setup." };
    }
    return { status: "restored", clientPlan, serverPlan: sync.plan };
  } finally {
    inFlight = false;
  }
}

/**
 * Resolve a scan-pack package from the dedicated `scan_packs` offering.
 *
 * By product identifier, never by index or position — a reordered offering must
 * not sell a different pack. Looks in `all[SCAN_PACK_OFFERING]` because scan
 * packs are deliberately not the current offering.
 */
export async function resolvePackPackage(
  sdk: any, sku: ScanPackSku,
): Promise<{ pkg: any | null; error?: string }> {
  let offerings: any;
  try { offerings = await sdk.getOfferings(); }
  catch { return { pkg: null, error: "Could not load scan packs." }; }

  const offering = offerings?.all?.[SCAN_PACK_OFFERING];
  if (!offering) return { pkg: null, error: "Scan packs aren't available right now." };

  const pkgs: any[] = offering.availablePackages ?? [];
  const match = pkgs.find(p => p?.product?.identifier === sku);
  if (!match) {
    console.warn(`[purchase] pack "${sku}" not in offering "${SCAN_PACK_OFFERING}". ` +
      `Available: ${pkgs.map(p => p?.product?.identifier).join(", ") || "none"}`);
    return { pkg: null, error: "That scan pack isn't available right now." };
  }
  return { pkg: match };
}

/**
 * Buy a scan pack.
 *
 * The client NEVER tells the server what was bought or how many scans to grant.
 * It completes the store purchase, then asks the server to reconcile; the server
 * independently verifies with RevenueCat V2 and decides the grant.
 */
export async function purchaseScanPack(
  sku: ScanPackSku,
  expectedUserId: string | null,
  currentUserId: () => string | null,
): Promise<PackPurchaseResult> {
  if (!expectedUserId) return { status: "error", sku, message: "Please sign in first." };
  if (inFlight) return { status: "error", sku, message: "A purchase is already in progress." };

  const sdk = await loadSdk();
  if (!sdk || typeof sdk.purchasePackage !== "function") {
    return { status: "unavailable", sku, message: "Purchase testing requires a development build." };
  }

  inFlight = true;
  try {
    const { pkg, error } = await resolvePackPackage(sdk, sku);
    if (!pkg) return { status: "error", sku, message: error, errorKind: "configuration" };

    try {
      await sdk.purchasePackage(pkg);
    } catch (e) {
      const s = sanitizePurchaseError(e);
      if (s.kind === "cancelled") return { status: "cancelled", sku, message: s.userMessage };
      if (s.kind === "pending")   return { status: "pending", sku, message: s.userMessage };
      return { status: "error", sku, message: s.userMessage, errorKind: s.kind };
    }

    // Same rule as subscriptions: if the account changed, this result is not
    // ours to apply, and the sync endpoint would reconcile the WRONG user.
    if (currentUserId() !== expectedUserId) {
      console.warn("[purchase] account changed mid-pack-purchase — NOT granting here");
      return {
        status: "account_changed", sku,
        message: "That purchase belongs to a different account. Sign in to it to see your scans.",
      };
    }

    // Server-authoritative grant. Recovery is idempotent, so a webhook that
    // already granted simply reports already_granted.
    const r = await recoverPacksOnServer();
    if (!r.ok) {
      // They paid. The webhook or a later recovery will grant it.
      return { status: "sync_pending", sku, message: "Purchase complete. Your scans will appear shortly." };
    }
    return {
      status: "success", sku,
      scansGranted: r.totalScansGranted, packBalance: r.packBalance,
    };
  } finally {
    inFlight = false;
  }
}

/** Ask the server to grant any purchase it has not yet recorded. */
export async function recoverPacksOnServer(): Promise<{
  ok: boolean; grantedCount: number; totalScansGranted: number;
  alreadyGranted: number; packBalance?: number;
}> {
  try {
    const { createTRPCClient } = await import("@/lib/trpc");
    const client = createTRPCClient();
    const res: any = await (client as any).monetization.recoverScanPacks.mutate();
    return {
      ok: Boolean(res?.ok),
      grantedCount: res?.grantedCount ?? 0,
      totalScansGranted: res?.totalScansGranted ?? 0,
      alreadyGranted: res?.alreadyGranted ?? 0,
      packBalance: res?.entitlement?.balances?.packScansRemaining,
    };
  } catch {
    return { ok: false, grantedCount: 0, totalScansGranted: 0, alreadyGranted: 0 };
  }
}

/** Authoritative refresh with no purchase. Reuses the Phase 2A endpoint —
 *  deliberately NOT a second sync architecture. */
export async function refreshSubscriptionState(): Promise<{ ok: boolean; plan: RcPlanKind | null }> {
  return syncWithServer(1);
}

/** Test seam. */
export function __resetPurchaseGuard(): void { inFlight = false; }
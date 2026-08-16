/**
 * lib/revenuecat.ts
 *
 * The ONE place FlipStart talks to the RevenueCat SDK.
 *
 * ── Lazy import, deliberately ───────────────────────────────────────────────
 * `react-native-purchases` is a native module. A top-level import crashes Expo
 * Go if the package is absent and, historically in this project, static native
 * imports at module scope have broken iOS standalone startup (the
 * react-native-url-polyfill lesson). Everything here loads inside a guarded
 * dynamic import, so a missing or unavailable SDK degrades to "unconfigured"
 * instead of a white screen.
 *
 * ── Never anonymous ─────────────────────────────────────────────────────────
 * FlipStart requires an account. Configuring RevenueCat before the Supabase uid
 * is known would mint an `$RCAnonymousID:` customer, and a later logIn would
 * leave an orphan customer holding purchases. So configuration WAITS for the
 * authenticated uid and passes it as appUserID.
 *
 * ── Client state is for UI only ─────────────────────────────────────────────
 * Nothing here is authorization. The server independently queries RevenueCat.
 * In Expo Go, Preview API Mode may return mock CustomerInfo — which is fine for
 * building a paywall and must never reach the server as truth.
 */

export type RcStatus = "unconfigured" | "initializing" | "ready" | "error";
export type RcPlanKind = "free" | "trial" | "monthly" | "annual" | "unknown";

export const PRO_ENTITLEMENT = "pro";
export const PRODUCT_MONTHLY = "flipstart_pro_monthly";
export const PRODUCT_ANNUAL  = "flipstart_pro_annual";

export interface RcState {
  status: RcStatus;
  appUserId: string | null;
  isPro: boolean;
  planKind: RcPlanKind;
  activeProductId: string | null;
  periodType: string | null;
  expiresAt: string | null;
  willRenew: boolean | null;
  monthlyPackage: unknown | null;
  annualPackage: unknown | null;
  offeringLoaded: boolean;
  lastUpdatedAt: number | null;
  error: string | null;
}

export const initialRcState: RcState = {
  status: "unconfigured", appUserId: null, isPro: false, planKind: "free",
  activeProductId: null, periodType: null, expiresAt: null, willRenew: null,
  monthlyPackage: null, annualPackage: null, offeringLoaded: false,
  lastUpdatedAt: null, error: null,
};

/**
 * Which SDK key to use.
 *
 * The Test Store key must NEVER be selected in a release build — it would point
 * a shipped app at a store that cannot take real money, and the failure would be
 * silent. In production without a real Apple key we return null and RevenueCat
 * stays unconfigured, which is a visible, safe failure rather than a fake one.
 */
export function resolveApiKey(): { key: string | null; kind: "test" | "apple" | "none" } {
  const apple = (process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY ?? "").trim();
  if (apple) return { key: apple, kind: "apple" };

  const test = (process.env.EXPO_PUBLIC_REVENUECAT_TEST_API_KEY ?? "").trim();
  if (test && __DEV__) return { key: test, kind: "test" };

  if (test && !__DEV__) {
    console.error(
      "[revenuecat] Test Store key present in a RELEASE build — refusing to use it. " +
      "Set EXPO_PUBLIC_REVENUECAT_IOS_API_KEY.",
    );
  }
  return { key: null, kind: "none" };
}

/** Map CustomerInfo to a FlipStart plan. Mirrors the server normalizer so both
 *  sides agree — the server remains authoritative. */
export function planFromCustomerInfo(info: unknown): {
  isPro: boolean; planKind: RcPlanKind; productId: string | null;
  periodType: string | null; expiresAt: string | null; willRenew: boolean | null;
} {
  const ent = (info as { entitlements?: { active?: Record<string, unknown> } })
    ?.entitlements?.active?.[PRO_ENTITLEMENT] as {
      productIdentifier?: string; periodType?: string;
      expirationDate?: string | null; willRenew?: boolean;
    } | undefined;

  if (!ent) {
    return { isPro: false, planKind: "free", productId: null,
             periodType: null, expiresAt: null, willRenew: null };
  }

  const periodType = (ent.periodType ?? "").toUpperCase();
  const productId = ent.productIdentifier ?? null;

  // Trial outranks product: an annual product in trial is a 50-scan trial, not
  // 4,000 annual scans.
  const planKind: RcPlanKind =
    periodType === "TRIAL" ? "trial"
    : productId === PRODUCT_MONTHLY ? "monthly"
    : productId === PRODUCT_ANNUAL ? "annual"
    : "unknown";   // never guessed

  if (planKind === "unknown") {
    console.warn(`[revenuecat] unrecognised active product "${productId}" — not guessing a plan`);
  }

  return {
    isPro: true, planKind, productId,
    periodType: ent.periodType ?? null,
    expiresAt: ent.expirationDate ?? null,
    willRenew: typeof ent.willRenew === "boolean" ? ent.willRenew : null,
  };
}

// ── Module singleton ────────────────────────────────────────────────────────
let Purchases: any = null;
let configuredFor: string | null = null;
let listenerAttached = false;

async function loadSdk(): Promise<any> {
  if (Purchases) return Purchases;
  try {
    const mod = await import("react-native-purchases");
    Purchases = (mod as { default?: unknown }).default ?? mod;
    return Purchases;
  } catch {
    // Not installed, or unavailable in this runtime. Not an error worth
    // surfacing: FlipStart works fully without RevenueCat until purchases exist.
    return null;
  }
}

/**
 * Configure, or switch identity, for an authenticated Supabase user.
 *
 * Called ONLY with a resolved uid. Configuring twice for the same user is a
 * no-op; a different user goes through logIn(), never logOut() — logOut would
 * create the anonymous customer this architecture avoids.
 */
export async function configureForUser(
  supabaseUserId: string,
  onUpdate?: (s: Partial<RcState>) => void,
): Promise<Partial<RcState>> {
  if (!supabaseUserId) return { status: "unconfigured" };
  if (configuredFor === supabaseUserId) return { status: "ready", appUserId: supabaseUserId };

  const { key, kind } = resolveApiKey();
  if (!key) return { status: "unconfigured", error: "no RevenueCat key for this build" };

  const sdk = await loadSdk();
  if (!sdk) return { status: "unconfigured", error: "SDK unavailable" };

  try {
    if (configuredFor === null) {
      // appUserID supplied up front — no anonymous customer is ever created.
      await sdk.configure({ apiKey: key, appUserID: supabaseUserId });
      console.log(`[revenuecat] configured user=${supabaseUserId.slice(0, 8)}… key=${kind}`);
    } else {
      // Same process, different account. logIn switches identified customers.
      await sdk.logIn(supabaseUserId);
      console.log(`[revenuecat] identity switched to ${supabaseUserId.slice(0, 8)}…`);
    }
    configuredFor = supabaseUserId;

    if (!listenerAttached && typeof sdk.addCustomerInfoUpdateListener === "function") {
      sdk.addCustomerInfoUpdateListener((info: unknown) => {
        onUpdate?.({ ...planFromCustomerInfo(info), lastUpdatedAt: Date.now() });
      });
      listenerAttached = true;
    }

    const info = await sdk.getCustomerInfo();
    const offering = await loadOffering(sdk);
    return {
      status: "ready", appUserId: supabaseUserId,
      ...planFromCustomerInfo(info), ...offering, lastUpdatedAt: Date.now(), error: null,
    };
  } catch (e) {
    console.warn("[revenuecat] configure failed:", (e as Error).message);
    // Never fatal. Free functionality continues; Pro is simply not granted.
    return { status: "error", error: "RevenueCat unavailable" };
  }
}

async function loadOffering(sdk: any): Promise<Partial<RcState>> {
  try {
    const offerings = await sdk.getOfferings();
    const current = offerings?.current;
    if (!current) {
      console.warn("[revenuecat] no current offering — paywall data unavailable");
      return { offeringLoaded: false, monthlyPackage: null, annualPackage: null };
    }
    const pkgs: any[] = current.availablePackages ?? [];
    const find = (id: string) =>
      pkgs.find(p => p?.product?.identifier === id) ?? null;
    console.log("[revenuecat] offering default loaded");
    return {
      offeringLoaded: true,
      monthlyPackage: find(PRODUCT_MONTHLY),
      annualPackage: find(PRODUCT_ANNUAL),
    };
  } catch {
    return { offeringLoaded: false, monthlyPackage: null, annualPackage: null };
  }
}

/**
 * FlipStart logout.
 *
 * Deliberately does NOT call Purchases.logOut(): that would create an anonymous
 * customer. The SDK keeps the previous identified user until the next account
 * logs in and logIn() switches it. What matters is that FlipStart's own view is
 * cleared, so User A's Pro state can never be visible while User B signs in.
 */
export function clearLocalState(): RcState {
  console.log("[revenuecat] local state cleared for account transition");
  return { ...initialRcState };
}

/** Test seam. */
export function __resetRevenueCat(): void {
  Purchases = null; configuredFor = null; listenerAttached = false;
}
export function __configuredFor(): string | null { return configuredFor; }
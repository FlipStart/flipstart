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
/** Mirrors the server. No trial: an unexpected RevenueCat trial is "unknown",
 *  which grants nothing and is reported rather than interpreted. */
export type RcPlanKind = "free" | "monthly" | "annual" | "unknown";

export const PRO_ENTITLEMENT = "pro";
export const PRODUCT_MONTHLY = "flipstart_pro_monthly";

/**
 * Annual identifiers, mirroring server/monetization/policy.ts.
 *
 * ── Why the client cannot import the server constant ────────────────────────
 * policy.ts reads REVENUECAT_PURCHASE_ENVIRONMENT, a Railway variable that is
 * not in the app bundle. The client therefore resolves the same split from the
 * key it is configured with, which is the only environment signal it has.
 *
 * ── Why keying on the API key is correct here ───────────────────────────────
 * The Test Store key and the Apple key ARE the environment distinction on the
 * client. A build using the Test Store key is talking to Test Store, so it must
 * offer the Test Store product. Using build type instead would be wrong: a
 * development build pointed at Apple Sandbox would offer the wrong id.
 */
export const PRODUCT_ANNUAL_SANDBOX    = "flipstart_pro_annual_v2";
export const PRODUCT_ANNUAL_PRODUCTION = "flipstart_pro_annual";

/** Every identifier that has meant "annual". Recognition only, never selling. */
export const ANNUAL_PRODUCT_IDS: readonly string[] = Object.freeze([
  PRODUCT_ANNUAL_SANDBOX,
  PRODUCT_ANNUAL_PRODUCTION,
]);

export function isAnnualProduct(productId: string | null | undefined): boolean {
  return !!productId && ANNUAL_PRODUCT_IDS.includes(productId);
}

/**
 * The annual product to OFFER in this build.
 *
 * Apple key present -> production catalog. Otherwise Test Store, which is the
 * only place the `_v2` workaround exists.
 */
export function annualProductId(): string {
  const apple = (process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY ?? "").trim();
  return apple ? PRODUCT_ANNUAL_PRODUCTION : PRODUCT_ANNUAL_SANDBOX;
}

/**
 * @deprecated Use annualProductId() for selling, isAnnualProduct() for
 * recognition. Kept so existing imports keep compiling.
 */
export const PRODUCT_ANNUAL = PRODUCT_ANNUAL_SANDBOX;

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

  /**
   * An unexpected TRIAL resolves to "unknown", matching the server normalizer.
   *
   * FlipStart offers no free trial, so this state means stale sandbox or a
   * dashboard introductory offer. Never reinterpreted as a paid plan — and this
   * is presentation only; the server decides entitlement independently.
   */
  const planKind: RcPlanKind =
    periodType === "TRIAL" ? "unknown"
    : productId === PRODUCT_MONTHLY ? "monthly"
    : isAnnualProduct(productId) ? "annual"
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

// ════════════════════════════════════════════════════════════════════════════
// CLIENT DIAGNOSTICS
//
// The server harness could not have caught the failure that cost a TestFlight
// build: no SDK installed, configureForUser never called, and no key in any EAS
// profile were ALL client-side and invisible to Railway.
//
// Reports only non-sensitive facts. The API key is NEVER printed — a short
// prefix at most, which identifies the key TYPE without revealing it.
// ════════════════════════════════════════════════════════════════════════════

export type KeyKind = "TEST_STORE" | "IOS" | "MISSING";

export interface RcDiagnostics {
  sdkInstalled: boolean;
  sdkVersion: string | null;
  configured: boolean;
  configuredFor: string | null;
  keyKind: KeyKind;
  /** First few characters only — enough to tell a key apart, not to use one. */
  keyPrefix: string | null;
  /** True when a Test Store key is present but refused for being a release build. */
  keyRefusedForReleaseBuild: boolean;
  isDevBuild: boolean;
  offeringIds: string[];
  currentOfferingId: string | null;
  packages: Array<{ offering: string; packageId: string; productId: string }>;
  errors: string[];
}

/** Key TYPE from its documented prefix, without exposing the key. */
function classifyKey(key: string): KeyKind {
  if (key.startsWith("appl_")) return "IOS";
  if (key.startsWith("test_") || key.startsWith("sk_test") || key.startsWith("rcb_")) return "TEST_STORE";
  // Unrecognised prefix. Reported as TEST_STORE only when it came from the test
  // variable, so an unknown key is never mistaken for an Apple one.
  return "TEST_STORE";
}

export async function collectDiagnostics(): Promise<RcDiagnostics> {
  const errors: string[] = [];
  const isDev = Boolean(__DEV__);

  const appleRaw = (process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY ?? "").trim();
  const testRaw  = (process.env.EXPO_PUBLIC_REVENUECAT_TEST_API_KEY ?? "").trim();
  const rawKey   = appleRaw || testRaw;

  const keyKind: KeyKind =
    appleRaw ? "IOS" : testRaw ? classifyKey(testRaw) : "MISSING";
  // 8 characters is enough to distinguish appl_ from test_ and to tell two keys
  // apart, and far too little to authenticate with.
  const keyPrefix = rawKey ? `${rawKey.slice(0, 8)}…` : null;

  const refused = Boolean(testRaw && !appleRaw && !isDev);
  if (keyKind === "MISSING") {
    errors.push("No RevenueCat key in this build. Add EXPO_PUBLIC_REVENUECAT_TEST_API_KEY to the EAS development environment.");
  }
  if (refused) {
    errors.push("Test Store key present but this is a RELEASE build — refused by design. Use a development build.");
  }

  const sdk = await loadSdk();
  if (!sdk) {
    errors.push("react-native-purchases is not available. Run: npx expo install react-native-purchases");
    return {
      sdkInstalled: false, sdkVersion: null, configured: false, configuredFor: null,
      keyKind, keyPrefix, keyRefusedForReleaseBuild: refused, isDevBuild: isDev,
      offeringIds: [], currentOfferingId: null, packages: [], errors,
    };
  }

  let sdkVersion: string | null = null;
  try {
    const mod: any = await import("react-native-purchases");
    sdkVersion = mod?.VERSION ?? mod?.default?.VERSION ?? null;
  } catch { /* version is a nice-to-have */ }

  const configured = configuredFor !== null;
  if (!configured) {
    errors.push("RevenueCat is not configured. configureForUser() runs on sign-in — check that a user is signed in.");
  }

  const offeringIds: string[] = [];
  const packages: RcDiagnostics["packages"] = [];
  let currentOfferingId: string | null = null;

  if (configured) {
    try {
      const offerings = await sdk.getOfferings();
      currentOfferingId = offerings?.current?.identifier ?? null;
      const all = offerings?.all ?? {};
      for (const [id, offering] of Object.entries<any>(all)) {
        offeringIds.push(id);
        for (const p of offering?.availablePackages ?? []) {
          packages.push({
            offering: id,
            packageId: p?.identifier ?? "?",
            productId: p?.product?.identifier ?? "?",
          });
        }
      }
      if (offeringIds.length === 0) {
        errors.push("getOfferings() returned no offerings. Check the RevenueCat dashboard for this project.");
      }
    } catch (e) {
      // Sanitized: code and short message only, never a payload or a key.
      const err = e as { code?: unknown; message?: unknown };
      const code = typeof err?.code === "string" ? err.code : "unknown";
      const msg = typeof err?.message === "string" ? err.message.slice(0, 120) : "";
      errors.push(`getOfferings failed [${code}] ${msg}`);
    }
  }

  return {
    sdkInstalled: true, sdkVersion, configured, configuredFor,
    keyKind, keyPrefix, keyRefusedForReleaseBuild: refused, isDevBuild: isDev,
    offeringIds, currentOfferingId, packages, errors,
  };
}
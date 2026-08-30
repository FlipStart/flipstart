/**
 * __tests__/monetization/revenuecat-key.test.ts
 *
 * The client SDK key must be the right KIND of credential, not merely present
 * in the right-looking variable.
 *
 * ── These execute the real function ─────────────────────────────────────────
 * lib/revenuecat.ts has no top-level imports and reads `process.env` and
 * `__DEV__` inside the function body, so `resolveApiKey()` runs for real here —
 * no shims, no source-text inference. Every case below is the actual decision
 * the app would make at launch.
 *
 * ── Why this matters more than it looks ─────────────────────────────────────
 * RevenueCat issues three credentials that all look like plausible "API keys":
 *
 *   appl_…  iOS PUBLIC SDK key   — belongs in the client
 *   test_…  Test Store PUBLIC key — development only
 *   sk_…    SECRET server key     — Railway only, never the bundle
 *
 * The variable NAME does not enforce which one was pasted into it. Before this
 * patch the code trusted the name, so a `test_` key in the iOS variable shipped
 * a release pointed at a store that cannot take money, and an `sk_` key would
 * have been bundled into the IPA and used as an SDK key.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isAppleApiKey, describeKeyPrefix, resolveApiKey, annualProductId,
  PRODUCT_ANNUAL_PRODUCTION, PRODUCT_ANNUAL_SANDBOX,
} from "@/lib/revenuecat";

const IOS_VAR = "EXPO_PUBLIC_REVENUECAT_IOS_API_KEY";
const TEST_VAR = "EXPO_PUBLIC_REVENUECAT_TEST_API_KEY";

/** Structurally realistic, entirely fabricated. No real credential appears here. */
const FAKE_APPLE = "appl_AbCdEfGhIjKlMnOpQrStUvWxYz";
const FAKE_TEST = "test_AbCdEfGhIjKlMnOpQrStUvWxYz";
const FAKE_SECRET = "sk_AbCdEfGhIjKlMnOpQrStUvWxYz";

function setEnv(ios?: string, test?: string) {
  if (ios === undefined) delete process.env[IOS_VAR];
  else process.env[IOS_VAR] = ios;
  if (test === undefined) delete process.env[TEST_VAR];
  else process.env[TEST_VAR] = test;
}

/** `__DEV__` is a React Native global; the bare runner has to supply it. */
function setDev(isDev: boolean) {
  (globalThis as any).__DEV__ = isDev;
}

const original = { ios: process.env[IOS_VAR], test: process.env[TEST_VAR] };

beforeEach(() => {
  // Silenced so an intentional failure case does not print a scary error.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  setEnv(original.ios, original.test);
  delete (globalThis as any).__DEV__;
});

// ── 1. The happy path ───────────────────────────────────────────────────────

describe("a well-formed Apple key", () => {
  it("is accepted in a release build", () => {
    setDev(false);
    setEnv(FAKE_APPLE, undefined);
    expect(resolveApiKey()).toEqual({ key: FAKE_APPLE, kind: "apple" });
  });

  it("is accepted in development too, and wins over the Test Store key", () => {
    setDev(true);
    setEnv(FAKE_APPLE, FAKE_TEST);
    // Apple key present means the production catalog — see annualProductId().
    expect(resolveApiKey()).toEqual({ key: FAKE_APPLE, kind: "apple" });
  });

  it("recognises the prefix without inspecting the rest of the value", () => {
    expect(isAppleApiKey(FAKE_APPLE)).toBe(true);
    // Prefix alone is not a key.
    expect(isAppleApiKey("appl_")).toBe(false);
    expect(isAppleApiKey("")).toBe(false);
  });
});

// ── 2-4. Wrong credential in the iOS variable ───────────────────────────────

describe("the wrong credential in the iOS variable", () => {
  /**
   * Requirement 2, and the gap this patch closes.
   *
   * Before the fix this returned kind "apple" and configure() was handed a Test
   * Store key in a production build — a shipped app pointed at a store that
   * cannot charge anyone, failing silently.
   */
  it("rejects a Test Store key pasted into the iOS variable", () => {
    for (const dev of [true, false]) {
      setDev(dev);
      setEnv(FAKE_TEST, undefined);
      expect(resolveApiKey()).toEqual({ key: null, kind: "none" });
    }
  });

  /** Requirement 3. The worst paste: a secret key bundled AND used. */
  it("rejects a secret server key pasted into the iOS variable", () => {
    setDev(false);
    setEnv(FAKE_SECRET, undefined);
    expect(resolveApiKey()).toEqual({ key: null, kind: "none" });
  });

  /** Requirement 4. */
  it("rejects malformed values", () => {
    setDev(false);
    for (const bad of ["appl", "APPL_XXXX", " appl", "xyz", "appl_", "rcb_abc", "1234"]) {
      setEnv(bad, undefined);
      expect(resolveApiKey().key).toBeNull();
      expect(resolveApiKey().kind).toBe("none");
    }
  });

  /** Whitespace is trimmed before classification — a trailing newline is not a fault. */
  it("tolerates surrounding whitespace on a valid key", () => {
    setDev(false);
    setEnv(`  ${FAKE_APPLE}\n`, undefined);
    expect(resolveApiKey()).toEqual({ key: FAKE_APPLE, kind: "apple" });
  });

  /**
   * No fallback, in any build.
   *
   * A bad Apple key must NOT quietly fall through to the Test Store key —
   * that would produce exactly the silent fake-store release the release guard
   * exists to prevent.
   */
  it("never falls back to the Test Store key when the Apple key is bad", () => {
    for (const dev of [true, false]) {
      setDev(dev);
      setEnv(FAKE_TEST, FAKE_TEST);           // bad iOS value, valid test value
      const r = resolveApiKey();
      expect(r.key).toBeNull();
      expect(r.kind).not.toBe("test");
    }
  });
});

// ── 5-6. Release and development behaviour preserved ────────────────────────

describe("build-type behaviour is unchanged", () => {
  /** Requirement 5. */
  it("stays unconfigured in release when only a Test Store key exists", () => {
    setDev(false);
    setEnv(undefined, FAKE_TEST);
    expect(resolveApiKey()).toEqual({ key: null, kind: "none" });
  });

  /** Requirement 6. */
  it("still uses the Test Store key in development", () => {
    setDev(true);
    setEnv(undefined, FAKE_TEST);
    expect(resolveApiKey()).toEqual({ key: FAKE_TEST, kind: "test" });
  });

  it("returns none when neither key is set", () => {
    for (const dev of [true, false]) {
      setDev(dev);
      setEnv(undefined, undefined);
      expect(resolveApiKey()).toEqual({ key: null, kind: "none" });
    }
  });
});

// ── Diagnostics must not leak the key ───────────────────────────────────────

describe("sanitized reporting", () => {
  /**
   * Enough to diagnose ("you pasted the secret key"), far too little to
   * authenticate with.
   */
  it("exposes only the leading characters", () => {
    expect(describeKeyPrefix(FAKE_SECRET)).toBe("sk_Ab…");
    expect(describeKeyPrefix(FAKE_APPLE)).toBe("appl_…");
    expect(describeKeyPrefix(FAKE_TEST)).toBe("test_…");
  });

  /** A short value must not leak proportionally more of itself. */
  it("never returns more than five characters of key material", () => {
    for (const k of [FAKE_APPLE, FAKE_TEST, FAKE_SECRET, "abc", "ab"]) {
      expect(describeKeyPrefix(k).replace("…", "").length).toBeLessThanOrEqual(5);
    }
  });

  it("logs the failure without printing the key", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    setDev(false);
    setEnv(FAKE_SECRET, undefined);
    resolveApiKey();
    expect(spy).toHaveBeenCalled();
    const logged = spy.mock.calls.flat().join(" ");
    expect(logged).not.toContain(FAKE_SECRET);
    expect(logged).toContain("sk_Ab…");
  });
});


// ── The annual product this build offers ────────────────────────────────────

describe("annual product selection", () => {
  /**
   * ── Why this shares isAppleApiKey with resolveApiKey ───────────────────
   *
   * annualProductId() used to check only that the iOS variable was NON-EMPTY.
   * That made it disagree with resolveApiKey(), which validates the prefix: a
   * `test_` key pasted into EXPO_PUBLIC_REVENUECAT_IOS_API_KEY left the SDK
   * correctly unconfigured while this function still reported the PRODUCTION
   * annual id.
   *
   * Two functions answering "is this a real Apple build?" differently is the
   * drift worth pinning, even though the mismatch was not exploitable on its
   * own — an unconfigured SDK cannot sell anything.
   */

  /** Requirement 1. */
  it("selects the production annual for a valid Apple key", () => {
    for (const dev of [true, false]) {
      setDev(dev);
      setEnv(FAKE_APPLE, undefined);
      expect(annualProductId()).toBe(PRODUCT_ANNUAL_PRODUCTION);
      expect(annualProductId()).toBe("flipstart_pro_annual");
      // The `_v2` id is Test Store only and must never be sold on Apple.
      expect(annualProductId()).not.toBe(PRODUCT_ANNUAL_SANDBOX);
    }
  });

  /** Requirement 2. The exact gap ISSUE-1 closed. */
  it("does NOT select the production annual for a test_ key in the iOS variable", () => {
    setDev(false);
    setEnv(FAKE_TEST, undefined);
    expect(annualProductId()).not.toBe(PRODUCT_ANNUAL_PRODUCTION);
    expect(annualProductId()).toBe(PRODUCT_ANNUAL_SANDBOX);
  });

  /** Requirement 3. */
  it("does NOT select the production annual for a secret key in the iOS variable", () => {
    setDev(false);
    setEnv(FAKE_SECRET, undefined);
    expect(annualProductId()).not.toBe(PRODUCT_ANNUAL_PRODUCTION);
  });

  /** Requirement 4. */
  it("does NOT select the production annual for a malformed value", () => {
    setDev(false);
    for (const bad of ["appl", "APPL_XXXX", "appl_", "xyz", "1234", "rcb_abc"]) {
      setEnv(bad, undefined);
      expect(annualProductId()).not.toBe(PRODUCT_ANNUAL_PRODUCTION);
    }
  });

  /** Requirement 5. Test Store development is unchanged. */
  it("selects the Test Store annual in development with only a test_ key", () => {
    setDev(true);
    setEnv(undefined, FAKE_TEST);
    expect(annualProductId()).toBe(PRODUCT_ANNUAL_SANDBOX);
    expect(annualProductId()).toBe("flipstart_pro_annual_v2");
    // And the SDK still configures against the Test Store.
    expect(resolveApiKey()).toEqual({ key: FAKE_TEST, kind: "test" });
  });

  it("selects the Test Store annual when no key is present at all", () => {
    setDev(false);
    setEnv(undefined, undefined);
    expect(annualProductId()).toBe(PRODUCT_ANNUAL_SANDBOX);
  });

  /**
   * Requirement 6, and the property that makes the whole thing safe.
   *
   * A release build with a bad Apple key must stay unconfigured. Whatever
   * annualProductId() reports is then moot — nothing can be purchased — but the
   * two must agree, which is the point of sharing the predicate.
   */
  it("stays unconfigured in release when the Apple key is invalid", () => {
    setDev(false);
    for (const bad of [FAKE_TEST, FAKE_SECRET, "appl_", "garbage"]) {
      setEnv(bad, FAKE_TEST);
      expect(resolveApiKey()).toEqual({ key: null, kind: "none" });
      // Never the production catalog while unconfigured.
      expect(annualProductId()).not.toBe(PRODUCT_ANNUAL_PRODUCTION);
    }
  });

  /** The two functions must never disagree about what a real Apple build is. */
  it("agrees with resolveApiKey on every input", () => {
    setDev(false);
    for (const value of [FAKE_APPLE, FAKE_TEST, FAKE_SECRET, "appl_", "", "xyz"]) {
      setEnv(value || undefined, undefined);
      const configuredAsApple = resolveApiKey().kind === "apple";
      const sellsProductionAnnual = annualProductId() === PRODUCT_ANNUAL_PRODUCTION;
      expect(sellsProductionAnnual).toBe(configuredAsApple);
    }
  });
});
/**
 * __tests__/monetization/sandbox-pack-allowlist.test.ts
 *
 * The sandbox Scan Pack allowlist, including the "*" QA wildcard.
 *
 * ── Why this is worth its own file ──────────────────────────────────────────
 * `pack_scan_balance` never expires and never resets, so a scan granted from a
 * free sandbox purchase is permanent and indistinguishable from a paid one.
 * The wildcard exists to make broad TestFlight QA practical; these tests exist
 * to make sure it can never do that in production.
 *
 * ── The Supabase stub ───────────────────────────────────────────────────────
 * scanPackGrant imports supabaseAdmin transitively, which imports the Supabase
 * SDK. Nothing under test touches the database — only env parsing — so the SDK
 * is stubbed to keep this a pure unit test with no client construction.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({}),
}));

import { isSandboxGrantAllowed, SANDBOX_GRANT_WILDCARD } from "@/server/monetization/scanPackGrant";

const ALLOWLIST = "REVENUECAT_SANDBOX_PACK_USER_IDS";
const ENVIRONMENT = "REVENUECAT_PURCHASE_ENVIRONMENT";

const UID_A = "1a1a1a1a-bbbb-4ccc-8ddd-eeeeffff0000";
const UID_B = "22222222-2222-4222-8222-222222222222";
const UID_C = "33333333-3333-4333-8333-333333333333";

function setEnv(list: string | undefined, environment: string | undefined) {
  if (list === undefined) delete process.env[ALLOWLIST];
  else process.env[ALLOWLIST] = list;
  if (environment === undefined) delete process.env[ENVIRONMENT];
  else process.env[ENVIRONMENT] = environment;
}

const original = { list: process.env[ALLOWLIST], env: process.env[ENVIRONMENT] };

beforeEach(() => {
  // Silenced: the production-wildcard case logs an intentional warning.
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  setEnv(original.list, original.env);
});

// ── The wildcard, in sandbox ────────────────────────────────────────────────

describe("sandbox + wildcard", () => {
  it("allows any authenticated user", () => {
    setEnv("*", "sandbox");
    for (const uid of [UID_A, UID_B, UID_C, "any-other-authenticated-uid"]) {
      expect(isSandboxGrantAllowed(uid)).toBe(true);
    }
  });

  it("exposes the wildcard as a named constant", () => {
    expect(SANDBOX_GRANT_WILDCARD).toBe("*");
  });

  it("tolerates whitespace and mixed entries", () => {
    setEnv(`  * , ${UID_A} `, "sandbox");
    expect(isSandboxGrantAllowed(UID_B)).toBe(true);
    expect(isSandboxGrantAllowed(UID_A)).toBe(true);
  });

  /**
   * "All AUTHENTICATED users" is not "anyone". An absent uid must not ride in
   * on the wildcard — there is no user to attribute the grant to.
   */
  it("still requires an authenticated user", () => {
    setEnv("*", "sandbox");
    for (const uid of ["", null as any, undefined as any]) {
      expect(isSandboxGrantAllowed(uid)).toBe(false);
    }
  });
});

// ── The wildcard must never work outside sandbox ────────────────────────────

describe("the wildcard is inert outside sandbox", () => {
  /**
   * The requirement that matters most. The call site already guards on
   * `env === "sandbox"`, so this is the SECOND guard — it proves the function
   * is safe even if a future caller forgets the first.
   */
  it("does NOT permit a grant in production", () => {
    setEnv("*", "production");
    for (const uid of [UID_A, UID_B, "anyone"]) {
      expect(isSandboxGrantAllowed(uid)).toBe(false);
    }
  });

  /** An unreadable environment fails closed rather than honouring "*". */
  it("does NOT permit a grant when the environment is unset or malformed", () => {
    // Note: " Sandbox " is NOT malformed — purchaseEnvironment() trims and
    // lowercases, and the case-insensitivity test below relies on that. Listing
    // it here contradicted that test; the first run caught the contradiction.
    for (const env of [undefined, "", "SANDBOX_", "prod", "staging", "sandboxx"]) {
      setEnv("*", env);
      expect(isSandboxGrantAllowed(UID_A)).toBe(false);
    }
  });

  /** "sandbox" is matched exactly as purchaseEnvironment() normalizes it. */
  it("accepts the environment case-insensitively, as purchaseEnvironment does", () => {
    for (const env of ["sandbox", "SANDBOX", " Sandbox "]) {
      setEnv("*", env);
      expect(isSandboxGrantAllowed(UID_A)).toBe(true);
    }
  });

  /**
   * An explicit uuid listed alongside "*" still works normally in sandbox.
   * The wildcard falling through must not disable the rest of the list.
   */
  it("still honours explicit uuids listed alongside an ignored wildcard", () => {
    setEnv(`*,${UID_A}`, "production");
    // Production: the call site never reaches here, but the explicit path is
    // unchanged — the wildcard is the only thing gated.
    expect(isSandboxGrantAllowed(UID_A)).toBe(true);
    expect(isSandboxGrantAllowed(UID_B)).toBe(false);
  });
});

// ── Existing behaviour, unchanged ───────────────────────────────────────────

describe("explicit allowlist behaviour is unchanged", () => {
  it("allows a listed uuid in sandbox", () => {
    setEnv(`${UID_A},${UID_B}`, "sandbox");
    expect(isSandboxGrantAllowed(UID_A)).toBe(true);
    expect(isSandboxGrantAllowed(UID_B)).toBe(true);
  });

  it("rejects an unlisted uuid in sandbox", () => {
    setEnv(`${UID_A},${UID_B}`, "sandbox");
    expect(isSandboxGrantAllowed(UID_C)).toBe(false);
  });

  it("trims whitespace around entries", () => {
    setEnv(` ${UID_A} , ${UID_B} `, "sandbox");
    expect(isSandboxGrantAllowed(UID_A)).toBe(true);
  });

  /** Empty and unset still mean NOBODY — never everybody. */
  it("rejects everyone when empty or unset", () => {
    for (const list of ["", "   ", ",,", undefined]) {
      setEnv(list, "sandbox");
      expect(isSandboxGrantAllowed(UID_A)).toBe(false);
      expect(isSandboxGrantAllowed("")).toBe(false);
    }
  });

  /** Matching is exact — no prefix, substring or partial-uuid matching. */
  it("matches uuids exactly", () => {
    setEnv(UID_A, "sandbox");
    expect(isSandboxGrantAllowed(UID_A.slice(0, 8))).toBe(false);
    expect(isSandboxGrantAllowed(`${UID_A}x`)).toBe(false);
    expect(isSandboxGrantAllowed(UID_A.toUpperCase())).toBe(false);
  });
});

// ── The surrounding protections are untouched ───────────────────────────────

describe("surrounding grant protections are unchanged", () => {
  const read = (rel: string) =>
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require("node:fs").readFileSync(require("node:path").join(__dirname, "../..", rel), "utf8");

  const GRANT = read("server/monetization/scanPackGrant.ts");

  /**
   * A sandbox purchase reaching a production deployment must never grant,
   * wildcard or not. That is a separate, earlier check than the allowlist.
   */
  it("still rejects on environment mismatch before the allowlist is consulted", () => {
    expect(GRANT).toMatch(/if \(purchaseEnv !== env\)/);
    expect(GRANT).toMatch(/failure: "environment_mismatch", retryable: false/);
    const mismatch = GRANT.indexOf("purchaseEnv !== env");
    const allowlist = GRANT.indexOf("isSandboxGrantAllowed(expectedUserId)");
    expect(mismatch).toBeGreaterThan(-1);
    expect(allowlist).toBeGreaterThan(mismatch);
  });

  /** The call site keeps its own environment guard — the first of the two. */
  it("keeps the caller's sandbox-only guard", () => {
    expect(GRANT).toMatch(/if \(env === "sandbox" && !isSandboxGrantAllowed\(expectedUserId\)\)/);
  });

  /** Quantities still come from the frozen server map, never the client. */
  it("leaves grant quantity resolution untouched", () => {
    const packs = read("server/monetization/scanPacks.ts");
    expect(packs).toMatch(/export const SCAN_PACK_SKUS = Object\.freeze\(\{/);
    expect(packs).toMatch(/flipstart_scan_pack_1200: 1200,/);
  });

  /** Exactly-once is the ledger's uniqueness constraint, not this file's. */
  it("leaves ledger idempotency untouched", () => {
    expect(GRANT).toMatch(/already_granted/);
    expect(GRANT).not.toMatch(/DELETE FROM purchase_ledger|onConflictDoNothing\(\)\.returning/);
  });

  /** Subscriptions are a different system and must not appear here. */
  it("changes nothing about subscriptions", () => {
    expect(GRANT).not.toMatch(/apply_revenuecat_snapshot|PRODUCT_MONTHLY|PRODUCT_ANNUAL/);
  });
});
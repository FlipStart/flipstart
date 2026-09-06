/**
 * __tests__/version/force-update.test.ts
 *
 * The gate decision, executed rather than pattern-matched.
 *
 * Supabase and expo-constants are stubbed so every failure mode can actually
 * be run: a refusing policy, a missing row, a disabled flag, a thrown client.
 * The single property under test is that ONLY a present, enabled, genuinely
 * higher row blocks — everything else lets the user in.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

/** Swappable per test. */
let VERSION: string | null = "2.0";
let RESULT: { data: unknown; error: unknown } = { data: null, error: null };
let THROWS = false;

vi.mock("expo-constants", () => ({
  default: { get expoConfig() { return VERSION === null ? {} : { version: VERSION }; } },
}));

vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from() {
      if (THROWS) throw new Error("client exploded");
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => RESULT,
      };
      return chain;
    },
  },
}));

const { checkForceUpdate } = await import("@/lib/forceUpdate");

const row = (over: Record<string, unknown> = {}) => ({
  data: { min_version: "2.2", store_url: "https://apps.apple.com/app/id1", message: null, enabled: true, ...over },
  error: null,
});

beforeEach(() => { VERSION = "2.0"; RESULT = row(); THROWS = false; });

describe("blocks only when it is certain", () => {
  it("blocks a genuinely old build", async () => {
    const g = await checkForceUpdate();
    expect(g.required).toBe(true);
    expect(g.storeUrl).toBe("https://apps.apple.com/app/id1");
    expect(g.minVersion).toBe("2.2");
  });

  it("passes the server's own message through when set", async () => {
    RESULT = row({ message: "  Scanning needs the new build.  " });
    expect((await checkForceUpdate()).message).toBe("Scanning needs the new build.");
  });

  it("reports no store URL rather than an empty one", async () => {
    RESULT = row({ store_url: "   " });
    const g = await checkForceUpdate();
    expect(g.required).toBe(true);
    expect(g.storeUrl).toBeNull();       // the UI shows instructions instead
  });
});

describe("fails OPEN on every failure mode", () => {
  const allowed = async (label: string) => {
    const g = await checkForceUpdate();
    expect(g.required, label).toBe(false);
  };

  it("when the query errors (network down, RLS refuses)", async () => {
    RESULT = { data: null, error: { message: "permission denied" } };
    await allowed("query error");
  });

  it("when an error arrives ALONGSIDE data — the error wins", async () => {
    // A degraded response must never be acted on, even if the payload looks
    // like a valid blocking row. Without this case the `error` check is dead
    // weight, because every other error path also has data === null.
    RESULT = { ...row(), error: { message: "stale read" } };
    await allowed("error with data");
  });

  it("when the row is missing", async () => {
    RESULT = { data: null, error: null };
    await allowed("missing row");
  });

  it("when the table does not exist yet", async () => {
    RESULT = { data: null, error: { code: "42P01" } };
    await allowed("no table");
  });

  it("when the client throws outright", async () => {
    THROWS = true;
    await allowed("throwing client");
  });

  it("when the kill switch is off", async () => {
    RESULT = row({ enabled: false });
    await allowed("enabled false");
    RESULT = row({ enabled: null });
    await allowed("enabled null");
  });

  it("when either version cannot be parsed", async () => {
    RESULT = row({ min_version: "2.2-rc" });
    await allowed("bad minimum");
    RESULT = row({ min_version: null });
    await allowed("null minimum");
    VERSION = "2.0-beta"; RESULT = row();
    await allowed("bad installed");
  });

  it("when the build carries no version at all", async () => {
    VERSION = null;
    await allowed("no installed version");
  });

  it("when the installed build already meets or exceeds the minimum", async () => {
    VERSION = "2.2";
    await allowed("equal");
    VERSION = "2.10"; RESULT = row({ min_version: "2.9" });
    await allowed("newer, numerically");
  });
});
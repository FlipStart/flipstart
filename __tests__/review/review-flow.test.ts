/**
 * __tests__/review/review-flow.test.ts
 *
 * The App Store review flow.
 *
 * The counting and once-per-version rules are EXECUTED against a stubbed
 * AsyncStorage, because that is where the real bugs live. The policy rules —
 * no custom pre-prompt, no sentiment gating, no incentives — are checked
 * structurally against the source, since they are about what does not exist.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

/**
 * Every "this must not exist" assertion runs on stripped code.
 *
 * The comments explaining what was removed necessarily quote the removed
 * strings — "the Help FlipStart grow modal was removed", "does not call
 * requestReview" — so matching raw source would ban the explanation.
 */
function stripComments(src: string): string {
  let out = "", mode: "code" | "line" | "block" | "sq" | "dq" | "tpl" = "code", i = 0;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (mode === "code") {
      if (c === "/" && n === "/") { mode = "line"; i += 2; continue; }
      if (c === "/" && n === "*") { mode = "block"; i += 2; continue; }
      if (c === "'") mode = "sq"; else if (c === '"') mode = "dq"; else if (c === "`") mode = "tpl";
      out += c; i++; continue;
    }
    if (mode === "line") { if (c === "\n") { mode = "code"; out += c; } i++; continue; }
    if (mode === "block") { if (c === "*" && n === "/") { mode = "code"; i += 2; } else i++; continue; }
    if (c === "\\") { out += c + (src[i + 1] ?? ""); i += 2; continue; }
    if ((mode === "sq" && c === "'") || (mode === "dq" && c === '"') || (mode === "tpl" && c === "`")) mode = "code";
    out += c; i++;
  }
  return out;
}
const code = (rel: string) => stripComments(read(rel));

let STORE: Record<string, string> = {};
let VERSION: string | null = "2.1";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (k: string) => STORE[k] ?? null,
    setItem: async (k: string, v: string) => { STORE[k] = v; },
  },
}));
vi.mock("expo-constants", () => ({
  default: { get expoConfig() { return VERSION === null ? {} : { version: VERSION }; } },
}));

const R = await import("@/lib/reviewPrompt");

beforeEach(() => { STORE = {}; VERSION = "2.1"; });

// ── Counting ───────────────────────────────────────────────────────────────

describe("three completed scans, then eligible", () => {
  it("scans 1 and 2 do not make it eligible; scan 3 does", async () => {
    expect(await R.recordCompletedScan()).toBe(false);
    expect(await R.recordCompletedScan()).toBe(false);
    expect(await R.recordCompletedScan()).toBe(true);
  });

  it("uses three, from the exported constant", () => {
    expect(R.SCANS_BEFORE_REVIEW).toBe(3);
  });

  it("counts completions, not saves", () => {
    // The counter is called where the analysis resolves, before any save.
    const loading = read("app/loading.tsx");
    expect(loading).toMatch(/m\.recordCompletedScan\(\)/);
    // And no longer from the results SAVE handler.
    expect(read("app/results.tsx")).not.toMatch(/recordCompletedScan|recordSuccessfulScan/);
  });
});

// ── Once per version ───────────────────────────────────────────────────────

describe("at most one automatic request per app version", () => {
  const reachEligible = async () => {
    await R.recordCompletedScan(); await R.recordCompletedScan();
    return R.recordCompletedScan();
  };

  it("further scans in the same version do not ask again", async () => {
    expect(await reachEligible()).toBe(true);
    await R.markReviewRequested();
    for (let i = 0; i < 7; i++) {
      expect(await R.recordCompletedScan(), `scan ${i + 4}`).toBe(false);
    }
    expect(await R.isReviewRequestAllowed()).toBe(false);
  });

  it("a new app version becomes eligible again", async () => {
    await reachEligible();
    await R.markReviewRequested();
    expect(await R.isReviewRequestAllowed()).toBe(false);
    VERSION = "2.2";
    expect(await R.isReviewRequestAllowed()).toBe(true);
  });

  it("never asks when the version is unknown", async () => {
    VERSION = null;
    await R.recordCompletedScan(); await R.recordCompletedScan();
    expect(await R.recordCompletedScan()).toBe(false);
    expect(await R.isReviewRequestAllowed()).toBe(false);
  });

  it("burns the request BEFORE calling StoreKit, so a throw cannot cause a retry", () => {
    const home = read("app/(tabs)/index.tsx");
    const mark = home.indexOf("markReviewRequested()");
    const call = home.indexOf("requestAppStoreReview()");
    expect(mark).toBeGreaterThan(-1);
    expect(mark).toBeLessThan(call);
  });
});

// ── Upgrading users ────────────────────────────────────────────────────────

describe("old persisted state does not break anyone", () => {
  it("reads a legacy record without crashing, carrying the old count across", async () => {
    STORE["flipstart_review_prompt_state"] = JSON.stringify({
      successfulScanCount: 20, lastShownAtScanCount: 11,
      dontAskAgain: true, hasRequestedReview: true,
    });
    // dontAskAgain / hasRequestedReview belonged to the removed custom modal
    // and are no longer consulted; the scan count is respected.
    expect(await R.isReviewRequestAllowed()).toBe(true);
  });

  it("survives corrupt storage", async () => {
    STORE["flipstart_review_prompt_state"] = "{not json";
    expect(await R.recordCompletedScan()).toBe(false);   // count restarts at 1
    expect(await R.isReviewRequestAllowed()).toBe(false);
  });
});

// ── Settings ───────────────────────────────────────────────────────────────

describe("Settings → Review FlipStart", () => {
  const settings = read("app/(tabs)/settings.tsx");
  const helper = read("lib/reviewPrompt.ts");

  it("does NOT call the StoreKit request API", () => {
    expect(settings).toMatch(/openAppStoreReviewPage\(\)/);
    expect(code("app/(tabs)/settings.tsx")).not.toMatch(/requestAppStoreReview|requestReview/);
  });

  it("opens the real listing with action=write-review", () => {
    expect(R.APP_STORE_WRITE_REVIEW_URL).toBe("https://apps.apple.com/app/id6770193673?action=write-review");
    expect(R.APP_STORE_PRODUCT_URL).toBe("https://apps.apple.com/app/id6770193673");
    // The id is the one already in the repo, not invented here.
    expect(read("components/UpdateGate.tsx")).toContain("6770193673");
  });

  it("falls back to the product page, then reports failure in plain words", () => {
    expect(helper).toMatch(/\[APP_STORE_WRITE_REVIEW_URL, APP_STORE_PRODUCT_URL\]/);
    expect(helper).toMatch(/return false;\s*\}\s*$/m);
    expect(settings).toMatch(/if \(!opened\) \{/);
    expect(settings).toMatch(/Search for FlipStart in the App Store to leave a review\./);
    // No raw error text surfaced to the user.
    expect(settings).not.toMatch(/Alert\.alert\([^)]*err/);
  });

  it("keeps the row and its copy", () => {
    expect(settings).toMatch(/label="Review FlipStart"/);
    expect(settings).toMatch(/Leave an App Store rating to help the mission\./);
  });
});

// ── Policy ─────────────────────────────────────────────────────────────────

describe("Apple policy", () => {
  const sources = ["lib/reviewPrompt.ts", "app/results.tsx", "app/(tabs)/index.tsx", "app/(tabs)/settings.tsx"];

  it("no custom pre-prompt survives in the automatic path", () => {
    const results = code("app/results.tsx");
    for (const gone of ["Help FlipStart grow", "Rate FlipStart", "Maybe Later", "Don't Ask Again", "★★★★★"]) {
      expect(results, gone).not.toContain(gone);
    }
    expect(results).not.toMatch(/showReview|reviewPendingRef/);
  });

  it("no sentiment gating, no incentive, no five-star language", () => {
    for (const f of sources) {
      const src = code(f).toLowerCase();
      for (const banned of ["are you enjoying", "do you love", "five star", "5 stars",
                            "rate us 5", "in exchange for a review", "free scans for a review"]) {
        expect(src, `${f}: ${banned}`).not.toContain(banned);
      }
    }
  });

  it("treats a request as a request — never as proof of a review", () => {
    expect(code("lib/reviewPrompt.ts")).not.toMatch(/review_submitted|five_star|reviewCompleted|hasRated/);
    // Nothing is granted on the back of it.
    const home = read("app/(tabs)/index.tsx");
    const block = home.slice(home.indexOf("markReviewRequested"), home.indexOf("REVIEW_SETTLE_MS"));
    expect(block).not.toMatch(/award|grant|xp|scan|reward|thank/i);
  });

  it("is not wired to a button tap in the automatic path", () => {
    const home = read("app/(tabs)/index.tsx");
    // Fired from a focus effect after a delay, not from onPress.
    expect(home).toMatch(/useFocusEffect\(useCallback\(\(\) => \{\s*let cancelled = false;/);
    expect(home).toMatch(/const REVIEW_SETTLE_MS = 1200;/);
  });
});
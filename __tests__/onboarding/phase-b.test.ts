/**
 * __tests__/onboarding/phase-b.test.ts
 *
 * The complete onboarding: value screens, profile build and result, the
 * staged handoff to the existing auth, the final Pro-or-Free offer, and the
 * completion semantics that make account creation NOT the end.
 *
 * Pure-function tests where the logic is pure; structural pins on the
 * screens and the shared modal where it is not. No native modules imported.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  ARCHETYPES, TOOLS, deriveArchetype, recommendTools, opportunityLabel,
} from "@/lib/onboardingProfile";
import { classifyAccount, migrateStagedAnswers, toOnboardingMetadata, NEW_ACCOUNT_SKEW_MS, ONBOARDING_METADATA_KEY } from "@/lib/onboardingAnswers";
import { PAIN_POINTS, PRIMARY_GOALS, QUIZ_STAGES, stageIsComplete, stageProgress, answersComplete, EMPTY_ANSWERS, type PainPoint } from "@/lib/onboardingQuiz";
// migrateStagedAnswers lives in onboardingAnswers (no native import), so it is unit-testable.
import { resolvePaywallConfig, PAYWALL_SOURCES } from "@/lib/paywallConfig";

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

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
const code = (s: string) => stripComments(s);

const SCREEN   = read("app/onboarding.tsx");
const TEASERS  = read("components/onboarding/ValueTeasers.tsx");
const BUILDING = read("components/onboarding/ProfileBuilding.tsx");
const RESULT   = read("components/onboarding/ProfileResult.tsx");
const SHELL    = read("components/onboarding/OnboardingShell.tsx");
const PROFILE  = read("lib/onboardingProfile.ts");
const ANSWERS  = read("lib/onboardingAnswers.ts");
const STORAGE  = read("lib/onboarding-storage.ts");
const MODAL    = read("components/monetization/paywall/ProPaywallModal.tsx");
const PROVIDER = read("components/monetization/paywall/ProPaywallProvider.tsx");
const CONFIG   = read("lib/paywallConfig.ts");
const AUTH     = read("app/auth.tsx");
const USERNAME = read("app/username-setup.tsx");
const AUTHCTX  = read("lib/auth-context.tsx");

const ONBOARDING_COPY = [SCREEN, TEASERS, BUILDING, RESULT, PROFILE].map(code).join("\n");

// ── Screen content / truth ──────────────────────────────────────────────────

describe("screen 6 — money", () => {
  it("uses Buy Under, never Max Buy, and labels the example SAMPLE", () => {
    // The label is JSX text now, not an attribute — see the Phase 3 suite.
    expect(TEASERS).toContain(">BUY UNDER<");
    expect(code(TEASERS)).not.toMatch(/max buy/i);
    expect(TEASERS).toContain('text="SAMPLE FIND"');
    expect(SCREEN).toMatch(/headline="Know the flip before you buy"/);
  });
});

describe("screen 7 — intelligence", () => {
  it("labels the example SAMPLE ANALYSIS, states uncertainty, and seals Deep Analysis PRO", () => {
    expect(TEASERS).toContain('text="SAMPLE ANALYSIS"');
    expect(TEASERS).toMatch(/Confidence, evidence and risk show what FlipStart found/);
    expect(TEASERS).toMatch(/GO DEEPER WITH PRO[\s\S]{0,120}<ProSeal \/>/);
    expect(SCREEN).toMatch(/headline="Spot what others might miss"/);
  });
});

describe("screen 8 — gamification", () => {
  it("ties the XP to a completed Hunt and reads every count from the real systems", () => {
    expect(TEASERS).toMatch(/HUNT COMPLETE[\s\S]{0,600}\+\{SAMPLE_XP_GAIN\} XP[\s\S]{0,200}for completing a Hunt/);
    expect(TEASERS).toMatch(/const SAMPLE_XP_GAIN = 125;/);
    expect(TEASERS).toMatch(/import \{ RANK_LADDER, getCurrentRank, getNextRank \} from "@\/lib\/huntXp";/);
    expect(TEASERS).toMatch(/import \{ CATEGORY_META, DIAMONDS, TOTAL_DIAMONDS \} from "@\/lib\/diamonds";/);
    expect(TEASERS).toMatch(/ACHIEVEMENT_CATEGORIES\.reduce/);
    // No hand-typed counts.
    expect(code(TEASERS)).not.toMatch(/(?<![.\d])(23|40|83|241)(?![.\d%])/);
    expect(TEASERS).toMatch(/import \{ ALL_BRANDS, RARITY_COLORS, RARITY_LABELS, TOTAL_SUPPORTED_BRANDS \}/);
    expect(SCREEN).toMatch(/headline="Turn every thrift trip into progress"/);
  });
});

describe("banned claims across screens 6–12", () => {
  it("promises nothing the product cannot keep", () => {
    expect(ONBOARDING_COPY.toLowerCase()).not.toMatch(
      /guarantee|will sell for|identifies anything|leaderboard|milestone|unlimited|retrain|recalibrat|users like you|\d+% of (users|resellers)|buy for yourself/,
    );
    // XP is never attached to a plain scan.
    expect(ONBOARDING_COPY).not.toMatch(/scan[^.]{0,40}\+\d+ XP|XP[^.]{0,40}(per|every|each) scan/i);
  });
});

// ── Archetype + recommendations ─────────────────────────────────────────────

describe("archetype", () => {
  it("is derived from primaryGoal and never persisted", () => {
    expect(ARCHETYPES[deriveArchetype("resell_profit")].title).toBe("THE PROFIT HUNTER");
    expect(ARCHETYPES[deriveArchetype("personal_finds")].title).toBe("THE TREASURE HUNTER");
    expect(ARCHETYPES[deriveArchetype("both")].title).toBe("THE ALL-AROUND FLIPPER");
    expect(code(STORAGE)).not.toMatch(/archetype/i);
    expect(code(ANSWERS)).not.toMatch(/archetype/i);
  });
});

describe("recommendations", () => {
  it("returns two or three deduplicated tools for every goal and every single pain point", () => {
    for (const g of PRIMARY_GOALS) for (const p of PAIN_POINTS) {
      const tools = recommendTools(g.value, [p.value]);
      expect(tools.length, `${g.value}/${p.value}`).toBeGreaterThanOrEqual(2);
      expect(tools.length).toBeLessThanOrEqual(3);
      for (const t of tools) expect(typeof t.pro).toBe("boolean");
      expect(new Set(tools.map(t => t.key)).size).toBe(tools.length);
    }
  });

  it("handles MULTIPLE pain points: still 2–3, still deduplicated, whatever the combination", () => {
    const all = PAIN_POINTS.map(o => o.value);
    for (const g of PRIMARY_GOALS) {
      for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
        const tools = recommendTools(g.value, [all[i], all[j]]);
        expect(tools.length, `${g.value}/${all[i]}+${all[j]}`).toBeGreaterThanOrEqual(2);
        expect(tools.length).toBeLessThanOrEqual(3);
        expect(new Set(tools.map(t => t.key)).size).toBe(tools.length);
      }
      // Everything at once still yields a short, deduplicated list.
      const allTools = recommendTools(g.value, all);
      expect(allTools.length).toBe(3);
      expect(new Set(allTools.map(t => t.key)).size).toBe(3);
    }
  });

  it("is deterministic — selection order never changes the result", () => {
    const a = recommendTools("both", ["listing_time", "valuation_uncertainty"]);
    const b = recommendTools("both", ["valuation_uncertainty", "listing_time"]);
    expect(a.map(t => t.key)).toEqual(b.map(t => t.key));
    // And repeated calls agree.
    expect(recommendTools("resell_profit", ["comp_research", "slow_selling_buys"]).map(t => t.key))
      .toEqual(recommendTools("resell_profit", ["comp_research", "slow_selling_buys"]).map(t => t.key));
  });

  it("never returns an empty set, even with no selection", () => {
    const tools = recommendTools("both", []);
    expect(tools.length).toBeGreaterThanOrEqual(2);
  });
  it("marks exactly the Pro-gated tools Pro, mirroring canUseFeature()", () => {
    expect(TOOLS.deep_analysis.pro).toBe(true);
    expect(TOOLS.generate_listings.pro).toBe(true);
    expect(TOOLS.scan_finds.pro).toBe(false);
    expect(TOOLS.sold_comps.pro).toBe(false);
    expect(TOOLS.hunt_mode.pro).toBe(false);
  });
  it("follows the spec's pain-point mapping and goal shaping", () => {
    expect(recommendTools("both", ["listing_time"]).map(t => t.key)).toContain("generate_listings");
    expect(recommendTools("both", ["comp_research"]).map(t => t.key)).toEqual(["sold_comps", "deep_analysis"]);
    // A selling tool is dropped for a purely personal goal — unless it is all they asked for.
    expect(recommendTools("personal_finds", ["listing_time", "item_identification"]).map(t => t.key)).not.toContain("generate_listings");
    expect(recommendTools("personal_finds", ["listing_time"]).map(t => t.key)).toContain("generate_listings");
    // The spec's worked example.
    const combo = recommendTools("resell_profit", ["listing_time", "valuation_uncertainty"]).map(t => t.key);
    expect(combo).toContain("generate_listings");
    expect(combo).toContain("sold_comps");
    expect(opportunityLabel(["missed_opportunities"])).toBe("Spot profitable finds faster");
    expect(opportunityLabel([])).toBe("Spot profitable finds faster");
    // Two selections read in catalogue order, capped at two.
    expect(opportunityLabel(["listing_time", "item_identification"]))
      .toBe("Know what you\u2019re looking at \u00B7 List finds in a fraction of the time");
  });
  it("renders the PRO seal from the tool's flag on the result card, and no longer shows Your hunt", () => {
    expect(RESULT).toMatch(/\{t\.pro && <ProSeal \/>\}/);
    expect(code(RESULT)).not.toMatch(/Your hunt|categoriesLabel|huntCategories|HuntCategory/);
    expect(RESULT).toMatch(/const tools = recommendTools\(primaryGoal, painPoints\);/);
    expect(code(BUILDING)).not.toMatch(/categoriesLabel|huntCategories|Preparing your hunt/);
    expect(RESULT).toMatch(/\{t\.pro && <ProSeal \/>\}/);
    expect(RESULT).toMatch(/import \{ FREE_LIFETIME_SCANS \} from '@\/lib\/paywallConfig';/);
    expect(RESULT).toMatch(/FREE SCANS READY/);
    expect(RESULT).toMatch(/const startingRank = RANK_LADDER\[0\];/);
    expect(RESULT).toMatch(/import \{ RANK_LADDER \} from '@\/lib\/huntXp';/);
    expect(code(RESULT)).not.toMatch(/Dung Beetle/);
  });
});

// ── Stages ──────────────────────────────────────────────────────────────────

describe("stages", () => {
  it("value screens and the result are always continuable; building and offer never are", () => {
    for (const s of ["money", "intelligence", "gamification", "result"] as const) expect(stageIsComplete(s, EMPTY_ANSWERS)).toBe(true);
    for (const s of ["building", "offer"] as const) expect(stageIsComplete(s, EMPTY_ANSWERS)).toBe(false);
    expect(stageProgress("offer")).toBe(1);
    expect(stageProgress("result")).toBeCloseTo((QUIZ_STAGES.indexOf("result") + 1) / QUIZ_STAGES.length);
    expect(answersComplete(EMPTY_ANSWERS)).toBe(false);
  });
  it("building auto-advances exactly once inside ~3s, and offers Continue under Reduce Motion", () => {
    expect(BUILDING).toMatch(/const BUILD_STEP_MS = 340;/);
    expect(BUILDING).toMatch(/const BUILD_HOLD_MS = 420;/);
    expect(BUILDING).toMatch(/const BUILD_STEPS = 6;/);
    expect(340 * 6 + 420).toBeLessThanOrEqual(3200);
    expect(340 * 6 + 420).toBeGreaterThanOrEqual(2300);
    expect(BUILDING).toMatch(/if \(doneRef\.current\) return;\s*doneRef\.current = true;\s*onDone\(\);/);
    expect(BUILDING).toMatch(/if \(reduceMotion\) \{ setStep\(BUILD_STEPS\); return; \}/);
    expect(SCREEN).toMatch(/cta=\{buildNeedsContinue \? \{ label: 'Continue', onPress: buildDone \} : undefined\}/);
    expect(SCREEN).toMatch(/if \(stage === 'result'\) \{ setStage\('gamification'\); return; \}/);
  });
});

// ── Staging + account isolation ─────────────────────────────────────────────

describe("staging", () => {
  it("stores coded keys at schema 2, never labels, categories, archetype or samples", () => {
    expect(STORAGE).toMatch(/schemaVersion: 2, \.\.\.a, answeredAt: new Date\(\)\.toISOString\(\), userId: null/);
    const meta = toOnboardingMetadata({
      primaryGoal: "both", experienceLevel: "basic",
      painPoints: ["comp_research", "listing_time"], answeredAt: "2026-09-04T00:00:00Z",
    });
    expect(meta).toEqual({
      schema_version: 2, primary_goal: "both", experience_level: "basic",
      pain_points: ["comp_research", "listing_time"], answered_at: "2026-09-04T00:00:00Z",
    });
    expect(meta).not.toHaveProperty("hunt_categories");
    expect(meta).not.toHaveProperty("primary_pain_point");
    expect(ONBOARDING_METADATA_KEY).toBe("flipstart_onboarding");
  });

  it("migrates a schema-1 payload instead of discarding it", () => {
    const v1 = {
      schemaVersion: 1, primaryGoal: "resell_profit", huntCategories: ["sneakers", "designer"],
      experienceLevel: "experienced", primaryPainPoint: "comp_research",
      answeredAt: "2026-09-01T00:00:00Z", userId: "user-1",
    };
    const out = migrateStagedAnswers(v1)!;
    expect(out.schemaVersion).toBe(2);
    expect(out.painPoints).toEqual(["comp_research"]);        // singular becomes a one-item array
    expect(out.huntCategories).toEqual(["sneakers", "designer"]); // carried, never required
    expect(out.userId).toBe("user-1");                        // account binding survives
    expect(out.primaryGoal).toBe("resell_profit");
  });

  it("is tolerant: bad, partial and unknown data yields null rather than a crash or a half-built profile", () => {
    expect(migrateStagedAnswers(null)).toBeNull();
    expect(migrateStagedAnswers("nonsense")).toBeNull();
    expect(migrateStagedAnswers({})).toBeNull();
    expect(migrateStagedAnswers({ primaryGoal: "not_a_goal", experienceLevel: "basic", painPoints: ["comp_research"] })).toBeNull();
    expect(migrateStagedAnswers({ primaryGoal: "both", experienceLevel: "basic", painPoints: [] })).toBeNull();
    expect(migrateStagedAnswers({ primaryGoal: "both", experienceLevel: "basic", painPoints: ["nope"] })).toBeNull();
    // Unknown members are dropped, valid ones kept, and order is normalised.
    const mixed = migrateStagedAnswers({
      primaryGoal: "both", experienceLevel: "basic",
      painPoints: ["listing_time", "nope", "item_identification"], huntCategories: "not-an-array",
    })!;
    expect(mixed.painPoints).toEqual(["item_identification", "listing_time"]);
    expect(mixed.huntCategories).toBeUndefined();
  });

  it("never fabricates a category for someone who was never asked", () => {
    const fresh = migrateStagedAnswers({
      schemaVersion: 2, primaryGoal: "both", experienceLevel: "basic",
      painPoints: ["listing_time"], answeredAt: "2026-09-05T00:00:00Z", userId: null,
    })!;
    expect(fresh.huntCategories).toBeUndefined();
    expect(code(STORAGE)).not.toMatch(/'everything'|"everything"/);
  });
  it("sets the pending marker only on Save My Profile — never on Log In, which clears it", () => {
    const save = SCREEN.slice(SCREEN.indexOf("const saveProfileAndCreateAccount"), SCREEN.indexOf("const finishExisting"));
    expect(save).toMatch(/await setPendingNewUserOffer\(\);/);
    expect(save).toMatch(/setAuthReturnDest\('\/onboarding'\);/);
    expect(save).toMatch(/mode: 'signup'/);
    const logIn = SCREEN.slice(SCREEN.indexOf("const logIn = useCallback"), SCREEN.indexOf("const saveProfileAndCreateAccount"));
    expect(logIn).toMatch(/clearPendingNewUserOffer\(\)/);
    expect(logIn).toMatch(/clearAuthReturnDest\(\)/);
    expect(logIn).not.toMatch(/setPendingNewUserOffer/);
    expect((SCREEN.match(/setPendingNewUserOffer\(\)/g) ?? []).length).toBe(1);
  });
  it("clears the staged payload only after a confirmed metadata write", () => {
    expect(SCREEN).toMatch(/const ok = await persistAnswersToAccount\(staged\);\s*if \(ok\) \{ persistedRef\.current = true; await clearStagedAnswers\(\); \}/);
    expect(ANSWERS).toMatch(/if \(error\) \{[\s\S]*?return false;/);
    expect(ANSWERS).toMatch(/supabase\.auth\.updateUser\(\{ data: \{ \[ONBOARDING_METADATA_KEY\]: toOnboardingMetadata\(a\) \} \}\)/);
    expect(code(ANSWERS)).not.toMatch(/from\(['"]profiles|onboarding_complete/);
  });
  it("never applies another account's pending state or answers", () => {
    expect(SCREEN).toMatch(/if \(pending\.userId && pending\.userId !== uid\) \{\s*[\s\S]*?await clearPendingNewUserOffer\(\);\s*await clearStagedAnswers\(\);\s*setResume\('existing'\);/);
    expect(SCREEN).toMatch(/await bindPendingOfferToUser\(uid\);\s*await bindStagedAnswersToUser\(uid\);/);
  });
  it("classifies new vs existing from auth's created_at, failing toward existing", () => {
    const stagedAt = Date.parse("2026-09-04T12:00:00Z");
    expect(classifyAccount("2026-09-04T12:00:30Z", stagedAt)).toBe("new");
    expect(classifyAccount("2026-09-04T11:50:00Z", stagedAt)).toBe("new");      // inside the skew margin
    expect(classifyAccount("2026-09-01T12:00:00Z", stagedAt)).toBe("existing");
    expect(classifyAccount(undefined, stagedAt)).toBe("existing");
    expect(classifyAccount("not-a-date", stagedAt)).toBe("existing");
    expect(NEW_ACCOUNT_SKEW_MS).toBe(15 * 60 * 1000);
  });
});

// ── Auth return ─────────────────────────────────────────────────────────────

describe("auth return", () => {
  it("changes no auth file: every success path still calls completeOnboarding, which is gated by the marker", () => {
    expect((AUTH.match(/completeOnboarding\('resell'\)/g) ?? []).length).toBe(4);
    expect(USERNAME).toMatch(/await completeOnboarding\('resell'\);/);
    expect(AUTH).toMatch(/const dest = takeAuthReturnDest\(\) \?\? '\/\(tabs\)';/);
    expect(STORAGE).toMatch(/export async function completeOnboarding\(mode: UserMode\): Promise<void> \{\s*if \(await readPendingNewUserOffer\(\)\) return;/);
    expect(STORAGE).toMatch(/export async function finishNewUserOnboarding\(mode: UserMode\): Promise<void> \{\s*await clearPendingNewUserOffer\(\);\s*await writeCompletion\(mode\);/);
    expect(code(AUTHCTX)).not.toMatch(/onboardingQuiz|onboardingAnswers|PendingNewUserOffer|user_metadata/);
  });
  it("keeps loginOnly's protection and the existing-account bounce untouched", () => {
    expect(AUTH).toMatch(/const loginOnly = entryPoint === 'onboarding' && params\.mode === 'login' && !cameFromLanding;/);
    expect(AUTH).toMatch(/const bounceIfNewAccountOnLoginOnly = async \(\): Promise<boolean> =>/);
    expect(AUTH).toMatch(/if \(await bounceIfNewAccountOnLoginOnly\(\)\) return;/);
  });
  it("routes a new account that still needs a username through the existing screen, and holds while the profile is unknown", () => {
    expect(SCREEN).toMatch(/if \(profileError \|\| !profile\) \{ setResume\('hold'\); return; \}/);
    expect(SCREEN).toMatch(/if \(!profile\.onboarding_complete\) \{ setResume\('username'\); return; \}/);
    expect(SCREEN).toMatch(/if \(resume === 'username'\) \{ router\.replace\('\/username-setup' as any\); return; \}/);
    expect(code(SCREEN)).not.toMatch(/onboarding_complete: /);   // never written here
  });
  it("decides on focus, not mount, so the instance beneath auth cannot open a second offer", () => {
    expect(SCREEN).toMatch(/useFocusEffect\(useCallback\(\(\) => \{/);
    expect(SCREEN).toMatch(/if \(offerOpenedRef\.current\) return;\s*offerOpenedRef\.current = true;\s*openOffer\(\);/);
  });
});

// ── The offer ───────────────────────────────────────────────────────────────

describe("final offer", () => {
  const cfg = resolvePaywallConfig("onboarding_offer");
  it("is a real source with a broad message, no Scan Store, a visible free option, and no dismissal", () => {
    expect(PAYWALL_SOURCES).toContain("onboarding_offer");
    expect(cfg.headline).toBe("Unlock the Full FlipStart Experience");
    expect(cfg.showScanStoreAlternative).toBe(false);
    expect(cfg.freeContinueLabel).toBe("Continue with 15 Free Scans");
    expect(cfg.dismissible).toBe(false);
    expect(code(CONFIG)).not.toMatch(/No thanks|Skip|Maybe later|Continue without Pro/);
  });
  it("is the only non-dismissible source and the only one with a free option", () => {
    for (const s of PAYWALL_SOURCES.filter(x => x !== "onboarding_offer")) {
      expect(resolvePaywallConfig(s).dismissible ?? true).toBe(true);
      expect(resolvePaywallConfig(s).freeContinueLabel ?? null).toBeNull();
    }
  });
  it("hides the X and ignores hardware back when not dismissible, but the free button is always there", () => {
    expect(MODAL).toMatch(/const dismissible = config\?\.dismissible !== false;/);
    expect(MODAL).toMatch(/const requestClose = useCallback\(\(\) => \{\s*if \(!dismissible\) return;/);
    expect(MODAL).toMatch(/\{dismissible && \(\s*<Pressable\s*onPress=\{requestClose\}/);
    expect(MODAL).toMatch(/\{!!config\?\.freeContinueLabel && \(\s*<Pressable\s*onPress=\{continueFree\}/);
    // No X means no reserved space above the hero — the free button stays on the first screen.
    expect(MODAL).toMatch(/paddingTop: topPad \+ \(dismissible \? 46 : compact \? 6 : 14\)/);
    // Free sits directly under the CTA, above the tagline and strip.
    const cta = MODAL.indexOf("<PaywallPurchaseButton");
    const free = MODAL.indexOf("onPress={continueFree}");
    const strip = MODAL.indexOf("<ProBenefits emphasize");
    expect(cta).toBeLessThan(free);
    expect(free).toBeLessThan(strip);
  });
  it("free resolves without any store call, and never while a transaction is live", () => {
    const fn = code(MODAL).slice(code(MODAL).indexOf("const continueFree"), code(MODAL).indexOf("const closeResolution"));
    expect(fn).toMatch(/if \(isBusy\(state\.phase\)\) return;/);
    expect(fn).toMatch(/dismiss\(false\);\s*request\?\.onDeclined\?\.\(\);/);
    expect(fn).not.toMatch(/purchase|restore|mutate|invalidate|grant/i);
  });
  it("keeps Restore, the live pricing hierarchy and Annual-by-default", () => {
    expect(MODAL).toMatch(/onRestore=\{runRestore\}/);
    expect(MODAL).toMatch(/label=\{planCtaLabel\(selected,/);
    expect(read("components/monetization/paywall/PlanSelector.tsx")).toMatch(/equivalent=\{annualMonthlyEquivalent\(annualPricing\)\}/);
    expect(read("components/monetization/paywall/PlanCard.tsx")).toMatch(/<Text style=\{s\.billedLine\}>Billed \{billed\}<\/Text>/);
    expect(MODAL).toMatch(/useState<PurchaseTarget>\("annual"\)/);
  });
  it("carries onDeclined through the provider, never fired by the X", () => {
    expect(PROVIDER).toMatch(/onDeclined\?: \(\) => void;/);
    expect(PROVIDER).toMatch(/onDeclined: options\?\.onDeclined,/);
    const close = code(MODAL).slice(code(MODAL).indexOf("const requestClose"), code(MODAL).indexOf("const continueUnlocked"));
    expect(close).not.toMatch(/onDeclined/);
  });
});

// ── Completion ──────────────────────────────────────────────────────────────

describe("completion", () => {
  it("finishes a new user only from onUnlocked (server-confirmed) or onDeclined (free), guarded once", () => {
    expect(SCREEN).toMatch(/onUnlocked: \(\) => \{ void finishNewUser\('pro'\); \},\s*onDeclined: \(\) => \{ void finishNewUser\('free'\); \},/);
    expect(SCREEN).toMatch(/if \(finishingRef\.current\) return;\s*finishingRef\.current = true;\s*setSaving\(true\);\s*await persistIfStaged\(\);/);
    expect(code(SCREEN)).toMatch(/await finishNewUserOnboarding\('resell'\);\s*router\.replace\('\/\(tabs\)' as any\);/);
    // Nothing in the screen touches the store, entitlements or balances.
    expect(code(SCREEN)).not.toMatch(/purchase\(|restorePurchases|useEntitlement|packScans|grant/);
  });
  it("purchasing, activating and cancellation never complete: onUnlocked fires only from the unlocked phase", () => {
    expect(MODAL).toMatch(/if \(state\.phase !== "unlocked" \|\| !hasContinuation\) return;/);
    expect(MODAL).toMatch(/const fn = consumeUnlock\(\);\s*dismiss\(true\);\s*fn\?\.\(\);/);
    expect(read("lib/paywallMachine.ts")).toMatch(/if \(confirmed\) return \{ phase: "unlocked", notice: null, target \};/);
    // Cancellation is a notice-less return to idle; failure is a notice in idle.
    expect(read("lib/paywallMachine.ts")).toMatch(/return phase === "unlocked" \|\| phase === "pending_activation";/);
  });
  it("Continue Free makes no store call and no grant", () => {
    expect(code(SCREEN)).not.toMatch(/Purchases\.|revenuecat|scanPack|account_usage/i);
  });
  it("an existing account never sees the offer and completes normally", () => {
    expect(SCREEN).toMatch(/if \(classifyAccount\(user\?\.created_at, pending\.stagedAt\) === 'existing'\) \{/);
    expect(SCREEN).toMatch(/if \(resume === 'existing'\) \{ void finishExisting\('existing_account'\); return; \}/);
    const existing = SCREEN.slice(SCREEN.indexOf("const finishExisting"), SCREEN.indexOf("const finishNewUser"));
    expect(existing).toMatch(/await completeOnboarding\('resell'\)/);
    expect(existing).not.toMatch(/openProPaywall|finishNewUserOnboarding/);
  });
  it("fixes the analytics property: onboarding_version is the version, outcome is separate", () => {
    expect(SCREEN).toMatch(/onboarding_version: ONBOARDING_VERSION, outcome/);
    expect(code(SCREEN)).not.toMatch(/completed_onboarding_version/);
  });
});

// ── Version + reset ─────────────────────────────────────────────────────────

describe("version", () => {
  it("is 3 in the finished implementation, and reset clears the new keys", () => {
    expect(STORAGE).toMatch(/export const ONBOARDING_VERSION = 3;/);
    expect(STORAGE).toMatch(/KEY_VERSION, KEY_COMPLETE, KEY_USER_MODE, KEY_INTERESTS,\s*KEY_STAGED, KEY_PENDING,/);
    expect(STORAGE).toMatch(/const PENDING_MAX_AGE_MS = 30 \* 24 \* 60 \* 60 \* 1000;/);
  });
});

// ── Pre-QA corrections ──────────────────────────────────────────────────────

describe("email confirmation copy", () => {
  it("never tells a mid-funnel user to take the quiz first", () => {
    // After confirmation, auth/callback replaces to /auth?mode=login with no
    // authEntryPoint — which defaults to 'onboarding' — so this user lands in
    // loginOnly having already finished the quiz.
    expect(read("app/auth/callback.tsx")).toMatch(/router\.replace\(\{ pathname: '\/auth', params: \{ mode: 'login' \} \}/);
    expect(AUTH).toMatch(/params\.authEntryPoint === 'settings' \? 'settings' : 'onboarding'/);
    // Both "take the quiz first" sites are now gated on the marker.
    expect(AUTH).toMatch(/\{loginOnly && pendingOnboarding \?/);
    expect(AUTH).toMatch(/<Text style=\{s\.switchText\}>Log in to finish setting up FlipStart\.<\/Text>/);
    expect(AUTH).toMatch(/!isSignUp && error && error !== '__EMAIL_EXISTS__' && !\(loginOnly && pendingOnboarding\) &&/);
    // Neither remaining "quiz first" string can render while the marker is set.
    for (const m of AUTH.matchAll(/Take the quiz first/g)) {
      const before = AUTH.slice(0, m.index!);
      expect(before).toMatch(/pendingOnboarding/);
    }
  });

  it("reads the marker without writing, clearing, or changing loginOnly", () => {
    expect(AUTH).toMatch(/import \{ completeOnboarding, readPendingNewUserOffer \} from '@\/lib\/onboarding-storage';/);
    expect(AUTH).toMatch(/readPendingNewUserOffer\(\)\s*\.then\(p => \{ if \(alive\) setPendingOnboarding\(!!p\); \}\)/);
    expect(code(AUTH)).not.toMatch(/setPendingNewUserOffer|clearPendingNewUserOffer|finishNewUserOnboarding/);
    // Unchanged security behaviour.
    expect(AUTH).toMatch(/const loginOnly = entryPoint === 'onboarding' && params\.mode === 'login' && !cameFromLanding;/);
    expect(AUTH).toMatch(/const bounceIfNewAccountOnLoginOnly = async \(\): Promise<boolean> =>/);
    expect((AUTH.match(/completeOnboarding\('resell'\)/g) ?? []).length).toBe(4);
  });

  it("leaves ordinary loginOnly copy alone when no funnel is pending", () => {
    expect(AUTH).toMatch(/\) : loginOnly \? \(/);
    expect(AUTH).toMatch(/New to FlipStart\? <Text style=\{s\.switchTextBold\}>Take the quiz first<\/Text>/);
    expect(AUTH).toMatch(/No account\? <Text style=\{s\.switchTextBold\}>Create one instead →<\/Text>/);
  });
});

describe("pending activation on the onboarding offer", () => {
  it("resolves through onPendingActivation, never onDeclined", () => {
    expect(MODAL).toMatch(/if \(state\.phase === "pending_activation"\) request\?\.onPendingActivation\?\.\(\);\s*else request\?\.onDeclined\?\.\(\);/);
    expect(MODAL).toMatch(/if \(dismissible\) return;/);
    expect(PROVIDER).toMatch(/onPendingActivation\?: \(\) => void;/);
    expect(PROVIDER).toMatch(/onPendingActivation: options\?\.onPendingActivation,/);
  });

  it("offers Continue to FlipStart with truthful copy, not a generic Close", () => {
    expect(MODAL).toMatch(/mustResolve=\{!dismissible\}/);
    expect(MODAL).toMatch(/const carryOn = !unlocked && mustResolve;/);
    expect(MODAL).toContain("Continue to FlipStart");
    expect(MODAL).toMatch(/Your Pro access is still activating\./);
    expect(MODAL).toMatch(/Pro unlocks automatically once it\\u2019s confirmed\./);
    // It must not claim Pro is already active.
    expect(MODAL).not.toMatch(/carryOn[\s\S]{0,200}(Pro is active|now open on this account)/);
  });

  it("completes onboarding with its own reason, never free", () => {
    expect(SCREEN).toMatch(/onPendingActivation: \(\) => \{ void finishNewUser\('activation_pending'\); \},/);
    expect(SCREEN).toMatch(/const finishNewUser = useCallback\(async \(outcome: 'pro' \| 'free' \| 'activation_pending'\) => \{/);
    // The three outcomes are distinct call sites; none of them shares a value.
    const offer = SCREEN.slice(SCREEN.indexOf("openProPaywall('onboarding_offer'"), SCREEN.indexOf("}, [openProPaywall, finishNewUser]"));
    expect(offer.match(/finishNewUser\('(\w+)'\)/g)).toEqual([
      "finishNewUser('pro')", "finishNewUser('free')", "finishNewUser('activation_pending')",
    ]);
  });

  it("grants nothing and touches no store, entitlement or balance", () => {
    const fn = code(MODAL).slice(code(MODAL).indexOf("const closeResolution"), code(MODAL).indexOf("const hasContinuation"));
    expect(fn).not.toMatch(/purchase|restore|grant|entitlement|invalidate|scan/i);
    expect(code(SCREEN)).not.toMatch(/isPro|setPro|grantPro|packScans|account_usage/i);
    // The reconciliation path itself is untouched.
    expect(MODAL).toMatch(/const confirmed = await confirmProWithServer\(\);/);
    expect(read("lib/paywallMachine.ts")).toMatch(/phase: "pending_activation",/);
  });

  it("keeps the free button unreachable while a transaction is live", () => {
    const free = code(MODAL).slice(code(MODAL).indexOf("const continueFree"), code(MODAL).indexOf("const closeResolution"));
    expect(free).toMatch(/if \(isBusy\(state\.phase\)\) return;/);
    expect(read("lib/paywallMachine.ts")).toMatch(/export function isBusy\(phase: PaywallPhase\): boolean \{/);
  });

  it("leaves the normal offer exactly as it was", () => {
    const cfg = resolvePaywallConfig("onboarding_offer");
    expect(cfg.freeContinueLabel).toBe("Continue with 15 Free Scans");
    expect(cfg.dismissible).toBe(false);
    expect(cfg.showScanStoreAlternative).toBe(false);
    expect(MODAL).toMatch(/useState<PurchaseTarget>\("annual"\)/);
    expect(MODAL).toMatch(/onRestore=\{runRestore\}/);
    expect(MODAL).toMatch(/label=\{planCtaLabel\(selected,/);
  });

  it("still records free for the free button and pro for a confirmed activation", () => {
    expect(SCREEN).toMatch(/onUnlocked: \(\) => \{ void finishNewUser\('pro'\); \},/);
    expect(SCREEN).toMatch(/onDeclined: \(\) => \{ void finishNewUser\('free'\); \},/);
    expect(MODAL).toMatch(/if \(state\.phase !== "unlocked" \|\| !hasContinuation\) return;/);
  });
});

// ── Phase 1 refinement: the Log In wall ─────────────────────────────────────

describe("Log In entry path — the wall against silent account creation", () => {
  it("enters the existing login-only mode, unchanged", () => {
    expect(SCREEN).toMatch(/pathname: '\/auth', params: \{ mode: 'login', authEntryPoint: 'onboarding' \}/);
    expect(AUTH).toMatch(/const loginOnly = entryPoint === 'onboarding' && params\.mode === 'login' && !cameFromLanding;/);
  });

  it("bounces a Google or Apple login that turns out to be a brand-new account", () => {
    // Both social handlers gate on the same check, before any navigation.
    expect((AUTH.match(/if \(await bounceIfNewAccountOnLoginOnly\(\)\) return;/g) ?? []).length).toBeGreaterThanOrEqual(2);
    const google = AUTH.slice(AUTH.indexOf("const handleGoogleSignIn"), AUTH.indexOf("const handleAppleSignIn"));
    expect(google).toMatch(/bounceIfNewAccountOnLoginOnly/);
    const apple = AUTH.slice(AUTH.indexOf("const handleAppleSignIn"), AUTH.indexOf("const handleSignUp"));
    expect(apple).toMatch(/bounceIfNewAccountOnLoginOnly/);
  });

  it("treats a freshly auto-created profile row as NOT proof of a prior account", () => {
    // ensureProfile() creates a row for any social login; only a FINISHED
    // onboarding proves the account already existed.
    expect(AUTH).toMatch(/if \(!profile \|\| profile\.onboarding_complete !== true\) \{/);
    expect(AUTH).toMatch(/await supabase\.auth\.signOut\(\)\.catch\(\(\) => \{\}\);/);
    expect(AUTH).toMatch(/params: \{ notice: 'no_existing_account' \}/);
  });

  it("fails safe: an inconclusive check never bounces a real user", () => {
    expect(AUTH).toMatch(/if \(!uid\) return false; \/\/ can't tell — don't bounce/);
    expect(AUTH).toMatch(/if \(error\) return false; \/\/ check failed — don't bounce/);
    expect(AUTH).toMatch(/return false; \/\/ existing account — proceed normally/);
  });

  it("gives the bounced user a truthful next step, and the log-in wording", () => {
    expect(SCREEN).toMatch(/params\.notice === 'no_existing_account'/);
    expect(SCREEN).toMatch(/That log-in created a new account, not an existing one\./);
    expect(SCREEN).toMatch(/Tap Get Started to set up FlipStart\./);
  });

  it("leaves normal signup untouched — the wall is login-only", () => {
    expect(AUTH).toMatch(/if \(!loginOnly\) return false;/);
    expect(SCREEN).toMatch(/pathname: '\/auth', params: \{ mode: 'signup', authEntryPoint: 'onboarding' \}/);
  });
});

describe("Phase 1 flow shape", () => {
  it("advances motivation → experience → pain points → money, and Back reverses it", () => {
    const order = ["motivation", "experience", "pain_points", "money"] as const;
    order.forEach((st, i) => { if (i > 0) expect(QUIZ_STAGES.indexOf(st)).toBe(QUIZ_STAGES.indexOf(order[i - 1]) + 1); });
    expect(SCREEN).toMatch(/setStage\(stageIndex <= 0 \? 'welcome' : QUIZ_STAGES\[stageIndex - 1\]\);/);
    expect(SCREEN).toMatch(/setStage\(QUIZ_STAGES\[stageIndex \+ 1\]\);/);
  });

  it("computes progress from the live stage array, never a hardcoded count", () => {
    QUIZ_STAGES.forEach((st, i) => expect(stageProgress(st)).toBeCloseTo((i + 1) / QUIZ_STAGES.length));
    expect(stageProgress("offer")).toBe(1);
    expect(code(read("lib/onboardingQuiz.ts"))).not.toMatch(/\/ ?(3|4|9|10)\b/);
  });

  it("keeps answers across back and forward — nothing clears them", () => {
    expect(code(SCREEN)).not.toMatch(/setAnswers\(EMPTY_ANSWERS\)/);
    expect(SCREEN).toMatch(/useState<OnboardingAnswers>\(\(\) => \(\{ \.\.\.EMPTY_ANSWERS, painPoints: \[\] \}\)\)/);
  });

  it("starts every question empty — answers are written ONLY by a tap", () => {
    // Regression: staged answers from an abandoned run were poured back into
    // the quiz, so the pain-point screen opened with an option already lit.
    expect(code(SCREEN)).not.toMatch(/answersFromStaged/);
    // Exactly three writers, all of them tap handlers.
    const writers = [...code(SCREEN).matchAll(/setAnswers\(/g)];
    expect(writers).toHaveLength(3);
    for (const fn of ["const setGoal", "const setExperience", "const tapPain"]) {
      expect(code(SCREEN)).toContain(fn);
    }
    // The empty set is frozen, so it cannot be mutated into a non-empty one.
    expect(Object.isFrozen(EMPTY_ANSWERS)).toBe(true);
    expect(Object.isFrozen(EMPTY_ANSWERS.painPoints)).toBe(true);
    expect(EMPTY_ANSWERS).toEqual({ primaryGoal: null, experienceLevel: null, painPoints: [] });
  });

  it("records the offer's outcome from storage, since a resumed offer has an empty quiz in memory", () => {
    expect(SCREEN).toMatch(/const recorded = \(await readStagedAnswers\(\)\) \?\? null;/);
    expect(SCREEN).toMatch(/primary_goal: recorded\?\.primaryGoal \?\? answers\.primaryGoal/);
    expect(SCREEN).toMatch(/pain_points: recorded\?\.painPoints \?\? answers\.painPoints/);
  });

  it("leaves the paywall and version alone", () => {
    expect(resolvePaywallConfig("onboarding_offer").freeContinueLabel).toBe("Continue with 15 Free Scans");
    expect(resolvePaywallConfig("onboarding_offer").dismissible).toBe(false);
    expect(STORAGE).toMatch(/export const ONBOARDING_VERSION = 3;/);
  });
});
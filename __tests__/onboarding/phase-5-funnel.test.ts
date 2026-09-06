/**
 * __tests__/onboarding/phase-5-funnel.test.ts
 *
 * The final funnel: Welcome → auth → onboarding offer → Free or Pro → in.
 *
 * Most of what matters here already has a pin from an earlier phase. This
 * suite is the end-to-end contract — every guard the launch depends on, in
 * one place, so a regression in any phase fails a test that names the
 * funnel step it broke.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { resolvePaywallConfig, PAYWALL_SOURCES, FREE_LIFETIME_SCANS } from "@/lib/paywallConfig";
import { classifyAccount } from "@/lib/onboardingAnswers";
import { QUIZ_STAGES, QUESTION_STAGES } from "@/lib/onboardingQuiz";

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
const AUTH     = read("app/auth.tsx");
const USERNAME = read("app/username-setup.tsx");
const CALLBACK = read("app/auth/callback.tsx");
const AUTHCTX  = read("lib/auth-context.tsx");
const STORAGE  = read("lib/onboarding-storage.ts");
const CONFIG   = read("lib/paywallConfig.ts");
const MODAL    = read("components/monetization/paywall/ProPaywallModal.tsx");
const PROVIDER = read("components/monetization/paywall/ProPaywallProvider.tsx");
const MACHINE  = read("lib/paywallMachine.ts");
const SHELL    = read("components/onboarding/OnboardingShell.tsx");

const welcomeShell = () => {
  const at = SCREEN.indexOf("Spot value.");
  return SCREEN.slice(SCREEN.lastIndexOf("<OnboardingShell", at), SCREEN.indexOf(">", SCREEN.indexOf("secondaryCta", at)));
};

// ── §3 / §32 Welcome ────────────────────────────────────────────────────────

describe("Welcome / Log In", () => {
  it("renders Get Started and Log In on the first frame, with no async gate", () => {
    const w = welcomeShell();
    expect(w).toMatch(/cta=\{\{ label: 'Get Started', onPress: start, kicker: signedIn \? undefined : 'NEW HERE\?', pulse: true \}\}/);
    expect(w).toMatch(/label: 'Log In', onPress: logIn, kicker: 'ALREADY HAVE A FLIPSTART ACCOUNT\?'/);
    // Nothing that used to delay the CTA area is back.
    expect(code(SCREEN)).not.toMatch(/getCompletedOnboardingVersion|onboardedBefore|const decided = resume|skeleton/i);
    expect(code(SCREEN)).not.toMatch(/cta=\{(resume|authLoading|profileChecked)/);
  });

  it("gives Log In real weight and hides it for a signed-in session", () => {
    expect(SHELL).toMatch(/secondaryCta: \{[^}]*minHeight: 52/);
    expect(SHELL).toMatch(/cta: \{[^}]*minHeight: 54/);
    expect(welcomeShell()).toMatch(/secondaryCta=\{signedIn \? undefined :/);
    expect(code(SCREEN)).not.toMatch(/signOut/);
  });

  it("says Log In everywhere on this surface, never Sign In", () => {
    expect(code(SCREEN)).not.toMatch(/Sign In|Sign in|sign-in/);
    expect(SCREEN).toContain("'Log In'");
  });
});

// ── §4 Login-only wall ──────────────────────────────────────────────────────

describe("login-only wall", () => {
  it("is entered by Log In and stays login-only", () => {
    expect(SCREEN).toMatch(/pathname: '\/auth', params: \{ mode: 'login', authEntryPoint: 'onboarding' \}/);
    expect(AUTH).toMatch(/const loginOnly = entryPoint === 'onboarding' && params\.mode === 'login' && !cameFromLanding;/);
  });

  it("Google: an unknown account cannot silently become a FlipStart account", () => {
    const google = AUTH.slice(AUTH.indexOf("const handleGoogleSignIn"), AUTH.indexOf("const handleAppleSignIn"));
    expect(google).toMatch(/if \(await bounceIfNewAccountOnLoginOnly\(\)\) return;/);
    // The bounce runs BEFORE any completion or navigation in that handler.
    expect(google.indexOf("bounceIfNewAccountOnLoginOnly")).toBeLessThan(google.indexOf("completeOnboarding"));
    expect(google.indexOf("bounceIfNewAccountOnLoginOnly")).toBeLessThan(google.indexOf("goAfterAuth"));
  });

  it("Apple: same wall, same order", () => {
    const apple = AUTH.slice(AUTH.indexOf("const handleAppleSignIn"), AUTH.indexOf("const handleSignUp"));
    expect(apple).toMatch(/if \(await bounceIfNewAccountOnLoginOnly\(\)\) return;/);
    expect(apple.indexOf("bounceIfNewAccountOnLoginOnly")).toBeLessThan(apple.indexOf("completeOnboarding"));
    expect(apple.indexOf("bounceIfNewAccountOnLoginOnly")).toBeLessThan(apple.indexOf("goAfterAuth"));
  });

  it("treats an auto-created profile row as NOT an existing account, signs out, and bounces", () => {
    expect(AUTH).toMatch(/if \(!loginOnly\) return false;/);
    expect(AUTH).toMatch(/if \(!profile \|\| profile\.onboarding_complete !== true\) \{/);
    expect(AUTH).toMatch(/await supabase\.auth\.signOut\(\)\.catch\(\(\) => \{\}\);/);
    expect(AUTH).toMatch(/params: \{ notice: 'no_existing_account' \}/);
    // Inconclusive checks never bounce a real user.
    expect(AUTH).toMatch(/if \(!uid\) return false;/);
    expect(AUTH).toMatch(/if \(error\) return false;/);
  });

  it("leaves normal signup reachable from Get Started", () => {
    expect(SCREEN).toMatch(/pathname: '\/auth', params: \{ mode: 'signup', authEntryPoint: 'onboarding' \}/);
    const signup = AUTH.slice(AUTH.indexOf("const handleSignUp"), AUTH.indexOf("const handleLogin"));
    expect(signup).not.toMatch(/bounceIfNewAccountOnLoginOnly/);
  });
});

// ── §5 / §6 / §8 Auth screens ───────────────────────────────────────────────

describe("auth screen polish", () => {
  it("uses the onboarding masthead and a real title: Create Account / Log In", () => {
    expect(AUTH).toMatch(/import \{ OnboardingMasthead \} from '@\/components\/onboarding\/OnboardingMasthead';/);
    expect(AUTH).toMatch(/<OnboardingMasthead \/>\s*<Text style=\{s\.formTitle\}[^>]*>\{isSignUp \? 'Create Account' : 'Log In'\}<\/Text>/);
    expect(code(AUTH)).not.toMatch(/'Welcome back'|'Create your account'/);
  });

  it("only ties the form back to onboarding for a user who came from it", () => {
    expect(AUTH).toMatch(/\{isSignUp && pendingOnboarding && \(\s*<Text style=\{s\.formSupport\}>One more step and your FlipStart profile is saved\.<\/Text>/);
  });

  it("uses Log in, not Sign in, for a mid-funnel user", () => {
    expect(AUTH).toContain("Log in to finish setting up FlipStart.");
    expect(code(AUTH)).not.toMatch(/Sign in to finish/);
    expect(AUTH).toMatch(/\{loginOnly && pendingOnboarding \?/);
  });

  it("keeps the keyboard patterns on both auth screens", () => {
    for (const f of [AUTH, USERNAME]) {
      expect(f).toMatch(/<KeyboardAvoidingView behavior=\{Platform\.OS === 'ios' \? 'padding' : 'height'\}/);
      expect(f).toMatch(/keyboardShouldPersistTaps="handled"/);
    }
  });

  it("centres the username form instead of pinning it to the top", () => {
    expect(USERNAME).toMatch(/<View style=\{s\.mastheadRow\}><OnboardingMasthead \/><\/View>/);
    expect(USERNAME).toMatch(/group:\s*\{ flex: 1, justifyContent: 'center'/);
    expect(USERNAME).toMatch(/primaryBtnDisabled: \{ backgroundColor: '#5F7562' \}/);
    expect(USERNAME).toMatch(/primaryTrim:/);
  });
});

// ── §7 Username flow ────────────────────────────────────────────────────────

describe("username flow", () => {
  it("email signup persists the username with onboarding_complete: true — no second ask", () => {
    // Confirmation off: inserted straight away.
    expect(AUTH).toMatch(/id: userId, username: trimUsername, display_name: trimUsername, onboarding_complete: true,/);
    // Confirmation on: parked, then used by ensureProfile on the first sign-in.
    expect(AUTH).toMatch(/await AsyncStorage\.setItem\(PENDING_USERNAME_KEY, trimUsername\)/);
    expect(AUTHCTX).toMatch(/id: userId, username: pendingUsername,\s*display_name: pendingUsername, onboarding_complete: true,/);
  });

  it("social signup gets a placeholder row that DOES require username setup", () => {
    expect(AUTHCTX).toMatch(/username: `user_\$\{userId\.slice\(0, 8\)\}`,\s*display_name: "Flipper", onboarding_complete: false,/);
    expect(SCREEN).toMatch(/if \(!profile\.onboarding_complete\) \{ setResume\('username'\); return; \}/);
  });

  it("keeps username rules and uniqueness intact", () => {
    expect(USERNAME).toMatch(/const USERNAME_RE = /);
    expect(USERNAME).toMatch(/check_username_available|availability === 'taken'/);
    expect(USERNAME).toMatch(/\{ onConflict: 'id' \}/);
    expect(USERNAME).toMatch(/upsertError\.code === '23505'/);
    expect(AUTH).toMatch(/check_username_available/);
  });
});

// ── §9 / §10 Handoff and marker ─────────────────────────────────────────────

describe("new account → onboarding offer", () => {
  it("Save My Profile stages, marks, sets the return, then hands to signup", () => {
    const save = SCREEN.slice(SCREEN.indexOf("const saveProfileAndCreateAccount"), SCREEN.indexOf("const finishExisting"));
    for (const step of ["await stageOnboardingAnswers(", "await setPendingNewUserOffer();", "setAuthReturnDest('/onboarding');", "mode: 'signup'"]) {
      expect(save).toContain(step);
    }
    expect(save.indexOf("setPendingNewUserOffer")).toBeLessThan(save.indexOf("router.push"));
  });

  it("every auth success path still calls completeOnboarding, which the marker turns into a no-op", () => {
    expect((AUTH.match(/completeOnboarding\('resell'\)/g) ?? [])).toHaveLength(4);
    expect(USERNAME).toMatch(/await completeOnboarding\('resell'\);/);
    expect(STORAGE).toMatch(/if \(await readPendingNewUserOffer\(\)\) return;\s*await writeCompletion\(mode\);/);
    expect(AUTH).toMatch(/const dest = takeAuthReturnDest\(\) \?\? '\/\(tabs\)';/);
  });

  it("username setup returns a pending funnel straight to /onboarding — no Home frame", () => {
    expect(USERNAME).toMatch(/const pending = await readPendingNewUserOffer\(\);\s*router\.replace\(\(pending \? '\/onboarding' : '\/\(tabs\)'\) as any\);/);
    // Everyone else still goes Home.
    expect(USERNAME).not.toMatch(/router\.replace\('\/onboarding' as any\)/);
  });

  it("email confirmation lands on login, which returns through the same mechanism", () => {
    expect(CALLBACK).toMatch(/router\.replace\(\{ pathname: '\/auth', params: \{ mode: 'login' \} \}/);
    expect(AUTH).toMatch(/params\.authEntryPoint === 'settings' \? 'settings' : 'onboarding'/);
  });

  it("the marker survives, binds, and is cleared only at the offer decision", () => {
    expect(STORAGE).toMatch(/export async function bindPendingOfferToUser/);
    expect(STORAGE).toMatch(/export async function finishNewUserOnboarding\(mode: UserMode\): Promise<void> \{\s*await clearPendingNewUserOffer\(\);/);
    expect(SCREEN).toMatch(/await bindPendingOfferToUser\(uid\);\s*await bindStagedAnswersToUser\(uid\);/);
    // Sign In / Log In clears it; nothing else outside the decision does.
    const logIn = SCREEN.slice(SCREEN.indexOf("const logIn = useCallback"), SCREEN.indexOf("const saveProfileAndCreateAccount"));
    expect(logIn).toMatch(/clearPendingNewUserOffer\(\)/);
    expect(code(AUTH)).not.toMatch(/clearPendingNewUserOffer|finishNewUserOnboarding/);
    expect(code(USERNAME)).not.toMatch(/clearPendingNewUserOffer|finishNewUserOnboarding/);
  });
});

// ── §12–§23 The offer ───────────────────────────────────────────────────────

describe("onboarding offer", () => {
  const cfg = resolvePaywallConfig("onboarding_offer");

  it("exists, sells the complete experience, and derives the free label from the real allowance", () => {
    expect(PAYWALL_SOURCES).toContain("onboarding_offer");
    expect(cfg.headline).toBe("Unlock the Full FlipStart Experience");
    expect(cfg.subtitle).toBe("More scans and the complete toolkit for finding, analyzing, and flipping smarter.");
    expect(cfg.freeContinueLabel).toBe(`Continue with ${FREE_LIFETIME_SCANS} Free Scans`);
    expect(CONFIG).toMatch(/freeContinueLabel: `Continue with \$\{FREE_LIFETIME_SCANS\} Free Scans`,/);
    // The constant is declared ABOVE the config, or the reference would throw at load.
    expect(CONFIG.indexOf("export const FREE_LIFETIME_SCANS")).toBeLessThan(CONFIG.indexOf("const ONBOARDING_OFFER"));
  });

  it("uses no manipulative decline copy, no income hype, no unlimited", () => {
    expect(code(CONFIG)).not.toMatch(/No thanks|Skip|Maybe later|Continue without Pro|Keep limited|I don't want/i);
    expect(code(CONFIG).toLowerCase()).not.toMatch(/unlimited|guarantee|make \$|earn \$|income/);
  });

  it("is not dismissible, shows no Scan Store, keeps Restore", () => {
    expect(cfg.dismissible).toBe(false);
    expect(cfg.showScanStoreAlternative).toBe(false);
    for (const s of PAYWALL_SOURCES.filter(x => x !== "onboarding_offer")) {
      expect(resolvePaywallConfig(s).dismissible ?? true, s).toBe(true);
    }
    expect(MODAL).toMatch(/const requestClose = useCallback\(\(\) => \{\s*if \(!dismissible\) return;/);
    expect(MODAL).toMatch(/\{dismissible && \(\s*<Pressable\s*onPress=\{requestClose\}/);
    expect(MODAL).toMatch(/onRequestClose=\{requestClose\}/);           // hardware back → same guard
    expect(MODAL).toMatch(/onRestore=\{runRestore\}/);
    expect(MODAL).toMatch(/showScanStore=\{!!config\?\.showScanStoreAlternative\}/);
  });

  it("keeps the approved pricing hierarchy: Annual default, live prices, derived monthly equivalent", () => {
    expect(MODAL).toMatch(/useState<PurchaseTarget>\("annual"\)/);
    expect(MODAL).toMatch(/label=\{planCtaLabel\(selected,/);
    const pricing = read("lib/paywallPricing.ts");
    expect(pricing).toMatch(/priceAmount \/ 12/);
    expect(code(pricing)).not.toMatch(/39\.99|7\.99|3\.33/);
    expect(read("components/monetization/paywall/PlanSelector.tsx")).toMatch(/equivalent=\{annualMonthlyEquivalent\(annualPricing\)\}/);
  });

  it("keeps the four real Pro benefits", () => {
    const benefits = read("components/monetization/paywall/ProBenefits.tsx");
    // Visual labels break across two lines; the a11y names are the exact strings.
    for (const b of ["3-photo scans", "Deep Analysis", "Generate Listings", "AI Context"]) expect(benefits).toContain(`a11y: "${b}"`);
    expect((benefits.match(/a11y: "/g) ?? [])).toHaveLength(4);
    expect(code(benefits).toLowerCase()).not.toMatch(/unlimited/);
  });

  it("opens exactly once per arrival, from the focused screen only", () => {
    expect(SCREEN).toMatch(/useFocusEffect\(useCallback\(\(\) => \{/);
    expect(SCREEN).toMatch(/if \(offerOpenedRef\.current\) return;\s*offerOpenedRef\.current = true;\s*openOffer\(\);/);
    expect(SCREEN).toMatch(/openProPaywall\('onboarding_offer', \{/);
  });
});

// ── §24–§28 Purchase states ─────────────────────────────────────────────────

describe("purchase states", () => {
  it("FREE: no store call, completes as free, enters", () => {
    const free = code(MODAL).slice(code(MODAL).indexOf("const continueFree"), code(MODAL).indexOf("const closeResolution"));
    expect(free).toMatch(/if \(isBusy\(state\.phase\)\) return;/);
    expect(free).not.toMatch(/purchase|restore|grant|entitle|invalidate|scan/i);
    expect(SCREEN).toMatch(/onDeclined: \(\) => \{ void finishNewUser\('free'\); \},/);
    const finish = code(SCREEN).slice(code(SCREEN).indexOf("const finishNewUser"), code(SCREEN).indexOf("const [offerShown"));
    expect(finish).toMatch(/await persistIfStaged\(\);/);
    expect(finish).toMatch(/await finishNewUserOnboarding\('resell'\);\s*router\.replace\('\/\(tabs\)' as any\);/);
    expect(finish).not.toMatch(/Purchases|revenuecat|scanPack|packScans|account_usage/i);
  });

  it("CANCEL / FAIL: back to idle with the offer still showing; never completes", () => {
    expect(MACHINE).toMatch(/return phase === "unlocked" \|\| phase === "pending_activation";/);   // the only terminals
    expect(MACHINE).toMatch(/export function purchaseCancelled\(|cancel/i);
    // A cancel or failure returns to idle — not a terminal phase — so the
    // panel never replaces the offer and onUnlocked cannot fire.
    expect(MACHINE).toMatch(/phase: "idle",\s*notice: null/);
    expect(MODAL).toMatch(/if \(state\.phase !== "unlocked" \|\| !hasContinuation\) return;/);
  });

  it("SUCCESS NOT CONFIRMED: activating/pending, never Pro", () => {
    expect(MACHINE).toMatch(/if \(confirmed\) return \{ phase: "unlocked", notice: null, target \};/);
    expect(MACHINE).toMatch(/phase: "pending_activation",/);
    expect(MODAL).toMatch(/const confirmed = await confirmProWithServer\(\);/);
    expect(MODAL).toMatch(/setState\(afterActivation\(confirmed, target\)\);/);
  });

  it("CONFIRMED: onUnlocked → complete as pro → Home", () => {
    expect(MODAL).toMatch(/const fn = consumeUnlock\(\);\s*dismiss\(true\);\s*fn\?\.\(\);/);
    expect(SCREEN).toMatch(/onUnlocked: \(\) => \{ void finishNewUser\('pro'\); \},/);
  });

  it("PENDING + CONTINUE: its own reason, no local grant", () => {
    expect(MODAL).toMatch(/if \(state\.phase === "pending_activation"\) request\?\.onPendingActivation\?\.\(\);\s*else request\?\.onDeclined\?\.\(\);/);
    expect(MODAL).toContain("Continue to FlipStart");
    expect(MODAL).toMatch(/Your Pro access is still activating\./);
    expect(SCREEN).toMatch(/onPendingActivation: \(\) => \{ void finishNewUser\('activation_pending'\); \},/);
    expect(PROVIDER).toMatch(/onPendingActivation\?: \(\) => void;/);
    expect(code(SCREEN)).not.toMatch(/isPro|setPro|grantPro/i);
  });

  it("RESTORE: same authoritative confirmation, same unlocked path", () => {
    const restore = code(MODAL).slice(code(MODAL).indexOf("const runRestore"), code(MODAL).indexOf("const dismiss = useCallback"));
    expect(restore).toMatch(/confirmProWithServer/);
    expect(restore).toMatch(/afterActivation\(confirmed, null\)/);
  });

  it("records the three outcomes distinctly", () => {
    const offer = SCREEN.slice(SCREEN.indexOf("openProPaywall('onboarding_offer'"), SCREEN.indexOf("}, [openProPaywall, finishNewUser]"));
    expect(offer.match(/finishNewUser\('(\w+)'\)/g)).toEqual([
      "finishNewUser('pro')", "finishNewUser('free')", "finishNewUser('activation_pending')",
    ]);
    expect(SCREEN).toMatch(/onboarding_version: ONBOARDING_VERSION, outcome/);
  });
});

// ── §29–§31 Recovery and isolation ──────────────────────────────────────────

describe("interrupted flow recovery + account isolation", () => {
  it("CASE C: signed-in + marker + complete profile → straight to the offer", () => {
    const decide = SCREEN.slice(SCREEN.indexOf("const decide = useCallback"), SCREEN.indexOf("const decidingRef"));
    expect(decide).toMatch(/if \(!pending\) \{ setResume\('none'\); return; \}/);
    expect(decide).toMatch(/if \(!profile\.onboarding_complete\) \{ setResume\('username'\); return; \}/);
    expect(decide).toMatch(/setResume\('offer'\);\s*\}, \[/);
    expect(SCREEN).toMatch(/if \(resume === 'offer'\) \{ setStage\('offer'\); void persistIfStaged\(\); \}/);
    // The Home gate covers a cold start: version 3 + no completion → /onboarding.
    expect(read("app/(tabs)/index.tsx")).toMatch(/needsOnboarding\(\)/);
    expect(STORAGE).toMatch(/export const ONBOARDING_VERSION = 3;/);
  });

  it("a marker for a different account is cleared, never applied", () => {
    expect(SCREEN).toMatch(/if \(pending\.userId && pending\.userId !== uid\) \{\s*[\s\S]*?await clearPendingNewUserOffer\(\);\s*await clearStagedAnswers\(\);\s*setResume\('existing'\);/);
  });

  it("an existing account never sees the offer", () => {
    expect(SCREEN).toMatch(/if \(classifyAccount\(user\?\.created_at, pending\.stagedAt\) === 'existing'\) \{/);
    expect(classifyAccount("2026-01-01T00:00:00Z", Date.parse("2026-09-05T12:00:00Z"))).toBe("existing");
    expect(classifyAccount(undefined, Date.now())).toBe("existing");
    const existing = SCREEN.slice(SCREEN.indexOf("const finishExisting"), SCREEN.indexOf("const finishNewUser"));
    expect(existing).not.toMatch(/openProPaywall|finishNewUserOnboarding/);
  });

  it("a signed-in dev reset gets Enter FlipStart, no offer, no sign-out", () => {
    expect(SCREEN).toMatch(/if \(signedIn\) void finishExisting\('signed_in_quiz'\);\s*else void saveProfileAndCreateAccount\(\);/);
    expect(SCREEN).toMatch(/label: signedIn \? 'Enter FlipStart' : 'Save My Profile'/);
    expect(code(SCREEN)).not.toMatch(/signOut/);
  });

  it("a failed metadata write never traps; success clears the staged copy", () => {
    expect(SCREEN).toMatch(/const ok = await persistAnswersToAccount\(staged\);\s*if \(ok\) \{ persistedRef\.current = true; await clearStagedAnswers\(\); \}/);
    const answers = read("lib/onboardingAnswers.ts");
    expect(answers).toMatch(/if \(error\) \{[\s\S]*?return false;/);
    expect(answers).toMatch(/\} catch \(e\) \{[\s\S]*?return false;/);
  });

  it("the quiz itself is still the locked three questions", () => {
    expect(QUESTION_STAGES).toEqual(["motivation", "experience", "pain_points"]);
    expect(QUIZ_STAGES[QUIZ_STAGES.length - 1]).toBe("offer");
  });
});

// ── §36 / §37 Nothing structural moved ──────────────────────────────────────

describe("core systems untouched", () => {
  it("no schema, no SQL, no new tables", () => {
    for (const f of ["app/onboarding.tsx", "app/auth.tsx", "app/username-setup.tsx", "lib/onboarding-storage.ts", "lib/onboardingAnswers.ts"]) {
      expect(code(read(f))).not.toMatch(/CREATE TABLE|ALTER TABLE|\.rpc\(['"](?!check_username_available)/);
    }
  });

  it("monetization core files carry only the earlier, approved changes", () => {
    // The state machine and the purchase/entitlement helpers must not gain
    // any onboarding awareness.
    for (const f of ["lib/paywallMachine.ts", "lib/purchases.ts", "lib/revenuecat.ts", "lib/useEntitlement.ts"]) {
      expect(code(read(f))).not.toMatch(/onboarding/i);
    }
  });
});
/**
 * lib/onboardingQuiz.ts
 *
 * The onboarding quiz as data: every option, its coded value, and the small
 * pure rules that govern selection. No React, no storage, no SDK.
 *
 * ── Coded values, never display strings ─────────────────────────────────────
 * The previous onboarding stored the chip LABELS ("Vintage Clothing") and
 * nothing ever read them. Everything here is a stable snake_case key so that,
 * when Phase B decides what to persist and Phase C decides what to do with it,
 * the copy can change without the data changing.
 *
 * ── These are onboarding preferences, not product modes ─────────────────────
 * `primaryGoal` is NOT the old `UserMode`. `personal_finds` does not, and must
 * not, activate the unfinished "Buy for Yourself" mode — it only shapes the
 * messaging and the eventual result screen. The two types are deliberately
 * unrelated and nothing in this file imports onboarding-storage.
 *
 * ── The category vocabulary is the user's, not the app's ────────────────────
 * These describe what someone HUNTS FOR. They are intentionally not the Brand
 * Compendium's `BrandCategory`, the Diamonds' `DiamondCategory`, or a scan's
 * free-text category. If a preference ever drives product behaviour, mapping
 * happens at that point, once, in one place.
 *
 * ── Session-only in Phase A ─────────────────────────────────────────────────
 * Answers live in the onboarding screen's state. They survive back/forward,
 * not app termination. Persistence is a later phase's decision.
 */

// ── Primary motivation ──────────────────────────────────────────────────────

export type PrimaryGoal = "resell_profit" | "personal_finds" | "both";

export interface QuizOption<V extends string> {
  value: V;
  title: string;
  support: string;
  /** Small category label above the title on the Motivation cards. */
  eyebrow?: string;
  /** MaterialIcons glyph name. Presentation only — never persisted. */
  icon?: string;
}

export const PRIMARY_GOALS: readonly QuizOption<PrimaryGoal>[] = [
  { value: "resell_profit",  title: "Make more money reselling",             support: "Find better flips and make smarter buying decisions.",
    eyebrow: "MONEY \u00B7 RESELLING", icon: "trending-up" },
  { value: "personal_finds", title: "Identify items & know what\u2019s worth buying", support: "Understand unfamiliar finds, value, and what deserves a closer look.",
    eyebrow: "IDENTIFY \u00B7 VALUE", icon: "travel-explore" },
  { value: "both",           title: "A little of both",                      support: "Spot great personal finds and profitable flips.",
    eyebrow: "BOTH PATHS", icon: "auto-awesome" },
] as const;

// ── Hunt categories — LEGACY ONLY ───────────────────────────────────────────

/**
 * "What do you usually hunt for?" was removed from the flow: a fourth question
 * whose answer nothing read, on a screen that repeated the one before it.
 *
 * The TYPE survives so that staged answers and user_metadata written by the
 * earlier v3 build still parse. Nothing asks for a category any more, nothing
 * requires one, and no default is ever invented — a user who never answered
 * simply has no categories. The catalogue and the toggle are gone with the
 * screen they served.
 */
export type HuntCategory =
  | "vintage_clothing" | "streetwear" | "sneakers" | "sportswear"
  | "designer" | "accessories" | "everything";

const LEGACY_CATEGORIES: readonly HuntCategory[] = [
  "vintage_clothing", "streetwear", "sneakers", "sportswear",
  "designer", "accessories", "everything",
];

// ── Experience ──────────────────────────────────────────────────────────────

export type ExperienceLevel = "beginner" | "basic" | "experienced" | "regular_reseller";

export const EXPERIENCE_LEVELS: readonly QuizOption<ExperienceLevel>[] = [
  { value: "beginner",         title: "I\u2019m new to this",       support: "Still learning what to look for." },
  { value: "basic",            title: "I know the basics",          support: "I can spot some good finds." },
  { value: "experienced",      title: "I\u2019m pretty experienced", support: "I know many brands and resale cues." },
  { value: "regular_reseller", title: "I resell regularly",         support: "I actively source items to sell." },
] as const;

// ── Pain point ──────────────────────────────────────────────────────────────

export type PainPoint =
  | "item_identification" | "valuation_uncertainty" | "missed_opportunities"
  | "comp_research" | "slow_selling_buys" | "listing_time";

export const PAIN_POINTS: readonly { value: PainPoint; title: string; icon: string }[] = [
  { value: "item_identification",   title: "Identify unfamiliar items",            icon: "search" },
  { value: "valuation_uncertainty", title: "Know what something is really worth",  icon: "sell" },
  { value: "missed_opportunities",  title: "Find more profitable flips",           icon: "trending-up" },
  { value: "comp_research",         title: "Check sold comps faster",              icon: "receipt-long" },
  { value: "slow_selling_buys",     title: "Avoid buying items that won\u2019t move", icon: "hourglass-empty" },
  { value: "listing_time",          title: "Create listings faster",               icon: "post-add" },
] as const;

/**
 * Toggle one pain point. Multi-select with no exclusive member — every option
 * is independent, and the result is returned in CATALOGUE order so the stored
 * answer is identical no matter which order they were tapped in.
 */
export function togglePainPoint(
  current: readonly PainPoint[],
  tapped: PainPoint,
): PainPoint[] {
  const set = new Set(current);
  if (set.has(tapped)) set.delete(tapped); else set.add(tapped);
  return PAIN_POINTS.map(o => o.value).filter(v => set.has(v));
}

// ── Answers ─────────────────────────────────────────────────────────────────

export interface OnboardingAnswers {
  primaryGoal:     PrimaryGoal | null;
  experienceLevel: ExperienceLevel | null;
  /** Multi-select. Always in PAIN_POINTS order. */
  painPoints:      PainPoint[];
}

/**
 * The empty answer set. FROZEN, and its array with it: this object is shared
 * by every consumer, so one accidental `answers.painPoints.push(...)` would
 * otherwise leave a selection lit for every later session on the device.
 * Copy it, never hold it.
 */
export const EMPTY_ANSWERS: OnboardingAnswers = Object.freeze({
  primaryGoal: null,
  experienceLevel: null,
  painPoints: Object.freeze([]) as unknown as PainPoint[],
});

// ── Stages ──────────────────────────────────────────────────────────────────

/**
 * Every stage after Welcome, in order. Welcome shows no progress.
 *
 *   motivation … pain_point  — the four questions (Phase A)
 *   money … gamification     — the three value screens
 *   building, result         — profile build and the personalized payoff
 *   offer                    — the final Pro-or-Free choice, after auth
 *
 * The progress bar is computed from this array's length, so nothing anywhere
 * assumes how many stages there are. Auth happens between `result` and
 * `offer` on a different screen; progress simply pauses there.
 */
export type QuizStage =
  | "motivation" | "experience" | "pain_points"
  | "money" | "intelligence" | "gamification"
  | "building" | "result"
  | "offer";

export const QUIZ_STAGES: readonly QuizStage[] = [
  "motivation",
  "experience",
  "pain_points",
  "money",
  "intelligence",
  "gamification",
  "building",
  "result",
  "offer",
] as const;

/** The three stages that collect an answer. */
export const QUESTION_STAGES: readonly QuizStage[] = ["motivation", "experience", "pain_points"];

/**
 * Whether Continue may be enabled on a stage. Questions need their answer;
 * value screens and the result are always complete; the build stage advances
 * itself; the offer is decided on the paywall, never by Continue.
 */
export function stageIsComplete(stage: QuizStage, a: OnboardingAnswers): boolean {
  switch (stage) {
    case "motivation":   return a.primaryGoal !== null;
    case "experience":   return a.experienceLevel !== null;
    case "pain_points":  return a.painPoints.length > 0;
    case "money":
    case "intelligence":
    case "gamification":
    case "result":       return true;
    case "building":
    case "offer":        return false;
    default:             return false;
  }
}

/** All three answers present — the precondition for building a profile. */
export function answersComplete(a: OnboardingAnswers): a is OnboardingAnswers & {
  primaryGoal: PrimaryGoal; experienceLevel: ExperienceLevel;
} {
  return a.primaryGoal !== null && a.experienceLevel !== null && a.painPoints.length > 0;
}

/** 0-based progress fraction for the bar: stage 1 of N fills 1/N. */
export function stageProgress(stage: QuizStage): number {
  const i = QUIZ_STAGES.indexOf(stage);
  return i < 0 ? 0 : (i + 1) / QUIZ_STAGES.length;
}

// ── Validators (for tests and for whatever persists these later) ────────────

const GOAL_SET = new Set<string>(PRIMARY_GOALS.map(o => o.value));
const CATEGORY_SET = new Set<string>(LEGACY_CATEGORIES);
const EXPERIENCE_SET = new Set<string>(EXPERIENCE_LEVELS.map(o => o.value));
const PAIN_SET = new Set<string>(PAIN_POINTS.map(o => o.value));

export const isPrimaryGoal     = (v: unknown): v is PrimaryGoal     => typeof v === "string" && GOAL_SET.has(v);
export const isHuntCategory    = (v: unknown): v is HuntCategory    => typeof v === "string" && CATEGORY_SET.has(v);
export const isExperienceLevel = (v: unknown): v is ExperienceLevel => typeof v === "string" && EXPERIENCE_SET.has(v);
export const isPainPoint       = (v: unknown): v is PainPoint       => typeof v === "string" && PAIN_SET.has(v);
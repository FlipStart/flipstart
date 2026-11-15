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
 * ── Where answers go (V2) ───────────────────────────────────────────────────
 * Session state while answering (survives back/forward). Staged on device when
 * the user creates an account, then written to the account: auth
 * user_metadata AND profiles.onboarding_answers (lib/onboardingAnswers.ts).
 *
 * ── Copy may change; codes may not ──────────────────────────────────────────
 * V2 rewrote several titles. Every coded value is unchanged, so answers given
 * before and after the redesign land in the same dashboard bucket.
 */

// ── Primary motivation ──────────────────────────────────────────────────────

export type PrimaryGoal = "resell_profit" | "personal_finds" | "both";

export interface QuizOption<V extends string> {
  value: V;
  title: string;
  support: string;
}

export const PRIMARY_GOALS: readonly QuizOption<PrimaryGoal>[] = [
  { value: "resell_profit",  title: "Make more money reselling",      support: "Find stronger flips and source smarter." },
  { value: "personal_finds", title: "Find valuable items for myself", support: "Spot great finds, even when I\u2019m not selling." },
  { value: "both",           title: "A little of both",               support: "Some finds are personal, some are flips." },
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
  { value: "basic",            title: "I know the basics",          support: "I recognize some good brands." },
  { value: "experienced",      title: "I\u2019m pretty experienced", support: "I know many brands and resale cues." },
  { value: "regular_reseller", title: "I resell regularly",         support: "I source inventory to sell." },
] as const;

// ── What they want help with ("pain points") ────────────────────────────────

/**
 * Stored as `pain_points` everywhere (events, metadata, the profile column) —
 * the name predates V2's "what do you want help with" wording and is kept so
 * history is not split. V2 adds `learn_brands` and `track_progress`; every
 * earlier code is unchanged. Eras are deliberately not offered until era
 * analysis is improved.
 */
export type PainPoint =
  | "item_identification" | "valuation_uncertainty" | "missed_opportunities"
  | "comp_research" | "slow_selling_buys" | "listing_time"
  | "learn_brands" | "track_progress";

export const PAIN_POINTS: readonly { value: PainPoint; title: string; icon: string }[] = [
  { value: "item_identification",   title: "Identify unfamiliar items",    icon: "search" },
  { value: "valuation_uncertainty", title: "Know what it\u2019s worth",     icon: "sell" },
  { value: "missed_opportunities",  title: "Find profitable flips",        icon: "trending-up" },
  { value: "comp_research",         title: "Check sold comps faster",      icon: "receipt-long" },
  { value: "slow_selling_buys",     title: "Avoid items that won\u2019t sell", icon: "shield" },
  { value: "listing_time",          title: "Create listings faster",       icon: "post-add" },
  { value: "learn_brands",          title: "Learn brands",                 icon: "menu-book" },
  { value: "track_progress",        title: "Track finds and progress",     icon: "bar-chart" },
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

// ── How they first heard about FlipStart ────────────────────────────────────

/**
 * Platforms only — no "creator / influencer" option, which overlapped every
 * platform (a creator on TikTok has two right answers). Self-reported, so
 * read it as a signal, not attribution.
 */
export type AcquisitionSource =
  | "tiktok" | "instagram" | "youtube" | "app_store"
  | "facebook" | "reddit" | "friend" | "other";

export const ACQUISITION_SOURCES: readonly { value: AcquisitionSource; title: string }[] = [
  { value: "tiktok",    title: "TikTok" },
  { value: "instagram", title: "Instagram" },
  { value: "youtube",   title: "YouTube" },
  { value: "app_store", title: "App Store search" },
  { value: "facebook",  title: "Facebook" },
  { value: "reddit",    title: "Reddit" },
  { value: "friend",    title: "Friend or word of mouth" },
  { value: "other",     title: "Other" },
] as const;

/** The optional "Other" text: trimmed, single-spaced, at most this long. */
export const OTHER_SOURCE_MAX = 80;

export function cleanOtherSource(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/\s+/g, " ").trim().slice(0, OTHER_SOURCE_MAX).trim();
}

// ── Answers ─────────────────────────────────────────────────────────────────

export interface OnboardingAnswers {
  primaryGoal:     PrimaryGoal | null;
  experienceLevel: ExperienceLevel | null;
  /** Multi-select. Always in PAIN_POINTS order. */
  painPoints:      PainPoint[];
  acquisitionSource: AcquisitionSource | null;
  /** Only meaningful when acquisitionSource is "other". Optional, may be "". */
  acquisitionSourceOther: string;
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
  acquisitionSource: null,
  acquisitionSourceOther: "",
});

// ── Stages ──────────────────────────────────────────────────────────────────

/**
 * Every stage after Welcome, in order (onboarding V2). Welcome shows no progress.
 *
 *   walkthrough_analysis,
 *   walkthrough_progress    — the real-product walkthrough, BEFORE any question
 *   motivation … source      — the four questions
 *   building, result         — profile build (removed in V2 Phase 4) and payoff
 *   offer                    — the final Pro-or-Free choice, after auth
 *
 * The old money / intelligence / gamification value screens are gone: they
 * were hand-built sample cards, and V2 shows the real app instead.
 *
 * Auth happens between `result` and `offer` on a different screen; progress
 * simply pauses there.
 */
export type QuizStage =
  | "walkthrough_analysis" | "walkthrough_progress"
  | "motivation" | "experience" | "pain_points" | "source"
  | "building" | "result"
  | "offer";

export const QUIZ_STAGES: readonly QuizStage[] = [
  "walkthrough_analysis",
  "walkthrough_progress",
  "motivation",
  "experience",
  "pain_points",
  "source",
  "building",
  "result",
  "offer",
] as const;

/** The two real-product screens. */
export const WALKTHROUGH_STAGES: readonly QuizStage[] = ["walkthrough_analysis", "walkthrough_progress"];

/** The stages that collect an answer. */
export const QUESTION_STAGES: readonly QuizStage[] = ["motivation", "experience", "pain_points", "source"];

/** "Question n of 4" — 1-based, or 0 for a stage that is not a question. */
export function questionNumber(stage: QuizStage): number {
  return QUESTION_STAGES.indexOf(stage) + 1;
}

/**
 * Whether Continue may be enabled on a stage. Questions need their answer;
 * walkthrough screens and the result are always complete; the build stage
 * advances itself and the offer is decided in the paywall.
 */
export function stageIsComplete(stage: QuizStage, a: OnboardingAnswers): boolean {
  switch (stage) {
    case "motivation":   return a.primaryGoal !== null;
    case "experience":   return a.experienceLevel !== null;
    case "pain_points":  return a.painPoints.length > 0;
    case "source":       return a.acquisitionSource !== null;
    case "walkthrough_analysis":
    case "walkthrough_progress":
    case "result":       return true;
    case "building":
    case "offer":        return false;
    default:             return false;
  }
}

/** All four answers present — the precondition for building a profile. */
export function answersComplete(a: OnboardingAnswers): a is OnboardingAnswers & {
  primaryGoal: PrimaryGoal; experienceLevel: ExperienceLevel; acquisitionSource: AcquisitionSource;
} {
  return a.primaryGoal !== null && a.experienceLevel !== null && a.painPoints.length > 0
    && a.acquisitionSource !== null;
}

/**
 * Which of the seven progress segments a stage fills (V2):
 *   1–2 walkthrough · 3–6 the four questions · 7 the profile result.
 * `building` shares 6 with the last question only until Phase 4 removes it. The offer keeps the
 * bar full. Explicit, so a stage added later cannot silently shift the rest.
 */
export const PROGRESS_STEPS = 7;
const STAGE_STEP: Record<QuizStage, number> = {
  walkthrough_analysis: 1,
  walkthrough_progress: 2,
  motivation: 3,
  experience: 4,
  pain_points: 5,
  source: 6,
  building: 6,
  result: 7,
  offer: 7,
};

export function stageStep(stage: QuizStage): number {
  return STAGE_STEP[stage] ?? 0;
}

/** 0–1 for the shell's progress bar. */
export function stageProgress(stage: QuizStage): number {
  return stageStep(stage) / PROGRESS_STEPS;
}

// ── Analytics payload ───────────────────────────────────────────────────────

/**
 * The `onboarding_question_answered` payload — one per question, sent on
 * Continue (not per tap, so changing your mind is not noise). Coded values
 * only; the free "Other" text never goes to analytics — it lives on the
 * profile record.
 */
export function questionAnswerEvent(stage: QuizStage, a: OnboardingAnswers): Record<string, unknown> {
  const base = { flow: "v2", question_number: questionNumber(stage) };
  switch (stage) {
    case "motivation":  return { ...base, question: "goal", answer: a.primaryGoal };
    case "experience":  return { ...base, question: "experience", answer: a.experienceLevel };
    case "pain_points": return { ...base, question: "help", answers: a.painPoints, answer_count: a.painPoints.length };
    case "source":      return {
      ...base, question: "source", answer: a.acquisitionSource,
      has_other_text: a.acquisitionSource === "other" && cleanOtherSource(a.acquisitionSourceOther).length > 0,
    };
    default:            return { ...base, question: stage };
  }
}

// ── Validators (for tests and for whatever persists these later) ────────────

const GOAL_SET = new Set<string>(PRIMARY_GOALS.map(o => o.value));
const CATEGORY_SET = new Set<string>(LEGACY_CATEGORIES);
const EXPERIENCE_SET = new Set<string>(EXPERIENCE_LEVELS.map(o => o.value));
const PAIN_SET = new Set<string>(PAIN_POINTS.map(o => o.value));
const SOURCE_SET = new Set<string>(ACQUISITION_SOURCES.map(o => o.value));

export const isPrimaryGoal     = (v: unknown): v is PrimaryGoal     => typeof v === "string" && GOAL_SET.has(v);
export const isHuntCategory    = (v: unknown): v is HuntCategory    => typeof v === "string" && CATEGORY_SET.has(v);
export const isExperienceLevel = (v: unknown): v is ExperienceLevel => typeof v === "string" && EXPERIENCE_SET.has(v);
export const isPainPoint       = (v: unknown): v is PainPoint       => typeof v === "string" && PAIN_SET.has(v);
export const isAcquisitionSource = (v: unknown): v is AcquisitionSource => typeof v === "string" && SOURCE_SET.has(v);
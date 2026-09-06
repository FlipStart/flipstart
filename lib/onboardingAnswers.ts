/**
 * lib/onboardingAnswers.ts
 *
 * The account side of the quiz answers: deciding whether the signed-in
 * account is the one this onboarding session created, and writing the
 * answers to that account.
 *
 * ── New vs. existing is explicit, not inferred from "auth succeeded" ────────
 * The pending-offer marker says "this session chose to CREATE an account".
 * That alone is not proof the account that came back is new: from the signup
 * form the user can switch to "Log in instead" and sign into an old account.
 * So the marker is combined with auth's own knowledge — `user.created_at` —
 * and an account is treated as new only if it was created no earlier than
 * the moment the marker was set (minus a clock-skew margin). Anything older
 * existed before this session and is never shown the new-user offer.
 *
 * Missing or unparseable `created_at` fails toward "existing": the user still
 * gets the Free plan and enters the app; only the offer is withheld.
 *
 * ── user_metadata is a preference store, nothing more ───────────────────────
 * `supabase.auth.updateUser({ data })` merges into auth.users.user_metadata,
 * which is the user's own, client-writable, unqueryable-without-a-join bag.
 * Right for preferences. Wrong for entitlements, balances or anything a
 * server decision trusts — none of that goes here.
 *
 * ── Failure never traps ─────────────────────────────────────────────────────
 * The write is best-effort. On failure the staged payload stays put and the
 * caller continues; on success the caller clears it. supabase is imported
 * lazily so this module can be loaded (and tested) without it.
 */
import { isExperienceLevel, isPainPoint, isPrimaryGoal, PAIN_POINTS } from "./onboardingQuiz";
import type { HuntCategory } from "./onboardingQuiz";
import type { StagedOnboardingAnswers } from "./onboarding-storage";

/** Device clock may run ahead of the server's. */
export const NEW_ACCOUNT_SKEW_MS = 15 * 60 * 1000;

export type AccountOrigin = "new" | "existing";

export function classifyAccount(userCreatedAt: string | null | undefined, stagedAt: number): AccountOrigin {
  if (!userCreatedAt) return "existing";
  const created = Date.parse(userCreatedAt);
  if (!Number.isFinite(created)) return "existing";
  return created >= stagedAt - NEW_ACCOUNT_SKEW_MS ? "new" : "existing";
}

/**
 * The namespaced shape written to user_metadata. snake_case, coded keys,
 * nothing derived.
 *
 * Version 2 drops `hunt_categories` (the question no longer exists) and
 * replaces `primary_pain_point` with `pain_points`. `updateUser` MERGES into
 * user_metadata, so a v1 record written by the earlier build keeps its old
 * fields alongside these; nothing reads them and nothing needs deleting.
 */
export interface OnboardingMetadata {
  schema_version: 2;
  primary_goal: StagedOnboardingAnswers["primaryGoal"];
  experience_level: StagedOnboardingAnswers["experienceLevel"];
  pain_points: StagedOnboardingAnswers["painPoints"];
  answered_at: string;
}

export const ONBOARDING_METADATA_KEY = "flipstart_onboarding";

export function toOnboardingMetadata(a: Pick<StagedOnboardingAnswers,
  "primaryGoal" | "experienceLevel" | "painPoints" | "answeredAt">): OnboardingMetadata {
  return {
    schema_version: 2,
    primary_goal: a.primaryGoal,
    experience_level: a.experienceLevel,
    pain_points: a.painPoints,
    answered_at: a.answeredAt,
  };
}

/**
 * Write the answers to the signed-in account. Resolves true only when
 * Supabase reported success. Never throws.
 */
export async function persistAnswersToAccount(
  a: Parameters<typeof toOnboardingMetadata>[0],
  timeoutMs = 6000,
): Promise<boolean> {
  try {
    const { supabase } = await import("@/lib/supabase");
    const write = supabase.auth.updateUser({ data: { [ONBOARDING_METADATA_KEY]: toOnboardingMetadata(a) } });
    const timeout = new Promise<{ error: { message: string } }>(resolve =>
      setTimeout(() => resolve({ error: { message: "timeout" } }), timeoutMs));
    const { error } = await Promise.race([write, timeout]);
    if (error) {
      if (__DEV__) console.warn("[onboarding] preference save failed (kept staged):", error.message);
      return false;
    }
    return true;
  } catch (e) {
    if (__DEV__) console.warn("[onboarding] preference save threw (kept staged):", (e as Error)?.message);
    return false;
  }
}

// ── Staged-answer migration ─────────────────────────────────────────────────

export function migrateStagedAnswers(p: unknown): StagedOnboardingAnswers | null {
  if (!p || typeof p !== "object") return null;
  const o = p as Record<string, unknown>;

  if (!isPrimaryGoal(o.primaryGoal) || !isExperienceLevel(o.experienceLevel)) return null;

  // Schema 2 carries an array; schema 1 carried a single value.
  const raw: unknown[] = Array.isArray(o.painPoints)
    ? o.painPoints
    : (o.primaryPainPoint !== undefined ? [o.primaryPainPoint] : []);
  const valid = raw.filter(isPainPoint);
  const painPoints = PAIN_POINTS.map(x => x.value).filter(v => valid.includes(v));
  if (painPoints.length === 0) return null;

  const out: StagedOnboardingAnswers = {
    schemaVersion: 2,
    primaryGoal: o.primaryGoal,
    experienceLevel: o.experienceLevel,
    painPoints,
    answeredAt: typeof o.answeredAt === "string" ? o.answeredAt : new Date(0).toISOString(),
    userId: typeof o.userId === "string" ? o.userId : null,
  };
  // Carried through untouched when present. Never fabricated when absent.
  if (Array.isArray(o.huntCategories)) {
    out.huntCategories = o.huntCategories.filter((c): c is HuntCategory => typeof c === "string") as HuntCategory[];
  }
  return out;
}
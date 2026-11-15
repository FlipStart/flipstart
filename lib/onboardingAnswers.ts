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
 * ── profiles.onboarding_answers is the queryable copy (V2) ───────────────────
 * user_metadata cannot be queried in bulk, so the same record is also written
 * to the user's own row in `profiles` — the founder dashboard segments on it
 * (source, goal, experience, help wanted → conversion, activation, retention).
 * It is the user's own row, written the same way Edit Profile writes
 * display_name; it carries preferences only, never anything a server trusts.
 *
 * ── Failure never traps ─────────────────────────────────────────────────────
 * Both writes are best-effort. Success means BOTH landed; otherwise the staged
 * payload stays put (so a retry can finish it) and the caller continues
 * regardless. supabase is imported lazily so this module can be loaded (and
 * tested) without it.
 */
import {
  cleanOtherSource, isAcquisitionSource, isExperienceLevel, isPainPoint, isPrimaryGoal, PAIN_POINTS,
} from "./onboardingQuiz";
import type { AcquisitionSource, HuntCategory } from "./onboardingQuiz";
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
 * The record written to BOTH user_metadata (under ONBOARDING_METADATA_KEY)
 * and profiles.onboarding_answers. snake_case, coded keys, nothing derived.
 *
 * Version 3 (V2 onboarding) adds `acquisition_source` — null when the answers
 * were staged by a build that never asked — and `acquisition_source_other`,
 * present only for "other" with text. `flow` says which onboarding produced it.
 * Version 2 dropped `hunt_categories` and replaced `primary_pain_point` with
 * `pain_points`. `updateUser` MERGES into user_metadata, so older fields
 * written by earlier builds stay alongside; nothing reads them.
 */
export interface OnboardingMetadata {
  schema_version: 3;
  flow: "v2";
  primary_goal: StagedOnboardingAnswers["primaryGoal"];
  experience_level: StagedOnboardingAnswers["experienceLevel"];
  pain_points: StagedOnboardingAnswers["painPoints"];
  acquisition_source: AcquisitionSource | null;
  acquisition_source_other?: string;
  answered_at: string;
}

export const ONBOARDING_METADATA_KEY = "flipstart_onboarding";

export type PersistableAnswers = Pick<StagedOnboardingAnswers,
  "primaryGoal" | "experienceLevel" | "painPoints" | "answeredAt" | "acquisitionSource" | "acquisitionSourceOther">;

export function toOnboardingMetadata(a: PersistableAnswers): OnboardingMetadata {
  const source = isAcquisitionSource(a.acquisitionSource) ? a.acquisitionSource : null;
  const other = source === "other" ? cleanOtherSource(a.acquisitionSourceOther) : "";
  const out: OnboardingMetadata = {
    schema_version: 3,
    flow: "v2",
    primary_goal: a.primaryGoal,
    experience_level: a.experienceLevel,
    pain_points: a.painPoints,
    acquisition_source: source,
    answered_at: a.answeredAt,
  };
  if (other) out.acquisition_source_other = other;
  return out;
}

function withTimeout<T>(p: PromiseLike<T>, ms: number, onTimeout: T): Promise<T> {
  return Promise.race([
    Promise.resolve(p),
    new Promise<T>(resolve => setTimeout(() => resolve(onTimeout), ms)),
  ]);
}

/**
 * Write the answers to the signed-in account: user_metadata and the user's
 * profiles row. Resolves true only when Supabase reported success for BOTH.
 * Never throws, never blocks longer than `timeoutMs` per write.
 */
export async function persistAnswersToAccount(a: PersistableAnswers, timeoutMs = 6000): Promise<boolean> {
  const record = toOnboardingMetadata(a);
  try {
    const { supabase } = await import("@/lib/supabase");

    const meta = await withTimeout(
      supabase.auth.updateUser({ data: { [ONBOARDING_METADATA_KEY]: record } }),
      timeoutMs, { error: { message: "timeout" } } as { error: { message: string } | null },
    );
    const metaOk = !meta.error;
    if (!metaOk && __DEV__) console.warn("[onboarding] metadata save failed (kept staged):", meta.error?.message);

    const profileOk = await persistAnswersToProfile(supabase, record, timeoutMs);
    return metaOk && profileOk;
  } catch (e) {
    if (__DEV__) console.warn("[onboarding] preference save threw (kept staged):", (e as Error)?.message);
    return false;
  }
}

/** Minimal surface of the Supabase client this module uses — keeps it testable. */
export interface ProfileWriter {
  auth: { getSession(): PromiseLike<{ data: { session: { user: { id: string } } | null } }> };
  from(table: "profiles"): {
    update(v: { onboarding_answers: OnboardingMetadata }): {
      eq(col: "id", id: string): { select(cols: "id"): PromiseLike<{ data: unknown[] | null; error: { message: string } | null }> };
    };
  };
}

/**
 * profiles.onboarding_answers for the signed-in user. True only when a row was
 * actually updated — an update that matched no row (profile not created yet)
 * is a failure, not a silent success.
 */
export async function persistAnswersToProfile(client: unknown, record: OnboardingMetadata, timeoutMs = 6000): Promise<boolean> {
  try {
    const db = client as ProfileWriter;
    const { data } = await db.auth.getSession();
    const uid = data.session?.user.id;
    if (!uid) return false;
    const res = await withTimeout(
      db.from("profiles").update({ onboarding_answers: record }).eq("id", uid).select("id"),
      timeoutMs, { data: null, error: { message: "timeout" } },
    );
    if (res.error || !res.data || res.data.length === 0) {
      if (__DEV__) console.warn("[onboarding] profile answers save failed (kept staged):", res.error?.message ?? "no row");
      return false;
    }
    return true;
  } catch (e) {
    if (__DEV__) console.warn("[onboarding] profile answers save threw (kept staged):", (e as Error)?.message);
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
    schemaVersion: 3,
    primaryGoal: o.primaryGoal,
    experienceLevel: o.experienceLevel,
    painPoints,
    // Absent from payloads staged before V2 — recorded as none, never guessed.
    acquisitionSource: isAcquisitionSource(o.acquisitionSource) ? o.acquisitionSource : null,
    answeredAt: typeof o.answeredAt === "string" ? o.answeredAt : new Date(0).toISOString(),
    userId: typeof o.userId === "string" ? o.userId : null,
  };
  const other = out.acquisitionSource === "other" ? cleanOtherSource(o.acquisitionSourceOther) : "";
  if (other) out.acquisitionSourceOther = other;
  // Carried through untouched when present. Never fabricated when absent.
  if (Array.isArray(o.huntCategories)) {
    out.huntCategories = o.huntCategories.filter((c): c is HuntCategory => typeof c === "string") as HuntCategory[];
  }
  return out;
}
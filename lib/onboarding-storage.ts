/**
 * lib/onboarding-storage.ts
 * Thin helpers for persisting onboarding state.
 * Uses AsyncStorage — already in package.json.
 *
 * VERSIONED ONBOARDING
 * ─────────────────────────────────────────────────────────────────────────────
 * Onboarding is gated by a version number, not just a boolean. Bumping
 * ONBOARDING_VERSION forces every user through onboarding ONE more time
 * (without wiping any scan history, Hunt progress, achievements, or profile data).
 *
 * Migration of the legacy `onboardingComplete: true` flag:
 *   - old flag true + no version stored  → treated as completed version 1
 *   - then 1 < ONBOARDING_VERSION (2)    → onboarding shows again once
 *   - finishing stores completedOnboardingVersion = ONBOARDING_VERSION
 *
 * To force testers through onboarding again in a future build, bump this number.
 *
 * NEW-USER FUNNEL (onboarding v3)
 * ─────────────────────────────────────────────────────────────────────────────
 * A brand-new account created FROM onboarding is not finished when auth
 * succeeds — it is finished when the user explicitly chooses Pro or the Free
 * plan on the final onboarding offer. So:
 *
 *   • Screen 10 stages the quiz answers and sets a PENDING OFFER marker before
 *     handing the user to the existing /auth screen.
 *   • completeOnboarding() — which every auth success path already calls — is
 *     a NO-OP while that marker exists. Auth then lands the user back on
 *     /onboarding (via authReturn, or the Home gate on a cold start), which
 *     resumes at the offer.
 *   • finishNewUserOnboarding() clears the marker and writes the version. Only
 *     the offer decision (Pro confirmed by the server, or Continue Free) calls
 *     it.
 *
 * The marker is never set by "Already have an account? Sign In", and it is
 * cleared whenever onboarding decides it does not apply (existing account,
 * different account, stale). None of this touches profiles.onboarding_complete,
 * which still means "username set up".
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ExperienceLevel, HuntCategory, PainPoint, PrimaryGoal } from './onboardingQuiz';

/**
 * Current onboarding version. Bump to force all users through onboarding once.
 *   1 — the pre-versioning onboarding
 *   2 — the four-step quiz
 *   3 — the full new-user journey: quiz, value screens, profile, account, Pro-or-Free offer
 */
export const ONBOARDING_VERSION = 3;

const KEY_COMPLETE   = 'onboardingComplete';        // legacy boolean (kept for back-compat)
const KEY_VERSION    = 'completedOnboardingVersion'; // new: highest onboarding version finished
const KEY_USER_MODE  = 'userMode';
const KEY_INTERESTS  = 'onboardingInterests';
/** Quiz answers staged before an account exists. Coded keys only. */
const KEY_STAGED     = '@flipstart/onboarding_staged_answers_v1';
/** Set ONLY when a user finished the quiz and chose to create a NEW account. */
const KEY_PENDING    = '@flipstart/onboarding_pending_offer_v1';
/** A marker older than this is abandoned, not pending. */
const PENDING_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export type UserMode = 'resell' | 'personal';

/**
 * Resolve the highest onboarding version this device has completed.
 * Handles the legacy boolean: if `onboardingComplete === 'true'` but no version
 * is stored, the user finished the pre-versioning onboarding → treat as version 1.
 * Returns 0 when onboarding has never been completed.
 */
export async function getCompletedOnboardingVersion(): Promise<number> {
  try {
    const [[, versionRaw], [, legacyRaw]] = await AsyncStorage.multiGet([KEY_VERSION, KEY_COMPLETE]);
    if (versionRaw != null) {
      const n = parseInt(versionRaw, 10);
      return Number.isFinite(n) ? n : 0;
    }
    // No version stored — migrate the legacy boolean.
    if (legacyRaw === 'true') return 1;
    return 0;
  } catch {
    return 0;
  }
}

/**
 * Whether onboarding should be shown. True when the completed version is behind
 * the current ONBOARDING_VERSION (covers never-onboarded, legacy v1 users, and
 * any future version bump).
 */
export async function needsOnboarding(): Promise<boolean> {
  const completed = await getCompletedOnboardingVersion();
  return completed < ONBOARDING_VERSION;
}

/**
 * Back-compat shim. Old callers asked "is onboarding complete?"; that now means
 * "is the device caught up to the current onboarding version?".
 */
export async function isOnboardingComplete(): Promise<boolean> {
  return !(await needsOnboarding());
}

/**
 * Mark onboarding finished for the CURRENT version. Writes both the new version
 * key and the legacy boolean (so anything still reading the old key stays happy).
 *
 * NO-OP while a new-user offer is pending: the auth success paths call this,
 * and for an account created from onboarding the funnel is not over yet. The
 * offer decision calls finishNewUserOnboarding() instead. See the header.
 *
 * `mode` is the legacy UserMode. Every caller passes 'resell'; nothing reads
 * it. It is NOT the quiz's primaryGoal and must not be derived from it.
 */
export async function completeOnboarding(mode: UserMode): Promise<void> {
  if (await readPendingNewUserOffer()) return;
  await writeCompletion(mode);
}

async function writeCompletion(mode: UserMode): Promise<void> {
  try {
    await AsyncStorage.multiSet([
      [KEY_VERSION,   String(ONBOARDING_VERSION)],
      [KEY_COMPLETE,  'true'],
      [KEY_USER_MODE, mode],
    ]);
  } catch {
    // fail silently — user still proceeds to home
  }
}

/**
 * The ONLY way to complete a new-user funnel: clears the pending marker, then
 * writes the version. Called after the server confirmed Pro, or after the
 * user chose the Free plan. Never on a store success alone.
 */
export async function finishNewUserOnboarding(mode: UserMode): Promise<void> {
  await clearPendingNewUserOffer();
  await writeCompletion(mode);
}

// ── Staged answers (pre-account) ────────────────────────────────────────────

/**
 * Schema 2 — the three-question model.
 *
 * Changes from schema 1: `primaryPainPoint` (one) became `painPoints` (many),
 * and `huntCategories` is no longer collected. The category field survives as
 * OPTIONAL so a payload written by the earlier v3 build still reads; nothing
 * writes it any more and no default is ever invented for it.
 */
export interface StagedOnboardingAnswers {
  schemaVersion: 2;
  primaryGoal:     PrimaryGoal;
  experienceLevel: ExperienceLevel;
  painPoints:      PainPoint[];
  /** Legacy, read-only. Absent for anyone onboarded after the question was removed. */
  huntCategories?: HuntCategory[];
  /** ISO timestamp. */
  answeredAt: string;
  /** Bound to the account the moment one exists. Null before that. */
  userId: string | null;
}

export async function stageOnboardingAnswers(
  a: Omit<StagedOnboardingAnswers, 'schemaVersion' | 'answeredAt' | 'userId' | 'huntCategories'>,
): Promise<void> {
  const payload: StagedOnboardingAnswers = {
    schemaVersion: 2, ...a, answeredAt: new Date().toISOString(), userId: null,
  };
  try { await AsyncStorage.setItem(KEY_STAGED, JSON.stringify(payload)); } catch {}
}

/**
 * Read the staged answers, migrating a schema-1 payload in memory.
 *
 * Tolerant on purpose: a real device may be holding a payload written by the
 * previous build, mid-funnel, with an account already created. Throwing it
 * away would strand that user, so a v1 record is upgraded (`primaryPainPoint`
 * → a one-item `painPoints`), unknown or malformed values are dropped rather
 * than trusted, and anything that cannot yield a usable answer set returns
 * null instead of a half-built object.
 *
 * The migration is NOT written back here. The value is returned to the caller,
 * and the next stage/persist writes schema 2 — a read never mutates storage.
 */
export async function readStagedAnswers(): Promise<StagedOnboardingAnswers | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY_STAGED);
    if (!raw) return null;
    const { migrateStagedAnswers } = await import('./onboardingAnswers');
    return migrateStagedAnswers(JSON.parse(raw));
  } catch { return null; }
}

export async function bindStagedAnswersToUser(userId: string): Promise<void> {
  const s = await readStagedAnswers();
  if (!s || s.userId === userId) return;
  try { await AsyncStorage.setItem(KEY_STAGED, JSON.stringify({ ...s, userId })); } catch {}
}

/** Only after a CONFIRMED metadata write, or when the answers belong to someone else. */
export async function clearStagedAnswers(): Promise<void> {
  try { await AsyncStorage.removeItem(KEY_STAGED); } catch {}
}

// ── Pending new-user offer ──────────────────────────────────────────────────

export interface PendingNewUserOffer {
  /** Epoch ms when the user chose to create an account. */
  stagedAt: number;
  /** Bound to the new account once it exists. Null before that. */
  userId: string | null;
}

/** Set by Screen 10's create-account action ONLY. Never by Sign In. */
export async function setPendingNewUserOffer(): Promise<void> {
  const p: PendingNewUserOffer = { stagedAt: Date.now(), userId: null };
  try { await AsyncStorage.setItem(KEY_PENDING, JSON.stringify(p)); } catch {}
}

export async function readPendingNewUserOffer(): Promise<PendingNewUserOffer | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY_PENDING);
    if (!raw) return null;
    const p = JSON.parse(raw) as PendingNewUserOffer;
    if (typeof p?.stagedAt !== 'number') { await clearPendingNewUserOffer(); return null; }
    // Abandoned, not pending. Without this, a marker could gate completion forever.
    if (Date.now() - p.stagedAt > PENDING_MAX_AGE_MS) { await clearPendingNewUserOffer(); return null; }
    return p;
  } catch { return null; }
}

export async function bindPendingOfferToUser(userId: string): Promise<void> {
  const p = await readPendingNewUserOffer();
  if (!p || p.userId === userId) return;
  try { await AsyncStorage.setItem(KEY_PENDING, JSON.stringify({ ...p, userId })); } catch {}
}

export async function clearPendingNewUserOffer(): Promise<void> {
  try { await AsyncStorage.removeItem(KEY_PENDING); } catch {}
}

export async function getUserMode(): Promise<UserMode | null> {
  try {
    const val = await AsyncStorage.getItem(KEY_USER_MODE);
    return (val as UserMode) ?? null;
  } catch {
    return null;
  }
}

export async function setUserMode(mode: UserMode): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_USER_MODE, mode);
  } catch {}
}

/** Onboarding interests — stored locally only (no server/personalization yet). */
export async function setOnboardingInterests(interests: string[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_INTERESTS, JSON.stringify(interests));
  } catch {}
}

export async function getOnboardingInterests(): Promise<string[]> {
  try {
    const val = await AsyncStorage.getItem(KEY_INTERESTS);
    return val ? (JSON.parse(val) as string[]) : [];
  } catch {
    return [];
  }
}

/**
 * Dev / settings helper — resets onboarding so it shows again on next launch.
 * Clears the version key AND the legacy boolean (so migration can't re-skip it),
 * plus the locally-stored interests. Does NOT touch scans, Hunt, achievements,
 * brands, diamonds, or profile data.
 */
export async function resetOnboarding(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([
      KEY_VERSION, KEY_COMPLETE, KEY_USER_MODE, KEY_INTERESTS,
      KEY_STAGED, KEY_PENDING,
    ]);
  } catch {}
}
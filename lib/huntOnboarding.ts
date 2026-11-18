/**
 * lib/huntOnboarding.ts
 *
 * State for the first-time Hunt Mode onboarding: what the user has done with it,
 * and from that, whether to invite them and whether to show the attention dots.
 *
 * ── Statuses ────────────────────────────────────────────────────────────────
 *   never_offered  Nothing yet. (No stored record also means this.)
 *   skipped        "Not right now." Skip WITHOUT "Do not show this again", or
 *                  leaving the demo early. The invitation comes back.
 *   completed      Finished the demo. No automatic invitation again.
 *   dismissed      Skip WITH "Do not show this again". No automatic invitation.
 *   grandfathered  Already a real Hunt user when this shipped (or on a new
 *                  device). Treated as having learned it: no invitation, no dots.
 *
 * Only never_offered and skipped are UNRESOLVED. The automatic invitation and the
 * attention dots exist only while unresolved. Resolved states never remove the
 * manual "How Hunt Mode Works" replay; replaying does not change a resolved status.
 *
 * ── Per account ─────────────────────────────────────────────────────────────
 * Stored at `flipstart_hunt_onboarding_v1:<uid>`, like the active Hunt and XP,
 * so one account never inherits another's state. This is deliberately separate
 * from the app onboarding (lib/onboarding-storage.ts, ONBOARDING_VERSION).
 *
 * ── Existing Hunt users ─────────────────────────────────────────────────────
 * Anyone who has completed a real Hunt is grandfathered silently. The check does
 * not depend on the login-time XP sync having finished: it reads the local XP
 * profile, the locally saved flips (for a saved Hunt), and, only when both say
 * "no Hunts", the cloud XP profile once per session. Until that check has an
 * answer for an unresolved account the state is NOT ready, so a veteran never
 * sees a flash of the dot or the invitation.
 *
 * Nothing here touches XP, scans, history, the leaderboard or analytics.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export type HuntOnboardingStatus =
  | 'never_offered' | 'skipped' | 'completed' | 'dismissed' | 'grandfathered';

export interface HuntOnboardingState {
  v: 1;
  status: HuntOnboardingStatus;
  /** Times the welcome has been shown. Drives how long the dots keep pulsing. */
  offerCount: number;
  /** Times the user chose "not right now". */
  skipCount: number;
  updatedAt: number;
}

/**
 * THE ONE SWITCH for Hunt onboarding. While false the whole feature is inert: no dots, no
 * automatic welcome, no replay button, and the guided demo refuses to start. True turns all of it
 * on for everyone (new accounts get the invitation; accounts that already use Hunt Mode are
 * grandfathered and only see the replay button). Nothing else needs flipping.
 */
export const HUNT_ONBOARDING_LIVE = true;
let _live = HUNT_ONBOARDING_LIVE;
export const isHuntOnboardingLive = (): boolean => _live;
export function __setHuntOnboardingLiveForTests(v: boolean): void { _live = v; }

export const HUNT_ONBOARDING_KEY = (uid: string) => `flipstart_hunt_onboarding_v1:${uid}`;

/** The dots pulse for this many offers, then stay as a quiet static dot. */
export const PULSE_OFFER_LIMIT = 3;

const STATUSES: readonly HuntOnboardingStatus[] =
  ['never_offered', 'skipped', 'completed', 'dismissed', 'grandfathered'];

export const isUnresolved = (s: HuntOnboardingStatus): boolean =>
  s === 'never_offered' || s === 'skipped';

export const defaultOnboardingState = (): HuntOnboardingState =>
  ({ v: 1, status: 'never_offered', offerCount: 0, skipCount: 0, updatedAt: 0 });

/** Tolerant parse: anything unreadable or unknown is "never offered", never a crash. */
export function parseOnboardingState(raw: string | null | undefined): HuntOnboardingState {
  if (!raw) return defaultOnboardingState();
  try {
    const p = JSON.parse(raw) as Partial<HuntOnboardingState>;
    const status = STATUSES.includes(p?.status as HuntOnboardingStatus)
      ? (p!.status as HuntOnboardingStatus) : 'never_offered';
    const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.floor(x) : 0);
    return { v: 1, status, offerCount: n(p?.offerCount), skipCount: n(p?.skipCount), updatedAt: n(p?.updatedAt) };
  } catch {
    return defaultOnboardingState();
  }
}

// ─── Derived behaviour (pure) ────────────────────────────────────────────────

export type AttentionMode = 'off' | 'static' | 'pulse';

/** What the dots do. Off until the state is ready and the account is unresolved. */
export function attentionFor(state: HuntOnboardingState, ready: boolean): AttentionMode {
  if (!ready || !isUnresolved(state.status)) return 'off';
  return state.offerCount < PULSE_OFFER_LIMIT ? 'pulse' : 'static';
}

/** Whether entering Hunt Mode should open the welcome invitation. */
export function shouldAutoOffer(state: HuntOnboardingState, ready: boolean): boolean {
  return ready && isUnresolved(state.status);
}

// ─── Existing-user detection ─────────────────────────────────────────────────

export type Experience = 'new' | 'experienced';

export interface ExperienceDeps {
  /** completedHunts from this device's XP profile for the account. */
  localCompletedHunts(uid: string): Promise<number>;
  /** Whether this device's saved flips for the account include a saved Hunt. */
  localHasSavedHunt(uid: string): Promise<boolean>;
  /** completedHunts from the cloud XP profile, or null if there is none / it failed. */
  cloudCompletedHunts(uid: string): Promise<number | null>;
}

const defaultExperienceDeps: ExperienceDeps = {
  async localCompletedHunts(uid) {
    const { loadXpProfile } = await import('./huntXp');
    return (await loadXpProfile(uid)).completedHunts ?? 0;
  },
  async localHasSavedHunt(uid) {
    const { SAVED_FLIPS_KEY } = await import('./hunt-context');
    const raw = await AsyncStorage.getItem(SAVED_FLIPS_KEY(uid));
    // Substring test: the saved-flips blob can be large and is not worth parsing.
    return !!raw && raw.includes('"hunt_bundle"');
  },
  async cloudCompletedHunts(uid) {
    const { fetchXpProfile } = await import('./xpSync');
    const p = await fetchXpProfile(uid);
    return p ? (p.completedHunts ?? 0) : null;
  },
};

let _deps: ExperienceDeps = defaultExperienceDeps;
export function __setExperienceDepsForTests(d: ExperienceDeps | null): void {
  _deps = d ?? defaultExperienceDeps;
}

/**
 * Has this account already completed a real Hunt? The cloud is asked only when
 * nothing local says so, so most accounts never make the network call.
 * A failed lookup counts as "new": the cost of a veteran seeing the invitation
 * once (they can dismiss it) is far smaller than a new user never seeing it.
 */
export async function resolveExperience(uid: string): Promise<Experience> {
  try { if ((await _deps.localCompletedHunts(uid)) >= 1) return 'experienced'; } catch { /* next signal */ }
  try { if (await _deps.localHasSavedHunt(uid)) return 'experienced'; } catch { /* next signal */ }
  try { if (((await _deps.cloudCompletedHunts(uid)) ?? 0) >= 1) return 'experienced'; } catch { /* new */ }
  return 'new';
}

// ─── Store ───────────────────────────────────────────────────────────────────

export interface HuntOnboardingSnapshot {
  /** The state has loaded AND, for an unresolved account, the experience check has answered. */
  ready: boolean;
  state: HuntOnboardingState;
  attention: AttentionMode;
  autoOffer: boolean;
}

interface Entry {
  state: HuntOnboardingState | null;
  experience: Experience | null;
  loading: Promise<void> | null;
  snap: HuntOnboardingSnapshot;
}

const SIGNED_OUT: HuntOnboardingSnapshot = {
  ready: false, state: defaultOnboardingState(), attention: 'off', autoOffer: false,
};

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();

function entryFor(uid: string): Entry {
  let e = entries.get(uid);
  if (!e) { e = { state: null, experience: null, loading: null, snap: SIGNED_OUT }; entries.set(uid, e); }
  return e;
}

function rebuild(e: Entry): void {
  const state = e.state ?? defaultOnboardingState();
  const ready = e.state !== null && (!isUnresolved(state.status) || e.experience === 'new');
  e.snap = {
    ready, state,
    attention: _live ? attentionFor(state, ready) : 'off',
    autoOffer: _live && shouldAutoOffer(state, ready),
  };
}

function emit(): void {
  listeners.forEach(fn => { try { fn(); } catch { /* a listener never breaks the store */ } });
}

export function subscribeHuntOnboarding(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Stable reference until something changes (required by useSyncExternalStore). */
export function getHuntOnboardingSnapshot(uid: string | null): HuntOnboardingSnapshot {
  return uid ? entryFor(uid).snap : SIGNED_OUT;
}

async function readState(uid: string): Promise<HuntOnboardingState> {
  try { return parseOnboardingState(await AsyncStorage.getItem(HUNT_ONBOARDING_KEY(uid))); }
  catch { return defaultOnboardingState(); }
}

async function commit(uid: string, next: HuntOnboardingState): Promise<void> {
  const e = entryFor(uid);
  e.state = next;
  rebuild(e);
  emit();
  try { await AsyncStorage.setItem(HUNT_ONBOARDING_KEY(uid), JSON.stringify(next)); }
  catch { /* memory is right for this session; worst case the next launch re-offers */ }
}

async function current(uid: string): Promise<HuntOnboardingState> {
  const e = entryFor(uid);
  if (e.state) return e.state;
  const s = await readState(uid);
  if (!e.state) { e.state = s; rebuild(e); }
  return e.state;
}

/**
 * Load this account's state and, if it is still unresolved, find out whether it
 * is a returning Hunt user. Safe to call from many places: one run per account
 * per session, shared by every caller.
 */
export function ensureHuntOnboardingLoaded(uid: string): Promise<void> {
  const e = entryFor(uid);
  if (e.loading) return e.loading;
  e.loading = (async () => {
    const state = await current(uid);
    if (isUnresolved(state.status) && e.experience === null) {
      const exp = await resolveExperience(uid);
      e.experience = exp;
      if (exp === 'experienced') { await markHuntOnboardingGrandfathered(uid); return; }
    }
    rebuild(e);
    emit();
  })().catch(() => { e.loading = null; });
  return e.loading;
}

// ─── Actions ─────────────────────────────────────────────────────────────────
// Each updates memory first (so the dots react immediately) and then persists.

/** The welcome was shown. Counts only while unresolved. */
export async function recordHuntOnboardingOffered(uid: string): Promise<void> {
  const s = await current(uid);
  if (!isUnresolved(s.status)) return;
  await commit(uid, { ...s, offerCount: s.offerCount + 1, updatedAt: Date.now() });
}

/** "Not right now": Skip without the checkbox, or leaving the demo early. */
export async function markHuntOnboardingSkipped(uid: string): Promise<void> {
  const s = await current(uid);
  // Leaving a replay must never un-complete or un-dismiss anything.
  if (!isUnresolved(s.status)) return;
  await commit(uid, { ...s, status: 'skipped', skipCount: s.skipCount + 1, updatedAt: Date.now() });
}

/** Skip with "Do not show this again". Stops the automatic invitation for good. */
export async function markHuntOnboardingDismissed(uid: string): Promise<void> {
  const s = await current(uid);
  await commit(uid, { ...s, status: 'dismissed', updatedAt: Date.now() });
}

/**
 * The welcome's Skip button. With "Do not show this again" checked it dismisses
 * for good; without it, it is only "not right now" and the invitation returns.
 */
export async function skipHuntOnboardingWelcome(uid: string, doNotShowAgain: boolean): Promise<void> {
  if (doNotShowAgain) await markHuntOnboardingDismissed(uid);
  else await markHuntOnboardingSkipped(uid);
}

/**
 * DEVELOPER TOOL. Forget this account's onboarding state, as if it had never opened Hunt
 * Mode, so the welcome and the dots come back for testing. It also forgets that the account
 * is an experienced Hunt user. Does nothing in a release build.
 */
export async function devResetHuntOnboarding(uid: string): Promise<boolean> {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return false;
  const e = entryFor(uid);
  e.experience = 'new';
  await commit(uid, defaultOnboardingState());
  return true;
}

/** Finished the demo (first run or a replay). */
export async function markHuntOnboardingCompleted(uid: string): Promise<void> {
  const s = await current(uid);
  await commit(uid, { ...s, status: 'completed', updatedAt: Date.now() });
}

/** Already a Hunt user. Never overrides a status the user chose. */
export async function markHuntOnboardingGrandfathered(uid: string): Promise<void> {
  const s = await current(uid);
  if (!isUnresolved(s.status)) return;
  await commit(uid, { ...s, status: 'grandfathered', updatedAt: Date.now() });
}

export function __resetHuntOnboardingForTests(): void {
  entries.clear(); listeners.clear(); _deps = defaultExperienceDeps; _live = HUNT_ONBOARDING_LIVE;
}
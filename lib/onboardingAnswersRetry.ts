/**
 * lib/onboardingAnswersRetry.ts
 *
 * Finishes a quiz-answers save that did not land the first time.
 *
 * The save at the end of onboarding is best-effort on purpose: a bad
 * connection must never trap a new user on the offer. When it fails, the
 * answers stay staged on the phone (lib/onboarding-storage.ts) and the user
 * carries on. Before this file nothing ever came back for them, so a failed
 * save was a permanent hole in the dashboard's cohort data, and it fails
 * most for the users on the worst connections.
 *
 * `retryStagedAnswers(userId)` runs once per launch per account, shortly
 * after sign-in is known. It writes ONLY when all of these hold:
 *   - no signup funnel is in progress (the onboarding screen owns the stage
 *     while the pending-offer marker exists; two writers would race)
 *   - the staged payload is bound to THIS account. An unbound payload belongs
 *     to a quiz that was never finished and is left alone; one bound to
 *     someone else is deleted unread, never applied.
 *   - it is not older than 30 days (stale, and likely not worth the write)
 *   - the backoff window has passed (5 min doubling to 24 h), so a user with
 *     a flaky connection is not hit on every launch
 *
 * On success the staged copy and the backoff record are cleared. On failure
 * the attempt is recorded and the staged copy stays. Never throws, never
 * blocks anything: it is called fire-and-forget from the root layout.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  clearStagedAnswers, readPendingNewUserOffer, readStagedAnswers,
  type StagedOnboardingAnswers,
} from './onboarding-storage';
import { persistAnswersToAccount, type PersistableAnswers } from './onboardingAnswers';

export const RETRY_KEY = '@flipstart/onboarding_answers_retry_v1';
export const RETRY_BASE_MS = 5 * 60 * 1000;
export const RETRY_MAX_MS = 24 * 60 * 60 * 1000;
export const STAGED_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export type RetryResult =
  | 'busy' | 'funnel_active' | 'nothing' | 'unbound' | 'other_account'
  | 'expired' | 'backoff' | 'synced' | 'failed';

interface RetryRecord { attempts: number; lastAt: number }

/** Wait before the next attempt after `attempts` failures. 5 min, 10, 20 ... capped at 24 h. */
export function retryDelayMs(attempts: number): number {
  const n = Math.max(0, Math.floor(attempts));
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * Math.pow(2, Math.min(n, 20)));
}

export interface RetryDeps {
  now: () => number;
  readPending: () => Promise<unknown | null>;
  readStaged: () => Promise<StagedOnboardingAnswers | null>;
  clearStaged: () => Promise<void>;
  persist: (a: PersistableAnswers) => Promise<boolean>;
  getRecord: () => Promise<RetryRecord | null>;
  setRecord: (r: RetryRecord | null) => Promise<void>;
  track: (name: string, props: Record<string, unknown>) => void;
}

async function getRecord(): Promise<RetryRecord | null> {
  try {
    const raw = await AsyncStorage.getItem(RETRY_KEY);
    if (!raw) return null;
    const r = JSON.parse(raw) as RetryRecord;
    if (typeof r?.attempts !== 'number' || typeof r?.lastAt !== 'number') return null;
    return r;
  } catch { return null; }
}

async function setRecord(r: RetryRecord | null): Promise<void> {
  try {
    if (r) await AsyncStorage.setItem(RETRY_KEY, JSON.stringify(r));
    else await AsyncStorage.removeItem(RETRY_KEY);
  } catch {}
}

function defaultDeps(): RetryDeps {
  return {
    now: () => Date.now(),
    readPending: readPendingNewUserOffer,
    readStaged: readStagedAnswers,
    clearStaged: clearStagedAnswers,
    persist: a => persistAnswersToAccount(a, 8000),
    getRecord,
    setRecord,
    track: (name, props) => {
      import('./analytics').then(m => m.trackAnalyticsEvent(name, props)).catch(() => {});
    },
  };
}

let inFlight = false;

export async function retryStagedAnswers(userId: string, overrides?: Partial<RetryDeps>): Promise<RetryResult> {
  if (inFlight) return 'busy';
  inFlight = true;
  try {
    const d = { ...defaultDeps(), ...overrides };
    if (!userId) return 'nothing';

    if (await d.readPending()) return 'funnel_active';

    const staged = await d.readStaged();
    if (!staged) { await d.setRecord(null); return 'nothing'; }

    if (!staged.userId) return 'unbound';
    if (staged.userId !== userId) {
      await d.clearStaged();
      await d.setRecord(null);
      return 'other_account';
    }

    const answeredMs = Date.parse(staged.answeredAt);
    if (Number.isFinite(answeredMs) && answeredMs > 0 && d.now() - answeredMs > STAGED_MAX_AGE_MS) {
      await d.clearStaged();
      await d.setRecord(null);
      return 'expired';
    }

    const rec = await d.getRecord();
    if (rec && d.now() - rec.lastAt < retryDelayMs(rec.attempts)) return 'backoff';

    const ok = await d.persist({
      primaryGoal: staged.primaryGoal,
      experienceLevel: staged.experienceLevel,
      painPoints: staged.painPoints,
      acquisitionSource: staged.acquisitionSource,
      acquisitionSourceOther: staged.acquisitionSourceOther,
      answeredAt: staged.answeredAt,
    });
    const attempts = (rec?.attempts ?? 0) + 1;
    if (ok) {
      await d.clearStaged();
      await d.setRecord(null);
      d.track('onboarding_answers_synced_late', { attempts, flow: 'v2' });
      return 'synced';
    }
    await d.setRecord({ attempts, lastAt: d.now() });
    return 'failed';
  } catch {
    return 'failed';
  } finally {
    inFlight = false;
  }
}
/**
 * lib/useHuntOnboarding.ts
 *
 * React access to the Hunt onboarding state (see lib/huntOnboarding.ts).
 * Every screen that shows a dot or opens the welcome uses this one hook, so they
 * all agree and the existing-user check runs once.
 *
 * Signed-out users get attention 'off' and autoOffer false: Hunt Mode needs an
 * account, and there is no per-account state to read.
 */
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { useAuth } from '@/lib/auth-context';
import {
  ensureHuntOnboardingLoaded, getHuntOnboardingSnapshot, subscribeHuntOnboarding,
  recordHuntOnboardingOffered, markHuntOnboardingSkipped, markHuntOnboardingDismissed,
  markHuntOnboardingCompleted, skipHuntOnboardingWelcome, isHuntOnboardingLive,
  type HuntOnboardingSnapshot,
} from '@/lib/huntOnboarding';

export function useHuntOnboarding() {
  const { user } = useAuth();
  const uid = user?.id ?? null;

  useEffect(() => { if (uid) void ensureHuntOnboardingLoaded(uid); }, [uid]);

  const snap: HuntOnboardingSnapshot = useSyncExternalStore(
    subscribeHuntOnboarding,
    () => getHuntOnboardingSnapshot(uid),
    () => getHuntOnboardingSnapshot(uid),
  );

  const recordOffered = useCallback(() => (uid ? recordHuntOnboardingOffered(uid) : Promise.resolve()), [uid]);
  const markSkipped   = useCallback(() => (uid ? markHuntOnboardingSkipped(uid)   : Promise.resolve()), [uid]);
  const markDismissed = useCallback(() => (uid ? markHuntOnboardingDismissed(uid) : Promise.resolve()), [uid]);
  const markCompleted = useCallback(() => (uid ? markHuntOnboardingCompleted(uid) : Promise.resolve()), [uid]);
  const skipWelcome   = useCallback((doNotShowAgain: boolean) => (uid ? skipHuntOnboardingWelcome(uid, doNotShowAgain) : Promise.resolve()), [uid]);

  return useMemo(() => ({
    /** The master switch (lib/huntOnboarding HUNT_ONBOARDING_LIVE). Off hides every surface. */
    live: isHuntOnboardingLive(),
    ready: snap.ready,
    status: snap.state.status,
    offerCount: snap.state.offerCount,
    /** 'off' | 'static' | 'pulse' — what the Hunt dots should do right now. */
    attention: snap.attention,
    /** True when entering Hunt Mode should open the welcome invitation. */
    autoOffer: snap.autoOffer,
    recordOffered, markSkipped, markDismissed, markCompleted, skipWelcome,
  }), [snap, recordOffered, markSkipped, markDismissed, markCompleted, skipWelcome]);
}
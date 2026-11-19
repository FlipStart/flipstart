/**
 * components/notifications/NotificationsHost.tsx
 *
 * Mounted once, inside the providers. Draws nothing. Two jobs:
 *
 *   1. Keep the local reminders in step with the hunter's progress. They are
 *      re-planned when the app opens and again when it goes to the background,
 *      so they always count from the last time FlipStart was used and always
 *      quote current numbers. Signed out: they are cleared.
 *   2. Open the right screen when a reminder is tapped.
 *
 * Everything is fail-safe; a notification problem never affects the app.
 */
import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useRouter } from 'expo-router';

import { useAuth } from '@/lib/auth-context';
import { useFlipStore } from '@/lib/useFlipStore';
import { loadXpProfile } from '@/lib/huntXp';
import { getActiveHunt, isHuntActive, keptItemsOf } from '@/lib/hunt-context';
import { isHuntDemoActive } from '@/lib/huntDemoMode';
import { computeDiscoveredBrands, TOTAL_SUPPORTED_BRANDS } from '@/lib/brandCompendium';
import { getNextRank } from '@shared/hunt/ranks';
import { logEvent } from '@/lib/analytics';
import { safeNudgeRoute, type NudgeState } from '@/lib/notificationPlan';
import { cancelNudges, consumeLaunchTap, onNudgeTap, syncNudges, type NudgeTap } from '@/lib/notifications';

/** Lets the first screen settle before a tapped reminder navigates (cold start). */
const LAUNCH_ROUTE_DELAY_MS = 1200;

export function NotificationsHost() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { flips, isLoaded } = useFlipStore();
  const uid = user?.id ?? null;

  const flipsRef = useRef(flips);
  flipsRef.current = flips;

  // ── 1. Reminders ────────────────────────────────────────────────────────────
  const sync = useCallback(async () => {
    try {
      if (!uid) { await cancelNudges(); return; }
      if (isHuntDemoActive()) return;
      const xp = await loadXpProfile(uid);
      const next = getNextRank(xp.totalXp);
      const hunt = isHuntActive() ? getActiveHunt() : null;
      const state: NudgeState = {
        completedHunts: xp.completedHunts,
        totalXp: xp.totalXp,
        nextRank: next ? { name: next.rank, xp: next.xp } : null,
        brandsUnlocked: computeDiscoveredBrands(flipsRef.current, xp.discoveredBrands ?? []).size,
        brandsTotal: TOTAL_SUPPORTED_BRANDS,
        openHunt: hunt ? { keptCount: keptItemsOf(hunt).length } : null,
      };
      await syncNudges(state);
    } catch { /* reminders are a nicety */ }
  }, [uid]);

  useEffect(() => {
    if (authLoading || (uid && !isLoaded)) return;
    void sync();
    const sub = AppState.addEventListener('change', s => {
      // Leaving the app is the moment that matters: the reminders count from here.
      if (s === 'background' || s === 'active') void sync();
    });
    return () => sub.remove();
  }, [authLoading, uid, isLoaded, sync]);

  // ── 2. Taps ─────────────────────────────────────────────────────────────────
  const handled = useRef<Set<string>>(new Set());
  const open = useCallback((tap: NudgeTap, delayMs: number) => {
    if (handled.current.has(tap.id)) return;
    handled.current.add(tap.id);
    const route = safeNudgeRoute(tap.route);
    try { logEvent('notification_opened', { kind: tap.kind, route: route ?? 'home' }); } catch { /* never blocks */ }
    if (!route) return;                                   // unknown route: the app just opens
    setTimeout(() => {
      try { router.push(route as any); } catch { /* stays where it is */ }
    }, delayMs);
  }, [router]);

  useEffect(() => {
    let alive = true;
    let off: () => void = () => {};
    void consumeLaunchTap().then(tap => { if (alive && tap) open(tap, LAUNCH_ROUTE_DELAY_MS); });
    void onNudgeTap(tap => open(tap, 300)).then(unsub => { if (alive) off = unsub; else unsub(); });
    return () => { alive = false; off(); };
  }, [open]);

  return null;
}
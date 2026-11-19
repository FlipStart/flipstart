/**
 * components/achievements/CelebrationHost.tsx
 *
 * Mounted once, inside the providers. Shows the full-screen achievement
 * celebrations queued by lib/achievementCelebrations, one at a time:
 * the first scan ("Finally Flipping"), a weekly Hunt streak, a top-3 or #1
 * weekly finish, 250 Hunts.
 *
 * Only on the main tabs. A celebration earned somewhere else (in a Hunt, on a
 * result) waits until the user is back on a tab, so it never covers a scan, a
 * Hunt, a paywall or the guided demo.
 *
 * It also tells lib/achievementStats which account is signed in.
 */
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'expo-router';

import { useAuth } from '@/lib/auth-context';
import { isHuntDemoActive } from '@/lib/huntDemoMode';
import { logEvent } from '@/lib/analytics';
import { MajorAchievementModal } from '@/lib/MajorAchievementModal';
import { setAchievementUser } from '@/lib/achievementStats';
import {
  clearCelebrations, currentCelebration, finishCelebration, hasPendingCelebration, subscribeCelebrations,
  type Celebration,
} from '@/lib/achievementCelebrations';

/** The screens a celebration may appear on. */
const TAB_PATHS = new Set(['/', '/history', '/progress', '/settings', '/profile', '/hunt-tab']);
/** Lets the screen finish arriving before the celebration covers it. */
const SETTLE_MS = 700;

export function CelebrationHost() {
  const { user } = useAuth();
  const pathname = usePathname();
  const uid = user?.id ?? null;

  // Signed out of an account, or switched: nothing queued for it may play for
  // anyone else. (Guest to account keeps the queue: a guest's first scan becomes
  // the new account's, so its celebration still belongs to them.)
  const lastUid = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (lastUid.current != null && lastUid.current !== uid) clearCelebrations();
    lastUid.current = uid;
    setAchievementUser(uid);
  }, [uid]);

  const [current, setCurrent] = useState<Celebration | null>(currentCelebration());
  useEffect(() => subscribeCelebrations(() => setCurrent(currentCelebration())), []);

  const onTab = TAB_PATHS.has(pathname ?? '');
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    setSettled(false);
    if (!onTab || !current) return;
    const t = setTimeout(() => setSettled(true), SETTLE_MS);
    return () => clearTimeout(t);
  }, [onTab, current?.key]);

  const show = !!current && onTab && settled && !isHuntDemoActive();

  useEffect(() => {
    if (show && current) {
      try { logEvent('achievement_celebration_shown', { celebration: current.key }); } catch { /* never blocks */ }
    }
  }, [show, current?.key]);

  if (!current || !show) return null;

  const onContinue = () => {
    const key = current.key;
    void finishCelebration(key).then(() => {
      // The notifications popup waits for celebrations. If this was the last
      // one, give it its turn now (it shows only if it is actually due).
      if (hasPendingCelebration()) return;
      setTimeout(() => {
        void import('@/lib/notifications').then(m => m.askForNotificationsIfDue()).catch(() => {});
      }, 600);
    });
  };

  return (
    <MajorAchievementModal
      key={current.key}
      type={current.type}
      text={current.text}
      visible
      onContinue={onContinue}
    />
  );
}
/**
 * lib/notifications.ts
 *
 * Notifications: the permission popup and the local reminders.
 *
 * ── What this is ──────────────────────────────────────────────────────────────
 * LOCAL notifications only. The phone schedules them itself; there is no push
 * server, no device token and nothing sent to FlipStart's backend. What gets
 * scheduled is decided in lib/notificationPlan.ts.
 *
 * ── When the popup appears ────────────────────────────────────────────────────
 * Once, after the first scan the user has decided on (saved or not), the moment
 * they are back on a stable screen. iOS shows its permission popup only once
 * per install, so it is never asked earlier (before the app has shown what it
 * does) and never during a scan, a paywall or the guided Hunt demo.
 *
 * ── Safety ────────────────────────────────────────────────────────────────────
 * expo-notifications is loaded lazily, inside try/catch, never at module level
 * (the same rule as lib/supabase.ts: a native module imported at startup has
 * crashed standalone builds before). Every function here is fail-safe: if the
 * module is missing or throws, notifications quietly do nothing.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { logEvent } from '@/lib/analytics';
import { isHuntDemoActive } from '@/lib/huntDemoMode';
import {
  NUDGE_ID_PREFIX, planNudges, type NudgeState, type PlannedNudge,
} from '@/lib/notificationPlan';

const KEY = '@flipstart/notifications:v1';

interface Stored {
  /** A just-finished scan has been saved or passed on at least once on this install. */
  scanDecided: boolean;
  /** When the iOS popup was shown (it can only be shown once). */
  askedAt: number | null;
}
const DEFAULT: Stored = { scanDecided: false, askedAt: null };

async function load(): Promise<Stored> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const p = raw ? JSON.parse(raw) : null;
    return {
      scanDecided: p?.scanDecided === true,
      askedAt: typeof p?.askedAt === 'number' ? p.askedAt : null,
    };
  } catch { return { ...DEFAULT }; }
}
async function save(s: Stored): Promise<void> {
  try { await AsyncStorage.setItem(KEY, JSON.stringify(s)); } catch { /* asked again later at worst */ }
}

// ─── The native module, loaded only when needed ───────────────────────────────

type Native = typeof import('expo-notifications');
let nativeOverride: Native | null | undefined;
/** Tests only: stand in for expo-notifications (null = "not available"). */
export function __setNotificationsNativeForTests(n: unknown): void { nativeOverride = n as Native | null | undefined; }

async function native(): Promise<Native | null> {
  if (nativeOverride !== undefined) return nativeOverride;
  try {
    const mod: any = await import('expo-notifications');
    return typeof mod?.getPermissionsAsync === 'function' ? (mod as Native) : null;
  } catch { return null; }
}

// ─── Permission ───────────────────────────────────────────────────────────────

export type NotificationPermission = 'granted' | 'denied' | 'undetermined' | 'unavailable';

function readPermission(p: any): NotificationPermission {
  if (!p) return 'unavailable';
  // iOS "provisional" and "ephemeral" both deliver notifications.
  const ios = p.ios?.status;
  if (p.granted === true || p.status === 'granted' || ios === 2 || ios === 3 || ios === 4) return 'granted';
  if (p.status === 'undetermined' || (p.status !== 'denied' && p.canAskAgain !== false && ios === 0)) return 'undetermined';
  return 'denied';
}

export async function getNotificationPermission(): Promise<NotificationPermission> {
  const n = await native();
  if (!n) return 'unavailable';
  try { return readPermission(await n.getPermissionsAsync()); } catch { return 'unavailable'; }
}

/** Show the iOS popup now. `source` is only for analytics. */
export async function requestNotificationPermission(source: 'first_scan' | 'settings'): Promise<NotificationPermission> {
  const n = await native();
  if (!n) return 'unavailable';
  try {
    const before = readPermission(await n.getPermissionsAsync());
    if (before !== 'undetermined') return before;
    // Burned BEFORE the call: iOS shows this popup once. If the app dies mid-call,
    // "already asked" is still the right answer.
    const s = await load();
    await save({ ...s, askedAt: Date.now() });
    try { logEvent('notification_permission_prompted', { source }); } catch { /* never blocks */ }
    const after = readPermission(await n.requestPermissionsAsync({
      ios: { allowAlert: true, allowSound: true, allowBadge: false },
    }));
    try { logEvent('notification_permission_answered', { source, granted: after === 'granted' }); } catch { /* never blocks */ }
    return after;
  } catch { return 'unavailable'; }
}

// ─── The first-scan moment ────────────────────────────────────────────────────

/**
 * A just-finished scan was saved or passed on. Called when the result screen is
 * left (normal scans) and on Save / Skip (Hunt finds). Idempotent.
 */
export async function markScanDecided(): Promise<void> {
  if (isHuntDemoActive()) return;                 // the guided demo's finds are not real scans
  const s = await load();
  if (s.scanDecided) return;
  await save({ ...s, scanDecided: true });
}

let asking = false;
/**
 * Show the popup if this is the moment for it: a scan has been decided, the
 * popup has never been shown, and iOS has not been answered some other way.
 * Call it from a stable screen (Home, Live Hunt). Returns true when the popup
 * was shown. Safe to call on every focus.
 */
export async function askForNotificationsIfDue(): Promise<boolean> {
  if (asking || isHuntDemoActive()) return false;
  asking = true;
  try {
    // A full-screen achievement celebration goes first (the first scan earns one).
    // The celebration host calls this again once the last one is dismissed.
    try {
      const { hasPendingCelebration } = await import('@/lib/achievementCelebrations');
      if (hasPendingCelebration()) return false;
    } catch { /* no celebrations module: ask as before */ }
    const s = await load();
    if (!s.scanDecided || s.askedAt != null) return false;
    const perm = await getNotificationPermission();
    if (perm !== 'undetermined') {
      // Answered already (an earlier install, or Settings): never show it.
      if (perm !== 'unavailable') await save({ ...s, askedAt: Date.now() });
      return false;
    }
    await requestNotificationPermission('first_scan');
    return true;
  } catch { return false; }
  finally { asking = false; }
}

// ─── Reminders ────────────────────────────────────────────────────────────────

async function cancelOurs(n: Native): Promise<void> {
  const all = await n.getAllScheduledNotificationsAsync();
  for (const req of all ?? []) {
    const id = String((req as any)?.identifier ?? '');
    if (id.startsWith(NUDGE_ID_PREFIX)) {
      try { await n.cancelScheduledNotificationAsync(id); } catch { /* replaced below anyway */ }
    }
  }
}

/** Remove every reminder FlipStart scheduled (signed out, or permission gone). */
export async function cancelNudges(): Promise<void> {
  const n = await native();
  if (!n) return;
  try { await cancelOurs(n); } catch { /* nothing scheduled, or nothing to do */ }
}

let syncing = false;
/**
 * Throw away the old reminders and schedule the ones that fit `state` now.
 * `state` null (signed out) just clears them. Returns what was scheduled.
 */
export async function syncNudges(state: NudgeState | null, now: Date = new Date()): Promise<PlannedNudge[]> {
  if (syncing) return [];
  syncing = true;
  try {
    const n = await native();
    if (!n) return [];
    if (isHuntDemoActive()) return [];            // the demo's throwaway Hunt must not shape a reminder
    const perm = readPermission(await n.getPermissionsAsync());
    if (perm !== 'granted' || !state) {
      if (perm === 'granted') await cancelOurs(n);
      return [];
    }
    const plan = planNudges(state, now);
    await cancelOurs(n);
    const done: PlannedNudge[] = [];
    for (const p of plan) {
      if (p.at.getTime() <= now.getTime()) continue;
      try {
        await n.scheduleNotificationAsync({
          identifier: p.id,
          content: { title: p.title, body: p.body, sound: true, data: { kind: p.kind, route: p.route } },
          trigger: { type: (n as any).SchedulableTriggerInputTypes?.DATE ?? 'date', date: p.at } as any,
        });
        done.push(p);
      } catch { /* one failed reminder must not stop the others */ }
    }
    return done;
  } catch { return []; }
  finally { syncing = false; }
}

// ─── Taps ─────────────────────────────────────────────────────────────────────

export interface NudgeTap { id: string; kind: string; route: unknown }

function tapOf(response: any): NudgeTap | null {
  const req = response?.notification?.request;
  const id = String(req?.identifier ?? '');
  if (!id.startsWith(NUDGE_ID_PREFIX)) return null;
  const data = req?.content?.data ?? {};
  return { id: `${id}:${response?.notification?.date ?? ''}`, kind: String(data.kind ?? ''), route: data.route };
}

/** The reminder the app was opened from, if any. Read once, then cleared. */
export async function consumeLaunchTap(): Promise<NudgeTap | null> {
  const n: any = await native();
  if (!n) return null;
  try {
    const last = typeof n.getLastNotificationResponse === 'function'
      ? n.getLastNotificationResponse()
      : await n.getLastNotificationResponseAsync?.();
    const tap = tapOf(last);
    if (tap) {
      try {
        if (typeof n.clearLastNotificationResponse === 'function') n.clearLastNotificationResponse();
        else await n.clearLastNotificationResponseAsync?.();
      } catch { /* de-duplicated by id in the host */ }
    }
    return tap;
  } catch { return null; }
}

/** Listen for reminder taps while the app is running. Returns the unsubscribe. */
export async function onNudgeTap(handler: (tap: NudgeTap) => void): Promise<() => void> {
  const n = await native();
  if (!n) return () => {};
  try {
    const sub = n.addNotificationResponseReceivedListener((response: unknown) => {
      const tap = tapOf(response);
      if (tap) handler(tap);
    });
    return () => { try { sub.remove(); } catch { /* already gone */ } };
  } catch { return () => {}; }
}
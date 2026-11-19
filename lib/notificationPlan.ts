/**
 * lib/notificationPlan.ts
 *
 * Which reminders FlipStart schedules, and when. Pure: no storage, no native
 * modules, no React, so it is the same answer every time and easy to test.
 *
 * ── The idea ──────────────────────────────────────────────────────────────────
 * No daily reminders. Each time the app is used, the old reminders are thrown
 * away and up to three new ones are planned for the days AFTER it was last
 * opened: day 3, day 7 and day 14. Someone who uses FlipStart regularly never
 * sees any of them; someone who drifts away gets three, each about a different
 * goal, and then nothing more.
 *
 * Every message is about a real goal the hunter has in front of them, taken from
 * their own progress: finish the Hunt they left open, complete a first Hunt,
 * reach the next Hunt rank, unlock more brands, go on another Hunt.
 *
 * Nothing here is a promise about money, and every number comes from the
 * hunter's own profile at the moment the app was last open.
 */

export type NudgeKind = 'open_hunt' | 'first_hunt' | 'next_rank' | 'brands' | 'another_hunt';

export interface NudgeState {
  /** Hunts finished and saved, all time. */
  completedHunts: number;
  /** Lifetime Hunt XP. */
  totalXp: number;
  /** The rank after the current one, or null at the top of the ladder. */
  nextRank: { name: string; xp: number } | null;
  /** Brands unlocked in the Brand Compendium, and how many exist. */
  brandsUnlocked: number;
  brandsTotal: number;
  /** A Hunt that is still running on this phone, and how many finds it has kept. */
  openHunt: { keptCount: number } | null;
}

export interface PlannedNudge {
  /** Stable id: scheduling again replaces it, and cancelling finds it by prefix. */
  id: string;
  kind: NudgeKind;
  title: string;
  body: string;
  /** Where a tap lands. */
  route: string;
  at: Date;
}

export const NUDGE_ID_PREFIX = 'fs-nudge-';
/** Days after the app was last used. Three reminders, then silence. */
export const NUDGE_DAYS = [3, 7, 14] as const;
/** Local time of day a reminder arrives: late morning, never at night. */
export const NUDGE_HOUR = 11;
export const NUDGE_MINUTE = 30;

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
const num = (n: number) => Math.max(0, Math.floor(Number.isFinite(n) ? n : 0));
const fmt = (n: number) => num(n).toLocaleString('en-US');

/** The goals this hunter has, most pressing first. At most one message per goal. */
export function nudgeCandidates(s: NudgeState): Array<Omit<PlannedNudge, 'id' | 'at'>> {
  const out: Array<Omit<PlannedNudge, 'id' | 'at'>> = [];
  const hunts = num(s.completedHunts);

  if (s.openHunt) {
    const kept = num(s.openHunt.keptCount);
    out.push({
      kind: 'open_hunt',
      title: 'Your Hunt is still open',
      body: kept > 0
        ? `${kept} ${plural(kept, 'find is', 'finds are')} waiting. Finish the Hunt to bank your XP.`
        : 'Pick it back up, or finish it to bank your XP.',
      route: '/hunt',
    });
  }

  if (hunts === 0) {
    out.push({
      kind: 'first_hunt',
      title: 'Complete your first Hunt',
      body: 'Next thrift trip, start a Hunt: scan your finds, track your haul and earn your first Hunt XP.',
      route: '/hunt',
    });
  } else if (s.nextRank && s.nextRank.xp > num(s.totalXp)) {
    const left = s.nextRank.xp - num(s.totalXp);
    out.push({
      kind: 'next_rank',
      title: `${fmt(left)} XP to ${s.nextRank.name}`,
      body: 'Your next Hunt moves you up the ranks.',
      route: '/hunt',
    });
  }

  const unlocked = num(s.brandsUnlocked);
  const total = num(s.brandsTotal);
  if (total > 0 && unlocked < total) {
    out.push(unlocked === 0
      ? {
          kind: 'brands',
          title: 'Unlock your first brand',
          body: `Save a find from one of ${fmt(total)} brands to start your Brand Compendium.`,
          route: '/brand-compendium',
        }
      : {
          kind: 'brands',
          title: `${fmt(unlocked)} ${plural(unlocked, 'brand', 'brands')} unlocked`,
          body: `${fmt(total - unlocked)} more to find. See which ones you're missing.`,
          route: '/brand-compendium',
        });
  }

  if (hunts > 0) {
    out.push({
      kind: 'another_hunt',
      title: 'Ready for another Hunt?',
      body: `You've finished ${fmt(hunts)} ${plural(hunts, 'Hunt', 'Hunts')}. Go see what's on the racks.`,
      route: '/hunt',
    });
  }
  return out;
}

/** `days` after `now`, at the reminder time of day, in the phone's own time zone. */
export function nudgeTime(now: Date, days: number): Date {
  const at = new Date(now.getTime());
  at.setDate(at.getDate() + days);
  at.setHours(NUDGE_HOUR, NUDGE_MINUTE, 0, 0);
  return at;
}

/** The reminders to schedule right now. Empty when there is nothing worth saying. */
export function planNudges(state: NudgeState, now: Date = new Date()): PlannedNudge[] {
  const picks = nudgeCandidates(state).slice(0, NUDGE_DAYS.length);
  return picks.map((p, i) => ({
    ...p,
    id: `${NUDGE_ID_PREFIX}${NUDGE_DAYS[i]}d`,
    at: nudgeTime(now, NUDGE_DAYS[i]),
  }));
}

/** Only routes this file hands out are ever opened from a notification tap. */
export const NUDGE_ROUTES = ['/hunt', '/brand-compendium'] as const;
export function safeNudgeRoute(route: unknown): string | null {
  return typeof route === 'string' && (NUDGE_ROUTES as readonly string[]).includes(route) ? route : null;
}
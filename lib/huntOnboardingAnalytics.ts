/**
 * lib/huntOnboardingAnalytics.ts
 *
 * The Hunt onboarding funnel: where people see it, start it, skip it, quit it, finish it.
 *
 * Every event name starts with `hunt_onboarding_`, the one prefix the guided demo is allowed
 * to send (lib/huntDemoMode). Nothing here is, or counts as, real Hunt usage: the demo's own
 * activity (scans, saves, XP, hunt_started...) is dropped at the source, so these events are
 * the whole of what the demo reports. They carry no names, ids or content: only which step,
 * how far, and whether it was a replay.
 *
 *   offered → started → step_completed (each) → completed → start_real_hunt_clicked | done_clicked
 *                          ↘ exited (left early, with the step and why)
 *   offered → skipped (do_not_show_again) [+ dismissed]
 *   replayed (the info button), then started/step_completed/... with replay: true
 *
 * Funnel to real use: hunt_onboarding_start_real_hunt_clicked → the ordinary hunt_started /
 * hunt_ended events that follow, which the demo never produces.
 */
import { logEvent } from '@/lib/analytics';
import {
  COACH_STEPS, COACH_VISIBLE_STEPS, coachProgress, getCoachState, subscribeCoach,
  type CoachStepId,
} from '@/lib/huntDemoCoach';

const send = (name: string, meta: Record<string, unknown> = {}): void => {
  try { logEvent(name, meta); } catch { /* analytics never breaks the demo */ }
};

export const HUNT_ONBOARDING_EVENTS = [
  'hunt_onboarding_offered', 'hunt_onboarding_started', 'hunt_onboarding_step_completed',
  'hunt_onboarding_skipped', 'hunt_onboarding_dismissed', 'hunt_onboarding_exited',
  'hunt_onboarding_completed', 'hunt_onboarding_replayed',
  'hunt_onboarding_start_real_hunt_clicked', 'hunt_onboarding_done_clicked',
] as const;

// ─── Before the demo ─────────────────────────────────────────────────────────

/** The welcome was shown automatically. `offerCount` is how many times, this one included. */
export function logHuntOnboardingOffered(offerCount: number): void {
  send('hunt_onboarding_offered', { offer_count: offerCount });
}

/** The welcome's Skip. With "Do not show this again" it is also a dismissal. */
export function logHuntOnboardingSkipped(doNotShowAgain: boolean): void {
  send('hunt_onboarding_skipped', { do_not_show_again: doNotShowAgain });
  if (doNotShowAgain) send('hunt_onboarding_dismissed');
}

/** "How Hunt Mode works" tapped: the tutorial was asked for. */
export function logHuntOnboardingReplayed(): void {
  send('hunt_onboarding_replayed');
}

// ─── During the demo ─────────────────────────────────────────────────────────

interface Run {
  replay: boolean;
  startedAt: number;
  last: CoachStepId | null;
  done: Set<CoachStepId>;
  open: boolean;
}

let run: Run | null = null;
let unsubscribe: (() => void) | null = null;
let lastReplay = false;

const indexOf = (id: CoachStepId | null) => COACH_STEPS.findIndex(s => s.id === id);

function release(): void {
  unsubscribe?.();
  unsubscribe = null;
}

function onCoachChange(): void {
  if (!run?.open) return;
  const now = getCoachState();
  if (!now.active) { closeRun('left'); return; }           // the coach stopped without finishing
  const prev = run.last;
  run.last = now.stepId;
  // Only moving FORWARD completes a step (cancelling Save Hunt steps back), once per step,
  // and never the silent native-dialog step.
  if (prev && now.stepId && indexOf(now.stepId) > indexOf(prev)
      && !COACH_STEPS[indexOf(prev)].silent && !run.done.has(prev)) {
    run.done.add(prev);
    send('hunt_onboarding_step_completed', {
      step: prev, step_number: coachProgress(prev).n, total_steps: COACH_VISIBLE_STEPS.length, replay: run.replay,
    });
  }
  // Reaching the last card is finishing the demo, whatever the person taps there.
  if (now.stepId && COACH_STEPS[indexOf(now.stepId)]?.final) logHuntOnboardingCompleted();
}

/** Start of a demo run. Closes any run that was left open without counting it twice. */
export function beginHuntOnboardingRun(replay: boolean): void {
  if (run?.open) closeRun('restarted');     // a demo that was never closed: its run ends before the new one starts
  release();
  run = { replay, startedAt: Date.now(), last: getCoachState().stepId, done: new Set(), open: true };
  lastReplay = replay;
  send('hunt_onboarding_started', { replay, total_steps: COACH_VISIBLE_STEPS.length });
  unsubscribe = subscribeCoach(onCoachChange);
}

/** The demo ended before the last card. `reason`: exit_button, left, ... */
export function closeRun(reason: string): void {
  if (!run?.open) return;
  const step = run.last;
  send('hunt_onboarding_exited', {
    step, step_number: step ? coachProgress(step).n : null, total_steps: COACH_VISIBLE_STEPS.length,
    reason, replay: run.replay, duration_ms: Date.now() - run.startedAt,
  });
  run.open = false;
  release();
}

/** The user reached the last card: the demo is complete, whatever they tap next. Once per run. */
export function logHuntOnboardingCompleted(): void {
  if (!run?.open) return;
  send('hunt_onboarding_completed', {
    replay: run.replay, duration_ms: Date.now() - run.startedAt, steps_completed: run.done.size,
  });
  run.open = false;
  release();
}

/** The last card's two buttons. */
export function logHuntOnboardingChoice(which: 'start_real_hunt' | 'done'): void {
  send(which === 'start_real_hunt' ? 'hunt_onboarding_start_real_hunt_clicked' : 'hunt_onboarding_done_clicked',
    { replay: lastReplay });
}

/** Test seam. */
export function __resetOnboardingAnalyticsForTests(): void {
  release(); run = null; lastReplay = false;
}
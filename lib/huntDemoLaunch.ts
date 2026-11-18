/**
 * lib/huntDemoLaunch.ts
 *
 * The one place "Start Demo" goes. Switches the sandbox on (no Hunt is started yet:
 * the walkthrough opens on the real Hunt start screen and the Hunt begins when the
 * user taps START HUNT) and starts the coach at step one.
 *
 * Changes NO onboarding state: the welcome is just hidden. Skip / Exit / completion
 * decide what the state becomes (see useHuntOnboarding).
 */
import { enterDemoMode, endDemoHunt } from '@/lib/huntDemoSession';
import { startCoach } from '@/lib/huntDemoCoach';
import { beginHuntOnboardingRun } from '@/lib/huntOnboardingAnalytics';
import { isHuntOnboardingLive } from '@/lib/huntOnboarding';

/** The name the demo pre-fills on the start screen. */
export const DEMO_HUNT_NAME = 'Goodwill Run';

export type LaunchResult = 'started' | 'real_hunt_active' | 'unavailable';

/**
 * Start the demo. A real Hunt in progress is never touched: the demo refuses and says why.
 * `replay` only labels the funnel (first run vs "How Hunt Mode works").
 */
export function launchHuntDemoResult(opts: { replay?: boolean } = {}): LaunchResult {
  if (!isHuntOnboardingLive()) return 'unavailable';   // the one switch (lib/huntOnboarding)
  let result = enterDemoMode();
  if (result === 'already_demo') {
    // A demo that was never closed (it only lives in memory): start it fresh.
    endDemoHunt();
    result = enterDemoMode();
  }
  if (result === 'real_hunt_active') return 'real_hunt_active';
  if (result !== 'entered') return 'unavailable';
  startCoach();
  beginHuntOnboardingRun(!!opts.replay);
  return 'started';
}

/** Returns true when the demo started. */
export function launchHuntDemo(opts: { replay?: boolean } = {}): boolean {
  return launchHuntDemoResult(opts) === 'started';
}
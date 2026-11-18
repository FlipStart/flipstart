/**
 * lib/huntDemoMode.ts
 *
 * The one switch that says "the guided Hunt demo is running".
 *
 * While it is on, the real Hunt screens run against throwaway in-memory data and
 * every durable side effect turns itself off at the place it would happen:
 *
 *   lib/hunt-context     never writes the Hunt to the phone, never deletes the real one
 *   lib/analytics        drops every event except hunt_onboarding_*, and session counters
 *   lib/huntXp           reads no real profile, saves nothing, syncs nothing
 *   lib/useFlipStore     the finished demo Hunt never reaches saved history or the cloud
 *   lib/huntPhotos       no photo upload
 *   lib/useHuntComps     no sold-comps search
 *
 * This file imports NOTHING so any of those modules can read the switch without
 * creating an import cycle. Only lib/huntDemoSession flips it (through
 * hunt-context), and it is never persisted: an app restart always starts real.
 */

let _demoActive = false;

/** Event names the demo is allowed to send. Everything else is dropped. */
export const DEMO_ANALYTICS_PREFIX = 'hunt_onboarding_';

export function isHuntDemoActive(): boolean {
  return _demoActive;
}

/** hunt-context only. Use enterHuntDemo / exitHuntDemo, not this. */
export function __setHuntDemoActive(on: boolean): void {
  const was = _demoActive;
  _demoActive = on;
  if (was && !on) for (const fn of [..._offListeners]) { try { fn(); } catch { /* never blocks leaving */ } }
}

/**
 * Runs when the demo switch drops, however that happened (finished, exited, or a different
 * account signed in). The coach uses it to clear itself so no dim layer outlives the demo.
 */
const _offListeners = new Set<() => void>();
export function onHuntDemoDeactivated(fn: () => void): () => void {
  _offListeners.add(fn);
  return () => { _offListeners.delete(fn); };
}

// ─── Leaving the demo ────────────────────────────────────────────────────────
// Screens guard their back gesture ("Skip this find?", "End this hunt?"). Exiting
// the demo resets the navigator, which those guards would also intercept. For the
// moment of the exit they step aside. Always cleared again by the caller.

let _demoExiting = false;
export function beginDemoExit(): void { _demoExiting = true; }
export function endDemoExit(): void { _demoExiting = false; }
export function isDemoExiting(): boolean { return _demoExiting; }

/** True when an event may leave the app right now. */
export function analyticsAllowed(eventName: string): boolean {
  return !_demoActive || String(eventName).startsWith(DEMO_ANALYTICS_PREFIX);
}

// ─── The finished demo bundle ────────────────────────────────────────────────
// The real finish path hands the bundle to the saved-history store and the
// completion screens read it back from there. In the demo the bundle lives here
// instead, in memory, and is gone on exit or restart.

let _demoBundle: unknown = null;

export function setHuntDemoBundle(bundle: unknown): void {
  _demoBundle = bundle;
}

export function getHuntDemoBundle<T = unknown>(id?: string | null): T | null {
  const b = _demoBundle as { id?: string } | null;
  if (!b) return null;
  if (id && b.id !== id) return null;
  return b as T;
}

export function clearHuntDemoBundle(): void {
  _demoBundle = null;
  _demoXp = null;
}

// The XP the demo Hunt "earned", computed against a brand-new profile and shown on
// the results screens. Visual only; it lives here, in memory, and is gone on exit.
let _demoXp: unknown = null;

export function setHuntDemoXp(xp: unknown): void {
  _demoXp = xp;
}

export function getHuntDemoXp<T = unknown>(): T | null {
  return (_demoXp as T | null) ?? null;
}
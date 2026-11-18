/**
 * lib/huntDemoCoach.ts
 *
 * The guided demo's script and its tiny state machine. Pure: no React, no
 * storage, no network. Screens ask it "which step is it?" and tell it "the user
 * just did the thing" (advanceCoach); the overlay draws whatever step is current.
 *
 * The walkthrough runs on the REAL Hunt screens, so every step is "highlight a real
 * control and wait for the real tap" (action: 'tap'), or "explain this part and wait
 * for Next" (action: 'next'). Steps only move forward by the user's own action, and
 * advanceCoach(from) is a no-op unless `from` is the current step, so a stray event
 * from the wrong screen can never skip ahead.
 *
 *   start → scan → shutter → analysis → price → save → another → skip
 *         → stats → removed → removed-list → finish → confirm
 *         → xp → rank → leaderboard → unlocked
 *
 * 'confirm' is the real Save Hunt dialog (a native modal, so nothing is drawn over
 * it); cancelling it steps back to 'finish'. After it the real XP reveal plays on its
 * own (no coach), then the Great Hunt summary carries the last four steps.
 * 'unlocked' is the end: onboarding is marked complete there.
 */
import { DEMO_JACKET } from '@/lib/huntDemoData';
import { onHuntDemoDeactivated } from '@/lib/huntDemoMode';

export type CoachScreen = 'hunt' | 'hunt-active' | 'demo-camera' | 'hunt-item-detail' | 'hunt-removed' | 'hunt-complete';

/**
 * The one switch for the Hunt Leaderboard (app/hunt-leaderboard.tsx).
 *
 *   true    the HUNT LEADERBOARD button, the Home card link and the Hunt complete
 *           link open the leaderboard, and the demo's teaser reads as a feature
 *   false   the button says "Coming soon", the links are hidden and the teaser
 *           carries a COMING SOON badge
 *
 * It needs the server (leaderboard.view) and its SQL to be live. Set it to false
 * to ship a build without the leaderboard.
 */
export const LEADERBOARD_LIVE = true;

export type CoachStepId =
  | 'start' | 'scan' | 'shutter' | 'analysis' | 'price' | 'save' | 'another' | 'skip'
  | 'stats' | 'removed' | 'removed-list' | 'finish' | 'confirm'
  | 'xp' | 'rank' | 'leaderboard' | 'unlocked';

export interface CoachStep {
  id: CoachStepId;
  screen: CoachScreen;
  /** Ids of the real controls to highlight (union). Empty: an explanation with no spotlight. */
  targets: string[];
  title: string;
  body: string;
  /** tap = the user taps the highlighted control; next = the user taps the card's button;
   *  choice = two buttons (primary / secondary), the screen decides what each does. */
  action: 'tap' | 'next' | 'choice';
  nextLabel?: string;
  /** For 'choice': the two button labels. */
  choice?: { primary: string; secondary: string };
  /** full (default) hides the screen behind the spotlight; soft lets it read through. */
  dim?: 'full' | 'soft';
  /** Small pill above the title (e.g. COMING SOON). */
  badge?: string;
  /** Replaces the default "Tap the highlighted spot" line on tap steps. */
  hint?: string;
  /** The last step: no Exit demo link, because leaving is the two buttons. */
  final?: boolean;
  /** What a VoiceOver user should look for and activate on a tap step, in plain words. */
  a11yTarget?: string;
  /** Put the card under the spotlight whenever it fits, so what is above it stays readable. */
  cardSide?: 'below';
  /** Not drawn at all (a native dialog is on screen). */
  silent?: boolean;
}

export const COACH_STEPS: readonly CoachStep[] = [
  { id: 'start', screen: 'hunt', targets: ['hunt-name', 'hunt-start-btn'], action: 'tap', a11yTarget: 'the Start Hunt button',
    title: 'Start your Hunt',
    body: 'Give your thrift trip a name, then start hunting.' },
  { id: 'scan', screen: 'hunt-active', targets: ['hunt-scan-btn'], action: 'tap', a11yTarget: 'the Scan an item button',
    title: 'Scan finds as you shop',
    body: 'Use FlipStart on anything you find while thrifting.' },
  { id: 'shutter', screen: 'demo-camera', targets: ['demo-shutter'], action: 'tap', a11yTarget: 'the Take photo button',
    title: 'Snap the find',
    body: "Tap the shutter. This is a practice camera, so nothing is used up." },
  { id: 'analysis', screen: 'hunt-item-detail', targets: ['item-decision'], action: 'next', nextLabel: 'Got it', cardSide: 'below',
    title: 'FlipStart analyzes the find',
    body: "See what it may sell for, what you could make, and whether it's worth grabbing." },
  { id: 'price', screen: 'hunt-item-detail', targets: ['item-price'], action: 'tap', a11yTarget: 'the store price box', cardSide: 'below',
    title: 'Enter the store price',
    body: `Tap the price box to enter the $${DEMO_JACKET.thriftPrice} on the tag. Your profit updates instantly.` },
  { id: 'save', screen: 'hunt-item-detail', targets: ['item-save'], action: 'tap', a11yTarget: 'the Save to Hunt button',
    title: 'Save to Hunt',
    body: 'Keep the winners and build your haul as you shop.' },
  { id: 'another', screen: 'hunt-active', targets: [], action: 'next', nextLabel: 'Show me',
    title: 'Found something else?',
    body: "Let's look at one more find." },
  { id: 'skip', screen: 'hunt-item-detail', targets: ['item-skip'], action: 'tap', a11yTarget: 'the Skip button',
    title: 'Not everything makes the cut',
    body: 'Skip weaker finds and keep your Hunt focused on the best opportunities.' },
  { id: 'stats', screen: 'hunt-active', targets: ['hunt-location', 'hunt-stats'], action: 'next', nextLabel: 'Next',
    title: 'Track your trip in real time',
    body: "See what you've scanned, what you've kept, your projected profit, and how long you've been hunting." },
  { id: 'removed', screen: 'hunt-active', targets: ['hunt-removed-link'], action: 'tap', a11yTarget: 'the Removed items link',
    title: 'Changed your mind?',
    body: 'Skipped finds stay in Removed Items so you can review or restore them later.' },
  { id: 'removed-list', screen: 'hunt-removed', targets: [], action: 'next', nextLabel: 'Back to Hunt',
    title: 'Nothing is lost',
    body: 'Open any removed find to review it, or restore it to your haul.' },
  { id: 'finish', screen: 'hunt-active', targets: ['hunt-finish-btn'], action: 'tap', a11yTarget: 'the finish Hunt check mark, top right',
    title: 'Finish your Hunt',
    body: 'When your thrift trip is over, finish the Hunt to save your results and earn XP.' },
  { id: 'confirm', screen: 'hunt-active', targets: [], action: 'tap', silent: true,
    title: 'Save your Hunt', body: 'Confirm to save the demo Hunt.' },
  { id: 'xp', screen: 'hunt-complete', targets: ['complete-xp'], action: 'next', nextLabel: 'Next', dim: 'soft',
    title: 'Earn XP every Hunt',
    body: 'Complete Hunts, find stronger items, and discover new brands to climb the ranks.' },
  { id: 'rank', screen: 'hunt-complete', targets: ['complete-rank'], action: 'next', nextLabel: 'Next', dim: 'soft',
    title: 'Fill the bar, rank up',
    body: 'Your XP fills your rank bar. Every rank you reach shows how far your thrifting has come.' },
  { id: 'leaderboard', screen: 'hunt-complete', targets: [], action: 'next', nextLabel: 'Next',
    badge: LEADERBOARD_LIVE ? undefined : 'COMING SOON',
    title: 'Climb the leaderboard',
    body: 'Earn XP from real Hunts and compete with other thrifters for the top spots.' },
  { id: 'unlocked', screen: 'hunt-complete', targets: [], action: 'choice', final: true,
    choice: { primary: 'Start a Real Hunt', secondary: 'Done' },
    title: 'Hunt Mode unlocked',
    body: 'Scan, price, keep or skip, finish, earn XP. That is the whole loop. Ready for a real one?' },
];

/** Steps the user sees numbered ("3 of 12"). The native-dialog step is not counted. */
export const COACH_VISIBLE_STEPS: readonly CoachStep[] = COACH_STEPS.filter(s => !s.silent);

export interface CoachState {
  active: boolean;
  stepId: CoachStepId | null;
}

const IDLE: CoachState = { active: false, stepId: null };
let _state: CoachState = IDLE;
const _listeners = new Set<() => void>();

function set(next: CoachState): void {
  if (next.active === _state.active && next.stepId === _state.stepId) return;
  _state = next;
  _listeners.forEach(fn => { try { fn(); } catch { /* a listener never breaks the demo */ } });
}

export const getCoachState = (): CoachState => _state;

export function subscribeCoach(fn: () => void): () => void {
  _listeners.add(fn);
  return () => { _listeners.delete(fn); };
}

export function getCoachStep(id: CoachStepId | null = _state.stepId): CoachStep | null {
  return COACH_STEPS.find(s => s.id === id) ?? null;
}

/** 1-based position among the numbered steps, and how many there are. */
export function coachProgress(id: CoachStepId | null = _state.stepId): { n: number; total: number } {
  const i = COACH_VISIBLE_STEPS.findIndex(s => s.id === id);
  return { n: i < 0 ? COACH_VISIBLE_STEPS.length : i + 1, total: COACH_VISIBLE_STEPS.length };
}

export function startCoach(): void {
  set({ active: true, stepId: COACH_STEPS[0].id });
}

export function stopCoach(): void {
  set(IDLE);
}

// The demo switch can drop without the coach being told (a different account signing in).
// The coach never outlives it.
onHuntDemoDeactivated(() => { if (_state.active) stopCoach(); });

/**
 * The user did what `from` asked. Moves to the next step, but ONLY when `from` is
 * the current step: anything else is ignored. Returns whether it moved.
 */
export function advanceCoach(from: CoachStepId): boolean {
  if (!_state.active || _state.stepId !== from) return false;
  const i = COACH_STEPS.findIndex(s => s.id === from);
  const next = COACH_STEPS[i + 1];
  if (!next) { set(IDLE); return true; }     // the script ends; Phase 5 continues from here
  set({ active: true, stepId: next.id });
  return true;
}

/** Step back to an earlier step (cancelling the Save dialog returns to 'finish'). */
export function returnCoachTo(id: CoachStepId, from: CoachStepId): boolean {
  if (!_state.active || _state.stepId !== from) return false;
  set({ active: true, stepId: id });
  return true;
}

/** Test seam. */
export function __resetCoachForTests(): void {
  _state = IDLE;
  _listeners.clear();
}
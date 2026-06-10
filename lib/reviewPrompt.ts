/**
 * lib/reviewPrompt.ts
 *
 * App Store review prompt logic for FlipStart.
 *
 * Rules:
 *  - Show after first successful scan (count = 1)
 *  - "Maybe Later" → show again after 10 more scans
 *  - "Don't Ask Again" → never show again
 *  - "Rate FlipStart" → request official review → never auto-show again
 *  - Settings button always available, never touches auto-prompt state
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'flipstart_review_prompt_state';

export interface ReviewState {
  successfulScanCount:   number;
  lastShownAtScanCount:  number;  // 0 = never shown
  dontAskAgain:          boolean;
  hasRequestedReview:    boolean; // tapped "Rate" at least once
}

const DEFAULT: ReviewState = {
  successfulScanCount:  0,
  lastShownAtScanCount: 0,
  dontAskAgain:         false,
  hasRequestedReview:   false,
};

async function load(): Promise<ReviewState> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? { ...DEFAULT, ...JSON.parse(raw) } : { ...DEFAULT };
  } catch { return { ...DEFAULT }; }
}

async function save(state: ReviewState): Promise<void> {
  try { await AsyncStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ok */ }
}

// ─── Called after every successful scan save ─────────────────────────────────
// Returns true if the review prompt should be shown to the user.
export async function recordSuccessfulScan(): Promise<boolean> {
  const state = await load();
  state.successfulScanCount += 1;
  await save(state);

  if (state.dontAskAgain || state.hasRequestedReview) return false;

  const { successfulScanCount: count, lastShownAtScanCount: last } = state;

  // First scan
  if (count === 1 && last === 0) return true;

  // Every 10 scans after dismissal
  if (last > 0 && count >= last + 10) return true;

  return false;
}

// ─── Called when user taps "Maybe Later" ─────────────────────────────────────
export async function onMaybeLater(): Promise<void> {
  const state = await load();
  state.lastShownAtScanCount = state.successfulScanCount;
  await save(state);
}

// ─── Called when user taps "Don't Ask Again" ─────────────────────────────────
export async function onDontAskAgain(): Promise<void> {
  const state = await load();
  state.dontAskAgain = true;
  state.lastShownAtScanCount = state.successfulScanCount;
  await save(state);
}

// ─── Called after user taps "Rate FlipStart" ─────────────────────────────────
export async function onRequestedReview(): Promise<void> {
  const state = await load();
  state.hasRequestedReview   = true;
  state.lastShownAtScanCount = state.successfulScanCount;
  await save(state);
}

// ─── Request the official App Store review (used by both prompt + Settings) ──
export async function requestAppStoreReview(): Promise<void> {
  try {
    const StoreReview = await import('expo-store-review');
    const available   = await StoreReview.isAvailableAsync();
    if (available) {
      await StoreReview.requestReview();
    }
  } catch (err) {
    if (__DEV__) console.warn('[reviewPrompt] requestReview threw:', err);
  }
}
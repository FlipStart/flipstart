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
// Returns true if the native review flow was successfully requested.
//
// Notes on iOS behavior (important — this is Apple's design, not a bug):
//   • iOS rate-limits the native sheet to ~3 times/year per device. Even a
//     correct call may not render a visible sheet — the OS decides.
//   • The sheet will NOT reliably appear in debug or Xcode-run builds. Test on
//     a real TestFlight/App Store build.
//   • requestReview() must be called while the app is active and NOT mid screen
//     transition, or iOS silently drops it.
export async function requestAppStoreReview(): Promise<boolean> {
  try {
    const mod: any = await import('expo-store-review');
    // The module's functions may sit on the namespace or on .default depending
    // on bundler interop — resolve whichever has the API.
    const StoreReview = (mod && typeof mod.requestReview === 'function') ? mod : (mod?.default ?? mod);

    if (typeof StoreReview?.requestReview !== 'function') {
      if (__DEV__) console.warn('[reviewPrompt] expo-store-review API not found on module');
      return false;
    }

    // hasAction() is the more reliable gate than isAvailableAsync() — it returns
    // true only when the device can actually act on a review request.
    let canRequest = true;
    try {
      if (typeof StoreReview.hasAction === 'function') {
        canRequest = await StoreReview.hasAction();
      } else if (typeof StoreReview.isAvailableAsync === 'function') {
        canRequest = await StoreReview.isAvailableAsync();
      }
    } catch { canRequest = true; /* if the check throws, still try */ }

    if (!canRequest) {
      if (__DEV__) console.warn('[reviewPrompt] StoreReview has no action available on this device');
      return false;
    }

    await StoreReview.requestReview();
    return true;
  } catch (err) {
    if (__DEV__) console.warn('[reviewPrompt] requestReview threw:', err);
    return false;
  }
}

// ─── Fallback: open the App Store review page directly ───────────────────────
// If the native in-app sheet can't show (iOS rate limit, unavailable), this
// deep-links to the store's write-review page so the user can still rate.
// Provide your real App Store ID via APP_STORE_ID below.
export async function openAppStoreReviewPage(): Promise<void> {
  try {
    const { Linking, Platform } = await import('react-native');
    if (Platform.OS === 'ios') {
      const url = `https://apps.apple.com/app/id${APP_STORE_ID}?action=write-review`;
      await Linking.openURL(url);
    } else {
      const url = `market://details?id=${ANDROID_PACKAGE}&showAllReviews=true`;
      await Linking.openURL(url).catch(() =>
        Linking.openURL(`https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`),
      );
    }
  } catch (err) {
    if (__DEV__) console.warn('[reviewPrompt] openAppStoreReviewPage threw:', err);
  }
}

// TODO: set these to your real IDs.
const APP_STORE_ID   = '6770193673';          // your numeric App Store ID
const ANDROID_PACKAGE = 'com.flipstart.app';  // your Android package name
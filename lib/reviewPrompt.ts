/**
 * lib/reviewPrompt.ts
 *
 * App Store review requests for FlipStart.
 *
 * ── Two separate flows, deliberately ────────────────────────────────────────
 * AUTOMATIC — after three successful completed scans, ask iOS to consider
 *   showing its own rating sheet. There is no FlipStart-made prompt in front
 *   of it. Apple's guidelines require the system API and disallow a custom
 *   pre-prompt, and a pre-prompt that filters who gets asked is review gating
 *   regardless of how politely it is worded.
 *
 * SETTINGS — an explicit "Review FlipStart" tap opens the App Store product
 *   page with ?action=write-review. It must NOT call requestReview(): Apple
 *   documents that API as a hint, not a command, and it may legitimately show
 *   nothing — which makes a deliberate button tap look broken.
 *
 * ── Completed, not saved ────────────────────────────────────────────────────
 * The counter advances when an analysis completes, not when the user saves it.
 * FlipStart is useful in the aisle without saving anything, so saving is a
 * weaker signal of having experienced the product.
 *
 * ── Once per app version ────────────────────────────────────────────────────
 * The automatic request fires at most once per public version. StoreKit
 * applies its own limits on top; ours exists so the app never nags even if
 * Apple would allow it.
 *
 * ── A request is not a review ───────────────────────────────────────────────
 * requestReview() resolving proves only that the call was made. It does not
 * mean a sheet appeared, and never means anyone rated. Nothing is unlocked,
 * awarded, or thanked on the strength of it.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

const KEY = 'flipstart_review_prompt_state';

/** Completed scans before the automatic request becomes eligible. */
export const SCANS_BEFORE_REVIEW = 3;

export interface ReviewState {
  /** Successful COMPLETED analyses, all-time. */
  completedScanCount: number;
  /** App version whose automatic request already fired. '' = none yet. */
  lastRequestedVersion: string;
}

const DEFAULT: ReviewState = { completedScanCount: 0, lastRequestedVersion: '' };

/**
 * Older builds persisted `successfulScanCount`, `lastShownAtScanCount`,
 * `dontAskAgain` and `hasRequestedReview` under this same key for the custom
 * modal. Those fields are simply no longer read. The spread below tolerates
 * them, so an upgrading user neither crashes nor needs a migration — and
 * `successfulScanCount` is carried across as the starting count so someone who
 * has already scanned twenty times is not made to start again.
 */
async function load(): Promise<ReviewState> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT };
    const parsed = JSON.parse(raw) as Partial<ReviewState> & { successfulScanCount?: number };
    const carried = typeof parsed.completedScanCount === 'number'
      ? parsed.completedScanCount
      : typeof parsed.successfulScanCount === 'number' ? parsed.successfulScanCount : 0;
    return {
      completedScanCount: Number.isFinite(carried) && carried >= 0 ? carried : 0,
      lastRequestedVersion: typeof parsed.lastRequestedVersion === 'string' ? parsed.lastRequestedVersion : '',
    };
  } catch {
    return { ...DEFAULT };
  }
}

async function save(state: ReviewState): Promise<void> {
  try { await AsyncStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ok */ }
}

/** The public version from app.config.ts, e.g. "2.1". */
export function currentAppVersion(): string {
  return Constants.expoConfig?.version ?? '';
}

/**
 * Record one successful COMPLETED scan.
 *
 * Returns true when this completion makes the app ELIGIBLE to request a
 * review. Eligible is not the same as "ask now" — the caller must wait for a
 * stable screen; see markReviewRequested / requestAppStoreReview.
 */
export async function recordCompletedScan(): Promise<boolean> {
  const state = await load();
  state.completedScanCount += 1;
  await save(state);

  const version = currentAppVersion();
  if (!version) return false;                              // unknown version: never ask
  if (state.lastRequestedVersion === version) return false; // already asked this version
  return state.completedScanCount >= SCANS_BEFORE_REVIEW;
}

/** True if an automatic request is still allowed for this version. */
export async function isReviewRequestAllowed(): Promise<boolean> {
  const version = currentAppVersion();
  if (!version) return false;
  const state = await load();
  return state.lastRequestedVersion !== version
    && state.completedScanCount >= SCANS_BEFORE_REVIEW;
}

/**
 * Burn this version's single automatic request.
 *
 * Recorded BEFORE the API call, not after: if requestReview() throws or the
 * app is killed mid-call, the correct outcome is still "we already asked".
 * Retrying would be nagging, which is the behaviour this replaces.
 */
export async function markReviewRequested(): Promise<void> {
  const state = await load();
  state.lastRequestedVersion = currentAppVersion();
  await save(state);
}

/**
 * Ask iOS to consider showing its rating sheet.
 *
 * Returns whether the CALL succeeded — never whether a sheet appeared, and
 * never whether anyone rated. Apple decides presentation; in TestFlight it
 * does nothing at all, which is expected and not a bug.
 */
export async function requestAppStoreReview(): Promise<boolean> {
  try {
    const mod: any = await import('expo-store-review');
    const StoreReview = (mod && typeof mod.requestReview === 'function') ? mod : (mod?.default ?? mod);
    if (typeof StoreReview?.requestReview !== 'function') return false;

    let canRequest = true;
    try {
      if (typeof StoreReview.hasAction === 'function') canRequest = await StoreReview.hasAction();
      else if (typeof StoreReview.isAvailableAsync === 'function') canRequest = await StoreReview.isAvailableAsync();
    } catch { canRequest = true; }
    if (!canRequest) return false;

    await StoreReview.requestReview();
    return true;
  } catch {
    return false;
  }
}

// ── Settings: the explicit, deliberate path ────────────────────────────────

/** The real listing. Also used by components/UpdateGate.tsx. */
const APP_STORE_ID = '6770193673';
const ANDROID_PACKAGE = 'com.dylan.flipstart';

export const APP_STORE_WRITE_REVIEW_URL =
  `https://apps.apple.com/app/id${APP_STORE_ID}?action=write-review`;
export const APP_STORE_PRODUCT_URL =
  `https://apps.apple.com/app/id${APP_STORE_ID}`;

/**
 * Open the store's write-review page.
 *
 * Tries the deep write-review link first, then the plain product page. Both
 * are attempted because the first can fail on a device with no App Store (a
 * simulator) or before a listing is live, and a dead tap with a console
 * warning is what QA saw. Returns false only if BOTH fail, so the caller can
 * say something rather than appear broken.
 */
export async function openAppStoreReviewPage(): Promise<boolean> {
  const { Linking, Platform } = await import('react-native');

  const targets = Platform.OS === 'ios'
    ? [APP_STORE_WRITE_REVIEW_URL, APP_STORE_PRODUCT_URL]
    : [
        `market://details?id=${ANDROID_PACKAGE}&showAllReviews=true`,
        `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`,
      ];

  for (const url of targets) {
    try {
      await Linking.openURL(url);
      return true;
    } catch {
      // Try the next one. No dev warning here: the previous version's
      // console.warn surfaced in LogBox and read as a crash during QA.
    }
  }
  return false;
}
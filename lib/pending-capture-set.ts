/**
 * lib/pending-capture-set.ts
 *
 * Module-level store for passing a completed CapturedPhotoSet from the
 * camera screen back to the home screen after navigation.
 *
 * Same pattern as pending-scan.ts. Set before navigating back, consume
 * immediately on the receiving screen.
 */

import type { CapturedPhotoSet } from './capture';

let _pending: CapturedPhotoSet | null = null;

/** Called by the camera screen before router.back() */
export function setPendingCaptureSet(set: CapturedPhotoSet): void {
  _pending = set;
}

/**
 * Called by the home screen after the camera screen returns.
 * Clears the store and returns the value (or null if nothing was set).
 */
export function consumePendingCaptureSet(): CapturedPhotoSet | null {
  const val = _pending;
  _pending = null;
  return val;
}

/** Peek without consuming — use only for debugging */
export function peekPendingCaptureSet(): CapturedPhotoSet | null {
  return _pending;
}
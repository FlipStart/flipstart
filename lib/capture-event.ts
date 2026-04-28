/**
 * Capture event listener — solves the center-camera-button lag.
 *
 * WHY THIS EXISTS:
 * The previous approach (setPendingCapture + useFocusEffect) only works when
 * the home screen gains focus. If the user is already on the Home tab,
 * navigation.navigate('index') is a no-op, focus never changes, and
 * useFocusEffect never fires. The photo sits unclaimed.
 *
 * This module holds a direct reference to the home screen's setCapturedPhoto
 * setter. The tab bar calls dispatchCapturedPhoto() synchronously after
 * capture — no focus change required.
 *
 * Usage:
 *   - Home screen: registerCaptureListener on mount, unregister on unmount
 *   - Tab bar:     call dispatchCapturedPhoto(photo) after capture, then navigate
 */

import type { CapturedPhoto } from './capture';

type CaptureListener = (photo: CapturedPhoto) => void;

let _listener: CaptureListener | null = null;

export function registerCaptureListener(fn: CaptureListener): void {
  _listener = fn;
}

export function unregisterCaptureListener(): void {
  _listener = null;
}

/** Call the home screen's setter directly. Returns true if a listener was registered. */
export function dispatchCapturedPhoto(photo: CapturedPhoto): boolean {
  if (_listener) {
    _listener(photo);
    return true;
  }
  return false;
}
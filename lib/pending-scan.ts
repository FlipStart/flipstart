/**
 * lib/pending-scan.ts
 *
 * Module-level store for all pending scan photos.
 * We pass via module state (not router params) to avoid base64 serialization
 * blocking the JS thread.
 *
 * Supports front (required), tag (optional), detail (optional).
 * 'detail' replaces old 'back' — flexible: back print, graphic, flaw, logo, close-up.
 */

export interface PhotoData {
  base64:   string;
  mimeType: string;
  /** The photo's file on the phone, for the results screen's photo viewer only. */
  uri?:     string;
}

/** How a photo got here. Reported to the server with Hunt scans (see server/hunt). */
export type CaptureSource = 'camera' | 'library';

export interface PendingScan {
  front:   PhotoData;
  /**
   * Where the FRONT photo came from: the in-app camera, or the photo library.
   * Hunt XP gives full value to big finds only when the photo was taken in the app.
   */
  frontSource?: CaptureSource;
  tag?:    PhotoData;
  detail?: PhotoData;   // formerly 'back' — back print, graphic, flaw, logo, close-up
  /**
   * Camera context the user typed AND confirmed. Absent when the field was
   * empty, unconfirmed, or edited after confirming — the camera screen only
   * sets it in the confirmed state, so an unconfirmed draft can never reach
   * the server by accident.
   *
   * Normalized here as well as on the server. The server re-normalizes and
   * never trusts this value.
   */
  userContext?: string;
}

let _pending: PendingScan | null = null;

export function setPendingScan(data: PendingScan) {
  _pending = data;
}

export function consumePendingScan(): PendingScan | null {
  const data = _pending;
  _pending   = null;
  return data;
}
/**
 * Module-level store for the pending scan's base64 image data.
 *
 * We deliberately do NOT pass imageBase64 through Expo Router params because
 * a base64 JPEG (200–500 KB) serialized into navigation state blocks the JS
 * thread synchronously, causing the ~30s freeze on the review screen before
 * the loading screen appears.
 *
 * Usage:
 *   - review screen sets pendingScan before calling router.push
 *   - loading screen reads pendingScan on mount, then clears it
 */

interface PendingScan {
    imageBase64: string;
    mimeType: string;
  }
  
  let _pending: PendingScan | null = null;
  
  export function setPendingScan(data: PendingScan) {
    _pending = data;
  }
  
  export function consumePendingScan(): PendingScan | null {
    const data = _pending;
    _pending = null;
    return data;
  }
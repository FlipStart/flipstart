/**
 * lib/pending-scan.ts
 *
 * Module-level store for all pending scan photos.
 * We pass via module state (not router params) to avoid base64 serialization
 * blocking the JS thread.
 *
 * Supports front (required), back (optional), tag (optional).
 */

export interface PhotoData {
  base64:   string;
  mimeType: string;
}

export interface PendingScan {
  front: PhotoData;
  back?: PhotoData;
  tag?:  PhotoData;
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
/**
 * lib/huntArt.ts
 *
 * The Hunt Mode start screen's artwork, and getting it ready BEFORE the screen opens.
 *
 * The art is large. Loaded on demand, the screen opened onto an empty background while
 * it decoded and faded in. Now the tab bar warms the art as soon as the user is signed
 * in, and the Hunt Mode button waits (briefly, never more than a moment) for it, so the
 * screen opens with the art already there. If the art is somehow not ready the screen
 * shows plain white until it is, never a coloured placeholder.
 */
import { Image as RNImage } from 'react-native';
import { Image as ExpoImage } from 'expo-image';

import { HUNT_BG, HUNT_TITLE } from '@/lib/huntArtAssets';

export { HUNT_BG, HUNT_TITLE };

let _ready = false;
let _pending: Promise<void> | null = null;

/** True once the art has been fetched and cached by preloadHuntArt. */
export function isHuntArtReady(): boolean {
  return _ready;
}

/** Fetch and cache the art. Safe to call any number of times; it only works once. */
export function preloadHuntArt(): Promise<void> {
  if (_ready) return Promise.resolve();
  if (!_pending) {
    _pending = (async () => {
      try {
        const uris = [HUNT_BG, HUNT_TITLE]
          .map(m => RNImage.resolveAssetSource(m)?.uri)
          .filter((u): u is string => !!u);
        if (uris.length) await ExpoImage.prefetch(uris, 'memory-disk');
        _ready = true;
      } catch {
        _pending = null;          // try again next time; never block the app on it
      }
    })();
  }
  return _pending;
}

/** Wait for the art, but never longer than maxMs: a slow phone must not feel a dead button. */
export async function preloadHuntArtBriefly(maxMs = 900): Promise<void> {
  await Promise.race([preloadHuntArt(), new Promise<void>(r => setTimeout(r, maxMs))]);
}
/**
 * components/hunt/onboarding/demoAssets.ts
 *
 * The bundled photos for the Hunt onboarding demo. Kept apart from
 * lib/huntDemoData.ts so that file stays pure data and math (testable without the
 * bundler). Photos are the founder's own, resized and stripped of metadata.
 */
import { Image } from 'react-native';

export const DEMO_JACKET_PHOTO = require('@/assets/images/hunt-demo/pelle-pelle-jacket.jpg');
export const DEMO_POLO_PHOTO = require('@/assets/images/hunt-demo/polo-ralph-lauren.jpg');
export const DEMO_TIGGER_PHOTO = require('@/assets/images/hunt-demo/tigger-sweatshirt.jpg');
export const DEMO_HOLLISTER_PHOTO = require('@/assets/images/hunt-demo/hollister-sherpa-zip.jpg');
export const DEMO_GREENDAY_PHOTO = require('@/assets/images/hunt-demo/green-day-hat.jpg');
export const DEMO_VEST_PHOTO = require('@/assets/images/hunt-demo/north-face-vest.jpg');
export const DEMO_BETTY_PHOTO = require('@/assets/images/hunt-demo/betty-boop-tee.jpg');

const PHOTOS: Record<string, number> = {
  jacket: DEMO_JACKET_PHOTO,
  polo: DEMO_POLO_PHOTO,
  tigger: DEMO_TIGGER_PHOTO,
  hollister: DEMO_HOLLISTER_PHOTO,
  greenday: DEMO_GREENDAY_PHOTO,
  vest: DEMO_VEST_PHOTO,
  betty: DEMO_BETTY_PHOTO,
};

/**
 * Photo key → a URI the Hunt screens can show (they read item.imageUri as a
 * string). Unknown or missing key → '' so the screen uses its icon fallback.
 */
export function demoPhotoUri(key?: string): string {
  if (!key || !PHOTOS[key]) return '';
  try { return Image.resolveAssetSource(PHOTOS[key])?.uri ?? ''; } catch { return ''; }
}
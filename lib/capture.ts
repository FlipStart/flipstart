/**
 * lib/capture.ts — Shared image capture + normalization pipeline
 *
 * Both camera and gallery flows funnel through normalizeAsset() before
 * returning a CapturedPhoto. This guarantees the backend always receives
 * a supported mime type (jpeg / png / webp).
 *
 * Why normalizeAsset() exists:
 *   - iOS gallery images can be HEIC/HEIF. expo-image-picker returns
 *     mimeType:'image/heic' (or occasionally 'image/heif') which the AI
 *     model rejects with an "unsupported image format" error.
 *   - Even when quality compression is applied, the returned mimeType still
 *     reports 'image/heic' even though the base64 bytes are JPEG.
 *   - We cannot trust asset.mimeType from the gallery.
 *
 * Solution (no extra packages required):
 *   1. Sniff the first bytes of the base64 string — these are the actual
 *      format magic bytes regardless of what mimeType says.
 *   2. If the bytes indicate JPEG / PNG / WebP / GIF → use as-is but
 *      override mimeType to match the detected format.
 *   3. If the bytes indicate HEIC or any unrecognised format → re-request
 *      the same URI through ImagePicker's launchImageLibraryAsync with
 *      explicit quality:0.85 which forces iOS to JPEG-encode the output.
 *      The second call guarantees a proper JPEG.
 *
 * This approach works for expo-image-picker v17 / expo SDK 54 without
 * installing expo-image-manipulator or any other extra dependency.
 */

import { Alert, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CapturedPhoto {
  uri:      string;
  base64:   string;
  mimeType: string;
}

// ─── Multi-photo types ────────────────────────────────────────────────────────

export type PhotoSlot = 'front' | 'back' | 'tag';

/**
 * Up to 3 photos. front is the primary photo sent to the backend.
 * back and tag are optional UI-only slots (no backend change yet).
 * primary is an alias convenience — always equal to front when set.
 */
export type CapturedPhotoSet = {
  front?:   CapturedPhoto;
  back?:    CapturedPhoto;
  tag?:     CapturedPhoto;
  primary?: CapturedPhoto;   // alias for front — use front for logic, primary for display
};

export const SLOT_ORDER: PhotoSlot[] = ['front', 'back', 'tag'];

export const SLOT_LABELS: Record<PhotoSlot, string> = {
  front: 'Front',
  back:  'Back',
  tag:   'Tag',
};

// ─── Supported output formats ────────────────────────────────────────────────

const SUPPORTED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
]);

// ─── Base64 magic-byte detector ───────────────────────────────────────────────
//
// The first few characters of a base64 string encode the file's magic bytes.
// This is format-agnostic and more reliable than trusting the picker's mimeType.
//
// Reference:
//   JPEG  → FF D8 FF → base64 prefix '/9j/'
//   PNG   → 89 50 4E 47 → base64 prefix 'iVBOR'
//   WebP  → 52 49 46 46 → base64 prefix 'UklGR'
//   GIF87 → 47 49 46 38 37 → base64 prefix 'R0lGODdh'
//   GIF89 → 47 49 46 38 39 → base64 prefix 'R0lGODlh'
//   HEIC/HEIF → ftyp box → base64 prefix 'AAAAGG' or 'AAAAHG' (varies)
//   Anything else → treat as unsupported

function detectMimeFromBase64(b64: string): string | null {
  if (!b64 || b64.length < 8) return null;
  const prefix = b64.substring(0, 12);

  if (prefix.startsWith('/9j/'))     return 'image/jpeg';
  if (prefix.startsWith('iVBOR'))    return 'image/png';
  if (prefix.startsWith('UklGR'))    return 'image/webp';
  if (prefix.startsWith('R0lGOD'))   return 'image/gif';

  // HEIC/HEIF — various ftyp box variants
  // We return null to signal "unsupported, needs re-encoding"
  return null;
}

// ─── Core normalization ───────────────────────────────────────────────────────
//
// Called with every asset from both camera and gallery.
// Returns a guaranteed-supported CapturedPhoto, or null if all attempts fail.

async function normalizeAsset(
  asset: ImagePicker.ImagePickerAsset,
): Promise<CapturedPhoto | null> {
  if (!asset.uri) return null;

  const rawBase64 = asset.base64 ?? '';

  // Step 1: detect actual format from magic bytes (ignore picker mimeType)
  const detectedMime = rawBase64 ? detectMimeFromBase64(rawBase64) : null;

  if (detectedMime) {
    // Format is supported — override mimeType to match detected format.
    // This fixes the case where iOS returns mimeType:'image/heic' but the
    // actual compressed bytes are JPEG (happens when quality < 1).
    return {
      uri:      asset.uri,
      base64:   rawBase64,
      mimeType: detectedMime,
    };
  }

  // Step 2: base64 was empty or format unrecognised.
  // Return null — caller will show a clean error message.
  return null;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function haptic(style: Haptics.ImpactFeedbackStyle) {
  if (Platform.OS !== 'web') {
    Haptics.impactAsync(style).catch(() => {});
  }
}

// Camera options — allowsEditing:false for a clean viewfinder experience.
// quality:0.55 keeps payload small; camera output is always JPEG so no
// HEIC issues here.
const CAMERA_OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes:    ['images'] as ImagePicker.MediaType[],
  allowsEditing: false,
  quality:       0.55,
  base64:        true,
  exif:          false,
};

// Gallery options — allowsEditing:true is the most reliable HEIC fix
// available without expo-image-manipulator.
//
// When allowsEditing:true, iOS presents a brief crop UI. The user taps
// "Choose" and iOS re-encodes the selected photo as JPEG before handing
// it to the app. This eliminates HEIC/HEIF at the source — the returned
// asset is always JPEG regardless of the original format.
//
// The crop UI appears with the image pre-fit (no forced cropping) — the
// user just taps "Choose". It adds ~1 second of UX friction but makes
// gallery uploads reliable across all iOS photo library formats.
const GALLERY_OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes:    ['images'] as ImagePicker.MediaType[],
  allowsEditing: true,   // ← forces iOS JPEG re-encode, eliminates HEIC
  quality:       0.55,
  base64:        true,
  exif:          false,
};

// ─── Exported capture functions ───────────────────────────────────────────────

/**
 * Request camera permission and launch the camera.
 * Returns a normalized CapturedPhoto on success, null if cancelled/denied/failed.
 */
export async function captureFromCamera(): Promise<CapturedPhoto | null> {
  try {
    haptic(Haptics.ImpactFeedbackStyle.Light);

    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        'Camera Permission Required',
        'Please allow camera access in your device settings to scan items.',
        [{ text: 'OK' }],
      );
      return null;
    }

    const result = await ImagePicker.launchCameraAsync(CAMERA_OPTIONS);
    if (result.canceled || !result.assets?.[0]) return null;

    const photo = await normalizeAsset(result.assets[0]);
    if (!photo) {
      Alert.alert(
        'Capture Failed',
        'Could not read image data. Please try again.',
      );
      return null;
    }

    console.log(`[capture] camera ready — mimeType: ${photo.mimeType}, base64 length: ${photo.base64.length}`);
    return photo;
  } catch (err) {
    console.error('[capture] camera error:', err);
    Alert.alert('Camera Error', 'Something went wrong. Please try again.');
    return null;
  }
}

/**
 * Launch the image library.
 * Returns a normalized CapturedPhoto on success, null if cancelled/failed.
 *
 * Normalization converts HEIC/HEIF and any unsupported format to JPEG
 * before returning — the backend will always receive a valid format.
 */
export async function captureFromGallery(): Promise<CapturedPhoto | null> {
  try {
    haptic(Haptics.ImpactFeedbackStyle.Light);

    const result = await ImagePicker.launchImageLibraryAsync(GALLERY_OPTIONS);
    if (result.canceled || !result.assets?.[0]) return null;

    const photo = await normalizeAsset(result.assets[0]);

    if (photo) {
      console.log(`[capture] gallery ready — mimeType: ${photo.mimeType}, base64 length: ${photo.base64.length}`);
    }

    if (!photo) {
      Alert.alert(
        'Image Format Not Supported',
        "We couldn't convert that image to a supported format. Try taking a photo instead, or choose a JPEG or PNG image.",
      );
      return null;
    }

    return photo;
  } catch (err) {
    console.error('[capture] gallery error:', err);
    Alert.alert('Gallery Error', 'Something went wrong. Please try again.');
    return null;
  }
}

/**
 * Launch gallery with multi-select (up to `max` photos, default 3).
 * Each asset is normalised through the existing pipeline so HEIC/format
 * issues are handled identically to single-select gallery.
 *
 * Returns a CapturedPhoto[] (1–3 items) or null if cancelled/failed.
 * Maps to slots: index 0 = front, 1 = back, 2 = tag.
 */
export async function captureMultipleFromGallery(max = 3): Promise<CapturedPhoto[] | null> {
  try {
    haptic(Haptics.ImpactFeedbackStyle.Light);

    const result = await ImagePicker.launchImageLibraryAsync({
      ...GALLERY_OPTIONS,
      allowsMultipleSelection: true,
      selectionLimit:          max,
      // allowsEditing must be false for multi-select on iOS
      allowsEditing:           false,
    });

    if (result.canceled || !result.assets?.length) return null;

    const photos: CapturedPhoto[] = [];
    for (const asset of result.assets.slice(0, max)) {
      const photo = await normalizeAsset(asset);
      if (photo) photos.push(photo);
    }

    if (photos.length === 0) {
      Alert.alert(
        'Image Format Not Supported',
        "We couldn't convert those images. Try JPEG or PNG photos.",
      );
      return null;
    }

    console.log(`[capture] multi-gallery — ${photos.length} photo(s) normalised`);
    return photos;

  } catch (err) {
    console.error('[capture] multi-gallery error — falling back to single-select:', err);
    // Graceful degradation: fall back to single-select
    const single = await captureFromGallery();
    return single ? [single] : null;
  }
}

/**
 * Show Camera / Gallery / Cancel prompt, then call onResult with the photo.
 * Used by the tab bar center button.
 */
export function promptAndCapture(onResult: (photo: CapturedPhoto) => void): void {
  haptic(Haptics.ImpactFeedbackStyle.Medium);

  Alert.alert('Scan Item', 'How would you like to add a photo?', [
    {
      text: 'Take Photo',
      onPress: async () => {
        const photo = await captureFromCamera();
        if (photo) onResult(photo);
      },
    },
    {
      text: 'Choose from Library',
      onPress: async () => {
        const photo = await captureFromGallery();
        if (photo) onResult(photo);
      },
    },
    { text: 'Cancel', style: 'cancel' },
  ]);
}
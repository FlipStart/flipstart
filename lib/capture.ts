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

import { Alert, Platform, Linking } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import * as ImageManipulator from 'expo-image-manipulator';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CapturedPhoto {
  uri:      string;
  base64:   string;
  mimeType: string;
}

// ─── Multi-photo types ────────────────────────────────────────────────────────

export type PhotoSlot = 'front' | 'tag' | 'detail';

/**
 * Up to 3 photos. front is the primary photo sent to the backend.
 * back and tag are optional UI-only slots (no backend change yet).
 * primary is an alias convenience — always equal to front when set.
 */
export type CapturedPhotoSet = {
  front?:   CapturedPhoto;
  detail?:  CapturedPhoto;  // formerly 'back' — flexible: back print, graphic, flaw, close-up
  tag?:     CapturedPhoto;
  primary?: CapturedPhoto;   // alias for front — use front for logic, primary for display
};

export const SLOT_ORDER: PhotoSlot[] = ['front', 'tag', 'detail'];

export const SLOT_LABELS: Record<PhotoSlot, string> = {
  front:  'Front',
  tag:    'Tag',
  detail: 'Graphic',
};

// Slot helper text shown in camera UI
export const SLOT_HELPER: Record<PhotoSlot, string> = {
  front:  'Take a clear front photo.',
  tag:    'Optional: brand, size, or care tag.',
  detail: 'Optional: graphic, back print, flaw, logo, or close-up.',
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

// ─── Camera normalization (unchanged) ────────────────────────────────────────
//
// Camera always outputs JPEG — just verify magic bytes and return.
// No resize needed: camera quality is already controlled by CAMERA_OPTIONS.

async function normalizeAsset(
  asset: ImagePicker.ImagePickerAsset,
): Promise<CapturedPhoto | null> {
  if (!asset.uri) return null;

  const rawBase64   = asset.base64 ?? '';
  const detectedMime = rawBase64 ? detectMimeFromBase64(rawBase64) : null;

  if (detectedMime) {
    console.log(`[capture:camera] format:${detectedMime} size:~${Math.round(rawBase64.length * 0.75 / 1024)}KB`);
    return { uri: asset.uri, base64: rawBase64, mimeType: detectedMime };
  }

  // Camera should never hit this path — log and surface error
  console.warn('[capture:camera] unexpected format — magic bytes undetected');
  return null;
}

// ─── Gallery normalization — resize + compress always ────────────────────────
//
// Gallery images (HEIC, JPEG, PNG) are processed through ImageManipulator
// unconditionally. This solves two problems:
//
//   1. FORMAT — HEIC/HEIF is converted to JPEG (required by AI API)
//   2. SIZE   — Full-res iPhone photos (12MP, 4032×3024, 3–5MB base64) are
//               the primary cause of scan timeouts. Downsizing to 1280px
//               reduces payload by ~70–80% while preserving tag/logo readability.
//
// Camera photos do NOT go through this path — camera output is already
// controlled by CAMERA_OPTIONS and is never the source of timeouts.

// ─── Resize target — derived from what the model can actually see ────────────
//
// gpt-4.1-mini divides an image into 32px patches and caps the count at 1536.
// Anything larger is downscaled by the API BEFORE the model sees it. For a 4:3
// photo that ceiling works out to 45x33 patches = 1440x1056 effective pixels.
//
// Consequences, both counter-intuitive:
//
//   1. A raw 4032x3024 capture and a 1440x1080 capture are IDENTICAL to the
//      model. Both arrive as 1440x1056. Sending the raw file uploads ~2.9MB
//      per photo so the API can discard 88% of it. Pure latency waste.
//
//   2. Resizing BELOW 1440 does cost real detail. The old 1280 target gave the
//      model 1280x960 — 19% fewer pixels than it was willing to process, which
//      is exactly the margin that decides whether an RN number or a copyright
//      date is legible.
//
// So 1440 is the only sensible target: maximum detail the model will accept,
// minimum bytes on the wire. Same constant for camera and gallery — there is no
// reason for the two paths to feed the model differently.
const AI_MAX_PX = 1440;

const GALLERY_MAX_PX  = AI_MAX_PX;
const GALLERY_QUALITY = 0.82;  // tags/logos remain crisp at this compression

// ─── Camera normalization — resize to the model ceiling ──────────────────────
//
// Takes the on-disk URI from takePictureAsync and produces a resized JPEG plus
// base64. Callers should request `base64: false` from the camera: encoding a
// ~2.9MB base64 string only to discard it wastes both time and memory on older
// devices.

export async function normalizeCameraCapture(
  uri: string,
  origW = 0,
  origH = 0,
  label = 'camera',
): Promise<CapturedPhoto | null> {
  if (!uri) return null;
  const startMs = Date.now();

  // Only downsize, never upscale.
  const actions: ImageManipulator.Action[] = [];
  if (origW > AI_MAX_PX || origH > AI_MAX_PX || (!origW && !origH)) {
    if (origW >= origH) actions.push({ resize: { width:  AI_MAX_PX } });
    else                actions.push({ resize: { height: AI_MAX_PX } });
  }

  try {
    const result = await ImageManipulator.manipulateAsync(
      uri,
      actions,
      { compress: GALLERY_QUALITY, format: ImageManipulator.SaveFormat.JPEG, base64: true },
    );
    if (!result.base64) {
      console.warn(`[capture:${label}] manipulator returned no base64`);
      return null;
    }
    const finalKB = Math.round((result.base64.length * 3) / 4 / 1024);
    console.log(
      `[capture:${label}] done — ${result.width ?? '?'}x${result.height ?? '?'} ~${finalKB}KB ` +
      `${Date.now() - startMs}ms${actions.length ? ` (resized from ${origW}x${origH})` : ''}`
    );
    return { uri: result.uri, base64: result.base64, mimeType: 'image/jpeg' };
  } catch (err) {
    console.error(`[capture:${label}] camera resize failed:`, err);
    return null;
  }
}

export async function normalizeGalleryAsset(
  asset: ImagePicker.ImagePickerAsset,
  label = 'gallery',
): Promise<CapturedPhoto | null> {
  if (!asset.uri) return null;

  const startMs = Date.now();
  const origW   = asset.width  ?? 0;
  const origH   = asset.height ?? 0;
  const origMime = (asset.mimeType ?? 'unknown').toLowerCase();

  console.log(
    `[capture:${label}] original — ${origW}×${origH} mime:${origMime}`
  );

  // Only downsize — never upscale. Resize the longest edge to GALLERY_MAX_PX.
  const actions: ImageManipulator.Action[] = [];
  if (origW > GALLERY_MAX_PX || origH > GALLERY_MAX_PX) {
    if (origW >= origH) {
      actions.push({ resize: { width: GALLERY_MAX_PX } });
    } else {
      actions.push({ resize: { height: GALLERY_MAX_PX } });
    }
  }

  try {
    const result = await ImageManipulator.manipulateAsync(
      asset.uri,
      actions,
      {
        compress: GALLERY_QUALITY,
        format:   ImageManipulator.SaveFormat.JPEG,
        base64:   true,
      },
    );

    if (!result.base64) {
      console.warn(`[capture:${label}] manipulator returned no base64`);
      return null;
    }

    const finalKB   = Math.round((result.base64.length * 3) / 4 / 1024);
    const durationMs = Date.now() - startMs;

    console.log(
      `[capture:${label}] done — ${result.width ?? '?'}×${result.height ?? '?'}` +
      ` ~${finalKB}KB jpeg:${GALLERY_QUALITY} ${durationMs}ms` +
      `${actions.length ? ` (resized from ${origW}×${origH})` : ' (no resize needed)'}`
    );

    // Safety check — if final image is still unreasonably large, warn loudly
    if (finalKB > 1800) {
      console.warn(`[capture:${label}] WARNING: final size ${finalKB}KB may cause timeouts`);
    }

    return {
      uri:      result.uri,
      base64:   result.base64,
      mimeType: 'image/jpeg',
    };
  } catch (err) {
    console.error(`[capture:${label}] ImageManipulator failed:`, err);
    return null;
  }
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
  quality:       0.92,   // high quality for sharp preview
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
  quality:       0.92,   // high quality for sharp preview
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
        'Camera Access Needed',
        'FlipStart uses your camera to scan thrifted items and estimate resale value. Enable it in Settings to continue.',
        [
          { text: 'Not Now', style: 'cancel' },
          { text: 'Open Settings', onPress: () => Linking.openSettings() },
        ],
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

    // Request photo library permission with clear context before launching picker.
    // expo-image-picker handles this internally too, but explicit request lets us
    // show a friendly denied message with an "Open Settings" action.
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        'Photo Library Access Needed',
        'FlipStart uses your photo library so you can upload saved item photos for resale analysis. Enable it in Settings to continue.',
        [
          { text: 'Not Now', style: 'cancel' },
          { text: 'Open Settings', onPress: () => Linking.openSettings() },
        ],
      );
      return null;
    }

    const result = await ImagePicker.launchImageLibraryAsync(GALLERY_OPTIONS);
    if (result.canceled || !result.assets?.[0]) return null;

    const photo = await normalizeGalleryAsset(result.assets[0], 'gallery-single');

    if (!photo) {
      Alert.alert(
        'Could Not Process Photo',
        "We couldn't prepare that photo for analysis. Try selecting a different image or take a new photo.",
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
 * Maps to slots: index 0 = front, 1 = tag, 2 = detail.
 */
/**
 * FAST multi-select picker — returns raw assets IMMEDIATELY, with no base64
 * encoding in the picker. The old path set base64:true, which made iOS encode
 * each full-res 12MP photo (~4MB+) inside the picker before returning — then
 * normalizeGalleryAsset re-encoded everything AGAIN. Selecting 3 photos meant
 * 3-9 seconds of nothing on screen.
 *
 * Callers show thumbnails from asset.uri instantly, then run
 * normalizeGalleryAsset per asset (in parallel) to produce the AI-ready
 * base64 JPEG in the background.
 */
export async function pickMultipleFromGallery(
  max = 3,
): Promise<ImagePicker.ImagePickerAsset[] | null> {
  try {
    haptic(Haptics.ImpactFeedbackStyle.Light);

    const existing = await ImagePicker.getMediaLibraryPermissionsAsync();
    if (!existing.granted) {
      if (!existing.canAskAgain) {
        Alert.alert(
          'Photo Library Access Denied',
          'To upload photos, enable Photo Library access in Settings \u2192 FlipStart.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
          ],
        );
        return null;
      }
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') return null;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes:              ['images'] as ImagePicker.MediaType[],
      allowsMultipleSelection: true,
      selectionLimit:          max,
      allowsEditing:           false, // must be false for multi-select on iOS
      base64:                  false, // \u2190 the speed fix: no encode in the picker
      exif:                    false,
    });

    if (result.canceled || !result.assets?.length) return null;
    return result.assets.slice(0, max);
  } catch (err) {
    console.error('[capture] pickMultipleFromGallery error:', err);
    return null;
  }
}

export async function captureMultipleFromGallery(max = 3): Promise<CapturedPhoto[] | null> {
  try {
    haptic(Haptics.ImpactFeedbackStyle.Light);

    const existing = await ImagePicker.getMediaLibraryPermissionsAsync();
    if (!existing.granted) {
      if (!existing.canAskAgain) {
        // Permanently denied — send straight to Settings, no system popup
        Alert.alert(
          'Photo Library Access Denied',
          'To upload photos, enable Photo Library access in Settings → FlipStart.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
          ],
        );
        return null;
      }
      // Not yet asked — request native popup
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        return null;
      }
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      ...GALLERY_OPTIONS,
      allowsMultipleSelection: true,
      selectionLimit:          max,
      // allowsEditing must be false for multi-select on iOS
      allowsEditing:           false,
    });

    if (result.canceled || !result.assets?.length) return null;

    // Parallel — each photo normalizes independently; 3\u00d7 faster than the old
    // sequential await-in-loop for a typical 3-photo pick.
    const normalized = await Promise.all(
      result.assets.slice(0, max).map((asset, i) => {
        const label = ['gallery-front', 'gallery-tag', 'gallery-detail'][i] ?? `gallery-${i}`;
        return normalizeGalleryAsset(asset, label);
      }),
    );
    const photos: CapturedPhoto[] = normalized.filter((p): p is CapturedPhoto => p !== null);

    if (photos.length === 0) {
      Alert.alert(
        'Could Not Process Photos',
        "We couldn't prepare those photos for analysis. Try selecting different images or take new photos.",
      );
      return null;
    }

    console.log(`[capture] multi-gallery — ${photos.length} photo(s) ready`);
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
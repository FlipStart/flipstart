/**
 * lib/savePhoto.ts
 *
 * Saves a scan photo to the user's Photos library (the photo viewer's
 * download button).
 *
 * Asks only for ADD-ONLY access (writeOnly): FlipStart never reads the library
 * here. A hosted photo (https://) is downloaded to the cache first, because
 * the Photos library only accepts a local file.
 *
 * The native modules are loaded LAZILY, on tap. A build made before
 * expo-media-library was added has no such native module; a top-level import
 * crashed the whole app at launch (Expo Router loads every screen up front).
 * Loaded here instead, an older build runs normally and the button reports
 * 'unavailable'.
 */
export type SavePhotoResult = 'saved' | 'denied' | 'failed' | 'unavailable';

/** Extension for the temporary download: Photos needs a real image suffix. */
export function photoExt(uri: string): string {
  const m = /\.(jpe?g|png|heic|webp)(?:[?#]|$)/i.exec(uri);
  return m ? m[1].toLowerCase().replace('jpeg', 'jpg') : 'jpg';
}

export async function savePhotoToLibrary(uri: string): Promise<SavePhotoResult> {
  if (!uri) return 'failed';

  let MediaLibrary: typeof import('expo-media-library');
  let FileSystem: typeof import('expo-file-system/legacy');
  try {
    MediaLibrary = await import('expo-media-library');
    FileSystem = await import('expo-file-system/legacy');
    if (typeof MediaLibrary.saveToLibraryAsync !== 'function') return 'unavailable';
  } catch {
    return 'unavailable';
  }

  try {
    const perm = await MediaLibrary.requestPermissionsAsync(true);
    if (!perm.granted) return 'denied';

    let local = uri;
    if (/^https?:\/\//i.test(uri)) {
      const dir = FileSystem.cacheDirectory;
      if (!dir) return 'failed';
      const target = `${dir}flipstart-photo-${Date.now()}.${photoExt(uri)}`;
      const res = await FileSystem.downloadAsync(uri, target);
      if (res.status < 200 || res.status >= 300) return 'failed';
      local = res.uri;
    }
    await MediaLibrary.saveToLibraryAsync(local);
    return 'saved';
  } catch (e) {
    // A missing native module can also surface on first CALL rather than on import.
    const msg = String((e as Error)?.message ?? e);
    return /native module|ExpoMediaLibrary|not available|Cannot find/i.test(msg) ? 'unavailable' : 'failed';
  }
}
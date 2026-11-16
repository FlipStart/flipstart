/**
 * lib/savePhoto.ts
 *
 * Saves a scan photo to the user's Photos library (the photo viewer's
 * download button).
 *
 * Asks only for ADD-ONLY access (writeOnly): FlipStart never reads the library
 * here. A hosted photo (https://) is downloaded to the cache first, because
 * the Photos library only accepts a local file.
 */
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system/legacy';

export type SavePhotoResult = 'saved' | 'denied' | 'failed';

/** Extension for the temporary download: Photos needs a real image suffix. */
export function photoExt(uri: string): string {
  const m = /\.(jpe?g|png|heic|webp)(?:[?#]|$)/i.exec(uri);
  return m ? m[1].toLowerCase().replace('jpeg', 'jpg') : 'jpg';
}

export async function savePhotoToLibrary(uri: string): Promise<SavePhotoResult> {
  if (!uri) return 'failed';
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
  } catch {
    return 'failed';
  }
}
/**
 * lib/imageUpload.ts
 *
 * Uploads a local photo (image-picker / camera URI) to Supabase Storage and
 * returns its public URL. Currently used ONLY for profile avatars, so they
 * survive logout/login, reinstalls, and appear across devices — local
 * file:// URIs never do.
 *
 * Fail-safe by design: returns null on ANY failure (no session, no network,
 * missing policy, etc.) so callers keep the local URI as a fallback instead
 * of blocking the save flow. Supabase is imported lazily — never at module
 * level (TestFlight startup-crash rule).
 */

async function getSupabase() {
    try {
      const { supabase } = await import('@/lib/supabase');
      return supabase;
    } catch {
      return null;
    }
  }
  
  function extFromUri(uri: string): string {
    const match = uri.match(/\.([a-zA-Z0-9]+)(?:\?.*)?$/);
    const ext = (match?.[1] ?? 'jpg').toLowerCase();
    return ext === 'jpeg' ? 'jpg' : ext;
  }
  
  function mimeFromExt(ext: string): string {
    if (ext === 'png')  return 'image/png';
    if (ext === 'webp') return 'image/webp';
    return 'image/jpeg';
  }
  
  export type UploadBucket = 'avatars' | 'scan-photos';
  
  /**
   * Upload a local image to `{userId}/{filename}` in the given bucket.
   * Returns the public URL, or null on any failure.
   */
  export async function uploadImageToStorage(
    localUri: string,
    bucket: UploadBucket,
    userId: string,
  ): Promise<string | null> {
    try {
      const sb = await getSupabase();
      if (!sb) return null;
  
      const ext      = extFromUri(localUri);
      const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const path     = `${userId}/${filename}`;
  
      // Standard Expo pattern: fetch the local file:// URI → ArrayBuffer.
      // (arrayBuffer is more reliable than blob across Hermes versions.)
      const response = await fetch(localUri);
      const buffer   = await response.arrayBuffer();
  
      const { error } = await sb.storage.from(bucket).upload(path, buffer, {
        contentType: mimeFromExt(ext),
        upsert: true,
      });
      if (error) {
        if (__DEV__) console.warn(`[imageUpload] upload to ${bucket} failed:`, error.message);
        return null;
      }
  
      const { data } = sb.storage.from(bucket).getPublicUrl(path);
      return data?.publicUrl ?? null;
    } catch (err) {
      if (__DEV__) console.warn(`[imageUpload] upload to ${bucket} threw:`, err);
      return null;
    }
  }
  
  /** True if a URI is already a hosted URL rather than a local device file path. */
  export function isRemoteUri(uri: string | null | undefined): boolean {
    return !!uri && /^https?:\/\//.test(uri);
  }
  
  /**
   * Best-effort delete of a previously-uploaded file, given its public URL.
   * Used when an avatar is replaced or removed so old files don't accumulate.
   */
  export async function deleteUploadedImage(publicUrl: string, bucket: UploadBucket): Promise<void> {
    try {
      const sb = await getSupabase();
      if (!sb) return;
      const marker = `/object/public/${bucket}/`;
      const idx = publicUrl.indexOf(marker);
      if (idx === -1) return;
      const path = publicUrl.slice(idx + marker.length);
      if (!path) return;
      const { error } = await sb.storage.from(bucket).remove([path]);
      if (error && __DEV__) console.warn(`[imageUpload] delete from ${bucket} failed:`, error.message);
    } catch (err) {
      if (__DEV__) console.warn(`[imageUpload] delete from ${bucket} threw:`, err);
    }
  }
/**
 * lib/huntPhotos.ts
 *
 * Back up a Hunt find's photos the same way a normal saved scan does
 * (app/results.tsx handleConfirm): the main photo and the Tag / Detail photos
 * go to the `scan-photos` bucket, and only hosted URLs are kept as
 * `extraPhotos`. Without this a hunt kept only its first photo, and history
 * lost the tag and detail evidence.
 *
 * - Runs in the background; a failed upload never affects the hunt.
 * - Already-hosted photos are never uploaded again.
 * - The flip store's foreground retry (useFlipStore.retryPendingPhotoUploads)
 *   picks up anything still local after the hunt is saved.
 */
import { scanPhotosFor } from './scanSessionPhotos';
import { setHuntItemPhotos, type HuntPhoto } from './hunt-context';

const isRemote = (u: string | null | undefined) => !!u && /^https?:\/\//.test(u);

/**
 * The Tag / Detail photos this session took for the scan. Local paths are
 * included on purpose: they are saved straight away so the hunt record holds
 * them even if the upload is still running when the app is closed.
 */
export function sessionExtraPhotos(scanId: string): HuntPhoto[] {
  return (scanPhotosFor(scanId) ?? []).filter(
    (p): p is HuntPhoto => (p.label === 'Tag' || p.label === 'Detail') && !!p.uri,
  ).map(p => ({ uri: p.uri, label: p.label }));
}

export async function backUpHuntItemPhotos(
  scanId: string,
  mainUri: string,
  userId: string | null | undefined,
): Promise<void> {
  const extras = sessionExtraPhotos(scanId);
  // Record the local extras immediately so they survive with the hunt.
  if (extras.length > 0) setHuntItemPhotos(scanId, { extraPhotos: extras });
  if (!userId) return;

  let upload: (uri: string, bucket: 'scan-photos', uid: string) => Promise<string | null>;
  try {
    ({ uploadImageToStorage: upload } = await import('./imageUpload') as any);
  } catch { return; }

  try {
    if (mainUri && !isRemote(mainUri)) {
      const url = await upload(mainUri, 'scan-photos', userId).catch(() => null);
      if (url) setHuntItemPhotos(scanId, { imageUri: url });
    }
    if (extras.length > 0) {
      const done = await Promise.all(extras.map(async p => {
        if (isRemote(p.uri)) return p;
        const url = await upload(p.uri, 'scan-photos', userId).catch(() => null);
        return url ? { uri: url, label: p.label } : p;   // keep local; retried later
      }));
      setHuntItemPhotos(scanId, { extraPhotos: done });
    }
  } catch { /* never breaks the hunt */ }
}
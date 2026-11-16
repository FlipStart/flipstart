/**
 * lib/viewerPhotos.ts
 *
 * Which photos the full-screen viewer shows for a scan, on every screen that
 * has one (results, Scan Record, Deep Analysis):
 *
 *   1. this session's photos (front, tag, detail) when the scan was just taken
 *   2. otherwise the saved scan's main photo plus any saved extra photos
 *      (tag / detail, uploaded when the scan was saved)
 *   3. otherwise nothing
 *
 * Empty and duplicate URIs are dropped.
 */
import { scanPhotosFor } from './scanSessionPhotos';

export interface ViewerPhoto { uri: string; label?: string }
export interface ExtraPhoto { uri: string; label: 'Tag' | 'Detail' }

export function viewerPhotosFor(
  scanId: string | null | undefined,
  mainUri: string | null | undefined,
  extras?: ExtraPhoto[] | null,
): ViewerPhoto[] {
  const session = scanPhotosFor(scanId);
  if (session && session.length > 0) return dedupe(session);
  const list: ViewerPhoto[] = [];
  if (mainUri) list.push({ uri: mainUri, label: extras && extras.length ? 'Front' : undefined });
  for (const e of extras ?? []) if (e?.uri) list.push({ uri: e.uri, label: e.label });
  return dedupe(list);
}

function dedupe(list: ViewerPhoto[]): ViewerPhoto[] {
  const seen = new Set<string>();
  return list.filter(p => {
    if (!p?.uri || seen.has(p.uri)) return false;
    seen.add(p.uri);
    return true;
  });
}
/**
 * lib/scanSessionPhotos.ts
 *
 * The photos the user took for a scan (front, tag, detail), kept in memory
 * so the results screen's photo viewer can swipe through them.
 *
 * Memory only, on purpose: nothing here is saved to history or uploaded. The
 * extra photos are local files that may not exist next time the app opens, so
 * a saved scan keeps showing just its main photo, exactly as before.
 */

export interface SessionPhoto {
    uri:   string;
    label: 'Front' | 'Tag' | 'Detail';
  }
  
  const KEEP = 5;
  const store = new Map<string, SessionPhoto[]>();
  
  export function rememberScanPhotos(scanId: string, photos: Array<SessionPhoto | null | undefined>): void {
    const list = photos.filter((p): p is SessionPhoto => !!p && typeof p.uri === 'string' && p.uri.length > 0);
    if (!scanId || list.length === 0) return;
    store.delete(scanId);
    store.set(scanId, list);
    while (store.size > KEEP) store.delete(store.keys().next().value as string);
  }
  
  /** The photos for this scan, or null when this session didn't take them. */
  export function scanPhotosFor(scanId: string | null | undefined): SessionPhoto[] | null {
    return scanId ? store.get(scanId) ?? null : null;
  }
  
  /** Test seam. */
  export function __resetScanPhotos(): void { store.clear(); }
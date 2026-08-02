/**
 * server/scanContextStore.ts
 *
 * Server-owned storage for confirmed camera context, keyed by analysis.
 *
 * Exists because Generate Listings must not trust a client-supplied context
 * string: anyone could post arbitrary text at listing time and have it written
 * into a listing that never went through analysis or entitlement. The listing
 * endpoint therefore looks the context up by analysis id and verifies the
 * caller owns that analysis.
 *
 * In-memory with a TTL rather than persisted to disk. Listings are generated
 * minutes after a scan, not days, and keeping typed personal details out of the
 * durable store is the safer default — a restart losing a context only means a
 * listing generated without it.
 */
export interface StoredScanContext {
  analysisId: string;
  scanAttemptId: string;
  /** Ownership check for Generate Listings. */
  ownerId: string;
  text: string;
  hash: string | null;
  /** What the model concluded FROM the note — normalised and validated. The
   *  listing writer needs these, not just the user's raw words. */
  confirmedFacts: string[];
  savedAt: number;
}

const TTL_MS = 6 * 60 * 60 * 1000;   // 6 hours
const MAX_ENTRIES = 500;

const store = new Map<string, StoredScanContext>();

function prune(): void {
  const now = Date.now();
  for (const [k, v] of store) {
    if (now - v.savedAt > TTL_MS) store.delete(k);
  }
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value as string | undefined;
    if (!oldest) break;
    store.delete(oldest);
  }
}

export function saveScanContext(entry: Omit<StoredScanContext, "savedAt">): void {
  if (!entry.text) return;             // nothing to store
  prune();
  store.set(entry.analysisId, { ...entry, savedAt: Date.now() });
  // Hash only. The raw text must not appear in logs.
  console.log(`[context] stored — analysis:${entry.analysisId.slice(0, 8)} hash:${entry.hash}`);
}

/**
 * Look up context for an analysis. Returns null when it does not exist, has
 * expired, or belongs to someone else — the caller cannot tell which, so a
 * probing client learns nothing about other users' scans.
 */
export function getScanContext(analysisId: string, ownerId: string): StoredScanContext | null {
  prune();
  const hit = store.get(analysisId);
  if (!hit) return null;
  if (!ownerId || hit.ownerId !== ownerId) {
    console.warn(`[context] ownership mismatch on analysis:${analysisId.slice(0, 8)}`);
    return null;
  }
  return hit;
}

/** Used by scan and account deletion. */
export function deleteScanContext(analysisId: string): void {
  store.delete(analysisId);
}

export function deleteAllScanContextFor(ownerId: string): number {
  let n = 0;
  for (const [k, v] of store) {
    if (v.ownerId === ownerId) { store.delete(k); n++; }
  }
  return n;
}
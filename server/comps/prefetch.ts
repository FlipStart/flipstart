/**
 * server/comps/prefetch.ts
 *
 * Starts the sold-comps search the moment a scan's analysis is saved, instead
 * of waiting for the app to show the results screen and ask. The app's request
 * then picks up the search already running (or finished), so the comps appear
 * that much sooner. Same searches, same budget, same cache: the work is only
 * moved earlier, never done twice.
 *
 * Each prefetch is used once, by the verified owner, within two minutes.
 * Started only when the app asks (prefetchComps, sent by builds after 2.2 for
 * non-Hunt scans) and the scan is not a soft fail. COMPS_PREFETCH=false turns
 * it off.
 */
import type { CompsRunRecord } from "./index.js";

const TTL_MS = 2 * 60_000;
const MAX = 500;

interface Pending { uid: string; at: number; p: Promise<CompsRunRecord | null> }
const pending = new Map<string, Pending>();

export function compsPrefetchEnabled(): boolean {
  return (process.env.COMPS_PREFETCH ?? "").trim().toLowerCase() !== "false";
}

function sweep(now: number): void {
  for (const [k, v] of pending) if (now - v.at > TTL_MS) pending.delete(k);
  while (pending.size > MAX) pending.delete(pending.keys().next().value as string);
}

/** Start the comps run for this analysis now. Never throws. */
export function startCompsPrefetch(analysisId: string, uid: string, run: () => Promise<CompsRunRecord>): void {
  if (!analysisId || !uid || !compsPrefetchEnabled()) return;
  const now = Date.now();
  sweep(now);
  if (pending.has(analysisId)) return;
  let p: Promise<CompsRunRecord | null>;
  try {
    p = run().catch(err => {
      console.warn(`[comps:prefetch] failed: ${String((err as Error)?.message ?? err).slice(0, 120)}`);
      return null;
    });
  } catch {
    return;
  }
  pending.set(analysisId, { uid, at: now, p });
}

/**
 * The prefetched run for this analysis, if this owner started one in the last
 * two minutes. Consumed: a second request runs normally (and hits the cache).
 */
export async function takePrefetchedComps(analysisId: string, uid: string): Promise<CompsRunRecord | null> {
  const hit = pending.get(analysisId);
  if (!hit || hit.uid !== uid) return null;
  pending.delete(analysisId);
  if (Date.now() - hit.at > TTL_MS) return null;
  return hit.p;
}

/** Test seam. */
export function __resetCompsPrefetch(): void { pending.clear(); }
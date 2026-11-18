/**
 * lib/useHuntComps.ts
 *
 * The Hunt screen's view of Sold Comps: a snapshot when the item has one,
 * otherwise one live search through the same `comps.forScan` the normal results
 * screen uses. Never blocks the screen, never throws, never searches twice for
 * the same item (lib/huntComps.ts is the single-flight + snapshot layer).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/lib/auth-context';
import { logEvent } from '@/lib/analytics';
import { setHuntItemComps } from '@/lib/hunt-context';
import { isHuntDemoActive } from '@/lib/huntDemoMode';
import {
  loadHuntComps, readCompsSnapshot, toCompsSnapshot, compsResultPayload, deriveHuntComps,
  type HuntCompsSource,
} from '@/lib/huntComps';
import type { SoldCompsResponse } from '@/components/comps/SoldCompsSection';

/** A search that has not answered by now shows the honest "unavailable" state. */
const CLIENT_TIMEOUT_MS = 30_000;

export interface UseHuntCompsArgs {
  huntItemId:  string | null;
  scanId:      string | null;
  analysisId?: string | null;
  /** The item's saved snapshot (live item or saved bundle item). */
  snapshot?:   unknown;
  /** false in Hunt History: show a snapshot or the honest unavailable state. */
  allowFetch:  boolean;
  /** Hunt (or bundle) id, for analytics. */
  huntId?:     string | null;
}

export function useHuntComps(a: UseHuntCompsArgs): {
  loading: boolean; data: SoldCompsResponse | null; source: HuntCompsSource | null;
} {
  const { user } = useAuth();
  const forScan = trpc.comps.forScan.useMutation();
  const mutateRef = useRef(forScan.mutateAsync);
  mutateRef.current = forScan.mutateAsync;

  const snapshotData = useMemo(() => readCompsSnapshot(a.snapshot), [a.snapshot]);
  const [live, setLive] = useState<{ key: string; data: SoldCompsResponse | null; source: HuntCompsSource } | null>(null);
  const reportedRef = useRef<string | null>(null);

  const key = a.huntItemId ?? '';
  // The demo never asks the (metered) comps endpoint.
  const needsSearch = !!a.huntItemId && !snapshotData && a.allowFetch && !!a.analysisId && !isHuntDemoActive();

  useEffect(() => {
    if (!needsSearch || !a.huntItemId) return;
    let cancelled = false;
    const started = Date.now();
    (async () => {
      const { getScannerId } = await import('@/lib/analytics');
      const scannerId = user?.id ?? await getScannerId().catch(() => undefined);
      const res = await loadHuntComps({
        huntItemId: a.huntItemId as string,
        analysisId: a.analysisId,
        existing:   a.snapshot,
        allowFetch: a.allowFetch,
        fetcher: () => {
          if (!scannerId) return Promise.resolve(null);
          return Promise.race([
            mutateRef.current({ scannerId, analysisId: a.analysisId as string }) as Promise<SoldCompsResponse>,
            new Promise<null>(r => setTimeout(() => r(null), CLIENT_TIMEOUT_MS)),
          ]);
        },
        persist: snap => setHuntItemComps(a.huntItemId as string, snap),
      });
      // Report first: saving the snapshot re-renders and cancels this effect,
      // but the search did happen and is counted as a live result.
      report(res.data, res.source, Date.now() - started);
      if (cancelled) return;
      setLive({ key, data: res.data, source: res.source });
    })().catch(() => { /* loadHuntComps never rejects; nothing to surface */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsSearch, a.huntItemId, a.analysisId]);

  // A search that finished before the item existed in the hunt (a brand-new
  // scan) is saved as soon as the item is there.
  useEffect(() => {
    if (!a.huntItemId || snapshotData || !live || live.key !== key || live.source !== 'live' || !live.data) return;
    const snap = toCompsSnapshot(live.data, a.analysisId ?? undefined);
    if (snap) setHuntItemComps(a.huntItemId, snap);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, snapshotData, a.huntItemId]);

  // One result event per item per screen visit.
  function report(data: SoldCompsResponse | null, source: HuntCompsSource, ms: number) {
    if (!a.huntItemId || reportedRef.current === a.huntItemId) return;
    reportedRef.current = a.huntItemId;
    reportCompsResult({ huntId: a.huntId, huntItemId: a.huntItemId, scanId: a.scanId, data, source, ms });
  }
  useEffect(() => {
    // Snapshot / no-search paths report once, immediately.
    if (!a.huntItemId || needsSearch) return;
    report(snapshotData, snapshotData ? 'snapshot' : 'none', 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.huntItemId, needsSearch, !!snapshotData]);

  return deriveHuntComps({ snapshotData, live, key, needsSearch });
}

function reportCompsResult(p: Parameters<typeof compsResultPayload>[0]): void {
  try { logEvent('hunt_sold_comps_result', compsResultPayload(p)); } catch { /* analytics never breaks the screen */ }
}
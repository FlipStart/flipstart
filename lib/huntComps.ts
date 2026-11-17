/**
 * lib/huntComps.ts
 *
 * Sold Comps for Hunt Mode — the production comps system, reused as is.
 *
 * ── What is (and is not) here ────────────────────────────────────────────────
 * There is NO relevance logic in this file. Matching, tiers (Exact / Strong /
 * Similar), duplicate filtering and statistics all happen on the server in the
 * same `comps.forScan` call the normal results screen makes. This module only
 * decides WHEN to ask, remembers the answer with the Hunt item, and hands the
 * production SoldCompsSection the same payload shape it already renders.
 *
 * ── Snapshot ─────────────────────────────────────────────────────────────────
 * The server keeps an analysis for ~7 days in memory (gone on redeploy), so a
 * Hunt item that only remembered an analysis id would lose its comps. When a
 * search returns something worth keeping, the PUBLIC contract (≤3 cards, stats,
 * confidence, availability, source) is saved on the item. Restart, finishing the
 * Hunt, Hunt History, cache expiry and redeploys all read that snapshot and
 * never ask the server again.
 *
 * Founder / debug fields are never copied: the snapshot is built by whitelist.
 *
 * ── One search per item ──────────────────────────────────────────────────────
 * Concurrent callers join one in-flight request, and a snapshot short-circuits
 * everything. A failed search is not retried for a short cooldown so a screen
 * that re-mounts cannot hammer the (metered) endpoint.
 */
import type { HuntCompsSnapshot } from './hunt-context';
import type { SoldCompsResponse } from '@/components/comps/SoldCompsSection';

/** How many cards the section ever shows. */
export const HUNT_COMPS_MAX_CARDS = 3;
/** After a search that was not saved, wait this long before asking again. */
export const HUNT_COMPS_RETRY_COOLDOWN_MS = 45_000;

export type HuntCompsSource = 'snapshot' | 'live' | 'none';
export type HuntCompsOutcome = 'loaded' | 'empty' | 'unavailable';

export interface HuntCompsResult {
  source:   HuntCompsSource;
  /** Payload for <SoldCompsSection data=…>. null → the section's legacy state. */
  data:     SoldCompsResponse | null;
  /** True when a new snapshot was written for this call. */
  saved:    boolean;
}

// ─── Snapshot build / read ────────────────────────────────────────────────────

const CARD_FIELDS = [
  'id', 'marketplace', 'fullTitle', 'primaryImageUrl', 'fallbackImageUrl', 'imageStatus',
  'soldPrice', 'shippingPrice', 'buyerPaidTotal', 'soldAt', 'bestOfferAccepted',
  'matchScore', 'matchClass', 'tier',
] as const;

/** Only the fields a comp card reads. Debug / rejection data never passes. */
function pickCard(m: any): Record<string, unknown> | null {
  if (!m || typeof m !== 'object' || typeof m.id !== 'string') return null;
  const out: Record<string, unknown> = {};
  for (const k of CARD_FIELDS) if (m[k] !== undefined) out[k] = m[k];
  return out;
}

/**
 * Should this response be saved?
 *  - cards present                      → yes (the evidence)
 *  - a search ran and found nothing     → yes (re-asking would not change it)
 *  - timeout / provider failure / legacy → NO (a later open should try again)
 */
export function isSavableCompsResponse(res: SoldCompsResponse | null | undefined): boolean {
  if (!res || typeof res !== 'object') return false;
  const st = res.availability?.state;
  if (st === 'temporarily_unavailable' || st === 'legacy_unavailable') return false;
  if (!st && res.ok === false) return false;
  if ((res.displayMatches ?? []).some(m => pickCard(m))) return true;
  return (st === 'no_reliable_matches' && res.availability?.searchPerformed === true)
      || st === 'insufficient_item_details';
}

/** Whitelist the public contract into a snapshot. null when not worth saving. */
export function toCompsSnapshot(
  res: SoldCompsResponse | null | undefined,
  analysisId?: string,
  now: number = Date.now(),
): HuntCompsSnapshot | null {
  if (!isSavableCompsResponse(res)) return null;
  const r = res as SoldCompsResponse;
  const cards = (r.displayMatches ?? [])
    .map(pickCard).filter((m): m is Record<string, unknown> => !!m)
    .slice(0, HUNT_COMPS_MAX_CARDS);
  const response: Record<string, unknown> = {
    ok: true,
    availability: r.availability ?? null,
    displayMatches: cards,
    publicStats: r.publicStats ?? null,
    confidenceLabel: r.confidenceLabel ?? null,
    confidencePercent: r.confidencePercent ?? null,
    countSummary: r.countSummary ?? null,
    source: r.source ?? null,
    query: r.query ?? null,
    historyDays: r.historyDays ?? null,
    dataStrength: r.dataStrength ?? null,
  };
  return { v: 1, savedAt: now, ...(analysisId ? { analysisId } : {}), response };
}

/** A usable snapshot, or null (absent, wrong version, malformed). */
export function readCompsSnapshot(raw: unknown): SoldCompsResponse | null {
  const snap = raw as Partial<HuntCompsSnapshot> | null | undefined;
  if (!snap || typeof snap !== 'object' || snap.v !== 1) return null;
  const r = snap.response as any;
  if (!r || typeof r !== 'object' || !Array.isArray(r.displayMatches)) return null;
  return r as SoldCompsResponse;
}

export function hasCompsSnapshot(raw: unknown): boolean {
  return readCompsSnapshot(raw) !== null;
}

/** loaded = cards to show · empty = searched, nothing reliable · unavailable = no answer. */
export function compsOutcome(data: SoldCompsResponse | null | undefined): HuntCompsOutcome {
  if (!data) return 'unavailable';
  if ((data.displayMatches ?? []).length > 0) return 'loaded';
  const st = data.availability?.state;
  return st === 'no_reliable_matches' || st === 'insufficient_item_details' ? 'empty' : 'unavailable';
}

/** Shown when a search ran out of time or failed. Same shape the server sends. */
export const COMPS_TEMP_UNAVAILABLE: SoldCompsResponse = {
  ok: false,
  availability: { state: 'temporarily_unavailable', reviewedCount: null, filteredOutCount: null, searchPerformed: false },
};

/** hunt_sold_comps_result payload (pure; the hook sends it). */
export function compsResultPayload(p: {
  huntId?: string | null; huntItemId: string; scanId?: string | null;
  data: SoldCompsResponse | null; source: HuntCompsSource; ms: number;
}): Record<string, unknown> {
  const matches = p.data?.displayMatches ?? [];
  const tierCount = (t: string) => matches.filter(m => m.tier === t).length;
  return {
    hunt_id: p.huntId ?? null,
    hunt_item_id: p.huntItemId,
    scan_id: p.scanId ?? null,
    outcome: compsOutcome(p.data),
    source: p.source,
    comp_count: matches.length,
    exact: tierCount('exact'), strong: tierCount('strong'), similar: tierCount('similar'),
    availability: p.data?.availability?.state ?? null,
    ...(p.source === 'live' ? { duration_ms: Math.max(0, Math.round(p.ms)) } : {}),
  };
}

// ─── Load (single flight) ─────────────────────────────────────────────────────

const inflight = new Map<string, Promise<HuntCompsResult>>();
const cooldown = new Map<string, number>();

export interface LoadHuntCompsArgs {
  huntItemId: string;
  analysisId?: string | null;
  /** The item's saved snapshot, if any. */
  existing?: unknown;
  /** The production request: comps.forScan({ scannerId, analysisId }). */
  fetcher: () => Promise<SoldCompsResponse | null | undefined>;
  /** Writes the snapshot on the item. Returns false when the item is gone. */
  persist?: (snap: HuntCompsSnapshot) => boolean;
  /** Allow a live search when there is no snapshot. History passes false. */
  allowFetch?: boolean;
  now?: () => number;
}

export function loadHuntComps(a: LoadHuntCompsArgs): Promise<HuntCompsResult> {
  const saved = readCompsSnapshot(a.existing);
  if (saved) return Promise.resolve({ source: 'snapshot', data: saved, saved: false });

  // Old item, or one opened where a search is not allowed: honest unavailable.
  if (a.allowFetch === false || !a.analysisId) {
    return Promise.resolve({ source: 'none', data: null, saved: false });
  }

  const key = a.huntItemId;
  const running = inflight.get(key);
  if (running) return running;

  const now = a.now ?? Date.now;
  const waitUntil = cooldown.get(key) ?? 0;
  if (now() < waitUntil) return Promise.resolve({ source: 'live', data: COMPS_TEMP_UNAVAILABLE, saved: false });

  const p = (async (): Promise<HuntCompsResult> => {
    try {
      const res = await a.fetcher();
      const snap = toCompsSnapshot(res, a.analysisId ?? undefined, now());
      if (snap) {
        cooldown.delete(key);
        const ok = a.persist ? a.persist(snap) : false;
        return { source: 'live', data: snap.response as SoldCompsResponse, saved: ok };
      }
      cooldown.set(key, now() + HUNT_COMPS_RETRY_COOLDOWN_MS);
      return { source: 'live', data: res ?? COMPS_TEMP_UNAVAILABLE, saved: false };
    } catch {
      cooldown.set(key, now() + HUNT_COMPS_RETRY_COOLDOWN_MS);
      return { source: 'live', data: COMPS_TEMP_UNAVAILABLE, saved: false };
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

/**
 * What the screen shows right now. A snapshot always wins; otherwise the live
 * answer for THIS item; otherwise a skeleton while a search is possible.
 */
export function deriveHuntComps(s: {
  snapshotData: SoldCompsResponse | null;
  live: { key: string; data: SoldCompsResponse | null; source: HuntCompsSource } | null;
  key: string;
  needsSearch: boolean;
}): { loading: boolean; data: SoldCompsResponse | null; source: HuntCompsSource | null } {
  if (s.snapshotData) return { loading: false, data: s.snapshotData, source: 'snapshot' };
  if (s.live && s.live.key === s.key) return { loading: false, data: s.live.data, source: s.live.source };
  return { loading: s.needsSearch, data: null, source: s.needsSearch ? null : 'none' };
}

/** Test seam. */
export function __resetHuntCompsForTests(): void {
  inflight.clear();
  cooldown.clear();
}
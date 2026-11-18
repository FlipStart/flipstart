/**
 * lib/huntCompletion.ts
 *
 * Finishing a Hunt through the server, and the queue for when that can't happen
 * right now.
 *
 * Hunt XP is awarded by the SERVER (server/hunt/completeHunt.ts). The phone only
 * says which scans were kept and what price was typed for each; the server works
 * out the XP from its own record of those scans and sends back the result.
 *
 * ── When the server can't be reached ────────────────────────────────────────
 * The Hunt is still saved to history straight away. Its XP is "pending": the
 * request is kept here, per account, and sent again when the app next opens or
 * comes back to the front. The server awards a Hunt exactly once however many
 * times it is asked, so retrying is always safe.
 *
 * Nothing here calculates XP.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { HuntBundle, HuntBundleItem } from '@/types/flip';
import type { XpBreakdownItem } from '@shared/hunt/xpRules';

export interface CompletionItem { analysisId: string; kept: boolean; thriftPrice: number }
export interface CompletionPayload { huntId: string; items: CompletionItem[]; queuedAt?: number }

/** What the server's hunt.complete returns on success. */
export interface ServerProfile {
  totalXp:              number;
  currentRank:          string;
  completedHunts:       number;
  huntStreak:           number;
  lastHuntDate:         string | null;
  weekStreak:           number;
  discoveredBrands:     string[];
  discoveredCategories: string[];
}
export interface ServerCompletion {
  status:          'awarded' | 'already' | 'empty';
  xpEarned:        number;
  breakdown:       XpBreakdownItem[];
  previousTotalXp: number;
  newTotalXp:      number;
  qualifies:       boolean;
  bestHuntScore:   number;
  cappedBigFinds:  number;
  foundingHunter:  boolean;
  profile:         ServerProfile | null;
}

export type SendOutcome =
  | { kind: 'done'; result: ServerCompletion }
  /** Not now (offline, timeout, server busy, session not ready). Queue it. */
  | { kind: 'retry' }
  /** The server will never accept this request. Drop it. */
  | { kind: 'rejected' };

export const COMPLETION_TIMEOUT_MS = 12_000;
const MAX_QUEUED = 20;
const queueKey = (uid: string) => `@flipstart/huntCompletionQueue:${uid}`;

const analysisIdOf = (i: HuntBundleItem): string | null => {
  const id = i.analysisId ?? (i.scanSnapshot as any)?.identification?.v1?.analysisId ?? (i.scanSnapshot as any)?.analysisId;
  return typeof id === 'string' && id ? id : null;
};

/** The whole request: which server-analysed scans were kept, and at what typed price. */
export function completionPayloadFor(bundle: HuntBundle): CompletionPayload {
  const items: CompletionItem[] = [];
  const seen = new Set<string>();
  const push = (i: HuntBundleItem, kept: boolean) => {
    const analysisId = analysisIdOf(i);
    if (!analysisId || seen.has(analysisId)) return;
    seen.add(analysisId);
    const p = Number(i.thriftPrice);
    items.push({ analysisId, kept, thriftPrice: Number.isFinite(p) && p > 0 ? Math.min(p, 100_000) : 0 });
  };
  for (const i of bundle.keptItems ?? []) push(i, true);
  for (const i of bundle.removedItems ?? []) push(i, false);
  return { huntId: bundle.id, items: items.slice(0, 300) };
}

// ─── Transport ────────────────────────────────────────────────────────────────

type Transport = (payload: CompletionPayload) => Promise<any>;
let transportOverride: Transport | null = null;
/** Tests only. */
export function __setCompletionTransportForTests(t: Transport | null): void { transportOverride = t; }

async function defaultTransport(payload: CompletionPayload): Promise<any> {
  const { createTRPCClient } = await import('@/lib/trpc');
  return createTRPCClient().hunt.complete.mutate({ huntId: payload.huntId, items: payload.items });
}

/** Ask the server to finish this Hunt. Never throws. */
export async function sendCompletion(payload: CompletionPayload, timeoutMs = COMPLETION_TIMEOUT_MS): Promise<SendOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const res: any = await Promise.race([
      (transportOverride ?? defaultTransport)(payload),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), timeoutMs); }),
    ]);
    if (res?.ok === true && typeof res.status === 'string') {
      return { kind: 'done', result: res as ServerCompletion };
    }
    if (res?.ok === false && res.reason === 'BAD_REQUEST') return { kind: 'rejected' };
    return { kind: 'retry' };
  } catch {
    return { kind: 'retry' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ─── Queue ────────────────────────────────────────────────────────────────────

async function readQueue(uid: string): Promise<CompletionPayload[]> {
  try {
    const raw = await AsyncStorage.getItem(queueKey(uid));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter(p => p && typeof p.huntId === 'string' && Array.isArray(p.items))
      : [];
  } catch { return []; }
}

async function writeQueue(uid: string, q: CompletionPayload[]): Promise<void> {
  try {
    if (q.length === 0) await AsyncStorage.removeItem(queueKey(uid));
    else await AsyncStorage.setItem(queueKey(uid), JSON.stringify(q.slice(-MAX_QUEUED)));
  } catch { /* tried again on the next flush */ }
}

/** Keep a Hunt's request for later. One entry per Hunt. */
export async function enqueueCompletion(uid: string, payload: CompletionPayload): Promise<void> {
  if (!uid || !payload?.huntId) return;
  const q = (await readQueue(uid)).filter(p => p.huntId !== payload.huntId);
  q.push({ ...payload, queuedAt: Date.now() });
  await writeQueue(uid, q);
}

/** Hunt ids whose XP is still waiting on the server. */
export async function pendingCompletionIds(uid: string | null | undefined): Promise<string[]> {
  return uid ? (await readQueue(uid)).map(p => p.huntId) : [];
}

const flushing = new Set<string>();

/**
 * Send every waiting request. `onDone` is called for each one the server
 * answered, before it leaves the queue. Returns how many were settled.
 * One flush per account at a time; safe to call often.
 */
export async function flushCompletions(
  uid: string | null | undefined,
  onDone: (huntId: string, result: ServerCompletion) => void | Promise<void>,
): Promise<number> {
  if (!uid || flushing.has(uid)) return 0;
  flushing.add(uid);
  let settled = 0;
  try {
    const queue = await readQueue(uid);
    for (const payload of queue) {
      const out = await sendCompletion(payload);
      if (out.kind === 'retry') break;                 // still unreachable: keep the rest for next time
      if (out.kind === 'done') {
        try { await onDone(payload.huntId, out.result); } catch { /* the award stands regardless */ }
      }
      settled += 1;
      // Re-read before writing: a Hunt may have been queued while this one was in flight.
      await writeQueue(uid, (await readQueue(uid)).filter(p => p.huntId !== payload.huntId));
    }
  } finally {
    flushing.delete(uid);
  }
  return settled;
}
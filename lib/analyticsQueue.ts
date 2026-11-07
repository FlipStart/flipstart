/**
 * lib/analyticsQueue.ts
 *
 * Holds analytics events the phone couldn't send — no signal in a thrift
 * store, a dropped connection — and sends them once it can (Phase 6 of the
 * scan-failure plan). Before this, an event written offline was simply lost,
 * so failures caused by a bad connection were the ones least likely to be
 * counted.
 *
 * ── Rules ───────────────────────────────────────────────────────────────────
 *   - Saved to the phone's storage, so a queued event survives the app closing.
 *   - Oldest first. While anything is waiting, new events join the back of the
 *     line instead of jumping it.
 *   - A row the server REJECTS (not a connection problem) is dropped, never
 *     retried forever.
 *   - Bounded: at most `max` rows, each kept at most `maxAgeMs` and refused
 *     by the server at most `maxAttempts` times. Past that it is dropped,
 *     oldest first. Getting no answer at all (offline) never counts as a try.
 *   - Every row carries a client_event_id. If a send got through but its
 *     answer was lost, the retry is recognised as a duplicate by the database
 *     and counted as delivered (see lib/analytics.ts), so nothing is counted
 *     twice.
 *
 * No React Native imports: storage, sending and the clock are passed in, so
 * the rules above are tested directly.
 */

/**
 * ok      — stored (or already stored)
 * offline — no answer at all; doesn't count as a try, so a long dead zone never uses up a row's tries
 * retry   — the server answered but couldn't take it now (overloaded, session expired)
 * drop    — the server refused it for good
 */
export type SendResult = "ok" | "offline" | "retry" | "drop";

export interface QueueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export interface QueuedEvent {
  row: Record<string, unknown>;
  /** When it was first queued. */
  at: number;
  tries: number;
}

export interface EventQueueOptions {
  storage: QueueStorage;
  send: (row: Record<string, unknown>) => Promise<SendResult>;
  key: string;
  max?: number;
  maxAttempts?: number;
  maxAgeMs?: number;
  retryMs?: number;
  /** Rows sent per flush, so one flush never runs for long. */
  batch?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
}

export interface EventQueue {
  /** Send now if nothing is waiting; otherwise queue behind what is. */
  deliver(row: Record<string, unknown>): Promise<void>;
  /** Try to send what is waiting. Safe to call any time, as often as wanted. */
  flush(): Promise<void>;
  size(): Promise<number>;
}

export function createEventQueue(o: EventQueueOptions): EventQueue {
  const max = o.max ?? 300;
  const maxAttempts = o.maxAttempts ?? 20;
  const maxAgeMs = o.maxAgeMs ?? 7 * 24 * 60 * 60 * 1000;
  const retryMs = o.retryMs ?? 30_000;
  const batch = o.batch ?? 50;
  const now = o.now ?? (() => Date.now());
  const setTimer = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms));

  let items: QueuedEvent[] | null = null;
  let loading: Promise<QueuedEvent[]> | null = null;
  let saving: Promise<void> = Promise.resolve();
  let flushing: Promise<void> | null = null;
  let timerSet = false;

  const load = (): Promise<QueuedEvent[]> => {
    if (items) return Promise.resolve(items);
    if (!loading) {
      loading = (async () => {
        let parsed: QueuedEvent[] = [];
        try {
          const raw = await o.storage.getItem(o.key);
          const v = raw ? JSON.parse(raw) : [];
          if (Array.isArray(v)) {
            parsed = v.filter((x: any) => x && typeof x === "object" && x.row && typeof x.row === "object"
              && typeof x.at === "number" && typeof x.tries === "number");
          }
        } catch { parsed = []; }
        items = parsed;
        return items;
      })();
    }
    return loading;
  };

  /** Writes run one after another, each saving the latest state. */
  const save = (): Promise<void> => {
    saving = saving.then(async () => {
      try { await o.storage.setItem(o.key, JSON.stringify(items ?? [])); } catch { /* best effort */ }
    });
    return saving;
  };

  const prune = (list: QueuedEvent[]) => {
    const t = now();
    const kept = list.filter(x => x.tries < maxAttempts && t - x.at < maxAgeMs);
    // Over the cap: the oldest go first.
    return kept.length > max ? kept.slice(kept.length - max) : kept;
  };

  const scheduleRetry = () => {
    if (timerSet) return;
    timerSet = true;
    setTimer(() => { timerSet = false; void flush(); }, retryMs);
  };

  // Always read and replace `items` itself, never a copy taken before an
  // await: a flush running at the same time replaces the array as it goes.
  const push = async (row: Record<string, unknown>) => {
    await load();
    items = prune([...(items ?? []), { row, at: now(), tries: 1 }]);
    await save();
    scheduleRetry();
  };

  const safeSend = async (row: Record<string, unknown>): Promise<SendResult> => {
    try { return await o.send(row); } catch { return "offline"; }
  };

  /** One pass: send from the front until something fails to go, or a batch is done. */
  const pass = async () => {
    await load();
    items = prune(items ?? []);
    let sent = 0;
    while (items.length && sent < batch) {
      const head: QueuedEvent = items[0];
      const r = await safeSend(head.row);
      sent++;
      if (r === "retry" || r === "offline") {
        if (r === "retry") head.tries++;
        items = prune(items);
        break;
      }
      items = items.filter(x => x !== head);   // delivered, or rejected for good
    }
    await save();
    if (items.length) scheduleRetry();
  };

  // A flush asked for while one is running runs again right after it, so a
  // call made because the connection just came back is never swallowed by a
  // pass that started while it was still down.
  let rerun = false;
  const flush = (): Promise<void> => {
    if (flushing) { rerun = true; return flushing; }
    flushing = (async () => {
      try {
        do { rerun = false; await pass(); } while (rerun);
      } finally {
        flushing = null;
      }
    })();
    return flushing;
  };

  const deliver = async (row: Record<string, unknown>) => {
    await load();
    // Something is already waiting: join the line. The scheduled retry, the
    // next foreground or an explicit flush sends it — not every new event,
    // which would spend the head row's tries (and add load) during an outage.
    if ((items ?? []).length || flushing) { await push(row); return; }
    const r = await safeSend(row);
    if (r === "retry" || r === "offline") await push(row);
  };

  return {
    deliver,
    flush,
    size: async () => { await load(); return (items ?? []).length; },
  };
}

export type InsertError = { code?: string; message?: string } | null;

/**
 * Sorts a failed insert: try again later, or drop because it never will
 * succeed. Status 0 is how supabase-js reports a request that got no answer
 * at all (offline, DNS, timeout).
 */
export function classifyInsertFailure(error: InsertError, status: number | undefined): "offline" | "retry" | "drop" {
  const code = error?.code ?? "";
  const msg = error?.message ?? "";
  // Refused by row-level security (e.g. rows from an account that has since
  // signed out). PostgREST answers 401 for a signed-out request, so check the
  // code first: this will never succeed.
  if (code === "42501") return "drop";
  if (!status) return "offline";
  if (status >= 500 || status === 408 || status === 429) return "retry";
  // An expired session: it refreshes, and the row is accepted then.
  if (status === 401 || code === "PGRST301" || /jwt expired/i.test(msg)) return "retry";
  if (!code && /network|fetch|timed? ?out|abort/i.test(msg)) return "offline";
  return "drop";
}

/** A random id for one event. Not secret, only unique. */
export function newClientEventId(): string {
  const r = () => Math.random().toString(36).slice(2, 10).padEnd(8, "0");
  return `ev_${Date.now().toString(36)}_${r()}${r()}`;
}
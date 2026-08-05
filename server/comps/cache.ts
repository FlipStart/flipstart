/**
 * server/comps/cache.ts
 *
 * DURABLE comps store, shared across every user.
 *
 * ── Why this is on disk ───────────────────────────────────────────────────────
 * This was an in-memory Map. Every Railway redeploy wiped it, so on a day with
 * three deploys the same North Face fleece was paid for three times. Comps are a
 * metered external cost and the answer barely changes day to day — throwing the
 * data away on restart was the single most expensive thing in the comps path.
 *
 * ── Keyed on the QUERY, never the scan or the user ────────────────────────────
 * Two people scanning two different Denali fleeces produce the same search. The
 * second one should cost nothing. That is the whole point: comps for "The North
 * Face fleece jacket" describe the MARKET, not a particular garment, so they are
 * safe and correct to share.
 *
 * ── RAW items are stored, not scored results ──────────────────────────────────
 * Deliberate. If scored output were cached, improving the match algorithm would
 * have no effect on anything already fetched, and the only way to see the fix
 * would be to pay for the data again. Storing raw listings and re-scoring on
 * every read means an algorithm change applies immediately to everything already
 * paid for — which is also why MATCH_ALGO_VERSION is NOT part of the key.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { NormalizedSoldComp } from "./types.js";
import { QUERY_BUILDER_VERSION } from "./normalize.js";

export interface CachedComps {
  items: NormalizedSoldComp[];
  fetchedAt: number;
  provider: string;
  historyDays: number;
  /** Times this entry has been served instead of a paid request. */
  served: number;
  lastServedAt: number;
}

interface CompsFile {
  version: 1;
  entries: Record<string, CachedComps>;
}

const DATA_DIR = process.env.DATA_DIR ?? "/tmp";
const FILE = path.join(DATA_DIR, "flipstart-comps.json");

/**
 * Seven days, not one.
 *
 * A 90-day median moves very little across a week, so a shorter window buys
 * accuracy nobody can perceive at the cost of requests that are measurably
 * real. Overridable for testing the other direction.
 */
const TTL_MS = (() => {
  const d = Number.parseInt((process.env.SOLD_COMPS_CACHE_TTL_DAYS ?? "").trim(), 10);
  return (Number.isFinite(d) && d > 0 ? Math.min(d, 30) : 7) * 86_400_000;
})();

/** Each entry is roughly 20-30KB. 2,000 keeps the file well under 60MB. */
const MAX_ENTRIES = 2_000;
/** Cap items per entry: stats stabilise well before 120 and the tail is bulk. */
const MAX_ITEMS_PER_ENTRY = 80;

const FLUSH_IDLE_MS = 2_000;
const FLUSH_MAX_WAIT_MS = 15_000;

let entries: Record<string, CachedComps> = {};
let loaded = false;
let hits = 0, misses = 0, writes = 0, savedRequests = 0;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let firstPendingAt = 0;
let pending = 0;

function load(): void {
  if (loaded) return;
  loaded = true;
  if (!process.env.DATA_DIR) {
    console.warn("[comps] DATA_DIR not set — comps cache will NOT survive redeploy.");
  }
  try {
    if (fs.existsSync(FILE)) {
      const raw = JSON.parse(fs.readFileSync(FILE, "utf8")) as CompsFile;
      if (raw?.version === 1 && raw.entries && typeof raw.entries === "object") {
        entries = raw.entries;
        console.log(`[comps] loaded ${Object.keys(entries).length} cached queries from disk`);
      }
    }
  } catch (e) {
    // A corrupt file must never stop scans. Start empty and move on.
    console.error("[comps] cache load failed, starting empty:", (e as Error).message);
    entries = {};
  }
}

function flushNow(reason: string): void {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  const n = pending;
  pending = 0; firstPendingAt = 0;
  if (n === 0) return;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    // Write-then-rename so a crash mid-write cannot leave a truncated file.
    const tmp = `${FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, entries } satisfies CompsFile));
    fs.renameSync(tmp, FILE);
    writes++;
    console.log(`[comps] flushed ${n} write(s) — ${reason}, ${Object.keys(entries).length} queries`);
  } catch (e) {
    console.error("[comps] flush failed:", (e as Error).message);
  }
}

/** Coalesced, matching the pattern persist.ts already uses — a burst of writes
 *  becomes one disk hit rather than one per entry. */
function scheduleSave(): void {
  pending++;
  const now = Date.now();
  if (firstPendingAt === 0) firstPendingAt = now;
  if (now - firstPendingAt >= FLUSH_MAX_WAIT_MS) { flushNow("max wait"); return; }
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => flushNow("idle"), FLUSH_IDLE_MS);
  if (typeof (flushTimer as { unref?: () => void }).unref === "function") {
    (flushTimer as unknown as { unref: () => void }).unref();
  }
}

// Railway sends SIGTERM on redeploy. Without these, comps bought seconds before
// a deploy would be lost — the exact problem this file exists to fix.
let hooked = false;
function hookExit(): void {
  if (hooked) return;
  hooked = true;
  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    process.once(sig, () => { flushNow(`${sig}`); process.exit(0); });
  }
  process.once("beforeExit", () => flushNow("beforeExit"));
}

/**
 * MATCH_ALGO_VERSION is deliberately absent — see the file header. Including it
 * would discard paid-for listings every time scoring improved.
 */
export function compsCacheKey(normalizedQuery: string, historyDays: number, marketplace: string): string {
  const basis = [normalizedQuery, historyDays, marketplace, QUERY_BUILDER_VERSION].join("|");
  return crypto.createHash("sha256").update(basis).digest("hex").slice(0, 24);
}

/** Evict expired first, then least-recently-served. Serving frequency is a
 *  better keep-signal than age: a query answered fifty times is worth more than
 *  one fetched yesterday and never used again. */
function prune(): void {
  const now = Date.now();
  for (const k of Object.keys(entries)) {
    if (now - entries[k].fetchedAt > TTL_MS) delete entries[k];
  }
  const keys = Object.keys(entries);
  if (keys.length <= MAX_ENTRIES) return;
  keys.sort((a, b) => (entries[a].lastServedAt || entries[a].fetchedAt)
                    - (entries[b].lastServedAt || entries[b].fetchedAt));
  for (const k of keys.slice(0, keys.length - MAX_ENTRIES)) delete entries[k];
}

export function getCachedComps(key: string): CachedComps | null {
  load(); hookExit();
  const hit = entries[key];
  if (!hit) { misses++; return null; }
  if (Date.now() - hit.fetchedAt > TTL_MS) { delete entries[key]; misses++; scheduleSave(); return null; }
  hits++; savedRequests++;
  hit.served++; hit.lastServedAt = Date.now();
  scheduleSave();
  return hit;
}

export function putCachedComps(
  key: string,
  value: Omit<CachedComps, "served" | "lastServedAt">,
): void {
  load(); hookExit();
  entries[key] = {
    ...value,
    items: value.items.slice(0, MAX_ITEMS_PER_ENTRY),
    served: 0,
    lastServedAt: 0,
  };
  prune();
  scheduleSave();
}

export function compsCacheStats() {
  load();
  const keys = Object.keys(entries);
  const totalServed = keys.reduce((s, k) => s + entries[k].served, 0);
  return {
    queries: keys.length,
    hits, misses,
    hitRate: hits + misses ? Math.round((hits / (hits + misses)) * 100) / 100 : 0,
    /** Provider requests this cache has avoided since the file was created. */
    providerRequestsSaved: totalServed,
    diskWrites: writes,
    ttlDays: Math.round(TTL_MS / 86_400_000),
    durable: Boolean(process.env.DATA_DIR),
    file: FILE,
  };
}

/** Test seam. */
export function __resetCompsCache(): void {
  entries = {}; loaded = true; hits = 0; misses = 0; writes = 0; savedRequests = 0;
}
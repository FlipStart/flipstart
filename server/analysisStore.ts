/**
 * server/analysisStore.ts
 *
 * Durable store of recent canonical analyses.
 *
 * Exists so a founder can scan in the app and then run comps against that exact
 * analysis from a terminal, without pasting a 15KB JSON blob or knowing an
 * internal id. The existing analysisCache cannot serve this: it is in-memory
 * with a 10-minute TTL and keyed on scanAttemptId, which the user never sees.
 *
 * Keyed by analysisId with an owner index, so "my latest scan" is one lookup.
 * Ownership is checked on read for the same reason as the context store: an
 * analysis is the user's data and a probing caller must not be able to read
 * someone else's.
 */
import fs from "node:fs";
import path from "node:path";
import type { CanonicalAnalysisV1 } from "../shared/canonical.types.js";

export interface StoredAnalysis {
  analysisId: string;
  scanAttemptId: string;
  ownerId: string;
  canonical: CanonicalAnalysisV1;
  savedAt: number;
}

interface AnalysisFile { version: 1; entries: Record<string, StoredAnalysis>; }

const DATA_DIR = process.env.DATA_DIR ?? "/tmp";
const FILE = path.join(DATA_DIR, "flipstart-analyses.json");

/** Long enough to scan in the morning and test in the afternoon. */
const TTL_MS = 7 * 86_400_000;
/** ~12KB each, so 300 keeps the file a few megabytes. */
const MAX_ENTRIES = 300;

let entries: Record<string, StoredAnalysis> = {};
let loaded = false;
let pending = 0;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    if (fs.existsSync(FILE)) {
      const raw = JSON.parse(fs.readFileSync(FILE, "utf8")) as AnalysisFile;
      if (raw?.version === 1 && raw.entries) {
        entries = raw.entries;
        console.log(`[analyses] loaded ${Object.keys(entries).length} stored analyses`);
      }
    }
  } catch (e) {
    console.error("[analyses] load failed, starting empty:", (e as Error).message);
    entries = {};
  }
}

function flushNow(reason: string): void {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  if (pending === 0) return;
  const n = pending; pending = 0;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, entries } satisfies AnalysisFile));
    fs.renameSync(tmp, FILE);
    console.log(`[analyses] flushed ${n} write(s) — ${reason}, ${Object.keys(entries).length} stored`);
  } catch (e) {
    console.error("[analyses] flush failed:", (e as Error).message);
  }
}

function scheduleSave(): void {
  pending++;
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => flushNow("idle"), 2_000);
  if (typeof (flushTimer as { unref?: () => void }).unref === "function") {
    (flushTimer as unknown as { unref: () => void }).unref();
  }
}

let hooked = false;
function hookExit(): void {
  if (hooked) return;
  hooked = true;
  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    process.once(sig, () => { flushNow(String(sig)); process.exit(0); });
  }
  process.once("beforeExit", () => flushNow("beforeExit"));
}

function prune(): void {
  const now = Date.now();
  for (const k of Object.keys(entries)) {
    if (now - entries[k].savedAt > TTL_MS) delete entries[k];
  }
  const keys = Object.keys(entries).sort((a, b) => entries[a].savedAt - entries[b].savedAt);
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) delete entries[k];
}

export function saveAnalysis(a: Omit<StoredAnalysis, "savedAt">): void {
  load(); hookExit();
  if (!a.analysisId || !a.canonical) return;
  entries[a.analysisId] = { ...a, savedAt: Date.now() };
  prune();
  scheduleSave();
}

/** Null when missing, expired, or owned by someone else — indistinguishable on
 *  purpose, so a probing caller learns nothing about other users' scans. */
export function getAnalysis(analysisId: string, ownerId: string): StoredAnalysis | null {
  load();
  const hit = entries[analysisId];
  if (!hit) return null;
  if (Date.now() - hit.savedAt > TTL_MS) { delete entries[analysisId]; return null; }
  if (!ownerId || hit.ownerId !== ownerId) return null;
  return hit;
}

/** Most recent analysis for this owner. The founder flow: scan in the app, then
 *  run comps against "my last scan" without needing any id. */
export function getLatestAnalysis(ownerId: string): StoredAnalysis | null {
  load();
  if (!ownerId) return null;
  let best: StoredAnalysis | null = null;
  for (const v of Object.values(entries)) {
    if (v.ownerId !== ownerId) continue;
    if (Date.now() - v.savedAt > TTL_MS) continue;
    if (!best || v.savedAt > best.savedAt) best = v;
  }
  return best;
}


export function analysisStoreStats() {
  load();
  return { stored: Object.keys(entries).length, durable: Boolean(process.env.DATA_DIR), file: FILE };
}
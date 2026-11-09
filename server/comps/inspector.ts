/**
 * server/comps/inspector.ts
 *
 * Founder-only Comps Inspector: what each recent comps run did, and the
 * founder's own "right comp / wrong comp" marks.
 *
 * ── Why ──────────────────────────────────────────────────────────────────────
 * Before this, the only trace of a comps run was one Railway log line. Why a
 * comp ranked first, what was thrown out and why, and what the provider really
 * returned were computed and then discarded. Real-world testing at a thrift
 * store needs all of that on hand, and the marks build the labelled set that
 * any later change to matching is measured against.
 *
 * ── What is stored ───────────────────────────────────────────────────────────
 * Item names, the search query, listing titles and prices, tiers and reasons.
 * Never a user id, email or token — a run is identified only by its opaque
 * analysis id. Bounded, and kept on DATA_DIR like the comps cache so it
 * survives a redeploy.
 *
 * ── Who can see it ───────────────────────────────────────────────────────────
 * The app panel and the mark buttons: only signed-in accounts whose Supabase
 * id is in COMPS_INSPECTOR_USER_IDS (comma-separated, set in Railway — never
 * in code). The dashboard section: behind the founder dashboard's own secret.
 */
import fs from "node:fs";
import path from "node:path";
import { onShutdownFlush } from "../shutdown.js";

export interface InspectorComp {
  id: string;
  title: string;
  price: number;
  tier: string;
  score: number;
  reason: string;
}

export interface InspectorRun {
  at: number;
  analysisId: string;
  item: string;
  query: string | null;
  historyDays: number | null;
  historySpanDays: number | null;
  cacheHit: boolean;
  /** internalCode/stage, e.g. "OK/evaluation" or "IDENTITY_TOO_WEAK/eligibility". */
  outcome: string;
  raw: number;
  tierCounts: { exact: number; strong: number; similar: number; weak: number } | null;
  rejectedCount: number;
  duplicatesRemoved: number;
  dataStrength: string | null;
  median: number | null;
  aiLow: number | null;
  aiHigh: number | null;
  shown: InspectorComp[];
  rejectionCounts: Record<string, number>;
  rejectedSample: Array<{ title: string; reason: string; detail: string | null; price: number }>;
  weakSample: Array<{ title: string; reason: string }>;
  duplicates: Array<{ title: string; reason: string }>;
}

export type CompVerdict = "right" | "wrong";

export interface CompFeedback {
  at: number;
  analysisId: string;
  compId: string;
  verdict: CompVerdict;
  item: string;
  query: string | null;
  title: string;
  tier: string;
  score: number | null;
}

interface InspectorFile {
  version: 1;
  runs: InspectorRun[];
  feedback: Record<string, CompFeedback>;
}

const DATA_DIR = process.env.DATA_DIR ?? "/tmp";
const FILE = path.join(DATA_DIR, "flipstart-comps-inspector.json");
const MAX_RUNS = 200;
const MAX_FEEDBACK = 3_000;
const SAMPLE = { rejected: 40, weak: 20, duplicates: 20 };

let runs: InspectorRun[] = [];
let feedback: Record<string, CompFeedback> = {};
let loaded = false;
let pending = 0;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    if (fs.existsSync(FILE)) {
      const raw = JSON.parse(fs.readFileSync(FILE, "utf8")) as InspectorFile;
      if (raw?.version === 1) {
        runs = Array.isArray(raw.runs) ? raw.runs : [];
        feedback = raw.feedback && typeof raw.feedback === "object" ? raw.feedback : {};
      }
    }
  } catch (e) {
    // A corrupt file must never affect comps. Start empty.
    console.error("[comps-inspector] load failed, starting empty:", (e as Error).message);
    runs = []; feedback = {};
  }
}

function flushNow(reason: string): void {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  if (pending === 0) return;
  pending = 0;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, runs, feedback } satisfies InspectorFile));
    fs.renameSync(tmp, FILE);
  } catch (e) {
    console.error(`[comps-inspector] flush failed (${reason}):`, (e as Error).message);
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
  onShutdownFlush("compsInspector", (reason) => flushNow(reason));
}

/** Is this VERIFIED Supabase user allowed the inspector? Never pass a
 *  client-supplied id here. */
export function compsInspectorAllowed(verifiedUserId: string | null | undefined): boolean {
  if (!verifiedUserId) return false;
  const list = (process.env.COMPS_INSPECTOR_USER_IDS ?? "")
    .split(",").map(s => s.trim()).filter(Boolean);
  return list.includes(verifiedUserId);
}

/** Bound the samples so one run can never bloat the file. */
export function recordCompsRun(run: InspectorRun): void {
  load(); hookExit();
  const bounded: InspectorRun = {
    ...run,
    rejectedSample: run.rejectedSample.slice(0, SAMPLE.rejected),
    weakSample: run.weakSample.slice(0, SAMPLE.weak),
    duplicates: run.duplicates.slice(0, SAMPLE.duplicates),
    shown: run.shown.slice(0, 3),
  };
  // One entry per analysis: reopening a scan replaces its run, newest first.
  runs = [bounded, ...runs.filter(r => r.analysisId !== run.analysisId)].slice(0, MAX_RUNS);
  scheduleSave();
}

export function latestRunFor(analysisId: string): InspectorRun | null {
  load();
  return runs.find(r => r.analysisId === analysisId) ?? null;
}

const fbKey = (analysisId: string, compId: string) => `${analysisId}|${compId}`;

/** Set or clear a mark. The comp's details come from the stored run, never
 *  from the client. Returns false when the comp isn't in that run. */
export function setCompFeedback(analysisId: string, compId: string, verdict: CompVerdict | "clear"): boolean {
  load(); hookExit();
  const run = latestRunFor(analysisId);
  const comp = run?.shown.find(c => c.id === compId);
  if (!run || !comp) return false;
  const key = fbKey(analysisId, compId);
  if (verdict === "clear") delete feedback[key];
  else {
    feedback[key] = {
      at: Date.now(), analysisId, compId, verdict,
      item: run.item, query: run.query, title: comp.title, tier: comp.tier, score: comp.score,
    };
    const keys = Object.keys(feedback);
    if (keys.length > MAX_FEEDBACK) {
      keys.sort((a, b) => feedback[a].at - feedback[b].at)
        .slice(0, keys.length - MAX_FEEDBACK).forEach(k => delete feedback[k]);
    }
  }
  scheduleSave();
  return true;
}

export function feedbackFor(analysisId: string): Record<string, CompVerdict> {
  load();
  const out: Record<string, CompVerdict> = {};
  for (const f of Object.values(feedback)) if (f.analysisId === analysisId) out[f.compId] = f.verdict;
  return out;
}

/** For the founder dashboard. */
export function inspectorSnapshot(limitRuns = 40) {
  load();
  const fb = Object.values(feedback).sort((a, b) => b.at - a.at);
  const byTier: Record<string, { right: number; wrong: number }> = {};
  for (const f of fb) {
    const t = (byTier[f.tier] ??= { right: 0, wrong: 0 });
    t[f.verdict]++;
  }
  return {
    durable: Boolean(process.env.DATA_DIR),
    runCount: runs.length,
    runs: runs.slice(0, limitRuns),
    feedback: fb.slice(0, 100),
    feedbackTotals: { right: fb.filter(f => f.verdict === "right").length, wrong: fb.filter(f => f.verdict === "wrong").length },
    byTier,
  };
}

/** Test seam. */
export function __resetInspector(): void {
  runs = []; feedback = {}; loaded = true; pending = 0;
}
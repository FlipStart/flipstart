/**
 * server/persist.ts
 *
 * Unified persistent storage for FlipStart beta data.
 *
 * Survives: Railway redeploys, server restarts, crashes.
 * Requires: DATA_DIR env var pointing to a Railway persistent volume (/data).
 * Fallback:  /tmp (in-memory effectively — warns loudly on startup).
 *
 * Data file: ${DATA_DIR}/flipstart-beta.json
 * Atomic writes: write to .tmp then rename (prevents corruption on crash).
 */

import * as fs   from "fs";
import * as path from "path";

// ─── Setup ────────────────────────────────────────────────────────────────────

const DATA_DIR  = process.env.DATA_DIR ?? "/tmp";
const DATA_FILE = path.join(DATA_DIR, "flipstart-beta.json");
const TMP_FILE  = DATA_FILE + ".tmp";

if (!process.env.DATA_DIR) {
  console.warn("⚠️  DATA_DIR not set — using /tmp. Data WILL be lost on redeploy.");
  console.warn("   Set DATA_DIR=/data and add a Railway volume mounted at /data.");
} else {
  console.log(`[persist] data directory: ${DATA_DIR}`);
  console.log(`[persist] data file:      ${DATA_FILE}`);
}

// ─── Data shape ───────────────────────────────────────────────────────────────

export interface ScanCounter {
  dateKey: string;   // "2026-05-06" in America/Chicago
  count:   number;
}

export interface FeedbackEntry {
  id:        string;
  scanId:    string;
  timestamp: number;
  prediction: {
    itemName:           string;
    brand:              string;
    category:           string;
    resaleLow:          number;
    resaleHigh:         number;
    suggestedBuy:       number;
    aiEstimatedResale?: number;   // adjusted_estimated_value — the AI's best resale estimate
    demand:             string;
    bestPlatform:       string;
    confidenceScore:    number;
    recommendation:     string;
  };
  // Future outcome tracking (optional — collected post-sale)
  outcome?: {
    actualSoldPrice?:         number;
    actualPlatformSold?:      string;
    actualDaysToSell?:        number;
    listingCreated?:          boolean;
    soldOutcomeSubmittedAt?:  number;
  };
  feedback: {
    accuracyRating:     string | null;
    buyDecision:        string | null;
    userEstimatedValue: number | null;
    notes:              string | null;
  };
}

interface Store {
  scanCounter: ScanCounter;
  feedback:    FeedbackEntry[];
}

// ─── In-memory cache (write-through) ─────────────────────────────────────────

const DEFAULT_STORE: Store = {
  scanCounter: { dateKey: "", count: 0 },
  feedback:    [],
};

let _cache:  Store | null = null;
let _loaded              = false;

// ─── IO helpers ───────────────────────────────────────────────────────────────

function load(): Store {
  if (_loaded && _cache) return _cache;
  _loaded = true;
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw  = fs.readFileSync(DATA_FILE, "utf-8");
      _cache     = JSON.parse(raw) as Store;
      console.log(`[persist] loaded — scans today: ${_cache.scanCounter.count}, feedback entries: ${_cache.feedback.length}`);
    } else {
      _cache = JSON.parse(JSON.stringify(DEFAULT_STORE));
      console.log("[persist] no existing data file — starting fresh");
    }
  } catch (e) {
    console.error("[persist] failed to read data file, starting fresh:", e);
    _cache = JSON.parse(JSON.stringify(DEFAULT_STORE));
  }
  return _cache!;
}

function save(): void {
  try {
    // Ensure directory exists (Railway volumes need this on first write)
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    // Atomic write: write to .tmp then rename
    fs.writeFileSync(TMP_FILE, JSON.stringify(_cache, null, 2), "utf-8");
    fs.renameSync(TMP_FILE, DATA_FILE);
  } catch (e) {
    console.error("[persist] failed to save data:", e);
  }
}

// ─── Scan counter API ─────────────────────────────────────────────────────────

const SCAN_LIMIT = 200;
const TZ         = "America/Chicago";

function todayKey(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}

function nextMidnight(): string {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tStr = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(tomorrow);
  return new Date(`${tStr}T00:00:00-05:00`).toISOString();
}

function refreshCounter(store: Store): void {
  const today = todayKey();
  if (store.scanCounter.dateKey !== today) {
    store.scanCounter = { dateKey: today, count: 0 };
    console.log(`[persist] new day (${today}) — scan counter reset to 0`);
  }
}

export function tryIncrementScanCount(): boolean {
  const store = load();
  refreshCounter(store);
  if (store.scanCounter.count >= SCAN_LIMIT) {
    console.log(`[persist] scan BLOCKED — ${store.scanCounter.count}/${SCAN_LIMIT} used`);
    return false;
  }
  store.scanCounter.count++;
  save();
  console.log(`[persist] scan ${store.scanCounter.count}/${SCAN_LIMIT} (${store.scanCounter.dateKey})`);
  return true;
}

export function getScanStats() {
  const store     = load();
  refreshCounter(store);
  const remaining = Math.max(0, SCAN_LIMIT - store.scanCounter.count);
  return {
    globalDailyLimit:          SCAN_LIMIT,
    globalScansUsedToday:      store.scanCounter.count,
    globalScansRemainingToday: remaining,
    resetTime:                 nextMidnight(),
  };
}

// ─── Feedback API ─────────────────────────────────────────────────────────────

export function submitFeedback(entry: FeedbackEntry): void {
  const store = load();
  const idx   = store.feedback.findIndex(e => e.scanId === entry.scanId);
  if (idx !== -1) {
    store.feedback[idx] = entry;
  } else {
    store.feedback.push(entry);
  }
  save();
}

export function getAllFeedback(): FeedbackEntry[] {
  return load().feedback;
}

export function getFeedbackByScanId(scanId: string): FeedbackEntry | null {
  return load().feedback.find(e => e.scanId === scanId) ?? null;
}

export function getFeedbackSummary() {
  const entries = load().feedback;
  const total   = entries.length;
  if (total === 0) return { total: 0 };

  const ratings:   Record<string, number> = {};
  const decisions: Record<string, number> = {};
  const cats:      Record<string, number> = {};
  let totalEstimated = 0, countEstimated = 0, totalPredicted = 0;

  for (const e of entries) {
    if (e.feedback.accuracyRating) ratings[e.feedback.accuracyRating]   = (ratings[e.feedback.accuracyRating]   ?? 0) + 1;
    if (e.feedback.buyDecision)    decisions[e.feedback.buyDecision]    = (decisions[e.feedback.buyDecision]    ?? 0) + 1;
    if (e.feedback.userEstimatedValue) { totalEstimated += e.feedback.userEstimatedValue; countEstimated++; }
    totalPredicted += e.prediction.resaleHigh;
    const cat = e.prediction.category || "Unknown";
    cats[cat] = (cats[cat] ?? 0) + 1;
  }

  return {
    total,
    accuracyRatings:    ratings,
    buyDecisions:       decisions,
    avgPredictedResale: Math.round(totalPredicted / total),
    avgUserEstimate:    countEstimated ? Math.round(totalEstimated / countEstimated) : null,
    topCategory:        Object.entries(cats).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
    categories:         cats,
  };
}
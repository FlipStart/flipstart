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
 *
 * v3 additions:
 *  - events[]     — analytics event stream (app/scan/listing/feedback events)
 *  - sessions[]   — session records with duration + per-session counts
 *  - scanRecords[] — full structured scan data for future AI memory system
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

// ─── Data shapes ──────────────────────────────────────────────────────────────

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

// ─── NEW: Analytics event ─────────────────────────────────────────────────────

export interface EventEntry {
  eventId:         string;
  eventName:       string;
  anonymousUserId: string;
  sessionId:       string;
  timestamp:       number;
  platform:        string;
  metadata:        Record<string, unknown>;
}

// ─── NEW: Session record ──────────────────────────────────────────────────────

export interface SessionEntry {
  sessionId:             string;
  anonymousUserId:       string;
  startedAt:             number;
  endedAt?:              number;
  durationMs?:           number;
  platform:              string;
  scanCount:             number;
  completedScanCount:    number;
  failedScanCount:       number;
  listingGeneratedCount: number;
  feedbackSubmittedCount:number;
}

// ─── NEW: Scan record (for future AI memory / similarity matching) ─────────────
//
// This stores enough structured data so a future item-memory system can:
//   1. Match new scans against historical scans by visual similarity
//   2. Reuse cached AI analysis for near-identical items (saving latency + cost)
//   3. Build a proprietary resale pricing dataset from real user outcomes
//
// DO NOT implement similarity matching yet. Structure only.

export interface ScanRecord {
  scanId:             string;
  anonymousUserId:    string;
  sessionId:          string;
  timestamp:          number;
  // Image references
  imageUri:           string;
  tagImagePresent:    boolean;
  detailImagePresent: boolean;
  // AI outputs
  aiTitle:            string;
  aiCategory:         string;
  aiBrand:            string;
  aiEra:              string;
  aiMaterial:         string;
  aiRecommendation:   string;
  aiResaleLow:        number;
  aiResaleHigh:       number;
  aiEstimatedValue:   number;
  aiPlatform:         string;
  aiSellSpeed:        string;
  aiDemand:           string;
  aiConfidence:       number;
  styleLabels:        string[];
  riskFlags:          string[];
  // Linked records (populated later)
  feedbackId:         string | null;
  listingIds:         string[];
  // ── Future AI memory placeholders (DO NOT BUILD YET) ─────────────────────
  imageEmbeddingId:   null;   // future: vector DB ID after embedding pipeline
  visualFingerprint:  null;   // future: perceptual hash for near-duplicate detection
  similarScanMatchId: null;   // future: scanId of the cached scan this matched
  cacheHit:           boolean;// future: true if this result was served from cache
  cacheConfidence:    null;   // future: 0–100 confidence of the cache match
}

// ─── Store ────────────────────────────────────────────────────────────────────

interface Store {
  scanCounter: ScanCounter;
  feedback:    FeedbackEntry[];
  events:      EventEntry[];     // NEW v3
  sessions:    SessionEntry[];   // NEW v3
  scanRecords: ScanRecord[];     // NEW v3
}

// ─── In-memory cache (write-through) ─────────────────────────────────────────

const DEFAULT_STORE: Store = {
  scanCounter: { dateKey: "", count: 0 },
  feedback:    [],
  events:      [],
  sessions:    [],
  scanRecords: [],
};

let _cache:  Store | null = null;
let _loaded              = false;

// ─── IO helpers ───────────────────────────────────────────────────────────────

function load(): Store {
  if (_loaded && _cache) return _cache;
  _loaded = true;
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw  = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
      // Safe migration: existing files won't have events/sessions/scanRecords
      _cache = {
        scanCounter: raw.scanCounter ?? JSON.parse(JSON.stringify(DEFAULT_STORE.scanCounter)),
        feedback:    Array.isArray(raw.feedback)    ? raw.feedback    : [],
        events:      Array.isArray(raw.events)      ? raw.events      : [],
        sessions:    Array.isArray(raw.sessions)    ? raw.sessions    : [],
        scanRecords: Array.isArray(raw.scanRecords) ? raw.scanRecords : [],
      };
      console.log(
        `[persist] loaded — scans today: ${_cache.scanCounter.count}, ` +
        `feedback: ${_cache.feedback.length}, ` +
        `events: ${_cache.events.length}, ` +
        `sessions: ${_cache.sessions.length}, ` +
        `scanRecords: ${_cache.scanRecords.length}`
      );
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

// ─── Analytics Events API ─────────────────────────────────────────────────────

export function logEvent(event: Omit<EventEntry, "eventId">): void {
  try {
    const store = load();
    const entry: EventEntry = {
      eventId: `ev_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      ...event,
    };
    store.events.push(entry);
    // Soft cap: keep last 50,000 events — trim oldest if exceeded
    if (store.events.length > 50000) {
      store.events = store.events.slice(-50000);
    }
    save();
  } catch (e) {
    console.error("[persist] logEvent failed:", e);
  }
}

export function getAllEvents(): EventEntry[] {
  return load().events;
}

// ─── Sessions API ─────────────────────────────────────────────────────────────

export function startSession(data: Omit<SessionEntry, "endedAt" | "durationMs" | "scanCount" | "completedScanCount" | "failedScanCount" | "listingGeneratedCount" | "feedbackSubmittedCount">): void {
  try {
    const store = load();
    const entry: SessionEntry = {
      ...data,
      scanCount:             0,
      completedScanCount:    0,
      failedScanCount:       0,
      listingGeneratedCount: 0,
      feedbackSubmittedCount:0,
    };
    // Remove any unclosed session with same ID
    const existingIdx = store.sessions.findIndex(s => s.sessionId === data.sessionId);
    if (existingIdx !== -1) store.sessions.splice(existingIdx, 1);
    store.sessions.push(entry);
    save();
  } catch (e) {
    console.error("[persist] startSession failed:", e);
  }
}

export function endSession(data: {
  sessionId:             string;
  anonymousUserId:       string;
  endedAt:               number;
  durationMs:            number;
  scanCount:             number;
  completedScanCount:    number;
  failedScanCount:       number;
  listingGeneratedCount: number;
  feedbackSubmittedCount:number;
}): void {
  try {
    const store = load();
    const idx   = store.sessions.findIndex(s => s.sessionId === data.sessionId);
    if (idx !== -1) {
      store.sessions[idx] = { ...store.sessions[idx], ...data };
    } else {
      // Session start was missed (e.g. app restarted) — create a stub
      store.sessions.push({
        sessionId:             data.sessionId,
        anonymousUserId:       data.anonymousUserId,
        startedAt:             data.endedAt - data.durationMs,
        endedAt:               data.endedAt,
        durationMs:            data.durationMs,
        platform:              "unknown",
        scanCount:             data.scanCount,
        completedScanCount:    data.completedScanCount,
        failedScanCount:       data.failedScanCount,
        listingGeneratedCount: data.listingGeneratedCount,
        feedbackSubmittedCount:data.feedbackSubmittedCount,
      });
    }
    save();
  } catch (e) {
    console.error("[persist] endSession failed:", e);
  }
}

export function getAllSessions(): SessionEntry[] {
  return load().sessions;
}

// ─── Scan Records API ─────────────────────────────────────────────────────────

export function saveScanRecord(record: ScanRecord): void {
  try {
    const store = load();
    // Upsert by scanId
    const idx = store.scanRecords.findIndex(r => r.scanId === record.scanId);
    if (idx !== -1) {
      store.scanRecords[idx] = record;
    } else {
      store.scanRecords.push(record);
    }
    save();
  } catch (e) {
    console.error("[persist] saveScanRecord failed:", e);
  }
}

export function getAllScanRecords(): ScanRecord[] {
  return load().scanRecords;
}

// ─── Analytics summary (for dashboard) ───────────────────────────────────────

export function getAnalyticsSummary() {
  const store    = load();
  const events   = store.events;
  const sessions = store.sessions;
  const records  = store.scanRecords;

  const nowMs      = Date.now();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayMs    = todayStart.getTime();
  const weekMs     = nowMs - 7  * 24 * 60 * 60 * 1000;
  const monthMs    = nowMs - 30 * 24 * 60 * 60 * 1000;

  // ── User metrics ────────────────────────────────────────────────────────────
  const allUsers      = new Set(events.map(e => e.anonymousUserId));
  const todayUsers    = new Set(events.filter(e => e.timestamp >= todayMs).map(e => e.anonymousUserId));
  const weekUsers     = new Set(events.filter(e => e.timestamp >= weekMs).map(e => e.anonymousUserId));

  // First seen per user
  const firstSeenMap: Record<string, number> = {};
  for (const ev of events) {
    const u = ev.anonymousUserId;
    if (firstSeenMap[u] === undefined || ev.timestamp < firstSeenMap[u]) {
      firstSeenMap[u] = ev.timestamp;
    }
  }
  const newUsersToday      = [...todayUsers].filter(u => (firstSeenMap[u] ?? 0) >= todayMs).length;
  const returningUsersToday = [...todayUsers].filter(u => (firstSeenMap[u] ?? 0) < todayMs).length;

  // ── Session metrics ─────────────────────────────────────────────────────────
  const closedSessions    = sessions.filter(s => s.durationMs != null);
  const todaySessions     = sessions.filter(s => s.startedAt >= todayMs);
  const avgSessionMs      = closedSessions.length
    ? Math.round(closedSessions.reduce((s, x) => s + (x.durationMs ?? 0), 0) / closedSessions.length)
    : 0;

  // Sessions per user per day (last 7 days)
  const last7DaySessions  = sessions.filter(s => s.startedAt >= weekMs);
  const sessPerUserDay    = weekUsers.size > 0 ? (last7DaySessions.length / weekUsers.size / 7).toFixed(2) : "—";

  // ── Scan metrics (from events) ──────────────────────────────────────────────
  const scanStarted   = events.filter(e => e.eventName === "scan_started").length;
  const scanCompleted = events.filter(e => e.eventName === "scan_completed").length;
  const scanFailed    = events.filter(e => e.eventName === "scan_failed").length;
  const scanRate      = scanStarted > 0 ? Math.round(scanCompleted / scanStarted * 100) : 0;

  // Scans per user per day (last 7 days)
  const scansLast7:  Record<string, number> = {};
  events.filter(e => e.eventName === "scan_completed" && e.timestamp >= weekMs).forEach(e => {
    scansLast7[e.anonymousUserId] = (scansLast7[e.anonymousUserId] ?? 0) + 1;
  });
  const scansPerUserValues = Object.values(scansLast7).map(n => n / 7);
  const avgScansPerDay     = scansPerUserValues.length
    ? (scansPerUserValues.reduce((a, b) => a + b, 0) / scansPerUserValues.length).toFixed(1)
    : "—";
  const sorted = [...scansPerUserValues].sort((a, b) => a - b);
  const medianScansPerDay  = sorted.length
    ? sorted[Math.floor(sorted.length / 2)].toFixed(1)
    : "—";
  const pct5PlusScans      = scansPerUserValues.length
    ? Math.round(scansPerUserValues.filter(n => n >= 5).length / scansPerUserValues.length * 100)
    : 0;

  // ── Listing metrics ─────────────────────────────────────────────────────────
  const listingsTotal  = events.filter(e => e.eventName === "listing_generation_completed").length;
  const ebayListings   = events.filter(e => e.eventName === "ebay_listing_generated").length;
  const depopListings  = events.filter(e => e.eventName === "depop_listing_generated").length;
  const listingRate    = scanCompleted > 0 ? Math.round(listingsTotal / scanCompleted * 100) : 0;

  // ── Feedback metrics ────────────────────────────────────────────────────────
  const feedbackEvents = events.filter(e => e.eventName === "feedback_submitted").length;
  const feedbackRate   = scanCompleted > 0 ? Math.round(feedbackEvents / scanCompleted * 100) : 0;

  // ── Time-to-value (per user: first session start → first scan_completed with isFirstScan flag) ──
  // Uses metadata.isFirstScan:true + metadata.ttvMs set by the client on the user's first scan.
  // Falls back to per-session calculation for users without the new metadata.
  const firstScanEvents = events.filter(e => e.eventName === "scan_completed" && e.metadata?.isFirstScan === true);
  const ttvValues: number[] = firstScanEvents
    .map(e => Number(e.metadata?.ttvMs))
    .filter(n => !isNaN(n) && n > 0 && n < 30 * 60 * 1000); // cap at 30 min to exclude outliers

  // Legacy fallback: per-session TTV for older events without isFirstScan metadata
  if (ttvValues.length === 0) {
    const sessionEventMap: Record<string, EventEntry[]> = {};
    for (const ev of events) {
      if (!sessionEventMap[ev.sessionId]) sessionEventMap[ev.sessionId] = [];
      sessionEventMap[ev.sessionId].push(ev);
    }
    for (const sess of Object.values(sessionEventMap)) {
      const opens   = sess.filter(e => e.eventName === "app_opened" || e.eventName === "app_session_started");
      const submits = sess.filter(e => e.eventName === "scan_submitted" || e.eventName === "scan_completed");
      if (opens.length && submits.length) {
        const firstOpen   = Math.min(...opens.map(e => e.timestamp));
        const firstSubmit = Math.min(...submits.map(e => e.timestamp));
        if (firstSubmit > firstOpen) ttvValues.push(firstSubmit - firstOpen);
      }
    }
  }

  const avgTTV = ttvValues.length
    ? Math.round(ttvValues.reduce((a, b) => a + b, 0) / ttvValues.length / 1000)
    : null;

  // ── Hunt Mode metrics ───────────────────────────────────────────────────────
  const huntModeOpened   = events.filter(e => e.eventName === "hunt_mode_opened").length;
  const huntStarted      = events.filter(e => e.eventName === "hunt_started").length;
  const huntScanStarted  = events.filter(e => e.eventName === "hunt_scan_started").length;
  const huntItemSaved    = events.filter(e => e.eventName === "hunt_item_saved").length;
  const huntItemRemoved  = events.filter(e => e.eventName === "hunt_item_removed").length;
  const huntEndedEvents  = events.filter(e => e.eventName === "hunt_ended");

  // Conversion: Hunt Mode opened → hunt actually started
  const huntConversionRate = huntModeOpened > 0
    ? Math.round(huntStarted / huntModeOpened * 100) : 0;

  // Conversion: scan started in hunt → item saved to hunt
  const huntScanSaveRate = huntScanStarted > 0
    ? Math.round(huntItemSaved / huntScanStarted * 100) : 0;

  // Average profit per hunt (from hunt_ended metadata)
  const huntProfits = huntEndedEvents
    .map(e => Number(e.metadata?.estimatedProfit))
    .filter(n => !isNaN(n));
  const avgHuntProfit = huntProfits.length
    ? Math.round(huntProfits.reduce((a, b) => a + b, 0) / huntProfits.length)
    : null;

  // Average hunt duration (ms)
  const huntDurations = huntEndedEvents
    .map(e => Number(e.metadata?.durationMs))
    .filter(n => !isNaN(n) && n > 0);
  const avgHuntDurationMs = huntDurations.length
    ? Math.round(huntDurations.reduce((a, b) => a + b, 0) / huntDurations.length)
    : null;

  // Average items saved per hunt
  const keptCounts = huntEndedEvents
    .map(e => Number(e.metadata?.keptCount))
    .filter(n => !isNaN(n));
  const avgSavedPerHunt = keptCounts.length
    ? (keptCounts.reduce((a, b) => a + b, 0) / keptCounts.length).toFixed(1)
    : null;

  // ── Retention (simple cohort — group by first seen date) ───────────────────
  // day1: returned on firstSeen + 1 day, day7: + 7 days, day30: + 30 days
  const DAY_MS = 24 * 60 * 60 * 1000;
  let day1Total = 0, day1Ret = 0, day7Total = 0, day7Ret = 0, day30Total = 0, day30Ret = 0;

  for (const [userId, firstSeen] of Object.entries(firstSeenMap)) {
    const userEvents = events.filter(e => e.anonymousUserId === userId);
    const d1Start = firstSeen + DAY_MS;
    const d1End   = firstSeen + 2 * DAY_MS;
    const d7Start = firstSeen + 6 * DAY_MS;
    const d7End   = firstSeen + 8 * DAY_MS;
    const d30Start= firstSeen + 29 * DAY_MS;
    const d30End  = firstSeen + 31 * DAY_MS;

    // Only count cohorts that had enough time to return
    if (nowMs >= d1End)  { day1Total++;  if (userEvents.some(e => e.timestamp >= d1Start && e.timestamp < d1End))   day1Ret++;  }
    if (nowMs >= d7End)  { day7Total++;  if (userEvents.some(e => e.timestamp >= d7Start && e.timestamp < d7End))   day7Ret++;  }
    if (nowMs >= d30End) { day30Total++; if (userEvents.some(e => e.timestamp >= d30Start && e.timestamp < d30End)) day30Ret++; }
  }

  return {
    // Users
    totalUniqueUsers:     allUsers.size,
    dau:                  todayUsers.size,
    wau:                  weekUsers.size,
    newUsersToday,
    returningUsersToday,
    // Sessions
    totalSessions:        sessions.length,
    sessionsToday:        todaySessions.length,
    avgSessionMs,
    sessPerUserDay,
    // Scans
    scanStarted,
    scanCompleted,
    scanFailed,
    scanRate,
    avgScansPerDay,
    medianScansPerDay,
    pct5PlusScans,
    // Listings
    listingsTotal,
    ebayListings,
    depopListings,
    listingRate,
    // Feedback
    feedbackEvents,
    feedbackRate,
    // TTV
    avgTTVSeconds: avgTTV,
    // Retention
    day1Total,  day1Ret,
    day7Total,  day7Ret,
    day30Total, day30Ret,
    // Hunt Mode
    huntModeOpened,
    huntStarted,
    huntScanStarted,
    huntItemSaved,
    huntItemRemoved,
    huntConversionRate,
    huntScanSaveRate,
    avgHuntProfit,
    avgHuntDurationMs,
    avgSavedPerHunt,
    // Raw counts for export
    totalEvents:      events.length,
    totalScanRecords: records.length,
  };
}
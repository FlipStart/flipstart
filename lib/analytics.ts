/**
 * lib/analytics.ts
 *
 * Fire-and-forget usage analytics. NEVER crashes the app. NEVER blocks user flow.
 * All functions are safe to call from anywhere — wrap every call in try/catch internally.
 *
 * Anonymous user ID: generated once, stored in AsyncStorage, reused forever.
 * Session: 30-minute timeout window — background < 30 min resumes same session.
 * Events: POSTed to backend REST endpoint, not tRPC (lightweight, no superjson overhead).
 *
 * Privacy: no PII, no contacts, no location, no payment data. Only app behavior.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { getApiBaseUrl } from "@/constants/oauth";

// ─── Constants ────────────────────────────────────────────────────────────────

const ANON_ID_KEY       = "@flipstart/anonUserId";
const FIRST_SCAN_KEY    = "@flipstart/firstScanAt";      // timestamp of first completed scan
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;               // 30 minutes

// ─── In-memory state ──────────────────────────────────────────────────────────

let _anonUserId:    string | null = null;
let _sessionId:     string | null = null;
let _sessionStart:  number | null = null;
let _backgroundedAt: number | null = null;   // when app last went to background

// Per-session counters — incremented by caller, sent on session end
const _counts = {
  scanCount:              0,
  completedScanCount:     0,
  failedScanCount:        0,
  listingGeneratedCount:  0,
  feedbackSubmittedCount: 0,
  huntScansCount:         0,
  huntItemsSavedCount:    0,
};

// ─── Anonymous user ID ────────────────────────────────────────────────────────

async function getAnonUserId(): Promise<string> {
  if (_anonUserId) return _anonUserId;
  try {
    const stored = await AsyncStorage.getItem(ANON_ID_KEY);
    if (stored) { _anonUserId = stored; return stored; }
    const id = "anon_" + Math.random().toString(36).slice(2, 11) + "_" + Date.now().toString(36);
    await AsyncStorage.setItem(ANON_ID_KEY, id);
    _anonUserId = id;
    return id;
  } catch {
    return "anon_unknown";
  }
}

// ─── Backend POST (truly fire-and-forget) ─────────────────────────────────────

function firePost(path: string, body: object): void {
  void (async () => {
    try {
      const base = getApiBaseUrl();
      await fetch(base + path, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      });
    } catch { /* swallow silently */ }
  })();
}

// ─── Session helpers ──────────────────────────────────────────────────────────

function newSessionId(): string {
  return "sess_" + Math.random().toString(36).slice(2, 11) + "_" + Date.now().toString(36);
}

function resetCounts(): void {
  _counts.scanCount              = 0;
  _counts.completedScanCount     = 0;
  _counts.failedScanCount        = 0;
  _counts.listingGeneratedCount  = 0;
  _counts.feedbackSubmittedCount = 0;
  _counts.huntScansCount         = 0;
  _counts.huntItemsSavedCount    = 0;
}

/** Returns the current session ID (may be null before first startSession). */
export function getCurrentSessionId(): string | null {
  return _sessionId;
}

/**
 * Increment a per-session counter. Safe to call before session starts.
 */
export function incrementSessionCount(key: keyof typeof _counts): void {
  try { _counts[key]++; } catch { /* never throw */ }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Log a named event with optional metadata. Fire-and-forget, never throws.
 */
export function logEvent(eventName: string, metadata: Record<string, unknown> = {}): void {
  void (async () => {
    try {
      const userId = await getAnonUserId();
      firePost("/api/analytics/event", {
        eventName,
        anonymousUserId: userId,
        sessionId:       _sessionId ?? "no_session",
        timestamp:       Date.now(),
        platform:        Platform.OS,
        metadata,
      });
    } catch { /* never throw */ }
  })();
}

/**
 * Call when the app foregrounds (from background or cold launch).
 *
 * 30-minute timeout window:
 * - If backgrounded < 30 min ago → resume same session silently (no new session on server)
 * - If backgrounded > 30 min ago or fresh launch → close old session, open new one
 *
 * This prevents a "quick check phone → put it down → pick it up" from counting
 * as multiple sessions, which was the root cause of session overcounting.
 */
export function resumeOrStartSession(): void {
  void (async () => {
    try {
      const now = Date.now();

      // Resume same session if within timeout window
      if (_sessionId && _backgroundedAt !== null) {
        const elapsed = now - _backgroundedAt;
        _backgroundedAt = null;
        if (elapsed < SESSION_TIMEOUT_MS) {
          // Within 30 min — resume silently, no new session record
          logEvent("app_foregrounded", { resumedSession: true, backgroundedForMs: elapsed });
          return;
        }
        // Over 30 min — close old session before starting new one
        endSession();
      }

      _backgroundedAt = null;
      _sessionId      = newSessionId();
      _sessionStart   = now;
      resetCounts();

      const userId = await getAnonUserId();
      firePost("/api/analytics/session/start", {
        sessionId:       _sessionId,
        anonymousUserId: userId,
        startedAt:       _sessionStart,
        platform:        Platform.OS,
      });

      logEvent("app_session_started");
    } catch { /* never throw */ }
  })();
}

/**
 * Call when app goes to background (inactive/background AppState).
 * Does NOT end the session immediately — waits for 30-min timeout.
 */
export function backgroundSession(): void {
  try {
    _backgroundedAt = Date.now();
    logEvent("app_backgrounded");
  } catch { /* never throw */ }
}

/**
 * End the current session. Call only on confirmed timeout or app close.
 * Sends duration + per-session counts to backend.
 */
export function endSession(): void {
  if (!_sessionId || !_sessionStart) return;

  const sessionId  = _sessionId;
  const durationMs = Date.now() - _sessionStart;
  const counts     = { ..._counts };

  // Clear immediately to prevent double-send
  _sessionId    = null;
  _sessionStart = null;

  void (async () => {
    try {
      const userId = await getAnonUserId();
      firePost("/api/analytics/session/end", {
        sessionId,
        anonymousUserId:        userId,
        endedAt:                Date.now(),
        durationMs,
        scanCount:              counts.scanCount,
        completedScanCount:     counts.completedScanCount,
        failedScanCount:        counts.failedScanCount,
        listingGeneratedCount:  counts.listingGeneratedCount,
        feedbackSubmittedCount: counts.feedbackSubmittedCount,
        huntScansCount:         counts.huntScansCount,
        huntItemsSavedCount:    counts.huntItemsSavedCount,
      });
      logEvent("app_session_ended", { durationMs, ...counts });
    } catch { /* never throw */ }
  })();
}

/**
 * Call when a scan completes successfully.
 * On the user's first-ever completed scan, records TTV (time-to-value)
 * as metadata so the dashboard can show accurate per-user time-to-first-scan.
 */
export function recordScanCompleted(metadata: Record<string, unknown> = {}): void {
  incrementSessionCount("completedScanCount");
  void (async () => {
    try {
      const now = Date.now();
      const existingFirstScan = await AsyncStorage.getItem(FIRST_SCAN_KEY);
      if (!existingFirstScan && _sessionStart) {
        // First scan ever for this user — record TTV
        await AsyncStorage.setItem(FIRST_SCAN_KEY, String(now));
        const ttvMs = now - _sessionStart;
        logEvent("scan_completed", { ...metadata, isFirstScan: true, ttvMs });
      } else {
        logEvent("scan_completed", metadata);
      }
    } catch {
      logEvent("scan_completed", metadata);
    }
  })();
}

// ─── Hunt Mode analytics ──────────────────────────────────────────────────────

/** Hunt Mode screen opened — user viewed the hunt entry screen */
export function logHuntModeOpened(): void {
  logEvent("hunt_mode_opened");
}

/** User confirmed hunt name and started an active hunt */
export function logHuntStarted(huntName: string): void {
  logEvent("hunt_started", { huntName });
}

/** Scan button pressed inside active hunt */
export function logHuntScanStarted(scannedCount: number): void {
  incrementSessionCount("huntScansCount");
  logEvent("hunt_scan_started", { scannedCount });
}

/** Item saved to hunt from Hunt Item Detail */
export function logHuntItemSaved(meta: {
  profit: number;
  recommendation: string;
  category: string;
}): void {
  incrementSessionCount("huntItemsSavedCount");
  logEvent("hunt_item_saved", meta);
}

/** Item removed/discarded from Hunt Item Detail */
export function logHuntItemRemoved(meta: {
  recommendation: string;
  category: string;
}): void {
  logEvent("hunt_item_removed", meta);
}

/** Hunt session ended */
export function logHuntEnded(meta: {
  durationMs: number;
  scannedCount: number;
  keptCount: number;
  estimatedProfit: number;
}): void {
  logEvent("hunt_ended", meta);
}

// ─── Scan record (future AI memory foundation) ────────────────────────────────

export interface ScanRecordPayload {
  scanId:             string;
  imageUri:           string;
  tagImagePresent:    boolean;
  detailImagePresent: boolean;
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
  styleLabels?:       string[];
  riskFlags?:         string[];
}

export function saveScanRecord(record: ScanRecordPayload): void {
  void (async () => {
    try {
      const userId = await getAnonUserId();
      firePost("/api/analytics/scan-record", {
        ...record,
        anonymousUserId:    userId,
        sessionId:          _sessionId ?? "no_session",
        timestamp:          Date.now(),
        imageEmbeddingId:   null,
        visualFingerprint:  null,
        similarScanMatchId: null,
        cacheHit:           false,
        cacheConfidence:    null,
        feedbackId:         null,
        listingIds:         [],
      });
    } catch { /* never throw */ }
  })();
}

// ─── Legacy startSession export (kept for backward compatibility) ──────────────
// Points to resumeOrStartSession — callers that imported startSession still work.
export const startSession = resumeOrStartSession;
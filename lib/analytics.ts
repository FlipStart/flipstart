/**
 * lib/analytics.ts
 *
 * Fire-and-forget usage analytics. NEVER crashes the app. NEVER blocks user flow.
 * All functions are safe to call from anywhere — wrap every call in try/catch internally.
 *
 * Anonymous user ID: generated once, stored in AsyncStorage, reused forever.
 * Session: managed via AppState in _layout.tsx (startSession / endSession).
 * Events: POSTed to backend REST endpoint, not tRPC (lightweight, no superjson overhead).
 *
 * Privacy: no PII, no contacts, no location, no payment data. Only app behavior.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { getApiBaseUrl } from "@/constants/oauth";

// ─── Storage key ──────────────────────────────────────────────────────────────

const ANON_ID_KEY = "@flipstart/anonUserId";

// ─── In-memory state ──────────────────────────────────────────────────────────

let _anonUserId:  string | null = null;
let _sessionId:   string | null = null;
let _sessionStart: number | null = null;

// Per-session counters — incremented by caller, sent on session end
const _counts = {
  scanCount:             0,
  completedScanCount:    0,
  failedScanCount:       0,
  listingGeneratedCount: 0,
  feedbackSubmittedCount:0,
};

// ─── Anonymous user ID ────────────────────────────────────────────────────────

async function getAnonUserId(): Promise<string> {
  if (_anonUserId) return _anonUserId;
  try {
    const stored = await AsyncStorage.getItem(ANON_ID_KEY);
    if (stored) {
      _anonUserId = stored;
      return stored;
    }
    // Generate new ID — compact but unique enough for beta scale
    const id = "anon_" + Math.random().toString(36).slice(2, 11) + "_" + Date.now().toString(36);
    await AsyncStorage.setItem(ANON_ID_KEY, id);
    _anonUserId = id;
    return id;
  } catch {
    // AsyncStorage failure is non-fatal
    return "anon_unknown";
  }
}

// ─── Backend POST (truly fire-and-forget) ─────────────────────────────────────

function firePost(path: string, body: object): void {
  // Intentionally no await — analytics must never block the calling code
  void (async () => {
    try {
      const base = getApiBaseUrl();
      await fetch(base + path, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      });
    } catch {
      // Swallow all errors silently — network failures, bad JSON, anything
    }
  })();
}

// ─── Session helpers ──────────────────────────────────────────────────────────

function newSessionId(): string {
  return "sess_" + Math.random().toString(36).slice(2, 11) + "_" + Date.now().toString(36);
}

/** Returns the current session ID (may be null before first startSession). */
export function getCurrentSessionId(): string | null {
  return _sessionId;
}

/**
 * Increment a per-session counter. Call from scan pipeline, listing generation, etc.
 * Safe to call before session starts (counts are reset on next startSession).
 */
export function incrementSessionCount(key: keyof typeof _counts): void {
  try { _counts[key]++; } catch { /* never throw */ }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Log a named event with optional metadata.
 * Fire-and-forget — returns void immediately, never throws.
 *
 * @example
 *   logEvent("scan_started", { photoSlot: "front" });
 *   logEvent("scan_completed", { confidence: 85, category: "Tops" });
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
 * Start a new analytics session. Call when app becomes active.
 * Resets per-session counters.
 */
export function startSession(): void {
  void (async () => {
    try {
      _sessionId    = newSessionId();
      _sessionStart = Date.now();
      // Reset per-session counters
      _counts.scanCount              = 0;
      _counts.completedScanCount     = 0;
      _counts.failedScanCount        = 0;
      _counts.listingGeneratedCount  = 0;
      _counts.feedbackSubmittedCount = 0;

      const userId = await getAnonUserId();
      firePost("/api/analytics/session/start", {
        sessionId:       _sessionId,
        anonymousUserId: userId,
        startedAt:       _sessionStart,
        platform:        Platform.OS,
      });

      // Log app_session_started event so it shows up in event stream
      logEvent("app_session_started");
    } catch { /* never throw */ }
  })();
}

/**
 * End the current session. Call when app goes to background or closes.
 * Sends duration + per-session counts to backend.
 */
export function endSession(): void {
  if (!_sessionId || !_sessionStart) return;

  const sessionId  = _sessionId;
  const durationMs = Date.now() - _sessionStart;
  const counts     = { ..._counts };

  // Clear state immediately so concurrent calls don't double-send
  _sessionId    = null;
  _sessionStart = null;

  void (async () => {
    try {
      const userId = await getAnonUserId();
      firePost("/api/analytics/session/end", {
        sessionId,
        anonymousUserId:       userId,
        endedAt:               Date.now(),
        durationMs,
        scanCount:             counts.scanCount,
        completedScanCount:    counts.completedScanCount,
        failedScanCount:       counts.failedScanCount,
        listingGeneratedCount: counts.listingGeneratedCount,
        feedbackSubmittedCount:counts.feedbackSubmittedCount,
      });

      logEvent("app_session_ended", { durationMs, ...counts });
    } catch { /* never throw */ }
  })();
}

// ─── Scan record (Part 4 — future AI memory foundation) ───────────────────────

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

/**
 * Save a completed scan record for future AI memory / similarity matching.
 * Stores full structured AI output + image metadata.
 *
 * Placeholder fields for future systems (NOT implemented yet):
 *   imageEmbeddingId  — vector embedding ID once embedding pipeline exists
 *   visualFingerprint — perceptual hash for near-duplicate detection
 *   similarScanMatchId — ID of the cached scan this matched, if any
 *   cacheHit          — whether this scan was served from cache
 *   cacheConfidence   — confidence of the cache match
 *
 * Future item-memory flow (DO NOT BUILD YET):
 *   1. User uploads images
 *   2. Backend generates image embeddings/fingerprint
 *   3. System compares against previous scanRecords
 *   4. If high-confidence match found → reuse cached analysis (cacheHit: true)
 *   5. If no match → call AI normally, store result
 *   6. Outcome + feedback linked via feedbackId post-sale
 */
export function saveScanRecord(record: ScanRecordPayload): void {
  void (async () => {
    try {
      const userId = await getAnonUserId();
      firePost("/api/analytics/scan-record", {
        ...record,
        anonymousUserId:     userId,
        sessionId:           _sessionId ?? "no_session",
        timestamp:           Date.now(),
        // ── Future AI memory placeholders ─────────────────────────────────
        // DO NOT implement these yet. Structure only.
        imageEmbeddingId:    null,   // future: vector DB ID
        visualFingerprint:   null,   // future: perceptual hash string
        similarScanMatchId:  null,   // future: scanId of cache hit
        cacheHit:            false,  // future: true if served from cache
        cacheConfidence:     null,   // future: 0–100 match confidence
        // ──────────────────────────────────────────────────────────────────
        feedbackId:          null,   // linked later when feedback submitted
        listingIds:          [],     // linked later when listings generated
      });
    } catch { /* never throw */ }
  })();
}
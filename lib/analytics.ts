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
import Constants from "expo-constants";
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

// Current signed-in user id (== profiles.id). Null for guests. Set from the
// root layout on auth change via setAnalyticsIdentity() so events attribute to
// the real profile when available, without this module importing React/auth.
let _identityUserId: string | null = null;

/** Set/clear the signed-in identity for analytics attribution. */
export function setAnalyticsIdentity(userId: string | null): void {
  _identityUserId = userId ?? null;
}

// App version, read once from expo config (app.config.ts `version`).
let _appVersion: string | null = null;
function getAppVersion(): string | null {
  if (_appVersion) return _appVersion;
  try {
    _appVersion =
      (Constants.expoConfig?.version as string | undefined) ??
      ((Constants as any).manifest?.version as string | undefined) ??
      null;
  } catch { _appVersion = null; }
  return _appVersion;
}

// Map an event name to a coarse category by prefix (keeps the dashboard tidy
// without changing call sites).
function categoryFor(eventName: string): string | null {
  if (eventName.startsWith("onboarding_") || eventName === "account_created" ||
      eventName === "login_success" || eventName.startsWith("guest_")) return "onboarding";
  if (eventName.startsWith("app_") || eventName.startsWith("session")) return "session";
  if (eventName.startsWith("scan_") || eventName === "listing_generated") return "scan";
  if (eventName.startsWith("hunt_")) return "hunt";
  if (eventName.startsWith("progress_") || eventName.startsWith("achievement") ||
      eventName.startsWith("brand_") || eventName.startsWith("diamond")) return "progress";
  return null;
}

// Keys we must never ship in analytics metadata (privacy / payload size).
const META_BLOCKLIST = new Set([
  "image", "images", "imageUri", "imageUris", "photo", "photos", "base64",
  "aiResult", "rawResult", "rawResponse", "analysis", "fullResult",
  "email", "password", "token", "accessToken", "apiKey",
]);

// Strip blocked keys and cap size so we never store huge/sensitive payloads.
function sanitizeMeta(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  try {
    for (const [k, v] of Object.entries(meta ?? {})) {
      if (META_BLOCKLIST.has(k)) continue;
      if (typeof v === "string" && v.length > 500) { out[k] = v.slice(0, 500); continue; }
      out[k] = v;
    }
    // Hard cap: if the JSON is still large, keep a truncated marker only.
    const json = JSON.stringify(out);
    if (json.length > 4000) return { _truncated: true, keys: Object.keys(out).slice(0, 20) };
  } catch { return {}; }
  return out;
}

// Supabase sink — lazy client, fully fail-safe. Inserts one analytics row.
// RLS: signed-in rows carry user_id = auth.uid(); guest rows carry user_id null.
function writeEventToSupabase(
  eventName: string,
  metadata: Record<string, unknown>,
  route?: string,
): void {
  void (async () => {
    try {
      const { supabase } = await import("@/lib/supabase");
      const anon = await getAnonUserId();
      const { error } = await supabase.from("analytics_events").insert({
        user_id:        _identityUserId,           // null for guests
        profile_id:     _identityUserId,           // profiles.id == auth user id
        anonymous_id:   anon,
        session_id:     _sessionId,
        event_name:     eventName,
        event_category: categoryFor(eventName),
        platform:       Platform.OS,
        app_version:    getAppVersion(),
        route:          route ?? null,
        metadata:       sanitizeMeta(metadata),
      });
      if (error && __DEV__) console.warn("[analytics] supabase insert failed:", error.message);
    } catch (e) {
      if (__DEV__) console.warn("[analytics] supabase insert threw:", e);
    }
  })();
}

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
  // Sink 1: Supabase analytics_events (Founder Dashboard v3 source). Fail-safe.
  const route = typeof metadata.route === "string" ? (metadata.route as string) : undefined;
  writeEventToSupabase(eventName, metadata, route);

  // Sink 2: legacy backend file store (existing dashboard). Unchanged.
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
 * trackAnalyticsEvent — canonical analytics entry point for Founder Dashboard
 * v3. Writes to Supabase analytics_events (+ the legacy backend store). Safe to
 * call from anywhere; never throws, never blocks UI, silently no-ops on failure.
 *
 * @param eventName  snake_case event (e.g. 'progress_tab_opened')
 * @param metadata   small key/values only — no images, AI blobs, or emails
 */
export function trackAnalyticsEvent(
  eventName: string,
  metadata: Record<string, unknown> = {},
): void {
  logEvent(eventName, metadata);
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
  logEvent("hunt_scan_started", { scannedCount, scan_type: "hunt", model_name: "gpt-4o", api_provider: "openai" });
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

// ─── Focus-based navigation tracking ──────────────────────────────────────────
//
// useScreenFocus(eventName, metadata?, cooldownMs?)
//
// Fires when a screen becomes FOCUSED, not just mounted. Uses useFocusEffect so
// returning to a screen (e.g. back-navigation) triggers a new event after the
// cooldown elapses. A per-event in-memory timestamp prevents spam when:
//   • React rerenders without unmount
//   • the user switches tabs rapidly
//   • the user returns within the cooldown window (default 30 s)
//
// Usage:
//   useScreenFocus('progress_tab_opened');
//   useScreenFocus('brand_detail_opened', { brand_id: 'Nike', brand_rarity: 'rare' });
//
// Safe to call unconditionally (no conditional hook rules violated — it's
// always called, metadata just varies). Never throws.
//
// NOTE: this is a React hook and must only be called inside a component body.

import { useCallback, useRef } from "react";
import { useFocusEffect } from "expo-router";

// Module-level cooldown store: cooldownKey → lastFiredAt (ms). In-memory only,
// resets on app restart (intentional — session boundary).
// Key defaults to eventName for broad screens; caller passes a specific key
// for detail/segmented screens (e.g. 'brand_detail_opened:Nike') so each item
// has its own independent cooldown window.
const _focusLastFired: Record<string, number> = {};

const DEFAULT_FOCUS_COOLDOWN_MS = 30_000; // 30 seconds

export function useScreenFocus(
  eventName: string,
  metadata:  Record<string, unknown> = {},
  options:   { cooldownMs?: number; cooldownKey?: string } = {},
): void {
  const cooldownMs  = options.cooldownMs  ?? DEFAULT_FOCUS_COOLDOWN_MS;
  // If no explicit cooldownKey is provided, fall back to eventName — correct
  // for broad screens. Detail screens pass an item-specific key so Nike and
  // Gucci each have their own 30-second window rather than sharing one.
  const cooldownKey = options.cooldownKey ?? eventName;

  // Stable refs so useFocusEffect doesn't re-subscribe on every render.
  const eventRef      = useRef(eventName);
  const metaRef       = useRef(metadata);
  const cooldownRef   = useRef(cooldownMs);
  const keyRef        = useRef(cooldownKey);
  eventRef.current    = eventName;
  metaRef.current     = metadata;
  cooldownRef.current = cooldownMs;
  keyRef.current      = cooldownKey;

  useFocusEffect(
    useCallback(() => {
      try {
        const now  = Date.now();
        const last = _focusLastFired[keyRef.current] ?? 0;
        if (now - last < cooldownRef.current) return; // within cooldown — skip
        _focusLastFired[keyRef.current] = now;
        trackAnalyticsEvent(eventRef.current, metaRef.current);
      } catch { /* never throw */ }
    }, []), // empty deps — refs keep values current without re-subscribing
  );
}
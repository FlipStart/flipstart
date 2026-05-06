/**
 * server/feedback.ts
 *
 * Beta feedback + market learning storage.
 *
 * Every scan generates structured feedback data for future:
 *   - AI pricing model improvement
 *   - demand prediction calibration
 *   - buy/pass accuracy tracking
 *   - proprietary resale dataset
 *
 * Storage: in-memory + JSON file persistence (/tmp/flipstart-feedback.json)
 * This is sufficient for beta (5-10 users). Migrate to DB before public launch.
 */

import * as fs from "fs";

const STORAGE_PATH = "/tmp/flipstart-feedback.json";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AccuracyRating = "accurate" | "somewhat" | "bad";
export type BuyDecision    = "bought"   | "passed"   | "unsure";

export interface FeedbackEntry {
  // Identity
  id:        string;
  scanId:    string;
  timestamp: number;

  // AI prediction snapshot — what the AI said
  prediction: {
    itemName:       string;
    brand:          string;
    category:       string;
    resaleLow:      number;
    resaleHigh:     number;
    suggestedBuy:   number;
    demand:         string;         // "High" | "Medium" | "Low"
    bestPlatform:   string;
    confidenceScore: number;        // 0-100
    recommendation: string;         // "STRONG_BUY" | "BUY" | "RISKY_BUY" | "SKIP"
  };

  // User feedback
  feedback: {
    accuracyRating:     AccuracyRating | null;
    buyDecision:        BuyDecision    | null;
    userEstimatedValue: number         | null;   // what user thinks it's worth
    notes:              string         | null;   // "Anything the AI missed?"
  };
}

// ─── In-memory store ──────────────────────────────────────────────────────────

let _entries: FeedbackEntry[] = [];
let _loaded  = false;

function loadFromDisk() {
  if (_loaded) return;
  _loaded = true;
  try {
    if (fs.existsSync(STORAGE_PATH)) {
      const raw = fs.readFileSync(STORAGE_PATH, "utf-8");
      _entries  = JSON.parse(raw) as FeedbackEntry[];
    }
  } catch {
    _entries = [];
  }
}

function saveToDisk() {
  try {
    fs.writeFileSync(STORAGE_PATH, JSON.stringify(_entries, null, 2), "utf-8");
  } catch {
    // /tmp may be read-only in some envs — in-memory still works
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function submitFeedback(entry: FeedbackEntry): void {
  loadFromDisk();
  // Replace if scanId already exists (user re-submits), otherwise append
  const idx = _entries.findIndex(e => e.scanId === entry.scanId);
  if (idx !== -1) {
    _entries[idx] = entry;
  } else {
    _entries.push(entry);
  }
  saveToDisk();
}

export function getAllFeedback(): FeedbackEntry[] {
  loadFromDisk();
  return _entries;
}

export function getFeedbackByScanId(scanId: string): FeedbackEntry | null {
  loadFromDisk();
  return _entries.find(e => e.scanId === scanId) ?? null;
}

// ─── Dev analytics helpers (used by /api/dev/feedback endpoint) ───────────────

export function getFeedbackSummary() {
  loadFromDisk();
  const total   = _entries.length;
  if (total === 0) return { total: 0 };

  const ratings  = { accurate: 0, somewhat: 0, bad: 0 };
  const decisions = { bought: 0, passed: 0, unsure: 0 };
  let   totalEstimated   = 0;
  let   countEstimated   = 0;
  let   totalPredicted   = 0;
  const categories: Record<string, number> = {};

  for (const e of _entries) {
    if (e.feedback.accuracyRating)     ratings[e.feedback.accuracyRating]++;
    if (e.feedback.buyDecision)        decisions[e.feedback.buyDecision]++;
    if (e.feedback.userEstimatedValue) { totalEstimated += e.feedback.userEstimatedValue; countEstimated++; }
    totalPredicted += e.prediction.resaleHigh;
    const cat = e.prediction.category || "Unknown";
    categories[cat] = (categories[cat] ?? 0) + 1;
  }

  const topCategory = Object.entries(categories).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  return {
    total,
    accuracyRatings:      ratings,
    buyDecisions:         decisions,
    avgPredictedResale:   Math.round(totalPredicted / total),
    avgUserEstimate:      countEstimated ? Math.round(totalEstimated / countEstimated) : null,
    topCategory,
    categories,
  };
}
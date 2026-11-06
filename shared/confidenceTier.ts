/**
 * shared/confidenceTier.ts
 *
 * The user-facing identification confidence: HIGH / MEDIUM / LOW.
 *
 * It answers one question: how sure is FlipStart about WHAT this item is?
 * It is not price confidence, sold comps, profit, Buy / Strong Buy, demand,
 * sell speed or authenticity. Those are separate signals with their own rules,
 * and nothing in this file reads them.
 *
 * The tier comes from the identification level (server/canonical/confidence.ts),
 * never from the score:
 *
 *   exact   → HIGH    a specific product read off the item
 *   brand   → HIGH    a brand, or official team / band / event / character
 *                     merchandise, seen or read on the item
 *   type    → MEDIUM  the item type is known, the brand is not confirmed
 *   partial → LOW     only part of the item could be identified
 *   none    → no tier couldn't identify, no item, or several items with none
 *                     clear. Those are problem states, not "Low confidence".
 *
 * Photo count never enters it. One clear photo of a readable tag is HIGH.
 *
 * The 0-100 score still exists for compatibility (app 2.1's screens and
 * labels, Diamonds, the recommendation engine, historical analytics). It is an
 * ordinal position, not a probability: 86 does not mean "86% likely correct".
 *
 * Lives in shared/ so the server (which computes the tier) and the app (which
 * shows it, and works it out for scans saved before the server sent one)
 * cannot disagree.
 */
import type { IdentificationLevel } from "./canonical.types.js";

export type ConfidenceTier = "high" | "medium" | "low";

export const TIER_FOR_LEVEL: Record<IdentificationLevel, ConfidenceTier | null> = {
  exact: "high",
  brand: "high",
  type: "medium",
  partial: "low",
  none: null,
};

export function tierForLevel(level: unknown): ConfidenceTier | null {
  return typeof level === "string" && Object.prototype.hasOwnProperty.call(TIER_FOR_LEVEL, level)
    ? TIER_FOR_LEVEL[level as IdentificationLevel]
    : null;
}

/**
 * For scans that predate the server tier: worked out from the compatibility
 * score, using boundaries app 2.1 already uses — 70 (its "verify" hint), 55
 * and 35 (its low and very-low screens). For every score the current server
 * produces this matches the level's tier; the one exception is a score held
 * at 60 for authenticity concerns, which the server's own tier covers.
 */
export function tierFromScore(score: unknown): ConfidenceTier | null {
  const n = typeof score === "number" ? score : Number(score);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n >= 70) return "high";
  if (n >= 55) return "medium";
  if (n >= 35) return "low";
  return null;
}

/**
 * What to show. The server's tier when the scan carries one — including an
 * explicit null, which means a problem state — otherwise worked out from the
 * score.
 */
export function resolveConfidenceTier(serverTier: unknown, score: unknown): ConfidenceTier | null {
  if (serverTier === "high" || serverTier === "medium" || serverTier === "low") return serverTier;
  if (serverTier === null) return null;
  return tierFromScore(score);
}

export const TIER_LABEL: Record<ConfidenceTier, string> = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
};

export const TIER_LABEL_CAPS: Record<ConfidenceTier, string> = {
  high: "HIGH CONFIDENCE",
  medium: "MEDIUM CONFIDENCE",
  low: "LOW CONFIDENCE",
};
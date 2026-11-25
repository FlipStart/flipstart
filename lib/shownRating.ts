/**
 * lib/shownRating.ts
 *
 * The rating the user actually saw, for analytics.
 *
 * Since the V1 route the server sends no rating at all: Strong Buy / Buy /
 * Risky Buy / Skip is decided on the phone by the shared engine
 * (computeFlipCalc in utils/flipCalculations.ts, the one results, Hunt and
 * Deep Analysis all use). So scan_completed's old `recommendation` key —
 * copied from the server payload — has been an empty string on every V1 scan,
 * and the rating a user was shown was recorded nowhere.
 *
 * These fields fix that, and keep the two sources apart:
 *   recommendation_server  what the server sent, or null (V1 sends none)
 *   recommendation_shown   STRONG_BUY | BUY | RISKY_BUY | SKIP, as shown
 *   rating_price_basis     what price it was rated at:
 *                            suggested — FlipStart's suggested buy price
 *                                        (no price typed yet; what the
 *                                        results screen opens with)
 *                            entered   — a price the user typed
 *                            none      — no price at all ($0)
 *
 * The rating on open uses provisionalEconomics(), which runs the engine on
 * exactly the inputs the results screen reads (engineInputs: the same v1 risk
 * signals and resale low) at the same price resolveEffectiveThriftPrice picks
 * when nothing is typed. A test holds the two to the same answer.
 *
 * Pure. Never throws: a rating that can't be worked out is recorded as null.
 */
import type { ScanResult } from './types';
import { provisionalEconomics } from './huntEconomics';

export type ShownRatingLabel = 'STRONG_BUY' | 'BUY' | 'RISKY_BUY' | 'SKIP';
export type RatingPriceBasis = 'suggested' | 'entered' | 'none';

const LABELS = new Set<string>(['STRONG_BUY', 'BUY', 'RISKY_BUY', 'SKIP']);

export interface ShownRatingFields {
  recommendation_server: string | null;
  recommendation_shown: ShownRatingLabel | null;
  rating_price_basis: RatingPriceBasis;
}

/** A coded label, or null for anything else. */
export function asShownLabel(label: unknown): ShownRatingLabel | null {
  return typeof label === 'string' && LABELS.has(label) ? (label as ShownRatingLabel) : null;
}

/** What the server sent as a rating, or null when it sent none. */
export function serverRecommendation(raw: unknown): string | null {
  return typeof raw === 'string' && raw.trim() ? raw.trim().slice(0, 40) : null;
}

/** The rating a fresh result opens with: no price typed, rated at the suggested buy price. */
export function ratingFieldsAtOpen(scan: ScanResult, serverRaw: unknown): ShownRatingFields {
  let shown: ShownRatingLabel | null = null;
  let basis: RatingPriceBasis = 'none';
  try {
    const e = provisionalEconomics(scan);
    shown = asShownLabel(e.calc?.recommendation?.label);
    basis = e.basis !== null ? 'suggested' : 'none';
  } catch { /* recorded as null */ }
  return { recommendation_server: serverRecommendation(serverRaw), recommendation_shown: shown, rating_price_basis: basis };
}

/** The rating on screen when the user saved: whatever the price field held then. */
export function ratingFieldsAtSave(label: unknown, priceEntered: boolean, suggestedPrice: unknown): Pick<ShownRatingFields, 'recommendation_shown' | 'rating_price_basis'> {
  const hasSuggested = typeof suggestedPrice === 'number' && Number.isFinite(suggestedPrice) && suggestedPrice > 0;
  return {
    recommendation_shown: asShownLabel(label),
    rating_price_basis: priceEntered ? 'entered' : hasSuggested ? 'suggested' : 'none',
  };
}
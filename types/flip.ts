/**
 * FlipStart — Flip type system
 *
 * FlipResult    → what gets persisted when user confirms an item
 * FlipCalc      → live recalculated values derived from FlipResult + thrift price
 * GlobalStats   → derived from the full FlipResult[] history
 * GlobalRank    → rank label + score
 */

import type { ScanResult } from '@/lib/types';
import type { XpBreakdownItem } from '@/lib/huntXp';

// ─── Persisted (stored in useFlipStore) ──────────────────────────────────────

/** Structured v2 scan-ID fields. All optional — older scans omit them and the
 *  Diamond matcher falls back to legacy fields under the same strict rules. */
export interface StructuredId {
  canonicalBrand?:        string;
  canonicalItemName?:     string;
  itemType?:              string;
  subType?:               string;
  styleVariant?:          string;
  modelName?:             string;
  logoPlacement?:         string;
  eraEstimate?:           string;
  eraConfidence?:         'low' | 'medium' | 'high';
  eraEvidence?:           string[];
  materialSignals?:       string[];
  graphicSignals?:        string[];
  sportsTeam?:            string;
  league?:                string;
  playerNumber?:          string;
  playerNameGuess?:       string;
  playerNameConfidence?:  'low' | 'medium' | 'high';
  brandModelSignals?:     string[];
  possibleDiamondIds?:    string[];
  diamondReasoningShort?: string;
}

export interface FlipResult {
  /** Matches ScanResult.id from scan-context */
  id:           string;
  imageUri:     string;
  timestamp:    number;

  // Identification
  itemName:     string;
  brand:        string;
  category:     string;
  era:          string;
  styleLabels:  string[];
  material:     string;

  // Structured v2 ID fields (optional — present on new scans, absent on old).
  // Carried verbatim from ScanResult.identification so the Diamond matcher can
  // prefer precise signals over loose title keywords.
  structured?:  StructuredId;

  // Market data from AI
  resaleValue:       number;
  resaleRangeLow:    number;
  resaleRangeHigh:   number;
  avgSoldPrice:      number;
  demand:            'High' | 'Medium' | 'Low';
  sellSpeed:         'Fast' | 'Moderate' | 'Slow';
  competitionLevel:  string;
  matchConfidence:   number;
  riskFlags:         string[];

  // User-confirmed values
  thriftPrice: number;   // what user actually paid / entered

  // Calculated at confirm time (from utils/flipCalculations.ts)
  fees:        number;
  profit:      number;
  roi:         number;
  buyScore:    number;
  buyLabel:    BuyLabel;
  stars:       number;
  bestPlatform: Platform;

  // Listings — optional; only set after user generates listings
  listingsGenerated?: boolean;
  generatedAt?:       number | null;
  listingData?:       ListingData | null;
}

// ─── Listing data (persisted inside FlipResult) ─────────────────────────────

export interface ListingData {
  ebay: {
    title:       string;
    description: string;
  };
  depop: {
    title:       string;
    description: string;
  };
}

// ─── Live recalculated values (ephemeral, derived on screen) ─────────────────

export interface FlipCalc {
  thriftPrice:    number;
  fees:           number;
  profit:         number;
  roi:            number;
  buyScore:       number;
  buyLabel:       BuyLabel;
  stars:          number;
  bestPlatform:   Platform;
  recommendation: Recommendation;

  // Listings — optional; only set after user generates listings
  listingsGenerated?: boolean;
  generatedAt?:       number | null;
  listingData?:       ListingData | null;
}

// ─── Derived stats (computed from FlipResult[]) ───────────────────────────────

export interface GlobalStats {
  totalFlips:   number;
  totalProfit:  number;
  totalCost:    number;
  lifetimeRoi:  number;   // (totalProfit / totalCost) * 100
  avgProfit:    number;   // totalProfit / totalFlips
  winRate:      number;   // % of items with buyLabel BUY or higher
}

export interface GlobalRank {
  rank:  RankLabel;
  score: number;
}

// ─── Enums / unions ───────────────────────────────────────────────────────────

export type BuyLabel =
  | '🔥 GRAIL FIND'
  | '💰 STRONG BUY'
  | '✅ BUY'
  | '⚠️ RISKY BUY'
  | "❌ DON'T BUY"
  | '🤮 TRASH';

export type Platform = 'eBay' | 'Depop' | 'Either';

export type RankLabel =
  | '🐐 GOAT'
  | '🐐 Elite'
  | '💰 Pro'
  | '📈 Skilled'
  | '🧠 Learning'
  | '🪨 Beginner';

// WIN_LABELS — labels that count as a "win" for win-rate calculation
export const WIN_LABELS: BuyLabel[] = [
  '🔥 GRAIL FIND',
  '💰 STRONG BUY',
  '✅ BUY',
];import type { Recommendation } from '@/utils/recommendation';
// ─── Hunt Bundle (Pass 2) ─────────────────────────────────────────────────────
// Represents a complete Hunt Mode session saved as ONE history entry.
// Stored in the same flips[] array as FlipResult but discriminated by `type`.

/** One item inside a saved hunt bundle. Preserves full scan data for reopening. */
export interface HuntBundleItem {
  huntItemId:   string;
  scanId:       string;
  itemName:     string;
  brand:        string;
  category:     string;
  imageUri:     string;
  thriftPrice:  number;
  profit:       number;
  huntRating:   'legendary' | 'treasure' | 'risky' | 'trash';
  kept:         boolean;
  scanSnapshot: ScanResult;   // full AI result — used to reopen Discovery Analysis
}

/** A complete Hunt Mode session saved as one Scan History bundle. */
export interface HuntBundle {
  type:               'hunt_bundle';  // discriminator — absent on old FlipResult entries
  id:                 string;         // = huntId
  huntTitle:          string;
  timestamp:          number;         // = endedAt — used for chronological sort
  startedAt:          number;
  endedAt:            number;
  durationMs:         number;
  keptItems:          HuntBundleItem[];
  removedItems:       HuntBundleItem[];
  keptItemCount:      number;
  removedItemCount:   number;
  totalCost:          number;         // sum of thriftPrice for kept items
  totalEstimatedProfit: number;       // sum of profit for kept items
  estimatedROI:       number;         // (totalEstimatedProfit / totalCost) * 100
  xpEarned?:          number;         // XP awarded when this hunt was saved
  xpBreakdown?:       XpBreakdownItem[]; // line-by-line XP breakdown for history detail UI
}

/**
 * Discriminated union of all history entry types.
 * Old FlipResult entries have no `type` field — treated as 'scan' by default.
 */
export type HistoryEntry = FlipResult | HuntBundle;

/** Type guard — true if entry is a hunt bundle, false if regular scan. */
export function isHuntBundle(entry: HistoryEntry): entry is HuntBundle {
  return (entry as HuntBundle).type === 'hunt_bundle';
}
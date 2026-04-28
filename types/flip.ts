/**
 * FlipStart — Flip type system
 *
 * FlipResult    → what gets persisted when user confirms an item
 * FlipCalc      → live recalculated values derived from FlipResult + thrift price
 * GlobalStats   → derived from the full FlipResult[] history
 * GlobalRank    → rank label + score
 */

// ─── Persisted (stored in useFlipStore) ──────────────────────────────────────

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

  // Listings — generated on demand, persisted once created
  listingsGenerated: boolean;
  generatedAt:       number | null;   // timestamp
  listingData:       ListingData | null;
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
  thriftPrice:  number;
  fees:         number;
  profit:       number;
  roi:          number;
  buyScore:     number;
  buyLabel:     BuyLabel;
  stars:        number;
  bestPlatform: Platform;
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
];
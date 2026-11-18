/**
 * lib/huntDemoData.ts
 *
 * The fixed items the Hunt onboarding demo shows. Every number is a real one:
 * the jacket sold for $180, the polo sells for about $25, and fees / profit / ROI /
 * rating are computed by the SAME engine as a real Hunt (huntEconomics), never
 * typed in. If the engine changes, the demo changes with it and can never
 * contradict the product.
 *
 * Pure data + math. No storage, no network, no Hunt state: this file cannot
 * touch XP, scans, history or the leaderboard. Photos are resolved by the caller
 * (components/hunt/onboarding/demoAssets) so this stays testable without the bundler.
 *
 * What the demo contains
 *   jacket   the interactive KEEP     (Legendary Loot)
 *   polo     the interactive SKIP     (price is too high for what it is)
 *   prefill  three kept finds + two passes already in the haul, so the
 *            dashboard, haul and results look like a real hour of thrifting
 *
 * No sold-comps data is invented. Comps are real marketplace sales, and a made-up
 * "sold listing" would be a fake claim, so the demo carries none and never searches.
 */
import { huntEconomics, type HuntRating } from '@/lib/huntEconomics';
import type { ScanResult } from '@/lib/types';

export interface DemoItemSeed {
  id: string;
  name: string;
  brand: string;
  category: string;
  /** Est. resale and thrift price, in dollars. */
  resale: number;
  thriftPrice: number;
  // Engine inputs (what a real scan would carry).
  confidence: number;
  competition: string;
  demand: string;
  speed: string;
  era: string;
  material: string;
  styleLabels: string[];
  /** Key the caller resolves to a bundled photo. Missing → no photo (icon fallback). */
  photoKey?: string;
}

export const DEMO_JACKET: DemoItemSeed = {
  id: 'demo_jacket',
  name: 'Pelle Pelle Leather Jacket',
  brand: 'Pelle Pelle',
  category: 'Leather Jacket',
  resale: 180,
  thriftPrice: 25,
  confidence: 85,
  competition: 'medium',
  demand: 'high',
  speed: 'medium',
  era: '2000s',
  material: 'Leather',
  styleLabels: ['Streetwear', 'Y2K'],
  photoKey: 'jacket',
};

/**
 * The skip. A vintage Polo by Ralph Lauren stripe: a real brand and a real
 * sale, just a small one. At a $15 tag it sells for about $25, which leaves a
 * thin profit for the effort and the engine says skip, which is exactly the
 * lesson: a known brand is not a deal.
 */
export const DEMO_POLO: DemoItemSeed = {
  id: 'demo_polo',
  name: 'Polo Ralph Lauren Striped Polo',
  brand: 'Polo Ralph Lauren',
  category: 'Polo Shirt',
  resale: 25,
  thriftPrice: 15,
  confidence: 72,
  competition: 'high',
  demand: 'medium',
  speed: 'moderate',
  era: '1990s',
  material: 'Cotton',
  styleLabels: ['Preppy', 'Vintage'],
  photoKey: 'polo',
};

/**
 * Already in the haul when the demo reaches the dashboard. All five are the
 * founder's own finds: the resale figure is what each one actually sold for.
 * Every rating comes from the engine, so the haul mixes Treasure and Legendary
 * keeps with the passes a real hour of thrifting always includes.
 */
export const DEMO_PREFILL_KEPT: DemoItemSeed[] = [
  { id: 'demo_tigger', name: 'Vintage Disney Store Tigger Sweatshirt', brand: 'Disney Store', category: 'Sweatshirt',
    resale: 30, thriftPrice: 8, confidence: 80, competition: 'medium', demand: 'medium', speed: 'moderate',
    era: '1990s', material: 'Cotton Blend', styleLabels: ['Vintage', 'Character'], photoKey: 'tigger' },
  { id: 'demo_hollister', name: 'Vintage Hollister Sherpa-Lined Zip-Up Hoodie', brand: 'Hollister', category: 'Zip-Up Hoodie',
    resale: 60, thriftPrice: 28, confidence: 80, competition: 'medium', demand: 'medium', speed: 'moderate',
    era: '2000s', material: 'Cotton Fleece', styleLabels: ['Y2K'], photoKey: 'hollister' },
  { id: 'demo_greenday', name: 'Green Day Tour Trucker Hat', brand: 'Green Day', category: 'Trucker Hat',
    resale: 18, thriftPrice: 2, confidence: 75, competition: 'medium', demand: 'medium', speed: 'moderate',
    era: 'Modern', material: 'Foam and Mesh', styleLabels: ['Band Merch'], photoKey: 'greenday' },
];

/** Passed on. Both are real sales too: they just did not pay enough for the price. */
export const DEMO_PREFILL_REMOVED: DemoItemSeed[] = [
  { id: 'demo_vest', name: 'The North Face Puffer Vest', brand: 'The North Face', category: 'Puffer Vest',
    resale: 25, thriftPrice: 15, confidence: 85, competition: 'high', demand: 'high', speed: 'fast',
    era: 'Modern', material: 'Nylon', styleLabels: ['Outdoor'], photoKey: 'vest' },
  { id: 'demo_betty', name: 'Betty Boop Tie-Dye Street Angel Tee', brand: 'Betty Boop', category: 'T-Shirt',
    resale: 5, thriftPrice: 2, confidence: 75, competition: 'high', demand: 'low', speed: 'slow',
    era: 'Modern', material: 'Cotton', styleLabels: ['Graphic', 'Tie-Dye'], photoKey: 'betty' },
];

/** A scan result shaped exactly like a real one, built from a seed. */
export function buildDemoScan(seed: DemoItemSeed, imageUri: string = '', now: number = Date.now()): ScanResult {
  const low  = Math.round(seed.resale * 0.85);
  const high = Math.round(seed.resale * 1.15);
  return {
    id: seed.id,
    imageUri,
    allImageUris: imageUri ? [imageUri] : [],
    timestamp: now,
    identification: {
      item_name: seed.name,
      brand: seed.brand,
      category: seed.category,
      estimated_era: seed.era,
      style_labels: seed.styleLabels,
      material_guess: seed.material,
      canonicalBrand: seed.brand,
      itemType: seed.category.toLowerCase(),
      eraEstimate: seed.era,
      eraConfidence: 'medium',
    },
    market_data: {
      estimated_resale_range: { low, high },
      average_sold_price: seed.resale,
      suggested_buy_price: Math.max(1, Math.round(seed.resale * 0.3)),
      demand: titleDemand(seed.demand),
      sell_speed: titleSpeed(seed.speed),
      competition_level: seed.competition,
      base_estimated_value: seed.resale,
      price_adjustments: [],
      adjusted_estimated_value: seed.resale,
    },
    risk_analysis: { match_confidence: seed.confidence, risk_flags: [] },
  };
}

function titleDemand(d: string): 'High' | 'Medium' | 'Low' {
  const v = d.toLowerCase();
  return v === 'high' ? 'High' : v === 'low' ? 'Low' : 'Medium';
}
function titleSpeed(s: string): 'Fast' | 'Moderate' | 'Slow' {
  const v = s.toLowerCase();
  return v === 'fast' ? 'Fast' : v === 'slow' ? 'Slow' : 'Moderate';
}

/** How long the example Hunt appears to have run. One number, shared by the welcome and the demo. */
export const DEMO_HUNT_MINUTES = 47;

export interface DemoHuntSummary {
  /** Everything scanned (kept + passed): the Hunt screen's "found" count. */
  found: number;
  kept: number;
  /** Est. profit and cost of the KEPT items, as the Hunt screen totals them. */
  profit: number;
  cost: number;
  minutes: number;
}

/**
 * The example Hunt's totals, summed from the demo items through the real engine.
 * The welcome shows this and the demo ends on it, so the two can never disagree.
 */
export function demoHuntSummary(): DemoHuntSummary {
  const kept = [DEMO_JACKET, ...DEMO_PREFILL_KEPT];
  const passed = [DEMO_POLO, ...DEMO_PREFILL_REMOVED];
  const profit = kept.reduce((n, s) => n + demoEconomics(s).profit, 0);
  const cost = kept.reduce((n, s) => n + s.thriftPrice, 0);
  return {
    found: kept.length + passed.length,
    kept: kept.length,
    profit: Math.round(profit),
    cost: Math.round(cost * 100) / 100,
    minutes: DEMO_HUNT_MINUTES,
  };
}

export interface DemoEconomics {
  thriftPrice: number;
  resale: number;
  fees: number;
  profit: number;
  roi: number;
  rating: HuntRating;
}

/** Fees, profit, ROI and Hunt rating for a demo item, from the real Hunt engine. */
export function demoEconomics(seed: DemoItemSeed, thriftPrice: number = seed.thriftPrice): DemoEconomics {
  const e = huntEconomics(buildDemoScan(seed), thriftPrice);
  return {
    thriftPrice: e.thriftPrice,
    resale: seed.resale,
    fees: e.fees,
    profit: e.profit,
    roi: e.roi,
    rating: e.huntRating,
  };
}
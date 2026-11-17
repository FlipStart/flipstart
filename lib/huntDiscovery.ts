/**
 * lib/huntDiscovery.ts
 *
 * What each Discovery Analysis section shows, computed from the scan and the
 * shared economics. Pure (no React), so every line is testable and nothing
 * on screen is invented: copy comes from the recommendation engine's own
 * structured headline / bullets / risk factors, or from scan fields.
 */
import type { ScanResult } from './types';
import type { HuntEconomics, HuntRating } from './huntEconomics';
import { findMaxBuyPriceForRating } from '@/utils/flipCalculations';
import { findBuyUnderPrice } from '@/utils/flipCalculations';
import { ratingSignalsFor, v1Of } from '@/utils/ratingSignals';

export const HUNT_RATING_LABEL: Record<HuntRating, string> = {
  legendary: 'Legendary Loot',
  treasure:  'Treasure',
  risky:     'Risky Buy',
  trash:     'Skip',
};

const money = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;

// ─── Buy guidance ─────────────────────────────────────────────────────────────

export interface BuyGuidance {
  buyUnder:  number | null;   // what we recommend paying (same as normal Analysis)
  skipAbove: number | null;   // above this it becomes a Skip
  line:      string | null;   // the one-line wording shown under the decision row
}

/** Same thresholds and wording as the normal results screen. */
export function huntBuyGuidance(scan: ScanResult): BuyGuidance {
  const md = scan?.market_data as any;
  const ra = scan?.risk_analysis as any;
  const sig = ratingSignalsFor(scan);
  const resale = md?.adjusted_estimated_value ?? 0;
  const conf   = ra?.match_confidence ?? 0;
  const comp   = md?.competition_level ?? '';
  const dem    = md?.demand ?? '';
  const speed  = md?.sell_speed ?? '';
  const buyUnder  = findBuyUnderPrice(resale, conf, comp, dem, speed, sig);
  const skipAbove = findMaxBuyPriceForRating(resale, conf, comp, dem, speed, sig);

  let line: string | null = null;
  if (buyUnder !== null && buyUnder > 0 && skipAbove !== null && buyUnder < skipAbove - 1) {
    line = `Buy under ${money(buyUnder)} for a solid margin · Skip above ${money(skipAbove)}`;
  } else if (buyUnder !== null && buyUnder > 0) {
    line = `Buy under ${money(buyUnder)} for a solid margin`;
  } else if (skipAbove !== null && skipAbove > 0) {
    line = `Skip above ${money(skipAbove)}`;
  } else {
    line = 'Not worth buying at any price for resale';
  }
  return { buyUnder, skipAbove, line };
}

// ─── Why this rating ──────────────────────────────────────────────────────────

export interface WhyRating {
  title:     string;          // "Why Treasure" / "Why an estimated Treasure"
  headline:  string | null;   // engine headline
  reasons:   string[];        // engine bullets (≤ 3) + price-vs-buy-under line
  watchOuts: string[];        // engine risk factors, as short chips
}

export function buildWhyRating(
  econ: HuntEconomics & { provisional?: boolean; basis?: number | null },
  rating: HuntRating,
  guidance: BuyGuidance,
  enteredPrice: number | null,
): WhyRating {
  const rec = econ.calc?.recommendation;
  const label = HUNT_RATING_LABEL[rating];
  const reasons = (rec?.bullets ?? []).filter(Boolean).slice(0, 3);

  // One structured line comparing the user's real price to the threshold.
  if (enteredPrice !== null && guidance.buyUnder !== null && guidance.buyUnder > 0) {
    reasons.push(enteredPrice <= guidance.buyUnder
      ? `Your ${money(enteredPrice)} is at or under the ${money(guidance.buyUnder)} buy-under price.`
      : `Your ${money(enteredPrice)} is above the ${money(guidance.buyUnder)} buy-under price.`);
  } else if (enteredPrice === null && econ.basis) {
    reasons.push(`Rated at FlipStart's suggested buy price of ${money(econ.basis)} until you enter yours.`);
  }

  return {
    title:     econ.provisional ? `Why an estimated ${label}` : `Why ${label}`,
    headline:  rec?.headline?.trim() || null,
    reasons,
    watchOuts: (rec?.riskFactors ?? []).map(f => f.label).filter(Boolean).slice(0, 4),
  };
}

// ─── Market snapshot ──────────────────────────────────────────────────────────

export interface SnapshotTile { label: string; value: string }

const cap = (s: unknown) => {
  const t = String(s ?? '').trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
};

/**
 * Compact market tiles. Each fact appears once. Deliberately absent:
 *   - "Risk" (the old row was identification confidence relabelled)
 *   - "Avg Sold" (average_sold_price is NOT sold-comp data — server comment)
 *   - Buy Under (already in the decision card)
 * ROI and Fees appear only once a real price is in.
 */
export function buildMarketSnapshot(
  scan: ScanResult,
  econ: HuntEconomics & { provisional?: boolean },
): SnapshotTile[] {
  const md = scan?.market_data as any;
  const tiles: SnapshotTile[] = [];
  const range = md?.estimated_resale_range;
  if (range && (range.low || range.high)) tiles.push({ label: 'Est. Resale', value: `$${range.low}–$${range.high}` });
  if (md?.adjusted_estimated_value > 0)  tiles.push({ label: 'Expected Sale', value: `$${md.adjusted_estimated_value}` });
  if (md?.demand)                        tiles.push({ label: 'Demand', value: cap(md.demand) });
  if (md?.sell_speed)                    tiles.push({ label: 'Sell Speed', value: cap(md.sell_speed) });
  if (md?.competition_level)             tiles.push({ label: 'Competition', value: cap(md.competition_level) });
  if (econ.calc?.bestPlatform)           tiles.push({ label: 'Best Platform', value: String(econ.calc.bestPlatform) });
  if (!econ.provisional) {
    tiles.push({ label: 'ROI', value: `${econ.roi}%` });
    tiles.push({ label: 'Fees', value: `$${econ.fees}` });
  }
  return tiles;
}

// ─── Item details ─────────────────────────────────────────────────────────────

export interface DetailRow { label: string; value: string; tone?: 'warn' }

const known = (s: unknown) => {
  const t = String(s ?? '').trim();
  return t && !/^(unknown|n\/a|none|null|undefined)$/i.test(t) ? t : '';
};

const ERA_STATUS: Record<string, string> = {
  confirmed: 'confirmed', likely: 'likely', possible: 'possible', unknown: 'unconfirmed',
};

/** Concise identification evidence. A row appears only when the scan has it. */
export function buildItemDetails(scan: ScanResult, authenticity: string | null): DetailRow[] {
  const id = scan?.identification as any;
  const v1 = v1Of(scan) ?? {};
  const rows: DetailRow[] = [];

  const material = known(id?.material_guess);
  if (material) rows.push({ label: 'Material', value: material });

  const size = known(v1.sizeLabel);
  const dept = known(v1.targetDepartment);
  if (size || dept) rows.push({ label: 'Size', value: [size, dept && cap(dept)].filter(Boolean).join(' · ') });

  const color = known(v1.primaryColor);
  if (color) rows.push({ label: 'Color', value: cap(color) });

  const damage: string[] = Array.isArray(v1.obviousDamage) ? v1.obviousDamage.filter(Boolean) : [];
  if (damage.length) rows.push({ label: 'Condition', value: cap(damage.slice(0, 2).join('; ')), tone: 'warn' });
  else if (Array.isArray(v1.photoSlots) || v1.conditionChecked) {
    rows.push({ label: 'Condition', value: 'No obvious damage seen in the photos' });
  }

  const era = known(id?.estimated_era);
  const decade = known(v1.productionDecade);
  const status = ERA_STATUS[String(v1.eraStatus ?? '')] ?? '';
  if (era || decade) {
    const main = decade && era && !era.includes(decade) ? `${era} (${decade})` : (era || decade);
    rows.push({ label: 'Era', value: status ? `${main} · ${status}` : main });
  }

  if (authenticity) rows.push({ label: 'Authenticity', value: `Not verified — ${authenticity}`, tone: 'warn' });

  const rescan = known(v1.rescanAdvice);
  if (rescan) rows.push({ label: 'Rescan tip', value: rescan });

  return rows;
}

/** "Carhartt · Work Vest · Modern" — brand, item type, era; blanks dropped. */
export function huntMetaLine(scan: ScanResult): string {
  const id = scan?.identification as any;
  return [known(id?.brand), known(id?.itemType ?? id?.category), known(id?.estimated_era)]
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i)
    .join(' · ');
}
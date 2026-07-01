/**
 * utils/deepAnalysis.ts
 *
 * Pure logic that turns a scan's raw data into concrete, reseller-grade
 * reasoning for the Deep Analysis screen. No React, no UI — input → output.
 *
 * Everything here derives from real fields on the scan (margin, brand,
 * competition, confidence, missing photos, etc.). It NEVER invents specific
 * facts that aren't present; when data is missing it says so with safe phrases.
 */

import type { FlipResult } from '@/types/flip';
import { normalizeBuyRating, type CanonicalRating } from '@/utils/recommendation';

export interface DeepInputs {
  flip: FlipResult;
  // Live-computed values from computeFlipCalc (reflect edited thrift price)
  profit: number;
  roi: number;
  fees: number;
  maxBuy: number;         // the price shown / used for the breakdown
  resaleValue: number;
  rating: CanonicalRating; // 'STRONG BUY' | 'BUY' | 'RISKY BUY' | 'SKIP'
}

const isUnknown = (v?: string) =>
  !v || ['unknown', 'other', 'n/a', 'insufficient evidence', ''].includes(v.trim().toLowerCase());

const lc = (v?: string) => (v ?? '').trim().toLowerCase();

// ─── 1. Why this rating? ──────────────────────────────────────────────────────

export function whyThisRating(i: DeepInputs): string[] {
  const { flip, profit, roi, rating, resaleValue, maxBuy } = i;
  const out: string[] = [];
  const comp = lc(flip.competitionLevel);
  const demand = lc(flip.demand);
  const speed = lc(flip.sellSpeed);
  const conf = flip.matchConfidence;
  const brandKnown = !isUnknown(flip.brand);

  // Margin reasoning (always lead with the money)
  if (profit >= 25) {
    out.push(`Strong margin — about $${profit} profit between the ~$${resaleValue} resale estimate and a ~$${maxBuy} buy price.`);
  } else if (profit >= 11) {
    out.push(`Workable margin — roughly $${profit} profit at a ~$${maxBuy} buy price, enough to be worth the effort.`);
  } else if (profit >= 0) {
    out.push(`Thin margin — only about $${profit} profit at this buy price, so there's little room for error.`);
  } else {
    out.push(`Negative margin at this buy price — you'd lose about $${Math.abs(profit)} after fees.`);
  }

  if (roi > 0) {
    if (roi >= 150) out.push(`High ROI (~${roi}%) — capital turns over efficiently if it sells.`);
    else if (roi >= 60) out.push(`Solid ROI (~${roi}%) for a flip in this price range.`);
    else out.push(`Modest ROI (~${roi}%) — fine if it sells fast, weak if it sits.`);
  }

  // Brand / demand
  if (brandKnown && demand === 'high') {
    out.push(`${flip.brand} has strong, steady secondhand demand — easier to sell at a fair price.`);
  } else if (brandKnown && demand === 'low') {
    out.push(`${flip.brand} is recognizable but demand looks soft right now — expect a slower sale.`);
  } else if (brandKnown) {
    out.push(`${flip.brand} is a recognizable brand, which helps buyers find and trust the listing.`);
  } else {
    out.push(`Brand isn't clearly identified, so value leans on item type, style, and condition instead.`);
  }

  // Competition / sell speed
  if (comp === 'high') {
    out.push(`High competition in this category — you may need sharp pricing or better photos to stand out.`);
  } else if (comp === 'low') {
    out.push(`Low competition means less price pressure and a better shot at your asking price.`);
  }
  if (speed === 'slow') {
    out.push(`Sell-through looks slow, so factor in holding time before it moves.`);
  } else if (speed === 'fast') {
    out.push(`Items like this tend to sell quickly, which lowers your holding risk.`);
  }

  // Confidence caveat tied to rating
  if (conf > 0 && conf < 70) {
    out.push(`Confidence is ${conf}% — verify size and condition in person before committing.`);
  }

  // Rating-specific closer
  if (rating === 'SKIP') {
    out.push(`Overall the risk/reward doesn't clear the bar at this price — walk unless you can buy much lower.`);
  } else if (rating === 'RISKY BUY') {
    out.push(`Worth it only if the price is right and you accept some uncertainty on sell speed or condition.`);
  }

  return out.slice(0, 6);
}

export function ratingQuestion(rating: CanonicalRating): string {
  switch (rating) {
    case 'STRONG BUY': return 'Why Strong Buy?';
    case 'BUY':        return 'Why Buy?';
    case 'RISKY BUY':  return 'Why Risky Buy?';
    case 'SKIP':       return 'Why Skip?';
    default:           return 'Why This Rating?';
  }
}

// ─── 2. Price logic (one concise paragraph) ───────────────────────────────────

export function priceLogicText(i: DeepInputs): string {
  const { flip, profit, fees, maxBuy, resaleValue } = i;
  const brandBit = isUnknown(flip.brand) ? 'item type and visible condition' : `${flip.brand}'s brand strength, item type, and condition`;
  if (resaleValue <= 0) {
    return `There isn't enough pricing data from this scan to estimate resale value reliably. Add clearer photos of the brand tag and item to improve the estimate.`;
  }
  const profitPhrase = profit >= 0
    ? `the expected profit is about +$${profit} after ~$${fees} in platform fees`
    : `you'd be down about $${Math.abs(profit)} after ~$${fees} in platform fees`;
  return `FlipStart estimates this can resell around $${resaleValue} based on ${brandBit}, plus current resale demand signals. At a buy price of about $${maxBuy}, ${profitPhrase}.`;
}

// ─── 3. Risk assessment ───────────────────────────────────────────────────────

export type RiskLevel = 'Low Risk' | 'Medium Risk' | 'High Risk';

export function riskAssessment(i: DeepInputs): { level: RiskLevel; color: string; bullets: string[] } {
  const { flip } = i;
  const conf = flip.matchConfidence;
  const comp = lc(flip.competitionLevel);
  const speed = lc(flip.sellSpeed);
  const bullets: string[] = [];
  let score = 0; // higher = riskier

  // Confidence-driven risk
  if (conf > 0 && conf < 55) { score += 2; bullets.push('Match confidence is low — the identification may be off; verify in person.'); }
  else if (conf > 0 && conf < 70) { score += 1; bullets.push('Confidence is moderate — double-check brand, size, and condition before buying.'); }

  // Scan-provided risk flags (real signals from the AI)
  if (flip.riskFlags?.length) {
    flip.riskFlags.slice(0, 3).forEach(f => { score += 1; bullets.push(f); });
  }

  // Missing evidence
  if (isUnknown(flip.era)) { bullets.push('Era not clearly determined from the photo.'); }
  if (isUnknown(flip.material)) { bullets.push('Material not visible — check the fabric/care tag.'); }

  // Market risk
  if (comp === 'high') { score += 1; bullets.push('High competition category — pricing and photos matter more.'); }
  if (speed === 'slow') { score += 1; bullets.push('Slower sell-through — be ready to hold the item.'); }

  // Modern vs vintage
  if (lc(flip.era) === 'modern') {
    bullets.push('Modern item — value depends on style and demand more than age.');
  }

  const level: RiskLevel = score >= 3 ? 'High Risk' : score >= 1 ? 'Medium Risk' : 'Low Risk';
  const color = level === 'High Risk' ? '#8A3A2A' : level === 'Medium Risk' ? '#B07A1E' : '#2A5A2A';

  // If low risk, explain why rather than leaving it empty
  if (level === 'Low Risk' && bullets.length === 0) {
    if (!isUnknown(flip.brand)) bullets.push('Brand and item type read clearly from the photo.');
    if (lc(flip.demand) === 'high') bullets.push('Demand appears steady for this type of item.');
    bullets.push('Still verify size and condition in person before buying.');
  }

  return { level, color, bullets: bullets.slice(0, 5) };
}

// ─── 4. Confidence breakdown ──────────────────────────────────────────────────

export function confidenceBreakdown(i: DeepInputs): { pct: number; confident: string[]; uncertain: string[] } {
  const { flip } = i;
  const confident: string[] = [];
  const uncertain: string[] = [];

  if (!isUnknown(flip.brand)) confident.push('Brand is visible and recognizable.');
  if (!isUnknown(flip.category)) confident.push('Item category is clear.');
  if (flip.styleLabels?.length) confident.push('Style can be identified from the photo.');
  if (!isUnknown(flip.era)) confident.push('Era estimate is supported by visible cues.');

  if (isUnknown(flip.brand)) uncertain.push('Brand tag is not clearly visible.');
  if (isUnknown(flip.material)) uncertain.push('Material tag is not visible.');
  if (isUnknown(flip.era)) uncertain.push('Era could not be confirmed from the photo.');
  uncertain.push('Back and detail photos could reveal flaws not visible here.');

  // Safe fallbacks so neither column is ever empty
  if (confident.length === 0) confident.push('Not enough clear signals to list what raised confidence.');
  if (uncertain.length === 0) uncertain.push('Add tag/detail photos to push confidence even higher.');

  return { pct: flip.matchConfidence, confident: confident.slice(0, 4), uncertain: uncertain.slice(0, 4) };
}

// ─── 5. Platform strategy ─────────────────────────────────────────────────────

export interface PlatformRec { name: string; note: string; }
export interface PlatformStrategy { best: PlatformRec[]; backup: PlatformRec[]; }

export function platformStrategy(i: DeepInputs): PlatformStrategy {
  const { flip } = i;
  const cat = lc(flip.category);
  const styles = (flip.styleLabels ?? []).map(lc).join(' ');
  const era = lc(flip.era);
  const text = `${cat} ${styles} ${era}`;

  const is = (...keys: string[]) => keys.some(k => text.includes(k));

  const NOTES: Record<string, string> = {
    eBay:     'Best for broad, searchable demand — vintage, workwear, and hard-to-find items.',
    Depop:    'Good for trend-driven fashion and younger buyers; rewards strong styling photos.',
    Poshmark: 'Strong for women\'s fashion brands and closet-style selling.',
    Grailed:  'Useful when the item fits a menswear or streetwear audience.',
    Mercari:  'Simple, broad marketplace — solid backup for general items.',
    Vinted:   'Growing for everyday fashion, especially in the EU.',
  };

  const best: PlatformRec[] = [];
  const backup: PlatformRec[] = [];
  const seen = new Set<string>();
  const add = (arr: PlatformRec[], name: string) => {
    if (seen.has(name)) return;
    seen.add(name);
    arr.push({ name, note: NOTES[name] });
  };

  const vintage = is('vintage', 'retro', 'y2k', '90s', '80s', '70s') || (era && era !== 'modern' && era !== 'unknown');
  const streetwear = is('streetwear', 'hype', 'skate', 'denim', 'jacket', 'hoodie', 'tee', 'graphic');
  const womens = is('women', 'dress', 'blouse', 'skirt', 'heels', 'purse', 'handbag');
  const menswear = is('men', 'menswear');

  if (vintage) { add(best, 'eBay'); add(best, 'Depop'); if (streetwear || menswear) add(best, 'Grailed'); }
  if (womens) { add(best, 'Depop'); add(best, 'Poshmark'); }
  if (streetwear && !vintage) { add(best, 'Depop'); add(best, 'Grailed'); }

  // Default best bet if nothing matched
  if (best.length === 0) { add(best, 'eBay'); add(best, 'Depop'); }

  // Backups = anything not already a best bet, capped
  ['eBay', 'Poshmark', 'Mercari', 'Vinted'].forEach(p => { if (backup.length < 2) add(backup, p); });

  return { best: best.slice(0, 3), backup: backup.slice(0, 2) };
}

// ─── 6. Listing strategy ──────────────────────────────────────────────────────

export interface ListingStrategy {
  listPriceRange: string;
  acceptAbove: string;
  keywords: string[];
  photos: string[];
  mention: string[];
}

export function listingStrategy(i: DeepInputs): ListingStrategy {
  const { flip, resaleValue } = i;
  const low  = flip.resaleRangeLow  > 0 ? flip.resaleRangeLow  : Math.round(resaleValue * 0.9);
  const high = flip.resaleRangeHigh > 0 ? flip.resaleRangeHigh : Math.round(resaleValue * 1.2);
  const acceptAbove = Math.round((low + resaleValue) / 2);

  const kw: string[] = [];
  if (!isUnknown(flip.brand)) kw.push(flip.brand);
  if (!isUnknown(flip.category)) kw.push(flip.category);
  (flip.styleLabels ?? []).slice(0, 3).forEach(s => kw.push(s));
  if (!isUnknown(flip.material)) kw.push(flip.material);
  if (kw.length === 0) kw.push('Add brand, category, and style once confirmed');

  return {
    listPriceRange: resaleValue > 0 ? `$${low}–$${high}` : 'Not enough data',
    acceptAbove: resaleValue > 0 ? `$${acceptAbove}` : 'Not enough data',
    keywords: kw.slice(0, 6),
    photos: ['Front', 'Back', 'Brand tag', 'Size tag', 'Fabric/care tag', 'Any flaws'],
    mention: ['Size & measurements', 'Condition (flaws, wear)', 'Fabric content', 'Fit (e.g. relaxed, slim)'],
  };
}

// ─── 7. Item evidence ─────────────────────────────────────────────────────────

export interface EvidenceField { label: string; value: string; }

export function itemEvidence(i: DeepInputs): { present: EvidenceField[]; missing: string[] } {
  const { flip } = i;
  const val = (v?: string) => (isUnknown(v) ? 'Not visible from photo' : (v as string));
  const present: EvidenceField[] = [
    { label: 'Brand',    value: val(flip.brand) },
    { label: 'Category', value: val(flip.category) },
    { label: 'Era',      value: val(flip.era) },
    { label: 'Material', value: val(flip.material) },
  ];
  if (flip.styleLabels?.length) {
    present.push({ label: 'Style', value: flip.styleLabels.slice(0, 4).join(', ') });
  }

  const missing: string[] = [];
  if (isUnknown(flip.brand)) missing.push('Brand tag');
  if (isUnknown(flip.material)) missing.push('Material/care tag');
  if (isUnknown(flip.era)) missing.push('Era-dating cues');
  missing.push('Back view', 'Close-ups of any flaws');

  return { present, missing: missing.slice(0, 5) };
}

// ─── 8. What could change this rating? ────────────────────────────────────────

export function whatCouldChange(i: DeepInputs): string[] {
  const { flip, rating } = i;
  const out: string[] = [
    'Heavy stains, holes, or pilling would lower the value and rating.',
    'A desirable size or new-with-tags condition could raise the value.',
  ];
  if (isUnknown(flip.brand)) out.push('Confirming the brand tag would sharpen the estimate significantly.');
  else out.push('If the brand tag is missing or altered, confidence should drop.');

  if (lc(flip.competitionLevel) === 'high' || lc(flip.sellSpeed) === 'slow') {
    out.push('If similar items are saturated, sell speed may be slower than estimated.');
  }
  out.push('Clearer photos of tags and condition can improve accuracy either way.');

  if (rating === 'SKIP') {
    out.push('A much lower thrift price could flip this from Skip to a Buy.');
  }
  return out.slice(0, 5);
}

// Convenience: build the full input object from a flip + calc.
export function buildDeepInputs(
  flip: FlipResult,
  calc: { profit: number; roi: number; fees: number },
  maxBuy: number,
): DeepInputs {
  return {
    flip,
    profit: calc.profit,
    roi: calc.roi,
    fees: calc.fees,
    maxBuy,
    resaleValue: flip.resaleValue,
    rating: normalizeBuyRating(flip.recommendation?.label ?? (flip as any).buyLabel ?? 'SKIP'),
  };
}
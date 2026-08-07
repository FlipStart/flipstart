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
  /**
   * The USER'S price — what they paid or entered. Renamed from `maxBuy`, which
   * caused Deep Analysis to print "MAX BUY $7" for a value that was simply the
   * user's own thrift price.
   */
  userPrice: number;
  /** findBuyThresholdPrice() — the price we actually recommend. May be null. */
  buyThreshold?: number | null;
  /** findMaxBuyPriceForRating() — above this it becomes a SKIP. May be null. */
  absoluteCeiling?: number | null;
  resaleValue: number;
  rating: CanonicalRating; // 'STRONG BUY' | 'BUY' | 'RISKY BUY' | 'SKIP'
}

const isUnknown = (v?: string) =>
  !v || ['unknown', 'other', 'n/a', 'insufficient evidence', ''].includes(v.trim().toLowerCase());

const lc = (v?: string) => (v ?? '').trim().toLowerCase();

// ─── 1. Why this rating? ──────────────────────────────────────────────────────

/**
 * Why this rating?
 *
 * The ordering must match the verdict. A RISKY BUY explanation that opens with
 * "workable margin" is answering "why buy" — it reads like the rating is wrong.
 * For RISKY BUY and SKIP the risk leads; the upside follows as the reason it
 * is not a flat SKIP.
 *
 * The AI's own risky_buy_reasons come first where present. It saw the item; a
 * template did not. Derived reasons only fill the gaps.
 */
export function whyThisRating(i: DeepInputs): string[] {
  const { flip, profit, roi, rating, resaleValue, userPrice, buyThreshold, absoluteCeiling } = i;
  const comp   = lc(flip.competitionLevel);
  const demand = lc(flip.demand);
  const speed  = lc(flip.sellSpeed);
  const conf   = flip.matchConfidence;
  const brandKnown = !isUnknown(flip.brand);

  // ── Reason pools ───────────────────────────────────────────────────────────

  const marginReason = (): string => {
    if (profit >= 25)  return `Strong margin — about $${profit} profit between the ~$${resaleValue} resale estimate and your $${userPrice} price.`;
    if (profit >= 11)  return `Workable margin — roughly $${profit} profit at your $${userPrice} price.`;
    if (profit >= 0)   return `Thin margin — only about $${profit} profit at this buy price, so there's little room for error.`;
    return `Negative margin at this buy price — you'd lose about $${Math.abs(profit)} after fees.`;
  };

  const roiReason = (): string | null => {
    if (roi <= 0) return null;
    if (roi >= 150) return `High ROI (~${roi}%) — capital turns over efficiently if it sells.`;
    if (roi >= 60)  return `Solid ROI (~${roi}%) for a flip in this price range.`;
    return `Modest ROI (~${roi}%) — fine if it sells fast, weak if it sits.`;
  };

  /** What actually makes this risky. Derived only — the AI's own reasons are
   *  layered on top by the caller. */
  const riskReasons = (): string[] => {
    const r: string[] = [];
    if (speed === 'slow')   r.push(`Slow sell-through — expect to hold this a while before it moves.`);
    if (demand === 'low')   r.push(`Soft demand for this type of item, so it may sit even priced well.`);
    if (comp === 'high')    r.push(`Saturated category — plenty of similar listings competing on price.`);
    if (profit > 0 && profit < 11) {
      r.push(`Margin is thin at ~$${profit} — one return or a price cut erases it.`);
    }
    if (conf > 0 && conf < 70) {
      r.push(`Identification confidence is ${conf}% — verify brand, size, and condition in person.`);
    }
    if (v1?.buyerPool === 'narrow' || v1?.buyerPool === 'very_narrow') {
      r.push(`Narrow buyer pool — it may be worth the money, but only to the right person.`);
    }
    if (typeof v1?.priceConfidence === 'number' && v1.priceConfidence < 50) {
      r.push(`Price confidence is only ${v1.priceConfidence}% — the resale estimate could move either way.`);
    }
    if (v1?.assessmentLimited) {
      r.push(`Parts of the item were not visible, so condition is only partly assessed.`);
    }
    if (isUnknown(flip.era))      r.push(`Era could not be confirmed, and age moves value on items like this.`);
    if (isUnknown(flip.material)) r.push(`Material not visible — check the fabric tag before committing.`);
    if (resaleValue <= 0)         r.push(`No reliable resale estimate, so profit here is unverified.`);
    return r;
  };

  /** Why it is not a flat SKIP. Kept short and placed after the risk. */
  const upsideReasons = (): string[] => {
    const u: string[] = [];
    if (profit >= 11) u.push(marginReason());
    const r = roiReason();
    if (r && roi >= 150) u.push(r);
    if (brandKnown && demand === 'high') {
      u.push(`${flip.brand} has steady secondhand demand, which helps it move.`);
    }
    if (speed === 'fast') u.push(`Items like this tend to sell quickly, lowering holding risk.`);
    return u;
  };

  // Canonical V1 values, when this scan produced them.
  const v1 = flip.structured?.v1;

  // AI-supplied reasons first — it saw the photos. risky_buy_reasons is the
  // model's direct answer to "why is this risky"; marketability_reasons and
  // obvious damage back it up with specifics.
  const aiReasons = [
    ...(flip.riskyBuyReasons ?? []),
    ...(v1?.obviousDamage ?? []),
    ...(v1?.authenticityConcerns ?? []),
    ...(v1?.marketabilityReasons ?? []).filter(r =>
      /slow|satur|compet|narrow|niche|soft|sit|hold|low demand/i.test(r)),
  ].map(s => (s || '').trim()).filter(Boolean);

  const dedupe = (list: string[]): string[] => {
    const seen = new Set<string>();
    return list.filter(s => {
      // Compare on the first few words so a derived reason does not repeat an
      // AI reason that says the same thing in different words.
      const key = s.toLowerCase().replace(/[^a-z ]/g, '').split(/\s+/).slice(0, 4).join(' ');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  // ── Rating-specific ordering ───────────────────────────────────────────────

  if (rating === 'RISKY BUY') {
    const out = dedupe([...aiReasons, ...riskReasons()]).slice(0, 4);
    const upside = upsideReasons();
    if (upside.length) {
      out.push(`Still worth considering — ${upside[0].charAt(0).toLowerCase()}${upside[0].slice(1)}`);
    }
    // Was "$7" — the user's own price described as a buy ceiling. Now uses the
    // real recommended threshold, and says nothing when one does not exist
    // rather than inventing a number.
    if (buyThreshold != null && buyThreshold > 0) {
      out.push(`For a strong buy, aim for about $${buyThreshold} or less.`);
    }
    if (absoluteCeiling != null && absoluteCeiling > 0) {
      out.push(`Above roughly $${absoluteCeiling}, FlipStart would consider this a skip.`);
    }
    return out.slice(0, 6);
  }

  if (rating === 'SKIP') {
    const out = dedupe([...aiReasons, ...riskReasons()]).slice(0, 4);
    if (profit < 0) out.unshift(marginReason());
    out.push(`The risk/reward doesn't clear the bar at this price — walk unless you can buy much lower.`);
    return dedupe(out).slice(0, 6);
  }

  // STRONG BUY / BUY — the money is genuinely the reason, so it leads.
  const out: string[] = [marginReason()];
  const r = roiReason();
  if (r) out.push(r);
  if (brandKnown && demand === 'high') {
    out.push(`${flip.brand} has strong, steady secondhand demand — easier to sell at a fair price.`);
  } else if (brandKnown) {
    out.push(`${flip.brand} is a recognizable brand, which helps buyers find and trust the listing.`);
  } else {
    out.push(`Brand isn't clearly identified, so value leans on item type, style, and condition instead.`);
  }
  if (comp === 'low')   out.push(`Low competition means less price pressure and a better shot at your asking price.`);
  if (speed === 'fast') out.push(`Items like this tend to sell quickly, which lowers your holding risk.`);
  // Caveats still belong here, just not leading.
  if (conf > 0 && conf < 70) out.push(`Confidence is ${conf}% — verify size and condition in person before committing.`);
  return dedupe(out).slice(0, 6);
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
  const { flip, profit, fees, userPrice, resaleValue, buyThreshold, absoluteCeiling } = i;
  const brandBit = isUnknown(flip.brand) ? 'item type and visible condition' : `${flip.brand}'s brand strength, item type, and condition`;
  if (resaleValue <= 0) {
    return `There isn't enough pricing data from this scan to estimate resale value reliably. Add clearer photos of the brand tag and item to improve the estimate.`;
  }
  const profitPhrase = profit >= 0
    ? `the expected profit is about +$${profit} after ~$${fees} in platform fees`
    : `you'd be down about $${Math.abs(profit)} after ~$${fees} in platform fees`;

  // Prefer the model's own stated basis over the template. It looked at the
  // item; "current resale demand signals" is a phrase, not a reason — and it
  // also implies live market access the system does not have.
  const v1 = flip.structured?.v1;
  const basis = (v1?.pricingBasis ?? []).filter(Boolean);
  if (basis.length) {
    const reasons = basis.slice(0, 2).join('; ');
    const caveat = (v1?.pricingUnknowns ?? [])[0];
    return `FlipStart estimates this can resell around $${resaleValue} — ${reasons}. ` +
           `At your $${userPrice} price, ${profitPhrase}.` +
           (caveat ? ` ${caveat.charAt(0).toUpperCase()}${caveat.slice(1)}.` : '');
  }
  return `FlipStart estimates this can resell around $${resaleValue} based on ${brandBit}. At your $${userPrice} price, ${profitPhrase}.`;
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
/**
 * Assemble deep-analysis inputs.
 *
 * `liveRating` MUST be passed whenever the user can edit the thrift price. The
 * stored rating on the flip reflects the price at scan time; reading it here
 * meant the explanation was written for a rating the screen was no longer
 * showing — raise the price until an item is unprofitable and it would still
 * explain why it was a good buy.
 *
 * It stays optional so callers that genuinely have no live calc (a read-only
 * historical view) still work, falling back to the stored value.
 */
export function buildDeepInputs(
  flip: FlipResult,
  calc: { profit: number; roi: number; fees: number },
  userPrice: number,
  buyThreshold: number | null,
  absoluteCeiling: number | null,
  liveRating?: CanonicalRating,
): DeepInputs {
  return {
    flip,
    profit: calc.profit,
    roi: calc.roi,
    fees: calc.fees,
    userPrice,
    buyThreshold,
    absoluteCeiling,
    resaleValue: flip.resaleValue,
    rating: liveRating
      ?? normalizeBuyRating(flip.recommendation?.label ?? (flip as any).buyLabel ?? 'SKIP'),
  };
}
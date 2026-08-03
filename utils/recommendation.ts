/**
 * utils/recommendation.ts
 *
 * Centralized recommendation engine for FlipStart.
 * Returns a structured recommendation used by both Analysis and Deep Analysis screens.
 *
 * Single source of truth — no recommendation logic lives in components.
 * Pure function: input → output, no side effects, no React deps.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type RecLabel = 'STRONG_BUY' | 'BUY' | 'RISKY_BUY' | 'SKIP';

export interface RecommendationInput {
  netProfit:        number;
  resaleValue:      number;
  thriftPrice:      number;
  roi:              number;
  matchConfidence:  number;   // 0–100
  competitionLevel: string;   // 'High' | 'Moderate' | 'Low' | ''
  demandLevel:      string;   // 'High' | 'Medium' | 'Low' | ''
  sellSpeed:        string;   // 'Fast' | 'Moderate' | 'Slow' | ''
  /** Canonical V1 signals. Optional — absent on v0 scans, which simply carry
   *  fewer risk factors rather than behaving differently. */
  buyerPool?:       string;   // 'broad' | 'moderate' | 'narrow' | 'very_narrow'
  hasObviousDamage?: boolean;
  eraUnconfirmed?:  boolean;
  /** ai.pricing.price_confidence, 0-100. Gates STRONG_BUY: a resale estimate
   *  the model is unsure of cannot support the app's strongest verdict. */
  priceConfidence?: number;
}

export interface Recommendation {
  label:        RecLabel;
  displayLabel: string;     // e.g. "Strong Buy"
  headline:     string;     // one-line summary for decision card
  bullets:      string[];   // 2–4 situational reason bullets
  warning?:     string;     // optional extra caution note
  colorKey:     RecLabel;   // same as label — used by UI for theme lookup
  /** Exactly what pushed this down a tier. Rendered under a RISKY BUY card so
   *  the user sees the specific reason rather than a generic caution. Same
   *  source as the Deep Analysis reasons, so the two cannot drift. */
  riskFactors:  RiskFactor[];
}

export type RiskFactorCode =
  | 'SLOW_SELL' | 'HIGH_COMPETITION' | 'LOW_CONFIDENCE'
  | 'NARROW_POOL' | 'OBVIOUS_DAMAGE' | 'ERA_UNCONFIRMED' | 'THIN_MARGIN'
  | 'LOW_DEMAND' | 'VERY_SLOW_SELL' | 'PRICE_CONFIDENCE_TOO_LOW_FOR_STRONG_BUY';

export interface RiskFactor { code: RiskFactorCode; label: string }

// Plain-language, and specific enough to act on. "Slow sell speed" tells the
// user what to expect; "risky" does not.
const RISK_LABELS: Record<RiskFactorCode, string> = {
  SLOW_SELL:        'Slow sell speed',
  VERY_SLOW_SELL:   'Very slow to sell',
  HIGH_COMPETITION: 'Lots of competition',
  LOW_DEMAND:       'Low demand',
  LOW_CONFIDENCE:   'Not sure what this is',
  NARROW_POOL:      'Niche buyer',
  OBVIOUS_DAMAGE:   'Visible damage',
  ERA_UNCONFIRMED:  'Era unconfirmed',
  THIN_MARGIN:      'Thin margin',
  PRICE_CONFIDENCE_TOO_LOW_FOR_STRONG_BUY: 'Price estimate uncertain',
};

/** STRONG_BUY needs a resale number worth betting on. At or below this the
 *  estimate is a guess, and the app's strongest verdict should not rest on a
 *  guess however good the margin looks. */
const STRONG_BUY_MIN_PRICE_CONFIDENCE = 75;

/** Ranked by how much each should worry a reseller. The card shows the top few,
 *  so ordering decides what the user actually reads. */
const RISK_PRIORITY: RiskFactorCode[] = [
  'OBVIOUS_DAMAGE', 'THIN_MARGIN', 'VERY_SLOW_SELL', 'LOW_DEMAND',
  'SLOW_SELL', 'HIGH_COMPETITION', 'NARROW_POOL', 'LOW_CONFIDENCE', 'ERA_UNCONFIRMED',
];

// ─── Normalisation helpers ─────────────────────────────────────────────────────

function comp(raw: string): 'high' | 'moderate' | 'low' {
  const v = raw.toLowerCase();
  if (v === 'high')                           return 'high';
  if (v === 'low')                            return 'low';
  return 'moderate';
}

function demand(raw: string): 'high' | 'medium' | 'low' {
  const v = raw.toLowerCase();
  if (v === 'high')                           return 'high';
  if (v === 'low')                            return 'low';
  return 'medium';
}

function speed(raw: string): 'fast' | 'moderate' | 'slow' {
  const v = raw.toLowerCase();
  if (v === 'fast' || v === 'quick')          return 'fast';
  if (v === 'slow')                           return 'slow';
  return 'moderate';
}

// ─── Core decision logic ──────────────────────────────────────────────────────

/**
 * Buy/skip decision.
 *
 * Profit sets the tier. Risk factors DEMOTE rather than veto, and enough profit
 * absorbs risk.
 *
 * The previous version gated two of its three BUY paths on
 * `competition !== 'high' && sellSpeed !== 'slow'`, making either signal an
 * absolute veto. Since the prompt correctly tells the model that mass-market
 * basics are "saturated: slow, high competition", most thrift clothing tripped
 * it and a $100-profit item still read RISKY BUY. A fat margin on a slow mover
 * is patience, not danger — it should cost a tier at most.
 */
export function getRecommendation(input: RecommendationInput): Recommendation {
  const { netProfit, roi, matchConfidence } = input;

  const c = comp(input.competitionLevel);
  const d = demand(input.demandLevel);
  const s = speed(input.sellSpeed);

  const TIERS: RecLabel[] = ['SKIP', 'RISKY_BUY', 'BUY', 'STRONG_BUY'];

  // ── Risk factors ────────────────────────────────────────────────────────────
  const factors: RiskFactor[] = [];
  const add = (code: RiskFactorCode) => factors.push({ code, label: RISK_LABELS[code] });

  const rawSpeed = (input.sellSpeed ?? '').toLowerCase();
  if (rawSpeed.includes('very slow') || rawSpeed === 'very_slow') add('VERY_SLOW_SELL');
  else if (s === 'slow')                add('SLOW_SELL');
  if (c === 'high')                     add('HIGH_COMPETITION');
  if (d === 'low')                      add('LOW_DEMAND');
  if (matchConfidence > 0 && matchConfidence < 55) add('LOW_CONFIDENCE');
  const pool = (input.buyerPool ?? '').toLowerCase();
  if (pool === 'narrow' || pool === 'very_narrow') add('NARROW_POOL');
  if (input.hasObviousDamage)           add('OBVIOUS_DAMAGE');
  if (input.eraUnconfirmed)             add('ERA_UNCONFIRMED');

  // ── Base tier from profit and confidence ────────────────────────────────────
  let base: number;
  if (netProfit < 0)                                   base = 0;
  else if (netProfit >= 25 && matchConfidence >= 70)   base = 3;
  else if (netProfit >= 15 && matchConfidence >= 55)   base = 2;
  else if (netProfit >= 11 && matchConfidence >= 40)   base = 2;
  else if (netProfit >= 8)                             base = 1;
  else                                                 base = 0;

  if (netProfit >= 0 && netProfit < 8) add('THIN_MARGIN');

  // ── Demotion ────────────────────────────────────────────────────────────────
  // Margin buys tolerance: a big enough spread absorbs one or two risk factors.
  const substantive = factors.filter(f => f.code !== 'ERA_UNCONFIRMED');

  // Era-unconfirmed does not count toward demotion on its own. On a front-only
  // scan it fires almost every time, and letting it drag every item to RISKY
  // BUY made the label meaningless.
  const weight = substantive.length;
  let demote: number;
  if (netProfit >= 40)      demote = weight <= 2 ? 0 : 1;
  else if (netProfit >= 25) demote = weight === 0 ? 0 : 1;
  else                      demote = Math.min(weight, 2);

  let tier = Math.max(0, base - demote);

  // ── STRONG_BUY price-confidence gate ────────────────────────────────────────
  //
  // Applied AFTER demotion, before the floor. A big margin on a price the model
  // is unsure of is not a strong buy — it is an uncertain buy that happens to
  // look good on paper, and presenting it as the app's strongest verdict is how
  // a user ends up overpaying on a number nobody stood behind.
  //
  // Deliberately NOT a mechanical drop to BUY. The tier steps down by one and
  // the remaining risk factors still apply, so an item with real problems can
  // land at RISKY_BUY or SKIP rather than being handed a floor it did not earn.
  const priceConf = input.priceConfidence;
  if (tier === 3 && typeof priceConf === "number" &&
      priceConf > 0 && priceConf <= STRONG_BUY_MIN_PRICE_CONFIDENCE) {
    tier = 2;
    add("PRICE_CONFIDENCE_TOO_LOW_FOR_STRONG_BUY");
    // Re-apply demotion pressure at the new tier: a blocked STRONG_BUY with
    // two live risk factors should not out-rank a clean BUY.
    if (weight >= 2 && netProfit < 40) tier = Math.max(1, tier - 1);
  }

  // Real profit never falls all the way to SKIP on risk alone. If the money is
  // there, the user deserves to see it flagged rather than hidden.
  if (tier === 0 && netProfit >= 11) tier = 1;

  const label = TIERS[tier];

  // Only the factors that actually cost something are worth showing. On a
  // STRONG BUY the user does not need a list of things that did not matter.
  // Era alone is a weak reason to hesitate — it says nothing about whether the
  // item sells or what it is worth. When it is the ONLY factor, the rating is
  // effectively being driven by an absence of information, which is not the
  // same as a risk. Keep the chip so the user knows why, but it never stands
  // alone as the sole justification for a downgrade.
  const ordered = [...factors].sort(
    (a, b) => RISK_PRIORITY.indexOf(a.code) - RISK_PRIORITY.indexOf(b.code),
  );
  const shownFactors = label === 'STRONG_BUY' ? [] : ordered;

  return {
    label,
    colorKey: label,
    displayLabel: DISPLAY_LABELS[label],
    headline:     buildHeadline(label, netProfit, matchConfidence, c, s, roi),
    bullets:      buildBullets(label, input, c, d, s),
    warning:      buildWarning(label, matchConfidence, c),
    riskFactors:  shownFactors,
  };
}

// ─── Display labels ───────────────────────────────────────────────────────────

const DISPLAY_LABELS: Record<RecLabel, string> = {
  STRONG_BUY: 'Strong Buy',
  BUY:        'Buy',
  RISKY_BUY:  'Risky Buy',
  SKIP:       'Skip This Item',
};

// ─── Canonical buy-rating normalizer ──────────────────────────────────────────
// The app must display EXACTLY one of: STRONG BUY / BUY / RISKY BUY / SKIP
// everywhere (Analysis screen + Scan History). This maps any internal label or
// legacy/free-text rating to one of those four. Never upgrades/downgrades intent.
export type CanonicalRating = 'STRONG BUY' | 'BUY' | 'RISKY BUY' | 'SKIP';

export function normalizeBuyRating(input: unknown): CanonicalRating {
  if (input == null) return 'SKIP';
  const v = String(input).trim().toUpperCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  // Exact canonical / internal labels first
  if (v === 'STRONG BUY' || v === 'STRONGBUY') return 'STRONG BUY';
  if (v === 'RISKY BUY'  || v === 'RISKYBUY')  return 'RISKY BUY';
  if (v === 'BUY')                              return 'BUY';
  if (v === 'SKIP')                             return 'SKIP';
  // Fuzzy / legacy wording — preserve intent
  if (v.includes('STRONG'))                                   return 'STRONG BUY';
  if (v.includes('RISK') || v.includes('MAYBE') ||
      v.includes('CONSIDER') || v.includes('CONDITION') ||
      v.includes('CAUTION'))                                  return 'RISKY BUY';
  if (v.includes('SKIP') || v.includes('PASS') ||
      v.includes('AVOID') || v.includes('DO NOT') ||
      v.includes("DON'T") || v.includes('NO BUY'))            return 'SKIP';
  if (v.includes('BUY') || v.includes('GOOD') ||
      v.includes('SOLID') || v.includes('GRAB'))              return 'BUY';
  return 'SKIP';
}

// ─── Headline builder ─────────────────────────────────────────────────────────

function buildHeadline(
  label:      RecLabel,
  profit:     number,
  confidence: number,
  c:          'high' | 'moderate' | 'low',
  s:          'fast' | 'moderate' | 'slow',
  roi:        number,
): string {
  if (label === 'STRONG_BUY') {
    return 'Strong profit, strong match, and healthy resale signals.';
  }
  if (label === 'BUY') {
    if (s === 'slow') return 'Profit justifies buying, but it may take longer to sell.';
    return 'Worth buying — profit justifies the selling effort.';
  }
  if (label === 'RISKY_BUY') {
    if (confidence < 50) return 'Possible upside, but verify the item before checkout.';
    if (c === 'high')    return 'Solid profit, but high competition increases selling risk.';
    if (s === 'slow')    return 'Good potential, but a slow sell could tie up your money.';
    return 'Possible upside — proceed with caution.';
  }
  // SKIP
  if (profit < 0)             return 'Costs exceed estimated resale value.';
  if (profit < 10 && roi > 200) return 'High ROI, but the actual dollar profit is too small.';
  if (c === 'high')            return 'Not worth the effort — high competition, thin margin.';
  return 'Not worth the time, risk, or selling effort.';
}

// ─── Bullet builder (situational, never generic) ─────────────────────────────

function buildBullets(
  label:  RecLabel,
  input:  RecommendationInput,
  c:      'high' | 'moderate' | 'low',
  d:      'high' | 'medium' | 'low',
  s:      'fast' | 'moderate' | 'slow',
): string[] {
  const {
    netProfit, resaleValue, matchConfidence, roi, thriftPrice,
  } = input;

  const bullets: string[] = [];

  // ── Profit statement ───────────────────────────────────────────────────────
  if (netProfit < 0) {
    bullets.push(`Costs exceed resale value by $${Math.abs(netProfit)} — you would lose money.`);
  } else if (netProfit < 5) {
    bullets.push(`Profit is only $${netProfit} — too thin for the effort of listing and shipping.`);
  } else if (netProfit < 10) {
    if (roi > 150) {
      bullets.push(`High ROI (${roi}%), but the actual dollar profit is only $${netProfit}.`);
    } else {
      bullets.push(`Profit is below the $10 minimum FlipStart usually recommends.`);
    }
  } else if (netProfit < 20) {
    bullets.push(`Est. $${netProfit} profit after platform fees.`);
  } else {
    bullets.push(`Strong estimated profit of $${netProfit} after fees.`);
  }

  // ── Confidence statement ───────────────────────────────────────────────────
  if (matchConfidence > 0) {
    if (matchConfidence >= 80) {
      bullets.push(`Confidence is high (${matchConfidence}%) — the item identification is likely reliable.`);
    } else if (matchConfidence >= 60) {
      bullets.push(`Match confidence is solid at ${matchConfidence}%.`);
    } else if (matchConfidence >= 40) {
      bullets.push(`Low confidence (${matchConfidence}%) means the item should be verified before buying.`);
    } else {
      bullets.push(`Very low confidence (${matchConfidence}%) — the AI may have misidentified the item.`);
    }
  }

  // ── Competition statement ──────────────────────────────────────────────────
  if (c === 'high') {
    bullets.push(`High competition means this may be harder to sell quickly.`);
  } else if (c === 'low' && label !== 'SKIP') {
    bullets.push(`Low seller competition — easier to stand out on the platform.`);
  }

  // ── Demand statement ───────────────────────────────────────────────────────
  if (d === 'high' && label !== 'SKIP') {
    bullets.push(`High buyer demand suggests a faster sale.`);
  } else if (d === 'low') {
    bullets.push(`Demand appears low compared to similar items.`);
  }

  // ── Sell speed statement ───────────────────────────────────────────────────
  if (s === 'slow' && bullets.length < 4) {
    bullets.push(`Sell speed appears slow — your money may sit longer than expected.`);
  } else if (s === 'fast' && label !== 'SKIP' && bullets.length < 4) {
    bullets.push(`Items like this tend to sell quickly.`);
  }

  // ── Resale value sanity ────────────────────────────────────────────────────
  if (resaleValue <= 8 && bullets.length < 4) {
    bullets.push(`Resale value is too low to justify listing and shipping effort.`);
  }

  // ── Positive final note for buy signals ───────────────────────────────────
  if (label === 'STRONG_BUY' && bullets.length < 4) {
    bullets.push(`Strong match and solid profit make this worth grabbing.`);
  }
  if (label === 'RISKY_BUY' && matchConfidence < 55 && bullets.length < 4) {
    bullets.push(`Good profit potential, but double-check tags, brand, and condition.`);
  }

  return bullets.slice(0, 4);
}

// ─── Warning builder ─────────────────────────────────────────────────────────

function buildWarning(
  label:      RecLabel,
  confidence: number,
  c:          'high' | 'moderate' | 'low',
): string | undefined {
  if (label === 'RISKY_BUY' && confidence < 50) {
    return 'Verify tags, brand, and sold comps before buying.';
  }
  if (label === 'STRONG_BUY' && c === 'moderate') {
    return 'Competition is moderate — price competitively when listing.';
  }
  return undefined;
}

// ─── Color themes (for UI) ────────────────────────────────────────────────────

/** Palette keyed by RecLabel — imported by results.tsx and analysis-details.tsx */
export const REC_THEMES: Record<RecLabel, {
  bg:        string;
  border:    string;
  icon:      string;
  iconColor: string;
  textColor: string;   // primary text on card
  dimColor:  string;   // secondary/muted text on card
}> = {
  STRONG_BUY: {
    bg:        '#163A16',
    border:    '#1F5A1F',
    icon:      'star',
    iconColor: '#D4A820',
    textColor: '#F4EED8',
    dimColor:  'rgba(244,238,216,0.65)',
  },
  BUY: {
    bg:        '#1E3A20',
    border:    '#2A5A2A',
    icon:      'check-circle',
    iconColor: '#70C870',
    textColor: '#F4EED8',
    dimColor:  'rgba(244,238,216,0.65)',
  },
  RISKY_BUY: {
    bg:        '#5A3A08',
    border:    '#7A5210',
    icon:      'warning',
    iconColor: '#E8C040',
    textColor: '#F4EED8',
    dimColor:  'rgba(244,238,216,0.65)',
  },
  SKIP: {
    bg:        '#581A1A',
    border:    '#7A2828',
    icon:      'cancel',
    iconColor: '#E87878',
    textColor: '#F4EED8',
    dimColor:  'rgba(244,238,216,0.65)',
  },
};
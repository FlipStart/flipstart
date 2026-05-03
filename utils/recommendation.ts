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
}

export interface Recommendation {
  label:        RecLabel;
  displayLabel: string;     // e.g. "Strong Buy"
  headline:     string;     // one-line summary for decision card
  bullets:      string[];   // 2–4 situational reason bullets
  warning?:     string;     // optional extra caution note
  colorKey:     RecLabel;   // same as label — used by UI for theme lookup
}

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

export function getRecommendation(input: RecommendationInput): Recommendation {
  const {
    netProfit, resaleValue, thriftPrice, roi,
    matchConfidence,
  } = input;

  const c = comp(input.competitionLevel);
  const d = demand(input.demandLevel);
  const s = speed(input.sellSpeed);

  // ── STRONG_BUY ──────────────────────────────────────────────────────────────
  // High profit + strong signal + no major risk factors
  const isStrongBuy =
    netProfit >= 25 &&
    matchConfidence >= 70 &&
    c !== 'high' &&
    s !== 'slow';

  // ── BUY ─────────────────────────────────────────────────────────────────────
  // Solid profit with reasonable confidence
  const isBuy =
    !isStrongBuy && (
      (netProfit >= 15 && matchConfidence >= 60 && s !== 'slow') ||
      (netProfit >= 20 && matchConfidence >= 45 && c !== 'high')
    );

  // ── RISKY_BUY ───────────────────────────────────────────────────────────────
  // Worth considering but with caveats
  const isRiskyBuy =
    !isStrongBuy && !isBuy && (
      (netProfit >= 20 && matchConfidence < 60) ||
      (netProfit >= 15 && c === 'high') ||
      (netProfit >= 15 && s === 'slow') ||
      (netProfit >= 25 && matchConfidence < 45)
    );

  // ── SKIP — everything else ──────────────────────────────────────────────────

  // ── Assign label ─────────────────────────────────────────────────────────────
  let label: RecLabel;
  if (isStrongBuy)     label = 'STRONG_BUY';
  else if (isBuy)      label = 'BUY';
  else if (isRiskyBuy) label = 'RISKY_BUY';
  else                 label = 'SKIP';

  return {
    label,
    colorKey: label,
    displayLabel: DISPLAY_LABELS[label],
    headline:     buildHeadline(label, netProfit, matchConfidence, c, s, roi),
    bullets:      buildBullets(label, input, c, d, s),
    warning:      buildWarning(label, matchConfidence, c),
  };
}

// ─── Display labels ───────────────────────────────────────────────────────────

const DISPLAY_LABELS: Record<RecLabel, string> = {
  STRONG_BUY: 'Strong Buy',
  BUY:        'Buy',
  RISKY_BUY:  'Risky Buy',
  SKIP:       'Skip This Item',
};

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
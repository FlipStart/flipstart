/**
 * shared/hunt/xpRules.ts
 *
 * THE Hunt XP engine. Pure: no storage, no network, no clock, no React.
 *
 * ── Who runs it ─────────────────────────────────────────────────────────────
 * The SERVER, for every real Hunt (server/hunt/completeHunt.ts). It feeds this
 * from evidence it collected itself at scan time, so nothing the app sends can
 * change the result except which items were kept and the price typed for each.
 * The guided demo also runs it on the phone, for display only (nothing is saved).
 *
 * ── The XP table is the one Hunt Mode has always had ────────────────────────
 * Base, kept, volume, rarity, profit tiers (a $10,000 Hunt still pays 10,000 XP),
 * time, grade and discovery are unchanged. What changed is what each line needs
 * before it pays:
 *
 *   1. XP PRICE FLOOR. Profit and rating for XP are worked out at
 *      max(typed price, $1, 5% of resale). Typing $0.01 gains nothing.
 *   2. SCAN STATUS (decided by the server, never shown to the user):
 *        normal    full XP
 *        reduced   takes part (scan count, kept count) but earns no rarity,
 *                  profit, grade or discovery XP
 *        excluded  earns nothing and is not counted at all
 *   3. EVIDENCE GATE. An item whose XP profit is over $250 only counts in full
 *      with evidence: taken with the in-app camera, a second photo, an image
 *      nobody has used before, not a screen or listing, confidently identified.
 *      Without it the item counts $250 of profit and Treasure at most, and all
 *      such items in one Hunt count $500 between them. Items at $250 or under
 *      need no evidence, so ordinary finds are untouched.
 *   4. REPEATS. The same item (brand + type + colour + subject) already counted
 *      as Legendary or Treasure, in this Hunt or the last 30 days, is reduced.
 *   5. STREAK is weekly, paid once per week, on a qualifying Hunt.
 *
 * Changing a number here changes XP for everyone: bump XP_RULES_VERSION.
 */

export const XP_RULES_VERSION = 'hx-1';

export type HuntRating = 'legendary' | 'treasure' | 'risky' | 'trash';
export type ScanStatus = 'normal' | 'reduced' | 'excluded';

export interface XpBreakdownItem {
  id:       string;
  label:    string;
  detail?:  string;
  xp:       number;
  category: 'base' | 'volume' | 'rarity' | 'profit' | 'time' | 'quality' | 'discovery' | 'streak';
}

/** What the server knows about how one scan was made. All five = the evidence gate. */
export interface XpEvidence {
  camera:      boolean;   // front photo taken with the in-app camera during the Hunt
  secondPhoto: boolean;   // a tag or detail photo was sent with the scan
  uniqueImage: boolean;   // not a near-copy of the user's own scans or of other accounts' images
  notScreen:   boolean;   // the model did not flag a screen, screenshot, listing or stock image
  confidentId: boolean;   // identified with High or Medium confidence
}

export interface XpEconomics { profit: number; roi: number; rating: HuntRating }

/** One decided item (kept or passed), in scan order. */
export interface XpItem {
  id:          string;            // the server's analysis id
  kept:        boolean;
  thriftPrice: number;            // as typed; 0 = never priced
  status:      ScanStatus;
  reasons?:    string[];          // why the server reduced or excluded it (internal)
  evidence:    XpEvidence;
  resale:      number;            // the server's own resale estimate
  brand:       string;
  category:    string;
  itemKey:     string | null;     // brand|type|colour|subject, or null when too generic to compare
  /** Profit, ROI and rating at a given buy price: the same engine the app shows. */
  economics:   (price: number) => XpEconomics;
}

export interface XpProfileState {
  discoveredBrands:     string[];
  discoveredCategories: string[];
  weekStreak:           number;         // before this Hunt
  lastStreakWeek:       string | null;  // week start ('YYYY-MM-DD') of the last streak-qualifying Hunt
}

export interface XpHuntInput {
  items:      XpItem[];
  durationMs: number;       // measured by the server
  weekStart:  string;       // the week this Hunt lands in ('YYYY-MM-DD', server-defined)
  prevWeekStart: string;    // the week before it
  profile:    XpProfileState;
  /** Item keys already counted as Legendary / Treasure in the last 30 days. */
  priorValuedItemKeys?: string[];
}

export interface XpItemResult {
  id:            string;
  kept:          boolean;
  status:        ScanStatus;
  reasons:       string[];
  xpPrice:       number;
  profit:        number;          // at the XP price, before any cap
  countedProfit: number;          // what went into the Hunt's XP profit
  rating:        HuntRating;      // as counted for XP
  gateNeeded:    boolean;
  gateOk:        boolean;
}

export type HuntGrade = 'S' | 'A' | 'B' | 'C' | null;

export interface XpHuntResult {
  earned:        number;
  breakdown:     XpBreakdownItem[];
  /** 3+ eligible scans, 1+ kept, 10+ minutes. Counts for Best Hunt and the weekly streak. */
  qualifies:     boolean;
  bestHuntScore: number;          // = earned when the Hunt qualifies, else 0
  eligibleScans: number;
  keptCount:     number;
  xpProfit:      number;
  xpRoi:         number;
  grade:         HuntGrade;
  newBrands:     string[];
  newCategories: string[];
  weekStreak:    number;          // after this Hunt
  lastStreakWeek: string | null;  // after this Hunt
  streakXp:      number;
  /** Big finds counted at the capped value because evidence was missing. */
  cappedBigFinds: number;
  items:         XpItemResult[];
}

// ─── The numbers ──────────────────────────────────────────────────────────────

export const XP = {
  huntCompleted: 3,
  perKeptItem:   1,
  volumeTiers: [
    { threshold: 50, xp: 25, label: '50+ scans in hunt' },
    { threshold: 25, xp: 10, label: '25+ scans in hunt' },
    { threshold: 10, xp:  5, label: '10+ scans in hunt' },
    { threshold:  5, xp:  2, label:  '5+ scans in hunt' },
  ],
  rarity: { legendary: 20, treasure: 8, risky: 1, trash: 0 } as Record<HuntRating, number>,
  profitTiers: [
    { threshold: 10000, xp: 10000, label: '$10,000+ hunt profit' },
    { threshold:  5000, xp:  4000, label:  '$5,000+ hunt profit' },
    { threshold:  2500, xp:  1500, label:  '$2,500+ hunt profit' },
    { threshold:  1000, xp:   500, label:  '$1,000+ hunt profit' },
    { threshold:   500, xp:   200, label:    '$500+ hunt profit' },
    { threshold:   250, xp:    75, label:    '$250+ hunt profit' },
    { threshold:   100, xp:    25, label:    '$100+ hunt profit' },
    { threshold:    50, xp:    10, label:     '$50+ hunt profit' },
    { threshold:    25, xp:     5, label:     '$25+ hunt profit' },
  ],
  timeTiers: [
    { minutes: 90, xp: 20, label: '90+ minute hunt' },
    { minutes: 45, xp:  8, label: '45+ minute hunt' },
    { minutes: 20, xp:  3, label: '20+ minute hunt' },
  ],
  grade: { S: 100, A: 50, B: 25, C: 10 } as Record<'S' | 'A' | 'B' | 'C', number>,
  newCategory: 5,
  newBrand:    3,
  /** Weeks in a row with a qualifying Hunt. Paid once, on the first qualifying Hunt of the week. */
  weekStreakTiers: [
    { weeks: 52, xp: 1000 },
    { weeks: 26, xp:  500 },
    { weeks:  8, xp:  200 },
    { weeks:  4, xp:   75 },
    { weeks:  2, xp:   25 },
  ],
} as const;

/** XP price floor: at least $1, at least this share of the resale estimate. */
export const XP_PRICE_FLOOR_USD   = 1;
export const XP_PRICE_FLOOR_SHARE = 0.05;
/** An item's XP profit above this needs the evidence gate. */
export const BIG_FIND_PROFIT = 250;
/** All big finds without evidence, together, in one Hunt. */
export const UNGATED_HUNT_PROFIT_CAP = 500;
/** A Hunt that counts for Best Hunt and the weekly streak. */
export const QUALIFY_MIN_SCANS   = 3;
export const QUALIFY_MIN_KEPT    = 1;
export const QUALIFY_MIN_MINUTES = 10;

// ─── Helpers (exported for the server, the app's "Big find" note and tests) ───

const cents = (n: number) => Math.round(n * 100) / 100;

/** The buy price XP is worked out at. Never below what the user typed. */
export function xpPriceFor(typedPrice: number, resale: number): number {
  const typed = Number.isFinite(typedPrice) && typedPrice > 0 ? typedPrice : 0;
  const res   = Number.isFinite(resale) && resale > 0 ? resale : 0;
  return cents(Math.max(typed, XP_PRICE_FLOOR_USD, res * XP_PRICE_FLOOR_SHARE));
}

export function gateOk(e: XpEvidence): boolean {
  return e.camera && e.secondPhoto && e.uniqueImage && e.notScreen && e.confidentId;
}

/** What is missing, in fixed order. Empty when the gate passes. */
export function gateMissing(e: XpEvidence): Array<keyof XpEvidence> {
  return (['camera', 'secondPhoto', 'uniqueImage', 'notScreen', 'confidentId'] as const).filter(k => !e[k]);
}

const IGNORED_VALUES = new Set(['unknown', 'n/a', 'other', 'none', 'misc', '']);
export const discoveryKey = (raw: string): string => String(raw ?? '').trim().toLowerCase();
export function isDiscoverable(raw: string | undefined | null): boolean {
  return !!raw && !IGNORED_VALUES.has(discoveryKey(raw));
}

export function calculateHuntGrade(
  keptCount: number, totalProfit: number, estimatedROI: number, hasLegendary: boolean,
): HuntGrade {
  if (keptCount >= 5 && totalProfit >= 100 && estimatedROI >= 100 && hasLegendary) return 'S';
  if (keptCount >= 3 && totalProfit >= 50 && estimatedROI >= 50) return 'A';
  if (keptCount >= 2 && totalProfit >= 20) return 'B';
  if (keptCount >= 1 && totalProfit > 0) return 'C';
  return null;
}

export function weekStreakXp(weeks: number): number {
  for (const t of XP.weekStreakTiers) if (weeks >= t.weeks) return t.xp;
  return 0;
}

const isValued = (r: HuntRating) => r === 'legendary' || r === 'treasure';

// ─── The engine ───────────────────────────────────────────────────────────────

export function calculateHuntXp(input: XpHuntInput): XpHuntResult {
  const breakdown: XpBreakdownItem[] = [];
  let earned = 0;
  const add = (item: Omit<XpBreakdownItem, 'id'>) => {
    if (!(item.xp > 0)) return;
    breakdown.push({ ...item, id: `${item.category}_${breakdown.length}` });
    earned += item.xp;
  };

  // ── Per item: status, XP price, economics, gate ──────────────────────────────
  const valuedKeys = new Set((input.priorValuedItemKeys ?? []).filter(Boolean));
  const seenIds = new Set<string>();
  const results: XpItemResult[] = [];
  let ungatedPool = 0;

  for (const it of input.items) {
    if (seenIds.has(it.id)) continue;            // one scan is one item, whatever was sent
    seenIds.add(it.id);
    const reasons = [...(it.reasons ?? [])];
    let status: ScanStatus = it.status;
    const xpPrice = xpPriceFor(it.thriftPrice, it.resale);
    const blank: XpItemResult = {
      id: it.id, kept: it.kept, status, reasons, xpPrice,
      profit: 0, countedProfit: 0, rating: 'trash', gateNeeded: false, gateOk: gateOk(it.evidence),
    };

    if (status === 'excluded' || !it.kept) { results.push(blank); continue; }

    const econ = it.economics(xpPrice);
    const profit = Number.isFinite(econ.profit) ? econ.profit : 0;
    let rating: HuntRating = econ.rating;

    // The same item again, already counted as a valued find.
    if (status === 'normal' && it.itemKey && isValued(rating) && valuedKeys.has(it.itemKey)) {
      status = 'reduced';
      reasons.push('repeat_item');
    }
    if (status === 'reduced') { results.push({ ...blank, status, reasons, profit }); continue; }

    const needs = profit > BIG_FIND_PROFIT;
    const ok = gateOk(it.evidence);
    let counted = profit;
    if (needs && !ok) {
      const room = Math.max(0, UNGATED_HUNT_PROFIT_CAP - ungatedPool);
      counted = Math.min(BIG_FIND_PROFIT, room);
      ungatedPool += counted;
      if (rating === 'legendary') rating = 'treasure';
      reasons.push(...gateMissing(it.evidence).map(k => `no_${k}`));
    }
    if (it.itemKey && isValued(rating)) valuedKeys.add(it.itemKey);
    results.push({
      id: it.id, kept: true, status, reasons, xpPrice, profit,
      countedProfit: counted, rating, gateNeeded: needs, gateOk: ok,
    });
  }

  const eligible   = results.filter(r => r.status !== 'excluded');
  const keptAll    = eligible.filter(r => r.kept);
  const keptNormal = keptAll.filter(r => r.status === 'normal');
  const byId       = new Map(input.items.map(i => [i.id, i]));

  // ── Base ─────────────────────────────────────────────────────────────────────
  if (eligible.length > 0) add({ label: 'Hunt completed', xp: XP.huntCompleted, category: 'base' });
  if (keptAll.length > 0) {
    add({ label: 'Items kept', detail: `${keptAll.length} × +${XP.perKeptItem} XP`, xp: keptAll.length * XP.perKeptItem, category: 'base' });
  }

  // ── Scan volume (highest tier only) ──────────────────────────────────────────
  for (const tier of XP.volumeTiers) {
    if (eligible.length >= tier.threshold) {
      add({ label: tier.label, detail: `${eligible.length} total scans`, xp: tier.xp, category: 'volume' });
      break;
    }
  }

  // ── Rarity (per kept item) ───────────────────────────────────────────────────
  const rarityLabel: Record<string, string> = {
    legendary: 'Legendary Loot item', treasure: 'Treasure item', risky: 'Risky item',
  };
  for (const rating of ['legendary', 'treasure', 'risky'] as const) {
    const count = keptNormal.filter(r => r.rating === rating).length;
    if (count > 0) {
      add({
        label: `${count} × ${rarityLabel[rating]}`, detail: `${count} × +${XP.rarity[rating]} XP`,
        xp: XP.rarity[rating] * count, category: 'rarity',
      });
    }
  }

  // ── Profit milestone (highest tier only) ─────────────────────────────────────
  const xpProfit = keptNormal.reduce((s, r) => s + r.countedProfit, 0);
  const xpCost   = keptNormal.reduce((s, r) => s + r.xpPrice, 0);
  const xpRoi    = xpCost > 0 ? Math.round((xpProfit / xpCost) * 100) : 0;
  const capped   = keptNormal.filter(r => r.gateNeeded && !r.gateOk).length;
  for (const tier of XP.profitTiers) {
    if (xpProfit >= tier.threshold) {
      add({
        label: tier.label,
        detail: `$${Math.round(xpProfit)} estimated` +
          (capped > 0 ? ` · ${capped} big find${capped === 1 ? '' : 's'} counted at a capped value` : ''),
        xp: tier.xp, category: 'profit',
      });
      break;
    }
  }

  // ── Time bonus (highest tier only) ───────────────────────────────────────────
  const durationMin = Math.max(0, input.durationMs) / 60000;
  if (eligible.length > 0) {
    for (const tier of XP.timeTiers) {
      if (durationMin >= tier.minutes) {
        add({ label: tier.label, detail: `${Math.round(durationMin)} minutes`, xp: tier.xp, category: 'time' });
        break;
      }
    }
  }

  // ── Hunt quality grade ───────────────────────────────────────────────────────
  const grade = calculateHuntGrade(keptNormal.length, xpProfit, xpRoi, keptNormal.some(r => r.rating === 'legendary'));
  if (grade) {
    add({
      label: `Grade ${grade} hunt`,
      detail: `${keptNormal.length} kept · $${Math.round(xpProfit)} profit · ${xpRoi}% ROI`,
      xp: XP.grade[grade], category: 'quality',
    });
  }

  // ── Discovery (kept, normal, confidently identified) ─────────────────────────
  const knownCats   = new Set(input.profile.discoveredCategories.map(discoveryKey));
  const knownBrands = new Set(input.profile.discoveredBrands.map(discoveryKey));
  const newCategories: string[] = [];
  const newBrands: string[] = [];
  for (const r of keptNormal) {
    const it = byId.get(r.id)!;
    if (!it.evidence.confidentId) continue;
    if (isDiscoverable(it.category) && !knownCats.has(discoveryKey(it.category))) {
      knownCats.add(discoveryKey(it.category)); newCategories.push(it.category.trim());
    }
    if (isDiscoverable(it.brand) && !knownBrands.has(discoveryKey(it.brand))) {
      knownBrands.add(discoveryKey(it.brand)); newBrands.push(it.brand.trim());
    }
  }
  if (newCategories.length > 0) {
    add({
      label: `${newCategories.length} new categor${newCategories.length === 1 ? 'y' : 'ies'} discovered`,
      detail: newCategories.join(', '), xp: newCategories.length * XP.newCategory, category: 'discovery',
    });
  }
  if (newBrands.length > 0) {
    add({
      label: `${newBrands.length} new brand${newBrands.length === 1 ? '' : 's'} discovered`,
      detail: newBrands.join(', '), xp: newBrands.length * XP.newBrand, category: 'discovery',
    });
  }

  // ── Weekly streak (once per week, on a qualifying Hunt) ──────────────────────
  const qualifies = eligible.length >= QUALIFY_MIN_SCANS
    && keptAll.length >= QUALIFY_MIN_KEPT
    && durationMin >= QUALIFY_MIN_MINUTES;
  let weekStreak = Math.max(0, Math.floor(input.profile.weekStreak || 0));
  let lastStreakWeek = input.profile.lastStreakWeek ?? null;
  let streakXp = 0;
  if (qualifies && lastStreakWeek !== input.weekStart) {
    weekStreak = lastStreakWeek === input.prevWeekStart ? weekStreak + 1 : 1;
    lastStreakWeek = input.weekStart;
    streakXp = weekStreakXp(weekStreak);
    add({
      label: `${weekStreak}-week hunt streak`, detail: `${weekStreak} weeks in a row`,
      xp: streakXp, category: 'streak',
    });
  }

  return {
    earned, breakdown, qualifies, bestHuntScore: qualifies ? earned : 0,
    eligibleScans: eligible.length, keptCount: keptAll.length,
    xpProfit, xpRoi, grade, newBrands, newCategories,
    weekStreak, lastStreakWeek, streakXp, cappedBigFinds: capped, items: results,
  };
}
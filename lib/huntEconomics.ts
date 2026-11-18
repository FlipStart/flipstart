/**
 * lib/huntEconomics.ts
 *
 * The money and rating for ONE Hunt item, from its scan and its thrift price.
 *
 * Hunt does not have its own scoring model. It runs the exact recommendation
 * engine normal Analysis uses (computeFlipCalc, with the same v1 risk signals
 * via utils/ratingSignals) and maps the result onto Hunt's names:
 *
 *   STRONG_BUY → Legendary Loot · BUY → Treasure · RISKY_BUY → Risky · SKIP → Skip
 *
 * Every place that sets or changes a Hunt item's price goes through
 * huntEconomics(), so fees, profit, ROI and rating can never be computed two
 * different ways.
 *
 * Pure: no React, no storage, no network.
 */
import type { ScanResult } from './types';
// Relative imports on purpose: the server imports this file to score Hunt XP with
// the exact engine the app shows, and it has no '@/' alias.
import { computeFlipCalc, findBuyUnderPrice } from '../utils/flipCalculations';
import { ratingSignalsFor, type RatingSignals } from '../utils/ratingSignals';
import type { FlipCalc } from '../types/flip';

export type HuntRating = 'legendary' | 'treasure' | 'risky' | 'trash';

/** Map the shared recommendation label to Hunt's rating names. */
export function recLabelToHuntRating(recLabel: string | undefined): HuntRating {
  switch (recLabel) {
    case 'STRONG_BUY': return 'legendary';
    case 'BUY':        return 'treasure';
    case 'RISKY_BUY':  return 'risky';
    default:           return 'trash';   // SKIP and anything unknown
  }
}

// ─── Thrift price ─────────────────────────────────────────────────────────────

/** Largest thrift price accepted. Guards typos like 1000000 without blocking real buys. */
export const MAX_THRIFT_PRICE = 100_000;

/**
 * Filter keystrokes for the price field: digits and ONE dot, at most two
 * decimals, no sign, no letters. Returns the previous value when the new one
 * would be malformed, so the field never shows something the parser rejects.
 */
export function sanitizePriceInput(next: string, prev: string): string {
  const raw = String(next ?? '').replace(/^\$/, '').replace(/,/g, '');
  if (raw === '') return '';
  if (!/^\d*\.?\d{0,2}$/.test(raw)) return prev;
  // A leading dot is a normal way to type cents: ".5" → "0.5".
  const fixed = raw.startsWith('.') ? `0${raw}` : raw;
  // No leading zeros on whole dollars ("007" → "7"), but keep "0." and "0".
  const trimmed = fixed.replace(/^0+(?=\d)/, '');
  const n = parseFloat(trimmed);
  if (Number.isFinite(n) && n > MAX_THRIFT_PRICE) return prev;
  return trimmed;
}

/**
 * A valid Hunt acquisition cost, or null.
 * Valid: a finite number ≥ $0.01 with at most two decimals. Zero, negatives,
 * NaN, letters and malformed decimals are all null.
 */
export function parseThriftPrice(text: string | number | null | undefined): number | null {
  if (text === null || text === undefined) return null;
  const s = String(text).trim().replace(/^\$/, '').replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$|^\.\d{1,2}$|^\d+\.$/.test(s)) return null;
  const n = Math.round(parseFloat(s) * 100) / 100;
  if (!Number.isFinite(n) || n < 0.01 || n > MAX_THRIFT_PRICE) return null;
  return n;
}

/** Display form, always two decimals. */
export function formatThriftPrice(n: number): string {
  return n.toFixed(2);
}

// ─── Economics ────────────────────────────────────────────────────────────────

export interface HuntEconomics {
  thriftPrice: number;
  fees:        number;
  profit:      number;
  roi:         number;
  huntRating:  HuntRating;
  /** The full shared result: recommendation headline, bullets, risk factors, best platform. */
  calc:        FlipCalc;
}

/**
 * Everything the rating engine reads from a scan. Small and JSON-safe: the server
 * stores this with each Hunt scan and scores XP from it later.
 */
export interface EngineInputs {
  resale:      number;
  confidence:  number;
  competition: string;
  styleLabels: string[];
  era:         string;
  demand:      string;
  speed:       string;
  signals:     RatingSignals;
}

/** Inputs to the shared engine, read from a scan. */
export function engineInputs(scan: ScanResult): EngineInputs {
  const md = scan?.market_data as any;
  const id = scan?.identification as any;
  const ra = scan?.risk_analysis as any;
  return {
    resale:      md?.adjusted_estimated_value ?? 0,
    confidence:  ra?.match_confidence ?? 0,
    competition: md?.competition_level ?? '',
    styleLabels: id?.style_labels ?? [],
    era:         id?.estimated_era ?? '',
    demand:      md?.demand ?? '',
    speed:       md?.sell_speed ?? '',
    signals:     ratingSignalsFor(scan),
  };
}

/** Fees, profit, ROI and Hunt rating for this scan at this thrift price. */
export function huntEconomics(scan: ScanResult, thriftPrice: number): HuntEconomics {
  return economicsFromInputs(engineInputs(scan), thriftPrice);
}

/** The same, from stored inputs. The one place the engine is actually called. */
export function economicsFromInputs(i: EngineInputs, thriftPrice: number): HuntEconomics {
  const price = Number.isFinite(thriftPrice) && thriftPrice > 0 ? thriftPrice : 0;
  const calc = computeFlipCalc(
    i.resale, price, i.confidence, i.competition, i.styleLabels, i.era, i.demand, i.speed, i.signals,
  );
  return {
    thriftPrice: price,
    fees:        calc.fees,
    profit:      calc.profit,
    roi:         calc.roi,
    huntRating:  recLabelToHuntRating(calc.recommendation?.label),
    calc,
  };
}

/** FlipStart's suggested buy price for this scan, or null when it has none. */
export function suggestedBuyPrice(scan: ScanResult): number | null {
  const v = (scan?.market_data as any)?.suggested_buy_price;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * The rating to SHOW before the user has typed a price: computed at
 * FlipStart's suggested buy price and flagged provisional. Never saved, never
 * used for XP — the saved rating always comes from the user's own price.
 */
export function provisionalEconomics(scan: ScanResult): (HuntEconomics & { provisional: true; basis: number | null }) {
  const basis = suggestedBuyPrice(scan);
  return { ...huntEconomics(scan, basis ?? 0), provisional: true, basis };
}

/** "Buy under $X" for this scan — the same threshold normal Analysis shows. */
export function huntBuyUnder(scan: ScanResult): number | null {
  const i = engineInputs(scan);
  return findBuyUnderPrice(i.resale, i.confidence, i.competition, i.demand, i.speed, i.signals);
}
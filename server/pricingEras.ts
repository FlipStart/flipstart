/**
 * server/pricingEras.ts
 *
 * Every price assumption the Founder Dashboard makes lives here, and nowhere
 * else. The app never hardcodes a price (it shows StoreKit's own string), so
 * these figures exist ONLY to estimate revenue on the dashboard — which is
 * why every number built from them is labelled ESTIMATED.
 *
 * ── Eras ───────────────────────────────────────────────────────────────────
 * V1  $7.99 / month · $39.99 / year
 * V2  $5.99 / month · $19.99 / year   — from 2026-09-21
 *
 * The V2 start is known as a DATE only. It defaults to midnight Central on
 * that date and is marked `assumed`; set FLIPSTART_PRICING_V2_AT to the exact
 * moment if it is ever known, and the assumption flag clears itself.
 *
 * ── Notes ──────────────────────────────────────────────────────────────────
 * Anything else that changed during an era and could muddy a comparison is
 * recorded in ERA_NOTES, so the dashboard states it beside the numbers
 * instead of leaving it to memory.
 */
import { centralDayStartUtc } from "./dashboardDates";

export interface PricingEra {
  id: "v1" | "v2";
  label: string;
  /** ISO start, inclusive. Null = from the beginning. */
  startsAt: string | null;
  /** ISO end, exclusive. Null = still current. */
  endsAt: string | null;
  monthlyUsd: number;
  annualUsd: number;
  /** True when a boundary is a date-only assumption rather than a known instant. */
  assumed: boolean;
}

/** The V2 boundary date, as given. */
export const PRICING_V2_DATE = "2026-09-21";

/**
 * Apple's cut. 15% is the App Store Small Business Program rate. Override
 * with FLIPSTART_APPLE_FEE_RATE (a fraction, e.g. 0.30) if that ever changes.
 */
export const APPLE_FEE_RATE_DEFAULT = 0.15;

/** Things that changed mid-era and belong next to the comparison. */
export const ERA_NOTES: Array<{ at: string | null; note: string }> = [
  {
    at: null,
    note: "Onboarding offer copy changes to \"Continue Free\" with the next app build. Record its release date here when it ships — it falls inside V2.",
  },
];

export function getAppleFeeRate(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number((env.FLIPSTART_APPLE_FEE_RATE ?? "").trim());
  return Number.isFinite(raw) && raw >= 0 && raw < 1 && (env.FLIPSTART_APPLE_FEE_RATE ?? "").trim() !== ""
    ? raw : APPLE_FEE_RATE_DEFAULT;
}

export function getPricingEras(env: NodeJS.ProcessEnv = process.env): PricingEra[] {
  const raw = (env.FLIPSTART_PRICING_V2_AT ?? "").trim();
  const parsed = raw && Number.isFinite(Date.parse(raw)) ? new Date(Date.parse(raw)).toISOString() : null;
  const fallbackMs = centralDayStartUtc(PRICING_V2_DATE);
  const v2At = parsed ?? (fallbackMs !== null ? new Date(fallbackMs).toISOString() : `${PRICING_V2_DATE}T05:00:00.000Z`);
  const assumed = !parsed;
  return [
    { id: "v1", label: "Pricing V1", startsAt: null, endsAt: v2At, monthlyUsd: 7.99, annualUsd: 39.99, assumed },
    { id: "v2", label: "Pricing V2", startsAt: v2At, endsAt: null, monthlyUsd: 5.99, annualUsd: 19.99, assumed },
  ];
}

/** Which era an instant falls in. Unparseable → null, never a guess. */
export function eraAt(eras: PricingEra[], isoStr: string | null | undefined): PricingEra | null {
  if (!isoStr) return null;
  const t = Date.parse(isoStr);
  if (!Number.isFinite(t)) return null;
  for (const e of eras) {
    const afterStart = e.startsAt === null || t >= Date.parse(e.startsAt);
    const beforeEnd = e.endsAt === null || t < Date.parse(e.endsAt);
    if (afterStart && beforeEnd) return e;
  }
  return null;
}

/** The era in effect right now. */
export const currentEra = (eras: PricingEra[], now: Date = new Date()) => eraAt(eras, now.toISOString());

/** List price of a plan in an era, in USD. Null for anything not a subscription plan. */
export function eraPrice(era: PricingEra, plan: string | null | undefined): number | null {
  return plan === "monthly" ? era.monthlyUsd : plan === "annual" ? era.annualUsd : null;
}
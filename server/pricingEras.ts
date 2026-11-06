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
 * V3  $7.99 / month · $29.99 / year   — from 2026-11-06
 *
 * A new price change = one more entry in ERA_DEFS. Everything downstream
 * (cohorts, comparisons, per-paywall columns) reads the list, so nothing
 * else needs editing.
 *
 * Each start is known as a DATE only. It defaults to midnight Central on that
 * date and is marked `assumed`; set the era's env variable
 * (FLIPSTART_PRICING_V2_AT, FLIPSTART_PRICING_V3_AT) to the exact moment if it
 * is ever known, and that era's assumption flag clears itself.
 *
 * ── Existing subscribers keep their price ──────────────────────────────────
 * At V3, people already subscribed stayed at the V2 price. Every estimate
 * prices a purchase by WHEN it was made (first period only, never renewals),
 * and a subscriber's monthly value by the era of their FIRST purchase — so a
 * V2 subscriber renewing after Nov 6 is still valued at V2, which is what
 * they pay.
 *
 * ── Notes ──────────────────────────────────────────────────────────────────
 * Anything else that changed during an era and could muddy a comparison is
 * recorded in ERA_NOTES, so the dashboard states it beside the numbers
 * instead of leaving it to memory.
 */
import { centralDayStartUtc } from "./dashboardDates";

export type PricingEraId = "v1" | "v2" | "v3";

export interface PricingEra {
  id: PricingEraId;
  label: string;
  /** ISO start, inclusive. Null = from the beginning. */
  startsAt: string | null;
  /** ISO end, exclusive. Null = still current. */
  endsAt: string | null;
  monthlyUsd: number;
  annualUsd: number;
  /** True when either boundary of this era is a date-only assumption rather than a known instant. */
  assumed: boolean;
  /** True when THIS era's start is a date-only assumption. Always false for the first era. */
  startAssumed: boolean;
  /** The env variable that pins this era's start to an exact moment. Null for the first era. */
  startEnv: string | null;
}

interface EraDef {
  id: PricingEraId;
  label: string;
  /** Central date the era starts, or null for the first era. */
  date: string | null;
  env: string | null;
  monthlyUsd: number;
  annualUsd: number;
}

/** The boundary dates, as given. */
export const PRICING_V2_DATE = "2026-09-21";
export const PRICING_V3_DATE = "2026-11-06";

/** Oldest first. Add a price change by appending one entry. */
const ERA_DEFS: EraDef[] = [
  { id: "v1", label: "Pricing V1", date: null,            env: null,                      monthlyUsd: 7.99, annualUsd: 39.99 },
  { id: "v2", label: "Pricing V2", date: PRICING_V2_DATE, env: "FLIPSTART_PRICING_V2_AT", monthlyUsd: 5.99, annualUsd: 19.99 },
  { id: "v3", label: "Pricing V3", date: PRICING_V3_DATE, env: "FLIPSTART_PRICING_V3_AT", monthlyUsd: 7.99, annualUsd: 29.99 },
];

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
  {
    at: "2026-11-06T06:00:00.000Z",
    note: "Pricing V3: people already subscribed kept the V2 price. Subscriber value uses the era of each person's first purchase, so they stay at V2. Someone whose V2 subscription lapsed and who re-subscribes in V3 pays V3 but is still valued at V2 here.",
  },
];

export function getAppleFeeRate(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number((env.FLIPSTART_APPLE_FEE_RATE ?? "").trim());
  return Number.isFinite(raw) && raw >= 0 && raw < 1 && (env.FLIPSTART_APPLE_FEE_RATE ?? "").trim() !== ""
    ? raw : APPLE_FEE_RATE_DEFAULT;
}

/** One era start: the env override if it parses, else midnight Central on the date. */
function resolveStart(def: EraDef, env: NodeJS.ProcessEnv): { at: string; assumed: boolean } {
  const raw = def.env ? (env[def.env] ?? "").trim() : "";
  const parsed = raw && Number.isFinite(Date.parse(raw)) ? new Date(Date.parse(raw)).toISOString() : null;
  if (parsed) return { at: parsed, assumed: false };
  const fallbackMs = centralDayStartUtc(def.date!);
  // Central is UTC−5 (CDT) until early November and UTC−6 (CST) after.
  return { at: fallbackMs !== null ? new Date(fallbackMs).toISOString() : `${def.date}T06:00:00.000Z`, assumed: true };
}

export function getPricingEras(env: NodeJS.ProcessEnv = process.env): PricingEra[] {
  const starts = ERA_DEFS.map(def => def.date === null ? { at: null as string | null, assumed: false } : resolveStart(def, env));
  return ERA_DEFS.map((def, i) => {
    const next = starts[i + 1];
    return {
      id: def.id,
      label: def.label,
      startsAt: starts[i].at,
      endsAt: next ? next.at : null,
      monthlyUsd: def.monthlyUsd,
      annualUsd: def.annualUsd,
      assumed: starts[i].assumed || (next?.assumed ?? false),
      startAssumed: starts[i].assumed,
      startEnv: def.env,
    };
  });
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
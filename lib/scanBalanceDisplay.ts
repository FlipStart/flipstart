/**
 * lib/scanBalanceDisplay.ts
 *
 * Pure formatting for every scan-balance surface.
 *
 * Extracted from the components so the wording rules — which are fiddly and
 * carry real product meaning — can be tested without rendering anything.
 */
import type { Plan } from "@/lib/useEntitlement";

/** Never render a negative count. Clamps for PRESENTATION only; a negative from
 *  the server is a data problem and is logged rather than hidden. */
export function clamp(n: number | null | undefined, label = "count"): number {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 0;
  if (v < 0) {
    console.warn(`[scan-balance] negative ${label} (${v}) from server — displaying 0`);
    return 0;
  }
  return v;
}

/** Thousands separators. 2,325 reads instantly; 2325 does not. */
export function fmt(n: number): string {
  return clamp(n).toLocaleString("en-US");
}

export interface BalanceInput {
  plan: Plan;
  freeScansRemaining: number;
  subscriptionScansRemaining: number;
  packScansRemaining: number;
  totalUsableScans: number;
  /** ISO string; null for Free. Optional so existing callers keep working. */
  subscriptionPeriodEnd?: string | null;
}

/**
 * Urgency level for the pill's colour.
 *
 * ── Absolute for Free, proportional for subscriptions ───────────────────────
 * Free has 15 lifetime scans, so 8 and 4 are meaningful absolute milestones —
 * roughly half gone, then nearly out.
 *
 * Those same numbers are useless on a subscription: an Annual user would sit
 * green from 4,000 all the way to 8, then flash red for two scans. Percentages
 * give a proportional warning that arrives with time to act — 20% and 7% of the
 * period allowance.
 *
 * Pack scans are deliberately included in the total but NOT in the threshold
 * calculation for subscriptions: someone with 2,000 pack scans is not running
 * low regardless of where their monthly allowance sits, and the combined total
 * already reflects that.
 */
export type ScanUrgency = "normal" | "low" | "critical";

export function scanUrgency(b: BalanceInput): ScanUrgency {
  const total = clamp(b.totalUsableScans, "total");
  if (total <= 0) return "critical";

  if (b.plan === "free") {
    // Absolute: 15 lifetime scans makes 8 and 4 legible milestones.
    if (total < 4) return "critical";
    if (total < 8) return "low";
    return "normal";
  }

  // Proportional to the plan's included allowance.
  const limit = b.plan === "annual" ? 4000 : 300;
  const pct = total / limit;
  if (pct <= 0.07) return "critical";   // annual 280, monthly 21
  if (pct <= 0.20) return "low";        // annual 800, monthly 60
  return "normal";
}

/** Human reset date, e.g. "March 14" or "Jan 8, 2027" when it crosses a year. */
export function resetDateLabel(iso: string | null | undefined, now = new Date()): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString("en-US",
    sameYear ? { month: "long", day: "numeric" }
             : { month: "short", day: "numeric", year: "numeric" });
}

/**
 * The compact HOME pill.
 *
 * ── The one special case ────────────────────────────────────────────────────
 * Free with NO packs says "15 Lifetime Scans" — deliberately without "Left".
 * The word pushes the string past the existing pill width, and the pill is not
 * being redesigned to accommodate it.
 *
 * The moment packs exist, that label would HIDE the user's real balance, so it
 * switches to the combined total instead.
 */
export function pillLabel(b: BalanceInput): string {
  const pack = clamp(b.packScansRemaining, "pack");

  if (b.plan === "free" && pack === 0) {
    const n = clamp(b.freeScansRemaining, "free");
    // Correct singular. "1 Lifetime Scans" looks like a bug.
    return `${fmt(n)} Lifetime ${n === 1 ? "Scan" : "Scans"}`;
  }

  const total = clamp(b.totalUsableScans, "total");
  return `${fmt(total)} ${total === 1 ? "Scan" : "Scans"} Left`;
}

/**
 * The small label UNDER the number in the Home pill.
 *
 * The pill stacks a number over a caption, so the wording splits differently
 * from `pillLabel`: the number is rendered separately and this supplies only
 * the caption. Same rules — Free with no packs reads "Lifetime Scans", and any
 * other state reads "scans left" because the number is a combined total.
 */
export function pillSubLabel(b: BalanceInput): string {
  const pack = clamp(b.packScansRemaining, "pack");
  if (b.plan === "free" && pack === 0) {
    /**
     * "Lifetime", not "Lifetime Scans".
     *
     * The pill is a bolt icon over a large number over this caption, so the
     * word "Scans" is already implied by everything around it. The full phrase
     * is 14 characters against 10 for "scans left", which made the pill wide
     * enough to crowd the FlipStart header — for the Free state only, which is
     * what most users see most of the time.
     *
     * "Lifetime" is 8 characters: shorter than every other state, so this stops
     * being the widest case entirely. The tapped modal still spells it out in
     * full for anyone who wants the detail.
     */
    return "Lifetime";
  }
  return clamp(b.totalUsableScans, "total") === 1 ? "scan left" : "scans left";
}

/**
 * Caption UNDER the big number in the scan modal.
 *
 * ── Why this is not pillLabel ───────────────────────────────────────────────
 * The modal renders the count as a large numeral immediately above this text.
 * Reusing pillLabel there printed the number a SECOND time — "15" followed by
 * "15 Lifetime Scans" — and the breakdown below printed it a third. This is the
 * caption alone.
 *
 * When packs exist the big number is the COMBINED total, so the caption must
 * describe the total rather than the included allowance; the split is explained
 * by the breakdown underneath.
 */
export function modalCaption(b: BalanceInput): string {
  if (clamp(b.packScansRemaining, "pack") > 0) {
    return clamp(b.totalUsableScans, "total") === 1 ? "Scan Left" : "Scans Left";
  }
  switch (b.plan) {
    case "monthly": return "Scans Left This Month";
    case "annual":  return "Scans Left This Year";
    case "free":
    default:
      return clamp(b.freeScansRemaining, "free") === 1 ? "Lifetime Scan" : "Lifetime Scans";
  }
}

/** Heading for the "included allowance" side of the tapped detail. */
export function includedHeading(plan: Plan): string {
  switch (plan) {
    case "monthly": return "Scans Left This Month";
    case "annual":  return "Scans Left This Year";
    case "free":
    default:        return "Lifetime Scans Remaining";
  }
}

/** The included figure for this plan. Dormant free scans are NEVER shown while
 *  a subscription is active — they are not spendable. */
export function includedCount(b: BalanceInput): number {
  return b.plan === "free"
    ? clamp(b.freeScansRemaining, "free")
    : clamp(b.subscriptionScansRemaining, "subscription");
}

/** One-line explanation under the detail. */
export function detailExplanation(b: BalanceInput): string {
  const hasPacks = clamp(b.packScansRemaining, "pack") > 0;

  /**
   * Subscription copy names the actual reset DATE.
   *
   * "resets each subscription month" is accurate and useless — the question a
   * user opens this to answer is *when*. The date comes from the store's own
   * period end, so it stays correct through billing retries and grace periods
   * rather than being guessed from a purchase date.
   */
  const reset = resetDateLabel(b.subscriptionPeriodEnd);
  const included = b.plan === "annual" ? "4,000 annual" : "300 monthly";

  const base =
    b.plan === "free"
      // No literal count: the number is already large directly above, and
      // hardcoding 15 reads wrong once some have been used.
      ? "Free scans are lifetime scans — they don't reset."
      : reset
        ? `Your ${included} scans reset on ${reset}.`
        // Vaguer wording ONLY when the date is genuinely unavailable, rather
        // than inventing one.
        : `Your ${included} scans reset at the start of each period.`;

  if (!hasPacks) return base;

  const first = b.plan === "free" ? "Lifetime" : b.plan === "monthly" ? "Monthly" : "Annual";
  return `${base} ${first} scans are used first — Pack Scans don't expire and are used afterward.`;
}

/** Whether to render the pack column at all. `+0 Pack Scans` is never shown. */
export function showPackColumn(b: BalanceInput): boolean {
  return clamp(b.packScansRemaining, "pack") > 0;
}

export function packLabel(n: number): string {
  const v = clamp(n, "pack");
  return `+${fmt(v)}`;
}
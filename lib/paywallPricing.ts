/**
 * lib/paywallPricing.ts
 *
 * Pure arithmetic and copy for prices. No React, no SDK, no network.
 *
 * ── Everything here refuses rather than guesses ─────────────────────────────
 * A paywall that prints a wrong price or an inflated saving is a consumer-law
 * problem, not a cosmetic bug. Every function in this file returns null when it
 * cannot be certain, and the UI is written to render nothing at all rather than
 * a placeholder. That is why there is no `?? "$7.99"` anywhere: a hardcoded
 * fallback is indistinguishable from a real price on screen, and it would be
 * wrong for every user outside the US the moment it appeared.
 */

/** The subset of a RevenueCat StoreProduct this layer needs. */
export interface ProductPricing {
    /** Localized, store-formatted. The ONLY string ever shown as a price. */
    priceString: string | null;
    /** Numeric amount, for arithmetic only. Never rendered directly. */
    priceAmount: number | null;
    currencyCode: string | null;
  }
  
  export const NO_PRICING: ProductPricing = {
    priceString: null,
    priceAmount: null,
    currencyCode: null,
  };
  
  /**
   * Read pricing off a RevenueCat package defensively.
   *
   * `any` is deliberate and matches lib/purchases.ts: the SDK's types are not
   * inspectable in this project's toolchain, and naming a library type I cannot
   * verify is a mistake this codebase has already paid for once. Every field is
   * validated at runtime instead, so an SDK that renames something degrades to
   * "no price" — which the UI already handles — rather than to `undefined`
   * rendered on a button.
   */
  export function readProductPricing(pkg: any): ProductPricing {
    const p = pkg?.product ?? pkg;
    const priceString =
      typeof p?.priceString === "string" && p.priceString.trim() ? p.priceString.trim() : null;
  
    const rawAmount = typeof p?.price === "number" ? p.price : null;
    // A zero or negative price is not a promotion, it is a misconfiguration.
    const priceAmount = rawAmount !== null && Number.isFinite(rawAmount) && rawAmount > 0 ? rawAmount : null;
  
    const currencyCode =
      typeof p?.currencyCode === "string" && p.currencyCode.trim() ? p.currencyCode.trim() : null;
  
    return { priceString, priceAmount, currencyCode };
  }
  
  /**
   * How much cheaper a year of Annual is than twelve Monthly payments.
   *
   * Returns null — meaning "show the badge with no number" — whenever the claim
   * cannot be made honestly:
   *
   *   • either amount missing                → nothing to compare
   *   • currencies differ or are unknown     → comparing 39.99 USD to 7.99 EUR is
   *                                            not a discount, it is an exchange
   *                                            rate, and storefronts genuinely do
   *                                            price plans in different currencies
   *   • annual is not actually cheaper       → do not invent a saving
   *   • below MIN_DISPLAY_PERCENT            → "Save 2%" reads as a trick
   *   • at or above MAX_PLAUSIBLE_PERCENT    → almost certainly a misconfigured
   *                                            product; refuse rather than
   *                                            advertise "Save 99%"
   *
   * At the intended configuration ($7.99 / $39.99) this returns 58.
   */
  export const MIN_DISPLAY_PERCENT = 5;
  export const MAX_PLAUSIBLE_PERCENT = 95;
  
  export function annualSavingsPercent(
    monthly: ProductPricing,
    annual: ProductPricing,
  ): number | null {
    const m = monthly.priceAmount;
    const a = annual.priceAmount;
    if (m === null || a === null) return null;
    if (!monthly.currencyCode || !annual.currencyCode) return null;
    if (monthly.currencyCode !== annual.currencyCode) return null;
  
    const twelve = m * 12;
    if (!(twelve > 0) || a >= twelve) return null;
  
    const percent = Math.round((1 - a / twelve) * 100);
    if (percent < MIN_DISPLAY_PERCENT) return null;
    if (percent >= MAX_PLAUSIBLE_PERCENT) return null;
    return percent;
  }
  
  /**
   * The savings line under the Annual price.
   *
   * Falls back to wording with no number rather than dropping the line entirely,
   * so the card keeps its height and the layout does not shift when prices
   * resolve.
   */
  export function annualSavingsLabel(
    monthly: ProductPricing,
    annual: ProductPricing,
  ): string {
    const percent = annualSavingsPercent(monthly, annual);
    return percent === null
      ? "Best value on FlipStart Pro"
      : `Save ${percent}% vs paying monthly`;
  }
  
  /**
   * Price plus period, e.g. "$39.99 / year".
   *
   * Null when the store has not given us a price. The caller renders a skeleton.
   */
  export function planPriceLabel(
    pricing: ProductPricing,
    period: "month" | "year",
  ): string | null {
    if (!pricing.priceString) return null;
    return `${pricing.priceString} / ${period}`;
  }
  
  /**
   * The renewal sentence, built from the price the store actually reported.
   *
   * Deliberately short. The App Store shows the full terms in the purchase sheet
   * and a wall of duplicated legalese on the paywall itself buries the parts that
   * matter.
   */
  export function renewalDisclosure(
    pricing: ProductPricing,
    period: "month" | "year",
  ): string {
    const priced = pricing.priceString ? `${pricing.priceString} per ${period}` : `the listed price`;
    return (
      `Payment is charged to your Apple Account at confirmation. ` +
      `FlipStart Pro renews automatically at ${priced} unless cancelled at least ` +
      `24 hours before the end of the current period.`
    );
  }
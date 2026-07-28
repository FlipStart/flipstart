/**
 * Reason codes and their user-facing text.
 *
 * One source. Normal Analysis, the RISKY BUY disclaimer, and Deep Analysis all
 * draw from here, so no screen can word the same finding differently.
 */
export type ReasonCode =
  | "NO_PRICE_ESTIMATE" | "OBVIOUS_DAMAGE" | "SLOW_SELL" | "LOW_SELL_LIKELIHOOD"
  | "NARROW_BUYER_POOL" | "HIGH_COMPETITION" | "LOW_IDENTITY_CONFIDENCE"
  | "LOW_PRICE_CONFIDENCE" | "ERA_UNCERTAIN" | "AUTHENTICITY_CONCERN"
  | "THIN_MARGIN" | "NEGATIVE_MARGIN" | "STRONG_MARGIN" | "HEALTHY_MARGIN"
  | "FAST_SELL" | "HIGH_CONFIDENCE" | "CONFIRMED_VINTAGE" | "CONDITION_UNASSESSED";

export interface Reason { code: ReasonCode; text: string }

const SHORT: Record<ReasonCode, string> = {
  NO_PRICE_ESTIMATE:       "No reliable resale estimate",
  OBVIOUS_DAMAGE:          "Visible damage affects value",
  SLOW_SELL:               "Expected to sell slowly",
  LOW_SELL_LIKELIHOOD:     "May not sell readily",
  NARROW_BUYER_POOL:       "Narrow buyer pool",
  HIGH_COMPETITION:        "Heavy competition from similar listings",
  LOW_IDENTITY_CONFIDENCE: "Item identity is uncertain",
  LOW_PRICE_CONFIDENCE:    "Price estimate is uncertain",
  ERA_UNCERTAIN:           "Era could not be confirmed",
  AUTHENTICITY_CONCERN:    "Authenticity could not be verified",
  THIN_MARGIN:             "Margin is thin at this price",
  NEGATIVE_MARGIN:         "Loses money at this price",
  STRONG_MARGIN:           "Strong margin at this price",
  HEALTHY_MARGIN:          "Workable margin at this price",
  FAST_SELL:               "Expected to sell quickly",
  HIGH_CONFIDENCE:         "Identification is well supported",
  CONFIRMED_VINTAGE:       "Confirmed vintage",
  CONDITION_UNASSESSED:    "Condition could not be fully checked",
};

const LONG: Partial<Record<ReasonCode, string>> = {
  NO_PRICE_ESTIMATE:
    "We could not produce a resale estimate we trust for this item, so profit and maximum buy price are unavailable.",
  OBVIOUS_DAMAGE:
    "Clear damage is visible in the photos. Buyers pay less for damaged items and are more likely to return them.",
  SLOW_SELL:
    "Items like this tend to sit. Your money is tied up until it moves.",
  NARROW_BUYER_POOL:
    "Only a small set of buyers wants this. It may still sell well, but it will take the right person finding it.",
  LOW_IDENTITY_CONFIDENCE:
    "We are not confident what this item is, which makes the price estimate less reliable.",
  ERA_UNCERTAIN:
    "We could not confirm the age of this item. Era changes value substantially on some pieces.",
  AUTHENTICITY_CONCERN:
    "Something about the tag, logo, or construction did not look consistent. Verify before paying a brand premium.",
  CONDITION_UNASSESSED:
    "Parts of this item were not visible in the photos, so the condition assessment is incomplete.",
};

export const reason = (code: ReasonCode): Reason => ({ code, text: SHORT[code] });
export const longReason = (code: ReasonCode): Reason => ({ code, text: LONG[code] ?? SHORT[code] });
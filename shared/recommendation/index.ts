/**
 * Public surface of the shared recommendation module.
 *
 * Server:  import { computeRecommendation } from "../shared/recommendation/index.js";
 * Client:  import { computeRecommendation } from "@shared/recommendation";
 *
 * Same file. One implementation. No separate client and server logic.
 */
export { computeRecommendation, findMaxBuyPriceForRating } from "./rules.js";
export { RECOMMENDATION_MODULE_VERSION } from "./version.js";
export { reason, longReason } from "./reasons.js";
export type { ReasonCode, Reason } from "./reasons.js";
export type {
  RecommendationInput, RecommendationResult, RecommendationEconomics,
} from "./types.js";
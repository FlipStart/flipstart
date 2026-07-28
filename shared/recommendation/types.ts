import type { CanonicalAnalysisV1 } from "../canonical.types.js";
import type { Reason } from "./reasons.js";

export interface RecommendationInput {
  canonical: CanonicalAnalysisV1;
  /** The price the user actually entered. A real 0 is valid — some finds are free. */
  thriftPrice: number;
  settings?: { minProfit?: number; targetRoi?: number };
}

export interface RecommendationEconomics {
  fees: number | null;
  profit: number | null;
  roi: number | null;
  maxBuyPrice: number | null;
}

export interface RecommendationResult {
  label: "STRONG_BUY" | "BUY" | "RISKY_BUY" | "SKIP";
  reasons: Reason[];
  riskyDisclaimer: string;
  deepAnalysisReasons: Reason[];
  economics: RecommendationEconomics;
  moduleVersion: string;
}
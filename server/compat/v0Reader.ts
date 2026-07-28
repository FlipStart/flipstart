/**
 * Legacy (v0) result compatibility.
 *
 * Old scans stay exactly as they are. Nothing is mutated, nothing is backfilled,
 * no unlock is removed. This adapter only lets new code READ old shapes.
 *
 * The rule that matters: a v0 scan can never be confirmed_vintage. Old
 * `estimated_era` is free text produced under a prompt that discouraged
 * "Unknown" and recommended labels like "Modern, vintage-inspired" — which
 * contains the word "vintage" and is exactly what the old substring matcher
 * mistook for age evidence. Treating it as evidence would import the bug we
 * removed.
 */
import type { AnyAnalysis, CanonicalAnalysisV1, LegacyV0Analysis } from "../../shared/canonical.types.js";

export function isCanonicalV1(a: AnyAnalysis): a is CanonicalAnalysisV1 {
  return (a as CanonicalAnalysisV1)?.meta?.schema_version === "1";
}

export interface V0View {
  schema: "v0";
  itemName: string;
  brand: string;
  category: string;
  /** DISPLAY ONLY. Never drives era logic. */
  eraText: string;
  resaleLow: number | null;
  resaleHigh: number | null;
  matchConfidence: number;
  riskFlags: string[];
  /** Preserved for rendering old scans. No logic may read these. */
  legacyStyleLabels: string[];
  /** Always false. v0 can never newly unlock a vintage Diamond. */
  vintageForUnlocks: false;
}

const s = (v: unknown): string => (typeof v === "string" ? v : "");
const n = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function readV0(raw: LegacyV0Analysis): V0View {
  const id = (raw.identification ?? {}) as Record<string, unknown>;
  const md = (raw.market_data ?? {}) as Record<string, unknown>;
  const ra = (raw.risk_analysis ?? {}) as Record<string, unknown>;
  const range = (md.estimated_resale_range ?? {}) as Record<string, unknown>;

  return {
    schema: "v0",
    itemName: s(id.item_name) || "Unknown Item",
    brand: s(id.brand),
    category: s(id.category) || "other",
    eraText: s(id.estimated_era),
    resaleLow: n(range.low),
    resaleHigh: n(range.high),
    matchConfidence: typeof ra.match_confidence === "number" ? ra.match_confidence : 0,
    riskFlags: Array.isArray(ra.risk_flags) ? (ra.risk_flags as string[]) : [],
    // NOT mapped into features.logo_identity — old style labels are not
    // reliable logo evidence and would pollute recognition scoring.
    legacyStyleLabels: Array.isArray(id.style_labels) ? (id.style_labels as string[]) : [],
    vintageForUnlocks: false,
  };
}

/** One entry point for any screen that may receive either shape. */
export function readAnalysis(raw: AnyAnalysis): CanonicalAnalysisV1 | V0View {
  return isCanonicalV1(raw) ? raw : readV0(raw as LegacyV0Analysis);
}
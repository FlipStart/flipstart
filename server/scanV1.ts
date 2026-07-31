/**
 * CanonicalAnalysisV1 scan path.
 *
 * Strictly fail-closed: any schema rejection, refusal, truncation, or parse
 * failure throws a ScanV1Error. The caller must NOT save an analysis, must NOT
 * consume the scan allowance, and must NOT unlock anything. A partially
 * repaired result is a fabricated analysis and is worse than no result.
 */
import { invokeLLM } from "./_core/llm.js";
import { ENV } from "./_core/env.js";
import {
  SCAN_PROMPT_VERSION, buildSystemMessage, vintageCutoffYear,
} from "./prompts/scanPromptV1_1.js";
import {
  canonicalResponseFormat, CANONICAL_SCHEMA_HASH, SCHEMA_VERSION,
} from "./canonical/schema.js";
import { buildCanonicalAnalysis } from "./canonical/build.js";
import type {
  AiAnalysis, CanonicalAnalysisV1, CanonicalMeta, PhotoSlot,
} from "../shared/canonical.types.js";

const MAX_OUTPUT_TOKENS = 2000;

const SLOT_LABELS: Record<PhotoSlot, string> = {
  front: "[FRONT] Front of the item.",
  detail: "[DETAIL] Supporting detail: back, close-up, graphic, flaw, texture, or marking.",
  // Deliberately not "brand tag" — with the category selector removed this may
  // be a Pyrex backstamp or an appliance model plate.
  tag: "[TAG] Identifying label, tag, stamp, or plate. Read everything legible: brand, size, material, country, numbers, date codes, care symbols, maker's marks.",
};

/** Payload order. Labels travel immediately before their image so they cannot
 *  desynchronise. */
const SLOT_ORDER: PhotoSlot[] = ["front", "detail", "tag"];

export type ScanV1FailureKind =
  | "schema_rejected" | "refusal" | "truncated" | "parse_failed"
  | "validation_failed" | "transport_error";

export class ScanV1Error extends Error {
  constructor(
    public kind: ScanV1FailureKind,
    message: string,
    public diagnostics: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ScanV1Error";
  }
}

export interface ScanV1Telemetry {
  model: string;
  prompt_version: string;
  schema_version: string;
  schema_hash: string;
  duration_ms: number;
  finish_reason: string | null;
  refusal: string | null;
  prompt_tokens: number | null;
  cached_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  retry_count: number;
  parse_ok: boolean;
  schema_failure: boolean;
  estimated_cost_usd: number | null;
  image_count: number;
  image_detail: "high";
}

export interface ScanV1Input {
  images: Partial<Record<PhotoSlot, string>>;   // base64, no data: prefix
  mimeType?: string;
  userId: string;
  scanAttemptId: string;
  analysisId: string;
  planAtScan: CanonicalMeta["plan_at_scan"];
  photoRefs: Record<PhotoSlot, string | null>;
  now?: Date;
}

export interface ScanV1Success {
  canonical: CanonicalAnalysisV1;
  telemetry: ScanV1Telemetry;
}

export async function analyzeItemV1(input: ScanV1Input): Promise<ScanV1Success> {
  const now = input.now ?? new Date();
  const mime = input.mimeType || "image/jpeg";

  const slots = SLOT_ORDER.filter(s => (input.images[s] ?? "").length > 0);
  if (!slots.includes("front")) {
    throw new ScanV1Error("validation_failed", "front photo is required");
  }

  const cutoff = vintageCutoffYear(now);
  const system = buildSystemMessage({
    currentYear: now.getFullYear(),
    vintageCutoffYear: cutoff,
    photoSlotsProvided: slots,
  });

  const content: Array<Record<string, unknown>> = [];
  for (const slot of slots) {
    content.push({ type: "text", text: SLOT_LABELS[slot] });
    content.push({
      type: "image_url",
      image_url: { url: `data:${mime};base64,${input.images[slot]}`, detail: "high" },
    });
  }

  const started = Date.now();
  let raw: Awaited<ReturnType<typeof invokeLLM>>;
  try {
    raw = await invokeLLM({
      model: ENV.openaiScanModel,
      messages: [
        { role: "system", content: system },
        { role: "user", content: content as never },
      ],
      response_format: canonicalResponseFormat() as never,
      max_tokens: MAX_OUTPUT_TOKENS,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // A strict-schema rejection surfaces as a 400 from the API layer. Treat it
    // as its own kind so the caller can fall back to the legacy path and the
    // exact rejected keyword lands in the logs.
    const schemaRejected = /\b400\b/.test(message) &&
      /schema|response_format|json_schema/i.test(message);
    throw new ScanV1Error(
      schemaRejected ? "schema_rejected" : "transport_error",
      message,
      { duration_ms: Date.now() - started, model: ENV.openaiScanModel },
    );
  }
  const duration = Date.now() - started;

  const choice = raw.choices?.[0];
  const usage = (raw as { usage?: Record<string, unknown> }).usage ?? {};
  const num = (k: string): number | null =>
    typeof usage[k] === "number" ? (usage[k] as number) : null;
  const cached =
    ((usage.prompt_tokens_details as { cached_tokens?: number } | undefined)?.cached_tokens) ?? null;

  const telemetry: ScanV1Telemetry = {
    model: raw.model || ENV.openaiScanModel,
    prompt_version: SCAN_PROMPT_VERSION,
    schema_version: SCHEMA_VERSION,
    schema_hash: CANONICAL_SCHEMA_HASH,
    duration_ms: duration,
    finish_reason: choice?.finish_reason ?? null,
    refusal: (choice?.message as { refusal?: string } | undefined)?.refusal ?? null,
    prompt_tokens: num("prompt_tokens"),
    cached_tokens: cached,
    completion_tokens: num("completion_tokens"),
    total_tokens: num("total_tokens"),
    retry_count: 0,
    parse_ok: false,
    schema_failure: false,
    estimated_cost_usd: null,
    image_count: slots.length,
    image_detail: "high",
  };

  if (telemetry.refusal) {
    throw new ScanV1Error("refusal", `model refused: ${telemetry.refusal}`, { telemetry });
  }
  // Truncation is detected via finish_reason, not by a parse failure. Never
  // attempt repair — a truncated analysis is an incomplete one.
  if (telemetry.finish_reason === "length") {
    throw new ScanV1Error("truncated",
      `response truncated at max_tokens=${MAX_OUTPUT_TOKENS}`, { telemetry });
  }

  const text = extractText(choice?.message?.content);
  if (!text) throw new ScanV1Error("parse_failed", "empty response content", { telemetry });

  let parsed: AiAnalysis;
  try {
    parsed = JSON.parse(text) as AiAnalysis;
  } catch {
    // The only permitted recovery: a COMPLETE valid object wrapped in a code
    // fence. Anything else fails closed.
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (!fence) throw new ScanV1Error("parse_failed", "response was not JSON", { telemetry });
    try { parsed = JSON.parse(fence[1]) as AiAnalysis; }
    catch { throw new ScanV1Error("parse_failed", "fenced content was not JSON", { telemetry }); }
  }
  telemetry.parse_ok = true;
  telemetry.estimated_cost_usd = estimateCost(
    telemetry.model, telemetry.prompt_tokens, telemetry.cached_tokens, telemetry.completion_tokens);

  const meta: CanonicalMeta = {
    schema_version: SCHEMA_VERSION,
    prompt_version: SCAN_PROMPT_VERSION,
    schema_hash: CANONICAL_SCHEMA_HASH,
    model: telemetry.model,
    photo_slots_provided: slots,
    plan_at_scan: input.planAtScan,
    vintage_cutoff_year: cutoff,
    current_year_at_scan: now.getFullYear(),
    user_context_supplied: false,   // extension point; feature deferred
    scan_attempt_id: input.scanAttemptId,
    analysis_id: input.analysisId,
    analyzed_at: now.getTime(),
    photo_refs: input.photoRefs,
  };

  let canonical: CanonicalAnalysisV1;
  try {
    canonical = buildCanonicalAnalysis({ ai: parsed, meta });
  } catch (err) {
    throw new ScanV1Error("validation_failed",
      err instanceof Error ? err.message : String(err), { telemetry });
  }

  return { canonical, telemetry };
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map(p => (p && typeof p === "object" && "text" in p ? String((p as { text: unknown }).text) : ""))
      .join("");
  }
  return "";
}

/** Mirrors the table in llm.ts. Cached input bills at a reduced rate. */
const PRICING: Record<string, { in: number; cachedIn: number; out: number }> = {
  "gpt-4o":       { in: 0.0000025,  cachedIn: 0.00000125,  out: 0.00001   },
  "gpt-4o-mini":  { in: 0.00000015, cachedIn: 0.000000075, out: 0.0000006 },
  "gpt-4.1":      { in: 0.000002,   cachedIn: 0.0000005,   out: 0.000008  },
  "gpt-4.1-mini": { in: 0.0000004,  cachedIn: 0.0000001,   out: 0.0000016 },
  "gpt-4.1-nano": { in: 0.0000001,  cachedIn: 0.000000025, out: 0.0000004 },
};

/**
 * Strip a trailing snapshot date so a pinned model prices the same as its alias.
 * "gpt-4.1-mini-2025-04-14" -> "gpt-4.1-mini". Without this a pinned snapshot
 * misses the table and silently bills at gpt-4o rates in the log, ~6x too high.
 */
function basePricingKey(model: string): string {
  return model.replace(/-\d{4}-\d{2}-\d{2}$/, "");
}

function estimateCost(
  model: string, promptTokens: number | null,
  cachedTokens: number | null, completionTokens: number | null,
): number | null {
  const rates = PRICING[basePricingKey(model)];
  if (!rates || promptTokens == null) return null;
  const cached = cachedTokens ?? 0;
  const fresh = Math.max(0, promptTokens - cached);
  return fresh * rates.in + cached * rates.cachedIn + (completionTokens ?? 0) * rates.out;
}
/**
 * server/hunt/scanEvidence.ts
 *
 * What the server writes down about every Hunt scan, the moment it analyses it.
 *
 * Hunt XP is scored later, when the Hunt is finished, from THESE rows and nothing
 * else. The app then only says which scans were kept and what price was typed.
 * A scan the server has no row for earns nothing, so XP cannot be invented by
 * posting a made-up Hunt.
 *
 * Everything here is taken from the server's own analysis of the photos, except
 * `captureFront` (camera or library), which the app reports. That one field can
 * be lied about by a modified app; it only ever unlocks the big-find gate
 * together with four things the server checks itself.
 *
 * Never in the way of a scan: recording is fire-and-forget and swallows errors.
 */
import type { CanonicalAnalysisV1, CaptureKind } from "../../shared/canonical.types.js";
import { engineInputs, type EngineInputs } from "../../lib/huntEconomics";
import { scanSoftFail } from "../../shared/scanFailure.js";
import { hashPhoto } from "./photoHash.js";
import { getHuntStore, type HuntScanRow } from "./store.js";

export type CaptureFront = "camera" | "library" | "unknown";

/** A Hunt id as the app makes it (`hunt_<ms>_<rand>`). Anything else is not recorded. */
export function validHuntId(id: unknown): id is string {
  return typeof id === "string" && /^[A-Za-z0-9_\-:.]{6,80}$/.test(id);
}

/** Kill switch for the extra "how was this photo made" question on Hunt scans. */
export function huntCaptureCheckEnabled(): boolean {
  return (process.env.HUNT_CAPTURE_CHECK ?? "").trim().toLowerCase() !== "off";
}

const CAPTURE_KINDS: readonly CaptureKind[] = ["in_person", "screen", "screenshot_or_listing", "unclear"];
export function normalizeCaptureKind(v: unknown): CaptureKind | null {
  return typeof v === "string" && (CAPTURE_KINDS as readonly string[]).includes(v) ? (v as CaptureKind) : null;
}
/** The model saw a screen, a screenshot or a listing image. */
export function isScreenFlag(kind: CaptureKind | null | undefined): boolean {
  return kind === "screen" || kind === "screenshot_or_listing";
}

const UNKNOWNISH = /^(unknown|n\/?a|none|not (provided|specified|visible)|unbranded|-|—)?$/i;
const norm = (v: unknown): string => {
  const s = String(v ?? "").trim();
  return UNKNOWNISH.test(s) ? "" : s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
};

/**
 * "The same item": brand | type | colour | what is on it. Used to stop one find
 * being counted as a valued find twice from two different photos.
 *
 * Null when there is neither a brand nor a subject. "black t-shirt" describes
 * thousands of different items, and comparing on it would punish honest hunts.
 */
export function itemKeyOf(c: CanonicalAnalysisV1): string | null {
  const id = c.ai.identification;
  const brand = norm(id.canonical_brand);
  const subject = [id.character_or_license, id.team, id.artist, id.event, id.subject, id.product_line, id.model_or_product_number]
    .map(norm).filter(Boolean).join(" ");
  if (!brand && !subject) return null;
  const type = norm(id.item_type) || norm(id.generic_item_name);
  if (!type) return null;
  return [brand, type, norm(c.ai.visible_attributes?.primary_color), subject].join("|").slice(0, 240);
}

export interface RecordHuntScanInput {
  userId:       string;
  huntId:       string;
  attemptId:    string;
  analysisId:   string;
  canonical:    CanonicalAnalysisV1;
  /** The legacy-shape result the app is sent (toLegacyShape + canonical). */
  payload:      unknown;
  frontBase64:  string | null;
  photoCount:   number;
  captureFront: CaptureFront;
}

/** The row for one scan. Pure apart from the photo hash. Exported for tests. */
export async function buildHuntScanRow(input: RecordHuntScanInput): Promise<HuntScanRow> {
  const { canonical: c, payload } = input;
  const inputs: EngineInputs = engineInputs(payload as never);
  const v1 = (payload as any)?.identification?.v1 ?? {};
  const soft = scanSoftFail(payload as never);
  const tier = v1.confidenceTier;
  const hash = await hashPhoto(input.frontBase64);
  const legacyId = (payload as any)?.identification ?? {};
  return {
    analysis_id:   input.analysisId,
    user_id:       input.userId,
    hunt_id:       input.huntId,
    attempt_id:    input.attemptId,
    scanned_at:    new Date().toISOString(),
    photo_hash:    hash?.hex ?? null,
    hash_b0:       hash?.bands[0] ?? null,
    hash_b1:       hash?.bands[1] ?? null,
    hash_b2:       hash?.bands[2] ?? null,
    hash_b3:       hash?.bands[3] ?? null,
    photo_count:   Math.max(1, Math.min(3, Math.floor(input.photoCount) || 1)),
    capture_front: input.captureFront,
    capture_kind:  normalizeCaptureKind(c.ai.photo_evidence?.capture_kind),
    soft_fail:     soft !== null,
    confident_id:  soft === null && (tier === "high" || tier === "medium"),
    brand:         String(legacyId.brand ?? "").slice(0, 120),
    category:      String(legacyId.category ?? "").slice(0, 120),
    item_key:      itemKeyOf(c),
    resale:        Number.isFinite(inputs.resale) ? inputs.resale : 0,
    xp_inputs:     inputs,
  };
}

/**
 * Record a Hunt scan. Fire-and-forget: call without awaiting.
 * One retry, because a row that fails to save costs an honest user that scan's XP.
 */
export async function recordHuntScan(input: RecordHuntScanInput): Promise<boolean> {
  try {
    if (!input.userId || !validHuntId(input.huntId) || !input.analysisId) return false;
    const row = await buildHuntScanRow(input);
    const store = getHuntStore();
    if (!store) { console.warn("[hunt] scan not recorded: database not configured"); return false; }
    for (let attempt = 0; attempt < 2; attempt++) {
      const ok = await store.insertScan(row).catch(() => false);
      if (ok) {
        console.log(`[hunt] scan recorded hunt=${input.huntId.slice(0, 24)} capture=${row.capture_front}` +
          ` kind=${row.capture_kind ?? "-"} photos=${row.photo_count} hash=${row.photo_hash ? "yes" : "NO"}`);
        return true;
      }
      await new Promise(r => setTimeout(r, 400));
    }
    console.error(`[hunt] scan NOT recorded after retry, analysis=${input.analysisId}`);
    return false;
  } catch (err) {
    console.error("[hunt] recordHuntScan threw:", err instanceof Error ? err.message : err);
    return false;
  }
}
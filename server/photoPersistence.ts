/**
 * Durable photo persistence.
 *
 * Today only the front photo persists, and only via the client
 * (results.tsx, gated on user?.id). Tag and detail are never stored, and
 * scanRecord.imageUri holds a dead file:// path because the old Forge upload
 * branch always early-returns. All three are fixed here.
 *
 * Every user is authenticated — there is no guest mode — so there is no
 * anonymous branch and no temporary path.
 */
import { getSupabaseAdmin } from "./supabaseAdmin.js";
import type { PhotoSlot } from "../shared/canonical.types.js";

const BUCKET = "scan-photos";

export interface PersistInput {
  userId: string;
  analysisId: string;
  scanAttemptId: string;
  images: Partial<Record<PhotoSlot, string>>;   // base64, no data: prefix
  mimeType?: string;
}

/**
 * Uploads every supplied slot, preserving slot identity in the path.
 * Returns storage references — never local file:// paths.
 *
 * A failed upload does NOT fail the scan: the analysis is still valid, the
 * photo is simply unavailable for later review. The ref comes back null and
 * that is visible in meta.photo_refs.
 */
export async function persistScanPhotos(
  input: PersistInput,
): Promise<Record<PhotoSlot, string | null>> {
  const refs: Record<PhotoSlot, string | null> = { front: null, tag: null, detail: null };
  const ext = (input.mimeType ?? "image/jpeg").includes("png") ? "png" : "jpg";

  let admin: ReturnType<typeof getSupabaseAdmin>;
  try {
    admin = getSupabaseAdmin();
  } catch (e) {
    console.warn("[photos] supabase admin unavailable; refs left null:", e);
    return refs;
  }
  if (!admin) return refs;

  for (const slot of ["front", "tag", "detail"] as PhotoSlot[]) {
    const b64 = input.images[slot];
    if (!b64) continue;
    const path = `${input.userId}/${input.analysisId}/${slot}.${ext}`;
    try {
      const bytes = Buffer.from(b64, "base64");
      const { error } = await admin.storage.from(BUCKET).upload(path, bytes, {
        contentType: input.mimeType ?? "image/jpeg",
        upsert: true,
      });
      if (error) { console.warn(`[photos] ${slot} upload failed:`, error.message); continue; }
      refs[slot] = `${BUCKET}/${path}`;
    } catch (e) {
      console.warn(`[photos] ${slot} upload threw:`, e);
    }
  }
  return refs;
}
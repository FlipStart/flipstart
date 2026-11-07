/**
 * lib/photoPrep.ts
 *
 * Getting a gallery photo ready to send (Phase 7 of the scan-failure plan).
 *
 * A photo picked from the library shows its thumbnail at once and is resized
 * and encoded in the background. Three things went wrong with that before:
 *
 *   1. Stuck on "One moment". The ready photo was only swapped in if it was
 *      still in the SAME slot. Drag it to another slot, or remove it and tap
 *      Undo, while it was loading, and the ready version was thrown away —
 *      the photo stayed half-ready forever and Done said "One moment" forever.
 *      A photo that failed to load (or never finished, e.g. still downloading
 *      from iCloud) did the same.
 *   2. Tag and Graphic photos silently dropped. Done only waited for the
 *      front photo; a Tag or Graphic still loading was simply left out of the
 *      scan, with no word to the user.
 *   3. Front photos sent at 1440 px. The background job never said which slot
 *      the photo was for, so it got the tag-reading size instead of 1024.
 *
 * So: one preparation per photo (keyed by its uri, wherever it moves), a time
 * limit, one automatic retry, and a result that Done can wait for and that
 * says exactly what went wrong when it does.
 *
 * No React Native imports: the resize function and the clock are passed in,
 * so these rules are tested directly.
 */
import type { CapturedPhoto, PhotoSlot } from "./capture";

export type PrepFailure =
  /** The image couldn't be read or converted. */
  | "unreadable"
  /** It didn't finish in time — usually an iCloud photo still downloading. */
  | "too_slow";

export type PrepOutcome = { ok: true; photo: CapturedPhoto } | { ok: false; reason: PrepFailure };

export interface PrepAsset { uri: string; width?: number; height?: number; mimeType?: string | null }

export type Normalize<A extends PrepAsset> = (asset: A, label: string, slot: PhotoSlot) => Promise<CapturedPhoto | null>;

export interface PhotoPrepOptions {
  /** How long one photo may take, both tries together. */
  timeoutMs?: number;
  /** Tries after the first, for a photo that came back unreadable. */
  retries?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
}

export const PREP_TIMEOUT_MS = 20_000;

/**
 * Size class: the front photo is sent at 1024 px, Tag and Graphic at 1440
 * (lib/capture.ts SLOT_MAX_PX). A photo prepared for the front and then
 * dragged into Tag must be prepared again at the larger size, or the tag text
 * the extra pixels are for is lost.
 */
type SizeClass = "front" | "full";
const sizeClassOf = (slot: PhotoSlot): SizeClass => (slot === "front" ? "front" : "full");

export interface PhotoPrep<A extends PrepAsset> {
  /** Start preparing a picked photo for a slot (once per photo and size). */
  start(asset: A, slot: PhotoSlot, label: string): Promise<PrepOutcome>;
  /**
   * The preparation a photo needs to be sent from `slot`, given the uri it
   * has in the slot now — the picked photo's uri, or the ready photo's uri
   * once it was swapped in. Starts a new one at the right size if the photo
   * was prepared for a smaller slot. Undefined for a photo this module never
   * saw (a camera photo): use it as it is.
   */
  jobFor(uri: string, slot: PhotoSlot): Promise<PrepOutcome> | undefined;
  /** The ready photo for sending from `slot`, if it is ready right now. */
  peek(uri: string, slot: PhotoSlot): CapturedPhoto | undefined;
  /** Forget everything (a new scan). */
  clear(): void;
}

export function createPhotoPrep<A extends PrepAsset>(normalize: Normalize<A>, o: PhotoPrepOptions = {}): PhotoPrep<A> {
  const timeoutMs = o.timeoutMs ?? PREP_TIMEOUT_MS;
  const retries = o.retries ?? 1;
  const setTimer = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  /** key = picked uri + size class */
  const jobs = new Map<string, Promise<PrepOutcome>>();
  const done = new Map<string, CapturedPhoto>();
  /** picked uri → the picked asset, to prepare again at another size */
  const assets = new Map<string, A>();
  /** ready photo's uri → which picked photo and size it came from */
  const origin = new Map<string, { picked: string; cls: SizeClass }>();
  const key = (picked: string, cls: SizeClass) => `${picked}|${cls}`;

  const attempt = async (asset: A, slot: PhotoSlot, label: string): Promise<PrepOutcome> => {
    for (let i = 0; i <= retries; i++) {
      try {
        const photo = await normalize(asset, label, slot);
        if (photo && photo.base64) return { ok: true, photo };
      } catch { /* try again */ }
    }
    return { ok: false, reason: "unreadable" };
  };

  const start = (asset: A, slot: PhotoSlot, label: string): Promise<PrepOutcome> => {
    const cls = sizeClassOf(slot);
    const k = key(asset.uri, cls);
    assets.set(asset.uri, asset);
    const existing = jobs.get(k);
    if (existing) return existing;
    const job = new Promise<PrepOutcome>(resolve => {
      let settled = false;
      const finish = (r: PrepOutcome) => {
        if (settled) return;
        settled = true;
        if (r.ok) {
          done.set(k, r.photo);
          origin.set(r.photo.uri, { picked: asset.uri, cls });
        }
        resolve(r);
      };
      setTimer(() => finish({ ok: false, reason: "too_slow" }), timeoutMs);
      attempt(asset, slot, label).then(finish, () => finish({ ok: false, reason: "unreadable" }));
    });
    jobs.set(k, job);
    return job;
  };

  /** The picked photo behind a uri, and the size it was last prepared at. */
  const resolveUri = (uri: string): { picked: string; cls: SizeClass | null } | null => {
    const o = origin.get(uri);
    if (o) return { picked: o.picked, cls: o.cls };
    if (assets.has(uri)) return { picked: uri, cls: null };
    return null;
  };

  return {
    start,
    jobFor(uri, slot) {
      const r = resolveUri(uri);
      if (!r) return undefined;
      const need = sizeClassOf(slot);
      // A larger photo is fine in the front slot; a smaller one is not fine in Tag/Graphic.
      if (r.cls === "full" || r.cls === need) {
        const job = jobs.get(key(r.picked, r.cls));
        if (job) return job;
      }
      const asset = assets.get(r.picked);
      return asset ? start(asset, slot, `gallery-${slot}`) : undefined;
    },
    peek(uri, slot) {
      const r = resolveUri(uri);
      if (!r) return undefined;
      const need = sizeClassOf(slot);
      return done.get(key(r.picked, need)) ?? (need === "front" ? done.get(key(r.picked, "full")) : undefined);
    },
    clear() { jobs.clear(); done.clear(); assets.clear(); origin.clear(); },
  };
}

/** Put a ready photo into whichever slot holds its uri now — wherever it was dragged. */
export function replaceByUri<T extends { uri: string }>(
  slots: Partial<Record<PhotoSlot, T>>, uri: string, photo: T,
): Partial<Record<PhotoSlot, T>> {
  let changed = false;
  const next: Partial<Record<PhotoSlot, T>> = { ...slots };
  for (const k of Object.keys(next) as PhotoSlot[]) {
    if (next[k]?.uri === uri) { next[k] = photo; changed = true; }
  }
  return changed ? next : slots;
}

/** The slot currently holding a uri, if any. */
export function slotOf<T extends { uri: string }>(slots: Partial<Record<PhotoSlot, T>>, uri: string): PhotoSlot | null {
  for (const k of Object.keys(slots) as PhotoSlot[]) if (slots[k]?.uri === uri) return k;
  return null;
}

const SLOT_NAME: Record<PhotoSlot, string> = { front: "Front", tag: "Tag", detail: "Graphic" };

/** What to tell the user about a photo that couldn't be prepared. Specific, never "something went wrong". */
export function prepFailureMessage(slot: PhotoSlot, reason: PrepFailure): { title: string; message: string } {
  const name = SLOT_NAME[slot];
  if (reason === "too_slow") {
    return {
      title: `Your ${name} photo didn't load`,
      message: `It took more than ${Math.round(PREP_TIMEOUT_MS / 1000)} seconds to load, which usually means it's still downloading from iCloud. We removed it — pick it again in a moment, or take a new photo.`,
    };
  }
  return {
    title: `Your ${name} photo couldn't be read`,
    message: "FlipStart couldn't open that image to prepare it, so we removed it. Pick a different photo, or take a new one.",
  };
}
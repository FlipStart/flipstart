/**
 * lib/thirdPhotoDecision.ts
 *
 * Who may occupy the third photo slot, and what a library selection should do.
 * Pure, and answerable without React or a camera.
 *
 * ── Why this is its own module ──────────────────────────────────────────────
 * Same split as generateListingsDecision and deepAnalysisDecision. The rules
 * here decide whether a Free user's image reaches the AI, and that is worth
 * testing in plain Node rather than through a rendered camera screen.
 *
 * ── The rule the old code got wrong ─────────────────────────────────────────
 * The premium threshold is the THIRD ACTIVE PHOTO, not the third item the
 * picker returned. The shipped handler sliced `picked.slice(0, maxAllowed)` and
 * assigned `SLOT_ORDER[i]` from index 0, which meant:
 *
 *   already active: front = A
 *   picker returns: B, C
 *   → B overwrote A, C became the tag, and NOTHING gated
 *
 * The user silently lost photo A and a Free account ended up with two photos it
 * never chose. planSelection() fills EMPTY slots in order instead, so existing
 * photos survive and the gate fires on the genuine third.
 */

/** The camera's three slots, in fill order. Mirrors SLOT_ORDER in camera.tsx. */
export type PhotoSlotName = "front" | "tag" | "detail";
export const SLOT_FILL_ORDER: PhotoSlotName[] = ["front", "tag", "detail"];

/** Hard product ceiling. Pro gets three; nobody gets four. */
export const MAX_SLOTS = 3;
export const FREE_SLOTS = 2;

export type EntitlementReadiness = "unresolved" | "ready" | "error";

/**
 * How many slots this user may actually fill.
 *
 * Fails closed while unresolved: FREE_SLOTS, never MAX_SLOTS. A premium slot
 * must not be granted by a loading state — and note that packs are not a
 * parameter here at all, so no balance can widen it.
 */
export function allowedSlots(status: EntitlementReadiness, maxPhotoSlots: number): number {
  if (status !== "ready") return FREE_SLOTS;
  return maxPhotoSlots >= MAX_SLOTS ? MAX_SLOTS : FREE_SLOTS;
}

// ── Camera origin ───────────────────────────────────────────────────────────

export type CameraTapAction =
  /** Open the normal capture flow. */
  | "capture"
  /** Free reaching for the third slot: open the paywall instead. */
  | "paywall"
  /** Already at capacity — nothing to do. */
  | "at_capacity";

/**
 * What a tap on the capture button should do.
 *
 * Gates BEFORE the camera opens, never after. Capturing and then rejecting
 * would waste the user's time, leave a discarded image in memory, and — worse —
 * prompt for camera permission purely because they touched a locked slot.
 */
export function decideCameraTap(
  filledCount: number,
  status: EntitlementReadiness,
  maxPhotoSlots: number,
): CameraTapAction {
  const allowed = allowedSlots(status, maxPhotoSlots);
  if (filledCount >= MAX_SLOTS) return "at_capacity";
  if (filledCount >= allowed) return "paywall";
  return "capture";
}

// ── Library origin ──────────────────────────────────────────────────────────

export interface SelectionPlan<T> {
  /** Asset → slot, for the images that fit. Existing photos are never moved. */
  assignments: { slot: PhotoSlotName; asset: T }[];
  /**
   * The one image that would have become the third photo, held ONLY as intent.
   *
   * Never an active photo, never in the scan payload, never sent to the model.
   * Null unless a Free user genuinely reached the third slot.
   */
  pendingThird: T | null;
  /** Anything beyond capacity. Discarded — Photo 4 must never exist. */
  discarded: T[];
  /** True when pendingThird is set, i.e. the paywall should open. */
  needsPaywall: boolean;
}

/**
 * Decide where a library selection goes.
 *
 * Fills EMPTY slots in SLOT_FILL_ORDER. An occupied slot is left exactly as it
 * is — selecting new images must never silently destroy a photo the user
 * already took.
 *
 * The first asset that would land in the third slot while the user is limited
 * to two becomes `pendingThird` rather than an assignment. Everything past
 * capacity is discarded outright.
 */
export function planSelection<T>(
  picked: T[],
  occupied: Partial<Record<PhotoSlotName, unknown>>,
  status: EntitlementReadiness,
  maxPhotoSlots: number,
): SelectionPlan<T> {
  const allowed = allowedSlots(status, maxPhotoSlots);
  const empty = SLOT_FILL_ORDER.filter(s => !occupied[s]);

  const assignments: { slot: PhotoSlotName; asset: T }[] = [];
  let pendingThird: T | null = null;
  const discarded: T[] = [];

  let filled = SLOT_FILL_ORDER.length - empty.length;

  for (const asset of picked) {
    const slot = empty[assignments.length];

    // No empty slot left at all — genuinely nothing to do with this image.
    if (!slot) { discarded.push(asset); continue; }

    if (filled < allowed) {
      assignments.push({ slot, asset });
      filled += 1;
      continue;
    }

    /**
     * Beyond what this user may fill.
     *
     * The FIRST such image is the one they were reaching for, so it is held as
     * pending intent and the paywall explains it. Any further images are
     * discarded — resuming one photo after an upgrade is helpful; silently
     * queuing three is not.
     */
    if (pendingThird === null && filled < MAX_SLOTS) pendingThird = asset;
    else discarded.push(asset);
  }

  return {
    assignments,
    pendingThird,
    discarded,
    needsPaywall: pendingThird !== null,
  };
}

// ── Promoting a pending image after an unlock ───────────────────────────────

export interface PromotionContext {
  /** The server confirmed monthly or annual. Nothing else counts. */
  isAuthoritativelyPro: boolean;
  /** Same signed-in user as when the intent was created. */
  sameUid: boolean;
  /** Same camera/scan session — an old intent must not reach a new scan. */
  sameSession: boolean;
  /** The pending asset reference still exists and is usable. */
  assetUsable: boolean;
  /** The third slot is still empty. */
  slotStillEmpty: boolean;
}

export type PromotionResult =
  /** Attach the pending image as the third photo. */
  | "promote"
  /** Pro is real, but the image can no longer be used. NOT a purchase failure. */
  | "unlocked_without_asset"
  /** Do nothing at all — Pro was never confirmed, or the context is stale. */
  | "abort";

/**
 * Whether a pending library image may become the active third photo.
 *
 * Deliberately separates "abort" from "unlocked_without_asset". They look alike
 * from the code's point of view and are completely different to the user: one
 * means nothing happened, the other means they successfully subscribed and we
 * simply cannot reuse their image. Showing a purchase error for the second
 * would be telling a paying customer their payment failed.
 */
export function decidePromotion(ctx: PromotionContext): PromotionResult {
  // Without authoritative Pro nothing may be attached, whatever else is true.
  if (!ctx.isAuthoritativelyPro) return "abort";

  /**
   * Identity first, and it is an abort rather than a soft outcome: attaching
   * account A's image under account B, or an old scan's image to a new one, is
   * a data-integrity failure, not a missing-asset inconvenience.
   */
  if (!ctx.sameUid || !ctx.sameSession) return "abort";

  // The slot filled some other way in the meantime. Leave it alone.
  if (!ctx.slotStillEmpty) return "abort";

  if (!ctx.assetUsable) return "unlocked_without_asset";

  return "promote";
}
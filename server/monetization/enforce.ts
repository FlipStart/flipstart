/**
 * server/monetization/enforce.ts
 *
 * Server-side entitlement checks for the endpoints that will eventually be
 * gated. Every one is a no-op while MONETIZATION_V1_ENABLED is off, so this file
 * can ship ahead of purchases without changing a single user's experience.
 *
 * These functions exist NOW, unwired to enforcement, so that when the flag flips
 * there is no scramble to add checks to five endpoints under time pressure.
 */
import { monetizationV1EnabledFor } from "../_core/env.js";
import { readUsage } from "./ledger.js";
import {
  derivePlan, canUseFeature, maxPhotoSlots, buildReadModel,
  type Feature, type PlanState, type EntitlementReadModel,
} from "./policy.js";

export interface EnforcementResult {
  allowed: boolean;
  /** Present when denied. Safe to send to a client — names the capability, never
   *  internal state. */
  /**
   * USAGE_UNAVAILABLE means the authoritative row could not be READ. It is not
   * a denial of entitlement -- it is a refusal to guess. Callers must not
   * present it as "you are Free".
   */
  reason?: "NOT_ENTITLED" | "TOO_MANY_PHOTOS" | "NOT_AUTHENTICATED" | "USAGE_UNAVAILABLE";
  plan?: PlanState;
  /** True when V1 is not authoritative for this user, so the caller should fall
   *  through to existing beta behaviour rather than treat this as a pass. */
  bypassed?: boolean;
}

const bypass = (): EnforcementResult => ({ allowed: true, bypassed: true });

/**
 * Feature gate. Sold Comps and Hunt Mode always pass — they are free features
 * and this function is not the place to quietly change that.
 */
export async function requireFeature(
  userId: string | null | undefined, feature: Feature,
): Promise<EnforcementResult> {
  if (!monetizationV1EnabledFor(userId ?? null)) return bypass();
  if (!userId) return { allowed: false, reason: "NOT_AUTHENTICATED" };

  /**
   * FAIL CLOSED on an unreadable row. Deriving a plan from fabricated usage is
   * exactly how a paying subscriber was refused their own features.
   */
  const read = await readUsage(userId);
  if (!read.ok) return { allowed: false, reason: "USAGE_UNAVAILABLE" };

  const plan = derivePlan(read.usage);
  return canUseFeature(plan, feature)
    ? { allowed: true, plan }
    : { allowed: false, reason: "NOT_ENTITLED", plan };
}

/**
 * Photo-slot ceiling.
 *
 * Enforced on the SERVER because a modified client can post a third image to a
 * publicProcedure regardless of what the camera UI offers. Hiding the slot is
 * presentation; this is the control.
 */
export async function requirePhotoCount(
  userId: string | null | undefined, photoCount: number,
): Promise<EnforcementResult> {
  if (!monetizationV1EnabledFor(userId ?? null)) return bypass();
  if (!userId) return { allowed: false, reason: "NOT_AUTHENTICATED" };

  const read = await readUsage(userId);
  if (!read.ok) return { allowed: false, reason: "USAGE_UNAVAILABLE" };

  const plan = derivePlan(read.usage);
  return photoCount <= maxPhotoSlots(plan)
    ? { allowed: true, plan }
    : { allowed: false, reason: "TOO_MANY_PHOTOS", plan };
}

/** Camera context. Same reasoning as photo count: the text arrives over the
 *  wire, so the wire is where it has to be refused. */
export async function requireCameraContext(
  userId: string | null | undefined,
): Promise<EnforcementResult> {
  return requireFeature(userId, "camera_context");
}

/** The safe read model for the client. Never includes credentials, reservation
 *  ids, or override state. */
export async function getEntitlementReadModel(
  userId: string,
): Promise<EntitlementReadModel | null> {
  /**
   * NULL when the row cannot be read.
   *
   * The route turns this into `{ ok: false }`, which the client already renders
   * as UNRESOLVED -- not Free. Returning a Free read model here is precisely
   * the bug that showed a Monthly subscriber 15 free scans, so the failure has
   * to stay visible all the way to the UI.
   */
  const read = await readUsage(userId);
  if (!read.ok) return null;
  return buildReadModel(read.usage);
}
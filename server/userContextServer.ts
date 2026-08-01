/**
 * server/userContextServer.ts
 *
 * Server-only half of user-context handling: hashing and entitlement.
 *
 * Split from shared/userContext.ts because that file is bundled by Metro for
 * the app, where a `node:crypto` import fails at runtime. Normalization is
 * shared so client and server agree byte-for-byte; hashing is server-only
 * because only the server builds cache keys.
 */
import crypto from "node:crypto";
import {
  normalizeUserContext, buildUserContextInput, type UserContextInput,
} from "../shared/userContext.js";
import { ENV } from "./_core/env.js";

/** Short SHA-256. Used as a cache-key component and as telemetry that
 *  distinguishes two scans without ever logging what the user typed. */
export function hashUserContext(normalized: string): string | null {
  if (!normalized) return null;
  return crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

/** Normalize + hash in one step. The server ALWAYS re-normalizes rather than
 *  trusting whatever the client sent. */
export function buildServerUserContext(raw: unknown): UserContextInput {
  const text = normalizeUserContext(raw);
  return buildUserContextInput(text, hashUserContext(text));
}

/**
 * Is this user allowed to use camera context?
 *
 * Entitlement is enforced HERE, not by hiding the UI. A modified client can
 * post whatever it likes to a publicProcedure, so the check has to be on the
 * server side of the wire.
 *
 * The permanent subscription system does not exist yet (handoff §8: "No
 * subscription code has been built"), so this is deliberately a TEMPORARY
 * allow-list on the same env variable that already gates V1 testing. When
 * entitlements land, replace the body with the real Pro/trial lookup and delete
 * this comment — the call sites do not change.
 */
export function userContextAllowedFor(userId: string | undefined | null): boolean {
  // Global flag on: the feature is live for everyone the product intends.
  if (ENV.canonicalV1Enabled) return true;
  if (!userId) return false;
  return ENV.canonicalV1AllowedUserIds.includes(userId);
}
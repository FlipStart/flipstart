/**
 * server/leaderboard/identity.ts
 *
 * Turns an account's profile into what OTHER people are allowed to see of it.
 *
 * The profile (name, username, picture) is written by its owner and can say
 * anything. This reads it, moderates it, and writes the approved result to
 * leaderboard_identity, which is the only thing leaderboard responses use.
 *
 *   name     display name, else username, else nothing (the app shows "Hunter")
 *   picture  a small re-encoded copy of the profile picture, stored under a
 *            random file name in a separate public bucket. Re-encoding drops
 *            the photo's metadata (including any location), and the random
 *            name means the link says nothing about whose picture it is.
 *
 * ── Never shown unchecked ───────────────────────────────────────────────────
 * A name or picture reaches other people only after it passed. If a check
 * cannot be run right now, nothing changes: whatever was approved before keeps
 * showing, and the check is tried again later.
 *
 * ── When it runs ────────────────────────────────────────────────────────────
 * After a profile edit (the app asks and waits, so it can say if something was
 * rejected), when an account finishes a Hunt, and in the background for any
 * leaderboard row whose profile changed since it was last checked.
 */
import { randomUUID } from "node:crypto";
import { cleanName, moderateImage, moderateName } from "./moderation.js";
import {
  AVATAR_BUCKET, getLeaderboardStore,
  type IdentityPatch, type IdentityRow, type LeaderboardStore, type ProfileRow,
} from "./store.js";

export type NameOutcome = "approved" | "rejected" | "pending";
export type AvatarOutcome = "approved" | "rejected" | "pending" | "none";

export interface IdentityResult {
  name:       NameOutcome;
  avatar:     AvatarOutcome;
  publicName: string | null;
  /** Something was looked at this time (false = already up to date). */
  checked:    boolean;
}

/** MUST match the expression in leaderboard_page() that decides a row is stale. */
export const nameSourceOf = (p: Pick<ProfileRow, "display_name" | "username">): string =>
  `${p.display_name ?? ""}\n${p.username ?? ""}`;

/**
 * The storage path of this account's own uploaded picture, or null.
 *
 * profiles.avatar_url is text its owner controls. It is never fetched as a URL.
 * Only a path inside this account's own folder of the app's avatar bucket is
 * accepted, and the file is then read through the storage API by that path.
 */
export function avatarPathFor(userId: string, avatarUrl: string | null | undefined): string | null {
  if (!userId || !avatarUrl || typeof avatarUrl !== "string" || avatarUrl.length > 600) return null;
  const marker = `/object/public/${AVATAR_BUCKET}/`;
  const i = avatarUrl.indexOf(marker);
  if (i === -1) return null;
  let path: string;
  try { path = decodeURIComponent(avatarUrl.slice(i + marker.length).split(/[?#]/)[0]); } catch { return null; }
  if (!path.startsWith(`${userId}/`)) return null;
  if (path.includes("..") || path.includes("//") || path.includes("\\") || path.length > 300) return null;
  if (!/^[A-Za-z0-9._\-/]+$/.test(path)) return null;
  return path;
}

export const PUBLIC_AVATAR_PX = 256;

type Encoder = (bytes: Buffer) => Promise<Buffer | null | "unavailable">;
let encoderOverride: Encoder | null = null;
/** Tests only. */
export function __setAvatarEncoderForTests(e: Encoder | null): void { encoderOverride = e; }

/**
 * A 256px square JPEG of the picture, with no metadata.
 * null = not a readable image.  "unavailable" = the image library is missing.
 */
async function toPublicJpeg(bytes: Buffer): Promise<Buffer | null | "unavailable"> {
  if (encoderOverride) return encoderOverride(bytes);
  let sharp: any;
  try { const m: any = await import("sharp"); sharp = m.default ?? m; }
  catch { console.error("[leaderboard] sharp is not available: profile pictures cannot be prepared"); return "unavailable"; }
  try {
    return await sharp(bytes, { limitInputPixels: 60_000_000 })
      .rotate()                                             // honour the camera's orientation, then drop it
      .resize(PUBLIC_AVATAR_PX, PUBLIC_AVATAR_PX, { fit: "cover" })
      .jpeg({ quality: 82 })
      .toBuffer();
  } catch { return null; }
}

async function decideName(profile: ProfileRow, current: IdentityRow | null): Promise<{ patch: IdentityPatch; outcome: NameOutcome; publicName: string | null; checked: boolean }> {
  const source = nameSourceOf(profile);
  const fresh = current && current.name_source === source && current.name_status !== "pending";
  if (fresh) return { patch: {}, outcome: current!.name_status, publicName: current!.public_name, checked: false };

  const changed = !current || current.name_source !== source;
  const candidates = Array.from(new Set([cleanName(profile.display_name), cleanName(profile.username)].filter(Boolean)));
  for (const candidate of candidates) {
    const verdict = await moderateName(candidate);
    if (verdict === "unavailable") {
      // Could not check. Change nothing: an earlier approved name keeps showing.
      return { patch: {}, outcome: "pending", publicName: current?.public_name ?? null, checked: true };
    }
    if (verdict === "ok") {
      return {
        patch: {
          public_name: candidate, name_status: "approved", name_source: source,
          // A new name starts clean: reports about the old one no longer apply.
          ...(changed ? { name_hidden: false, name_cleared_at: new Date().toISOString() } : {}),
        },
        outcome: "approved", publicName: candidate, checked: true,
      };
    }
  }
  return { patch: { public_name: null, name_status: "rejected", name_source: source }, outcome: "rejected", publicName: null, checked: true };
}

async function decideAvatar(store: LeaderboardStore, userId: string, profile: ProfileRow, current: IdentityRow | null): Promise<{ patch: IdentityPatch; outcome: AvatarOutcome; removeOld: boolean; checked: boolean }> {
  const source = profile.avatar_url ?? "";
  const fresh = current && (current.avatar_source ?? "") === source && current.avatar_status !== "pending";
  if (fresh) return { patch: {}, outcome: current!.avatar_status, removeOld: false, checked: false };

  const pending = { patch: {}, outcome: "pending" as const, removeOld: false, checked: true };
  if (!source) {
    return { patch: { avatar_url: null, avatar_status: "none", avatar_source: "" }, outcome: "none", removeOld: true, checked: true };
  }
  const rejected = { patch: { avatar_url: null, avatar_status: "rejected" as const, avatar_source: source }, outcome: "rejected" as const, removeOld: true, checked: true };

  const path = avatarPathFor(userId, source);
  if (!path) return rejected;                       // not this account's own uploaded picture

  const bytes = await store.downloadAvatar(path);
  if (!bytes) return pending;                       // not there yet, too large, or storage is down

  const jpeg = await toPublicJpeg(bytes);
  if (jpeg === "unavailable") return pending;
  if (!jpeg) return rejected;                       // not an image

  const verdict = await moderateImage(jpeg.toString("base64"));
  if (verdict === "unavailable") return pending;
  if (verdict === "blocked") return rejected;

  const url = await store.uploadPublicAvatar(`${randomUUID()}.jpg`, jpeg);
  if (!url) return pending;
  return {
    patch: {
      avatar_url: url, avatar_status: "approved", avatar_source: source,
      avatar_hidden: false, avatar_cleared_at: new Date().toISOString(),
    },
    outcome: "approved", removeOld: true, checked: true,
  };
}

const inflight = new Map<string, Promise<IdentityResult>>();

/** Check one account's name and picture, if they need it. Never throws. */
export function refreshIdentity(userId: string): Promise<IdentityResult> {
  const running = inflight.get(userId);
  if (running) return running;
  const job = run(userId).finally(() => { inflight.delete(userId); });
  inflight.set(userId, job);
  return job;
}

async function run(userId: string): Promise<IdentityResult> {
  const nothing: IdentityResult = { name: "pending", avatar: "none", publicName: null, checked: false };
  try {
    const store = getLeaderboardStore();
    if (!store || !userId) return nothing;
    const profile = await store.profile(userId);
    if (!profile) return nothing;
    const current = await store.identity(userId);

    const name = await decideName(profile, current);
    const avatar = await decideAvatar(store, userId, profile, current);
    const patch: IdentityPatch = { ...name.patch, ...avatar.patch };

    if (Object.keys(patch).length > 0 || !current) {
      const saved = await store.saveIdentity(userId, { ...patch, checked_at: new Date().toISOString() });
      if (!saved) return { name: "pending", avatar: "pending", publicName: current?.public_name ?? null, checked: true };
      // The old public copy is only removed once the new decision is stored.
      const old = current?.avatar_url;
      if (avatar.removeOld && old && old !== patch.avatar_url) void store.removePublicAvatar(old);
    }
    if (name.checked || avatar.checked) {
      console.log(`[leaderboard] identity checked: name=${name.outcome} picture=${avatar.outcome}`);
    }
    return { name: name.outcome, avatar: avatar.outcome, publicName: name.publicName, checked: name.checked || avatar.checked };
  } catch (err) {
    console.error("[leaderboard] refreshIdentity failed:", err instanceof Error ? err.message : err);
    return nothing;
  }
}

// ─── Background refresh ───────────────────────────────────────────────────────
// Leaderboard reads hand over the accounts whose profile changed. They are
// checked a couple at a time, and the same account is not retried for a few
// minutes, so an outage of the moderation service cannot turn every page view
// into a burst of requests.

export const REFRESH_COOLDOWN_MS = 3 * 60_000;
const MAX_QUEUE = 200;
const CONCURRENCY = 2;
const lastTried = new Map<string, number>();
const queue: string[] = [];
let active = 0;

function pump(): void {
  while (active < CONCURRENCY && queue.length > 0) {
    const id = queue.shift() as string;
    active += 1;
    void refreshIdentity(id).finally(() => { active -= 1; pump(); });
  }
}

/** Ask for these accounts to be checked soon. Returns how many were queued. */
export function queueIdentityRefresh(userIds: string[], now = Date.now()): number {
  let added = 0;
  for (const id of userIds) {
    if (!id || queue.length >= MAX_QUEUE) break;
    if (now - (lastTried.get(id) ?? 0) < REFRESH_COOLDOWN_MS) continue;
    lastTried.set(id, now);
    if (lastTried.size > 5000) lastTried.clear();
    queue.push(id);
    added += 1;
  }
  pump();
  return added;
}

/** Tests only. */
export function __resetIdentityQueueForTests(): void { lastTried.clear(); queue.length = 0; inflight.clear(); }
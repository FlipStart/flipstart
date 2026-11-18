/**
 * server/leaderboard/store.ts
 *
 * Every database and storage call the leaderboard makes, behind one interface,
 * so the logic above it can be tested against an in-memory store.
 *
 * The real store uses the service-role client. None of these tables or
 * functions can be reached by the app (drizzle/sql/hunt_leaderboard_phase2.sql).
 */
import { getSupabaseAdmin } from "../supabaseAdmin.js";

export type Board = "weekly" | "all_time" | "best_hunt";
export const BOARDS: readonly Board[] = ["weekly", "all_time", "best_hunt"];
export type ReportReason = "photo" | "name" | "cheating";

export interface ProfileRow {
  id:           string;
  display_name: string | null;
  username:     string | null;
  avatar_url:   string | null;
}

export interface IdentityRow {
  user_id:       string;
  public_id:     string;
  public_name:   string | null;
  name_source:   string | null;
  name_status:   "approved" | "rejected" | "pending";
  avatar_url:    string | null;
  avatar_source: string | null;
  avatar_status: "approved" | "rejected" | "pending" | "none";
  name_hidden:   boolean;
  avatar_hidden: boolean;
}

export type IdentityPatch = Partial<Omit<IdentityRow, "user_id" | "public_id">> & {
  name_cleared_at?: string; avatar_cleared_at?: string; checked_at?: string;
};

/** One row of leaderboard_page(), exactly as Postgres returns it. Carries the real account id. */
export interface RawRow {
  user_id:   string;
  pos:       number;
  metric:    number;
  public_id: string;
  name:      string | null;
  avatar:    string | null;
  total_xp:  number;
  founding:  boolean;
  stale:     boolean;
}

export interface RawPage {
  board:        Board;
  now:          string;
  week_start:   string;
  week_ends_at: string;
  ranked:       number;
  rows:         RawRow[];
  me:           RawRow | null;
  above_metric: number | null;
}

export const AVATAR_BUCKET = "avatars";               // where the app uploads (owner-only link)
export const PUBLIC_AVATAR_BUCKET = "public-avatars"; // moderated copies, random names

export interface LeaderboardStore {
  page(board: Board, viewerId: string | null, after: number, limit: number): Promise<RawPage | null>;
  profile(userId: string): Promise<ProfileRow | null>;
  identity(userId: string): Promise<IdentityRow | null>;
  saveIdentity(userId: string, patch: IdentityPatch): Promise<boolean>;
  /** Bytes of a file in the app's avatar bucket, by path. Null when missing or too large. */
  downloadAvatar(path: string): Promise<Buffer | null>;
  /** Store a moderated copy under this file name. Returns its public link. */
  uploadPublicAvatar(fileName: string, jpeg: Buffer): Promise<string | null>;
  removePublicAvatar(publicUrl: string): Promise<void>;
  report(reporterId: string, publicId: string, reason: ReportReason): Promise<{ status: string; hidden?: boolean } | null>;
  setBlock(blockerId: string, publicId: string, blocked: boolean): Promise<{ status: string } | null>;
  blocked(blockerId: string): Promise<Array<{ public_id: string; name: string | null; avatar: string | null }> | null>;
  /** Account ids with a profile, in a fixed order, for the one-off backfill. */
  profileIds(afterId: string | null, limit: number): Promise<string[]>;
}

export const MAX_AVATAR_BYTES = 12 * 1024 * 1024;
const IDENTITY_COLUMNS =
  "user_id,public_id,public_name,name_source,name_status,avatar_url,avatar_source,avatar_status,name_hidden,avatar_hidden";

function supabaseStore(sb: any): LeaderboardStore {
  const warn = (what: string, error: any) => console.warn(`[leaderboard] ${what} failed:`, error?.message ?? error);
  const one = (data: any) => (Array.isArray(data) ? data[0] : data);
  return {
    async page(board, viewerId, after, limit) {
      const { data, error } = await sb.rpc("leaderboard_page", {
        p_board: board, p_viewer: viewerId, p_after: after, p_limit: limit,
      });
      if (error) { warn("page", error); return null; }
      const d = one(data);
      return d && typeof d === "object" ? (d as RawPage) : null;
    },
    async profile(userId) {
      const { data, error } = await sb.from("profiles")
        .select("id,display_name,username,avatar_url").eq("id", userId).maybeSingle();
      if (error) { warn("read profile", error); return null; }
      return (data as ProfileRow) ?? null;
    },
    async identity(userId) {
      const { data, error } = await sb.from("leaderboard_identity")
        .select(IDENTITY_COLUMNS).eq("user_id", userId).maybeSingle();
      if (error) { warn("read identity", error); return null; }
      return (data as IdentityRow) ?? null;
    },
    async saveIdentity(userId, patch) {
      const { error } = await sb.from("leaderboard_identity")
        .upsert({ user_id: userId, ...patch, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
      if (error) { warn("save identity", error); return false; }
      return true;
    },
    async downloadAvatar(path) {
      try {
        const { data, error } = await sb.storage.from(AVATAR_BUCKET).download(path);
        if (error || !data) { if (error) warn("download avatar", error); return null; }
        if (typeof data.size === "number" && data.size > MAX_AVATAR_BYTES) return null;
        const bytes = Buffer.from(await data.arrayBuffer());
        return bytes.length > 0 && bytes.length <= MAX_AVATAR_BYTES ? bytes : null;
      } catch (err) { warn("download avatar", err); return null; }
    },
    async uploadPublicAvatar(fileName, jpeg) {
      const { error } = await sb.storage.from(PUBLIC_AVATAR_BUCKET).upload(fileName, jpeg, {
        contentType: "image/jpeg", upsert: false, cacheControl: "31536000",
      });
      if (error) { warn("upload public avatar", error); return null; }
      const { data } = sb.storage.from(PUBLIC_AVATAR_BUCKET).getPublicUrl(fileName);
      return data?.publicUrl ?? null;
    },
    async removePublicAvatar(publicUrl) {
      try {
        const marker = `/object/public/${PUBLIC_AVATAR_BUCKET}/`;
        const i = publicUrl.indexOf(marker);
        if (i === -1) return;
        const name = publicUrl.slice(i + marker.length).split("?")[0];
        if (!name || name.includes("/") || name.includes("..")) return;
        await sb.storage.from(PUBLIC_AVATAR_BUCKET).remove([name]);
      } catch { /* an orphaned copy is harmless: nothing links to it */ }
    },
    async report(reporterId, publicId, reason) {
      const { data, error } = await sb.rpc("report_profile", { p_reporter: reporterId, p_public_id: publicId, p_reason: reason });
      if (error) { warn("report", error); return null; }
      return one(data) ?? null;
    },
    async setBlock(blockerId, publicId, blocked) {
      const { data, error } = await sb.rpc("set_user_block", { p_blocker: blockerId, p_public_id: publicId, p_blocked: blocked });
      if (error) { warn("block", error); return null; }
      return one(data) ?? null;
    },
    async blocked(blockerId) {
      const { data, error } = await sb.rpc("blocked_users", { p_blocker: blockerId });
      if (error) { warn("blocked list", error); return null; }
      const d = Array.isArray(data) && data.length === 1 && Array.isArray(data[0]) ? data[0] : data;
      return Array.isArray(d) ? d : [];
    },
    async profileIds(afterId, limit) {
      let q = sb.from("profiles").select("id").order("id", { ascending: true }).limit(limit);
      if (afterId) q = q.gt("id", afterId);
      const { data, error } = await q;
      if (error) { warn("list profiles", error); return []; }
      return (data ?? []).map((r: any) => String(r.id));
    },
  };
}

let override: LeaderboardStore | null | undefined;
/** Tests only: replace the store (null = "not configured"), or undefined to restore. */
export function __setLeaderboardStoreForTests(s: LeaderboardStore | null | undefined): void { override = s; }

export function getLeaderboardStore(): LeaderboardStore | null {
  if (override !== undefined) return override;
  const sb = getSupabaseAdmin();
  return sb ? supabaseStore(sb) : null;
}
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
  /**
   * Freeze the final result of every finished week that is not frozen yet
   * (drizzle/sql/hunt_leaderboard_phase4.sql). Returns the weeks it froze, or
   * null when the call failed.
   */
  closeFinishedWeeks(): Promise<ClosedWeek[] | null>;
  /**
   * This account's top-10 finishes on frozen Weekly boards, newest first, each
   * with how many hunters that week had. Null when it could not be read.
   * (Optional so a store written before it existed still satisfies the type.)
   */
  weeklyFinishes?(userId: string): Promise<WeeklyFinish[] | null>;
  /**
   * File names of every public picture an account is still using. Null when
   * the list could not be read IN FULL (it decides what may be deleted, so a
   * partial answer is never returned).
   */
  avatarFilesInUse(): Promise<Set<string> | null>;
  /** One page of the public pictures bucket, by name. Null when it could not be read. */
  listPublicAvatars(offset: number, limit: number): Promise<Array<{ name: string; createdAt: string | null }> | null>;
  /** Delete public pictures by file name. Returns how many were asked for, or null on failure. */
  removePublicAvatarFiles(names: string[]): Promise<number | null>;
}

export interface ClosedWeek { week_start: string; hunters: number }
export interface WeeklyFinish { week_start: string; position: number; hunters: number }

export const MAX_AVATAR_BYTES = 12 * 1024 * 1024;

/** The file name inside the public pictures bucket that a public link points at, or null. */
export function publicAvatarFileName(publicUrl: string): string | null {
  const marker = `/object/public/${PUBLIC_AVATAR_BUCKET}/`;
  const i = typeof publicUrl === "string" ? publicUrl.indexOf(marker) : -1;
  if (i === -1) return null;
  const name = publicUrl.slice(i + marker.length).split(/[?#]/)[0];
  if (!name || name.includes("/") || name.includes("..") || name.includes("\\")) return null;
  return name;
}
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
        const name = publicAvatarFileName(publicUrl);
        if (!name) return;
        await sb.storage.from(PUBLIC_AVATAR_BUCKET).remove([name]);
      } catch { /* left behind: the daily sweep removes pictures nothing uses (avatarSweep.ts) */ }
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
    async avatarFilesInUse() {
      // The exact number first, then every row: the two must agree, or the answer is not trusted.
      const head = await sb.from("leaderboard_identity").select("user_id", { count: "exact", head: true }).not("avatar_url", "is", null);
      if (head.error || typeof head.count !== "number") { warn("count pictures in use", head.error); return null; }
      const names = new Set<string>();
      let rows = 0;
      for (let from = 0; from < 2_000_000; from += 1000) {
        const { data, error } = await sb.from("leaderboard_identity").select("user_id,avatar_url")
          .not("avatar_url", "is", null).order("user_id", { ascending: true }).range(from, from + 999);
        if (error) { warn("list pictures in use", error); return null; }
        for (const r of data ?? []) {
          rows += 1;
          const name = publicAvatarFileName(String(r.avatar_url ?? ""));
          if (name) names.add(name);
        }
        if (!data || data.length < 1000) break;
      }
      return rows === head.count ? names : null;
    },
    async listPublicAvatars(offset, limit) {
      try {
        const { data, error } = await sb.storage.from(PUBLIC_AVATAR_BUCKET)
          .list("", { limit, offset, sortBy: { column: "name", order: "asc" } });
        if (error || !Array.isArray(data)) { if (error) warn("list public pictures", error); return null; }
        return data.filter((f: any) => f && typeof f.name === "string")
          .map((f: any) => ({ name: f.name as string, createdAt: typeof f.created_at === "string" ? f.created_at : null }));
      } catch (err) { warn("list public pictures", err); return null; }
    },
    async removePublicAvatarFiles(names) {
      if (names.length === 0) return 0;
      try {
        const { error } = await sb.storage.from(PUBLIC_AVATAR_BUCKET).remove(names);
        if (error) { warn("remove public pictures", error); return null; }
        return names.length;
      } catch (err) { warn("remove public pictures", err); return null; }
    },
    async closeFinishedWeeks() {
      const { data, error } = await sb.rpc("leaderboard_close_finished_weeks");
      if (error) { warn("freeze finished weeks", error); return null; }
      const d = Array.isArray(data) && data.length === 1 && Array.isArray(data[0]) ? data[0] : data;
      return Array.isArray(d) ? (d as ClosedWeek[]) : [];
    },
    async weeklyFinishes(userId) {
      // Two plain reads on tables only the server can see (phase 4). No new SQL.
      const mine = await sb.from("weekly_results").select("week_start,position")
        .eq("user_id", userId).lte("position", 10)
        .order("week_start", { ascending: false }).limit(120);
      if (mine.error) { warn("read weekly finishes", mine.error); return null; }
      const rows = (mine.data ?? []) as Array<{ week_start: string; position: number }>;
      if (rows.length === 0) return [];
      const weeks = await sb.from("weekly_results_weeks").select("week_start,hunters")
        .in("week_start", rows.map(r => r.week_start));
      if (weeks.error) { warn("read weekly finishes", weeks.error); return null; }
      const hunters = new Map<string, number>(
        ((weeks.data ?? []) as Array<{ week_start: string; hunters: number }>)
          .map(w => [String(w.week_start), Number(w.hunters) || 0]),
      );
      return rows.map(r => ({
        week_start: String(r.week_start),
        position:   Number(r.position),
        hunters:    hunters.get(String(r.week_start)) ?? 0,
      }));
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
/**
 * server/hunt/store.ts
 *
 * Every database read and write Hunt XP makes, behind one small interface, so
 * the scoring logic (completeHunt.ts) can be tested against an in-memory store.
 *
 * The real store uses the service-role client. The tables it touches
 * (hunt_scans, hunts, xp_ledger, the server columns of xp_profiles) cannot be
 * written by the app at all: see drizzle/sql/hunt_xp_phase1.sql.
 */
import type { EngineInputs } from "../../lib/huntEconomics";
import { getSupabaseAdmin } from "../supabaseAdmin.js";

export interface HuntScanRow {
  analysis_id:   string;
  user_id:       string;
  hunt_id:       string;
  attempt_id:    string;
  scanned_at:    string;
  photo_hash:    string | null;
  hash_b0:       number | null;
  hash_b1:       number | null;
  hash_b2:       number | null;
  hash_b3:       number | null;
  photo_count:   number;
  capture_front: "camera" | "library" | "unknown";
  capture_kind:  string | null;
  soft_fail:     boolean;
  confident_id:  boolean;
  brand:         string;
  category:      string;
  item_key:      string | null;
  resale:        number;
  xp_inputs:     EngineInputs;
  // Filled in when the Hunt is completed.
  kept?:           boolean | null;
  final_status?:   string | null;
  final_rating?:   string | null;
}

/** The clock and the profile, read together in one statement by Postgres. */
export interface XpContext {
  now:           string;         // server time
  weekStart:     string;         // Monday 00:00 America/Los_Angeles, as 'YYYY-MM-DD'
  prevWeekStart: string;
  profile: {
    totalXp:              number;
    completedHunts:       number;
    huntStreak:           number;      // days, for the streak achievements
    lastHuntDate:         string | null;
    weekStreak:           number;
    lastStreakWeek:       string | null;
    discoveredBrands:     string[];
    discoveredCategories: string[];
    version:              number;
  };
}

export interface AwardArgs {
  userId: string; huntId: string;
  expectedVersion: number; weekStart: string;
  xp: number; bestScore: number; qualifies: boolean;
  scanCount: number; keptCount: number;
  startedAt: string; endedAt: string; durationMs: number;
  rulesVersion: string;
  result: Record<string, unknown>;
  discoveredBrands: string[]; discoveredCategories: string[];
  weekStreak: number; lastStreakWeek: string | null;
  items: Array<{ id: string; kept: boolean; thriftPrice: number; status: string; rating: string; reasons: string[]; countedProfit: number }>;
  ranks: Array<{ xp: number; rank: string }>;
}

export interface AwardOutcome {
  status: "awarded" | "already" | "conflict";
  /** The stored result for this Hunt (the first award's, on "already"). */
  result?: Record<string, unknown>;
  profile?: ProfileSnapshot;
  totalBefore?: number;
  totalAfter?: number;
  foundingHunter?: boolean;
}

/** What the app mirrors on the phone after an award. */
export interface ProfileSnapshot {
  totalXp:              number;
  currentRank:          string;
  completedHunts:       number;
  huntStreak:           number;
  lastHuntDate:         string | null;
  weekStreak:           number;
  discoveredBrands:     string[];
  discoveredCategories: string[];
}

export interface HuntStore {
  insertScan(row: HuntScanRow): Promise<boolean>;
  /** Every scan the server recorded for this user's Hunt. */
  scansForHunt(userId: string, huntId: string): Promise<HuntScanRow[]>;
  /** Hashes of this user's scans that already counted in OTHER Hunts since `sinceIso`. */
  ownCountedHashes(userId: string, sinceIso: string, excludeHuntId: string): Promise<string[]>;
  /** (user, hash) of other accounts' scans sharing any 16-bit band with these hashes. */
  othersNearHashes(userId: string, hashes: string[]): Promise<Array<{ user_id: string; photo_hash: string }>>;
  /** Item keys this user already had counted as Legendary / Treasure in other Hunts since `sinceIso`. */
  priorValuedKeys(userId: string, sinceIso: string, excludeHuntId: string): Promise<string[]>;
  context(userId: string): Promise<XpContext | null>;
  existingHunt(userId: string, huntId: string): Promise<{ result: Record<string, unknown> } | null>;
  award(args: AwardArgs): Promise<AwardOutcome | null>;
  /** Does this account hold the Founding Hunter badge? false when it cannot be read. */
  isFoundingHunter?(userId: string): Promise<boolean>;
}

const arr = (v: unknown): string[] => Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
const int = (v: unknown): number => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? n : 0; };

/** One xp_profiles row (as JSON, whatever its column types) → the app's snapshot. */
export function snapshotFromRow(row: any): ProfileSnapshot {
  const r = row ?? {};
  return {
    totalXp:              int(r.total_xp),
    currentRank:          String(r.current_rank ?? ""),
    completedHunts:       int(r.completed_hunts),
    huntStreak:           int(r.hunt_streak),
    lastHuntDate:         r.last_hunt_day ? String(r.last_hunt_day).slice(0, 10)
                            : (r.last_hunt_date ? String(r.last_hunt_date).slice(0, 10) : null),
    weekStreak:           int(r.week_streak),
    discoveredBrands:     arr(r.discovered_brands),
    discoveredCategories: arr(r.discovered_categories),
  };
}

export function contextFromRpc(data: any): XpContext | null {
  if (!data || typeof data !== "object" || !data.week_start) return null;
  const p = data.profile ?? {};
  const snap = snapshotFromRow(p);
  return {
    now: String(data.now),
    weekStart: String(data.week_start).slice(0, 10),
    prevWeekStart: String(data.prev_week_start).slice(0, 10),
    profile: {
      totalXp: snap.totalXp, completedHunts: snap.completedHunts, huntStreak: snap.huntStreak,
      lastHuntDate: snap.lastHuntDate, weekStreak: snap.weekStreak,
      lastStreakWeek: p.last_streak_week ? String(p.last_streak_week).slice(0, 10) : null,
      discoveredBrands: snap.discoveredBrands, discoveredCategories: snap.discoveredCategories,
      version: int(p.xp_version),
    },
  };
}

const SCAN_COLUMNS =
  "analysis_id,user_id,hunt_id,attempt_id,scanned_at,photo_hash,hash_b0,hash_b1,hash_b2,hash_b3," +
  "photo_count,capture_front,capture_kind,soft_fail,confident_id,brand,category,item_key,resale,xp_inputs," +
  "kept,final_status,final_rating";

let warnedNoMatchFn = false;

function supabaseStore(sb: any): HuntStore {
  const warn = (what: string, error: any) => console.warn(`[hunt] ${what} failed:`, error?.message ?? error);
  return {
    async insertScan(row) {
      // Keyed on the analysis id: a retried request for the same scan keeps the first row.
      const { error } = await sb.from("hunt_scans").upsert(row, { onConflict: "analysis_id", ignoreDuplicates: true });
      if (error) { warn("insert scan", error); return false; }
      return true;
    },
    async scansForHunt(userId, huntId) {
      const { data, error } = await sb.from("hunt_scans").select(SCAN_COLUMNS)
        .eq("user_id", userId).eq("hunt_id", huntId).order("scanned_at", { ascending: true }).limit(500);
      if (error) { warn("read hunt scans", error); throw new Error("hunt_scans_read_failed"); }
      return (data ?? []) as HuntScanRow[];
    },
    async ownCountedHashes(userId, sinceIso, excludeHuntId) {
      const { data, error } = await sb.from("hunt_scans").select("photo_hash")
        .eq("user_id", userId).neq("hunt_id", excludeHuntId).gte("scanned_at", sinceIso)
        .not("photo_hash", "is", null).not("final_status", "is", null).neq("final_status", "excluded")
        // The newest 1,000: the most Supabase returns for one request.
        .order("scanned_at", { ascending: false }).limit(1000);
      if (error) { warn("read own hashes", error); throw new Error("hunt_scans_read_failed"); }
      return (data ?? []).map((r: any) => String(r.photo_hash));
    },
    async othersNearHashes(userId, hashes) {
      if (hashes.length === 0) return [];
      // The database compares the fingerprints itself and returns only real
      // matches (at most 3 accounts per photo), so the answer is complete however
      // many scans exist. See hunt_near_photo_matches in hunt_xp_phase1.sql.
      const viaRpc = await sb.rpc("hunt_near_photo_matches", { p_user_id: userId, p_hashes: Array.from(new Set(hashes)) });
      if (!viaRpc.error) {
        return ((viaRpc.data ?? []) as any[]).filter(r => r?.photo_hash && r?.user_id)
          .map(r => ({ user_id: String(r.user_id), photo_hash: String(r.photo_hash) }));
      }
      // The function is not there yet (the SQL file has not been run again): the
      // earlier lookup still works, but is only complete while few scans exist.
      if (!warnedNoMatchFn) {
        warnedNoMatchFn = true;
        console.warn("[hunt] hunt_near_photo_matches unavailable, using the table lookup (run hunt_xp_phase1.sql again):", viaRpc.error?.message);
      }
      const bands: number[][] = [[], [], [], []];
      for (const h of hashes) [0, 4, 8, 12].forEach((o, k) => bands[k].push(parseInt(h.slice(o, o + 4), 16)));
      const clause = bands.map((b, k) => `hash_b${k}.in.(${Array.from(new Set(b)).join(",")})`).join(",");
      const { data, error } = await sb.from("hunt_scans").select("user_id,photo_hash")
        .neq("user_id", userId).or(clause).limit(5000);
      if (error) { warn("read other accounts' hashes", error); throw new Error("hunt_scans_read_failed"); }
      return (data ?? []).filter((r: any) => r.photo_hash) as Array<{ user_id: string; photo_hash: string }>;
    },
    async priorValuedKeys(userId, sinceIso, excludeHuntId) {
      const { data, error } = await sb.from("hunt_scans").select("item_key")
        .eq("user_id", userId).neq("hunt_id", excludeHuntId).gte("scanned_at", sinceIso)
        .eq("kept", true).eq("final_status", "normal").in("final_rating", ["legendary", "treasure"])
        .not("item_key", "is", null).order("scanned_at", { ascending: false }).limit(1000);
      if (error) { warn("read prior finds", error); throw new Error("hunt_scans_read_failed"); }
      return Array.from(new Set((data ?? []).map((r: any) => String(r.item_key))));
    },
    async context(userId) {
      const { data, error } = await sb.rpc("hunt_xp_context", { p_user_id: userId });
      if (error) { warn("read xp context", error); return null; }
      return contextFromRpc(Array.isArray(data) ? data[0] : data);
    },
    async isFoundingHunter(userId) {
      const { data, error } = await sb.from("founding_hunters").select("user_id").eq("user_id", userId).maybeSingle();
      if (error) { warn("read founding hunter", error); return false; }
      return Boolean(data);
    },
    async existingHunt(userId, huntId) {
      const { data, error } = await sb.from("hunts").select("result")
        .eq("user_id", userId).eq("hunt_id", huntId).maybeSingle();
      if (error) { warn("read hunt", error); throw new Error("hunts_read_failed"); }
      return data ? { result: (data.result ?? {}) as Record<string, unknown> } : null;
    },
    async award(a) {
      const { data, error } = await sb.rpc("award_hunt_xp", {
        p_user_id: a.userId, p_hunt_id: a.huntId,
        p_expected_version: a.expectedVersion, p_week_start: a.weekStart,
        p_xp: a.xp, p_best_score: a.bestScore, p_qualifies: a.qualifies,
        p_scan_count: a.scanCount, p_kept_count: a.keptCount,
        p_started_at: a.startedAt, p_ended_at: a.endedAt, p_duration_ms: a.durationMs,
        p_rules_version: a.rulesVersion, p_result: a.result,
        p_discovered_brands: a.discoveredBrands, p_discovered_categories: a.discoveredCategories,
        p_week_streak: a.weekStreak, p_last_streak_week: a.lastStreakWeek,
        p_items: a.items, p_ranks: a.ranks,
      });
      if (error) { warn("award", error); return null; }
      const d = Array.isArray(data) ? data[0] : data;
      if (!d || typeof d !== "object") return null;
      return {
        status: d.status,
        result: d.result ?? undefined,
        profile: d.profile ? snapshotFromRow(d.profile) : undefined,
        totalBefore: d.total_before != null ? int(d.total_before) : undefined,
        totalAfter: d.total_after != null ? int(d.total_after) : undefined,
        foundingHunter: d.founding === true,
      };
    },
  };
}

let override: HuntStore | null | undefined;
/** Tests only: replace the store (null = "not configured"), or undefined to restore. */
export function __setHuntStoreForTests(s: HuntStore | null | undefined): void { override = s; }

export function getHuntStore(): HuntStore | null {
  if (override !== undefined) return override;
  const sb = getSupabaseAdmin();
  return sb ? supabaseStore(sb) : null;
}
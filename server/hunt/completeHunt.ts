/**
 * server/hunt/completeHunt.ts
 *
 * Finishing a Hunt. The ONLY place Hunt XP is awarded.
 *
 * The app sends { huntId, items: [{ analysisId, kept, thriftPrice }] }. Nothing
 * else it could send is read. The server then:
 *
 *   1. keeps only scans IT recorded for this user and this Hunt (hunt_scans)
 *   2. decides each scan's status from its own evidence
 *        excluded  the same photo again (this Hunt, or the last 90 days)
 *        reduced   library photo, flagged as a screen / listing image, the same
 *                  image seen from 2+ other accounts, or a result FlipStart
 *                  could not stand behind
 *   3. measures the Hunt's length from its own clock
 *   4. scores it with the shared engine (shared/hunt/xpRules.ts)
 *   5. awards it in ONE database transaction, exactly once per Hunt
 *
 * A second call for the same Hunt returns the first result and awards nothing.
 */
import { economicsFromInputs } from "../../lib/huntEconomics";
import {
  calculateHuntXp, XP_RULES_VERSION, type XpItem, type ScanStatus, type XpBreakdownItem,
} from "../../shared/hunt/xpRules";
import { RANK_LADDER, getCurrentRank } from "../../shared/hunt/ranks";
import { getAnalysis } from "../analysisStore.js";
import { toLegacyShape } from "../compat/toLegacyShape.js";
import { hamming } from "./photoHash.js";
import { buildHuntScanRow, isScreenFlag, normalizeCaptureKind, settleRecordings, validHuntId } from "./scanEvidence.js";
import { getHuntStore, type HuntScanRow, type HuntStore, type ProfileSnapshot } from "./store.js";

/** Two hashes this close are the same image. */
export const SAME_IMAGE_BITS = 6;
/** The same image from this many OTHER accounts is a shared (web) image. */
export const SHARED_IMAGE_ACCOUNTS = 2;
export const OWN_DUPLICATE_DAYS = 90;
export const REPEAT_ITEM_DAYS = 30;
/** After the last scan, this much more time still counts as the Hunt. */
export const HUNT_TAIL_MS = 15 * 60_000;
export const MAX_ITEMS = 300;
const DAY = 86_400_000;

export interface CompleteHuntItem { analysisId: string; kept: boolean; thriftPrice: number }
export interface CompleteHuntInput { userId: string; huntId: string; items: CompleteHuntItem[]; now?: Date }

export interface CompleteHuntResult {
  /**
   * awarded  XP was awarded now
   * already  this Hunt was awarded before; the same result again, nothing added
   * empty    the server has no scans for this Hunt: no XP, nothing recorded
   */
  status:          "awarded" | "already" | "empty";
  xpEarned:        number;
  breakdown:       XpBreakdownItem[];
  previousTotalXp: number;
  newTotalXp:      number;
  qualifies:       boolean;
  bestHuntScore:   number;
  cappedBigFinds:  number;
  foundingHunter:  boolean;
  profile:         ProfileSnapshot | null;
}

export class HuntCompletionError extends Error {
  constructor(public code: "not_configured" | "bad_request" | "unavailable" | "busy") { super(code); }
}

// One completion at a time per account in this process. The database function
// still guards against two processes (xp_version), this only avoids wasted work.
const chains = new Map<string, Promise<unknown>>();
function serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  chains.set(key, next);
  void next.catch(() => undefined).finally(() => { if (chains.get(key) === next) chains.delete(key); });
  return next;
}

export function sanitizeItems(raw: unknown): CompleteHuntItem[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: CompleteHuntItem[] = [];
  for (const r of raw.slice(0, MAX_ITEMS)) {
    const id = typeof r?.analysisId === "string" ? r.analysisId.trim() : "";
    if (!id || id.length > 80 || seen.has(id)) continue;
    seen.add(id);
    const price = Number(r?.thriftPrice);
    out.push({
      analysisId: id,
      kept: r?.kept === true,
      thriftPrice: Number.isFinite(price) && price > 0 ? Math.min(price, 100_000) : 0,
    });
  }
  return out;
}

/**
 * A listed scan with no row: the insert at scan time failed. Rebuild it from the
 * server's own stored analysis, and only when ALL of these hold:
 *
 *   - the server verified this account as the owner when the scan ran
 *   - the server marked the analysis, at scan time, as a Hunt scan for THIS Hunt
 *
 * The second is what stops an ordinary scan (any photo, any day, never checked
 * as a Hunt scan) being listed in a made-up Hunt and paid as one. The rebuilt
 * row keeps what the server recorded about how the photo was taken. It has no
 * photo fingerprint, so it can never pass the big-find gate.
 */
async function recoverRow(store: HuntStore, userId: string, huntId: string, analysisId: string): Promise<HuntScanRow | null> {
  try {
    const stored = getAnalysis(analysisId, userId);
    if (!stored || stored.verifiedOwnerId !== userId) return null;
    const mark = stored.hunt;
    if (!mark || mark.huntId !== huntId) return null;
    const payload = { ...toLegacyShape(stored.canonical), canonical: stored.canonical };
    const row = await buildHuntScanRow({
      userId, huntId, attemptId: stored.scanAttemptId || analysisId, analysisId,
      canonical: stored.canonical, payload, frontBase64: null,
      photoCount: mark.photoCount,
      captureFront: mark.captureFront === "camera" || mark.captureFront === "library" ? mark.captureFront : "unknown",
    });
    row.scanned_at = new Date(stored.savedAt).toISOString();
    await store.insertScan(row).catch(() => false);
    console.warn(`[hunt] recovered a scan with no evidence row, analysis=${analysisId}`);
    return row;
  } catch { return null; }
}

interface Decided { row: HuntScanRow; item: CompleteHuntItem; status: ScanStatus; reasons: string[]; unique: boolean }

/** A scan's time as a number, whatever the database handed back (ISO text with any offset, or a Date). */
const at = (r: HuntScanRow): number => {
  const ms = new Date(r.scanned_at as unknown as string | Date).getTime();
  return Number.isFinite(ms) ? ms : 0;
};

/**
 * Status for each decided scan. Pure given its inputs. Exported for tests.
 *
 * Among copies of the same photo exactly ONE counts: a kept one before a passed
 * one, the earlier before the later. A photo already counted in another Hunt
 * always wins over this one.
 */
export function decideStatuses(
  decided: Array<{ row: HuntScanRow; item: CompleteHuntItem }>,
  ownCountedHashes: string[],
  others: Array<{ user_id: string; photo_hash: string }>,
): Decided[] {
  const out: Decided[] = decided.map(d => ({ ...d, status: "normal" as ScanStatus, reasons: [], unique: true }));
  const near = (a: string | null, b: string | null) => hamming(a, b) <= SAME_IMAGE_BITS;

  const order = [...out].sort((a, b) =>
    (Number(b.item.kept) - Number(a.item.kept)) || (at(a.row) - at(b.row)));
  const accepted: string[] = [];
  for (const d of order) {
    const h = d.row.photo_hash;
    if (!h) { d.unique = false; d.reasons.push("no_photo_hash"); continue; }   // could not check
    if (ownCountedHashes.some(p => near(p, h)) || accepted.some(p => near(p, h))) {
      d.status = "excluded"; d.unique = false; d.reasons.push("duplicate_photo");
      continue;
    }
    accepted.push(h);
  }

  for (const d of out) {
    if (d.status === "excluded") continue;
    const h = d.row.photo_hash;
    if (h) {
      const accounts = new Set(others.filter(o => near(o.photo_hash, h)).map(o => o.user_id));
      if (accounts.size >= SHARED_IMAGE_ACCOUNTS) { d.unique = false; d.reasons.push("shared_image"); }
    }
    // What the app said. It is a claim, not a proof: a changed app could say
    // "camera" for anything, so this only ever counts together with the checks
    // the server makes itself (the fingerprint, the screen flag, the review list).
    // No stated source at all is left as an ordinary scan; it just can never
    // count as "taken with the in-app camera" for a big find.
    if (d.row.capture_front === "library") d.reasons.push("library_photo");
    if (isScreenFlag(normalizeCaptureKind(d.row.capture_kind))) d.reasons.push("screen_flag");
    if (d.row.soft_fail) d.reasons.push("soft_fail");
    if (d.reasons.some(r => r === "shared_image" || r === "library_photo" || r === "screen_flag" || r === "soft_fail")) {
      d.status = "reduced";
    }
  }
  return out;
}

function toXpItem(d: Decided): XpItem {
  const r = d.row;
  return {
    id: r.analysis_id,
    kept: d.item.kept,
    thriftPrice: d.item.thriftPrice,
    status: d.status,
    reasons: d.reasons,
    evidence: {
      camera:      r.capture_front === "camera",
      secondPhoto: r.photo_count >= 2,
      uniqueImage: d.unique,
      notScreen:   !isScreenFlag(normalizeCaptureKind(r.capture_kind)),
      confidentId: r.confident_id === true,
    },
    resale: Number(r.resale) || 0,
    brand: r.brand ?? "",
    category: r.category ?? "",
    itemKey: r.item_key ?? null,
    economics: price => {
      const e = economicsFromInputs(r.xp_inputs, price);
      return { profit: e.profit, roi: e.roi, rating: e.huntRating };
    },
  };
}

function resultFromStored(stored: Record<string, unknown>, profile: ProfileSnapshot | null, status: "awarded" | "already"): CompleteHuntResult {
  const s = stored as any;
  return {
    status,
    xpEarned:        Number(s.xpEarned) || 0,
    breakdown:       Array.isArray(s.breakdown) ? s.breakdown : [],
    previousTotalXp: Number(s.previousTotalXp) || 0,
    newTotalXp:      Number(s.newTotalXp) || 0,
    qualifies:       s.qualifies === true,
    bestHuntScore:   Number(s.bestHuntScore) || 0,
    cappedBigFinds:  Number(s.cappedBigFinds) || 0,
    foundingHunter:  s.foundingHunter === true,
    profile,
  };
}

export async function completeHunt(input: CompleteHuntInput): Promise<CompleteHuntResult> {
  if (!input.userId || !validHuntId(input.huntId)) throw new HuntCompletionError("bad_request");
  const store = getHuntStore();
  if (!store) throw new HuntCompletionError("not_configured");
  return serial(input.userId, () => run(store, input));
}

async function run(store: HuntStore, input: CompleteHuntInput): Promise<CompleteHuntResult> {
  const { userId, huntId } = input;
  const items = sanitizeItems(input.items);

  try {
    // ── Already awarded? The first result stands. ──────────────────────────────
    const existing = await store.existingHunt(userId, huntId);
    if (existing) {
      const ctx = await store.context(userId);
      const p = ctx?.profile;
      return resultFromStored(existing.result, p ? {
        totalXp: p.totalXp, currentRank: getCurrentRank(p.totalXp).rank, completedHunts: p.completedHunts,
        huntStreak: p.huntStreak, lastHuntDate: p.lastHuntDate, weekStreak: p.weekStreak,
        discoveredBrands: p.discoveredBrands, discoveredCategories: p.discoveredCategories,
      } : null, "already");
    }

    // ── Only scans the server recorded for THIS user and THIS Hunt ─────────────
    // A scan made a moment ago may still be on its way into the database.
    await settleRecordings(items.map(i => i.analysisId));
    const rows = await store.scansForHunt(userId, huntId);
    const byId = new Map(rows.map(r => [r.analysis_id, r]));
    const decided: Array<{ row: HuntScanRow; item: CompleteHuntItem }> = [];
    for (const item of items) {
      let row = byId.get(item.analysisId) ?? null;
      if (!row) {
        row = await recoverRow(store, userId, huntId, item.analysisId);
        if (row) { byId.set(row.analysis_id, row); rows.push(row); }
      }
      if (row && row.user_id === userId && row.hunt_id === huntId) decided.push({ row, item });
    }

    if (decided.length === 0) {
      console.warn(`[hunt] complete: no recorded scans for hunt=${huntId.slice(0, 24)} (${items.length} listed)`);
      return {
        status: "empty", xpEarned: 0, breakdown: [], previousTotalXp: 0, newTotalXp: 0,
        qualifies: false, bestHuntScore: 0, cappedBigFinds: 0, foundingHunter: false, profile: null,
      };
    }

    const nowMs = (input.now ?? new Date()).getTime();
    const hashes = decided.map(d => d.row.photo_hash).filter((h): h is string => !!h);
    const [ownHashes, others, priorKeys] = await Promise.all([
      store.ownCountedHashes(userId, new Date(nowMs - OWN_DUPLICATE_DAYS * DAY).toISOString(), huntId),
      store.othersNearHashes(userId, hashes),
      store.priorValuedKeys(userId, new Date(nowMs - REPEAT_ITEM_DAYS * DAY).toISOString(), huntId),
    ]);
    const statuses = decideStatuses(decided, ownHashes, others)
      .sort((a, b) => at(a.row) - at(b.row));

    // ── Length of the Hunt, from the server's own timestamps ───────────────────
    const times = rows.map(at).filter(ms => ms > 0);
    const first = Math.min(...times);
    const last  = Math.max(...times);
    const ended = Math.max(first, Math.min(nowMs, last + HUNT_TAIL_MS));
    const durationMs = ended - first;

    // ── Score and award. Retried if the profile moved underneath us. ───────────
    for (let attempt = 0; attempt < 3; attempt++) {
      const ctx = await store.context(userId);
      if (!ctx) throw new HuntCompletionError("unavailable");

      const xp = calculateHuntXp({
        items: statuses.map(toXpItem),
        durationMs,
        weekStart: ctx.weekStart,
        prevWeekStart: ctx.prevWeekStart,
        profile: {
          discoveredBrands: ctx.profile.discoveredBrands,
          discoveredCategories: ctx.profile.discoveredCategories,
          weekStreak: ctx.profile.weekStreak,
          lastStreakWeek: ctx.profile.lastStreakWeek,
        },
        priorValuedItemKeys: priorKeys,
      });

      const previousTotalXp = ctx.profile.totalXp;
      const newTotalXp = previousTotalXp + xp.earned;
      const stored = {
        xpEarned: xp.earned, breakdown: xp.breakdown, previousTotalXp, newTotalXp,
        qualifies: xp.qualifies, bestHuntScore: xp.bestHuntScore, cappedBigFinds: xp.cappedBigFinds,
        eligibleScans: xp.eligibleScans, keptCount: xp.keptCount,
        xpProfit: Math.round(xp.xpProfit), grade: xp.grade, weekStreak: xp.weekStreak,
      };

      const outcome = await store.award({
        userId, huntId,
        expectedVersion: ctx.profile.version, weekStart: ctx.weekStart,
        xp: xp.earned, bestScore: xp.bestHuntScore, qualifies: xp.qualifies,
        scanCount: xp.eligibleScans, keptCount: xp.keptCount,
        startedAt: new Date(first).toISOString(), endedAt: new Date(ended).toISOString(), durationMs,
        rulesVersion: XP_RULES_VERSION,
        result: stored,
        discoveredBrands: [...ctx.profile.discoveredBrands, ...xp.newBrands],
        discoveredCategories: [...ctx.profile.discoveredCategories, ...xp.newCategories],
        weekStreak: xp.weekStreak, lastStreakWeek: xp.lastStreakWeek,
        items: xp.items.map(i => ({
          id: i.id, kept: i.kept, thriftPrice: statuses.find(s => s.row.analysis_id === i.id)?.item.thriftPrice ?? 0,
          status: i.status, rating: i.rating, reasons: i.reasons, countedProfit: Math.round(i.countedProfit * 100) / 100,
        })),
        ranks: RANK_LADDER,
      });
      if (!outcome) throw new HuntCompletionError("unavailable");
      if (outcome.status === "conflict") continue;

      if (outcome.status === "already") {
        return resultFromStored(outcome.result ?? stored, outcome.profile ?? null, "already");
      }
      const before = outcome.totalBefore ?? previousTotalXp;
      const after  = outcome.totalAfter ?? newTotalXp;
      console.log(`[hunt] awarded hunt=${huntId.slice(0, 24)} xp=${xp.earned} scans=${xp.eligibleScans}` +
        ` kept=${xp.keptCount} qualifies=${xp.qualifies} capped=${xp.cappedBigFinds}` +
        ` reduced=${xp.items.filter(i => i.status === "reduced").length}` +
        ` excluded=${xp.items.filter(i => i.status === "excluded").length}`);
      return {
        ...resultFromStored({ ...stored, previousTotalXp: before, newTotalXp: after }, outcome.profile ?? null, "awarded"),
        foundingHunter: outcome.foundingHunter === true,
      };
    }
    throw new HuntCompletionError("busy");
  } catch (err) {
    if (err instanceof HuntCompletionError) throw err;
    console.error("[hunt] complete failed:", err instanceof Error ? err.message : err);
    throw new HuntCompletionError("unavailable");
  }
}
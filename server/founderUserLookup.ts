/**
 * server/founderUserLookup.ts
 *
 * The parts of the User Explorer that answer "what happened with this one
 * person?" — including "why did they refund?". Loaded only when one user is
 * selected, so the cost is a handful of single-user queries.
 *
 *   store      — RevenueCat's record: every purchase, when Apple saw
 *                auto-renew turned off, billing problems, and refunds.
 *   outcomes   — every scan the SERVER saw for this user (scan_outcomes):
 *                ok / soft fail / hard fail, why, confidence, charged or not.
 *   saved      — the items they saved (scans table): what the app told them.
 *   xp         — their Hunt XP row (xp_profiles).
 *
 * Each part fails on its own and says why; a failure is never shown as
 * "nothing here".
 *
 * ── RevenueCat, carefully ───────────────────────────────────────────────────
 * V1 `GET /subscribers/{id}` is GET-OR-CREATE: asking about someone RevenueCat
 * has never seen creates an empty customer for them. So the store is only
 * asked about users with some sign of a purchase (a plan, a product, a pack
 * balance, or a purchase/restore event). Apple never tells developers WHY
 * someone refunded — the store record gives the when; the scans and timeline
 * are the why.
 */
import { getSupabaseAdmin } from "./supabaseAdmin";
import { fetchSubscriber } from "./monetization/revenuecatServer";
import { isV2Configured, listCustomerPurchases, resolveStoreIdentifier } from "./monetization/revenuecatV2";
import { HUNT_RANKS, rankIndexFor } from "./founderHuntJourney";

export const LOOKUP_ROW_LIMIT = 300;

type Part<T> = { ok: true; data: T } | { ok: false; reason: string };

// ── Store (RevenueCat) ──────────────────────────────────────────────────────

/** V1 subscriber fields this view reads. `refunded_at` and `ownership_type` are V1 fields the billing code doesn't need, so they're typed here. */
interface V1Sub {
  expires_date?: string | null; purchase_date?: string | null; original_purchase_date?: string | null;
  period_type?: string | null; unsubscribe_detected_at?: string | null; billing_issues_detected_at?: string | null;
  refunded_at?: string | null; store?: string | null; is_sandbox?: boolean | null; ownership_type?: string | null;
}
interface V1NonSub { id?: string; purchase_date?: string | null; store?: string | null; is_sandbox?: boolean | null }

export interface StoreSubscription {
  product: string; store: string | null; sandbox: boolean; periodType: string | null;
  firstPurchased: string | null; latestPurchased: string | null; expires: string | null;
  autoRenewOffAt: string | null; billingIssueAt: string | null; refundedAt: string | null;
  familyShared: boolean;
}
export interface StorePurchase {
  product: string; purchased: string | null; store: string | null; sandbox: boolean;
  /** From RevenueCat V2 when configured — e.g. "owned" or "refunded". */
  status: string | null;
}
export interface StoreRecord {
  subscriptions: StoreSubscription[];
  purchases: StorePurchase[];
  refunded: boolean;
  firstRefundAt: string | null;
  /** Why some of the record may be missing. */
  notes: string[];
}

export function summarizeSubscriber(sub: { subscriptions?: Record<string, V1Sub>; non_subscriptions?: Record<string, V1NonSub[]> } | null): StoreRecord {
  const subscriptions: StoreSubscription[] = Object.entries(sub?.subscriptions ?? {}).map(([product, s]) => ({
    product, store: s.store ?? null, sandbox: !!s.is_sandbox, periodType: s.period_type ?? null,
    firstPurchased: s.original_purchase_date ?? s.purchase_date ?? null, latestPurchased: s.purchase_date ?? null,
    expires: s.expires_date ?? null, autoRenewOffAt: s.unsubscribe_detected_at ?? null,
    billingIssueAt: s.billing_issues_detected_at ?? null, refundedAt: s.refunded_at ?? null,
    familyShared: s.ownership_type === "FAMILY_SHARED",
  })).sort((a, b) => (a.firstPurchased ?? "").localeCompare(b.firstPurchased ?? ""));
  const purchases: StorePurchase[] = Object.entries(sub?.non_subscriptions ?? {}).flatMap(([product, list]) =>
    (Array.isArray(list) ? list : []).map(p => ({
      product, purchased: p.purchase_date ?? null, store: p.store ?? null, sandbox: !!p.is_sandbox, status: null,
    }))).sort((a, b) => (a.purchased ?? "").localeCompare(b.purchased ?? ""));
  const refunds = subscriptions.map(s => s.refundedAt).filter((x): x is string => !!x).sort();
  return { subscriptions, purchases, refunded: refunds.length > 0, firstRefundAt: refunds[0] ?? null, notes: [] };
}

/** V2 lists one-time purchases with a status; use it to mark refunded packs. Best effort. */
async function addPackStatuses(uid: string, rec: StoreRecord): Promise<void> {
  if (!rec.purchases.length) return;
  if (!isV2Configured()) { rec.notes.push("Scan-pack refund status needs the RevenueCat V2 key, which isn't configured."); return; }
  const r = await listCustomerPurchases(uid);
  if (!r.ok) { rec.notes.push(`Scan-pack refund status unavailable (RevenueCat V2: ${r.reason}).`); return; }
  const v2 = await Promise.all(r.data.map(async p => ({
    sku: p.product_id ? (await resolveStoreIdentifier(p.product_id).catch(() => null)) ?? p.product_id : null,
    at: typeof p.purchased_at === "number" ? new Date(p.purchased_at).toISOString() : (p.purchased_at ?? null),
    status: p.status ?? null,
  })));
  const used = new Set<number>();
  for (const p of rec.purchases) {
    // Same product, bought within a minute — the V1 and V2 views of one purchase.
    const i = v2.findIndex((x, k) => !used.has(k) && x.sku === p.product && !!x.at && !!p.purchased
      && Math.abs(Date.parse(x.at) - Date.parse(p.purchased)) < 60_000);
    if (i >= 0) { used.add(i); p.status = v2[i].status; }
  }
  if (rec.purchases.some(p => p.status && /refund/i.test(p.status))) rec.refunded = true;
}

// ── Loading ─────────────────────────────────────────────────────────────────

export interface OutcomeLite {
  created_at: string; kind: string; reason: string | null; failure_group: string | null;
  confidence_tier: string | null; match_confidence: number | null; scan_issue: string | null;
  photo_problems: string[] | null; photo_count: number | null; charge: string | null;
  resolution: string | null; duration_ms: number | null;
}
export interface SavedLite {
  created_at: string; item_name: string | null; brand: string | null; category: string | null;
  thrift_price: number | null; profit: number | null; status: string | null; sold_price: number | null;
  resale: number | string | null; low: number | string | null; high: number | string | null;
  confidence: number | string | null; label: string | null;
}
export interface XpLite { xp: number; rank: string; rankNumber: number; hunts: number; streak: number; lastHunt: string | null }

export type StorePart = { ok: true; data: StoreRecord } | { ok: false; reason: string; skipped?: true };
export interface UserExtras {
  store: StorePart;
  outcomes: Part<OutcomeLite[]>;
  saved: Part<SavedLite[]>;
  xp: Part<XpLite | null>;
}

const missingTable = (msg: string) => /does not exist|could not find|schema cache|42P01|PGRST205/i.test(msg);

async function readRows<T>(table: string, cols: string, uid: string, order = true): Promise<Part<T[]>> {
  const sb = getSupabaseAdmin();
  if (!sb) return { ok: false, reason: "Supabase isn't configured on the server." };
  try {
    let q: any = sb.from(table).select(cols).eq("user_id", uid);
    if (order) q = q.order("created_at", { ascending: true });
    const { data, error } = await q.limit(LOOKUP_ROW_LIMIT);
    if (error) return { ok: false, reason: missingTable(error.message) ? `The ${table} table doesn't exist.` : `${table}: ${error.message.slice(0, 160)}` };
    return { ok: true, data: (data ?? []) as T[] };
  } catch (e: any) {
    return { ok: false, reason: `${table}: ${String(e?.message ?? e).slice(0, 160)}` };
  }
}

const n0 = (v: unknown) => { const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN; return Number.isFinite(n) && n > 0 ? n : 0; };

export async function loadUserExtras(uid: string, hasPurchaseSigns: boolean): Promise<UserExtras> {
  const store = (async (): Promise<StorePart> => {
    if (!hasPurchaseSigns) return { ok: false, skipped: true, reason: "No sign of a purchase, so RevenueCat wasn't asked (asking creates an empty customer record)." };
    const sub = await fetchSubscriber(uid);
    if (sub === undefined) return { ok: false, reason: "RevenueCat didn't answer, or REVENUECAT_API_KEY isn't set." };
    const rec = summarizeSubscriber(sub as any);
    await addPackStatuses(uid, rec).catch(e => { rec.notes.push(`Scan-pack status check failed: ${String(e?.message ?? e).slice(0, 120)}`); });
    return { ok: true, data: rec };
  })();
  const [s, outcomes, saved, xpRows] = await Promise.all([
    store,
    readRows<OutcomeLite>("scan_outcomes",
      "created_at, kind, reason, failure_group, confidence_tier, match_confidence, scan_issue, photo_problems, photo_count, charge, resolution, duration_ms", uid),
    readRows<SavedLite>("scans",
      "created_at, item_name, brand, category, thrift_price, profit, status, sold_price, resale:raw_result->>resaleValue, low:raw_result->>resaleRangeLow, high:raw_result->>resaleRangeHigh, confidence:raw_result->>matchConfidence, label:raw_result->>buyLabel", uid),
    readRows<any>("xp_profiles", "total_xp, completed_hunts, hunt_streak, last_hunt_date", uid, false),
  ]);
  const xp: Part<XpLite | null> = !xpRows.ok ? xpRows : {
    ok: true,
    data: xpRows.data.length ? (() => {
      const r = xpRows.data[0], total = n0(r.total_xp), i = rankIndexFor(total);
      return { xp: total, rank: HUNT_RANKS[i].rank, rankNumber: i + 1, hunts: n0(r.completed_hunts), streak: n0(r.hunt_streak), lastHunt: r.last_hunt_date ?? null };
    })() : null,
  };
  return { store: s, outcomes, saved, xp };
}

// ── Pure: summaries and timeline rows ───────────────────────────────────────

export function summarizeOutcomes(rows: OutcomeLite[]) {
  const by = (k: string) => rows.filter(r => r.kind === k).length;
  const tiers: Record<string, number> = { high: 0, medium: 0, low: 0 };
  for (const r of rows) if (r.kind === "ok" && r.confidence_tier && r.confidence_tier in tiers) tiers[r.confidence_tier]++;
  const reasons = new Map<string, number>();
  for (const r of rows) if (r.kind !== "ok" && r.reason) reasons.set(r.reason, (reasons.get(r.reason) ?? 0) + 1);
  return {
    total: rows.length, ok: by("ok"), soft: by("soft"), hard: by("hard"),
    charged: rows.filter(r => r.charge === "charged").length,
    tiers,
    topReasons: [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([reason, n]) => ({ reason, n })),
  };
}

export interface StoreTimelineRow { at: string; event: string; detail: string }

/** RevenueCat's dates as timeline rows, so purchase → scans → auto-renew off → refund reads in order. */
export function storeTimeline(rec: StoreRecord, now: Date): StoreTimelineRow[] {
  const rows: StoreTimelineRow[] = [];
  const tag = (s: { sandbox: boolean; store: string | null }) => [s.store, s.sandbox ? "sandbox" : null].filter(Boolean).join(" · ");
  for (const s of rec.subscriptions) {
    const d = (x: string) => [s.product, x, tag(s)].filter(Boolean).join(" · ");
    if (s.firstPurchased) rows.push({ at: s.firstPurchased, event: "store_subscribed", detail: d(s.periodType ? `period ${s.periodType.toLowerCase()}` : "") });
    if (s.latestPurchased && s.latestPurchased !== s.firstPurchased) rows.push({ at: s.latestPurchased, event: "store_renewed", detail: d("latest period") });
    if (s.autoRenewOffAt) rows.push({ at: s.autoRenewOffAt, event: "store_auto_renew_off", detail: d("Apple saw auto-renew turned off") });
    if (s.billingIssueAt) rows.push({ at: s.billingIssueAt, event: "store_billing_issue", detail: d("") });
    if (s.refundedAt) rows.push({ at: s.refundedAt, event: "store_refunded", detail: d("Apple refunded this subscription") });
    if (s.expires && Date.parse(s.expires) <= now.getTime()) rows.push({ at: s.expires, event: "store_expired", detail: d("") });
  }
  for (const p of rec.purchases) {
    if (p.purchased) rows.push({ at: p.purchased, event: "store_pack_bought", detail: [p.product, p.status ? `status ${p.status}` : null, tag(p)].filter(Boolean).join(" · ") });
  }
  return rows;
}

// ── At a glance ─────────────────────────────────────────────────────────────

interface EvLite { event_name: string; created_at: string; metadata?: Record<string, unknown> | null }
const ms = (iso: string | null | undefined) => iso ? Date.parse(iso) : NaN;
const hoursBetween = (a: string | null | undefined, b: string | null | undefined) => {
  const x = ms(a), y = ms(b);
  return Number.isFinite(x) && Number.isFinite(y) ? (y - x) / 3_600_000 : null;
};
const mstr = (e: EvLite, k: string) => { const v = e.metadata?.[k]; return typeof v === "string" ? v : null; };
const mnum = (e: EvLite, k: string) => { const v = e.metadata?.[k]; return typeof v === "number" && Number.isFinite(v) ? v : null; };

/**
 * The dashboard's per-user facts in one place, from every event this person
 * wrote — signed in, plus signed-out activity attributed by device. Refund
 * facts come from the store record when it loaded.
 */
export function buildGlance(all: EvLite[], accountCreated: string | null, refundAt: string | null) {
  const evs = [...all].sort((a, b) => a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0);
  const of = (name: string) => evs.filter(e => e.event_name === name);
  const first = (name: string) => evs.find(e => e.event_name === name) ?? null;
  const before = (name: string, at: string | null) => at ? evs.filter(e => e.event_name === name && e.created_at < at).length : null;
  const between = (name: string, a: string | null, b: string | null) =>
    a ? evs.filter(e => e.event_name === name && e.created_at >= a && (!b || e.created_at < b)).length : null;

  const firstSeen = evs[0]?.created_at ?? null;
  const steps = of("onboarding_step_viewed");
  let maxStep: number | null = null, totalSteps: number | null = null;
  for (const e of steps) { const s = mnum(e, "step_number"); if (s !== null && (maxStep === null || s > maxStep)) maxStep = s; totalSteps = mnum(e, "total_steps") ?? totalSteps; }
  const done = first("onboarding_completed");
  const tapped = evs.find(e => e.event_name === "onboarding_create_account_tapped" || e.event_name === "onboarding_login_tapped") ?? null;

  const scans = of("scan_completed");
  const firstScan = scans[0]?.created_at ?? null;
  const pw = of("paywall_opened");
  const firstPw = pw[0] ?? null;
  const bySource = new Map<string, number>();
  for (const e of pw) { const s = mstr(e, "paywall_source") ?? "unknown"; bySource.set(s, (bySource.get(s) ?? 0) + 1); }

  const sub = first("paywall_purchase_completed");
  const pack = first("scan_pack_purchase_completed");
  const paidAt = [sub?.created_at, pack?.created_at].filter((x): x is string => !!x).sort()[0] ?? null;
  const lastSeen = evs.at(-1)?.created_at ?? null;

  return {
    firstSeen, accountCreated, lastSeen,
    onboarding: {
      started: !!first("onboarding_started"), quiz: !!first("onboarding_quiz_completed"),
      tapped: tapped ? (tapped.event_name === "onboarding_login_tapped" ? "log in" : "create account") : null,
      completed: done ? (mstr(done, "outcome") ?? "done") : null, completedAt: done?.created_at ?? null,
      maxStep, totalSteps,
    },
    scans: {
      total: scans.length, failed: of("scan_failed").length, firstAt: firstScan,
      hoursToFirst: hoursBetween(accountCreated ?? firstSeen, firstScan),
    },
    paywall: {
      first: firstPw ? { source: mstr(firstPw, "paywall_source") ?? "unknown", at: firstPw.created_at, scansBefore: before("scan_completed", firstPw.created_at) ?? 0 } : null,
      views: pw.length,
      bySource: [...bySource.entries()].sort((a, b) => b[1] - a[1]).map(([source, n]) => ({ source, n })),
      planSelections: of("paywall_plan_selected").length, purchaseStarts: of("paywall_purchase_started").length,
      cancelled: of("paywall_purchase_cancelled").length,
    },
    purchase: paidAt ? {
      at: paidAt,
      kind: sub && sub.created_at === paidAt ? (mstr(sub, "selected_plan") ?? "subscription") : "scan pack",
      source: sub && sub.created_at === paidAt ? mstr(sub, "paywall_source") : pack ? mstr(pack, "paywall_source") : null,
      scansBefore: before("scan_completed", paidAt) ?? 0, paywallsBefore: before("paywall_opened", paidAt) ?? 0,
      hoursFromSignup: hoursBetween(accountCreated ?? firstSeen, paidAt),
      scansAfter: between("scan_completed", paidAt, refundAt) ?? 0,
      lastSeenAfterHours: hoursBetween(paidAt, lastSeen),
      packs: of("scan_pack_purchase_completed").length,
    } : null,
    refund: refundAt ? {
      at: refundAt, hoursAfterPurchase: hoursBetween(paidAt, refundAt),
      scansBetween: paidAt ? between("scan_completed", paidAt, refundAt) : null,
      activeAfter: evs.some(e => e.created_at > refundAt),
    } : null,
    features: {
      saved: of("scan_saved").length, listings: of("listing_generated").length,
      huntOpens: of("hunt_mode_opened").length, hunts: of("hunt_ended").length,
      deepAnalysisPaywalls: pw.filter(e => mstr(e, "paywall_source") === "deep_analysis").length,
      deepAnalysisOpens: of("deep_analysis_viewed").length,
      scanStore: of("scan_store_opened").length, progress: of("progress_tab_opened").length,
    },
  };
}
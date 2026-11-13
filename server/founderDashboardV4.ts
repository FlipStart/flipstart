/**
 * server/founderDashboardV4.ts
 *
 * Founder Dashboard V4 — server-rendered HTML.
 *
 * Same route, same auth, same architecture as V3: one HTML string built from
 * a metrics object. The business funnel comes first; V3's product sections are
 * imported unchanged and rendered further down. Nothing from V3 is deleted.
 *
 * ── Trust is visible, quietly ───────────────────────────────────────────────
 * Every metric carries EXACT / DERIVED / ESTIMATED / NOT TRACKED / LEGACY.
 * The renderer shows it as a small badge with a tooltip and a legend at the
 * top — present, not shouting.
 *
 * ── Small samples are labelled, never hidden ────────────────────────────────
 * Every rate renders as "n / d · pct" so 5.6% is never mistaken for a trend
 * when it is 2 of 36. Denominators under 20 get a subtle marker.
 *
 * ── PII stays in this HTML ──────────────────────────────────────────────────
 * Purchaser emails appear only in the server-rendered Paid User Journeys
 * table, behind FOUNDER_DASHBOARD_SECRET. Every value passes through esc().
 * There is no client-side JS that fetches or holds user data.
 */
import {
  esc, card, section, bar, isErr, errorCard,
  renderTrust, renderCost, renderHunt, renderProgress, renderAchievements,
  renderBrands, renderDiamonds, renderListings, renderSold, renderScans,
} from "./founderDashboardV3";
import type { Metric, Trust, PaywallRow, PaidJourney, Scope, AnalysisWindow, RangePreset } from "./founderMetricsV4";
import { formatCentralDateTime } from "./dashboardDates";
import { REASON_LABEL, buildScanReliability } from "./scanReliability";

// ── Formatting ───────────────────────────────────────────────────────────────

const num = (v: unknown, dp = 0): string => {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v); if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: dp, minimumFractionDigits: 0 });
};
const pct = (v: number | null): string => v === null ? "—" : `${(v * 100).toFixed(1)}%`;
const hrs = (h: number | null): string => {
  if (h === null || !Number.isFinite(h)) return "—";
  // Negative = the reference event came AFTER the purchase (e.g. first scan
  // after paying). "-2400m" is technically right and reads as garbage.
  if (h < 0) return `<span class="muted" title="${esc(`${Math.abs(h).toFixed(1)}h before`)}">paid first</span>`;
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 48) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
};
// Central, like everything else on the page — not the raw UTC ISO string.
const when = (s: string | null | undefined): string => { const f = formatCentralDateTime(s); return f ? esc(f) : "—"; };

const TRUST_LABEL: Record<Trust, string> = { EXACT: "exact", DERIVED: "derived", ESTIMATED: "est.", NOT_TRACKED: "n/t", LEGACY: "legacy", PARTIAL: "partial", CONFLICT: "conflict" };
const TRUST_TIP: Record<Trust, string> = {
  EXACT: "A count from an authoritative table.", DERIVED: "Arithmetic over exact inputs.",
  ESTIMATED: "A model, not a measurement.", NOT_TRACKED: "Not collected.", LEGACY: "Known unreliable. Shown for context only.",
  PARTIAL: "Some underlying data is missing, so this is a floor, not the full number.",
  CONFLICT: "Two sources that should agree, don't.",
};
const badge = (t: Trust) => `<span class="tb tb-${t.toLowerCase()}" title="${esc(TRUST_TIP[t])}">${TRUST_LABEL[t]}</span>`;
/**
 * Two tiers, never suppressing the number. Below 20 a rate is noisy; below 5
 * a single person changes it by 20 points or more.
 */
export const SMALL_SAMPLE = 20, VERY_SMALL_SAMPLE = 5;
const small = (d: number | undefined) =>
  d === undefined || d >= SMALL_SAMPLE ? ""
  : d < VERY_SMALL_SAMPLE
    ? `<span class="ss ss-vs" title="Very small sample: fewer than 5 in the denominator — one person moves this by 20+ points">n&lt;5</span>`
    : `<span class="ss" title="Small sample: fewer than 20 in the denominator">n&lt;20</span>`;

/** A metric card. Handles unavailable, rates with N, and plain counts. */
function m(label: string, x: Metric | null | undefined, opts: { dp?: number; fmt?: "pct" | "hrs" | "num" } = {}): string {
  if (!x) return card(label, "—");
  if (x.available === false) return `<div class="stat na"><div class="stat-v">Not yet available</div><div class="stat-l">${esc(label)}</div><div class="stat-s">${esc(x.note ?? "Available after Analytics V4 cutover")}</div></div>`;
  let v: string, sub = "";
  if (x.trust === "DERIVED" && x.d !== undefined && x.n !== undefined) {
    v = pct(x.value); sub = `${num(x.n)} / ${num(x.d)} ${small(x.d)}`;
  } else if (opts.fmt === "hrs") { v = hrs(x.value); if (x.d !== undefined) sub = `n=${num(x.d)} ${small(x.d)}`; }
  else if (opts.fmt === "pct") { v = pct(x.value); }
  else { v = num(x.value, opts.dp ?? 0); if (x.d !== undefined) sub = `n=${num(x.d)} ${small(x.d)}`; }
  return `<div class="stat"><div class="stat-v">${v} ${badge(x.trust)}</div><div class="stat-l">${esc(label)}</div>${sub || x.note ? `<div class="stat-s">${sub}${x.note ? ` <span class="muted">${esc(x.note)}</span>` : ""}</div>` : ""}</div>`;
}
/** A card whose answer is a word or a date rather than a number. */
function textCard(label: string, text: string | null | undefined, trust: Trust = "EXACT", sub?: string): string {
  const v = text ? esc(text) : `<span class="muted">none</span>`;
  return `<div class="stat"><div class="stat-v stat-text">${v} ${badge(trust)}</div><div class="stat-l">${esc(label)}</div>${sub ? `<div class="stat-s">${esc(sub)}</div>` : ""}</div>`;
}
const grid = (cards: string[]) => `<div class="stat-grid">${cards.join("")}</div>`;
const na = (label: string, note = "Awaiting Analytics V4 client release") => `<div class="card na"><div class="card-h">${esc(label)}</div><div class="muted">${esc(note)}</div></div>`;
const rate = (n: number, d: number) => d ? `${num(n)} / ${num(d)} · ${pct(n / d)} ${small(d)}` : "—";
const table = (head: string[], rows: string[][], cls = "") => rows.length
  ? `<table class="${cls}"><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table>`
  : `<div class="muted">No data yet.</div>`;
const funnel = (rows: Array<{ stage: string; users: number; note?: string }>) => {
  const top = rows[0]?.users || 0;
  return `<table class="funnel">${rows.map((r, i) => {
    const prev = rows[i - 1]?.users ?? r.users;
    const drop = i === 0 || !prev ? "" : `<span class="muted">−${pct(1 - r.users / prev)} vs prev</span>`;
    return `<tr><td class="stg">${esc(r.stage)}${r.note ? ` <span class="muted">${esc(r.note)}</span>` : ""}</td><td class="r">${num(r.users)}</td><td class="r">${top ? pct(r.users / top) : "—"}</td><td class="w">${bar(top ? r.users / top * 100 : 0)}</td><td>${drop}</td></tr>`;
  }).join("")}</table>`;
};
/**
 * `unit` names what the counts are. Defaults to "Users"; plan selections pass
 * "Selections", because they count selection EVENTS — one user choosing
 * Annual twice is two rows, and calling that "users" overstated reach.
 */
const buckets = (obj: Record<string, number>, total?: number, unit = "Users") => {
  const t = total ?? Object.values(obj).reduce((a, b) => a + b, 0);
  return table(["Bucket", unit, "Share"], Object.entries(obj).map(([k, v]) => [esc(k), num(v), t ? pct(v / t) : "—"]));
};
const legend = () => `<div class="legend">${(["EXACT", "DERIVED", "ESTIMATED", "PARTIAL", "CONFLICT", "NOT_TRACKED", "LEGACY"] as Trust[]).map(t => `${badge(t)} ${esc(TRUST_TIP[t])}`).join(" &nbsp; ")}</div>`;

// ── Sections ─────────────────────────────────────────────────────────────────

/**
 * Links back into this page keep the founder secret, the scope and the date
 * range, so following one never logs you out or silently changes the view.
 * Rendering is synchronous, so this is set at the start of each render and
 * cannot be seen by another request mid-render.
 */
let pageQuery = "";
function setPageQuery(secret: string | undefined, scope: Scope, win?: AnalysisWindow) {
  const parts = [`secret=${encodeURIComponent(secret ?? "")}`];
  if (scope === "all") parts.push("scope=all");
  if (win?.preset === "custom" && win.fromDay && win.toDay) parts.push("preset=custom", `from=${win.fromDay}`, `to=${win.toDay}`);
  else if (win?.preset) parts.push(`preset=${encodeURIComponent(win.preset)}`);
  pageQuery = "?" + parts.join("&");
}
/**
 * Journey data quality. INFERRED is its own badge rather than a trust level:
 * it means a key fact came from current state (the plan) instead of an
 * event, which is neither "partial" nor "conflicting".
 */
const Q_TIP: Record<string, string> = {
  EXACT: "Every join is complete.",
  PARTIAL: "Some underlying data is missing; counts are floors.",
  INFERRED: "Key facts come from current state, not from events.",
  CONFLICT: "Sources disagree.",
};
function qBadge(q: string, reasons: string[] = []): string {
  const cls = q === "EXACT" ? "exact" : q === "PARTIAL" ? "partial" : q === "CONFLICT" ? "conflict" : "derived";
  const tip = [Q_TIP[q] ?? "", ...reasons].filter(Boolean).join(" • ");
  return `<span class="tb tb-${cls}" title="${esc(tip)}">${esc(q.toLowerCase())}</span>`;
}
/** A link that opens one user in the Explorer. Only the opaque user ID is in it — never an email. */
const explorerHref = (uid: string) => `${pageQuery}&user=${encodeURIComponent(uid)}#explorer`;
const userLink = (uid: string, label: string) => `<a class="ulink" href="${esc(explorerHref(uid))}">${esc(label)}</a>`;

function renderAttention(items: any): string {
  if (!Array.isArray(items) || items.length === 0) {
    return `<div class="attn attn-none"><strong>Founder attention</strong> <span class="muted">— nothing flagged by the rules right now.</span></div>`;
  }
  return `<div class="attn"><div class="attn-h">Founder attention <span class="muted">— rules over numbers on this page, not predictions</span></div>${
    items.map((i: any) => `<a class="attn-i attn-${esc(i.level)}" href="#${esc(i.anchor)}"><span class="attn-ic">${esc(i.icon)}</span><span><strong>${esc(i.title)}</strong><br><span class="muted">${esc(i.detail)}</span></span></a>`).join("")
  }</div>`;
}

function renderIntegrity(di: any): string {
  // Absent (e.g. the metrics layer was skipped) must degrade like every other
  // section — one missing block can never take the whole page down.
  if (!di || typeof di !== "object") return section("integrity", "1b · Data Integrity", `<div class="card muted">Data Integrity is unavailable for this load.</div>`);
  // Wrapped in its section so the contents link still lands somewhere.
  if (isErr(di)) return section("integrity", "1b · Data Integrity", errorCard("Data Integrity", di));
  const c = di.counts;
  const sevPill = (sv: string) => `<span class="sev sev-${esc(sv.toLowerCase())}">${esc(sv)}</span>`;
  const head = grid([
    m("Analytics health", di.health),
    textCard("Integrity issues", `${di.conflicts + di.warnings} detected`, di.conflicts ? "CONFLICT" : di.warnings ? "PARTIAL" : "EXACT",
      `${di.conflicts} conflict(s) · ${di.warnings} warning(s) · ${di.infos} explained`),
    textCard("Loader", di.loader?.status === "ok" ? "OK" : String(di.loader?.status ?? "unknown"), di.loader?.status === "ok" ? "EXACT" : "CONFLICT", di.loader?.note),
  ]);
  const evGrid = grid([
    m("Signed-out events", c.anonymousEvents), m("…linked by device", c.linkedByDevice), m("…shared device, not linked", c.ambiguousDevice),
    m("…never linkable", c.unlinkable), m("Missing session_id", c.missingSession), m("Missing app_version", c.missingVersion),
    m("Missing route", c.missingRoute), m("Orphan events", c.orphanEvents), m("Internal accounts excluded", c.internalExcluded),
    ...(c.internalLeaked ? [m("Internal accounts in scope", c.internalLeaked)] : []), m("Shared devices", c.sharedDevices),
  ]);
  const recon = table(["Source", "Count", "What it measures"],
    di.reconciliation.map((r: any) => [esc(r.source), num(r.value), `<span class="muted">${esc(r.meaning)}</span>`]));
  const rows = (di.issues as any[]).slice(0, 150).map(i => [
    i.userId ? userLink(i.userId, i.user ?? i.userId.slice(0, 8) + "…") : "—",
    esc(i.label), sevPill(i.severity), `<span class="muted">${esc(i.sourceA)}</span>`, `<span class="muted">${esc(i.sourceB)}</span>`,
    when(i.at), `<span class="muted">${esc(i.notes)}</span>`,
  ]);
  const more = di.issues.length > 150 ? `<div class="muted">Showing 150 of ${num(di.issues.length)}, most severe first.</div>` : "";
  return section("integrity", "1b · Data Integrity", head + evGrid +
    `<div class="two"><div class="card"><div class="card-h">Scan sources — different things, not expected to match</div>${recon}</div>
     <div class="card"><div class="card-h">Behaviour, not errors</div>${grid([m("Scanned, never saved", di.behaviour.scannedNeverSaved), m("Save rate", di.behaviour.saveRate)])}<div class="muted">${esc(di.behaviour.note)}</div></div></div>
     <div class="card wide"><div class="card-h">Issues — most severe first</div>${rows.length ? table(["User", "Issue", "Severity", "Source A", "Source B", "When", "Notes"], rows, "compact") : `<div class="muted">No issues found.</div>`}${more}
     <div class="muted">CONFLICT: sources that must agree, don't. WARNING: data missing or suspect, so numbers may be floors. INFO: looks odd, has an innocent explanation — never counted against health. ${esc(di.scopeNote)}</div></div>`,
    di.conflicts ? `${di.conflicts} conflict(s)` : "");
}


// ── User Explorer: refund investigation (server/founderUserLookup.ts) ──────────

const partNote = (p: any, what: string) => p?.skipped
  ? `<div class="muted">${esc(p.reason)}</div>`
  : `<div class="banner warn">${esc(what)} unavailable: ${esc(p?.reason ?? "not loaded")}</div>`;
const dollars = (v: unknown) => { const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN; return Number.isFinite(n) ? `$${n.toFixed(0)}` : "—"; };

function renderStoreCard(store: any): string {
  const head = `<div class="card-h">Store record <span class="muted">— RevenueCat · what was bought, when auto-renew went off, and refunds. Apple never tells developers why someone refunded.</span></div>`;
  if (!store) return "";
  if (!store.ok) return `<div class="card">${head}${partNote(store, "Store record")}</div>`;
  const r = store.data;
  const flag = r.refunded ? `<div class="banner warn"><strong>Refunded.</strong> Read the timeline below from the purchase to the refund.</div>` : "";
  const subs = r.subscriptions.length ? table(["Product", "First bought", "Latest period", "Expires", "Auto-renew off", "Billing issue", "Refunded"], r.subscriptions.map((s: any) => [
    `${esc(s.product)}${s.sandbox ? ` <span class="sev sev-info">sandbox</span>` : ""}${s.familyShared ? ` <span class="sev sev-info">family</span>` : ""}`,
    when(s.firstPurchased), when(s.latestPurchased), when(s.expires),
    s.autoRenewOffAt ? when(s.autoRenewOffAt) : `<span class="muted">—</span>`,
    s.billingIssueAt ? when(s.billingIssueAt) : `<span class="muted">—</span>`,
    s.refundedAt ? `<span class="sev sev-conflict">${when(s.refundedAt)}</span>` : `<span class="muted">no</span>`,
  ]), "compact") : `<div class="muted">No subscriptions on record.</div>`;
  const packs = r.purchases.length ? table(["Scan pack", "Bought", "Status"], r.purchases.map((p: any) => [
    `${esc(p.product)}${p.sandbox ? ` <span class="sev sev-info">sandbox</span>` : ""}`, when(p.purchased),
    p.status ? (/refund/i.test(p.status) ? `<span class="sev sev-conflict">${esc(p.status)}</span>` : esc(p.status)) : `<span class="muted">—</span>`,
  ]), "compact") : "";
  const notes = r.notes.map((n: string) => `<div class="muted">${esc(n)}</div>`).join("");
  return `<div class="card">${head}${flag}${subs}${packs}${notes}</div>`;
}

function renderOutcomesCard(o: any): string {
  const head = `<div class="card-h">Every scan the server saw <span class="muted">— scan_outcomes · what each scan ended as, oldest first</span></div>`;
  if (!o) return "";
  if (!o.ok) return `<div class="card">${head}${partNote(o, "Scan outcomes")}</div>`;
  if (!o.rows.length) return `<div class="card">${head}<div class="muted">No scans reached the server for this user.</div></div>`;
  const s = o.summary;
  const label = (r: any) => r.kind === "ok" ? `result${r.confidence_tier ? ` · ${esc(r.confidence_tier)}` : ""}`
    : r.kind === "soft" ? `<span class="sev sev-warning">soft · ${esc(r.reason ?? "?")}</span>`
    : `<span class="sev sev-conflict">${esc(r.failure_group ?? "failed")} · ${esc(r.reason ?? "?")}</span>`;
  const rows = o.rows.map((r: any) => [
    when(r.created_at), label(r),
    r.match_confidence !== null && r.match_confidence !== undefined ? num(r.match_confidence) : "—",
    esc([...new Set([r.scan_issue, ...(Array.isArray(r.photo_problems) ? r.photo_problems : [])].filter(Boolean))].join(", ") || "—"),
    esc(r.charge ?? "—") + (r.resolution ? ` <span class="muted">${esc(r.resolution)}</span>` : ""),
    r.photo_count ?? "—", r.duration_ms ? `${(r.duration_ms / 1000).toFixed(1)}s` : "—",
  ]);
  return `<div class="card wide">${head}${grid([
      m("Scans", { value: s.total, trust: "EXACT" }), m("Results", { value: s.ok, trust: "EXACT", d: s.total }),
      m("Soft fails", { value: s.soft, trust: "EXACT", d: s.total }), m("Hard fails", { value: s.hard, trust: "EXACT", d: s.total }),
      m("Charged", { value: s.charged, trust: "EXACT", d: s.total }),
      textCard("Confidence (results)", `high ${s.tiers.high} · medium ${s.tiers.medium} · low ${s.tiers.low}`),
    ])}${s.topReasons.length ? `<div class="muted">Most common problems: ${s.topReasons.map((t: any) => `${esc(t.reason)} ×${num(t.n)}`).join(" · ")}</div>` : ""}
    ${table(["When", "Ended as", "Match", "Issues", "Charge", "Photos", "Took"], rows, "compact")}</div>`;
}

function renderSavedCard(sv: any): string {
  const head = `<div class="card-h">Saved items <span class="muted">— what the app told them about each item they kept</span></div>`;
  if (!sv) return "";
  if (!sv.ok) return `<div class="card">${head}${partNote(sv, "Saved items")}</div>`;
  if (!sv.data.length) return `<div class="card">${head}<div class="muted">Nothing saved.</div></div>`;
  return `<div class="card wide">${head}${table(["Saved", "Item", "Brand", "Paid", "Est. resale", "Match", "Verdict", "Status"], sv.data.map((r: any) => [
    when(r.created_at), esc(r.item_name ?? "—"), esc(r.brand ?? "—"), dollars(r.thrift_price),
    r.low !== null || r.high !== null ? `${dollars(r.resale)} <span class="muted">${dollars(r.low)}–${dollars(r.high)}</span>` : dollars(r.resale),
    r.confidence !== null && r.confidence !== undefined ? esc(String(r.confidence)) : "—", esc(r.label ?? "—"),
    esc(r.status ?? "—") + (r.sold_price ? ` <span class="muted">sold ${dollars(r.sold_price)}</span>` : ""),
  ]), "compact")}</div>`;
}

const hh = (h: number | null | undefined) => h === null || h === undefined ? "—"
  : h < 1 ? `${Math.max(0, Math.round(h * 60))} min` : h < 48 ? `${h.toFixed(1)} h` : `${(h / 24).toFixed(1)} days`;

function renderGlanceCard(g: any, xp: any, collections: any): string {
  if (!g) return "";
  const o = g.onboarding, s = g.scans, p = g.paywall, b = g.purchase, r = g.refund, f = g.features;
  const muted = (t: string) => `<span class="muted">${t}</span>`;
  const onboarding = !o.started && !o.completed ? muted("no onboarding events")
    : [o.maxStep !== null ? `reached step ${num(o.maxStep)}${o.totalSteps ? ` of ${num(o.totalSteps)}` : ""}` : null,
       o.quiz ? "finished quiz" : "quiz not finished",
       o.tapped ? `tapped ${esc(o.tapped)}` : null,
       o.completed ? `completed (${esc(o.completed)}) ${when(o.completedAt)}` : "never completed"].filter(Boolean).join(" · ");
  const xpText = !xp ? muted("—") : !xp.ok ? muted(esc(xp.reason)) : !xp.data ? muted("no XP row")
    : `${num(xp.data.xp)} XP · rank ${num(xp.data.rankNumber)} ${esc(xp.data.rank)} · ${num(xp.data.hunts)} hunts${xp.data.streak ? ` · streak ${num(xp.data.streak)}` : ""}`;
  const rows: string[][] = [
    ["First seen", `${when(g.firstSeen)}${g.accountCreated ? ` · account ${when(g.accountCreated)}` : ""}`],
    ["Last seen", when(g.lastSeen)],
    ["Onboarding", onboarding],
    ["Scans", s.total ? `${num(s.total)} completed · ${num(s.failed)} failed · first ${when(s.firstAt)} (${hh(s.hoursToFirst)} after signup)` : `none${s.failed ? ` · ${num(s.failed)} failed` : ""}`],
    ["First paywall", p.first ? `<strong>${esc(p.first.source)}</strong> · ${when(p.first.at)} · after ${num(p.first.scansBefore)} scan${p.first.scansBefore === 1 ? "" : "s"}` : muted("never saw one")],
    ["Paywalls seen", p.views ? `${num(p.views)} — ${p.bySource.map((x: any) => `${esc(x.source)} ×${num(x.n)}`).join(" · ")}` : "0"],
    ["Checkout", `${num(p.planSelections)} plan selections · ${num(p.purchaseStarts)} purchase starts · ${num(p.cancelled)} cancelled at Apple sheet`],
    ["Paid", b ? `<strong>${esc(b.kind)}</strong>${b.source ? ` from <strong>${esc(b.source)}</strong>` : ""} · ${when(b.at)} · ${hh(b.hoursFromSignup)} after signup · after ${num(b.scansBefore)} scans and ${num(b.paywallsBefore)} paywall views${b.packs ? ` · ${num(b.packs)} pack purchase${b.packs === 1 ? "" : "s"}` : ""}` : muted("never")],
    ["After paying", b ? `${num(b.scansAfter)} scans${r ? " before the refund" : ""} · last seen ${hh(b.lastSeenAfterHours)} after paying` : muted("—")],
    ["Refund", r ? `<span class="sev sev-conflict">${when(r.at)}</span> · ${hh(r.hoursAfterPurchase)} after paying · ${r.scansBetween === null ? "—" : num(r.scansBetween)} scans in between · ${r.activeAfter ? "still used the app after" : "never opened the app after"}` : muted("none on record")],
    ["Features used", `saved ${num(f.saved)} · listings ${num(f.listings)} · Hunt opens ${num(f.huntOpens)} / hunts ${num(f.hunts)} · Deep Analysis opens ${num(f.deepAnalysisOpens)}, paywalls ${num(f.deepAnalysisPaywalls)} · Scan Store ${num(f.scanStore)} · Progress ${num(f.progress)}`],
    ["Hunt XP", xpText],
    ["Collections", `brands ${collections?.brands ?? "—"} · diamonds ${collections?.diamonds ?? "—"} · achievements ${collections?.achievements ?? "—"}`],
  ];
  return `<div class="card"><div class="card-h">At a glance <span class="muted">— everything this person did, including signed-out activity on their phone · Central Time</span></div>${table(["", ""], rows, "compact kv")}</div>`;
}

function renderExplorer(ex: any): string {
  if (ex && isErr(ex)) return errorCard("User Explorer", ex);
  const form = `<form class="xsearch" method="post" action="${esc(pageQuery)}#explorer">
    <input type="search" name="q" value="${esc(ex?.query ?? "")}" placeholder="Name, username, email or user ID (a full ID opens them directly)" maxlength="200" autocomplete="off">
    <button type="submit">Search</button>
    <span class="muted">Search runs by form post, so what you type never appears in a URL or a server log.</span></form>`;
  let body = "";
  if (ex?.results) {
    body += ex.results.length
      ? `<div class="card">${table(["User", "Username", "Email", "Created", "Plan", "Status"], ex.results.map((r: any) => [
          userLink(r.userId, r.displayName ?? r.username ?? r.userId.slice(0, 8) + "…"), esc(r.username ?? "—"), esc(r.email ?? "—"),
          when(r.createdAt), esc(r.plan), r.internal ? `<span class="sev sev-info">internal</span>` : r.inScope ? "in scope" : `<span class="muted">outside scope</span>`]), "compact")}
          ${ex.results.length >= 25 ? `<div class="muted">First 25 matches — narrow the search.</div>` : ""}</div>`
      : `<div class="card muted">No users match.</div>`;
  }
  if (ex?.notFound) body += `<div class="card muted">Nothing on record for that ID — no profile, account, ledger row or app events. Check it was copied in full.</div>`;
  const u = ex?.user;
  if (u) {
    const id = u.identity, b = u.balance, us = u.usage, mo = u.monetization, j = mo.journey;
    const status = id.accountState === "deleted" ? "account deleted — rebuilt from what's left (events, scans, store)"
      : id.accountState === "no_profile" ? "signed up but never saved a profile"
      : id.internal ? "internal account — excluded from every metric" : id.inScope ? "in the current scope" : "outside the current scope — not in the dashboard's numbers";
    const col = (n: number | null) => n === null ? `<span class="muted">n/t</span>` : num(n);
    body += `<div class="card"><div class="card-h">${esc(id.displayName ?? id.username ?? "User")} <span class="muted">— ${esc(status)}${id.sharedDevice ? " · shares a device with another account" : ""}</span></div>
      ${table(["", ""], [
        ["Email", esc(id.email ?? "—")], ["User ID", `<code>${esc(id.userId)}</code>`], ["Username", esc(id.username ?? "—")],
        ["Account created", when(id.accountCreated)], ["Profile created", when(id.profileCreated)],
        ["Plan", `${esc(id.plan)}${id.product ? ` <span class="muted">${esc(id.product)}</span>` : ""}${id.periodEnd ? ` <span class="muted">· period ends ${when(id.periodEnd)}</span>` : ""}`],
        ["Scan balance", b.hasLedgerRow ? `${num(b.freeRemaining)} of ${num(b.freeUsed + b.freeRemaining)} free left · ${num(b.packBalance)} pack${b.subscriptionLimit ? ` · ${num(b.subscriptionUsed)} / ${num(b.subscriptionLimit)} this period` : ""}` : `<span class="muted">no ledger row yet</span>`],
        ["App version", id.firstVersion ? `first ${esc(id.firstVersion)} · latest ${esc(id.lastVersion ?? "")}` : `<span class="muted">none recorded</span>`],
        ["Active", `${when(id.firstActive)} → ${when(id.lastActive)}`],
      ], "compact kv")}</div>
      ${renderGlanceCard(u.glance, u.xp, u.collections)}
      ${renderStoreCard(u.store)}
      <div class="card"><div class="card-h">Usage</div>${grid([
        m("Lifetime scans", { value: us.lifetimeScans, trust: "EXACT" }), m("Scans 7d", { value: us.scans7, trust: "EXACT" }),
        m("Scans 30d", { value: us.scans30, trust: "EXACT" }), m("Failed scans", { value: us.failedScans, trust: "EXACT" }),
        m("Signed-out scans (device)", { value: us.linkedScans, trust: us.linkedScans ? "PARTIAL" : "EXACT" }),
        m("Saved items", { value: us.savedItems, trust: "EXACT" }), m("Sessions", { value: us.sessions, trust: "EXACT" }),
        m("Active days", { value: us.activeDays, trust: "EXACT" }), m("Listings", { value: us.listings, trust: "EXACT" }),
        m("Hunt opens", { value: us.huntOpens, trust: "EXACT" }), m("Hunts completed", { value: us.huntCompletions, trust: "EXACT" }),
        m("Progress opens", { value: us.progressOpens, trust: "EXACT" }), m("Scan Store opens", { value: us.scanStoreOpens, trust: "EXACT" }),
        us.deepAnalysisOpens === null
          ? m("Deep Analysis opens", { value: null, trust: "NOT_TRACKED", available: false, note: `no open event yet — ${us.deepAnalysisPaywalls} paywall view(s)` })
          : m("Deep Analysis opens", { value: us.deepAnalysisOpens, trust: "PARTIAL", note: `only from the app build that logs it · ${us.deepAnalysisPaywalls} paywall view(s)` }),
      ])}<div class="muted">Collections — brands ${col(u.collections?.brands ?? null)} · diamonds ${col(u.collections?.diamonds ?? null)} · achievements ${col(u.collections?.achievements ?? null)}</div></div>
      <div class="card"><div class="card-h">Monetization</div>${grid([
        textCard("First paywall", mo.firstPaywall), m("Paywall views", { value: mo.paywallImpressions, trust: "EXACT" }),
        m("Plan selections", { value: mo.planSelections, trust: "EXACT" }), m("Purchase starts", { value: mo.purchaseStarts, trust: "EXACT" }),
        m("Purchases", { value: mo.purchaseCompletions, trust: "EXACT" }), m("Cancelled", { value: mo.cancellations, trust: "EXACT" }),
        m("Restores", { value: mo.restores, trust: "EXACT" }),
        m("Est. API cost", { value: u.costEstimate, trust: "ESTIMATED" }, { dp: 3 }),
      ])}${j ? `<div class="muted">Journey ${qBadge(j.quality, j.qualityReasons)} —
        converted on ${esc(j.convertingPaywall ?? "UNKNOWN")} · ${num(j.scansBeforePay)} scans, ${num(j.sessionsBeforePay)} sessions and ${num(j.paywallImpressionsBeforePay)} paywall views before paying · account → pay ${hrs(j.hoursAccountToPay)}
        ${j.qualityReasons.length ? `<br>${j.qualityReasons.map((r: string) => esc(r)).join("<br>")}` : ""}</div>` : `<div class="muted">Not a paying user.</div>`}</div>
      <div class="card wide"><div class="card-h">Timeline <span class="muted">— Central Time, oldest first${u.timelineTotal > u.timeline.length ? ` · last ${num(u.timeline.length)} of ${num(u.timelineTotal)} events` : ""}</span></div>
      ${table(["When", "Event", "Detail"], u.timeline.map((r: any) => [when(r.at), `${r.event === "store_refunded" ? `<strong>${esc(r.event)}</strong>` : esc(r.event)}${r.linked ? ` <span class="sev sev-info" title="Written while signed out on this user's device; attributed by device">device</span>` : ""}${r.source === "store" ? ` <span class="sev ${r.event === "store_refunded" ? "sev-conflict" : "sev-warning"}" title="From RevenueCat, not the app">store</span>` : ""}`, `<span class="muted">${esc(r.detail)}</span>`]), "compact")}</div>
      ${renderOutcomesCard(u.outcomes)}
      ${renderSavedCard(u.saved)}`;
  }
  return section("explorer", "1c · User Explorer", `<div class="card">${form}<div class="muted">Founder-only. Shows any account — pre-launch and internal included — with its whole history; scope and date range do not apply here.</div></div>` + body);
}

const usd = (v: number | null | undefined, dp = 2) => v === null || v === undefined || !Number.isFinite(v) ? "—" : `$${v.toFixed(dp)}`;
const signed = (v: number | null, unit: string, dp = 1) => v === null ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(dp)}${unit}`;
const absent = (label: string, x: any) => !x || typeof x !== "object" ? `<div class="card muted">${esc(label)} is unavailable for this load.</div>` : "";

function renderPricing(pr: any): string {
  if (!pr || typeof pr !== "object") return section("pricing", "4b · Pricing Experiments", absent("Pricing Experiments", pr));
  // Wrapped in its section so the contents link still lands somewhere.
  if (isErr(pr)) return section("pricing", "4b · Pricing Experiments", errorCard("Pricing Experiments", pr));
  const col = (r: any) => {
    const e = r.era;
    const span = `${e.startsAt ? when(e.startsAt) : "start"} → ${e.endsAt ? when(e.endsAt) : "now"}`;
    return `<div class="card"><div class="card-h">${esc(e.label)} · ${usd(e.monthlyUsd)}/mo · ${usd(e.annualUsd)}/yr ${pr.currentEraId === e.id ? `<span class="sev sev-info">current</span>` : ""}<br><span class="muted">${esc(span)} Central</span></div>
      <div class="muted">Cohort — signed up in this era, full ${pr.conversionDays}-day window inside it</div>
      ${grid([
        m("Signed up", r.acquired), m(`Activation · ${pr.conversionDays}d`, r.activation7), m(`Paid · ${pr.conversionDays}d`, r.paid7),
        m("Est. revenue / 100 users", r.revenuePer100, { dp: 2 }),
      ])}
      <div class="muted">${num(r.eligible)} eligible · ${num(r.straddling)} excluded (week crosses the era boundary) · ${num(r.tooNew)} too new to judge</div>
      <div class="muted" style="margin-top:8px">Flow — everything that happened in this era</div>
      ${grid([
        m("Active users", r.activeUsers), m("Paywall viewers", r.paywallViewers), m("Purchase starts", r.purchaseStarts),
        m("Purchases", r.purchases), m("Viewer → paid", r.viewerToPaid), m("Start → purchase", r.startToPurchase),
        m("Monthly", r.monthly), m("Annual", r.annual), m("Annual share", r.annualShare),
        m("Est. gross", r.grossEstimate, { dp: 2 }), m("Est. net", r.netEstimate, { dp: 2 }), m("Est. gross / viewer", r.revenuePerViewer, { dp: 2 }),
        m("Median time to pay", { value: r.timeToPay.median, trust: "DERIVED", d: r.timeToPay.d }, { fmt: "hrs" }),
        m("Mean time to pay", { value: r.timeToPay.mean, trust: "DERIVED", d: r.timeToPay.d }, { fmt: "hrs" }),
        m("Median scans before pay", { value: r.scansBeforePay.median, trust: "DERIVED", d: r.scansBeforePay.d }, { dp: 1 }),
        m("Mean paywall views before pay", { value: r.paywallsBeforePay.mean, trust: "DERIVED", d: r.paywallsBeforePay.d }, { dp: 1 }),
      ])}</div>`;
  };
  // Each era against the one before it, newest first. "—" until an era has
  // users whose whole conversion window has closed.
  const short = (label: string) => String(label ?? "").replace(/^Pricing /, "");
  const cmpRows = (c: any) => [
    [`Activation (${pr.conversionDays}-day)`, esc(signed(c.activationPts, " pts"))],
    [`Paid conversion (${pr.conversionDays}-day)`, esc(signed(c.paidPts, " pts"))],
    ["Paywall viewer → paid", esc(signed(c.viewerToPaidPts, " pts"))],
    ["Est. revenue per 100 users", c.revenuePer100Delta === null ? "—" : esc(`${c.revenuePer100Delta >= 0 ? "+" : "−"}$${Math.abs(c.revenuePer100Delta).toFixed(2)}`)],
  ];
  const pairs: any[] = Array.isArray(pr.comparisons) ? [...pr.comparisons].reverse() : [];
  const cmp = pairs.length ? `<div class="card"><div class="card-h">Each era vs the one before <span class="muted">— observational, not causal</span></div>${table(
    ["Measure", ...pairs.map(c => `${short(c.toLabel)} vs ${short(c.fromLabel)}`)],   // table() escapes headers
    cmpRows(pairs[0]).map((_, i) => [cmpRows(pairs[0])[i][0], ...pairs.map(c => cmpRows(c)[i][1])]),
    "compact")}<div class="muted">${esc(pr.caveat)} Small samples are flagged on each card above. An era's 7-day numbers fill in once its first signups are a week old.</div></div>` : "";
  const assumed: any[] = Array.isArray(pr.assumedStarts) ? pr.assumedStarts : [];
  const notes = [
    ...assumed.map(a => `${short(a.label)} start is a date-only assumption (midnight Central${a.startsAt ? `, ${when(a.startsAt)}` : ""}). Set ${a.env} to the exact moment if known.`),
    `Revenue is ESTIMATED: list price in USD, first period only — before refunds, renewals and non-US storefront pricing. Net applies Apple's ${Math.round(pr.appleFeeRate * 100)}%. Subscriptions only; scan-pack events are test activity.`,
    ...pr.notes.map((n: any) => `${n.at ? when(n.at) + " — " : ""}${n.note}`),
  ].filter(Boolean).map(t => `<div class="note-block">${esc(t)}</div>`).join("");
  return section("pricing", "4b · Pricing Experiments", `<div class="eras">${pr.eras.map(col).join("")}</div>` + cmp + notes,
    "eras define their own windows; the date range does not apply");
}

function renderFreeToPaid(fp: any): string {
  if (!fp || typeof fp !== "object") return section("freepaid", "4c · Free → Paid", absent("Free → Paid", fp));
  // Wrapped in its section so the contents link still lands somewhere.
  if (isErr(fp)) return section("freepaid", "4c · Free → Paid", errorCard("Free → Paid", fp));
  const top = Math.max(0, ...fp.buckets.map((b: any) => b.conversion.value ?? 0));
  const rows = fp.buckets.map((b: any) => [
    esc(b.label), num(b.users), num(b.paid),
    b.conversion.d ? `${rate(b.conversion.n, b.conversion.d)}` : "—",
    `<div class="w">${bar(top ? ((b.conversion.value ?? 0) / top) * 100 : 0)}</div>`,
    b.paid ? `${num(b.monthly)} / ${num(b.annual)}` : "—",
    hrs(b.medianHoursToPay), num(b.meanPaywallViews, 1), b.topConvertingPaywall ? `<code>${esc(b.topConvertingPaywall)}</code>` : "—",
  ]);
  return section("freepaid", "4c · Free → Paid",
    `<div class="card"><div class="card-h">Probability of paying, by free scans used before paying</div>
     ${table(["Free scans", "Users", "Paid", "Conversion", "", "Monthly / Annual", "Median time to pay", "Mean paywall views", "Top converting paywall"], rows, "compact")}
     <div class="muted">${esc(fp.note)} Counts are exact — straight from scan events, no balance reconstruction.${fp.undatedPayers ? ` ${num(fp.undatedPayers)} payer(s) with no purchase event are left out: there is no purchase moment to count scans against.` : ""}</div></div>`,
    "observed association, not causation");
}

function renderPowerUsers(pu: any): string {
  if (!pu || typeof pu !== "object") return section("power", "7b · Power Users", absent("Power Users", pu));
  // Wrapped in its section so the contents link still lands somewhere.
  if (isErr(pu)) return section("power", "7b · Power Users", errorCard("Power Users", pu));
  const tiers = table(["Lifetime scans", "Users", "Free / Monthly / Annual"], pu.tiers.map((t: any) => [
    `${num(t.threshold)}+`, rate(t.users.n, t.users.d), `${num(t.mix.free)} / ${num(t.mix.monthly)} / ${num(t.mix.annual)}`]), "compact");
  const rows = pu.top.map((r: any, i: number) => [
    num(i + 1), userLink(r.userId, r.user ?? r.userId.slice(0, 8) + "…"), esc(r.plan), num(r.scans7), num(r.scans30), num(r.lifetime),
    num(r.sessions), num(r.activeDays), num(r.listings), num(r.hunts), when(r.lastActive), r.cost === null ? "—" : usd(r.cost, 3),
  ]);
  return section("power", "7b · Power Users",
    `<div class="two"><div class="card"><div class="card-h">Thresholds</div>${tiers}</div>
     <div class="card"><div class="card-h">How this is ranked</div><div class="muted">Scans in the last 30 days, then lifetime scans. Internal accounts are excluded by the scope. Cost is ESTIMATED at the dashboard's per-action rates.</div></div></div>
     <div class="card wide"><div class="card-h">Top ${num(pu.top.length)}</div>${rows.length ? table(["#", "User", "Plan", "7d", "30d", "Lifetime", "Sessions", "Active days", "Listings", "Hunts", "Last active", "Est. cost"], rows, "compact") : `<div class="muted">No scans yet.</div>`}</div>`);
}

function renderDistributions(ds: any): string {
  if (!ds || typeof ds !== "object") return section("dist", "9b · Usage Distribution", absent("Usage Distribution", ds));
  // Wrapped in its section so the contents link still lands somewhere.
  if (isErr(ds)) return section("dist", "9b · Usage Distribution", errorCard("Usage Distribution", ds));
  const f = (v: number | null, dp = 1) => v === null ? "—" : num(v, dp);
  const line = (label: string, x: any, full: boolean) => x ? [esc(label), num(x.n), f(x.mean), f(x.median),
    ...(full ? [f(x.p25)] : []), f(x.p75), f(x.p90), ...(full ? [f(x.p95)] : []), f(x.max, 0)] : null;
  const card = (plan: string) => {
    const d = ds[plan]; if (!d) return "";
    const full = [line("Lifetime scans", d.lifetime, true)].filter(Boolean) as string[][];
    const short = [line("Scans 7d", d.scans7, false), line("Scans 30d", d.scans30, false), line("Sessions", d.sessions, false),
      line("Active days", d.activeDays, false), line("Listings", d.listings, false), line("Hunts", d.hunts, false),
      d.cost ? [esc("Est. API cost ($)"), num(d.cost.n), f(d.cost.mean, 3), f(d.cost.median, 3), f(d.cost.p75, 3), f(d.cost.p90, 3), f(d.cost.max, 3)] : null,
    ].filter(Boolean) as string[][];
    return `<div class="card"><div class="card-h">Current ${esc(plan)} · ${num(d.users)} users ${small(d.users)}</div>
      ${table(["", "n", "Mean", "Median", "P25", "P75", "P90", "P95", "Max"], full, "compact")}
      ${table(["", "n", "Mean", "Median", "P75", "P90", "Max"], short, "compact")}</div>`;
  };
  return section("dist", "9b · Usage Distribution", card("free") + card("monthly") + card("annual") +
    `<div class="muted">${esc(ds.note)} ${esc(ds.method)}</div>`, "per user, current plan");
}

const mins = (v: number | null) => v === null ? "—" : v < 60 ? `${Math.round(v)}m` : hrs(v / 60);

function funnelTable(stages: any[], unit: string): string {
  const top = stages.find((st: any) => st.tracked)?.reached || 0;
  const rows = stages.map((st: any) => st.tracked ? [
    esc(st.label) + (st.note ? ` <span class="muted">${esc(st.note)}</span>` : ""),
    num(st.reached), top ? pct(st.reached / top) : "—", `<div class="w">${bar(top ? (st.reached / top) * 100 : 0)}</div>`,
    st.conversion ? `${rate(st.conversion.n, st.conversion.d)}` : "—",
    st.conversion?.value !== null && st.conversion?.value !== undefined ? pct(1 - st.conversion.value) : "—",
    st.observed < st.reached ? `${num(st.observed)} <span class="muted" title="Reached this stage per a later event, but its own event is missing">(+${num(st.reached - st.observed)} implied)</span>` : num(st.observed),
    mins(st.medianMinutesFromPrev),
  ] : [`<span class="muted">${esc(st.label)}</span>`, `<span class="tb tb-not_tracked" title="No event exists for this step">n/t</span>`, "", "", "", "", `<span class="muted">${esc(st.note ?? "")}</span>`, ""]);
  return table(["Stage", unit, "Of first", "", "From previous", "Drop-off", "Own event seen", "Median time from previous"], rows, "compact");
}

function renderFunnel(fs: any): string {
  if (!fs || typeof fs !== "object") return section("funnel", "3b · First-Session Funnel", absent("First-Session Funnel", fs));
  // Wrapped in its section so the contents link still lands somewhere.
  if (isErr(fs)) return section("funnel", "3b · First-Session Funnel", errorCard("First-Session Funnel", fs));
  const o = fs.offerOutcomes, totalO = o.pro + o.free + o.activation_pending + o.unknown;
  return section("funnel", "3b · First-Session Funnel",
    `<div class="card"><div class="card-h">Before the account <span class="muted">— by device, ${num(fs.devices)} that started onboarding</span></div>${funnelTable(fs.before, "Devices")}</div>
     <div class="card"><div class="card-h">After the account <span class="muted">— by user, ${num(fs.users)} acquired in range, followed forward</span></div>${funnelTable(fs.after, "Users")}</div>
     <div class="two"><div class="card"><div class="card-h">How the onboarding offer was answered</div>${table(["Outcome", "Users", "Share"], [
        ["Continue Free", num(o.free), totalO ? pct(o.free / totalO) : "—"], ["Subscribed", num(o.pro), totalO ? pct(o.pro / totalO) : "—"],
        ["Activation pending", num(o.activation_pending), totalO ? pct(o.activation_pending / totalO) : "—"],
        ...(o.unknown ? [["Outcome not recorded", num(o.unknown), pct(o.unknown / totalO)]] : []),
      ], "compact")}<div class="muted">From <code>onboarding_completed</code>, which records the offer's outcome — exact in every era, unlike the generic Continue Free event that starts at the V4 cutover.</div></div>
     <div class="card"><div class="card-h">Beside the funnel</div>${grid([m("Saved a scan", fs.side.saved), m("Started an analysis, no completed scan", fs.side.analysisNoScan), m("…with a failed analysis", fs.side.failedNoScan)])}
     <div class="muted">Saving is shown here, not as a stage: scanning without saving is normal, and a nested "saved" stage would drop people who simply scan.</div></div></div>
     <div class="note-block">${badge("NOT_TRACKED")} ${esc(fs.gaps.join(" and "))} have no events, so the funnel cannot split the step between finishing onboarding and capturing a photo. ${esc(fs.note)}</div>`,
    "where new users stop");
}

function renderPaywallIntel(pi: any): string {
  if (!pi || typeof pi !== "object") return section("pwintel", "5b · Paywall Intelligence", absent("Paywall Intelligence", pi));
  // Wrapped in its section so the contents link still lands somewhere.
  if (isErr(pi)) return section("pwintel", "5b · Paywall Intelligence", errorCard("Paywall Intelligence", pi));
  const eraList: Array<{ id: string; label: string }> = Array.isArray(pi.eras) ? pi.eras : [{ id: "v1", label: "Pricing V1" }, { id: "v2", label: "Pricing V2" }];
  const eraIds = eraList.map(e => e.id);
  const eraHead = `Purchases ${eraList.map(e => String(e.label).replace(/^Pricing /, "")).join(" / ")}`;
  const rows = pi.rows.map((r: any) => [
    `<code>${esc(r.source)}</code>`, num(r.impressions), num(r.uniqueViewers), num(r.repeatViewers),
    num(r.selections), num(r.purchases), r.selectionToPurchase.d ? rate(r.selectionToPurchase.n, r.selectionToPurchase.d) : "—",
    eraIds.map((id: string) => num(r.purchasesByEra?.[id] ?? 0)).join(" / "), usd(r.revenueEstimate.value),
    num(r.medianImpressionsBeforePurchase, 1), hrs(r.medianHoursFirstImpressionToPurchase),
    `${num(r.firstSeenFor)} / ${num(r.convertingFor)} / ${num(r.lastBeforeFor)}`,
  ]);
  return section("pwintel", "5b · Paywall Intelligence",
    `<div class="card wide"><div class="card-h">Which paywalls create value <span class="muted">— sorted by estimated revenue in range</span></div>
     ${table(["Paywall", "Impr.", "Viewers", "Repeat viewers", "Selections", "Purchases", "Selection → purchase", eraHead, "Est. revenue", "Median views before buying", "First view → purchase", "First / converting / last"], rows, "compact")}
     <div class="muted">${esc(pi.note)} "First / converting / last": for buyers, how often this paywall was the first they saw, the one they bought on, and the last before buying. ${num(pi.buyers)} buyer(s). Current era: ${esc(pi.currentEra ?? "—")}.</div></div>`,
    "ESTIMATED revenue");
}

function renderFeatureAdoption(fa: any): string {
  if (!fa || typeof fa !== "object") return section("adopt", "13b · Feature Adoption & Conversion", absent("Feature Adoption", fa));
  // Wrapped in its section so the contents link still lands somewhere.
  if (isErr(fa)) return section("adopt", "13b · Feature Adoption & Conversion", errorCard("Feature Adoption", fa));
  const r = (x: any) => x.d ? rate(x.n, x.d) : "—";
  const rows = fa.rows.map((x: any) => [esc(x.label), r(x.paidUsed), r(x.unpaidUsed), r(x.paidRateUsers), r(x.paidRateNonUsers)]);
  return section("adopt", "13b · Feature Adoption & Conversion",
    `<div class="card wide"><div class="card-h">${esc(fa.label)}</div>
     ${table(["Feature", `Paid users who used it (${num(fa.paid)})`, `Non-paid users who used it (${num(fa.unpaid)})`, "Paid rate · users", "Paid rate · non-users"], rows, "compact")}
     <div class="muted">${esc(fa.note)} "Hit the paywall" is an attempt, not usage.${fa.undated ? ` ${num(fa.undated)} payer(s) with no purchase event are left out.` : ""}</div></div>`,
    "observed association, not causation");
}

function renderRetentionSegments(rs: any): string {
  if (!rs || typeof rs !== "object") return section("retseg", "11b · Retention by Segment", absent("Retention by Segment", rs));
  // Wrapped in its section so the contents link still lands somewhere.
  if (isErr(rs)) return section("retseg", "11b · Retention by Segment", errorCard("Retention by Segment", rs));
  const c = (x: any) => x.d ? `${pct(x.value)} <span class="muted">${num(x.n)}/${num(x.d)}</span> ${small(x.d)}` : "—";
  return section("retseg", "11b · Retention by Segment",
    `<div class="card wide">${table(["Segment", "Users", "D1", "D3", "D7", "D14", "D30"],
      rs.rows.map((x: any) => [esc(x.label), num(x.users), c(x.d1), c(x.d3), c(x.d7), c(x.d14), c(x.d30)]), "compact")}
     <div class="muted">${esc(rs.note)}</div></div>`, "first-day segments");
}

const cell = (x: any) => x && x.d ? `${pct(x.value)} <span class="muted">${num(x.n)}/${num(x.d)}</span> ${small(x.d)}` : "—";

function renderAppVersions(av: any): string {
  if (!av || typeof av !== "object") return section("versions", "12b · App Versions", absent("App Versions", av));
  // Wrapped in its section so the contents link still lands somewhere.
  if (isErr(av)) return section("versions", "12b · App Versions", errorCard("App Versions", av));
  const rows = av.rows.map((r: any) => [
    `<code>${esc(r.version)}</code>`, num(r.users.value), num(r.activeInRange.value), num(r.newUsers.value),
    cell(r.activation7), cell(r.paid7), cell(r.d1), cell(r.d7),
    num(r.scansPerUser.value, 1), cell(r.failedScanRate), cell(r.paywallToPurchase),
    num(r.listingsPerUser.value, 2), num(r.huntsPerUser.value, 2),
  ]);
  return section("versions", "12b · App Versions",
    `<div class="card wide">${rows.length ? table(["Version", "Users", "Active in range", "First-version users", "Activation 7d", "Paid 7d", "D1", "D7",
      "Scans / user", "Failed scans", "Paywall → purchase", "Listings / user", "Hunts / user"], rows, "compact") : `<div class="muted">No versioned events yet.</div>`}
     <div class="muted">Activity columns count events written on that version; the first-version columns follow the users who started on it. ${esc(av.note)}</div>
     <div class="muted">Events with no version: ${cell(av.missingEvents)} · users with no versioned event: ${num(av.usersWithoutVersion.value)}</div></div>`,
    "event-time version");
}

// ── Scan reliability (Phase 6) ───────────────────────────────────────────────

const reasonLabel = (k: string) => esc(REASON_LABEL[k] ?? k);
/** The fail-screen buttons, as the user saw them. */
const ACTION_LABEL: Record<string, string> = {
  continue: "Continue anyway", back: "Back to Home / Hunt", retake: "Retake photo", sign_in: "Sign in",
  see_plans: "See plans / See Pro", scan_store: "Open Scan Store", update: "Update FlipStart",
};
const r8 = (x: any) => x && x.d ? `${pct(x.value)} <span class="muted">${num(x.n)}/${num(x.d)}</span> ${small(x.d)}` : `0% <span class="muted">0/0</span>`;
/** A rate card that reads 0% (not blank) before there is any data. */
const rateCard = (label: string, x: any) => m(label, { value: x && x.d ? x.value : 0, trust: "DERIVED", n: x?.n ?? 0, d: x?.d ?? 0 });

/**
 * Every fail screen, most shown first — "what fails most often" at a glance.
 * Zeros stay listed, so a screen nobody hit is visibly zero.
 */
export function renderFailScreenRanking(fs: any): string {
  if (!fs || !Array.isArray(fs.rows)) return "";
  const total = Number(fs.total) || 0;
  const top = fs.rows[0];
  const headline = total && top && top.shown
    ? `<div class="banner">Most hit: <b>${esc(top.label)}</b> — ${num(top.shown)} of ${num(total)} fail screens (${pct(top.share)}), ${num(top.users)} ${top.users === 1 ? "user" : "users"}.</div>`
    : `<div class="banner">No fail screens shown in this range.</div>`;
  const maxShown = Math.max(1, ...fs.rows.map((r: any) => Number(r.shown) || 0));
  const rows = fs.rows.map((r: any, i: number) => [
    r.shown ? num(i + 1) : "—",
    esc(r.label),
    `<span class="muted">${esc(r.group)}</span>`,
    num(r.shown),
    r.share === null || r.share === undefined ? "0%" : pct(r.share),
    num(r.users),
    `<div style="min-width:100px">${bar(r.shown / maxShown * 100)}</div>`,
    when(r.lastShown),
  ]);
  const older = (fs.olderApp ?? []).length
    ? `<div class="muted">Also ${num((fs.olderApp ?? []).reduce((a: number, x: any) => a + (Number(x.count) || 0), 0))} from app 2.1, which only says the general type: ${(fs.olderApp ?? []).map((x: any) => `${esc(x.key)} ${num(x.count)}`).join(" · ")}. Included in the total above.</div>`
    : "";
  return `<div class="card"><div class="card-h">Fail screens — most hit first ${badge("EXACT")} <span class="muted">— every user, the selected dates</span></div>
    ${headline}
    <div style="overflow-x:auto">${table(["#", "Screen", "Kind", "Times shown", "Share", "Users", "", "Last shown"], rows, "compact")}</div>
    <div class="muted">One count per screen shown. "Unsure result" screens follow a scan that ran (they show the result as Continue anyway); "Didn't run" means no result; "Account" screens are working as designed; "Before the scan" are messages from the scan button and the camera; "After the scan" are results screens that crashed.</div>
    ${older}</div>`;
}

/**
 * The Fail Screens & Scan Reliability section.
 *
 * ALWAYS the full layout — every fail screen, every card, every table row —
 * with zeros where there is no data yet, whatever went wrong behind it: the
 * metrics not loaded, a load error, or the scan_outcomes table missing. A
 * banner says which. (Before, a load error replaced the whole section with a
 * bare error card, so the contents link landed nowhere.)
 */
export function renderScanReliability(input: any): string {
  const title = "12c · Fail Screens & Scan Reliability";
  let sr = input;
  if (!sr || typeof sr !== "object" || isErr(sr)) {
    const why = !sr || typeof sr !== "object"
      ? "This load didn't include fail-screen data (the server may be running an older version), so everything shows zero."
      : `Loading fail-screen data failed, so everything shows zero: ${String(sr.error).slice(0, 200)}`;
    sr = buildScanReliability({ configured: false, note: why }, [], { startMs: null, endMs: null } as any);
  }
  const app = sr.app ?? {};
  const appBlock = `<div class="card"><div class="card-h">What the app showed ${badge("EXACT")} <span class="muted">— every user</span></div>
    ${grid([card("Fail screens shown", num(app.failedEvents)), card("Phone offline", num(app.offline), "never reached the server"), card("Server down (Railway)", num(app.serverDown), "the app reached the internet but not us")])}
    <div class="card-h">What users tapped</div>
    ${table(["Action", "Taps"], (app.actions ?? []).map((x: any) => [esc(ACTION_LABEL[x.key] ?? x.key), num(x.count)]), "compact")}
    <div class="card-h">Blocked screens shown (out of scans, update needed)</div>
    ${table(["Screen", "Shown"], (app.blocked ?? []).map((x: any) => [reasonLabel(x.key), num(x.count)]), "compact")}
    <div class="muted">Taps and blocked screens are recorded from the new app build onward; app 2.1 sends only scan_failed with an errorType.</div></div>`;
  const ranking = renderFailScreenRanking(app.screens);
  const problem = sr.problem ? `<div class="banner warn">${esc(sr.problem)}</div>` : "";
  const t = sr.tiers ?? { high: 0, medium: 0, low: 0, none: 0 };
  const tierRow = (label: string, n: number) => [esc(label), num(n), sr.results ? pct(n / sr.results) : "0%", bar(sr.results ? n / sr.results * 100 : 0)];
  const hardBlock = `<div class="card"><div class="card-h">Hard failures — no result ${badge("EXACT")}</div>
    ${grid([rateCard("Failure rate", sr.failureRate), card("Failed scans", num(sr.failures)), card("Cancelled by user", num(sr.stopped))])}
    ${table(["Reason", "Scans", "Share of attempts"], (sr.failuresByReason ?? []).map((x: any) => [reasonLabel(x.key), num(x.count), r8(x.share)]), "compact")}
    <div class="card-h">Blocked — working as designed, not counted as failures</div>
    ${table(["Reason", "Scans"], (sr.blockedByReason ?? []).map((x: any) => [reasonLabel(x.key), num(x.count)]), "compact")}</div>`;
  const softBlock = `<div class="card"><div class="card-h">Low-confidence results — soft fails ${badge("EXACT")}</div>
    ${grid([rateCard("Soft-fail rate", sr.softRate), rateCard("Continue anyway rate", sr.continueRate), card("Charged at once", num(sr.chargedAtOnce), "app 2.1, or past the daily cap")])}
    ${table(["Soft fail", "Scans", "Continued", "Back / Retake", "Left without choosing", "Waiting", "Charged at once", "Not charged, no choice", "Continue rate"],
      (sr.softByReason ?? []).map((x: any) => [reasonLabel(x.reason), num(x.count), num(x.continued), num(x.declined), num(x.abandoned), num(x.open), num(x.chargedAtOnce), num(x.noChoice), r8(x.continueRate)]), "compact")}
    <div class="muted">"Left without choosing": the app closed on the screen; after 10 minutes the hold expired and the scan went back to the user. "Charged at once": no choice could be recorded — app 2.1, or a user past the daily cap of uncharged soft fails. "Not charged, no choice": mostly "no item", which goes straight back.</div></div>`;
  const tierBlock = `<div class="card"><div class="card-h">Confidence of every result ${badge("EXACT")} <span class="muted">— for calibrating the tiers</span></div>
    ${table(["Tier", "Results", "Share", ""], [tierRow("HIGH", t.high), tierRow("MEDIUM", t.medium), tierRow("LOW", t.low), tierRow("No tier", t.none)], "compact")}
    <div class="muted">${num(sr.results)} results in range. "No tier": couldn't identify, or an older result without a tier.</div></div>`;
  return section("reliability", title,
    `${problem}${ranking}
     ${grid([card("Scan attempts", num(sr.attempts), "results + failures"), card("Results", num(sr.results)), card("Hard failures", num(sr.failures)), card("Soft fails", num(sr.soft))])}
     <div class="two">${hardBlock}${softBlock}</div><div class="two">${tierBlock}${appBlock}</div>
     <div class="muted">${esc(sr.note)}</div>`,
    "server + app");
}

function renderAcquisitionSource(as: any): string {
  if (!as || typeof as !== "object") return section("source", "2b · Acquisition Source", absent("Acquisition Source", as));
  // Wrapped in its section so the contents link still lands somewhere.
  if (isErr(as)) return section("source", "2b · Acquisition Source", errorCard("Acquisition Source", as));
  const seg = (rows: any[], head: string) => table([head, "Users", "Activation 7d", "Paid 7d", "Est. revenue", "Est. revenue / user", "Est. revenue / paid user"],
    rows.map((r: any) => [esc(r.key), num(r.users), cell(r.activation7), cell(r.paid7), usd(r.revenue.value), usd(r.revenuePerUser.value), usd(r.revenuePerPaidUser.value)]), "compact");
  const sourceBlock = as.tracked
    ? `<div class="card"><div class="card-h">By source</div>${seg(as.sources, "Source")}<div class="muted">CAC: ${esc(as.cac.note)}.</div></div>`
    : `<div class="card"><div class="card-h">By source ${badge("NOT_TRACKED")}</div><div class="muted">No event carries an acquisition source, so TikTok, Instagram, creators and campaigns cannot be told apart. Nothing is inferred to fill the gap. The day the app writes any of <code>${esc(as.keysRead.join(", "))}</code> into event metadata, this table fills itself in. CAC also needs marketing spend, which the dashboard does not have.</div></div>`;
  return section("source", "2b · Acquisition Source", sourceBlock +
    `<div class="two"><div class="card"><div class="card-h">By stated goal <span class="muted">— self-reported intent, not channel</span></div>${seg(as.byGoal, "Goal")}</div>
     <div class="card"><div class="card-h">By stated experience</div>${seg(as.byExperience, "Experience")}</div></div>
     <div class="muted">${esc(as.note)}</div>`);
}

function renderCostByPlan(cb: any): string {
  if (!cb || typeof cb !== "object") return section("costplan", "14b · Cost by Plan", absent("Cost by Plan", cb));
  // Wrapped in its section so the contents link still lands somewhere.
  if (isErr(cb)) return section("costplan", "14b · Cost by Plan", errorCard("Cost by Plan", cb));
  if (!cb.available) return section("costplan", "14b · Cost by Plan", `<div class="card muted">${esc(cb.note)}</div>`);
  const plan = (k: string) => {
    const x = cb[k]; if (!x) return "";
    const c = x.contribution;
    return `<div class="card"><div class="card-h">Current ${esc(k)} · ${num(x.users)} users ${small(x.users)}</div>${grid([
      m("Est. AI cost, lifetime", x.totalCost, { dp: 2 }), m("Est. cost / scan", x.costPerScan, { dp: 3 }),
      m("Mean / user", { value: x.perUser.mean, trust: "ESTIMATED" }, { dp: 3 }), m("Median / user", { value: x.perUser.median, trust: "ESTIMATED" }, { dp: 3 }),
      m("P90 / user", { value: x.perUser.p90, trust: "ESTIMATED" }, { dp: 3 }), m("Max / user", { value: x.perUser.max, trust: "ESTIMATED" }, { dp: 3 }),
      m("Scans", x.scans), m("Est. AI cost, last 30d", x.cost30Total, { dp: 2 }),
      ...(c ? [m("Est. contribution / user / month", { value: c.mean, trust: "ESTIMATED", d: c.users }, { dp: 2 }),
               m("…median", { value: c.median, trust: "ESTIMATED", d: c.users }, { dp: 2 }),
               m("…total per month", { value: c.total, trust: "ESTIMATED" }, { dp: 2 }),
               m("Costing more than they pay", { value: c.negative, trust: "ESTIMATED" })] : []),
    ])}</div>`;
  };
  return section("costplan", "14b · Cost by Plan", plan("free") + plan("monthly") + plan("annual") +
    `<div class="note-block">${badge("ESTIMATED")} ${esc(cb.note)}${cb.unpriced ? ` ${num(cb.unpriced)} subscriber(s) have no purchase event and cannot be priced.` : ""} Rates: scan ${usd(cb.rates.NORMAL, 3)}, hunt scan ${usd(cb.rates.HUNT, 3)}, listing ${usd(cb.rates.LISTING, 3)}.</div>`,
    "ESTIMATED — not profit");
}

function renderExecutive(x: any): string {
  const a = x.acquisition, mo = x.monetization, pw = x.paywalls, ret = x.retentionV2, ue = x.unitEconomics, sc = x.scans;
  if (isErr(a) || isErr(mo)) return errorCard("Executive", isErr(a) ? a : mo);
  const co = x.cohort;

  const scopeNote = co?.scope === "post_launch"
    ? `<div class="banner scope"><strong>Scope: Post Global Launch</strong> · ${esc(co.label)}${co.assumed ? ` <span class="muted">(time-of-day assumed 00:00 UTC — set FLIPSTART_GLOBAL_LAUNCH_AT to correct)</span>` : ""}<br><span class="muted">Only accounts created on or after this date are counted. Pre-launch accounts and anonymous pre-auth events appear in All Time only.</span></div>`
    : `<div class="banner scope"><strong>Scope: All Time</strong> <span class="muted">— includes ${num(x.preLaunchProfiles ?? 0)} pre-launch development-era accounts. Use Post Launch for business decisions.</span></div>`;
  const c = x.cutover;
  const banner = c?.configured
    ? `<div class="banner ok">Analytics V4 active since ${esc(c.at)}</div>`
    : `<div class="banner warn"><strong>Awaiting Analytics V4 client release.</strong> ${esc(c?.status ?? "")} — V4-only metrics show “Not yet available” until then.</div>`;
  /**
   * One headline number per question, each naming its own window, so the
   * section answers "how are we doing" at a glance. Everything that used to
   * be here is still one click away under "More metrics".
   */
  const ec = x.executiveCore && !isErr(x.executiveCore) ? x.executiveCore : {};
  const core = grid([
    m("New users · 7d", ec.newUsers7 ?? a.new7),
    m("Activation · acquired in range", ec.activation ?? null),
    m("WAU · rolling 7d", ec.wau ?? a.wau),
    m("Paying users · now", ec.payingUsers ?? mo.totalPaying),
    m("Paywall viewer → purchase · in range", ec.viewerToPurchase ?? mo.viewToPurchase),
    m("D7 retention · cohort in range", ec.d7 ?? null),
    ec.pricingConversion
      ? m(`${ec.pricingEraLabel ?? "Current era"} · 7-day paid conversion`, ec.pricingConversion)
      : m("Pricing era conversion", { value: null, trust: "NOT_TRACKED", available: false, note: "no users with a complete 7-day window yet" }),
    m("Top user · scans 30d", ec.topUserScans30 === null || ec.topUserScans30 === undefined ? null : { value: ec.topUserScans30, trust: "EXACT", note: "highest in scope" }),
  ]);
  return section("exec", "1 · Executive", renderAttention(x.founderAttention) + scopeNote + banner + legend() + core +
    `<details class="more"><summary>More metrics</summary>` + grid([
    m("Total users", a.totalUsers), m("New users in range", a.newInRange), m("New users 7d", a.new7), m("New users 30d", a.new30),
    m("DAU", a.dau), m("WAU", a.wau), m("MAU", a.mau), m("DAU / MAU", a.dauMau, { fmt: "pct" }),
    m("Scans 7d", a && !isErr(a) ? a.scans7 : null),
    m("Activated (1+ scan)", x.activation && !isErr(x.activation) ? x.activation.activationRate : null),
    m("Paywall viewers 7d", pw && !isErr(pw) ? pw.viewers7 : null), m("Purchases 7d", pw && !isErr(pw) ? pw.purchases7 : null),
    m("Current Monthly", mo.currentMonthly), m("Current Annual", mo.currentAnnual), m("Holding pack scans", mo.scanPackHolders),
    m("Subscription purchases · in range", mo.purchaseCompletions),
    m("Revenue", mo.revenue), m("MRR", mo.mrr),
    m("Est. API spend (in range)", ue && !isErr(ue) ? ue.estimatedSpend : null, { dp: 2 }),
    m("D7 retention", ret && !isErr(ret) ? ret.d7 : null),
  ]) + `</details>`);
}

function renderAcquisition(a: any): string {
  // Wrapped in its section so the contents link still lands somewhere.
  if (isErr(a)) return section("acq", "2 · Acquisition / Users", errorCard("Acquisition", a));
  /**
   * The selected range comes FIRST and is visually separated from the fixed
   * 7d/30d cards. Those two groups answer different questions — "what did my
   * campaign do" versus "how are we doing right now" — and mixing them in one
   * grid is what made the range figure impossible to find.
   */
  const rangeBlock = `<div class="card"><div class="card-h">Selected window · ${esc(a.rangeLabel ?? "")}</div>${grid([
    m("New users in range", a.newInRange),
    m("Signups / day", a.signupsPerDay, { dp: 2 }),
    textCard("Peak signup day", a.peakSignupDay, "EXACT", a.peakSignupDay ? `${num(a.peakSignupCount?.value)} signups` : "no signups in range"),
    m("Share of cohort", a.shareOfCohort),
  ])}<div class="muted">Counted by account creation date inside the window, in ${esc("Central Time")}. ${esc(String(a.rangeDays ?? 0))} day(s) in range.</div></div>`;
  const trend = table(["Day", "New", "Active"], a.trend.slice(-14).reverse().map((r: any) => [esc(r.day), num(r.newUsers), num(r.active)]), "compact");
  const growth = `<div class="spark">${a.cumulative.map((p: any) => `<span title="${esc(p.day)}: ${p.users}" style="height:${Math.max(2, p.users / (a.cumulative.at(-1)?.users || 1) * 40)}px"></span>`).join("")}</div><div class="muted">Cumulative users across the charted window</div>`;
  return section("acq", "2 · Acquisition / Users", rangeBlock + `<div class="card"><div class="card-h">Current momentum <span class="muted">— fixed windows, not affected by the date selection</span></div>${grid([
    m("Total profiles", a.totalUsers), m("New today", a.newToday), m("New 7d", a.new7), m("New 30d", a.new30),
    m("Active today", a.dau), m("Active 7d (rolling)", a.wau), m("Active 30d (rolling)", a.mau),
  ])}</div>` + `<div class="two"><div class="card"><div class="card-h">Cumulative growth</div>${growth}</div><div class="card"><div class="card-h">Daily trend <span class="muted">— last 14 charted days, Central</span></div>${trend}</div></div>
  <div class="note-block">${badge("NOT_TRACKED")} ${esc(a.attributionNote)}</div>`);
}

function renderActivation(x: any): string {
  // Wrapped in its section so the contents link still lands somewhere.
  if (isErr(x)) return section("act", "3 · Activation", errorCard("Activation", x));
  return section("act", "3 · Activation", grid([
    m("Activation rate", x.activationRate), m("Never scanned", x.neverScanned), m("Onboarding completed (event)", x.onboardingCompleted),
    m("Median account → first scan", x.hoursToFirstScanMedian, { fmt: "hrs" }), m("Mean account → first scan", x.hoursToFirstScanMean, { fmt: "hrs" }),
  ]) + `<div class="card"><div class="card-h">Lifecycle (nested — each stage is a subset of the one above)</div>${funnel(x.lifecycle)}</div>`,
  "scans are scan_completed events, not saved items");
}

function renderMonetization(mo: any): string {
  // Wrapped in its section so the contents link still lands somewhere.
  if (isErr(mo)) return section("mon", "4 · Monetization", errorCard("Monetization", mo));
  return section("mon", "4 · Monetization", grid([
    m("Current Free", mo.currentFree), m("Current Monthly", mo.currentMonthly), m("Current Annual", mo.currentAnnual), m("Total paying", mo.totalPaying),
    m("Holding pack scans (ledger)", mo.scanPackHolders), m("Pack purchases Apple-approved", mo.scanPackApproved), m("Paywall viewers (in range)", mo.paywallViewers),
    m("Purchase starts", mo.purchaseStarts), m("Purchase completions", mo.purchaseCompletions),
    m("Cancellations", mo.purchaseCancellations), m("Failures", mo.purchaseFailures),
    m("Viewer → purchase", mo.viewToPurchase),
    m("Monthly purchases", mo.monthlyPurchases), m("Annual purchases", mo.annualPurchases), m("Scan-pack purchases", mo.scanPackPurchases),
    m("Known revenue", mo.revenue), m("MRR", mo.mrr),
  ]) + `<div class="card"><div class="card-h">Plan selections in range (all paywalls)</div>${buckets({ Monthly: mo.planSelection.monthly, Annual: mo.planSelection.annual }, undefined, "Selections")}</div>`);
}

function renderPaywalls(pw: any): string {
  // Wrapped in its section so the contents link still lands somewhere.
  if (isErr(pw)) return section("pw", "5 · Paywalls", errorCard("Paywalls", pw));
  const rows = (pw.rows as PaywallRow[]).map(r => [
    `<code>${esc(r.source)}</code>`, num(r.impressions), num(r.uniqueViewers), num(r.impressionsPerViewer, 2),
    num(r.monthlySelected), num(r.annualSelected), num(r.purchaseStarts), num(r.purchases), num(r.cancelled), num(r.failed),
    r.impressionToPurchase.d ? rate(r.impressionToPurchase.n!, r.impressionToPurchase.d) : "—",
    r.startToCompletion.d ? rate(r.startToCompletion.n!, r.startToCompletion.d) : "—",
  ]);
  const v4 = (pw.rows as PaywallRow[]).map(r => {
    const u = r.continueFree.available === false;
    const e = r.entitlementAtImpression;
    return [`<code>${esc(r.source)}</code>`,
      u ? "—" : num(r.continueFree.value), u ? "—" : num(r.closed.value), u ? "—" : num(r.backgroundedActive.value),
      u ? "—" : num(r.avgScansRemainingAtImpression.value, 1),
      e ? `F ${e.free} · M ${e.monthly} · A ${e.annual} · ? ${e.unknown}` : "—"];
  });
  const v4Block = pw.rows[0]?.continueFree?.available === false
    ? na("Post-cutover outcomes (Continue Free, close, backgrounded, balance and entitlement at impression)")
    : `<div class="card"><div class="card-h">Post-cutover outcomes</div>${table(["Paywall", "Continue Free", "Closed", "Backgrounded w/ paywall", "Avg scans left", "Entitlement F/M/A/?"], v4)}</div>`;
  return section("pw", "5 · Paywalls", grid([
    textCard("Most shown (in range)", pw.mostShown), m("Unique viewers (in range)", pw.totalViewers),
    m("Viewers 7d", pw.viewers7), m("Purchases 7d", pw.purchases7), m("Legacy dismissed rows", pw.legacyDismissed),
  ]) + `<div class="card"><div class="card-h">Per-paywall comparison (sorted by impressions)</div>${table(["Paywall", "Impr.", "Uniq", "Impr/viewer", "Monthly sel.", "Annual sel.", "Starts", "Purchases", "Cancel", "Fail", "Impr→purchase", "Start→complete"], rows)}</div>
  <div class="two"><div class="card"><div class="card-h">Repeat exposure (impressions per viewer)</div>${buckets(pw.repeatExposure)}</div>${v4Block}</div>`,
  "all paywall events are historical-safe; V4 outcomes are gated");
}

function renderOnboardingOffer(o: any): string {
  // Wrapped in its section so the contents link still lands somewhere.
  if (isErr(o)) return section("offer", "6 · Onboarding Offer", errorCard("Onboarding offer", o));
  const L = o.legacy;
  const legacy = funnel([
    { stage: "Offer shown", users: L.shown.value }, { stage: "Plan selected", users: L.planSelected.value },
    { stage: "Purchase started", users: L.purchaseStarted.value }, { stage: "Purchase completed", users: L.purchaseCompleted.value },
  ]);
  const v4 = o.v4.available ? funnel([
    { stage: "Offer shown", users: o.v4.shown.value }, { stage: "Monthly selected", users: o.v4.monthlySelected.value },
    { stage: "Annual selected", users: o.v4.annualSelected.value }, { stage: "Purchase started", users: o.v4.purchaseStarted.value },
    { stage: "Purchase completed", users: o.v4.purchaseCompleted.value }, { stage: "Continue Free", users: o.v4.continueFree.value },
    { stage: "Backgrounded with offer open", users: o.v4.backgroundedActive.value },
  ]) + grid([m("Later activity", o.v4.laterActivity), m("No later activity", o.v4.noLaterActivity)]) +
    `<div class="note-block">${badge("DERIVED")} Abandonment: ${esc(o.v4.abandonmentDefinition)}</div>`
    : na("Post-cutover exact funnel (Monthly / Annual selected, Continue Free, backgrounded, later activity)");
  return section("offer", "6 · Onboarding Offer", `<div class="two">
    <div class="card"><div class="card-h">All-time funnel</div>${legacy}${grid([m("Conversion", L.conversion), m("Inferred Continue Free", L.inferredContinueFree)])}</div>
    <div class="card"><div class="card-h">Post-cutover</div>${v4}</div></div>`);
}

function renderPaidJourneys(pj: any): string {
  // Wrapped in its section so the contents link still lands somewhere.
  if (isErr(pj)) return section("paid", "7 · Paid User Journeys", errorCard("Paid user journeys", pj));
  const tp = pj.hoursToPay, sb = pj.scansBeforePay;
  const agg = grid([
    m("Paying users", pj.payingUsers), m("With confirmed purchase event", pj.withKnownPurchaseTime),
    m("Mean account → pay", { value: tp.mean, trust: "DERIVED", d: tp.d }, { fmt: "hrs" }), m("Median account → pay", { value: tp.median, trust: "DERIVED", d: tp.d }, { fmt: "hrs" }),
    m("Fastest", { value: tp.fastest, trust: "DERIVED" }, { fmt: "hrs" }), m("Slowest", { value: tp.slowest, trust: "DERIVED" }, { fmt: "hrs" }),
    m("Mean scans before pay", { value: sb.mean, trust: "DERIVED", d: sb.d }, { dp: 1 }), m("Median scans before pay", { value: sb.median, trust: "DERIVED", d: sb.d }, { dp: 1 }),
    m("Mean sessions before pay", { value: pj.sessionsBeforePay.mean, trust: "DERIVED", d: pj.sessionsBeforePay.d }, { dp: 1 }),
    m("Mean paywall impressions before pay", { value: pj.paywallsBeforePay.mean, trust: "DERIVED", d: pj.paywallsBeforePay.d }, { dp: 1 }),
  ]);
  const rows = (pj.journeys as PaidJourney[]).slice(0, 200).map(j => [
    qBadge(j.quality, j.qualityReasons), esc(j.displayName ?? "—"), esc(j.email ?? "—"), userLink(j.userId, j.userId.slice(0, 8) + "…"),
    esc(j.currentPlan), j.firstPaidKind === "scan_pack" ? `${esc(j.firstPaidKind)} ${j.packGrantConfirmed ? "✓ granted" : `<span class="muted" title="Apple approved but the ledger holds no pack scans — the server may have refused the grant">? unconfirmed</span>`}` : esc(j.firstPaidKind), esc(j.firstPaidProduct ?? "—"),
    when(j.accountCreatedAt ?? j.profileCreatedAt), when(j.firstScanAt), when(j.firstPaywallAt), when(j.firstPurchaseAt), when(j.latestActivityAt),
    hrs(j.hoursAccountToPay), hrs(j.hoursFirstScanToPay), hrs(j.hoursFirstPaywallToPay),
    num(j.scansBeforePay), num(j.sessionsBeforePay), num(j.activeDaysBeforePay), num(j.paywallImpressionsBeforePay), num(j.uniquePaywallSourcesBeforePay),
    esc(j.firstPaywallSource ?? "—"), esc(j.lastPaywallBeforePay ?? "—"), j.convertingPaywall ? `<code>${esc(j.convertingPaywall)}</code>` : `<span class="muted">UNKNOWN</span>`,
    num(j.scanStoreVisitsBeforePay), num(j.huntEventsBeforePay), num(j.listingsBeforePay),
  ]);
  const attribution = table(["Converting paywall", "Purchases"], pj.byConvertingPaywall.map((r: any) => [r.source === "UNKNOWN" ? `<span class="muted">UNKNOWN</span>` : `<code>${esc(r.source)}</code>`, num(r.purchases)]));
  return section("paid", "7 · Paid User Journeys", agg +
    `<div class="two"><div class="card"><div class="card-h">Time to pay (mutually exclusive)</div>${buckets(pj.timeBuckets)}<div class="muted">Placed by first match: same session → same Central day → &lt;24h → 1–3d → 4–7d → 8–14d → 15+d.</div></div>
     <div class="card"><div class="card-h">Scans before first payment</div>${buckets(pj.scanBuckets)}</div></div>
     <div class="card"><div class="card-h">Purchases by converting paywall</div>${attribution}<div class="muted">Direct attribution = source on purchase_completed, confirmed by the preceding purchase_started. Disagreement → UNKNOWN.</div></div>
     <div class="card wide"><div class="card-h">Every paying user (newest first, up to 200) — founder-only, contains email</div>
     ${table(["Data", "Name", "Email", "UID", "Plan", "Kind", "Product", "Account", "First scan", "First paywall", "First purchase", "Last active",
              "Acct→pay", "Scan→pay", "Paywall→pay", "Scans", "Sessions", "Days", "PW impr.", "PW srcs", "First PW", "Last PW", "Converting", "Store visits", "Hunt", "Listings"], rows, "compact wrap")}</div>`,
    pj.smallSample ? "small sample" : "");
}

/** Where people entered the Scan Store from, in plain words. */
const ENTRY_LABEL: Record<string, string> = {
  home_cta: "Scans-remaining popup", paywall: "Paywall's scan-store button", home_gate: "Scan button, Pro & out of scans (home)",
  tab_gate: "Scan button, Pro & out of scans (tab bar)", hunt_active: "Scan button, Pro & out of scans (hunt)",
  scan_fail: "Scan failed screen", settings: "Settings", unknown: "Unknown (older app build)",
};
const PAYWALL_LABEL = (s: string, limit: number) => s === "scan_limit" ? `${limit}-scan limit paywall` : s.replace(/_/g, " ");

/**
 * Scan Store deep dive — the founder's questions, answered in order. Every
 * value escaped; nothing here names a user.
 */
export function renderScanStoreInsights(x: any): string {
  if (!x || isErr(x)) return isErr(x) ? errorCard("Scan Store deep dive", x) : "";
  const r = (v: any) => (v && v.d ? rate(v.n, v.d) : "—");
  const since = x.since.available
    ? `<div class="card"><div class="card-h">Pack purchases since the 2.1.1 release ${badge("EXACT")}</div>${grid([
        m("Purchases", { value: x.since.purchases, trust: "EXACT" }), m("Buyers", { value: x.since.buyers, trust: "EXACT" }),
        m("Repeat buyers", { value: x.since.repeatBuyers, trust: "EXACT" }), m("Scans sold", { value: x.since.scansSold, trust: "EXACT" })])}
        <div class="muted">Every purchase from ${esc(formatCentralDateTime(x.since.at))} (ANALYTICS_V4_CUTOVER_AT) on, whatever date range is selected. Your own TestFlight test buys after that would be included.</div></div>`
    : na("Pack purchases since the 2.1.1 release", "Set ANALYTICS_V4_CUTOVER_AT to count purchases from the release on.");

  const u = x.packUsage;
  const usage = !u ? "" : u.buyers === 0
    ? na("Pack scans used after purchase", "No real pack buyers yet.")
    : `<div class="card"><div class="card-h">Pack scans used after purchase ${badge("DERIVED")} <span class="muted">— everyone who has bought a pack since 2.1.1, as of now</span></div>${grid([
        m("Buyers", { value: u.buyers, trust: "EXACT" }), m("Scans bought", { value: u.bought, trust: "DERIVED" }),
        m("Used", { value: u.used, trust: "DERIVED" }), m("Still unused", { value: u.left, trust: "EXACT" }),
        m("Share used", u.usedShare), m("Median share used per buyer", { value: u.medianUsedPct, trust: "DERIVED" }, { fmt: "pct" }),
        m("Median days since first purchase", { value: u.medianDaysSinceFirstPurchase, trust: "EXACT" }, { dp: 1 })])}
      ${table(["How much of their pack scans buyers have used", "Buyers"], u.buckets.map((b: any) => [esc(b.label), num(b.users)]))}
      ${table(["Plan when they first bought", "Buyers", "Share of pack scans used"], u.byPlan.map((p: any) => [esc(p.plan), num(p.buyers), r(p.usedShare)]))}
      <div class="muted">Used = scans bought − today's pack balance. Pack scans are spent last (after free or Pro scans), so a Pro buyer only dips in once their monthly allowance is gone.
      Scans bought counts every pack each buyer ever bought, earlier test buys included, because those sit in the same balance.
      ${u.mismatched ? ` Left out: ${num(u.mismatched)} buyer(s) holding more pack scans than their recorded purchases (a purchase event was lost, or scans were added by hand).` : ""}
      ${u.noUsageRow ? ` Left out: ${num(u.noUsageRow)} buyer(s) with no usage row.` : ""}
      ${u.notLanded ? ` Not counted as bought: ${num(u.notLanded)} purchase(s) the app saw not reach the pack balance (e.g. a TestFlight buy the live server refused).` : ""}
      ${u.v2At ? ` Pack sizes switch to the new pricing at ${esc(formatCentralDateTime(u.v2At))}.` : " FLIPSTART_SCAN_PACKS_V2_AT isn't set, so purchases from older app builds are counted at the old pack sizes."}</div></div>`;

  const ap = x.atPurchase;
  const PLAN_NAME: Record<string, string> = { free: "Free", monthly: "Monthly", annual: "Annual" };
  const atBuy = !ap ? "" : ap.purchases === 0
    ? na("Scans left when they bought", "No real pack purchases in this range.")
    : `<div class="card"><div class="card-h">Scans left when they bought a pack ${badge("DERIVED")} <span class="muted">— real purchases in this range</span></div>
      ${table(["Plan at purchase", "Purchases", "Median plan scans left", "0", "1–4", "5–14", "15–49", "50+", "Completely out of scans", "Still had pack scans"],
        ap.byPlan.filter((p: any) => p.purchases > 0).map((p: any) => [esc(PLAN_NAME[p.plan] ?? p.plan), num(p.purchases), num(p.medianPlanLeft, 1),
          ...p.buckets.map((b: any) => num(b.purchases)), num(p.outOfScans), num(p.hadPackLeft)]))}
      <div class="muted">"Plan scans left" is free scans left for Free users and this month's Monthly/Annual scans left for Pro. Known for ${num(ap.known)} of ${num(ap.purchases)} purchases (older builds: read from the tap on that pack in the hour before).</div></div>`;

  const pw = `<div class="card"><div class="card-h">Paywall → Scan Store → purchase ${badge("EXACT")} <span class="muted">— unique users</span></div>
    ${table(["Paywall", "Saw it", "→ Scan Store", "→ bought a pack (24h)", "→ subscribed instead"],
      x.paywallToStore.map((p: any) => [esc(PAYWALL_LABEL(p.source, x.freeLimit)), num(p.shown), r(p.toStoreRate), num(p.boughtPack), num(p.subscribed)]))}
    <div class="muted">Scan-store button taps on any paywall in this range: ${num(x.storeButtonClicks)} (logged from the next app build on).
    Only people who saw that paywall in this range are counted as going to the store, so the rate can't pass 100%. A pack counts as bought if it was bought in that same store visit (older builds: within 24h).
    ${x.paywallToStore.some((p: any) => p.inferredVisits > 0) ? " Older builds didn't say which paywall sent people; those visits count for the 15-scan paywall if the person saw it in the 30 minutes before (it was the only one with a Scan Store button)." : ""}</div></div>`;

  const sb = x.scansBeforeFirstVisit;
  const before = `<div class="card"><div class="card-h">Scans done before the first Scan Store visit ${badge("EXACT")}</div>
    ${grid([m("Users (first visit in range)", { value: sb.users, trust: "EXACT" }), m("Median scans", { value: sb.median, trust: "EXACT" }),
            m("Average scans", { value: sb.mean, trust: "EXACT" }, { dp: 1 }), m("Median scans before first real pack purchase", { value: sb.beforeFirstPurchase.median, trust: "EXACT", d: sb.beforeFirstPurchase.users })])}
    ${table(["Scans before first visit", "Users"], sb.buckets.map((b: any) => [esc(b.label), num(b.users)]))}
    <div class="muted">Completed scans, all time, before the user's first-ever store visit (for users whose first visit is in this range). The purchase figure counts real buyers only: first purchase since 2.1.1, in this range. Free accounts hit the paywall at ${num(x.freeLimit)}.</div></div>`;

  const p = x.popup;
  const popup = p.available
    ? `<div class="card"><div class="card-h">Scans-remaining popup ${badge("EXACT")}</div>${grid([
        m("Times opened", { value: p.opens, trust: "EXACT" }), m("People who opened it", { value: p.users, trust: "EXACT" }),
        m("→ Scan Store", { value: p.toStore, trust: "EXACT" }), m("Pressed Got it", { value: p.gotIt, trust: "EXACT" }),
        m("Tapped away", { value: p.dismissed, trust: "EXACT" }), m("Opened it, never tapped its store button", { value: p.usersNeverToStore, trust: "EXACT" }),
        m("Opened at 0 scans", { value: p.openedAtZero, trust: "EXACT" }), m("Median seconds open", { value: p.medianSecondsOpen, trust: "EXACT" }, { dp: 1 })])}
        <div class="muted">Popup → store: ${r(p.toStoreRate)}</div></div>`
    : na("Scans-remaining popup", "Starts with the next app build — tapping the scans pill wasn't logged before.");

  const plans = ["free", "monthly", "annual", "unknown"];
  const planRow = (label: string, o: any) => [esc(label), ...plans.map(k => num(o[k]))];
  const byPlan = `<div class="card"><div class="card-h">Free vs Pro in the Scan Store ${badge("EXACT")} <span class="muted">— unique users, plan at the time</span></div>
    ${table(["", "Free", "Monthly", "Annual", "Unknown"], [planRow("Visited", x.byPlan.visitors), planRow("Tapped a pack", x.byPlan.tappers), planRow("Bought", x.byPlan.buyers)])}</div>`;

  const packs = `<div class="card"><div class="card-h">Which pack gets tapped ${badge("EXACT")}</div>
    ${table(["Pack", "Taps", "Share of taps", "Free taps", "Pro taps", "Purchases"],
      x.packs.map((k: any) => [`${esc(k.name)} · ${num(k.scans)} scans`, num(k.taps), r(k.tapShare), num(k.freeTaps), num(k.proTaps), num(k.purchases)]))}
    <div class="muted">A tap is pressing a pack's Buy button (the App Store sheet opens). Purchases are in this date range. Pack sizes shown are today's.</div></div>`;

  const v = x.visits;
  const visits = v.available
    ? `<div class="card"><div class="card-h">How Scan Store visits end ${badge("EXACT")}</div>${grid([
        m("Visits", { value: v.total, trust: "EXACT" }), m("Left without tapping a pack", { value: v.leftWithoutTapping, trust: "EXACT" }),
        m("Tapped, didn't buy", { value: v.tappedNoPurchase, trust: "EXACT" }), m("Bought", { value: v.bought, trust: "EXACT" }),
        m("Median seconds in store", { value: v.medianSeconds, trust: "EXACT" }, { dp: 0 }),
        m("No close recorded (app closed in store)", { value: v.noClose, trust: "EXACT" })])}
        ${table(["Came from", "Visits", "Tapped a pack", "Bought"], v.bySource.map((s: any) =>
          [esc(ENTRY_LABEL[s.source] ?? s.source), num(s.visits), r(s.tapRate), r(s.buyRate)]))}</div>`
    : na("How Scan Store visits end", "Starts with the next app build — leaving the store wasn't logged before.");

  return `<h3>Deep dive</h3>${since}${usage}${atBuy}${pw}${before}${popup}${byPlan}${packs}${visits}`;
}

function renderScanStore(s: any, insights?: any): string {
  // Wrapped in its section so the contents link still lands somewhere.
  if (isErr(s)) return section("store", "8 · Scan Store", errorCard("Scan Store", s) + renderScanStoreInsights(insights));
  const skus = table(["Pack", "Scans", "Attempts", "Purchases", "Cancels", "Failures", "Attempt → purchase"],
    s.skus.map((k: any) => [`${esc(k.name)} <code>${esc(k.sku)}</code>`, num(k.scans), num(k.attempts), num(k.purchases), num(k.cancels), num(k.failures), k.conversion.d ? rate(k.conversion.n, k.conversion.d) : "—"]));
  const v4 = s.v4.available
    ? `<div class="card"><div class="card-h">Post-cutover context</div>${table(["Entry source", "Opens"], s.v4.entrySource.map((r: any) => [`<code>${esc(r.source)}</code>`, num(r.opens)]))}
       ${grid([m("Opened at 0 scans", s.v4.atZero), m("Opened above 0", s.v4.aboveZero), m("Avg balance at open", s.v4.avgBalanceAtOpen, { dp: 1 }), m("Avg scans left at attempt", s.v4.avgRemainingAtAttempt, { dp: 1 })])}
       <div class="muted">Visitors by entitlement: Free ${s.v4.entitlement.free} · Monthly ${s.v4.entitlement.monthly} · Annual ${s.v4.entitlement.annual} · Unknown ${s.v4.entitlement.unknown}</div></div>`
    : na("Post-cutover context (entry source, entitlement, balance at open, users at 0 scans)");
  /**
   * Every historical scan-pack "purchase" is test activity — sandbox buys
   * during TestFlight QA, some of which the server then refused. There has
   * never been a genuine sale. Opens and browsing ARE real and useful; the
   * purchase counts must not be read as revenue or customers.
   */
  const contamination = `<div class="banner warn"><strong>Historical Scan Pack purchase events include test activity.</strong> <span class="muted">Purchases before the 2.1.1 release are TestFlight test buys, so the all-time purchase counts below are marked ${TRUST_LABEL.LEGACY.toUpperCase()}. For real sales, use "Pack purchases since the 2.1.1 release" in the deep dive. Opens and browsing are real throughout.</span></div>`;
  return section("store", "8 · Scan Store", contamination + grid([
    m("Opens", s.opens), m("Unique visitors", s.uniqueVisitors), m("Repeat visitors", s.repeatVisitors), m("Opens / visitor", s.opensPerVisitor, { dp: 2 }),
    m("Visitor → buyer", { ...s.visitorToBuyer, trust: "LEGACY", note: "test-contaminated" }),
    m("Completed", { value: s.outcomes.completed, trust: "LEGACY", note: "test activity" }),
    m("Cancelled", { value: s.outcomes.cancelled, trust: "LEGACY", note: "test activity" }),
    m("Failed", { value: s.outcomes.failed, trust: "LEGACY", note: "test activity" }),
    m("Median first visit → purchase", { value: s.hoursFirstVisitToPurchase.median, trust: "DERIVED", d: s.hoursFirstVisitToPurchase.d }, { fmt: "hrs" }), m("Revenue", s.revenue),
  ]) + `<div class="two"><div class="card"><div class="card-h">Funnel (unique users)</div>${funnel(s.funnel)}<div class="muted">StoreKit sheet presentation is not tracked, so it is not a stage.</div></div>
  <div class="card"><div class="card-h">Entry mode (legacy field)</div>${table(["Mode", "Opens"], s.entryMode.map((r: any) => [esc(r.mode), num(r.opens)]))}</div></div>
  <div class="card"><div class="card-h">Per SKU</div>${skus}</div>${v4}${renderScanStoreInsights(insights)}`, s.smallSample ? "small sample" : "");
}

function cohortCard(c: any): string {
  const allow = c.allowance
    ? `<div class="muted">Allowance: mean ${num(c.allowance.meanUsed, 1)} / ${num(c.allowance.limit)} used this period (${pct(c.allowance.meanPct)}) · median ${num(c.allowance.medianUsed, 1)} · n=${c.allowance.d} ${small(c.allowance.d)}<br>${esc(c.allowance.note)}</div>`
    : "";
  return `<div class="card"><div class="card-h">Current ${esc(c.plan)} · ${num(c.users.value)} users ${badge("EXACT")}</div>
    ${grid([m("Active today", c.activeToday), m("Active 7d", c.active7), m("Active 30d", c.active30),
      m("Lifetime scans / user (mean)", { value: c.lifetimeScansMean, trust: "DERIVED" }, { dp: 1 }), m("Lifetime scans / user (median)", { value: c.lifetimeScansMedian, trust: "DERIVED" }, { dp: 1 }),
      m("Scans 7d / user", { value: c.scans7PerUser, trust: "DERIVED" }, { dp: 2 }), m("Scans 30d / user", { value: c.scans30PerUser, trust: "DERIVED" }, { dp: 2 }),
      m("Sessions / user", { value: c.sessionsPerUser, trust: "DERIVED" }, { dp: 1 }), m("Active days / user", { value: c.activeDaysPerUser, trust: "DERIVED" }, { dp: 1 }),
      m("Listings", { value: c.listings, trust: "EXACT" }), m("Hunt users", { value: c.huntUsers, trust: "EXACT" }), m("Account age (mean days)", { value: c.accountAgeDaysMean, trust: "DERIVED" }, { dp: 1 })])}
    ${allow}<div class="muted">${esc(c.classificationNote)}</div></div>`;
}
function renderCohorts(c: any): string {
  // Wrapped in its section so the contents link still lands somewhere.
  if (isErr(c)) return section("cohorts", "9 · User Cohorts (current plan)", errorCard("Cohorts", c));
  return section("cohorts", "9 · User Cohorts (current plan)", cohortCard(c.free) + cohortCard(c.monthly) + cohortCard(c.annual));
}

function renderFree(f: any): string {
  // Wrapped in its section so the contents link still lands somewhere.
  if (isErr(f)) return section("free", "10 · Free User Behaviour", errorCard("Free user behaviour", f));
  return section("free", "10 · Free User Behaviour", grid([
    m("Current Free users", f.users), m("Never scanned", f.neverScanned), m("Exhausted 15 free scans", f.exhausted), m("Exhaustion rate", f.exhaustedRate),
    m("Lifetime scans (mean)", { value: f.lifetimeMean, trust: "DERIVED" }, { dp: 1 }), m("Lifetime scans (median)", { value: f.lifetimeMedian, trust: "DERIVED" }, { dp: 1 }),
    m("Active days (mean)", { value: f.activeDaysMean, trust: "DERIVED" }, { dp: 1 }), m("Active days (median)", { value: f.activeDaysMedian, trust: "DERIVED" }, { dp: 1 }),
    m("Median time to first scan", { value: f.hoursToFirstScanMedian.value, trust: "DERIVED", d: f.hoursToFirstScanMedian.d }, { fmt: "hrs" }),
    m("Ever scanned", f.everScanned), m("Reached 2+", f.reached2Plus), m("Reached 3+", f.reached3Plus), m("Reached 5+", f.reached5Plus), m("Reached 10+", f.reached10Plus),
    m("Active 7d", f.active7), m("Active 30d", f.active30),
    m("Lifetime P75", { value: f.lifetimeP75 ?? null, trust: "DERIVED" }, { dp: 1 }), m("Lifetime P90", { value: f.lifetimeP90 ?? null, trust: "DERIVED" }, { dp: 1 }),
    m("Lifetime max", { value: f.lifetimeMax ?? null, trust: "EXACT" }),
    m("First scan ≤ 10 min", f.firstScanWithin10m), m("First scan same day", f.firstScanSameDay),
    m("First scan ≤ 24h", f.firstScanWithin24h), m("First scan ≤ 7d", f.firstScanWithin7d),
    m("Activated late", f.delayedActivation), m("Still not activated", f.stillNotActivated),
  ]) + `<div class="two"><div class="card"><div class="card-h">Lifetime scans consumed</div>${buckets(f.buckets)}</div>
  <div class="card"><div class="card-h">Post-cutover</div>${na("Paywall views and conversion by scans consumed; outcome by scans remaining")}<div class="muted">${esc(f.balanceHistoryNote)}</div></div></div>`);
}

function renderRetentionV2(r: any): string {
  // Wrapped in its section so the contents link still lands somewhere.
  if (isErr(r)) return section("ret", "11 · Retention", errorCard("Retention", r));
  return section("ret", "11 · Retention", grid([m("D1", r.d1), m("D3", r.d3), m("D7", r.d7), m("D14", r.d14), m("D30", r.d30)]) +
    `<div class="muted">Anchor: ${esc(r.anchor)} · timezone ${esc(r.timezone)} · ${num(r.cohortUsers)} users with an anchor. Only users old enough for each window are counted in its denominator.</div>`,
    "re-anchored on first activity, not profile creation");
}

function renderSessionsV2(s: any): string {
  // Wrapped in its section so the contents link still lands somewhere.
  if (isErr(s)) return section("sess", "12 · Sessions", errorCard("Sessions", s));
  return section("sess", "12 · Sessions", grid([m("Sessions today", s.sessionsToday), m("Sessions 7d", s.sessions7), m("Sessions / user 7d", s.sessionsPerUser7, { dp: 2 })]) +
    `<div class="note-block">${badge("LEGACY")} ${esc(s.durationNote.note)}</div>`);
}

/**
 * Deep Analysis: previews used (database), what a tap leads to, opens, the
 * one-free-look offer, and the paywall. Counts come from the selected range.
 * Events start with the app build that added them and are not back-filled.
 */
export function renderDeepAnalysis(x: any): string {
  if (!x) return "";
  if (isErr(x)) return section("deepa", "Deep Analysis", errorCard("Deep Analysis", x));
  const r = (v: any) => (v && v.d ? rate(v.n, v.d) : "—");
  const t = x.tracking;
  const SOURCE_LABEL: Record<string, string> = { results: "Results screen", history: "Scan history / diamonds", hunt_history: "Hunt history", unknown: "Unknown" };
  const OUTCOME_LABEL: Record<string, string> = {
    open: "Opened straight away (Pro)", offer_preview: "Offered the free look (Free, unused)",
    paywall: "Hit the paywall (Free, look spent)", unresolved: "Plan not known yet — nothing happened",
  };

  const p = x.previews;
  const previews = `<div class="card"><div class="card-h">Free looks used ${badge("EXACT")} <span class="muted">— from the database, covers everyone from the start</span></div>${grid([
      m("Used, all time", { value: p.allTime, trust: "EXACT" }), m("Used in this range", { value: p.inRange, trust: "EXACT" }),
      m("…then saw the paywall", p.laterSawPaywall), m("…then bought from it", p.laterBoughtViaDeepPaywall), m("…on a paid plan now", p.paidNow)])}
    <div class="muted">Free users get one lifetime look; the server stamps the date it is spent. The three "then" figures are for people whose look falls in this range: "on a paid plan now" is their plan today and may have nothing to do with Deep Analysis. Accounts outside the launch cohort are left out.</div></div>`;

  const taps = t.available
    ? `<div class="card"><div class="card-h">What a tap on Deep Analysis leads to ${badge("EXACT")}</div>
      ${table(["Outcome", "Taps", "People"], x.taps.map((o: any) => [esc(OUTCOME_LABEL[o.outcome] ?? o.outcome), num(o.taps), num(o.users)]))}
      <div class="muted">One row per tap. Free users meet the free look BEFORE the paywall, so the paywall row is only people who had already used theirs.</div></div>`
    : na("What a tap on Deep Analysis leads to", "Starts with the next app build — taps on Deep Analysis weren't logged before.");

  const o = x.opens;
  const opens = t.available
    ? `<div class="card"><div class="card-h">Deep Analysis opened ${badge("EXACT")}</div>${grid([
        m("Opens", { value: o.total, trust: "EXACT" }), m("People", { value: o.users, trust: "EXACT" }),
        m("By Free users", { value: o.byPlan.free, trust: "EXACT" }), m("By Monthly", { value: o.byPlan.monthly, trust: "EXACT" }),
        m("By Annual", { value: o.byPlan.annual, trust: "EXACT" }), m("Plan not recorded", { value: o.byPlan.unknown, trust: "EXACT" })])}
      ${table(["Opened from", "Opens"], o.bySource.map((s: any) => [esc(SOURCE_LABEL[s.source] ?? s.source), num(s.views)]))}
      <div class="muted">Counted when the Deep Analysis screen opens, once per visit. A Free open is either the free look or someone who bought on the paywall.</div></div>`
    : na("Deep Analysis opened", "Starts with the next app build — opens weren't logged before.");

  const f = x.offer;
  const offer = t.available
    ? `<div class="card"><div class="card-h">The free-look offer ${badge("EXACT")}</div>${grid([
        m("Offer shown", { value: f.offered, trust: "EXACT" }), m("People shown it", { value: f.offeredUsers, trust: "EXACT" }),
        m("Tapped Try Deep Analysis", { value: f.accepted, trust: "EXACT" }), m("Said Not Now", { value: f.dismissed, trust: "EXACT" }),
        m("Granted", { value: f.granted, trust: "EXACT" }), m("Refused — already used", { value: f.alreadyUsed, trust: "EXACT" }),
        m("Failed (network or error)", { value: f.error, trust: "EXACT" })])}
      <div class="muted">Accepted: ${r(f.acceptRate)}. Not every offer ends in a tap or Not Now (the app can be closed with the sheet open), so shown ≥ accepted + dismissed.</div></div>`
    : na("The free-look offer", "Starts with the next app build — the offer being shown, accepted or dismissed wasn't logged before.");

  const w = x.paywall;
  const paywall = `<div class="card"><div class="card-h">The Deep Analysis paywall ${badge("EXACT")}</div>${grid([
      m("Views", { value: w.impressions, trust: "EXACT" }), m("People", { value: w.viewers, trust: "EXACT" }),
      m("Picked a plan", { value: w.planSelected, trust: "EXACT" }), m("Started a purchase", { value: w.purchaseStarts, trust: "EXACT" }),
      m("Purchases", { value: w.purchases, trust: "EXACT" }), m("Cancelled", { value: w.cancelled, trust: "EXACT" })])}
    <div class="muted">Viewers who bought: ${r(w.conversion)}. This is only people who had already used their free look, so it understates how many wanted Deep Analysis.</div></div>`;

  const note = t.available
    ? `<div class="note-block">${badge("PARTIAL")} Tap, open and offer events start ${esc(formatCentralDateTime(t.since))}, with the app build that added them; earlier use isn't back-filled. ${t.anyInRange ? "" : "None fall in this range."} Free looks used and the paywall are complete.</div>`
    : `<div class="note-block">${badge("NOT_TRACKED")} Tap, open and offer events start with the next app build. Free looks used and the paywall are complete now.</div>`;

  return section("deepa", "Deep Analysis", previews + taps + opens + offer + paywall + note);
}

function renderFeatureUsage(f: any): string {
  // Wrapped in its section so the contents link still lands somewhere.
  if (isErr(f)) return section("feat", "13 · Feature Usage", errorCard("Feature usage", f));
  const rows = f.map((r: any) => [esc(r.feature), r.accessed === null ? `<span class="muted">n/t</span>` : num(r.accessed), r.paywallTriggered === null ? `<span class="muted">n/a</span>` : num(r.paywallTriggered), r.completed === null ? `<span class="muted">n/t</span>` : num(r.completed), r.completedUsers === null ? "—" : num(r.completedUsers), `<span class="muted">${esc(r.note)}</span>`]);
  return section("feat", "13 · Feature Usage", `<div class="card">${table(["Feature", "Accessed", "Paywall triggered", "Completed", "Users", "Source"], rows)}<div class="muted">A paywall being triggered is not feature usage; the columns are kept separate on purpose.</div></div>`);
}

function renderUnitEconomics(u: any): string {
  // Wrapped in its section so the contents link still lands somewhere.
  if (isErr(u)) return section("cost", "14 · Cost / Unit Economics", errorCard("Unit economics", u));
  return section("cost", "14 · Cost / Unit Economics", grid([
    m("Est. API spend (in range)", u.estimatedSpend, { dp: 2 }), m("Est. cost / scan", u.costPerScan, { dp: 3 }), m("Est. cost / user in scope", u.costPerUser, { dp: 3 }),
    m("Est. cost / active user (in range)", u.costPerActiveUser, { dp: 3 }), m("Scans in range", u.scansInRange), m("Scans 30d", u.scans30),
  ]) + `<div class="note-block">${badge("ESTIMATED")} ${esc(u.marginNote)}</div>` + (u.v3 && !isErr(u.v3) ? renderCost(u.v3).replace(/<h2>[\s\S]*?<\/h2>/, `<h3>V3 cost detail</h3>`) : ""));
}

function renderDataQualityV4(q: any): string {
  // Wrapped in its section so the contents link still lands somewhere.
  if (isErr(q)) return section("dq", "23 · Data Quality", errorCard("Data quality", q));
  const c = q.cutover;
  const wq = q.window;
  const winBlock = wq ? `<div class="card"><div class="card-h">Analysis window (debug)</div>${grid([
    m("Preset", { value: null, trust: "EXACT", note: wq.preset }),
    m("Window", { value: null, trust: "EXACT", note: wq.label }),
    m("Timezone", { value: null, trust: "EXACT", note: `${wq.timezone} (${wq.timezoneLabel})` }),
    m("Eligible users", wq.eligibleUsers),
    m("Events in window", wq.eventsInWindow), m("Events all time", wq.eventsAllTime),
    m("Scans in window", wq.scansInWindow), m("Scans all time", wq.scansAllTime),
  ])}${wq.warning ? `<div class="warnline">${esc(wq.warning)}</div>` : ""}</div>` : "";
  /**
   * Loader integrity first: if it fails, nothing else on the page is
   * trustworthy, so it is the first thing to read in this section.
   */
  const li = q.loader;
  const loaderBlock = li ? `<div class="card"><div class="card-h">Loader integrity <span class="muted">— checked on every page load</span></div>${grid([
    m("Events loaded", li.loaded), m("Events in database", li.inDatabase),
    textCard("Status", li.status === "ok" ? "OK" : li.status === "unverified" ? "Unverified" : li.status === "duplicated" ? "Duplicated rows" : "Skipped rows",
      li.status === "ok" ? "EXACT" : "LEGACY", li.note),
  ])}</div>` : "";
  const ss = q.scanSources;
  const scanBlock = ss ? `<div class="card"><div class="card-h">Scan sources</div>${grid([
    m("Scans completed", ss.scansCompleted), m("Saved items", ss.savedItems), m("Save rate", ss.saveRate),
    m("Unattributable scans", ss.anonymousScans),
  ])}<div class="muted">Scans are <code>scan_completed</code> events. Saved items are rows in the <code>scans</code> table — the user's collection, which earlier versions of this dashboard counted as scans.</div></div>` : "";
  const sc = q.scope;
  const scopeBlock = sc ? `<div class="card"><div class="card-h">Acquisition scope</div>${grid([
    m("Scope", { value: null, trust: "EXACT", note: sc.scope === "all" ? "All time" : `Post launch · ${sc.launchAt ?? "—"}` }),
    m("Post-launch profiles", sc.postLaunchProfiles), m("Pre-launch profiles", sc.preLaunchProfiles),
    m("Post-launch share", sc.postLaunchShare),
    m("Anonymous events excluded", sc.anonymousExcluded),
  ])}<div class="muted">${esc(sc.note)}${sc.assumed ? " · Launch time-of-day assumed 00:00 UTC; set FLIPSTART_GLOBAL_LAUNCH_AT to correct." : ""}</div>
  <div class="note-block">${badge("LEGACY")} ${esc(sc.scanPackWarning)}</div></div>` : "";
  return section("dq", "23 · Data Quality", `<div class="banner ${c.configured ? "ok" : "warn"}">${esc(c.status)}</div>` + loaderBlock + winBlock + scanBlock + scopeBlock + grid([
    m("Analytics events", q.totalEvents), m("Authenticated", q.authenticated), m("Anonymous", q.anonymous), m("Missing session_id", q.missingSession),
    textCard("Latest event", q.latestEvent ? formatCentralDateTime(q.latestEvent) : null, "EXACT", "Central Time"),
    m("Post-cutover events", q.postCutoverEvents), m("Snapshot coverage", q.snapshotCoverage), m("Unknown snapshot %", q.unknownSnapshotPct),
    m("Legacy paywall_dismissed", q.legacyDismissed), m("Continue Free (post)", q.continueFreePost), m("paywall_closed (post)", q.closedPost),
    m("scan_completed (post)", q.scanCompletedPost), m("scan_completed (legacy)", q.scanCompletedLegacy),
  ]) + (q.anomalies.length ? `<div class="banner warn">${q.anomalies.map((a: string) => esc(a)).join("<br>")}</div>` : "") +
    `<div class="note-block">${badge("NOT_TRACKED")} ${esc(q.revenueCatHistoryNote)}</div>`);
}

/**
 * 12d · Sold Comps Inspector.
 *
 * Every recent comps run (all users): the search, what came back, how it was
 * tiered and why, what was thrown out — plus the founder's right/wrong marks,
 * which are the labelled set any later matching change is judged against.
 * Always renders its full layout; missing data shows as zeros with a banner.
 * Every value is escaped; nothing here identifies a user.
 */
export function renderCompsInspector(input: any): string {
  const title = "12d · Sold Comps Inspector";
  const empty = { runCount: 0, runs: [], feedback: [], feedbackTotals: { right: 0, wrong: 0 }, byTier: {}, durable: true,
                  history: { runsAsking365: 0, medianSpanDays: null, maxSpanDays: null }, searchTiers: {}, paidCalls: 0 };
  const snap = input && typeof input === "object" && !isErr(input) ? { ...empty, ...input } : empty;
  const problem = !input || typeof input !== "object"
    ? `<div class="banner warn">This load didn't include comps inspector data (the server may be running an older version), so everything shows zero.</div>`
    : isErr(input) ? `<div class="banner warn">Loading the comps inspector failed: ${esc(String(input.error).slice(0, 200))}</div>`
    : !snap.durable ? `<div class="banner warn">DATA_DIR is not set, so inspector history resets on every deploy.</div>` : "";
  const when = (ms: number) => esc(formatCentralDateTime(new Date(ms).toISOString()));
  const tiers = (t: any) => t ? `${num(t.exact)} / ${num(t.strong)} / ${num(t.similar)} / ${num(t.weak)}` : "—";
  const runs: any[] = Array.isArray(snap.runs) ? snap.runs : [];
  const runRows = runs.map((r: any) => [
    when(r.at), esc(r.item), esc(r.query ?? "—"), esc(r.outcome), esc(r.searchTier ?? "—"),
    num((r.searches ?? []).filter((s: any) => s.paid).length), num(r.raw), tiers(r.tierCounts),
    num(r.rejectedCount), num(r.duplicatesRemoved), esc(r.dataStrength ?? "—"),
    r.median != null ? usd(r.median) : "—",
    r.aiLow != null && r.aiHigh != null ? `${usd(r.aiLow, 0)}–${usd(r.aiHigh, 0)}` : "—",
    r.historySpanDays != null ? `${num(r.historySpanDays)}d of ${num(r.historyDays)}d` : "—",
  ]);
  const detail = (r: any) => {
    const counts = Object.entries(r.rejectionCounts ?? {}).sort((a: any, b: any) => b[1] - a[1]);
    return `<details class="more"><summary>${esc(r.item)} — ${esc(r.query ?? "no search")} · ${when(r.at)}</summary>
      <div class="card-h">Searches run</div>
      ${table(["Step", "Search", "Category", "Outcome", "Paid", "Returned"], (r.searches ?? []).map((s: any) => [esc(s.tier), esc(s.query), esc(s.categoryId ?? "none"), esc(s.cacheHit ? "cached" : s.outcome), s.paid ? "yes" : "no", num(s.raw)]), "compact")}
      <div class="card-h">Shown, in order</div>
      ${table(["Tier", "Score", "Price", "Title", "Why"], (r.shown ?? []).map((c: any) => [esc(c.tier), num(c.score), usd(c.price), esc(c.title), esc(c.reason)]), "compact")}
      <div class="card-h">Why listings were thrown out</div>
      ${table(["Reason", "Listings"], counts.map(([k, v]: any) => [esc(String(k).toLowerCase().replace(/_/g, " ")), num(v)]), "compact")}
      <div class="card-h">Rejected (sample)</div>
      ${table(["Reason", "Title", "Price", "Detail"], (r.rejectedSample ?? []).map((x: any) => [esc(String(x.reason).toLowerCase().replace(/_/g, " ")), esc(x.title), usd(x.price), esc(x.detail ?? "")]), "compact")}
      <div class="card-h">Weak — never shown (sample)</div>
      ${table(["Title", "Why"], (r.weakSample ?? []).map((x: any) => [esc(x.title), esc(x.reason)]), "compact")}
      <div class="card-h">Duplicates removed</div>
      ${table(["Title", "Why"], (r.duplicates ?? []).map((x: any) => [esc(x.title), esc(x.reason)]), "compact")}
    </details>`;
  };
  const fb: any[] = Array.isArray(snap.feedback) ? snap.feedback : [];
  const byTier = Object.entries(snap.byTier ?? {}) as Array<[string, any]>;
  const tierOrder = ["exact", "strong", "similar"];
  byTier.sort((a, b) => tierOrder.indexOf(a[0]) - tierOrder.indexOf(b[0]));
  const marks = `<div class="card"><div class="card-h">Your marks ${badge("EXACT")} <span class="muted">— right / wrong taps from the in-app inspector</span></div>
    ${grid([card("Marked right", num(snap.feedbackTotals?.right)), card("Marked wrong", num(snap.feedbackTotals?.wrong))])}
    ${table(["Tier", "Right", "Wrong", "Wrong rate"], byTier.map(([t, v]) => [esc(t), num(v.right), num(v.wrong), pct((v.right + v.wrong) ? v.wrong / (v.right + v.wrong) : null)]), "compact")}
    <div class="card-h">Latest marks</div>
    ${table(["When", "Mark", "Tier", "Score", "Item", "Comp"], fb.slice(0, 50).map((f: any) => [when(f.at), esc(f.verdict), esc(f.tier), num(f.score), esc(f.item), esc(f.title)]), "compact")}</div>`;
  return section("comps", title,
    `${problem}
     ${grid([card("Comps runs kept", num(snap.runCount)), card("Paid searches (all time)", num(snap.paidCalls)), card("Marked right", num(snap.feedbackTotals?.right)), card("Marked wrong", num(snap.feedbackTotals?.wrong))])}
     <div class="card"><div class="card-h">Search depth & history ${badge("EXACT")} <span class="muted">— A precise · B relaxed · C broad · D nothing shown</span></div>
     ${grid(["A", "B", "C", "D"].map(t => card(`Reached ${t}`, num((snap.searchTiers ?? {})[t] ?? 0))))}
     ${grid([card("Runs that asked for 365 days", num(snap.history?.runsAsking365)),
             card("Median days of sales returned", snap.history?.medianSpanDays != null ? `${num(snap.history.medianSpanDays)}d` : "—"),
             card("Longest span returned", snap.history?.maxSpanDays != null ? `${num(snap.history.maxSpanDays)}d` : "—")])}
     <div class="muted">If the median stays near 90 days, eBay isn't giving more than that — the 365-day setting can be dropped.</div></div>
     <div class="card"><div class="card-h">Recent runs ${badge("EXACT")} <span class="muted">— tiers are Exact / Strong / Similar / Weak; one row per scan, latest view</span></div>
     ${table(["When", "Item", "Search", "Outcome", "Depth", "Paid", "Returned", "Tiers E/S/s/W", "Rejected", "Dupes", "Data", "Median", "AI range", "History"], runRows, "compact")}
     ${runs.slice(0, 15).map(detail).join("")}</div>
     ${marks}
     <div class="muted">"History" is the span of sale dates the provider actually returned, against the window asked for. Comps never change the resale estimate.</div>`,
    "server");
}

// ── Last 50 new phones · Hunt XP · Hunt Levels (server/founderHuntJourney.ts) ──

const tick = (b: boolean) => b ? "✓" : `<span class="muted">·</span>`;
const cnt = (v: number | null | undefined) => v === null || v === undefined ? `<span class="muted">—</span>` : v === 0 ? `<span class="muted">0</span>` : num(v);

function onboardingCell(o: any): string {
  if (o.skippedSignedIn && !o.started) return `<span class="muted">skipped (signed in)</span>`;
  const parts: string[] = [];
  if (o.maxStep !== null) parts.push(`step ${num(o.maxStep)}${o.totalSteps ? `/${num(o.totalSteps)}` : ""}${o.maxStepName ? ` <span class="muted">${esc(o.maxStepName)}</span>` : ""}`);
  parts.push([
    o.started ? "started" : `<span class="muted">not started</span>`,
    o.quiz ? "quiz ✓" : "",
    o.tapped ? (o.tapped === "login" ? "tapped log in" : "tapped create") : "",
    o.completed ? `done <span class="muted">${esc(o.completed)}</span>` : "",
  ].filter(Boolean).join(" → "));
  return parts.join("<br>");
}

function accountCell(a: any): string {
  if (!a) return `<span class="muted">none</span>`;
  const label = a.name ?? a.userId.slice(0, 8) + "…";
  const tag = a.sharedWith > 0
    ? ` <span class="sev sev-warning" title="${a.sharedWith + 1} accounts signed in on this phone">shared ×${a.sharedWith + 1}</span>`
    : a.kind === "existing"
      ? ` <span class="sev sev-info" title="Account created ${esc(formatCentralDateTime(a.createdAt) || "earlier")}, before this phone first opened — a reinstall or new device">existing</span>`
      : "";
  return userLink(a.userId, label) + tag;
}

function boughtCell(r: any): string {
  const parts: string[] = [];
  if (r.subscriptions.length) parts.push(esc(r.subscriptions.join(", ")));
  if (r.packs) parts.push(`${num(r.packs)} pack${r.packs === 1 ? "" : "s"}`);
  if (parts.length) return `<strong>${parts.join(" + ")}</strong>`;
  if (r.planNow && r.planNow !== "free") return `<span class="muted" title="No purchase event on this phone, but the account is on this plan now">${esc(r.planNow)} now</span>`;
  return `<span class="muted">no</span>`;
}

function renderNewPhones(x: any): string {
  const id = "newphones", title = "3c · Last 50 New Phones";
  if (!x || typeof x !== "object") return section(id, title, `<div class="card muted">Unavailable for this load.</div>`);
  if (isErr(x)) return section(id, title, errorCard("New Phones", x));
  const s = x.summary;
  const of = (v: number) => rate(v, s.newPeople);
  const summary = `<div class="card"><div class="card-h">Of the ${num(s.newPeople)} new people ${badge("EXACT")}
      <span class="muted">— ${num(s.phones)} phones listed; ${num(s.reinstalls)} reinstall${s.reinstalls === 1 ? "" : "s"} of existing accounts and ${num(s.shared)} shared phone${s.shared === 1 ? "" : "s"} are listed but not counted here</span></div>
    ${table(["Step", "People"], [
      ["Started onboarding", of(s.onboardingStarted)], ["Finished the quiz", of(s.quiz)], ["Made an account", of(s.account)],
      ["Scanned", of(s.scanned)], ["Saved a scan", of(s.saved)], ["Hit a paywall", of(s.paywall)],
      ["Opened Hunt Mode", of(s.hunted)], ["Unlocked a brand", of(s.brands)], ["Earned Hunt XP", of(s.xp)], ["Paid", of(s.paid)],
    ], "compact")}</div>`;
  const rows = x.rows.map((r: any) => [
    when(r.firstSeen) + (r.firstVersion ? `<br><span class="muted">v${esc(r.firstVersion)}</span>` : ""),
    esc(r.reached),
    onboardingCell(r.onboarding),
    accountCell(r.account),
    r.paywalls ? `${num(r.paywalls)}${r.firstPaywall ? ` <span class="muted">first ${esc(r.firstPaywall)}</span>` : ""}` : cnt(0),
    cnt(r.scans), cnt(r.saved),
    r.huntOpens || r.huntsDone ? `${num(r.huntOpens)} open${r.huntOpens === 1 ? "" : "s"} · ${num(r.huntsDone)} done` : cnt(0),
    cnt(r.brands),
    r.xp === null ? cnt(null) : r.xp === 0 ? cnt(0) : `${num(r.xp)}<br><span class="muted">${esc(r.rank ?? "")}</span>`,
    boughtCell(r),
    when(r.lastSeen),
  ]);
  const warn = [
    x.brandsError ? `Brands unavailable: ${x.brandsError}` : "",
    x.xpError ? `XP unavailable: ${x.xpError}` : "",
  ].filter(Boolean).map((t: string) => `<div class="banner warn">${esc(t)}</div>`).join("");
  return section(id, title, warn + summary +
    `<div class="card wide"><div class="card-h">Newest first <span class="muted">— Central Time · a phone is one install (reinstalling makes a new one) · scope and date range do not apply here${x.oldest ? ` · oldest shown first opened ${when(x.oldest)}` : ""}</span></div>
    ${table(["First open", "Reached", "Onboarding", "Account", "Paywalls", "Scans", "Saved", "Hunt", "Brands", "Hunt XP", "Bought", "Last seen"], rows, "compact")}</div>
    <div class="muted">${x.stepsTracked
      ? "Onboarding step = the furthest screen reached (onboarding_step_viewed)."
      : "Onboarding shows milestones only. The exact screen reached starts with the app build after 2.2 (onboarding_step_viewed)."}
      Scans, saves, paywalls and Hunt count events on this phone, plus the account's events on other phones after this phone's first open. Brands and XP are the account's current totals.</div>`);
}

function renderHuntXp(x: any): string {
  const id = "huntxp", title = "Hunt XP";
  if (!x || typeof x !== "object") return section(id, title, `<div class="card muted">Unavailable for this load.</div>`);
  if (isErr(x)) return section(id, title, errorCard("Hunt XP", x));
  const ev = x.events;
  const top = x.top.map((t: any, i: number) => [
    num(i + 1), userLink(t.userId, t.name ?? t.userId.slice(0, 8) + "…"), num(t.xp),
    `${num(t.rankNumber)} · ${esc(t.rank)}`, num(t.hunts),
    t.streak ? `${num(t.streak)}${t.streakLive ? "" : ` <span class="muted">ended</span>`}` : `<span class="muted">0</span>`,
    t.lastHunt ? esc(String(t.lastHunt).slice(0, 10)) : "—",
  ]);
  return section(id, title,
    `<div class="card"><div class="card-h">Lifetime <span class="muted">— current totals from xp_profiles · the date range does not apply</span></div>${grid([
      m("Accounts with XP", x.withXp), m("Total XP", x.totalXp), m("Avg XP (with XP)", x.meanXp), m("Median XP (with XP)", x.medianXp),
      m("Most XP", x.maxXp), m("Hunts completed", x.huntsCompleted), m("Accounts with a hunt", x.hunters),
      m("Live streaks", x.liveStreaks), m("Longest live streak", x.longestLiveStreak),
    ])}</div>
    <div class="card"><div class="card-h">In the selected range</div>${grid([
      m("XP earned", ev.xpInRange), m("XP awards (hunts)", ev.awardsInRange), m("People who earned XP", ev.earnersInRange), m("XP per hunt", ev.perHunt, { dp: 0 }),
    ])}</div>
    <div class="card"><div class="card-h">Top ${num(x.top.length)} hunters by XP</div>${table(["#", "User", "XP", "Rank", "Hunts", "Streak", "Last hunt"], top, "compact")}</div>
    <div class="muted">Only signed-in accounts have an XP row (${num(x.xpRows)} of ${num(x.accounts)} accounts in scope). A streak is live if the last hunt was ${esc(x.today)} or the day before.${x.staleRankNames ? ` ${num(x.staleRankNames)} stored rank name${x.staleRankNames === 1 ? " is" : "s are"} out of date; ranks here are recomputed from XP.` : ""}</div>`,
    "source: xp_profiles");
}

function renderHuntLevels(x: any): string {
  const id = "huntlevels", title = "Hunt Levels";
  if (!x || typeof x !== "object") return section(id, title, `<div class="card muted">Unavailable for this load.</div>`);
  if (isErr(x)) return section(id, title, errorCard("Hunt Levels", x));
  const max = Math.max(1, ...x.ladder.map((r: any) => r.users));
  const rows = x.ladder.map((r: any) => [
    num(r.number), esc(r.rank),
    `${num(r.fromXp)}${r.toXp !== null ? `–${num(r.toXp)}` : "+"}`,
    r.users ? num(r.users) : `<span class="muted">0</span>`,
    r.share === null ? "—" : pct(r.share),
    `<div style="min-width:120px">${bar(r.users / max * 100)}</div>`,
    r.rankUpsInRange === null ? `<span class="muted">—</span>` : r.rankUpsInRange ? num(r.rankUpsInRange) : `<span class="muted">0</span>`,
  ]);
  return section(id, title,
    grid([
      textCard("Highest rank reached", x.highest ? `${x.highest.number} · ${x.highest.rank}` : null),
      textCard("Median rank (with XP)", x.medianRank ? `${x.medianRank.number} · ${x.medianRank.rank}` : null, "DERIVED"),
      m("Accounts at 0 XP", { value: x.zeroXp, trust: "EXACT", d: x.xpRows }),
      m("Rank-ups in range", x.rankUpsInRange),
    ]) +
    `<div class="card"><div class="card-h">Accounts on each rank <span class="muted">— current, recomputed from total XP · share of the ${num(x.xpRows)} accounts with an XP row · rank 1 includes the ${num(x.zeroXp)} at 0 XP</span></div>
    ${table(["#", "Rank", "XP", "Accounts", "Share", "", "Rank-ups in range"], rows, "compact")}</div>`,
    "source: xp_profiles");
}

// ── Composer ─────────────────────────────────────────────────────────────────

const TOC: Array<[string, string]> = [
  ["exec", "Executive"], ["integrity", "Integrity"], ["explorer", "User explorer"], ["acq", "Users"], ["source", "Source"], ["act", "Activation"], ["funnel", "First session"], ["newphones", "New phones"], ["mon", "Monetization"], ["pricing", "Pricing"], ["freepaid", "Free → Paid"], ["pw", "Paywalls"], ["pwintel", "Paywall value"], ["offer", "Onboarding offer"],
  ["paid", "Paid journeys"], ["power", "Power users"], ["store", "Scan Store"], ["deepa", "Deep Analysis"], ["cohorts", "Cohorts"], ["dist", "Distribution"], ["free", "Free users"], ["ret", "Retention"], ["retseg", "Retention segments"], ["sess", "Sessions"], ["versions", "Versions"],
  ["scans", "Scans"], ["reliability", "Fail screens & reliability"], ["comps", "Sold comps inspector"], ["feat", "Features"], ["adopt", "Feature adoption"], ["cost", "Cost"], ["costplan", "Cost by plan"], ["trust", "Scan trust"], ["hunt", "Hunt"], ["huntxp", "Hunt XP"], ["huntlevels", "Hunt levels"], ["progress", "Progress"],
  ["achievements", "Achievements"], ["brands", "Brands"], ["diamonds", "Diamonds"], ["listings", "Listings"], ["sold", "Sold"], ["dq", "Data quality"],
];

export function generateFounderDashboardV4(metrics: any, secret?: string): string {
  const scope: Scope = metrics?.cohort?.scope === "all" ? "all" : "post_launch";
  const win: AnalysisWindow | undefined = metrics?.window;
  setPageQuery(secret, scope, win);
  if (metrics && metrics.configured === false) {
    return shell(`<div class="banner warn"><strong>Supabase not configured.</strong> Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the server.</div>`, "—", scope, secret, win);
  }
  if (metrics && metrics.fatal) return shell(`<div class="banner warn"><strong>Failed to load data:</strong> ${esc(metrics.fatal)}</div>`, "—", scope, secret, win);
  if (metrics && metrics.v4Error) {
    return shell(`<div class="banner warn"><strong>V4 metrics failed:</strong> ${esc(metrics.v4Error)} — showing V3 sections only.</div>` +
      [renderScans(metrics.scans), renderTrust(metrics.trust), renderCost(metrics.cost), renderHunt(metrics.hunt), renderProgress(metrics.progress),
       renderAchievements(metrics.achievements), renderBrands(metrics.brands), renderDiamonds(metrics.diamonds), renderListings(metrics.listings), renderSold(metrics.sold)].join(""), metrics.generatedAt, scope, secret, win);
  }
  const body = [
    renderExecutive(metrics), renderIntegrity(metrics.dataIntegrity), renderExplorer(metrics.userExplorer),
    renderAcquisition(metrics.acquisition), renderAcquisitionSource(metrics.acquisitionSource), renderActivation(metrics.activation), renderFunnel(metrics.firstSession), renderNewPhones(metrics.newPhones),
    renderMonetization(metrics.monetization), renderPricing(metrics.pricing), renderFreeToPaid(metrics.freeToPaid),
    renderPaywalls(metrics.paywalls), renderPaywallIntel(metrics.paywallIntel), renderOnboardingOffer(metrics.onboardingOffer),
    renderPaidJourneys(metrics.paidJourneys), renderPowerUsers(metrics.powerUsers), renderScanStore(metrics.scanStore, metrics.scanStoreInsights),
    renderDeepAnalysis(metrics.deepAnalysis),
    renderCohorts(metrics.cohorts), renderDistributions(metrics.distributions),
    renderFree(metrics.freeBehaviour), renderRetentionV2(metrics.retentionV2), renderRetentionSegments(metrics.retentionSegments), renderSessionsV2(metrics.sessionsV2), renderAppVersions(metrics.appVersions),
    renderScans(metrics.scans), renderScanReliability(metrics.scanReliability), renderCompsInspector(metrics.compsInspector), renderFeatureUsage(metrics.featureUsage), renderFeatureAdoption(metrics.featureAdoption), renderUnitEconomics(metrics.unitEconomics), renderCostByPlan(metrics.costByPlan),
    // V3 product analytics, preserved and demoted below the business funnel.
    renderTrust(metrics.trust), renderHunt(metrics.hunt), renderHuntXp(metrics.huntXp), renderHuntLevels(metrics.huntLevels), renderProgress(metrics.progress), renderAchievements(metrics.achievements),
    renderBrands(metrics.brands), renderDiamonds(metrics.diamonds), renderListings(metrics.listings), renderSold(metrics.sold),
    renderDataQualityV4(metrics.dataQualityV4),
  ].join("");
  return shell(body, metrics.generatedAt, scope, secret, win);
}

function shell(body: string, generatedAt: string, scope: Scope = "post_launch", secret?: string, win?: AnalysisWindow): string {
  const toc = TOC.map(([id, label]) => `<a href="#${id}">${esc(label)}</a>`).join("");
  /**
   * The secret must ride along or the tab logs you out. It is already in the
   * address bar on this page, so putting it in a same-page link exposes
   * nothing new — but it is URL-encoded so a secret containing & or = cannot
   * break the link or silently truncate.
   */
  const q = (sc: Scope, preset?: RangePreset) =>
    `?secret=${encodeURIComponent(secret ?? "")}${sc === "all" ? "&scope=all" : ""}${preset && preset !== "custom" ? `&preset=${encodeURIComponent(preset)}` : ""}`;
  const scopeTabs = ([["post_launch", "Post Launch"], ["all", "All Time"]] as Array<[Scope, string]>)
    .map(([sc, label]) => `<a class="scope-tab${scope === sc ? " on" : ""}" href="${esc(q(sc, win?.preset))}">${esc(label)}</a>`).join("");
  /**
   * Presets, kept short. "All Available" changes only the DATE range — the
   * user scope is a separate control and is preserved in the link.
   */
  const rangeTabs = ([
    ["today", "Today"], ["yesterday", "Yest."], ["7d", "7D"], ["14d", "14D"],
    ["30d", "30D"], ["since_launch", "Since Launch"], ["all", "All"],
  ] as Array<[RangePreset, string]>)
    .map(([pr, label]) => `<a class="scope-tab${win?.preset === pr ? " on" : ""}" href="${esc(q(scope, pr))}">${esc(label)}</a>`).join("");
  const todayDay = win?.toDay ?? "";
  /**
   * Rendered in the shell rather than inside the Executive section, so the
   * reader always knows what they are looking at — even when a section throws
   * and renders an error card instead.
   */
  const summary = win ? `<div class="banner scope"><div class="sumrow">
      <span><strong>Scope</strong><br>${esc(scope === "all" ? "All Time" : "Post Launch")}</span>
      <span><strong>Analysis Window</strong><br>${esc(win.label)}</span>
      <span><strong>Timezone</strong><br>${esc(win.timezoneLabel)}</span>
    </div>${win.warning ? `<div class="warnline">${esc(win.warning)}</div>` : ""}
    <div class="muted">Activity sections show events inside this window. Activation and Retention instead use it to pick who ENTERED during it, then follow them forward — otherwise a short range could never show D7.</div></div>` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>FlipStart · Founder Dashboard V4</title>
<style>
:root{--bg:#0f1512;--card:#161f1a;--line:#24312a;--fg:#e7e2d2;--muted:#8f9a91;--accent:#c4a334;--ok:#3a8f5a;--warn:#b7791f}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:13px/1.45 -apple-system,Segoe UI,Roboto,sans-serif}
header{position:sticky;top:0;z-index:5;background:var(--bg);border-bottom:1px solid var(--line);padding:10px 18px;display:flex;align-items:center;gap:14px;flex-wrap:wrap}
header h1{font-size:15px;margin:0;color:var(--accent)}header .gen{color:var(--muted);font-size:11px;margin-left:auto}
nav.toc{display:flex;flex-wrap:wrap;gap:4px 10px;font-size:11.5px}nav.toc a{color:var(--muted);text-decoration:none}nav.toc a:hover{color:var(--fg)}
main{padding:14px 18px 60px;max-width:1500px;margin:0 auto}
section{margin:0 0 26px;scroll-margin-top:150px}section h2{font-size:15px;margin:0 0 10px;padding-top:6px;border-top:1px solid var(--line)}section h2 .note{font-weight:400;color:var(--muted);font-size:11px;margin-left:10px}
h3{font-size:12.5px;color:var(--muted);margin:14px 0 6px}
.stat-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin-bottom:10px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:9px 11px}.stat-v{font-size:19px;font-weight:600;line-height:1.2}.stat-l{color:var(--muted);font-size:11px;margin-top:2px}.stat-s{color:var(--muted);font-size:10.5px;margin-top:2px}
.stat-v.stat-text{font-size:15px}
.stat.na .stat-v{font-size:12px;color:var(--muted);font-weight:500}
.card{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:10px 12px;margin-bottom:10px}.card-h{font-weight:600;font-size:12px;margin-bottom:8px}.card.na{color:var(--muted)}.card.wide{overflow-x:auto}
.two{display:grid;grid-template-columns:1fr 1fr;gap:10px}@media(max-width:900px){.two{grid-template-columns:1fr}}
.eras{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:10px}
table{width:100%;border-collapse:collapse;font-size:12px}th,td{text-align:left;padding:5px 7px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);font-weight:500;font-size:11px}td.r,th.r{text-align:right}
table.compact th,table.compact td{padding:3px 6px;font-size:11.5px}table.wrap{min-width:1800px}
table.funnel td.stg{width:30%}table.funnel td.w{width:30%}
.bar{height:8px;background:var(--line);border-radius:4px;overflow:hidden}.bar-fill{height:100%}
.tb{display:inline-block;font-size:9px;font-weight:600;letter-spacing:.4px;padding:1px 5px;border-radius:3px;vertical-align:middle;margin-left:4px;text-transform:uppercase;cursor:help}
.tb-exact{background:#1f3b2a;color:#7bd394}.tb-derived{background:#1f2f3b;color:#7fb8e8}.tb-estimated{background:#3b331f;color:#e8c77f}.tb-not_tracked{background:#2a2a2a;color:#9a9a9a}.tb-legacy{background:#3b1f1f;color:#e88f7f}
.tb-partial{background:#33291a;color:#e0b46a}.tb-conflict{background:#4a1d1d;color:#ff9b8a}
.ss-vs{color:#ff9b8a;border-color:#ff9b8a}
details.more{margin-top:4px}details.more>summary{cursor:pointer;color:var(--muted);font-size:12px;padding:4px 0}
details.more[open]>summary{margin-bottom:8px}
.attn{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:10px 12px;margin-bottom:12px}
.attn-none{color:var(--muted);font-size:12px}
.attn-h{font-weight:600;font-size:12px;margin-bottom:8px}
.attn-i{display:flex;gap:10px;align-items:flex-start;padding:7px 9px;border-radius:5px;margin-top:5px;text-decoration:none;color:var(--fg);border-left:3px solid var(--line)}
.attn-i:hover{background:#0b110e}.attn-ic{font-size:16px;line-height:1.2}
.attn-critical{border-left-color:#ff6b5a}.attn-warning{border-left-color:var(--warn)}.attn-opportunity{border-left-color:var(--accent)}.attn-info{border-left-color:#7fb8e8}
.sev{display:inline-block;font-size:9.5px;font-weight:600;padding:1px 6px;border-radius:3px;letter-spacing:.3px}
.sev-conflict{background:#4a1d1d;color:#ff9b8a}.sev-warning{background:#33291a;color:#e0b46a}.sev-info{background:#1f2f3b;color:#7fb8e8}
.ulink{color:var(--fg);text-decoration:underline;text-decoration-color:var(--line)}.ulink:hover{text-decoration-color:var(--accent)}
.xsearch{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:6px}
.xsearch input{flex:1;min-width:220px;background:#0b110e;border:1px solid var(--line);color:var(--fg);border-radius:4px;padding:5px 8px;font-size:12.5px;font-family:inherit}
.xsearch button{background:var(--accent);color:#14200f;border:0;border-radius:4px;padding:5px 12px;font-size:12px;font-weight:600;cursor:pointer}
table.kv td:first-child{color:var(--muted);width:150px}
.ss{display:inline-block;font-size:9.5px;color:var(--warn);border:1px solid var(--warn);border-radius:3px;padding:0 4px;margin-left:4px;cursor:help}
.legend{font-size:11px;color:var(--muted);margin:6px 0 12px}.muted{color:var(--muted);font-size:11px}.note-block{color:var(--muted);font-size:11.5px;padding:8px 10px;border-left:2px solid var(--line);margin:6px 0 10px}
.banner{padding:9px 12px;border-radius:6px;margin-bottom:10px;font-size:12px}.banner.warn{background:#2c2410;border:1px solid var(--warn)}.banner.ok{background:#12291b;border:1px solid var(--ok)}
.scopes{display:flex;gap:2px;background:var(--card);border:1px solid var(--line);border-radius:6px;padding:2px}
.scope-tab{color:var(--muted);text-decoration:none;font-size:11.5px;padding:3px 10px;border-radius:4px}
.scope-tab.on{background:var(--accent);color:#14200f;font-weight:600}
.ranges{display:flex;gap:2px;background:var(--card);border:1px solid var(--line);border-radius:6px;padding:2px}
.custom{display:flex;align-items:center;gap:4px}
.custom input[type=date]{background:var(--card);border:1px solid var(--line);color:var(--fg);border-radius:4px;padding:2px 6px;font-size:11.5px;font-family:inherit}
.custom button{background:var(--accent);color:#14200f;border:0;border-radius:4px;padding:3px 10px;font-size:11.5px;font-weight:600;cursor:pointer}
.sumrow{display:flex;gap:26px;flex-wrap:wrap;font-size:12px;margin-bottom:4px}
.warnline{color:var(--warn);font-size:11.5px;margin:4px 0}
.banner.scope{background:#12200f;border:1px solid var(--accent)}
.spark{display:flex;align-items:flex-end;gap:2px;height:44px}.spark span{flex:1;background:var(--accent);opacity:.7;border-radius:1px 1px 0 0;min-width:2px}
code{font-size:11px;background:#0b110e;padding:1px 4px;border-radius:3px}.uid{cursor:help}
</style></head><body>
<header><h1>FlipStart · Founder Dashboard <span style="color:var(--muted);font-weight:400">V4</span></h1>
<div class="scopes">${scopeTabs}</div>
<div class="ranges">${rangeTabs}</div>
<form class="custom" method="get" action="">
  <input type="hidden" name="secret" value="${esc(secret ?? "")}">
  <input type="hidden" name="scope" value="${esc(scope)}">
  <input type="hidden" name="preset" value="custom">
  <input type="date" name="from" value="${esc(win?.fromDay ?? "")}" max="${esc(todayDay)}" aria-label="Start date">
  <span class="muted">→</span>
  <input type="date" name="to" value="${esc(win?.toDay ?? "")}" max="${esc(todayDay)}" aria-label="End date">
  <button type="submit">Apply</button>
</form>
<nav class="toc">${toc}</nav><span class="gen">generated ${esc(generatedAt)}</span></header>
<main>${summary}${body}</main></body></html>`;
}
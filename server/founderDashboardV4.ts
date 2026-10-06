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
  if (isErr(di)) return errorCard("Data Integrity", di);
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

function renderExplorer(ex: any): string {
  if (ex && isErr(ex)) return errorCard("User Explorer", ex);
  const form = `<form class="xsearch" method="post" action="${esc(pageQuery)}#explorer">
    <input type="search" name="q" value="${esc(ex?.query ?? "")}" placeholder="Name, username, email or user ID" maxlength="200" autocomplete="off">
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
  if (ex?.notFound) body += `<div class="card muted">No user with that ID.</div>`;
  const u = ex?.user;
  if (u) {
    const id = u.identity, b = u.balance, us = u.usage, mo = u.monetization, j = mo.journey;
    const status = id.internal ? "internal account — excluded from every metric" : id.inScope ? "in the current scope" : "outside the current scope — not in the dashboard's numbers";
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
      <div class="card"><div class="card-h">Usage</div>${grid([
        m("Lifetime scans", { value: us.lifetimeScans, trust: "EXACT" }), m("Scans 7d", { value: us.scans7, trust: "EXACT" }),
        m("Scans 30d", { value: us.scans30, trust: "EXACT" }), m("Failed scans", { value: us.failedScans, trust: "EXACT" }),
        m("Signed-out scans (device)", { value: us.linkedScans, trust: us.linkedScans ? "PARTIAL" : "EXACT" }),
        m("Saved items", { value: us.savedItems, trust: "EXACT" }), m("Sessions", { value: us.sessions, trust: "EXACT" }),
        m("Active days", { value: us.activeDays, trust: "EXACT" }), m("Listings", { value: us.listings, trust: "EXACT" }),
        m("Hunt opens", { value: us.huntOpens, trust: "EXACT" }), m("Hunts completed", { value: us.huntCompletions, trust: "EXACT" }),
        m("Progress opens", { value: us.progressOpens, trust: "EXACT" }), m("Scan Store opens", { value: us.scanStoreOpens, trust: "EXACT" }),
        m("Deep Analysis opens", { value: null, trust: "NOT_TRACKED", available: false, note: `no open event — ${us.deepAnalysisPaywalls} paywall view(s)` }),
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
      ${table(["When", "Event", "Detail"], u.timeline.map((r: any) => [when(r.at), `${esc(r.event)}${r.linked ? ` <span class="sev sev-info" title="Written while signed out on this user's device; attributed by device">device</span>` : ""}`, `<span class="muted">${esc(r.detail)}</span>`]), "compact")}</div>`;
  }
  return section("explorer", "1c · User Explorer", `<div class="card">${form}<div class="muted">Founder-only. Shows any account — pre-launch and internal included — with its whole history; scope and date range do not apply here.</div></div>` + body);
}

const usd = (v: number | null | undefined, dp = 2) => v === null || v === undefined || !Number.isFinite(v) ? "—" : `$${v.toFixed(dp)}`;
const signed = (v: number | null, unit: string, dp = 1) => v === null ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(dp)}${unit}`;
const absent = (label: string, x: any) => !x || typeof x !== "object" ? `<div class="card muted">${esc(label)} is unavailable for this load.</div>` : "";

function renderPricing(pr: any): string {
  if (!pr || typeof pr !== "object") return section("pricing", "4b · Pricing Experiments", absent("Pricing Experiments", pr));
  if (isErr(pr)) return errorCard("Pricing Experiments", pr);
  const [v1, v2] = pr.eras;
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
  const c = pr.comparison;
  const cmp = `<div class="card"><div class="card-h">V2 vs V1 <span class="muted">— observational, not causal</span></div>${table(["Measure", "Change"], [
    [`Activation (${pr.conversionDays}-day)`, esc(signed(c.activationPts, " pts"))],
    [`Paid conversion (${pr.conversionDays}-day)`, esc(signed(c.paidPts, " pts"))],
    ["Paywall viewer → paid", esc(signed(c.viewerToPaidPts, " pts"))],
    ["Est. revenue per 100 users", c.revenuePer100Delta === null ? "—" : esc(`${c.revenuePer100Delta >= 0 ? "+" : "−"}$${Math.abs(c.revenuePer100Delta).toFixed(2)}`)],
  ], "compact")}<div class="muted">${esc(pr.caveat)} Small samples are flagged on each card above.</div></div>`;
  const notes = [
    pr.boundaryAssumed ? `V2 start is a date-only assumption (midnight Central). Set FLIPSTART_PRICING_V2_AT to the exact moment if known.` : "",
    `Revenue is ESTIMATED: list price in USD, first period only — before refunds, renewals and non-US storefront pricing. Net applies Apple's ${Math.round(pr.appleFeeRate * 100)}%. Subscriptions only; scan-pack events are test activity.`,
    ...pr.notes.map((n: any) => `${n.at ? when(n.at) + " — " : ""}${n.note}`),
  ].filter(Boolean).map(t => `<div class="note-block">${esc(t)}</div>`).join("");
  return section("pricing", "4b · Pricing Experiments", `<div class="two">${col(v1)}${col(v2)}</div>` + cmp + notes,
    "eras define their own windows; the date range does not apply");
}

function renderFreeToPaid(fp: any): string {
  if (!fp || typeof fp !== "object") return section("freepaid", "4c · Free → Paid", absent("Free → Paid", fp));
  if (isErr(fp)) return errorCard("Free → Paid", fp);
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
  if (isErr(pu)) return errorCard("Power Users", pu);
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
  if (isErr(ds)) return errorCard("Usage Distribution", ds);
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
  if (isErr(fs)) return errorCard("First-Session Funnel", fs);
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
  if (isErr(pi)) return errorCard("Paywall Intelligence", pi);
  const rows = pi.rows.map((r: any) => [
    `<code>${esc(r.source)}</code>`, num(r.impressions), num(r.uniqueViewers), num(r.repeatViewers),
    num(r.selections), num(r.purchases), r.selectionToPurchase.d ? rate(r.selectionToPurchase.n, r.selectionToPurchase.d) : "—",
    `${num(r.purchasesByEra.v1 ?? 0)} / ${num(r.purchasesByEra.v2 ?? 0)}`, usd(r.revenueEstimate.value),
    num(r.medianImpressionsBeforePurchase, 1), hrs(r.medianHoursFirstImpressionToPurchase),
    `${num(r.firstSeenFor)} / ${num(r.convertingFor)} / ${num(r.lastBeforeFor)}`,
  ]);
  return section("pwintel", "5b · Paywall Intelligence",
    `<div class="card wide"><div class="card-h">Which paywalls create value <span class="muted">— sorted by estimated revenue in range</span></div>
     ${table(["Paywall", "Impr.", "Viewers", "Repeat viewers", "Selections", "Purchases", "Selection → purchase", "Purchases V1 / V2", "Est. revenue", "Median views before buying", "First view → purchase", "First / converting / last"], rows, "compact")}
     <div class="muted">${esc(pi.note)} "First / converting / last": for buyers, how often this paywall was the first they saw, the one they bought on, and the last before buying. ${num(pi.buyers)} buyer(s). Current era: ${esc(pi.currentEra ?? "—")}.</div></div>`,
    "ESTIMATED revenue");
}

function renderFeatureAdoption(fa: any): string {
  if (!fa || typeof fa !== "object") return section("adopt", "13b · Feature Adoption & Conversion", absent("Feature Adoption", fa));
  if (isErr(fa)) return errorCard("Feature Adoption", fa);
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
  if (isErr(rs)) return errorCard("Retention by Segment", rs);
  const c = (x: any) => x.d ? `${pct(x.value)} <span class="muted">${num(x.n)}/${num(x.d)}</span> ${small(x.d)}` : "—";
  return section("retseg", "11b · Retention by Segment",
    `<div class="card wide">${table(["Segment", "Users", "D1", "D3", "D7", "D14", "D30"],
      rs.rows.map((x: any) => [esc(x.label), num(x.users), c(x.d1), c(x.d3), c(x.d7), c(x.d14), c(x.d30)]), "compact")}
     <div class="muted">${esc(rs.note)}</div></div>`, "first-day segments");
}

const cell = (x: any) => x && x.d ? `${pct(x.value)} <span class="muted">${num(x.n)}/${num(x.d)}</span> ${small(x.d)}` : "—";

function renderAppVersions(av: any): string {
  if (!av || typeof av !== "object") return section("versions", "12b · App Versions", absent("App Versions", av));
  if (isErr(av)) return errorCard("App Versions", av);
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

function renderAcquisitionSource(as: any): string {
  if (!as || typeof as !== "object") return section("source", "2b · Acquisition Source", absent("Acquisition Source", as));
  if (isErr(as)) return errorCard("Acquisition Source", as);
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
  if (isErr(cb)) return errorCard("Cost by Plan", cb);
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
  if (isErr(a)) return errorCard("Acquisition", a);
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
  if (isErr(x)) return errorCard("Activation", x);
  return section("act", "3 · Activation", grid([
    m("Activation rate", x.activationRate), m("Never scanned", x.neverScanned), m("Onboarding completed (event)", x.onboardingCompleted),
    m("Median account → first scan", x.hoursToFirstScanMedian, { fmt: "hrs" }), m("Mean account → first scan", x.hoursToFirstScanMean, { fmt: "hrs" }),
  ]) + `<div class="card"><div class="card-h">Lifecycle (nested — each stage is a subset of the one above)</div>${funnel(x.lifecycle)}</div>`,
  "scans are scan_completed events, not saved items");
}

function renderMonetization(mo: any): string {
  if (isErr(mo)) return errorCard("Monetization", mo);
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
  if (isErr(pw)) return errorCard("Paywalls", pw);
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
  if (isErr(o)) return errorCard("Onboarding offer", o);
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
  if (isErr(pj)) return errorCard("Paid user journeys", pj);
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

function renderScanStore(s: any): string {
  if (isErr(s)) return errorCard("Scan Store", s);
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
  const contamination = `<div class="banner warn"><strong>Historical Scan Pack purchase events include test activity.</strong> <span class="muted">No genuine scan-pack sale has occurred. Treat purchase counts below as ${TRUST_LABEL.LEGACY.toUpperCase()} — opens and browsing behaviour are real; purchases are not monetization evidence.</span></div>`;
  return section("store", "8 · Scan Store", contamination + grid([
    m("Opens", s.opens), m("Unique visitors", s.uniqueVisitors), m("Repeat visitors", s.repeatVisitors), m("Opens / visitor", s.opensPerVisitor, { dp: 2 }),
    m("Visitor → buyer", { ...s.visitorToBuyer, trust: "LEGACY", note: "test-contaminated" }),
    m("Completed", { value: s.outcomes.completed, trust: "LEGACY", note: "test activity" }),
    m("Cancelled", { value: s.outcomes.cancelled, trust: "LEGACY", note: "test activity" }),
    m("Failed", { value: s.outcomes.failed, trust: "LEGACY", note: "test activity" }),
    m("Median first visit → purchase", { value: s.hoursFirstVisitToPurchase.median, trust: "DERIVED", d: s.hoursFirstVisitToPurchase.d }, { fmt: "hrs" }), m("Revenue", s.revenue),
  ]) + `<div class="two"><div class="card"><div class="card-h">Funnel (unique users)</div>${funnel(s.funnel)}<div class="muted">StoreKit sheet presentation is not tracked, so it is not a stage.</div></div>
  <div class="card"><div class="card-h">Entry mode (legacy field)</div>${table(["Mode", "Opens"], s.entryMode.map((r: any) => [esc(r.mode), num(r.opens)]))}</div></div>
  <div class="card"><div class="card-h">Per SKU</div>${skus}</div>${v4}`, s.smallSample ? "small sample" : "");
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
  if (isErr(c)) return errorCard("Cohorts", c);
  return section("cohorts", "9 · User Cohorts (current plan)", cohortCard(c.free) + cohortCard(c.monthly) + cohortCard(c.annual));
}

function renderFree(f: any): string {
  if (isErr(f)) return errorCard("Free user behaviour", f);
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
  if (isErr(r)) return errorCard("Retention", r);
  return section("ret", "11 · Retention", grid([m("D1", r.d1), m("D3", r.d3), m("D7", r.d7), m("D14", r.d14), m("D30", r.d30)]) +
    `<div class="muted">Anchor: ${esc(r.anchor)} · timezone ${esc(r.timezone)} · ${num(r.cohortUsers)} users with an anchor. Only users old enough for each window are counted in its denominator.</div>`,
    "re-anchored on first activity, not profile creation");
}

function renderSessionsV2(s: any): string {
  if (isErr(s)) return errorCard("Sessions", s);
  return section("sess", "12 · Sessions", grid([m("Sessions today", s.sessionsToday), m("Sessions 7d", s.sessions7), m("Sessions / user 7d", s.sessionsPerUser7, { dp: 2 })]) +
    `<div class="note-block">${badge("LEGACY")} ${esc(s.durationNote.note)}</div>`);
}

function renderFeatureUsage(f: any): string {
  if (isErr(f)) return errorCard("Feature usage", f);
  const rows = f.map((r: any) => [esc(r.feature), r.accessed === null ? `<span class="muted">n/t</span>` : num(r.accessed), r.paywallTriggered === null ? `<span class="muted">n/a</span>` : num(r.paywallTriggered), r.completed === null ? `<span class="muted">n/t</span>` : num(r.completed), r.completedUsers === null ? "—" : num(r.completedUsers), `<span class="muted">${esc(r.note)}</span>`]);
  return section("feat", "13 · Feature Usage", `<div class="card">${table(["Feature", "Accessed", "Paywall triggered", "Completed", "Users", "Source"], rows)}<div class="muted">A paywall being triggered is not feature usage; the columns are kept separate on purpose.</div></div>`);
}

function renderUnitEconomics(u: any): string {
  if (isErr(u)) return errorCard("Unit economics", u);
  return section("cost", "14 · Cost / Unit Economics", grid([
    m("Est. API spend (in range)", u.estimatedSpend, { dp: 2 }), m("Est. cost / scan", u.costPerScan, { dp: 3 }), m("Est. cost / user in scope", u.costPerUser, { dp: 3 }),
    m("Est. cost / active user (in range)", u.costPerActiveUser, { dp: 3 }), m("Scans in range", u.scansInRange), m("Scans 30d", u.scans30),
  ]) + `<div class="note-block">${badge("ESTIMATED")} ${esc(u.marginNote)}</div>` + (u.v3 && !isErr(u.v3) ? renderCost(u.v3).replace(/<h2>[\s\S]*?<\/h2>/, `<h3>V3 cost detail</h3>`) : ""));
}

function renderDataQualityV4(q: any): string {
  if (isErr(q)) return errorCard("Data quality", q);
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

// ── Composer ─────────────────────────────────────────────────────────────────

const TOC: Array<[string, string]> = [
  ["exec", "Executive"], ["integrity", "Integrity"], ["explorer", "User explorer"], ["acq", "Users"], ["source", "Source"], ["act", "Activation"], ["funnel", "First session"], ["mon", "Monetization"], ["pricing", "Pricing"], ["freepaid", "Free → Paid"], ["pw", "Paywalls"], ["pwintel", "Paywall value"], ["offer", "Onboarding offer"],
  ["paid", "Paid journeys"], ["power", "Power users"], ["store", "Scan Store"], ["cohorts", "Cohorts"], ["dist", "Distribution"], ["free", "Free users"], ["ret", "Retention"], ["retseg", "Retention segments"], ["sess", "Sessions"], ["versions", "Versions"],
  ["scans", "Scans"], ["feat", "Features"], ["adopt", "Feature adoption"], ["cost", "Cost"], ["costplan", "Cost by plan"], ["trust", "Scan trust"], ["hunt", "Hunt"], ["progress", "Progress"],
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
    renderAcquisition(metrics.acquisition), renderAcquisitionSource(metrics.acquisitionSource), renderActivation(metrics.activation), renderFunnel(metrics.firstSession),
    renderMonetization(metrics.monetization), renderPricing(metrics.pricing), renderFreeToPaid(metrics.freeToPaid),
    renderPaywalls(metrics.paywalls), renderPaywallIntel(metrics.paywallIntel), renderOnboardingOffer(metrics.onboardingOffer),
    renderPaidJourneys(metrics.paidJourneys), renderPowerUsers(metrics.powerUsers), renderScanStore(metrics.scanStore),
    renderCohorts(metrics.cohorts), renderDistributions(metrics.distributions),
    renderFree(metrics.freeBehaviour), renderRetentionV2(metrics.retentionV2), renderRetentionSegments(metrics.retentionSegments), renderSessionsV2(metrics.sessionsV2), renderAppVersions(metrics.appVersions),
    renderScans(metrics.scans), renderFeatureUsage(metrics.featureUsage), renderFeatureAdoption(metrics.featureAdoption), renderUnitEconomics(metrics.unitEconomics), renderCostByPlan(metrics.costByPlan),
    // V3 product analytics, preserved and demoted below the business funnel.
    renderTrust(metrics.trust), renderHunt(metrics.hunt), renderProgress(metrics.progress), renderAchievements(metrics.achievements),
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
section{margin:0 0 26px}section h2{font-size:15px;margin:0 0 10px;padding-top:6px;border-top:1px solid var(--line)}section h2 .note{font-weight:400;color:var(--muted);font-size:11px;margin-left:10px}
h3{font-size:12.5px;color:var(--muted);margin:14px 0 6px}
.stat-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin-bottom:10px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:9px 11px}.stat-v{font-size:19px;font-weight:600;line-height:1.2}.stat-l{color:var(--muted);font-size:11px;margin-top:2px}.stat-s{color:var(--muted);font-size:10.5px;margin-top:2px}
.stat-v.stat-text{font-size:15px}
.stat.na .stat-v{font-size:12px;color:var(--muted);font-weight:500}
.card{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:10px 12px;margin-bottom:10px}.card-h{font-weight:600;font-size:12px;margin-bottom:8px}.card.na{color:var(--muted)}.card.wide{overflow-x:auto}
.two{display:grid;grid-template-columns:1fr 1fr;gap:10px}@media(max-width:900px){.two{grid-template-columns:1fr}}
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
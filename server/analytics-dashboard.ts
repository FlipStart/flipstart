/**
 * server/analytics-dashboard.ts
 *
 * Visual HTML analytics dashboard for FlipStart beta.
 * Served at: GET /api/dev/analytics-dashboard?secret=DEV_SECRET
 *
 * Shows: user metrics, session metrics, scan metrics, listing metrics,
 * feedback metrics, retention / time-to-value, and raw data tables
 * for recent events, sessions, and scan records.
 *
 * Same dark v2 style as the main Founder Dashboard.
 * Raw JSON endpoint /api/dev/analytics is unchanged.
 */

// ─── Types (mirrors persist.ts — duplicated here to avoid circular imports) ───

interface AnalyticsSummary {
  totalUniqueUsers:     number;
  dau:                  number;
  wau:                  number;
  newUsersToday:        number;
  returningUsersToday:  number;
  totalSessions:        number;
  sessionsToday:        number;
  avgSessionMs:         number;
  sessPerUserDay:       string | number;
  scanStarted:          number;
  scanCompleted:        number;
  scanFailed:           number;
  scanRate:             number;
  avgScansPerDay:       string | number;
  medianScansPerDay:    string | number;
  pct5PlusScans:        number;
  listingsTotal:        number;
  ebayListings:         number;
  depopListings:        number;
  listingRate:          number;
  feedbackEvents:       number;
  feedbackRate:         number;
  avgTTVSeconds:        number | null;
  day1Total: number; day1Ret: number;
  day7Total: number; day7Ret: number;
  day30Total:number; day30Ret:number;
  totalEvents:          number;
  totalScanRecords:     number;
}

interface EventEntry {
  eventId:         string;
  eventName:       string;
  anonymousUserId: string;
  sessionId:       string;
  timestamp:       number;
  platform:        string;
  metadata:        Record<string, unknown>;
}

interface SessionEntry {
  sessionId:             string;
  anonymousUserId:       string;
  startedAt:             number;
  endedAt?:              number;
  durationMs?:           number;
  platform:              string;
  scanCount:             number;
  completedScanCount:    number;
  failedScanCount:       number;
  listingGeneratedCount: number;
  feedbackSubmittedCount:number;
}

interface ScanRecord {
  scanId:           string;
  anonymousUserId:  string;
  sessionId:        string;
  timestamp:        number;
  imageUri:         string;
  tagImagePresent:  boolean;
  detailImagePresent:boolean;
  aiTitle:          string;
  aiCategory:       string;
  aiBrand:          string;
  aiEra:            string;
  aiRecommendation: string;
  aiResaleLow:      number;
  aiResaleHigh:     number;
  aiEstimatedValue: number;
  aiPlatform:       string;
  aiSellSpeed:      string;
  aiDemand:         string;
  aiConfidence:     number;
}

export interface AnalyticsDashboardInput {
  summary:     AnalyticsSummary;
  events:      EventEntry[];
  sessions:    SessionEntry[];
  scanRecords: ScanRecord[];
  secret:      string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function esc(s: any): string {
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
function ts(n: number): string {
  return new Date(n).toLocaleString("en-US", { timeZone: "America/Chicago" });
}
function fmtMs(ms: number | null | undefined): string {
  if (!ms) return "—";
  if (ms < 60000) return Math.round(ms / 1000) + "s";
  return Math.floor(ms / 60000) + "m " + Math.round((ms % 60000) / 1000) + "s";
}
function val(v: any, suffix = ""): string {
  if (v === null || v === undefined || v === "—" || v === "") {
    return '<span style="color:#4a5568">—</span>';
  }
  return '<span style="color:#f0c040;font-weight:500">' + esc(String(v)) + esc(suffix) + "</span>";
}
function retPct(ret: number, total: number): string {
  return total > 0 ? Math.round(ret / total * 100) + "%" : "—";
}
function shortId(id: string): string {
  return id ? id.slice(0, 14) + "…" : "—";
}

// ─── Layout primitives ────────────────────────────────────────────────────────

function section(title: string, content: string): string {
  return (
    '<h2 style="font-size:13px;font-weight:500;text-transform:uppercase;letter-spacing:1px;' +
    'color:#a0aec0;margin:32px 0 12px;padding-bottom:6px;border-bottom:1px solid #2d3748">' +
    esc(title) + "</h2>" + content
  );
}

function metricGrid(items: { label: string; value: any; suffix?: string; sub?: string; danger?: boolean }[]): string {
  return (
    '<div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:8px">' +
    items.map(({ label, value, suffix = "", sub = "", danger = false }) => {
      const bg = danger ? "#4a1c1c" : "#1a2035";
      const vc = danger ? "#fc8181" : "#f0c040";
      const display = (value === null || value === undefined || value === "—")
        ? '<p style="font-size:22px;font-weight:500;margin:0 0 2px;color:#4a5568">—</p>'
        : '<p style="font-size:22px;font-weight:500;margin:0 0 2px;color:' + vc + '">' + esc(String(value)) + esc(suffix) + "</p>";
      return (
        '<div style="background:' + bg + ';border-radius:8px;padding:12px 16px;min-width:140px">' +
        '<p style="font-size:12px;color:#a0aec0;margin:0 0 4px">' + esc(label) + "</p>" +
        display +
        (sub ? '<p style="font-size:11px;color:#718096;margin:0">' + esc(sub) + "</p>" : "") +
        "</div>"
      );
    }).join("") +
    "</div>"
  );
}

function tableWrap(headers: string[], rows: string[]): string {
  if (rows.length === 0) {
    return '<p style="color:#718096;padding:12px;font-size:13px">No data yet.</p>';
  }
  const head = "<tr>" + headers.map(h =>
    '<th style="background:#243050;padding:8px 12px;text-align:left;font-size:11px;' +
    'text-transform:uppercase;letter-spacing:0.5px;color:#a0aec0">' + esc(h) + "</th>"
  ).join("") + "</tr>";
  return (
    '<div style="overflow-x:auto;margin-bottom:8px;border-radius:8px">' +
    '<table style="width:100%;border-collapse:collapse;background:#1a2035;border-radius:8px">' +
    "<thead>" + head + "</thead><tbody>" + rows.join("") + "</tbody></table></div>"
  );
}

function tr(cells: string[]): string {
  return (
    "<tr>" +
    cells.map((c, i) => {
      const isLast = i === cells.length - 1;
      return (
        '<td style="padding:8px 12px;border-top:1px solid #2d3748;color:#cbd5e0;font-size:13px;' +
        (isLast ? "white-space:normal;max-width:280px;word-break:break-word" : "max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap") +
        '">' + c + "</td>"
      );
    }).join("") +
    "</tr>"
  );
}

function badge(text: string, color: "green" | "red" | "yellow" | "blue" | "gray"): string {
  const styles: Record<string, string> = {
    green:  "background:#1c4532;color:#68d391",
    red:    "background:#4a1c1c;color:#fc8181",
    yellow: "background:#2d3319;color:#f6e05e",
    blue:   "background:#1a2a4a;color:#90cdf4",
    gray:   "background:#2d3748;color:#a0aec0",
  };
  return '<span style="display:inline-block;padding:2px 7px;border-radius:4px;font-size:11px;font-weight:500;' + styles[color] + '">' + esc(text) + "</span>";
}

function eventBadge(name: string): string {
  if (name.includes("scan_completed"))   return badge(name, "green");
  if (name.includes("scan_failed"))      return badge(name, "red");
  if (name.includes("scan_started") || name.includes("scan_submitted")) return badge(name, "blue");
  if (name.includes("listing"))          return badge(name, "yellow");
  if (name.includes("session"))          return badge(name, "gray");
  return badge(name, "gray");
}

// ─── CSS ──────────────────────────────────────────────────────────────────────

const CSS = [
  "* { box-sizing: border-box; margin: 0; padding: 0; }",
  "body { font-family: system-ui, sans-serif; background: #0f1117; color: #e2e8f0; font-size: 14px; }",
  ".topbar { background: #1a2035; padding: 14px 28px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #2d3748; }",
  ".topbar h1 { font-size: 18px; font-weight: 500; color: #f0c040; }",
  ".meta { font-size: 12px; color: #718096; }",
  ".container { max-width: 1280px; margin: 0 auto; padding: 24px 20px; }",
  ".exports a { background: #243050; color: #90cdf4; padding: 8px 16px; border-radius: 6px; text-decoration: none; font-size: 12px; border: 1px solid #2d3748; display: inline-block; margin-right: 8px; margin-bottom: 6px; }",
  ".exports a:hover { background: #2d3a5a; }",
  ".exports a.active { background: #1c3a5a; border-color: #4a90d9; color: #90cdf4; }",
  ".ret-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 8px; max-width: 480px; }",
  ".ret-card { background: #1a2035; border-radius: 8px; padding: 14px; text-align: center; border: 1px solid #2d3748; }",
  ".ret-pct { font-size: 28px; font-weight: 500; color: #f0c040; }",
  ".ret-label { font-size: 11px; color: #718096; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 4px; }",
  ".ret-sub { font-size: 11px; color: #4a5568; margin-top: 3px; }",
  "footer { text-align: center; color: #4a5568; font-size: 11px; padding: 32px; }",
].join(" ");

// ─── Main generator ───────────────────────────────────────────────────────────

export function generateAnalyticsDashboard({ summary: a, events, sessions, scanRecords, secret }: AnalyticsDashboardInput): string {

  const now = new Date().toLocaleString("en-US", { timeZone: "America/Chicago" });
  const hasData = a.totalEvents > 0;

  if (!hasData) {
    return [
      "<!DOCTYPE html><html lang='en'><head><meta charset='UTF-8'>",
      "<meta name='viewport' content='width=device-width,initial-scale=1'>",
      "<title>FlipStart User Analytics</title>",
      "<style>" + CSS + "</style></head><body>",
      "<div class='topbar'><h1>FlipStart User Analytics</h1><div class='meta'>Private · " + now + " CT</div></div>",
      "<div class='container'>",
      "<div class='exports' style='margin:16px 0'>",
      "<a href='/api/dev/dashboard?secret=" + esc(secret) + "'>← Founder Dashboard</a>",
      "</div>",
      "<div style='background:#1a2035;border-radius:8px;padding:32px;text-align:center;margin-top:24px'>",
      "<p style='font-size:16px;color:#a0aec0;margin-bottom:8px'>No analytics events collected yet.</p>",
      "<p style='font-size:13px;color:#4a5568'>Events will appear here once users open the app after the analytics update is deployed.</p>",
      "</div>",
      "</div></body></html>",
    ].join("\n");
  }

  // ── Section 1: User Metrics ────────────────────────────────────────────────
  const userSection = metricGrid([
    { label: "Total Unique Users",   value: a.totalUniqueUsers },
    { label: "Daily Active Users",   value: a.dau,                sub: "today" },
    { label: "Weekly Active Users",  value: a.wau,                sub: "last 7 days" },
    { label: "New Users Today",      value: a.newUsersToday },
    { label: "Returning Users Today",value: a.returningUsersToday },
  ]);

  // ── Section 2: Session Metrics ────────────────────────────────────────────
  const sessSection = metricGrid([
    { label: "Total Sessions",          value: a.totalSessions },
    { label: "Sessions Today",          value: a.sessionsToday },
    { label: "Avg Session Length",      value: fmtMs(a.avgSessionMs) },
    { label: "Sessions / User / Day",   value: a.sessPerUserDay,     sub: "last 7 days" },
  ]);

  // ── Section 3: Scan Metrics ───────────────────────────────────────────────
  const scanSection = metricGrid([
    { label: "Scans Started",           value: a.scanStarted },
    { label: "Scans Completed",         value: a.scanCompleted },
    { label: "Scans Failed",            value: a.scanFailed,         danger: a.scanFailed > a.scanCompleted * 0.3 },
    { label: "Completion Rate",         value: a.scanStarted > 0 ? a.scanRate : null, suffix: a.scanStarted > 0 ? "%" : "" },
    { label: "Avg Scans / User / Day",  value: a.avgScansPerDay,     sub: "last 7 days" },
    { label: "Median Scans / User / Day",value: a.medianScansPerDay, sub: "last 7 days" },
    { label: "Users with 5+ Scans/Day", value: a.pct5PlusScans != null ? a.pct5PlusScans : null, suffix: "%" },
  ]);

  // ── Section 4: Listing Metrics ────────────────────────────────────────────
  const splitStr = (a.ebayListings || a.depopListings)
    ? a.ebayListings + " eBay / " + a.depopListings + " Depop" : null;
  const listSection = metricGrid([
    { label: "Total Listings Generated", value: a.listingsTotal },
    { label: "Listing Generation Rate",  value: a.scanCompleted > 0 ? a.listingRate : null, suffix: "%" },
    { label: "eBay Listings",            value: a.ebayListings },
    { label: "Depop Listings",           value: a.depopListings },
    { label: "eBay vs Depop Split",      value: splitStr },
  ]);

  // ── Section 5: Feedback Metrics ───────────────────────────────────────────
  const fbSection = metricGrid([
    { label: "Feedback Events",         value: a.feedbackEvents },
    { label: "Feedback Rate",           value: a.scanCompleted > 0 ? a.feedbackRate : null, suffix: "%", sub: "of completed scans" },
    { label: "Scan Records Saved",      value: a.totalScanRecords, sub: "for future AI memory" },
    { label: "Total Events Logged",     value: a.totalEvents },
  ]);

  // ── Section 6: Hunt Mode Metrics ──────────────────────────────────────────
  const huntSection = (a as any).huntModeOpened != null
    ? metricGrid([
        { label: "Hunt Mode Opens",           value: (a as any).huntModeOpened },
        { label: "Hunts Started",             value: (a as any).huntStarted },
        { label: "Open → Start Rate",         value: (a as any).huntConversionRate, suffix: "%" },
        { label: "Hunt Scans",                value: (a as any).huntScanStarted },
        { label: "Items Saved",               value: (a as any).huntItemSaved },
        { label: "Items Removed",             value: (a as any).huntItemRemoved },
        { label: "Scan → Save Rate",          value: (a as any).huntScanSaveRate, suffix: "%" },
        { label: "Avg Hunt Profit",           value: (a as any).avgHuntProfit != null ? "$" + (a as any).avgHuntProfit : null },
        { label: "Avg Hunt Duration",         value: (a as any).avgHuntDurationMs ? fmtMs((a as any).avgHuntDurationMs) : null },
        { label: "Avg Items Saved / Hunt",    value: (a as any).avgSavedPerHunt },
      ])
    : '<p style="color:#718096;padding:12px;font-size:13px">No Hunt Mode events yet. Deploy analytics update and run a hunt.</p>';

  // ── Section 6: Retention + TTV ────────────────────────────────────────────
  const ttvBlock =
    '<div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:16px">' +
    [
      { label: "Avg Time → First Scan",    value: a.avgTTVSeconds != null ? a.avgTTVSeconds + "s" : null },
    ].map(({ label, value }) =>
      '<div style="background:#1a2035;border-radius:8px;padding:12px 16px;min-width:180px">' +
      '<p style="font-size:12px;color:#a0aec0;margin:0 0 4px">' + esc(label) + "</p>" +
      (value
        ? '<p style="font-size:22px;font-weight:500;color:#f0c040;margin:0">' + esc(value) + "</p>"
        : '<p style="font-size:22px;font-weight:500;color:#4a5568;margin:0">—</p>') +
      "</div>"
    ).join("") +
    "</div>";

  const retBlock =
    '<div class="ret-grid">' +
    [
      { label: "Day 1", ret: a.day1Ret, total: a.day1Total },
      { label: "Day 7", ret: a.day7Ret, total: a.day7Total },
      { label: "Day 30",ret: a.day30Ret,total: a.day30Total },
    ].map(({ label, ret, total }) => {
      const pct = retPct(ret, total);
      const pctNum = total > 0 ? Math.round(ret / total * 100) : null;
      const color  = pctNum == null ? "#4a5568" : pctNum >= 40 ? "#68d391" : pctNum >= 20 ? "#f0c040" : "#fc8181";
      return (
        '<div class="ret-card">' +
        '<div class="ret-pct" style="color:' + color + '">' + pct + "</div>" +
        '<div class="ret-label">' + esc(label) + " Retention</div>" +
        (total > 0 ? '<div class="ret-sub">' + ret + " / " + total + " users</div>" : '<div class="ret-sub">Not enough data</div>') +
        "</div>"
      );
    }).join("") +
    "</div>" +
    '<p style="font-size:11px;color:#4a5568;margin-top:8px">Returned on that day after first use. Only counts cohorts old enough to measure.</p>';

  const retSection = ttvBlock + retBlock;

  // ── Section 7a: Recent Events table ──────────────────────────────────────
  const recentEvents = [...events]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 100);

  const eventRows = recentEvents.map(e => {
    const metaStr = Object.keys(e.metadata ?? {}).length > 0
      ? Object.entries(e.metadata).map(([k, v]) => k + ": " + String(v)).join(", ")
      : "—";
    return tr([
      esc(ts(e.timestamp)),
      eventBadge(e.eventName),
      '<span style="color:#718096;font-size:11px">' + esc(shortId(e.anonymousUserId)) + "</span>",
      '<span style="color:#718096;font-size:11px">' + esc(shortId(e.sessionId)) + "</span>",
      esc(e.platform || "—"),
      '<span style="font-size:11px;color:#a0aec0">' + esc(metaStr) + "</span>",
    ]);
  });

  // ── Section 7b: Recent Sessions table ────────────────────────────────────
  const recentSessions = [...sessions]
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, 50);

  const sessionRows = recentSessions.map(s => {
    const statusBadge = s.endedAt
      ? badge("closed", "gray")
      : badge("open", "green");
    return tr([
      esc(ts(s.startedAt)),
      statusBadge,
      '<span style="color:#718096;font-size:11px">' + esc(shortId(s.anonymousUserId)) + "</span>",
      esc(fmtMs(s.durationMs)),
      esc(s.platform || "—"),
      esc(String(s.scanCount)),
      esc(String(s.completedScanCount)),
      esc(String(s.listingGeneratedCount)),
      esc(String(s.feedbackSubmittedCount)),
    ]);
  });

  // ── Section 7c: Recent Scan Records table ─────────────────────────────────
  const recentScans = [...scanRecords]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 50);

  const scanRows = recentScans.map(r => {
    const recColor = r.aiRecommendation.toLowerCase().includes("buy") ? "green"
      : r.aiRecommendation.toLowerCase().includes("risky") ? "yellow"
      : r.aiRecommendation.toLowerCase().includes("skip") ? "red"
      : "gray";
    const photoIcons =
      "📸" +
      (r.tagImagePresent    ? " 🏷️" : "") +
      (r.detailImagePresent ? " 🔍" : "");
    return tr([
      esc(ts(r.timestamp)),
      esc(r.aiTitle   || "—"),
      esc(r.aiBrand   || "—"),
      esc(r.aiCategory|| "—"),
      badge(r.aiRecommendation || "—", recColor),
      '<span style="color:#f0c040">' + esc(r.aiConfidence ? r.aiConfidence + "%" : "—") + "</span>",
      esc(r.aiEstimatedValue ? "$" + r.aiEstimatedValue : "—"),
      esc(r.aiPlatform || "—"),
      esc(photoIcons),
    ]);
  });

  // ── Render ────────────────────────────────────────────────────────────────
  return [
    "<!DOCTYPE html><html lang='en'><head><meta charset='UTF-8'>",
    "<meta name='viewport' content='width=device-width,initial-scale=1'>",
    "<title>FlipStart User Analytics</title>",
    "<style>" + CSS + "</style></head><body>",
    "<div class='topbar'><h1>FlipStart User Analytics</h1><div class='meta'>Private · " + now + " CT</div></div>",
    "<div class='container'>",

    "<div class='exports' style='margin:16px 0'>",
    "<a href='/api/dev/dashboard?secret="        + esc(secret) + "'>← Founder Dashboard</a>",
    "<a href='/api/dev/analytics?secret="        + esc(secret) + "'>Raw Analytics JSON</a>",
    "<a href='/api/dev/analytics.csv?secret="    + esc(secret) + "'>Analytics CSV</a>",
    "</div>",

    section("1 — User Metrics",         userSection),
    section("2 — Session Metrics",      sessSection),
    section("3 — Scan Metrics",         scanSection),
    section("4 — Listing Metrics",           listSection),
    section("5 — Feedback Metrics",           fbSection),
    section("6 — Hunt Mode",                  huntSection),
    section("7 — Retention & Time to Value",  retSection),
    section("8a — Recent Events (last 100)",
      tableWrap(["Time","Event","User","Session","Platform","Metadata"], eventRows)),
    section("8b — Recent Sessions (last 50)",
      tableWrap(["Started","Status","User","Duration","Platform","Scans","Completed","Listings","Feedback"], sessionRows)),
    section("8c — Recent Scan Records (last 50)",
      tableWrap(["Time","Item","Brand","Category","Rec","Confidence","Est. Value","Platform","Photos"], scanRows)),

    "<footer>FlipStart User Analytics · " + a.totalEvents + " events · " + a.totalScanRecords + " scan records</footer>",
    "</div></body></html>",
  ].join("\n");
}
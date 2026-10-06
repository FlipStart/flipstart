/**
 * server/confidenceReport.ts
 *
 * Founder-only, READ-ONLY report: why do scans land on the low-confidence
 * screens?
 *
 * The confidence the app shows is not the AI's number. The AI writes an
 * identity_confidence, then server/canonical/validate.ts adjusts it:
 *
 *   - IDENTITY_UNEVIDENCED_FIELDS  −15 per identified field with no evidence
 *   - authenticity concerns        capped at 60
 *   - one photo                    capped at 75
 *   - non-core category            capped at 70 unless something is legible
 *   - no identification evidence   capped at 50
 *
 * Every adjustment is recorded on the stored analysis — the penalty as a
 * downgrade with its from/to, the caps as labels in confidence_caps_applied.
 * This module reads them back and answers one question per scan: was the
 * score low because the AI was unsure, or because our own scoring pushed it
 * down?
 *
 * It reads the analysis store (the last 300 analyses, 7 days) and nothing
 * else. It writes nothing, calls no API, and changes no behaviour.
 *
 * Screen thresholds mirror app/loading.tsx exactly:
 *   conf > 0 && conf < 35  → very-low screen ("Something interrupted the hunt")
 *   conf > 0 && conf < 55  → low screen ("Hard to identify from here")
 *   otherwise              → results (including 0, which is a known app bug)
 */
import type { StoredAnalysis } from "./analysisStore";
import { DASHBOARD_TZ } from "./dashboardDates";

/** Mirrors app/loading.tsx. Change both together or not at all. */
export const VERY_LOW_BELOW = 35;
export const LOW_BELOW = 55;

export type Screen = "results" | "low" | "very_low" | "zero_shown_as_result";

export type Cause =
  /** The AI's own score was already below 55. */
  | "ai_unsure"
  /** The AI scored 55+; the missing-evidence penalty took it below 55. */
  | "evidence_penalty"
  /** The AI scored above 50; the no-evidence cap set it to 50. */
  | "no_evidence_cap"
  /** Below 55 by some other combination we cannot attribute exactly. */
  | "unclear";

export interface Adjustment {
  kind: "evidence_penalty" | "photo_cap" | "authenticity_cap" | "non_core_cap" | "no_evidence_cap";
  /** Human-readable, e.g. "−45: no evidence for item_type, subtype, subject". */
  label: string;
  /** Points removed, when the stored record says. */
  points?: number;
}

export interface ReportRow {
  analysisId: string;
  analyzedAt: number;
  owner: string;            // first 8 chars only
  photos: number;
  category: string;
  itemName: string;
  model: string;
  promptVersion: string;
  /** The AI's own score, when the record pins it down exactly. */
  aiScore: number | null;
  /** When aiScore is unknown: the AI scored ABOVE this. */
  aiScoreAbove: number | null;
  finalScore: number;
  screen: Screen;
  /** Only for scans that landed on a low screen (or the 0 bug). */
  cause: Cause | null;
  adjustments: Adjustment[];
  /** True when the server lowered the score at all. */
  lowered: boolean;
}

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

export function screenFor(conf: number): Screen {
  if (conf > 0 && conf < VERY_LOW_BELOW) return "very_low";
  if (conf > 0 && conf < LOW_BELOW) return "low";
  if (conf <= 0) return "zero_shown_as_result";
  return "results";
}

/**
 * Turns one stored analysis into a report row. Defensive throughout: the
 * store holds whatever schema was live when each scan ran, so a field that is
 * missing on an old record must degrade to "unknown", never throw.
 */
export function analyzeStored(s: StoredAnalysis): ReportRow | null {
  const c: any = s?.canonical;
  if (!c || typeof c !== "object") return null;

  const finalScore = num(c.ai?.identification?.identity_confidence);
  if (finalScore == null) return null;

  const downgrades: any[] = Array.isArray(c.derived?.validation?.downgrades)
    ? c.derived.validation.downgrades : [];
  const caps: string[] = Array.isArray(c.derived?.validation?.confidence_caps_applied)
    ? c.derived.validation.confidence_caps_applied.map(String) : [];
  const idCaps = caps.filter(l => l.startsWith("identity_confidence"));

  const adjustments: Adjustment[] = [];
  let aiScore: number | null = null;
  let aiScoreAbove: number | null = null;

  // 1. The missing-evidence penalty. Its `from` is the AI's own score (after
  //    clamping to 0..100), which pins aiScore down exactly.
  const pen = downgrades.find(d =>
    d?.rule_id === "IDENTITY_UNEVIDENCED_FIELDS" && d?.field === "identity_confidence");
  if (pen) {
    const from = num(pen.from);
    const to = num(pen.to);
    const fields = String(pen.internal_detail ?? "").replace(/^unevidenced:\s*/i, "");
    if (from != null) aiScore = from;
    const points = from != null && to != null ? from - to : undefined;
    adjustments.push({
      kind: "evidence_penalty",
      points,
      label: `${points != null ? `−${points}` : "penalty"}: no evidence cited for ${fields || "some identified fields"}`,
    });
  }

  // 2. Caps, in the order validate.ts applies them.
  //    The authenticity label is written even when it changed nothing, so it
  //    only counts as a lowering when the score sits at 60.
  const auth = idCaps.find(l => l.includes("authenticity"));
  if (auth) {
    adjustments.push({ kind: "authenticity_cap", label: "capped at 60: authenticity concerns" });
    if (aiScore == null && finalScore === 60) aiScoreAbove = 59; // at least 60
  }
  const photo = idCaps.map(l => l.match(/^identity_confidence (\d+) -> (\d+) \((\d+) photos?\)/)).find(Boolean);
  if (photo) {
    const from = Number(photo[1]);
    const to = Number(photo[2]);
    // No penalty fired → the photo cap's `from` is the AI's own score.
    if (aiScore == null) { aiScore = from; aiScoreAbove = null; }
    adjustments.push({
      kind: "photo_cap", points: from - to,
      label: `capped at ${to}: only ${photo[3]} photo${photo[3] === "1" ? "" : "s"}`,
    });
  }
  if (idCaps.some(l => l.includes("non-core"))) {
    adjustments.push({ kind: "non_core_cap", label: "capped at 70: not clothing/shoes/bags, nothing legible" });
    if (aiScore == null) aiScoreAbove = 70;
  }
  if (idCaps.some(l => l.includes("no identification evidence"))) {
    adjustments.push({ kind: "no_evidence_cap", label: "capped at 50: AI cited no identification evidence" });
    if (aiScore == null && (aiScoreAbove == null || aiScoreAbove < 50)) aiScoreAbove = 50;
  }

  // Nothing touched it → the final score IS the AI's score.
  if (aiScore == null && aiScoreAbove == null) aiScore = finalScore;

  const screen = screenFor(finalScore);
  const failed = screen !== "results";

  let cause: Cause | null = null;
  if (failed) {
    if (aiScore != null && aiScore < LOW_BELOW) cause = "ai_unsure";
    else if (pen && num(pen.to) != null && (num(pen.to) as number) < LOW_BELOW) cause = "evidence_penalty";
    else if (adjustments.some(a => a.kind === "no_evidence_cap")) cause = "no_evidence_cap";
    else cause = "unclear";
  }

  const slots = Array.isArray(c.meta?.photo_slots_provided) ? c.meta.photo_slots_provided : [];

  return {
    analysisId: s.analysisId,
    analyzedAt: num(c.meta?.analyzed_at) ?? s.savedAt,
    owner: String(s.ownerId ?? "").slice(0, 8),
    photos: slots.length || 1,
    category: String(c.ai?.identification?.broad_category ?? "unknown"),
    itemName: String(
      c.derived?.identification?.display_item_name
      ?? c.ai?.identification?.generic_item_name ?? ""),
    model: String(c.meta?.model ?? ""),
    promptVersion: String(c.meta?.prompt_version ?? ""),
    aiScore,
    aiScoreAbove: aiScore == null ? aiScoreAbove : null,
    finalScore,
    screen,
    cause,
    adjustments,
    lowered: aiScore != null ? finalScore < aiScore : aiScoreAbove != null,
  };
}

export interface ConfidenceReport {
  generatedAt: number;
  store: { stored: number; durable: boolean };
  rows: ReportRow[];
  total: number;
  oldest: number | null;
  newest: number | null;
  screens: Record<Screen, number>;
  /** Scans that landed on a low screen or the 0 bug. */
  failed: number;
  causes: Record<Cause, number>;
  /** Of the failed scans: the AI's own score was 55+ (or above 50 under the cap). */
  failedButAiWasConfident: number;
  /** Across ALL scans: how often each adjustment fired. */
  adjustmentCounts: Record<Adjustment["kind"], number>;
  loweredAtAll: number;
  byPhotos: Array<{ photos: number; n: number; failed: number; serverCaused: number }>;
}

export function buildConfidenceReport(
  entries: StoredAnalysis[],
  store: { stored: number; durable: boolean },
  now = Date.now(),
): ConfidenceReport {
  const rows = entries
    .map(analyzeStored)
    .filter((r): r is ReportRow => r !== null)
    .sort((a, b) => b.analyzedAt - a.analyzedAt);

  const screens: Record<Screen, number> = { results: 0, low: 0, very_low: 0, zero_shown_as_result: 0 };
  const causes: Record<Cause, number> = { ai_unsure: 0, evidence_penalty: 0, no_evidence_cap: 0, unclear: 0 };
  const adjustmentCounts: Record<Adjustment["kind"], number> = {
    evidence_penalty: 0, photo_cap: 0, authenticity_cap: 0, non_core_cap: 0, no_evidence_cap: 0,
  };
  let failedButAiWasConfident = 0;
  let loweredAtAll = 0;
  const photosMap = new Map<number, { n: number; failed: number; serverCaused: number }>();

  for (const r of rows) {
    screens[r.screen]++;
    if (r.cause) {
      causes[r.cause]++;
      if (r.cause === "evidence_penalty" || r.cause === "no_evidence_cap") failedButAiWasConfident++;
    }
    for (const kind of new Set(r.adjustments.map(a => a.kind))) adjustmentCounts[kind]++;
    if (r.lowered) loweredAtAll++;
    const p = photosMap.get(r.photos) ?? { n: 0, failed: 0, serverCaused: 0 };
    p.n++;
    if (r.cause) p.failed++;
    if (r.cause === "evidence_penalty" || r.cause === "no_evidence_cap") p.serverCaused++;
    photosMap.set(r.photos, p);
  }

  return {
    generatedAt: now,
    store,
    rows,
    total: rows.length,
    oldest: rows.length ? rows[rows.length - 1].analyzedAt : null,
    newest: rows.length ? rows[0].analyzedAt : null,
    screens,
    failed: screens.low + screens.very_low + screens.zero_shown_as_result,
    causes,
    failedButAiWasConfident,
    adjustmentCounts,
    loweredAtAll,
    byPhotos: [...photosMap.entries()].sort((a, b) => a[0] - b[0])
      .map(([photos, v]) => ({ photos, ...v })),
  };
}

// ─── HTML ────────────────────────────────────────────────────────────────────

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : "—");

const when = new Intl.DateTimeFormat("en-US", {
  timeZone: DASHBOARD_TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
});

const SCREEN_LABEL: Record<Screen, string> = {
  results: "Results",
  low: "Low screen",
  very_low: "Very-low screen",
  zero_shown_as_result: "0, shown as result",
};

const CAUSE_LABEL: Record<Cause, string> = {
  ai_unsure: "AI itself was unsure",
  evidence_penalty: "Our missing-evidence penalty",
  no_evidence_cap: "Our no-evidence cap (50)",
  unclear: "Unclear",
};

export function renderConfidenceReport(r: ConfidenceReport): string {
  const card = (label: string, value: string, sub = "") =>
    `<div class="card"><div class="v">${esc(value)}</div><div class="l">${esc(label)}</div>${sub ? `<div class="s">${esc(sub)}</div>` : ""}</div>`;

  const failedRows = r.rows.filter(x => x.cause);
  const rowHtml = (x: ReportRow) => `
    <tr class="${x.cause ? "bad" : ""}">
      <td>${esc(when.format(new Date(x.analyzedAt)))}</td>
      <td>${esc(x.itemName || "—")}<div class="s">${esc(x.category)} · ${x.photos} photo${x.photos === 1 ? "" : "s"} · user ${esc(x.owner)}</div></td>
      <td class="n">${x.aiScore != null ? x.aiScore : x.aiScoreAbove != null ? `&gt;${x.aiScoreAbove}` : "?"}</td>
      <td class="n">${x.finalScore}</td>
      <td>${esc(SCREEN_LABEL[x.screen])}</td>
      <td>${x.cause ? esc(CAUSE_LABEL[x.cause]) : ""}</td>
      <td class="adj">${x.adjustments.map(a => esc(a.label)).join("<br>")}</td>
    </tr>`;

  const range = r.oldest && r.newest
    ? `${when.format(new Date(r.oldest))} → ${when.format(new Date(r.newest))} (Central)` : "no scans stored";

  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>Confidence report</title>
<style>
  body{font:14px/1.45 -apple-system,system-ui,Segoe UI,sans-serif;margin:0;padding:20px;background:#faf8f2;color:#2b2118}
  h1{font-size:20px;margin:0 0 4px} h2{font-size:16px;margin:28px 0 8px}
  .muted,.s{color:#6f5a3e;font-size:12px}
  .cards{display:flex;flex-wrap:wrap;gap:10px;margin-top:14px}
  .card{background:#fff;border:1px solid #e6dcc4;border-radius:10px;padding:12px 14px;min-width:150px}
  .card .v{font-size:22px;font-weight:700} .card .l{font-size:12px;color:#6f5a3e}
  table{border-collapse:collapse;width:100%;background:#fff;border:1px solid #e6dcc4}
  th,td{padding:7px 9px;border-bottom:1px solid #eee5cf;text-align:left;vertical-align:top}
  th{font-size:12px;color:#6f5a3e;background:#f4efe1}
  td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}
  td.adj{font-size:12px;color:#6f5a3e}
  tr.bad td{background:#fff6ee}
  .note{background:#fff;border-left:3px solid #c4a334;padding:10px 12px;margin-top:12px}
</style></head><body>
<h1>Confidence report</h1>
<div class="muted">Last ${r.total} scans the server kept · ${esc(range)} · read-only</div>
${r.store.durable ? "" : `<div class="note">DATA_DIR is not set, so this store lives in /tmp and empties on every deploy.</div>`}

<div class="cards">
  ${card("Scans in store", String(r.total))}
  ${card("Landed on a low screen", `${r.failed}`, pct(r.failed, r.total))}
  ${card("…of those, AI was confident", `${r.failedButAiWasConfident}`, `${pct(r.failedButAiWasConfident, r.failed)} — our scoring pushed them down`)}
  ${card("Score lowered by the server", `${r.loweredAtAll}`, `${pct(r.loweredAtAll, r.total)} of all scans`)}
</div>

<h2>Why scans landed on a low screen</h2>
<table><tr><th>Cause</th><th class="n">Scans</th><th class="n">Share</th></tr>
${(Object.keys(r.causes) as Cause[]).map(k =>
  `<tr><td>${esc(CAUSE_LABEL[k])}</td><td class="n">${r.causes[k]}</td><td class="n">${pct(r.causes[k], r.failed)}</td></tr>`).join("")}
</table>

<h2>Screens shown</h2>
<table><tr><th>Screen</th><th class="n">Scans</th><th class="n">Share</th></tr>
${(Object.keys(r.screens) as Screen[]).map(k =>
  `<tr><td>${esc(SCREEN_LABEL[k])}</td><td class="n">${r.screens[k]}</td><td class="n">${pct(r.screens[k], r.total)}</td></tr>`).join("")}
</table>

<h2>How often each server adjustment fired (all scans)</h2>
<table><tr><th>Adjustment</th><th class="n">Scans</th><th class="n">Share</th></tr>
${([
  ["evidence_penalty", "−15 per identified field with no evidence"],
  ["photo_cap", "One-photo cap (75)"],
  ["non_core_cap", "Non-clothing cap (70)"],
  ["authenticity_cap", "Authenticity cap (60)"],
  ["no_evidence_cap", "No-evidence cap (50)"],
] as const).map(([k, label]) =>
  `<tr><td>${esc(label)}</td><td class="n">${r.adjustmentCounts[k]}</td><td class="n">${pct(r.adjustmentCounts[k], r.total)}</td></tr>`).join("")}
</table>

<h2>By number of photos</h2>
<table><tr><th>Photos</th><th class="n">Scans</th><th class="n">Low screen</th><th class="n">…caused by our scoring</th></tr>
${r.byPhotos.map(p =>
  `<tr><td>${p.photos}</td><td class="n">${p.n}</td><td class="n">${p.failed} (${pct(p.failed, p.n)})</td><td class="n">${p.serverCaused}</td></tr>`).join("")}
</table>

<h2>Scans that landed on a low screen (${failedRows.length})</h2>
<table><tr><th>When</th><th>Item</th><th class="n">AI score</th><th class="n">Shown</th><th>Screen</th><th>Cause</th><th>What the server changed</th></tr>
${failedRows.map(rowHtml).join("") || `<tr><td colspan="7" class="muted">None in the store.</td></tr>`}
</table>

<h2>All scans (${r.rows.length})</h2>
<table><tr><th>When</th><th>Item</th><th class="n">AI score</th><th class="n">Shown</th><th>Screen</th><th>Cause</th><th>What the server changed</th></tr>
${r.rows.map(rowHtml).join("") || `<tr><td colspan="7" class="muted">None in the store.</td></tr>`}
</table>
<p class="muted">"AI score" is the AI's own number before our scoring. "&gt;50" means the record only shows it was above 50.</p>
</body></html>`;
}
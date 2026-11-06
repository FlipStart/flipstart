/**
 * server/confidenceReport.ts
 *
 * Founder-only, READ-ONLY report: why do scans land on the low-confidence
 * screens, and did the computed confidence model fix it?
 *
 * Reads the analysis store (the last 300 analyses, 7 days) and nothing else.
 * It writes nothing, calls no API, and changes no behaviour.
 *
 * Two scoring models can be in the store at once, and the report compares them:
 *
 *   OLD — the model's own identity_confidence, adjusted by the validator:
 *         −15 per identified field with no evidence, 75 for one photo, 70 for
 *         non-clothing, 60 for authenticity concerns, 50 with no evidence. Every
 *         adjustment was recorded (the penalty as a downgrade, the caps as
 *         labels), and is read back here.
 *   NEW — levels-v1 (server/canonical/confidence.ts): computed from what the
 *         model identified. Recognised by derived.confidence on the record.
 *
 * Old and new rows are DIFFERENT scans, so their mix of items differs. For a
 * same-scan comparison, every old scan is also run through the new scoring
 * from its saved fields ("rescored"). That is approximate: old scans did not
 * report an identification level, other items in frame or photo problems.
 *
 * Scores are ordinal compatibility numbers, not probabilities. The report also
 * shows the tier the new app displays instead of a number: HIGH / MEDIUM /
 * LOW, or "Couldn't identify" for a problem state (shared/confidenceTier.ts).
 *
 * Screen thresholds mirror app/loading.tsx exactly:
 *   conf > 0 && conf < 35  → very-low screen ("Something interrupted the hunt")
 *   conf > 0 && conf < 55  → low screen ("Hard to identify from here")
 *   otherwise              → results (including 0, a known app bug)
 */
import type { StoredAnalysis } from "./analysisStore";
import { DASHBOARD_TZ } from "./dashboardDates";
import { computeConfidence, LEVELS } from "./canonical/confidence.js";
import { tierFromScore } from "../shared/confidenceTier.js";

/** Mirrors app/loading.tsx. Change both together or not at all. */
export const VERY_LOW_BELOW = 35;
export const LOW_BELOW = 55;

export type Screen = "results" | "low" | "very_low" | "zero_shown_as_result";
export type Scoring = "old" | "new";
/** What the new app shows. "problem" = Couldn't identify / no item / several items. */
export type TierShown = "high" | "medium" | "low" | "problem";

/** OLD scoring: why a scan landed on a low screen. */
export type OldCause =
  /** The AI's own score was already below 55. */
  | "ai_unsure"
  /** The AI scored 55+; the missing-evidence penalty took it below 55. */
  | "evidence_penalty"
  /** The AI scored above 50; the no-evidence cap set it to 50. */
  | "no_evidence_cap"
  /** Below 55 by some other combination we cannot attribute exactly. */
  | "unclear";

/** NEW scoring: the issue the computed model recorded, or our level check. */
export type NewCause =
  | "no_item" | "multiple_items" | "photo_problem" | "cannot_identify"
  /** The AI reported a level that shows results; our check against the
   *  validated fields lowered it onto a low screen. */
  | "level_lowered";

export type Cause = OldCause | NewCause;

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
  scoring: Scoring;
  /** The AI's own score, when the record pins it down exactly. */
  aiScore: number | null;
  /** OLD scoring only: when aiScore is unknown, the AI scored ABOVE this. */
  aiScoreAbove: number | null;
  finalScore: number;
  screen: Screen;
  /** Only for scans that landed on a low screen (or the 0 bug). */
  cause: Cause | null;
  /** OLD scoring: what the validator changed. Empty for NEW rows. */
  adjustments: Adjustment[];
  /** NEW scoring: how the score was built. Empty for OLD rows. */
  reasons: string[];
  /** NEW scoring: the level after our check. */
  level: string | null;
  /** NEW scoring: the level the AI reported, before our check. */
  levelReported: string | null;
  /** NEW scoring: whether our check against the fields moved the AI's level.
   *  The no-item / several-items overrides follow the AI's own facts and
   *  don't count. */
  levelChange: "lowered" | "raised" | null;
  itemsInFrame: string | null;
  photoProblems: string[];
  /** OLD: the server lowered the score at all. NEW: our check lowered the level. */
  lowered: boolean;
  /** NEW scoring: what the new app shows. Null for OLD rows (see rescored). */
  tier: TierShown | null;
  /** OLD scoring only: the same scan through the new scoring. Approximate. */
  rescored: { score: number; screen: Screen; level: string; tier: TierShown } | null;
}

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

const rank = (l: unknown): number => (LEVELS as readonly unknown[]).indexOf(l);

export function screenFor(conf: number): Screen {
  if (conf > 0 && conf < VERY_LOW_BELOW) return "very_low";
  if (conf > 0 && conf < LOW_BELOW) return "low";
  if (conf <= 0) return "zero_shown_as_result";
  return "results";
}

/** The new scoring over an old scan's saved, validated fields. Never throws. */
function rescore(c: any, aiScore: number | null): ReportRow["rescored"] {
  try {
    if (!c.ai?.identification || typeof c.ai.identification !== "object") return null;
    const r = computeConfidence({
      ai: c.ai, aiSelfScore: aiScore ?? 0, recognition: c.derived?.recognition ?? null,
    });
    return { score: r.score, screen: screenFor(r.score), level: r.level, tier: r.tier ?? "problem" };
  } catch {
    return null;
  }
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

  const slots = Array.isArray(c.meta?.photo_slots_provided) ? c.meta.photo_slots_provided : [];
  const base = {
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
    finalScore,
    screen: screenFor(finalScore),
  };

  const dc = c.derived?.confidence;
  if (dc && typeof dc === "object") {
    const issue = typeof dc.issue === "string" ? (dc.issue as NewCause) : null;
    const level = typeof dc.level === "string" ? dc.level : null;
    const levelReported = typeof dc.level_reported === "string" ? dc.level_reported : null;
    let levelChange: ReportRow["levelChange"] = null;
    if (rank(level) >= 0 && rank(levelReported) >= 0 && issue !== "no_item" && issue !== "multiple_items") {
      if (rank(level) > rank(levelReported)) levelChange = "lowered";
      else if (rank(level) < rank(levelReported)) levelChange = "raised";
    }
    let cause: NewCause | null = null;
    if (base.screen !== "results") {
      cause = issue === "no_item" || issue === "multiple_items" ? issue
        : levelChange === "lowered" ? "level_lowered"
        : issue ?? "cannot_identify";
    }
    return {
      ...base,
      scoring: "new",
      aiScore: num(dc.ai_self_score),
      aiScoreAbove: null,
      cause,
      adjustments: [],
      reasons: Array.isArray(dc.reasons) ? dc.reasons.map(String) : [],
      level,
      levelReported,
      levelChange,
      itemsInFrame: typeof dc.items_in_frame === "string" ? dc.items_in_frame : null,
      photoProblems: Array.isArray(dc.photo_problems) ? dc.photo_problems.map(String) : [],
      lowered: levelChange === "lowered",
      // A record scored before the tier existed: the app works it out from
      // the number, so the report does too.
      tier: dc.tier === "high" || dc.tier === "medium" || dc.tier === "low" ? dc.tier
        : dc.tier === null ? "problem" : (tierFromScore(finalScore) ?? "problem"),
      rescored: null,
    };
  }

  // ── OLD scoring: reconstruct what the validator did ─────────────────────────
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

  // 2. Caps, in the order the old validator applied them. The authenticity
  //    label was written even when it changed nothing, so it only counts as a
  //    lowering when the score sits at 60.
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

  let cause: OldCause | null = null;
  if (base.screen !== "results") {
    if (aiScore != null && aiScore < LOW_BELOW) cause = "ai_unsure";
    else if (pen && num(pen.to) != null && (num(pen.to) as number) < LOW_BELOW) cause = "evidence_penalty";
    else if (adjustments.some(a => a.kind === "no_evidence_cap")) cause = "no_evidence_cap";
    else cause = "unclear";
  }

  return {
    ...base,
    scoring: "old",
    aiScore,
    aiScoreAbove: aiScore == null ? aiScoreAbove : null,
    cause,
    adjustments,
    reasons: [],
    level: null,
    levelReported: null,
    levelChange: null,
    itemsInFrame: null,
    photoProblems: [],
    lowered: aiScore != null ? finalScore < aiScore : aiScoreAbove != null,
    tier: null,
    rescored: rescore(c, aiScore),
  };
}

// ─── Summaries ───────────────────────────────────────────────────────────────

export interface ScoringSummary {
  total: number;
  screens: Record<Screen, number>;
  /** Scans that landed on a low screen or the 0 bug. */
  failed: number;
  medianShown: number | null;
  causes: Partial<Record<Cause, number>>;
  byPhotos: Array<{ photos: number; n: number; failed: number }>;
  /** OLD: of the failed scans, the AI was confident and our scoring pushed them down. */
  failedButAiWasConfident: number;
  /** OLD: how often each validator adjustment fired. */
  adjustmentCounts: Record<Adjustment["kind"], number>;
  /** OLD: scans whose score the server lowered at all. */
  loweredAtAll: number;
  /** NEW: identification level counts, after our check. */
  levels: Record<string, number>;
  /** NEW: identification levels the AI reported, before our check. */
  levelsReported: Record<string, number>;
  /** NEW: how often our check moved the AI's level. */
  levelChanges: { lowered: number; raised: number };
  /** NEW: items-in-frame counts. */
  itemsInFrame: Record<string, number>;
  /** NEW: photo problem counts (a scan can have several). */
  photoProblems: Record<string, number>;
  /** What the new app shows: high / medium / low / problem. */
  tiers: Record<string, number>;
}

export interface ConfidenceReport {
  generatedAt: number;
  store: { stored: number; durable: boolean };
  rows: ReportRow[];
  total: number;
  oldest: number | null;
  newest: number | null;
  old: ScoringSummary;
  /** The OLD scans again, scored by the new model from their saved fields. */
  rescored: ScoringSummary;
  new: ScoringSummary;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

const isLow = (s: Screen) => s !== "results";

function summarize(rows: ReportRow[]): ScoringSummary {
  const screens: Record<Screen, number> = { results: 0, low: 0, very_low: 0, zero_shown_as_result: 0 };
  const causes: Partial<Record<Cause, number>> = {};
  const adjustmentCounts: Record<Adjustment["kind"], number> = {
    evidence_penalty: 0, photo_cap: 0, authenticity_cap: 0, non_core_cap: 0, no_evidence_cap: 0,
  };
  const levels: Record<string, number> = {};
  const levelsReported: Record<string, number> = {};
  const levelChanges = { lowered: 0, raised: 0 };
  const itemsInFrame: Record<string, number> = {};
  const photoProblems: Record<string, number> = {};
  const tiers: Record<string, number> = {};
  const photosMap = new Map<number, { n: number; failed: number }>();
  let failedButAiWasConfident = 0;
  let loweredAtAll = 0;

  for (const r of rows) {
    screens[r.screen]++;
    if (r.cause) {
      causes[r.cause] = (causes[r.cause] ?? 0) + 1;
      if (r.cause === "evidence_penalty" || r.cause === "no_evidence_cap") failedButAiWasConfident++;
    }
    for (const kind of new Set(r.adjustments.map(a => a.kind))) adjustmentCounts[kind]++;
    if (r.lowered) loweredAtAll++;
    if (r.level) levels[r.level] = (levels[r.level] ?? 0) + 1;
    if (r.levelReported) levelsReported[r.levelReported] = (levelsReported[r.levelReported] ?? 0) + 1;
    if (r.levelChange) levelChanges[r.levelChange]++;
    if (r.itemsInFrame) itemsInFrame[r.itemsInFrame] = (itemsInFrame[r.itemsInFrame] ?? 0) + 1;
    for (const p of r.photoProblems) photoProblems[p] = (photoProblems[p] ?? 0) + 1;
    if (r.tier) tiers[r.tier] = (tiers[r.tier] ?? 0) + 1;
    const p = photosMap.get(r.photos) ?? { n: 0, failed: 0 };
    p.n++;
    if (isLow(r.screen)) p.failed++;
    photosMap.set(r.photos, p);
  }

  return {
    total: rows.length,
    screens,
    failed: screens.low + screens.very_low + screens.zero_shown_as_result,
    medianShown: median(rows.map(r => r.finalScore)),
    causes,
    byPhotos: [...photosMap.entries()].sort((a, b) => a[0] - b[0]).map(([photos, v]) => ({ photos, ...v })),
    failedButAiWasConfident,
    adjustmentCounts,
    loweredAtAll,
    levels,
    levelsReported,
    levelChanges,
    itemsInFrame,
    photoProblems,
    tiers,
  };
}

/** Old rows as the new scoring would have shown them: screens, median, photos and levels only. */
function asRescored(rows: ReportRow[]): ReportRow[] {
  return rows.flatMap(r => r.rescored ? [{
    ...r,
    finalScore: r.rescored.score,
    screen: r.rescored.screen,
    level: r.rescored.level,
    tier: r.rescored.tier,
    cause: null, adjustments: [], lowered: false, levelReported: null, levelChange: null,
  }] : []);
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
  const oldRows = rows.filter(r => r.scoring === "old");

  return {
    generatedAt: now,
    store,
    rows,
    total: rows.length,
    oldest: rows.length ? rows[rows.length - 1].analyzedAt : null,
    newest: rows.length ? rows[0].analyzedAt : null,
    old: summarize(oldRows),
    rescored: summarize(asRescored(oldRows)),
    new: summarize(rows.filter(r => r.scoring === "new")),
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
  no_item: "No item in the photo",
  multiple_items: "Several items, none clearly the subject",
  photo_problem: "Photo problem (blurry, dark, far, glare, cut off)",
  cannot_identify: "AI couldn't identify the item",
  level_lowered: "Our level check lowered it",
};

const LEVEL_LABEL: Record<string, string> = {
  exact: "Exact product", brand: "Brand or licensed name", type: "Item type only",
  partial: "Partly identified", none: "Couldn't identify",
};

const ITEMS_LABEL: Record<string, string> = {
  one: "One item", multiple_main_clear: "Several, main one clear", multiple_unclear: "Several, none clear",
};

const TIER_SHOWN_LABEL: Record<TierShown, string> = {
  high: "High confidence", medium: "Medium confidence", low: "Low confidence",
  problem: "Couldn't identify (problem state)",
};

const PROBLEM_LABEL: Record<string, string> = {
  blurry: "Blurry", too_dark: "Too dark", too_far: "Too far away", glare: "Glare",
  cut_off: "Item cut off", no_item: "No item in the photo",
};

export function renderConfidenceReport(r: ConfidenceReport): string {
  const card = (label: string, value: string, sub = "") =>
    `<div class="card"><div class="v">${esc(value)}</div><div class="l">${esc(label)}</div>${sub ? `<div class="s">${esc(sub)}</div>` : ""}</div>`;

  const countTable = (title: string, head: string, counts: Record<string, number>, labels: Record<string, string>, of: number) => {
    const keys = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
    return `<h3>${esc(title)}</h3><table><tr><th>${esc(head)}</th><th class="n">Scans</th><th class="n">Share</th></tr>
${keys.map(k => `<tr><td>${esc(labels[k] ?? k)}</td><td class="n">${counts[k]}</td><td class="n">${pct(counts[k], of)}</td></tr>`).join("")
  || `<tr><td colspan="3" class="muted">None yet.</td></tr>`}</table>`;
  };

  const levelTable = (s: ScoringSummary) => {
    const keys = [...LEVELS, ...Object.keys({ ...s.levelsReported, ...s.levels })
      .filter(k => !(LEVELS as readonly string[]).includes(k))];
    const body = keys
      .filter(k => s.levelsReported[k] || s.levels[k])
      .map(k => `<tr><td>${esc(LEVEL_LABEL[k] ?? k)}</td><td class="n">${s.levelsReported[k] ?? 0}</td><td class="n">${s.levels[k] ?? 0}</td></tr>`)
      .join("");
    return `<h3>How far the AI got</h3><table><tr><th>Identification</th><th class="n">AI reported</th><th class="n">Final level</th></tr>
${body || `<tr><td colspan="3" class="muted">None yet.</td></tr>`}</table>
<div class="muted">Our check against the identified fields lowered ${s.levelChanges.lowered} and raised ${s.levelChanges.raised} of ${s.total} scans. "Final level" also includes no-item and several-items scans set to "Couldn't identify" from the AI's own answer; those aren't counted as our check.</div>`;
  };

  // NEW rows: the stored reasons already say "Lowered from type to partial: …"
  // or "Raised from type to brand: …" when our check moved the level.
  const details = (x: ReportRow) => {
    if (x.scoring === "new") {
      const shown = x.tier ? [`<b>${esc(TIER_SHOWN_LABEL[x.tier])}</b>`] : [];
      return [...shown, ...x.reasons.map(esc)].join("<br>");
    }
    const rs = x.rescored
      ? [`New scoring on this scan: ${x.rescored.score} (${esc(x.rescored.level)}) · ${esc(SCREEN_LABEL[x.rescored.screen])} · ${esc(TIER_SHOWN_LABEL[x.rescored.tier])}`] : [];
    return [...x.adjustments.map(a => esc(a.label)), ...rs].join("<br>");
  };

  const rowHtml = (x: ReportRow) => `
    <tr class="${x.cause ? "bad" : ""}">
      <td>${esc(when.format(new Date(x.analyzedAt)))}</td>
      <td>${esc(x.itemName || "—")}<div class="s">${esc(x.category)} · ${x.photos} photo${x.photos === 1 ? "" : "s"} · user ${esc(x.owner)}</div></td>
      <td><span class="tag ${x.scoring}">${x.scoring === "new" ? "New" : "Old"}</span></td>
      <td class="n">${x.aiScore != null ? x.aiScore : x.aiScoreAbove != null ? `&gt;${x.aiScoreAbove}` : "?"}</td>
      <td class="n">${x.finalScore}</td>
      <td>${esc(SCREEN_LABEL[x.screen])}</td>
      <td>${x.cause ? esc(CAUSE_LABEL[x.cause]) : ""}</td>
      <td class="adj">${details(x)}</td>
    </tr>`;

  const head = `<tr><th>When</th><th>Item</th><th>Scoring</th><th class="n">AI's own</th><th class="n">Shown</th><th>Screen</th><th>Why low</th><th>Details</th></tr>`;

  const range = r.oldest && r.newest
    ? `${when.format(new Date(r.oldest))} → ${when.format(new Date(r.newest))} (Central)` : "no scans stored";

  const compareRow = (label: string, s: ScoringSummary) => `<tr>
    <td>${esc(label)}</td><td class="n">${s.total}</td>
    <td class="n">${pct(s.screens.results, s.total)}</td>
    <td class="n">${pct(s.screens.low, s.total)}</td>
    <td class="n">${pct(s.screens.very_low, s.total)}</td>
    <td class="n">${s.screens.zero_shown_as_result}</td>
    <td class="n">${s.medianShown ?? "—"}</td></tr>`;

  const photoKeys = [...new Set([...r.old.byPhotos, ...r.new.byPhotos].map(p => p.photos))].sort((a, b) => a - b);
  const photoCell = (s: ScoringSummary, n: number) => {
    const p = s.byPhotos.find(x => x.photos === n);
    return p ? `${p.n} scan${p.n === 1 ? "" : "s"} · ${pct(p.failed, p.n)} low` : "—";
  };

  const failedRows = r.rows.filter(x => x.cause);

  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>Confidence report</title>
<style>
  body{font:14px/1.45 -apple-system,system-ui,Segoe UI,sans-serif;margin:0;padding:20px;background:#faf8f2;color:#2b2118}
  h1{font-size:20px;margin:0 0 4px} h2{font-size:16px;margin:30px 0 8px} h3{font-size:14px;margin:18px 0 6px}
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
  .tag{font-size:11px;padding:1px 6px;border-radius:8px;border:1px solid #e6dcc4}
  .tag.new{background:#e8f1e6;border-color:#bcd5b5} .tag.old{background:#f4efe1}
  .note{background:#fff;border-left:3px solid #c4a334;padding:10px 12px;margin-top:12px}
</style></head><body>
<h1>Confidence report</h1>
<div class="muted">Last ${r.total} scans the server kept · ${esc(range)} · read-only</div>
${r.store.durable ? "" : `<div class="note">DATA_DIR is not set, so this store lives in /tmp and empties on every deploy.</div>`}

<div class="cards">
  ${card("Scans in store", String(r.total))}
  ${card("New scoring: low screen", pct(r.new.failed, r.new.total), `${r.new.failed} of ${r.new.total} scans`)}
  ${card("Old scoring: low screen", pct(r.old.failed, r.old.total), `${r.old.failed} of ${r.old.total} scans`)}
  ${card("Old scans, rescored: low screen", pct(r.rescored.failed, r.rescored.total), `${r.rescored.failed} of ${r.rescored.total} · same scans, new scoring`)}
  ${card("Old scoring: lowered by server", pct(r.old.loweredAtAll, r.old.total), `${r.old.loweredAtAll} scans`)}
</div>

<h2>Before / after</h2>
<table><tr><th>Scoring</th><th class="n">Scans</th><th class="n">Results</th><th class="n">Low screen</th><th class="n">Very-low screen</th><th class="n">Shown 0</th><th class="n">Median shown</th></tr>
${compareRow("Old (AI's number + our adjustments)", r.old)}
${compareRow("Old scans, rescored with new scoring (approximate)", r.rescored)}
${compareRow("New (computed from what the AI identified)", r.new)}
</table>
<p class="muted">The Old and New rows are different scans: New rows are scans made since the new scoring went live, so the items differ. The rescored row runs the new scoring over the same old scans, from their saved fields, so it compares like with like. It is approximate: old scans didn't report how far the AI got, other items in the photo, or photo problems, and filed band and team names less consistently.</p>

<h2>What the new app shows instead of a number</h2>
<table><tr><th>Shown</th><th class="n">Old scans, rescored</th><th class="n">New scans</th></tr>
${(["high", "medium", "low", "problem"] as const).map(t => `<tr><td>${esc(TIER_SHOWN_LABEL[t])}</td><td class="n">${r.rescored.tiers[t] ?? 0} · ${pct(r.rescored.tiers[t] ?? 0, r.rescored.total)}</td><td class="n">${r.new.tiers[t] ?? 0} · ${pct(r.new.tiers[t] ?? 0, r.new.total)}</td></tr>`).join("")}
</table>
<p class="muted">From the identification level only. Photo count, authenticity, price confidence and the Buy rating play no part. The numbers in this report are ordinal compatibility scores, not probabilities.</p>

<h2>New scoring</h2>
${countTable("Why scans landed on a low screen", "Reason", r.new.causes as Record<string, number>, CAUSE_LABEL, r.new.failed)}
${levelTable(r.new)}
${countTable("Items in the photo", "Photo showed", r.new.itemsInFrame, ITEMS_LABEL, r.new.total)}
${countTable("Photo problems reported", "Problem", r.new.photoProblems, PROBLEM_LABEL, r.new.total)}

<h2>Old scoring</h2>
${countTable("Why scans landed on a low screen", "Cause", r.old.causes as Record<string, number>, CAUSE_LABEL, r.old.failed)}
<h3>How often each old adjustment fired</h3>
<table><tr><th>Adjustment</th><th class="n">Scans</th><th class="n">Share</th></tr>
${([
  ["evidence_penalty", "−15 per identified field with no evidence"],
  ["photo_cap", "One-photo cap (75)"],
  ["non_core_cap", "Non-clothing cap (70)"],
  ["authenticity_cap", "Authenticity cap (60)"],
  ["no_evidence_cap", "No-evidence cap (50)"],
] as const).map(([k, label]) =>
  `<tr><td>${esc(label)}</td><td class="n">${r.old.adjustmentCounts[k]}</td><td class="n">${pct(r.old.adjustmentCounts[k], r.old.total)}</td></tr>`).join("")}
</table>
${countTable("Old scans, rescored: how far the AI got (worked out from the fields)", "Identification", r.rescored.levels, LEVEL_LABEL, r.rescored.total)}

<h2>By number of photos</h2>
<table><tr><th>Photos</th><th class="n">Old scoring</th><th class="n">Old scans, rescored</th><th class="n">New scoring</th></tr>
${photoKeys.map(n => `<tr><td>${n}</td><td class="n">${photoCell(r.old, n)}</td><td class="n">${photoCell(r.rescored, n)}</td><td class="n">${photoCell(r.new, n)}</td></tr>`).join("")
  || `<tr><td colspan="4" class="muted">None in the store.</td></tr>`}
</table>

<h2>Scans that landed on a low screen (${failedRows.length})</h2>
<table>${head}
${failedRows.map(rowHtml).join("") || `<tr><td colspan="8" class="muted">None in the store.</td></tr>`}
</table>

<h2>All scans (${r.rows.length})</h2>
<table>${head}
${r.rows.map(rowHtml).join("") || `<tr><td colspan="8" class="muted">None in the store.</td></tr>`}
</table>
<p class="muted">"AI's own" is the AI's own number. Under old scoring it decided the score before our adjustments; under new scoring it is recorded for comparison only. "&gt;50" means the record only shows it was above 50.</p>
</body></html>`;
}
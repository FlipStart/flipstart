/**
 * server/listingFacts.ts
 *
 * The facts Generate Listings is allowed to write about, built on the server.
 *
 * Why this exists: the listing writer used to receive only name, brand,
 * category, era (often the literal string "Unknown"), material, style, value
 * and demand, while the prompt told it to "cover condition and sizing". With
 * nothing to cover, gpt-4.1-mini invented filler and gpt-6-luna honestly wrote
 * "era, size, material and condition were not provided". Both are bad
 * listings.
 *
 * Now every fact is either KNOWN (and passed) or ABSENT (and never mentioned).
 * "Unknown" never reaches the model as a value.
 *
 * Source order:
 *   1. the stored canonical analysis for this scan (server-side, 7-day store),
 *      looked up by analysisId and owner, so it works for every app version;
 *   2. otherwise hints the app sends from the saved scan (older scans, or a
 *      scan older than the store keeps).
 *
 * Condition always resolves to a word. With no damage found it is "excellent"
 * (or "good" when the photos could not show enough) — founder rule: never
 * "condition unknown".
 */
import type { CanonicalAnalysisV1 } from "../shared/canonical.types.js";

export type ConditionWord = "excellent" | "great" | "good" | "fair";

export interface ListingFacts {
  /** Lead era word, or "" for modern / unknown items: "Vintage", "Y2K", "90s", "Vintage 80s". */
  era: string;
  brand: string;
  itemName: string;
  category: string;
  condition: ConditionWord;
  /** Flaws to disclose, plain words ("small hole on left cuff"). */
  flaws: string[];
  /** "XL", "M", "32x30". "" when unknown. */
  size: string;
  /** "men's" / "women's" / "unisex" / "kids". "" when unknown. */
  gender: string;
  /** Only when the colour read was confident. */
  color: string;
  material: string;
  styleLabels: string[];
  /**
   * WHAT is printed, embroidered or pictured on the item, as a buyer would search it:
   * "Disney", "Mickey Mouse, Goofy and Donald Duck on the chest", "Chicago Bulls". Empty when the
   * scan found nothing nameable. Without this the writer only knows there IS a graphic
   * ("embroidered graphic") and has nothing to say about it.
   */
  design: string[];
}

export interface ListingHints {
  eraStatus?: string;
  productionDecade?: string;
  styleEra?: string;
  sizeLabel?: string;
  targetDepartment?: string;
  primaryColor?: string;
  obviousDamage?: string[];
  assessmentLimited?: boolean;
  /** Saved-scan design details (character / artist / team / event / subject, and what the photos showed). */
  design?: string[];
}

/** Words that mean "we don't know" and must never be written into a listing. */
const UNKNOWNISH = /^(unknown|n\/?a|none|not (specified|provided|available|listed|visible)|unspecified|unclear|other|-|—)?$/i;

export function known(v: string | null | undefined): string {
  const s = (v ?? "").trim();
  return UNKNOWNISH.test(s) ? "" : s;
}

/** A "subject" that only restates that a design exists says nothing a buyer can use. */
const VAGUE_DESIGN = /^(graphics?|logos?|prints?|designs?|text|lettering|pattern|patterns|artwork|embroider(?:y|ed)|screen ?print(?:ed)?|graphic (?:tee|print|design)|embroidered (?:graphic|logo|design))$/i;

/** One design phrase, single line, bounded, or "" when it is empty or vague. */
function designPhrase(v: string | null | undefined, max = 110): string {
  const s = known(v).replace(/\s+/g, " ").replace(/[\u0000-\u001f]/g, "").trim();
  return !s || VAGUE_DESIGN.test(s) ? "" : s.slice(0, max);
}

/**
 * What the item shows, from the scan's identity fields and the photo observations behind them.
 * Order: the named thing first (character / artist / team / event / subject), then what the
 * photos actually showed ("Mickey, Goofy and Donald Duck on the chest"). Deduped, at most 4.
 * Observations written FROM the user's note are included too: that is the seller's own word.
 */
export function designPhrases(
  ids: { character_or_license?: string; artist?: string; team?: string; event?: string; subject?: string },
  evidence: Array<{ field?: string; observation?: string; evidence_mode?: string }> = [],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string | null | undefined) => {
    const p = designPhrase(raw);
    if (!p) return;
    const key = p.toLowerCase();
    // Skip a phrase that only repeats one already kept ("Disney" then "Disney characters").
    for (const k of seen) if (k.includes(key) || key.includes(k)) { if (key.length <= k.length) return; }
    seen.add(key); out.push(p);
  };
  for (const f of [ids.character_or_license, ids.artist, ids.team, ids.event, ids.subject]) push(f);
  const DESIGN_FIELDS = new Set(["character_or_license", "artist", "team", "event", "subject"]);
  for (const e of evidence) {
    if (DESIGN_FIELDS.has(String(e.field)) && e.evidence_mode !== "inference") push(e.observation);
  }
  return out.slice(0, 4);
}

const DECADE_SHORT: Record<string, string> = {
  pre_1950s: "", "1950s": "50s", "1960s": "60s", "1970s": "70s", "1980s": "80s",
  "1990s": "90s", "2000s": "2000s", "2010s": "", "2020s": "",
};

/** The era word a reseller would lead with, or "" when none applies. */
export function eraWord(status?: string, decade?: string, styleEra?: string, freeText?: string): string {
  const st = (status ?? "").toLowerCase();
  const dec = DECADE_SHORT[(decade ?? "").toLowerCase()] ?? "";
  const vintage = st === "confirmed_vintage" || st === "likely_vintage";
  if (vintage) {
    if ((styleEra ?? "").toLowerCase() === "y2k") return "Y2K";
    if (dec === "2000s") return "Y2K";
    return dec ? `Vintage ${dec}` : "Vintage";
  }
  if (st) return "";   // modern, vintage_inspired, unknown: no era word
  // No status (older client data): accept only an explicit vintage-ish phrase.
  const t = known(freeText);
  if (/\by2k\b/i.test(t)) return "Y2K";
  const m = /\b(?:19)?([5-9]0)'?s\b/.exec(t);
  if (/\bvintage\b/i.test(t)) return m ? `Vintage ${m[1]}s` : "Vintage";
  if (m) return `Vintage ${m[1]}s`;
  return "";
}

const GENDER: Record<string, string> = { mens: "men's", womens: "women's", unisex: "unisex", kids: "kids" };

const FLAW_WORDS: Record<string, string> = {
  possible_stain: "small stain", hole: "small hole", tear: "small tear", cracking: "cracking on the graphic",
  peeling: "some peeling", broken_hardware: "broken hardware", missing_component: "missing piece",
  repair: "past repair", heavy_wear: "noticeable wear", other: "minor flaw",
};

function flawText(type: string, location: string): string {
  const base = FLAW_WORDS[type] ?? "minor flaw";
  const loc = known(location);
  return loc ? `${base} on ${loc.replace(/^(the|on|at)\s+/i, "")}` : base;
}

export interface FactsInput {
  item_name: string;
  brand: string;
  category: string;
  estimated_era?: string;
  material_guess?: string;
  style_labels?: string[];
}

export function buildListingFacts(
  input: FactsInput,
  canonical: CanonicalAnalysisV1 | null,
  hints: ListingHints = {},
): ListingFacts {
  const base = {
    brand: known(input.brand),
    itemName: known(input.item_name),
    category: known(input.category),
    material: known(input.material_guess),
    styleLabels: (input.style_labels ?? []).map(known).filter(Boolean).slice(0, 4),
    design: [] as string[],
  };

  if (canonical) {
    const ai = canonical.ai;
    const d = canonical.derived;
    const va = ai.visible_attributes;
    const cs = d.condition_summary;
    const flaws = (cs?.obvious_findings ?? []).map(f => flawText(f.type, f.location)).slice(0, 3);
    const sev = cs?.max_obvious_severity ?? "none";
    const condition: ConditionWord =
      sev === "moderate" || sev === "major" ? "fair"
      : sev === "minor" ? "good"
      : cs?.assessment_limited ? "good"
      : (ai.condition?.condition_confidence ?? 0) >= 60 ? "excellent" : "great";
    const deptOk = (va.target_department_confidence ?? 0) >= 50;
    return {
      ...base,
      design: designPhrases(ai.identification ?? {}, ai.identification?.identification_evidence ?? []),
      era: eraWord(d.era_effective?.status, d.era_effective?.production_decade_effective, ai.era?.style_era),
      condition,
      flaws,
      size: known(va.size_label),
      gender: deptOk ? GENDER[va.target_department] ?? "" : "",
      color: (va.color_confidence ?? 0) >= 70 ? known(va.primary_color) : "",
      material: (va.material_composition ?? []).map(known).filter(Boolean).join(", ") || base.material,
    };
  }

  // Hints from the app's saved scan.
  const flaws = (hints.obviousDamage ?? []).map(known).filter(Boolean).slice(0, 3);
  return {
    ...base,
    design: (hints.design ?? []).map(d => designPhrase(d)).filter(Boolean).slice(0, 4),
    era: eraWord(hints.eraStatus, hints.productionDecade, hints.styleEra, input.estimated_era),
    condition: flaws.length ? "good" : hints.assessmentLimited ? "good" : "excellent",
    flaws,
    size: known(hints.sizeLabel),
    gender: GENDER[(hints.targetDepartment ?? "").toLowerCase()] ?? "",
    color: known(hints.primaryColor),
  };
}

/** The item block the model sees. Absent facts are simply not listed. */
export function factsBlock(f: ListingFacts): string {
  const lines: string[] = [];
  const add = (k: string, v: string) => { if (v) lines.push(`${k}: ${v}`); };
  add("Era", f.era);
  add("Brand", f.brand);
  add("Item", f.itemName);
  add("Category", f.category);
  add("Condition", f.condition);
  if (f.flaws.length) lines.push(`Flaws to disclose: ${f.flaws.join("; ")}`);
  add("Size", f.size);
  add("Fit", f.gender);
  add("Color", f.color);
  add("Material", f.material);
  if (f.styleLabels.length) lines.push(`Style: ${f.styleLabels.join(", ")}`);
  // What is printed / embroidered on it. The writer must NAME these, never just say "graphic".
  if (f.design.length) lines.push(`Design on the item: ${f.design.join("; ")}`);
  return lines.join("\n");
}

// ── Safety net ────────────────────────────────────────────────────────────────

/** A sentence containing any of these is about missing data. It is dropped. */
const MISSING_PHRASE = new RegExp(
  [
    String.raw`\bunknown\b`, String.raw`\bnot (?:provided|specified|listed|available|stated|given|known|visible|shown|confirmed)\b`,
    String.raw`\bunspecified\b`, String.raw`\bunconfirmed\b`, String.raw`\bn\/a\b`,
    String.raw`\b(?:no|without) (?:size|era|material|condition) (?:info|information|details?|listed|given)\b`,
    String.raw`\b(?:era|size|material|condition)s? (?:is|are|was|were) (?:not|un)`,
  ].join("|"),
  "i",
);

/** Removes sentences about missing info. Never empties a description. */
export function stripMissingInfo(text: string): string {
  if (!text) return text;
  const lines = text.split("\n");
  const out = lines.map(line => {
    if (/^\s*#/.test(line)) return line;                 // hashtag line
    const parts = line.split(/(?<=[.!?])\s+/);
    const kept = parts.filter(p => !MISSING_PHRASE.test(p));
    return kept.join(" ");
  }).filter((l, i, arr) => l.trim() !== "" || (i > 0 && arr[i - 1].trim() !== ""));
  const joined = out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return joined || text.replace(/\s*\b(unknown|n\/a)\b/gi, "").trim();
}

/** Title: drop the bare word "Unknown" and tidy spaces. */
export function cleanTitle(t: string): string {
  return t.replace(/\b(unknown|n\/a)\b/gi, "").replace(/\s{2,}/g, " ").replace(/\s+([,.)])/g, "$1").trim();
}

/** Depop: exactly five hashtags, lowercase, no spaces inside a tag, no duplicates. */
export function normalizeHashtags(desc: string, fallback: string[]): string {
  const tags = (desc.match(/#[^\s#]+/g) ?? []).map(t => `#${t.slice(1).toLowerCase().replace(/[^a-z0-9]/g, "")}`)
    .filter(t => t.length > 2);
  const uniq = [...new Set(tags)];
  for (const f of fallback) {
    if (uniq.length >= 5) break;
    const t = `#${f.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
    if (t.length > 2 && !uniq.includes(t)) uniq.push(t);
  }
  const body = desc.replace(/#[^\s#]+/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return uniq.length ? `${body}\n\n${uniq.slice(0, 5).join(" ")}` : body;
}
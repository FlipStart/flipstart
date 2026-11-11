/**
 * server/comps/queryBuilder.ts
 *
 * Eligibility and deterministic query construction.
 *
 * No AI call. The query is built from validated canonical facts by fixed rules,
 * because a second model request would cost money, add latency, and make the
 * same scan produce different searches on different days — which would poison
 * the cache and make Phase 0's validation data meaningless.
 */
import type { CanonicalAnalysisV1 } from "../../shared/canonical.types.js";
import type { CompsIneligibleReason } from "./types.js";
import { QUERY_BUILDER_VERSION, normalizeText, detectClosure } from "./normalize.js";
import { styleWords, typeIsStyled, queryPart, notStyleTag, searchType } from "./searchPlan.js";
import { scanCategory, brandMask } from "./taxonomy.js";

export interface QueryComponent {
  kind: string;
  value: string;
  included: boolean;
  reason: string;
}

export interface BuiltQuery {
  eligible: true;
  query: string;
  normalizedQuery: string;
  components: QueryComponent[];
  historyDays: number;
  /** Ranked alternatives, kept for the founder record. The searches actually
   *  run are planned in searchPlan.ts. */
  candidates: string[];
  /** No brand, model or subject: searched by style words and type. Its comps
   *  can only ever be Similar, so its data is never better than Limited. */
  unbranded: boolean;
  builderVersion: string;
}

export interface IneligibleQuery {
  eligible: false;
  reason: CompsIneligibleReason;
  detail: string;
  builderVersion: string;
}

/** An obvious colour (black, navy, brown…) at this confidence or more goes in
 *  the precise search: sellers almost always write it. Was 85. */
const COLOUR_CONFIDENT_AT = 70;

const GENERIC_ITEM_TYPES = new Set([
  "", "unknown", "item", "clothing", "garment", "apparel", "other", "misc",
]);

/**
 * Longer windows for items that sell rarely.
 *
 * A common modern hoodie has hundreds of sales in 90 days. A niche 1990s
 * local-business tee may have two in a year — and 90 days would return nothing,
 * which reads as "worthless" rather than "rarely traded". The provider
 * documents daysToScrape up to 365, so the long window is available.
 */
export function chooseHistoryDays(c: CanonicalAnalysisV1): number {
  const era = c.derived.era_effective;
  const oldish = era.status === "confirmed_vintage" ||
                 era.status === "likely_vintage" ||
                 c.ai.era.style_era === "y2k";
  const niche = Boolean(c.ai.identification.subject || c.ai.identification.event ||
                        c.ai.identification.artist || c.ai.identification.character_or_license) ||
                c.ai.marketability.buyer_pool === "narrow" ||
                c.ai.marketability.buyer_pool === "very_narrow";
  const rareModel = Boolean((c.ai.identification.model_or_product_number ?? "").trim());
  return (oldish || niche || rareModel) ? 365 : 90;
}

export function buildCompsQuery(c: CanonicalAnalysisV1): BuiltQuery | IneligibleQuery {
  const v = QUERY_BUILDER_VERSION;
  const id = c.ai.identification;
  const comps: QueryComponent[] = [];
  const add = (kind: string, value: string, included: boolean, reason: string) => {
    if (value.trim()) comps.push({ kind, value: value.trim(), included, reason });
  };

  if (!c.derived.validation.passed) {
    return { eligible: false, reason: "INVALID_ANALYSIS", detail: "validation did not pass", builderVersion: v };
  }

  const itemType = normalizeText(id.item_type ?? "");
  if (GENERIC_ITEM_TYPES.has(itemType)) {
    return { eligible: false, reason: "ITEM_TYPE_UNKNOWN", detail: `item_type "${id.item_type}"`, builderVersion: v };
  }

  // Identity strength: at least one thing that narrows the search beyond
  // "a hoodie". Without it the search returns the entire category.
  const identity = [id.model_or_product_number, notStyleTag(id.product_line), id.canonical_brand,
                    notStyleTag(id.subject), id.team, id.artist, id.event, id.character_or_license]
                    .filter(x => (x ?? "").trim());
  /*
   * Unbranded items (Phase 3). Most thrift finds have no readable brand, and
   * they used to get no search at all. A known garment type plus a style word
   * ("plaid flannel shirt") or a confident colour is enough to search on; the
   * matcher keeps every such comp at Similar, so the screen says Limited.
   */
  let unbranded = false;
  let unbrandedWords: string[] = [];
  if (identity.length === 0) {
    const group = scanCategory(
      { itemType: id.item_type ?? "", subtype: id.subtype ?? "", genericName: id.generic_item_name ?? "" },
      brandMask(id.canonical_brand ?? ""),
    );
    // A pattern, material or construction word — never a colour or a generic
    // tag: "black t-shirt" and "streetwear hoodie" match every listing of the type.
    const style = styleWords(c);
    if (!group || (style.length === 0 && !typeIsStyled(c))) {
      return { eligible: false, reason: "IDENTITY_TOO_WEAK",
               detail: "no brand, model, subject, team, artist, event or licence, and no style or material word to search on",
               builderVersion: v };
    }
    unbranded = true;
    unbrandedWords = style;
  }

  const conflict = c.derived.validation.downgrades.some(d => d.rule_id === "SOURCE_CONFLICT");
  if (conflict && !id.canonical_brand.trim()) {
    return { eligible: false, reason: "UNRESOLVED_IDENTITY_CONFLICT",
             detail: "source conflict with no anchoring brand", builderVersion: v };
  }

  // ── Assemble, highest-signal first ─────────────────────────────────────────
  const parts: string[] = [];
  /** Names (brand, artist, licence, model) are sent as they are; feeling words
   *  are stripped only from free text. A leading "-" is never sent — eBay would
   *  read it as "exclude". */
  const push = (kind: string, value: string | null | undefined, why: string, freeText = false) => {
    const v = queryPart(value, freeText);
    if (!v) return;
    parts.push(v); add(kind, v, true, why);
  };

  push("model", id.model_or_product_number, "exact model is the strongest possible signal");
  push("product_line", notStyleTag(id.product_line), "product line narrows within a brand");
  if (id.product_line && !notStyleTag(id.product_line)) add("product_line", id.product_line, false, "a style tag, not a product line");
  push("brand", id.canonical_brand, "brand anchors the search");
  // Subject / team / artist / event: the thing a collector actually searches.
  push("subject", notStyleTag(id.subject), "recognisable subject drives niche demand", true);
  if (id.subject && !notStyleTag(id.subject)) add("subject", id.subject, false, "a style tag, not a subject");
  push("team", id.team, "team is a primary search term for sports items");
  push("artist", id.artist, "artist is a primary search term for music items");
  push("event", id.event, "event narrows to a specific print run");
  push("license", id.character_or_license, "licensed IP is a primary search term");
  for (const w of unbrandedWords) push("style", w, "unbranded: a style or material word stands in for a brand");
  // One type word per kind: "satchel handbag" would only find listings saying both.
  const typeQ = searchType(c);
  push("item_type", typeQ, typeQ.toLowerCase() === (id.item_type ?? "").trim().toLowerCase()
    ? "item type is required for a usable search"
    : `item type, with the repeated type word dropped from "${id.item_type}"`);

  // ── Closure ────────────────────────────────────────────────────────────────
  // "Polo by Ralph Lauren hoodie" returned pullovers, zip-ups and everything
  // else, because closure never reached the query. For a hoodie or a jacket it
  // is one of the most discriminating words available.
  const closure = detectClosure(
    [id.item_type, id.subtype, id.generic_item_name,
     (c.ai.features?.closure_type ?? "")].join(" "),
  );
  const CLOSURE_WORD: Record<string, string> = {
    full_zip: "full zip", quarter_zip: "quarter zip", half_zip: "half zip",
    pullover: "pullover", button: "button up", snap: "snap front",
  };
  // Only add the closure word when the item type has not already implied it.
  // "zip-up hoodie full zip" is keyword stuffing, and eBay's matching punishes it.
  const closureAlreadyStated = detectClosure(parts.join(" ")) === closure;
  if (closure && CLOSURE_WORD[closure] && !closureAlreadyStated) {
    push("closure", CLOSURE_WORD[closure], `closure ${closure} narrows the result pool sharply`);
  } else {
    add("closure", closure ?? "", false, closure ? "already implied by the item type" : "closure not determined");
  }

  // Era only when the validated conclusion supports it commercially.
  const era = c.derived.era_effective;
  if (era.status === "confirmed_vintage" || era.status === "likely_vintage") {
    push("era", "vintage", `era_status ${era.status}`);
  } else {
    add("era", era.status, false, "era not commercially relevant or not established");
  }

  // Technical material genuinely changes what a buyer is searching for.
  const tech = c.ai.visible_attributes.material_composition
    .find(m => /gore-?tex|primaloft|thinsulate|down|windstopper|merino|futurelight/i.test(m));
  if (tech) push("material", tech, "named technical system materially changes value");

  // Deliberately omitted, recorded so the decision is visible.
  add("size", c.ai.visible_attributes.size_label, false,
      "size narrows results faster than it improves them; revisit in Phase 1");
  // Colour, only when the model was confident. An uncertain colour narrows the
  // pool by the wrong axis and can exclude every good comp.
  const colour = (c.ai.visible_attributes.primary_color ?? "").trim();
  const colourConf = c.ai.visible_attributes.color_confidence ?? 0;
  const OBVIOUS = /^(black|white|red|blue|green|yellow|navy|grey|gray|orange|purple|pink|brown|tan|beige|cream)$/i;
  if (unbrandedWords.includes(colour) && colour) {
    add("color", colour, false, "already the unbranded search word");
  } else if (colour && colourConf >= COLOUR_CONFIDENT_AT && OBVIOUS.test(colour)) {
    push("color", colour, `obvious colour at ${colourConf}% confidence`);
  } else {
    add("color", colour, false,
        colour ? `colour confidence ${colourConf}% below the ${COLOUR_CONFIDENT_AT}% bar, or not an unambiguous colour`
               : "no colour determined");
  }
  add("department", (c.ai.visible_attributes as { target_department?: string }).target_department ?? "", false,
      "department is used for FILTERING results, not for narrowing the search");

  const query = parts.join(" ").replace(/\s+/g, " ").trim();
  if (query.split(" ").length < 2) {
    return { eligible: false, reason: "QUERY_TOO_GENERIC", detail: `"${query}"`, builderVersion: v };
  }

  // Ranked alternatives, recorded but NOT executed in Phase 0.
  const candidates = [
    query,
    [id.canonical_brand, id.item_type].filter(Boolean).join(" ").trim(),
    [id.subject || id.team || id.artist, id.item_type].filter(Boolean).join(" ").trim(),
  ].filter((q, i, a) => q && q.split(" ").length >= 2 && a.indexOf(q) === i);

  return {
    eligible: true,
    query,
    normalizedQuery: normalizeText(query),
    components: comps,
    historyDays: chooseHistoryDays(c),
    candidates: candidates.slice(0, 3),
    unbranded,
    builderVersion: v,
  };
}
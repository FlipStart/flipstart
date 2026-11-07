/**
 * lib/screenCrash.ts
 *
 * When the results screen or the Hunt item screen crashes, say exactly what
 * broke (Phase 7 of the scan-failure plan). Never "something went wrong".
 *
 * Works in this order, most specific first:
 *   1. No scan at all in memory.
 *   2. The scan's result is missing parts the screen needs — named in plain
 *      words ("the resale price range", "the item identification").
 *   3. A part is there but holds a value the screen can't use (text where a
 *      number belongs, a price that isn't a number).
 *   4. The error itself names the field it tripped on — translated.
 *   5. Known error kinds (an update loop, out of memory).
 *   6. Anything else: the error's own words, shown as they are.
 *
 * Also returns what CAN still be shown (item name, estimated value), read
 * defensively, so the user isn't left with nothing for a scan they paid for.
 *
 * Pure: no React Native imports, tested directly.
 */

export type CrashScreen = "results" | "hunt_item";

export type CrashKind =
  | "missing_scan"
  | "incomplete_result"
  | "bad_value"
  | "missing_field"
  | "update_loop"
  | "out_of_memory"
  | "unexpected";

export interface CrashExplanation {
  kind: CrashKind;
  title: string;
  /** What happened, in plain words. */
  body: string;
  /** The specific problems found, each one line. */
  problems: string[];
  /** The raw error, for the "technical detail" line. Never shown as the main message. */
  technical: string;
  /** What can still be shown from the scan, if anything. */
  salvage: { itemName: string | null; brand: string | null; value: number | null; low: number | null; high: number | null } | null;
  /** Field paths found missing or wrong, for analytics. */
  fields: string[];
}

const SCREEN_NAME: Record<CrashScreen, string> = {
  results: "the results screen",
  hunt_item: "this Hunt item",
};

/** Plain names for the parts of a scan result a screen reads. */
const FIELD_NAME: Record<string, string> = {
  identification: "the item identification",
  "identification.item_name": "the item's name",
  "identification.brand": "the brand",
  "identification.category": "the category",
  market_data: "the market data (prices, demand, sell speed)",
  "market_data.estimated_resale_range": "the resale price range",
  "market_data.estimated_resale_range.low": "the low end of the resale range",
  "market_data.estimated_resale_range.high": "the high end of the resale range",
  "market_data.adjusted_estimated_value": "the estimated value",
  "market_data.average_sold_price": "the average sold price",
  "market_data.suggested_buy_price": "the suggested buy price",
  "market_data.price_adjustments": "the price adjustments",
  risk_analysis: "the risk and confidence details",
  "risk_analysis.match_confidence": "the confidence score",
  "risk_analysis.risk_flags": "the risk flags",
  listings: "the generated listings",
  imageUri: "the photo",
};

/** Single-word keys an error message may name, mapped to their plain name. */
const KEY_NAME: Record<string, string> = {
  identification: FIELD_NAME.identification,
  market_data: FIELD_NAME.market_data,
  estimated_resale_range: FIELD_NAME["market_data.estimated_resale_range"],
  adjusted_estimated_value: FIELD_NAME["market_data.adjusted_estimated_value"],
  average_sold_price: FIELD_NAME["market_data.average_sold_price"],
  suggested_buy_price: FIELD_NAME["market_data.suggested_buy_price"],
  price_adjustments: FIELD_NAME["market_data.price_adjustments"],
  risk_analysis: FIELD_NAME.risk_analysis,
  match_confidence: FIELD_NAME["risk_analysis.match_confidence"],
  risk_flags: FIELD_NAME["risk_analysis.risk_flags"],
  listings: FIELD_NAME.listings,
  ebay: "the eBay listing",
  depop: "the Depop listing",
  item_name: FIELD_NAME["identification.item_name"],
  style_labels: "the style labels",
  low: "a price range",
  high: "a price range",
  v1: "the confidence details",
  scanSnapshot: "this Hunt item's saved scan",
};

type Check = { path: string; kind: "object" | "number" | "string" | "array" };

/** What the results and Hunt item screens read without guarding. */
const REQUIRED: Check[] = [
  { path: "identification", kind: "object" },
  { path: "identification.item_name", kind: "string" },
  { path: "market_data", kind: "object" },
  { path: "market_data.estimated_resale_range", kind: "object" },
  { path: "market_data.estimated_resale_range.low", kind: "number" },
  { path: "market_data.estimated_resale_range.high", kind: "number" },
  { path: "market_data.adjusted_estimated_value", kind: "number" },
  { path: "risk_analysis", kind: "object" },
  { path: "risk_analysis.match_confidence", kind: "number" },
];
/** Read if present; must be the right kind when it is. */
const OPTIONAL: Check[] = [
  { path: "identification.style_labels", kind: "array" },
  { path: "market_data.price_adjustments", kind: "array" },
  { path: "risk_analysis.risk_flags", kind: "array" },
  { path: "market_data.average_sold_price", kind: "number" },
  { path: "market_data.suggested_buy_price", kind: "number" },
];

function get(obj: unknown, path: string): unknown {
  let cur: any = obj;
  for (const k of path.split(".")) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = cur[k];
  }
  return cur;
}

function isKind(v: unknown, kind: Check["kind"]): boolean {
  if (kind === "object") return !!v && typeof v === "object" && !Array.isArray(v);
  if (kind === "array") return Array.isArray(v);
  if (kind === "number") return typeof v === "number" && Number.isFinite(v);
  return typeof v === "string";
}

const plain = (path: string) => FIELD_NAME[path] ?? path;

function salvage(scan: unknown): CrashExplanation["salvage"] {
  if (!scan || typeof scan !== "object") return null;
  const str = (p: string) => { const v = get(scan, p); return typeof v === "string" && v.trim() ? v.trim().slice(0, 120) : null; };
  const num = (p: string) => { const v = get(scan, p); return typeof v === "number" && Number.isFinite(v) ? v : null; };
  const out = {
    itemName: str("identification.item_name"),
    brand: str("identification.brand"),
    value: num("market_data.adjusted_estimated_value"),
    low: num("market_data.estimated_resale_range.low"),
    high: num("market_data.estimated_resale_range.high"),
  };
  return Object.values(out).some(v => v !== null) ? out : null;
}

/** The part that holds each field — the thing that is missing when the field can't be read. */
const PARENT_OF: Record<string, string> = {
  low: "estimated_resale_range", high: "estimated_resale_range",
  estimated_resale_range: "market_data", adjusted_estimated_value: "market_data",
  average_sold_price: "market_data", suggested_buy_price: "market_data", price_adjustments: "market_data",
  demand: "market_data", sell_speed: "market_data",
  match_confidence: "risk_analysis", risk_flags: "risk_analysis",
  item_name: "identification", brand: "identification", category: "identification", style_labels: "identification", v1: "identification",
  ebay: "listings", depop: "listings",
};

/**
 * Which part of the result was missing, from the error's own wording.
 *   Hermes / V8: "Cannot read property 'low' of undefined" — the thing being
 *                read FROM was missing, so the answer is the parent of 'low'.
 *   JSC:         "undefined is not an object (evaluating 'md.estimated_resale_range.low')"
 *                — the expression minus its last step is what was undefined.
 * Null when the message doesn't say.
 */
export function fieldFromError(message: string): string | null {
  const reading = message.match(/Cannot read propert(?:y|ies) of (?:undefined|null) \(reading '([^']+)'\)/)
    ?? message.match(/Cannot read property '([^']+)' of (?:undefined|null)/);
  if (reading) return PARENT_OF[reading[1]] ?? `?${reading[1]}`;
  const evaluating = message.match(/(?:undefined|null) is not an object \(evaluating '([^']+)'\)/);
  if (evaluating) {
    const parts = evaluating[1].split(/[.[\]'"]+/).filter(Boolean);
    const missing = parts[parts.length - 2];
    if (missing && KEY_NAME[missing]) return missing;
    const last = parts[parts.length - 1];
    return last ? PARENT_OF[last] ?? `?${last}` : null;
  }
  return null;
}

export function describeScreenCrash(screen: CrashScreen, error: unknown, scan: unknown): CrashExplanation {
  const err = error instanceof Error ? error : new Error(String(error ?? "Unknown error"));
  const technical = `${err.name || "Error"}: ${String(err.message || "").slice(0, 300)}`;
  const where = SCREEN_NAME[screen];
  // Only what is true: the scan ran on the server. It is NOT in History unless
  // the user saved it, so never say "it's saved".
  const keep = "The scan itself finished — this is only a problem showing it.";

  if (!scan || typeof scan !== "object") {
    return {
      kind: "missing_scan",
      title: screen === "results" ? "This scan's result isn't loaded" : "This Hunt item's scan isn't loaded",
      body: `There was no scan in memory for ${where} to show — usually because the app was closed or reloaded while it opened. Nothing about your photo or account caused this.`,
      problems: ["No scan result was found to display."],
      technical, salvage: null, fields: ["scan"],
    };
  }

  /**
   * Bad data shows up as a TypeError ("cannot read property of undefined",
   * "x is not a function", "toFixed of undefined"). Only then is the scan's
   * shape the likely cause; an update loop with a slightly odd result must
   * not be blamed on the result.
   */
  const msg = String(err.message ?? "");
  const dataShaped = err.name === "TypeError" || /undefined|null is not|not an object|not a function|NaN/i.test(msg);

  if (dataShaped) {
    const missing = REQUIRED.filter(c => get(scan, c.path) === undefined || get(scan, c.path) === null);
    // Name the top-most missing part only: if the market data is missing, its
    // prices obviously are too.
    const topMissing = missing.filter(c => !missing.some(o => o !== c && c.path.startsWith(o.path + ".")));
    if (topMissing.length) {
      return {
        kind: "incomplete_result",
        title: "This scan's result is incomplete",
        body: `The answer FlipStart's server sent back is missing parts ${where} needs, so it can't be shown in full. ${keep}`,
        problems: topMissing.map(c => `Missing ${plain(c.path)}.`),
        technical, salvage: salvage(scan), fields: topMissing.map(c => c.path),
      };
    }

    const wrong = [...REQUIRED, ...OPTIONAL].filter(c => {
      const v = get(scan, c.path);
      return v !== undefined && v !== null && !isKind(v, c.kind);
    });
    if (wrong.length) {
      const describe = (c: Check) => {
        const v = get(scan, c.path);
        const got = typeof v === "number" ? "a number that isn't valid" : Array.isArray(v) ? "a list" : typeof v === "string" ? "text" : `a ${typeof v}`;
        const want = c.kind === "number" ? "a number" : c.kind === "array" ? "a list" : c.kind === "object" ? "a group of details" : "text";
        return `${capital(plain(c.path))} should be ${want}, but it's ${got}.`;
      };
      return {
        kind: "bad_value",
        title: "Part of this scan's result is unreadable",
        body: `${capital(where)} found a value it can't use in the scan's result. ${keep}`,
        problems: wrong.map(describe),
        technical, salvage: salvage(scan), fields: wrong.map(c => c.path),
      };
    }

    const field = fieldFromError(msg);
    // "?toFixed": the error names something that isn't part of a scan result,
    // so it's a FlipStart bug reading a value, not missing data — say so below.
    if (field && !field.startsWith("?")) {
      const name = KEY_NAME[field] ?? FIELD_NAME[field] ?? `a part called "${field}"`;
      return {
        kind: "missing_field",
        title: "Part of this scan's result is missing",
        body: `${capital(where)} tried to show ${name}, but the scan's result doesn't have it. ${keep}`,
        problems: [`Missing ${name}.`],
        technical, salvage: salvage(scan), fields: [field],
      };
    }
  }

  if (/Maximum update depth exceeded|Too many re-renders/i.test(msg)) {
    return {
      kind: "update_loop",
      title: `${capital(where)} got stuck redrawing itself`,
      body: `A part of ${where} kept updating in a loop until the app stopped it. That's a bug in FlipStart, not your scan. ${keep}`,
      problems: ["The screen kept re-rendering without stopping."],
      technical, salvage: salvage(scan), fields: [],
    };
  }

  if (/Maximum call stack size exceeded/i.test(msg)) {
    return {
      kind: "update_loop",
      title: `${capital(where)} got stuck in an endless loop`,
      body: `Part of ${where} kept calling itself until the app stopped it. That's a bug in FlipStart, not your scan or your phone. ${keep}`,
      problems: ["The screen's code looped without end (a stack overflow)."],
      technical, salvage: salvage(scan), fields: [],
    };
  }

  if (/out of memory|allocation failed/i.test(msg)) {
    return {
      kind: "out_of_memory",
      title: "Your phone ran out of memory showing this",
      body: `${capital(where)} needed more memory than was free. Closing other apps usually fixes it. ${keep}`,
      problems: ["The phone ran out of memory while drawing the screen."],
      technical, salvage: salvage(scan), fields: [],
    };
  }

  return {
    kind: "unexpected",
    title: `${capital(where)} hit an error`,
    body: `It stopped on an error FlipStart doesn't recognise, shown below exactly as it happened. That's a bug in FlipStart, not your scan. ${keep}`,
    problems: [String(err.message || err.name || "Unknown error").slice(0, 200)],
    technical, salvage: salvage(scan), fields: [],
  };
}

function capital(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }
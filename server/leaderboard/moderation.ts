/**
 * server/leaderboard/moderation.ts
 *
 * Decides whether a name or a profile picture may be shown to OTHER people.
 *
 * Two layers for names, one for pictures:
 *   1. a word list, checked here (instant, and catches plain profanity that an
 *      AI harm classifier does not treat as harmful)
 *   2. OpenAI's moderation endpoint (omni-moderation-latest; free; text and
 *      images) for hate, harassment, sexual content, violence and self-harm
 *
 * ── Fail closed ─────────────────────────────────────────────────────────────
 * Every answer is one of  ok | blocked | unavailable.  "unavailable" (no API
 * key, timeout, a 5xx) is NOT a pass: the caller leaves the name or picture
 * unapproved and tries again later. Nothing is ever shown because a check
 * could not be run.
 *
 * ── What this cannot do ─────────────────────────────────────────────────────
 * The image model scores sexual content, violence and self-harm. It does not
 * recognise hate symbols, or offensive words written inside a picture. Those
 * are what the report button and the three-report auto-hide are for.
 */
import { ENV } from "../_core/env.js";

export type Verdict = "ok" | "blocked" | "unavailable";

export const MODERATION_MODEL = "omni-moderation-latest";
const MODERATION_URL = "https://api.openai.com/v1/moderations";
const TIMEOUT_MS = 8_000;
export const MAX_PUBLIC_NAME = 40;

// ─── Names: cleaning ──────────────────────────────────────────────────────────

/**
 * A name as it may be shown: visible characters only, single spaces, at most 40.
 * Removes control characters, zero-width characters and the Unicode direction
 * overrides that can make text read differently from how it is stored.
 */
export function cleanName(raw: unknown): string {
  return String(raw ?? "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202f\u2060-\u206f\ufeff\ufff9-\ufffb]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_PUBLIC_NAME);
}

// ─── Names: word list ─────────────────────────────────────────────────────────
// Two kinds of entry. WHOLE entries only match a whole word, because they sit
// inside ordinary words and names ("ass" in "Cassie", "dick" in "Dickies",
// "coon" in "raccoon", "heil" in "Sheila"). ANYWHERE entries are not part of
// ordinary words, so they also match inside a longer word ("xXfuckXx").
//
// Deliberately not a list of every rude word: mild words ("damn", "hell") are
// allowed, and anything this misses still has the AI check and the report button.

const WHOLE = [
  "ass", "asses", "arse", "anal", "anus", "cum", "cums", "cock", "cocks", "dick", "dicks", "tit", "tits", "titty",
  "hoe", "hoes", "sex", "sexy", "rape", "raped", "fag", "fags", "dyke", "dykes", "kike", "kikes",
  "spic", "spics", "chink", "chinks", "coon", "coons", "gook", "gooks", "homo", "kkk", "nazi", "nazis", "paki",
  "piss", "pissed", "prick", "pube", "pubes", "semen", "sperm", "twat", "wank", "wop", "jap", "japs",
  "tard", "milf", "dildo", "thot", "incel", "molest", "pedo", "pedos", "heil", "fuk", "niga", "kys",
];

const ANYWHERE = [
  "fuck", "fck", "phuck", "bitch", "biatch", "cunt", "nigger", "nigga", "nigg",
  "faggot", "fagot", "whore", "slut", "bastard", "asshole", "arsehole", "dumbass", "dickhead",
  "cocksuck", "blowjob", "handjob", "jizz", "pussy", "penis", "vagina", "boob", "porn", "hentai",
  "masturbat", "orgasm", "retard", "tranny", "wetback", "beaner", "towelhead", "raghead", "hitler",
  "pedophile", "paedophile", "rapist", "bollock", "wanker", "motherf", "bullshit", "horseshit",
  "killyourself",
];

/**
 * Words that need a rule of their own. "shit" is inside very common Japanese
 * names (Yamashita, Morishita, Yoshitaka), so it only matches when it is not
 * followed by "a", except in "shitass".
 */
const PATTERNS: RegExp[] = [/shit(?!a)/, /shitass/];

const LEET: Record<string, string> = {
  "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "i", "|": "i",
};
const unleet = (s: string) => s.toLowerCase().replace(/[013457@$!|]/g, c => LEET[c] ?? c);
const WHOLE_SET = new Set(WHOLE);

/** A word, plus the same word with stretched letters pulled back in ("fuuuck", "asss"). */
const variants = (w: string): string[] =>
  Array.from(new Set([w, w.replace(/(.)\1{2,}/g, "$1$1"), w.replace(/(.)\1{2,}/g, "$1")]));

/** True when the name contains a listed word. Pure and deterministic. */
export function nameHasBlockedWord(name: string): boolean {
  const plain = unleet(name).normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  // Words, with a run of single letters read as one word: "f u c k", "f.u.c.k".
  const words: string[] = [];
  let spelled = "";
  for (const t of plain.split(/[^a-z]+/).filter(Boolean)) {
    if (t.length === 1) { spelled += t; continue; }
    if (spelled) { words.push(spelled); spelled = ""; }
    words.push(t);
  }
  if (spelled) words.push(spelled);

  for (const word of words) {
    for (const w of variants(word)) {
      if (WHOLE_SET.has(w)) return true;
      if (ANYWHERE.some(bad => w.includes(bad))) return true;
      if (PATTERNS.some(re => re.test(w))) return true;
    }
  }
  return false;
}

// ─── OpenAI moderation ────────────────────────────────────────────────────────

type Fetcher = (url: string, init: any) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;
let fetchOverride: Fetcher | null = null;
/** Tests only. */
export function __setModerationFetchForTests(f: Fetcher | null): void { fetchOverride = f; }

/**
 * Stricter than the API's own `flagged`, because these are shown to everyone
 * using the app. A score at or above the number blocks.
 */
export const TEXT_LIMITS: Record<string, number> = {
  "hate": 0.3, "hate/threatening": 0.2, "harassment": 0.5, "harassment/threatening": 0.3,
  "sexual": 0.3, "sexual/minors": 0.05, "violence": 0.6, "violence/graphic": 0.4,
  "self-harm": 0.4, "self-harm/intent": 0.3, "self-harm/instructions": 0.3,
};
export const IMAGE_LIMITS: Record<string, number> = {
  "sexual": 0.2, "sexual/minors": 0.05, "violence": 0.5, "violence/graphic": 0.25,
  "self-harm": 0.3, "self-harm/intent": 0.3, "self-harm/instructions": 0.3,
};

/** Pure: the verdict for one API result. Exported for tests. */
export function verdictFromResult(result: any, limits: Record<string, number>): Verdict {
  if (!result || typeof result !== "object" || typeof result.flagged !== "boolean") return "unavailable";
  if (result.flagged) return "blocked";
  const scores = result.category_scores ?? {};
  for (const [category, limit] of Object.entries(limits)) {
    const s = Number(scores[category]);
    if (Number.isFinite(s) && s >= limit) return "blocked";
  }
  return "ok";
}

async function callModeration(input: unknown[], limits: Record<string, number>): Promise<Verdict> {
  const key = (ENV.openaiApiKey ?? "").trim();
  if (!key && !fetchOverride) return "unavailable";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await (fetchOverride ?? (fetch as unknown as Fetcher))(MODERATION_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: MODERATION_MODEL, input }),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn(`[moderation] API answered ${res.status}`);
      return "unavailable";
    }
    const body = await res.json();
    const results = Array.isArray(body?.results) ? body.results : [];
    if (results.length === 0) return "unavailable";
    // Any one result blocking blocks the whole input.
    let verdict: Verdict = "ok";
    for (const r of results) {
      const v = verdictFromResult(r, limits);
      if (v === "blocked") return "blocked";
      if (v === "unavailable") verdict = "unavailable";
    }
    return verdict;
  } catch (err) {
    console.warn("[moderation] request failed:", err instanceof Error ? err.message : err);
    return "unavailable";
  } finally {
    clearTimeout(timer);
  }
}

/** A name. The word list answers first; the API is only asked when it passes. */
export async function moderateName(raw: string): Promise<Verdict> {
  const name = cleanName(raw);
  if (!name) return "blocked";
  if (nameHasBlockedWord(name)) return "blocked";
  return callModeration([{ type: "text", text: name }], TEXT_LIMITS);
}

/** A picture, as base64 JPEG bytes (no data: prefix). */
export async function moderateImage(jpegBase64: string): Promise<Verdict> {
  if (!jpegBase64) return "unavailable";
  return callModeration(
    [{ type: "image_url", image_url: { url: `data:image/jpeg;base64,${jpegBase64}` } }],
    IMAGE_LIMITS,
  );
}
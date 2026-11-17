/**
 * utils/titleCase.ts
 *
 * Display-only capitalisation for item labels the model returns in whatever case
 * it likes: category ("carpenter pants"), item type, era, brand, material.
 * The stored data is never changed — only what the user reads.
 *
 *   carpenter pants     → Carpenter Pants
 *   t-shirt             → T-Shirt
 *   button-up shirt     → Button-Up Shirt
 *   pants/shorts        → Pants/Shorts
 *   men's jacket        → Men's Jacket
 *   y2k                 → Y2K
 *   90s vintage         → 90s Vintage
 *   cotton and polyester→ Cotton and Polyester
 *
 * Words the model already capitalised on purpose are left alone: LEGO, UGG,
 * iPhone, J.Crew, eBay (any uppercase after the first letter).
 */

const SMALL_WORDS = new Set(['and', 'or', 'of', 'the', 'for', 'with', 'in', 'on', 'a', 'an', 'to', 'by']);
const ALWAYS_UPPER = new Set(['y2k', 'nwt', 'nwot', 'usa', 'uk', 'us']);

function capWord(word: string, isFirst: boolean): string {
  if (!word) return word;
  const lower = word.toLowerCase();
  if (ALWAYS_UPPER.has(lower)) return lower.toUpperCase();
  // Already has deliberate capitals past the first letter (LEGO, iPhone, J.Crew).
  if (/[A-Z]/.test(word.slice(1))) return word;
  if (/^\d/.test(word)) return word;
  if (!isFirst && SMALL_WORDS.has(lower)) return lower;
  // Leading punctuation ("(vintage") is skipped; the first letter is raised.
  const m = word.match(/^([^A-Za-z0-9]*)([A-Za-z])(.*)$/s);
  if (!m) return word;
  return m[1] + m[2].toUpperCase() + m[3];
}

export function toTitleCase(input: unknown): string {
  const s = String(input ?? '').trim().replace(/\s+/g, ' ');
  if (!s) return '';
  let first = true;
  // Split on spaces, hyphens and slashes, keeping the separators.
  return s.split(/([\s\-/(]+)/).map(part => {
    if (/^[\s\-/(]+$/.test(part) || part === '') return part;
    const out = capWord(part, first);
    first = false;
    return out;
  }).join('');
}
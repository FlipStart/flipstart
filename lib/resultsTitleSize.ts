/**
 * lib/resultsTitleSize.ts
 *
 * The item title on the results screen's identity card.
 *
 * It used to be `adjustsFontSizeToFit` with a 0.72 floor: a long name was
 * squeezed to 72% of its size, so a 21pt title could land near 15pt, smaller
 * than the 10.5pt pills' neighbours looked, and different on every title.
 *
 * Now the size is picked from a few fixed steps by estimating how the name
 * wraps in the column, with a hard floor of 17pt. The estimate is only the
 * STARTING size: components/results/FitTitle.tsx re-measures the real layout
 * and steps down if iOS needs more than three lines.
 *
 * The title is NEVER shortened or given "...". A name too long for three lines
 * at 17pt takes a fourth. (A word-cut used to happen here; real Georgia Bold is
 * wider than the estimate, so iOS also cut names mid-word - "...Waterproof
 * Jack...". Both are gone.)
 */

/** Largest first. 23 and 21 are the card's existing two sizes. */
export const TITLE_STEPS = [23, 21, 19.5, 18, 17] as const;
export const TITLE_MAX_LINES = 3;
/** Average width of a Georgia Bold character, in ems. Slightly pessimistic on
 *  purpose: a title may be cut a word early, never clipped mid-glyph. */
const CHAR_EM = 0.62;

export const titleLineHeight = (size: number) => Math.round(size * 1.24);

/** Lines `text` takes at `size` in a column `width` wide (greedy word wrap). */
export function countTitleLines(text: string, size: number, width: number): number {
  const perLine = Math.max(1, Math.floor(width / (size * CHAR_EM)));
  let lines = 1;
  let used = 0;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const len = word.length;
    if (len > perLine) {                       // a word wider than the column breaks across lines
      if (used > 0) { lines += 1; used = 0; }
      lines += Math.ceil(len / perLine) - 1;
      used = len % perLine || perLine;
      continue;
    }
    if (used === 0) used = len;
    else if (used + 1 + len <= perLine) used += 1 + len;
    else { lines += 1; used = len; }
  }
  return lines;
}

export interface TitleFit {
  fontSize: number;
  lineHeight: number;
  /** The name to render: the full name, whitespace tidied. Never shortened. */
  text: string;
  /** Always false. Kept so callers written against the old shape still compile. */
  truncated: false;
}

/**
 * @param name        the item name
 * @param columnWidth width available to the title, in points
 * @param startSize   the largest size this card may use (23 for a short card, 21 otherwise)
 */
export function pickTitleSize(name: string, columnWidth: number, startSize: number): TitleFit {
  const text = (name ?? "").replace(/\s+/g, " ").trim() || "Unknown Item";
  const width = Math.max(60, columnWidth);
  // The trailing " ›" is measured too: it sits on the last line.
  const fits = (t: string, size: number) => countTitleLines(`${t} ›`, size, width) <= TITLE_MAX_LINES;

  const sizes = TITLE_STEPS.filter(s => s <= startSize);
  if (sizes.length === 0) sizes.push(TITLE_STEPS[TITLE_STEPS.length - 1]);
  for (const size of sizes) {
    if (fits(text, size)) return { fontSize: size, lineHeight: titleLineHeight(size), text, truncated: false };
  }
  const floor = sizes[sizes.length - 1];
  return { fontSize: floor, lineHeight: titleLineHeight(floor), text, truncated: false };
}

/** The next smaller size step, or null at the floor. */
export function nextTitleStepDown(size: number): number | null {
  const next = TITLE_STEPS.find(s => s < size);
  return next ?? null;
}

/** Width the title column gets on the results screen: the screen, minus the
 *  card's margins (28) and padding (30), the photo column (138) and the gap (14). */
export const titleColumnWidth = (screenWidth: number) => screenWidth - 28 - 30 - 138 - 14;
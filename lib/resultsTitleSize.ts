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
 * wraps in the column, with a hard floor of 17pt. A name that still does not fit
 * in three lines at the floor is cut at a word and given an ellipsis HERE, so
 * the tappable "›" after the title is never the thing that gets clipped.
 *
 * Pure and deterministic: no layout pass, no flicker, the same name always gets
 * the same size.
 */

/** Largest first. 23 and 21 are the card's existing two sizes. */
export const TITLE_STEPS = [23, 21, 19.5, 18, 17] as const;
export const TITLE_MAX_LINES = 3;
/** Average width of a Georgia Bold character, in ems. Slightly pessimistic on
 *  purpose: a title may be cut a word early, never clipped mid-glyph. */
const CHAR_EM = 0.58;

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
  /** The name to render. Equals the input unless it had to be cut. */
  text: string;
  truncated: boolean;
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

  // Nothing fits: stay at the floor and cut at a word.
  const floor = sizes[sizes.length - 1];
  const words = text.split(" ");
  while (words.length > 1) {
    words.pop();
    const t = `${words.join(" ")}…`;
    if (fits(t, floor)) return { fontSize: floor, lineHeight: titleLineHeight(floor), text: t, truncated: true };
  }
  // One enormous word: cut characters.
  let t = words[0] ?? text;
  while (t.length > 1 && !fits(`${t}…`, floor)) t = t.slice(0, -1);
  return { fontSize: floor, lineHeight: titleLineHeight(floor), text: `${t}…`, truncated: true };
}

/** Width the title column gets on the results screen: the screen, minus the
 *  card's margins (28) and padding (30), the photo column (138) and the gap (14). */
export const titleColumnWidth = (screenWidth: number) => screenWidth - 28 - 30 - 138 - 14;
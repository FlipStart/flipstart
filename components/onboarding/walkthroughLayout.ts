/**
 * components/onboarding/walkthroughLayout.ts
 *
 * Sizing for the walkthrough screenshots. Pure — no React Native — so it is
 * tested directly across phone sizes.
 *
 * The images are Dylan's own crops and are shown exactly as supplied: never
 * re-cropped, never stretched. Each is scaled UNIFORMLY to the largest size
 * that fits the space the screen has left between the supporting line and
 * the Continue button, so every image stays fully visible on every phone.
 */

/** width / height of each supplied crop. */
export const WALKTHROUGH_ASPECT = {
    analysis: 1112 / 1344,
    hunt: 1179 / 2294,
    brand: 1027 / 1080,
    achievement: 1179 / 1223,
  } as const;
  
  /** Badge under each progress image: 8pt gap + a 26pt pill. */
  export const BADGE_H = 26;
  export const CAPTION_H = 8 + BADGE_H;
  /** Between the two right-hand images, and between the two columns. */
  export const COLLAGE_GAP = 12;
  
  export interface Box { width: number; height: number }
  
  /** The largest box of `aspect` that fits inside `w` × `h`. */
  export function fitAspect(w: number, h: number, aspect: number): Box {
    if (!(w > 0) || !(h > 0) || !(aspect > 0)) return { width: 0, height: 0 };
    const width = Math.min(w, h * aspect);
    return { width, height: width / aspect };
  }
  
  export interface CollageLayout {
    /** Hunt, the tall left column. */
    left: Box;
    /** Brand above Achievement, the right column (same width). */
    rightWidth: number;
    brand: Box;
    achievement: Box;
    /** The whole collage, for centring. */
    width: number;
    height: number;
  }
  
  /**
   * Hunt on the left (it is tall and narrow), Brand above Achievement on the
   * right, both columns ending on the same line.
   *
   * Solved for the left width at which the two columns are equally tall when
   * the collage spans the full width:
   *
   *   wl / aH + C  =  wr / aB + wr / aA + 2C + G,   wr = W − G − wl
   *
   * If that is taller than the space, everything scales down together
   * (captions keep their size), so the columns still end together.
   */
  export function layoutProgressCollage(w: number, h: number): CollageLayout {
    const { hunt, brand, achievement } = WALKTHROUGH_ASPECT;
    const C = CAPTION_H, G = COLLAGE_GAP;
    const empty: CollageLayout = {
      left: { width: 0, height: 0 }, rightWidth: 0,
      brand: { width: 0, height: 0 }, achievement: { width: 0, height: 0 }, width: 0, height: 0,
    };
    if (!(w > G) || !(h > 2 * C + G)) return empty;
  
    const rightPerWidth = 1 / brand + 1 / achievement;      // right-column image height per pt of width
    let wl = (rightPerWidth * (w - G) + C + G) / (1 / hunt + rightPerWidth);
    let wr = w - G - wl;
  
    // Image heights at full width; captions and the gap do not scale.
    const leftImg = wl / hunt;
    const rightImg = wr * rightPerWidth;
    const k = Math.min(1, (h - C) / leftImg, (h - 2 * C - G) / rightImg);
    wl *= k;
    wr *= k;
  
    const left = { width: wl, height: wl / hunt };
    const b = { width: wr, height: wr / brand };
    const a = { width: wr, height: wr / achievement };
    return {
      left, rightWidth: wr, brand: b, achievement: a,
      width: wl + G + wr,
      height: Math.max(left.height + C, b.height + a.height + 2 * C + G),
    };
  }
  
  /** Badge geometry: side padding, icon, icon-to-text gap, tracking. */
  export const BADGE = { pad: 10, icon: 13, gap: 5, tracking: 1.4, maxFont: 12, minFont: 9.5 } as const;
  
  /**
   * Label size for a badge in a column of `columnWidth`: 12pt when it fits,
   * down to 9.5pt on a narrow column, so "ACHIEVEMENTS" never truncates on an
   * SE. Heavy caps run about 0.7em per character plus the tracking.
   */
  export function badgeFontSize(columnWidth: number, text: string): number {
    if (!(columnWidth > 0) || text.length === 0) return BADGE.maxFont;
    const room = columnWidth - 2 * BADGE.pad - BADGE.icon - BADGE.gap - text.length * BADGE.tracking;
    const size = room / (text.length * 0.7);
    return Math.round(Math.max(BADGE.minFont, Math.min(BADGE.maxFont, size)) * 2) / 2;
  }
  
  /** Estimated badge width at a font size — for tests and layout checks. */
  export function badgeWidth(text: string, fontSize: number): number {
    return 2 * BADGE.pad + BADGE.icon + BADGE.gap + text.length * (fontSize * 0.7 + BADGE.tracking);
  }
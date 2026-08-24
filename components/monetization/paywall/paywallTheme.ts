/**
 * components/monetization/paywall/paywallTheme.ts
 *
 * The paywall's palette. Every value below was READ OUT OF SHIPPED FlipStart
 * CODE, not invented and not taken from the brief's suggested hex values.
 *
 * ── Where these came from ───────────────────────────────────────────────────
 * app/(tabs)/index.tsx declares the monetization palette at the top of the
 * file, and the scan-balance sheet is the closest existing surface to a
 * paywall. Those constants are the source of truth here. constants/vintage.ts
 * exists but is a DIFFERENT, older palette (green #3D5A38, white page) used by
 * eleven other files — mixing the two mid-paywall is how a screen ends up with
 * two greens that are almost the same.
 *
 * ── The two golds ───────────────────────────────────────────────────────────
 * #C4A334 (home) and #BE9C2C (results/analysis) both exist because screens were
 * built at different times. The paywall is a NEW surface reached from the home
 * side of the app, so it uses #C4A334 throughout and does not attempt to
 * unify them.
 *
 * ── Gold is never used for small text ───────────────────────────────────────
 * #C4A334 on #F4EED8 is roughly a 2:1 contrast ratio — unreadable at label
 * sizes and a real accessibility failure, not a stylistic quibble.
 * components/home/ScanCircleLabel.tsx already learned this and switched its
 * label from gold to dark green with a comment saying so.
 *
 * So: gold draws RULES, SEALS, BORDERS and ICONS. Words are green or brown.
 * That is also, conveniently, how actual antique catalogues were printed — the
 * brass was in the ornament, the text was in ink.
 */

export const PW = {
    // ── Parchment surfaces ────────────────────────────────────────────────────
    /** Page. The workhorse warm parchment used across the app. */
    parchment: "#F4EED8",
    /** Panels and plan cards. Near-white, very slightly warm. */
    card: "#FFFEFA",
    /** Selected plan interior. Already means "the warmer one" in the scan sheet. */
    cardSelected: "#FBF4DC",
    /** Pale gold wash, for the seal interior. */
    goldTint: "#F5EBCB",
  
    // ── Ink ───────────────────────────────────────────────────────────────────
    /** Deepest warm espresso. Headline. */
    ink: "#2B2118",
    /** Primary dark green. Buttons, plan prices, eyebrow, brand type. */
    forest: "#214D2D",
    /** Deepest green, for the emblem fill. */
    forestDeep: "#122E1B",
    /** Body copy on parchment. The app's established secondary ink. */
    brown: "#6F5A3E",
    /** Non-essential text only — too light for anything that must be read. */
    muted: "#8A7658",
  
    // ── Metal ─────────────────────────────────────────────────────────────────
    gold: "#C4A334",
    /** Brighter core for a sheen highlight, matching PremiumGlimmer. */
    goldHot: "#F0DC96",
    /** Soft warm divider. */
    border: "#DDD2AC",
  
    /** Muted vintage red, from constants/vintage.ts. Errors only. */
    error: "#9E3A2A",
    errorTint: "#F7E9E4",
    errorBorder: "#E3B8B4",
  
    /** Light text on dark green fills. */
    cream: "#F4EED8",
  } as const;
  
  /**
   * Radii, following the conventions already in the codebase:
   * 50 for pills, 18–22 for sheets, 10–14 for cards and tiles.
   */
  export const PW_RADIUS = {
    pill: 50,
    card: 14,
    seal: 4,
    emblem: 999,
  } as const;
  
  /**
   * Warm shadow, matching constants/vintage.ts `shadowSm`.
   *
   * Deliberately gentle. A paper card sitting on paper casts almost nothing —
   * a strong drop shadow is the single fastest way to make this look like a
   * floating glass panel instead.
   */
  export const PW_SHADOW = {
    shadowColor: "#3D2A12",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.07,
    shadowRadius: 5,
    elevation: 2,
  } as const;
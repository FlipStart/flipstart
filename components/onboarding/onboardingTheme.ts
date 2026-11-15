/**
 * components/onboarding/onboardingTheme.ts
 *
 * The onboarding V2 palette and spacing — one place, so every screen in the
 * flow draws from the same few values.
 *
 * ── Two text colours, no brown ──────────────────────────────────────────────
 * Every readable sentence is INK. Emphasis is FOREST. Hierarchy comes from
 * size and weight, never from fading the text. The paywall's `brown` and
 * `muted` are deliberately not re-exported here: onboarding retired them.
 *
 * ── Gold draws, it does not write ───────────────────────────────────────────
 * GOLD (#C4A334) is 2.4:1 on white — fine for stars, rules, borders and the
 * header's brand line (which matches the live Home header exactly), too faint
 * for anything a user must read. GOLD_TEXT (#8C6F14, 4.7:1) is the readable
 * gold, kept to small tracked section labels.
 *
 * Values reuse the live app's own constants (Home BORDER, GREEN_TINT, the
 * paywall's card and forestDeep) so onboarding matches the screens it leads into.
 */
import { PW } from "@/components/monetization/paywall/paywallTheme";

export const OB = {
  /** All readable text. 17:1 on white. */
  ink: "#1F1B16",
  /** Brand, emphasis, primary action. */
  forest: PW.forest,
  /** The Welcome panel — the Home "Scan Item" card's green. */
  forestDeep: PW.forestDeep,
  /** Stars, rules, borders, the header brand line. Never body text. */
  gold: PW.gold,
  /** The readable gold, for small tracked labels only. 4.7:1. */
  goldText: "#8C6F14",
  /** Light text on forest. */
  cream: "#F4EED8",
  /** Screen background. */
  background: "#FFFFFF",
  /** Card fill — the app's card. */
  card: PW.card,
  /** Hairlines and card borders — the app's BORDER. */
  border: PW.border,
  /** Chosen-row fill — the app's GREEN_TINT. */
  greenTint: "#E7EFE4",
  /** Tags and badges — the app's GOLD_TINT. */
  goldTint: PW.goldTint,
  /** Unfilled progress segments. */
  track: "#ECE4C8",
  /** Disabled button: reads as off at a glance, never as tappable. */
  disabledBg: "#EEEBE3",
  disabledText: "#75716A",
} as const;

export const OB_SPACE = {
  /** Side margin for all content below the header. */
  gutter: 24,
  /** Primary button height. */
  cta: 54,
  /** Card / option corner radius. */
  radius: 16,
} as const;

/** Screen-change and selection timings. Nothing in onboarding loops. */
export const OB_MOTION = {
  stage: 220,
  progress: 300,
  select: 120,
} as const;
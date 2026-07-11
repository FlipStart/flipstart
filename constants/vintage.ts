/**
 * FlipStart Design Tokens — single source of truth.
 *
 * Palette from reference swatches (DO NOT deviate):
 *   Deep Green:    #3D5A38   — primary green swatch
 *   Warm Beige:    #C4A455   — warm golden tan swatch
 *   Antique Cream: #ECE7D3   — light off-white cream swatch
 *   Vintage Gold:  #BE9C2C   — warm amber-gold swatch
 *   Aged Brown:    #8A7050   — warm medium brown swatch
 *   Subtle Sepia:  #D6C8A3   — light warm tan swatch
 *
 * NO pure white, NO pure black, NO cool grays, NO modern colors.
 */

export const V = {

  // ── Brand greens — from Deep Green swatch ───────────────────────────────────
  green:       '#3D5A38',   // Deep Green swatch — primary
  greenSecond: '#4A6844',   // Deep Green lighter shade — pressed states
  greenLight:  '#D8E8D6',   // Deep Green pale tint — subtle bg
  greenMuted:  '#6E8A68',   // Deep Green desaturated — low-value profit

  // ── Page & surface — from Antique Cream / Subtle Sepia swatches ─────────────
  pageBg:  '#FFFFFF',   // Antique Cream swatch — page background
  cream:   '#FFFFFF',   // alias of pageBg
  cardBg:  '#FFFEFA',   // Antique Cream lighter — card surface (layering)
  tan:     '#F4F1E8',   // Subtle Sepia swatch — icon containers, inner tones
  tanDark: '#DDD2AC',   // alias of border

  // ── Accent — from Vintage Gold swatch ───────────────────────────────────────
  gold:      '#BE9C2C',   // Vintage Gold swatch — badges, rank, highlights
  goldLight: '#F4F1E8',   // Vintage Gold pale tint

  // ── Text hierarchy — from Aged Brown swatch ─────────────────────────────────
  textDark:   '#3D2A12',   // very dark warm brown — primary text
  textMuted:  '#8A7050',   // Aged Brown swatch — secondary text
  textSubtle: '#A8906E',   // Aged Brown lighter — inactive/subtle text
  white:      '#ECE7D3',   // Antique Cream — "white" text on dark green bg

  // ── Status colors ────────────────────────────────────────────────────────────
  profitLow: '#6E8A68',   // desaturated green — low-value items
  neutral:   '#8A7050',   // Aged Brown — not-a-flip tags
  warning:   '#BE9C2C',   // Vintage Gold — risky/caution (warm, not bright)
  error:     '#9E3A2A',          // muted vintage red — errors only

  // ── Borders & dividers — from Subtle Sepia / Warm Beige mix ─────────────────
  border:        '#DDD2AC',   // Subtle Sepia + Warm Beige midpoint
  separatorLine: '#DDD2AC',   // thin rule under header

  // ── Legacy aliases ───────────────────────────────────────────────────────────
  heading:   '#3D5A38',   // → green
  brown:     '#3D2A12',   // → textDark
  brownMid:  '#8A7050',   // → textMuted
  muted:     '#A8906E',  // → textSubtle
  greenMid:  '#4A6844',  // → greenSecond

  // ── Shadows (warm dark from Deep Green swatch) ───────────────────────────────
  shadow: {
    shadowColor: '#3D2A12',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.09,
    shadowRadius: 8,
    elevation: 3,
  } as const,

  shadowSm: {
    shadowColor: '#3D2A12',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  } as const,

  // ── Spacing ──────────────────────────────────────────────────────────────────
  screenPad:  16,
  cardRadius: 16,
  pillRadius: 20,

  // ── Legacy size tokens ───────────────────────────────────────────────────────
  fontTitle:   28,
  fontSection: 20,
  fontBody:    14,
  fontSmall:   12,
};
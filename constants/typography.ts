/**
 * FlipStart Typography System
 * ─────────────────────────────────────────────────────────────────────────────
 * CURRENT STATE
 * System serif  = Georgia (iOS) / serif (Android) — good vintage fallback.
 * System sans   = platform default — clean and readable.
 *
 * HOW TO ADD PLAYFAIR DISPLAY + INTER
 * ─────────────────────────────────────────────────────────────────────────────
 * Step 1 — Install font packages:
 *   npx expo install @expo-google-fonts/playfair-display
 *   npx expo install @expo-google-fonts/inter
 *
 * Step 2 — Load fonts in app/_layout.tsx:
 *   import {
 *     useFonts,
 *     PlayfairDisplay_700Bold,
 *     PlayfairDisplay_400Regular,
 *   } from '@expo-google-fonts/playfair-display';
 *   import { Inter_400Regular, Inter_600SemiBold } from '@expo-google-fonts/inter';
 *
 *   // Inside root layout component:
 *   const [fontsLoaded] = useFonts({
 *     PlayfairDisplay_700Bold,
 *     PlayfairDisplay_400Regular,
 *     Inter_400Regular,
 *     Inter_600SemiBold,
 *   });
 *   if (!fontsLoaded) return null; // or a splash screen
 *
 * Step 3 — Swap the font strings below:
 *   FONTS.serif    → 'PlayfairDisplay_700Bold'
 *   FONTS.serifReg → 'PlayfairDisplay_400Regular'
 *   FONTS.sans     → 'Inter_400Regular'
 *   FONTS.sansSemi → 'Inter_600SemiBold'
 *
 * All components import from here, so swapping in one place updates everything.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Platform } from 'react-native';

// ─── Font families ────────────────────────────────────────────────────────────

export const FONTS = {
  /**
   * Display / wordmark serif.
   * Used for: FlipStart title, hero text.
   * Swap to: 'PlayfairDisplay_700Bold'
   */
  serif: Platform.select({
    ios:     'Georgia',
    android: 'serif',
    default: 'serif',
  }) as string,

  /**
   * Regular serif.
   * Used for: pull-quotes, editorial body.
   * Swap to: 'PlayfairDisplay_400Regular'
   */
  serifReg: Platform.select({
    ios:     'Georgia',
    android: 'serif',
    default: 'serif',
  }) as string,

  /**
   * Sans-serif body.
   * Used for: body text, descriptions, muted labels.
   * Swap to: 'Inter_400Regular'
   * undefined = system font (fine until Inter is loaded)
   */
  sans: undefined as string | undefined,

  /**
   * Semi-bold sans.
   * Used for: subheadings, pill labels, button text.
   * Swap to: 'Inter_600SemiBold'
   */
  sansSemi: undefined as string | undefined,
} as const;

// ─── Size scale ───────────────────────────────────────────────────────────────

export const FONT_SIZES = {
  wordmark: 28,  // FlipStart title
  h1:       24,  // hero / welcome text
  h2:       20,  // section headers
  h3:       17,  // card titles
  body:     14,  // body text
  caption:  12,  // captions, badges
  micro:    10,  // tab bar labels
} as const;

// ─── Line heights ─────────────────────────────────────────────────────────────

export const LINE_HEIGHTS = {
  tight:  1.15,
  normal: 1.45,
  loose:  1.65,
} as const;
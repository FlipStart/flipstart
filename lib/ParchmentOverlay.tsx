/**
 * lib/ParchmentOverlay.tsx
 *
 * Extremely subtle static grain texture overlay for FlipStart's vintage
 * parchment design system.
 *
 * ─── Design intent ────────────────────────────────────────────────────────────
 * Makes flat cream/ivory card surfaces feel like aged physical paper.
 * Inspired by antique field journals, explorer notebooks, and museum placards.
 * Effect is nearly invisible — only noticeable subconsciously.
 *
 * ─── Technical approach ───────────────────────────────────────────────────────
 * Uses react-native-svg's Pattern primitive (v15, pre-installed in Expo SDK 54).
 * An 8×8pt tile of warm-sepia grain dots repeats across the surface.
 * NO animations, NO JavaScript noise generation, NO canvas drawing.
 * Purely static SVG — renders instantly with zero runtime cost.
 *
 * ─── Usage ────────────────────────────────────────────────────────────────────
 * Place as the FIRST child of any container (renders behind content):
 *
 *   import { ParchmentOverlay } from '@/lib/ParchmentOverlay';
 *
 *   // Page background
 *   <View style={s.root}>
 *     <ParchmentOverlay />          // default 4% — page backgrounds
 *     ...content...
 *   </View>
 *
 *   // Card surface (slightly lighter)
 *   <View style={s.card}>
 *     <ParchmentOverlay opacity={0.035} />
 *     ...content...
 *   </View>
 *
 * pointerEvents="none" ensures it never intercepts touches.
 * Works inside any View, Pressable, or ScrollView container.
 *
 * ─── Opacity guide ────────────────────────────────────────────────────────────
 *   0.03  — very light surfaces (near-white)
 *   0.04  — page backgrounds (PARCH #ECE7D3) — DEFAULT
 *   0.035 — card surfaces (IVORY/CARD — slightly warmer than page)
 *   0.05  — maximum — avoid going higher
 */

import React, { useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, Pattern, Rect, Circle } from 'react-native-svg';

// Module-level counter ensures unique SVG pattern IDs across all instances.
// SVG pattern refs must be unique within the rendered document.
let _uid = 0;

interface ParchmentOverlayProps {
  /**
   * Texture opacity. Keep between 0.10 and 0.22.
   * Default 0.18 (18%) — appropriate for page backgrounds.
   */
  opacity?: number;
}

export function ParchmentOverlay({ opacity = 1.0 }: ParchmentOverlayProps) {
  // Stable unique ID per component instance — never changes after mount
  const patternId = useRef(`fs_grain_${_uid++}`).current;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width="100%" height="100%">
        <Defs>
          {/*
           * 8×8pt repeating tile.
           *
           * 16 grain dots at irregular positions and radii — simulates the
           * microscopic cellulose fibers visible in fine paper under a loupe.
           * Fill colour #6B3A1F is a warm dark sepia drawn from FlipStart's
           * brown palette. At 3–5% overall opacity it reads as texture, not colour.
           *
           * Positions were chosen to avoid obvious grid/diagonal regularity
           * so the pattern feels organic rather than mechanical.
           */}
          <Pattern
            id={patternId}
            x="0" y="0"
            width="8" height="8"
            patternUnits="userSpaceOnUse"
          >
            <Circle cx="0.8"  cy="0.9"  r="0.30" fill="#6B3A1F" />
            <Circle cx="3.1"  cy="0.4"  r="0.22" fill="#6B3A1F" />
            <Circle cx="6.2"  cy="1.1"  r="0.26" fill="#6B3A1F" />
            <Circle cx="1.6"  cy="2.7"  r="0.18" fill="#6B3A1F" />
            <Circle cx="4.8"  cy="2.2"  r="0.24" fill="#6B3A1F" />
            <Circle cx="7.3"  cy="2.8"  r="0.20" fill="#6B3A1F" />
            <Circle cx="2.4"  cy="4.6"  r="0.28" fill="#6B3A1F" />
            <Circle cx="5.7"  cy="4.0"  r="0.18" fill="#6B3A1F" />
            <Circle cx="0.4"  cy="5.8"  r="0.22" fill="#6B3A1F" />
            <Circle cx="3.9"  cy="5.4"  r="0.20" fill="#6B3A1F" />
            <Circle cx="7.0"  cy="5.1"  r="0.26" fill="#6B3A1F" />
            <Circle cx="1.2"  cy="7.1"  r="0.20" fill="#6B3A1F" />
            <Circle cx="4.5"  cy="7.7"  r="0.24" fill="#6B3A1F" />
            <Circle cx="6.8"  cy="6.9"  r="0.18" fill="#6B3A1F" />
            <Circle cx="2.9"  cy="3.1"  r="0.16" fill="#6B3A1F" />
            <Circle cx="5.2"  cy="6.3"  r="0.18" fill="#6B3A1F" />
          </Pattern>
        </Defs>

        {/* Single rect covering the full surface with the grain pattern */}
        <Rect
          x="0" y="0"
          width="100%" height="100%"
          fill={`url(#${patternId})`}
          opacity={opacity}
        />
      </Svg>
    </View>
  );
}
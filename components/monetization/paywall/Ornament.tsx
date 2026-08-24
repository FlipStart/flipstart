/**
 * components/monetization/paywall/Ornament.tsx
 *
 * Two pieces of restrained decoration: a catalogue rule, and the aging at the
 * edges of the page.
 *
 * ── No new dependency ───────────────────────────────────────────────────────
 * react-native-svg 15.12.1 is already installed and is already how
 * PremiumGlimmer draws its gradient. expo-linear-gradient is NOT installed and
 * is not worth adding for decoration.
 *
 * ── Both are static ─────────────────────────────────────────────────────────
 * Nothing here animates, so neither needs a Reduce Motion branch. Decoration
 * that moves on a purchase screen is decoration competing with the decision.
 *
 * ── Gradient ids are per-instance ───────────────────────────────────────────
 * SVG ids are global within a document, and a collision fails SILENTLY — one
 * element simply renders blank. PremiumGlimmer already hit this and solved it
 * with useId(); the same pattern is used here rather than trusting that only
 * one ornament will ever be on screen.
 */
import React, { useId } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop, Path, Line } from "react-native-svg";
import { PW } from "./paywallTheme";

/**
 * A thin rule with a lozenge at the middle and tapered ends.
 *
 * The taper matters: a rule that runs at full opacity to a hard stop reads as a
 * divider in a settings list. Fading the ends is what makes it read as
 * engraving on a title page.
 */
export function OrnamentRule({
  width = 132,
  color = PW.gold,
}: {
  width?: number;
  color?: string;
}) {
  const uid = useId().replace(/:/g, "");
  const leftId = `ornL-${uid}`;
  const rightId = `ornR-${uid}`;

  const h = 12;
  const mid = width / 2;
  const gap = 11; // clearance either side of the lozenge
  const lozenge = 4.6;

  return (
    <Svg
      width={width}
      height={h}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Defs>
        {/* Opaque at the centre, transparent at both ends. */}
        <LinearGradient id={leftId} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={color} stopOpacity="0" />
          <Stop offset="1" stopColor={color} stopOpacity="0.85" />
        </LinearGradient>
        <LinearGradient id={rightId} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={color} stopOpacity="0.85" />
          <Stop offset="1" stopColor={color} stopOpacity="0" />
        </LinearGradient>
      </Defs>

      <Rect x="0" y={h / 2 - 0.5} width={mid - gap} height="1" fill={`url(#${leftId})`} />
      <Rect x={mid + gap} y={h / 2 - 0.5} width={mid - gap} height="1" fill={`url(#${rightId})`} />

      {/* Diamond, drawn as a path rather than a rotated square so it stays crisp. */}
      <Path
        d={`M ${mid} ${h / 2 - lozenge} L ${mid + lozenge} ${h / 2} L ${mid} ${h / 2 + lozenge} L ${mid - lozenge} ${h / 2} Z`}
        fill={color}
        opacity={0.9}
      />

      {/* Short ticks flanking the diamond — the detail that reads as "catalogue". */}
      <Line
        x1={mid - gap + 2.5}
        y1={h / 2}
        x2={mid - lozenge - 2}
        y2={h / 2}
        stroke={color}
        strokeWidth="1"
        opacity="0.55"
      />
      <Line
        x1={mid + lozenge + 2}
        y1={h / 2}
        x2={mid + gap - 2.5}
        y2={h / 2}
        stroke={color}
        strokeWidth="1"
        opacity="0.55"
      />
    </Svg>
  );
}

/**
 * Edge aging for the parchment page.
 *
 * A radial gradient that is fully transparent across the middle two-thirds and
 * reaches a warm brown at about 7.5% in the corners. That is the whole effect —
 * it is meant to be felt rather than seen, and the readable area of the screen
 * is genuinely untouched.
 *
 * Paired with the existing ParchmentOverlay grain (lib/ParchmentOverlay.tsx) at
 * a low opacity, this gives "aged paper" with no texture asset and no new
 * dependency.
 *
 * Kept under 8%: past that it stops looking like age and starts looking like
 * dirt, which the brief explicitly rules out.
 */
export function ParchmentAging() {
  const uid = useId().replace(/:/g, "");
  const id = `pwAging-${uid}`;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width="100%" height="100%">
        <Defs>
          <RadialGradient id={id} cx="50%" cy="42%" rx="72%" ry="62%">
            <Stop offset="0" stopColor={PW.brown} stopOpacity="0" />
            <Stop offset="0.62" stopColor={PW.brown} stopOpacity="0" />
            <Stop offset="1" stopColor={PW.brown} stopOpacity="0.075" />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}
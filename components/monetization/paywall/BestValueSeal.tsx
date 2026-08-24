/**
 * components/monetization/paywall/BestValueSeal.tsx
 *
 * The BEST VALUE mark on the Annual plan.
 *
 * ── Why a chamfered plaque and not a circle ─────────────────────────────────
 * A round wax seal was the first instinct, and FlipStart already has the
 * machinery for it — ScanCircleLabel curves text with <TextPath>. It does not
 * survive the size test. "BEST VALUE" around a circle small enough to sit in a
 * card corner puts the glyphs at roughly 5pt on an arc: decoration that happens
 * to contain letters, rather than a label anyone can read.
 *
 * A chamfered plaque with a double rule is the other genuinely period form —
 * the stamped emblem on a merchant's catalogue heading — and it reads at 8.5pt
 * because the text stays on a straight baseline.
 *
 * ── SVG for the frame, RN Text for the words ────────────────────────────────
 * The frame is geometry, so it is SVG. The label is type, so it is a <Text>
 * that inherits FONTS.serif like every other piece of type in the app. Drawing
 * it as <SvgText> would mean a second font-resolution path for eleven
 * characters.
 *
 * ── No image dependency, and no transform props ─────────────────────────────
 * No PNG, no icon font, no new package. The inner rule is drawn at an offset by
 * computing its path, not by passing translateX to <Path> — this codebase has
 * been bitten before by reaching for a library API it could not inspect, and
 * two extra arguments cost nothing.
 */
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { FONTS } from "@/constants/typography";
import { PW } from "./paywallTheme";

const W = 88;
const H = 22;
/** Corner cut. Small — a big chamfer turns a plaque into a hexagon. */
const C = 5;
/** Inset of the inner rule from the outer frame. */
const INSET = 3;

/** Outline of a rectangle with all four corners cut at 45°, at an origin. */
function plaquePath(x: number, y: number, w: number, h: number, c: number): string {
  return [
    `M ${x + c} ${y}`,
    `L ${x + w - c} ${y}`,
    `L ${x + w} ${y + c}`,
    `L ${x + w} ${y + h - c}`,
    `L ${x + w - c} ${y + h}`,
    `L ${x + c} ${y + h}`,
    `L ${x} ${y + h - c}`,
    `L ${x} ${y + c}`,
    "Z",
  ].join(" ");
}

export function BestValueSeal({ label = "BEST VALUE" }: { label?: string }) {
  return (
    <View
      style={s.wrap}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Svg width={W} height={H} style={StyleSheet.absoluteFill}>
        {/* Outer frame, filled with the pale gold wash. */}
        <Path d={plaquePath(0, 0, W, H, C)} fill={PW.goldTint} stroke={PW.gold} strokeWidth={1.1} />

        {/*
         * Inner rule.
         *
         * The double line is the entire reason this reads as "stamped" rather
         * than "chip with a border". Kept at 45% opacity so it is a hairline
         * impression and not a second frame competing with the first.
         */}
        <Path
          d={plaquePath(INSET, INSET, W - INSET * 2, H - INSET * 2, C - 2)}
          fill="none"
          stroke={PW.gold}
          strokeWidth={0.6}
          opacity={0.45}
        />
      </Svg>

      {/*
       * Brown ink on the gold wash, not gold on gold.
       *
       * #6F5A3E on #F5EBCB is about 5.6:1, which passes at this weight and size.
       * Gold on gold would be roughly 1.3:1 — legible only to someone who
       * already knew what it said.
       *
       * allowFontScaling is OFF, deliberately and narrowly. The frame is fixed
       * geometry, so scaled text would overflow it. Nothing is lost: the seal is
       * hidden from screen readers and its meaning is folded into the plan
       * card's own accessibilityLabel via BEST_VALUE_A11Y, which DOES scale.
       */}
      <Text style={s.label} allowFontScaling={false} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/**
 * The spoken form of the seal.
 *
 * The seal is hidden from screen readers because a decorative frame plus a
 * floating "BEST VALUE" announces itself out of context. The plan card folds
 * this string into its own accessibilityLabel so VoiceOver hears one coherent
 * sentence instead of a badge and a card as two separate elements.
 */
export const BEST_VALUE_A11Y = "Best value";

const s = StyleSheet.create({
  wrap: { width: W, height: H, alignItems: "center", justifyContent: "center" },
  label: {
    fontFamily: FONTS.serif,
    fontSize: 8.5,
    fontWeight: "800",
    letterSpacing: 1.15,
    color: PW.brown,
    // Optical centring: letter-spacing adds a trailing gap after the last
    // glyph, which pushes the visual centre left without this.
    marginLeft: 1.15,
  },
});
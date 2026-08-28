/**
 * components/monetization/paywall/heroes/GenerateListingsHero.tsx
 *
 * The Generate Listings hero: a thrift find becoming two listing slips.
 *
 * ── The story, not the feature ──────────────────────────────────────────────
 * The user pressed a button because they want to SELL something. So the visual
 * is a find on a merchant's desk turning into two paper listing slips — not a
 * dashboard, not a phone mockup, not an AI graphic. A reseller's desk in 1962
 * would have looked like this: a tagged item, and two slips written out ready
 * to go in the post.
 *
 * ── Everything is drawn ─────────────────────────────────────────────────────
 * No image assets, no logo files, no new packages. The slips are Views with
 * borders, the connector is react-native-svg (already installed, already used
 * by PremiumGlimmer). "eBay" and "Depop" are plain text, deliberately — using
 * real marketplace logos would be both a trademark problem and an asset
 * dependency, and the brief rules both out.
 *
 * ── Decorative, and honest about it ─────────────────────────────────────────
 * The whole illustration is hidden from screen readers. The headline and
 * subtitle already say "eBay and Depop titles and descriptions", so a VoiceOver
 * user who also had to hear "YOUR FIND, eBay, blank line, blank line, READY TO
 * EDIT, Depop…" would be worse off, not better. Decoration that repeats the
 * text is noise.
 *
 * ── No motion ───────────────────────────────────────────────────────────────
 * Nothing animates. The brief permits restrained motion and explicitly prefers
 * a good static hero, and on a screen asking for money, movement competes with
 * the decision. Nothing to gate behind Reduce Motion because there is nothing
 * moving.
 */
import React from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import Svg, { Circle, Line, Path } from "react-native-svg";
import { FONTS } from "@/constants/typography";
import type { PaywallHeroProps } from "../PaywallHero";
import { PW, PW_RADIUS, PW_SHADOW } from "../paywallTheme";

/**
 * Below this height the hero compresses rather than pushing the plan cards off
 * screen.
 *
 * 700pt is just above the iPhone SE's 667. The brief is explicit that the
 * purchase section must not be crushed, so the illustration is what gives way.
 */
const COMPACT_BELOW = 700;

export function GenerateListingsHero({ config }: PaywallHeroProps) {
  const { height } = useWindowDimensions();
  const compact = height < COMPACT_BELOW;

  const slipHeight = compact ? 78 : 92;
  const findSize = compact ? 46 : 54;
  const connectorH = compact ? 14 : 20;
  const ruleCount = compact ? 2 : 3;

  return (
    <View style={s.hero}>
      {/* ── Copy ──────────────────────────────────────────────────────────── */}
      <Text style={s.eyebrow} accessibilityRole="header">
        {config.eyebrow}
      </Text>

      <Text style={[s.headline, compact && s.headlineCompact]}>{config.headline}</Text>

      <Text style={[s.subtitle, compact && s.subtitleCompact]}>{config.subtitle}</Text>

      {/* ── Illustration ──────────────────────────────────────────────────── */}
      <View
        style={[s.illustration, compact && s.illustrationCompact]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Text style={s.caption}>YOUR FIND</Text>

        {/*
         * The find itself.
         *
         * A tag rather than a photo or a garment: it is the one symbol that
         * means "thrifted item with a price on it" without committing to a
         * category. FlipStart scans clothing, but it also scans lamps.
         */}
        <View style={[s.findCard, { width: findSize, height: findSize }]}>
          <MaterialIcons name="local-offer" size={compact ? 21 : 25} color={PW.forest} />
          {/* Gold corner tick — the same "antique detail" language as the seal. */}
          <View style={s.findCorner} />
        </View>

        <Connector height={connectorH} />

        <View style={s.slips}>
          <ListingSlip
            platform="eBay"
            height={slipHeight}
            ruleCount={ruleCount}
            tilt={-1.4}
            compact={compact}
          />
          <ListingSlip
            platform="Depop"
            height={slipHeight}
            ruleCount={ruleCount}
            tilt={1.4}
            compact={compact}
          />
        </View>
      </View>
    </View>
  );
}

/**
 * The gold thread from the find down to the slips.
 *
 * A dashed line with a small arrowhead and two flanking dots — the restrained
 * antique connector the brief asks for. Explicitly not a beam, a glow or a
 * gradient: it should read as ink on paper, drawn with a ruler.
 */
function Connector({ height }: { height: number }) {
  const w = 44;
  const mid = w / 2;

  return (
    <Svg width={w} height={height + 8}>
      {/* Dashed stem. */}
      <Line
        x1={mid}
        y1={0}
        x2={mid}
        y2={height - 2}
        stroke={PW.gold}
        strokeWidth={1.2}
        strokeDasharray="3,2.5"
        opacity={0.8}
      />
      {/* Arrowhead. */}
      <Path
        d={`M ${mid - 4} ${height - 3} L ${mid} ${height + 2} L ${mid + 4} ${height - 3}`}
        stroke={PW.gold}
        strokeWidth={1.3}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Two ticks, the same detail that flanks the lozenge in OrnamentRule. */}
      <Circle cx={mid - 11} cy={height / 2} r={1.3} fill={PW.gold} opacity={0.55} />
      <Circle cx={mid + 11} cy={height / 2} r={1.3} fill={PW.gold} opacity={0.55} />
    </Svg>
  );
}

/**
 * One paper listing slip.
 *
 * Warm cream, thin forest rule, a gold hairline along the top edge, and a soft
 * warm shadow. The slight rotation is what stops the pair reading as two UI
 * cards in a grid — real slips on a desk are never square to the world.
 */
function ListingSlip({
  platform,
  height,
  ruleCount,
  tilt,
  compact,
}: {
  platform: string;
  height: number;
  ruleCount: number;
  tilt: number;
  compact: boolean;
}) {
  return (
    <View style={[s.slip, { height, transform: [{ rotate: `${tilt}deg` }] }]}>
      {/* Gold rule across the head of the slip, like a printed letterhead. */}
      <View style={s.slipHead} />

      <Text style={[s.slipPlatform, compact && { fontSize: 11.5 }]} numberOfLines={1}>
        {platform}
      </Text>

      {/*
       * Placeholder copy lines.
       *
       * Rules of varying width rather than lorem ipsum: real words would either
       * be a fake listing (misleading) or gibberish (cheap). Ruled lines read
       * as "text goes here" in any language.
       */}
      <View style={s.rules}>
        {Array.from({ length: ruleCount }).map((_, i) => (
          <View
            key={i}
            style={[
              s.rule,
              // Tapering the last line is what makes it read as a paragraph
              // ending rather than a progress bar.
              i === ruleCount - 1 && { width: "58%" },
            ]}
          />
        ))}
      </View>

      {/* Tiny stamp. The brief's "READY TO EDIT", set like an ink mark. */}
      <View style={s.stamp}>
        <Text style={s.stampText} allowFontScaling={false} numberOfLines={1}>
          READY TO EDIT
        </Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  hero: { alignItems: "center", gap: 8, paddingHorizontal: 4 },

  /**
   * Green, not gold — the same contrast decision as the Phase 2 hero.
   * #C4A334 on parchment is roughly 2:1 and unreadable at this size.
   */
  eyebrow: {
    fontFamily: FONTS.serif,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 2.6,
    color: PW.forest,
  },

  headline: {
    fontFamily: FONTS.serif,
    fontSize: 27,
    fontWeight: "800",
    color: PW.ink,
    textAlign: "center",
    lineHeight: 33,
    paddingHorizontal: 4,
  },
  headlineCompact: { fontSize: 24, lineHeight: 29 },

  subtitle: {
    fontSize: 14,
    color: PW.brown,
    textAlign: "center",
    lineHeight: 20,
    paddingHorizontal: 8,
    maxWidth: 336,
  },
  subtitleCompact: { fontSize: 13, lineHeight: 18.5 },

  illustration: { alignItems: "center", marginTop: 10, gap: 4 },
  illustrationCompact: { marginTop: 4 },

  caption: {
    fontFamily: FONTS.serif,
    fontSize: 9.5,
    fontWeight: "800",
    letterSpacing: 1.8,
    color: PW.brown,
    marginBottom: 4,
  },

  findCard: {
    backgroundColor: PW.card,
    borderRadius: 10,
    borderWidth: 1.25,
    borderColor: PW.border,
    alignItems: "center",
    justifyContent: "center",
    ...PW_SHADOW,
  },
  findCorner: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 7,
    height: 7,
    borderTopWidth: 1.1,
    borderRightWidth: 1.1,
    borderColor: PW.gold,
  },

  slips: { flexDirection: "row", gap: 12, alignItems: "flex-start" },

  slip: {
    width: 128,
    backgroundColor: PW.card,
    borderRadius: PW_RADIUS.card - 4,
    borderWidth: 1.1,
    borderColor: PW.border,
    paddingHorizontal: 10,
    paddingTop: 9,
    paddingBottom: 8,
    justifyContent: "flex-start",
    ...PW_SHADOW,
  },
  slipHead: {
    position: "absolute",
    top: 4,
    left: 8,
    right: 8,
    height: 1,
    backgroundColor: PW.gold,
    opacity: 0.5,
  },
  slipPlatform: {
    fontFamily: FONTS.serif,
    fontSize: 13,
    fontWeight: "800",
    color: PW.forest,
    marginBottom: 6,
  },

  rules: { gap: 5, flex: 1 },
  rule: {
    height: 2,
    width: "100%",
    borderRadius: 1,
    backgroundColor: PW.border,
  },

  stamp: {
    alignSelf: "flex-start",
    marginTop: 6,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 2.5,
    borderWidth: 0.9,
    borderColor: PW.gold,
    backgroundColor: PW.goldTint,
  },
  /**
   * Brown ink on the gold wash, ~5.6:1. Gold on gold would be about 1.3:1.
   * allowFontScaling is off because the stamp is fixed geometry and the whole
   * illustration is hidden from screen readers, so nothing is lost.
   */
  stampText: {
    fontFamily: FONTS.serif,
    fontSize: 7,
    fontWeight: "800",
    letterSpacing: 0.7,
    color: PW.brown,
  },
});
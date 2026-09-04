/**
 * components/monetization/paywall/heroes/GenerateListingsHero.tsx
 *
 * The Generate Listings hero: one find branching into two listing drafts.
 *
 * ── The redesign ────────────────────────────────────────────────────────────
 * The previous version stacked the story vertically — a find, an arrow down,
 * two slips side by side — and spent ~185pt saying it. It also read as a
 * wireframe: ruled lines where a title should be, cards square to the world.
 *
 * This version turns the story sideways. The find sits at the left; a gold
 * thread, drawn with a ruler, forks once into two stacked drafts on the right.
 * "One thing becomes two" is now the literal shape of the illustration, and it
 * costs ~100pt instead of ~185pt, which is what lets the plan cards and the
 * CTA stay on the first screen.
 *
 * ── The drafts look like drafts ─────────────────────────────────────────────
 * Each slip carries the marketplace name, one plausible title line, and a
 * READY TO EDIT stamp. The title is fixed illustrative text for a generic item
 * (the same sample item the Deep Analysis hero uses), and the block is stamped
 * SAMPLE: this paywall opens over a REAL scan, and a draft that looked like
 * the user's item would be a claim about their find that FlipStart has not
 * made. No price, size or condition appears — those would be fabricated data
 * on a purchase screen.
 *
 * "eBay" and "Depop" are plain text, deliberately: real marketplace logos are
 * a trademark problem and an asset dependency.
 *
 * ── Motion ──────────────────────────────────────────────────────────────────
 * One entrance, via the shared useHeroReveal: the find settles, the thread
 * appears, then the two drafts slide in from the fork in sequence — the eye
 * reads the illustration in the order the story happens. ~0.9s, then still.
 * No ambient loop here; the masthead glint is the only slow repeat on this
 * hero. Reduce Motion renders the finished illustration.
 */
import React from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import Svg, { Circle, Path } from "react-native-svg";
import { FONTS } from "@/constants/typography";
import type { PaywallHeroProps } from "../PaywallHero";
import { PaywallMasthead } from "../PaywallMasthead";
import { Reveal, useHeroReveal } from "../HeroReveal";
import { PW, PW_RADIUS, PW_SHADOW } from "../paywallTheme";

/**
 * Below this height the illustration compresses rather than pushing the plan
 * cards off screen. 740 matches the Deep Analysis hero, so the two siblings
 * switch modes on the same devices.
 */
const COMPACT_BELOW = 740;

/** Illustrative. The same generic item the Deep Analysis sample uses. */
const SAMPLE_TITLES = {
  eBay:  "Vintage Leather Jacket Brown",
  Depop: "Vintage brown leather jacket",
} as const;

export function GenerateListingsHero({ config }: PaywallHeroProps) {
  const { height } = useWindowDimensions();
  const compact = height < COMPACT_BELOW;
  const { progress } = useHeroReveal();

  const slipH = compact ? 42 : 46;
  const slipGap = 8;
  const forkH = slipH * 2 + slipGap;

  return (
    <View style={s.hero}>
      <PaywallMasthead feature="GENERATE LISTINGS" accessibilityLabel="FlipStart, Generate Listings" />

      <Text style={[s.headline, compact && s.headlineCompact]}>{config.headline}</Text>
      <Text style={[s.subtitle, compact && s.subtitleCompact]}>{config.subtitle}</Text>

      {/*
       * The illustration is hidden from screen readers. The headline and
       * subtitle already say "eBay and Depop titles and descriptions", so a
       * VoiceOver user hearing "YOUR FIND, eBay, Vintage Leather Jacket…"
       * would get repetition, not information.
       */}
      <View
        style={[s.teaser, compact && s.teaserCompact]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Text style={s.sampleTag} allowFontScaling={false}>SAMPLE</Text>

        {/* The find. */}
        <Reveal progress={progress} at={0} span={0.4} dy={6} style={s.findCol}>
          <View style={s.findCard}>
            <MaterialIcons name="local-offer" size={26} color={PW.forest} />
            <View style={s.findCorner} />
          </View>
          <Text style={s.caption} allowFontScaling={false}>YOUR FIND</Text>
        </Reveal>

        {/* The thread, forking once. */}
        <Reveal progress={progress} at={0.2} span={0.35} dy={0}>
          <Fork height={forkH} slipH={slipH} gap={slipGap} />
        </Reveal>

        {/* Two drafts, arriving in order. */}
        <View style={[s.slips, { gap: slipGap }]}>
          <Reveal progress={progress} at={0.38} span={0.45} dx={-10} dy={0}>
            <ListingSlip platform="eBay" title={SAMPLE_TITLES.eBay} height={slipH} compact={compact} />
          </Reveal>
          <Reveal progress={progress} at={0.52} span={0.45} dx={-10} dy={0}>
            <ListingSlip platform="Depop" title={SAMPLE_TITLES.Depop} height={slipH} compact={compact} />
          </Reveal>
        </View>
      </View>
    </View>
  );
}

/**
 * The gold thread from the find to the two drafts.
 *
 * Dashed, with a dot where it leaves the find and an arrowhead where it
 * reaches each draft. Drawn as two cubic curves from one origin so the fork is
 * a single decision, not two separate arrows. Ink on paper, with a ruler — not
 * a beam, a glow or a gradient.
 */
function Fork({ height, slipH, gap }: { height: number; slipH: number; gap: number }) {
  const w = 34;
  const mid = height / 2;
  const topY = slipH / 2;
  const botY = slipH + gap + slipH / 2;
  const end = w - 4;

  return (
    <Svg width={w} height={height}>
      <Circle cx={2} cy={mid} r={1.8} fill={PW.gold} />
      <Path
        d={`M 2 ${mid} C 16 ${mid}, 14 ${topY}, ${end} ${topY}`}
        stroke={PW.gold} strokeWidth={1.2} strokeDasharray="3,2.5" fill="none" opacity={0.85}
      />
      <Path
        d={`M 2 ${mid} C 16 ${mid}, 14 ${botY}, ${end} ${botY}`}
        stroke={PW.gold} strokeWidth={1.2} strokeDasharray="3,2.5" fill="none" opacity={0.85}
      />
      <Path d={`M ${end - 4} ${topY - 4} L ${end} ${topY} L ${end - 4} ${topY + 4}`}
        stroke={PW.gold} strokeWidth={1.3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <Path d={`M ${end - 4} ${botY - 4} L ${end} ${botY} L ${end - 4} ${botY + 4}`}
        stroke={PW.gold} strokeWidth={1.3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/**
 * One listing draft.
 *
 * Marketplace name in forest serif, a READY TO EDIT stamp on the same line,
 * one title in ink, and — when there is room — a single ruled line standing
 * in for the description. A gold hairline across the head is the same
 * letterhead detail the plan cards and the note card use.
 */
function ListingSlip({ platform, title, height, compact }: {
  platform: string; title: string; height: number; compact: boolean;
}) {
  return (
    <View style={[s.slip, { height }]}>
      <View style={s.slipHead} />
      <View style={s.slipRow}>
        <Text style={s.slipPlatform} numberOfLines={1}>{platform}</Text>
        <View style={s.stamp}>
          <Text style={s.stampText} allowFontScaling={false} numberOfLines={1}>READY TO EDIT</Text>
        </View>
      </View>
      <Text style={s.slipTitle} numberOfLines={1}>{title}</Text>
      {!compact && <View style={s.rule} />}
    </View>
  );
}

const s = StyleSheet.create({
  hero: { alignItems: "center", gap: 4, paddingHorizontal: 4 },

  headline: {
    fontFamily: FONTS.serif, fontSize: 28, fontWeight: "800",
    color: PW.ink, textAlign: "center", lineHeight: 32, marginTop: 2,
  },
  headlineCompact: { fontSize: 25, lineHeight: 29 },
  subtitle: {
    fontSize: 14.5, color: PW.brown, textAlign: "center", lineHeight: 19,
    paddingHorizontal: 12, maxWidth: 360, fontWeight: "500",
  },
  subtitleCompact: { fontSize: 13.5, lineHeight: 18 },

  teaser: {
    width: "100%", maxWidth: 380, marginTop: 4,
    flexDirection: "row", alignItems: "center", gap: 6,
  },
  teaserCompact: { marginTop: 6 },

  sampleTag: {
    position: "absolute", top: -12, right: 2,
    fontFamily: FONTS.serif, fontSize: 8, fontWeight: "800",
    letterSpacing: 1.6, color: PW.brown, opacity: 0.8,
  },

  findCol: { alignItems: "center", gap: 4, width: 62 },
  findCard: {
    width: 58, height: 58,
    backgroundColor: PW.card, borderRadius: 10,
    borderWidth: 1.25, borderColor: "rgba(33,77,45,0.30)",
    alignItems: "center", justifyContent: "center",
    ...PW_SHADOW,
  },
  findCorner: {
    position: "absolute", top: 4, right: 4, width: 7, height: 7,
    borderTopWidth: 1.1, borderRightWidth: 1.1, borderColor: PW.gold,
  },
  caption: {
    fontFamily: FONTS.serif, fontSize: 8.5, fontWeight: "800",
    letterSpacing: 1.5, color: PW.brown,
  },

  slips: { flex: 1 },
  slip: {
    backgroundColor: PW.card,
    borderRadius: PW_RADIUS.card - 5,
    borderWidth: 1.1, borderColor: PW.border,
    paddingHorizontal: 10, paddingTop: 5, paddingBottom: 4,
    overflow: "hidden",
    ...PW_SHADOW,
  },
  slipHead: {
    position: "absolute", top: 2.5, left: 8, right: 8, height: 1,
    backgroundColor: PW.gold, opacity: 0.5,
  },
  slipRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6 },
  slipPlatform: { fontFamily: FONTS.serif, fontSize: 12.5, fontWeight: "800", color: PW.forest },
  slipTitle: { marginTop: 2, fontSize: 11.5, lineHeight: 14, color: PW.ink, fontWeight: "600" },
  rule: { marginTop: 3, height: 1.5, width: "62%", borderRadius: 1, backgroundColor: PW.border },

  stamp: {
    paddingHorizontal: 5, paddingVertical: 1.5, borderRadius: 2.5,
    borderWidth: 0.9, borderColor: PW.gold, backgroundColor: PW.goldTint,
  },
  /** Brown ink on the gold wash, ~5.6:1. Gold on gold would be ~1.3:1. */
  stampText: {
    fontFamily: FONTS.serif, fontSize: 6.5, fontWeight: "800",
    letterSpacing: 0.7, color: PW.brown,
  },
});
/**
 * components/monetization/paywall/heroes/ScanLimitHero.tsx
 *
 * The scan-limit hero, redesigned to be short.
 *
 * ── What was removed and why ────────────────────────────────────────────────
 * The previous version drew a full "LIFETIME SCAN PASS" with fifteen punched
 * marks and an ALLOTMENT USED stamp. It was handsome and it cost ~150pt — which,
 * on this one paywall, pushed the Scan Store button below the fold. For a user
 * who has run out of scans, that button is the one that may actually solve
 * their problem. Nothing decorative is worth hiding it.
 *
 * The count survives as a single compact pill. Same information, a fifth of
 * the height.
 *
 * ── Brand first ─────────────────────────────────────────────────────────────
 * This is the only paywall whose eyebrow is FLIPSTART rather than FLIPSTART
 * PRO, because it offers two answers (subscribe, or buy packs) and heading the
 * whole screen "Pro" would frame the Scan Store as an afterthought. So the
 * wordmark gets the full treatment: gold sparks either side, a gold rule with a
 * diamond beneath. Editorial, not ornamental.
 *
 * ── Tone ────────────────────────────────────────────────────────────────────
 * "Keep Scanning With Pro" is an invitation. The previous headline stated the
 * fact of exhaustion; the fact now lives in the pill, and the headline points
 * forward. Nothing here is red, and nothing says limit, exceeded, or denied.
 */
import React from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Svg, { Path, Line } from "react-native-svg";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { FONTS } from "@/constants/typography";
import { FREE_LIFETIME_SCANS } from "@/lib/paywallConfig";
import type { PaywallHeroProps } from "../PaywallHero";
import { PW } from "../paywallTheme";

const COMPACT_BELOW = 720;

export function ScanLimitHero({ config }: PaywallHeroProps) {
  const { height } = useWindowDimensions();
  const compact = height < COMPACT_BELOW;

  return (
    <View style={s.hero}>
      {/* ── Brand ─────────────────────────────────────────────────────── */}
      <View style={s.brandRow} accessibilityRole="header" accessibilityLabel="FlipStart">
        <Spark />
        <Text style={s.brand} allowFontScaling={false}>{config.eyebrow}</Text>
        <Spark />
      </View>
      <DiamondRule />

      {/* ── Headline + support ────────────────────────────────────────── */}
      <Text style={[s.headline, compact && s.headlineCompact]}>Keep Scanning With Pro</Text>
      <Text style={[s.subtitle, compact && s.subtitleCompact]}>
        You've used all {FREE_LIFETIME_SCANS} lifetime scans. Upgrade to get more scans and
        unlock powerful Pro tools.
      </Text>

      {/* ── The count, as a pill ──────────────────────────────────────── */}
      <View
        style={s.pill}
        accessibilityLabel={`All ${FREE_LIFETIME_SCANS} free scans have been used.`}
      >
        <MaterialIcons name="verified" size={15} color={PW.forest} />
        <Text style={s.pillText} allowFontScaling={false}>
          {FREE_LIFETIME_SCANS} FREE SCANS USED
        </Text>
      </View>
    </View>
  );
}

/** A four-point gold spark, the mark that brackets the wordmark. */
function Spark() {
  return (
    <Svg width={14} height={14}>
      <Path d="M7 0 L8.3 5.7 L14 7 L8.3 8.3 L7 14 L5.7 8.3 L0 7 L5.7 5.7 Z" fill={PW.gold} />
    </Svg>
  );
}

/** Thin gold rule with a small diamond at the centre. */
function DiamondRule() {
  return (
    <Svg width={220} height={12} style={s.rule}>
      <Line x1={0} y1={6} x2={100} y2={6} stroke={PW.gold} strokeWidth={1} opacity={0.75} />
      <Path d="M110 1.5 L114.5 6 L110 10.5 L105.5 6 Z" fill={PW.gold} />
      <Line x1={120} y1={6} x2={220} y2={6} stroke={PW.gold} strokeWidth={1} opacity={0.75} />
    </Svg>
  );
}

const s = StyleSheet.create({
  hero: { alignItems: "center", gap: 6, paddingHorizontal: 4 },

  brandRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  /** Forest, heavy, wide-tracked. The wordmark has to read as a brand, not a label. */
  brand: {
    fontFamily: FONTS.serif, fontSize: 19, fontWeight: "800",
    letterSpacing: 5, color: PW.forest,
  },
  rule: { marginTop: -2, marginBottom: 2 },

  headline: {
    fontFamily: FONTS.serif, fontSize: 30, fontWeight: "800",
    color: PW.ink, textAlign: "center", lineHeight: 35, marginTop: 2,
  },
  headlineCompact: { fontSize: 26, lineHeight: 30 },

  /** Warm brown, never grey. Wider than before so it wraps to two lines, not three. */
  subtitle: {
    fontSize: 15, color: PW.brown, textAlign: "center", lineHeight: 21,
    paddingHorizontal: 10, maxWidth: 360, fontWeight: "500",
  },
  subtitleCompact: { fontSize: 14, lineHeight: 19 },

  pill: {
    flexDirection: "row", alignItems: "center", gap: 7,
    marginTop: 6,
    paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: 50, borderWidth: 1,
    borderColor: "rgba(33,77,45,0.30)", backgroundColor: PW.goldTint,
  },
  pillText: {
    fontFamily: FONTS.serif, fontSize: 11.5, fontWeight: "800",
    letterSpacing: 1.8, color: PW.forest,
  },
});
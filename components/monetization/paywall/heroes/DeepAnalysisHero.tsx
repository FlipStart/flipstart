/**
 * components/monetization/paywall/heroes/DeepAnalysisHero.tsx
 *
 * The Deep Analysis hero: a merchant's appraisal dossier, half read.
 *
 * ── The story, not the feature ──────────────────────────────────────────────
 * Generate Listings tells "find → listing". This one tells "quick answer →
 * deeper evidence → better decision". The user already saw the surface result;
 * what they want is the reasoning underneath it. So the visual is a research
 * sheet whose first entries are legible and whose lower entries fade into the
 * parchment behind a small wax seal.
 *
 * Not a dashboard, not a chart, not a terminal. An appraiser's card from a
 * catalogue house, where the valuable part was always the notes further down.
 *
 * ── The rows are the REAL feature ───────────────────────────────────────────
 * Every label here is a section that actually exists in
 * app/analysis-details.tsx: Price Logic, Risk Flags, Where to Sell, Confidence
 * Breakdown. Inventing plausible-sounding metrics would promise a feature that
 * does not ship.
 *
 * The VALUES are illustrative and deliberately generic — "Moderate", "3 noted".
 * They describe no real item, and they must not: the paywall can appear over
 * any scan, and rendering convincing numbers for the user's actual find would
 * be a fabricated analysis. The header says SAMPLE for the same reason.
 *
 * ── The fade is a fade, not a blur ──────────────────────────────────────────
 * Lower rows lose opacity into the parchment rather than being blurred out.
 * Blur reads as broken rendering; a fade reads as a page continuing past the
 * edge of what you were given. No BlurView, no new dependency.
 *
 * ── No motion ───────────────────────────────────────────────────────────────
 * The brief allows a restrained gold sweep and prefers a strong static hero.
 * On a screen asking for money, movement competes with the decision. Nothing
 * animates, so there is nothing to branch on for Reduce Motion.
 */
import React from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import Svg, { Circle, Line, Path } from "react-native-svg";
import { FONTS } from "@/constants/typography";
import type { PaywallHeroProps } from "../PaywallHero";
import { PW, PW_RADIUS, PW_SHADOW } from "../paywallTheme";

/** Below this height the dossier compresses rather than pushing plans away. */
const COMPACT_BELOW = 700;

/**
 * Four rows, progressively revealed.
 *
 * `reveal` is opacity: the first two read normally, the third is receding, the
 * fourth is nearly gone behind the seal. That gradient IS the message — there
 * is more here, and you are seeing the top of it.
 */
const ROWS: { label: string; value: string; reveal: number }[] = [
  { label: "PRICE LOGIC", value: "Full breakdown", reveal: 1 },
  { label: "RISK FLAGS", value: "3 noted", reveal: 1 },
  { label: "WHERE TO SELL", value: "Platform strategy", reveal: 0.42 },
  { label: "CONFIDENCE BREAKDOWN", value: "By area", reveal: 0.16 },
];

export function DeepAnalysisHero({ config }: PaywallHeroProps) {
  const { height } = useWindowDimensions();
  const compact = height < COMPACT_BELOW;

  // The last row is the first thing to go on a small screen: it is already the
  // faintest, so dropping it costs the least meaning.
  const rows = compact ? ROWS.slice(0, 3) : ROWS;

  return (
    <View style={s.hero}>
      {/* ── Copy ──────────────────────────────────────────────────────────── */}
      <Text style={s.eyebrow} accessibilityRole="header">
        {config.eyebrow}
      </Text>

      <Text style={[s.headline, compact && s.headlineCompact]}>{config.headline}</Text>

      <Text style={[s.subtitle, compact && s.subtitleCompact]}>{config.subtitle}</Text>

      {/* ── Dossier ───────────────────────────────────────────────────────── */}
      <View
        style={[s.dossier, compact && s.dossierCompact]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {/* Letterhead: title left, SAMPLE right so nothing reads as real data. */}
        <View style={s.head}>
          <View style={s.headLeft}>
            <MaterialIcons name="psychology" size={13} color={PW.gold} />
            <Text style={s.headTitle}>DEEP ANALYSIS</Text>
          </View>
          <Text style={s.headMark}>SAMPLE</Text>
        </View>

        <RuleLine />

        {rows.map((r, i) => (
          <View key={r.label} style={{ opacity: r.reveal }}>
            <View style={[s.row, compact && s.rowCompact]}>
              <Text style={s.rowLabel} numberOfLines={1}>
                {r.label}
              </Text>
              <Text style={s.rowValue} numberOfLines={1}>
                {r.value}
              </Text>
            </View>
            {i < rows.length - 1 && <RuleLine />}
          </View>
        ))}

        {/*
         * The seal sits over the fading rows, not over the readable ones.
         *
         * Small and off to one side: a wax mark pressed onto a page, not a
         * padlock stamped across it. The brief is explicit that a giant modern
         * lock is the wrong language, and a big lock would also say "denied"
         * where this should say "continues".
         */}
        <View style={s.sealRow}>
          <WaxSeal />
          <Text style={s.sealText}>Full dossier with Pro</Text>
        </View>
      </View>
    </View>
  );
}

/** A hairline gold rule, faded at both ends like a printed ledger line. */
function RuleLine() {
  return <View style={s.rule} />;
}

/**
 * A small wax seal.
 *
 * Drawn rather than an icon: MaterialIcons has no wax seal, and a padlock would
 * be the modern-SaaS reading the brief rules out. A notched disc with a keyhole
 * mark reads as "sealed document" at 26pt.
 */
function WaxSeal() {
  const S = 26;
  const c = S / 2;
  const r = 10;
  // Eight small notches around the rim — the squeeze marks of a wax press.
  const notches = Array.from({ length: 8 }, (_, i) => {
    const a = (Math.PI * 2 * i) / 8;
    return {
      x1: c + Math.cos(a) * (r - 1),
      y1: c + Math.sin(a) * (r - 1),
      x2: c + Math.cos(a) * (r + 1.6),
      y2: c + Math.sin(a) * (r + 1.6),
    };
  });

  return (
    <Svg width={S} height={S}>
      <Circle cx={c} cy={c} r={r} fill={PW.goldTint} stroke={PW.gold} strokeWidth={1.1} />
      {notches.map((n, i) => (
        <Line
          key={i}
          x1={n.x1}
          y1={n.y1}
          x2={n.x2}
          y2={n.y2}
          stroke={PW.gold}
          strokeWidth={0.9}
          opacity={0.75}
        />
      ))}
      {/* Keyhole: a small circle over a taper. Impression, not illustration. */}
      <Circle cx={c} cy={c - 1.6} r={2} fill="none" stroke={PW.brown} strokeWidth={1.1} />
      <Path
        d={`M ${c - 1.5} ${c + 4.2} L ${c} ${c + 0.6} L ${c + 1.5} ${c + 4.2} Z`}
        fill={PW.brown}
        opacity={0.85}
      />
    </Svg>
  );
}

const s = StyleSheet.create({
  hero: { alignItems: "center", gap: 8, paddingHorizontal: 4 },

  /** Green, not gold: #C4A334 on parchment is ~2:1 and unreadable at 11pt. */
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

  dossier: {
    marginTop: 12,
    width: "100%",
    maxWidth: 320,
    backgroundColor: PW.card,
    borderRadius: PW_RADIUS.card,
    borderWidth: 1.25,
    borderColor: PW.border,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    ...PW_SHADOW,
  },
  dossierCompact: { marginTop: 6, paddingTop: 8, paddingBottom: 8 },

  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headLeft: { flexDirection: "row", alignItems: "center", gap: 5 },
  headTitle: {
    fontFamily: FONTS.serif,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.6,
    color: PW.forest,
  },
  /**
   * SAMPLE, in plain brown. Small, but never faint enough to miss — it is the
   * label that stops these rows being mistaken for the user's own item.
   */
  headMark: {
    fontFamily: FONTS.serif,
    fontSize: 8.5,
    fontWeight: "800",
    letterSpacing: 1.3,
    color: PW.brown,
  },

  rule: {
    height: 1,
    backgroundColor: PW.gold,
    opacity: 0.28,
    marginVertical: 7,
  },

  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  rowCompact: { paddingVertical: 0 },
  rowLabel: {
    fontFamily: FONTS.serif,
    fontSize: 10.5,
    fontWeight: "800",
    letterSpacing: 1.1,
    color: PW.brown,
    flexShrink: 1,
  },
  rowValue: {
    fontSize: 11.5,
    fontWeight: "600",
    color: PW.forest,
    flexShrink: 0,
  },

  sealRow: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 8 },
  sealText: {
    fontFamily: FONTS.serif,
    fontSize: 11,
    fontWeight: "700",
    color: PW.brown,
  },
});
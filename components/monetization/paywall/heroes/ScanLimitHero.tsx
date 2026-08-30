/**
 * components/monetization/paywall/heroes/ScanLimitHero.tsx
 *
 * The Scan Limit hero: a punched expedition pass with all fifteen marks used.
 *
 * ── Not an error screen ─────────────────────────────────────────────────────
 * This person has scanned fifteen times. They are the most engaged Free user we
 * have, and the screen should read like a ticket book that has run out — a
 * thing you top up — rather than a wall they hit. No red, no warning triangle,
 * no "LIMIT EXCEEDED". The palette is the same aged paper and forest green as
 * the rest of the app, and the stamp is brown, not scarlet.
 *
 * ── Fifteen marks, and they are countable ───────────────────────────────────
 * Drawn as three rows of five punched circles rather than a progress bar. A bar
 * says "you are at 100%"; fifteen individual marks say "you used fifteen
 * scans", which is what actually happened and what the headline claims.
 *
 * ── The count is not carried by the visual alone ────────────────────────────
 * The tally grid is hidden from screen readers and the card states 15 / 15 USED
 * in text. A VoiceOver user gets the fact, not a description of dots.
 *
 * ── No motion ───────────────────────────────────────────────────────────────
 * Nothing animates, so there is nothing to branch on for Reduce Motion. Motion
 * on the one screen with two competing choices would pull attention toward
 * whichever thing moved.
 */
import React from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Svg, { Circle, Line, Path } from "react-native-svg";
import { FONTS } from "@/constants/typography";
import { FREE_LIFETIME_SCANS } from "@/lib/paywallConfig";
import type { PaywallHeroProps } from "../PaywallHero";
import { PW, PW_RADIUS, PW_SHADOW } from "../paywallTheme";

/**
 * Below this height the pass compresses.
 *
 * This paywall carries more below the fold than any other — plan cards, the Pro
 * CTA, the trust row, the Scan Store alternative, then Restore and legal. The
 * decoration is what gives way.
 */
const COMPACT_BELOW = 760;

export function ScanLimitHero({ config }: PaywallHeroProps) {
  const { height } = useWindowDimensions();
  const compact = height < COMPACT_BELOW;

  return (
    <View style={s.hero}>
      <Text style={s.eyebrow} accessibilityRole="header">
        {config.eyebrow}
      </Text>

      <Text style={[s.headline, compact && s.headlineCompact]}>{config.headline}</Text>

      <Text style={[s.subtitle, compact && s.subtitleCompact]}>{config.subtitle}</Text>

      {/* ── The pass ──────────────────────────────────────────────────────── */}
      <View style={[s.pass, compact && s.passCompact]}>
        <NotchedEdge side="left" />
        <NotchedEdge side="right" />

        <Text style={s.passTitle}>LIFETIME SCAN PASS</Text>

        {/*
         * The count in text, so it is never visual-only. The grid below repeats
         * it decoratively and is hidden from assistive tech.
         */}
        <Text style={s.passCount} accessibilityLabel="All 15 of your 15 lifetime scans have been used.">
          {FREE_LIFETIME_SCANS} / {FREE_LIFETIME_SCANS} USED
        </Text>

        <View
          style={s.tally}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <TallyGrid compact={compact} />
        </View>

        <View style={s.stamp}>
          <Text style={s.stampText} allowFontScaling={false}>
            ALLOTMENT USED
          </Text>
        </View>
      </View>
    </View>
  );
}

/**
 * Fifteen punched marks, three rows of five.
 *
 * Each is a ring with a cross struck through it — a ticket punch, not a filled
 * dot. Brown on cream, so it reads as spent ink rather than an alert.
 */
function TallyGrid({ compact }: { compact: boolean }) {
  const cols = 5;
  const rows = Math.ceil(FREE_LIFETIME_SCANS / cols);
  const r = compact ? 5 : 6;
  const gapX = compact ? 22 : 26;
  const gapY = compact ? 19 : 22;
  const w = gapX * cols;
  const h = gapY * rows;

  const marks = Array.from({ length: FREE_LIFETIME_SCANS }, (_, i) => ({
    cx: gapX * (i % cols) + gapX / 2,
    cy: gapY * Math.floor(i / cols) + gapY / 2,
  }));

  return (
    <Svg width={w} height={h}>
      {marks.map((m, i) => (
        <React.Fragment key={i}>
          <Circle
            cx={m.cx}
            cy={m.cy}
            r={r}
            fill="none"
            stroke={PW.brown}
            strokeWidth={1.1}
            opacity={0.55}
          />
          {/* The punch. A small stroke through the ring says "spent". */}
          <Line
            x1={m.cx - r * 0.62}
            y1={m.cy - r * 0.62}
            x2={m.cx + r * 0.62}
            y2={m.cy + r * 0.62}
            stroke={PW.brown}
            strokeWidth={1.2}
            opacity={0.75}
          />
        </React.Fragment>
      ))}
    </Svg>
  );
}

/**
 * A scalloped edge, like a torn ticket stub.
 *
 * Three small notches cut out of the card's side. The detail that makes this a
 * pass rather than a panel.
 */
function NotchedEdge({ side }: { side: "left" | "right" }) {
  const n = 3;
  const r = 5;
  return (
    <Svg width={r} height={r * 2 * n + 8} style={[s.notch, side === "left" ? { left: -1 } : { right: -1 }]}>
      {Array.from({ length: n }).map((_, i) => (
        <Path
          key={i}
          d={
            side === "left"
              ? `M 0 ${i * r * 2 + 4} A ${r} ${r} 0 0 1 0 ${i * r * 2 + 4 + r * 2}`
              : `M ${r} ${i * r * 2 + 4} A ${r} ${r} 0 0 0 ${r} ${i * r * 2 + 4 + r * 2}`
          }
          fill={PW.parchment}
        />
      ))}
    </Svg>
  );
}

const s = StyleSheet.create({
  hero: { alignItems: "center", gap: 8, paddingHorizontal: 4 },

  /**
   * Green, as on every other hero. #C4A334 on parchment is ~2:1 and unreadable
   * at 11pt, so gold never carries small text anywhere in this system.
   */
  eyebrow: {
    fontFamily: FONTS.serif,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 2.8,
    color: PW.forest,
  },

  headline: {
    fontFamily: FONTS.serif,
    fontSize: 25,
    fontWeight: "800",
    color: PW.ink,
    textAlign: "center",
    lineHeight: 31,
    paddingHorizontal: 4,
  },
  headlineCompact: { fontSize: 22, lineHeight: 27 },

  subtitle: {
    fontSize: 14,
    color: PW.brown,
    textAlign: "center",
    lineHeight: 20,
    paddingHorizontal: 8,
    maxWidth: 336,
  },
  subtitleCompact: { fontSize: 12.5, lineHeight: 18 },

  pass: {
    marginTop: 12,
    alignItems: "center",
    gap: 7,
    backgroundColor: PW.card,
    borderRadius: PW_RADIUS.card,
    borderWidth: 1.25,
    borderColor: PW.border,
    borderStyle: "dashed",
    paddingHorizontal: 26,
    paddingVertical: 13,
    ...PW_SHADOW,
  },
  passCompact: { marginTop: 6, paddingVertical: 10, gap: 5 },

  notch: { position: "absolute", top: "50%", marginTop: -22 },

  passTitle: {
    fontFamily: FONTS.serif,
    fontSize: 9.5,
    fontWeight: "800",
    letterSpacing: 2,
    color: PW.brown,
  },
  /** Forest, not red. This is a count, not a fault. */
  passCount: {
    fontFamily: FONTS.serif,
    fontSize: 19,
    fontWeight: "800",
    letterSpacing: 0.5,
    color: PW.forest,
  },

  tally: { marginTop: 2 },

  stamp: {
    marginTop: 3,
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: PW.border,
    backgroundColor: PW.goldTint,
  },
  /** Brown ink on the gold wash — about 5.6:1, and deliberately not scarlet. */
  stampText: {
    fontFamily: FONTS.serif,
    fontSize: 8,
    fontWeight: "800",
    letterSpacing: 1.4,
    color: PW.brown,
  },
});
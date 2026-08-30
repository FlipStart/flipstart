/**
 * components/monetization/paywall/heroes/AiContextHero.tsx
 *
 * The AI Context hero: a collector's note card pinned above the appraisal.
 *
 * ── The story ───────────────────────────────────────────────────────────────
 * The user spotted something the photos cannot show and wants it taken into
 * account. So the visual is a handwritten observation card feeding down into
 * FlipStart's analysis — a note clipped to a merchant's appraisal form, not a
 * chat bubble.
 *
 * Deliberately NOT a messaging UI. No avatar, no send button, no rounded
 * bubble, no blinking cursor. The moment this looks like a chat box it starts
 * promising a conversation, and the real feature is one short note.
 *
 * ── The sample is labelled SAMPLE NOTE ──────────────────────────────────────
 * The card shows fixed illustrative text and is never bound to the user's
 * actual context state. That matters twice over: this paywall appears when the
 * user has typed NOTHING, so unlabelled example text would imply FlipStart had
 * already received a note it has not. The heading removes the ambiguity.
 *
 * ── The lower card explains, it does not report ─────────────────────────────
 * It reads GUIDE THE ANALYSIS, not "Context added". Nothing has been added —
 * the user is looking at a paywall — and wording that claims otherwise would be
 * describing a state they have not reached.
 *
 * ── No motion ───────────────────────────────────────────────────────────────
 * The brief allows a restrained gold sweep and says static is completely
 * acceptable. On a purchase screen, movement competes with the decision, and a
 * typing effect here would be the exact chat-UI language being avoided. Nothing
 * animates, so there is nothing to branch on for Reduce Motion.
 */
import React from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import Svg, { Circle, Line, Path } from "react-native-svg";
import { FONTS } from "@/constants/typography";
import type { PaywallHeroProps } from "../PaywallHero";
import { PW, PW_RADIUS, PW_SHADOW } from "../paywallTheme";

/** Below this height the card compresses rather than pushing plans away. */
const COMPACT_BELOW = 700;

/**
 * Fixed illustrative text. Never the user's own draft.
 *
 * Chosen to match what the real feature is for — a detail the photos cannot
 * carry — and short enough to fit two lines on a small screen.
 */
const SAMPLE_NOTE = "Tag is faded — focus on the stitching and embroidered logo.";

export function AiContextHero({ config }: PaywallHeroProps) {
  const { height } = useWindowDimensions();
  const compact = height < COMPACT_BELOW;

  return (
    <View style={s.hero}>
      <Text style={s.eyebrow} accessibilityRole="header">
        {config.eyebrow}
      </Text>

      <Text style={[s.headline, compact && s.headlineCompact]}>{config.headline}</Text>

      <Text style={[s.subtitle, compact && s.subtitleCompact]}>{config.subtitle}</Text>

      {/*
       * Hidden from screen readers: the headline and subtitle already say what
       * this shows, so hearing the sample note read aloud would suggest it is
       * real content rather than an illustration.
       */}
      <View
        style={[s.stack, compact && s.stackCompact]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {/* ── The observation card ─────────────────────────────────────── */}
        <View style={[s.note, compact && s.noteCompact]}>
          <View style={s.noteHead}>
            <View style={s.noteHeadLeft}>
              <MaterialIcons name="edit-note" size={15} color={PW.gold} />
              <Text style={s.noteHeadText}>SAMPLE NOTE</Text>
            </View>
            <View style={s.proSeal}>
              <Text style={s.proSealText} allowFontScaling={false}>
                PRO
              </Text>
            </View>
          </View>

          {/*
           * Ruled paper. Lines sit BEHIND the text rather than under each
           * glyph, which is what makes it read as a note card instead of an
           * underlined form field.
           */}
          <View style={s.noteBody}>
            <RuledPaper compact={compact} />
            <Text style={[s.noteText, compact && s.noteTextCompact]} numberOfLines={compact ? 2 : 3}>
              {SAMPLE_NOTE}
            </Text>
          </View>

          <CornerFold />
        </View>

        {/* ── Brass connector ──────────────────────────────────────────── */}
        <Connector height={compact ? 14 : 20} />

        {/* ── What it does, explained — not reported as done ───────────── */}
        <View style={[s.result, compact && s.resultCompact]}>
          <MaterialIcons name="auto-awesome" size={13} color={PW.gold} />
          <Text style={s.resultText}>GUIDE THE ANALYSIS</Text>
        </View>
      </View>
    </View>
  );
}

/** Faint horizontal rules, like a lined index card. */
function RuledPaper({ compact }: { compact: boolean }) {
  const rows = compact ? 2 : 3;
  const gap = compact ? 17 : 18;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width="100%" height="100%">
        {Array.from({ length: rows }).map((_, i) => (
          <Line
            key={i}
            x1="0"
            y1={gap * (i + 1) - 3}
            x2="100%"
            y2={gap * (i + 1) - 3}
            stroke={PW.border}
            strokeWidth={0.8}
            opacity={0.55}
          />
        ))}
      </Svg>
    </View>
  );
}

/** A small turned-up corner. The detail that says "paper", cheaply. */
function CornerFold() {
  const S = 13;
  return (
    <Svg width={S} height={S} style={s.fold}>
      <Path d={`M 0 ${S} L ${S} ${S} L ${S} 0 Z`} fill={PW.goldTint} />
      <Path d={`M 0 ${S} L ${S} 0`} stroke={PW.gold} strokeWidth={0.9} opacity={0.6} />
    </Svg>
  );
}

/** Dashed brass thread from the note down to the analysis. */
function Connector({ height }: { height: number }) {
  const w = 36;
  const mid = w / 2;
  return (
    <Svg width={w} height={height + 6}>
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
      <Path
        d={`M ${mid - 4} ${height - 3} L ${mid} ${height + 2} L ${mid + 4} ${height - 3}`}
        stroke={PW.gold}
        strokeWidth={1.3}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle cx={mid - 10} cy={height / 2} r={1.2} fill={PW.gold} opacity={0.5} />
      <Circle cx={mid + 10} cy={height / 2} r={1.2} fill={PW.gold} opacity={0.5} />
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
  headlineCompact: { fontSize: 23, lineHeight: 28 },

  subtitle: {
    fontSize: 14,
    color: PW.brown,
    textAlign: "center",
    lineHeight: 20,
    paddingHorizontal: 8,
    maxWidth: 336,
  },
  subtitleCompact: { fontSize: 12.5, lineHeight: 18 },

  stack: { alignItems: "center", marginTop: 12, width: "100%" },
  stackCompact: { marginTop: 6 },

  note: {
    width: "100%",
    maxWidth: 320,
    backgroundColor: PW.card,
    borderRadius: PW_RADIUS.card,
    borderWidth: 1.25,
    borderColor: PW.forest,
    paddingHorizontal: 13,
    paddingTop: 9,
    paddingBottom: 11,
    overflow: "hidden",
    ...PW_SHADOW,
  },
  noteCompact: { paddingTop: 7, paddingBottom: 9 },

  noteHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 7,
  },
  noteHeadLeft: { flexDirection: "row", alignItems: "center", gap: 5 },
  noteHeadText: {
    fontFamily: FONTS.serif,
    fontSize: 9.5,
    fontWeight: "800",
    letterSpacing: 1.5,
    color: PW.brown,
  },

  noteBody: { minHeight: 40, justifyContent: "flex-start" },
  /**
   * Serif and slightly loose, so it reads as something written rather than
   * something typed into a field.
   */
  noteText: {
    fontFamily: FONTS.serif,
    fontSize: 13.5,
    lineHeight: 18,
    color: PW.ink,
    fontStyle: "italic",
  },
  noteTextCompact: { fontSize: 12.5, lineHeight: 17 },

  fold: { position: "absolute", right: 0, bottom: 0 },

  proSeal: {
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 3,
    borderWidth: 0.9,
    borderColor: PW.gold,
    backgroundColor: PW.goldTint,
  },
  /** Forest ink on the gold wash — gold on gold would be ~1.3:1. */
  proSealText: {
    fontFamily: FONTS.serif,
    fontSize: 7.5,
    fontWeight: "800",
    letterSpacing: 1,
    color: PW.forest,
  },

  result: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: PW.goldTint,
    borderRadius: PW_RADIUS.card - 4,
    borderWidth: 1,
    borderColor: "rgba(196,163,52,0.45)",
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  resultCompact: { paddingVertical: 5 },
  resultText: {
    fontFamily: FONTS.serif,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.4,
    color: PW.brown,
  },
});
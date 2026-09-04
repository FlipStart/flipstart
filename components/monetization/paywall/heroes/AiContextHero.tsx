/**
 * components/monetization/paywall/heroes/AiContextHero.tsx
 *
 * The AI Context hero: a collector's note card pinned above the appraisal.
 *
 * ── The story ───────────────────────────────────────────────────────────────
 * The user spotted something the photos cannot show and wants it taken into
 * account. So the visual is a handwritten observation card feeding down into
 * FlipStart's analysis — a note clipped to a merchant's appraisal form.
 *
 * Deliberately NOT a messaging UI. No avatar, no rounded speech shape, no
 * blinking cursor. The moment this looks like a conversation it starts
 * promising one, and the real feature is one short note.
 *
 * ── The redesign ────────────────────────────────────────────────────────────
 * The concept was already the strongest of the three heroes; what changed is
 * the shell around it. The note now sits under the shared masthead, carries
 * the hairline gold inner rule the selected plan card uses (so "this is the
 * Pro object" is said in the same language everywhere), and casts the forest
 * shadow the Deep Analysis dossier casts. The card, connector and chip are
 * tightened so the whole teaser fits in ~105pt.
 *
 * ── The sample is labelled SAMPLE NOTE ──────────────────────────────────────
 * The card shows fixed illustrative text and is never bound to the user's
 * actual context state. This paywall appears when the user has typed NOTHING,
 * so unlabelled example text would imply FlipStart had already received a note
 * it has not.
 *
 * ── The lower chip explains, it does not report ─────────────────────────────
 * It reads GUIDE THE ANALYSIS, not "Context added". Nothing has been added —
 * the user is looking at a paywall.
 *
 * ── Motion ──────────────────────────────────────────────────────────────────
 * One entrance via the shared useHeroReveal: the note settles, the thread
 * appears, the chip follows — top to bottom, the direction the note travels.
 * ~0.9s, then still. The masthead glint is the only slow repeat on this hero.
 * Reduce Motion renders the finished card. There is no typing effect: that
 * would be the exact conversation-UI language being avoided.
 */
import React from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import Svg, { Circle, Line, Path } from "react-native-svg";
import { FONTS } from "@/constants/typography";
import type { PaywallHeroProps } from "../PaywallHero";
import { PaywallMasthead } from "../PaywallMasthead";
import { Reveal, useHeroReveal } from "../HeroReveal";
import { PW, PW_RADIUS } from "../paywallTheme";

/** Below this height the card compresses rather than pushing plans away. */
const COMPACT_BELOW = 740;

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
  const { progress } = useHeroReveal();

  return (
    <View style={s.hero}>
      <PaywallMasthead feature="AI CONTEXT" accessibilityLabel="FlipStart, AI Context" />

      <Text style={[s.headline, compact && s.headlineCompact]}>{config.headline}</Text>
      <Text style={[s.subtitle, compact && s.subtitleCompact]}>{config.subtitle}</Text>

      {/*
       * Hidden from screen readers: the headline and subtitle already say what
       * this shows, and hearing the sample note read aloud would suggest it is
       * real content rather than an illustration.
       */}
      <View
        style={[s.stack, compact && s.stackCompact]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {/* ── The observation card ─────────────────────────────────────── */}
        <Reveal progress={progress} at={0} span={0.45} dy={6} style={s.noteWrap}>
          <View style={[s.note, compact && s.noteCompact]}>
            <View pointerEvents="none" style={s.innerRule} />

            <View style={s.noteHead}>
              <View style={s.noteHeadLeft}>
                <MaterialIcons name="edit-note" size={15} color={PW.gold} />
                <Text style={s.noteHeadText} allowFontScaling={false}>SAMPLE NOTE</Text>
              </View>
              <View style={s.proSeal}>
                <Text style={s.proSealText} allowFontScaling={false}>PRO</Text>
              </View>
            </View>

            {/*
             * Ruled paper. Lines sit BEHIND the text rather than under each
             * glyph, which is what makes it read as a note card instead of an
             * underlined form field.
             */}
            <View style={s.noteBody}>
              <RuledPaper compact={compact} />
              <Text style={[s.noteText, compact && s.noteTextCompact]} numberOfLines={2}>
                {SAMPLE_NOTE}
              </Text>
            </View>

            <CornerFold />
          </View>
        </Reveal>

        {/* ── Brass thread ─────────────────────────────────────────────── */}
        <Reveal progress={progress} at={0.35} span={0.35} dy={0}>
          <Connector height={compact ? 8 : 9} />
        </Reveal>

        {/* ── What it does, explained — not reported as done ───────────── */}
        <Reveal progress={progress} at={0.5} span={0.45} dy={4}>
          <View style={[s.chip, compact && s.chipCompact]}>
            <MaterialIcons name="auto-awesome" size={13} color={PW.gold} />
            <Text style={s.chipText} allowFontScaling={false}>GUIDE THE ANALYSIS</Text>
          </View>
        </Reveal>
      </View>
    </View>
  );
}

/** Faint horizontal rules, like a lined index card. */
function RuledPaper({ compact }: { compact: boolean }) {
  const gap = compact ? 17 : 18;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width="100%" height="100%">
        {[0, 1].map(i => (
          <Line key={i} x1="0" y1={gap * (i + 1) - 3} x2="100%" y2={gap * (i + 1) - 3}
            stroke={PW.border} strokeWidth={0.8} opacity={0.55} />
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
  const w = 36, mid = w / 2;
  return (
    <Svg width={w} height={height + 6}>
      <Line x1={mid} y1={0} x2={mid} y2={height - 2}
        stroke={PW.gold} strokeWidth={1.2} strokeDasharray="3,2.5" opacity={0.8} />
      <Path d={`M ${mid - 4} ${height - 3} L ${mid} ${height + 2} L ${mid + 4} ${height - 3}`}
        stroke={PW.gold} strokeWidth={1.3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <Circle cx={mid - 10} cy={height / 2} r={1.2} fill={PW.gold} opacity={0.5} />
      <Circle cx={mid + 10} cy={height / 2} r={1.2} fill={PW.gold} opacity={0.5} />
    </Svg>
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

  stack: { alignItems: "center", marginTop: 4, width: "100%" },
  stackCompact: { marginTop: 6 },

  noteWrap: { width: "100%", alignItems: "center" },
  note: {
    width: "100%", maxWidth: 340,
    backgroundColor: PW.card, borderRadius: PW_RADIUS.card,
    borderWidth: 1.25, borderColor: PW.forest,
    paddingHorizontal: 13, paddingTop: 7, paddingBottom: 7,
    overflow: "hidden",
    shadowColor: PW.forest, shadowOpacity: 0.10, shadowRadius: 12, shadowOffset: { width: 0, height: 5 },
    elevation: 3,
  },
  noteCompact: { paddingTop: 7, paddingBottom: 8 },
  /** The selected plan card's hairline — the Pro object, said the same way. */
  innerRule: {
    position: "absolute", top: 4, left: 4, right: 4, bottom: 4,
    borderRadius: PW_RADIUS.card - 4,
    borderWidth: 1, borderColor: "rgba(196,163,52,0.45)",
  },

  noteHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  noteHeadLeft: { flexDirection: "row", alignItems: "center", gap: 5 },
  noteHeadText: { fontFamily: FONTS.serif, fontSize: 9.5, fontWeight: "800", letterSpacing: 1.5, color: PW.brown },

  noteBody: { minHeight: 34, justifyContent: "flex-start" },
  /** Serif and slightly loose, so it reads as written rather than typed. */
  noteText: { fontFamily: FONTS.serif, fontSize: 13.5, lineHeight: 18, color: PW.ink, fontStyle: "italic" },
  noteTextCompact: { fontSize: 12.5, lineHeight: 17 },

  fold: { position: "absolute", right: 0, bottom: 0 },

  proSeal: {
    paddingHorizontal: 6, paddingVertical: 1.5, borderRadius: 3,
    borderWidth: 0.9, borderColor: PW.gold, backgroundColor: PW.goldTint,
  },
  /** Forest ink on the gold wash — gold on gold would be ~1.3:1. */
  proSealText: { fontFamily: FONTS.serif, fontSize: 7.5, fontWeight: "800", letterSpacing: 1, color: PW.forest },

  chip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: PW.goldTint, borderRadius: PW_RADIUS.card - 4,
    borderWidth: 1, borderColor: "rgba(196,163,52,0.45)",
    paddingHorizontal: 12, paddingVertical: 4,
  },
  chipCompact: { paddingVertical: 3.5 },
  chipText: { fontFamily: FONTS.serif, fontSize: 10, fontWeight: "800", letterSpacing: 1.4, color: PW.brown },
});
/**
 * components/monetization/paywall/heroes/SettingsUpgradeHero.tsx
 *
 * The Settings upgrade paywall: a member's plaque.
 *
 * ── Why this one looks different ────────────────────────────────────────────
 * Every other paywall is CONTEXTUAL — it appears at the moment the user reaches
 * for a locked thing, and its hero explains that one thing. This one is
 * VOLUNTARY: the user went looking for it in Settings. Nobody arriving here
 * needs a lock explained; they want to see what membership is.
 *
 * So instead of an illustration of a feature, the hero is the membership
 * itself: a deep forest plaque, engraved in brass, with a wax seal that stamps
 * down when the screen opens. Old collector's club, not app-store card.
 *
 * ── Motion, and where it stops ──────────────────────────────────────────────
 * A single entrance choreography, once, on mount:
 *
 *   plaque rises and settles        (0 → 420ms)
 *   engraved lines fade up, staggered (200 → 700ms)
 *   seal stamps down with a bounce   (500 → 900ms)
 *   one slow brass sheen crosses the plaque, then never again
 *
 * Nothing loops. Nothing runs during the purchase decision. Reduce Motion
 * renders the finished state immediately — the plaque, the lines and the seal,
 * all present, no movement.
 *
 * ── Everything is drawn ─────────────────────────────────────────────────────
 * No photography, no assets, no new packages. The plaque is Views and SVG; the
 * seal is a hand-drawn medallion; the sheen is a translated gradient strip.
 */
import React, { useEffect, useState } from "react";
import {
  AccessibilityInfo, StyleSheet, Text, View, useWindowDimensions,
} from "react-native";
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, withDelay, withSequence,
  Easing, interpolate, type SharedValue,
} from "react-native-reanimated";
import Svg, { Circle, Path, Rect, Defs, LinearGradient, Stop, Line } from "react-native-svg";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { FONTS } from "@/constants/typography";
import type { PaywallHeroProps } from "../PaywallHero";
import { PW } from "../paywallTheme";

/** Below this height the plaque compresses so the plan cards stay in view. */
const COMPACT_BELOW = 720;

/** Plaque palette. Deliberately deeper than the app's forest — this is velvet. */
const PLAQUE      = "#163A22";
const PLAQUE_EDGE = "#0F2A18";
const BRASS       = "#D4B454";
const BRASS_DIM   = "rgba(212,180,84,0.55)";
const BRASS_FAINT = "rgba(212,180,84,0.22)";
const IVORY       = "#F3EBD3";
const WAX         = "#8E2F2A";
const WAX_DEEP    = "#6B1F1B";

const LINES = [
  { icon: "photo-library",  text: "Three-photo scans" },
  { icon: "edit-note",      text: "AI Context on every scan" },
  { icon: "insights",       text: "Deep Analysis" },
  { icon: "sell",           text: "Generate Listings" },
] as const;

export function SettingsUpgradeHero({ config }: PaywallHeroProps) {
  const { width, height } = useWindowDimensions();
  const compact = height < COMPACT_BELOW;
  const plaqueW = Math.min(width - 40, 380);

  const [reduceMotion, setReduceMotion] = useState(false);
  const [plaqueH, setPlaqueH] = useState(0);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
  }, []);

  // ── Choreography ─────────────────────────────────────────────────────────
  const rise  = useSharedValue(reduceMotion ? 1 : 0);
  const lines = useSharedValue(reduceMotion ? 1 : 0);
  const sealIn    = useSharedValue(reduceMotion ? 1 : 0);   // opacity + rotation
  const sealScale = useSharedValue(reduceMotion ? 1 : 1.5); // the stamp itself
  const sheen = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    if (reduceMotion) {
      rise.value = 1; lines.value = 1; sealIn.value = 1; sealScale.value = 1; sheen.value = 1;
      return;
    }
    const ease = Easing.out(Easing.cubic);
    rise.value  = withTiming(1, { duration: 420, easing: ease });
    lines.value = withDelay(200, withTiming(1, { duration: 500, easing: ease }));
    // Stamp: drop from 1.5, overshoot to 1.12, settle at exactly 1. Reads as a
    // press. Scale is its own value so the final frame is 1, not an
    // interpolation artefact.
    sealIn.value    = withDelay(500, withTiming(1, { duration: 240, easing: ease }));
    sealScale.value = withDelay(500, withSequence(
      withTiming(1.12, { duration: 260, easing: Easing.out(Easing.quad) }),
      withTiming(1,    { duration: 180, easing: Easing.inOut(Easing.quad) }),
    ));
    // One pass, then done. Never repeats.
    sheen.value = withDelay(900, withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.sin) }));
  }, [reduceMotion, rise, lines, sealIn, sealScale, sheen]);

  const plaqueStyle = useAnimatedStyle(() => ({
    opacity: rise.value,
    transform: [{ translateY: interpolate(rise.value, [0, 1], [18, 0]) }],
  }));
  const sealStyle = useAnimatedStyle(() => ({
    opacity: sealIn.value,
    transform: [
      { scale: sealScale.value },
      { rotate: `${interpolate(sealIn.value, [0, 1], [-14, -8])}deg` },
    ],
  }));
  const sheenStyle = useAnimatedStyle(() => ({
    opacity: interpolate(sheen.value, [0, 0.15, 0.85, 1], [0, 0.55, 0.55, 0]),
    transform: [{ translateX: interpolate(sheen.value, [0, 1], [-plaqueW * 0.7, plaqueW * 1.1]) }],
  }));

  return (
    <View style={s.hero}>
      <Text style={s.eyebrow} accessibilityRole="header">
        {config.eyebrow}
      </Text>
      <Text style={[s.headline, compact && s.headlineCompact]}>{config.headline}</Text>

      {/* ── The plaque ───────────────────────────────────────────────────── */}
      <Animated.View
        onLayout={e => setPlaqueH(e.nativeEvent.layout.height)}
        style={[s.plaque, { width: plaqueW }, compact && s.plaqueCompact, plaqueStyle]}
        accessibilityLabel="FlipStart Pro membership: three-photo scans, AI Context on every scan, Deep Analysis, and Generate Listings."
      >
        {/* Velvet grain — a fine diagonal hatch, barely there. */}
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <Svg width="100%" height="100%">
            <Defs>
              <LinearGradient id="vel" x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0" stopColor="#1B4529" />
                <Stop offset="1" stopColor={PLAQUE_EDGE} />
              </LinearGradient>
            </Defs>
            <Rect width="100%" height="100%" fill="url(#vel)" />
            {Array.from({ length: 22 }).map((_, i) => (
              <Line key={i} x1={i * 22 - 40} y1="0" x2={i * 22 + 60} y2="100%"
                stroke="#000" strokeOpacity={0.06} strokeWidth={1} />
            ))}
          </Svg>
        </View>

        {/* Engraved double rule with corner flourishes. */}
        <Frame w={plaqueW} h={plaqueH} />

        {/* Brass sheen — a single pass across the surface. */}
        <Animated.View style={[s.sheen, sheenStyle]} pointerEvents="none">
          <Svg width={90} height="100%">
            <Defs>
              <LinearGradient id="sh" x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0"   stopColor={BRASS} stopOpacity="0" />
                <Stop offset="0.5" stopColor={IVORY} stopOpacity="0.35" />
                <Stop offset="1"   stopColor={BRASS} stopOpacity="0" />
              </LinearGradient>
            </Defs>
            <Rect width="100%" height="100%" fill="url(#sh)" />
          </Svg>
        </Animated.View>

        <View style={s.plaqueInner}>
          <Text style={s.plaqueKicker}>MEMBERSHIP</Text>
          <Text style={[s.plaqueTitle, compact && s.plaqueTitleCompact]}>FlipStart Pro</Text>
          <View style={s.rule} />

          {LINES.map((l, i) => (
            <EngravedLine key={l.text} icon={l.icon} text={l.text} index={i}
              progress={lines} compact={compact} />
          ))}

          <Text style={s.plaqueFoot}>300 scans monthly · 4,000 annually</Text>
        </View>

        {/* The seal. Stamps down last. */}
        <Animated.View style={[s.sealWrap, sealStyle]} pointerEvents="none">
          <WaxSeal size={compact ? 58 : 66} />
        </Animated.View>
      </Animated.View>

      <Text style={[s.subtitle, compact && s.subtitleCompact]}>{config.subtitle}</Text>
    </View>
  );
}

/** One engraved feature line, fading up on its own stagger. */
function EngravedLine({ icon, text, index, progress, compact }: {
  icon: (typeof LINES)[number]["icon"]; text: string; index: number;
  // Named export in Reanimated 4 — `Animated.SharedValue` is not a member of
  // the default namespace there and fails to type-check.
  progress: SharedValue<number>; compact: boolean;
}) {
  const style = useAnimatedStyle(() => {
    const start = index * 0.18;
    const t = interpolate(progress.value, [start, Math.min(1, start + 0.45)], [0, 1], "clamp");
    return { opacity: t, transform: [{ translateY: (1 - t) * 8 }] };
  });
  return (
    <Animated.View style={[s.line, compact && s.lineCompact, style]}>
      <MaterialIcons name={icon} size={compact ? 14 : 15} color={BRASS} />
      <Text style={[s.lineText, compact && s.lineTextCompact]}>{text}</Text>
    </Animated.View>
  );
}

/**
 * Double engraved border with small corner flourishes.
 *
 * Takes the measured plaque size. SVG path data has no `calc()` and a
 * percentage-width Rect offset by an inset overflows its box, so everything is
 * computed from real numbers.
 */
function Frame({ w, h }: { w: number; h: number }) {
  if (!w || !h) return null;
  const inset = 8, gap = 4, f = 12;
  const outer = { x: inset, y: inset, w: w - inset * 2, h: h - inset * 2 };
  const inner = { x: inset + gap, y: inset + gap, w: w - (inset + gap) * 2, h: h - (inset + gap) * 2 };
  const corners: [number, number, number, number][] = [
    [inset, inset, 1, 1], [w - inset, inset, -1, 1],
    [inset, h - inset, 1, -1], [w - inset, h - inset, -1, -1],
  ];
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width={w} height={h}>
        <Rect x={outer.x} y={outer.y} width={outer.w} height={outer.h}
          fill="none" stroke={BRASS_DIM} strokeWidth={1.2} rx={4} />
        <Rect x={inner.x} y={inner.y} width={inner.w} height={inner.h}
          fill="none" stroke={BRASS_FAINT} strokeWidth={0.8} rx={2} />
        {corners.map(([x, y, sx, sy], i) => (
          <Path key={i}
            d={`M ${x} ${y + f * sy} L ${x} ${y} L ${x + f * sx} ${y}`}
            stroke={BRASS} strokeWidth={1.4} fill="none"
            strokeLinecap="round" strokeLinejoin="round" />
        ))}
      </Svg>
    </View>
  );
}

/**
 * A hand-drawn wax seal: crimson disc, scalloped edge, brass FS monogram.
 *
 * ── The monogram ────────────────────────────────────────────────────────────
 * F upper-left, S lower-right, joined: the F's stem runs diagonally down-right
 * and becomes the S's entry stroke, so the two letters are one physical mark
 * rather than two glyphs sharing a circle.
 *
 * The S is built from a unit-box template scaled into place, which is what
 * keeps its two bowls open and legible at 58px. An earlier freehand version
 * knotted into a blob at that size — this one was rendered and checked at the
 * shipped dimensions before it went in.
 *
 * Drawn rather than typeset so it engraves rather than prints.
 */
function WaxSeal({ size }: { size: number }) {
  const c = size / 2, r = size / 2 - 2, sw = size * 0.055;
  const scallops = 14;
  const pts: string[] = [];
  for (let i = 0; i < scallops * 2; i++) {
    const a = (Math.PI * 2 * i) / (scallops * 2) - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * 0.9;
    pts.push(`${(c + rr * Math.cos(a)).toFixed(2)} ${(c + rr * Math.sin(a)).toFixed(2)}`);
  }

  // Unit-relative coordinates, so the mark scales with the seal.
  const P = (x: number, y: number) => `${(c + x * r).toFixed(2)} ${(c + y * r).toFixed(2)}`;
  const F =
    `M ${P(-0.31, -0.44)} L ${P(-0.31, -0.14)} ` +
    `M ${P(-0.31, -0.44)} L ${P(0.05, -0.44)} ` +
    `M ${P(-0.31, -0.29)} L ${P(-0.07, -0.29)}`;
  // The S, in a box below-right of the F.
  const sx = -0.02, sy = 0.00, w = 0.44, h = 0.48;
  const S = (u: number, v: number) => P(sx + u * w, sy + v * h);
  // One continuous stroke: F stem base → diagonal ligature → S.
  const FS =
    `M ${P(-0.31, -0.14)} L ${S(0.75, 0.20)} ` +
    `C ${S(0.75, -0.10)} ${S(0.20, -0.10)} ${S(0.20, 0.25)} ` +
    `C ${S(0.20, 0.50)} ${S(0.80, 0.50)} ${S(0.80, 0.75)} ` +
    `C ${S(0.80, 1.10)} ${S(0.25, 1.10)} ${S(0.25, 0.80)}`;

  return (
    <Svg width={size} height={size}>
      <Defs>
        <LinearGradient id="wax" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#A83B34" />
          <Stop offset="1" stopColor={WAX_DEEP} />
        </LinearGradient>
      </Defs>
      <Path d={`M ${pts.join(" L ")} Z`} fill="url(#wax)" />
      <Circle cx={c} cy={c} r={r * 0.72} fill="none" stroke={BRASS} strokeWidth={1.1} opacity={0.7} />
      <Circle cx={c} cy={c} r={r * 0.62} fill={WAX} />
      <Path d={F} stroke={BRASS} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <Path d={FS} stroke={BRASS} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

const s = StyleSheet.create({
  hero: { alignItems: "center", gap: 8, paddingHorizontal: 4 },

  eyebrow: {
    fontFamily: FONTS.serif, fontSize: 11, fontWeight: "800",
    letterSpacing: 2.8, color: PW.forest,
  },
  headline: {
    fontFamily: FONTS.serif, fontSize: 26, fontWeight: "800",
    color: PW.ink, textAlign: "center", lineHeight: 32, paddingHorizontal: 4,
  },
  headlineCompact: { fontSize: 22, lineHeight: 27 },

  plaque: {
    marginTop: 8,
    borderRadius: 14,
    backgroundColor: PLAQUE,
    overflow: "hidden",
    paddingHorizontal: 22,
    paddingTop: 20,
    paddingBottom: 18,
    shadowColor: "#000",
    shadowOpacity: 0.28,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  plaqueCompact: { paddingTop: 14, paddingBottom: 13, paddingHorizontal: 18 },
  plaqueInner: { alignItems: "center", gap: 3 },

  plaqueKicker: {
    fontFamily: FONTS.serif, fontSize: 9.5, fontWeight: "800",
    letterSpacing: 3.2, color: BRASS_DIM,
  },
  plaqueTitle: {
    fontFamily: FONTS.serif, fontSize: 28, fontWeight: "800",
    color: IVORY, letterSpacing: 0.4, marginTop: 2,
  },
  plaqueTitleCompact: { fontSize: 24 },

  rule: { width: 52, height: 1, backgroundColor: BRASS, opacity: 0.7, marginVertical: 10 },

  line: { flexDirection: "row", alignItems: "center", gap: 9, paddingVertical: 4.5 },
  lineCompact: { paddingVertical: 3 },
  lineText: {
    fontFamily: FONTS.serif, fontSize: 14.5, color: IVORY, letterSpacing: 0.2,
  },
  lineTextCompact: { fontSize: 13.5 },

  plaqueFoot: {
    marginTop: 10, fontSize: 11, color: BRASS_DIM, letterSpacing: 0.6,
    fontWeight: "600",
  },

  sealWrap: { position: "absolute", right: 14, top: 12 },

  sheen: { position: "absolute", top: 0, bottom: 0, left: 0, width: 90 },

  subtitle: {
    marginTop: 4, fontSize: 13.5, color: PW.brown, textAlign: "center",
    lineHeight: 19, paddingHorizontal: 10, maxWidth: 340,
  },
  subtitleCompact: { fontSize: 12.5, lineHeight: 17 },
});
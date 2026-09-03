/**
 * components/monetization/paywall/heroes/DeepAnalysisHero.tsx
 *
 * The Deep Analysis hero: a dossier with three insights open and the rest
 * under seal.
 *
 * ── What is teased, and why these three ─────────────────────────────────────
 * Deep Analysis has twelve sections. A paywall that showed six of them would be
 * a shrunken report, not a teaser — and the reference mockup showed exactly
 * why that fails. So the card opens three, chosen as a single argument:
 *
 *   WHY STRONG BUY?   the verdict, and the reasons behind it
 *   PRICE LOGIC       the numbers that verdict rests on
 *   RISK FLAGS        what could still go wrong
 *
 * Together they answer the question every reseller has at the rack: "should I
 * buy this, at what price, and what am I missing?" The remaining sections are
 * named but sealed beneath a gold lock, which is the actual pitch: you have
 * seen the shape of the reasoning; the rest of it is one tap away.
 *
 * ── Everything shown is a SAMPLE ────────────────────────────────────────────
 * The figures are fixed and illustrative. The card is stamped SAMPLE and the
 * item is generic on purpose: this paywall opens over a REAL scan, and a
 * fabricated analysis that looked like the user's item would be a lie about
 * their find. The section names are the real ones from analysis-details.tsx,
 * cross-checked by test, so the tease is truthful about what exists.
 *
 * ── Motion ──────────────────────────────────────────────────────────────────
 * On open: the verdict chip stamps in, then the three insight rows slide up in
 * sequence, then the sealed footer settles last — the eye reads the dossier
 * top to bottom exactly as the argument is built. One pass, ~1.1s, then still.
 * A faint gold glint crosses the DEEP ANALYSIS diamond every ~11s (offset from
 * the CTA's 7s and the store button's 9s so nothing ever pulses in step).
 * Reduce Motion renders the finished card.
 */
import React, { useEffect, useState } from "react";
import { AccessibilityInfo, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, withDelay, withSequence, withRepeat,
  Easing, interpolate, type SharedValue,
} from "react-native-reanimated";
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from "react-native-svg";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { FONTS } from "@/constants/typography";
import type { PaywallHeroProps } from "../PaywallHero";
import { PW, PW_RADIUS } from "../paywallTheme";

const COMPACT_BELOW = 740;

/** Real section titles from app/analysis-details.tsx — pinned by test. */
const SEALED_SECTIONS = ["Confidence Breakdown", "Where to Sell", "Listing Strategy", "Item Evidence"];

/** Illustrative. A generic item so it cannot be mistaken for the user's scan. */
const SAMPLE = {
  item: "Vintage Leather Jacket",
  verdict: "STRONG BUY",
  confidence: "74%",
  resale: "$150",
  buyUnder: "$62",
  profit: "+$88",
  risk: "Low",
  toVerify: 2,
} as const;

export function DeepAnalysisHero({ config }: PaywallHeroProps) {
  const { height } = useWindowDimensions();
  const compact = height < COMPACT_BELOW;

  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
  }, []);

  // ── Choreography ─────────────────────────────────────────────────────────
  const stamp = useSharedValue(reduceMotion ? 1 : 0);
  const rows  = useSharedValue(reduceMotion ? 1 : 0);
  const seal  = useSharedValue(reduceMotion ? 1 : 0);
  const glint = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) { stamp.value = 1; rows.value = 1; seal.value = 1; glint.value = 0; return; }
    const ease = Easing.out(Easing.cubic);
    stamp.value = withDelay(120, withSequence(
      withTiming(1.12, { duration: 220, easing: Easing.out(Easing.quad) }),
      withTiming(1,    { duration: 160, easing: Easing.inOut(Easing.quad) }),
    ));
    rows.value = withDelay(300, withTiming(1, { duration: 560, easing: ease }));
    seal.value = withDelay(800, withTiming(1, { duration: 320, easing: ease }));
    glint.value = withDelay(2500, withRepeat(
      withSequence(
        withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 0 }),
        withDelay(9800, withTiming(0, { duration: 0 })),
      ), -1, false,
    ));
  }, [reduceMotion, stamp, rows, seal, glint]);

  const stampStyle = useAnimatedStyle(() => ({
    opacity: interpolate(stamp.value, [0, 0.3, 1.12], [0, 1, 1], "clamp"),
    transform: [{ scale: stamp.value === 0 ? 1.4 : stamp.value }],
  }));
  const sealStyle = useAnimatedStyle(() => ({
    opacity: seal.value,
    transform: [{ translateY: (1 - seal.value) * 6 }],
  }));
  const glintStyle = useAnimatedStyle(() => ({
    opacity: interpolate(glint.value, [0, 0.15, 0.85, 1], [0, 0.9, 0.9, 0]),
    transform: [{ translateX: interpolate(glint.value, [0, 1], [-70, 70]) }],
  }));

  return (
    <View style={s.hero}>
      {/* ── Brand ─────────────────────────────────────────────────────── */}
      <View style={s.brandRow} accessibilityRole="header" accessibilityLabel="FlipStart, Deep Analysis">
        <Spark size={13} />
        <Text style={s.brand} allowFontScaling={false}>FLIPSTART</Text>
        <Spark size={13} />
      </View>
      <View style={s.featureRow}>
        <View style={s.featureRule} />
        <View style={s.featureLabelWrap}>
          <Text style={s.featureLabel} allowFontScaling={false}>DEEP ANALYSIS</Text>
          {!reduceMotion && (
            <Animated.View pointerEvents="none" style={[s.glint, glintStyle]}>
              <Svg width={40} height="100%">
                <Defs>
                  <LinearGradient id="da-glint" x1="0" y1="0" x2="1" y2="0">
                    <Stop offset="0" stopColor={PW.gold} stopOpacity="0" />
                    <Stop offset="0.5" stopColor="#FFF4C8" stopOpacity="0.7" />
                    <Stop offset="1" stopColor={PW.gold} stopOpacity="0" />
                  </LinearGradient>
                </Defs>
                <Rect width="100%" height="100%" fill="url(#da-glint)" />
              </Svg>
            </Animated.View>
          )}
        </View>
        <View style={s.featureRule} />
      </View>
      <Diamond />

      {/* ── Headline ──────────────────────────────────────────────────── */}
      <Text style={[s.headline, compact && s.headlineCompact]}>{config.headline}</Text>
      <Text style={[s.subtitle, compact && s.subtitleCompact]}>{config.subtitle}</Text>

      {/* ── The dossier ───────────────────────────────────────────────── */}
      <View
        style={[s.dossier, compact && s.dossierCompact]}
        accessibilityLabel="Sample Deep Analysis: a strong buy verdict with price logic and risk flags shown, and Confidence Breakdown, Where to Sell, Listing Strategy and Item Evidence available with Pro."
      >
        {/* Letterhead */}
        <View style={s.letterhead}>
          <View style={s.itemBlock}>
            <Text style={s.itemName} numberOfLines={1}>{SAMPLE.item}</Text>
            <Text style={s.itemMeta}>Est. resale <Text style={s.itemMetaGold}>{SAMPLE.resale}</Text></Text>
          </View>
          <View style={s.headRight}>
            <Text style={s.sampleTag} allowFontScaling={false}>SAMPLE</Text>
            <Animated.View style={[s.verdict, stampStyle]}>
              <Text style={s.verdictText} allowFontScaling={false}>{SAMPLE.verdict}</Text>
            </Animated.View>
          </View>
        </View>

        <View style={s.hairline} />

        {/* Three open insights */}
        <InsightRow index={0} progress={rows} icon="verified" title="Why Strong Buy?"
          body={`Strong margin \u00b7 ${SAMPLE.confidence} confidence \u00b7 steady demand`} compact={compact} />
        <InsightRow index={1} progress={rows} icon="show-chart" title="Price Logic"
          body={`Resale ${SAMPLE.resale} \u00b7 Buy under ${SAMPLE.buyUnder} \u00b7 Profit ${SAMPLE.profit}`}
          accent compact={compact} />
        <InsightRow index={2} progress={rows} icon="shield" title="Risk Flags"
          body={`${SAMPLE.risk} risk \u00b7 ${SAMPLE.toVerify} things to verify`} compact={compact} />

        {/* Sealed remainder */}
        <Animated.View style={[s.sealed, sealStyle]}>
          <View style={s.fade} pointerEvents="none">
            <Svg width="100%" height="100%">
              <Defs>
                <LinearGradient id="da-fade" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={PW.card} stopOpacity="0" />
                  <Stop offset="1" stopColor={PW.card} stopOpacity="1" />
                </LinearGradient>
              </Defs>
              <Rect width="100%" height="100%" fill="url(#da-fade)" />
            </Svg>
          </View>
          <View style={s.sealedRow}>
            <View style={s.lock}>
              <MaterialIcons name="lock" size={11} color={PW.forest} />
            </View>
            <Text style={s.sealedTitle} allowFontScaling={false}>MORE INSIGHTS WITH PRO</Text>
          </View>
          <Text style={s.sealedNames} numberOfLines={compact ? 1 : 2}>
            {SEALED_SECTIONS.join("  \u00b7  ")}
          </Text>
        </Animated.View>
      </View>
    </View>
  );
}

function InsightRow({ index, progress, icon, title, body, accent = false, compact }: {
  index: number; progress: SharedValue<number>;
  icon: React.ComponentProps<typeof MaterialIcons>["name"];
  title: string; body: string; accent?: boolean; compact: boolean;
}) {
  const style = useAnimatedStyle(() => {
    const start = index * 0.22;
    const t = interpolate(progress.value, [start, Math.min(1, start + 0.5)], [0, 1], "clamp");
    return { opacity: t, transform: [{ translateY: (1 - t) * 8 }] };
  });
  return (
    <Animated.View style={[s.row, compact && s.rowCompact, style]}>
      <View style={[s.rowIcon, accent && s.rowIconAccent]}>
        <MaterialIcons name={icon} size={14} color={accent ? PW.card : PW.forest} />
      </View>
      <View style={s.rowText}>
        <Text style={s.rowTitle}>{title}</Text>
        <Text style={[s.rowBody, accent && s.rowBodyAccent]} numberOfLines={1}>{body}</Text>
      </View>
    </Animated.View>
  );
}

function Spark({ size }: { size: number }) {
  const h = size / 2;
  return (
    <Svg width={size} height={size}>
      <Path d={`M${h} 0 L${h * 1.19} ${h * 0.81} L${size} ${h} L${h * 1.19} ${h * 1.19} L${h} ${size} L${h * 0.81} ${h * 1.19} L0 ${h} L${h * 0.81} ${h * 0.81} Z`} fill={PW.gold} />
    </Svg>
  );
}

function Diamond() {
  return (
    <Svg width={10} height={10} style={{ marginTop: -2 }}>
      <Path d="M5 0 L10 5 L5 10 L0 5 Z" fill={PW.gold} />
    </Svg>
  );
}

const s = StyleSheet.create({
  hero: { alignItems: "center", gap: 5, paddingHorizontal: 4 },

  brandRow: { flexDirection: "row", alignItems: "center", gap: 9 },
  brand: { fontFamily: FONTS.serif, fontSize: 19, fontWeight: "800", letterSpacing: 5, color: PW.forest },

  featureRow: { flexDirection: "row", alignItems: "center", gap: 10, width: 260 },
  featureRule: { flex: 1, height: 1, backgroundColor: "rgba(196,163,52,0.65)" },
  featureLabelWrap: { overflow: "hidden", paddingHorizontal: 2 },
  featureLabel: { fontFamily: FONTS.serif, fontSize: 11, fontWeight: "800", letterSpacing: 3.2, color: PW.gold },
  glint: { position: "absolute", top: 0, bottom: 0, left: 0, width: 40 },

  headline: {
    fontFamily: FONTS.serif, fontSize: 30, fontWeight: "800",
    color: PW.ink, textAlign: "center", lineHeight: 35, marginTop: 4,
  },
  headlineCompact: { fontSize: 26, lineHeight: 30 },
  subtitle: {
    fontSize: 14.5, color: PW.brown, textAlign: "center", lineHeight: 20,
    paddingHorizontal: 12, maxWidth: 360, fontWeight: "500",
  },
  subtitleCompact: { fontSize: 13.5, lineHeight: 18 },

  dossier: {
    width: "100%", maxWidth: 400, marginTop: 8,
    backgroundColor: PW.card, borderRadius: PW_RADIUS.card,
    borderWidth: 1.25, borderColor: "rgba(33,77,45,0.30)",
    paddingHorizontal: 14, paddingTop: 11, paddingBottom: 0,
    overflow: "hidden",
    shadowColor: PW.forest, shadowOpacity: 0.10, shadowRadius: 12, shadowOffset: { width: 0, height: 5 },
    elevation: 3,
  },
  dossierCompact: { marginTop: 5, paddingTop: 9 },

  letterhead: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 },
  itemBlock: { flex: 1, gap: 1 },
  itemName: { fontFamily: FONTS.serif, fontSize: 15, fontWeight: "800", color: PW.ink },
  itemMeta: { fontSize: 12, color: PW.brown, fontWeight: "600" },
  itemMetaGold: { color: PW.gold, fontWeight: "800" },
  headRight: { alignItems: "flex-end", gap: 4 },
  sampleTag: { fontFamily: FONTS.serif, fontSize: 8, fontWeight: "800", letterSpacing: 1.6, color: PW.brown, opacity: 0.8 },
  verdict: {
    paddingHorizontal: 9, paddingVertical: 3, borderRadius: 4,
    borderWidth: 1.2, borderColor: PW.gold, backgroundColor: PW.goldTint,
  },
  verdictText: { fontFamily: FONTS.serif, fontSize: 10, fontWeight: "800", letterSpacing: 1.4, color: PW.forest },

  hairline: { height: 1, backgroundColor: PW.border, marginTop: 9, marginBottom: 4 },

  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 },
  rowCompact: { paddingVertical: 4.5 },
  rowIcon: {
    width: 26, height: 26, borderRadius: 13,
    borderWidth: 1, borderColor: "rgba(33,77,45,0.35)", backgroundColor: PW.card,
    alignItems: "center", justifyContent: "center",
  },
  rowIconAccent: { backgroundColor: PW.forest, borderColor: PW.forest },
  rowText: { flex: 1, gap: 1 },
  rowTitle: { fontFamily: FONTS.serif, fontSize: 13.5, fontWeight: "800", color: PW.ink },
  rowBody: { fontSize: 12.5, color: PW.brown, fontWeight: "600" },
  rowBodyAccent: { color: PW.forest, fontWeight: "700" },

  sealed: { marginTop: 4, paddingTop: 12, paddingBottom: 11, alignItems: "center", gap: 3 },
  fade: { ...StyleSheet.absoluteFillObject, top: -22 },
  sealedRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  lock: {
    width: 18, height: 18, borderRadius: 9,
    borderWidth: 1, borderColor: PW.gold, backgroundColor: PW.goldTint,
    alignItems: "center", justifyContent: "center",
  },
  sealedTitle: { fontFamily: FONTS.serif, fontSize: 10, fontWeight: "800", letterSpacing: 1.8, color: PW.forest },
  sealedNames: { fontSize: 11.5, color: PW.brown, textAlign: "center", opacity: 0.85, paddingHorizontal: 8 },
});
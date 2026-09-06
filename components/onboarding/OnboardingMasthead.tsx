/**
 * components/onboarding/OnboardingMasthead.tsx
 *
 * The small FlipStart identity that sits above every screen-specific title.
 *
 * ── Why it exists ───────────────────────────────────────────────────────────
 * After Welcome, the brand disappeared and every screen became "back arrow,
 * bar, brown headline". This is the constant that says THIS IS FLIPSTART on
 * the way past — deliberately about a third the weight of Welcome's version,
 * so it frames the title rather than competing with it.
 *
 *        ✦  FLIPSTART  ✦
 *        THRIFT INTELLIGENCE
 *        ─────────────────
 *
 * ── Motion ──────────────────────────────────────────────────────────────────
 * A single fade-and-settle on entrance, ~260ms, then still. No loop, no glint:
 * the user is here to answer three questions, not to watch the header. The
 * shell re-keys it per stage so it plays once per screen. Reanimated's default
 * ReduceMotion.System removes it when the OS asks.
 */
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { FONTS } from "@/constants/typography";
import { Spark } from "@/components/monetization/paywall/PaywallMasthead";
import { PW } from "@/components/monetization/paywall/paywallTheme";

export interface OnboardingMastheadProps {
  /** Tiny tracked line under the wordmark. Omit to show the wordmark alone. */
  line?: string;
}

export function OnboardingMasthead({ line = "THRIFT INTELLIGENCE" }: OnboardingMastheadProps) {
  return (
    <Animated.View
      entering={FadeIn.duration(260)}
      style={s.wrap}
      accessibilityRole="header"
      accessibilityLabel="FlipStart"
    >
      <View style={s.row}>
        <Spark size={9} />
        <Text style={s.word} allowFontScaling={false}>FLIPSTART</Text>
        <Spark size={9} />
      </View>
      {!!line && <Text style={s.line} allowFontScaling={false}>{line}</Text>}
      <View style={s.rule} />
    </Animated.View>
  );
}

const s = StyleSheet.create({
  wrap: { alignItems: "center", gap: 3 },
  row: { flexDirection: "row", alignItems: "center", gap: 7 },
  /** 13/800/tracked-4 — Welcome's wordmark is 19/800/tracked-5. */
  word: { fontFamily: FONTS.serif, fontSize: 13, fontWeight: "800", letterSpacing: 4, color: PW.forest },
  line: { fontFamily: FONTS.serif, fontSize: 7.5, fontWeight: "800", letterSpacing: 2.2, color: PW.brown, opacity: 0.85 },
  /** A short gold hairline, the same rule language as the paywall section heads. */
  rule: { width: 46, height: 1, marginTop: 4, backgroundColor: "rgba(196,163,52,0.7)" },
});
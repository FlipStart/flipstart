/**
 * components/onboarding/WelcomeScreen.tsx
 *
 * Onboarding V2, screen 1. A welcome, not a pitch: the product claims live in
 * the walkthrough that follows.
 *
 *   ┌───────────────────────────────┐
 *   │ ╔═══════════════════════════╗ │  forestDeep panel, solid gold border
 *   │ ║        Welcome to         ║ │  (the Home "Scan Item" card)
 *   │ ║        FlipStart          ║ │
 *   │ ║  ✦ THRIFT & RESALE AI ✦   ║ │
 *   │ ║         ───               ║ │
 *   │ ║  Scan your thrift finds…  ║ │
 *   │ ╚═══════════════════════════╝ │
 *   │  Scan   │  Analyze │ Collect  │  the Home strip under that card
 *   └───────────────────────────────┘
 *            [ Get Started ]
 *    Already have an account? Log in
 *
 * Fits one viewport on every supported iPhone. On a short phone (SE/8) the
 * panel padding and wordmark step down; nothing is hidden.
 */
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { FONTS } from "@/constants/typography";
import { OB, OB_SPACE } from "./onboardingTheme";
import { OnboardingButton, OnboardingTextLink } from "./OnboardingButton";
import { useOnboardingLayout } from "./useOnboardingLayout";

export interface WelcomeScreenProps {
  onGetStarted: () => void;
  /** Omit for a signed-in user: they have nothing to log in to. */
  onLogIn?: () => void;
  /** A one-line notice above the buttons (e.g. a social login that made a new account). */
  notice?: string | null;
}

type IconName = React.ComponentProps<typeof MaterialIcons>["name"];

const STEPS: { icon: IconName; title: string; line: string }[] = [
  { icon: "photo-camera", title: "Scan", line: "Snap a find" },
  { icon: "insights", title: "Analyze", line: "See its value" },
  { icon: "emoji-events", title: "Collect", line: "Earn XP" },
];

export function WelcomeScreen({ onGetStarted, onLogIn, notice }: WelcomeScreenProps) {
  const { compact, insets } = useOnboardingLayout();

  return (
    <View style={[s.root, {
      paddingTop: Math.max(insets.top, 12) + (compact ? 8 : 16),
      paddingBottom: Math.max(insets.bottom, 12) + 6,
    }]}>
      <View style={s.spacer} />

      <Animated.View entering={FadeInDown.duration(320)} style={s.card}>
        <View style={[s.panel, compact && s.panelCompact]}>
          <View
            style={[s.frame, compact && s.frameCompact]}
            accessible
            accessibilityRole="header"
            accessibilityLabel="Welcome to FlipStart. Scan your thrift finds and see what they're worth."
          >
            <Text style={[s.welcome, compact && s.welcomeCompact]} maxFontSizeMultiplier={1.2}>Welcome to</Text>
            <Text style={[s.wordmark, compact && s.wordmarkCompact]} allowFontScaling={false}>FlipStart</Text>
            <Text style={s.tagline} allowFontScaling={false}>{"✦ THRIFT & RESALE AI ✦"}</Text>
            <View style={[s.rule, compact && s.ruleCompact]} />
            <Text style={s.intro} maxFontSizeMultiplier={1.25}>
              Scan your thrift finds and see{"\n"}what they{"’"}re worth.
            </Text>
          </View>
        </View>

        <View style={[s.strip, compact && s.stripCompact]}>
          {STEPS.map((step, i) => (
            <View key={step.title} style={[s.step, i > 0 && s.stepDivided]}
              accessible accessibilityLabel={`${step.title}: ${step.line}`}>
              <View style={s.ring}>
                <MaterialIcons name={step.icon} size={19} color={OB.forest} />
              </View>
              <Text style={s.stepTitle} maxFontSizeMultiplier={1.2}>{step.title}</Text>
              <Text style={s.stepLine} maxFontSizeMultiplier={1.2}>{step.line}</Text>
            </View>
          ))}
        </View>
      </Animated.View>

      <View style={s.spacer} />

      <Animated.View entering={FadeIn.delay(160).duration(280)} style={s.actions}>
        {!!notice && (
          <View style={s.notice} accessibilityLiveRegion="polite">
            <MaterialIcons name="info-outline" size={16} color={OB.forest} />
            <Text style={s.noticeText}>{notice}</Text>
          </View>
        )}
        <OnboardingButton label="Get Started" onPress={onGetStarted} height={56} />
        {onLogIn && <OnboardingTextLink prefix="Already have an account?" action="Log in" onPress={onLogIn} />}
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: OB.background, paddingHorizontal: OB_SPACE.gutter },
  spacer: { flex: 1, minHeight: 8 },

  card: {
    borderRadius: 24, borderWidth: 1, borderColor: OB.border, overflow: "hidden",
    backgroundColor: OB.card,
  },
  panel: { backgroundColor: OB.forestDeep, padding: 12 },
  panelCompact: { padding: 10 },
  /** Solid gold, not dashed — the approved change from the Home card. */
  frame: {
    borderWidth: 1.5, borderColor: OB.gold, borderRadius: 16,
    paddingTop: 34, paddingBottom: 30, paddingHorizontal: 18,
    alignItems: "center",
  },
  frameCompact: { paddingTop: 22, paddingBottom: 20 },

  /** Home's "Welcome back" treatment: italic serif. */
  welcome: { fontFamily: FONTS.serif, fontStyle: "italic", fontWeight: "700", fontSize: 22, lineHeight: 28, color: OB.cream },
  welcomeCompact: { fontSize: 20, lineHeight: 25 },
  wordmark: { fontFamily: FONTS.serif, fontWeight: "800", fontSize: 54, lineHeight: 62, color: OB.cream },
  wordmarkCompact: { fontSize: 46, lineHeight: 53 },
  /** Gold on forestDeep is 6.7:1 — readable here, unlike gold on white. */
  tagline: { marginTop: 2, fontSize: 11, lineHeight: 14, fontWeight: "800", letterSpacing: 2.6, paddingLeft: 2.6, color: OB.gold },
  rule: { width: 44, height: 1, backgroundColor: OB.gold, marginTop: 18, marginBottom: 14 },
  ruleCompact: { marginTop: 12, marginBottom: 10 },
  intro: { fontSize: 16, lineHeight: 23, color: OB.cream, textAlign: "center" },

  strip: { flexDirection: "row", paddingVertical: 18, paddingHorizontal: 8 },
  stripCompact: { paddingVertical: 14 },
  step: { flex: 1, alignItems: "center", gap: 5, paddingHorizontal: 6 },
  stepDivided: { borderLeftWidth: 1, borderLeftColor: OB.border },
  ring: {
    width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: OB.border,
    backgroundColor: OB.card, alignItems: "center", justifyContent: "center",
  },
  stepTitle: { fontFamily: FONTS.serif, fontWeight: "700", fontSize: 16, lineHeight: 20, color: OB.forest },
  stepLine: { fontSize: 12.5, lineHeight: 16, color: OB.ink, textAlign: "center" },

  actions: { gap: 6 },
  notice: {
    flexDirection: "row", alignItems: "flex-start", gap: 8, marginBottom: 6,
    backgroundColor: OB.goldTint, borderRadius: 12, borderWidth: 1, borderColor: OB.gold,
    paddingHorizontal: 12, paddingVertical: 10,
  },
  noticeText: { flex: 1, fontSize: 13.5, lineHeight: 19, color: OB.ink, fontWeight: "600" },
});
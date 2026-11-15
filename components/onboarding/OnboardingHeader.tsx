/**
 * components/onboarding/OnboardingHeader.tsx
 *
 * The onboarding masthead, copied from the live Home and History headers so
 * onboarding reads as the same app it leads into:
 *
 *              FlipStart
 *           ✦ ONBOARDING ✦
 *   ──────────────────────────────────   (full-width hairline)
 *
 * Same numbers as app/(tabs)/index.tsx `headerTitle` / `headerSub` /
 * `headerDivider`: Georgia 28 heavy forest, 10pt heavy tracked gold, the app
 * BORDER hairline edge to edge. The back button sits in the header row where
 * Home keeps its profile button.
 *
 * It owns the top safe area, so a screen never pads for the notch itself.
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { FONTS } from "@/constants/typography";
import { OB } from "./onboardingTheme";

export interface OnboardingHeaderProps {
  /** Omit to hide the back button. */
  onBack?: () => void;
  /** The tracked line under the wordmark. */
  line?: string;
  /** Short phones: a 26pt wordmark instead of 28. */
  compact?: boolean;
}

export function OnboardingHeader({ onBack, line = "ONBOARDING", compact = false }: OnboardingHeaderProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[s.band, { paddingTop: Math.max(insets.top, 12) + 2 }]}>
      <View style={s.row}>
        {onBack && (
          <Pressable
            onPress={onBack}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="Back"
            style={({ pressed }) => [s.back, pressed && { opacity: 0.55 }]}
          >
            <MaterialIcons name="arrow-back-ios-new" size={20} color={OB.forest} />
          </Pressable>
        )}
        <View style={s.lockup} accessibilityRole="header" accessibilityLabel={`FlipStart, ${line.toLowerCase()}`}>
          <Text style={[s.title, compact && s.titleCompact]} allowFontScaling={false}>FlipStart</Text>
          <Text style={s.sub} allowFontScaling={false} importantForAccessibility="no">{`✦ ${line} ✦`}</Text>
        </View>
      </View>
      <View style={s.rule} />
    </View>
  );
}

const s = StyleSheet.create({
  band: { backgroundColor: OB.background },
  row: { minHeight: 56, alignItems: "center", justifyContent: "center", paddingBottom: 8 },
  /** Home's profile-button slot: 44pt target, vertically centred on the lockup. */
  back: {
    position: "absolute", left: 8, top: 0, bottom: 8,
    width: 44, alignItems: "center", justifyContent: "center", zIndex: 2,
  },
  lockup: { alignItems: "center" },
  /** = Home headerTitle. */
  title: { fontFamily: FONTS.serif, fontSize: 28, lineHeight: 33, fontWeight: "800", color: OB.forest },
  titleCompact: { fontSize: 26, lineHeight: 30 },
  /** = Home headerSub. Gold is a brand line here, not information. */
  sub: { fontSize: 10, lineHeight: 13, fontWeight: "800", color: OB.gold, letterSpacing: 2.4, marginTop: 3, paddingLeft: 2.4 },
  /** = Home headerDivider, edge to edge. */
  rule: { height: 1, backgroundColor: OB.border },
});
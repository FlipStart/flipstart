/**
 * components/onboarding/OnboardingButton.tsx
 *
 * The two kinds of action in onboarding.
 *
 * OnboardingButton — the one filled button on a screen. Forest with a gold
 * edge and cream serif label, 54pt. Gives 2% under the finger; never pulses.
 * Disabled is pale grey with grey text so it reads as OFF at a glance — the
 * old muted-forest disabled state still looked tappable.
 *
 * OnboardingTextLink — every secondary action ("Already have an account? Log
 * in"). A full 44pt tap area, ink prefix, forest action. Secondary actions are
 * links, not second buttons, so the primary is never in competition.
 */
import React from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { FONTS } from "@/constants/typography";
import { OB, OB_SPACE } from "./onboardingTheme";

export function OnboardingButton({ label, onPress, disabled = false, height = OB_SPACE.cta }: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  height?: number;
}) {
  const pressed = useSharedValue(0);
  const give = useAnimatedStyle(() => ({ transform: [{ scale: 1 - pressed.value * 0.02 }] }));

  return (
    <Animated.View style={give}>
      <Pressable
        onPress={disabled ? undefined : onPress}
        disabled={disabled}
        onPressIn={() => { if (!disabled) pressed.value = withTiming(1, { duration: 80 }); }}
        onPressOut={() => { pressed.value = withTiming(0, { duration: 140 }); }}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        style={[s.button, { minHeight: height, borderRadius: height / 2 }, disabled && s.disabled]}
      >
        <Text style={[s.label, disabled && s.labelDisabled]} maxFontSizeMultiplier={1.3} numberOfLines={1}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

export function OnboardingTextLink({ prefix, action, onPress, disabled = false }: {
  prefix?: string;
  action: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={prefix ? `${prefix} ${action}` : action}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [s.link, pressed && { opacity: 0.6 }]}
    >
      <Text style={s.linkText} maxFontSizeMultiplier={1.3}>
        {prefix ? `${prefix} ` : ""}<Text style={s.linkAction}>{action}</Text>
      </Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  button: {
    backgroundColor: OB.forest,
    borderWidth: 1, borderColor: OB.gold,
    alignItems: "center", justifyContent: "center",
    paddingHorizontal: 22,
    shadowColor: OB.forestDeep, shadowOpacity: 0.18, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  disabled: {
    backgroundColor: OB.disabledBg, borderColor: OB.disabledBg,
    shadowOpacity: 0, elevation: 0,
  },
  label: { fontFamily: FONTS.serif, fontSize: 17, fontWeight: "700", color: OB.cream, letterSpacing: 0.2 },
  labelDisabled: { color: OB.disabledText },

  link: { minHeight: 44, alignItems: "center", justifyContent: "center", alignSelf: "stretch", paddingHorizontal: 8 },
  linkText: { fontSize: 15, lineHeight: 20, color: OB.ink, textAlign: "center" },
  linkAction: { fontWeight: "700", color: OB.forest },
});
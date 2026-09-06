/**
 * components/onboarding/OptionCard.tsx
 *
 * One answer in a single-select question.
 *
 * Selection is carried by structure: a forest border, the plan card's
 * hairline gold inner rule, and a filled radio with a check — never colour
 * alone. Unselected cards are quiet white so the selected one is obvious
 * without any option looking "better" than another (the experience question
 * depends on that).
 *
 * ~200ms settle on select, once. Reanimated's default ReduceMotion.System
 * respects the OS setting.
 */
import React, { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming, Easing } from "react-native-reanimated";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { FONTS } from "@/constants/typography";
import { PW, PW_RADIUS, PW_SHADOW } from "@/components/monetization/paywall/paywallTheme";

export interface OptionCardProps {
  title: string;
  support?: string;
  selected: boolean;
  onPress: () => void;
  /**
   * Multi-select. Changes the semantics a screen reader announces (checkbox
   * rather than radio) and squares off the mark, so "you may pick several" is
   * visible as well as spoken.
   */
  multi?: boolean;
}

export function OptionCard({ title, support, selected, onPress, multi = false }: OptionCardProps) {
  const on = useSharedValue(selected ? 1 : 0);
  useEffect(() => {
    on.value = withTiming(selected ? 1 : 0, { duration: 200, easing: Easing.out(Easing.quad) });
  }, [selected, on]);
  const checkStyle = useAnimatedStyle(() => ({
    opacity: on.value,
    transform: [{ scale: 0.6 + on.value * 0.4 }],
  }));

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={multi ? "checkbox" : "radio"}
      accessibilityState={multi ? { checked: selected } : { selected }}
      accessibilityLabel={support ? `${title}. ${support}` : title}
      style={({ pressed }) => [s.card, selected && s.cardSelected, pressed && { opacity: 0.92 }]}
    >
      {selected && <View pointerEvents="none" style={s.innerRule} />}

      <View style={[s.radio, multi && s.box, selected && s.radioSelected]}>
        <Animated.View style={checkStyle}>
          <MaterialIcons name="check" size={15} color={PW.cream} />
        </Animated.View>
      </View>

      <View style={s.text}>
        <Text style={[s.title, selected && s.titleSelected]}>{title}</Text>
        {!!support && <Text style={s.support}>{support}</Text>}
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  card: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: PW.card,
    borderRadius: PW_RADIUS.card,
    borderWidth: 1.25, borderColor: PW.border,
    paddingVertical: 13, paddingHorizontal: 14,
    overflow: "hidden",
    ...PW_SHADOW,
  },
  cardSelected: {
    borderColor: PW.forest, borderWidth: 2,
    shadowColor: PW.forest, shadowOpacity: 0.14, shadowRadius: 12, shadowOffset: { width: 0, height: 5 },
    elevation: 4,
  },
  innerRule: {
    position: "absolute", top: 3, left: 3, right: 3, bottom: 3,
    borderRadius: PW_RADIUS.card - 3, borderWidth: 1, borderColor: "rgba(196,163,52,0.45)",
  },

  radio: {
    width: 24, height: 24, borderRadius: 12,
    borderWidth: 1.5, borderColor: PW.border,
    alignItems: "center", justifyContent: "center",
    backgroundColor: PW.parchment,
  },
  /** Square for multi-select: the shape carries the "pick several" affordance. */
  box: { borderRadius: 7 },
  radioSelected: { backgroundColor: PW.forest, borderColor: PW.forest },

  text: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontFamily: FONTS.serif, fontSize: 16, fontWeight: "800", color: PW.ink, lineHeight: 21 },
  titleSelected: { color: PW.forest },
  support: { fontSize: 13, lineHeight: 18, color: PW.brown, fontWeight: "500" },
});
/**
 * components/onboarding/CategoryChip.tsx
 *
 * One category in the multi-select. Unselected: white, hairline border, ink
 * text. Selected: forest fill, a restrained gold ring, cream text, and a check
 * — state carried by fill AND mark, never colour alone.
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { FONTS } from "@/constants/typography";
import { PW, PW_RADIUS } from "@/components/monetization/paywall/paywallTheme";

export interface CategoryChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
}

export function CategoryChip({ label, selected, onPress }: CategoryChipProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      style={({ pressed }) => [s.chip, selected && s.chipSelected, pressed && { opacity: 0.9 }]}
    >
      {selected && (
        <View style={s.check}>
          <MaterialIcons name="check" size={14} color={PW.cream} />
        </View>
      )}
      <Text style={[s.label, selected && s.labelSelected]} allowFontScaling={false}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  chip: {
    flexDirection: "row", alignItems: "center", gap: 7,
    minHeight: 46,
    paddingHorizontal: 17, paddingVertical: 11,
    borderRadius: PW_RADIUS.pill,
    backgroundColor: PW.card,
    borderWidth: 1.25, borderColor: PW.border,
  },
  /** Forest fill with a gold ring: the selected plan card's "expensive" pairing, at chip scale. */
  chipSelected: { backgroundColor: PW.forest, borderColor: PW.gold },
  check: { marginLeft: -3 },
  label: { fontFamily: FONTS.serif, fontSize: 14.5, fontWeight: "800", color: PW.ink },
  labelSelected: { color: PW.cream },
});
/**
 * components/monetization/paywall/PaywallFreeButton.tsx
 *
 * The explicit Free option: the way out of a paywall that has no close X.
 *
 * Lifted out of ProPaywallModal unchanged, so the shared layout and the
 * onboarding offer draw the SAME button rather than two that drift apart:
 * a card-white pill, forest outline and text, a hairline gold rule just
 * inside the border. A real button, clearly second to the forest CTA above
 * it, and never a link someone has to hunt for.
 *
 * It decides nothing. The caller owns what "free" means; this only refuses a
 * press while a transaction is live.
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { FONTS } from "@/constants/typography";
import { PW, PW_RADIUS } from "./paywallTheme";

export interface PaywallFreeButtonProps {
  label: string;
  onPress: () => void;
  /** True while a purchase or restore is in flight. */
  busy: boolean;
  /** Button height. 50 is the shared paywall's; the onboarding offer asks for more. */
  minHeight?: number;
}

export function PaywallFreeButton({ label, onPress, busy, minHeight = 50 }: PaywallFreeButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: busy }}
      style={({ pressed }) => [s.btn, { minHeight }, busy && { opacity: 0.45 }, pressed && !busy && { opacity: 0.85 }]}
    >
      <View pointerEvents="none" style={s.trim} />
      <Text style={s.text} allowFontScaling={false}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  /** Outlined, card white, forest text: clearly second to the forest CTA above. */
  btn: {
    backgroundColor: PW.card,
    borderRadius: PW_RADIUS.pill,
    borderWidth: 1.6,
    borderColor: PW.forest,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    overflow: "hidden",
  },
  trim: {
    position: "absolute", top: 3, left: 3, right: 3, bottom: 3,
    borderRadius: PW_RADIUS.pill - 3, borderWidth: 1, borderColor: "rgba(196,163,52,0.45)",
  },
  text: { fontFamily: FONTS.serif, fontSize: 15.5, fontWeight: "800", color: PW.forest },
});
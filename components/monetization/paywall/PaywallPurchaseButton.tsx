/**
 * components/monetization/paywall/PaywallPurchaseButton.tsx
 *
 * The one control on this screen that can charge someone.
 *
 * ── Appearance and behaviour come from the same predicate ───────────────────
 * `disabled` is computed by `canPurchase()` in lib/paywallMachine.ts, and the
 * press handler is short-circuited by the same flag. A button that looks
 * disabled but still fires on a fast double tap is how duplicate charges
 * happen; deriving both from one boolean makes that shape impossible.
 *
 * ── Loading does not blank the screen ───────────────────────────────────────
 * The button keeps its size and its place and swaps its label for a spinner.
 * Everything around it stays visible. A full-screen overlay during a purchase
 * hides the plan the user just chose at the exact moment they are being asked
 * to confirm it in Apple's sheet.
 *
 * ── Style ───────────────────────────────────────────────────────────────────
 * Solid forest green, radius 50, cream serif — the PRIMARY button vocabulary
 * already used by "Got it" in the scan sheet. At full width and 54pt tall the
 * pill reads as the large rounded rectangle the brief asks for, while still
 * being the button FlipStart already uses. No gradient: the app does not use
 * one anywhere.
 */
import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { FONTS } from "@/constants/typography";
import { PW, PW_RADIUS } from "./paywallTheme";

export interface PaywallPurchaseButtonProps {
  label: string;
  onPress: () => void;
  /** Spinner instead of the label. Implies disabled. */
  busy?: boolean;
  /** Blocked for any other reason — unresolved identity, products missing. */
  disabled?: boolean;
  /** Replaces the label while blocked, e.g. "Checking your account…". */
  blockedLabel?: string | null;
}

export function PaywallPurchaseButton({
  label,
  onPress,
  busy = false,
  disabled = false,
  blockedLabel = null,
}: PaywallPurchaseButtonProps) {
  const inert = busy || disabled;
  const shown = busy ? null : disabled && blockedLabel ? blockedLabel : label;

  return (
    <Pressable
      onPress={inert ? undefined : onPress}
      disabled={inert}
      accessibilityRole="button"
      accessibilityLabel={shown ?? "Working"}
      accessibilityState={{ disabled: inert, busy }}
      style={({ pressed }) => [s.btn, inert && s.btnInert, pressed && !inert && s.btnPressed]}
    >
      {/*
       * Gold hairline inset inside the green.
       *
       * The "restrained gold bordering" from the brief. Inside rather than
       * outside so the button's silhouette stays a clean pill and the metal
       * reads as an inlay on the surface.
       */}
      <View pointerEvents="none" style={s.inlay} />

      {busy ? (
        <ActivityIndicator size="small" color={PW.cream} />
      ) : (
        <Text style={s.label} numberOfLines={1}>
          {shown}
        </Text>
      )}
    </Pressable>
  );
}

const s = StyleSheet.create({
  btn: {
    backgroundColor: PW.forest,
    borderRadius: PW_RADIUS.pill,
    minHeight: 54,
    paddingVertical: 15,
    paddingHorizontal: 24,
    alignItems: "center",
    justifyContent: "center",
    // No shadow: the app's primary button vocabulary has none, and a raised
    // green pill on parchment immediately reads as a different app.
  },
  /**
   * Dimmed, not greyed.
   *
   * Swapping to a grey fill would introduce the first cool colour on the screen.
   * Opacity keeps it recognisably the same button, temporarily unavailable.
   */
  btnInert: { opacity: 0.45 },
  btnPressed: { opacity: 0.86 },

  inlay: {
    position: "absolute",
    top: 3.5,
    left: 3.5,
    right: 3.5,
    bottom: 3.5,
    borderRadius: PW_RADIUS.pill,
    borderWidth: 1,
    borderColor: "rgba(196,163,52,0.45)",
  },

  label: {
    fontFamily: FONTS.serif,
    fontSize: 16.5,
    fontWeight: "800",
    color: PW.cream,
    letterSpacing: 0.2,
  },
});
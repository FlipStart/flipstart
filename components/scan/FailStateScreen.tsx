/**
 * components/scan/FailStateScreen.tsx
 *
 * The one screen a scan ends on when it can't show a normal result (Phase 5
 * of the scan-failure plan). Replaces the old safari-themed "expedition log"
 * screen and its seven guessed types.
 *
 * ── Look ────────────────────────────────────────────────────────────────────
 * The paywall's vintage green-and-white catalogue style, built from the
 * paywall's own pieces so the two read as one app: the engraved FLIPSTART
 * masthead (PaywallMasthead), the tapered gold rule (OrnamentRule) and the
 * paywall palette (paywallTheme.ts). Gold draws rules, rings and sparks only;
 * every word is forest, ink or brown, for contrast.
 *
 * ── Content ─────────────────────────────────────────────────────────────────
 * Every word and button comes from failContent() (failScreenContent.ts), which
 * is tested on its own. This file decides layout only.
 */
import React from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, FadeInDown, FadeInUp } from "react-native-reanimated";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FONTS } from "@/constants/typography";
import { PW, PW_RADIUS, PW_SHADOW } from "@/components/monetization/paywall/paywallTheme";
import { PaywallMasthead, Spark } from "@/components/monetization/paywall/PaywallMasthead";
import { OrnamentRule } from "@/components/monetization/paywall/Ornament";
import type { FailPaywall, FailScreen, ServerCause } from "@/lib/scanAttempt";
import { CHARGE_NOTE, failContent, type ChargeState, type FailAction, type FailButton } from "./failScreenContent";

export type { FailScreen, ServerCause } from "@/lib/scanAttempt";
export type { ChargeState, FailAction } from "./failScreenContent";

export interface FailStateProps {
  screen: FailScreen;
  /** Which problem on our side, for the "server" screen. */
  cause?: ServerCause;
  /** Which Pro feature, for the "pro_feature" screen. */
  paywall?: FailPaywall;
  /** The front photo, shown on the result-based screens. */
  photoUri?: string | null;
  /** What the AI could tell (the confidence reason), on the result-based screens. */
  seen?: string | null;
  /** blurry / too_dark / too_far / glare / cut_off, on the photo-problem screen. */
  photoProblems?: readonly string[];
  charge: ChargeState;
  inHunt: boolean;
  /** Out of scans only: whose scans ran out, when known. */
  plan?: "free" | "pro" | null;
  /** The action whose request is in flight; its button shows a spinner and the others wait. */
  busy?: FailAction | null;
  onAction: (action: FailAction) => void;
}

export function FailStateScreen(p: FailStateProps) {
  const insets = useSafeAreaInsets();
  const c = failContent({
    screen: p.screen, cause: p.cause, paywall: p.paywall,
    photoProblems: p.photoProblems, charge: p.charge, inHunt: p.inHunt, plan: p.plan,
  });
  const press = (a: FailAction) => { if (!p.busy) p.onAction(a); };
  const seen = (p.seen ?? "").trim();

  return (
    <View style={s.root} testID={`fail-screen-${p.screen}`}>
      <ScrollView
        contentContainerStyle={[s.scroll, { paddingTop: insets.top + 28, paddingBottom: insets.bottom + 28 }]}
        bounces={false}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View entering={FadeIn.duration(320)}>
          <PaywallMasthead
            feature={c.feature}
            accessibilityLabel={`FlipStart, ${c.feature.toLowerCase()}`}
            glint={false}
          />
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(60).duration(320)} style={s.emblemWrap}>
          <Emblem icon={c.icon} />
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(110).duration(320)} style={s.textBlock}>
          <Text style={s.title} accessibilityRole="header">{c.title}</Text>
          <Text style={s.body}>{c.body}</Text>
        </Animated.View>

        {(c.showPhoto && p.photoUri) || c.tip ? (
          <Animated.View entering={FadeInDown.delay(160).duration(320)} style={s.card}>
            {c.showPhoto && p.photoUri ? (
              <View style={s.seenRow}>
                <View style={s.thumbFrame}>
                  <Image source={{ uri: p.photoUri }} style={s.thumb} accessibilityIgnoresInvertColors />
                </View>
                <View style={s.seenText}>
                  {c.photoCaption === "photo_only" ? (
                    <Text style={s.eyebrow} allowFontScaling={false}>YOUR PHOTO</Text>
                  ) : (
                    <>
                      <Text style={s.eyebrow} allowFontScaling={false}>WHAT WE COULD TELL</Text>
                      <Text style={s.seenBody}>{seen || "Not enough to go on."}</Text>
                    </>
                  )}
                </View>
              </View>
            ) : null}
            {c.showPhoto && p.photoUri && c.tip ? <View style={s.cardRule} /> : null}
            {c.tip ? (
              <View style={s.tipRow}>
                <MaterialIcons name="lightbulb-outline" size={16} color={PW.forest} style={s.tipIcon} />
                <Text style={s.tipText}>{c.tip}</Text>
              </View>
            ) : null}
          </Animated.View>
        ) : null}

        <Animated.View entering={FadeIn.delay(200).duration(300)} style={s.rule}>
          <OrnamentRule width={156} />
        </Animated.View>

        <Animated.View entering={FadeInUp.delay(230).duration(320)} style={s.actions}>
          <PrimaryButton button={c.primary} busy={p.busy === c.primary.action} disabled={!!p.busy} onPress={press} />
          {c.secondary ? (
            <SecondaryButton button={c.secondary} busy={p.busy === c.secondary.action} disabled={!!p.busy} onPress={press} />
          ) : null}
          {c.link ? (
            <Pressable
              onPress={() => press(c.link!.action)}
              disabled={!!p.busy}
              hitSlop={10}
              accessibilityRole="button"
              style={({ pressed }) => [s.linkBtn, pressed && { opacity: 0.6 }]}
            >
              <Text style={s.linkText}>{c.link.label}</Text>
            </Pressable>
          ) : null}
        </Animated.View>

        {c.chargeNote ? (
          <Animated.View entering={FadeIn.delay(300).duration(300)} style={s.chargeRow}>
            <MaterialIcons
              name={c.chargeNote === CHARGE_NOTE.not_used ? "check-circle-outline" : "info-outline"}
              size={13}
              color={PW.forest}
            />
            <Text style={s.chargeText}>{c.chargeNote}</Text>
          </Animated.View>
        ) : null}
      </ScrollView>
    </View>
  );
}

/** A gold-ringed seal with the screen's icon — the paywall's medallion, small. */
function Emblem({ icon }: { icon: React.ComponentProps<typeof MaterialIcons>["name"] }) {
  return (
    <View style={s.emblemOuter} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={s.emblemInner}>
        <MaterialIcons name={icon} size={38} color={PW.forest} />
      </View>
    </View>
  );
}

function PrimaryButton({ button, busy, disabled, onPress }: {
  button: FailButton; busy: boolean; disabled: boolean; onPress: (a: FailAction) => void;
}) {
  return (
    <Pressable
      onPress={() => onPress(button.action)}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={button.label}
      accessibilityState={{ disabled, busy }}
      style={({ pressed }) => [s.primary, pressed && !disabled && s.pressed, disabled && !busy && s.dimmed]}
    >
      {/* Hairline gold trim inside the edge, as on the paywall's purchase button. */}
      <View pointerEvents="none" style={s.primaryTrim} />
      {busy ? (
        <ActivityIndicator color={PW.cream} />
      ) : (
        <View style={s.primaryRow}>
          <Spark size={9} />
          <Text style={s.primaryText} numberOfLines={1}>{button.label}</Text>
          <Spark size={9} />
        </View>
      )}
    </Pressable>
  );
}

function SecondaryButton({ button, busy, disabled, onPress }: {
  button: FailButton; busy: boolean; disabled: boolean; onPress: (a: FailAction) => void;
}) {
  return (
    <Pressable
      onPress={() => onPress(button.action)}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={button.label}
      accessibilityState={{ disabled, busy }}
      style={({ pressed }) => [s.secondary, pressed && !disabled && s.pressedSoft, disabled && !busy && s.dimmed]}
    >
      {busy ? <ActivityIndicator color={PW.forest} /> : (
        <Text style={s.secondaryText} numberOfLines={1}>{button.label}</Text>
      )}
    </Pressable>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: PW.parchment },
  scroll: { flexGrow: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: 26 },

  emblemWrap: { marginTop: 26, marginBottom: 20 },
  emblemOuter: {
    width: 92, height: 92, borderRadius: PW_RADIUS.emblem,
    borderWidth: 1.5, borderColor: PW.gold, backgroundColor: PW.goldTint,
    alignItems: "center", justifyContent: "center", ...PW_SHADOW,
  },
  emblemInner: {
    width: 78, height: 78, borderRadius: PW_RADIUS.emblem,
    borderWidth: 1, borderColor: "rgba(196,163,52,0.55)", backgroundColor: PW.card,
    alignItems: "center", justifyContent: "center",
  },

  textBlock: { alignItems: "center", gap: 10, marginBottom: 20, maxWidth: 340 },
  title: {
    fontFamily: FONTS.serif, fontSize: 24, fontWeight: "700", lineHeight: 30,
    color: PW.ink, textAlign: "center",
  },
  body: {
    fontFamily: FONTS.serif, fontSize: 15, lineHeight: 22,
    color: PW.brown, textAlign: "center",
  },

  card: {
    width: "100%", maxWidth: 380, backgroundColor: PW.card,
    borderRadius: PW_RADIUS.card, borderWidth: 1, borderColor: PW.border,
    paddingHorizontal: 14, paddingVertical: 13, marginBottom: 18, ...PW_SHADOW,
  },
  seenRow: { flexDirection: "row", alignItems: "center", gap: 13 },
  thumbFrame: {
    width: 64, height: 64, borderRadius: 10, padding: 2,
    borderWidth: 1, borderColor: "rgba(196,163,52,0.7)", backgroundColor: PW.parchment,
  },
  thumb: { flex: 1, borderRadius: 8, backgroundColor: PW.goldTint },
  seenText: { flex: 1, minWidth: 0, gap: 4 },
  eyebrow: { fontSize: 10.5, fontWeight: "800", letterSpacing: 1.6, color: PW.forest },
  seenBody: { fontFamily: FONTS.serif, fontSize: 14.5, lineHeight: 20, color: PW.ink },
  cardRule: { height: 1, backgroundColor: PW.border, marginVertical: 12 },
  tipRow: { flexDirection: "row", alignItems: "flex-start", gap: 9 },
  tipIcon: { marginTop: 2 },
  tipText: { flex: 1, minWidth: 0, fontFamily: FONTS.serif, fontSize: 14, lineHeight: 20, color: PW.brown },

  rule: { marginBottom: 20 },

  actions: { width: "100%", maxWidth: 380, gap: 11, alignItems: "center" },
  primary: {
    width: "100%", minHeight: 54, borderRadius: PW_RADIUS.pill, backgroundColor: PW.forest,
    alignItems: "center", justifyContent: "center", paddingHorizontal: 22, overflow: "hidden",
    shadowColor: PW.forestDeep, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.22, shadowRadius: 6, elevation: 4,
  },
  primaryTrim: {
    position: "absolute", top: 3, left: 3, right: 3, bottom: 3,
    borderRadius: PW_RADIUS.pill, borderWidth: 1, borderColor: "rgba(196,163,52,0.55)",
  },
  primaryRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  primaryText: { fontFamily: FONTS.serif, fontSize: 16.5, fontWeight: "700", color: PW.cream, letterSpacing: 0.2 },
  secondary: {
    width: "100%", minHeight: 50, borderRadius: PW_RADIUS.pill, backgroundColor: PW.parchment,
    borderWidth: 1.5, borderColor: PW.border, alignItems: "center", justifyContent: "center", paddingHorizontal: 22,
  },
  secondaryText: { fontFamily: FONTS.serif, fontSize: 15.5, fontWeight: "700", color: PW.forest },
  pressed: { transform: [{ scale: 0.98 }], opacity: 0.92 },
  pressedSoft: { backgroundColor: PW.cardSelected },
  dimmed: { opacity: 0.55 },
  linkBtn: { paddingVertical: 6, paddingHorizontal: 12 },
  linkText: {
    fontFamily: FONTS.serif, fontSize: 14, color: PW.brown,
    textDecorationLine: "underline", textDecorationColor: PW.border,
  },

  chargeRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 18 },
  chargeText: { fontSize: 12.5, fontWeight: "600", color: PW.brown, letterSpacing: 0.1 },
});
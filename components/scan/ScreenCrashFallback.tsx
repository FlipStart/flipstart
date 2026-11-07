/**
 * components/scan/ScreenCrashFallback.tsx
 *
 * Shown instead of the results screen or the Hunt item screen when either
 * crashes (Phase 7 of the scan-failure plan). Says exactly what broke — never
 * "something went wrong" — using describeScreenCrash() (lib/screenCrash.ts),
 * shows whatever of the scan can still be read, and offers a way out.
 *
 * Same vintage green-and-white look as the scan fail screens: the paywall's
 * masthead, ornament rule and palette.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FONTS } from "@/constants/typography";
import { PW, PW_RADIUS, PW_SHADOW } from "@/components/monetization/paywall/paywallTheme";
import { PaywallMasthead, Spark } from "@/components/monetization/paywall/PaywallMasthead";
import { OrnamentRule } from "@/components/monetization/paywall/Ornament";
import { describeScreenCrash, type CrashScreen } from "@/lib/screenCrash";
import { logEvent } from "@/lib/analytics";

export interface ScreenCrashFallbackProps {
  screen: CrashScreen;
  error: unknown;
  /** The scan the screen was showing, if it can be found. */
  scan: unknown;
  /** Re-draw the screen (expo-router's retry). */
  onRetry: () => Promise<void> | void;
  onBack: () => void;
  backLabel: string;
  /** The scan was just run and charged (results, active Hunt item) — not a saved item being reopened. */
  justScanned: boolean;
}

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

export function ScreenCrashFallback(p: ScreenCrashFallbackProps) {
  const insets = useSafeAreaInsets();
  const c = useMemo(() => describeScreenCrash(p.screen, p.error, p.scan), [p.screen, p.error, p.scan]);
  const [retrying, setRetrying] = useState(false);

  // One event per crash shown, so the dashboard can rank it with the fail screens.
  const logged = useRef(false);
  useEffect(() => {
    if (logged.current) return;
    logged.current = true;
    console.error(`[crash:${p.screen}] ${c.kind} — ${c.technical}`);
    try {
      logEvent("screen_crashed", {
        screen: p.screen, kind: c.kind, fields: c.fields.slice(0, 6),
        error: c.technical.slice(0, 160),
      });
    } catch { /* never block the fallback */ }
  }, [p.screen, c]);

  const retry = async () => {
    if (retrying) return;
    setRetrying(true);
    try { await p.onRetry(); } finally { setRetrying(false); }
  };

  // Redraws the screen from the result already on the phone: no new scan, no charge.
  const reloadLabel = p.screen === "results" ? "Reload results" : "Reload item";
  const sv = c.salvage;
  const range = sv && sv.low !== null && sv.high !== null ? `${money(sv.low)}–${money(sv.high)}` : null;

  return (
    <View style={s.root} testID={`screen-crash-${p.screen}`}>
      <ScrollView
        contentContainerStyle={[s.scroll, { paddingTop: insets.top + 28, paddingBottom: insets.bottom + 28 }]}
        bounces={false}
        showsVerticalScrollIndicator={false}
      >
        <PaywallMasthead feature="SCREEN ERROR" accessibilityLabel="FlipStart, screen error" glint={false} />

        <View style={s.emblemWrap}>
          <View style={s.emblemOuter} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <View style={s.emblemInner}>
              <MaterialIcons name="report-problem" size={36} color={PW.forest} />
            </View>
          </View>
        </View>

        <View style={s.textBlock}>
          <Text style={s.title} accessibilityRole="header">{c.title}</Text>
          <Text style={s.body}>{c.body}</Text>
        </View>

        <View style={s.card}>
          <Text style={s.eyebrow} allowFontScaling={false}>WHAT WENT WRONG</Text>
          {c.problems.map((line, i) => (
            <View key={i} style={s.problemRow}>
              <Text style={s.bullet}>•</Text>
              <Text style={[s.problemText, c.kind === "unexpected" && s.techText]} selectable={c.kind === "unexpected"}>{line}</Text>
            </View>
          ))}
          {sv ? (
            <>
              <View style={s.cardRule} />
              <Text style={s.eyebrow} allowFontScaling={false}>WHAT WE CAN STILL SHOW</Text>
              {sv.itemName ? <Text style={s.salvageName}>{sv.itemName}</Text> : null}
              {sv.brand ? <Text style={s.salvageLine}>Brand: {sv.brand}</Text> : null}
              {sv.value !== null ? <Text style={s.salvageLine}>Estimated value: {money(sv.value)}</Text> : null}
              {range ? <Text style={s.salvageLine}>Resale range: {range}</Text> : null}
            </>
          ) : null}
          {c.kind !== "unexpected" ? (
            // For an unrecognised error the message above already IS the detail.
            <>
              <View style={s.cardRule} />
              <Text style={s.techLabel} allowFontScaling={false}>TECHNICAL DETAIL</Text>
              <Text style={s.techText} selectable>{c.technical}</Text>
            </>
          ) : null}
        </View>

        <View style={s.rule}><OrnamentRule width={156} /></View>

        <View style={s.actions}>
          <Pressable
            onPress={retry}
            disabled={retrying}
            accessibilityRole="button"
            accessibilityLabel={reloadLabel}
            style={({ pressed }) => [s.primary, pressed && s.pressed]}
          >
            <View pointerEvents="none" style={s.primaryTrim} />
            {retrying ? <ActivityIndicator color={PW.cream} /> : (
              <View style={s.primaryRow}>
                <Spark size={9} />
                <Text style={s.primaryText}>{reloadLabel}</Text>
                <Spark size={9} />
              </View>
            )}
          </Pressable>
          <Pressable
            onPress={p.onBack}
            accessibilityRole="button"
            accessibilityLabel={p.backLabel}
            style={({ pressed }) => [s.secondary, pressed && s.pressedSoft]}
          >
            <Text style={s.secondaryText}>{p.backLabel}</Text>
          </Pressable>
        </View>

        {p.justScanned && c.kind !== "missing_scan" ? (
          <View style={s.chargeRow}>
            <MaterialIcons name="info-outline" size={13} color={PW.forest} />
            <Text style={s.chargeText}>This scan was used — it ran; only showing it failed</Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: PW.parchment },
  scroll: { flexGrow: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: 24 },
  emblemWrap: { marginTop: 22, marginBottom: 18 },
  emblemOuter: {
    width: 86, height: 86, borderRadius: PW_RADIUS.emblem, borderWidth: 1.5, borderColor: PW.gold,
    backgroundColor: PW.goldTint, alignItems: "center", justifyContent: "center", ...PW_SHADOW,
  },
  emblemInner: {
    width: 72, height: 72, borderRadius: PW_RADIUS.emblem, borderWidth: 1, borderColor: "rgba(196,163,52,0.55)",
    backgroundColor: PW.card, alignItems: "center", justifyContent: "center",
  },
  textBlock: { alignItems: "center", gap: 10, marginBottom: 18, maxWidth: 350 },
  title: { fontFamily: FONTS.serif, fontSize: 23, fontWeight: "700", lineHeight: 29, color: PW.ink, textAlign: "center" },
  body: { fontFamily: FONTS.serif, fontSize: 15, lineHeight: 22, color: PW.brown, textAlign: "center" },
  card: {
    width: "100%", maxWidth: 390, backgroundColor: PW.card, borderRadius: PW_RADIUS.card,
    borderWidth: 1, borderColor: PW.border, paddingHorizontal: 15, paddingVertical: 14, marginBottom: 18, ...PW_SHADOW,
  },
  eyebrow: { fontSize: 10.5, fontWeight: "800", letterSpacing: 1.6, color: PW.forest, marginBottom: 6 },
  problemRow: { flexDirection: "row", gap: 7, marginBottom: 3 },
  bullet: { fontFamily: FONTS.serif, fontSize: 14.5, lineHeight: 20, color: PW.forest },
  problemText: { flex: 1, minWidth: 0, fontFamily: FONTS.serif, fontSize: 14.5, lineHeight: 20, color: PW.ink },
  cardRule: { height: 1, backgroundColor: PW.border, marginVertical: 12 },
  salvageName: { fontFamily: FONTS.serif, fontSize: 15.5, fontWeight: "700", color: PW.ink, marginBottom: 3 },
  salvageLine: { fontFamily: FONTS.serif, fontSize: 14, lineHeight: 20, color: PW.brown },
  techLabel: { fontSize: 9.5, fontWeight: "800", letterSpacing: 1.4, color: PW.brown, marginBottom: 4, opacity: 0.8 },
  techText: { fontFamily: "Courier", fontSize: 11.5, lineHeight: 16, color: PW.brown },
  rule: { marginBottom: 18 },
  actions: { width: "100%", maxWidth: 390, gap: 11, alignItems: "center" },
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
  chargeRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 18 },
  chargeText: { fontSize: 12.5, fontWeight: "600", color: PW.brown, letterSpacing: 0.1 },
});
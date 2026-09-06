/**
 * components/ForceUpdateGate.tsx
 *
 * Blocks the app when the installed build is below the server minimum.
 *
 * ── It renders nothing until it is sure ─────────────────────────────────────
 * The default state is "allowed". The check runs in the background and the
 * children render immediately, so a slow or failed lookup never delays launch
 * and never shows a flash of a blocking screen. Only a definite answer swaps
 * the tree.
 *
 * ── Re-checks on foreground ─────────────────────────────────────────────────
 * A user who leaves the app open for a week would otherwise never see the
 * gate. AppState brings it back to 'active' and we ask again — cheap, one row.
 *
 * ── Deliberately not dismissible, and deliberately not a trap ───────────────
 * There is no close control: the point is that this build must not continue.
 * But the user can always leave via the home button, and if no store URL is
 * configured the copy still tells them what to do rather than showing a button
 * that goes nowhere.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { FONTS } from "@/constants/typography";
import { PW } from "@/components/monetization/paywall/paywallTheme";
import { checkForceUpdate, installedVersion, type UpdateGate } from "@/lib/forceUpdate";

export function ForceUpdateGate({ children }: { children: React.ReactNode }) {
  const [gate, setGate] = useState<UpdateGate | null>(null);
  const insets = useSafeAreaInsets();
  const checking = useRef(false);

  const run = useCallback(() => {
    if (checking.current) return;
    checking.current = true;
    checkForceUpdate()
      .then(setGate)
      .catch(() => {})                 // checkForceUpdate never rejects; belt and braces
      .finally(() => { checking.current = false; });
  }, []);

  useEffect(() => {
    run();
    const sub = AppState.addEventListener("change", s => { if (s === "active") run(); });
    return () => sub.remove();
  }, [run]);

  // Unknown or allowed: the app runs. This is the path taken on every error.
  if (!gate?.required) return <>{children}</>;

  const openStore = () => {
    if (gate.storeUrl) Linking.openURL(gate.storeUrl).catch(() => {});
  };

  return (
    <View style={[s.root, { paddingTop: insets.top + 24, paddingBottom: Math.max(insets.bottom, 16) + 24 }]}>
      <View style={s.body}>
        <View style={s.seal}>
          <MaterialIcons name="system-update" size={30} color={PW.forest} />
        </View>

        <Text style={s.eyebrow} allowFontScaling={false}>FLIPSTART</Text>
        <Text style={s.title} accessibilityRole="header">Update required</Text>

        <Text style={s.text}>
          {gate.message ??
            "This version of FlipStart is out of date and can no longer connect. Update to the latest version to keep scanning."}
        </Text>

        {gate.storeUrl ? (
          <Pressable
            onPress={openStore}
            accessibilityRole="button"
            accessibilityLabel={Platform.OS === "android" ? "Update on Google Play" : "Update on the App Store"}
            style={({ pressed }) => [s.btn, pressed && { opacity: 0.86 }]}
          >
            <Text style={s.btnText}>
              {Platform.OS === "android" ? "Update on Google Play" : "Update on the App Store"}
            </Text>
          </Pressable>
        ) : (
          // No URL configured: say what to do rather than offer a dead button.
          <Text style={s.fallback}>
            {Platform.OS === "android"
              ? "Open Google Play and update FlipStart."
              : "Open the App Store and update FlipStart."}
          </Text>
        )}

        <Text style={s.version}>
          Installed {installedVersion() ?? "unknown"}
          {gate.minVersion ? ` · requires ${gate.minVersion}` : ""}
        </Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: PW.parchment, paddingHorizontal: 28, justifyContent: "center" },
  body: { alignItems: "center", gap: 10 },
  seal: {
    width: 60, height: 60, borderRadius: 30, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(33,77,45,0.07)", borderWidth: 1, borderColor: "rgba(33,77,45,0.22)",
    marginBottom: 4,
  },
  eyebrow: { fontFamily: FONTS.serif, fontSize: 10, fontWeight: "800", letterSpacing: 2.4, color: PW.brown },
  title: { fontFamily: FONTS.serif, fontSize: 26, fontWeight: "800", color: PW.forest, textAlign: "center", lineHeight: 32 },
  text: { fontSize: 15, lineHeight: 21, color: PW.brown, textAlign: "center", fontWeight: "500", paddingHorizontal: 4 },
  btn: {
    marginTop: 10, alignSelf: "stretch", minHeight: 54, borderRadius: 50,
    backgroundColor: PW.forest, alignItems: "center", justifyContent: "center", paddingHorizontal: 20,
  },
  btnText: { fontFamily: FONTS.serif, fontSize: 17, fontWeight: "800", color: PW.cream },
  fallback: { marginTop: 10, fontSize: 14, lineHeight: 20, color: PW.ink, textAlign: "center", fontWeight: "600" },
  version: { marginTop: 14, fontSize: 11.5, color: PW.brown, textAlign: "center" },
});
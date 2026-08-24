/**
 * components/monetization/paywall/PaywallFooter.tsx
 *
 * Everything below the CTA: reassurance, Restore, the optional Scan Store
 * route, and the subscription disclosure.
 *
 * ── Only claims that are true ───────────────────────────────────────────────
 * "Secure purchase with the App Store" and "Cancel anytime in your Apple
 * account" are both literally accurate — Apple takes the payment, and an
 * auto-renewable subscription can be cancelled from Apple's own settings at any
 * time. There is no money-back guarantee and no risk-free claim, because
 * neither is true and both are the kind of thing that turns a paywall into a
 * refund queue.
 *
 * ── The legal block is short on purpose ─────────────────────────────────────
 * Apple's own sheet shows the full terms before anything is charged. Restating
 * them at length here buries the two facts a person actually needs: what it
 * costs, and that it renews. Links go to the SAME two URLs already used in
 * Settings, not to new pages invented for this screen.
 */
import React from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { FONTS } from "@/constants/typography";
import { PW } from "./paywallTheme";

/** Verbatim from app/(tabs)/settings.tsx. Do not invent alternatives. */
const PRIVACY_URL = "https://flipstartapp.com/privacy";
const TERMS_URL = "https://flipstartapp.com/terms";

export interface PaywallFooterProps {
  /** Built from the SELECTED plan's live store price. Never hardcoded. */
  disclosure: string;
  onRestore: () => void;
  restoreBusy: boolean;
  /** Blocked while any other operation is in flight. */
  restoreDisabled: boolean;
  /** Source-controlled. True only for a scan-limit paywall. */
  showScanStore: boolean;
  onScanStore: () => void;
}

export function PaywallFooter({
  disclosure,
  onRestore,
  restoreBusy,
  restoreDisabled,
  showScanStore,
  onScanStore,
}: PaywallFooterProps) {
  const open = (url: string) => {
    // Never throws. A dead link must not take the paywall down with it.
    Linking.openURL(url).catch(() => {});
  };

  return (
    <View style={s.wrap}>
      {/* ── Reassurance ──────────────────────────────────────────────────── */}
      <View style={s.trustRow}>
        <View style={s.trustItem}>
          <MaterialIcons name="lock-outline" size={13} color={PW.gold} />
          <Text style={s.trustText}>Secure App Store purchase</Text>
        </View>
        <View style={s.trustDot} />
        <View style={s.trustItem}>
          <MaterialIcons name="event-repeat" size={13} color={PW.gold} />
          <Text style={s.trustText}>Cancel anytime</Text>
        </View>
      </View>

      {/*
       * ── Scan Store alternative ──────────────────────────────────────────
       * Source-controlled and OFF for every capability paywall, because packs
       * buy quantity and never capability. Offering packs to somebody who
       * wanted Generate Listings sells them something that cannot unlock it.
       */}
      {showScanStore && (
        <Pressable
          onPress={onScanStore}
          accessibilityRole="button"
          accessibilityLabel="Just need more scans? Go to the Scan Store"
          hitSlop={8}
          style={({ pressed }) => [s.altBtn, pressed && { opacity: 0.7 }]}
        >
          <Text style={s.altText}>Just need more scans? Visit the Scan Store</Text>
        </Pressable>
      )}

      {/* ── Restore ──────────────────────────────────────────────────────── */}
      <Pressable
        onPress={restoreDisabled || restoreBusy ? undefined : onRestore}
        disabled={restoreDisabled || restoreBusy}
        accessibilityRole="button"
        accessibilityLabel="Restore purchases"
        accessibilityState={{ disabled: restoreDisabled || restoreBusy, busy: restoreBusy }}
        // A text action still needs a 44pt target.
        hitSlop={12}
        style={({ pressed }) => [
          s.restoreBtn,
          (restoreDisabled || restoreBusy) && { opacity: 0.45 },
          pressed && { opacity: 0.65 },
        ]}
      >
        <Text style={s.restoreText}>
          {restoreBusy ? "Restoring…" : "Restore Purchases"}
        </Text>
      </Pressable>

      {/* ── Disclosure ───────────────────────────────────────────────────── */}
      <Text style={s.legal}>{disclosure}</Text>

      <View style={s.legalLinks}>
        <Pressable onPress={() => open(PRIVACY_URL)} accessibilityRole="link" hitSlop={10}>
          <Text style={s.legalLink}>Privacy Policy</Text>
        </Pressable>
        <Text style={s.legalSep}>·</Text>
        <Pressable onPress={() => open(TERMS_URL)} accessibilityRole="link" hitSlop={10}>
          <Text style={s.legalLink}>Terms of Service</Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { alignItems: "center", gap: 12 },

  trustRow: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap", justifyContent: "center" },
  trustItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  trustText: { fontSize: 11.5, color: PW.brown, fontWeight: "600" },
  trustDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: PW.border },

  altBtn: { paddingVertical: 4 },
  altText: {
    fontFamily: FONTS.serif,
    fontSize: 13,
    fontWeight: "700",
    color: PW.forest,
    textDecorationLine: "underline",
    textDecorationColor: "rgba(33,77,45,0.35)",
  },

  restoreBtn: { paddingVertical: 6, paddingHorizontal: 12 },
  restoreText: {
    fontFamily: FONTS.serif,
    fontSize: 13.5,
    fontWeight: "700",
    color: PW.brown,
  },

  legal: {
    fontSize: 10.5,
    lineHeight: 15,
    color: PW.brown,
    textAlign: "center",
    paddingHorizontal: 6,
    opacity: 0.92,
  },
  legalLinks: { flexDirection: "row", alignItems: "center", gap: 8 },
  legalLink: { fontSize: 11, color: PW.brown, fontWeight: "700", textDecorationLine: "underline" },
  legalSep: { fontSize: 11, color: PW.muted },
});
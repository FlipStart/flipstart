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
import { PW, PW_RADIUS } from "./paywallTheme";

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
       *
       * Source-controlled, and TRUE for scan_limit only. Packs buy quantity and
       * never capability, so offering them to someone who wanted Generate
       * Listings would sell a thing that cannot unlock it. On scan_limit the
       * user's problem IS quantity, so packs genuinely solve it — and hiding
       * the cheaper option while selling a subscription would be a dark
       * pattern.
       *
       * Rendered as a real secondary button rather than a text link: it is a
       * legitimate second answer, not a footnote. Cream on parchment with a
       * forest outline keeps it clearly below the solid-green Pro CTA in the
       * visual hierarchy without looking disabled.
       */}
      {showScanStore && (
        <View style={s.altBlock}>
          <View style={s.orRow}>
            <View style={s.orRule} />
            <Text style={s.orText}>or</Text>
            <View style={s.orRule} />
          </View>

          <Text style={s.altPrompt}>Just need more scans?</Text>

          <Pressable
            onPress={onScanStore}
            accessibilityRole="button"
            accessibilityLabel="Go to Scan Store"
            hitSlop={6}
            style={({ pressed }) => [s.altBtn, pressed && { opacity: 0.78 }]}
          >
            <Text style={s.altText}>Go to Scan Store</Text>
          </Pressable>
        </View>
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

  altBlock: { width: "100%", alignItems: "center", gap: 9, marginTop: 2 },

  /** A ruled "or", the way a printed form separates two options. */
  orRow: { flexDirection: "row", alignItems: "center", gap: 10, width: "100%" },
  orRule: { flex: 1, height: 1, backgroundColor: PW.border },
  orText: {
    fontFamily: FONTS.serif,
    fontSize: 11.5,
    fontWeight: "700",
    color: PW.brown,
    letterSpacing: 0.5,
  },

  altPrompt: {
    fontFamily: FONTS.serif,
    fontSize: 13.5,
    fontWeight: "700",
    color: PW.ink,
  },

  /**
   * Outlined, not filled. The Pro CTA above is solid forest green; matching
   * that here would make two equally loud primary actions and leave the user
   * with no sense of which is the main path.
   */
  altBtn: {
    alignSelf: "stretch",
    backgroundColor: PW.card,
    borderRadius: PW_RADIUS.pill,
    borderWidth: 1.4,
    borderColor: PW.forest,
    minHeight: 46,
    paddingVertical: 12,
    paddingHorizontal: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  altText: {
    fontFamily: FONTS.serif,
    fontSize: 15,
    fontWeight: "800",
    color: PW.forest,
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
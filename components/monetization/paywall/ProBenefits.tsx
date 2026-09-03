/**
 * components/monetization/paywall/ProBenefits.tsx
 *
 * The four things Pro unlocks, as one compact strip.
 *
 * ── Why it sits below the CTA ───────────────────────────────────────────────
 * A user who arrived from a contextual trigger already knows what they came
 * for. The plans and the button are what they act on; this strip is the reason
 * to feel good about the price. Above the button it would compete with the
 * headline. Below it, it answers "what else do I get?" at exactly the moment
 * that question forms.
 *
 * ── Why names only ──────────────────────────────────────────────────────────
 * This paywall has to fit eleven things above the fold on a normal phone. Four
 * full descriptions would push the Scan Store alternative off-screen — and for
 * the scan-limit user, that button is the one that may actually solve their
 * problem. The four names are unmistakable; the descriptions live on the
 * contextual heroes that sell each feature individually.
 *
 * ── Motion ──────────────────────────────────────────────────────────────────
 * The four columns fade up in sequence when the paywall opens — 90ms apart,
 * once. Reduce Motion renders them in place.
 */
import React, { useEffect, useState } from "react";
import { AccessibilityInfo, StyleSheet, Text, View } from "react-native";
import Animated, {
  useSharedValue, useAnimatedStyle, withDelay, withTiming, Easing, interpolate,
  type SharedValue,
} from "react-native-reanimated";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { FONTS } from "@/constants/typography";
import { PW, PW_RADIUS } from "./paywallTheme";

/** The standardized Pro set. Identical on every paywall — never per-trigger. */
export const PRO_BENEFITS = [
  { icon: "photo-camera",   label: "3-Photo\nScans",     a11y: "3-photo scans" },
  { icon: "search",         label: "Deep\nAnalysis",     a11y: "Deep Analysis" },
  { icon: "sell",           label: "Generate\nListings", a11y: "Generate Listings" },
  { icon: "auto-awesome",   label: "AI\nContext",        a11y: "AI Context" },
] as const;

/**
 * The benefit the user actually reached for, given a quiet gold ring on its
 * icon. Keyed on paywall source at the call site; null on paywalls with no
 * single feature (scan_limit, settings).
 */
export type BenefitKey = "photos" | "deep" | "listings" | "context";
const KEY_INDEX: Record<BenefitKey, number> = { photos: 0, deep: 1, listings: 2, context: 3 };

export function ProBenefits({ emphasize = null }: { emphasize?: BenefitKey | null }) {
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
  }, []);

  const progress = useSharedValue(reduceMotion ? 1 : 0);
  useEffect(() => {
    if (reduceMotion) { progress.value = 1; return; }
    progress.value = withDelay(250, withTiming(1, { duration: 520, easing: Easing.out(Easing.cubic) }));
  }, [reduceMotion, progress]);

  return (
    <View
      style={s.strip}
      accessibilityRole="summary"
      accessibilityLabel={`Included with Pro: ${PRO_BENEFITS.map(b => b.a11y).join(", ")}.`}
    >
      <Text style={s.kicker} accessibilityElementsHidden>INCLUDED WITH PRO</Text>
      <View style={s.row}>
        {PRO_BENEFITS.map((b, i) => (
          <React.Fragment key={b.a11y}>
            {i > 0 && <View style={s.divider} />}
            <Benefit icon={b.icon} label={b.label} index={i} progress={progress}
              emphasized={emphasize !== null && KEY_INDEX[emphasize] === i} />
          </React.Fragment>
        ))}
      </View>
    </View>
  );
}

function Benefit({ icon, label, index, progress, emphasized }: {
  icon: (typeof PRO_BENEFITS)[number]["icon"]; label: string; index: number;
  progress: SharedValue<number>; emphasized: boolean;
}) {
  const style = useAnimatedStyle(() => {
    const start = index * 0.16;
    const t = interpolate(progress.value, [start, Math.min(1, start + 0.5)], [0, 1], "clamp");
    return { opacity: t, transform: [{ translateY: (1 - t) * 6 }] };
  });
  return (
    <Animated.View style={[s.cell, style]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={[s.iconWrap, emphasized && s.iconWrapEmphasized]}>
        <MaterialIcons name={icon} size={22} color={PW.forest} />
      </View>
      <Text style={[s.label, emphasized && s.labelEmphasized]} numberOfLines={2} allowFontScaling={false}>{label}</Text>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  strip: {
    backgroundColor: PW.card,
    borderRadius: PW_RADIUS.card,
    borderWidth: 1.25,
    borderColor: PW.border,
    paddingTop: 8,
    paddingBottom: 10,
    paddingHorizontal: 6,
  },
  kicker: {
    fontFamily: FONTS.serif, fontSize: 9.5, fontWeight: "800",
    letterSpacing: 2, color: PW.brown, textAlign: "center", marginBottom: 6,
  },
  row: { flexDirection: "row", alignItems: "stretch" },
  cell: { flex: 1, alignItems: "center", gap: 5, paddingHorizontal: 2 },
  iconWrap: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  /** The one they came for: a gold ring and a warm fill. Quiet, but unmistakable. */
  iconWrapEmphasized: { borderWidth: 1.4, borderColor: PW.gold, backgroundColor: PW.goldTint },
  labelEmphasized: { color: PW.forest },
  divider: { width: 1, backgroundColor: PW.border, marginVertical: 4 },
  label: {
    fontFamily: FONTS.serif, fontSize: 12.5, fontWeight: "700",
    color: PW.ink, textAlign: "center", lineHeight: 15,
  },
});
/**
 * components/monetization/paywall/PlanCard.tsx
 *
 * One plan, as a selectable card. Shared by every paywall source.
 *
 * ── The redesign ────────────────────────────────────────────────────────────
 * The previous card filled its selected state with cream, which on the new
 * white canvas read as a stain rather than a highlight. Selection is now
 * carried by structure — a strong forest border, a hairline gold inner rule,
 * a filled check, real depth — over a near-white interior. Expensive, not tinted.
 *
 * ── The one number that matters ─────────────────────────────────────────────
 * Annual leads with the monthly-equivalent figure ("$3.33 / month"), set at
 * headline size, in ink — the same treatment the headline price always had, so
 * the two cards still read as the same kind of object at a glance. The actual
 * annual charge moves to a smaller "Billed $39.99/year" line directly beneath
 * it, set in forest green: the accent color now marks the SUPPORTING fact
 * ("here is what that actually bills as"), not the headline number, which
 * needs no extra color to be the biggest thing on the card. Both numbers are
 * still on the card; only which is loud, and which is green, changed.
 *
 * Monthly has no equivalent to lead with, so its card is untouched: the
 * storefront price ("$7.99 / month") stays the headline, exactly as before.
 * The two cards intentionally look different at the top for that reason — a
 * true per-period price on one, a per-month equivalent on the other — and both
 * say plainly, right below, what will actually be billed.
 *
 * ── Motion ──────────────────────────────────────────────────────────────────
 * The check scales in and the border settles when a card becomes selected —
 * ~200ms, once per selection, nothing continuous. Reduce Motion renders the
 * final state directly.
 */
import React, { useEffect, useState } from "react";
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, withSequence, Easing,
} from "react-native-reanimated";
import Svg, { Circle, Path, Text as SvgText } from "react-native-svg";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { FONTS } from "@/constants/typography";
import { Skeleton } from "@/components/monetization/Skeleton";
import { BEST_VALUE_A11Y } from "./BestValueSeal";
import { PW, PW_RADIUS } from "./paywallTheme";

export interface PlanCardProps {
  /** Small caps plan name, e.g. "ANNUAL PRO". */
  name: string;
  /** Localized "price / period", or null while loading. */
  priceLabel: string | null;
  /** What the plan includes, e.g. "4,000 scans per year". */
  allowance: string;
  /** Third line. Savings for annual; the reset cadence for monthly. */
  footnote: string;
  /**
   * The Annual plan expressed per month ("$3.33"). Rendered large and green.
   * Null suppresses the line entirely — never a placeholder.
   */
  equivalent?: string | null;
  selected: boolean;
  /** Annual carries the badge, the watermark and a slightly stronger outline. */
  preferred?: boolean;
  /** The store could not offer this plan. Visible, explained, not selectable. */
  unavailable?: boolean;
  /** Locked during a purchase so the target cannot change mid-transaction. */
  disabled?: boolean;
  onSelect: () => void;
}

export function PlanCard({
  name, priceLabel, allowance, footnote, equivalent = null,
  selected, preferred = false, unavailable = false, disabled = false, onSelect,
}: PlanCardProps) {
  const inert = disabled || unavailable;

  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
  }, []);

  // Check pops on selection; border settles. Once per change, then still.
  const check = useSharedValue(selected ? 1 : 0);
  useEffect(() => {
    if (reduceMotion) { check.value = selected ? 1 : 0; return; }
    check.value = selected
      ? withSequence(
          withTiming(1.18, { duration: 140, easing: Easing.out(Easing.quad) }),
          withTiming(1,    { duration: 120, easing: Easing.inOut(Easing.quad) }),
        )
      : withTiming(0, { duration: 120 });
  }, [selected, reduceMotion, check]);

  const checkStyle = useAnimatedStyle(() => ({
    transform: [{ scale: check.value }],
    opacity: check.value > 0.05 ? 1 : 0,
  }));

  // Split "$39.99 / year" so the period can be set lighter than the amount.
  const [amount, period] = priceLabel ? splitPrice(priceLabel) : [null, null];

  // Both amount and equivalent must be ready before the equivalent leads —
  // a lone "$3.33/month" with no "billed" figure yet resolved would be a
  // headline price the card cannot back up. See the render below.
  const showEquivDominant = Boolean(equivalent && amount);
  const billed = priceLabel ? priceLabel.replace(/\s+/g, "") : null;

  const a11y = [
    name,
    showEquivDominant
      ? `${equivalent} per month, billed ${billed}`
      : (priceLabel ?? "price loading"),
    allowance,
    footnote,
    preferred ? BEST_VALUE_A11Y : "",
    unavailable ? "currently unavailable" : "",
  ].filter(Boolean).join(", ");

  return (
    <Pressable
      onPress={onSelect}
      disabled={inert}
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled: inert }}
      accessibilityLabel={a11y}
      style={({ pressed }) => [
        s.card,
        preferred && s.cardPreferred,
        selected && s.cardSelected,
        unavailable && s.cardUnavailable,
        pressed && !inert && { opacity: 0.94 },
      ]}
    >
      {/* Hairline gold rule just inside the border — the "expensive" detail. */}
      {selected && <View pointerEvents="none" style={s.innerRule} />}

      {/* Subtle FS watermark on the preferred plan. Decorative only. */}
      {preferred && (
        <View pointerEvents="none" style={s.watermark} accessibilityElementsHidden>
          <Watermark />
        </View>
      )}

      <View style={s.head}>
        <Text style={[s.name, selected && s.nameSelected]}>{name}</Text>
        {preferred && (
          <View style={s.badge}>
            <Text style={s.badgeText} allowFontScaling={false}>BEST VALUE</Text>
          </View>
        )}
        <View style={s.spacer} />
        <View style={[s.radio, selected && s.radioSelected]}>
          <Animated.View style={checkStyle}>
            <MaterialIcons name="check" size={16} color={PW.card} />
          </Animated.View>
        </View>
      </View>

      {showEquivDominant ? (
        <>
          <View style={s.priceRow}>
            <Text style={s.amount}>{equivalent}</Text>
            <Text style={s.period}> / month</Text>
          </View>
          {/* The actual charge, right under the number that sold it. */}
          <Text style={s.billedLine}>Billed {billed}</Text>
        </>
      ) : amount ? (
        <View style={s.priceRow}>
          <Text style={s.amount}>{amount}</Text>
          <Text style={s.period}> {period}</Text>
        </View>
      ) : (
        <View style={s.priceSkeleton}><Skeleton width={128} height={30} radius={6} /></View>
      )}

      <Text style={s.allowance}>{allowance}</Text>

      {unavailable ? (
        <Text style={s.unavailable}>Not available in your store right now</Text>
      ) : (
        <View style={s.footRow}>
          {preferred && <MaterialIcons name="sell" size={13} color={PW.gold} />}
          <Text style={[s.footnote, preferred && s.footnoteGreen]}>{footnote}</Text>
        </View>
      )}
    </Pressable>
  );
}

/** "$39.99 / year" → ["$39.99", "/ year"]. Tolerates a missing separator. */
function splitPrice(label: string): [string, string] {
  const i = label.indexOf(" / ");
  if (i < 0) return [label, ""];
  return [label.slice(0, i), label.slice(i + 1)];
}

/** A faint laurel seal reading FLIPSTART · FS · PRO. */
function Watermark() {
  const size = 96, c = size / 2;
  return (
    <Svg width={size} height={size} opacity={0.10}>
      <Circle cx={c} cy={c} r={44} fill="none" stroke={PW.forest} strokeWidth={1.2} />
      <Circle cx={c} cy={c} r={36} fill="none" stroke={PW.forest} strokeWidth={0.8} />
      <Path d={`M ${c - 30} ${c + 22} q 8 -14 18 -6 M ${c + 30} ${c + 22} q -8 -14 -18 -6`}
        stroke={PW.forest} strokeWidth={1.2} fill="none" strokeLinecap="round" />
      <SvgText x={c} y={c + 9} fontSize={26} fontWeight="800" fill={PW.forest}
        textAnchor="middle" fontFamily="Georgia">FS</SvgText>
      <SvgText x={c} y={c - 20} fontSize={7} fontWeight="700" fill={PW.forest}
        textAnchor="middle" letterSpacing={1.5}>FLIPSTART</SvgText>
      <SvgText x={c} y={c + 30} fontSize={7} fontWeight="700" fill={PW.forest}
        textAnchor="middle" letterSpacing={2}>PRO</SvgText>
    </Svg>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: PW.card,
    borderRadius: PW_RADIUS.card,
    borderWidth: 1.25,
    borderColor: PW.border,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 13,
    overflow: "hidden",
  },
  cardPreferred: { borderColor: "rgba(33,77,45,0.35)" },
  /** Structure, not tint: forest border, real depth, white interior. */
  cardSelected: {
    borderColor: PW.forest,
    borderWidth: 2,
    shadowColor: PW.forest,
    shadowOpacity: 0.16,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  cardUnavailable: { opacity: 0.55 },

  innerRule: {
    position: "absolute", top: 4, left: 4, right: 4, bottom: 4,
    borderRadius: PW_RADIUS.card - 4,
    borderWidth: 1,
    borderColor: "rgba(196,163,52,0.45)",
  },
  watermark: { position: "absolute", right: 10, bottom: 4 },

  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  spacer: { flex: 1 },
  name: {
    fontFamily: FONTS.serif, fontSize: 13, fontWeight: "800",
    letterSpacing: 1.6, color: PW.brown,
  },
  nameSelected: { color: PW.forest },

  badge: {
    paddingHorizontal: 9, paddingVertical: 3, borderRadius: 4,
    borderWidth: 1, borderColor: PW.gold, backgroundColor: PW.goldTint,
  },
  badgeText: {
    fontFamily: FONTS.serif, fontSize: 10, fontWeight: "800",
    letterSpacing: 1.3, color: PW.brown,
  },

  radio: {
    width: 28, height: 28, borderRadius: 14,
    borderWidth: 1.5, borderColor: PW.border,
    alignItems: "center", justifyContent: "center",
  },
  radioSelected: { backgroundColor: PW.forest, borderColor: PW.forest },

  priceRow: { flexDirection: "row", alignItems: "baseline", marginTop: 6 },
  amount: { fontFamily: FONTS.serif, fontSize: 32, fontWeight: "800", color: PW.ink, lineHeight: 36 },
  period: { fontFamily: FONTS.serif, fontSize: 20, fontWeight: "700", color: PW.ink, lineHeight: 36 },
  priceSkeleton: { height: 36, marginTop: 6, justifyContent: "center" },

  /**
   * "Billed $39.99/year" — forest green, not ink. The headline number ($3.33)
   * is already the biggest thing on the card and needs no color to draw the
   * eye; the accent instead marks this line, the one someone glancing past the
   * headline should still catch.
   */
  billedLine: { marginTop: 2, fontFamily: FONTS.serif, fontSize: 14, fontWeight: "700", color: PW.forest },

  allowance: { marginTop: 5, fontSize: 15, color: PW.ink, fontWeight: "500" },

  footRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 4 },
  footnote: { fontSize: 13.5, color: PW.brown, fontWeight: "600" },
  footnoteGreen: { color: PW.forest },
  unavailable: { marginTop: 4, fontSize: 13, color: PW.brown, fontStyle: "italic" },
});
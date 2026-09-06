/**
 * components/onboarding/QuestionCards.tsx
 *
 * One selection component per question, so the three screens read as three
 * different moments rather than the same card stack with different words.
 *
 *   PathCard   — Motivation. Three rich cards: seal, category eyebrow, serif
 *                title, one supporting line. "Three FlipStart paths."
 *   LadderRow  — Experience. A single connected column with markers on a
 *                vertical rule. A progression in FORM only: every rung is
 *                styled identically, because none of these answers is better
 *                than another.
 *   HelpCard   — Pain points. A compact two-column field of icon tiles, so
 *                multi-select looks like a field to sweep rather than a list
 *                to work down.
 *
 * All three share the system: PW tokens, forest selection, one hairline gold
 * inner rule when selected, a check that appears with the fill. Selection is
 * never colour alone — there is always a mark and a border change.
 */
import React, { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming, Easing } from "react-native-reanimated";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { FONTS } from "@/constants/typography";
import { PW, PW_RADIUS, PW_SHADOW } from "@/components/monetization/paywall/paywallTheme";

type Glyph = React.ComponentProps<typeof MaterialIcons>["name"];

/** The shared select animation: a 200ms settle, once, no loop. */
function useSelectProgress(selected: boolean) {
  const on = useSharedValue(selected ? 1 : 0);
  useEffect(() => {
    on.value = withTiming(selected ? 1 : 0, { duration: 200, easing: Easing.out(Easing.quad) });
  }, [selected, on]);
  return on;
}

// ── Motivation ──────────────────────────────────────────────────────────────

export interface PathCardProps {
  eyebrow: string;
  title: string;
  support: string;
  icon: Glyph;
  selected: boolean;
  onPress: () => void;
}

export function PathCard({ eyebrow, title, support, icon, selected, onPress }: PathCardProps) {
  const on = useSelectProgress(selected);
  const mark = useAnimatedStyle(() => ({ opacity: on.value, transform: [{ scale: 0.6 + on.value * 0.4 }] }));

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${title}. ${support}`}
      style={({ pressed }) => [p.card, selected && p.cardOn, pressed && { opacity: 0.92 }]}
    >
      {selected && <View pointerEvents="none" style={p.innerRule} />}

      <View style={[p.seal, selected && p.sealOn]}>
        <MaterialIcons name={icon} size={22} color={selected ? PW.cream : PW.forest} />
      </View>

      <View style={p.text}>
        <Text style={p.eyebrow} allowFontScaling={false}>{eyebrow}</Text>
        <Text style={[p.title, selected && p.titleOn]} maxFontSizeMultiplier={1.3}>{title}</Text>
        <Text style={p.support} maxFontSizeMultiplier={1.3}>{support}</Text>
      </View>

      <Animated.View style={[p.check, mark]}>
        <MaterialIcons name="check-circle" size={20} color={PW.forest} />
      </Animated.View>
    </Pressable>
  );
}

const p = StyleSheet.create({
  card: {
    flexDirection: "row", alignItems: "flex-start", gap: 12,
    backgroundColor: PW.card, borderRadius: PW_RADIUS.card,
    borderWidth: 1.25, borderColor: PW.border,
    paddingVertical: 13, paddingHorizontal: 14,
    overflow: "hidden", ...PW_SHADOW,
  },
  cardOn: {
    borderColor: PW.forest, borderWidth: 2,
    shadowColor: PW.forest, shadowOpacity: 0.14, shadowRadius: 12, shadowOffset: { width: 0, height: 5 },
    elevation: 4,
  },
  innerRule: {
    position: "absolute", top: 3, left: 3, right: 3, bottom: 3,
    borderRadius: PW_RADIUS.card - 3, borderWidth: 1, borderColor: "rgba(196,163,52,0.45)",
  },
  seal: {
    width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(33,77,45,0.07)", borderWidth: 1, borderColor: "rgba(33,77,45,0.22)",
  },
  sealOn: { backgroundColor: PW.forest, borderColor: PW.forest },
  text: { flex: 1, minWidth: 0, gap: 2 },
  eyebrow: { fontFamily: FONTS.serif, fontSize: 8.5, fontWeight: "800", letterSpacing: 1.5, color: PW.brown },
  title: { fontFamily: FONTS.serif, fontSize: 16, fontWeight: "800", color: PW.ink, lineHeight: 21 },
  titleOn: { color: PW.forest },
  support: { fontSize: 12.5, lineHeight: 17, color: PW.brown, fontWeight: "500" },
  check: { marginTop: 2 },
});

// ── Experience ──────────────────────────────────────────────────────────────

export interface LadderRowProps {
  title: string;
  support: string;
  selected: boolean;
  onPress: () => void;
  /** Draws the connecting rule above/below this rung. */
  first: boolean;
  last: boolean;
}

/**
 * One rung.
 *
 * The cards are SEPARATED — 10pt of air between them, like every other list in
 * the onboarding. Butted together they read as one striped block rather than
 * four choices. The rail still connects them: each rule extends half the gap
 * past its own row (marginVertical: -RAIL_BRIDGE), so the segments meet in the
 * space between cards and the column stays one line.
 *
 * The rungs themselves are identical in weight, size and colour, so the shape
 * suggests a sequence without suggesting that the bottom is worth more than
 * the top.
 */
export function LadderRow({ title, support, selected, onPress, first, last }: LadderRowProps) {
  const on = useSelectProgress(selected);
  const dot = useAnimatedStyle(() => ({ transform: [{ scale: 0.85 + on.value * 0.15 }] }));

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${title}. ${support}`}
      style={({ pressed }) => [l.row, pressed && { opacity: 0.92 }]}
    >
      {/* The rail: rule above, marker, rule below. */}
      <View style={l.rail}>
        <View style={[l.rule, first && l.ruleHidden]} />
        <Animated.View style={[l.marker, selected && l.markerOn, dot]}>
          {selected && <MaterialIcons name="check" size={13} color={PW.cream} />}
        </Animated.View>
        <View style={[l.rule, last && l.ruleHidden]} />
      </View>

      <View style={[l.card, selected && l.cardOn]}>
        {selected && <View pointerEvents="none" style={l.innerRule} />}
        <Text style={[l.title, selected && l.titleOn]} maxFontSizeMultiplier={1.3}>{title}</Text>
        <Text style={l.support} maxFontSizeMultiplier={1.3}>{support}</Text>
      </View>
    </Pressable>
  );
}

/** Half the parent's 10pt row gap: two rules meet exactly in the middle of it. */
const RAIL_BRIDGE = 5;

const l = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "stretch", gap: 12 },
  rail: { width: 24, alignItems: "center" },
  /** Reaches into the gap on both sides so the column reads as one line. */
  rule: { flex: 1, width: 1.5, marginVertical: -RAIL_BRIDGE, backgroundColor: "rgba(196,163,52,0.5)" },
  ruleHidden: { backgroundColor: "transparent" },
  marker: {
    width: 22, height: 22, borderRadius: 11, marginVertical: 2,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1.5, borderColor: PW.border, backgroundColor: PW.parchment,
  },
  markerOn: { backgroundColor: PW.forest, borderColor: PW.forest },

  card: {
    flex: 1, minWidth: 0,
    backgroundColor: PW.card, borderRadius: PW_RADIUS.card - 2,
    borderWidth: 1.25, borderColor: PW.border,
    paddingVertical: 12, paddingHorizontal: 13, gap: 2,
    overflow: "hidden", ...PW_SHADOW,
  },
  cardOn: { borderColor: PW.forest, borderWidth: 2 },
  innerRule: {
    position: "absolute", top: 3, left: 3, right: 3, bottom: 3,
    borderRadius: PW_RADIUS.card - 5, borderWidth: 1, borderColor: "rgba(196,163,52,0.45)",
  },
  title: { fontFamily: FONTS.serif, fontSize: 15, fontWeight: "800", color: PW.ink, lineHeight: 20 },
  titleOn: { color: PW.forest },
  support: { fontSize: 12, lineHeight: 16, color: PW.brown, fontWeight: "500" },
});

// ── Pain points ─────────────────────────────────────────────────────────────

export interface HelpCardProps {
  title: string;
  icon: Glyph;
  selected: boolean;
  onPress: () => void;
}

/**
 * One tile in the multi-select field. Half-width, so six sit in three rows and
 * the whole set is visible at once — a field to sweep, not a list to work
 * down. Selected fills forest with a gold hairline and a check badge; the
 * title flips to cream, so the state survives without colour vision.
 */
export function HelpCard({ title, icon, selected, onPress }: HelpCardProps) {
  const on = useSelectProgress(selected);
  const badge = useAnimatedStyle(() => ({ opacity: on.value, transform: [{ scale: 0.5 + on.value * 0.5 }] }));

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={title}
      style={({ pressed }) => [h.card, selected && h.cardOn, pressed && { opacity: 0.9 }]}
    >
      {selected && <View pointerEvents="none" style={h.innerRule} />}

      <View style={h.head}>
        <MaterialIcons name={icon} size={20} color={selected ? PW.cream : PW.forest} />
        <Animated.View style={[h.badge, badge]}>
          <MaterialIcons name="check" size={12} color={PW.forest} />
        </Animated.View>
      </View>

      <Text style={[h.title, selected && h.titleOn]} numberOfLines={3} maxFontSizeMultiplier={1.25}>
        {title}
      </Text>
    </Pressable>
  );
}

const h = StyleSheet.create({
  card: {
    /** Two per row with the parent's 10pt gap. */
    width: "48%", flexGrow: 1, minHeight: 92,
    backgroundColor: PW.card, borderRadius: PW_RADIUS.card,
    borderWidth: 1.25, borderColor: PW.border,
    paddingVertical: 11, paddingHorizontal: 12, gap: 8,
    overflow: "hidden", ...PW_SHADOW,
  },
  cardOn: {
    backgroundColor: PW.forest, borderColor: PW.gold, borderWidth: 1.6,
    shadowColor: PW.forest, shadowOpacity: 0.18, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  innerRule: {
    position: "absolute", top: 3, left: 3, right: 3, bottom: 3,
    borderRadius: PW_RADIUS.card - 3, borderWidth: 1, borderColor: "rgba(196,163,52,0.55)",
  },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  badge: {
    width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center",
    backgroundColor: PW.cream,
  },
  title: { fontFamily: FONTS.serif, fontSize: 13.5, fontWeight: "800", color: PW.ink, lineHeight: 18 },
  titleOn: { color: PW.cream },
});
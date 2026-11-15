/**
 * components/onboarding/ChoiceCards.tsx
 *
 * The answer controls for the V2 questions. One visual language, three shapes:
 *
 *   ChoiceRow  — single choice with a supporting line (goal, experience).
 *                Round marker. Chosen = forest border, green tint, filled check.
 *   IconTile   — multi-select with an icon (what to help with). Square marker.
 *                Chosen = solid forest, cream label, gold check — obvious at a
 *                glance, which the old faint tint was not.
 *   SourceTile — single choice, label only (how they heard). Round marker,
 *                same solid-forest chosen state as IconTile. No platform logos:
 *                those are other companies' marks.
 *
 * Unchosen controls use the app's own card (cream fill, app border) with a
 * deep-gold marker. Selection is never colour alone: the marker fills and a
 * check appears, and each control reports checked/unchecked to VoiceOver.
 * Every tap target is at least 54pt tall. Nothing animates beyond a press dim.
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { FONTS } from "@/constants/typography";
import { OB, OB_SPACE } from "./onboardingTheme";

type Glyph = React.ComponentProps<typeof MaterialIcons>["name"];

/** Unchosen marker ring — deep gold, 4.7:1, so the control reads as a control. */
const RING = OB.goldText;
/** Light text and icon wash on a chosen (forest) tile. */
const ON_FOREST_WASH = "rgba(244,238,216,0.14)";

// ── ChoiceRow ───────────────────────────────────────────────────────────────

export function ChoiceRow({ title, support, selected, onPress, minHeight = 74 }: {
  title: string;
  support: string;
  selected: boolean;
  onPress: () => void;
  minHeight?: number;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${title}. ${support}`}
      style={({ pressed }) => [r.card, { minHeight }, selected && r.cardOn, pressed && r.pressed]}
    >
      <View style={r.text}>
        <Text style={[r.title, selected && r.titleOn]} maxFontSizeMultiplier={1.25}>{title}</Text>
        <Text style={r.support} maxFontSizeMultiplier={1.25}>{support}</Text>
      </View>
      {selected ? (
        <View style={r.markOn}><MaterialIcons name="check" size={16} color="#FFFFFF" /></View>
      ) : (
        <View style={r.mark} />
      )}
    </Pressable>
  );
}

// ── IconTile ────────────────────────────────────────────────────────────────

export function IconTile({ title, icon, selected, onPress, height, compact = false }: {
  title: string;
  icon: Glyph;
  selected: boolean;
  onPress: () => void;
  height: number;
  /** Short phones: smaller badge, label and corner box so two lines still fit. */
  compact?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={title}
      style={({ pressed }) => [t.tile, { height }, compact && t.tileCompact, selected && t.tileOn, pressed && r.pressed]}
    >
      <View style={[t.badge, compact && t.badgeCompact, selected && t.badgeOn]}>
        <MaterialIcons name={icon} size={compact ? 16 : 19} color={selected ? OB.gold : OB.forest} />
      </View>
      <Text style={[t.label, compact && t.labelCompact, selected && t.labelOn]} numberOfLines={2} maxFontSizeMultiplier={1.15}>{title}</Text>
      {selected ? (
        <View style={[t.checkOn, compact && t.checkCompact]}><MaterialIcons name="check" size={compact ? 12 : 14} color={OB.forestDeep} /></View>
      ) : (
        <View style={[t.check, compact && t.checkCompact]} />
      )}
    </Pressable>
  );
}

// ── SourceTile ──────────────────────────────────────────────────────────────

export function SourceTile({ title, selected, onPress, compact = false }: {
  title: string;
  selected: boolean;
  onPress: () => void;
  /** Short phones: tighter insides so "Friend or word of mouth" fits two lines. */
  compact?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={title}
      style={({ pressed }) => [s.tile, compact && s.tileCompact, selected && s.tileOn, pressed && r.pressed]}
    >
      {selected ? (
        <View style={[s.markOn, compact && s.markCompact]}><MaterialIcons name="check" size={12} color={OB.forestDeep} /></View>
      ) : (
        <View style={[s.mark, compact && s.markCompact]} />
      )}
      <Text style={[s.label, compact && s.labelCompact, selected && s.labelOn]} numberOfLines={2} maxFontSizeMultiplier={1.15}>{title}</Text>
    </Pressable>
  );
}

// ── Two-column grid ─────────────────────────────────────────────────────────

/**
 * Pairs children into rows of two equal columns. Rows, not flex-wrap with
 * percentage widths, so the 10pt gap is exact and a long label in one tile can
 * never change its neighbour's width.
 */
export function TwoColumnGrid({ children, gap = 10 }: { children: React.ReactNode; gap?: number }) {
  const items = React.Children.toArray(children);
  const rows: React.ReactNode[][] = [];
  for (let i = 0; i < items.length; i += 2) rows.push(items.slice(i, i + 2));
  return (
    <View style={{ gap }}>
      {rows.map((row, i) => (
        <View key={i} style={[g.row, { gap }]}>
          {row.map((child, j) => <View key={j} style={g.cell}>{child}</View>)}
          {row.length === 1 && <View style={g.cell} />}
        </View>
      ))}
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const r = StyleSheet.create({
  card: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingVertical: 14, paddingHorizontal: 16,
    borderRadius: OB_SPACE.radius, borderWidth: 1, borderColor: OB.border, backgroundColor: OB.card,
  },
  /** 2pt border: padding drops by 1 so the content never shifts on select. */
  cardOn: { borderWidth: 2, borderColor: OB.forest, backgroundColor: OB.greenTint, paddingVertical: 13, paddingHorizontal: 15 },
  pressed: { opacity: 0.9 },
  text: { flex: 1, gap: 3 },
  title: { fontFamily: FONTS.serif, fontSize: 17, lineHeight: 22, fontWeight: "700", color: OB.ink },
  titleOn: { color: OB.forest },
  support: { fontSize: 14, lineHeight: 20, color: OB.ink },
  mark: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: RING },
  markOn: { width: 24, height: 24, borderRadius: 12, backgroundColor: OB.forest, alignItems: "center", justifyContent: "center" },
});

const t = StyleSheet.create({
  tile: {
    padding: 12, justifyContent: "space-between", alignItems: "flex-start",
    borderRadius: OB_SPACE.radius, borderWidth: 1, borderColor: OB.border, backgroundColor: OB.card,
  },
  tileCompact: { padding: 10 },
  tileOn: { backgroundColor: OB.forest, borderColor: OB.gold },
  badge: { width: 34, height: 34, borderRadius: 17, backgroundColor: OB.greenTint, alignItems: "center", justifyContent: "center" },
  badgeCompact: { width: 28, height: 28, borderRadius: 14 },
  badgeOn: { backgroundColor: ON_FOREST_WASH },
  label: { fontSize: 14, lineHeight: 18, fontWeight: "700", color: OB.ink, paddingRight: 4 },
  labelCompact: { fontSize: 13, lineHeight: 16 },
  labelOn: { color: OB.cream },
  checkCompact: { top: 8, right: 8, width: 18, height: 18, borderRadius: 5 },
  check: { position: "absolute", top: 10, right: 10, width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, borderColor: RING },
  checkOn: {
    position: "absolute", top: 10, right: 10, width: 20, height: 20, borderRadius: 6,
    backgroundColor: OB.gold, alignItems: "center", justifyContent: "center",
  },
});

const s = StyleSheet.create({
  tile: {
    minHeight: 54, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12,
    borderRadius: OB_SPACE.radius, borderWidth: 1, borderColor: OB.border, backgroundColor: OB.card,
  },
  tileCompact: { paddingHorizontal: 10, gap: 8 },
  tileOn: { backgroundColor: OB.forest, borderColor: OB.gold },
  mark: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: RING },
  markCompact: { width: 18, height: 18, borderRadius: 9 },
  markOn: { width: 20, height: 20, borderRadius: 10, backgroundColor: OB.gold, alignItems: "center", justifyContent: "center" },
  label: { flex: 1, fontSize: 15, lineHeight: 19, fontWeight: "600", color: OB.ink },
  labelCompact: { fontSize: 14, lineHeight: 18 },
  labelOn: { color: OB.cream, fontWeight: "700" },
});

const g = StyleSheet.create({
  row: { flexDirection: "row" },
  cell: { flex: 1 },
});
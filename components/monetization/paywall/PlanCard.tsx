/**
 * components/monetization/paywall/PlanCard.tsx
 *
 * One selectable plan, styled as a card from a paper catalogue.
 *
 * ── It is a radio, not a coloured rectangle ─────────────────────────────────
 * accessibilityRole="radio" with a real selected state, inside a radiogroup on
 * the selector. VoiceOver therefore announces "Annual Pro… selected, 1 of 2"
 * and the swipe order is correct. A Pressable with a border change is invisible
 * to a screen reader, which on a purchase screen means the user cannot tell
 * what they are about to be charged for.
 *
 * ── No purchase button on the card ──────────────────────────────────────────
 * Selection and purchase are separate acts. One CTA below the pair owns the
 * transaction, so there is exactly one place a charge can originate.
 *
 * ── Prices are never invented ───────────────────────────────────────────────
 * `priceLabel` null means the store has not answered, and the card renders the
 * existing Skeleton rather than a plausible-looking number. The row keeps its
 * height either way so nothing jumps when prices land.
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { FONTS } from "@/constants/typography";
import { Skeleton } from "@/components/monetization/Skeleton";
import { BestValueSeal, BEST_VALUE_A11Y } from "./BestValueSeal";
import { PW, PW_RADIUS, PW_SHADOW } from "./paywallTheme";

export interface PlanCardProps {
  /** Small caps plan name, e.g. "ANNUAL PRO". */
  name: string;
  /** Localized "price / period", or null while loading. */
  priceLabel: string | null;
  /** What the plan includes, e.g. "4,000 scans per year". */
  allowance: string;
  /** Third line. Savings for annual; the reset cadence for monthly. */
  footnote: string;
  selected: boolean;
  /** Annual carries the seal and a slightly stronger resting outline. */
  preferred?: boolean;
  /** The store could not offer this plan. Visible, explained, not selectable. */
  unavailable?: boolean;
  /** Locked during a purchase so the target cannot change mid-transaction. */
  disabled?: boolean;
  onSelect: () => void;
}

export function PlanCard({
  name,
  priceLabel,
  allowance,
  footnote,
  selected,
  preferred = false,
  unavailable = false,
  disabled = false,
  onSelect,
}: PlanCardProps) {
  const inert = disabled || unavailable;

  /**
   * One sentence, in the order a person would say it.
   *
   * Built here rather than left to VoiceOver's default concatenation, which
   * would read the card's children in layout order and produce "ANNUAL PRO,
   * BEST VALUE, $39.99 slash year" — the seal interrupting the plan name.
   */
  const a11yLabel = [
    name,
    preferred ? BEST_VALUE_A11Y : null,
    priceLabel ?? "price loading",
    allowance,
    footnote,
    unavailable ? "Unavailable" : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <Pressable
      onPress={inert ? undefined : onSelect}
      disabled={inert}
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled: inert }}
      accessibilityLabel={a11yLabel}
      // Generous, so the whole card is the target rather than the radio dot.
      hitSlop={4}
      style={({ pressed }) => [
        s.card,
        preferred && !selected && s.cardPreferred,
        selected && s.cardSelected,
        unavailable && s.cardUnavailable,
        pressed && !inert && s.cardPressed,
      ]}
    >
      {/*
       * Gold hairline, inset inside the green outline.
       *
       * Only on the selected card. Two rules a hair apart is the "antique gold
       * detail" from the brief, and it is what separates a selected state from
       * a plain thicker border — without tinting the whole card gold.
       */}
      {selected && <View pointerEvents="none" style={s.goldInlay} />}

      <View style={s.row}>
        <View style={s.body}>
          <View style={s.nameRow}>
            <Text style={s.name} numberOfLines={1}>
              {name}
            </Text>
            {preferred && <BestValueSeal />}
          </View>

          {priceLabel ? (
            <Text style={s.price} numberOfLines={1}>
              {priceLabel}
            </Text>
          ) : (
            // Same height as the price line, so resolving prices does not
            // reflow the card.
            <View style={s.priceSkeleton}>
              <Skeleton width={128} height={20} radius={5} />
            </View>
          )}

          <Text style={s.allowance} numberOfLines={2}>
            {allowance}
          </Text>
          <Text style={[s.footnote, preferred && s.footnotePreferred]} numberOfLines={2}>
            {unavailable ? "Unavailable right now" : footnote}
          </Text>
        </View>

        {/*
         * Filled disc with a cream check when selected; an empty ring when not.
         *
         * Deliberately high contrast. "Obvious selected state" is the one thing
         * on this screen a user must not have to squint at, because it decides
         * what the button below charges them.
         */}
        <View style={[s.radio, selected && s.radioSelected, unavailable && s.radioDim]}>
          {selected && <MaterialIcons name="check" size={13} color={PW.cream} />}
        </View>
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: PW.card,
    borderRadius: PW_RADIUS.card,
    borderWidth: 1.25,
    borderColor: PW.border,
    paddingVertical: 13,
    paddingHorizontal: 16,
    ...PW_SHADOW,
  },
  /**
   * Annual at rest.
   *
   * A green tint at 32% rather than the full green: it has to look preferred
   * next to Monthly while still looking clearly UNSELECTED next to itself
   * selected. Using the solid green here left the two states nearly identical.
   */
  cardPreferred: { borderColor: "rgba(33,77,45,0.32)", borderWidth: 1.5 },
  cardSelected: {
    backgroundColor: PW.cardSelected,
    borderColor: PW.forest,
    borderWidth: 2,
  },
  cardUnavailable: { opacity: 0.55 },
  cardPressed: { opacity: 0.88 },

  goldInlay: {
    position: "absolute",
    top: 3,
    left: 3,
    right: 3,
    bottom: 3,
    borderRadius: PW_RADIUS.card - 3,
    borderWidth: 1,
    borderColor: "rgba(196,163,52,0.55)",
  },

  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  body: { flex: 1, gap: 2 },

  nameRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 1 },
  name: {
    fontFamily: FONTS.serif,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 1.3,
    color: PW.forest,
  },

  price: {
    fontFamily: FONTS.serif,
    fontSize: 21,
    fontWeight: "800",
    color: PW.ink,
    lineHeight: 26,
  },
  priceSkeleton: { height: 26, justifyContent: "center" },

  allowance: { fontSize: 12.5, color: PW.brown, lineHeight: 17 },
  footnote: { fontSize: 11.5, color: PW.muted, lineHeight: 16 },
  /** The savings line earns real ink; the monthly cadence line does not. */
  footnotePreferred: { color: PW.brown, fontWeight: "600" },

  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: "rgba(33,77,45,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  radioSelected: { backgroundColor: PW.forest, borderColor: PW.forest },
  radioDim: { borderColor: PW.border },
});
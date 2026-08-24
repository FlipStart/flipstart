/**
 * components/monetization/paywall/PlanSelector.tsx
 *
 * Annual, then Monthly. In that order, always.
 *
 * ── The order is a decision, not a layout accident ──────────────────────────
 * Annual is rendered first and selected by default because it is the better
 * deal for anyone who keeps using the app, and because a year of Pro is the
 * outcome that suits both sides. It is expressed as literal JSX ordering rather
 * than a sorted array so it cannot be reordered by a data change.
 *
 * ── Monthly is not punished ─────────────────────────────────────────────────
 * Same card component, same type sizes, same radio, fully selectable, no
 * dimming and no "are you sure". The only differences are the seal and a
 * slightly stronger resting outline on Annual. A monthly subscriber is a
 * perfectly good customer and the screen should not sulk about it.
 */
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { FONTS } from "@/constants/typography";
import { ANNUAL_SCANS, MONTHLY_SCANS } from "@/lib/paywallConfig";
import { annualSavingsLabel, planPriceLabel, type ProductPricing } from "@/lib/paywallPricing";
import { fmt } from "@/lib/scanBalanceDisplay";
import type { PurchaseTarget } from "@/lib/purchases";
import { PlanCard } from "./PlanCard";
import { PW } from "./paywallTheme";

export interface PlanSelectorProps {
  selected: PurchaseTarget;
  onSelect: (t: PurchaseTarget) => void;
  monthlyPricing: ProductPricing;
  annualPricing: ProductPricing;
  monthlyAvailable: boolean;
  annualAvailable: boolean;
  /** True during a purchase — the target must not change mid-transaction. */
  locked: boolean;
}

export function PlanSelector({
  selected,
  onSelect,
  monthlyPricing,
  annualPricing,
  monthlyAvailable,
  annualAvailable,
  locked,
}: PlanSelectorProps) {
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel="Choose your plan"
      style={s.group}
    >
      <Text style={s.sectionLabel} accessibilityRole="header">
        CHOOSE YOUR PLAN
      </Text>

      {/* ANNUAL FIRST. */}
      <PlanCard
        name="ANNUAL PRO"
        priceLabel={planPriceLabel(annualPricing, "year")}
        allowance={`${fmt(ANNUAL_SCANS)} scans per year`}
        // Falls back to wording with no percentage when the two prices cannot
        // be compared honestly — see lib/paywallPricing.ts.
        footnote={annualSavingsLabel(monthlyPricing, annualPricing)}
        selected={selected === "annual"}
        preferred
        unavailable={!annualAvailable}
        disabled={locked}
        onSelect={() => onSelect("annual")}
      />

      <PlanCard
        name="MONTHLY PRO"
        priceLabel={planPriceLabel(monthlyPricing, "month")}
        allowance={`${fmt(MONTHLY_SCANS)} scans every month`}
        footnote="Renews monthly"
        selected={selected === "monthly"}
        unavailable={!monthlyAvailable}
        disabled={locked}
        onSelect={() => onSelect("monthly")}
      />
    </View>
  );
}

const s = StyleSheet.create({
  group: { gap: 10 },
  /**
   * Brown, not the muted tone.
   *
   * #8A7658 on parchment is about 3.4:1 — under AA for a label this size. The
   * wide letter-spacing already carries the "small caps catalogue heading"
   * feeling without needing to be faint as well.
   */
  sectionLabel: {
    fontFamily: FONTS.serif,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 2,
    color: PW.brown,
    textAlign: "center",
    marginBottom: 2,
  },
});
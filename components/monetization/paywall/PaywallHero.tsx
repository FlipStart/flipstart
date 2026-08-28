/**
 * components/monetization/paywall/PaywallHero.tsx
 *
 * The upper third. TEMPORARY, and built to be thrown away.
 *
 * ── This is the replaceable part ────────────────────────────────────────────
 * Phase 3 onwards replaces this one component per source — Generate Listings
 * gets a listing mock-up, Deep Analysis gets a valuation breakdown, and so on.
 * Everything below it in the modal is shared and stays.
 *
 * The mapping from source to hero lives HERE rather than in lib/paywallConfig
 * so that config stays plain data and testable in a bare Node runner. Adding a
 * contextual hero is: write the component, add one line to HEROES.
 *
 * ── Deliberately under-designed ─────────────────────────────────────────────
 * An emblem, a rule, three lines of type. No feature checklist, no
 * illustration, no motion. The brief is explicit that the generic hero must not
 * be overdesigned, and there is a practical reason too: a polished placeholder
 * is the kind of thing that survives to launch because nobody remembers it was
 * temporary.
 *
 * ── Height ──────────────────────────────────────────────────────────────────
 * Content-sized, roughly 200–225pt, which is about 30% on a 6.1" iPhone and
 * about 33% on an SE. The brief's ceiling matters more than its floor: hero
 * artwork that pushes pricing below the fold is the failure mode, so this errs
 * short.
 */
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { FONTS } from "@/constants/typography";
import type { PaywallConfig, ProPaywallSource } from "@/lib/paywallConfig";
import { DeepAnalysisHero } from "./heroes/DeepAnalysisHero";
import { GenerateListingsHero } from "./heroes/GenerateListingsHero";
import { OrnamentRule } from "./Ornament";
import { PW } from "./paywallTheme";

export interface PaywallHeroProps {
  config: PaywallConfig;
}

/**
 * The Phase 2 placeholder.
 *
 * Named `GenericHero` rather than `DefaultHero` so that when every source has a
 * real hero, the thing left over is obviously the thing to delete.
 */
export function GenericHero({ config }: PaywallHeroProps) {
  return (
    <View style={s.hero}>
      {/*
       * Emblem.
       *
       * The 62pt gold-ringed circle is lifted straight from app/scan-store.tsx,
       * which is the only other monetization surface with a hero. Reusing it
       * means the two screens read as the same family instead of two designers'
       * opinions.
       */}
      <View style={s.emblem}>
        <MaterialIcons name="workspace-premium" size={30} color={PW.gold} />
      </View>

      <OrnamentRule width={132} />

      <Text style={s.eyebrow} accessibilityRole="header">
        {config.eyebrow}
      </Text>

      <Text style={s.headline}>{config.headline}</Text>

      <Text style={s.subtitle}>{config.subtitle}</Text>
    </View>
  );
}

/**
 * Source → hero.
 *
 * generate_listings (Phase 3) and deep_analysis (Phase 4) have real heroes. The
 * remaining three still fall through to GenericHero, which is exactly what the
 * indirection was for:
 * adding a contextual paywall is one component plus one line here, with no
 * change to the modal, the purchase engine or the plan selector.
 */
const HEROES: Partial<Record<ProPaywallSource, React.ComponentType<PaywallHeroProps>>> = {
  generate_listings: GenerateListingsHero,
  deep_analysis:     DeepAnalysisHero,
  // third_photo:    ThirdPhotoHero,     ← Phase 5
  // camera_context: AiContextHero,      ← Phase 6
  // scan_limit:     ScanLimitHero,      ← Phase 7
};

export function PaywallHero({ config }: PaywallHeroProps) {
  const Hero = HEROES[config.source] ?? GenericHero;
  return <Hero config={config} />;
}

const s = StyleSheet.create({
  hero: { alignItems: "center", paddingHorizontal: 8, gap: 10 },

  emblem: {
    width: 66,
    height: 66,
    borderRadius: 33,
    borderWidth: 1.5,
    borderColor: PW.gold,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },

  /**
   * Green, not gold.
   *
   * Gold at 11pt on parchment is roughly 2:1 contrast. ScanCircleLabel hit the
   * same wall and moved its label to dark green for exactly this reason. The
   * gold stays in the rule directly above it, where it belongs.
   */
  eyebrow: {
    fontFamily: FONTS.serif,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 2.6,
    color: PW.forest,
    marginTop: 2,
  },

  headline: {
    fontFamily: FONTS.serif,
    fontSize: 27,
    fontWeight: "800",
    color: PW.ink,
    textAlign: "center",
    lineHeight: 33,
    paddingHorizontal: 4,
  },

  subtitle: {
    fontSize: 14,
    color: PW.brown,
    textAlign: "center",
    lineHeight: 20,
    paddingHorizontal: 10,
    maxWidth: 330,
  },
});
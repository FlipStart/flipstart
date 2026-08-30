/**
 * components/monetization/paywall/heroes/ThirdPhotoHero.tsx
 *
 * The Third Photo hero: a merchant's contact sheet with the third frame still
 * unexposed.
 *
 * ── It echoes the thing they just tapped ────────────────────────────────────
 * The user pressed a gold, glimmering third slot in the camera. This hero shows
 * the same three-card row with the same gold treatment on the third card, so
 * the paywall reads as an explanation of what they touched rather than an
 * unrelated sales screen. Same PremiumGlimmer component the camera slot uses —
 * not a lookalike, the actual one — which means the sweep timing, the antique
 * gold and the Reduce Motion fallback are identical by construction.
 *
 * ── Real slot names ─────────────────────────────────────────────────────────
 * FRONT, TAG, GRAPHIC. Those are SLOT_LABELS in app/camera.tsx. The brief
 * sketched "EXTRA ANGLE" for the third card, but shipping a label the product
 * does not use would teach the user a word they will never see again — the
 * headline and subtitle carry the "another angle, detail, or tag" idea instead.
 *
 * ── Everything is drawn ─────────────────────────────────────────────────────
 * No photography, no image assets, no new packages. Cards are Views with
 * borders; the marks are MaterialIcons and react-native-svg, both already in
 * use.
 */
import React from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import Svg, { Path } from "react-native-svg";
import { FONTS } from "@/constants/typography";
import { PremiumGlimmer } from "@/components/monetization/PremiumGlimmer";
import type { PaywallHeroProps } from "../PaywallHero";
import { PW, PW_RADIUS, PW_SHADOW } from "../paywallTheme";

/** Below this height the contact sheet compresses rather than pushing plans away. */
const COMPACT_BELOW = 700;

export function ThirdPhotoHero({ config }: PaywallHeroProps) {
  const { width, height } = useWindowDimensions();
  const compact = height < COMPACT_BELOW;

  /**
   * Three cards across, sized from the real viewport rather than the brief's
   * ASCII proportions. Floored so the cards never collapse into slivers on a
   * narrow device, and capped so they do not sprawl on a Pro Max or an iPad.
   */
  const available = Math.min(width, 460) - 40 - 20; // padding + two gaps
  const cardW = Math.max(78, Math.min(compact ? 92 : 104, available / 3));
  const cardH = Math.round(cardW * (compact ? 1.06 : 1.14));

  return (
    <View style={s.hero}>
      <Text style={s.eyebrow} accessibilityRole="header">
        {config.eyebrow}
      </Text>

      <Text style={[s.headline, compact && s.headlineCompact]}>{config.headline}</Text>

      <Text style={[s.subtitle, compact && s.subtitleCompact]}>{config.subtitle}</Text>

      {/*
       * The contact sheet.
       *
       * Hidden from screen readers: the headline and subtitle already say what
       * this shows, so a VoiceOver user hearing "FRONT, TAG, GRAPHIC, PRO"
       * would get repetition rather than information.
       */}
      <View
        style={[s.sheet, compact && s.sheetCompact]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <PhotoCard label="FRONT" icon="checkroom" w={cardW} h={cardH} state="filled" />
        <PhotoCard label="TAG" icon="local-offer" w={cardW} h={cardH} state="filled" />
        <PhotoCard label="GRAPHIC" icon="auto-awesome" w={cardW} h={cardH} state="premium" />
      </View>
    </View>
  );
}

/**
 * One frame of the contact sheet.
 *
 * `filled` cards are quiet: cream paper, a soft border, a small forest tick.
 * They are context, not the pitch.
 *
 * The `premium` card carries the gold border, the glimmer and the PRO seal —
 * the same visual grammar as the camera's third slot.
 */
function PhotoCard({
  label,
  icon,
  w,
  h,
  state,
}: {
  label: string;
  icon: React.ComponentProps<typeof MaterialIcons>["name"];
  w: number;
  h: number;
  state: "filled" | "premium";
}) {
  const premium = state === "premium";

  const card = (
    <View style={[s.card, { width: w, height: h }, premium && s.cardPremium]}>
      {/* Corner ticks — the register marks on a printed contact sheet. */}
      <CornerTicks color={premium ? PW.gold : PW.border} />

      <MaterialIcons
        name={icon}
        size={Math.round(w * 0.29)}
        color={premium ? PW.gold : PW.brown}
        style={{ opacity: premium ? 1 : 0.55 }}
      />

      <Text style={[s.cardLabel, premium && s.cardLabelPremium]} numberOfLines={1}>
        {label}
      </Text>

      {premium ? (
        <View style={s.proSeal}>
          <Text style={s.proSealText} allowFontScaling={false}>
            PRO
          </Text>
        </View>
      ) : (
        <MaterialIcons name="check" size={13} color={PW.forest} style={{ opacity: 0.75 }} />
      )}
    </View>
  );

  /**
   * The premium card wraps in PremiumGlimmer — the same component the camera's
   * third slot uses, so the sweep and its Reduce Motion fallback are shared
   * rather than reimplemented. The plain cards are static; a glimmer on all
   * three would say nothing about which one is locked.
   */
  return premium ? (
    <PremiumGlimmer active size={w} radius={PW_RADIUS.card - 3}>
      {card}
    </PremiumGlimmer>
  ) : (
    card
  );
}

/** Four short corner rules, like the crop marks on a proof sheet. */
function CornerTicks({ color }: { color: string }) {
  const S = 9;
  const L = 5;
  return (
    <Svg width="100%" height="100%" style={StyleSheet.absoluteFill} pointerEvents="none">
      <Path
        d={`M ${S} ${S + L} L ${S} ${S} L ${S + L} ${S}`}
        stroke={color}
        strokeWidth={1.1}
        fill="none"
        opacity={0.8}
      />
    </Svg>
  );
}

const s = StyleSheet.create({
  hero: { alignItems: "center", gap: 8, paddingHorizontal: 4 },

  /** Green, not gold: #C4A334 on parchment is ~2:1 and unreadable at 11pt. */
  eyebrow: {
    fontFamily: FONTS.serif,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 2.6,
    color: PW.forest,
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
  headlineCompact: { fontSize: 23, lineHeight: 28 },

  subtitle: {
    fontSize: 14,
    color: PW.brown,
    textAlign: "center",
    lineHeight: 20,
    paddingHorizontal: 8,
    maxWidth: 336,
  },
  subtitleCompact: { fontSize: 12.5, lineHeight: 18 },

  sheet: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginTop: 14,
  },
  sheetCompact: { marginTop: 8, gap: 8 },

  card: {
    backgroundColor: PW.card,
    borderRadius: PW_RADIUS.card - 3,
    borderWidth: 1.1,
    borderColor: PW.border,
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    ...PW_SHADOW,
  },
  /**
   * The third card. Gold border and the warmer parchment interior — the same
   * two signals the camera's premium slot uses. No gradient and no glow: the
   * app has neither anywhere.
   */
  cardPremium: {
    borderColor: PW.gold,
    borderWidth: 1.8,
    backgroundColor: PW.goldTint,
  },

  cardLabel: {
    fontFamily: FONTS.serif,
    fontSize: 8.5,
    fontWeight: "800",
    letterSpacing: 1.2,
    color: PW.brown,
  },
  cardLabelPremium: { color: PW.forest },

  proSeal: {
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 3,
    borderWidth: 0.9,
    borderColor: PW.gold,
    backgroundColor: PW.card,
  },
  /**
   * Forest ink on cream, not gold on gold. allowFontScaling is off because the
   * seal is fixed geometry, and nothing is lost — the whole sheet is hidden
   * from screen readers.
   */
  proSealText: {
    fontFamily: FONTS.serif,
    fontSize: 7.5,
    fontWeight: "800",
    letterSpacing: 1,
    color: PW.forest,
  },
});
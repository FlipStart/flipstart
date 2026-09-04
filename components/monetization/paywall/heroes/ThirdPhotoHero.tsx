/**
 * components/monetization/paywall/heroes/ThirdPhotoHero.tsx
 *
 * The Third Photo hero: a contact sheet with the third frame lit.
 *
 * ── It echoes the thing they just tapped ────────────────────────────────────
 * The user pressed a gold, glimmering third slot in the camera. This hero shows
 * the same three-frame row with the same gold treatment on the third frame, so
 * the paywall reads as an explanation of what they touched rather than an
 * unrelated sales screen. It wraps the frame in the SAME PremiumGlimmer the
 * camera slot uses — not a lookalike — so the sweep timing, the antique gold
 * and the Reduce Motion fallback are identical by construction.
 *
 * ── EXTRA PHOTO, not GRAPHIC and not DETAIL ────────────────────────────────
 * The camera captions its third slot "Graphic" (SLOT_LABELS in app/camera.tsx).
 * That word is right for a printed tee and wrong for a lamp — but repeating it
 * here would teach a word the paywall cannot stand behind, and inventing a
 * different specific word (DETAIL) would create a mismatch with the camera the
 * user is about to return to. So the frame says what the feature IS: an EXTRA
 * PHOTO, with the PRO seal beneath. Generic, truthful, and true no matter what
 * the camera calls the slot. The camera's caption is unchanged in this pass.
 *
 * ── Lit, not locked ─────────────────────────────────────────────────────────
 * The third frame is the desirable one, not the unavailable one. It carries
 * the warm gold interior, the hairline inner rule the selected plan card uses,
 * a spark at the corner and a PRO seal — the visual grammar of "the good
 * one", never a padlock or a greyed-out box.
 *
 * ── Motion ──────────────────────────────────────────────────────────────────
 * One entrance via the shared useHeroReveal: the three frames settle in order,
 * left to right, so the eye lands on the third. Then still — except the
 * PremiumGlimmer sweep, which is the camera's own ambient loop and the reason
 * this hero turns the masthead glint OFF: two slow loops is the budget, three
 * is a casino. Reduce Motion renders the finished sheet.
 *
 * ── Everything is drawn ─────────────────────────────────────────────────────
 * No photography, no image assets, no new packages. Frames are Views with
 * borders; the marks are MaterialIcons and react-native-svg.
 */
import React from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import Svg, { Path } from "react-native-svg";
import { FONTS } from "@/constants/typography";
import { PremiumGlimmer } from "@/components/monetization/PremiumGlimmer";
import type { PaywallHeroProps } from "../PaywallHero";
import { PaywallMasthead, Spark } from "../PaywallMasthead";
import { Reveal, useHeroReveal } from "../HeroReveal";
import { PW, PW_RADIUS, PW_SHADOW } from "../paywallTheme";

/** Below this height the sheet compresses rather than pushing plans away. */
const COMPACT_BELOW = 740;

export function ThirdPhotoHero({ config }: PaywallHeroProps) {
  const { width, height } = useWindowDimensions();
  const compact = height < COMPACT_BELOW;
  const { progress } = useHeroReveal();

  /**
   * Three frames across, sized from the real viewport. Floored so they never
   * collapse into slivers on a narrow phone, capped so they do not sprawl on
   * a Pro Max or an iPad.
   */
  const gap = compact ? 8 : 10;
  const available = Math.min(width, 460) - 40 - gap * 2;
  const frameW = Math.max(78, Math.min(compact ? 82 : 86, available / 3));
  const frameH = Math.round(frameW * (compact ? 0.98 : 1.0));

  return (
    <View style={s.hero}>
      <PaywallMasthead feature="THIRD PHOTO" accessibilityLabel="FlipStart, Third Photo" glint={false} />

      <Text style={[s.headline, compact && s.headlineCompact]}>{config.headline}</Text>
      <Text style={[s.subtitle, compact && s.subtitleCompact]}>{config.subtitle}</Text>

      {/*
       * The contact sheet. Hidden from screen readers: the headline and
       * subtitle already say what this shows, so hearing "FRONT, TAG,
       * EXTRA PHOTO, PRO" would be repetition rather than information.
       */}
      <View
        style={[s.sheet, compact && s.sheetCompact, { gap }]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Reveal progress={progress} at={0} span={0.4} dy={6}>
          <Frame label="FRONT" icon="checkroom" w={frameW} h={frameH} state="filled" />
        </Reveal>
        <Reveal progress={progress} at={0.16} span={0.4} dy={6}>
          <Frame label="TAG" icon="local-offer" w={frameW} h={frameH} state="filled" />
        </Reveal>
        <Reveal progress={progress} at={0.34} span={0.45} dy={6}>
          <Frame label="EXTRA PHOTO" icon="add-a-photo" w={frameW} h={frameH} state="premium" />
        </Reveal>
      </View>
    </View>
  );
}

/**
 * One frame of the contact sheet.
 *
 * `filled` frames are quiet: paper, a soft border, a small forest tick. They
 * are context, not the pitch. The `premium` frame carries the gold border, the
 * warm interior, the inner hairline, the corner spark, the glimmer and the PRO
 * seal — the same grammar as the camera's third slot and the selected plan.
 */
function Frame({ label, icon, w, h, state }: {
  label: string;
  icon: React.ComponentProps<typeof MaterialIcons>["name"];
  w: number; h: number;
  state: "filled" | "premium";
}) {
  const premium = state === "premium";

  const frame = (
    <View style={[s.frame, { width: w, height: h }, premium && s.framePremium]}>
      <CornerTicks color={premium ? PW.gold : PW.border} />
      {premium && <View pointerEvents="none" style={s.innerRule} />}
      {premium && <View style={s.cornerSpark}><Spark size={10} /></View>}

      <MaterialIcons
        name={icon}
        size={Math.round(w * 0.3)}
        color={premium ? PW.gold : PW.brown}
        style={{ opacity: premium ? 1 : 0.55 }}
      />

      <Text style={[s.frameLabel, premium && s.frameLabelPremium]} numberOfLines={1} allowFontScaling={false}
        adjustsFontSizeToFit minimumFontScale={0.85}>
        {label}
      </Text>

      {premium ? (
        <View style={s.proSeal}>
          <Text style={s.proSealText} allowFontScaling={false}>PRO</Text>
        </View>
      ) : (
        <MaterialIcons name="check" size={13} color={PW.forest} style={{ opacity: 0.75 }} />
      )}
    </View>
  );

  return premium ? (
    <PremiumGlimmer active size={w} radius={PW_RADIUS.card - 3}>
      {frame}
    </PremiumGlimmer>
  ) : frame;
}

/** Four short corner rules — the register marks on a printed proof sheet. */
function CornerTicks({ color }: { color: string }) {
  const S = 8, L = 5;
  return (
    <Svg width="100%" height="100%" style={StyleSheet.absoluteFill} pointerEvents="none">
      <Path d={`M ${S} ${S + L} L ${S} ${S} L ${S + L} ${S}`} stroke={color} strokeWidth={1.1} fill="none" opacity={0.8} />
    </Svg>
  );
}

const s = StyleSheet.create({
  hero: { alignItems: "center", gap: 4, paddingHorizontal: 4 },

  headline: {
    fontFamily: FONTS.serif, fontSize: 28, fontWeight: "800",
    color: PW.ink, textAlign: "center", lineHeight: 32, marginTop: 2,
  },
  headlineCompact: { fontSize: 25, lineHeight: 29 },
  subtitle: {
    fontSize: 14.5, color: PW.brown, textAlign: "center", lineHeight: 19,
    paddingHorizontal: 12, maxWidth: 360, fontWeight: "500",
  },
  subtitleCompact: { fontSize: 13.5, lineHeight: 18 },

  sheet: { flexDirection: "row", alignItems: "center", justifyContent: "center", marginTop: 4 },
  sheetCompact: { marginTop: 6 },

  frame: {
    backgroundColor: PW.card,
    borderRadius: PW_RADIUS.card - 3,
    borderWidth: 1.1, borderColor: PW.border,
    alignItems: "center", justifyContent: "center", gap: 5,
    overflow: "hidden",
    ...PW_SHADOW,
  },
  /** Gold border and the warm interior — the camera's premium slot, exactly. */
  framePremium: {
    borderColor: PW.gold, borderWidth: 1.8,
    backgroundColor: PW.goldTint,
    shadowColor: PW.gold, shadowOpacity: 0.22, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  /** The hairline just inside the edge — the selected plan card's detail. */
  innerRule: {
    position: "absolute", top: 3, left: 3, right: 3, bottom: 3,
    borderRadius: PW_RADIUS.card - 6,
    borderWidth: 1, borderColor: "rgba(196,163,52,0.5)",
  },
  cornerSpark: { position: "absolute", top: 6, right: 6 },

  frameLabel: {
    fontFamily: FONTS.serif, fontSize: 8, fontWeight: "800",
    letterSpacing: 1.1, color: PW.brown,
  },
  frameLabelPremium: { color: PW.forest },

  proSeal: {
    paddingHorizontal: 6, paddingVertical: 1.5, borderRadius: 3,
    borderWidth: 0.9, borderColor: PW.gold, backgroundColor: PW.card,
  },
  /** Forest ink on paper, not gold on gold. */
  proSealText: {
    fontFamily: FONTS.serif, fontSize: 7.5, fontWeight: "800",
    letterSpacing: 1, color: PW.forest,
  },
});
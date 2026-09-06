/**
 * components/onboarding/OnboardingShell.tsx
 *
 * The one layout every onboarding screen sits in.
 *
 * ── What it owns ────────────────────────────────────────────────────────────
 * Safe areas, the back button, the progress bar, an optional brand row, the
 * headline and supporting line, a body that scrolls only when it must, and a
 * bottom CTA that stays reachable. Screens supply content and copy; they do
 * not lay themselves out.
 *
 * ── Progress is a fraction, not a step count ────────────────────────────────
 * The shell is told `progress` (0–1) and nothing else. The quiz computes it
 * from its own stage list, so adding stages in Phase B changes one array, not
 * this file. `progress === null` hides the bar (Welcome).
 *
 * ── Motion ──────────────────────────────────────────────────────────────────
 * The bar interpolates to its new width in ~320ms. The CTA gives 2% under the
 * finger. Nothing loops. Reanimated's default `ReduceMotion.System` means
 * both respect the OS setting without a manual AccessibilityInfo read.
 *
 * ── Two CTA modes, because one bottom-pin made every sparse screen hollow ───
 * `ctaPlacement="bottom"` is the original: body flexes, CTA sits above the
 * home indicator. Right when the content fills the screen.
 *
 * `ctaPlacement="content"` puts the CTA immediately after the content with one
 * measured gap, and lets the leftover space fall BELOW it. On a three-option
 * question that turns a 40% hole in the middle of the screen into ordinary
 * bottom margin, and the button stops looking marooned.
 *
 * Screens choose; neither hardcodes a position. On a small phone the
 * content-following body still scrolls, and the CTA travels with it rather
 * than covering it.
 *
 * ── The Welcome pulse ───────────────────────────────────────────────────────
 * The two entry buttons breathe: a small lift and a 2.8% swell, then a long
 * rest — about one beat every three seconds, staggered so Get Started leads
 * and Log In answers rather than the pair twitching in unison.
 *
 * OPT-IN, and only Welcome opts in. A heartbeat under every Continue for nine
 * screens would be noise, and a button that moves while you are reading the
 * question above it is a distraction. It also stops while pressed and never
 * runs on a disabled button — a control that pulses but cannot be tapped is a
 * lie. Reduce Motion removes it entirely.
 *
 * ── Less ornate than the paywalls ───────────────────────────────────────────
 * Same tokens (PW), same serif, the same hairline gold trim on the CTA — but
 * no glints, no seals. Onboarding should feel fast.
 */
import React, { useEffect, useState } from "react";
import {
  AccessibilityInfo, Pressable, ScrollView, StyleSheet, Text, View,
  type StyleProp, type ViewStyle,
} from "react-native";
import Animated, {
  useAnimatedStyle, useSharedValue, withTiming, withDelay, withSequence, withRepeat, Easing,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { FONTS } from "@/constants/typography";
import { Spark } from "@/components/monetization/paywall/PaywallMasthead";
import { OnboardingMasthead } from "./OnboardingMasthead";
import { PW, PW_RADIUS } from "@/components/monetization/paywall/paywallTheme";

export interface OnboardingShellProps {
  /** 0–1 fills the bar; null hides it (Welcome). */
  progress: number | null;
  /** Omit to hide the back button (Welcome). */
  onBack?: () => void;
  /** Welcome's full-size ✦ FLIPSTART ✦ block. */
  brand?: boolean;
  /** Tiny tracked line under the brand, e.g. THRIFT INTELLIGENCE. */
  brandLine?: string;
  /** The compact masthead — every screen past Welcome. */
  masthead?: boolean;
  /** Small tracked gold label above the title, e.g. QUESTION 1 OF 3. */
  eyebrow?: string;
  headline: string;
  /**
   * One phrase inside `headline` to set in forest green. Must appear in it
   * verbatim; ignored otherwise, so a copy edit can never crash the screen.
   */
  accent?: string;
  support?: string;
  children?: React.ReactNode;
  cta?: {
    label: string;
    onPress: () => void;
    disabled?: boolean;
    /** Small tracked label above the button, e.g. NEW HERE?. */
    kicker?: string;
    /** Slow breathing pulse. Welcome only — see the header. */
    pulse?: boolean;
  };
  /**
   * A second, equally substantial action under the primary one — outlined
   * rather than filled, so the hierarchy still favours the primary without
   * demoting this to a text link. Welcome uses it for Log In.
   */
  secondaryCta?: {
    label: string;
    onPress: () => void;
    disabled?: boolean;
    kicker?: string;
    pulse?: boolean;
  };
  /** Rendered under the CTA — a text link, a notice. */
  footer?: React.ReactNode;
  /** Centre the headline block (Welcome). Questions are left-aligned. */
  centered?: boolean;
  /**
   * Where the CTA sits. "content" follows the content block (sparse screens);
   * "bottom" pins above the home indicator (dense/scrolling screens).
   */
  ctaPlacement?: "content" | "bottom";
  bodyStyle?: StyleProp<ViewStyle>;
}

export function OnboardingShell({
  progress, onBack, brand = false, brandLine, masthead = false, eyebrow,
  headline, accent, support, children, cta, secondaryCta, footer,
  centered = false, ctaPlacement = "bottom", bodyStyle,
}: OnboardingShellProps) {
  const insets = useSafeAreaInsets();
  const follows = ctaPlacement === "content";

  const actions = (cta || secondaryCta || footer) ? (
    <View style={[s.actions, follows && s.actionsFollowing]}>
      {cta && (
        <View style={s.ctaGroup}>
          {!!cta.kicker && <Text style={s.ctaKicker} allowFontScaling={false}>{cta.kicker}</Text>}
          <PrimaryCTA label={cta.label} onPress={cta.onPress} disabled={cta.disabled} pulse={cta.pulse} />
        </View>
      )}
      {secondaryCta && (
        <View style={s.ctaGroup}>
          {!!secondaryCta.kicker && <Text style={s.ctaKicker} allowFontScaling={false}>{secondaryCta.kicker}</Text>}
          <SecondaryCTA label={secondaryCta.label} onPress={secondaryCta.onPress} disabled={secondaryCta.disabled}
            pulse={secondaryCta.pulse} pulseDelay={PULSE_STAGGER_MS} />
        </View>
      )}
      {footer}
    </View>
  ) : null;

  return (
    /* +8 above the OS inset: the top bar was sitting under the Dynamic Island. */
    <View style={[s.root, { paddingTop: Math.max(insets.top, 12) + 8 }]}>
      {/* ── Top bar: back | progress | spacer ─────────────────────────── */}
      <View style={s.topBar}>
        {onBack ? (
          <Pressable
            onPress={onBack}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Back"
            style={({ pressed }) => [s.backBtn, pressed && { opacity: 0.6 }]}
          >
            <MaterialIcons name="arrow-back" size={20} color={PW.forest} />
          </Pressable>
        ) : (
          <View style={s.topSpacer} />
        )}
        <View style={s.progressSlot}>
          {progress !== null && <ProgressBar value={progress} />}
        </View>
        <View style={s.topSpacer} />
      </View>

      {/* ── Head ──────────────────────────────────────────────────────── */}
      <View style={[s.head, centered && s.headCentered]}>
        {masthead && <View style={s.mastheadSlot}><OnboardingMasthead /></View>}
        {brand && (
          <View style={s.brandBlock}>
            <View style={s.brandRow} accessibilityRole="header" accessibilityLabel="FlipStart">
              <Spark size={13} />
              <Text style={s.brand} allowFontScaling={false}>FLIPSTART</Text>
              <Spark size={13} />
            </View>
            {!!brandLine && <Text style={s.brandLine} allowFontScaling={false}>{brandLine}</Text>}
          </View>
        )}
        {!!eyebrow && (
          <View style={[s.eyebrowRow, centered && s.eyebrowRowCentered]}>
            <View style={s.eyebrowRule} />
            <Text style={s.eyebrow} allowFontScaling={false}>{eyebrow}</Text>
          </View>
        )}
        <Headline text={headline} accent={accent} centered={centered} />
        {!!support && <Text style={[s.support, centered && s.supportCentered]}>{support}</Text>}
      </View>

      {/* ── Body ──────────────────────────────────────────────────────── */}
      <ScrollView
        style={s.body}
        contentContainerStyle={[
          s.bodyContent,
          { paddingBottom: follows ? Math.max(insets.bottom, 12) + 20 : 12 },
          bodyStyle,
        ]}
        showsVerticalScrollIndicator={false}
        alwaysBounceVertical={false}
        keyboardShouldPersistTaps="handled"
      >
        {children}
        {/* Content-following: the CTA rides inside the scroll, right under the
            content, and the leftover space falls below it instead of between. */}
        {follows && actions}
      </ScrollView>

      {/* Bottom-anchored: pinned above the home indicator. */}
      {!follows && (
        <View style={[s.footer, { paddingBottom: Math.max(insets.bottom, 12) + 6 }]}>
          {actions}
        </View>
      )}
    </View>
  );
}

/**
 * The title, with one optional phrase in forest green.
 *
 * Split on the accent rather than accepting rich children, so a screen passes
 * plain strings and the emphasis rule lives in one place. An accent that isn't
 * present renders the title unchanged.
 *
 * Size steps down as the title grows: a short headline gets the full 28pt, a
 * long one 25 or 23, which is what stops "What do you want FlipStart to help
 * with?" becoming four enormous lines.
 */
function Headline({ text, accent, centered }: { text: string; accent?: string; centered: boolean }) {
  const size = text.length > 44 ? s.headlineSm : text.length > 32 ? s.headlineMd : null;
  const style = [s.headline, size, centered && s.headlineCentered].filter(Boolean);

  const at = accent ? text.indexOf(accent) : -1;
  if (at < 0) {
    return <Text style={style} accessibilityRole="header" maxFontSizeMultiplier={1.4}>{text}</Text>;
  }
  return (
    <Text style={style} accessibilityRole="header" maxFontSizeMultiplier={1.4}>
      {text.slice(0, at)}
      <Text style={s.headlineAccent}>{accent}</Text>
      {text.slice(at + accent!.length)}
    </Text>
  );
}

// ── Progress bar ────────────────────────────────────────────────────────────

const BAR_MS = 320;

function ProgressBar({ value }: { value: number }) {
  const fill = useSharedValue(value);
  React.useEffect(() => {
    fill.value = withTiming(Math.max(0, Math.min(1, value)), { duration: BAR_MS, easing: Easing.out(Easing.cubic) });
  }, [value, fill]);
  const style = useAnimatedStyle(() => ({ width: `${fill.value * 100}%` }));

  return (
    <View
      style={s.track}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(value * 100) }}
    >
      <Animated.View style={[s.fillBar, style]}>
        <View style={s.fillTip} />
      </Animated.View>
    </View>
  );
}

// ── The Welcome pulse ───────────────────────────────────────────────────────

const PULSE_RISE_MS = 260;
const PULSE_FALL_MS = 440;
/** Between beats. Long enough that it reads as breathing, not blinking. */
const PULSE_REST_MS = 2200;
const PULSE_START_MS = 900;
/** Log In answers Get Started rather than moving with it. */
const PULSE_STAGGER_MS = 190;

/**
 * A 0 → 1 → 0 beat on a long rest, or a flat 0 when it should not run.
 * Shared by both buttons so they cannot drift apart in feel.
 */
function useCtaPulse(active: boolean, delay: number) {
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
  }, []);

  const beat = useSharedValue(0);
  useEffect(() => {
    if (!active || reduceMotion) { beat.value = withTiming(0, { duration: 160 }); return; }
    beat.value = 0;
    beat.value = withDelay(PULSE_START_MS + delay, withRepeat(
      withSequence(
        withTiming(1, { duration: PULSE_RISE_MS, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: PULSE_FALL_MS, easing: Easing.inOut(Easing.quad) }),
        withDelay(PULSE_REST_MS, withTiming(0, { duration: 0 })),
      ), -1, false,
    ));
  }, [active, reduceMotion, delay, beat]);

  return beat;
}

/** The lift and swell, combined with the press give so one cannot cancel the other. */
const PULSE_LIFT = 3;
const PULSE_SWELL = 0.028;

// ── Primary CTA ─────────────────────────────────────────────────────────────

function PrimaryCTA({ label, onPress, disabled = false, pulse = false }: {
  label: string; onPress: () => void; disabled?: boolean; pulse?: boolean;
}) {
  const pressed = useSharedValue(0);
  // Never while disabled: a button that beats but cannot be tapped is a lie.
  const beat = useCtaPulse(pulse && !disabled, 0);
  const give = useAnimatedStyle(() => {
    // The beat yields to the finger, so a press always reads as a press.
    const live = beat.value * (1 - pressed.value);
    return {
      transform: [
        { translateY: -live * PULSE_LIFT },
        { scale: (1 + live * PULSE_SWELL) * (1 - pressed.value * 0.02) },
      ],
    };
  });

  return (
    <Animated.View style={give}>
      <Pressable
        onPress={disabled ? undefined : onPress}
        disabled={disabled}
        onPressIn={() => { pressed.value = withTiming(1, { duration: 80 }); }}
        onPressOut={() => { pressed.value = withTiming(0, { duration: 140 }); }}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        style={[s.cta, disabled && s.ctaDisabled]}
      >
        <View pointerEvents="none" style={[s.ctaTrim, disabled && s.ctaTrimDisabled]} />
        <Text style={[s.ctaText, disabled && s.ctaTextDisabled]} allowFontScaling={false}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

/**
 * The second action. Same width and near-identical height as the primary, so
 * both read as real choices — outlined card white with forest text and the
 * same hairline gold trim, which is the paywall's own secondary treatment.
 */
function SecondaryCTA({ label, onPress, disabled = false, pulse = false, pulseDelay = 0 }: {
  label: string; onPress: () => void; disabled?: boolean; pulse?: boolean; pulseDelay?: number;
}) {
  const pressed = useSharedValue(0);
  const beat = useCtaPulse(pulse && !disabled, pulseDelay);
  const give = useAnimatedStyle(() => {
    const live = beat.value * (1 - pressed.value);
    return {
      transform: [
        // Two thirds of the primary's travel: it answers, it does not compete.
        { translateY: -live * PULSE_LIFT * 0.66 },
        { scale: (1 + live * PULSE_SWELL * 0.66) * (1 - pressed.value * 0.02) },
      ],
    };
  });

  return (
    <Animated.View style={give}>
      <Pressable
        onPress={disabled ? undefined : onPress}
        disabled={disabled}
        onPressIn={() => { pressed.value = withTiming(1, { duration: 80 }); }}
        onPressOut={() => { pressed.value = withTiming(0, { duration: 140 }); }}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        style={[s.secondaryCta, disabled && s.secondaryDisabled]}
      >
        <View pointerEvents="none" style={s.secondaryTrim} />
        <Text style={s.secondaryCtaText} allowFontScaling={false}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: PW.parchment },

  topBar: {
    flexDirection: "row", alignItems: "center", gap: 14,
    paddingHorizontal: 16, height: 48,
  },
  backBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  topSpacer: { width: 36, height: 36 },
  progressSlot: { flex: 1, justifyContent: "center" },

  track: {
    height: 4, borderRadius: 2, overflow: "hidden",
    backgroundColor: "rgba(196,163,52,0.28)",
  },
  fillBar: { height: "100%", backgroundColor: PW.forest, borderRadius: 2, justifyContent: "center", alignItems: "flex-end" },
  /** A 2pt gold tip on the leading edge — the only gold on the bar. */
  fillTip: { width: 3, height: "100%", backgroundColor: PW.gold, opacity: 0.9 },

  head: { paddingHorizontal: 24, paddingTop: 6, paddingBottom: 6, gap: 8 },
  headCentered: { alignItems: "center" },
  mastheadSlot: { alignSelf: "center", marginBottom: 12 },

  eyebrowRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: -2 },
  eyebrowRowCentered: { justifyContent: "center" },
  eyebrowRule: { width: 16, height: 1, backgroundColor: "rgba(196,163,52,0.8)" },
  /**
   * Brown, not gold. Gold on white is 2.4:1 — fine for a rule, unreadable for
   * 9.5pt text. The gold lives in the rule beside it, which carries no meaning.
   */
  eyebrow: { fontFamily: FONTS.serif, fontSize: 9.5, fontWeight: "800", letterSpacing: 2, color: PW.brown },
  brandBlock: { alignItems: "center", gap: 6, marginBottom: 10 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 9 },
  brand: { fontFamily: FONTS.serif, fontSize: 19, fontWeight: "800", letterSpacing: 5, color: PW.forest },
  brandLine: { fontFamily: FONTS.serif, fontSize: 9.5, fontWeight: "800", letterSpacing: 2.4, color: PW.brown },

  headline: { fontFamily: FONTS.serif, fontSize: 28, fontWeight: "800", lineHeight: 34, color: PW.ink, maxWidth: 340 },
  headlineMd: { fontSize: 25, lineHeight: 31 },
  headlineSm: { fontSize: 23, lineHeight: 29 },
  /** The one coloured phrase. Forest, never a second accent colour. */
  headlineAccent: { color: PW.forest },
  headlineCentered: { textAlign: "center", fontSize: 30, lineHeight: 36, maxWidth: undefined },
  support: { fontSize: 14.5, lineHeight: 20, color: PW.brown, fontWeight: "500" },
  supportCentered: { textAlign: "center", paddingHorizontal: 8 },

  body: { flex: 1 },
  bodyContent: { paddingHorizontal: 20, paddingTop: 12, gap: 10 },

  footer: { paddingHorizontal: 20, paddingTop: 8 },
  actions: { gap: 12 },
  /** The measured gap between content and a content-following CTA. */
  actionsFollowing: { marginTop: 22 },
  ctaGroup: { gap: 6 },
  ctaKicker: {
    fontFamily: FONTS.serif, fontSize: 9, fontWeight: "800",
    letterSpacing: 1.6, color: PW.brown, textAlign: "center",
  },

  cta: {
    backgroundColor: PW.forest,
    borderRadius: PW_RADIUS.pill,
    minHeight: 54,
    alignItems: "center", justifyContent: "center",
    paddingHorizontal: 22,
    overflow: "hidden",
    shadowColor: PW.forestDeep, shadowOpacity: 0.22, shadowRadius: 12, shadowOffset: { width: 0, height: 5 },
    elevation: 4,
  },
  /**
   * Disabled, not broken. A muted forest fill with its own border keeps the
   * button's structure — the old flat 0.45 opacity read as a rendering fault.
   */
  ctaDisabled: {
    // #5F7562: muted forest, still 4.3:1 against the cream label. The lighter
    // sage that reads "disabled" at a glance measured 2.3:1 and was unreadable.
    backgroundColor: "#5F7562",
    borderWidth: 1, borderColor: "rgba(33,77,45,0.28)",
    shadowOpacity: 0, elevation: 0,
  },
  /** The paywall CTA's hairline gold trim — same numbers. */
  ctaTrim: {
    position: "absolute", top: 3, left: 3, right: 3, bottom: 3,
    borderRadius: PW_RADIUS.pill - 3, borderWidth: 1, borderColor: "rgba(212,180,84,0.55)",
  },
  ctaTrimDisabled: { borderColor: "rgba(255,255,255,0.28)" },
  ctaText: { fontFamily: FONTS.serif, fontSize: 17, fontWeight: "800", color: PW.cream, letterSpacing: 0.2 },
  ctaTextDisabled: { color: PW.cream, opacity: 0.92 },

  secondaryCta: {
    backgroundColor: PW.card,
    borderRadius: PW_RADIUS.pill,
    borderWidth: 1.6,
    borderColor: PW.forest,
    minHeight: 52,
    alignItems: "center", justifyContent: "center",
    paddingHorizontal: 22,
    overflow: "hidden",
  },
  secondaryTrim: {
    position: "absolute", top: 3, left: 3, right: 3, bottom: 3,
    borderRadius: PW_RADIUS.pill - 3, borderWidth: 1, borderColor: "rgba(196,163,52,0.45)",
  },
  /** Outlined: mute the border and the ink, keep the shape. */
  secondaryDisabled: { borderColor: "rgba(33,77,45,0.30)", opacity: 0.7 },
  secondaryCtaText: { fontFamily: FONTS.serif, fontSize: 16.5, fontWeight: "800", color: PW.forest, letterSpacing: 0.2 },
});
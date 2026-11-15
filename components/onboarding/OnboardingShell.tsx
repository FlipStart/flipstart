/**
 * components/onboarding/OnboardingShell.tsx
 *
 * The one layout every onboarding screen after Welcome sits in.
 *
 * ── What it owns (V2) ───────────────────────────────────────────────────────
 *   OnboardingHeader   FlipStart / ✦ ONBOARDING ✦ / full-width hairline, with
 *                      the back button in the header row — the live Home
 *                      header, so onboarding looks like the app it opens into.
 *   OnboardingProgress segmented bar BELOW the brand, never above it.
 *   Head               a readable step label (or, on the result screen, a small
 *                      gold kicker), the headline (one phrase may be forest),
 *                      one supporting line in ink.
 *   Body               the screen's content. It scrolls only if it must (large
 *                      accessibility text); screens are designed to fit.
 *   Actions            one filled OnboardingButton, plus an optional footer
 *                      (a text link, a notice).
 *
 * ── Progress is a fraction ──────────────────────────────────────────────────
 * Screens pass `progress` (0–1); the bar rounds it to whole segments.
 * `progress === null` hides the bar.
 *
 * ── Two CTA placements ──────────────────────────────────────────────────────
 * "bottom" pins the button above the home indicator (the default, and the V2
 * spec). "content" puts it straight after the content with the leftover space
 * below — kept for the pre-V2 screens that still use it until they are
 * rebuilt in later phases.
 *
 * ── Colour ──────────────────────────────────────────────────────────────────
 * Ink for every sentence, forest for emphasis. No brown. See onboardingTheme.
 * Nothing loops or pulses.
 */
import React from "react";
import {
  KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FONTS } from "@/constants/typography";
import { OB, OB_SPACE } from "./onboardingTheme";
import { OnboardingHeader } from "./OnboardingHeader";
import { OnboardingProgress } from "./OnboardingProgress";
import { OnboardingButton } from "./OnboardingButton";
import { useOnboardingLayout } from "./useOnboardingLayout";

export interface OnboardingShellProps {
  /** 0–1 fills the bar; null hides it. */
  progress: number | null;
  /** Omit to hide the back button. */
  onBack?: () => void;
  /** A readable step label above the title, e.g. "Question 1 of 4". */
  eyebrow?: string;
  /**
   * A small tracked label in readable gold above the title ("YOUR FLIPSTART
   * PROFILE"). The same job as `eyebrow` for a screen that is not a question.
   */
  kicker?: string;
  /** A one-line lead-in above the title, in italic serif. */
  lead?: string;
  headline: string;
  /**
   * One phrase inside `headline` to set in forest green. Must appear in it
   * verbatim; ignored otherwise, so a copy edit can never crash the screen.
   */
  accent?: string;
  support?: string;
  /** Appended to `support` in forest, after a middle dot — e.g. "3 selected". */
  supportAccent?: string;
  children?: React.ReactNode;
  cta?: {
    label: string;
    onPress: () => void;
    disabled?: boolean;
  };
  /** Rendered under the button — a text link, a notice. */
  footer?: React.ReactNode;
  /** Centre the headline block. Questions are left-aligned. */
  centered?: boolean;
  /** Where the button sits. See the header. */
  ctaPlacement?: "content" | "bottom";
  bodyStyle?: StyleProp<ViewStyle>;
  /**
   * The one screen with a text field (Question 4's "Other") sets this: the
   * layout lifts above the keyboard and the body can be scrolled to the field.
   */
  avoidKeyboard?: boolean;
  scrollRef?: React.RefObject<ScrollView | null>;
}

export function OnboardingShell({
  progress, onBack, eyebrow, kicker, lead, headline, accent, support, supportAccent, children, cta, footer,
  centered = false, ctaPlacement = "bottom", bodyStyle, avoidKeyboard = false, scrollRef,
}: OnboardingShellProps) {
  const insets = useSafeAreaInsets();
  const { compact } = useOnboardingLayout();
  const follows = ctaPlacement === "content";

  const actions = (cta || footer) ? (
    <View style={[s.actions, follows && s.actionsFollowing]}>
      {cta && <OnboardingButton label={cta.label} onPress={cta.onPress} disabled={cta.disabled} />}
      {footer}
    </View>
  ) : null;

  const Root = avoidKeyboard ? KeyboardAvoidingView : View;
  const rootProps = avoidKeyboard ? { behavior: Platform.OS === "ios" ? ("padding" as const) : undefined } : {};

  return (
    <Root style={s.root} {...rootProps}>
      <OnboardingHeader onBack={onBack} compact={compact} />

      {progress !== null && (
        <View style={[s.progress, compact && s.progressCompact]}><OnboardingProgress value={progress} /></View>
      )}

      <View style={[s.head, compact && s.headCompact, centered && s.headCentered]}>
        {!!eyebrow && <Text style={[s.eyebrow, centered && s.textCentered]} maxFontSizeMultiplier={1.3}>{eyebrow}</Text>}
        {!!kicker && <Text style={[s.kicker, centered && s.textCentered]} maxFontSizeMultiplier={1.3}>{kicker}</Text>}
        {!!lead && <Text style={[s.lead, centered && s.textCentered]} maxFontSizeMultiplier={1.3}>{lead}</Text>}
        <Headline text={headline} accent={accent} centered={centered} compact={compact} />
        {!!support && (
          <Text style={[s.support, centered && s.textCentered]} maxFontSizeMultiplier={1.3}>
            {support}
            {!!supportAccent && <Text style={s.supportAccent}>{` \u00B7 ${supportAccent}`}</Text>}
          </Text>
        )}
      </View>

      <ScrollView
        ref={scrollRef}
        style={s.body}
        contentContainerStyle={[
          s.bodyContent,
          compact && s.bodyContentCompact,
          { paddingBottom: follows ? Math.max(insets.bottom, 12) + 20 : 12 },
          bodyStyle,
        ]}
        showsVerticalScrollIndicator={false}
        alwaysBounceVertical={false}
        keyboardShouldPersistTaps="handled"
      >
        {children}
        {follows && actions}
      </ScrollView>

      {!follows && actions && (
        <View style={[s.footer, { paddingBottom: Math.max(insets.bottom, 12) + 6 }]}>
          {actions}
        </View>
      )}
    </Root>
  );
}

/**
 * The title, with one optional phrase in forest.
 *
 * Steps down as it grows so a long question stays at two lines: 28pt, then
 * 26, then 24. A short phone caps it at 24 to give the answers the room.
 */
function Headline({ text, accent, centered, compact = false }: { text: string; accent?: string; centered: boolean; compact?: boolean }) {
  const size = compact ? s.headlineSm : text.length > 44 ? s.headlineSm : text.length > 32 ? s.headlineMd : null;
  const style = [s.headline, size, centered && s.textCentered].filter(Boolean);

  const at = accent ? text.indexOf(accent) : -1;
  if (at < 0) {
    return <Text style={style} accessibilityRole="header" maxFontSizeMultiplier={1.3}>{text}</Text>;
  }
  return (
    <Text style={style} accessibilityRole="header" maxFontSizeMultiplier={1.3}>
      {text.slice(0, at)}
      <Text style={s.headlineAccent}>{accent}</Text>
      {text.slice(at + accent!.length)}
    </Text>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: OB.background },

  progress: { paddingHorizontal: OB_SPACE.gutter, marginTop: 14 },
  progressCompact: { marginTop: 10 },

  head: { paddingHorizontal: OB_SPACE.gutter, paddingTop: 16, gap: 6 },
  headCompact: { paddingTop: 12 },
  headCentered: { alignItems: "center" },
  textCentered: { textAlign: "center" },

  /** "Question 1 of 4": readable, green, sentence case — not tiny tracked caps. */
  eyebrow: { fontSize: 13, lineHeight: 18, fontWeight: "700", color: OB.forest },
  /** The readable gold (4.7:1), small and tracked — the one place gold carries words. */
  kicker: { fontSize: 10.5, lineHeight: 14, fontWeight: "800", letterSpacing: 1.6, color: OB.goldText },
  /** Hunt Mode's italic-serif lead line. */
  lead: { fontFamily: FONTS.serif, fontStyle: "italic", fontSize: 16, lineHeight: 22, color: OB.ink },
  headline: { fontFamily: FONTS.serif, fontSize: 28, lineHeight: 34, fontWeight: "700", color: OB.ink },
  headlineMd: { fontSize: 26, lineHeight: 32 },
  headlineSm: { fontSize: 24, lineHeight: 30 },
  headlineAccent: { color: OB.forest },
  support: { fontSize: 16, lineHeight: 23, color: OB.ink },
  supportAccent: { fontWeight: "800", color: OB.forest },

  body: { flex: 1 },
  bodyContent: { paddingHorizontal: OB_SPACE.gutter, paddingTop: 16, gap: 10 },
  bodyContentCompact: { paddingTop: 12 },

  footer: { paddingHorizontal: OB_SPACE.gutter, paddingTop: 8 },
  actions: { gap: 6 },
  actionsFollowing: { marginTop: 22 },
});
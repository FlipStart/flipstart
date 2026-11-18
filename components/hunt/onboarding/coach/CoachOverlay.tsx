/**
 * components/hunt/onboarding/coach/CoachOverlay.tsx
 *
 * The coach marks for the guided demo. Drawn INSIDE a real Hunt screen, so it sits
 * where that screen's own controls are and is never in the way of native dialogs.
 *
 * How the spotlight works: the dim layer is FOUR rectangles around a hole, not one
 * rectangle with a cut-out. The rectangles swallow touches; the hole is simply not
 * covered, so a tap inside it reaches the real control underneath. That is why the
 * demo is interactive: the user taps the real Start Hunt, the real Scan button.
 *
 * Steps with no target (explanations) dim the whole screen and wait for the card's
 * button. If a step's target cannot be found on screen the card offers Continue
 * instead, so a layout surprise can never strand someone inside the demo.
 *
 * Reduce Motion: no fade, no pulse.
 *
 * Accessibility: the gold ring and dim are decoration, never the only instruction. Every
 * card says in words what to do ("Find the Start Hunt button and double-tap it"). VoiceOver
 * lands on the step's message when a step appears, then reaches Exit demo and the button as
 * their own stops (the card is NOT one grouped element, which would hide them). Steps with
 * nothing to tap are modal for VoiceOver so it cannot wander into the screen behind. Text
 * scales with the system setting up to a cap, and the card scrolls if it still won't fit.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, Pressable, ScrollView, StyleSheet, Animated, AccessibilityInfo, findNodeHandle,
  useWindowDimensions,
} from 'react-native';
import { useNavigation, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { FONTS } from '@/constants/typography';
import { useReduceMotion } from '@/components/hunt/HuntAttentionDot';
import { useHuntOnboarding } from '@/lib/useHuntOnboarding';
import { advanceCoach, coachProgress, type CoachScreen, type CoachStepId } from '@/lib/huntDemoCoach';
import { closeRun } from '@/lib/huntOnboardingAnalytics';
import { endDemoHunt } from '@/lib/huntDemoSession';
import { beginDemoExit, endDemoExit } from '@/lib/huntDemoMode';
import { useCoach } from './useCoach';
import { measureTargets, type Rect } from './coachTargets';

const FOREST = '#1E3A1E';
const GOLD   = '#C4972A';            // ring and borders only: 2.2:1 on cream, never used for text
const GOLD_TEXT = '#7A5C0E';          // gold for small text on cream: 5.1:1
const CREAM  = '#F2E8D0';
const TEXT   = '#2A1A0A';
const MUTED  = '#5C4426';
const DIM    = 'rgba(24, 14, 4, 0.74)';
const DIM_SOFT = 'rgba(24, 14, 4, 0.46)';     // lets the screen behind still read (results summary)

const HOLE_PAD    = 8;
const HOLE_RADIUS = 16;
const CARD_MAX_W  = 380;
/** Dynamic Type: grow with the system setting, but stop where the card can no longer fit. */
const MAX_FONT_SCALE = 1.5;
const MIN_CARD_H = 190;
/** Poll so the spotlight follows a layout shift (list growing, keyboard, scroll). */
const REMEASURE_MS = 250;
/** How long to look for a target before offering Continue instead. */
const TARGET_GIVE_UP_MS = 1200;

export interface CoachOverlayProps {
  /** Which real screen this overlay lives in: it only draws that screen's steps. */
  screen: CoachScreen;
  /** Runs when the card's button is pressed, before the demo moves on (e.g. open the next find). */
  onNext?: (stepId: CoachStepId) => void;
  /** For two-button steps: which one was pressed. The screen ends the demo and navigates. */
  onChoose?: (stepId: CoachStepId, which: 'primary' | 'secondary') => void;
}

export function CoachOverlay({ screen, onNext, onChoose }: CoachOverlayProps) {
  const { active, step } = useCoach();
  if (!active || !step || step.silent || step.screen !== screen) return null;
  return <CoachLayer key={step.id} stepId={step.id} onNext={onNext} onChoose={onChoose} />;
}

function CoachLayer({ stepId, onNext, onChoose }: {
  stepId: CoachStepId;
  onNext?: (id: CoachStepId) => void;
  onChoose?: (id: CoachStepId, which: 'primary' | 'secondary') => void;
}) {
  const { step } = useCoach();
  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = useWindowDimensions();
  const reduce = useReduceMotion();
  const navigation = useNavigation();
  const router = useRouter();
  const onboarding = useHuntOnboarding();

  const rootRef = useRef<View>(null);
  const [origin, setOrigin] = useState({ x: 0, y: 0 });
  const [hole, setHole] = useState<Rect | null>(null);
  const [searched, setSearched] = useState(false);
  const fade = useRef(new Animated.Value(reduce ? 1 : 0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const messageRef = useRef<View>(null);

  const targets = step?.targets ?? [];
  const hasTargets = targets.length > 0;

  // Keep the spotlight on the control.
  useEffect(() => {
    if (!hasTargets) return;
    let alive = true;
    const run = async () => {
      try { rootRef.current?.measureInWindow((x, y) => { if (alive) setOrigin(o => (o.x === x && o.y === y ? o : { x, y })); }); } catch { /* origin stays 0,0 */ }
      const r = await measureTargets(targets);
      if (!alive) return;
      setHole(prev => (sameRect(prev, r) ? prev : r));
    };
    void run();
    const t = setInterval(run, REMEASURE_MS);
    const giveUp = setTimeout(() => { if (alive) setSearched(true); }, TARGET_GIVE_UP_MS);
    return () => { alive = false; clearInterval(t); clearTimeout(giveUp); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepId]);

  useEffect(() => {
    if (!reduce) Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: true }).start();
  }, [fade, reduce]);

  useEffect(() => {
    if (reduce || !hole) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 900, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse, reduce, !!hole]);                      // eslint-disable-line react-hooks/exhaustive-deps

  // VoiceOver / TalkBack: move focus to this step's message so it is read as the step appears.
  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      try {
        if (!alive || !(await AccessibilityInfo.isScreenReaderEnabled())) return;
        const node = findNodeHandle(messageRef.current);
        if (node) AccessibilityInfo.setAccessibilityFocus(node);
      } catch { /* focus is a nicety; the step still works */ }
    }, 400);                                          // after the screen under it has settled
    return () => { alive = false; clearTimeout(t); };
  }, [stepId]);

  if (!step) return null;
  const { n, total } = coachProgress(step.id);

  // A target that never appeared: don't strand the user behind a dim screen.
  const lost = hasTargets && !hole && searched;
  const waiting = hasTargets && !hole && !searched;
  const isChoice = step.action === 'choice';
  const showsNextButton = !isChoice && (step.action === 'next' || lost);
  const buttonLabel = lost ? 'Continue' : (step.nextLabel ?? 'Next');
  const dimColor = step.dim === 'soft' ? DIM_SOFT : DIM;

  const exit = () => {
    // The screens' back guards step aside for the moment of the reset.
    beginDemoExit();
    closeRun('exit_button');                         // before the coach stops, so the reason is the real one
    endDemoHunt();
    void onboarding.markSkipped();                   // leaving early is "not right now"
    try { (navigation as any).reset({ index: 0, routes: [{ name: '(tabs)' }] }); }
    catch { router.replace('/(tabs)' as any); }
    setTimeout(endDemoExit, 1000);
  };
  const next = () => { onNext?.(step.id); advanceCoach(step.id); };

  // Hole in this overlay's own coordinates.
  const h = hole ? {
    x: Math.max(0, hole.x - origin.x - HOLE_PAD),
    y: Math.max(0, hole.y - origin.y - HOLE_PAD),
    w: hole.w + HOLE_PAD * 2,
    h: hole.h + HOLE_PAD * 2,
  } : null;

  // Card goes on whichever side of the spotlight has more room (below, for a top-half target),
  // and is never taller than that room: past it, the card's own content scrolls.
  const cardW = Math.min(CARD_MAX_W, winW - 32);
  const below = h ? winH - (h.y + h.h) - 14 - insets.bottom - 8 : 0;
  const above = h ? h.y - 14 - insets.top - 8 : 0;
  const putBelow = !!h && ((step.cardSide === 'below' && below >= MIN_CARD_H)
    || (h.y + h.h / 2 < winH * 0.5 ? below >= MIN_CARD_H || below >= above : below < MIN_CARD_H && below > above));
  let cardPos: Record<string, number>;
  let cardMaxH: number;
  if (h && putBelow) { cardPos = { top: h.y + h.h + 14 }; cardMaxH = Math.max(MIN_CARD_H, below); }
  else if (h) { cardPos = { bottom: Math.max(winH - h.y + 14, insets.bottom + 12) }; cardMaxH = Math.max(MIN_CARD_H, above); }
  else {
    const top = Math.max(insets.top + 40, winH * 0.5 - 130);
    cardPos = { top }; cardMaxH = Math.max(MIN_CARD_H, winH - top - insets.bottom - 12);
  }
  const tapTarget = step.a11yTarget ?? 'the highlighted control';
  const isTapStep = !showsNextButton && !isChoice;

  const ringOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] });

  return (
    <Animated.View
      ref={rootRef as any}
      collapsable={false}
      pointerEvents="box-none"
      style={[StyleSheet.absoluteFill, s.root, { opacity: fade }]}
      accessibilityViewIsModal={!isTapStep}
      testID="hunt-coach"
    >
      {/* Dim layer: four rectangles around the hole (or one, when there is no hole). */}
      {h && !waiting ? (
        <>
          <Blocker color={dimColor} style={{ left: 0, top: 0, right: 0, height: h.y }} />
          <Blocker color={dimColor} style={{ left: 0, top: h.y + h.h, right: 0, bottom: 0 }} />
          <Blocker color={dimColor} style={{ left: 0, top: h.y, width: h.x, height: h.h }} />
          <Blocker color={dimColor} style={{ left: h.x + h.w, top: h.y, right: 0, height: h.h }} />
          <Animated.View
            pointerEvents="none"
            style={[s.ring, { left: h.x, top: h.y, width: h.w, height: h.h, borderRadius: Math.min(HOLE_RADIUS, h.h / 2), opacity: reduce ? 1 : ringOpacity }]}
            testID="hunt-coach-ring"
          />
        </>
      ) : (
        <Blocker color={dimColor} style={StyleSheet.absoluteFillObject} />
      )}

      {!waiting && (
        <View
          style={[s.card, { width: cardW, left: (winW - cardW) / 2, maxHeight: cardMaxH }, cardPos]}
          testID="hunt-coach-card"
        >
         <ScrollView bounces={false} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={s.topRow}>
            <Text style={s.stepLabel} maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityLabel={`Step ${n} of ${total}`}>{`STEP ${n} OF ${total}`}</Text>
            {!step.final && (
              <Pressable
                onPress={exit}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Exit demo"
                accessibilityHint="Leaves the guided demo. Your real Hunts are not affected."
                style={s.exitBtn}
                testID="hunt-coach-exit"
              >
                <Text style={s.exitText} maxFontSizeMultiplier={MAX_FONT_SCALE}>Exit demo</Text>
              </Pressable>
            )}
          </View>
          {!!step.badge && (
            <View style={s.badge} testID="hunt-coach-badge"><Text style={s.badgeText} maxFontSizeMultiplier={MAX_FONT_SCALE}>{step.badge}</Text></View>
          )}
          {/* One VoiceOver stop for the message; the buttons stay their own stops. */}
          <View
            ref={messageRef}
            accessible
            accessibilityLabel={`Step ${n} of ${total}. ${step.title}. ${step.body}${step.badge ? `. ${step.badge}` : ''}`}
            testID="hunt-coach-message"
          >
            <Text style={s.title} accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE}>{step.title}</Text>
            <Text style={s.body} maxFontSizeMultiplier={MAX_FONT_SCALE}>{step.body}</Text>
          </View>
          {showsNextButton ? (
            <Pressable
              onPress={next}
              accessibilityRole="button"
              accessibilityLabel={buttonLabel}
              style={({ pressed }) => [s.primary, pressed && { opacity: 0.88, transform: [{ scale: 0.98 }] }]}
              testID="hunt-coach-next"
            >
              <Text style={s.primaryText} maxFontSizeMultiplier={MAX_FONT_SCALE}>{buttonLabel}</Text>
            </Pressable>
          ) : isChoice ? (
            <View style={s.choiceCol}>
              <Pressable
                onPress={() => onChoose?.(step.id, 'primary')}
                accessibilityRole="button"
                accessibilityLabel={step.choice?.primary}
                style={({ pressed }) => [s.primary, { marginTop: 12 }, pressed && { opacity: 0.88, transform: [{ scale: 0.98 }] }]}
                testID="hunt-coach-primary"
              >
                <Text style={s.primaryText} maxFontSizeMultiplier={MAX_FONT_SCALE}>{step.choice?.primary}</Text>
              </Pressable>
              <Pressable
                onPress={() => onChoose?.(step.id, 'secondary')}
                accessibilityRole="button"
                accessibilityLabel={step.choice?.secondary}
                style={s.secondary}
                testID="hunt-coach-secondary"
              >
                <Text style={s.secondaryText} maxFontSizeMultiplier={MAX_FONT_SCALE}>{step.choice?.secondary}</Text>
              </Pressable>
            </View>
          ) : (
            <View
              style={s.tapHint}
              accessible
              accessibilityLabel={`Find ${tapTarget} and double-tap it to continue.`}
              testID="hunt-coach-hint"
            >
              <MaterialIcons name="touch-app" size={16} color={GOLD_TEXT} />
              <Text style={s.tapHintText} maxFontSizeMultiplier={MAX_FONT_SCALE}>{step.hint ?? 'Tap the highlighted spot'}</Text>
            </View>
          )}
         </ScrollView>
        </View>
      )}
    </Animated.View>
  );
}

/** A rectangle that swallows touches so nothing outside the spotlight can be pressed. */
function Blocker({ style, color }: { style: object; color: string }) {
  return (
    <Pressable
      style={[s.blocker, { backgroundColor: color }, style]}
      onPress={() => {}}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    />
  );
}

function sameRect(a: Rect | null, b: Rect | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1 && Math.abs(a.w - b.w) < 1 && Math.abs(a.h - b.h) < 1;
}

const s = StyleSheet.create({
  root:    { zIndex: 100, elevation: 100 },
  blocker: { position: 'absolute', backgroundColor: DIM },
  ring:    { position: 'absolute', borderWidth: 2.5, borderColor: GOLD },
  card: {
    position: 'absolute', backgroundColor: CREAM, borderRadius: 18, borderWidth: 1, borderColor: GOLD + 'AA',
    paddingHorizontal: 18, paddingTop: 12, paddingBottom: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.35, shadowRadius: 16, elevation: 14,
  },
  topRow:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  stepLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.4, color: GOLD_TEXT },
  exitBtn:   { minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'flex-end', marginVertical: -10 },
  exitText:  { fontSize: 12, fontWeight: '600', color: MUTED, textDecorationLine: 'underline' },
  title:     { fontFamily: FONTS.serif, fontSize: 20, fontWeight: '800', color: FOREST, lineHeight: 25 },
  body:      { fontSize: 14.5, lineHeight: 21, color: TEXT, marginTop: 4 },
  primary:   { marginTop: 12, minHeight: 46, borderRadius: 14, backgroundColor: FOREST, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  primaryText: { fontFamily: FONTS.serif, fontSize: 16, fontWeight: '800', color: '#F4EED8', letterSpacing: 0.4 },
  choiceCol:   { alignSelf: 'stretch' },
  secondary:   { marginTop: 4, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { fontSize: 14.5, fontWeight: '700', color: MUTED, textDecorationLine: 'underline' },
  badge:       { alignSelf: 'flex-start', marginBottom: 6, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, backgroundColor: GOLD + '26', borderWidth: 1, borderColor: GOLD + '77' },
  badgeText:   { fontSize: 9.5, fontWeight: '800', letterSpacing: 1.3, color: GOLD_TEXT },
  tapHint:     { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  tapHintText: { fontSize: 12.5, fontWeight: '600', color: MUTED },
});
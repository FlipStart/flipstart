/**
 * components/onboarding/ProfileBuilding.tsx
 *
 * Screen 9 — the profile assembling itself.
 *
 * ── Truthful by construction ────────────────────────────────────────────────
 * Nothing is "analysed". An empty profile card appears and the user's OWN
 * answers drop into it one at a time — goal, experience, focus chips, the
 * tools those answers recommend — and the archetype those answers derive
 * resolves last. There is no model, no calibration, no percentage, because
 * none of that happens. What the user watches is literally their choices
 * becoming the card they are about to be shown.
 *
 * That is why it replaced four ticking text lines: the old screen claimed
 * progress without showing any, and left the lower half of the display empty.
 *
 * ── The card is the object the result screen finishes ───────────────────────
 * Same crest, same gold frame, same archetype type, same chips. The next
 * screen is this card, complete — which is what makes the transition read as
 * completion rather than as one more screen.
 *
 * ── Timing ──────────────────────────────────────────────────────────────────
 * Six steps at 340ms then a 420ms hold: ~2.5s, with something entering at
 * every step. Continue then appears; the user is never yanked onward
 * mid-reveal.
 *
 * ── Reduce Motion ───────────────────────────────────────────────────────────
 * The finished card renders immediately and Continue is available at once — no
 * timed wait, no sequence to sit through.
 */
import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { FONTS } from '@/constants/typography';
import { PW, PW_RADIUS } from '@/components/monetization/paywall/paywallTheme';
import {
  ARCHETYPES, deriveArchetype, experienceLabel, goalLabel, painChips, recommendTools,
} from '@/lib/onboardingProfile';
import type { OnboardingAnswers } from '@/lib/onboardingQuiz';
import { ProfileCrest } from './ProfileCrest';

export const BUILD_STEP_MS = 340;
export const BUILD_HOLD_MS = 420;
export const BUILD_STEPS = 6;

export interface ProfileBuildingProps {
  answers: OnboardingAnswers;
  /** Fires once when the sequence finishes. Not called under Reduce Motion. */
  onDone: () => void;
  /** Reports whether the sequence will auto-advance, so the parent can show Continue. */
  onReduceMotion?: (on: boolean) => void;
}

export function ProfileBuilding({ answers, onDone, onReduceMotion }: ProfileBuildingProps) {
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then(v => { setReduceMotion(v); onReduceMotion?.(v); })
      .catch(() => { setReduceMotion(false); onReduceMotion?.(false); });
  }, [onReduceMotion]);

  /** How many elements have landed. 0 = empty frame, BUILD_STEPS = complete. */
  const [step, setStep] = useState(0);
  const doneRef = useRef(false);

  useEffect(() => {
    if (reduceMotion === null) return;
    if (reduceMotion) { setStep(BUILD_STEPS); return; }
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let n = 1; n <= BUILD_STEPS; n++) {
      timers.push(setTimeout(() => setStep(n), BUILD_STEP_MS * n));
    }
    timers.push(setTimeout(() => {
      if (doneRef.current) return;
      doneRef.current = true;
      onDone();
    }, BUILD_STEP_MS * BUILD_STEPS + BUILD_HOLD_MS));
    return () => timers.forEach(clearTimeout);
  }, [reduceMotion, onDone]);

  const complete = step >= BUILD_STEPS;
  const archetype = answers.primaryGoal ? ARCHETYPES[deriveArchetype(answers.primaryGoal)] : null;
  const chips = painChips(answers.painPoints);
  const tools = answers.primaryGoal ? recommendTools(answers.primaryGoal, answers.painPoints) : [];

  /** One slot. Holds its height before it lands, so nothing below it jumps. */
  const Slot = ({ at, height, children }: { at: number; height: number; children: React.ReactNode }) => {
    if (step < at) return <View style={{ height }} />;
    if (reduceMotion) return <>{children}</>;
    return <Animated.View entering={FadeInDown.duration(260)}>{children}</Animated.View>;
  };

  return (
    <View
      style={s.wrap}
      accessibilityLiveRegion="polite"
      accessibilityLabel={complete && archetype
        ? `Profile ready. ${archetype.title}.`
        : 'Building your FlipStart profile'}
    >
      <View style={[s.card, complete && s.cardComplete]}>
        <View pointerEvents="none" style={[s.frame, complete && s.frameComplete]} />

        {/* The crest is present from the first frame: the card exists, empty. */}
        <View style={s.crestRow}>
          <ProfileCrest size={46} lit={complete} />
        </View>

        <Slot at={1} height={40}>
          <Row label="GOAL" value={answers.primaryGoal ? goalLabel(answers.primaryGoal) : '—'} />
        </Slot>

        <Slot at={2} height={40}>
          <Row label="EXPERIENCE" value={answers.experienceLevel ? experienceLabel(answers.experienceLevel) : '—'} />
        </Slot>

        <Slot at={3} height={48}>
          <View style={s.block}>
            <Text style={s.label} allowFontScaling={false}>YOUR FOCUS</Text>
            <View style={s.chips}>
              {chips.visible.map(t => (
                <View key={t} style={s.chip}><Text style={s.chipText} numberOfLines={1}>{t}</Text></View>
              ))}
              {chips.moreCount > 0 && (
                <View style={s.chip}><Text style={s.chipText}>+{chips.moreCount} more</Text></View>
              )}
            </View>
          </View>
        </Slot>

        <Slot at={4} height={48}>
          <View style={s.block}>
            <Text style={s.label} allowFontScaling={false}>TOOLS</Text>
            <View style={s.tools}>
              {tools.map(t => (
                <View key={t.key} style={s.tool}>
                  <MaterialIcons name={t.icon} size={15} color={PW.forest} />
                  <Text style={s.toolText} numberOfLines={1}>{t.name}</Text>
                </View>
              ))}
            </View>
          </View>
        </Slot>

        {/* The gold rule completes the frame. */}
        <Slot at={5} height={5}>
          <View style={s.rule} />
        </Slot>

        <Slot at={6} height={48}>
          <View style={s.archetypeBlock}>
            <Text style={s.archetypeLabel} allowFontScaling={false}>YOUR PROFILE</Text>
            <Text style={s.archetype} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.8}>
              {archetype?.title ?? ''}
            </Text>
          </View>
        </Slot>
      </View>

      {complete && (
        <Animated.View entering={reduceMotion ? undefined : FadeIn.duration(240)} style={s.readyRow}>
          <MaterialIcons name="check-circle" size={15} color={PW.forest} />
          <Text style={s.ready} allowFontScaling={false}>PROFILE READY</Text>
        </Animated.View>
      )}
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.block}>
      <Text style={s.label} allowFontScaling={false}>{label}</Text>
      <Text style={s.value} numberOfLines={2}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 10, paddingTop: 2 },

  card: {
    backgroundColor: PW.card, borderRadius: PW_RADIUS.card,
    borderWidth: 1.25, borderColor: PW.border,
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 14, gap: 8,
    overflow: 'hidden',
    shadowColor: PW.forest, shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 5 },
    elevation: 3,
  },
  /** The finished card takes the forest border the result screen uses. */
  cardComplete: { borderColor: PW.forest, borderWidth: 1.6, shadowOpacity: 0.13 },
  frame: {
    position: 'absolute', top: 4, left: 4, right: 4, bottom: 4,
    borderRadius: PW_RADIUS.card - 4, borderWidth: 1, borderColor: 'rgba(196,163,52,0.20)',
  },
  frameComplete: { borderColor: 'rgba(196,163,52,0.55)' },

  crestRow: { alignItems: 'center', paddingBottom: 2 },

  block: { gap: 2 },
  label: { fontFamily: FONTS.serif, fontSize: 8.5, fontWeight: '800', letterSpacing: 1.5, color: PW.brown },
  value: { fontFamily: FONTS.serif, fontSize: 15, fontWeight: '800', color: PW.ink, lineHeight: 20 },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  chip: {
    paddingHorizontal: 9, paddingVertical: 3.5, borderRadius: PW_RADIUS.pill,
    backgroundColor: 'rgba(33,77,45,0.07)', borderWidth: 1, borderColor: 'rgba(33,77,45,0.22)',
  },
  chipText: { fontSize: 11.5, fontWeight: '700', color: PW.forest },

  tools: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  tool: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 9, paddingVertical: 4, borderRadius: PW_RADIUS.pill,
    backgroundColor: PW.parchment, borderWidth: 1, borderColor: PW.border,
  },
  toolText: { fontSize: 11.5, fontWeight: '700', color: PW.ink },

  rule: { height: 1, backgroundColor: 'rgba(196,163,52,0.55)', marginVertical: 2 },

  archetypeBlock: { alignItems: 'center', gap: 2 },
  archetypeLabel: { fontFamily: FONTS.serif, fontSize: 8.5, fontWeight: '800', letterSpacing: 1.6, color: PW.brown },
  archetype: {
    fontFamily: FONTS.serif, fontSize: 19, fontWeight: '800', letterSpacing: 1.6,
    color: PW.forest, textAlign: 'center', lineHeight: 24,
  },

  readyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  ready: { fontFamily: FONTS.serif, fontSize: 10, fontWeight: '800', letterSpacing: 1.8, color: PW.forest },
});
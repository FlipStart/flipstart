/**
 * components/onboarding/ProfileResult.tsx
 *
 * The payoff, in one viewport (V2 Phase 4).
 *
 * ── What it is ──────────────────────────────────────────────────────────────
 * The BODY of the result screen. The archetype — a gold "YOUR FLIPSTART
 * PROFILE" kicker, the name, one sentence — is the screen's head, drawn by
 * OnboardingShell like every other screen's headline. This draws what sits
 * under it:
 *
 *   1. Your focus         up to three chips, +N for the rest
 *   2. Recommended        ONE card, up to three one-line rows, PRO marked
 *   3. What you start     15 free scans | starting rank · 0 XP
 *
 * ── What it deliberately leaves out ─────────────────────────────────────────
 * The previous version repeated the user's goal and experience back to them,
 * gave each tool a two-line blurb and drew a crest. None of it told them
 * anything new, and together it pushed the starting state off the bottom of a
 * small phone. Their answers made the archetype and the tools; saying so a
 * second time is not a result.
 *
 * ── Fits without scrolling ──────────────────────────────────────────────────
 * Every row has a fixed shape: chips are held to 18 characters (any three fit
 * in two rows), tool blurbs to one line, the card to three rows. The
 * compact variant tightens spacing only — nothing is removed, so the
 * smallest phone shows the same content as the largest. See the render checks
 * in __tests__/onboarding/v2-phase-4-profile.test.ts.
 *
 * ── Everything is derived, nothing is invented ──────────────────────────────
 * Tools come from the goal and the pain points, the scan count from
 * FREE_LIFETIME_SCANS and the rank from RANK_LADDER[0]. There is no predicted
 * profit, no success rate, no percentile and no personality score, because the
 * product computes none of those.
 *
 * ── The rank says exactly two things ────────────────────────────────────────
 * Its name and "0 XP". No threshold, no progress bar: the user has not earned
 * anything yet, and the honest picture of that is a zero.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { FONTS } from '@/constants/typography';
import { FREE_LIFETIME_SCANS } from '@/lib/paywallConfig';
import { RANK_LADDER } from '@/lib/huntXp';
import { painChips, recommendTools } from '@/lib/onboardingProfile';
import type { PainPoint, PrimaryGoal } from '@/lib/onboardingQuiz';
import { OB } from './onboardingTheme';
import { useOnboardingLayout } from './useOnboardingLayout';

/** Dynamic Type is honoured up to here; past it the shell's ScrollView takes over. */
const MAX_SCALE = 1.3;

export interface ProfileResultProps {
  primaryGoal: PrimaryGoal;
  painPoints: PainPoint[];
}

export function ProfileResult({ primaryGoal, painPoints }: ProfileResultProps) {
  const { compact } = useOnboardingLayout();
  const tools = recommendTools(primaryGoal, painPoints);
  const chips = painChips(painPoints);
  const startingRank = RANK_LADDER[0];

  return (
    <View style={[s.stack, compact && s.stackCompact]}>
      {/* ── 1. Focus ──────────────────────────────────────────────────── */}
      <View style={[s.block, compact && s.blockCompact]}>
        <Text style={s.label} maxFontSizeMultiplier={MAX_SCALE}>YOUR FOCUS</Text>
        <View
          style={s.chips}
          accessible
          accessibilityLabel={`Your focus: ${chips.visible.join(', ')}${chips.moreCount > 0 ? `, and ${chips.moreCount} more` : ''}`}
        >
          {chips.visible.map(t => (
            <View key={t} style={s.chip}>
              <Text style={s.chipText} numberOfLines={1} maxFontSizeMultiplier={MAX_SCALE}>{t}</Text>
            </View>
          ))}
          {chips.moreCount > 0 && (
            <View style={s.chip}>
              <Text style={s.chipText} numberOfLines={1} maxFontSizeMultiplier={MAX_SCALE}>+{chips.moreCount} more</Text>
            </View>
          )}
        </View>
      </View>

      {/* ── 2. Recommended ────────────────────────────────────────────── */}
      <View style={[s.block, compact && s.blockCompact]}>
        <Text style={s.label} maxFontSizeMultiplier={MAX_SCALE}>RECOMMENDED FOR YOU</Text>
        <View style={s.tools}>
          {tools.map((t, i) => (
            <View
              key={t.key}
              style={[s.tool, compact && s.toolCompact, i > 0 && s.toolDivider]}
              accessible
              accessibilityLabel={t.pro ? `${t.name}, Pro feature. ${t.blurb}` : `${t.name}. ${t.blurb}`}
            >
              <MaterialIcons name={t.icon} size={20} color={OB.forest} />
              <View style={s.toolText}>
                <View style={s.toolTitleRow}>
                  <Text style={s.toolName} numberOfLines={1} maxFontSizeMultiplier={MAX_SCALE}>{t.name}</Text>
                  {t.pro && (
                    <View style={s.pro}>
                      <Text style={s.proText} maxFontSizeMultiplier={MAX_SCALE}>PRO</Text>
                    </View>
                  )}
                </View>
                <Text style={s.toolBlurb} numberOfLines={2} maxFontSizeMultiplier={MAX_SCALE}>{t.blurb}</Text>
              </View>
            </View>
          ))}
        </View>
      </View>

      {/* ── 3. What you start with ────────────────────────────────────── */}
      <View style={s.start}>
        <View style={s.startBar} />
        <View style={[s.startRow, compact && s.startRowCompact]}>
          <View
            style={s.startCol}
            accessible
            accessibilityLabel={`${FREE_LIFETIME_SCANS} free scans ready`}
          >
            <Text style={s.startBig} maxFontSizeMultiplier={MAX_SCALE}>{FREE_LIFETIME_SCANS}</Text>
            <Text style={[s.startLabel, compact && s.startLabelCompact]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} maxFontSizeMultiplier={MAX_SCALE}>FREE SCANS READY</Text>
          </View>
          <View style={s.startDivider} />
          <View
            style={[s.startCol, s.startColWide]}
            accessible
            accessibilityLabel={`Starting rank: ${startingRank.rank}, 0 XP`}
          >
            <Text style={s.startRank} numberOfLines={2} maxFontSizeMultiplier={MAX_SCALE}>{startingRank.rank}</Text>
            {/* One line, always: "XP" alone on a second line reads as a mistake.
                The column is wider, the tracking tightens on a small phone, and
                iOS shrinks it a notch before it would ever wrap. */}
            <Text style={[s.startLabel, compact && s.startLabelCompact]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} maxFontSizeMultiplier={MAX_SCALE}>STARTING RANK {'·'} 0 XP</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  stack: { gap: 16 },
  stackCompact: { gap: 12 },

  block: { gap: 8 },
  blockCompact: { gap: 6 },

  /** The same small gold label as the screen's kicker. */
  label: { fontSize: 10.5, lineHeight: 14, fontWeight: '800', letterSpacing: 1.6, color: OB.goldText },

  // ── Focus ───────────────────────────────────────────────────────────────
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    height: 30, paddingHorizontal: 12, borderRadius: 15,
    borderWidth: 1, borderColor: OB.forest, backgroundColor: OB.greenTint,
    alignItems: 'center', justifyContent: 'center',
  },
  chipText: { fontSize: 13, lineHeight: 18, fontWeight: '700', color: OB.forest },

  // ── Recommended ─────────────────────────────────────────────────────────
  tools: {
    backgroundColor: OB.card, borderRadius: 16,
    borderWidth: 1, borderColor: OB.border,
    paddingHorizontal: 14, overflow: 'hidden',
  },
  tool: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingVertical: 7 },
  toolCompact: { minHeight: 48, paddingVertical: 5 },
  toolDivider: { borderTopWidth: 1, borderTopColor: OB.border },
  toolText: { flex: 1, minWidth: 0, gap: 1 },
  toolTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  toolName: { flexShrink: 1, fontFamily: FONTS.serif, fontSize: 16, lineHeight: 20, fontWeight: '700', color: OB.ink },
  toolBlurb: { fontSize: 13, lineHeight: 17, color: OB.ink },
  pro: {
    height: 18, paddingHorizontal: 7, borderRadius: 5,
    borderWidth: 1, borderColor: OB.gold, backgroundColor: OB.goldTint,
    alignItems: 'center', justifyContent: 'center',
  },
  proText: { fontSize: 11, lineHeight: 14, fontWeight: '800', letterSpacing: 1, color: OB.ink },

  // ── Starting state ──────────────────────────────────────────────────────
  start: {
    backgroundColor: OB.card, borderRadius: 16,
    borderWidth: 1, borderColor: OB.border, overflow: 'hidden',
  },
  /** The History cards' gold top rule. */
  startBar: { height: 4, backgroundColor: OB.gold },
  startRow: { flexDirection: 'row', alignItems: 'stretch', paddingTop: 12, paddingBottom: 14 },
  startRowCompact: { paddingTop: 9, paddingBottom: 10 },
  startCol: { flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 6 },
  /** The rank column carries the longer label. */
  startColWide: { flex: 1.25 },
  startDivider: { width: 1, backgroundColor: OB.border },
  startBig: { fontFamily: FONTS.serif, fontSize: 30, lineHeight: 32, fontWeight: '800', color: OB.forest },
  startRank: { fontFamily: FONTS.serif, fontSize: 17, lineHeight: 21, fontWeight: '800', color: OB.forest, textAlign: 'center' },
  startLabel: { fontSize: 10.5, lineHeight: 14, fontWeight: '800', letterSpacing: 1.2, color: OB.ink, textAlign: 'center' },
  startLabelCompact: { letterSpacing: 0.9 },
});
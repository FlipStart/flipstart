/**
 * components/onboarding/ProfileResult.tsx
 *
 * Screen 10 — the payoff.
 *
 * ── Modular, not one tall card ──────────────────────────────────────────────
 * The previous version stacked everything into a single card: archetype,
 * four fact rows, three tool rows, then a strip — tall, dense, and repetitive,
 * with the starting rank crammed beside the scan count. This is four sections
 * with their own weight:
 *
 *   1. Archetype hero   — the crest from the building screen, now lit
 *   2. Summary          — goal, experience, focus, in three compact rows
 *   3. Recommended      — the derived tools, PRO marked
 *   4. Starting state   — 15 free scans | starting rank, 0 XP
 *
 * ── Everything is derived, nothing is invented ──────────────────────────────
 * The archetype comes from primaryGoal, the tools from the goal and the pain
 * points, the scan count from FREE_LIFETIME_SCANS and the rank from
 * RANK_LADDER[0]. There is no predicted profit, no success rate, no percentile
 * and no personality score, because the product computes none of those.
 *
 * ── The rank strip says exactly two things ──────────────────────────────────
 * The rank's name and "0 XP". No threshold, no id, no progress maths — the
 * user has not earned anything yet, and the honest version of that is a zero
 * and an empty bar.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { FONTS } from '@/constants/typography';
import { PW, PW_RADIUS, PW_SHADOW } from '@/components/monetization/paywall/paywallTheme';
import { FREE_LIFETIME_SCANS } from '@/lib/paywallConfig';
import { RANK_LADDER } from '@/lib/huntXp';
import {
  ARCHETYPES, deriveArchetype, experienceLabel, goalLabel, painChips, recommendTools,
} from '@/lib/onboardingProfile';
import type { ExperienceLevel, PainPoint, PrimaryGoal } from '@/lib/onboardingQuiz';
import { ProSeal } from './ValueTeasers';
import { ProfileCrest } from './ProfileCrest';

export interface ProfileResultProps {
  primaryGoal: PrimaryGoal;
  experienceLevel: ExperienceLevel;
  painPoints: PainPoint[];
}

export function ProfileResult({ primaryGoal, experienceLevel, painPoints }: ProfileResultProps) {
  const archetype = ARCHETYPES[deriveArchetype(primaryGoal)];
  const tools = recommendTools(primaryGoal, painPoints);
  const chips = painChips(painPoints);
  const startingRank = RANK_LADDER[0];

  return (
    <View style={s.stack}>
      {/* ── 1. The archetype, as hero ─────────────────────────────────── */}
      <View style={s.hero}>
        <View pointerEvents="none" style={s.heroFrame} />
        <ProfileCrest size={52} lit />
        <Text style={s.heroLabel} allowFontScaling={false}>YOUR FLIPSTART PROFILE</Text>
        <Text
          style={s.heroTitle}
          numberOfLines={2}
          adjustsFontSizeToFit
          minimumFontScale={0.8}
          accessibilityRole="header"
        >
          {archetype.title}
        </Text>
        <Text style={s.heroLine}>{archetype.line}</Text>
      </View>

      {/* ── 2. Summary ────────────────────────────────────────────────── */}
      <View style={s.section}>
        <SummaryRow label="GOAL" value={goalLabel(primaryGoal)} />
        <View style={s.divider} />
        <SummaryRow label="EXPERIENCE" value={experienceLabel(experienceLevel)} />
        <View style={s.divider} />
        <View style={s.focusRow}>
          <Text style={s.rowLabel} allowFontScaling={false}>YOUR FOCUS</Text>
          <View style={s.chips}>
            {chips.visible.map(t => (
              <View key={t} style={s.chip}><Text style={s.chipText} numberOfLines={1}>{t}</Text></View>
            ))}
            {chips.moreCount > 0 && (
              <View style={s.chip}><Text style={s.chipText}>+{chips.moreCount} more</Text></View>
            )}
          </View>
        </View>
      </View>

      {/* ── 3. Recommended tools ──────────────────────────────────────── */}
      <Text style={s.kicker} allowFontScaling={false}>RECOMMENDED FOR YOU</Text>
      <View style={s.tools}>
        {tools.map(t => (
          <View
            key={t.key}
            style={s.tool}
            accessibilityLabel={t.pro ? `${t.name}, Pro feature. ${t.blurb}` : `${t.name}. ${t.blurb}`}
          >
            <View style={s.toolSeal}><MaterialIcons name={t.icon} size={17} color={PW.forest} /></View>
            <View style={s.toolText}>
              <View style={s.toolTitleRow}>
                <Text style={s.toolName} numberOfLines={1}>{t.name}</Text>
                {t.pro && <ProSeal />}
              </View>
              <Text style={s.toolBlurb} numberOfLines={2}>{t.blurb}</Text>
            </View>
          </View>
        ))}
      </View>

      {/* ── 4. What you start with ────────────────────────────────────── */}
      <View style={s.startRow}>
        <View style={s.startCard}>
          <Text style={s.startBig} allowFontScaling={false}>{FREE_LIFETIME_SCANS}</Text>
          <Text style={s.startLabel} allowFontScaling={false}>FREE SCANS READY</Text>
          <Text style={s.startSub}>Start finding your first flip.</Text>
        </View>

        <View style={s.startCard}>
          <Text style={s.startLabel} allowFontScaling={false}>STARTING RANK</Text>
          <Text style={s.startRank} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.75}>
            {startingRank.rank}
          </Text>
          {/* An empty bar and a zero: nothing has been earned yet, and the
              honest picture of that is exactly this. No thresholds shown. */}
          <View style={s.xpTrack}><View style={s.xpFill} /></View>
          <Text style={s.startSub}>0 XP</Text>
        </View>
      </View>
    </View>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel} allowFontScaling={false}>{label}</Text>
      <Text style={s.rowValue} numberOfLines={2}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  stack: { gap: 10 },

  // ── Hero ────────────────────────────────────────────────────────────────
  hero: {
    alignItems: 'center', gap: 5,
    backgroundColor: PW.card, borderRadius: PW_RADIUS.card,
    borderWidth: 1.6, borderColor: PW.forest,
    paddingHorizontal: 18, paddingTop: 16, paddingBottom: 14,
    overflow: 'hidden',
    shadowColor: PW.forest, shadowOpacity: 0.13, shadowRadius: 14, shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  heroFrame: {
    position: 'absolute', top: 4, left: 4, right: 4, bottom: 4,
    borderRadius: PW_RADIUS.card - 4, borderWidth: 1, borderColor: 'rgba(196,163,52,0.55)',
  },
  heroLabel: { fontFamily: FONTS.serif, fontSize: 8.5, fontWeight: '800', letterSpacing: 1.8, color: PW.brown, marginTop: 4 },
  heroTitle: {
    fontFamily: FONTS.serif, fontSize: 23, fontWeight: '800', letterSpacing: 1.8,
    color: PW.forest, textAlign: 'center', lineHeight: 28,
  },
  heroLine: { fontSize: 12.5, lineHeight: 17.5, color: PW.brown, textAlign: 'center', fontWeight: '500', paddingHorizontal: 4 },

  // ── Summary ─────────────────────────────────────────────────────────────
  section: {
    backgroundColor: PW.card, borderRadius: PW_RADIUS.card,
    borderWidth: 1.25, borderColor: PW.border,
    paddingHorizontal: 14, paddingVertical: 4, ...PW_SHADOW,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 10 },
  rowLabel: { fontFamily: FONTS.serif, fontSize: 8.5, fontWeight: '800', letterSpacing: 1.5, color: PW.brown },
  rowValue: { flexShrink: 1, fontFamily: FONTS.serif, fontSize: 14, fontWeight: '800', color: PW.ink, textAlign: 'right', lineHeight: 19 },
  divider: { height: 1, backgroundColor: PW.border },
  focusRow: { gap: 6, paddingVertical: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 9, paddingVertical: 3.5, borderRadius: PW_RADIUS.pill,
    backgroundColor: 'rgba(33,77,45,0.07)', borderWidth: 1, borderColor: 'rgba(33,77,45,0.22)',
  },
  chipText: { fontSize: 11.5, fontWeight: '700', color: PW.forest },

  // ── Tools ───────────────────────────────────────────────────────────────
  kicker: { fontFamily: FONTS.serif, fontSize: 9.5, fontWeight: '800', letterSpacing: 1.8, color: PW.brown, marginTop: 2 },
  tools: { gap: 8 },
  tool: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: PW.card, borderRadius: 12, borderWidth: 1.25, borderColor: PW.border,
    paddingHorizontal: 12, paddingVertical: 9, ...PW_SHADOW,
  },
  toolSeal: {
    width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(33,77,45,0.07)', borderWidth: 1, borderColor: 'rgba(33,77,45,0.22)',
  },
  toolText: { flex: 1, minWidth: 0, gap: 1 },
  toolTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  toolName: { flexShrink: 1, fontFamily: FONTS.serif, fontSize: 14.5, fontWeight: '800', color: PW.ink },
  toolBlurb: { fontSize: 11.5, lineHeight: 15.5, color: PW.brown, fontWeight: '500' },

  // ── Starting state ──────────────────────────────────────────────────────
  startRow: { flexDirection: 'row', gap: 10, marginTop: 2 },
  startCard: {
    flex: 1, minWidth: 0, alignItems: 'center', gap: 3,
    backgroundColor: PW.goldTint, borderRadius: PW_RADIUS.card,
    borderWidth: 1, borderColor: 'rgba(196,163,52,0.45)',
    paddingVertical: 12, paddingHorizontal: 10,
  },
  startBig: { fontFamily: FONTS.serif, fontSize: 30, fontWeight: '800', color: PW.forest, lineHeight: 34 },
  startLabel: { fontFamily: FONTS.serif, fontSize: 8.5, fontWeight: '800', letterSpacing: 1.4, color: PW.brown, textAlign: 'center' },
  startRank: { fontFamily: FONTS.serif, fontSize: 14.5, fontWeight: '800', color: PW.forest, textAlign: 'center', lineHeight: 19 },
  startSub: { fontSize: 11, lineHeight: 15, color: PW.brown, textAlign: 'center', fontWeight: '600' },
  xpTrack: { width: '70%', height: 5, borderRadius: 2.5, backgroundColor: 'rgba(196,163,52,0.35)', overflow: 'hidden', marginTop: 3 },
  xpFill: { width: '0%', height: '100%', backgroundColor: PW.forest },
});
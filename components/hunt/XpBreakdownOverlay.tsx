/**
 * components/hunt/XpBreakdownOverlay.tsx
 *
 * Pass 3C — Animated XP Breakdown Popup
 *
 * Display-only component. All XP data comes from HuntXpResult
 * already calculated by Pass 3A applyHuntXp. Never re-awards XP.
 *
 * Sequence:
 *   1. "Calculating Rewards..." header fades in
 *   2. Breakdown rows reveal one by one (slide + fade)
 *   3. Total XP counts up from 0
 *   4. Progress bar animates
 *   5. If didRankUp → rank-up sequence (confetti burst + badge spin)
 *   6. Continue button appears
 *
 * X button skips entire animation at any point.
 */

import {
  View, Text, Pressable, StyleSheet, Animated,
  Dimensions, Platform,
} from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useRef, useEffect, useState, useCallback } from 'react';
import * as Haptics from 'expo-haptics';

import { FONTS } from '@/constants/typography';
import type { HuntXpResult, XpBreakdownItem, Rank } from '@/lib/huntXp';
import { RANK_LADDER } from '@/lib/huntXp';

// ─── Palette ──────────────────────────────────────────────────────────────────

const FOREST    = '#1A3320';
const FOREST_M  = '#2A4A2A';
const GOLD      = '#BE9C2C';
const GOLD_L    = '#D4A72C';
const GOLD_PALE = '#F0D870';
const CREAM     = '#F4EED8';
const PARCHMENT = '#EDE0C4';
const CARD_B    = '#DDD0B0';
const BROWN     = '#5A3A1A';
const MUTED     = '#8A7050';

const { width: SW, height: SH } = Dimensions.get('window');

// ─── Category icons ───────────────────────────────────────────────────────────

const CAT_ICON: Record<string, keyof typeof MaterialIcons.glyphMap> = {
  base:      'check-circle',
  volume:    'bar-chart',
  rarity:    'diamond',
  profit:    'trending-up',
  time:      'timer',
  quality:   'military-tech',
  discovery: 'explore',
  streak:    'local-fire-department',
};

// ─── Timing ───────────────────────────────────────────────────────────────────

const ROW_DELAY_MS  = 220;   // ms between each row reveal
const FAST_DELAY_MS = 120;   // ms after row 5 — speeds up if many rows
const COUNT_MS      = 900;   // XP count-up duration
const BAR_MS        = 700;   // progress bar fill duration
const RANUP_DELAY   = 400;   // delay before rank-up sequence

// ─── Confetti particle ────────────────────────────────────────────────────────

function ConfettiParticle({ index }: { index: number }) {
  const anim = useRef(new Animated.Value(0)).current;
  const angle = (index / 12) * Math.PI * 2;
  const dist  = 80 + Math.random() * 60;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: 1, duration: 700 + Math.random() * 300,
      useNativeDriver: true,
    }).start();
  }, []);

  const tx = anim.interpolate({ inputRange: [0, 1], outputRange: [0, Math.cos(angle) * dist] });
  const ty = anim.interpolate({ inputRange: [0, 1], outputRange: [0, Math.sin(angle) * dist - 30] });
  const op = anim.interpolate({ inputRange: [0, 0.6, 1], outputRange: [1, 1, 0] });

  const colors = [GOLD_L, GOLD_PALE, CREAM, '#E8C040'];
  const color  = colors[index % colors.length];
  const size   = 4 + (index % 3) * 2;

  return (
    <Animated.View style={{
      position: 'absolute',
      width: size, height: size,
      borderRadius: size / 2,
      backgroundColor: color,
      transform: [{ translateX: tx }, { translateY: ty }],
      opacity: op,
    }} />
  );
}

// ─── Breakdown row ────────────────────────────────────────────────────────────

function BreakdownRow({ item, visible }: { item: XpBreakdownItem; visible: boolean }) {
  const slideAnim = useRef(new Animated.Value(0)).current;
  const opacAnim  = useRef(new Animated.Value(0)).current;
  const xpScale   = useRef(new Animated.Value(0.7)).current;
  const xpOpac    = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    Animated.parallel([
      Animated.timing(slideAnim, { toValue: 1, duration: 220, useNativeDriver: true }),
      Animated.timing(opacAnim,  { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start(() => {
      // XP value pops in slightly after label
      Animated.parallel([
        Animated.spring(xpScale, { toValue: 1, useNativeDriver: true, bounciness: 8 }),
        Animated.timing(xpOpac,  { toValue: 1, duration: 150, useNativeDriver: true }),
      ]).start();
    });
  }, [visible]);

  const translateY = slideAnim.interpolate({ inputRange: [0, 1], outputRange: [14, 0] });
  const icon = CAT_ICON[item.category] ?? 'check-circle';

  return (
    <Animated.View style={[
      r.row,
      { opacity: opacAnim, transform: [{ translateY }] },
      !visible && r.rowHidden,
    ]}>
      <MaterialIcons name={icon} size={14} color={GOLD} style={r.icon} />
      <View style={r.labelWrap}>
        <Text style={r.label} numberOfLines={1}>{item.label}</Text>
        {item.detail && <Text style={r.detail} numberOfLines={1}>{item.detail}</Text>}
      </View>
      <Animated.Text style={[r.xp, { opacity: xpOpac, transform: [{ scale: xpScale }] }]}>
        +{item.xp} XP
      </Animated.Text>
    </Animated.View>
  );
}

// ─── Main overlay ─────────────────────────────────────────────────────────────

interface Props {
  result:     HuntXpResult;
  bundleId:   string;
  onContinue: () => void;   // navigate to hunt-complete
}

export function XpBreakdownOverlay({ result, bundleId, onContinue }: Props) {
  const {
    breakdown, totalXpEarned, newTotalXp,
    previousRank, newRank, didRankUp,
    progressBefore, progressAfter,
  } = result;

  // ── State ───────────────────────────────────────────────────────────────────
  const [phase, setPhase] = useState<
    'intro' | 'rows' | 'total' | 'rankup' | 'done'
  >('intro');
  const [visibleRows, setVisibleRows] = useState<number>(-1); // -1 = none shown
  const [countXp,     setCountXp]     = useState(0);
  const [showConfetti, setShowConfetti] = useState(false);
  const [skipped,     setSkipped]     = useState(false);
  const [continueReady, setContinueReady] = useState(false);
  const [rankUpDismissed, setRankUpDismissed] = useState(false);
  // Which rank label is shown in the progress bar — starts at old rank, steps through each crossed rank
  const [displayRankLabel, setDisplayRankLabel] = useState(previousRank.rank);
  const timerRefs = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Animated values
  const headerOpac  = useRef(new Animated.Value(0)).current;
  const totalOpac   = useRef(new Animated.Value(0)).current;
  const totalScale  = useRef(new Animated.Value(0.85)).current;
  const barAnim     = useRef(new Animated.Value(progressBefore / 100)).current;
  const rankBadgeScale  = useRef(new Animated.Value(0)).current;
  const rankBadgeOpac   = useRef(new Animated.Value(0)).current;
  const rankGlow    = useRef(new Animated.Value(0)).current;
  const screenDim   = useRef(new Animated.Value(0)).current;

  // ── Clear all timers on unmount ──────────────────────────────────────────────
  useEffect(() => {
    return () => { timerRefs.current.forEach(clearTimeout); };
  }, []);

  // ── Skip — jump straight to done ────────────────────────────────────────────
  const handleSkip = useCallback(() => {
    if (skipped) return;
    setSkipped(true);
    timerRefs.current.forEach(clearTimeout);
    timerRefs.current = [];
    setVisibleRows(breakdown.length - 1);
    setCountXp(totalXpEarned);
    setDisplayRankLabel(newRank.rank);
    barAnim.setValue(progressAfter / 100);
    setPhase('done');
    setContinueReady(true);
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onContinue();
  }, [skipped, breakdown.length, totalXpEarned, progressAfter]);

  // ── Dismiss rank-up popup only — return to XP panel with Continue ───────────
  const handleDismissRankUp = useCallback(() => {
    if (rankUpDismissed) return;
    setRankUpDismissed(true);
    // Stop and snap all rank-up animations cleanly
    screenDim.stopAnimation();
    rankBadgeScale.stopAnimation();
    rankBadgeOpac.stopAnimation();
    rankGlow.stopAnimation();
    screenDim.setValue(0);
    rankBadgeScale.setValue(0);
    rankBadgeOpac.setValue(0);
    rankGlow.setValue(0);
    // Return to XP panel — show Continue button
    setDisplayRankLabel(newRank.rank);
    barAnim.setValue(progressAfter / 100);
    setPhase('done');
    setContinueReady(true);
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }, [rankUpDismissed]);
  useEffect(() => {
    const t = (fn: () => void, ms: number) => {
      const id = setTimeout(fn, ms);
      timerRefs.current.push(id);
      return id;
    };

    // 1. Fade in header
    Animated.timing(headerOpac, { toValue: 1, duration: 350, useNativeDriver: true }).start();

    // 2. Start revealing rows after short intro
    t(() => {
      setPhase('rows');
      let delay = 0;
      breakdown.forEach((_, i) => {
        const rowDelay = i >= 5 ? FAST_DELAY_MS : ROW_DELAY_MS;
        delay += rowDelay;
        t(() => setVisibleRows(i), delay);
      });

      // 3. After last row — show total
      const totalDelay = delay + 350;
      t(() => {
        setPhase('total');
        if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});

        // Count up XP
        const stepMs = Math.min(COUNT_MS / Math.max(totalXpEarned, 1), 16);
        const steps  = Math.ceil(COUNT_MS / 16);
        let step = 0;
        const countInterval = setInterval(() => {
          step++;
          const progress = step / steps;
          const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
          setCountXp(Math.round(eased * totalXpEarned));
          if (step >= steps) clearInterval(countInterval);
        }, 16);

        // Fade in total block
        Animated.parallel([
          Animated.timing(totalOpac,  { toValue: 1, duration: 300, useNativeDriver: true }),
          Animated.spring(totalScale, { toValue: 1, useNativeDriver: true, bounciness: 6 }),
        ]).start();

        // Progress bar — multi-segment: fill through each crossed rank in order
        t(() => {
          // Build list of rank segments to animate through:
          // Each segment is { fillTo, label } where fillTo is 0–1
          // Starting from previousRank, fill to 1.0 for each crossed rank,
          // then fill to progressAfter for the final rank.
          const segments: { fillTo: number; labelAfter: string }[] = [];

          // Find all ranks crossed between previousRank and newRank
          const prevIdx = RANK_LADDER.findIndex(r => r.rank === previousRank.rank);
          const newIdx  = RANK_LADDER.findIndex(r => r.rank === newRank.rank);

          if (newIdx > prevIdx) {
            // For each intermediate rank (not the final), fill bar to 100%
            for (let i = prevIdx; i < newIdx; i++) {
              segments.push({
                fillTo:     1.0,
                labelAfter: RANK_LADDER[i + 1].rank,  // switch to next rank label after fill
              });
            }
          }
          // Final segment: fill to progressAfter in the final rank
          segments.push({
            fillTo:     progressAfter / 100,
            labelAfter: newRank.rank,
          });

          // How long each segment fill should take
          // Single segment: BAR_MS. Multiple: split time between them.
          const segDuration = segments.length <= 1 ? BAR_MS : Math.round(BAR_MS / segments.length);

          // Chain segments sequentially
          const runSegment = (idx: number) => {
            if (idx >= segments.length) return;
            const seg = segments[idx];
            Animated.timing(barAnim, {
              toValue:  seg.fillTo,
              duration: segDuration,
              useNativeDriver: false,
            }).start(({ finished }) => {
              if (!finished) return; // was stopped by skip/dismiss
              setDisplayRankLabel(seg.labelAfter);
              if (idx < segments.length - 1) {
                // Short pause then reset bar to 0 and run next segment
                setTimeout(() => {
                  barAnim.setValue(0);
                  runSegment(idx + 1);
                }, 180);
              }
            });
          };

          runSegment(0);
        }, 200);

        // 4. Rank-up sequence or done
        if (didRankUp) {
          t(() => {
            setPhase('rankup');
            setShowConfetti(true);
            if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});

            // Dim screen + spin badge in
            Animated.parallel([
              Animated.timing(screenDim, { toValue: 0.55, duration: 400, useNativeDriver: true }),
              Animated.spring(rankBadgeScale, { toValue: 1, useNativeDriver: true, bounciness: 14, speed: 6 }),
              Animated.timing(rankBadgeOpac, { toValue: 1, duration: 350, useNativeDriver: true }),
            ]).start(() => {
              // Glow pulse
              Animated.sequence([
                Animated.timing(rankGlow, { toValue: 1, duration: 400, useNativeDriver: true }),
                Animated.timing(rankGlow, { toValue: 0.4, duration: 400, useNativeDriver: true }),
                Animated.timing(rankGlow, { toValue: 1, duration: 300, useNativeDriver: true }),
              ]).start(() => {
                setPhase('done');
                setContinueReady(true);
              });
            });
          }, RANUP_DELAY + BAR_MS);
        } else {
          t(() => {
            setPhase('done');
            setContinueReady(true);
          }, BAR_MS + 300);
        }
      }, totalDelay);
    }, 600);
  }, []);

  const barWidth = barAnim.interpolate({
    inputRange: [0, 1], outputRange: ['0%', '100%'], extrapolate: 'clamp',
  });
  const glowOpac = rankGlow.interpolate({ inputRange: [0, 1], outputRange: [0, 0.6] });

  return (
    <View style={ov.root}>

      {/* ── Dark overlay ──────────────────────────────────────────────────── */}
      <View style={ov.backdrop} />

      {/* ── Panel ─────────────────────────────────────────────────────────── */}
      <View style={ov.panel}>

        {/* X skip button */}
        <Pressable
          onPress={handleSkip}
          style={ov.closeBtn}
          hitSlop={12}
        >
          <MaterialIcons name="close" size={20} color={MUTED} />
        </Pressable>

        {/* Header */}
        <Animated.View style={[ov.headerBlock, { opacity: headerOpac }]}>
          <Text style={ov.smallLabel}>♦  HUNT COMPLETE  ♦</Text>
          <Text style={ov.mainTitle}>
            {phase === 'intro' ? 'Calculating Rewards…' : 'Hunt Results'}
          </Text>
        </Animated.View>

        {/* Ornament */}
        <View style={ov.ornamentRow}>
          <View style={ov.ornLine} />
          <Text style={ov.ornGlyph}>✦</Text>
          <View style={ov.ornLine} />
        </View>

        {/* Breakdown rows */}
        <View style={ov.rowsArea}>
          {breakdown.length === 0 ? (
            <View style={ov.zeroXpRow}>
              <MaterialIcons name="check-circle" size={14} color={GOLD} />
              <Text style={ov.zeroXpText}>No XP earned this hunt</Text>
            </View>
          ) : (
            breakdown.map((item, i) => (
              <BreakdownRow
                key={item.id}
                item={item}
                visible={visibleRows >= i}
              />
            ))
          )}
        </View>

        {/* Total XP block */}
        {(phase === 'total' || phase === 'rankup' || phase === 'done') && (
          <Animated.View style={[ov.totalBlock, { opacity: totalOpac, transform: [{ scale: totalScale }] }]}>
            <View style={ov.totalRow}>
              <Text style={ov.totalLabel}>TOTAL XP EARNED</Text>
              <Text style={ov.totalXp}>+{countXp} XP</Text>
            </View>
            <View style={ov.rankRow}>
              <View style={ov.rankIcon}>
                <MaterialIcons name="emoji-events" size={16} color={GOLD} />
              </View>
              <Text style={ov.rankName}>{displayRankLabel}</Text>
            </View>
            <View style={ov.progressTrack}>
              <Animated.View style={[ov.progressFill, { width: barWidth }]} />
            </View>
            <View style={ov.progressLabels}>
              <Text style={ov.progressCurrent}>{newTotalXp.toLocaleString()} XP</Text>
            </View>
          </Animated.View>
        )}

        {/* Continue button */}
        {continueReady && (
          <Pressable
            onPress={onContinue}
            style={({ pressed }) => [ov.continueBtn, pressed && { opacity: 0.85 }]}
          >
            <Text style={ov.continueBtnText}>Continue</Text>
            <MaterialIcons name="arrow-forward" size={16} color={CREAM} />
          </Pressable>
        )}

      </View>

      {/* ── Rank-up overlay ────────────────────────────────────────────────── */}
      {phase === 'rankup' || (phase === 'done' && didRankUp && showConfetti) ? (
        <Animated.View
          pointerEvents="none"
          style={[ov.rankUpOverlay, { opacity: screenDim }]}
        />
      ) : null}

      {/* Rank-up badge */}
      {(phase === 'rankup' || (phase === 'done' && didRankUp && !rankUpDismissed)) && (
        <Animated.View
          style={[ov.rankUpCenter, {
            opacity: rankBadgeOpac,
            transform: [{ scale: rankBadgeScale }],
          }]}
        >
          {/* X dismiss button — fades in with badge */}
          <Pressable
            onPress={handleDismissRankUp}
            hitSlop={14}
            style={ov.rankUpCloseBtn}
          >
            <MaterialIcons name="close" size={18} color={CREAM} />
          </Pressable>
          {/* Glow halo */}
          <Animated.View style={[ov.glowHalo, { opacity: glowOpac }]} />

          {/* Badge */}
          <View style={ov.rankUpBadge}>
            <Text style={ov.rankUpSmall}>RANK UP</Text>
            <MaterialIcons name="emoji-events" size={40} color={GOLD_L} />
            <Text style={ov.rankUpOld}>{previousRank.rank}</Text>
            <View style={ov.arrowRow}>
              <View style={ov.rankArrowLine} />
              <MaterialIcons name="arrow-forward" size={14} color={GOLD} />
              <View style={ov.rankArrowLine} />
            </View>
            <Text style={ov.rankUpNew}>{newRank.rank}</Text>
          </View>

          {/* Confetti burst */}
          {showConfetti && (
            <View style={ov.confettiWrap} pointerEvents="none">
              {Array.from({ length: 14 }).map((_, i) => (
                <ConfettiParticle key={i} index={i} />
              ))}
            </View>
          )}
        </Animated.View>
      )}

    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const ov = StyleSheet.create({
  root: {
    position: 'absolute', inset: 0,
    justifyContent: 'center', alignItems: 'center',
    zIndex: 999,
  },
  backdrop: {
    position: 'absolute', inset: 0,
    backgroundColor: 'rgba(8,18,8,0.82)',
  },

  panel: {
    width:         SW - 40,
    maxHeight:     SH * 0.85,
    backgroundColor: FOREST_M,
    borderRadius:  20,
    borderWidth:   1,
    borderColor:   GOLD + '44',
    paddingHorizontal: 20,
    paddingVertical:   22,
    gap: 0,
    zIndex: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 12,
  },

  closeBtn: {
    position: 'absolute', top: 14, right: 14,
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center', alignItems: 'center',
    zIndex: 2,
  },

  headerBlock: { alignItems: 'center', marginBottom: 12 },
  smallLabel: {
    fontSize: 9, fontWeight: '800', color: GOLD, letterSpacing: 2.5, marginBottom: 6,
  },
  mainTitle: {
    fontFamily: FONTS.serif, fontSize: 22, fontWeight: '800',
    color: CREAM, textAlign: 'center',
  },

  ornamentRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  ornLine:     { flex: 1, height: 1, backgroundColor: GOLD + '33' },
  ornGlyph:    { fontSize: 12, color: GOLD },

  rowsArea:    { gap: 2, marginBottom: 10, minHeight: 20 },
  zeroXpRow:   { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  zeroXpText:  { fontSize: 13, color: MUTED, fontStyle: 'italic' },

  totalBlock:  {
    backgroundColor: 'rgba(0,0,0,0.25)', borderRadius: 12,
    borderWidth: 1, borderColor: GOLD + '33',
    padding: 14, marginBottom: 14, gap: 8,
  },
  totalRow:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  totalLabel:  { fontSize: 9, fontWeight: '800', color: MUTED, letterSpacing: 2 },
  totalXp:     { fontFamily: FONTS.serif, fontSize: 28, fontWeight: '900', color: GOLD_L },

  rankRow:     { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rankIcon:    {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: GOLD + '22', borderWidth: 1, borderColor: GOLD + '44',
    justifyContent: 'center', alignItems: 'center',
  },
  rankName:    { fontFamily: FONTS.serif, fontSize: 14, fontWeight: '700', color: CREAM },

  progressTrack: { height: 6, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 3, overflow: 'hidden' },
  progressFill:  { height: '100%', backgroundColor: GOLD, borderRadius: 3 },
  progressLabels:{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 3 },
  progressCurrent:{ fontSize: 10, color: MUTED },

  continueBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: FOREST, borderRadius: 12,
    paddingVertical: 14, borderWidth: 1, borderColor: GOLD + '44',
  },
  continueBtnText: {
    fontFamily: FONTS.serif, fontSize: 15, fontWeight: '800',
    color: CREAM, letterSpacing: 0.5,
  },

  // ── Rank-up ────────────────────────────────────────────────────────────────
  rankUpOverlay: {
    position: 'absolute', inset: 0,
    backgroundColor: '#000', zIndex: 2,
  },
  rankUpCenter: {
    position: 'absolute',
    top: '50%', left: '50%',
    marginTop: -110, marginLeft: -110,
    width: 220, height: 220,
    justifyContent: 'center', alignItems: 'center',
    zIndex: 3,
  },
  glowHalo: {
    position: 'absolute',
    width: 200, height: 200, borderRadius: 100,
    backgroundColor: GOLD_L,
    zIndex: -1,
  },
  rankUpCloseBtn: {
    position: 'absolute', top: -14, right: -14,
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: 'rgba(10,20,10,0.80)',
    borderWidth: 1, borderColor: GOLD + '44',
    justifyContent: 'center', alignItems: 'center',
    zIndex: 10,
  },
  rankUpBadge: {
    backgroundColor: FOREST_M, borderRadius: 20,
    borderWidth: 1.5, borderColor: GOLD + '88',
    padding: 20, alignItems: 'center', gap: 6,
    shadowColor: GOLD_L, shadowOpacity: 0.6, shadowRadius: 20, shadowOffset: { width: 0, height: 0 },
    elevation: 16,
  },
  rankUpSmall:  { fontSize: 10, fontWeight: '900', color: GOLD, letterSpacing: 3 },
  rankUpOld:    { fontSize: 12, color: MUTED, textDecorationLine: 'line-through' },
  arrowRow:     { flexDirection: 'row', alignItems: 'center', gap: 6, width: '100%', justifyContent: 'center' },
  rankArrowLine:{ flex: 1, height: 1, backgroundColor: GOLD + '44' },
  rankUpNew:    { fontFamily: FONTS.serif, fontSize: 16, fontWeight: '900', color: GOLD_L },

  confettiWrap: {
    position: 'absolute', top: '50%', left: '50%',
    width: 0, height: 0,
  },
});

const r = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 5, gap: 8,
  },
  rowHidden: { opacity: 0 },
  icon:      { marginTop: 1 },
  labelWrap: { flex: 1 },
  label:     { fontSize: 13, color: CREAM, fontWeight: '500' },
  detail:    { fontSize: 10, color: MUTED, marginTop: 1 },
  xp: {
    fontFamily: FONTS.serif, fontSize: 14, fontWeight: '800',
    color: GOLD_L, minWidth: 56, textAlign: 'right',
  },
});
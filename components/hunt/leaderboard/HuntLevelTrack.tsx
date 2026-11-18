/**
 * components/hunt/leaderboard/HuntLevelTrack.tsx
 *
 * MY HUNT LEVEL: the viewer's place on the whole rank ladder.
 *
 *   summary   "Hyena Hustler · Rank 4 of 23", "420 XP to Warthog Wanderer", a small bar
 *   track     one line through all 23 ranks, scrolled sideways, filled gold up to
 *             the exact point between the current rank and the next
 *
 * It opens with the current rank near the middle. That first placement never
 * animates; a later change does, unless Reduce Motion is on.
 *
 * Progress here does not depend on how many people are on the boards, which is
 * the point: on a quiet week there is still something to climb.
 */
import { View, Text, ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
import { useEffect, useMemo, useRef } from 'react';
import { RANK_LADDER, rankIndexFor } from '@shared/hunt/ranks';
import {
  levelSummary, trackPosition, trackOffset, nodeState, nodeA11yLabel, formatXp, RANK_COUNT, type NodeState,
} from '@/lib/leaderboard';
import { FONTS } from '@/constants/typography';
import { LB, MAX_TEXT_SCALE } from './theme';

const CELL      = 104;   // one rank's width on the track
const PAD       = 6;     // space before the first cell and after the last
const MARKER_H  = 20;    // the "YOU" / "NEXT" row above the nodes
const NODE_H    = 38;    // the row the nodes and the line sit in
const LINE_H    = 4;

const trackOffsetFor = (index: number, viewportWidth: number) => trackOffset(index, viewportWidth, CELL, PAD);

export function HuntLevelTrack({ totalXp, signedIn, reduceMotion }: {
  /** Lifetime XP as the server holds it. Ignored when signed out. */
  totalXp: number;
  signedIn: boolean;
  reduceMotion: boolean;
}) {
  const { width: winW } = useWindowDimensions();
  const viewportW = winW - 32;                       // the panel's inner width
  const xp = signedIn ? Math.max(0, totalXp || 0) : 0;
  const index = rankIndexFor(xp);
  const summary = useMemo(() => levelSummary(xp), [xp]);
  const fill = signedIn ? trackPosition(xp) : 0;

  const scroller = useRef<ScrollView>(null);
  const placed = useRef(false);
  const initialX = useRef(trackOffsetFor(index, viewportW)).current;
  useEffect(() => {
    const x = trackOffsetFor(index, viewportW);
    // First placement: jump. Afterwards (XP arrived, a rank-up): glide, unless Reduce Motion.
    scroller.current?.scrollTo({ x, y: 0, animated: placed.current && !reduceMotion });
    placed.current = true;
  }, [index, viewportW, reduceMotion]);

  const line = signedIn ? summary.line : 'Sign in to track your level';

  return (
    <View style={s.panel} testID="hunt-level">
      <View
        accessible
        accessibilityLabel={`My Hunt Level. ${summary.headline}. ${line}.`}
        style={s.summary}
      >
        <Text style={s.label} maxFontSizeMultiplier={MAX_TEXT_SCALE}>MY HUNT LEVEL</Text>
        <Text style={s.headline} maxFontSizeMultiplier={MAX_TEXT_SCALE} testID="hunt-level-headline">
          {summary.headline}
        </Text>
        <Text style={s.line} maxFontSizeMultiplier={MAX_TEXT_SCALE} testID="hunt-level-line">{line}</Text>
        {signedIn && !summary.atTop && (
          <View style={s.bar}>
            <View style={[s.barFill, { width: `${summary.progress}%` }]} />
          </View>
        )}
      </View>

      <ScrollView
        ref={scroller}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentOffset={{ x: initialX, y: 0 }}
        contentContainerStyle={s.trackContent}
        testID="hunt-level-track"
      >
        {/* The line: muted all the way, gold up to the viewer's exact position. */}
        <View style={[s.rail, { width: CELL * (RANK_COUNT - 1) }]} />
        <View style={[s.rail, s.railFill, { width: CELL * fill }]} testID="hunt-level-fill" />

        {RANK_LADDER.map((r, i) => {
          const state = nodeState(i, index);
          const crown = i === RANK_COUNT - 1;
          return (
            <View
              key={r.rank}
              style={s.cell}
              accessible
              accessibilityLabel={nodeA11yLabel(i, signedIn ? index : null)}
            >
              <View style={s.markerRow}>
                {state === 'current' && (
                  <Text style={[s.marker, s.markerYou]} maxFontSizeMultiplier={1.3}>{signedIn ? 'YOU' : 'START'}</Text>
                )}
                {state === 'next' && signedIn && (
                  <Text style={s.marker} maxFontSizeMultiplier={1.3}>NEXT</Text>
                )}
              </View>
              <View style={s.nodeRow}>
                {crown ? <CrownNode state={state} /> : <Node state={state} />}
              </View>
              <Text
                style={[s.rankName, state === 'current' && s.rankNameCurrent, state === 'future' && s.rankNameFuture]}
                numberOfLines={2}
                maxFontSizeMultiplier={MAX_TEXT_SCALE}
              >
                {r.rank}
              </Text>
              <Text style={[s.rankXp, state === 'future' && s.rankNameFuture]} maxFontSizeMultiplier={MAX_TEXT_SCALE}>
                {formatXp(r.xp)}
              </Text>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

function Node({ state }: { state: NodeState }) {
  if (state === 'current') {
    return <View style={s.nodeRing}><View style={s.nodeCurrent} /></View>;
  }
  if (state === 'reached') return <View style={s.nodeReached} />;
  if (state === 'next') return <View style={s.nodeNext} />;
  return <View style={s.nodeFuture} />;
}

/** Lion King: the end of the line, drawn as a crown in a roundel. */
function CrownNode({ state }: { state: NodeState }) {
  const lit = state === 'current' || state === 'reached';
  const edge = lit || state === 'next' ? LB.GOLD : LB.LINE;
  const ink = lit ? LB.CREAM : state === 'next' ? LB.GOLD : LB.MUTED;
  return (
    <View style={[s.crownRoundel, { borderColor: edge, backgroundColor: lit ? LB.GOLD : LB.CARD }]} testID="hunt-level-crown">
      <View style={s.crownPeaks}>
        <View style={[s.peak, { borderBottomColor: ink, borderBottomWidth: 6 }]} />
        <View style={[s.peak, { borderBottomColor: ink, borderBottomWidth: 9 }]} />
        <View style={[s.peak, { borderBottomColor: ink, borderBottomWidth: 6 }]} />
      </View>
      <View style={[s.crownBase, { backgroundColor: ink }]} />
    </View>
  );
}

const s = StyleSheet.create({
  panel: {
    marginHorizontal: 16, backgroundColor: LB.CARD, borderRadius: 16,
    borderWidth: 1, borderColor: LB.CARD_EDGE, overflow: 'hidden',
  },
  summary:  { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 },
  label:    { fontSize: 10, fontWeight: '800', letterSpacing: 1.6, color: LB.MUTED, marginBottom: 5 },
  headline: { fontFamily: FONTS.serif, fontSize: 17, fontWeight: '800', color: LB.FOREST },
  line:     { fontSize: 13, fontWeight: '600', color: LB.BROWN, marginTop: 3 },
  bar: {
    height: 6, borderRadius: 3, backgroundColor: LB.CREAM, borderWidth: 1, borderColor: LB.CARD_EDGE,
    overflow: 'hidden', marginTop: 9,
  },
  barFill: { height: '100%', backgroundColor: LB.GOLD, borderRadius: 3 },

  trackContent: { paddingHorizontal: PAD, paddingTop: 6, paddingBottom: 14 },
  rail: {
    position: 'absolute', left: PAD + CELL / 2, top: 6 + MARKER_H + (NODE_H - LINE_H) / 2,
    height: LINE_H, borderRadius: LINE_H / 2, backgroundColor: LB.LINE,
  },
  railFill: { backgroundColor: LB.GOLD },

  cell:      { width: CELL, alignItems: 'center' },
  markerRow: { height: MARKER_H, justifyContent: 'flex-end', alignItems: 'center' },
  marker:    { fontSize: 9, fontWeight: '800', letterSpacing: 1.2, color: LB.MUTED },
  markerYou: { color: LB.GOLD_DEEP },
  nodeRow:   { height: NODE_H, alignItems: 'center', justifyContent: 'center' },

  nodeReached: { width: 14, height: 14, borderRadius: 7, backgroundColor: LB.GOLD },
  nodeRing: {
    width: 32, height: 32, borderRadius: 16, borderWidth: 2.5, borderColor: LB.GOLD,
    backgroundColor: LB.CARD, alignItems: 'center', justifyContent: 'center',
  },
  nodeCurrent: { width: 18, height: 18, borderRadius: 9, backgroundColor: LB.GOLD },
  nodeNext: {
    width: 16, height: 16, borderRadius: 8, borderWidth: 2.5, borderColor: LB.GOLD, backgroundColor: LB.CARD,
  },
  nodeFuture: {
    width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: LB.LINE, backgroundColor: LB.CARD,
  },

  crownRoundel: {
    width: 34, height: 34, borderRadius: 17, borderWidth: 2.5, alignItems: 'center', justifyContent: 'center',
  },
  crownPeaks: { flexDirection: 'row', alignItems: 'flex-end' },
  peak: {
    width: 0, height: 0, borderLeftWidth: 3, borderRightWidth: 3,
    borderLeftColor: 'transparent', borderRightColor: 'transparent',
  },
  crownBase: { width: 18, height: 4, borderRadius: 1 },

  rankName: {
    fontFamily: FONTS.serif, fontSize: 11.5, fontWeight: '700', color: LB.FOREST,
    textAlign: 'center', paddingHorizontal: 6, marginTop: 2,
  },
  rankNameCurrent: { fontWeight: '800', color: LB.FOREST_DEEP },
  rankNameFuture:  { color: LB.MUTED },
  rankXp: { fontSize: 10.5, fontWeight: '600', color: LB.BROWN, marginTop: 2, textAlign: 'center' },
});
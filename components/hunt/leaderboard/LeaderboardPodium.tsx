/**
 * components/hunt/leaderboard/LeaderboardPodium.tsx
 *
 * The top three: #2 on the left, #1 in the middle and taller, #3 on the right.
 *
 * Designed for the small board first. With fewer than three ranked hunters the
 * remaining plinths stay standing and read "Open spot", so two people on the
 * board still looks like a board with room on it, not a broken list.
 */
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { formatXp, podiumSlots, type BoardRow } from '@/lib/leaderboard';
import { FONTS } from '@/constants/typography';
import { HunterAvatar, FoundingMark } from './HunterAvatar';
import { LB, MAX_TEXT_SCALE } from './theme';

const PLACES = [2, 1, 3] as const;

export function LeaderboardPodium({ rows, onPress }: {
  rows: BoardRow[];
  /** Another hunter was tapped or long-pressed. Never called for the viewer's own spot. */
  onPress?: (row: BoardRow) => void;
}) {
  const slots = podiumSlots(rows);
  return (
    <View style={s.wrap} testID="lb-podium">
      {slots.map((row, i) => <Spot key={PLACES[i]} place={PLACES[i]} row={row} onPress={onPress} />)}
    </View>
  );
}

function Spot({ place, row, onPress }: { place: 1 | 2 | 3; row: BoardRow | null; onPress?: (row: BoardRow) => void }) {
  const first = place === 1;
  const size = first ? 76 : 56;
  const plinth = [s.plinth, first ? s.plinthFirst : place === 2 ? s.plinthSecond : s.plinthThird];

  if (!row) {
    return (
      <View style={s.spot} accessible accessibilityLabel={`Number ${place}. Open spot.`} testID={`lb-podium-open-${place}`}>
        <View style={[s.openAvatar, { width: size, height: size, borderRadius: size / 2 }]} />
        <Text style={s.openText} maxFontSizeMultiplier={MAX_TEXT_SCALE}>Open spot</Text>
        <View style={plinth}>
          <Text style={[s.place, first && s.placeFirst]} maxFontSizeMultiplier={1.2}>{place}</Text>
        </View>
      </View>
    );
  }

  const canOpen = !!onPress && !row.isMe;
  const label =
    `Number ${place}. ${row.isMe ? 'You, ' : ''}${row.name}. ${formatXp(row.metric)}. ${row.rankTitle}.` +
    (row.foundingHunter ? ' Founding Hunter.' : '');
  return (
    <Pressable
      style={({ pressed }) => [s.spot, pressed && canOpen && { opacity: 0.75 }]}
      disabled={!canOpen}
      onPress={() => onPress?.(row)}
      onLongPress={() => onPress?.(row)}
      delayLongPress={300}
      accessibilityRole={canOpen ? 'button' : undefined}
      accessibilityLabel={label}
      accessibilityHint={canOpen ? 'Opens report and block options' : undefined}
      testID={`lb-podium-${place}`}
    >
      <HunterAvatar uri={row.avatarUrl} size={size} ring={first ? 'gold' : 'plain'} />
      <View style={s.nameRow}>
        <Text style={[s.name, first && s.nameFirst]} numberOfLines={2} maxFontSizeMultiplier={MAX_TEXT_SCALE}>
          {row.name}
        </Text>
        {row.foundingHunter && <FoundingMark size={first ? 14 : 12} />}
      </View>
      <Text style={[s.metric, first && s.metricFirst]} numberOfLines={1} maxFontSizeMultiplier={MAX_TEXT_SCALE}>
        {formatXp(row.metric)}
      </Text>
      {first && (
        <Text style={s.level} numberOfLines={1} maxFontSizeMultiplier={MAX_TEXT_SCALE}>{row.rankTitle}</Text>
      )}
      <View style={plinth}>
        <Text style={[s.place, first && s.placeFirst]} maxFontSizeMultiplier={1.2}>{place}</Text>
      </View>
    </Pressable>
  );
}

/** The podium's shape while the first board is loading. */
export function PodiumSkeleton() {
  return (
    <View style={s.wrap} testID="lb-podium-skeleton" accessible accessibilityLabel="Loading the leaderboard">
      {PLACES.map(place => {
        const first = place === 1;
        const size = first ? 76 : 56;
        return (
          <View key={place} style={s.spot}>
            <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: LB.SKELETON }} />
            <View style={[s.bone, { width: first ? 78 : 58, marginTop: 9 }]} />
            <View style={[s.bone, { width: first ? 54 : 40, marginTop: 6, marginBottom: 8 }]} />
            <View style={[s.plinth, first ? s.plinthFirst : place === 2 ? s.plinthSecond : s.plinthThird, s.plinthBone]} />
          </View>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    flexDirection: 'row', alignItems: 'flex-end', marginHorizontal: 16, paddingTop: 18, gap: 8, marginBottom: 14,
    borderBottomWidth: 1, borderBottomColor: LB.CARD_EDGE,       // the floor the plinths stand on
  },
  spot: { flex: 1, alignItems: 'center', minWidth: 0 },

  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 7, maxWidth: '100%', paddingHorizontal: 2 },
  name:      { flexShrink: 1, fontFamily: FONTS.serif, fontSize: 13, fontWeight: '800', color: LB.FOREST, textAlign: 'center' },
  nameFirst: { fontSize: 15 },
  metric:      { fontSize: 12.5, fontWeight: '800', color: LB.BROWN, marginTop: 2 },
  metricFirst: { fontSize: 14, color: LB.GOLD_DEEP },
  level: { fontSize: 11, fontWeight: '600', color: LB.MUTED, marginTop: 1 },

  openAvatar: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: LB.LINE, backgroundColor: 'transparent' },
  openText:   { fontSize: 12, fontWeight: '700', color: LB.MUTED, marginTop: 7 },

  plinth: {
    alignSelf: 'stretch', marginTop: 9, alignItems: 'center', justifyContent: 'flex-start', paddingTop: 7,
    backgroundColor: LB.CARD, borderWidth: 1, borderBottomWidth: 0, borderColor: LB.CARD_EDGE,
    borderTopLeftRadius: 10, borderTopRightRadius: 10,
  },
  plinthFirst:  { height: 74, backgroundColor: LB.GOLD_WASH, borderColor: LB.GOLD },
  plinthSecond: { height: 54 },
  plinthThird:  { height: 40 },
  plinthBone:   { backgroundColor: LB.SKELETON, borderColor: LB.SKELETON },
  place:      { fontFamily: FONTS.serif, fontSize: 20, fontWeight: '800', color: LB.MUTED },
  placeFirst: { fontSize: 26, color: LB.GOLD_DEEP },

  bone: { height: 10, borderRadius: 5, backgroundColor: LB.SKELETON },
});
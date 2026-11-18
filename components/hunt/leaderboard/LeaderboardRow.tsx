/**
 * components/hunt/leaderboard/LeaderboardRow.tsx
 *
 * One hunter, ranks 4 and below. The order is fixed:
 *
 *   picture · #position · name (Hunt level beneath) ……… the number
 *
 * Tapping or holding another hunter's row opens report and block. The viewer's
 * own row does nothing.
 */
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { memo } from 'react';
import { formatXp, type BoardRow } from '@/lib/leaderboard';
import { FONTS } from '@/constants/typography';
import { HunterAvatar, FoundingMark } from './HunterAvatar';
import { LB, MAX_TEXT_SCALE } from './theme';

export const LeaderboardRow = memo(function LeaderboardRow({ row, onPress }: {
  row: BoardRow;
  onPress?: (row: BoardRow) => void;
}) {
  const canOpen = !!onPress && !row.isMe;
  const label =
    `Number ${row.position}. ${row.isMe ? 'You, ' : ''}${row.name}. ${row.rankTitle}. ${formatXp(row.metric)}.` +
    (row.foundingHunter ? ' Founding Hunter.' : '');
  return (
    <Pressable
      style={({ pressed }) => [s.row, row.isMe && s.rowMe, pressed && canOpen && { opacity: 0.7 }]}
      disabled={!canOpen}
      onPress={() => onPress?.(row)}
      onLongPress={() => onPress?.(row)}
      delayLongPress={300}
      accessibilityRole={canOpen ? 'button' : undefined}
      accessibilityLabel={label}
      accessibilityHint={canOpen ? 'Opens report and block options' : undefined}
      testID={`lb-row-${row.position}`}
    >
      <HunterAvatar uri={row.avatarUrl} size={40} />
      <Text style={s.position} numberOfLines={1} maxFontSizeMultiplier={1.3}>#{row.position}</Text>
      <View style={s.who}>
        <View style={s.nameRow}>
          <Text style={s.name} numberOfLines={1} maxFontSizeMultiplier={MAX_TEXT_SCALE}>{row.name}</Text>
          {row.foundingHunter && <FoundingMark size={13} />}
        </View>
        <Text style={s.level} numberOfLines={1} maxFontSizeMultiplier={MAX_TEXT_SCALE}>{row.rankTitle}</Text>
      </View>
      <Text style={s.metric} numberOfLines={1} maxFontSizeMultiplier={MAX_TEXT_SCALE}>{formatXp(row.metric)}</Text>
    </Pressable>
  );
});

/** A row's shape while the first board is loading. */
export function RowSkeleton() {
  return (
    <View style={s.row} accessible={false}>
      <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: LB.SKELETON }} />
      <View style={[s.bone, { width: 26 }]} />
      <View style={s.who}>
        <View style={[s.bone, { width: 120 }]} />
        <View style={[s.bone, { width: 84, marginTop: 7, height: 8 }]} />
      </View>
      <View style={[s.bone, { width: 56 }]} />
    </View>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: 16, paddingVertical: 10, paddingHorizontal: 12,
    backgroundColor: LB.CARD, borderWidth: 1, borderColor: LB.CARD_EDGE, borderRadius: 14, marginBottom: 8,
  },
  rowMe: { borderColor: LB.GOLD, backgroundColor: LB.GOLD_WASH },
  position: { minWidth: 34, fontFamily: FONTS.serif, fontSize: 15, fontWeight: '800', color: LB.BROWN },
  who:     { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  name:    { flexShrink: 1, fontFamily: FONTS.serif, fontSize: 15, fontWeight: '800', color: LB.FOREST },
  level:   { fontSize: 12, fontWeight: '600', color: LB.MUTED, marginTop: 2 },
  metric:  { fontSize: 14, fontWeight: '800', color: LB.FOREST, marginLeft: 6 },
  bone:    { height: 11, borderRadius: 5.5, backgroundColor: LB.SKELETON },
});
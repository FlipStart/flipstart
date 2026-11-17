/**
 * components/hunt/discovery/HuntRatingBadge.tsx
 *
 * The Hunt rating, prominent: Legendary Loot / Treasure / Risky Buy / Skip.
 * While no thrift price is in, it is dashed and tagged ESTIMATED so it can
 * never be mistaken for the final rating.
 */
import { View, Text, StyleSheet } from 'react-native';
import { FONTS } from '@/constants/typography';
import type { HuntRating } from '@/lib/huntEconomics';
import { HUNT_BADGE } from './theme';

export function HuntRatingBadge({ rating, provisional }: { rating: HuntRating; provisional: boolean }) {
  const b = HUNT_BADGE[rating] ?? HUNT_BADGE.trash;
  return (
    <View
      testID="hunt-rating-badge"
      accessibilityLabel={`${provisional ? 'Estimated rating: ' : 'Hunt rating: '}${b.label}`}
      style={[
        s.badge,
        { backgroundColor: b.bg, borderColor: b.border },
        provisional && s.provisional,
        b.glow && { shadowColor: b.glow, shadowOpacity: 1, shadowRadius: 10, shadowOffset: { width: 0, height: 0 }, elevation: 5 },
      ]}
    >
      {provisional && <Text style={[s.est, { color: b.text }]}>ESTIMATED</Text>}
      <Text style={s.emoji}>{b.emoji}</Text>
      <Text style={[s.label, { color: b.text }]} numberOfLines={2}>{b.label.toUpperCase()}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  badge:       { width: 100, alignItems: 'center', justifyContent: 'center', paddingVertical: 12, paddingHorizontal: 6, borderRadius: 14, borderWidth: 1.5, gap: 4 },
  provisional: { borderStyle: 'dashed', opacity: 0.92 },
  est:         { fontSize: 7, fontWeight: '800', letterSpacing: 1.2 },
  emoji:       { fontSize: 24 },
  label:       { fontFamily: FONTS.serif, fontSize: 11, fontWeight: '800', letterSpacing: 0.8, textAlign: 'center' },
});
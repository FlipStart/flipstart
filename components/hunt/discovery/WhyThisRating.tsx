/**
 * components/hunt/discovery/WhyThisRating.tsx
 *
 * "Why Treasure": the recommendation engine's own headline and bullets, one
 * line comparing the user's price to the buy-under price, and the risk
 * factors that cost a tier. All structured — no AI-written paragraph.
 */
import { View, Text, StyleSheet } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import type { WhyRating } from '@/lib/huntDiscovery';
import { SectionCard } from './SectionCard';
import { H } from './theme';

export function WhyThisRating({ why }: { why: WhyRating }) {
  return (
    <SectionCard title={why.title} testID="hunt-why-rating">
      {!!why.headline && <Text style={s.headline}>{why.headline}</Text>}
      {why.reasons.map((r, i) => (
        <View key={i} style={s.row}>
          <MaterialIcons name="check-circle" size={14} color={H.forest} style={s.icon} />
          <Text style={s.reason}>{r}</Text>
        </View>
      ))}
      {why.watchOuts.length > 0 && (
        <View style={s.watch}>
          <Text style={s.watchTitle}>WATCH OUT</Text>
          <View style={s.chips}>
            {why.watchOuts.map(w => (
              <View key={w} style={s.chip}>
                <MaterialIcons name="error-outline" size={12} color={H.warn} />
                <Text style={s.chipText}>{w}</Text>
              </View>
            ))}
          </View>
        </View>
      )}
    </SectionCard>
  );
}

const s = StyleSheet.create({
  headline:   { fontSize: 14, fontWeight: '700', color: H.brown, marginBottom: 8, lineHeight: 19 },
  row:        { flexDirection: 'row', gap: 8, marginBottom: 6 },
  icon:       { marginTop: 2 },
  reason:     { flex: 1, fontSize: 13, color: H.brown, lineHeight: 18 },
  watch:      { marginTop: 6, paddingTop: 10, borderTopWidth: 1, borderTopColor: H.cardB + '90' },
  watchTitle: { fontSize: 9, fontWeight: '800', color: H.muted, letterSpacing: 1.2, marginBottom: 6 },
  chips:      { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip:       { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#F6E4D8', borderWidth: 1, borderColor: H.warn + '40', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  chipText:   { fontSize: 11, fontWeight: '700', color: H.warn },
});
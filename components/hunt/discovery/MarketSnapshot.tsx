/**
 * components/hunt/discovery/MarketSnapshot.tsx
 *
 * Compact two-column market tiles. Each fact once; no filler.
 */
import { View, Text, StyleSheet } from 'react-native';
import { FONTS } from '@/constants/typography';
import type { SnapshotTile } from '@/lib/huntDiscovery';
import { SectionCard } from './SectionCard';
import { H } from './theme';

export function MarketSnapshot({ tiles }: { tiles: SnapshotTile[] }) {
  if (tiles.length === 0) return null;
  return (
    <SectionCard title="Market Snapshot" testID="hunt-market-snapshot">
      <View style={s.grid}>
        {tiles.map(t => (
          <View key={t.label} style={s.tile}>
            <Text style={s.label} numberOfLines={1}>{t.label}</Text>
            <Text style={s.value} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{t.value}</Text>
          </View>
        ))}
      </View>
    </SectionCard>
  );
}

const s = StyleSheet.create({
  grid:  { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4 },
  tile:  { width: '50%', paddingHorizontal: 4, paddingVertical: 6 },
  label: { fontSize: 10, fontWeight: '700', color: H.muted, letterSpacing: 0.6, textTransform: 'uppercase' },
  value: { fontFamily: FONTS.serif, fontSize: 16, fontWeight: '800', color: H.brown, marginTop: 2 },
});
/**
 * components/hunt/discovery/ItemDetails.tsx
 *
 * Concise identification evidence (material, size, condition, era,
 * authenticity, rescan tip). Rows appear only when the scan has the data.
 */
import { View, Text, StyleSheet } from 'react-native';
import type { DetailRow } from '@/lib/huntDiscovery';
import { SectionCard } from './SectionCard';
import { H } from './theme';

export function ItemDetails({ rows }: { rows: DetailRow[] }) {
  if (rows.length === 0) return null;
  return (
    <SectionCard title="Item Details" testID="hunt-item-details">
      {rows.map((r, i) => (
        <View key={r.label} style={[s.row, i === rows.length - 1 && { borderBottomWidth: 0 }]}>
          <Text style={s.label}>{r.label}</Text>
          <Text style={[s.value, r.tone === 'warn' && { color: H.warn }]}>{r.value}</Text>
        </View>
      ))}
    </SectionCard>
  );
}

const s = StyleSheet.create({
  row:   { flexDirection: 'row', gap: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: H.cardB + '80' },
  label: { width: 92, fontSize: 12, color: H.muted },
  value: { flex: 1, fontSize: 13, fontWeight: '600', color: H.brown, lineHeight: 18 },
});
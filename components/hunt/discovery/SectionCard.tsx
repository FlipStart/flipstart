/**
 * components/hunt/discovery/SectionCard.tsx
 *
 * A Discovery Analysis section: a ♦ SMALL-CAPS GOLD ♦ heading over a cream
 * card with a gold hairline — the Hunt look, consistently.
 */
import type { ReactNode } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { FONTS } from '@/constants/typography';
import { H } from './theme';

export function SectionCard({ title, children, testID }: { title: string; children: ReactNode; testID?: string }) {
  return (
    <View style={s.wrap} testID={testID}>
      <Text style={s.title} accessibilityRole="header">♦  {title.toUpperCase()}  ♦</Text>
      <View style={s.card}>{children}</View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap:  { marginHorizontal: 16, marginTop: 22 },
  title: { fontFamily: FONTS.serif, fontSize: 11, fontWeight: '800', color: H.gold, letterSpacing: 1.8, textAlign: 'center', marginBottom: 8 },
  card:  { backgroundColor: H.card, borderWidth: 1, borderColor: H.gold + '55', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12 },
});
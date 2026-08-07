/**
 * components/comps/SoldCompMetrics.tsx
 *
 * Premium metric cards and the confidence row.
 *
 * Every value here comes from Phase 2 PUBLIC statistics. A suppressed number is
 * null server-side, so this file never has the option of rendering a median it
 * should not — which is exactly how a $65 median from two listings reached the
 * screen before.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { C, formatMoney, confidenceColor, confidenceText, type ConfidenceLabel } from './tokens';

export interface PublicStats {
  medianSoldPrice: number | null;
  typicalLow: number | null;
  typicalHigh: number | null;
  reliableMatchCount: number;
  canShowMedian: boolean;
  canShowTypicalRange: boolean;
  limitedSample: boolean;
}

/**
 * Metric grid.
 *
 * Builds the card list from eligibility, so two eligible metrics render as two
 * equal-width cards rather than two cards and a gap. Nothing renders "—", "$0",
 * null or NaN: an ineligible metric simply is not built.
 */
export function SoldCompMetrics({ stats, currency = 'USD' }: { stats: PublicStats; currency?: string }) {
  const cards: Array<{ key: string; label: string; value: string; tone: 'green' | 'cream'; note?: string }> = [];

  if (stats.canShowMedian && stats.medianSoldPrice != null) {
    cards.push({
      key: 'median', label: 'MEDIAN SOLD',
      value: formatMoney(stats.medianSoldPrice, currency),
      tone: 'green',
      // Three or four comps can support a median but not a range. Saying so
      // keeps it from reading like a five-plus sample.
      note: stats.limitedSample ? 'Limited sample' : undefined,
    });
  }
  if (stats.canShowTypicalRange && stats.typicalLow != null && stats.typicalHigh != null) {
    cards.push({
      key: 'range', label: 'TYPICAL RANGE',
      value: `${formatMoney(stats.typicalLow, currency)}–${formatMoney(stats.typicalHigh, currency)}`,
      tone: 'cream',
    });
  }
  // Always shown when anything reliable exists. Replaces the old "SOLD 2",
  // which read as "this sold for 2".
  if (stats.reliableMatchCount > 0) {
    cards.push({
      key: 'count', label: stats.reliableMatchCount === 1 ? 'RELIABLE MATCH' : 'RELIABLE MATCHES',
      value: String(stats.reliableMatchCount), tone: 'cream',
    });
  }

  if (cards.length === 0) return null;

  return (
    <View style={s.grid}>
      {cards.map(c => (
        <View key={c.key} style={[s.metric, c.tone === 'green' ? s.metricGreen : s.metricCream]}>
          <Text style={[s.label, c.tone === 'green' && s.labelOnGreen]}>{c.label}</Text>
          <Text style={[s.value, c.tone === 'green' && s.valueOnGreen]}>{c.value}</Text>
          {!!c.note && <Text style={s.note}>{c.note}</Text>}
        </View>
      ))}
    </View>
  );
}

/**
 * Confidence on the left, counts on the right — the arrangement the sketch asks
 * for. Wraps rather than shrinking text on narrow screens.
 */
export function SoldCompConfidence({
  label, percent, summaryText,
}: {
  label: ConfidenceLabel | null;
  percent: number | null;
  summaryText: string | null;
}) {
  const color = confidenceColor(label);
  const text = confidenceText(label, percent);
  return (
    <View style={s.confRow}>
      <View
        style={[s.confPill, { borderColor: color }]}
        accessible
        /* Spoken, not colour-coded. Colour alone would exclude anyone who
           cannot distinguish it. */
        accessibilityLabel={`Sold comp confidence: ${label ?? 'insufficient'}${typeof percent === 'number' ? `, ${percent} percent` : ''}`}
      >
        <View style={[s.confDot, { backgroundColor: color }]} />
        <Text style={[s.confText, { color }]}>{text}</Text>
      </View>
      {!!summaryText && <Text style={s.summary}>{summaryText}</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  grid: { flexDirection: 'row', gap: 8, marginTop: 12 },
  metric: { flex: 1, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 9, borderWidth: 1.25 },
  metricGreen: { backgroundColor: C.forest, borderColor: C.gold },
  metricCream: { backgroundColor: C.cream, borderColor: C.gold + '77' },
  label: { fontSize: 8.5, fontWeight: '800', color: C.brown, letterSpacing: 0.8 },
  labelOnGreen: { color: C.gold },
  value: { fontSize: 16, fontWeight: '800', color: C.forest, marginTop: 3 },
  valueOnGreen: { color: '#F7F2DE' },
  note: { fontSize: 9, fontWeight: '700', color: C.gold, marginTop: 2 },
  confRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
             flexWrap: 'wrap', gap: 8, marginTop: 11 },
  confPill: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1.25,
              borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  confDot: { width: 7, height: 7, borderRadius: 4 },
  confText: { fontSize: 11, fontWeight: '800' },
  summary: { fontSize: 10.5, color: C.muted, flexShrink: 1, textAlign: 'right' },
});
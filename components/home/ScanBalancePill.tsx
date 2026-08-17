/**
 * components/home/ScanBalancePill.tsx
 *
 * Shows the SIGNED-IN USER'S authoritative scan balance.
 *
 * ── What changed and why ────────────────────────────────────────────────────
 * This used to fetch `GET /api/scan-stats` and display
 * `globalScansRemainingToday` — a GLOBAL beta backstop shared by everyone. It
 * had nothing to do with the viewer's own allowance, so buying a scan pack would
 * not move it and running out personally would not show.
 *
 * It now reads the same authoritative entitlement read model every gate uses, so
 * the number on Home is the number a scan will actually spend.
 *
 * Visual treatment is unchanged.
 */

import { useState, useEffect, useCallback } from 'react';
import { View, Text, Pressable, StyleSheet, AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { FONTS } from '@/constants/typography';
import { useEntitlement } from '@/lib/useEntitlement';

const GOLD    = '#BE9C2C';
const FOREST  = '#2A4A2A';
const WARNING = '#A04020';
const LIMIT   = 200;
export function ScanBalancePill() {
  const ent = useEntitlement();
  const [tipOpen, setTipOpen] = useState(false);

  const remaining = ent.totalUsableScans;
  const loading   = ent.loading;

  // Refresh on Home focus (returning from a scan) and on foreground. The scan
  // flow invalidates directly too; this is the safety net for anything that
  // changed the balance outside the app.
  useFocusEffect(useCallback(() => { ent.refresh(); }, [ent.refresh]));
  useEffect(() => {
    const sub = AppState.addEventListener('change', s => { if (s === 'active') ent.refresh(); });
    return () => sub.remove();
  }, [ent.refresh]);

  const isZero = remaining <= 0;
  // 5, not 30. A Free account starts with 15 lifetime scans, so a 30-scan
  // warning would be permanently on.
  const isLow  = remaining > 0 && remaining <= 5;
  const accent = isZero || isLow ? WARNING : GOLD;
  const color  = isZero || isLow ? WARNING : FOREST;

  /**
   * "remaining" — not "remaining today".
   *
   * Nothing here resets daily any more: Free scans are lifetime, pack scans
   * never expire, and subscription scans reset on the store's period boundary.
   * The old copy described the beta daily quota and would now be wrong.
   */
  const tooltipText = loading
    ? 'Checking scan balance…'
    : ent.packScansRemaining > 0
      ? `${remaining} scans remaining (${ent.packScansRemaining} from packs).`
      : `${remaining} scans remaining.`;

  return (
    <View style={s.wrap}>
      <Pressable
        onPress={() => setTipOpen(v => !v)}
        style={[s.pill, { borderColor: accent + '80' }]}
        hitSlop={6}
      >
        <Text style={[s.icon, { color: accent }]}>⚡</Text>
        <Text style={[s.label, { color }]}>
          {loading ? '…' : `${remaining} left`}
        </Text>
      </Pressable>

      {tipOpen && (
        <View style={s.tooltip}>
          <View style={s.tooltipArrow} />
          <Text style={s.tooltipText}>{tooltipText}</Text>
        </View>
      )}
    </View>
  );
}

export interface ScanBalancePillProps {
  remaining?: number | null;
  limit?:     number | null;
  loading?:   boolean;
  variant?:   'global' | 'user';
}

const s = StyleSheet.create({
  wrap: {
    alignItems:  'flex-end',
    position:    'relative',
  },
  pill: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               3,
    paddingHorizontal: 9,
    paddingVertical:   5,
    borderRadius:      20,
    borderWidth:       1,
    backgroundColor:   'rgba(190,156,44,0.10)',
  },
  icon:  { fontSize: 11, lineHeight: 14 },
  label: {
    fontFamily:    FONTS.serif,
    fontSize:      11,
    fontWeight:    '700',
    letterSpacing: 0.1,
  },
  tooltipArrow: {
    position:           'absolute',
    top:                -6,
    right:              18,
    width:              0,
    height:             0,
    borderLeftWidth:    6,
    borderRightWidth:   6,
    borderBottomWidth:  6,
    borderLeftColor:    'transparent',
    borderRightColor:   'transparent',
    borderBottomColor:  '#BE9C2C',
  },
  tooltip: {
    position:          'absolute',
    top:               32,
    right:             0,
    width:             220,
    backgroundColor:   '#FFFEFA',
    borderWidth:       1,
    borderColor:       '#BE9C2C',
    borderRadius:      10,
    paddingHorizontal: 12,
    paddingVertical:   10,
    shadowColor:       '#2A1A0A',
    shadowOffset:      { width: 0, height: 3 },
    shadowOpacity:     0.14,
    shadowRadius:      6,
    elevation:         6,
    zIndex:            100,
  },
  tooltipText: {
    fontFamily:  FONTS.serif,
    fontSize:    11,
    color:       '#5A3A1A',
    lineHeight:  16,
  },
});
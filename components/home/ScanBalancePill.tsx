/**
 * components/home/ScanBalancePill.tsx
 *
 * Fetches scan balance via plain REST GET /api/scan-stats.
 * Fetches on: mount, Home focus, app foreground.
 * No polling. No spam logs.
 */

import { useState, useEffect, useCallback } from 'react';
import { View, Text, Pressable, StyleSheet, AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { FONTS } from '@/constants/typography';

const GOLD    = '#BE9C2C';
const FOREST  = '#2A4A2A';
const WARNING = '#A04020';
const LIMIT   = 7;
const API_BASE = process.env.EXPO_PUBLIC_API_BASE_URL ?? '';

async function fetchScanStats(): Promise<number> {
  const { getScannerId } = await import('@/lib/analytics');
  const scannerId = await getScannerId().catch(() => undefined);
  const qs   = scannerId ? `?scannerId=${encodeURIComponent(scannerId)}` : '';
  const res  = await fetch(`${API_BASE}/api/scan-stats${qs}`, { method: 'GET' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  // Per-user response uses remainingToday; fall back to legacy global field.
  const val  = typeof data?.remainingToday === 'number' ? data.remainingToday : data?.globalScansRemainingToday;
  return typeof val === 'number' && !isNaN(val) ? val : LIMIT;
}

export function ScanBalancePill() {
  const [remaining, setRemaining] = useState<number | null>(null); // null = not loaded yet
  const [loading,   setLoading]   = useState(true);
  const [failed,    setFailed]    = useState(false);
  const [tipOpen,   setTipOpen]   = useState(false);

  const load = useCallback(async () => {
    try {
      const val = await fetchScanStats();
      setRemaining(val);
      setFailed(false);
    } catch {
      // Don't show a fake number on failure — mark failed so UI shows a dash
      // and the user can tap to retry, rather than a misleading "7 left".
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Refetch when Home gains focus (returns from scan)
  useFocusEffect(useCallback(() => {
    load();
  }, [load]));

  // Refetch when app returns to foreground
  useEffect(() => {
    const sub = AppState.addEventListener('change', s => {
      if (s === 'active') load();
    });
    return () => sub.remove();
  }, [load]);

  const hasData = remaining !== null;
  const isZero = hasData && remaining! <= 0;
  const isLow  = hasData && remaining! > 0 && remaining! <= 30;
  const accent = isZero || isLow ? WARNING : GOLD;
  const color  = isZero || isLow ? WARNING : FOREST;

  const tooltipText = loading && !hasData
    ? 'Checking scan balance…'
    : failed && !hasData
      ? "Couldn't load scan balance. Tap to retry."
      : `${remaining} scans remaining today.`;

  const labelText = !hasData
    ? (failed ? '—' : '…')
    : `${remaining} left`;

  return (
    <View style={s.wrap}>
      <Pressable
        onPress={() => { if (failed && !hasData) { load(); } setTipOpen(v => !v); }}
        style={[s.pill, { borderColor: accent + '80' }]}
        hitSlop={6}
      >
        <Text style={[s.icon, { color: accent }]}>⚡</Text>
        <Text style={[s.label, { color }]}>
          {labelText}
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
    backgroundColor:   '#FFF9EE',
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
/**
 * components/home/ScanBalancePill.tsx
 *
 * Fetches scan balance via plain REST GET /api/scan-stats.
 * Fetches on: mount, Home focus, app foreground.
 * No polling. No spam logs.
 */

import { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { FONTS } from '@/constants/typography';

const GOLD    = '#BE9C2C';
const FOREST  = '#2A4A2A';
const WARNING = '#A04020';
const LIMIT   = 200;
const API_BASE = process.env.EXPO_PUBLIC_API_BASE_URL ?? '';

async function fetchScanStats(): Promise<number> {
  const res  = await fetch(`${API_BASE}/api/scan-stats`, { method: 'GET' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const val  = data?.globalScansRemainingToday;
  return typeof val === 'number' && !isNaN(val) ? val : LIMIT;
}

export function ScanBalancePill() {
  const [remaining, setRemaining] = useState<number>(LIMIT);
  const [loading,   setLoading]   = useState(true);

  const load = useCallback(async () => {
    try {
      const val = await fetchScanStats();
      setRemaining(val);
    } catch {
      // Silent fail — keep showing current value, don't spam logs
      if (remaining === LIMIT && loading) {
        // Only on first load failure, keep showing LIMIT
        setRemaining(LIMIT);
      }
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

  const isZero = remaining <= 0;
  const isLow  = remaining > 0 && remaining <= 30;
  const accent = isZero || isLow ? WARNING : GOLD;
  const color  = isZero || isLow ? WARNING : FOREST;

  return (
    <View style={[s.pill, { borderColor: accent + '80' }]}>
      <Text style={[s.icon, { color: accent }]}>⚡</Text>
      <Text style={[s.label, { color }]}>
        {loading ? '…' : `${remaining} left`}
      </Text>
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
});
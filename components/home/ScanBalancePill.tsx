/**
 * components/home/ScanBalancePill.tsx
 *
 * Fetches scan balance via plain REST GET /api/scan-stats.
 * No tRPC. No prop drilling. Cannot be misconfigured.
 *
 * States:
 *   loading  → "⚡ …"
 *   success  → "⚡ 199 left"
 *   error    → never shows — defaults to 200
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

interface ScanStats {
  globalDailyLimit:          number;
  globalScansUsedToday:      number;
  globalScansRemainingToday: number;
}

async function fetchScanStats(): Promise<ScanStats> {
  const url = `${API_BASE}/api/scan-stats`;
  console.log('[ScanBalancePill] fetching:', url);
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  console.log('[ScanBalancePill] response:', JSON.stringify(data));
  return data as ScanStats;
}

export function ScanBalancePill() {
  const [remaining, setRemaining] = useState<number | null>(null);
  const [loading,   setLoading]   = useState(true);

  const load = useCallback(async () => {
    try {
      const stats = await fetchScanStats();
      const val   = stats?.globalScansRemainingToday;
      setRemaining(typeof val === 'number' && !isNaN(val) ? val : LIMIT);
    } catch (e) {
      console.warn('[ScanBalancePill] fetch failed — defaulting to', LIMIT, e);
      // Never show Beta — default to full limit on any error
      if (remaining === null) setRemaining(LIMIT);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load on mount
  useEffect(() => { load(); }, [load]);

  // Poll every 8s — catches decrement without needing navigation events
  useEffect(() => {
    const t = setInterval(() => { load(); }, 8_000);
    return () => clearInterval(t);
  }, [load]);

  // Immediate + delayed refetch when Home gains focus (after returning from scan)
  useFocusEffect(useCallback(() => {
    load();                                          // immediate
    const t = setTimeout(() => { load(); }, 1_500); // 1.5s later — server has settled
    return () => clearTimeout(t);
  }, [load]));

  // Reload when app comes back to foreground
  useEffect(() => {
    const sub = AppState.addEventListener('change', s => { if (s === 'active') load(); });
    return () => sub.remove();
  }, [load]);

  const count  = remaining ?? LIMIT;
  const isZero = count <= 0;
  const isLow  = count > 0 && count <= 30;
  const accent = isZero || isLow ? WARNING : GOLD;
  const color  = isZero || isLow ? WARNING : FOREST;

  return (
    <View style={[s.pill, { borderColor: accent + '80' }]}>
      <Text style={[s.icon, { color: accent }]}>⚡</Text>
      <Text style={[s.label, { color }]}>
        {loading ? '…' : `${count} left`}
      </Text>
    </View>
  );
}

// Kept for backwards compatibility — props are ignored
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
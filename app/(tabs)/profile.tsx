import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useState, useEffect } from 'react';
import { FONTS } from '@/constants/typography';
import { useFlipStore } from '@/lib/useFlipStore';
import { loadXpProfile, getCurrentRank } from '@/lib/huntXp';
import { isHuntBundle } from '@/types/flip';
import type { FlipResult } from '@/types/flip';

const FOREST = '#2A4A2A';
const GOLD   = '#BE9C2C';
const MUTED  = '#8A7050';
const BROWN  = '#5A3A1A';
const CARD   = '#FFF9EE';
const CARD_B = '#DDD0B0';
const BG     = '#F0E8D4';
const CREAM  = '#F4EED8';
const TAN    = '#D9C9A3';

export default function ProfileScreen() {
  const router  = useRouter();
  const insets  = useSafeAreaInsets();
  const { flips } = useFlipStore();

  // Only FlipResult entries have .profit/.category — HuntBundles are excluded from profile stats
  const scanFlips = flips.filter((f): f is FlipResult => !isHuntBundle(f));

  // ── XP rank — used as profile name ────────────────────────────────────────
  const [rankName, setRankName] = useState('Explorer');
  useEffect(() => {
    loadXpProfile().then(profile => {
      setRankName(getCurrentRank(profile.totalXp).rank);
    }).catch(() => {});
  }, []);

  // ── Stats derived from scan history ───────────────────────────────────────
  const totalScans  = scanFlips.length;
  const totalProfit = scanFlips.reduce((sum, f) => sum + Math.max(0, f.profit ?? 0), 0);
  const topFlip     = scanFlips.reduce<FlipResult | null>(
    (best, f) => (f.profit ?? 0) > (best?.profit ?? 0) ? f : best,
    null
  );
  const catCount: Record<string, number> = {};
  scanFlips.forEach(f => { if (f.category) catCount[f.category] = (catCount[f.category] ?? 0) + 1; });
  const topCategory = Object.entries(catCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={s.header}>
        <View style={{ width: 36 }} />
        <Text style={s.headerTitle}>Profile</Text>
        <Pressable
          onPress={() => router.push('/(tabs)/settings' as any)}
          hitSlop={8}
          style={({ pressed }) => [s.iconBtn, pressed && { opacity: 0.65 }]}
        >
          <MaterialIcons name="settings" size={20} color={FOREST} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {/* Avatar */}
        <View style={s.avatarBlock}>
          <View style={s.avatar}>
            <Text style={s.avatarEmoji}>👤</Text>
          </View>
          <Text style={s.name}>{rankName}</Text>
        </View>

        {/* Stats */}
        {totalScans > 0 ? (
          <>
            <Text style={s.sectionLabel}>YOUR STATS</Text>
            <View style={s.statsGrid}>
              <StatCard icon="photo-camera" value={String(totalScans)} label="Items Scanned" />
              <StatCard icon="trending-up" value={`$${Math.round(totalProfit)}`} label="Est. Total Profit" />
              {topFlip && (
                <StatCard icon="star" value={`$${Math.round(topFlip.profit ?? 0)}`} label="Best Flip" />
              )}
              {topCategory && (
                <StatCard icon="label" value={topCategory} label="Top Category" small />
              )}
            </View>
          </>
        ) : (
          <View style={s.emptyBlock}>
            <MaterialIcons name="photo-camera" size={32} color={MUTED} />
            <Text style={s.emptyText}>Scan your first item to see stats here.</Text>
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

function StatCard({
  icon, value, label, small = false,
}: {
  icon: string; value: string; label: string; small?: boolean;
}) {
  return (
    <View style={s.statCard}>
      <View style={s.statIconWrap}>
        <MaterialIcons name={icon as any} size={18} color={FOREST} />
      </View>
      <Text style={[s.statValue, small && { fontSize: 13 }]} numberOfLines={1}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: CARD_B,
    backgroundColor: FOREST,
  },
  headerTitle: { fontFamily: FONTS.serif, fontSize: 18, fontWeight: '700', color: CREAM },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center', alignItems: 'center',
  },

  scroll: { paddingHorizontal: 16, paddingTop: 20 },

  avatarBlock: { alignItems: 'center', gap: 8, marginBottom: 24 },
  avatar: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: TAN, borderWidth: 2, borderColor: GOLD,
    justifyContent: 'center', alignItems: 'center',
  },
  avatarEmoji: { fontSize: 36 },
  name:        { fontFamily: FONTS.serif, fontSize: 18, fontWeight: '800', color: BROWN },

  sectionLabel: {
    fontSize: 10, fontWeight: '700', color: MUTED,
    letterSpacing: 1.4, marginBottom: 8, marginLeft: 2,
  },

  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 8 },
  statCard: {
    width: '47%', backgroundColor: CARD, borderRadius: 12,
    borderWidth: 1, borderColor: CARD_B,
    alignItems: 'center', padding: 14, gap: 4,
  },
  statIconWrap: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: GOLD + '18',
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 2,
  },
  statValue: { fontFamily: FONTS.serif, fontSize: 18, fontWeight: '800', color: FOREST },
  statLabel: { fontSize: 10, fontWeight: '600', color: MUTED, textAlign: 'center' },

  emptyBlock: { alignItems: 'center', gap: 10, paddingVertical: 32 },
  emptyText:  { fontSize: 13, color: MUTED, textAlign: 'center' },
});
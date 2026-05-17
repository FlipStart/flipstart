/**
 * history.tsx
 *
 * Source of truth: useFlipStore.flips ONLY.
 * scan-context is NOT used here — it only manages the temporary scan pipeline.
 *
 * Stats are derived from useFlipStore.globalStats (computed via flipCalculations.ts).
 * No formulas live in this file.
 */

import {
  Text, View, FlatList, Pressable, Platform,
  StyleSheet, TextInput,
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useState, useRef, useMemo, useCallback } from 'react';
import Swipeable from 'react-native-gesture-handler/Swipeable';

import { ScreenContainer } from '@/components/screen-container';
import { useFlipStore } from '@/lib/useFlipStore';
import { FlipResult } from '@/types/flip';
import { V } from '@/constants/vintage';
import { FONTS } from '@/constants/typography';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(ts: number): string {
  const d = new Date(ts);
  const diffMin = Math.floor((Date.now() - d.getTime()) / 60000);
  if (diffMin < 1)  return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24)   return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7)    return `${diffD}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ─── Rank badge ───────────────────────────────────────────────────────────────

function RankBadge({ rank }: { rank: number }) {
  const cfg: Record<number, { bg: string; text: string; label: string }> = {
    1: { bg: '#D4AF37', text: '#3A2A00', label: '🥇' },
    2: { bg: '#A8A9AD', text: '#1A1A1A', label: '🥈' },
    3: { bg: '#CD7F32', text: '#2A1000', label: '🥉' },
  };
  const c = cfg[rank] ?? { bg: V.tan, text: V.textMuted, label: `#${rank}` };
  return (
    <View style={[rb.badge, { backgroundColor: c.bg }]}>
      <Text style={[rb.text, { color: c.text }]}>{c.label}</Text>
    </View>
  );
}
const rb = StyleSheet.create({
  badge: { width: 34, height: 34, borderRadius: 10, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)' },
  text:  { fontSize: 13, fontWeight: '800' },
});

// ─── Swipeable scan card ──────────────────────────────────────────────────────
//
// Uses Swipeable from react-native-gesture-handler — native gesture recognizers
// cooperate correctly with FlatList scroll. No PanResponder conflicts.
//
// Behavior:
//   - Partial swipe left → reveals red Delete action (ACTION_WIDTH wide)
//   - Swiping reveals the delete button; tap it to confirm delete
//   - Only one row open at a time — openSwipeableRef tracks the active row
//   - Tapping the card when row is open closes it instead of navigating

const ACTION_WIDTH = 88;
const ACTION_GAP   = 10;  // gap between card right edge and red delete zone

// Module-level ref tracks the currently open Swipeable so we can close it
// when a new row opens. Shared across all FlipCard instances.
let openSwipeableRef: Swipeable | null = null;

function FlipCard({
  item, onPress, onDelete,
}: { item: FlipResult; onPress: () => void; onDelete: () => void }) {

  const swipeableRef = useRef<Swipeable>(null);

  const handleOpen = useCallback(() => {
    if (openSwipeableRef && openSwipeableRef !== swipeableRef.current) {
      openSwipeableRef.close();
    }
    openSwipeableRef = swipeableRef.current;
  }, []);

  const handleClose = useCallback(() => {
    if (openSwipeableRef === swipeableRef.current) openSwipeableRef = null;
  }, []);

  const renderRightActions = useCallback(() => (
    // Transparent wrapper is ACTION_WIDTH + ACTION_GAP wide so Swipeable
    // slides the card far enough to fully reveal the red zone.
    // The gap is purely visual — the red button still fills ACTION_WIDTH.
    <View style={fc.deleteWrapper}>
      <Pressable
        style={fc.deleteAction}
        onPress={() => {
          swipeableRef.current?.close();
          if (Platform.OS !== 'web') {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
          }
          setTimeout(onDelete, 160);
        }}
      >
        <MaterialIcons name="delete-outline" size={24} color="#FFF" />
        <Text style={fc.deleteText}>Delete</Text>
      </Pressable>
    </View>
  ), [onDelete]);

  const profitColor = item.profit >= 15 ? V.green : item.profit >= 0 ? V.greenMuted : V.error;

  return (
    <Swipeable
      ref={swipeableRef}
      renderRightActions={renderRightActions}
      rightThreshold={ACTION_WIDTH * 0.35}
      overshootRight={false}
      friction={2}
      onSwipeableOpen={handleOpen}
      onSwipeableClose={handleClose}
      onSwipeableWillOpen={() => {
        if (Platform.OS !== 'web') {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        }
      }}
    >
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [fc.card, pressed && { opacity: 0.88 }]}
      >
        {/* Thumbnail */}
        <View style={fc.thumbWrap}>
          {item.imageUri ? (
            <Image source={{ uri: item.imageUri }} style={fc.thumb} contentFit="cover" />
          ) : (
            <View style={[fc.thumb, fc.thumbFallback]}>
              <MaterialIcons name="checkroom" size={22} color={V.textMuted} />
            </View>
          )}
        </View>

        {/* Content */}
        <View style={fc.content}>
          <Text style={fc.name} numberOfLines={1}>{item.itemName}</Text>
          <Text style={fc.brand} numberOfLines={1}>{item.brand} · {item.category}</Text>
          <Text style={fc.thrift}>Bought at: ${item.thriftPrice}</Text>
          <Text style={fc.date}>{formatDate(item.timestamp)}</Text>
        </View>

        {/* Right */}
        <View style={fc.right}>
          <Text style={[fc.profit, { color: profitColor }]}>
            {item.profit >= 0 ? `+$${item.profit}` : `-$${Math.abs(item.profit)}`}
          </Text>
          <View style={[fc.labelPill, { borderColor: profitColor + '55' }]}>
            <Text style={[fc.labelPillText, { color: profitColor }]} numberOfLines={1}>
              {item.buyLabel}
            </Text>
          </View>
        </View>
      </Pressable>
    </Swipeable>
  );
}

const fc = StyleSheet.create({
  deleteWrapper: {
    // Transparent container — total width drives how far Swipeable slides the card
    width: ACTION_WIDTH + ACTION_GAP,
    paddingLeft: ACTION_GAP,        // gap between card and red zone
    marginBottom: 10,               // matches card marginBottom so heights align
  },
  deleteAction: {
    flex: 1,                        // fills the wrapper minus the gap
    backgroundColor: '#8B2A1A',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 5,
    borderRadius: 14,               // all 4 corners rounded — floats as its own element
  },
  deleteText:    { fontSize: 11, fontWeight: '700', color: '#FFF', letterSpacing: 0.2 },
  card:          { flexDirection: 'row', alignItems: 'center', backgroundColor: V.cardBg, borderRadius: 14, borderWidth: 1, borderColor: V.border, padding: 12, gap: 11, marginBottom: 10, shadowColor: V.textDark, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2 },
  thumbWrap:     { borderRadius: 11, overflow: 'hidden', borderWidth: 1, borderColor: V.border },
  thumb:         { width: 56, height: 56, borderRadius: 10 },
  thumbFallback: { backgroundColor: V.tan, justifyContent: 'center', alignItems: 'center' },
  content:       { flex: 1, gap: 2 },
  name:          { fontSize: 14, fontWeight: '700', color: V.textDark },
  brand:         { fontSize: 11, color: V.textMuted },
  thrift:        { fontSize: 11, color: V.textMuted },
  date:          { fontSize: 10, color: V.textSubtle, marginTop: 1 },
  right:         { alignItems: 'flex-end', gap: 4, minWidth: 64 },
  profit:        { fontSize: 17, fontWeight: '900' },
  labelPill:     { borderWidth: 1, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 6, maxWidth: 88 },
  labelPillText: { fontSize: 9, fontWeight: '700' },
});

// ─── Top flip card ────────────────────────────────────────────────────────────

function TopFlipCard({ item, rank, onPress }: { item: FlipResult; rank: number; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [tf.card, pressed && { opacity: 0.88 }]}
    >
      <RankBadge rank={rank} />

      <View style={tf.thumbWrap}>
        {item.imageUri ? (
          <Image source={{ uri: item.imageUri }} style={tf.thumb} contentFit="cover" />
        ) : (
          <View style={[tf.thumb, tf.thumbFallback]}>
            <MaterialIcons name="checkroom" size={20} color={V.textMuted} />
          </View>
        )}
      </View>

      <View style={tf.info}>
        <Text style={tf.name} numberOfLines={1}>{item.itemName}</Text>
        <Text style={tf.brand}>{item.brand}</Text>
        <View style={tf.roiWrap}>
          <Text style={tf.roi}>{item.roi}% ROI</Text>
        </View>
      </View>

      <View style={tf.profitBlock}>
        <Text style={tf.profit}>+${item.profit}</Text>
        <Text style={tf.profitSub}>profit</Text>
      </View>
    </Pressable>
  );
}

const tf = StyleSheet.create({
  card:         { flexDirection: 'row', alignItems: 'center', backgroundColor: V.cardBg, borderRadius: 14, borderWidth: 1, borderColor: V.border, padding: 12, gap: 10, marginBottom: 10, shadowColor: V.textDark, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2 },
  thumbWrap:    { borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: V.border },
  thumb:        { width: 48, height: 48, borderRadius: 9 },
  thumbFallback:{ backgroundColor: V.tan, justifyContent: 'center', alignItems: 'center' },
  info:         { flex: 1, gap: 3 },
  name:         { fontSize: 14, fontWeight: '700', color: V.textDark },
  brand:        { fontSize: 11, color: V.textMuted },
  roiWrap:      { flexDirection: 'row' },
  roi:          { fontSize: 10, fontWeight: '700', color: V.green, backgroundColor: V.greenLight, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  profitBlock:  { alignItems: 'flex-end', gap: 1 },
  profit:       { fontSize: 18, fontWeight: '800', color: V.green },
  profitSub:    { fontSize: 9, color: V.textMuted },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────

type Tab = 'all' | 'top';

export default function HistoryScreen() {
  const router   = useRouter();
  const insets   = useSafeAreaInsets();
  // ONLY source of truth — scan-context is NOT used here
  const { flips, removeFlip, globalStats, globalRank } = useFlipStore();

  const [activeTab, setActiveTab] = useState<Tab>('all');
  const [search,    setSearch]    = useState('');

  // All scans — most recent first, filtered by search
  const allScans = useMemo(() => {
    const q = search.toLowerCase();
    return [...flips]
      .sort((a, b) => b.timestamp - a.timestamp)
      .filter(f => !q || f.itemName.toLowerCase().includes(q) || f.brand.toLowerCase().includes(q));
  }, [flips, search]);

  // Top flips — highest profit first, only positive-profit items
  const topFlips = useMemo(
    () => [...flips].filter(f => f.profit > 0).sort((a, b) => b.profit - a.profit),
    [flips],
  );

  const handlePress = (item: FlipResult) => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    // Navigate to analysis-details directly — no need to set currentScan
    router.push({ pathname: '/analysis-details' as any, params: { scanId: item.id, source: 'history' } });
  };

  const handleDelete = (id: string) => {
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    removeFlip(id);
  };

  const EmptyState = ({ msg }: { msg: string }) => (
    <View style={s.emptyWrap}>
      <Text style={s.emptyIcon}>📦</Text>
      <Text style={s.emptyTitle}>Nothing here yet</Text>
      <Text style={s.emptySub}>{msg}</Text>
    </View>
  );

  return (
    <View style={[s.root, { backgroundColor: V.pageBg }]}>

      {/* ── Sticky header ── */}
      <View style={[s.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={({ pressed }) => [pressed && { opacity: 0.6 }]}>
          <MaterialIcons name="arrow-back" size={22} color={V.green} />
        </Pressable>
        <Text style={s.headerTitle}>Scan History</Text>
        <View style={{ width: 22 }} />
      </View>
      <View style={s.headerDivider} />

      {/* ── Tabs ── */}
      <View style={s.tabRow}>
        {(['all', 'top'] as Tab[]).map(tab => {
          const active = activeTab === tab;
          return (
            <Pressable
              key={tab}
              onPress={() => {
                setActiveTab(tab);
                if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              }}
              style={[s.tabBtn, active ? s.tabActive : s.tabInactive]}
            >
              <Text style={[s.tabText, active ? s.tabTextActive : s.tabTextInactive]}>
                {tab === 'all' ? 'All Scans' : 'Top Flips'}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* ── Content ── */}
      {activeTab === 'all' ? (
        <FlatList
          data={allScans}
          keyExtractor={item => item.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={s.list}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <>
              {/* Total profit dashboard — from globalStats (derived via flipCalculations.ts) */}
              <View style={s.profitCard}>
                <View style={s.profitLeft}>
                  <Text style={s.profitLabel}>Total Profit</Text>
                  <Text style={s.profitValue}>+${Math.round(globalStats.totalProfit)}</Text>
                  <Text style={s.profitSub}>
                    {globalStats.totalFlips} flip{globalStats.totalFlips !== 1 ? 's' : ''} · {globalStats.lifetimeRoi}% ROI · {globalStats.winRate}% win rate
                  </Text>
                </View>
                <View style={s.rankWrap}>
                  <Text style={s.rankLabel}>{globalRank.rank}</Text>
                </View>
              </View>

              {/* Search */}
              <View style={s.searchRow}>
                <View style={s.searchBar}>
                  <MaterialIcons name="search" size={18} color={V.textMuted} />
                  <TextInput
                    style={s.searchInput}
                    placeholder="Search scans..."
                    placeholderTextColor={V.textMuted}
                    value={search}
                    onChangeText={setSearch}
                    returnKeyType="search"
                  />
                  {search.length > 0 && (
                    <Pressable onPress={() => setSearch('')} hitSlop={8}>
                      <MaterialIcons name="close" size={16} color={V.textMuted} />
                    </Pressable>
                  )}
                </View>
              </View>

              <Text style={s.countLabel}>
                {allScans.length} item{allScans.length !== 1 ? 's' : ''}
              </Text>
            </>
          }
          renderItem={({ item }) => (
            <FlipCard
              item={item}
              onPress={() => handlePress(item)}
              onDelete={() => handleDelete(item.id)}
            />
          )}
          ListEmptyComponent={
            <EmptyState msg={search ? 'No items match your search.' : 'Scan and confirm items to build your history.'} />
          }
        />
      ) : (
        <FlatList
          data={topFlips}
          keyExtractor={item => item.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={s.list}
          ListHeaderComponent={
            <Text style={s.countLabel}>
              {topFlips.length} flip{topFlips.length !== 1 ? 's' : ''}
            </Text>
          }
          renderItem={({ item, index }) => (
            <TopFlipCard
              item={item}
              rank={index + 1}
              onPress={() => handlePress(item)}
            />
          )}
          ListEmptyComponent={
            <EmptyState msg="Your profitable flips will appear here." />
          }
        />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1 },

  header:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: V.screenPad, paddingBottom: 12, backgroundColor: V.pageBg },
  headerTitle:   { fontFamily: FONTS.serif, fontSize: 22, fontWeight: '700', color: V.green },
  headerDivider: { height: 1, backgroundColor: V.border, opacity: 0.7 },

  tabRow:        { flexDirection: 'row', marginHorizontal: V.screenPad, marginTop: 14, marginBottom: 6, backgroundColor: V.tan, borderRadius: 12, padding: 3, borderWidth: 1, borderColor: V.border },
  tabBtn:        { flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center' },
  tabActive:     { backgroundColor: V.green },
  tabInactive:   { backgroundColor: 'transparent' },
  tabText:       { fontSize: 13, fontWeight: '700' },
  tabTextActive: { color: V.white },
  tabTextInactive:{ color: V.green },

  list:          { paddingHorizontal: V.screenPad, paddingTop: 12, paddingBottom: 40 },
  countLabel:    { fontSize: 11, color: V.textMuted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10 },

  profitCard:    { flexDirection: 'row', alignItems: 'center', backgroundColor: V.cardBg, borderRadius: 16, borderWidth: 1, borderColor: V.green + '30', padding: 18, marginBottom: 14, shadowColor: V.green, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.10, shadowRadius: 10, elevation: 3 },
  profitLeft:    { flex: 1, gap: 3 },
  profitLabel:   { fontSize: 12, fontWeight: '600', color: V.textMuted, textTransform: 'uppercase', letterSpacing: 0.8 },
  profitValue:   { fontSize: 34, fontWeight: '900', color: V.green, letterSpacing: -1 },
  profitSub:     { fontSize: 12, color: V.textMuted },
  rankWrap:      { alignItems: 'center' },
  rankLabel:     { fontSize: 28 },

  searchRow:     { flexDirection: 'row', marginBottom: 12 },
  searchBar:     { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: V.cardBg, borderRadius: 12, borderWidth: 1, borderColor: V.border, paddingHorizontal: 12, paddingVertical: 9, gap: 8 },
  searchInput:   { flex: 1, fontSize: 14, color: V.textDark, padding: 0 },

  emptyWrap:  { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyIcon:  { fontSize: 48 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: V.textDark },
  emptySub:   { fontSize: 14, color: V.textMuted, textAlign: 'center', maxWidth: 240 },
});
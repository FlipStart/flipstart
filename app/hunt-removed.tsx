/**
 * app/hunt-removed.tsx
 *
 * Hunt Mode — Removed Items screen.
 * Shows all skipped/removed items from the active hunt.
 * Each item can be viewed (read-only Discovery Analysis) or restored to kept.
 */

import {
  View, Text, Pressable, StyleSheet, ScrollView,
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as Haptics from 'expo-haptics';
import { useState, useEffect } from 'react';
import { Platform } from 'react-native';

import {
  getActiveHunt, restoreHuntItem, subscribeToHunt,
  type HuntItem, type HuntSession,
} from '@/lib/hunt-context';
import { logEvent } from '@/lib/analytics';
import { FONTS } from '@/constants/typography';

// ─── Palette ──────────────────────────────────────────────────────────────────

const BG     = '#F0E8D4';
const CARD   = '#FFF9EE';
const CARD_B = '#DDD0B0';
const FOREST = '#2A4A2A';
const BROWN  = '#5A3A1A';
const MUTED  = '#8A7050';
const GOLD   = '#BE9C2C';
const CREAM  = '#F4EED8';
const RED    = '#8A2A2A';

// ─── Component ────────────────────────────────────────────────────────────────

export default function HuntRemovedScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [session, setSession] = useState<HuntSession | null>(getActiveHunt());

  useEffect(() => {
    const unsub = subscribeToHunt(() => {
      const h = getActiveHunt();
      // Spread to force a new reference — hunt-context mutates _activeHunt in place
      // and then replaces it, but we need React to detect the change
      setSession(h ? { ...h } : null);
    });
    return unsub;
  }, []);

  const removedItems = session?.items.filter(i => !i.kept) ?? [];

  const handleRestore = (item: HuntItem) => {
    if (Platform.OS !== 'web') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
    restoreHuntItem(item.huntItemId);
    logEvent('hunt_item_restored', { huntItemId: item.huntItemId, category: item.category });
  };

  const handleViewItem = (item: HuntItem) => {
    router.push(`/hunt-item-detail?mode=readonly&huntItemId=${item.huntItemId}` as any);
  };

  if (!session) {
    return (
      <View style={[s.root, { paddingTop: insets.top, justifyContent: 'center', alignItems: 'center', gap: 16 }]}>
        <MaterialIcons name="search-off" size={40} color={MUTED} />
        <Text style={s.emptyTitle}>No active hunt</Text>
        <Pressable onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.backBtnText}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>

      {/* ── Header ── */}
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={s.headerBtn}>
          <MaterialIcons name="arrow-back" size={22} color={BROWN} />
        </Pressable>
        <View style={s.headerCenter}>
          <Text style={s.headerMode}>♦  HUNT MODE  ♦</Text>
          <Text style={s.headerTitle}>Removed Items</Text>
        </View>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
      >
        {removedItems.length === 0 ? (
          <View style={s.emptyState}>
            <MaterialIcons name="check-circle-outline" size={40} color={MUTED} />
            <Text style={s.emptyTitle}>No removed items</Text>
            <Text style={s.emptySub}>Items you skip will appear here.</Text>
          </View>
        ) : (
          removedItems.map(item => (
            <RemovedItemCard
              key={item.huntItemId}
              item={item}
              onView={() => handleViewItem(item)}
              onRestore={() => handleRestore(item)}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

// ─── Removed item card ────────────────────────────────────────────────────────

function RemovedItemCard({
  item, onView, onRestore,
}: {
  item: HuntItem;
  onView: () => void;
  onRestore: () => void;
}) {
  return (
    <Pressable
      onPress={onView}
      style={({ pressed }) => [rc.card, pressed && { opacity: 0.80 }]}
    >
      {/* Image */}
      <View style={rc.imgWrap}>
        {item.imageUri ? (
          <Image source={{ uri: item.imageUri }} style={rc.img} contentFit="cover" />
        ) : (
          <View style={[rc.img, rc.imgFallback]}>
            <MaterialIcons name="checkroom" size={20} color={MUTED} />
          </View>
        )}
      </View>

      {/* Info */}
      <View style={rc.info}>
        <Text style={rc.name} numberOfLines={1}>{item.itemName}</Text>
        <Text style={rc.meta} numberOfLines={1}>
          {[item.brand, item.category].filter(Boolean).join(' · ')}
        </Text>
        <View style={rc.skipPill}>
          <Text style={rc.skipText}>✕  SKIPPED</Text>
        </View>
      </View>

      {/* Restore button */}
      <Pressable
        onPress={e => { e.stopPropagation(); onRestore(); }}
        style={({ pressed }) => [rc.keepBtn, pressed && { opacity: 0.75 }]}
        hitSlop={8}
      >
        <MaterialIcons name="add-circle-outline" size={14} color={FOREST} />
        <Text style={rc.keepText}>Keep</Text>
      </Pressable>
    </Pressable>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root:         { flex: 1, backgroundColor: BG },
  header:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: CARD_B },
  headerBtn:    { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center', backgroundColor: CARD_B + '50' },
  headerCenter: { flex: 1, alignItems: 'center', gap: 1 },
  headerMode:   { fontSize: 10, fontWeight: '700', color: GOLD, letterSpacing: 2 },
  headerTitle:  { fontFamily: FONTS.serif, fontSize: 22, fontWeight: '800', color: BROWN },
  scroll:       { padding: 16, gap: 10 },
  emptyState:   { alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyTitle:   { fontFamily: FONTS.serif, fontSize: 18, fontWeight: '800', color: BROWN },
  emptySub:     { fontSize: 13, color: MUTED, textAlign: 'center' },
  backBtn:      { backgroundColor: FOREST, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10 },
  backBtnText:  { fontFamily: FONTS.serif, fontSize: 14, color: CREAM, fontWeight: '700' },
});

const rc = StyleSheet.create({
  card:       { flexDirection: 'row', alignItems: 'center', backgroundColor: CARD, borderRadius: 12, borderWidth: 1, borderColor: CARD_B, padding: 12, gap: 10 },
  imgWrap:    { borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: CARD_B },
  img:        { width: 54, height: 54 },
  imgFallback:{ backgroundColor: CARD_B, justifyContent: 'center', alignItems: 'center' },
  info:       { flex: 1, gap: 4 },
  name:       { fontFamily: FONTS.serif, fontSize: 13, fontWeight: '700', color: BROWN },
  meta:       { fontSize: 11, color: MUTED },
  skipPill:   { alignSelf: 'flex-start', backgroundColor: RED + '18', borderWidth: 1, borderColor: RED + '55', borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  skipText:   { fontSize: 9, fontWeight: '800', color: RED, letterSpacing: 0.6 },
  keepBtn:    { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: FOREST + '18', borderWidth: 1, borderColor: FOREST + '55', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  keepText:   { fontSize: 12, fontWeight: '700', color: FOREST },
});
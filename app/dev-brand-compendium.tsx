/**
 * app/dev-brand-compendium.tsx
 *
 * FILE PATH: app/dev-brand-compendium.tsx
 *
 * DEV ONLY — Brand Compendium testing tool.
 * Accessible from Settings → "Test Brand Compendium" (dev builds only).
 *
 * Lets you, without scanning real items:
 *   - View all brands grouped by rarity with state (locked/discovered/previewed)
 *   - Unlock / Remove / Trigger Reveal / Trigger Notification / Preview per brand
 *   - Bulk unlock random N per rarity, lock all, unlock all
 *   - Reset preview cooldown, clear all previews
 *   - Reset everything
 *
 * All state is local AsyncStorage. No Supabase, no auth, no production exposure.
 */

import {
  View, Text, StyleSheet, ScrollView, Pressable, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useState, useCallback } from 'react';

import { FONTS } from '@/constants/typography';
import { useAuth } from '@/lib/auth-context';
import { useFlipStore } from '@/lib/useFlipStore';
import { loadXpProfile } from '@/lib/huntXp';
import { useAchievementNotifications } from '@/lib/AchievementNotificationContext';
import { BrandRevealModal } from '@/lib/BrandRevealModal';
import {
  ALL_BRANDS,
  TOTAL_SUPPORTED_BRANDS,
  RARITY_TOTALS,
  RARITY_COLORS,
  RARITY_LABELS,
  CATEGORY_LABELS,
  computeDiscoveredBrands,
  getRevealedBrandNames,
  markBrandRevealed,
  clearRevealedBrands,
  markBrandNamesAsSeen,
  type Brand,
  type BrandRarity,
} from '@/lib/brandCompendium';
import {
  getDevUnlockedBrands, addDevUnlockedBrand, removeDevUnlockedBrand,
  clearAllDevUnlockedBrands, setDiscoveryMeta, removeDiscoveryMeta,
  clearAllDiscoveryMeta,
} from '@/lib/devBrandOverrides';
import {
  getPreviewState, devForcePreview, devResetPreviewCooldown, devClearAllPreviews,
} from '@/lib/brandPreview';

// ─── Palette ──────────────────────────────────────────────────────────────────
const FOREST = '#2A4A2A';
const GOLD   = '#BE9C2C';

const RARITIES: BrandRarity[] = ['common', 'uncommon', 'rare', 'legendary'];

// ─────────────────────────────────────────────────────────────────────────────

export default function DevBrandCompendiumScreen() {
  if (!__DEV__) return null;
  return <DevBrandCompendiumScreenImpl />;
}

function DevBrandCompendiumScreenImpl() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user }  = useAuth();
  const { flips } = useFlipStore();
  const { addUnseenBrands } = useAchievementNotifications();

  const [realDiscovered, setRealDiscovered] = useState<Set<string>>(new Set());
  const [devUnlocked,    setDevUnlocked]    = useState<Set<string>>(new Set());
  const [previewedBrand, setPreviewedBrand] = useState<string | null>(null);
  const [previewUsed,    setPreviewUsed]    = useState(false);
  const [revealBrand,    setRevealBrand]    = useState<Brand | null>(null);
  const [revealTotal,    setRevealTotal]    = useState(0);
  const [expanded,       setExpanded]       = useState<BrandRarity | null>('legendary');

  const reload = useCallback(async () => {
    const uid     = user?.id ?? null;
    const profile = uid ? await loadXpProfile(uid).catch(() => null) : null;
    setRealDiscovered(computeDiscoveredBrands(flips, profile?.discoveredBrands ?? []));
    setDevUnlocked(await getDevUnlockedBrands());
    const pv = await getPreviewState();
    setPreviewUsed(pv.usedToday);
    setPreviewedBrand(pv.previewedBrand);
  }, [user?.id, flips]);

  useFocusEffect(useCallback(() => { reload(); }, [reload]));

  // Merged discovery view (real + dev)
  const allDiscovered = (name: string) =>
    realDiscovered.has(name) || devUnlocked.has(name);
  const totalDiscovered =
    new Set([...realDiscovered, ...devUnlocked]).size;

  // ── Single-brand actions ──────────────────────────────────────────────────

  const doUnlock = async (brand: Brand, withReveal = false) => {
    if (allDiscovered(brand.name)) {
      Alert.alert('Already Discovered', `${brand.name} is already in your collection.`);
      return;
    }
    await addDevUnlockedBrand(brand.name);
    await setDiscoveryMeta({
      brandName: brand.name, rarity: brand.rarity, category: brand.category,
      dateDiscovered: Date.now(), discoverySource: 'dev_tool',
    });
    // Trigger notification badge
    addUnseenBrands([brand.name]);

    // Signed-in: upsert the discovery to Supabase (background, fail-safe).
    if (user?.id) {
      const uid = user.id;
      import('@/lib/brandSync').then(({ upsertBrandDiscovery }) =>
        upsertBrandDiscovery(uid, {
          brandName: brand.name, rarity: brand.rarity, category: brand.category,
          dateDiscovered: Date.now(), discoverySource: 'dev_tool',
        }, { isUnread: true }),
      ).catch(() => {});
    }

    await reload();

    if (withReveal) {
      await markBrandRevealed(brand.name);
      setRevealTotal(totalDiscovered + 1);
      setRevealBrand(brand);
    }
  };

  const doRemove = async (brand: Brand) => {
    await removeDevUnlockedBrand(brand.name);
    await removeDiscoveryMeta(brand.name);
    // Clear brand from revealed set so its reveal animation can re-trigger
    const revealed = await getRevealedBrandNames();
    if (revealed.has(brand.name)) {
      const next = [...revealed].filter(n => n !== brand.name);
      await clearRevealedBrands();
      for (const n of next) await markBrandRevealed(n);
    }

    // Signed-in: delete the Supabase row so testing stays consistent.
    if (user?.id) {
      const uid = user.id;
      import('@/lib/brandSync').then(({ deleteBrandDiscoveryRemoteDevOnly }) =>
        deleteBrandDiscoveryRemoteDevOnly(uid, brand.name),
      ).catch(() => {});
    }

    await reload();
  };

  // Trigger reveal WITHOUT changing discovery state
  const doTriggerReveal = (brand: Brand) => {
    setRevealTotal(Math.max(totalDiscovered, 1));
    setRevealBrand(brand);
  };

  // Trigger notification WITHOUT unlocking
  const doTriggerNotification = (brand: Brand) => {
    addUnseenBrands([brand.name]);
    Alert.alert('Notification Triggered', `Progress badge incremented for ${brand.name}. Check the Progress tab.`);
  };

  // Preview a brand (force, ignoring cooldown)
  const doPreview = async (brand: Brand) => {
    await devForcePreview(brand.name);
    await reload();
    Alert.alert('Preview Set', `${brand.name} is now previewed for today. View it in the rarity screen.`);
  };

  // ── Bulk actions ──────────────────────────────────────────────────────────

  const bulkUnlockRandom = async (rarity: BrandRarity, count: number) => {
    const locked = ALL_BRANDS.filter(b => b.rarity === rarity && !allDiscovered(b.name));
    const shuffled = [...locked].sort(() => Math.random() - 0.5).slice(0, count);
    for (const b of shuffled) {
      await addDevUnlockedBrand(b.name);
      await setDiscoveryMeta({
        brandName: b.name, rarity: b.rarity, category: b.category,
        dateDiscovered: Date.now() - Math.floor(Math.random() * 7 * 86_400_000),
        discoverySource: 'dev_tool',
      });
    }
    if (shuffled.length > 0) addUnseenBrands(shuffled.map(b => b.name));
    await reload();
    Alert.alert('Done', `Unlocked ${shuffled.length} ${RARITY_LABELS[rarity]} brand(s).`);
  };

  const lockAll = () => {
    Alert.alert('Lock All Brands?', 'This removes all dev-unlocked brands and their metadata. Real discoveries from scans are not affected.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Lock All', style: 'destructive', onPress: async () => {
        await clearAllDevUnlockedBrands();
        await clearAllDiscoveryMeta();
        await clearRevealedBrands();
        await reload();
        Alert.alert('Done', 'All dev-unlocked brands cleared.');
      }},
    ]);
  };

  const unlockAll = () => {
    Alert.alert('Unlock All Brands?', `This dev-unlocks all ${TOTAL_SUPPORTED_BRANDS} brands.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Unlock All', onPress: async () => {
        for (const b of ALL_BRANDS) {
          if (!realDiscovered.has(b.name)) {
            await addDevUnlockedBrand(b.name);
            await setDiscoveryMeta({
              brandName: b.name, rarity: b.rarity, category: b.category,
              dateDiscovered: Date.now(), discoverySource: 'dev_tool',
            });
          }
        }
        await reload();
        Alert.alert('Done', 'All brands unlocked.');
      }},
    ]);
  };

  const resetEverything = () => {
    Alert.alert('⚠️ Reset Everything', 'Clears all dev-unlocked brands, discovery metadata, reveal history, seen badges, and preview state. Real scan discoveries are not affected.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reset All', style: 'destructive', onPress: async () => {
        await clearAllDevUnlockedBrands();
        await clearAllDiscoveryMeta();
        await clearRevealedBrands();
        await devClearAllPreviews();
        await reload();
        Alert.alert('Done', 'Brand Compendium dev state reset.');
      }},
    ]);
  };

  // ─────────────────────────────────────────────────────────────────────────

  const byRarityCount = (rarity: BrandRarity) => {
    const brands = ALL_BRANDS.filter(b => b.rarity === rarity);
    const found  = brands.filter(b => allDiscovered(b.name)).length;
    return { found, total: brands.length };
  };

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>

      {/* Header */}
      <View style={s.header}>
        <Pressable
          onPress={() => router.canGoBack() ? router.back() : router.replace('/settings' as any)}
          hitSlop={8}
          style={({ pressed }) => [s.headerBtn, pressed && { opacity: 0.6 }]}
        >
          <MaterialIcons name="arrow-back" size={20} color="#AAF0AA" />
        </Pressable>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={s.headerTitle}>🔧 Brand Compendium Tester</Text>
          <Text style={s.headerSub}>{totalDiscovered} / {TOTAL_SUPPORTED_BRANDS} discovered · DEV ONLY</Text>
        </View>
        <View style={{ width: 34 }} />
      </View>

      <ScrollView
        contentContainerStyle={[s.scroll, { paddingBottom: Math.max(insets.bottom, 16) + 24 }]}
        showsVerticalScrollIndicator={false}
      >

        {/* Bulk actions */}
        <View style={s.bulkCard}>
          <Text style={s.bulkTitle}>Bulk Actions</Text>
          <View style={s.bulkRow}>
            <BulkBtn label="+5 Common"     onPress={() => bulkUnlockRandom('common', 5)} />
            <BulkBtn label="+5 Uncommon"   onPress={() => bulkUnlockRandom('uncommon', 5)} />
          </View>
          <View style={s.bulkRow}>
            <BulkBtn label="+3 Rare"       onPress={() => bulkUnlockRandom('rare', 3)} />
            <BulkBtn label="+1 Legendary"  onPress={() => bulkUnlockRandom('legendary', 1)} gold />
          </View>
          <View style={s.bulkRow}>
            <BulkBtn label="Unlock All"    onPress={unlockAll} />
            <BulkBtn label="Lock All"      onPress={lockAll} danger />
          </View>
          <View style={s.bulkRow}>
            <BulkBtn label="Reset Preview Cooldown" onPress={async () => { await devResetPreviewCooldown(); await reload(); Alert.alert('Done', 'Preview cooldown reset.'); }} small />
            <BulkBtn label="Clear Previews" onPress={async () => { await devClearAllPreviews(); await reload(); Alert.alert('Done', 'Previews cleared.'); }} small />
          </View>
          <Pressable onPress={resetEverything} style={({ pressed }) => [s.resetAllBtn, pressed && { opacity: 0.8 }]}>
            <MaterialIcons name="delete-sweep" size={15} color="#fff" />
            <Text style={s.resetAllText}>Reset Everything</Text>
          </Pressable>
        </View>

        {/* Preview status */}
        <View style={s.previewStatus}>
          <MaterialIcons name="visibility" size={14} color={GOLD} />
          <Text style={s.previewStatusText}>
            {previewUsed
              ? `Preview used today: ${previewedBrand ?? '—'}`
              : 'No preview used today'}
          </Text>
        </View>

        {/* Rarity groups */}
        {RARITIES.map(rarity => {
          const { found, total } = byRarityCount(rarity);
          const color = RARITY_COLORS[rarity];
          const isOpen = expanded === rarity;
          const brands = ALL_BRANDS.filter(b => b.rarity === rarity);

          return (
            <View key={rarity} style={s.raritySection}>
              <Pressable
                onPress={() => setExpanded(isOpen ? null : rarity)}
                style={[s.rarityHeader, { borderLeftColor: color }]}
              >
                <Text style={[s.rarityHeaderTitle, { color }]}>
                  {RARITY_LABELS[rarity]}
                </Text>
                <Text style={s.rarityHeaderCount}>{found} / {total}</Text>
                <MaterialIcons
                  name={isOpen ? 'expand-less' : 'expand-more'}
                  size={20} color="#888"
                />
              </Pressable>

              {isOpen && brands.map(brand => {
                const isReal = realDiscovered.has(brand.name);
                const isDev  = devUnlocked.has(brand.name);
                const isDiscovered = isReal || isDev;
                const isPreviewed  = previewedBrand === brand.name;

                const state = isReal ? 'REAL' : isDev ? 'DEV' : isPreviewed ? 'PREVIEW' : 'LOCKED';
                const stateColor = isReal ? FOREST : isDev ? GOLD : isPreviewed ? '#5B90D8' : '#555';

                return (
                  <View key={brand.name} style={s.brandRow}>
                    <View style={{ flex: 1 }}>
                      <View style={s.brandNameRow}>
                        <Text style={s.brandName}>{brand.name}</Text>
                        <View style={[s.stateBadge, { borderColor: stateColor + '80', backgroundColor: stateColor + '20' }]}>
                          <Text style={[s.stateText, { color: stateColor }]}>{state}</Text>
                        </View>
                      </View>
                      <Text style={s.brandCat}>{CATEGORY_LABELS[brand.category]}</Text>
                    </View>

                    <View style={s.actionsCol}>
                      <View style={s.actionsRow}>
                        {!isDiscovered ? (
                          <ActBtn icon="lock-open" label="Unlock" color={FOREST} onPress={() => doUnlock(brand, true)} />
                        ) : isDev ? (
                          <ActBtn icon="lock-reset" label="Reset" color="#CC2222" onPress={() => doRemove(brand)} />
                        ) : (
                          <View style={s.realLock}><Text style={s.realLockText}>real</Text></View>
                        )}
                        <ActBtn icon="play-circle" label="Reveal" color="#5B90D8" onPress={() => doTriggerReveal(brand)} />
                      </View>
                      <View style={s.actionsRow}>
                        <ActBtn icon="notifications" label="Notify" color="#B8860B" onPress={() => doTriggerNotification(brand)} />
                        <ActBtn icon="visibility" label="Preview" color="#7A3ABF" onPress={() => doPreview(brand)} />
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          );
        })}

      </ScrollView>

      {/* Reveal modal */}
      <BrandRevealModal
        brand={revealBrand}
        totalDiscovered={revealTotal}
        totalBrands={TOTAL_SUPPORTED_BRANDS}
        visible={!!revealBrand}
        onContinue={() => setRevealBrand(null)}
      />
    </View>
  );
}

// ─── Small components ───────────────────────────────────────────────────────

function BulkBtn({ label, onPress, danger, gold, small }: {
  label: string; onPress: () => void; danger?: boolean; gold?: boolean; small?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        s.bulkBtn,
        danger && { backgroundColor: '#8A1010' },
        gold && { backgroundColor: GOLD },
        pressed && { opacity: 0.75 },
      ]}
    >
      <Text style={[s.bulkBtnText, small && { fontSize: 10 }, gold && { color: '#0D0900' }]}>{label}</Text>
    </Pressable>
  );
}

function ActBtn({ icon, label, color, onPress }: {
  icon: string; label: string; color: string; onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [s.actBtn, { borderColor: color + '60' }, pressed && { opacity: 0.6 }]}
    >
      <MaterialIcons name={icon as any} size={12} color={color} />
      <Text style={[s.actBtnText, { color }]}>{label}</Text>
    </Pressable>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0C0C18' },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: '#2A2A40',
  },
  headerBtn: {
    width: 34, height: 34, borderRadius: 17,
    borderWidth: 1, borderColor: '#2A2A40', backgroundColor: '#14142A',
    justifyContent: 'center', alignItems: 'center',
  },
  headerTitle: { fontFamily: FONTS.serif, fontSize: 15, fontWeight: '800', color: '#AAF0AA' },
  headerSub:   { fontSize: 9, color: '#5A5A7A', letterSpacing: 0.6, marginTop: 1 },

  scroll: { paddingHorizontal: 12, paddingTop: 14, gap: 12 },

  // Bulk
  bulkCard: {
    backgroundColor: '#14142A', borderRadius: 12, borderWidth: 1, borderColor: '#2A2A40',
    padding: 12, gap: 8,
  },
  bulkTitle: { fontSize: 11, fontWeight: '800', color: '#AAF0AA', letterSpacing: 1, textTransform: 'uppercase' },
  bulkRow:   { flexDirection: 'row', gap: 8 },
  bulkBtn: {
    flex: 1, backgroundColor: '#243B24', borderRadius: 8,
    paddingVertical: 9, alignItems: 'center',
  },
  bulkBtnText: { fontSize: 11, fontWeight: '700', color: '#CFE8CF' },
  resetAllBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: '#6A0A0A', borderRadius: 8, paddingVertical: 9, marginTop: 2,
  },
  resetAllText: { fontSize: 12, fontWeight: '800', color: '#fff' },

  // Preview status
  previewStatus: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: GOLD + '15', borderRadius: 8, borderWidth: 1, borderColor: GOLD + '30',
    paddingHorizontal: 12, paddingVertical: 8,
  },
  previewStatusText: { fontSize: 11, color: '#D8C8A0', fontWeight: '600' },

  // Rarity section
  raritySection: {
    backgroundColor: '#14142A', borderRadius: 12, borderWidth: 1, borderColor: '#2A2A40',
    overflow: 'hidden',
  },
  rarityHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 12, paddingVertical: 12,
    borderLeftWidth: 4, backgroundColor: '#0C0C18',
  },
  rarityHeaderTitle: { flex: 1, fontFamily: FONTS.serif, fontSize: 14, fontWeight: '900' },
  rarityHeaderCount: { fontSize: 12, color: '#888', fontWeight: '700' },

  // Brand row
  brandRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: '#1E1E34',
  },
  brandNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandName: { fontSize: 13, fontWeight: '700', color: '#D8D8E8' },
  brandCat:  { fontSize: 10, color: '#5A5A7A', marginTop: 1 },
  stateBadge: { borderRadius: 5, borderWidth: 1, paddingHorizontal: 5, paddingVertical: 1 },
  stateText:  { fontSize: 8, fontWeight: '900', letterSpacing: 0.4 },

  actionsCol: { gap: 4 },
  actionsRow: { flexDirection: 'row', gap: 4 },
  actBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    borderWidth: 1, borderRadius: 7, paddingHorizontal: 7, paddingVertical: 4,
    minWidth: 64, justifyContent: 'center',
  },
  actBtnText: { fontSize: 9, fontWeight: '700' },
  realLock: {
    borderRadius: 7, paddingHorizontal: 7, paddingVertical: 4,
    backgroundColor: '#243B24', minWidth: 64, alignItems: 'center', justifyContent: 'center',
  },
  realLockText: { fontSize: 9, fontWeight: '700', color: '#6A8A6A' },
});
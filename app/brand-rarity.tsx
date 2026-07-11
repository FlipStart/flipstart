/**
 * app/brand-rarity.tsx
 *
 * FILE PATH: app/brand-rarity.tsx
 *
 * Rarity collection screen — Pass 1.
 * Opened from Brand Compendium main screen by tapping a rarity card.
 *
 * Features:
 *   - Summary (X / Y Found, Z% Complete)
 *   - "Recently Discovered" highlight strip (up to 5 most recent)
 *   - Full brand list: discovered (named, full color) + undiscovered (mystery)
 *   - Search bar + filter icon → bottom sheet with category / sort / display
 *   - Undiscovered brands shown as "Unknown [Rarity] Brand" — never reveals names
 *   - Tapping any brand: "Brand details coming in a future update."
 */

import {
  View, Text, StyleSheet, FlatList, Pressable,
  TextInput, Modal, Alert, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { FONTS } from '@/constants/typography';
import { useAuth } from '@/lib/auth-context';
import { useFlipStore } from '@/lib/useFlipStore';
import { loadXpProfile } from '@/lib/huntXp';
import { useAchievementNotifications } from '@/lib/AchievementNotificationContext';
import { trackAnalyticsEvent, useScreenFocus } from '@/lib/analytics';
import {
  ALL_BRANDS,
  RARITY_TOTALS,
  RARITY_COLORS,
  RARITY_LABELS,
  CATEGORY_LABELS,
  computeDiscoveredBrandsWithDates,
  markBrandNamesAsSeen,
  type Brand,
  type BrandRarity,
  type BrandCategory,
} from '@/lib/brandCompendium';

// ─── Preview helpers (inlined — no external file dependency) ─────────────────
const _PREVIEW_KEY = '@flipstart/mystery_preview_v1';

function _todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function getPreviewState(): Promise<{ usedToday: boolean; previewedBrand: string | null }> {
  try {
    const raw = await AsyncStorage.getItem(_PREVIEW_KEY);
    const rec = raw ? JSON.parse(raw) as { dateKey: string; brandName: string } : null;
    if (rec && rec.dateKey === _todayKey()) {
      return { usedToday: true, previewedBrand: rec.brandName };
    }
  } catch {}
  return { usedToday: false, previewedBrand: null };
}

async function consumePreview(brandName: string): Promise<boolean> {
  const state = await getPreviewState();
  if (state.usedToday) return false;
  try {
    await AsyncStorage.setItem(_PREVIEW_KEY, JSON.stringify({ dateKey: _todayKey(), brandName }));
    return true;
  } catch { return false; }
}

// ─── Palette ──────────────────────────────────────────────────────────────────
const FOREST = '#2A4A2A';
const GOLD   = '#BE9C2C';
const PARCH  = '#FFFFFF';
const CARD   = '#F8F7F0';
const IVORY  = '#FFFEFA';
const BORDER = '#DDD2AC';
const TAN    = '#F4F1E8';
const BROWN  = '#3D2A12';
const MUTED  = '#8A7050';

// ─── Filter types ─────────────────────────────────────────────────────────────

type SortBy       = 'recent' | 'alpha' | 'category';
type DisplayMode  = 'all' | 'discovered' | 'undiscovered';

// ─── List item union type ─────────────────────────────────────────────────────

type DiscoveredItem = {
  type:      'discovered';
  brand:     Brand;
  timestamp: number;
};
type UnknownItem = {
  type:    'unknown';
  brand:   Brand;           // the real (hidden) brand behind this slot
  rarity:  BrandRarity;
};
type ListItem = DiscoveredItem | UnknownItem;

// ─── Date formatter ───────────────────────────────────────────────────────────

function formatDate(ts: number): string {
  if (ts <= 1) return 'Discovered';
  const diff = Date.now() - ts;
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return 'Discovered today';
  if (days === 1) return 'Discovered yesterday';
  if (days < 7)  return `Discovered ${days} days ago`;
  const d = new Date(ts);
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `Discovered ${M[d.getMonth()]} ${d.getDate()}`;
}

// ─────────────────────────────────────────────────────────────────────────────

export default function BrandRarityScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user }  = useAuth();
  const { flips } = useFlipStore();
  const { unseenBrandNames, markBrandSeen } = useAchievementNotifications();

  const { rarity: rarityParam } = useLocalSearchParams<{ rarity: string }>();
  const rarity = (rarityParam ?? 'common') as BrandRarity;

  const color     = RARITY_COLORS[rarity];
  const label     = RARITY_LABELS[rarity];
  const total     = RARITY_TOTALS[rarity];
  const rarityBrands = ALL_BRANDS.filter(b => b.rarity === rarity);

  // Data state
  const [brandDates, setBrandDates] = useState<Map<string, number>>(new Map());
  const [previewedBrand, setPreviewedBrand] = useState<string | null>(null);
  const [previewUsed,    setPreviewUsed]    = useState(false);

  // Snapshot of which brands were unread when this rarity page opened, so their
  // NEW dots remain visible during THIS visit even though we mark them seen on
  // open. After leaving and returning, the snapshot is empty → no dots.
  const [newAtOpen, setNewAtOpen] = useState<Set<string>>(new Set());
  const capturedSeen = useRef(false);

  // Analytics: a brand rarity page was opened. cooldownKey is rarity-specific
  // so Common and Legendary both track independently within their own windows.
  useScreenFocus(
    'brand_rarity_opened',
    { brand_rarity: rarity },
    { cooldownKey: `brand_rarity_opened:${rarity}` },
  );

  // Filter state
  const [search,      setSearch]      = useState('');
  const [catFilter,   setCatFilter]   = useState<BrandCategory | 'all'>('all');
  const [sortBy,      setSortBy]      = useState<SortBy>('recent');
  const [displayMode, setDisplayMode] = useState<DisplayMode>('all');
  const [filterOpen,  setFilterOpen]  = useState(false);

  // Staged filter (applied only on "Apply")
  const [stagedCat,     setStagedCat]     = useState<BrandCategory | 'all'>('all');
  const [stagedSort,    setStagedSort]    = useState<SortBy>('recent');
  const [stagedDisplay, setStagedDisplay] = useState<DisplayMode>('all');

  useFocusEffect(useCallback(() => {
    const load = async () => {
      const uid     = user?.id ?? null;
      const profile = uid ? await loadXpProfile(uid).catch(() => null) : null;
      const dates   = computeDiscoveredBrandsWithDates(flips, profile?.discoveredBrands ?? []);

      // DEV — merge dev-unlocked brands (use stored meta date if available).
      if (__DEV__) {
        const { getDevUnlockedBrands, getAllDiscoveryMeta } = await import('@/lib/devBrandOverrides');
        const devSet = await getDevUnlockedBrands();
        const meta   = await getAllDiscoveryMeta();
        devSet.forEach(name => {
          if (!dates.has(name)) {
            dates.set(name, meta[name]?.dateDiscovered ?? Date.now());
          }
        });
      }
      setBrandDates(dates);

      const pv = await getPreviewState();
      setPreviewUsed(pv.usedToday);
      setPreviewedBrand(pv.previewedBrand);
    };
    load();
  }, [user?.id, flips]));

  // ── Bug 2 + Bug 1(brands): clear notifications by rarity-page visit ──────────
  // Opening this rarity page marks EVERY unread discovered brand in this rarity
  // seen — locally (persisted), in-memory (Progress badge), and remotely. The
  // user no longer has to tap each brand. We snapshot which were unread at open
  // so their NEW dots still show during this visit; on return they're gone.
  const discoveredNamesForRarity = useMemo(
    () => rarityBrands.filter(b => brandDates.has(b.name)).map(b => b.name),
    [rarityBrands, brandDates],
  );
  useEffect(() => {
    if (capturedSeen.current) return;
    if (brandDates.size === 0) return;           // wait for discovery data to load
    capturedSeen.current = true;

    const unread = discoveredNamesForRarity.filter(n => unseenBrandNames.includes(n));
    setNewAtOpen(new Set(unread));               // freeze dots for this visit
    if (unread.length === 0) return;

    markBrandNamesAsSeen(unread).catch(() => {}); // persist (won't reappear next focus)
    unread.forEach(markBrandSeen);                // in-memory → Progress badge updates
    const uid = user?.id;
    if (uid) {
      import('@/lib/brandSync').then(({ markBrandDiscoverySeenRemote }) => {
        unread.forEach(n => markBrandDiscoverySeenRemote(uid, n).catch(() => {}));
      }).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandDates, discoveredNamesForRarity]);

  // Handle tapping a locked/mystery card
  const handleUnknownTap = (hiddenBrand: Brand) => {
    // If this brand is already the one previewed today, open its (preview) detail
    if (previewedBrand === hiddenBrand.name) {
      Alert.alert(
        hiddenBrand.name,
        `${RARITY_LABELS[hiddenBrand.rarity]} · ${CATEGORY_LABELS[hiddenBrand.category]}\n\nThis is a 24-hour preview. Scan & save this brand to add it to your collection permanently.`,
        [{ text: 'OK' }],
      );
      return;
    }

    if (previewUsed) {
      Alert.alert(
        'No Previews Left',
        "You've already used today's Mystery Preview. A new preview unlocks tomorrow.",
        [{ text: 'OK' }],
      );
      return;
    }

    Alert.alert(
      "Use Today's Mystery Preview?",
      'You have 1 preview remaining. This reveals the brand for 24 hours but does not add it to your collection.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reveal',
          onPress: async () => {
            const ok = await consumePreview(hiddenBrand.name);
            if (ok) {
              setPreviewUsed(true);
              setPreviewedBrand(hiddenBrand.name);
            }
          },
        },
      ],
    );
  };

  // ── Derived values ──────────────────────────────────────────────────────────
  const discovered       = useMemo(() => new Set(brandDates.keys()), [brandDates]);
  const discoveredInRarity = useMemo(
    () => rarityBrands.filter(b => discovered.has(b.name)),
    [rarityBrands, discovered],
  );
  const foundCount = discoveredInRarity.length;
  const pct = total > 0 ? Math.round((foundCount / total) * 1000) / 10 : 0;

  // Recently Discovered — top 5 for this rarity, sorted by date DESC
  // Main list items (filtered + sorted)
  const listItems = useMemo((): ListItem[] => {
    const q = search.trim().toLowerCase();

    // Build discovered items
    let discItems: DiscoveredItem[] = rarityBrands
      .filter(b => discovered.has(b.name))
      .filter(b => catFilter === 'all' || b.category === catFilter)
      .filter(b => !q || b.name.toLowerCase().includes(q))
      .map(b => ({ type: 'discovered' as const, brand: b, timestamp: brandDates.get(b.name) ?? 0 }));

    // Sort discovered
    if (sortBy === 'recent') {
      discItems = discItems.sort((a, b) => b.timestamp - a.timestamp);
    } else if (sortBy === 'alpha') {
      discItems = discItems.sort((a, b) => a.brand.name.localeCompare(b.brand.name));
    } else {
      discItems = discItems.sort((a, b) =>
        a.brand.category.localeCompare(b.brand.category) ||
        a.brand.name.localeCompare(b.brand.name)
      );
    }

    // Build undiscovered items
    // Category filter and search do NOT apply to unknowns (would reveal info)
    const undiscBrands = rarityBrands.filter(b => !discovered.has(b.name));
    const unknItems: UnknownItem[] = undiscBrands.map(b => ({
      type:   'unknown' as const,
      brand:  b,
      rarity,
    }));

    // Apply display mode
    if (displayMode === 'discovered')   return discItems;
    if (displayMode === 'undiscovered') return unknItems;
    return [...discItems, ...unknItems];
  }, [search, catFilter, sortBy, displayMode, rarityBrands, discovered, brandDates, rarity]);

  // Open filter — stage current values
  const openFilter = () => {
    setStagedCat(catFilter);
    setStagedSort(sortBy);
    setStagedDisplay(displayMode);
    setFilterOpen(true);
  };

  // Apply filter
  const applyFilter = () => {
    setCatFilter(stagedCat);
    setSortBy(stagedSort);
    setDisplayMode(stagedDisplay);
    setFilterOpen(false);
  };

  // Count active filters (excluding defaults)
  const activeFilters = [
    catFilter !== 'all' ? 1 : 0,
    sortBy !== 'recent' ? 1 : 0,
    displayMode !== 'all' ? 1 : 0,
  ].reduce((a, b) => a + b, 0);

  // ─────────────────────────────────────────────────────────────────────────

  const renderItem = ({ item }: { item: ListItem }) => {
    if (item.type === 'discovered') {
      // NEW dot reflects what was unread when the page opened (frozen for the
      // visit). Marking-seen already happened on open, so tapping just navigates.
      const isNew = newAtOpen.has(item.brand.name);
      return (
        <DiscoveredCard
          brand={item.brand}
          timestamp={item.timestamp}
          rarityColor={color}
          isNew={isNew}
          onPress={() => {
            router.push({ pathname: '/brand-detail' as any, params: { brand: item.brand.name } });
          }}
        />
      );
    }
    // Unknown — check if it's the previewed brand
    const isPreviewed = previewedBrand === item.brand.name;
    return (
      <UnknownCard
        brand={item.brand}
        rarity={item.rarity}
        rarityColor={color}
        isPreviewed={isPreviewed}
        onPress={() => handleUnknownTap(item.brand)}
      />
    );
  };

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>

      {/* Header */}
      <View style={s.header}>
        <Pressable
          onPress={() => router.canGoBack() ? router.back() : router.replace('/brand-compendium' as any)}
          hitSlop={8}
          style={({ pressed }) => [s.backBtn, pressed && { opacity: 0.6 }]}
        >
          <MaterialIcons name="arrow-back" size={20} color={FOREST} />
        </Pressable>
        <View style={s.headerCenter}>
          <Text style={[s.headerTitle, { color }]}>{label}</Text>
          <Text style={s.headerSub}>Brands</Text>
        </View>
        <View style={{ width: 34 }} />
      </View>
      {/* Colored accent line under header */}
      <View style={[s.accentLine, { backgroundColor: color }]} />

      <FlatList
        data={listItems}
        keyExtractor={item =>
          item.type === 'discovered' ? item.brand.name : `unknown-${item.brand.name}`
        }
        renderItem={renderItem}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          s.list,
          { paddingBottom: Math.max(insets.bottom, 16) + 24 },
        ]}

        ListHeaderComponent={
          <View style={s.listHeader}>

            {/* Summary */}
            <View style={[s.summaryCard, { borderColor: color + '40' }]}>
              <Text style={s.summaryText}>
                <Text style={[s.summaryNum, { color }]}>{foundCount}</Text>
                <Text style={s.summaryOf}> / {total} Found</Text>
              </Text>
              <View style={s.summaryBarTrack}>
                <View style={[
                  s.summaryBarFill,
                  { width: `${Math.min(pct, 100)}%` as any, backgroundColor: color },
                ]} />
              </View>
              <Text style={[s.summaryPct, { color }]}>{pct}% Complete</Text>
            </View>

                        {/* Search + filter */}
            <View style={s.searchRow}>
              <View style={s.searchWrap}>
                <MaterialIcons name="search" size={18} color={MUTED} style={{ marginRight: 8 }} />
                <TextInput
                  style={s.searchInput}
                  placeholder="Search brands..."
                  placeholderTextColor={MUTED}
                  value={search}
                  onChangeText={setSearch}
                  autoCorrect={false}
                  autoCapitalize="none"
                  clearButtonMode="while-editing"
                />
              </View>
              <Pressable
                onPress={openFilter}
                style={({ pressed }) => [
                  s.filterBtn,
                  { borderColor: activeFilters > 0 ? color : BORDER },
                  activeFilters > 0 && { backgroundColor: color + '18' },
                  pressed && { opacity: 0.7 },
                ]}
              >
                <MaterialIcons
                  name="tune"
                  size={20}
                  color={activeFilters > 0 ? color : MUTED}
                />
                {activeFilters > 0 && (
                  <View style={[s.filterDot, { backgroundColor: color }]}>
                    <Text style={s.filterDotText}>{activeFilters}</Text>
                  </View>
                )}
              </Pressable>
            </View>

            {/* "All Brands" divider */}
            <View style={s.allBrandsDivider}>
              <View style={s.dividerLine} />
              <Text style={s.dividerLabel}>
                All {label} Brands
              </Text>
              <View style={s.dividerLine} />
            </View>

            {/* Mystery preview hint */}
            {!previewUsed && (
              <View style={s.previewHint}>
                <MaterialIcons name="visibility" size={15} color={GOLD} />
                <Text style={s.previewHintText}>
                  Tap any locked brand to use today's Mystery Preview.
                </Text>
              </View>
            )}

          </View>
        }

        ListEmptyComponent={
          <View style={s.emptyWrap}>
            <MaterialIcons name="search-off" size={32} color={MUTED} />
            <Text style={s.emptyText}>No brands match your search.</Text>
          </View>
        }
      />

      {/* Filter Bottom Sheet */}
      <Modal
        visible={filterOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setFilterOpen(false)}
      >
        <Pressable style={s.sheetOverlay} onPress={() => setFilterOpen(false)} />
        <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>

          <View style={s.sheetHandle} />
          <Text style={s.sheetTitle}>Filter & Sort</Text>

          <ScrollView showsVerticalScrollIndicator={false}>

            {/* Category */}
            <Text style={s.sheetSectionLabel}>Category</Text>
            <View style={s.sheetOptions}>
              {(['all', 'sportswear', 'denim', 'menswear', 'womenswear',
                 'outdoor', 'workwear', 'streetwear', 'luxury',
                 'footwear', 'accessories', 'golf', 'basics', 'kids'] as const).map(c => (
                <Pressable
                  key={c}
                  onPress={() => setStagedCat(c)}
                  style={[
                    s.sheetPill,
                    stagedCat === c && { backgroundColor: color, borderColor: color },
                  ]}
                >
                  <Text style={[
                    s.sheetPillText,
                    stagedCat === c && { color: '#FFFEFA' },
                  ]}>
                    {c === 'all' ? 'All Categories' : CATEGORY_LABELS[c]}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Sort By */}
            <Text style={[s.sheetSectionLabel, { marginTop: 20 }]}>Sort By</Text>
            {([
              ['recent', 'Recently Discovered'],
              ['alpha',  'Alphabetical (A–Z)'],
              ['category', 'Category'],
            ] as [SortBy, string][]).map(([val, label]) => (
              <Pressable
                key={val}
                onPress={() => setStagedSort(val)}
                style={s.sheetRow}
              >
                <Text style={s.sheetRowText}>{label}</Text>
                <View style={[
                  s.sheetRadio,
                  stagedSort === val && { backgroundColor: color, borderColor: color },
                ]}>
                  {stagedSort === val && (
                    <View style={s.sheetRadioFill} />
                  )}
                </View>
              </Pressable>
            ))}

            {/* Display */}
            <Text style={[s.sheetSectionLabel, { marginTop: 20 }]}>Show</Text>
            {([
              ['all',          'All Brands'],
              ['discovered',   'Discovered Only'],
              ['undiscovered', 'Undiscovered Only'],
            ] as [DisplayMode, string][]).map(([val, label]) => (
              <Pressable
                key={val}
                onPress={() => setStagedDisplay(val)}
                style={s.sheetRow}
              >
                <Text style={s.sheetRowText}>{label}</Text>
                <View style={[
                  s.sheetRadio,
                  stagedDisplay === val && { backgroundColor: color, borderColor: color },
                ]}>
                  {stagedDisplay === val && (
                    <View style={s.sheetRadioFill} />
                  )}
                </View>
              </Pressable>
            ))}

            <View style={{ height: 16 }} />

          </ScrollView>

          {/* Apply + Reset */}
          <View style={s.sheetActions}>
            <Pressable
              onPress={() => {
                setStagedCat('all');
                setStagedSort('recent');
                setStagedDisplay('all');
              }}
              style={s.sheetResetBtn}
            >
              <Text style={s.sheetResetText}>Reset</Text>
            </Pressable>
            <Pressable
              onPress={applyFilter}
              style={[s.sheetApplyBtn, { backgroundColor: color }]}
            >
              <Text style={s.sheetApplyText}>Apply</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

    </View>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function DiscoveredCard({
  brand, timestamp, rarityColor, isNew, onPress,
}: { brand: Brand; timestamp: number; rarityColor: string; isNew: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [s.discCard, pressed && { opacity: 0.75 }]}
    >
      <View style={[s.discCheck, { backgroundColor: rarityColor + '20', borderColor: rarityColor + '60' }]}>
        <MaterialIcons name="check" size={16} color={rarityColor} />
      </View>
      <View style={s.discBody}>
        <Text style={s.discName}>{brand.name}</Text>
        <Text style={s.discCat}>{CATEGORY_LABELS[brand.category]}</Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        <View style={[s.discRarityBadge, { borderColor: rarityColor + '50', backgroundColor: rarityColor + '12' }]}>
          <Text style={[s.discRarityText, { color: rarityColor }]}>{RARITY_LABELS[brand.rarity]}</Text>
        </View>
        {isNew && (
          <View style={s.newBadge}>
            <Text style={s.newBadgeText}>NEW</Text>
          </View>
        )}
        <Text style={s.discDate}>{formatDate(timestamp)}</Text>
      </View>
    </Pressable>
  );
}

function UnknownCard({
  brand, rarity, rarityColor, isPreviewed, onPress,
}: {
  brand: Brand; rarity: BrandRarity; rarityColor: string;
  isPreviewed: boolean; onPress: () => void;
}) {
  // Previewed state — reveal name/category temporarily, distinct styling
  if (isPreviewed) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          s.previewCard,
          { borderColor: rarityColor },
          pressed && { opacity: 0.8 },
        ]}
      >
        <View style={[s.previewIcon, { backgroundColor: rarityColor + '20', borderColor: rarityColor + '60' }]}>
          <MaterialIcons name="visibility" size={15} color={rarityColor} />
        </View>
        <View style={s.discBody}>
          <Text style={[s.discName, { color: BROWN }]}>{brand.name}</Text>
          <Text style={s.discCat}>{CATEGORY_LABELS[brand.category]}</Text>
        </View>
        <View style={[s.previewBadge, { backgroundColor: rarityColor }]}>
          <Text style={s.previewBadgeText}>PREVIEW</Text>
        </View>
      </Pressable>
    );
  }

  // Hidden state
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [s.unknownCard, pressed && { opacity: 0.85 }]}
    >
      <View style={s.unknownIcon}>
        <MaterialIcons name="lock" size={16} color={MUTED} />
      </View>
      <Text style={s.unknownText}>Unknown {RARITY_LABELS[rarity]} Brand</Text>
      <Text style={s.unknownRate}>{brand.globalUnlockRate}%</Text>
      <View style={s.unknownBadge}>
        <Text style={s.unknownBadgeText}>?</Text>
      </View>
    </Pressable>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: PARCH },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 14,
    backgroundColor: PARCH,
  },
  backBtn: {
    width: 34, height: 34, borderRadius: 17,
    borderWidth: 1, borderColor: BORDER, backgroundColor: CARD,
    justifyContent: 'center', alignItems: 'center',
  },
  headerCenter: { flex: 1, alignItems: 'center', gap: 0 },
  headerTitle:  { fontFamily: FONTS.serif, fontSize: 22, fontWeight: '900' },
  headerSub:    { fontSize: 12, color: MUTED },
  accentLine:   { height: 3 },

  list:       { paddingHorizontal: 16, paddingTop: 14 },
  listHeader: { gap: 14, marginBottom: 8 },

  // Summary card
  summaryCard: {
    backgroundColor: IVORY, borderRadius: 14, borderWidth: 1.5,
    padding: 14, gap: 8,
  },
  summaryText: {},
  summaryNum:  { fontFamily: FONTS.serif, fontSize: 24, fontWeight: '900' },
  summaryOf:   { fontSize: 15, color: MUTED },
  summaryBarTrack: {
    height: 6, backgroundColor: BORDER + '60', borderRadius: 3, overflow: 'hidden',
  },
  summaryBarFill: { height: '100%', borderRadius: 3 },
  summaryPct:  { fontSize: 11, fontWeight: '700' },

  // Search row
  searchRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  searchWrap: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    backgroundColor: CARD, borderRadius: 12,
    borderWidth: 1, borderColor: BORDER, paddingHorizontal: 12, height: 42,
  },
  searchInput: { flex: 1, fontSize: 14, color: BROWN, fontFamily: FONTS.serif },
  filterBtn: {
    width: 42, height: 42, borderRadius: 12,
    borderWidth: 1.5, backgroundColor: CARD,
    justifyContent: 'center', alignItems: 'center',
  },
  filterDot: {
    position: 'absolute', top: -4, right: -4,
    width: 16, height: 16, borderRadius: 8,
    justifyContent: 'center', alignItems: 'center',
  },
  filterDotText: { fontSize: 9, fontWeight: '900', color: '#FFF' },

  // All brands divider
  allBrandsDivider: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dividerLine:  { flex: 1, height: 1, backgroundColor: BORDER },
  dividerLabel: {
    fontFamily: FONTS.serif, fontSize: 11, fontWeight: '700',
    color: MUTED, letterSpacing: 0.5,
  },

  // Preview hint
  previewHint: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: GOLD + '12', borderRadius: 10,
    borderWidth: 1, borderColor: GOLD + '40',
    paddingHorizontal: 12, paddingVertical: 9,
  },
  previewHintText: { flex: 1, fontSize: 11, color: BROWN, fontWeight: '600' },

  // Discovered card
  discCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: IVORY, borderRadius: 12,
    borderWidth: 1.5, borderColor: BORDER,
    paddingHorizontal: 12, paddingVertical: 11, marginBottom: 6,
  },
  discCheck: {
    width: 32, height: 32, borderRadius: 9, borderWidth: 1.5,
    justifyContent: 'center', alignItems: 'center',
  },
  discBody:     { flex: 1, gap: 2 },
  discName:     { fontFamily: FONTS.serif, fontSize: 14, fontWeight: '800', color: BROWN },
  discCat:      { fontSize: 10, color: MUTED },
  discRarityBadge: {
    borderRadius: 6, borderWidth: 1,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  discRarityText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.4 },
  discDate:     { fontSize: 9, color: MUTED },
  newBadge: {
    backgroundColor: '#CC2222', borderRadius: 5,
    paddingHorizontal: 5, paddingVertical: 2,
  },
  newBadgeText: { fontSize: 8, fontWeight: '900', color: '#fff', letterSpacing: 0.6 },

  // Unknown card
  unknownCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: CARD, borderRadius: 12,
    borderWidth: 1.5, borderColor: BORDER,
    paddingHorizontal: 12, paddingVertical: 11, marginBottom: 6,
    opacity: 0.55,
  },
  unknownIcon: {
    width: 32, height: 32, borderRadius: 9,
    backgroundColor: TAN, borderWidth: 1, borderColor: BORDER,
    justifyContent: 'center', alignItems: 'center',
  },
  unknownText: { flex: 1, fontSize: 13, fontWeight: '600', color: MUTED, fontStyle: 'italic' },
  unknownRate: { fontSize: 11, fontWeight: '700', color: MUTED, marginRight: 8 },
  unknownBadge: {
    width: 22, height: 22, borderRadius: 6,
    backgroundColor: TAN, borderWidth: 1, borderColor: BORDER,
    justifyContent: 'center', alignItems: 'center',
  },
  unknownBadgeText: { fontSize: 11, fontWeight: '900', color: MUTED },

  // Preview card (temporarily revealed)
  previewCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: IVORY, borderRadius: 12,
    borderWidth: 1.5, borderStyle: 'dashed',
    paddingHorizontal: 12, paddingVertical: 11, marginBottom: 6,
  },
  previewIcon: {
    width: 32, height: 32, borderRadius: 9, borderWidth: 1.5,
    justifyContent: 'center', alignItems: 'center',
  },
  previewBadge: {
    borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3,
  },
  previewBadgeText: { fontSize: 8, fontWeight: '900', color: '#FFFEFA', letterSpacing: 0.6 },

  // Empty state
  emptyWrap: { alignItems: 'center', gap: 10, paddingTop: 32 },
  emptyText: { fontSize: 14, color: MUTED, fontFamily: FONTS.serif },

  // Filter bottom sheet
  sheetOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.40)',
  },
  sheet: {
    backgroundColor: IVORY,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingTop: 12,
    maxHeight: '80%',
  },
  sheetHandle: {
    width: 38, height: 4, borderRadius: 2,
    backgroundColor: BORDER, alignSelf: 'center', marginBottom: 16,
  },
  sheetTitle: {
    fontFamily: FONTS.serif, fontSize: 18, fontWeight: '900',
    color: BROWN, marginBottom: 16,
  },
  sheetSectionLabel: {
    fontSize: 11, fontWeight: '800', color: MUTED,
    textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 10,
  },
  sheetOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  sheetPill: {
    borderRadius: 20, borderWidth: 1.5, borderColor: BORDER,
    paddingHorizontal: 12, paddingVertical: 6, backgroundColor: CARD,
  },
  sheetPillText: { fontSize: 12, fontWeight: '600', color: MUTED },

  sheetRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: BORDER + '40',
  },
  sheetRowText: { flex: 1, fontSize: 14, color: BROWN, fontFamily: FONTS.serif },
  sheetRadio: {
    width: 20, height: 20, borderRadius: 10,
    borderWidth: 2, borderColor: BORDER,
    justifyContent: 'center', alignItems: 'center',
  },
  sheetRadioFill: {
    width: 8, height: 8, borderRadius: 4, backgroundColor: '#FFFEFA',
  },

  sheetActions: { flexDirection: 'row', gap: 12, marginTop: 16 },
  sheetResetBtn: {
    flex: 1, height: 46, borderRadius: 12,
    borderWidth: 1.5, borderColor: BORDER,
    justifyContent: 'center', alignItems: 'center',
  },
  sheetResetText: { fontSize: 14, fontWeight: '700', color: MUTED },
  sheetApplyBtn: {
    flex: 2, height: 46, borderRadius: 12,
    justifyContent: 'center', alignItems: 'center',
  },
  sheetApplyText: { fontSize: 14, fontWeight: '900', color: '#FFFEFA', fontFamily: FONTS.serif },
});
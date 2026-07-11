/**
 * app/brand-detail.tsx
 *
 * FILE PATH: app/brand-detail.tsx
 *
 * Pass 2 — Brand Detail Page.
 * Opened by tapping a discovered brand (from rarity screen or reveal).
 * Receives ?brand=<canonicalName> via route params.
 *
 * Sections:
 *   - Header (name, category, rarity badge)
 *   - Discovery hero card (date discovered)
 *   - Brand stats row (scans, profit, best flip)
 *   - Brand information (logo placeholder, country, founded, description)
 *   - Market information (resale, demand, sell speed, common products)
 *   - Discovery info (collection position + date)
 *   - Collection completion
 *   - Rarity information (unlock rate)
 */

import {
  View, Text, StyleSheet, ScrollView, Pressable,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useState, useCallback, useMemo, useEffect } from 'react';

import { FONTS } from '@/constants/typography';
import { useAuth } from '@/lib/auth-context';
import { trackAnalyticsEvent, useScreenFocus } from '@/lib/analytics';
import { useFlipStore } from '@/lib/useFlipStore';
import { loadXpProfile } from '@/lib/huntXp';
import {
  getBrandByName,
  getBrandStats,
  computeDiscoveredBrands,
  TOTAL_SUPPORTED_BRANDS,
  RARITY_COLORS,
  RARITY_LABELS,
  CATEGORY_LABELS,
  type BrandStats,
} from '@/lib/brandCompendium';
import { getBrandMeta, getBrandLogoUrl } from '@/lib/brandMeta';

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatFullDate(ts: number): string {
  if (ts <= 1) return 'Discovered in Hunt Mode';
  const d = new Date(ts);
  const M = ['January','February','March','April','May','June',
             'July','August','September','October','November','December'];
  return `${M[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function money(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

// ─────────────────────────────────────────────────────────────────────────────

export default function BrandDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user }  = useAuth();
  const { flips } = useFlipStore();

  const { brand: brandParam } = useLocalSearchParams<{ brand: string }>();
  const brand = useMemo(() => getBrandByName(brandParam ?? ''), [brandParam]);

  const [stats,    setStats]    = useState<BrandStats | null>(null);
  const [totalDisc, setTotalDisc] = useState(0);
  const [logoError, setLogoError] = useState(false);

  // Analytics: a brand detail page was opened. cooldownKey is brand-specific so
  // opening Nike then Gucci both track (they don't share one cooldown window).
  useScreenFocus(
    'brand_detail_opened',
    {
      brand_id:     brand?.name ?? brandParam ?? null,
      brand_name:   brand?.name ?? brandParam ?? null,
      brand_rarity: brand?.rarity ?? null,
    },
    { cooldownKey: `brand_detail_opened:${(brand?.name ?? brandParam ?? 'unknown').toLowerCase()}` },
  );

  useFocusEffect(useCallback(() => {
    const load = async () => {
      if (!brand) return;
      setLogoError(false);  // fresh logo attempt for this brand
      const uid     = user?.id ?? null;
      const profile = uid ? await loadXpProfile(uid).catch(() => null) : null;
      const huntBrands = profile?.discoveredBrands ?? [];
      setStats(getBrandStats(flips, brand.name, huntBrands));

      let total = computeDiscoveredBrands(flips, huntBrands).size;
      // DEV — include dev-unlocked brands in the total so completion % matches.
      if (__DEV__) {
        const { getDevUnlockedBrands } = await import('@/lib/devBrandOverrides');
        const real = computeDiscoveredBrands(flips, huntBrands);
        const devSet = await getDevUnlockedBrands();
        total = new Set([...real, ...devSet]).size;
      }
      setTotalDisc(total);
    };
    load();
  }, [brand, user?.id, flips]));

  // Brand not found / not supported
  if (!brand) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <View style={s.header}>
          <Pressable onPress={() => router.back()} style={s.backBtn}>
            <MaterialIcons name="arrow-back" size={20} color={FOREST} />
          </Pressable>
          <View style={s.headerCenter}><Text style={s.headerTitle}>Brand</Text></View>
          <View style={{ width: 34 }} />
        </View>
        <View style={s.notFound}>
          <MaterialIcons name="help-outline" size={36} color={MUTED} />
          <Text style={s.notFoundText}>Brand not found.</Text>
        </View>
      </View>
    );
  }

  const meta  = getBrandMeta(brand.name);
  if (!meta) return null;
  const color = RARITY_COLORS[brand.rarity];
  const pct   = TOTAL_SUPPORTED_BRANDS > 0
    ? Math.round((totalDisc / TOTAL_SUPPORTED_BRANDS) * 1000) / 10
    : 0;

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
          <Text style={s.headerTitle}>{brand.name}</Text>
          <View style={s.headerMeta}>
            <Text style={s.headerCat}>{CATEGORY_LABELS[brand.category]}</Text>
            <View style={[s.headerRarityBadge, { backgroundColor: color + '18', borderColor: color + '55' }]}>
              <Text style={[s.headerRarityText, { color }]}>{RARITY_LABELS[brand.rarity]}</Text>
            </View>
          </View>
        </View>
        <View style={{ width: 34 }} />
      </View>
      <View style={[s.accentLine, { backgroundColor: color }]} />

      <ScrollView
        contentContainerStyle={[s.scroll, { paddingBottom: Math.max(insets.bottom, 16) + 24 }]}
        showsVerticalScrollIndicator={false}
      >

        {/* ── Discovery hero card ─────────────────────────────────────────── */}
        <View style={[s.heroCard, { borderColor: color + '50' }]}>
          <View style={[s.heroIconRing, { borderColor: color }]}>
            <MaterialIcons name="verified" size={28} color={color} />
          </View>
          <Text style={s.heroLabel}>ADDED TO YOUR COLLECTION</Text>
          <Text style={[s.heroDate, { color: BROWN }]}>
            {stats ? formatFullDate(stats.dateDiscovered) : '—'}
          </Text>
        </View>

        {/* ── Stats row ────────────────────────────────────────────────────── */}
        <View style={s.statsRow}>
          <View style={s.statBox}>
            <Text style={s.statNum}>{stats?.scanCount ?? 0}</Text>
            <Text style={s.statLabel}>Scans</Text>
          </View>
          <View style={s.statDivider} />
          <View style={s.statBox}>
            <Text style={[s.statNum, { color: FOREST }]}>{money(stats?.totalProfit ?? 0)}</Text>
            <Text style={s.statLabel}>Total Profit</Text>
          </View>
          <View style={s.statDivider} />
          <View style={s.statBox}>
            <Text style={[s.statNum, { color: GOLD }]}>{money(stats?.bestFlip ?? 0)}</Text>
            <Text style={s.statLabel}>Best Flip</Text>
          </View>
        </View>

        {/* ── Brand information ────────────────────────────────────────────── */}
        <View style={s.infoCard}>
          <View style={s.infoHeader}>
            {/* Brand logo — fetched at runtime via logo API; letter monogram fallback */}
            {(() => {
              const logoUrl = getBrandLogoUrl(meta.domain);
              const showLogo = logoUrl && !logoError;
              return (
                <View style={[s.logoBox, { borderColor: color + '40' }]}>
                  {showLogo ? (
                    <Image
                      source={{ uri: logoUrl }}
                      style={s.logoImage}
                      contentFit="contain"
                      transition={150}
                      onError={() => setLogoError(true)}
                    />
                  ) : (
                    <Text style={[s.logoLetter, { color }]}>{brand.name.charAt(0)}</Text>
                  )}
                </View>
              );
            })()}
            <View style={{ flex: 1 }}>
              <Text style={s.infoBrandName}>{brand.name}</Text>
              <Text style={s.infoBrandCat}>{CATEGORY_LABELS[brand.category]} · {RARITY_LABELS[brand.rarity]}</Text>
            </View>
          </View>

          <View style={s.infoMetaRow}>
            <View style={s.infoMetaCol}>
              <Text style={s.infoMetaLabel}>Country</Text>
              <Text style={s.infoMetaValue}>{meta.country}</Text>
            </View>
            <View style={s.infoMetaCol}>
              <Text style={s.infoMetaLabel}>Founded</Text>
              <Text style={s.infoMetaValue}>{meta.founded}</Text>
            </View>
          </View>

          <Text style={s.description}>{meta.description}</Text>
        </View>

        {/* ── Market information ───────────────────────────────────────────── */}
        <Text style={s.sectionLabel}>Market Information</Text>
        <View style={s.marketCard}>
          <View style={s.marketRow}>
            <Text style={s.marketLabel}>Resale Potential</Text>
            <View style={[s.marketPill, { backgroundColor: color + '18', borderColor: color + '50' }]}>
              <Text style={[s.marketPillText, { color }]}>{meta.resale}</Text>
            </View>
          </View>

          <View style={s.marketRow}>
            <Text style={s.marketLabel}>Demand</Text>
            <Text style={s.marketValue}>{meta.demand.toFixed(1)} / 10</Text>
          </View>
          <View style={s.demandBarTrack}>
            <View style={[s.demandBarFill, { width: `${meta.demand * 10}%` as any, backgroundColor: color }]} />
          </View>

          <View style={s.marketRow}>
            <Text style={s.marketLabel}>Typical Sell Speed</Text>
            <Text style={s.marketValue}>{meta.sellSpeed}</Text>
          </View>

          <Text style={[s.marketLabel, { marginTop: 6, marginBottom: 8 }]}>Common Products</Text>
          <View style={s.productTags}>
            {meta.products.map((p: string) => (
              <View key={p} style={s.productTag}>
                <Text style={s.productTagText}>{p}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* ── Discovery information ────────────────────────────────────────── */}
        <Text style={s.sectionLabel}>Discovery</Text>
        <View style={s.discoveryCard}>
          <View style={s.discoveryRow}>
            <MaterialIcons name="bookmark" size={18} color={color} />
            <Text style={s.discoveryText}>
              Brand <Text style={{ fontWeight: '900', color: BROWN }}>#{stats?.collectionOrder ?? '—'}</Text> Discovered
            </Text>
          </View>
          <View style={s.discoveryRow}>
            <MaterialIcons name="event" size={18} color={color} />
            <Text style={s.discoveryText}>
              {stats ? formatFullDate(stats.dateDiscovered) : '—'}
            </Text>
          </View>
        </View>

        {/* ── Collection completion ────────────────────────────────────────── */}
        <View style={s.completionCard}>
          <Text style={s.completionLabel}>Collection Completion</Text>
          <Text style={s.completionCount}>
            <Text style={[s.completionNum, { color: FOREST }]}>{totalDisc}</Text>
            <Text style={s.completionOf}> / {TOTAL_SUPPORTED_BRANDS} Brands</Text>
          </Text>
          <View style={s.completionBarTrack}>
            <View style={[s.completionBarFill, { width: `${Math.min((totalDisc / TOTAL_SUPPORTED_BRANDS) * 100, 100)}%` as any }]} />
          </View>
          <Text style={s.completionPct}>{pct}%</Text>
        </View>

        {/* ── Rarity information ───────────────────────────────────────────── */}
        <View style={[s.rarityCard, { borderColor: color + '50' }]}>
          <View style={[s.rarityIconRing, { backgroundColor: color + '18', borderColor: color }]}>
            <MaterialIcons
              name={brand.rarity === 'legendary' ? 'workspace-premium' : brand.rarity === 'rare' ? 'diamond' : brand.rarity === 'uncommon' ? 'grade' : 'local-offer'}
              size={22}
              color={color}
            />
          </View>
          <Text style={[s.rarityTitle, { color }]}>{RARITY_LABELS[brand.rarity]}</Text>
          <Text style={s.rarityRate}>
            Unlocked by {brand.globalUnlockRate}% of users
          </Text>
        </View>

      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: PARCH },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, backgroundColor: PARCH,
  },
  backBtn: {
    width: 34, height: 34, borderRadius: 17,
    borderWidth: 1, borderColor: BORDER, backgroundColor: CARD,
    justifyContent: 'center', alignItems: 'center',
  },
  headerCenter: { flex: 1, alignItems: 'center', gap: 3 },
  headerTitle:  { fontFamily: FONTS.serif, fontSize: 18, fontWeight: '900', color: FOREST, textAlign: 'center' },
  headerMeta:   { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerCat:    { fontSize: 11, color: MUTED },
  headerRarityBadge: { borderRadius: 6, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 1 },
  headerRarityText:  { fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },
  accentLine:   { height: 3 },

  scroll: { paddingHorizontal: 16, paddingTop: 16, gap: 16 },

  // Hero
  heroCard: {
    backgroundColor: IVORY, borderRadius: 18, borderWidth: 1.5,
    paddingVertical: 22, alignItems: 'center', gap: 8, overflow: 'hidden',
  },
  heroIconRing: {
    width: 56, height: 56, borderRadius: 28, borderWidth: 2,
    justifyContent: 'center', alignItems: 'center', marginBottom: 2,
  },
  heroLabel: { fontSize: 10, fontWeight: '800', color: MUTED, letterSpacing: 1.4 },
  heroDate:  { fontFamily: FONTS.serif, fontSize: 20, fontWeight: '900' },

  // Stats row
  statsRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: CARD, borderRadius: 14, borderWidth: 1, borderColor: BORDER,
    paddingVertical: 14,
  },
  statBox:   { flex: 1, alignItems: 'center', gap: 2 },
  statNum:   { fontFamily: FONTS.serif, fontSize: 18, fontWeight: '900', color: BROWN },
  statLabel: { fontSize: 10, color: MUTED },
  statDivider: { width: 1, height: 30, backgroundColor: BORDER },

  // Info card
  infoCard: {
    backgroundColor: IVORY, borderRadius: 16, borderWidth: 1.5, borderColor: BORDER,
    padding: 16, gap: 14,
  },
  infoHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  logoBox: {
    width: 52, height: 52, borderRadius: 12, borderWidth: 1.5, backgroundColor: CARD,
    justifyContent: 'center', alignItems: 'center', overflow: 'hidden',
  },
  logoImage: { width: 44, height: 44, borderRadius: 8 },
  logoLetter: { fontFamily: FONTS.serif, fontSize: 26, fontWeight: '900' },
  infoBrandName: { fontFamily: FONTS.serif, fontSize: 18, fontWeight: '900', color: BROWN },
  infoBrandCat:  { fontSize: 11, color: MUTED, marginTop: 2 },

  infoMetaRow: { flexDirection: 'row', gap: 24 },
  infoMetaCol: { gap: 2 },
  infoMetaLabel: { fontSize: 10, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.6 },
  infoMetaValue: { fontSize: 14, fontWeight: '700', color: BROWN, fontFamily: FONTS.serif },

  description: { fontSize: 13, color: BROWN, lineHeight: 20 },

  // Section label
  sectionLabel: {
    fontFamily: FONTS.serif, fontSize: 13, fontWeight: '700',
    color: BROWN, letterSpacing: 0.3, textTransform: 'uppercase', marginBottom: -6,
  },

  // Market card
  marketCard: {
    backgroundColor: IVORY, borderRadius: 16, borderWidth: 1.5, borderColor: BORDER,
    padding: 16, gap: 10,
  },
  marketRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  marketLabel: { fontSize: 13, color: MUTED, fontWeight: '600' },
  marketValue: { fontSize: 14, color: BROWN, fontWeight: '800', fontFamily: FONTS.serif },
  marketPill: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 3 },
  marketPillText: { fontSize: 12, fontWeight: '900' },
  demandBarTrack: { height: 5, backgroundColor: BORDER + '60', borderRadius: 3, overflow: 'hidden', marginTop: -4 },
  demandBarFill:  { height: '100%', borderRadius: 3 },
  productTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  productTag: {
    backgroundColor: CARD, borderRadius: 8, borderWidth: 1, borderColor: BORDER,
    paddingHorizontal: 10, paddingVertical: 5,
  },
  productTagText: { fontSize: 11, color: BROWN, fontWeight: '600' },

  // Discovery card
  discoveryCard: {
    backgroundColor: IVORY, borderRadius: 16, borderWidth: 1.5, borderColor: BORDER,
    padding: 16, gap: 12,
  },
  discoveryRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  discoveryText: { fontSize: 13, color: MUTED },

  // Completion card
  completionCard: {
    backgroundColor: IVORY, borderRadius: 16, borderWidth: 1.5, borderColor: GOLD + '55',
    padding: 16, gap: 8, alignItems: 'center', overflow: 'hidden',
  },
  completionLabel: { fontSize: 11, color: MUTED, letterSpacing: 1, textTransform: 'uppercase' },
  completionCount: {},
  completionNum: { fontFamily: FONTS.serif, fontSize: 26, fontWeight: '900' },
  completionOf:  { fontSize: 15, color: MUTED },
  completionBarTrack: {
    width: '100%', height: 7, backgroundColor: BORDER + '60', borderRadius: 4, overflow: 'hidden',
  },
  completionBarFill: { height: '100%', backgroundColor: FOREST, borderRadius: 4 },
  completionPct: { fontFamily: FONTS.serif, fontSize: 16, fontWeight: '900', color: GOLD },

  // Rarity card
  rarityCard: {
    backgroundColor: IVORY, borderRadius: 16, borderWidth: 1.5,
    padding: 18, alignItems: 'center', gap: 6,
  },
  rarityIconRing: {
    width: 48, height: 48, borderRadius: 24, borderWidth: 2,
    justifyContent: 'center', alignItems: 'center', marginBottom: 2,
  },
  rarityTitle: { fontFamily: FONTS.serif, fontSize: 18, fontWeight: '900', letterSpacing: 0.5 },
  rarityRate:  { fontSize: 13, color: MUTED, fontWeight: '600' },

  // Not found
  notFound: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  notFoundText: { fontSize: 15, color: MUTED, fontFamily: FONTS.serif },
});
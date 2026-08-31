/**
 * app/scan-store.tsx
 *
 * The Scan Store — a merchant's supply catalog for the hunt.
 *
 * ── What this screen is allowed to decide ───────────────────────────────────
 * Almost nothing. It renders live RevenueCat products, calls the Phase 3
 * purchase service, and displays the authoritative balance the server returns.
 * It never computes a grant, never adds to a balance, and never tells the
 * server what was bought — that architecture was live-validated in Phase 3 and
 * is reused untouched.
 *
 * ── The rule worth stating loudly ───────────────────────────────────────────
 * There is NO optimistic balance anywhere in this file. A RevenueCat success is
 * not scans; the server reconciling a canonical V2 purchase is. The number on
 * screen is always the last authoritative read, and the gap between paying and
 * seeing it is filled with "Adding scans…" rather than arithmetic we invented.
 *
 * ── Two entry modes ─────────────────────────────────────────────────────────
 * browse       — arrived voluntarily from the scan-balance sheet. Buy, watch
 *                the balance rise, stay and buy more.
 * resume_scan  — arrived because a scan was blocked. The moment scans exist the
 *                original problem is solved, so the store closes and the scan
 *                they already asked for resumes.
 *
 * The intent lives in lib/scanStoreIntent.ts, not in route params: the
 * continuation is a function, and functions do not survive serialization.
 *
 * ── No Pro upsell here ──────────────────────────────────────────────────────
 * This screen sells quantity. Free users reach it through the Scan Limit
 * paywall, which has already offered them Pro; repeating the pitch would be
 * badgering someone who just declined it.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator, InteractionManager,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { FONTS } from '@/constants/typography';
import { Skeleton } from '@/components/monetization/Skeleton';
import { useAuth } from '@/lib/auth-context';
import { useEntitlement, useRefreshEntitlement } from '@/lib/useEntitlement';
import {
  purchaseScanPack, recoverPacksOnServer, loadScanPackProducts,
  type ScanPackSku, type ScanPackProductsResult,
} from '@/lib/purchases';
import {
  SCAN_PACKS, bestValueSku, formatScans, packBySku, type PackPricing, type PackSku,
} from '@/lib/scanPackCatalog';
import { readProductPricing, type ProductPricing } from '@/lib/paywallPricing';
import { clearScanStoreIntent, consumeScanStoreIntent, scanStoreEntryMode } from '@/lib/scanStoreIntent';
import { trackAnalyticsEvent } from '@/lib/analytics';

// ─── Palette — the shipped monetization values ────────────────────────────────
// Page canvas only. CARD / GOLD_TINT / BORDER / GOLD are unchanged, so the
// pack cards and balance card keep their warm treatment against white.
const PARCHMENT = '#FFFFFF';
const CARD      = '#FFFEFA';
const GOLD_TINT = '#F5EBCB';
const FOREST    = '#214D2D';
const INK       = '#2B2118';
const BROWN     = '#6F5A3E';
const BORDER    = '#DDD2AC';
const GOLD      = '#C4A334';
const CREAM     = '#F4EED8';

type Phase = 'idle' | 'purchasing' | 'granting' | 'recovering';

export default function ScanStoreScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const ent = useEntitlement();
  const invalidateEntitlement = useRefreshEntitlement();

  /**
   * Entry mode is captured ONCE, on mount.
   *
   * Reading it live would flip it to "browse" the instant the intent is
   * consumed, changing the screen's behaviour mid-purchase.
   */
  const [entryMode] = useState(() => scanStoreEntryMode());

  const [products, setProducts] = useState<ScanPackProductsResult | null>(null);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [attempt, setAttempt] = useState(0);

  const [phase, setPhase] = useState<Phase>('idle');
  const [activeSku, setActiveSku] = useState<ScanPackSku | null>(null);
  const [notice, setNotice] = useState<{ tone: 'info' | 'error' | 'success'; text: string } | null>(null);

  const uidRef = useRef<string | null>(user?.id ?? null);
  uidRef.current = user?.id ?? null;

  // ── Products ──────────────────────────────────────────────────────────────
  const runId = useRef(0);
  useEffect(() => {
    const id = ++runId.current;
    setLoadingProducts(true);
    void (async () => {
      let r: ScanPackProductsResult;
      try { r = await loadScanPackProducts(); }
      catch {
        r = { status: 'error', products: [], missing: [], message: 'Scan Store is temporarily unavailable.' };
      }
      if (id !== runId.current) return;
      setProducts(r);
      setLoadingProducts(false);
    })();
  }, [attempt]);

  useEffect(() => {
    trackAnalyticsEvent('scan_store_opened', { entry_mode: entryMode });
  }, [entryMode]);

  /**
   * ── Account switch ──────────────────────────────────────────────────────
   *
   * B must never see A's balance, and must never inherit A's pending scan. The
   * balance clears because useEntitlement re-resolves for the new uid; the
   * intent is dropped here explicitly.
   */
  const lastUid = useRef<string | null>(user?.id ?? null);
  useEffect(() => {
    const uid = user?.id ?? null;
    if (lastUid.current === uid) return;
    lastUid.current = uid;
    clearScanStoreIntent();
    setNotice(null);
    setPhase('idle');
    setActiveSku(null);
  }, [user?.id]);

  // ── Pricing ───────────────────────────────────────────────────────────────
  const pricingBySku = useMemo(() => {
    const m = new Map<string, ProductPricing>();
    for (const p of products?.products ?? []) m.set(p.sku, readProductPricing(p.pkg));
    return m;
  }, [products]);

  /**
   * Computed, never hardcoded to FlipGod.
   *
   * Pricing is App Store configuration and can change without anyone editing
   * this app. A badge claiming BEST VALUE when it is no longer true is a false
   * claim about money, so the helper refuses on any incomplete or mixed-currency
   * set rather than guessing.
   */
  const bestValue = useMemo<PackSku | null>(() => {
    if (products?.status !== 'ready') return null;
    const rows: PackPricing[] = SCAN_PACKS.map(p => {
      const pr = pricingBySku.get(p.sku);
      return { sku: p.sku, priceAmount: pr?.priceAmount ?? null, currencyCode: pr?.currencyCode ?? null };
    });
    return bestValueSku(rows);
  }, [products, pricingBySku]);

  // ── Balance ───────────────────────────────────────────────────────────────
  /** Unresolved shows a skeleton, never "0" — a false zero reads as a lost balance. */
  const balanceReady = ent.status === 'ready';
  const packBalance = ent.packScansRemaining;
  const busy = phase !== 'idle';

  // ── Resume ────────────────────────────────────────────────────────────────
  const resumedRef = useRef(false);

  /**
   * Leave and resume the blocked scan — once.
   *
   * Requires an authoritative usable balance, not merely a successful payment:
   * closing the store and opening the camera against a stale zero would fail at
   * reservation and look like the purchase did nothing.
   */
  const maybeResume = useCallback(async () => {
    if (entryMode !== 'resume_scan' || resumedRef.current) return false;

    const res: any = await invalidateEntitlement().catch(() => null);
    const total = res?.entitlement?.totalUsableScans ?? ent.totalUsableScans;
    if (!(typeof total === 'number' && total > 0)) return false;

    const intent = consumeScanStoreIntent(uidRef.current ?? null);
    /**
     * No intent means the account changed or it was already taken. The PURCHASE
     * is still perfectly valid — the scans are on the account — so this is never
     * surfaced as a failure. The user simply stays in the store.
     */
    if (!intent) return false;

    resumedRef.current = true;
    trackAnalyticsEvent('scan_store_resumed_scan', { origin: intent.origin });
    InteractionManager.runAfterInteractions(() => {
      router.back();
      intent.resume();
    });
    return true;
  }, [entryMode, invalidateEntitlement, ent.totalUsableScans, router]);

  // ── Purchase ──────────────────────────────────────────────────────────────
  const buy = useCallback(async (sku: ScanPackSku) => {
    if (busy) return;                       // one purchase at a time
    const startedUid = uidRef.current ?? null;
    const pack = packBySku(sku);

    setActiveSku(sku);
    setNotice(null);
    setPhase('purchasing');
    trackAnalyticsEvent('scan_pack_purchase_started', { product_id: sku, entry_mode: entryMode });

    const r = await purchaseScanPack(sku, startedUid, () => uidRef.current ?? null);

    if (r.status === 'cancelled') {
      trackAnalyticsEvent('scan_pack_purchase_cancelled', { product_id: sku });
      setPhase('idle'); setActiveSku(null);
      return;                               // benign — no notice at all
    }

    if (r.status === 'success' || r.status === 'sync_pending') {
      setPhase('granting');
      await invalidateEntitlement().catch(() => {});
      trackAnalyticsEvent('scan_pack_purchase_completed', { product_id: sku, entry_mode: entryMode });

      /**
       * The granted count is the SERVER's, never `pack.scans`. They agree
       * today; if they ever disagreed, the card label would be the thing that
       * was wrong, and reporting it would launder a client number into a
       * confirmation.
       */
      const granted = r.scansGranted ?? null;
      setNotice({
        tone: 'success',
        text: granted && granted > 0
          ? `${formatScans(granted)} scans added to your Pack balance.`
          : 'Purchase complete. Your scans will appear shortly.',
      });
      setPhase('idle'); setActiveSku(null);
      await maybeResume();
      return;
    }

    trackAnalyticsEvent('scan_pack_purchase_failed', { product_id: sku, reason: r.status });
    setNotice({
      tone: r.status === 'account_changed' || r.status === 'pending' || r.status === 'unavailable' ? 'info' : 'error',
      text: r.message ?? `We couldn't complete that purchase${pack ? ` for ${pack.name}` : ''}. Please try again.`,
    });
    setPhase('idle'); setActiveSku(null);
  }, [busy, entryMode, invalidateEntitlement, maybeResume]);

  // ── Recovery ──────────────────────────────────────────────────────────────
  const recover = useCallback(async () => {
    if (busy) return;
    setNotice(null);
    setPhase('recovering');
    trackAnalyticsEvent('scan_pack_recovery', {});

    const r = await recoverPacksOnServer();
    await invalidateEntitlement().catch(() => {});

    /**
     * The counts are the server's. Recovery is idempotent — an already-granted
     * purchase adds zero — so pressing this repeatedly can never inflate a
     * balance, and the copy must not imply it might.
     */
    setNotice(
      !r.ok
        ? { tone: 'error', text: "We couldn't check your purchases just now. Please try again." }
        : r.totalScansGranted > 0
          ? { tone: 'success', text: `Recovered ${formatScans(r.totalScansGranted)} Pack Scans.` }
          : { tone: 'info', text: 'Your Scan Packs are already up to date.' },
    );
    setPhase('idle');
  }, [busy, invalidateEntitlement]);

  /** Backing out abandons the blocked scan — it must not launch later. */
  const goBack = useCallback(() => {
    clearScanStoreIntent();
    router.back();
  }, [router]);

  return (
    <View style={s.root}>
      <View style={[s.header, { paddingTop: Math.max(insets.top, 20) + 6 }]}>
        <Pressable
          onPress={goBack}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={({ pressed }) => [s.backBtn, pressed && { opacity: 0.6 }]}
        >
          <MaterialIcons name="arrow-back" size={22} color={FOREST} />
        </Pressable>
        <Text style={s.headerTitle}>Scan Store</Text>
        <View style={s.backBtn} />
      </View>

      <ScrollView
        contentContainerStyle={[s.scroll, { paddingBottom: Math.max(insets.bottom, 16) + 28 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={s.subtitle}>Stock up on extra scans whenever you need them.</Text>

        {/* ── Balance ──────────────────────────────────────────────────── */}
        <View style={s.balanceCard}>
          <Text style={s.balanceLabel}>YOUR PACK BALANCE</Text>
          {balanceReady ? (
            <Text
              style={s.balanceValue}
              accessibilityLabel={`${formatScans(packBalance)} pack scans remaining`}
            >
              {formatScans(packBalance)}
            </Text>
          ) : (
            // Neutral while unresolved. Showing "0" would tell an existing buyer
            // their scans were gone.
            <View style={s.balanceSkeleton}><Skeleton width={104} height={30} radius={6} /></View>
          )}
          <Text style={s.balanceUnit}>PACK SCANS</Text>
        </View>

        <Text style={s.rule}>
          Pack Scans never expire and are used after your included scans.
        </Text>

        {!!notice && (
          <View
            style={[
              s.notice,
              notice.tone === 'error' ? s.noticeError : notice.tone === 'success' ? s.noticeSuccess : s.noticeInfo,
            ]}
            accessibilityLiveRegion="polite"
          >
            <MaterialIcons
              name={notice.tone === 'error' ? 'error-outline' : notice.tone === 'success' ? 'check-circle-outline' : 'info-outline'}
              size={14}
              color={notice.tone === 'error' ? '#9E3A2A' : FOREST}
            />
            <Text style={s.noticeText}>{notice.text}</Text>
          </View>
        )}

        <Text style={s.sectionLabel}>CHOOSE A SCAN PACK</Text>

        {/* ── Catalog ──────────────────────────────────────────────────── */}
        {products?.status === 'error' && !loadingProducts ? (
          <View style={s.errorCard}>
            <Text style={s.errorText}>Scan Store is temporarily unavailable.</Text>
            <Pressable
              onPress={() => setAttempt(n => n + 1)}
              accessibilityRole="button"
              accessibilityLabel="Retry loading the Scan Store"
              style={({ pressed }) => [s.retryBtn, pressed && { opacity: 0.75 }]}
            >
              <Text style={s.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : (
          SCAN_PACKS.map(pack => {
            const pricing = pricingBySku.get(pack.sku) ?? null;
            const available = !loadingProducts && !!pricing?.priceString;
            return (
              <PackCard
                key={pack.sku}
                name={pack.name}
                scans={pack.scans}
                priceString={pricing?.priceString ?? null}
                loading={loadingProducts}
                available={available}
                bestValue={bestValue === pack.sku}
                busy={busy}
                active={activeSku === pack.sku}
                phase={phase}
                onBuy={() => void buy(pack.sku)}
              />
            );
          })
        )}

        {/* ── Recovery + footer ────────────────────────────────────────── */}
        <Pressable
          onPress={() => void recover()}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Recover Scan Purchases"
          accessibilityState={{ disabled: busy, busy: phase === 'recovering' }}
          hitSlop={12}
          style={({ pressed }) => [s.recoverBtn, busy && { opacity: 0.45 }, pressed && !busy && { opacity: 0.65 }]}
        >
          <Text style={s.recoverText}>
            {phase === 'recovering' ? 'Checking…' : 'Recover Scan Purchases'}
          </Text>
        </Pressable>

        <Text style={s.footer}>
          Scan Packs add scan quantity only and do not unlock FlipStart Pro.
        </Text>
      </ScrollView>
    </View>
  );
}

/**
 * One catalog card.
 *
 * Quantity is the largest thing on it. The names are a joke and the price is
 * the cost, but what the user is buying is SCANS — so that is what leads.
 */
function PackCard({
  name, scans, priceString, loading, available, bestValue, busy, active, phase, onBuy,
}: {
  name: string; scans: number; priceString: string | null;
  loading: boolean; available: boolean; bestValue: boolean;
  busy: boolean; active: boolean; phase: Phase; onBuy: () => void;
}) {
  const working = active && (phase === 'purchasing' || phase === 'granting');
  const label = `${name}, ${formatScans(scans)} scans${priceString ? `, ${priceString}` : ''}`;

  return (
    <View style={[s.card, bestValue && s.cardBest]}>
      <View style={s.cardLeft}>
        <View style={s.nameRow}>
          <Text style={s.packName}>{name}</Text>
          {bestValue && (
            <View style={s.badge}>
              <Text style={s.badgeText} allowFontScaling={false}>BEST VALUE</Text>
            </View>
          )}
        </View>
        <Text style={s.packScans}>{formatScans(scans)} SCANS</Text>
        {loading ? (
          <View style={s.priceSkeleton}><Skeleton width={62} height={15} radius={4} /></View>
        ) : (
          <Text style={s.packPrice}>{priceString ?? 'Currently unavailable'}</Text>
        )}
      </View>

      <Pressable
        onPress={onBuy}
        disabled={!available || busy}
        accessibilityRole="button"
        accessibilityLabel={working ? `Adding ${formatScans(scans)} scans` : `Buy ${label}`}
        accessibilityState={{ disabled: !available || busy, busy: working }}
        style={({ pressed }) => [
          s.buyBtn,
          (!available || busy) && { opacity: 0.4 },
          pressed && available && !busy && { opacity: 0.85 },
        ]}
      >
        {working ? (
          <>
            <ActivityIndicator size="small" color={CREAM} />
            <Text style={s.buyBusyText}>Adding scans…</Text>
          </>
        ) : (
          <Text style={s.buyText}>Buy</Text>
        )}
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: PARCHMENT },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 10,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: FONTS.serif, fontSize: 20, fontWeight: '800', color: INK },

  scroll: { paddingHorizontal: 18, gap: 12 },

  subtitle: { fontSize: 14, lineHeight: 20, color: BROWN, textAlign: 'center', paddingHorizontal: 8 },

  balanceCard: {
    alignItems: 'center', gap: 2, marginTop: 4,
    backgroundColor: CARD, borderRadius: 14, borderWidth: 1.25, borderColor: BORDER,
    paddingVertical: 14,
  },
  balanceLabel: {
    fontFamily: FONTS.serif, fontSize: 9.5, fontWeight: '800',
    letterSpacing: 1.8, color: BROWN,
  },
  balanceValue: { fontFamily: FONTS.serif, fontSize: 34, fontWeight: '800', color: FOREST, lineHeight: 40 },
  balanceSkeleton: { height: 40, justifyContent: 'center' },
  balanceUnit: { fontFamily: FONTS.serif, fontSize: 10, fontWeight: '800', letterSpacing: 1.6, color: BROWN },

  rule: { fontSize: 11.5, lineHeight: 16, color: BROWN, textAlign: 'center', paddingHorizontal: 10 },

  notice: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9,
  },
  noticeInfo:    { backgroundColor: GOLD_TINT, borderColor: 'rgba(196,163,52,0.45)' },
  noticeSuccess: { backgroundColor: '#EDF3EC', borderColor: 'rgba(33,77,45,0.30)' },
  noticeError:   { backgroundColor: '#F7E9E4', borderColor: '#E3B8B4' },
  noticeText:    { flex: 1, fontSize: 12, lineHeight: 17, color: BROWN, fontWeight: '600' },

  sectionLabel: {
    fontFamily: FONTS.serif, fontSize: 11, fontWeight: '800',
    letterSpacing: 2, color: BROWN, textAlign: 'center', marginTop: 4,
  },

  card: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12,
    backgroundColor: CARD, borderRadius: 14, borderWidth: 1.25, borderColor: BORDER,
    paddingVertical: 12, paddingHorizontal: 14,
  },
  /** Gold outline only. The badge already says it — tinting too would shout. */
  cardBest: { borderColor: GOLD, borderWidth: 1.8 },

  cardLeft: { flex: 1, gap: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  packName: { fontFamily: FONTS.serif, fontSize: 13, fontWeight: '800', color: FOREST, letterSpacing: 0.3 },
  /** The largest thing on the card: it is what they are actually buying. */
  packScans: { fontFamily: FONTS.serif, fontSize: 19, fontWeight: '800', color: INK, lineHeight: 24 },
  packPrice: { fontSize: 13, fontWeight: '700', color: BROWN },
  priceSkeleton: { height: 18, justifyContent: 'center' },

  badge: {
    paddingHorizontal: 6, paddingVertical: 1.5, borderRadius: 3,
    borderWidth: 0.9, borderColor: GOLD, backgroundColor: GOLD_TINT,
  },
  /** Brown on the gold wash — gold on gold would be about 1.3:1. */
  badgeText: { fontFamily: FONTS.serif, fontSize: 7.5, fontWeight: '800', letterSpacing: 1, color: BROWN },

  buyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: FOREST, borderRadius: 50,
    minHeight: 44, minWidth: 84, paddingHorizontal: 18, justifyContent: 'center',
  },
  buyText: { fontFamily: FONTS.serif, fontSize: 15, fontWeight: '800', color: CREAM },
  buyBusyText: { fontSize: 11.5, fontWeight: '700', color: CREAM },

  errorCard: {
    alignItems: 'center', gap: 12,
    backgroundColor: CARD, borderRadius: 14, borderWidth: 1.25, borderColor: BORDER,
    paddingVertical: 22, paddingHorizontal: 16,
  },
  errorText: { fontSize: 13.5, color: BROWN, textAlign: 'center' },
  retryBtn: {
    borderRadius: 50, borderWidth: 1.4, borderColor: FOREST,
    paddingVertical: 9, paddingHorizontal: 26, backgroundColor: CARD,
  },
  retryText: { fontFamily: FONTS.serif, fontSize: 14, fontWeight: '800', color: FOREST },

  recoverBtn: { alignSelf: 'center', paddingVertical: 8, paddingHorizontal: 14, marginTop: 6 },
  recoverText: { fontFamily: FONTS.serif, fontSize: 13.5, fontWeight: '700', color: BROWN },

  footer: {
    fontSize: 10.5, lineHeight: 15, color: BROWN,
    textAlign: 'center', paddingHorizontal: 12, opacity: 0.92,
  },
});
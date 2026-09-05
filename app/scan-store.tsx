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
 *
 * ── The redesign ────────────────────────────────────────────────────────────
 * Presentation only. Every hook, effect and callback above the JSX is the
 * live-validated Phase 3 code, byte for byte. What changed is what the user
 * sees: the paywalls' masthead brand row over a large serif title; a balance
 * card with real presence (seal, ruled figure, "fuel your next find"); the
 * catalogue heading in the paywalls' ✦-rule language; five compact cards each
 * with a tier seal — sprout, rocket, star, crown, diamond — a serif name, a
 * tracked scan count, the live price and a gold-trimmed forest Buy pill; the
 * best-value card lit in gold; and the two sentences that keep this honest
 * (never expire / does not unlock Pro) each given an icon and a clear seat.
 *
 * ── Gold means "best pack value", and only that ─────────────────────────────
 * The tier progression is carried entirely by the icon. Gold — border, seal,
 * inner rule, badge — is applied by `bestValue`, which is computed from live
 * prices (lib/scanPackCatalog.ts), never by pack name. If pricing changed so
 * FlipPro won, FlipPro would go gold and FlipGod would not. One signal, one
 * meaning.
 *
 * ── Motion ──────────────────────────────────────────────────────────────────
 * One entrance through the paywalls' shared reveal: balance card, heading,
 * then the five cards in order. Then still, except a slow glint across the
 * best-value seal on the masthead's 11s cadence. Reduce Motion renders the
 * finished screen.
 */
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator, InteractionManager,
  AccessibilityInfo,
} from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, withDelay, withSequence, withRepeat,
  Easing, interpolate,
} from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { FONTS } from '@/constants/typography';
import { Skeleton } from '@/components/monetization/Skeleton';
import { Spark } from '@/components/monetization/paywall/PaywallMasthead';
import { Reveal, useHeroReveal } from '@/components/monetization/paywall/HeroReveal';
import { PW, PW_RADIUS, PW_SHADOW } from '@/components/monetization/paywall/paywallTheme';
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

type Phase = 'idle' | 'purchasing' | 'granting' | 'recovering';

/**
 * Tier identity, smallest to largest: sprout, rocket, star, crown, diamond.
 * Keyed by SKU so a reorder of the catalogue cannot shuffle the icons.
 */
type TierGlyph = 'eco' | 'rocket-launch' | 'star' | 'crown' | 'diamond';
const TIER_GLYPH: Record<PackSku, TierGlyph> = {
  flipstart_scan_pack_40:   'eco',
  flipstart_scan_pack_110:  'rocket-launch',
  flipstart_scan_pack_300:  'star',
  flipstart_scan_pack_700:  'crown',
  flipstart_scan_pack_1200: 'diamond',
};

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
   * this app. A badge claiming BEST PACK VALUE when it is no longer true is a
   * false claim about money, so the helper refuses on any incomplete or
   * mixed-currency set rather than guessing.
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

  // ── Entrance ──────────────────────────────────────────────────────────────
  const { progress } = useHeroReveal();

  return (
    <View style={s.root}>
      {/* ── Masthead row: back, brand, spacer ─────────────────────────── */}
      <View style={[s.header, { paddingTop: Math.max(insets.top, 20) + 6 }]}>
        <Pressable
          onPress={goBack}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={({ pressed }) => [s.backBtn, pressed && { opacity: 0.6 }]}
        >
          <MaterialIcons name="arrow-back" size={20} color={PW.forest} />
        </Pressable>

        {/* The paywalls' brand row, exactly: two sparks and the wordmark. */}
        <View style={s.brandRow} accessibilityRole="header" accessibilityLabel="FlipStart">
          <Spark size={13} />
          <Text style={s.brand} allowFontScaling={false}>FLIPSTART</Text>
          <Spark size={13} />
        </View>

        <View style={s.backBtn} />
      </View>

      <ScrollView
        contentContainerStyle={[s.scroll, { paddingBottom: Math.max(insets.bottom, 16) + 28 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={s.headerTitle}>Scan Store</Text>
        <Text style={s.subtitle}>Stock up on extra scans whenever you need them.</Text>

        {/* ── Balance ──────────────────────────────────────────────────── */}
        <Reveal progress={progress} at={0} span={0.4} dy={8}>
          <View style={s.balanceCard}>
            <View pointerEvents="none" style={s.balanceInnerRule} />

            <View style={s.balanceSeal}>
              <MaterialIcons name="style" size={26} color={PW.forest} />
            </View>

            <View style={s.balanceCenter}>
              <Text style={s.balanceLabel} allowFontScaling={false}>YOUR PACK BALANCE</Text>
              <View style={s.balanceRuleRow}>
                <View style={s.balanceRule} />
                <Spark size={8} />
                <View style={s.balanceRule} />
              </View>
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
              <Text style={s.balanceUnit} allowFontScaling={false}>PACK SCANS</Text>
            </View>

            <View style={s.balanceDivider} />
            <Text style={s.balanceMotto} allowFontScaling={false}>FUEL{'\n'}YOUR{'\n'}NEXT{'\n'}FIND</Text>
          </View>
        </Reveal>

        <View style={s.ruleRow}>
          <MaterialIcons name="all-inclusive" size={13} color={PW.gold} />
          <Text style={s.rule}>
            Pack Scans never expire and are used after your included scans.
          </Text>
        </View>

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
              color={notice.tone === 'error' ? PW.error : PW.forest}
            />
            <Text style={s.noticeText}>{notice.text}</Text>
          </View>
        )}

        {/* ── Catalogue heading: the paywalls' ✦-rule language ─────────── */}
        <Reveal progress={progress} at={0.15} span={0.4} dy={4}>
          <View style={s.sectionRow}>
            <Text style={s.sectionSpark}>✦</Text>
            <View style={s.sectionRule} />
            <Text style={s.sectionLabel} accessibilityRole="header">CHOOSE A SCAN PACK</Text>
            <View style={s.sectionRule} />
            <Text style={s.sectionSpark}>✦</Text>
          </View>
        </Reveal>

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
          SCAN_PACKS.map((pack, i) => {
            const pricing = pricingBySku.get(pack.sku) ?? null;
            const available = !loadingProducts && !!pricing?.priceString;
            return (
              <Reveal key={pack.sku} progress={progress} at={0.25 + i * 0.08} span={0.4} dy={10}>
                <PackCard
                  name={pack.name}
                  scans={pack.scans}
                  glyph={TIER_GLYPH[pack.sku]}
                  priceString={pricing?.priceString ?? null}
                  loading={loadingProducts}
                  available={available}
                  bestValue={bestValue === pack.sku}
                  busy={busy}
                  active={activeSku === pack.sku}
                  phase={phase}
                  onBuy={() => void buy(pack.sku)}
                />
              </Reveal>
            );
          })
        )}

        {/* ── The sentence that prevents the expensive misunderstanding ─── */}
        <View style={s.footerRow}>
          <MaterialIcons name="info-outline" size={13} color={PW.brown} />
          <Text style={s.footer}>
            Scan Packs add scan quantity only and do not unlock FlipStart Pro.
          </Text>
        </View>

        {/* ── Recovery: consumables are recovered, not restored ──────────── */}
        <View style={s.recoverRow}>
          <View style={s.recoverRule} />
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
          <View style={s.recoverRule} />
        </View>
      </ScrollView>
    </View>
  );
}

/**
 * One catalogue card.
 *
 * Seal, name over a tracked scan count, the live price, and a Buy pill. The
 * name is the serif headline and the count is the strong line under it — the
 * reference's hierarchy — with the price the largest figure on the row, since
 * it is the one thing a buyer compares across cards.
 *
 * Gold on this card is `bestValue` and nothing else — see the file header.
 */
function PackCard({
  name, scans, glyph, priceString, loading, available, bestValue, busy, active, phase, onBuy,
}: {
  name: string; scans: number; glyph: TierGlyph; priceString: string | null;
  loading: boolean; available: boolean; bestValue: boolean;
  busy: boolean; active: boolean; phase: Phase; onBuy: () => void;
}) {
  const working = active && (phase === 'purchasing' || phase === 'granting');
  const label = `${name}, ${formatScans(scans)} scans${priceString ? `, ${priceString}` : ''}`;

  return (
    <View style={[s.card, bestValue && s.cardBest]}>
      {bestValue && <View pointerEvents="none" style={s.cardInnerRule} />}

      <TierSeal glyph={glyph} gold={bestValue} />

      <View style={s.cardText}>
        <Text style={s.packName} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
          {name}
        </Text>
        {bestValue && (
          <View style={s.badge}>
            <Text style={s.badgeText} allowFontScaling={false}>BEST PACK VALUE</Text>
          </View>
        )}
        <Text style={s.packScans} allowFontScaling={false}>{formatScans(scans)} SCANS</Text>
      </View>

      {loading ? (
        <View style={s.priceSkeleton}><Skeleton width={56} height={22} radius={5} /></View>
      ) : (
        <Text
          style={[s.packPrice, !priceString && s.packPriceUnavailable]}
          numberOfLines={priceString ? 1 : 2}
          adjustsFontSizeToFit={!!priceString}
          minimumFontScale={0.8}
        >
          {priceString ?? 'Currently unavailable'}
        </Text>
      )}

      <Pressable
        onPress={onBuy}
        disabled={!available || busy}
        accessibilityRole="button"
        accessibilityLabel={working ? `Adding ${formatScans(scans)} scans` : `Buy ${label}`}
        accessibilityState={{ disabled: !available || busy, busy: working }}
        style={({ pressed }) => [
          s.buyBtn,
          (!available || busy) && s.buyBtnInert,
          pressed && available && !busy && { opacity: 0.85 },
        ]}
      >
        <View pointerEvents="none" style={s.buyTrim} />
        {working ? (
          <>
            <ActivityIndicator size="small" color={PW.cream} />
            <Text style={s.buyBusyText}>Adding scans…</Text>
          </>
        ) : (
          <>
            <Text style={s.buyText}>Buy</Text>
            <MaterialIcons name="chevron-right" size={17} color={PW.cream} style={s.buyChevron} />
          </>
        )}
      </Pressable>
    </View>
  );
}

/**
 * The tier seal: a forest glyph in a faint ring, the same ring the benefits
 * strip uses. Gold when — and only when — the card is the best pack value,
 * with a slow glint on the masthead's cadence.
 */
function TierSeal({ glyph, gold }: { glyph: TierGlyph; gold: boolean }) {
  const color = gold ? PW.gold : PW.forest;
  return (
    <View style={[s.seal, gold && s.sealGold]}>
      {glyph === 'crown' ? (
        <Crown size={20} color={color} />
      ) : (
        <MaterialIcons name={glyph} size={20} color={color} />
      )}
      {gold && <SealGlint />}
    </View>
  );
}

/** MaterialIcons has no crown. A five-point one, drawn to match the icon weight. */
function Crown({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M3 17.5 L4.4 6.8 L9 11.8 L12 4.2 L15 11.8 L19.6 6.8 L21 17.5 Z" fill={color} />
      <Rect x="3" y="18.8" width="18" height="2.4" rx="1.2" fill={color} />
    </Svg>
  );
}

/** Slow gold pass across the best-value seal. 11s, like the masthead; off under Reduce Motion. */
const GLINT_PERIOD_MS = 11000;
const GLINT_PASS_MS = 1200;
function SealGlint() {
  const uid = useId().replace(/:/g, '');
  const id = `sealGlint-${uid}`;
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
  }, []);
  const pass = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) { pass.value = 0; return; }
    pass.value = 0;
    pass.value = withDelay(3000, withRepeat(
      withSequence(
        withTiming(1, { duration: GLINT_PASS_MS, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 0 }),
        withDelay(GLINT_PERIOD_MS - GLINT_PASS_MS, withTiming(0, { duration: 0 })),
      ), -1, false,
    ));
  }, [reduceMotion, pass]);
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(pass.value, [0, 0.15, 0.85, 1], [0, 0.85, 0.85, 0]),
    transform: [{ translateX: interpolate(pass.value, [0, 1], [-30, 50]) }],
  }));
  if (reduceMotion) return null;
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
      <Svg width={20} height="100%">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0"   stopColor={PW.gold} stopOpacity="0" />
            <Stop offset="0.5" stopColor="#FFF4C8" stopOpacity="0.8" />
            <Stop offset="1"   stopColor={PW.gold} stopOpacity="0" />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: PW.parchment },

  // ── Masthead row ─────────────────────────────────────────────────────────
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 6,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(33,77,45,0.35)',
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  /** The masthead's wordmark: 19/800, tracked 5, forest. */
  brand: { fontFamily: FONTS.serif, fontSize: 19, fontWeight: '800', letterSpacing: 5, color: PW.forest },

  scroll: { paddingHorizontal: 18, gap: 12 },

  /** The screen title, set like a paywall headline. */
  headerTitle: {
    fontFamily: FONTS.serif, fontSize: 32, fontWeight: '800', color: PW.ink,
    textAlign: 'center', lineHeight: 36, marginTop: -2,
  },
  subtitle: {
    fontSize: 14, lineHeight: 19, color: PW.brown, textAlign: 'center',
    paddingHorizontal: 8, marginTop: -6, fontWeight: '500',
  },

  // ── Balance card ─────────────────────────────────────────────────────────
  balanceCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: PW.card, borderRadius: PW_RADIUS.card,
    borderWidth: 1.25, borderColor: PW.border,
    paddingVertical: 13, paddingHorizontal: 14,
    overflow: 'hidden',
    shadowColor: PW.forest, shadowOpacity: 0.09, shadowRadius: 12, shadowOffset: { width: 0, height: 5 },
    elevation: 3,
  },
  /** The hairline just inside the edge — the selected plan card's detail. */
  balanceInnerRule: {
    position: 'absolute', top: 3, left: 3, right: 3, bottom: 3,
    borderRadius: PW_RADIUS.card - 3, borderWidth: 1, borderColor: 'rgba(196,163,52,0.40)',
  },
  balanceSeal: {
    width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(33,77,45,0.07)', borderWidth: 1, borderColor: 'rgba(33,77,45,0.22)',
  },
  balanceCenter: { flex: 1, alignItems: 'center', gap: 2 },
  balanceLabel: {
    fontFamily: FONTS.serif, fontSize: 9.5, fontWeight: '800',
    letterSpacing: 1.8, color: PW.brown,
  },
  balanceRuleRow: { flexDirection: 'row', alignItems: 'center', gap: 5, width: 96, marginTop: 1 },
  balanceRule: { flex: 1, height: 1, backgroundColor: 'rgba(196,163,52,0.55)' },
  balanceValue: { fontFamily: FONTS.serif, fontSize: 36, fontWeight: '800', color: PW.forest, lineHeight: 40 },
  balanceSkeleton: { height: 40, justifyContent: 'center' },
  balanceUnit: { fontFamily: FONTS.serif, fontSize: 10, fontWeight: '800', letterSpacing: 1.6, color: PW.brown },
  balanceDivider: { width: 1, alignSelf: 'stretch', marginVertical: 4, backgroundColor: 'rgba(196,163,52,0.45)' },
  balanceMotto: {
    width: 44, fontFamily: FONTS.serif, fontSize: 8.5, lineHeight: 12.5, fontWeight: '800',
    letterSpacing: 1.4, color: PW.brown, opacity: 0.85,
  },

  ruleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 6, marginTop: -2 },
  rule: { fontSize: 11.5, lineHeight: 16, color: PW.brown, textAlign: 'center', flexShrink: 1 },

  // ── Notice ───────────────────────────────────────────────────────────────
  notice: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9,
  },
  noticeInfo:    { backgroundColor: PW.goldTint, borderColor: 'rgba(196,163,52,0.45)' },
  noticeSuccess: { backgroundColor: '#EDF3EC', borderColor: 'rgba(33,77,45,0.30)' },
  noticeError:   { backgroundColor: PW.errorTint, borderColor: PW.errorBorder },
  noticeText:    { flex: 1, fontSize: 12, lineHeight: 17, color: PW.brown, fontWeight: '600' },

  // ── Section heading (the PlanSelector's) ─────────────────────────────────
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 2, marginTop: 2 },
  sectionRule: { flex: 1, height: 1, backgroundColor: 'rgba(196,163,52,0.55)' },
  sectionSpark: { color: PW.gold, fontSize: 11 },
  sectionLabel: {
    fontFamily: FONTS.serif, fontSize: 11, fontWeight: '800',
    letterSpacing: 2, color: PW.brown, textAlign: 'center', marginBottom: 2,
  },

  // ── Pack cards ───────────────────────────────────────────────────────────
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: PW.card, borderRadius: PW_RADIUS.card,
    borderWidth: 1.25, borderColor: PW.border,
    paddingVertical: 11, paddingHorizontal: 12,
    overflow: 'hidden',
    ...PW_SHADOW,
  },
  /** Gold outline, warm glow, white interior — the selected-plan grammar. */
  cardBest: {
    borderColor: PW.gold, borderWidth: 1.8,
    shadowColor: PW.gold, shadowOpacity: 0.20, shadowRadius: 12, shadowOffset: { width: 0, height: 5 },
    elevation: 4,
  },
  cardInnerRule: {
    position: 'absolute', top: 3, left: 3, right: 3, bottom: 3,
    borderRadius: PW_RADIUS.card - 3, borderWidth: 1, borderColor: 'rgba(196,163,52,0.45)',
  },

  seal: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(33,77,45,0.07)', borderWidth: 1, borderColor: 'rgba(33,77,45,0.22)',
    overflow: 'hidden',
  },
  sealGold: { backgroundColor: PW.goldTint, borderColor: PW.gold },

  cardText: { flex: 1, minWidth: 0, gap: 2 },
  /** The serif headline of the card. */
  packName: { fontFamily: FONTS.serif, fontSize: 17, fontWeight: '800', color: PW.ink, lineHeight: 21 },
  /** Strong and tracked, not a footnote: it is what they are buying. */
  packScans: { fontFamily: FONTS.serif, fontSize: 12, fontWeight: '800', letterSpacing: 1.6, color: PW.ink, opacity: 0.85 },
  /** The largest figure on the row — the thing a buyer compares. */
  packPrice: { fontFamily: FONTS.serif, fontSize: 19, fontWeight: '800', color: PW.ink, textAlign: 'right', maxWidth: 88 },
  packPriceUnavailable: { fontFamily: undefined, fontSize: 10.5, lineHeight: 13, fontWeight: '600', color: PW.brown, maxWidth: 72 },
  priceSkeleton: { height: 22, justifyContent: 'center' },

  badge: {
    alignSelf: 'flex-start', paddingHorizontal: 6, paddingVertical: 1.5, borderRadius: 3,
    borderWidth: 0.9, borderColor: PW.gold, backgroundColor: PW.goldTint,
  },
  /** Brown on the gold wash — gold on gold would be about 1.3:1. */
  badgeText: { fontFamily: FONTS.serif, fontSize: 7.5, fontWeight: '800', letterSpacing: 1, color: PW.brown },

  buyBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2,
    backgroundColor: PW.forest, borderRadius: PW_RADIUS.pill,
    minHeight: 44, minWidth: 80, paddingLeft: 16, paddingRight: 11,
    overflow: 'hidden',
    shadowColor: PW.forestDeep, shadowOpacity: 0.22, shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  buyBtnInert: { opacity: 0.4, shadowOpacity: 0, elevation: 0 },
  /** Gold hairline just inside the pill — the purchase CTA's trim, at pill scale. */
  buyTrim: {
    position: 'absolute', top: 2.5, left: 2.5, right: 2.5, bottom: 2.5,
    borderRadius: PW_RADIUS.pill - 2.5, borderWidth: 1, borderColor: 'rgba(212,180,84,0.55)',
  },
  buyText: { fontFamily: FONTS.serif, fontSize: 15, fontWeight: '800', color: PW.cream },
  buyChevron: { marginTop: 1, opacity: 0.9 },
  buyBusyText: { fontSize: 11.5, fontWeight: '700', color: PW.cream, marginLeft: 6 },

  // ── Error ────────────────────────────────────────────────────────────────
  errorCard: {
    alignItems: 'center', gap: 12,
    backgroundColor: PW.card, borderRadius: PW_RADIUS.card, borderWidth: 1.25, borderColor: PW.border,
    paddingVertical: 22, paddingHorizontal: 16,
  },
  errorText: { fontSize: 13.5, color: PW.brown, textAlign: 'center' },
  retryBtn: {
    borderRadius: PW_RADIUS.pill, borderWidth: 1.4, borderColor: PW.forest,
    paddingVertical: 9, paddingHorizontal: 26, backgroundColor: PW.card,
  },
  retryText: { fontFamily: FONTS.serif, fontSize: 14, fontWeight: '800', color: PW.forest },

  // ── Footer + recovery ────────────────────────────────────────────────────
  footerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 8, marginTop: 2 },
  footer: { fontSize: 11, lineHeight: 15, color: PW.brown, textAlign: 'center', flexShrink: 1, fontWeight: '500' },

  recoverRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 30, marginTop: 2 },
  recoverRule: { flex: 1, height: 1, backgroundColor: 'rgba(196,163,52,0.55)' },
  recoverBtn: { paddingVertical: 8, paddingHorizontal: 4 },
  recoverText: { fontFamily: FONTS.serif, fontSize: 13.5, fontWeight: '700', color: PW.forest },
});
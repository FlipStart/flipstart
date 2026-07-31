/**
 * results.tsx — Analysis screen (fast decision engine)
 *
 * Structure: Identity → Decision → Quick Summary → Why This Rating
 *            → Deep Analysis CTA → Market Value → Your Price → Actions
 */

import {
  Text, View, ScrollView, Pressable, Platform, Modal, Animated,
  StyleSheet, TextInput, Alert, KeyboardAvoidingView, Clipboard, BackHandler,
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useState, useMemo, useEffect, useRef, useCallback } from 'react';

import { ScreenContainer } from '@/components/screen-container';
import { useScanContext } from '@/lib/scan-context';
import { isHuntActive, addItemToHunt, computeHuntRating, getActiveHunt, updateHuntItemImage } from '@/lib/hunt-context';
import { uploadImageToStorage, isRemoteUri } from '@/lib/imageUpload';
import { recordSuccessfulScan, onMaybeLater, onDontAskAgain, onRequestedReview, requestAppStoreReview, openAppStoreReviewPage } from '@/lib/reviewPrompt';
import { FeedbackCard } from '@/components/results/FeedbackCard';
import { useFlipStore } from '@/lib/useFlipStore';
import { trpc } from '@/lib/trpc';
import { FlipResult, isHuntBundle } from '@/types/flip';
import { FONTS } from '@/constants/typography';
import { MajorAchievementModal } from '@/lib/MajorAchievementModal';
import {
  hasShownMajorAchievement,
  markMajorAchievementShown,
  type MajorAchievementType,
} from '@/lib/majorAchievementStorage';
import { BrandRevealModal } from '@/lib/BrandRevealModal';
import {
  getBrandByName,
  computeDiscoveredBrands,
  getRevealedBrandNames,
  markBrandRevealed,
  TOTAL_SUPPORTED_BRANDS,
  type Brand,
} from '@/lib/brandCompendium';

// ─── Reward queue type ────────────────────────────────────────────────────────
type QueuedReward =
  | { kind: 'brand'; brand: Brand; totalDiscovered: number }
  | { kind: 'achievement'; achievementType: MajorAchievementType };
import { setDiscoveryMeta } from '@/lib/devBrandOverrides';
import { useAchievementNotifications } from '@/lib/AchievementNotificationContext';
import { useAuth } from '@/lib/auth-context';
import { trackAnalyticsEvent } from '@/lib/analytics';
import { computeFlipCalc, findMaxBuyPriceForRating, resolveEffectiveThriftPrice, findBuyThresholdPrice } from '@/utils/flipCalculations';
import { REC_THEMES } from '@/utils/recommendation';
import { normalizeBuyRating } from '@/utils/recommendation';
import PoshmarkLogo from '@/components/logos/PoshmarkLogo';

// ─── Listings helper ─────────────────────────────────────────────────────────

/**
 * Returns true ONLY if listing content has real non-empty text.
 * Empty strings, null, undefined, or missing fields all return false.
 */
function hasGeneratedListings(listings: { ebay?: { title?: string; description?: string } | null; depop?: { title?: string; description?: string } | null } | null | undefined): boolean {
  if (!listings) return false;
  const ebayOk  = !!(listings.ebay?.title?.trim()  || listings.ebay?.description?.trim());
  const depopOk = !!(listings.depop?.title?.trim() || listings.depop?.description?.trim());
  return ebayOk || depopOk;
}

// ─── Palette ──────────────────────────────────────────────────────────────────
const BG     = '#FFFFFF';
const CARD   = '#FFFEFA';
const CARD_B = '#DDD2AC';
const FOREST = '#2A4A2A';
const BROWN  = '#5A3A1A';
const MUTED  = '#8A7050';
const GOLD   = '#BE9C2C';
const CREAM  = '#F4EED8';

// ─── Sold Comp Sources config ─────────────────────────────────────────────────
// PLACEHOLDER marketplaces (no live data yet). eBay shows logo only; the rest
// show logo + name. Widths are set per-logo to preserve each one's aspect ratio
// at a shared height. Poshmark is a real SVG (rendered via PoshmarkLogo); the
// others are PNGs in assets/images/logos.
const COMP_LOGO_H = 16;
const COMP_SOURCES: {
  name: string;
  showText: boolean;
  png?: any;
  width?: number;     // for PNGs: width at COMP_LOGO_H
  svg?: 'poshmark';   // marks the SVG-component logo
}[] = [
  { name: 'eBay',     showText: false, png: require('@/assets/images/logos/ebay.png'),    width: 40 },
  { name: 'Depop',    showText: false,  png: require('@/assets/images/logos/depop.png'),   width: 62 },
  { name: 'Poshmark', showText: false,  svg: 'poshmark' },
  { name: 'Mercari',  showText: false,  png: require('@/assets/images/logos/mercari.png'), width: 64 },
  { name: 'Vinted',   showText: false,  png: require('@/assets/images/logos/vinted.png'),  width: 50 },
];


function confidenceLabel(conf: number): { text: string; color: string } {
  if (conf >= 85) return { text: 'Strong Match',   color: '#2A5A2A' };
  if (conf >= 60) return { text: 'Good Match',     color: '#7A5C1E' };
  if (conf >= 35) return { text: 'Low Confidence', color: '#8A4A1A' };
  return           { text: 'Uncertain',            color: '#6A2A2A' };
}

function buildWhyBullets(calc: ReturnType<typeof computeFlipCalc>, md: any, ra: any): string[] {
  const bullets: string[] = [];
  const demand = (md.demand ?? '').toLowerCase();
  const comp   = (md.competition_level ?? '').toLowerCase();
  const speed  = (md.sell_speed ?? '').toLowerCase();

  if (calc.profit < 0)               bullets.push('Costs exceed estimated resale value at this price');
  if (calc.profit >= 0 && calc.profit < 10) bullets.push(`Thin profit margin ($${calc.profit}) — low reward for risk`);
  if (calc.profit >= 10)             bullets.push(`Est. $${calc.profit} profit after platform fees`);
  if (md.average_sold_price)         bullets.push(`Average sold price is $${md.average_sold_price} on eBay`);
  if (comp === 'high')               bullets.push('High seller competition makes it harder to stand out');
  if (demand === 'low')              bullets.push('Buyer demand is currently low for this item type');
  if (demand === 'high')             bullets.push('High buyer demand — good chance of a fast sale');
  if (speed === 'slow')              bullets.push('Items like this tend to sit listed for a while');
  if (ra.match_confidence < 60 && ra.match_confidence > 0)
    bullets.push(`Confidence ${ra.match_confidence}% — estimate may vary from actual result`);

  return bullets.slice(0, 3);
}

const SUMMARY_ICONS: Record<string, string> = {
  'Est. Profit': 'attach-money',
  'ROI':         'show-chart',
  'Competition': 'group',
  'Sell Speed':  'speed',
};

// ─── Image Viewer Modal ───────────────────────────────────────────────────────

function ImageViewerModal({
  uri, visible, onClose,
}: { uri: string; visible: boolean; onClose: () => void }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={iv.backdrop} onPress={onClose}>
        <Pressable style={iv.closeBtn} onPress={onClose}>
          <MaterialIcons name="close" size={22} color={CREAM} />
        </Pressable>
        <Image
          source={{ uri }}
          style={iv.image}
          contentFit="contain"
          transition={200}
        />
      </Pressable>
    </Modal>
  );
}

const iv = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.92)',
    justifyContent: 'center', alignItems: 'center',
  },
  closeBtn: {
    position: 'absolute', top: 52, right: 20,
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center', alignItems: 'center',
  },
  image: { width: '90%', height: '75%' },
});

// ─── Listings Modal ───────────────────────────────────────────────────────────

function ListingsModal({
  visible, listings, onClose,
}: {
  visible: boolean;
  listings: { ebay?: { title: string; description: string } | null; depop?: { title: string; description: string } | null } | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (text: string, key: string) => {
    Clipboard.setString(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={lm.overlay} onPress={onClose} />
      <View style={lm.sheet}>
        <View style={lm.handle} />
        <View style={lm.sheetHeader}>
          <Text style={lm.sheetTitle}>Generated Listings</Text>
          <Pressable onPress={onClose} hitSlop={8}>
            <MaterialIcons name="close" size={22} color={FOREST} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
          {(['ebay', 'depop'] as const).map(platform => {
            const entry = listings?.[platform];
            if (!entry) return null;
            const titleKey = `${platform}_title`;
            const descKey  = `${platform}_desc`;
            return (
              <View key={platform} style={lm.platformBlock}>
                <Text style={lm.platformName}>{platform === 'ebay' ? 'eBay' : 'Depop'}</Text>

                <View style={lm.fieldWrap}>
                  <View style={lm.fieldHeader}>
                    <Text style={lm.fieldLabel}>TITLE</Text>
                    <Pressable onPress={() => copy(entry.title, titleKey)} style={lm.copyBtn}>
                      <MaterialIcons name={copied === titleKey ? 'check' : 'content-copy'} size={13} color={FOREST} />
                      <Text style={lm.copyBtnText}>{copied === titleKey ? 'Copied' : 'Copy'}</Text>
                    </Pressable>
                  </View>
                  <Text style={lm.fieldText} selectable>{entry.title}</Text>
                </View>

                <View style={lm.fieldWrap}>
                  <View style={lm.fieldHeader}>
                    <Text style={lm.fieldLabel}>DESCRIPTION</Text>
                    <Pressable onPress={() => copy(entry.description, descKey)} style={lm.copyBtn}>
                      <MaterialIcons name={copied === descKey ? 'check' : 'content-copy'} size={13} color={FOREST} />
                      <Text style={lm.copyBtnText}>{copied === descKey ? 'Copied' : 'Copy'}</Text>
                    </Pressable>
                  </View>
                  <Text style={lm.fieldText} selectable>{entry.description}</Text>
                </View>
              </View>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}

const lm = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.40)' },
  sheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: CARD, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    maxHeight: '80%', paddingHorizontal: 18, paddingBottom: 8,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: CARD_B, alignSelf: 'center', marginTop: 10, marginBottom: 6,
  },
  sheetHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: CARD_B, marginBottom: 12,
  },
  sheetTitle:    { fontFamily: FONTS.serif, fontSize: 18, fontWeight: '700', color: FOREST },
  platformBlock: { marginBottom: 20 },
  platformName:  { fontFamily: FONTS.serif, fontSize: 15, fontWeight: '700', color: FOREST, marginBottom: 10 },
  fieldWrap:     { backgroundColor: BG, borderRadius: 10, borderWidth: 1, borderColor: CARD_B, padding: 10, marginBottom: 8 },
  fieldHeader:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  fieldLabel:    { fontSize: 9, fontWeight: '700', color: MUTED, letterSpacing: 1 },
  fieldText:     { fontSize: 12, color: BROWN, lineHeight: 18 },
  copyBtn:       { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, borderWidth: 1, borderColor: CARD_B, backgroundColor: CARD },
  copyBtnText:   { fontSize: 10, fontWeight: '600', color: FOREST },
});

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ResultsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { currentScan, setCurrentScan, updateScan } = useScanContext();
  const { addFlip, updateFlip, removeFlip, flips, pendingThriftPrices, setPendingThriftPrice } = useFlipStore();
  const { addUnseenBrands } = useAchievementNotifications();
  const { user } = useAuth();

  const [thriftEditing,   setThriftEditing]   = useState(false);
  const [listingsLoading, setListingsLoading] = useState(false);
  const [listingsError,   setListingsError]   = useState(false);
  const [imageModalOpen,  setImageModalOpen]  = useState(false);
  const [listingsOpen,    setListingsOpen]    = useState(false);
  const [isSaved,         setIsSaved]         = useState(false);
  // ── Reward queue — ensures brand reveals + achievement celebrations never overlap ──
  // Priority: legendary brand first, then major achievements, then other brands.
  const [rewardQueue, setRewardQueue] = useState<QueuedReward[]>([]);
  const currentReward = rewardQueue[0] ?? null;

  const enqueueReward = useCallback((reward: QueuedReward) => {
    setRewardQueue(prev => {
      if (reward.kind === 'brand' && reward.brand.rarity === 'legendary') {
        // Legendary always jumps to the front
        return [reward, ...prev];
      }
      if (reward.kind === 'achievement') {
        // Major achievements go after any legendary brands
        const lastLeg = prev.reduce((idx, r, i) =>
          r.kind === 'brand' && r.brand.rarity === 'legendary' ? i : idx, -1);
        const insertAt = lastLeg + 1;
        return [...prev.slice(0, insertAt), reward, ...prev.slice(insertAt)];
      }
      return [...prev, reward];
    });
  }, []);

  const advanceQueue = useCallback(() => {
    setRewardQueue(prev => prev.slice(1));
  }, []);
  const [showReview,      setShowReview]      = useState(false);

  const generateListingsMutation = trpc.scan.generateListings.useMutation();

  // ── Derive values before any early return so all hooks run unconditionally ──
  // When currentScan is null these produce safe zero-defaults; the early
  // return below prevents them from ever reaching the JSX.
  // Use underscored optionals before the guard so useMemo can run unconditionally
  const _md = currentScan?.market_data;
  const _id = currentScan?.identification;
  const _ra = currentScan?.risk_analysis;

  const thriftPriceStr  = pendingThriftPrices[currentScan?.id ?? ''] ?? '';
  const parsedThrift    = parseFloat(thriftPriceStr) || 0;
  // Shared resolver — Deep Analysis calls the same function, so the two screens
  // can never rate the same item at different prices.
  const effectiveThrift = resolveEffectiveThriftPrice({
    entered:   parsedThrift > 0 ? parsedThrift : null,
    stored:    null,   // a fresh scan has no stored price yet
    suggested: _md?.suggested_buy_price ?? null,
  });

  // useMemo MUST be before any early return — fixes the "fewer hooks" crash
  const calc = useMemo(
    () => computeFlipCalc(
      _md?.adjusted_estimated_value ?? 0,
      effectiveThrift,
      _ra?.match_confidence ?? 0,
      _md?.competition_level ?? '',
      _id?.style_labels ?? [],
      _id?.estimated_era ?? '',
      _md?.demand ?? '',
      _md?.sell_speed ?? '',
      {
        buyerPool:        (_id as any)?.v1?.buyerPool,
        hasObviousDamage: ((_id as any)?.v1?.obviousDamage?.length ?? 0) > 0,
        eraUnconfirmed:   ((_id as any)?.v1?.eraStatus ?? '') === 'unknown',
      },
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [_md?.adjusted_estimated_value, effectiveThrift, _ra?.match_confidence,
     _md?.competition_level, _id?.style_labels, _id?.estimated_era,
     _md?.demand, _md?.sell_speed],
  );

  // backHandlerRef + BackHandler useEffect MUST also be before the early return.
  // The ref is updated below (after early return) where handleConfirm is accessible.
  // Using a ref ensures the BackHandler callback always calls the latest version
  // without needing to re-register the listener on every state change.
  const backHandlerRef = useRef<() => boolean>(() => true);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => backHandlerRef.current());
    return () => sub.remove();
  }, []);   // stable — ref is always current

  // ── Deep Analysis coach-mark (tooltip) ──────────────────────────────────────
  // Rules:
  //  • Shows on early scans until the user taps into Deep Analysis once.
  //  • The X hides it for the current scan only.
  //  • After they've used Deep Analysis, it stays hidden — UNLESS the user then
  //    does 5+ scans in a row WITHOUT opening Deep Analysis, in which case the
  //    tip returns until they tap Deep Analysis again (which resets the streak).
  // State is stored as one account-scoped JSON blob to avoid multiple reads.
  const DEEP_STREAK_THRESHOLD = 5;
  const deepTipKey = `@flipstart/deep_analysis_state:${user?.id ?? 'guest'}`;
  const [showDeepTip, setShowDeepTip] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(deepTipKey);
        const st = raw ? JSON.parse(raw) as { seen?: boolean; streak?: number; lastScanId?: string } : {};
        let streak = st.streak ?? 0;
        // Count this scan once (dedupe by scan id so re-renders don't inflate it).
        if (currentScan?.id && currentScan.id !== st.lastScanId) {
          streak += 1;
          await AsyncStorage.setItem(deepTipKey, JSON.stringify({ ...st, streak, lastScanId: currentScan.id }));
        }
        const shouldShow = !st.seen || streak >= DEEP_STREAK_THRESHOLD;
        if (alive) setShowDeepTip(shouldShow);
      } catch { /* if storage fails, just don't show the tip */ }
    })();
    return () => { alive = false; };
  }, [deepTipKey, currentScan?.id]);

  // ── Deep Analysis arrow glow ────────────────────────────────────────────────
  // Subtle pulsing gold aura on the "›" next to the title. Uses the JS driver
  // (textShadowRadius isn't native-driver animatable) — fine for one tiny
  // element pulsing slowly. Gives the arrow a soft "ember" flicker.
  const arrowGlow = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(arrowGlow, { toValue: 1, duration: 1100, useNativeDriver: false }),
        Animated.timing(arrowGlow, { toValue: 0, duration: 1100, useNativeDriver: false }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [arrowGlow]);
  const arrowShadowRadius = arrowGlow.interpolate({ inputRange: [0, 1], outputRange: [1, 9] });

  // ── Deferred navigation after save ──────────────────────────────────────────
  // The save flow shows reward modals (brand reveals + major-achievement
  // celebrations) and possibly a review prompt. Previously handleConfirm
  // navigated home immediately, unmounting the screen before the deferred
  // setTimeouts could enqueue/show those modals — so celebrations never
  // appeared. Now: detect rewards synchronously, stay on the screen while any
  // reward/review is showing, and navigate home only once the queue drains.
  const navPendingRef    = useRef(false);
  const reviewPendingRef = useRef(false);
  useEffect(() => {
    if (!navPendingRef.current) return;
    if (currentReward) return;             // a reward modal is still showing
    if (reviewPendingRef.current) {        // rewards done → show review now
      reviewPendingRef.current = false;
      setShowReview(true);
      return;
    }
    if (showReview) return;                // review modal showing → wait for button
    navPendingRef.current = false;         // nothing left → go home
    setCurrentScan(null);
    router.replace('/(tabs)' as any);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentReward, showReview]);

  // Early return AFTER all hooks — safe now
  if (!currentScan) {
    return (
      <ScreenContainer>
        <View style={s.emptyWrap}>
          <Text style={s.emptyText}>No scan data available.</Text>
          <Pressable onPress={() => router.replace('/(tabs)' as any)} style={s.emptyBtn}>
            <Text style={s.emptyBtnText}>Go Home</Text>
          </Pressable>
        </View>
      </ScreenContainer>
    );
  }

  // Past the guard — currentScan is non-null. Redeclare as concrete types.
  const md = currentScan.market_data;
  const id = currentScan.identification;
  const ra = currentScan.risk_analysis;

  const rec          = calc.recommendation;
  const theme        = REC_THEMES[rec.colorKey];
  const confBadge    = confidenceLabel(ra.match_confidence);
  const whyBullets   = rec.bullets;
  const profitColor = calc.profit >= 15 ? '#2A5A2A' : calc.profit >= 0 ? '#7A5C1E' : '#8A3A2A';

  // ── Derived display values for the redesigned analysis screen ──
  const fmtMoney = (n: number | null | undefined) => {
    const v = Math.round(Number(n) || 0);
    return `$${v.toLocaleString()}`;
  };
  const canonicalRating = normalizeBuyRating(rec.label);           // STRONG BUY / BUY / RISKY BUY / SKIP
  // For SKIP, the gold accent reads poorly — use white for the icon, label, and
  // EST. RESALE label instead. Other ratings keep gold.
  const ratingAccent = canonicalRating === 'SKIP' ? '#FFFFFF' : GOLD;
  // STRONG BUY is the longest label; shrink it so it fits on one line and never
  // wraps "STRONG" / "BUY" awkwardly. Other ratings keep the normal size.
  const ratingFontSize = canonicalRating === 'STRONG BUY' ? 19 : 22;
  const resaleValue     = md.adjusted_estimated_value ?? 0;
  // The highest price you can pay while the rating STAYS at BUY/STRONG_BUY.
  // Derived directly from the same recommendation engine that drives the rating
  // shown on screen — so it's never disconnected from what you actually see.
  // Paying more than this is guaranteed to downgrade the rating.
  const v1Sig = {
    buyerPool:        (_id as any)?.v1?.buyerPool,
    hasObviousDamage: ((_id as any)?.v1?.obviousDamage?.length ?? 0) > 0,
    eraUnconfirmed:   ((_id as any)?.v1?.eraStatus ?? '') === 'unknown',
  };
  // Ceiling: the most you should pay before this becomes a SKIP. Null when the
  // item is not worth buying at any price — rendered as words, never as $0.
  const suggestedMax = findMaxBuyPriceForRating(
    resaleValue, ra.match_confidence, md.competition_level ?? '', md.demand ?? '', md.sell_speed ?? '', v1Sig,
  );
  // Aspirational: the price at which it would become a solid BUY. Null when the
  // risk factors cap it below BUY at any price, which is common and fine.
  const buyThreshold = findBuyThresholdPrice(
    resaleValue, ra.match_confidence, md.competition_level ?? '', md.demand ?? '', md.sell_speed ?? '', v1Sig,
  );
  // The price actually used in the breakdown + shown in the editor. Defaults to
  // the AI's real per-item thrift-price estimate (from the scan itself) until
  // the user types their own — NOT the breakeven ceiling above, which is a
  // different number used only for the recommendation line below.
  const aiEstimatedPrice = Math.max(1, md.suggested_buy_price ?? 0);
  const maxBuy           = parsedThrift > 0 ? parsedThrift : aiEstimatedPrice;
  // True until the user edits the price — drives the "Est." label in the UI.
  const isEstimatedPrice = parsedThrift <= 0;
  const rangeStr        = (md.estimated_resale_range?.low != null && md.estimated_resale_range?.high != null)
    ? `${fmtMoney(md.estimated_resale_range.low)}–${fmtMoney(md.estimated_resale_range.high)}`
    : '—';
  // Dynamic recommendation line under the rating; falls back to the rec headline.
  // The line under the rating. It has to answer the question the rating raises,
  // and that differs by rating:
  //   SKIP        — why not
  //   RISKY BUY   — the ceiling, because there may be no price that makes it a
  //                 clean BUY and pretending otherwise produced "$1 or less"
  //   BUY/STRONG  — the price that keeps it a solid buy
  const buyLine = (() => {
    if (canonicalRating === 'SKIP') {
      return rec.headline || 'Not worth the risk at this price.';
    }
    if (suggestedMax === null || suggestedMax <= 0) {
      return 'Hard to make money on this one at any price.';
    }
    if (canonicalRating === 'RISKY BUY') {
      // Mention the BUY price only when one exists AND is meaningfully below
      // the ceiling — otherwise it is noise.
      return (buyThreshold !== null && buyThreshold > 0 && buyThreshold < suggestedMax - 1)
        ? `Pay ${fmtMoney(suggestedMax)} at most — a solid buy under ${fmtMoney(buyThreshold)}.`
        : `Pay ${fmtMoney(suggestedMax)} at most for this to be worth it.`;
    }
    return `Worth grabbing if you can buy at ${fmtMoney(suggestedMax)} or less.`;
  })();

  const haptic = (style: Haptics.ImpactFeedbackStyle) => {
    if (Platform.OS !== 'web') Haptics.impactAsync(style).catch(() => {});
  };

  const handleThriftChange = (text: string) => {
    if (/^\d*\.?\d*$/.test(text)) setPendingThriftPrice(currentScan.id, text);
  };

  const handleConfirm = async () => {
    if (isSaved) return;
    haptic(Haptics.ImpactFeedbackStyle.Medium);
    setIsSaved(true);
    const flip: FlipResult = {
      id: currentScan.id, imageUri: currentScan.imageUri, timestamp: Date.now(),
      itemName: id.item_name, brand: id.brand, category: id.category,
      era: id.estimated_era, styleLabels: id.style_labels, material: id.material_guess,
      // Carry v2 structured fields verbatim (undefined on older scans).
      structured: {
        v1:                    (id as any).v1,
        frontEvidence:         (id as any).frontEvidence,
        tagEvidence:           (id as any).tagEvidence,
        detailEvidence:        (id as any).detailEvidence,
        canonicalBrand:        id.canonicalBrand,
        canonicalItemName:     id.canonicalItemName,
        itemType:              id.itemType,
        subType:               id.subType,
        styleVariant:          id.styleVariant,
        modelName:             id.modelName,
        logoPlacement:         id.logoPlacement,
        eraEstimate:           id.eraEstimate,
        eraConfidence:         id.eraConfidence,
        eraEvidence:           id.eraEvidence,
        materialSignals:       id.materialSignals,
        graphicSignals:        id.graphicSignals,
        sportsTeam:            id.sportsTeam,
        league:                id.league,
        playerNumber:          id.playerNumber,
        playerNameGuess:       id.playerNameGuess,
        playerNameConfidence:  id.playerNameConfidence,
        brandModelSignals:     id.brandModelSignals,
        possibleDiamondIds:    id.possibleDiamondIds,
        diamondReasoningShort: id.diamondReasoningShort,
      },
      resaleValue: md.adjusted_estimated_value,
      resaleRangeLow: md.estimated_resale_range.low,
      resaleRangeHigh: md.estimated_resale_range.high,
      avgSoldPrice: md.average_sold_price,
      demand: md.demand, sellSpeed: md.sell_speed, competitionLevel: md.competition_level,
      matchConfidence: ra.match_confidence, riskFlags: ra.risk_flags,
      riskyBuyReasons: (ra as any).risky_buy_reasons ?? [],
      thriftPrice: calc.thriftPrice, fees: calc.fees, profit: calc.profit,
      roi: calc.roi, buyScore: calc.buyScore, buyLabel: calc.buyLabel,
      recommendation: calc.recommendation,
      // Explicit outcome status at save time: a user who TYPED a real price is
      // signaling a purchase; one riding the "Est." AI default merely scanned.
      status: isEstimatedPrice ? 'scanned' : 'bought',
      stars: calc.stars, bestPlatform: calc.bestPlatform,
      listingsGenerated: hasGeneratedListings(currentScan.listings),
      generatedAt: hasGeneratedListings(currentScan.listings) ? Date.now() : null,
      listingData: hasGeneratedListings(currentScan.listings)
        ? {
            ebay:  { title: currentScan.listings!.ebay.title,  description: currentScan.listings!.ebay.description  },
            depop: { title: currentScan.listings!.depop.title, description: currentScan.listings!.depop.description },
          }
        : null,
    };
    addFlip(flip);

    // Back up the scan photo to Supabase Storage so it survives logout/login
    // and reinstalls — local file:// paths never do. Non-blocking, guest-gated.
    // On success we swap the scan's imageUri to the cloud URL (persists via the
    // updateFlip sync fix) AND patch the staged hunt item (if a hunt is active)
    // so the hunt bundle later snapshots the durable URL, not the local path.
    if (user?.id && flip.imageUri && !isRemoteUri(flip.imageUri)) {
      const uid = user.id;
      const localUri = flip.imageUri;
      const flipId = flip.id;
      uploadImageToStorage(localUri, 'scan-photos', uid).then(cloudUrl => {
        if (!cloudUrl) return;
        updateFlip(flipId, { imageUri: cloudUrl });
        if (isHuntActive()) updateHuntItemImage(flipId, cloudUrl);
      }).catch(() => {});
    }

    trackAnalyticsEvent('scan_saved', {
      scan_id:         currentScan.id,
      brand:           flip.brand ?? null,
      category:        (flip as any).category ?? null,
      estimated_resale: (flip as any).profit ?? null,
      notes_present:   !!(flip as any).notes,
    });

    // Collect rewards locally so we know synchronously whether any exist, then
    // enqueue them. Navigation is deferred until the queue drains (see effect).
    const rewards: QueuedReward[] = [];

    // ── Brand discovery reveal ─────────────────────────────────────────────
    // Fires when this save introduces a brand never discovered before.
    // Works for both normal scans and items saved during a hunt (both go
    // through addFlip, so the brand lands in flips[] either way).
    try {
      const newBrand = getBrandByName(flip.brand ?? '');
      if (newBrand) {
        const activeHunt = getActiveHunt();
        const huntBrands = activeHunt
          ? activeHunt.items.map(i => i.brand).filter(Boolean) as string[]
          : [];

        const prevDiscovered = computeDiscoveredBrands(flips, huntBrands);
        const revealed = await getRevealedBrandNames();
        if (!prevDiscovered.has(newBrand.name) && !revealed.has(newBrand.name)) {
          await markBrandRevealed(newBrand.name);

          const source = activeHunt ? 'hunt_mode' : 'normal_scan';
          const meta = {
            brandName:       newBrand.name,
            rarity:          newBrand.rarity,
            category:        newBrand.category,
            dateDiscovered:  Date.now(),
            discoverySource: source as 'hunt_mode' | 'normal_scan',
            scanId:          currentScan.id,
            huntId:          activeHunt?.id,
            itemName:        flip.itemName,
            estimatedProfit: flip.profit,
          };
          await setDiscoveryMeta(meta);

          // Badge (gated for guests in the context) + immediate cloud upsert.
          addUnseenBrands([newBrand.name]);
          if (user?.id) {
            const uid = user.id;
            import('@/lib/brandSync')
              .then(({ upsertBrandDiscovery }) => upsertBrandDiscovery(uid, meta, { isUnread: true }))
              .catch(() => {});
          }

          rewards.push({ kind: 'brand', brand: newBrand, totalDiscovered: prevDiscovered.size + 1 });
        }
      }
    } catch {
      // Never crash on brand reveal logic
    }

    // ── Major achievement detection ────────────────────────────────────────
    // Uses pre-save `flips` snapshot to detect "just crossed" thresholds.
    try {
        const scans = (flips.filter(f => !isHuntBundle(f)) as FlipResult[]);
        const prevScanCount   = scans.length;
        const prevTotalProfit = scans.reduce((s, f) => s + (f.profit ?? 0), 0);
        const prevBrands      = new Set(scans.map(f => f.brand?.toLowerCase().trim()).filter(Boolean));

        // Priority order: most impressive first; only one fires per save
        let triggered: MajorAchievementType | null = null;

        // FlipStart Legend — $10,000 total profit
        if (!triggered && prevTotalProfit < 10000 && prevTotalProfit + flip.profit >= 10000) {
          if (!await hasShownMajorAchievement('flipstart_legend')) triggered = 'flipstart_legend';
        }

        // Jackpot — first $1,000+ profit item
        const wasJackpot = scans.some(f => f.profit >= 1000);
        if (!triggered && !wasJackpot && flip.profit >= 1000) {
          if (!await hasShownMajorAchievement('jackpot')) triggered = 'jackpot';
        }

        // Band Tee Bloodhound — first vintage band tee
        const eraStr   = (flip.era ?? '').toLowerCase();
        const styleStr = [...(flip.styleLabels ?? []), flip.itemName ?? ''].join(' ').toLowerCase();
        const isVintageBandTee = eraStr.includes('vintage') && styleStr.includes('band');
        const wasBandTee = scans.some(f => {
          const e = (f.era ?? '').toLowerCase();
          const s = [...(f.styleLabels ?? []), f.itemName ?? ''].join(' ').toLowerCase();
          return e.includes('vintage') && s.includes('band');
        });
        if (!triggered && isVintageBandTee && !wasBandTee) {
          if (!await hasShownMajorAchievement('band_tee_bloodhound')) triggered = 'band_tee_bloodhound';
        }

        // Master Scanner — 5,000th scan
        if (!triggered && prevScanCount < 5000 && prevScanCount + 1 >= 5000) {
          if (!await hasShownMajorAchievement('master_scanner')) triggered = 'master_scanner';
        }

        // Brand Encyclopedia — 100th unique brand
        const isNewBrand  = !prevBrands.has(flip.brand?.toLowerCase().trim());
        const newBrandCount = prevBrands.size + (isNewBrand ? 1 : 0);
        if (!triggered && prevBrands.size < 100 && newBrandCount >= 100) {
          if (!await hasShownMajorAchievement('brand_encyclopedia')) triggered = 'brand_encyclopedia';
        }

        // First Achievement Ever — very first save
        if (!triggered && prevScanCount === 0) {
          if (!await hasShownMajorAchievement('first_achievement')) triggered = 'first_achievement';
        }

        if (triggered) {
          await markMajorAchievementShown(triggered);
          rewards.push({ kind: 'achievement', achievementType: triggered });
        }
      } catch {
        // Never crash on achievement logic
      }

    // Enqueue all collected rewards (priority handled inside enqueueReward).
    rewards.forEach(enqueueReward);

    // If a hunt is active, add this item to the hunt session too
    if (isHuntActive()) {
      try {
        addItemToHunt({
          huntItemId:     currentScan.id,
          scanId:         currentScan.id,
          itemName:       id.item_name,
          brand:          id.brand,
          category:       id.category,
          imageUri:       currentScan.imageUri,
          allImageUris:   currentScan.allImageUris ?? [currentScan.imageUri],
          estimatedValue: md.adjusted_estimated_value,
          thriftPrice:    calc.thriftPrice,
          profit:         calc.profit,
          kept:           true,
          huntRating:     computeHuntRating(calc.profit, ra.match_confidence),
          addedAt:        Date.now(),
          scanSnapshot:   currentScan,
        });
      } catch { /* never block navigation */ }
    }

    // Check review prompt — awaited so the result is known before deciding to navigate.
    const shouldShowReview = await recordSuccessfulScan().catch(() => false);

    // If any reward modals are queued, stay on the screen and let them play.
    // The deferred-navigation effect shows the review prompt (if any) after the
    // reward queue drains, then navigates home. This is what makes brand reveals
    // and major-achievement celebrations actually appear after a save.
    if (rewards.length > 0) {
      navPendingRef.current    = true;
      reviewPendingRef.current = shouldShowReview;
      return;
    }

    // No rewards — original behavior: show review if due (its buttons navigate),
    // otherwise navigate home immediately.
    if (shouldShowReview) {
      setShowReview(true);
      return;
    }

    setCurrentScan(null);
    router.replace('/(tabs)' as any);
  };

  // Called by every review modal button to clear scan context and go home
  const navigateHome = () => {
    navPendingRef.current    = false;
    reviewPendingRef.current = false;
    setCurrentScan(null);
    router.replace('/(tabs)' as any);
  };

  const handleDelete = () => {
    Alert.alert('Delete Scan', 'Remove this scan?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => {
          removeFlip(currentScan.id);
          setCurrentScan(null);
          router.replace('/(tabs)' as any);
      }},
    ]);
  };

  const handleSaveWithConfirm = () => {
    if (isSaved) return;
    Alert.alert(
      'Save to History',
      'Save this scan to your flip history?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Save', onPress: handleConfirm },
      ]
    );
  };

  // Update the back handler ref with current state — runs on every render
  // so the ref always reflects the latest isSaved value and handleConfirm closure.
  backHandlerRef.current = () => {
    if (isSaved) {
      router.canGoBack() ? router.back() : router.replace('/(tabs)' as any);
      return true;
    }
    Alert.alert(
      'Save this analysis?',
      'Do you want to save this scan to history before leaving?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            setCurrentScan(null);
            router.replace('/(tabs)' as any);
          },
        },
        {
          text: 'Save',
          onPress: handleConfirm,
        },
      ]
    );
    return true;
  };

  // Plain function used by the back arrow Pressable
  const handleBackPress = () => backHandlerRef.current();

  const handleGenerateListings = async () => {
    if (hasGeneratedListings(currentScan.listings)) {
      // Real content already exists — open modal without re-calling AI
      setListingsOpen(true);
      return;
    }
    if (listingsLoading) return;
    haptic(Haptics.ImpactFeedbackStyle.Medium);
    setListingsLoading(true);
    setListingsError(false);
    try {
      const result = await generateListingsMutation.mutateAsync({
        item_name: id.item_name, brand: id.brand, category: id.category,
        estimated_era: id.estimated_era, material_guess: id.material_guess,
        style_labels: id.style_labels,
        adjusted_estimated_value: md.adjusted_estimated_value, demand: md.demand,
      });
      updateScan(currentScan.id, { listings: result });
      trackAnalyticsEvent('listing_generated', {
        scan_id:           currentScan.id,
        item_title:        id.item_name,
        brand:             id.brand,
        category:          id.category,
        platform:          'both',
        title_generated:   !!(result.ebay?.title || result.depop?.title),
        description_generated: !!(result.ebay?.description || result.depop?.description),
        estimated_resale_value: md.adjusted_estimated_value,
        generation_source: 'result_screen',
      });
      // Open immediately after generation
      setListingsOpen(true);
    } catch (err: any) {
      setListingsError(true);
      trackAnalyticsEvent('listing_generation_failed', {
        scan_id:   currentScan.id,
        item_title: id.item_name,
        platform:  'both',
        error_code: err?.code ?? null,
        failure_stage: 'ai_generation',
      });
    } finally {
      setListingsLoading(false);
    }
  };

  const handleOpenAnalysis = () => {
    haptic(Haptics.ImpactFeedbackStyle.Light);
    const snapshot = JSON.stringify({
      id: currentScan.id, imageUri: currentScan.imageUri,
      itemName: id.item_name, brand: id.brand, category: id.category,
      era: id.estimated_era, styleLabels: id.style_labels, material: id.material_guess,
      resaleValue: md.adjusted_estimated_value,
      resaleRangeLow: md.estimated_resale_range.low,
      resaleRangeHigh: md.estimated_resale_range.high,
      avgSoldPrice: md.average_sold_price, demand: md.demand,
      sellSpeed: md.sell_speed, competitionLevel: md.competition_level,
      matchConfidence: ra.match_confidence, riskFlags: ra.risk_flags,
      riskyBuyReasons: (ra as any).risky_buy_reasons ?? [],
      // The canonical block. Deep Analysis gates Era & Authenticity, rescan
      // advice, market signals and "What the AI Saw" on this — omitting it
      // silently hid all four whenever Deep Analysis was opened before the scan
      // had been confirmed into the store.
      structured: {
        v1:             (id as any).v1,
        frontEvidence:  (id as any).frontEvidence,
        tagEvidence:    (id as any).tagEvidence,
        detailEvidence: (id as any).detailEvidence,
        eraEvidence:    (id as any).eraEvidence,
        canonicalBrand: (id as any).canonicalBrand,
        eraEstimate:    (id as any).eraEstimate,
        eraConfidence:  (id as any).eraConfidence,
      },
      recommendation: calc.recommendation,
      thriftPrice: calc.thriftPrice, fees: calc.fees, profit: calc.profit,
      roi: calc.roi, buyScore: calc.buyScore, buyLabel: calc.buyLabel,
      stars: calc.stars, bestPlatform: calc.bestPlatform,
      timestamp: Date.now(),
      listingsGenerated: hasGeneratedListings(currentScan.listings),
      generatedAt: hasGeneratedListings(currentScan.listings) ? Date.now() : null,
      listingData: hasGeneratedListings(currentScan.listings)
        ? { ebay: currentScan.listings!.ebay, depop: currentScan.listings!.depop }
        : null,
    });
    router.push({ pathname: '/analysis-details' as any, params: { scanId: currentScan.id, snapshot, source: 'results' } });
  };

  // Tapping the title opens Deep Analysis AND permanently dismisses the coach-mark.
  const handleOpenDeepAnalysis = () => {
    if (showDeepTip) setShowDeepTip(false);
    // Mark as used and reset the "scans since last use" streak.
    AsyncStorage.setItem(
      deepTipKey,
      JSON.stringify({ seen: true, streak: 0, lastScanId: currentScan?.id ?? '' }),
    ).catch(() => { /* non-fatal */ });
    handleOpenAnalysis();
  };

  const listings = hasGeneratedListings(currentScan.listings) ? currentScan.listings! : null;

  return (
    <ScreenContainer edges={['left', 'right', 'bottom']} style={{ backgroundColor: BG }}>
      {/* Review prompt — appears after first successful scan */}
      {showReview && (
        <Modal transparent animationType="fade" visible statusBarTranslucent>
          <View style={{ flex: 1, backgroundColor: '#000000AA', justifyContent: 'center', alignItems: 'center', padding: 28 }}>
            <View style={{ backgroundColor: '#FFFFFF', borderRadius: 24, padding: 28, width: '100%', maxWidth: 360, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 12 }}>
              {/* Stars decoration */}
              <Text style={{ textAlign: 'center', fontSize: 26, marginBottom: 12, letterSpacing: 4 }}>★★★★★</Text>
              {/* Title */}
              <Text style={{ fontFamily: FONTS.serif, fontSize: 22, fontWeight: '800', color: '#152815', textAlign: 'center', marginBottom: 10 }}>
                Help FlipStart grow
              </Text>
              {/* Body */}
              <Text style={{ fontSize: 14, color: '#5A3A1A', textAlign: 'center', lineHeight: 21, marginBottom: 24 }}>
                If FlipStart helped you scan your first find, a quick App Store rating would seriously help the mission. Early reviews help us keep improving the AI for thrifters and resellers.
              </Text>
              {/* Rate button */}
              <Pressable
                onPress={async () => {
                  await onRequestedReview();
                  // Request the native sheet WHILE this screen is still mounted
                  // and active — calling it after navigation makes iOS drop it.
                  const shown = await requestAppStoreReview();
                  // If iOS couldn't present the in-app sheet (rate-limited or
                  // unavailable), deep-link to the store review page so the
                  // user can still leave a rating.
                  if (!shown) await openAppStoreReviewPage();
                  setShowReview(false);
                  navigateHome();
                }}
                style={({ pressed }) => ({ backgroundColor: '#152815', borderRadius: 50, paddingVertical: 15, alignItems: 'center', marginBottom: 10, opacity: pressed ? 0.85 : 1 })}
              >
                <Text style={{ fontFamily: FONTS.serif, fontSize: 16, fontWeight: '800', color: '#F4EED8' }}>
                  Rate FlipStart ★
                </Text>
              </Pressable>
              {/* Maybe Later */}
              <Pressable
                onPress={async () => { setShowReview(false); await onMaybeLater(); navigateHome(); }}
                style={({ pressed }) => ({ borderRadius: 50, paddingVertical: 13, alignItems: 'center', marginBottom: 8, borderWidth: 1.5, borderColor: '#2A4A2A', opacity: pressed ? 0.6 : 1 })}
              >
                <Text style={{ fontSize: 15, fontWeight: '600', color: '#2A4A2A' }}>Maybe Later</Text>
              </Pressable>
              {/* Don't ask again */}
              <Pressable
                onPress={async () => { setShowReview(false); await onDontAskAgain(); navigateHome(); }}
                style={({ pressed }) => ({ alignItems: 'center', paddingVertical: 8, opacity: pressed ? 0.5 : 1 })}
              >
                <Text style={{ fontSize: 13, color: '#8A7050', textDecorationLine: 'underline' }}>Don't Ask Again</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      )}
      {/* Modals */}
      {currentScan.imageUri && (
        <ImageViewerModal
          uri={currentScan.imageUri}
          visible={imageModalOpen}
          onClose={() => setImageModalOpen(false)}
        />
      )}
      <ListingsModal
        visible={listingsOpen}
        listings={listings}
        onClose={() => setListingsOpen(false)}
      />

      {/* Header — matches other screen headers: cream bg, green title, circular buttons */}
      <View style={[s.header, { paddingTop: insets.top + 6 }]}>
        <Pressable
          onPress={handleBackPress}
          hitSlop={8}
          style={({ pressed }) => [s.headerBtn, pressed && { opacity: 0.6 }]}
        >
          <MaterialIcons name="arrow-back" size={19} color={CREAM} />
        </Pressable>

        <View style={s.headerCenter}>
          <View style={s.headerSubRow}>
            <Text style={s.headerStar}>✦</Text>
            <Text style={s.headerBrand}>FlipStart</Text>
            <Text style={s.headerStar}>✦</Text>
          </View>
          <Text style={s.headerSub}>Analysis</Text>
        </View>

        <Pressable
          onPress={handleSaveWithConfirm}
          disabled={isSaved}
          hitSlop={8}
          style={({ pressed }) => [s.headerBtn, pressed && { opacity: 0.6 }, isSaved && { opacity: 0.5 }]}
        >
          <MaterialIcons name={isSaved ? 'check-circle' : 'check-circle-outline'} size={19} color={CREAM} />
        </Pressable>
      </View>
      <View style={s.headerDivider} />

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView
          style={{ flex: 1, backgroundColor: BG }}
          contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >

          {/* ── 1. Item Identity Card ── */}
          <View style={s.idCard}>
            <View style={s.idCardRow}>
              <Pressable
                onPress={() => currentScan.imageUri && setImageModalOpen(true)}
                style={({ pressed }) => [s.idThumbWrap, pressed && { opacity: 0.9 }]}
              >
                {currentScan.imageUri
                  ? <Image source={{ uri: currentScan.imageUri }} style={s.idThumb} contentFit="cover" transition={200} />
                  : <View style={[s.idThumb, s.idThumbFallback]}><MaterialIcons name="checkroom" size={34} color={MUTED} /></View>}
                {currentScan.imageUri && (
                  <View style={s.idThumbHint}><MaterialIcons name="zoom-in" size={11} color={CREAM} /></View>
                )}
              </Pressable>

              <View style={s.idInfo}>
                <View style={s.idTitleWrap}>
                  <Pressable onPress={handleOpenDeepAnalysis} hitSlop={4} style={({ pressed }) => [s.idTitlePress, pressed && { opacity: 0.6 }]}>
                    <Text style={s.idName}>
                      {id.item_name || 'Unknown Item'}
                      <Animated.Text
                        style={[
                          s.idTitleArrow,
                          { textShadowColor: GOLD, textShadowOffset: { width: 0, height: 0 }, textShadowRadius: arrowShadowRadius },
                        ]}
                      > ›</Animated.Text>
                    </Text>
                  </Pressable>

                  {/* First-scan coach mark for Deep Analysis — shows until user taps the title */}
                  {showDeepTip && (
                    <View style={s.deepTip}>
                      <View style={s.deepTipArrow} />
                      <View style={s.deepTipRow}>
                        <MaterialIcons name="lightbulb" size={15} color={GOLD} style={{ marginTop: 1 }} />
                        <Text style={s.deepTipText}>
                          Tap the item name to open <Text style={s.deepTipBold}>Deep Analysis</Text> — full price reasoning, risks, and platform strategy.
                        </Text>
                        <Pressable onPress={() => setShowDeepTip(false)} hitSlop={8} style={s.deepTipClose}>
                          <MaterialIcons name="close" size={15} color={MUTED} />
                        </Pressable>
                      </View>
                    </View>
                  )}
                </View>

                <View style={s.chipWrap}>
                  {!!id.brand && <View style={s.chip}><Text style={s.chipText} numberOfLines={1} ellipsizeMode="tail">{id.brand}</Text></View>}
                  {!!id.category && <View style={s.chip}><Text style={s.chipText} numberOfLines={1} ellipsizeMode="tail">{id.category}</Text></View>}
                  {/* Size, when it was actually read off a tag. Never inferred —
                      a wrong size is worse than no size for a reseller. */}
                  {!!(id as any).v1?.sizeLabel && (
                    <View style={s.chip}>
                      <Text style={s.chipText} numberOfLines={1}>Size {(id as any).v1.sizeLabel}</Text>
                    </View>
                  )}
                  {/* Era: prefer the validated decade/status over the free-text
                      field, which can say "Unknown" while the canonical status
                      is a confident "modern". */}
                  {/* Era pill. Always renders — a missing pill reads as a
                      broken field, and "Era unknown" is a real, useful answer.
                      Confidence is expressed in the wording rather than by
                      hiding the chip. */}
                  {(() => {
                    const v1 = (id as any).v1;
                    const status  = v1?.eraStatus;
                    const conf    = typeof v1?.eraConfidence === 'number' ? v1.eraConfidence : 0;
                    const decade  = v1?.productionDecade && v1.productionDecade !== 'unknown'
                      ? String(v1.productionDecade).replace(/^pre_/, 'pre-') : null;
                    const y2k     = v1?.styleEra === 'y2k';

                    // A decade only appears when hard manufacturing evidence
                    // established it, so it is never hedged.
                    let label: string | null = decade;

                    if (!label) {
                      if (status === 'confirmed_vintage')      label = y2k ? 'Y2K' : 'Vintage';
                      else if (status === 'likely_vintage')    label = y2k ? 'Likely Y2K' : 'Likely vintage';
                      else if (status === 'vintage_inspired')  label = 'Vintage-inspired';
                      else if (status === 'modern')            label = conf >= 70 ? 'Modern' : 'Likely modern';
                      else {
                        // Unknown. Fall back to any legacy free text, then to a
                        // hedge from styling, then to an honest "Era unknown".
                        const legacy = id.estimated_era;
                        const usableLegacy = legacy && legacy !== 'Unknown'
                          && legacy !== 'Insufficient evidence' ? legacy : null;
                        label = usableLegacy
                          ?? (y2k ? 'Y2K styling' : null)
                          ?? 'Era unknown';
                      }
                    }

                    const soft = label === 'Era unknown' || label.startsWith('Likely');
                    return (
                      <View style={[s.chip, soft && s.chipSoft]}>
                        <Text style={[s.chipText, soft && s.chipSoftText]} numberOfLines={1} ellipsizeMode="tail">
                          {label}
                        </Text>
                      </View>
                    );
                  })()}
                  {ra.match_confidence > 0 && (
                    <View style={[s.chip, s.chipConf]}>
                      <MaterialIcons name="verified" size={12} color={FOREST} />
                      <Text style={[s.chipText, s.chipConfText]} numberOfLines={1}>{ra.match_confidence}% Confidence</Text>
                    </View>
                  )}
                </View>
              </View>
            </View>
          </View>

          {/* ── 2. Big Buy Rating Card ── */}
          <View style={[s.ratingCard, { backgroundColor: theme.bg, borderColor: GOLD }]}>
            <View style={s.ratingLeft}>
              <View style={[s.ratingBadge, { borderColor: ratingAccent }]}>
                <MaterialIcons name={theme.icon as any} size={30} color={ratingAccent} />
              </View>
              <View style={s.ratingTextCol}>
                <Text
                  style={[s.ratingText, { color: ratingAccent, fontSize: ratingFontSize }]}
                  numberOfLines={2}
                  adjustsFontSizeToFit
                  minimumFontScale={0.7}
                  ellipsizeMode="clip"
                >{canonicalRating}</Text>
                <Text style={s.ratingRec} numberOfLines={2} ellipsizeMode="tail">{buyLine}</Text>
              </View>
            </View>
            <View style={s.ratingDivider} />
            <View style={s.ratingRight}>
              <Text style={[s.ratingResaleLabel, { color: ratingAccent }]}>EST. RESALE</Text>
              <Text style={[s.ratingResaleValue, { color: ratingAccent === '#FFFFFF' ? '#FFFFFF' : GOLD }]}>{fmtMoney(resaleValue)}</Text>
              <View style={s.ratingProfitPill}>
                <Text style={s.ratingProfitPillText}>Est. Profit {calc.profit >= 0 ? '+' : '-'}{fmtMoney(Math.abs(calc.profit))}</Text>
              </View>
            </View>
          </View>

          {/* ── 2a. Why risky? ──────────────────────────────────────────────
              Only on RISKY BUY, and only when there is something specific to
              say. The rating alone does not tell the user WHAT to weigh — the
              same label can mean "it will sit for months" or "I am not sure
              what this is", and those call for different decisions. Factors
              come from the rating engine itself, so this can never disagree
              with Deep Analysis. */}
          {canonicalRating === 'RISKY BUY' && (calc.recommendation?.riskFactors?.length ?? 0) > 0 && (
            <View style={s.riskWhyCard}>
              <View style={s.riskWhyHeader}>
                <MaterialIcons name="info-outline" size={15} color={BROWN} />
                <Text style={s.riskWhyTitle}>Why risky</Text>
              </View>
              <View style={s.riskWhyChips}>
                {calc.recommendation.riskFactors.slice(0, 4).map(f => (
                  <View key={f.code} style={s.riskWhyChip}>
                    <Text style={s.riskWhyChipText}>{f.label}</Text>
                  </View>
                ))}
              </View>
              {/* The sentence names the DOMINANT factor rather than describing
                  the situation vaguely. "The conditions are not in your favour"
                  read as a condition-of-the-item problem — the opposite of what
                  it meant — right below a card saying condition was fine. */}
              <Text style={s.riskWhyNote}>
                {(() => {
                  const codes = calc.recommendation.riskFactors.map(f => f.code);
                  const has = (c: string) => codes.includes(c as any);
                  const good = calc.profit >= 15;

                  if (has('OBVIOUS_DAMAGE'))
                    return good
                      ? 'Good profit on paper, but the damage will cost you buyers and may bring a return.'
                      : 'The damage eats into a margin that is already thin.';
                  if (has('VERY_SLOW_SELL') || has('SLOW_SELL'))
                    return good
                      ? 'Good profit potential — but expect it to sit a while before it sells.'
                      : 'Modest profit and a slow seller, so your money is tied up for the payoff.';
                  if (has('LOW_DEMAND'))
                    return good
                      ? 'The money is there if it sells — demand for this is soft.'
                      : 'Soft demand and a thin margin is a hard combination.';
                  if (has('HIGH_COMPETITION'))
                    return good
                      ? 'Solid margin, but you are competing with a lot of similar listings.'
                      : 'Thin margin against heavy competition — you will likely have to undercut.';
                  if (has('NARROW_POOL'))
                    return 'Worth real money to the right buyer, but that buyer is rare.';
                  if (has('LOW_CONFIDENCE'))
                    return 'The numbers look fine, but verify what this actually is before paying.';
                  if (has('THIN_MARGIN'))
                    return 'Very little room here — one return or price cut wipes out the profit.';
                  if (has('ERA_UNCONFIRMED'))
                    return 'Age could not be confirmed from these photos, and era moves value on items like this.';
                  return good
                    ? 'Real profit here — just not a quick or certain one.'
                    : 'Workable, but nothing about this is a sure thing.';
                })()}
              </Text>
            </View>
          )}

          {/* ── 2b. Condition ────────────────────────────────────────────────
              Renders ONLY when there is something concrete to report. A clean,
              well-photographed item shows nothing — an always-present "no
              damage found" line would train users to ignore the row, which is
              exactly when a real warning needs to land.

              Obvious findings only. Low-certainty maybes stay in Deep Analysis:
              a false damage warning costs more trust than a missed one costs
              money. */}
          {(() => {
            const v1 = (id as any).v1;
            const damage: string[] = v1?.obviousDamage ?? [];
            const unknowns: string[] = v1?.conditionUnknowns ?? [];
            const slots: string[] = v1?.photoSlots ?? ['front'];

            // Damage always wins — it changes the decision.
            if (damage.length > 0) {
              return (
                <View style={[s.conditionStrip, s.conditionStripWarn]}>
                  <MaterialIcons name="report-problem" size={16} color="#8A3A2A" />
                  <View style={{ flex: 1 }}>
                    <Text style={[s.conditionStripTitle, { color: '#8A3A2A' }]}>Condition</Text>
                    <Text style={s.conditionStripBody} numberOfLines={3}>
                      {damage.slice(0, 3).join(' · ')}
                    </Text>
                  </View>
                </View>
              );
            }

            // No damage found. Say what WAS checked rather than only what was
            // not — "condition not fully visible" reads as a failure when the
            // model successfully assessed everything it was shown. A front
            // photo genuinely does assess the front.
            const coverage =
              slots.length >= 3 ? 'all three photos'
              : slots.length === 2 ? 'the photos provided'
              : 'the front photo';
            const gap =
              slots.length >= 3 ? null
              : slots.includes('tag') && !slots.includes('detail')
                ? 'Check the back and any wear areas to confirm.'
                : 'Check the back and inside of the item to verify.';

            // Nothing useful to say at all — stay silent rather than filling space.
            if (!gap && unknowns.length === 0) return null;

            return (
              <View style={[s.conditionStrip, s.conditionStripInfo]}>
                <MaterialIcons name="check-circle-outline" size={16} color={FOREST} />
                <View style={{ flex: 1 }}>
                  <Text style={s.conditionStripTitle}>Condition</Text>
                  <Text style={s.conditionStripBody} numberOfLines={3}>
                    No visible flaws in {coverage}.{gap ? ` ${gap}` : ''}
                  </Text>
                </View>
              </View>
            );
          })()}

          {/* ── 3. Quick Stats Row ── */}
          <View style={s.statsCard}>
            {[
              { icon: 'payments',   label: 'Est. Profit',  value: `${calc.profit >= 0 ? '+' : '-'}${fmtMoney(Math.abs(calc.profit))}`, color: profitColor },
              { icon: 'show-chart', label: 'ROI',          value: calc.roi > 0 ? `${calc.roi}%` : '—',     color: calc.roi >= 50 ? '#2A5A2A' : BROWN },
              // "Avg Sold" removed: it was the midpoint of the AI's own estimate
              // presented as if it were sold-comp data. No comps exist yet, and
              // implying otherwise is exactly the claim the prompt rewrite set
              // out to remove.
              { icon: 'trending-up',label: 'Market Range', value: rangeStr, color: FOREST },
            ].map((m, i) => (
              <View key={m.label} style={[s.statBox, i < 2 && s.statBoxBorder]}>
                <View style={s.statIconCircle}><MaterialIcons name={m.icon as any} size={15} color={GOLD} /></View>
                <Text style={s.statLabel}>{m.label}</Text>
                <Text
                  style={[s.statValue, { color: m.color }]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.6}
                >{m.value}</Text>
              </View>
            ))}
          </View>

          {/* ── 4. Sold Comp Sources (placeholder marketplaces) ── */}
          <View style={s.card}>
            <View style={s.compHeaderRow}>
              <Text style={s.compTitle}>Sold Comp Sources</Text>
              <MaterialIcons name="info-outline" size={15} color={MUTED} />
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={s.compScrollContent}
            >
              {COMP_SOURCES.map(src => (
                <View key={src.name} style={s.compItem}>
                  {src.svg === 'poshmark'
                    ? <PoshmarkLogo height={10} />
                    : <Image
                        source={src.png}
                        style={{ width: Math.min(src.width ?? 48, 48), height: COMP_LOGO_H }}
                        contentFit="contain"
                      />}
                  {src.showText && <Text style={s.compPillText}>{src.name}</Text>}
                </View>
              ))}
            </ScrollView>
            <View style={s.compNoteRow}>
              <MaterialIcons name="schedule" size={12} color={MUTED} />
              <Text style={s.compNote}>Live comp breakdown coming soon.</Text>
            </View>
          </View>

          {/* ── 5. Your thrift price + compact breakdown ── */}
          <View style={s.card}>
            <View style={s.priceTopRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.priceTitle}>Your thrift price</Text>
                <Text style={s.priceSub}>Values update automatically</Text>
              </View>
              {thriftEditing ? (
                <View style={s.priceInputWrap}>
                  <Text style={s.priceDollar}>$</Text>
                  <TextInput
                    style={s.priceInput} value={thriftPriceStr}
                    onChangeText={handleThriftChange} keyboardType="decimal-pad"
                    autoFocus returnKeyType="done" onBlur={() => setThriftEditing(false)}
                    onSubmitEditing={() => setThriftEditing(false)}
                    placeholder={String(md.suggested_buy_price)} placeholderTextColor={MUTED}
                  />
                </View>
              ) : (
                <Pressable
                  onPress={() => { setThriftEditing(true); haptic(Haptics.ImpactFeedbackStyle.Light); }}
                  style={s.priceDisplayRow}
                >
                  {isEstimatedPrice && <Text style={s.priceEstTag}>Est.</Text>}
                  <Text style={s.priceDisplayText}>{fmtMoney(maxBuy)}</Text>
                  <View style={s.priceEditBtn}><MaterialIcons name="edit" size={15} color={CREAM} /></View>
                </Pressable>
              )}
            </View>

            <View style={s.breakdownRow}>
              <View style={s.breakdownCol}>
                <Text style={s.breakdownLabel}>Resale Value</Text>
                <Text style={s.breakdownValue}>{fmtMoney(resaleValue)}</Text>
              </View>
              <Text style={s.breakdownOp}>−</Text>
              <View style={s.breakdownCol}>
                <Text style={s.breakdownLabel}>Platform Fees</Text>
                <Text style={[s.breakdownValue, { color: '#8A3A2A' }]}>-{fmtMoney(calc.fees)}</Text>
              </View>
              <Text style={s.breakdownOp}>−</Text>
              <View style={s.breakdownCol}>
                <Text style={s.breakdownLabel}>Max Buy Price</Text>
                <Text style={[s.breakdownValue, { color: '#8A3A2A' }]}>-{fmtMoney(maxBuy)}</Text>
              </View>
              <Text style={s.breakdownOp}>=</Text>
              <View style={[s.breakdownCol, s.breakdownColResult]}>
                <Text style={s.breakdownLabel}>Est. Profit</Text>
                <Text style={[s.breakdownValue, { color: profitColor }]}>{calc.profit >= 0 ? '+' : '-'}{fmtMoney(Math.abs(calc.profit))}</Text>
              </View>
            </View>
          </View>

          {/* ── 6. Generate Listings — full-width CTA ── */}
          <Pressable
            onPress={handleGenerateListings}
            disabled={listingsLoading}
            style={({ pressed }) => [s.generateBtn, (pressed || listingsLoading) && { opacity: 0.85 }]}
          >
            <MaterialIcons name={listingsLoading ? 'hourglass-empty' : 'sell'} size={19} color={FOREST} />
            <Text style={s.generateBtnText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
              {listingsLoading ? 'Generating…' : hasGeneratedListings(listings) ? 'View Listings' : 'Generate Listings'}
            </Text>
          </Pressable>

          {listingsError && (
            <Text style={s.listingsErrText}>Couldn't generate listings. Tap to retry.</Text>
          )}

          {/* ── 7. Remove + Save to History ── */}
          <View style={s.actionsRow}>
            <Pressable
              onPress={handleDelete}
              style={({ pressed }) => [s.removeBtn, pressed && { opacity: 0.7 }]}
            >
              <MaterialIcons name="delete-outline" size={17} color="#FFFFFF" />
              <Text style={s.removeBtnText}>Remove</Text>
            </Pressable>

            <Pressable
              onPress={handleConfirm}
              disabled={isSaved}
              style={({ pressed }) => [
                s.saveBtn,
                pressed && !isSaved && { opacity: 0.88, transform: [{ scale: 0.97 }] },
                isSaved && { backgroundColor: '#2A5A2A', opacity: 0.85 },
              ]}
            >
              <MaterialIcons name={isSaved ? 'check' : 'bookmark-border'} size={17} color={CREAM} />
              <Text style={s.saveBtnText}>{isSaved ? 'Saved' : 'Save to History'}</Text>
            </Pressable>
          </View>

          {/* ── 9. Accuracy feedback ── */}
          <FeedbackCard
            scanId={currentScan.id}
            itemName={id.item_name}
            brand={id.brand}
            category={id.category}
            resaleLow={md.estimated_resale_range.low}
            resaleHigh={md.estimated_resale_range.high}
            suggestedBuy={md.suggested_buy_price}
            aiEstimatedResale={md.adjusted_estimated_value}
            demand={md.demand}
            bestPlatform={calc.bestPlatform}
            confidenceScore={ra.match_confidence}
            recommendation={canonicalRating}
          />

          <View style={{ height: 32 }} />
        </ScrollView>
      </KeyboardAvoidingView>

      {/* ── Reward queue — one reward at a time, in priority order ───────────
           Legendary brand → major achievement → other brand reveals          */}
      {currentReward?.kind === 'achievement' && (
        <MajorAchievementModal
          type={currentReward.achievementType}
          visible={true}
          onContinue={advanceQueue}
        />
      )}
      {currentReward?.kind === 'brand' && (
        <BrandRevealModal
          brand={currentReward.brand}
          totalDiscovered={currentReward.totalDiscovered}
          totalBrands={TOTAL_SUPPORTED_BRANDS}
          visible={true}
          onContinue={advanceQueue}
        />
      )}

    </ScreenContainer>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  scroll:    { backgroundColor: BG, paddingBottom: 20 },
  emptyWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16 },
  emptyText: { fontSize: 16, color: BROWN },
  emptyBtn:  { backgroundColor: FOREST, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 50 },
  emptyBtnText: { color: CREAM, fontWeight: '700' },

  // Header — deep forest green, no separate safe-area view needed because paddingTop handles it
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 12,
    backgroundColor: FOREST,
  },
  headerBtn: {
    width: 34, height: 34, borderRadius: 17,
    borderWidth: 1, borderColor: 'rgba(190,156,44,0.4)', backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center', justifyContent: 'center',
  },
  headerCenter:  { flex: 1, alignItems: 'center', gap: 1 },
  headerSubRow:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerBrand:   { fontFamily: FONTS.serif, fontSize: 26, fontWeight: '800', color: CREAM },
  headerStar:    { fontSize: 12, color: GOLD },
  headerSub:     { fontSize: 11, fontWeight: '700', color: CREAM, letterSpacing: 2.5, textTransform: 'uppercase' },
  headerDivider: { height: 0 },

  // Cards
  card: {
    backgroundColor: CARD, borderRadius: 14, borderWidth: 1, borderColor: CARD_B,
    marginHorizontal: 14, marginTop: 12, padding: 16,
    shadowColor: '#2A1A0A', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.07, shadowRadius: 4, elevation: 2,
  },
  sectionLabel: {
    fontSize: 10, fontWeight: '700', color: MUTED,
    letterSpacing: 1.4, textTransform: 'uppercase', marginBottom: 12,
  },

  // Item identity card — large
  itemRow:    { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  thumbWrap:  { position: 'relative', borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: CARD_B },
  thumb:      { width: 100, height: 100, borderRadius: 11 },
  thumbFallback: { backgroundColor: '#FFFEFA', justifyContent: 'center', alignItems: 'center' },
  thumbExpandHint: {
    position: 'absolute', bottom: 4, right: 4,
    backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 8,
    paddingHorizontal: 4, paddingVertical: 2,
  },
  itemInfo: { flex: 1, gap: 5 },
  itemName: { fontFamily: FONTS.serif, fontSize: 20, fontWeight: '700', color: FOREST, lineHeight: 26 },
  itemMeta: { fontSize: 13, color: MUTED },
  itemEra:  { fontSize: 11, color: MUTED, fontStyle: 'italic' },
  confBadge: {
    alignSelf: 'flex-start', borderWidth: 1, borderRadius: 8,
    paddingHorizontal: 9, paddingVertical: 4, marginTop: 4, gap: 1,
  },
  confBadgeText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  confBadgeSub:  { fontSize: 9, fontWeight: '500' },

  // Decision card
  decisionCard: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 14, marginTop: 12,
    borderRadius: 14, borderWidth: 1.5,
    padding: 16, gap: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.12, shadowRadius: 5, elevation: 4,
  },
  decisionLeft:        { width: 38, alignItems: 'center' },
  decisionMid:         { flex: 1, gap: 4 },
  decisionLabel:       { fontFamily: FONTS.serif, fontSize: 18, fontWeight: '800', letterSpacing: 0.2 },
  decisionReason:      { fontSize: 12 },
  decisionMaxBuy:      { fontSize: 11, marginTop: 4, fontStyle: 'italic' },
  decisionRight:       { alignItems: 'flex-end', gap: 2, minWidth: 68 },
  decisionProfitLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
  decisionProfit:      { fontFamily: FONTS.serif, fontSize: 24, fontWeight: '900', letterSpacing: -0.5 },

  // Quick summary
  summaryRow:   { flexDirection: 'row' },
  summaryBox:   { flex: 1, alignItems: 'center', paddingVertical: 4, gap: 2 },
  summaryValue: { fontFamily: FONTS.serif, fontSize: 15, fontWeight: '800' },
  summaryLabel: { fontSize: 9, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.4, textAlign: 'center' },

  // Bullets
  bulletRow: { flexDirection: 'row', gap: 8, marginBottom: 6, alignItems: 'flex-start' },
  bulletDot: { fontSize: 14, color: GOLD, lineHeight: 20 },
  bulletText:{ flex: 1, fontSize: 13, color: BROWN, lineHeight: 20 },

  // Deep analysis CTA
  deepCtaCard: {
    backgroundColor: CARD, borderRadius: 14,
    borderWidth: 1.5, borderColor: GOLD + '70',
    marginHorizontal: 14, marginTop: 12,
    shadowColor: GOLD, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.14, shadowRadius: 6, elevation: 3,
  },
  deepCtaInner:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 },
  deepCtaTextCol: { flex: 1, gap: 3 },
  deepCtaTitle:   { fontSize: 11, fontWeight: '700', color: FOREST, letterSpacing: 1 },
  deepCtaSub:     { fontSize: 11, color: MUTED },
  deepCtaArrow:   { flexDirection: 'row', alignItems: 'center', gap: 2 },
  deepCtaLink:    { fontSize: 13, fontWeight: '700', color: FOREST, fontFamily: FONTS.serif },

  // Market value
  marketRow:    { flexDirection: 'row' },
  marketBox:    { flex: 1, alignItems: 'center', gap: 4 },
  marketBoxMid: { borderLeftWidth: 1, borderRightWidth: 1, borderColor: CARD_B },
  marketLabel:  { fontSize: 9, fontWeight: '700', color: MUTED, letterSpacing: 0.5, textAlign: 'center' },
  marketValue:  { fontFamily: FONTS.serif, fontSize: 18, fontWeight: '800', color: FOREST, textAlign: 'center' },

  // Your price (input styles reused by redesigned thrift editor)
  priceInputWrap: { flexDirection: 'row', alignItems: 'center', borderRadius: 8, borderWidth: 1.5, borderColor: FOREST, paddingHorizontal: 10, paddingVertical: 6, gap: 2 },
  priceDollar:    { fontSize: 15, fontWeight: '700', color: FOREST },
  priceInput:     { fontSize: 18, fontWeight: '800', color: FOREST, minWidth: 70, padding: 0 },

  // Actions
  actionsRow:      { flexDirection: 'row', gap: 10, marginHorizontal: 14, marginTop: 14 },
  actionOutline:   { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 14, borderRadius: 10, borderWidth: 1.5, borderColor: FOREST, backgroundColor: CARD },
  actionOutlineText: { fontSize: 13, fontWeight: '700', color: FOREST, fontFamily: FONTS.serif },
  actionSolid:     { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 14, borderRadius: 10, backgroundColor: FOREST },
  actionSolidText: { fontSize: 13, fontWeight: '700', color: CREAM, fontFamily: FONTS.serif },
  listingsErrText: { fontSize: 11, color: '#8A3A2A', textAlign: 'center', marginTop: 6 },

  // ════════ REDESIGN STYLES ════════
  // 1 · Item identity card
  idCard: {
    backgroundColor: CARD, borderRadius: 16, borderWidth: 1, borderColor: CARD_B,
    marginHorizontal: 14, marginTop: 12, padding: 15,
    zIndex: 30, elevation: 12,   // lift above the rating card so the coach-mark tooltip paints on top
    shadowColor: '#2A1A0A', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 6,
  },
  idCardRow: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  idThumbWrap: { width: 138, height: 138, borderRadius: 14, overflow: 'hidden', position: 'relative' },
  idThumb:     { width: '100%', height: '100%', backgroundColor: '#FFFEFA' },
  idThumbFallback: { alignItems: 'center', justifyContent: 'center' },
  idThumbHint: { position: 'absolute', bottom: 5, right: 5, backgroundColor: 'rgba(42,74,42,0.85)', borderRadius: 10, padding: 3 },
  idInfo:    { flex: 1, gap: 8, minWidth: 0 },
  idTitleWrap: { position: 'relative', zIndex: 40 },
  idTitlePress:{ alignSelf: 'flex-start' },
  idName:    { fontFamily: FONTS.serif, fontSize: 21, fontWeight: '800', color: FOREST, lineHeight: 26 },
  idTitleArrow: { fontFamily: FONTS.serif, fontSize: 21, fontWeight: '800', color: GOLD },
  chipWrap:  { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  chip:      { flexDirection: 'row', alignItems: 'center', gap: 3, maxWidth: '100%', backgroundColor: '#F8F7F0', borderWidth: 1, borderColor: CARD_B, borderRadius: 50, paddingHorizontal: 8, paddingVertical: 4 },
  chipText:  { fontSize: 10.5, fontWeight: '600', color: BROWN, flexShrink: 1 },
  chipConf:  { borderColor: '#7CA87C', backgroundColor: '#EFF6EC' },
  chipConfText: { color: FOREST, fontWeight: '700' },
  // Deep Analysis coach-mark (thought bubble)
  deepTip: {
    position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 8, zIndex: 20,
    backgroundColor: '#FFFDF6', borderRadius: 12, borderWidth: 1, borderColor: GOLD,
    paddingVertical: 10, paddingHorizontal: 12,
    shadowColor: '#2A1A0A', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.18, shadowRadius: 8, elevation: 6,
  },
  deepTipArrow: {
    position: 'absolute', top: -7, left: 22, width: 12, height: 12,
    backgroundColor: '#FFFDF6', borderLeftWidth: 1, borderTopWidth: 1, borderColor: GOLD,
    transform: [{ rotate: '45deg' }],
  },
  deepTipRow:  { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  deepTipText: { flex: 1, fontSize: 12, lineHeight: 17, color: BROWN },
  deepTipBold: { fontWeight: '800', color: FOREST },
  deepTipClose:{ padding: 2, marginTop: -1 },

  // 2 · Big buy rating card
  ratingCard: {
    flexDirection: 'row', alignItems: 'center', marginHorizontal: 14, marginTop: 12,
    borderRadius: 16, borderWidth: 2, padding: 14, gap: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 5,
  },
  ratingLeft:  { flex: 1.6, flexDirection: 'row', alignItems: 'center', gap: 10 },
  ratingBadge: { width: 44, height: 44, borderRadius: 22, borderWidth: 1.5, borderColor: GOLD, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(190,156,44,0.12)' },
  ratingTextCol: { flex: 1 },
  ratingText:  { fontFamily: FONTS.serif, fontSize: 22, fontWeight: '800', color: GOLD, lineHeight: 25 },
  ratingRec:   { fontSize: 11.5, color: '#E8E0CC', lineHeight: 15, marginTop: 3 },
  ratingDivider: { width: 1, alignSelf: 'stretch', backgroundColor: 'rgba(190,156,44,0.35)', marginVertical: 2 },
  ratingRight: { flex: 1, alignItems: 'center' },
  ratingResaleLabel: { fontSize: 10, fontWeight: '700', color: GOLD, letterSpacing: 1.2 },
  ratingResaleValue: { fontFamily: FONTS.serif, fontSize: 30, fontWeight: '800', color: GOLD, lineHeight: 34, marginTop: 2 },
  ratingProfitPill: { marginTop: 6, backgroundColor: 'rgba(0,0,0,0.22)', borderRadius: 50, paddingHorizontal: 9, paddingVertical: 3, borderWidth: 1, borderColor: 'rgba(190,156,44,0.4)' },
  ratingProfitPillText: { fontSize: 11.5, fontWeight: '700', color: '#8FE08F' },

  // 3 · Quick stats row
  chipSoft:      { opacity: 0.72 },
  chipSoftText:  { fontStyle: 'italic' },
  // marginHorizontal 14 matches ratingCard / statsCard / every other card.
  // Without it these span the full screen and read as a different component.
  conditionStrip:      { flexDirection: 'row', alignItems: 'flex-start', gap: 9, borderRadius: 14,
                         borderWidth: 1, paddingHorizontal: 13, paddingVertical: 11,
                         marginTop: 10, marginHorizontal: 14 },
  conditionStripWarn:  { backgroundColor: '#FBEFEA', borderColor: '#8A3A2A' + '44' },
  conditionStripInfo:  { backgroundColor: '#FBF6E6', borderColor: GOLD + '44' },
  conditionStripTitle: { fontSize: 10.5, fontWeight: '800', color: BROWN, letterSpacing: 1, marginBottom: 2 },
  conditionStripBody:  { fontSize: 12.5, color: BROWN, lineHeight: 17 },
  riskWhyCard:    { backgroundColor: '#FBF6E6', borderRadius: 14, borderWidth: 1, borderColor: GOLD + '55',
                    paddingHorizontal: 14, paddingVertical: 12, marginTop: 10,
                    marginHorizontal: 14, gap: 8 },
  riskWhyHeader:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
  riskWhyTitle:   { fontSize: 11, fontWeight: '800', color: BROWN, letterSpacing: 1 },
  riskWhyChips:   { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  riskWhyChip:    { backgroundColor: '#FFFEFA', borderRadius: 999, borderWidth: 1, borderColor: GOLD + '66',
                    paddingHorizontal: 10, paddingVertical: 5 },
  riskWhyChipText:{ fontSize: 12, fontWeight: '700', color: BROWN },
  riskWhyNote:    { fontSize: 12, color: BROWN, opacity: 0.85, lineHeight: 17 },
  statsCard: {
    flexDirection: 'row', backgroundColor: CARD, borderRadius: 18, borderWidth: 1, borderColor: CARD_B,
    marginHorizontal: 14, marginTop: 14, paddingVertical: 16, paddingHorizontal: 6,
    shadowColor: '#2A1A0A', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.07, shadowRadius: 4, elevation: 2,
  },
  statBox:       { flex: 1, alignItems: 'center', gap: 4, paddingHorizontal: 2 },
  statBoxBorder: { borderRightWidth: 1, borderRightColor: '#DDD2AC' },
  statIconCircle:{ width: 30, height: 30, borderRadius: 15, backgroundColor: FOREST, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  statLabel:     { fontSize: 11, color: MUTED, fontWeight: '600' },
  statValue:     { fontFamily: FONTS.serif, fontSize: 17, fontWeight: '800' },

  // 4 · Sold comp sources — compact
  compHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  compTitle:     { fontFamily: FONTS.serif, fontSize: 15, fontWeight: '700', color: FOREST },
  compPillsRow:  { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 16, rowGap: 12 },
  compScrollContent: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingRight: 8, paddingVertical: 2 },
  compItem:      { height: 24, borderRadius: 8, borderWidth: 1.5, borderColor: '#1A1A1A', backgroundColor: '#FFFEFA', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  compPillText:  { fontSize: 13, fontWeight: '700', color: BROWN },
  compNoteRow:   { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 10 },
  compNote:      { fontSize: 11.5, color: MUTED, fontStyle: 'italic' },

  // 5 · Your thrift price + breakdown
  priceTopRow:   { flexDirection: 'row', alignItems: 'center', paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: '#DDD2AC' },
  priceTitle:    { fontFamily: FONTS.serif, fontSize: 16, fontWeight: '700', color: FOREST },
  priceSub:      { fontSize: 12, color: MUTED, marginTop: 2 },
  priceDisplayRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  priceEstTag:     { fontSize: 11, fontWeight: '700', color: MUTED, fontStyle: 'italic' },
  priceDisplayText:{ fontFamily: FONTS.serif, fontSize: 22, fontWeight: '800', color: FOREST },
  priceEditBtn:  { width: 36, height: 36, borderRadius: 9, backgroundColor: FOREST, alignItems: 'center', justifyContent: 'center' },
  breakdownRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 14 },
  breakdownCol:  { alignItems: 'center', flex: 1 },
  breakdownColResult: { paddingVertical: 6, marginVertical: -6 },
  breakdownLabel:{ fontSize: 10.5, color: FOREST, fontWeight: '600', textAlign: 'center', marginBottom: 3 },
  breakdownValue:{ fontFamily: FONTS.serif, fontSize: 16, fontWeight: '800', color: FOREST },
  breakdownOp:   { fontSize: 15, color: MUTED, fontWeight: '700', paddingHorizontal: 2 },

  // 6 · Deep analysis CTA — compact premium secondary
  // 6 · Generate listings (full-width)
  generateBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9,
    backgroundColor: CARD, borderWidth: 1.5, borderColor: FOREST, borderRadius: 13,
    marginHorizontal: 14, marginTop: 12, paddingVertical: 16,
    shadowColor: FOREST, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
  },
  generateBtnText: { fontFamily: FONTS.serif, fontSize: 16, fontWeight: '800', color: FOREST },

  // 7 · Remove + Save row — equal width, both filled
  removeBtn:   { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 18, borderRadius: 12, backgroundColor: '#6E211B' },
  removeBtnText: { fontSize: 14, fontWeight: '700', color: '#FFFFFF', fontFamily: FONTS.serif },
  saveBtn:     { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 18, borderRadius: 12, backgroundColor: FOREST },
  saveBtnText: { fontSize: 14, fontWeight: '700', color: CREAM, fontFamily: FONTS.serif },
});
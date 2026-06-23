/**
 * results.tsx — Analysis screen (fast decision engine)
 *
 * Structure: Identity → Decision → Quick Summary → Why This Rating
 *            → Deep Analysis CTA → Market Value → Your Price → Actions
 */

import {
  Text, View, ScrollView, Pressable, Platform, Modal,
  StyleSheet, TextInput, Alert, KeyboardAvoidingView, Clipboard, BackHandler,
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useState, useMemo, useEffect, useRef, useCallback } from 'react';

import { ScreenContainer } from '@/components/screen-container';
import { useScanContext } from '@/lib/scan-context';
import { isHuntActive, addItemToHunt, computeHuntRating, getActiveHunt } from '@/lib/hunt-context';
import { recordSuccessfulScan, onMaybeLater, onDontAskAgain, onRequestedReview, requestAppStoreReview } from '@/lib/reviewPrompt';
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
import { computeFlipCalc } from '@/utils/flipCalculations';
import { REC_THEMES } from '@/utils/recommendation';

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
const BG     = '#F0E8D4';
const CARD   = '#FFF9EE';
const CARD_B = '#DDD0B0';
const FOREST = '#2A4A2A';
const BROWN  = '#5A3A1A';
const MUTED  = '#8A7050';
const GOLD   = '#BE9C2C';
const CREAM  = '#F4EED8';


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
  const { addFlip, removeFlip, flips, pendingThriftPrices, setPendingThriftPrice } = useFlipStore();
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
  const effectiveThrift = parsedThrift > 0 ? parsedThrift : (_md?.suggested_buy_price ?? 0);

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
      thriftPrice: calc.thriftPrice, fees: calc.fees, profit: calc.profit,
      roi: calc.roi, buyScore: calc.buyScore, buyLabel: calc.buyLabel,
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

  const listings = hasGeneratedListings(currentScan.listings) ? currentScan.listings! : null;

  return (
    <ScreenContainer edges={['left', 'right', 'bottom']}>
      {/* Review prompt — appears after first successful scan */}
      {showReview && (
        <Modal transparent animationType="fade" visible statusBarTranslucent>
          <View style={{ flex: 1, backgroundColor: '#000000AA', justifyContent: 'center', alignItems: 'center', padding: 28 }}>
            <View style={{ backgroundColor: '#F0E8D4', borderRadius: 24, padding: 28, width: '100%', maxWidth: 360, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 12 }}>
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
                  setShowReview(false);
                  await onRequestedReview();
                  navigateHome();
                  await requestAppStoreReview(); // request after nav — non-blocking
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

      {/* Header — outside ScrollView so safe area is not double-applied */}
      <View style={[s.header, { paddingTop: insets.top + 4 }]}>
        <Pressable
          onPress={handleBackPress}
          hitSlop={8} style={({ pressed }) => [pressed && { opacity: 0.6 }]}
        >
          <MaterialIcons name="arrow-back" size={22} color={CREAM} />
        </Pressable>

        <View style={s.headerCenter}>
          <Text style={s.headerBrand}>FlipStart</Text>
          <View style={s.headerSubRow}>
            <Text style={s.headerStar}>✦</Text>
            <Text style={s.headerSub}>ANALYSIS</Text>
            <Text style={s.headerStar}>✦</Text>
          </View>
        </View>

        <Pressable onPress={handleDelete} hitSlop={8}>
          <MaterialIcons name="delete-outline" size={22} color={CREAM} />
        </Pressable>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={s.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >

          {/* ── 1. Item Identity Card — large and prominent ── */}
          <View style={s.card}>
            <View style={s.itemRow}>
              {/* Tappable image */}
              <Pressable
                onPress={() => currentScan.imageUri && setImageModalOpen(true)}
                style={({ pressed }) => [s.thumbWrap, pressed && { opacity: 0.88 }]}
              >
                {currentScan.imageUri
                  ? <Image source={{ uri: currentScan.imageUri }} style={s.thumb} contentFit="cover" transition={200} />
                  : <View style={[s.thumb, s.thumbFallback]}><MaterialIcons name="checkroom" size={32} color={MUTED} /></View>
                }
                {currentScan.imageUri && (
                  <View style={s.thumbExpandHint}>
                    <MaterialIcons name="zoom-in" size={11} color={CREAM} />
                  </View>
                )}
              </Pressable>

              <View style={s.itemInfo}>
                <Text style={s.itemName} numberOfLines={2}>{id.item_name}</Text>
                <Text style={s.itemMeta}>{id.brand} · {id.category}</Text>
                {id.estimated_era && id.estimated_era !== 'Unknown' && id.estimated_era !== 'Insufficient evidence' && (
                  <Text style={s.itemEra}>{id.estimated_era}</Text>
                )}
                {ra.match_confidence > 0 && (
                  <View style={[s.confBadge, { backgroundColor: confBadge.color + '18', borderColor: confBadge.color + '50' }]}>
                    <Text style={[s.confBadgeText, { color: confBadge.color }]}>
                      {ra.match_confidence}% CONFIDENCE
                    </Text>
                    <Text style={[s.confBadgeSub, { color: confBadge.color }]}>{confBadge.text}</Text>
                  </View>
                )}
              </View>
            </View>
          </View>

          {/* ── 2. Decision Card ── */}
          <View style={[s.decisionCard, { backgroundColor: theme.bg, borderColor: theme.border }]}>
            <View style={s.decisionLeft}>
              <MaterialIcons name={theme.icon as any} size={30} color={theme.iconColor} />
            </View>
            <View style={s.decisionMid}>
              <Text style={[s.decisionLabel, { color: theme.textColor }]}>
                {rec.displayLabel.toUpperCase()}
              </Text>
              <Text style={[s.decisionReason, { color: theme.dimColor }]} numberOfLines={2}>
                {rec.headline}
              </Text>
              <Text style={[s.decisionMaxBuy, { color: theme.dimColor }]}>
                Only buy for ${Math.max(1, md.suggested_buy_price)} or less
              </Text>
            </View>
            <View style={s.decisionRight}>
              <Text style={[s.decisionProfitLabel, { color: theme.dimColor }]}>EST. PROFIT</Text>
              <Text style={[s.decisionProfit, { color: theme.textColor }]}>
                {calc.profit >= 0 ? '+' : ''}{calc.profit < 0 ? `-$${Math.abs(calc.profit)}` : `$${calc.profit}`}
              </Text>
            </View>
          </View>

          {/* ── 3. Quick Summary (with icons) ── */}
          <View style={s.card}>
            <Text style={s.sectionLabel}>QUICK SUMMARY</Text>
            <View style={s.summaryRow}>
              {[
                { label: 'Est. Profit', value: `${calc.profit >= 0 ? '+' : '-'}$${Math.abs(calc.profit)}`, color: profitColor,    icon: 'attach-money'   },
                { label: 'ROI',         value: calc.roi > 0 ? `${calc.roi}%` : '—',                         color: calc.roi >= 50 ? '#2A5A2A' : BROWN, icon: 'show-chart' },
                { label: 'Competition', value: md.competition_level || '—',                                  color: (md.competition_level||'').toLowerCase() === 'high' ? '#8A3A2A' : '#2A5A2A', icon: 'group' },
                { label: 'Sell Speed',  value: md.sell_speed || '—',                                        color: (md.sell_speed||'').toLowerCase() === 'slow' ? '#8A3A2A' : '#2A5A2A',        icon: 'speed'  },
              ].map(m => (
                <View key={m.label} style={s.summaryBox}>
                  <MaterialIcons name={m.icon as any} size={18} color={m.color} style={{ marginBottom: 2 }} />
                  <Text style={[s.summaryValue, { color: m.color }]}>{m.value}</Text>
                  <Text style={s.summaryLabel}>{m.label}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* ── 4. Why This Rating ── */}
          <View style={s.card}>
            <Text style={s.sectionLabel}>WHY THIS RATING?</Text>
            {whyBullets.map((b, i) => (
              <View key={i} style={s.bulletRow}>
                <Text style={s.bulletDot}>•</Text>
                <Text style={s.bulletText}>{b}</Text>
              </View>
            ))}
          </View>

          {/* ── 5. Deep Analysis CTA — prominent, after Why, before Market Value ── */}
          <Pressable onPress={handleOpenAnalysis} style={({ pressed }) => [s.deepCtaCard, pressed && { opacity: 0.88 }]}>
            <View style={s.deepCtaInner}>
              <View style={s.deepCtaTextCol}>
                <Text style={s.deepCtaTitle}>WANT MORE DETAILS?</Text>
                <Text style={s.deepCtaSub}>Price breakdown · Platform data · Item details</Text>
              </View>
              <View style={s.deepCtaArrow}>
                <Text style={s.deepCtaLink}>View Deep Analysis</Text>
                <MaterialIcons name="chevron-right" size={18} color={FOREST} />
              </View>
            </View>
          </Pressable>

          {/* ── 6. Market Value ── */}
          <View style={s.card}>
            <Text style={s.sectionLabel}>MARKET VALUE</Text>
            <View style={s.marketRow}>
              <View style={s.marketBox}>
                <Text style={s.marketLabel}>AVERAGE SOLD</Text>
                <Text style={s.marketValue}>${md.average_sold_price || '—'}</Text>
              </View>
              <View style={[s.marketBox, s.marketBoxMid]}>
                <Text style={s.marketLabel}>MARKET RANGE</Text>
                <Text style={s.marketValue}>${md.estimated_resale_range?.low}–${md.estimated_resale_range?.high}</Text>
              </View>
              <View style={s.marketBox}>
                <Text style={s.marketLabel}>EST. RESALE</Text>
                <Text style={s.marketValue}>${md.adjusted_estimated_value}</Text>
              </View>
            </View>
          </View>

          {/* ── 7. Your Price ── */}
          <View style={s.card}>
            <Text style={s.sectionLabel}>YOUR PRICE</Text>
            <View style={s.priceRow}>
              <Text style={s.priceHint}>Your thrift price</Text>
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
                  style={s.priceDisplay}
                >
                  <Text style={s.priceDisplayText}>${parsedThrift > 0 ? parsedThrift : md.suggested_buy_price}</Text>
                  <MaterialIcons name="edit" size={14} color={FOREST} />
                </Pressable>
              )}
            </View>
            <Text style={s.priceAutoNote}>✓ All values update automatically</Text>
          </View>

          {/* ── 8. Actions ── */}
          <View style={s.actionsRow}>
            <Pressable
              onPress={handleGenerateListings}
              disabled={listingsLoading}
              style={({ pressed }) => [s.actionOutline, pressed && { opacity: 0.8 }]}
            >
              {listingsLoading
                ? <MaterialIcons name="hourglass-empty" size={17} color={FOREST} />
                : <MaterialIcons name="edit-note" size={17} color={FOREST} />}
              <Text style={s.actionOutlineText}>
                {listingsLoading ? 'Generating…' : hasGeneratedListings(listings) ? 'View Listings' : 'Generate Listings'}
              </Text>
            </Pressable>

            <Pressable
              onPress={handleConfirm}
              disabled={isSaved}
              style={({ pressed }) => [
                s.actionSolid,
                pressed && !isSaved && { opacity: 0.88, transform: [{ scale: 0.97 }] },
                isSaved && { backgroundColor: '#2A5A2A', opacity: 0.85 },
              ]}
            >
              <MaterialIcons name={isSaved ? 'check' : 'bookmark'} size={17} color={CREAM} />
              <Text style={s.actionSolidText}>{isSaved ? 'Saved' : 'Save to History'}</Text>
            </Pressable>
          </View>

          {listingsError && (
            <Text style={s.listingsErrText}>Couldn't generate listings. Tap to retry.</Text>
          )}

          {/* Beta feedback card */}
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
            recommendation={calc.recommendation?.label ?? 'SKIP'}
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
    paddingHorizontal: 18, paddingTop: 14, paddingBottom: 14,
    backgroundColor: FOREST,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15, shadowRadius: 4, elevation: 4,
  },
  // Header center branding
  headerCenter:  { alignItems: 'center', gap: 2 },
  headerBrand:   { fontFamily: FONTS.serif, fontSize: 22, fontWeight: '800', color: CREAM, letterSpacing: 0.3 },
  headerSubRow:  { flexDirection: 'row', alignItems: 'center', gap: 5 },
  headerSub:     { fontSize: 14, fontWeight: '700', color: GOLD, letterSpacing: 2.0, textTransform: 'uppercase' },
  headerStar:    { fontSize: 14, color: GOLD },

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
  thumbFallback: { backgroundColor: '#EDE0C4', justifyContent: 'center', alignItems: 'center' },
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

  // Your price
  priceRow:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  priceHint:      { fontSize: 13, color: BROWN },
  priceInputWrap: { flexDirection: 'row', alignItems: 'center', borderRadius: 8, borderWidth: 1.5, borderColor: FOREST, paddingHorizontal: 10, paddingVertical: 6, gap: 2 },
  priceDollar:    { fontSize: 15, fontWeight: '700', color: FOREST },
  priceInput:     { fontSize: 18, fontWeight: '800', color: FOREST, minWidth: 70, padding: 0 },
  priceDisplay:   { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 8, borderWidth: 1.5, borderColor: CARD_B, paddingHorizontal: 12, paddingVertical: 7 },
  priceDisplayText: { fontFamily: FONTS.serif, fontSize: 18, fontWeight: '800', color: FOREST },
  priceAutoNote:  { fontSize: 10, color: MUTED, marginTop: 6, fontStyle: 'italic' },

  // Actions
  actionsRow:      { flexDirection: 'row', gap: 10, marginHorizontal: 14, marginTop: 14 },
  actionOutline:   { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 14, borderRadius: 10, borderWidth: 1.5, borderColor: FOREST, backgroundColor: CARD },
  actionOutlineText: { fontSize: 13, fontWeight: '700', color: FOREST, fontFamily: FONTS.serif },
  actionSolid:     { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 14, borderRadius: 10, backgroundColor: FOREST },
  actionSolidText: { fontSize: 13, fontWeight: '700', color: CREAM, fontFamily: FONTS.serif },
  listingsErrText: { fontSize: 11, color: '#8A3A2A', textAlign: 'center', marginTop: 6 },
});
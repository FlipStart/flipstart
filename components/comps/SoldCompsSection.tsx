/**
 * components/comps/SoldCompsSection.tsx
 *
 * The finished Sold Comps section.
 *
 * ── Contract discipline ───────────────────────────────────────────────────────
 * Reads ONLY the public contract: displayMatches, publicStats, confidenceLabel,
 * confidencePercent, countSummary, source. Never debugMatches, never a raw
 * median, never a rejection reason. Rendering correctly without any debug field
 * present is a hard requirement, and the test suite asserts it.
 *
 * ── Card width ───────────────────────────────────────────────────────────────
 * Sized so roughly 1.7 cards sit in view: big enough to compare a logo or a
 * graphic against the item in hand, small enough that the second card's edge
 * shows and the swipe is discoverable without a hint.
 */
import React, { useMemo, useState } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet, ActivityIndicator,
  useWindowDimensions, AccessibilityInfo,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { C, marketplaceLabel } from './tokens';
import { SoldCompCard, type PublicMatch } from './SoldCompCard';
import { SoldCompMetrics, SoldCompConfidence, type PublicStats } from './SoldCompMetrics';
import { SoldCompsUnavailableState, type UnavailableVariant } from './SoldCompsUnavailableState';

export type PublicAvailability =
  | 'available' | 'limited' | 'no_reliable_matches'
  | 'insufficient_item_details' | 'temporarily_unavailable' | 'legacy_unavailable';

export interface SoldCompsResponse {
  ok?: boolean;
  /** Phase 5. The server's safe category — the screen no longer infers meaning
   *  from `ok`, empty arrays or internal error codes, and internal codes are no
   *  longer sent at all. */
  availability?: {
    state: PublicAvailability;
    reviewedCount: number | null;
    filteredOutCount: number | null;
    searchPerformed: boolean;
  } | null;
  displayMatches?: PublicMatch[] | null;
  publicStats?: PublicStats | null;
  confidenceLabel?: 'high' | 'moderate' | 'low' | 'insufficient' | null;
  confidencePercent?: number | null;
  countSummary?: { summaryText: string } | null;
  source?: { marketplaces: string[] } | null;
  query?: string | null;
  historyDays?: number | null;
  cacheHit?: boolean;
}

/** Section horizontal padding inside the results card. */
const PAD = 14;
/** Fraction of available width per card — yields ~1.7 cards in view. */
const CARD_FRACTION = 0.52;
const CARD_MIN = 132;
const CARD_MAX = 210;

export function SoldCompsSection({
  loading, data,
}: { loading: boolean; data: SoldCompsResponse | null }) {
  const { width: screenW } = useWindowDimensions();
  const [infoOpen, setInfoOpen] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  React.useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => sub?.remove?.();
  }, []);

  // Results cards sit inside 14px page margins; the section adds its own.
  const available = Math.max(240, screenW - PAD * 2 - PAD * 2);
  const cardW = useMemo(
    () => Math.round(Math.max(CARD_MIN, Math.min(CARD_MAX, available * CARD_FRACTION))),
    [available],
  );

  const matches = (data?.displayMatches ?? []).slice(0, 3);   // defensive cap
  const stats = data?.publicStats ?? null;

  /**
   * Which final state, if any.
   *
   * Driven by the server category rather than inferred from `ok` or an empty
   * array, so an unknown future reason maps safely instead of rendering
   * something wrong. A missing `availability` on a historical record falls to
   * the legacy state.
   */
  const availability = data?.availability?.state
    ?? (data == null ? 'legacy_unavailable' : data.ok === false ? 'temporarily_unavailable' : null);
  const unavailableVariant: UnavailableVariant | null =
    matches.length > 0 ? null
    : availability === 'no_reliable_matches' ? 'no_reliable_matches'
    : availability === 'insufficient_item_details' ? 'insufficient_item_details'
    : availability === 'legacy_unavailable' ? 'legacy_unavailable'
    : availability === 'temporarily_unavailable' ? 'temporarily_unavailable'
    : availability === 'available' || availability === 'limited' ? 'no_reliable_matches'
    : 'temporarily_unavailable';

  /**
   * Source badge honesty.
   *
   * Shown only when a search actually ran. A timeout or an identity failure
   * never consulted eBay, and a badge would imply marketplace data was
   * retrieved when none was.
   */
  const searchPerformed = data?.availability?.searchPerformed ?? (matches.length > 0);
  const markets = searchPerformed ? (data?.source?.marketplaces ?? []) : [];
  const sourceLabels = markets.map(marketplaceLabel).filter(Boolean) as string[];

  return (
    <View style={s.section}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <View style={s.headerRow}>
        <Text style={s.title}>Recent Sold Comps</Text>
        <View style={s.headerRight}>
          {/* Real eBay logo, replacing the text pill.
              Still driven by server source metadata — an unknown marketplace
              renders NOTHING rather than defaulting to eBay. */}
          {markets.map(key => {
            const label = marketplaceLabel(key);
            if (!label) return null;                    // unknown: no badge
            if (key.toLowerCase() === 'ebay') {
              return (
                <View key={key} style={s.logoBadge}>
                  <Image
                    source={require('@/assets/images/logos/ebay.png')}
                    /* Fixed height, width from the asset's own ratio — the eBay
                       mark is ~2.5:1 and must never be stretched or recoloured. */
                    style={s.ebayLogo}
                    contentFit="contain"
                    accessibilityLabel="Sold comp source: eBay"
                  />
                </View>
              );
            }
            // Any other supported marketplace keeps the compact text treatment.
            return (
              <View key={key} style={s.sourceBadge}>
                <Text style={s.sourceText} accessibilityLabel={`Sold comp source: ${label}`}>{label}</Text>
              </View>
            );
          })}
          <Pressable
            onPress={() => setInfoOpen(v => !v)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="About sold comps"
          >
            <MaterialIcons name="info-outline" size={17} color={C.muted} />
          </Pressable>
        </View>
      </View>

      {infoOpen && (
        <View style={s.info}>
          <Text style={s.infoText}>
            FlipStart reviews recent sold listings and filters out weak or mismatched
            results. The cards below are the closest matches it found. Statistics may
            use more reliable matches than the cards shown. Sold comps show what
            similar items sold for — not a guarantee for yours.
          </Text>
          {!!data?.query && (
            <Text style={s.infoMeta}>Matched using “{data.query}”{data.historyDays ? ` · last ${data.historyDays} days` : ''}</Text>
          )}
        </View>
      )}

      {/* ── Loading ────────────────────────────────────────────────────────── */}
      {loading && (
        <View>
          <View style={s.skelRow}>
            {[0, 1].map(i => (
              <View key={i} style={[s.skelCard, { width: cardW }]}>
                <View style={[s.skelImage, { width: cardW, height: cardW }]} />
                <View style={s.skelLine} />
                <View style={[s.skelLine, { width: '55%' }]} />
              </View>
            ))}
          </View>
          <View style={s.loadingRow}>
            {!reduceMotion && <ActivityIndicator size="small" color={C.gold} />}
            <Text style={s.loadingText}>Checking recent sold listings…</Text>
          </View>
        </View>
      )}

      {/* ── Final states ────────────────────────────────────────────────────
          Shown only when there are ZERO usable cards. One reliable match is not
          a failure — replacing a real card with a sad face would discard
          evidence the user could have looked at. */}
      {!loading && unavailableVariant && (
        <SoldCompsUnavailableState
          variant={unavailableVariant}
          reviewedCount={data?.availability?.reviewedCount ?? null}
          filteredOutCount={data?.availability?.filteredOutCount ?? null}
        />
      )}

      {/* ── Carousel ───────────────────────────────────────────────────────── */}
      {!loading && matches.length > 0 && (
        <>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            /* Order comes from the server, ranked by similarity. Never re-sorted
               here by price or image presence. */
            contentContainerStyle={s.carousel}
            /* Lets the vertical page keep scrolling when the gesture is vertical. */
            directionalLockEnabled
          >
            {matches.map(m => (
              <SoldCompCard key={m.id} match={m} width={cardW} />
            ))}
          </ScrollView>
          {matches.length === 3 && (
            <Text style={s.affordance}>Showing the three closest matches</Text>
          )}
        </>
      )}

      {/* ── Metrics + confidence ───────────────────────────────────────────── */}
      {!loading && stats && matches.length > 0 && (
        <>
          <SoldCompMetrics
            stats={stats}
            currency={matches[0]?.soldPrice.currency ?? 'USD'}
          />
          <SoldCompConfidence
            label={data?.confidenceLabel ?? null}
            percent={data?.confidencePercent ?? null}
            summaryText={data?.countSummary?.summaryText ?? null}
          />
          {/* Limited data with real cards on screen: a note, not a failure. The
              zero-card case is handled by the final state above. */}
          {!stats.canShowMedian && stats.reliableMatchCount > 0 && (
            <Text style={s.stateCopy}>
              Limited sold data — not enough close matches for a full market range.
              The FlipStart estimate above still applies.
            </Text>
          )}
        </>
      )}

      {/* Provider failure, identity failure and legacy scans are all handled by
          the final state above — the Phase 4 plain-text fallbacks are gone. */}
    </View>
  );
}

const s = StyleSheet.create({
  section: { backgroundColor: C.card, borderRadius: 16, borderWidth: 1.25, borderColor: C.gold + '55',
             paddingHorizontal: PAD, paddingTop: 13, paddingBottom: 14,
             marginTop: 10, marginHorizontal: PAD },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { fontSize: 15.5, fontWeight: '800', color: C.forest, flexShrink: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  sourceBadge: { backgroundColor: C.cream, borderRadius: 999, borderWidth: 1,
                 borderColor: C.gold + '66', paddingHorizontal: 8, paddingVertical: 2.5 },
  /* Cream/gold surround ties the brand mark into the FlipStart palette without
     recolouring the logo itself. Deliberately smaller than the section title. */
  logoBadge:   { backgroundColor: C.cream, borderRadius: 8, borderWidth: 1,
                 borderColor: C.gold + '66', paddingHorizontal: 7, paddingVertical: 4,
                 justifyContent: 'center' },
  ebayLogo:    { width: 42, height: 17 },
  sourceText: { fontSize: 10, fontWeight: '800', color: C.brown },
  info: { backgroundColor: C.cream, borderRadius: 11, padding: 10, marginTop: 9, gap: 6 },
  infoText: { fontSize: 11.5, color: C.brown, lineHeight: 16.5 },
  infoMeta: { fontSize: 10, color: C.muted, fontStyle: 'italic' },
  carousel: { gap: 10, paddingTop: 12, paddingRight: 4 },
  affordance: { fontSize: 10, color: C.muted, fontStyle: 'italic', marginTop: 7 },
  skelRow: { flexDirection: 'row', gap: 10, paddingTop: 12 },
  skelCard: { gap: 7 },
  skelImage: { backgroundColor: C.placeholder, borderRadius: 12 },
  skelLine: { height: 9, borderRadius: 5, backgroundColor: C.placeholder, width: '85%' },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 11 },
  loadingText: { fontSize: 12, color: C.muted, fontStyle: 'italic' },
  stateCopy: { fontSize: 11.5, color: C.brown, lineHeight: 16.5, marginTop: 10 },
});
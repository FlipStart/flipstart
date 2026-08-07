/**
 * components/comps/SoldCompCard.tsx
 *
 * One sold comp. Image, marketplace, full title, sold price.
 *
 * Reads ONLY the Phase 3 public contract — never debugMatches, never a raw
 * provider object, never a score component. The section must render correctly
 * with debug data entirely absent.
 */
import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { MaterialIcons } from '@expo/vector-icons';
import { C, CARD_RADIUS, formatMoney, formatSoldDate, marketplaceLabel } from './tokens';

export interface PublicMatch {
  id: string;
  buyerPaidTotal?: { amount: number; currency: string } | null;
  marketplace: string;
  fullTitle: string;
  primaryImageUrl: string | null;
  imageStatus: string;
  soldPrice: { amount: number; currency: string };
  shippingPrice: { amount: number; currency: string } | null;
  soldAt: string | null;
  bestOfferAccepted: boolean | null;
  matchScore: number;
  matchClass: string;
}

/** Collapsed preview length. Beyond this a More control appears. */
const TITLE_LINES = 3;

export function SoldCompCard({
  match, width, onExpandChange,
}: {
  match: PublicMatch;
  width: number;
  onExpandChange?: (expanded: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  // Tracked locally so a dead URL swaps to the placeholder instead of showing a
  // broken-image glyph. Never reported to the server — image loading is the
  // client's business.
  const [imgFailed, setImgFailed] = useState(false);

  const showImage = Boolean(match.primaryImageUrl) && !imgFailed;
  const market = marketplaceLabel(match.marketplace);
  const soldDate = formatSoldDate(match.soldAt);

  // A provider record with no usable price is not a comp. Rendering "$0" would
  // read as a real sale for nothing, which is worse than saying nothing.
  const hasPrice = Number.isFinite(match.soldPrice?.amount) && match.soldPrice.amount > 0;
  const price = hasPrice
    ? formatMoney(match.soldPrice.amount, match.soldPrice.currency)
    : null;

  // A title should always exist, but a malformed record must not render a blank
  // card with no way to tell what it was.
  const title = match.fullTitle?.trim() || 'Listing title unavailable';
  const titleOverflows = title.length > 60;

  // ── Shipping ──────────────────────────────────────────────────────────────
  // Zero is meaningful, not missing: free shipping is a real and useful fact
  // about a sale. "+$0 ship" said the same thing badly.
  const ship = match.shippingPrice;
  const shipText = ship == null || !Number.isFinite(ship.amount)
    ? null
    : ship.amount === 0
      ? 'Free shipping'
      : `+${formatMoney(ship.amount, ship.currency)} shipping`;

  // ── Buyer-paid total ──────────────────────────────────────────────────────
  // Shown only when it differs meaningfully from the sold price, and only in the
  // expanded state. On a collapsed card it would sit next to the sold price and
  // invite reading the larger number as the sale — the exact confusion the
  // separate fields exist to prevent. Never computed here; server-supplied only.
  const total = match.buyerPaidTotal;
  const totalText = total != null && Number.isFinite(total.amount) && hasPrice &&
                    Math.abs(total.amount - match.soldPrice.amount) >= 0.01
    ? `Buyer paid ${formatMoney(total.amount, total.currency)} total`
    : null;

  /**
   * Expansion is a general DETAILS state, not a long-title state.
   *
   * It was gated on title length, which left a hole: a comp with a short title
   * and a buyer-paid total had no control to reveal, so the total was
   * unreachable. Either a clipped title or extra details now earns the control,
   * and the label says which — "More" for a truncated title, "Details" when the
   * title fits but there is something else to show.
   */
  const hasExtraDetails = Boolean(totalText);
  const canExpand = titleOverflows || hasExtraDetails;
  const expandLabel = expanded ? 'Less' : titleOverflows ? 'More' : 'Details';

  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    onExpandChange?.(next);
  };

  return (
    <View
      style={[s.card, { width }]}
      accessible
      accessibilityLabel={
        `${market ?? 'Marketplace'} sold comp. ${title}. ` +
        `${hasPrice ? `Sold for ${price}.` : 'Sold price unavailable.'} ${match.matchClass} match.`
      }
    >
      <View style={[s.imageWrap, { width, height: width }]}>
        {showImage ? (
          <Image
            source={{ uri: match.primaryImageUrl as string }}
            style={{ width, height: width }}
            contentFit="cover"
            transition={150}
            onError={() => setImgFailed(true)}
            accessibilityLabel={title}
          />
        ) : (
          /* Same dimensions as a loaded image, so nothing shifts when one comp
             has a photo and another does not. A strong comp with no image is
             still a strong comp. */
          <View style={[s.placeholder, { width, height: width }]}
                accessibilityLabel="Listing image unavailable">
            <MaterialIcons name="image-not-supported" size={26} color={C.muted} />
            <Text style={s.placeholderText}>Image unavailable</Text>
          </View>
        )}

        {!!market && (
          <View style={s.marketBadge}>
            <Text style={s.marketText} accessibilityLabel={`Sold on ${market}`}>{market}</Text>
          </View>
        )}
      </View>

      <View style={s.body}>
        <Pressable
          onPress={canExpand ? toggle : undefined}
          hitSlop={10}
          accessibilityRole={canExpand ? 'button' : undefined}
          accessibilityLabel={canExpand
            ? (expanded
                ? 'Collapse listing details'
                : titleOverflows ? 'Show full listing title and details' : 'Show listing details')
            : undefined}
        >
          <Text style={s.title} numberOfLines={expanded ? undefined : TITLE_LINES}>
            {title}
          </Text>
          {canExpand && <Text style={s.more}>{expandLabel}</Text>}
        </Pressable>

        {/* Sold price: the brightest thing on the card. "Sold for" makes it
            unambiguous that this is a completed sale, not an ask. */}
        {hasPrice ? (
          <Text style={s.price} accessibilityLabel={`Sold for ${price}`}>
            Sold for <Text style={s.priceValue}>{price}</Text>
          </Text>
        ) : (
          <Text style={s.priceMissing}>Sold price unavailable</Text>
        )}

        {/* Secondary details. Kept to one wrapped row so nothing competes with
            the sold price. */}
        <View style={s.detailRow}>
          {!!soldDate && (
            <Text style={s.detail} accessibilityLabel={`Sold on ${soldDate}`}>Sold {soldDate}</Text>
          )}
          {!!shipText && (
            <Text style={s.detail} accessibilityLabel={
              shipText === 'Free shipping' ? 'Free shipping'
                : `Plus ${formatMoney(ship!.amount, ship!.currency)} shipping, charged separately`
            }>{shipText}</Text>
          )}
          {match.bestOfferAccepted === true && (
            <Text style={s.detailBadge} accessibilityLabel="Best Offer accepted">Best Offer</Text>
          )}
        </View>

        {/* Tertiary, expanded only. */}
        {expanded && !!totalText && (
          <Text style={s.detailTertiary} accessibilityLabel={totalText}>{totalText}</Text>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: C.card, borderRadius: CARD_RADIUS, borderWidth: 1,
          borderColor: C.cardB, overflow: 'hidden' },
  imageWrap: { backgroundColor: C.placeholder, position: 'relative' },
  placeholder: { alignItems: 'center', justifyContent: 'center', gap: 5 },
  placeholderText: { fontSize: 10, color: C.muted, fontWeight: '600' },
  marketBadge: { position: 'absolute', top: 7, left: 7, backgroundColor: 'rgba(255,254,250,0.94)',
                 borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2.5,
                 borderWidth: 1, borderColor: C.cardB },
  marketText: { fontSize: 9.5, fontWeight: '800', color: C.brown, letterSpacing: 0.2 },
  body: { paddingHorizontal: 10, paddingTop: 8, paddingBottom: 10, gap: 4 },
  title: { fontSize: 11.5, color: C.brown, lineHeight: 15.5, fontWeight: '600' },
  more: { fontSize: 10.5, color: C.gold, fontWeight: '800', marginTop: 2 },
  price: { fontSize: 11, color: C.muted, fontWeight: '700', marginTop: 2 },
  priceValue: { fontSize: 16, color: C.soldGreen, fontWeight: '800' },
  priceMissing: { fontSize: 12, color: C.muted, fontStyle: 'italic', fontWeight: '600', marginTop: 2 },
  detailRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, alignItems: 'center' },
  detail: { fontSize: 10, color: C.muted },
  detailBadge: { fontSize: 9, fontWeight: '800', color: C.brown, backgroundColor: C.cream,
                 borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1.5,
                 borderWidth: 0.75, borderColor: C.gold + '66' },
  detailTertiary: { fontSize: 9.5, color: C.muted, marginTop: 3, fontStyle: 'italic' },
});
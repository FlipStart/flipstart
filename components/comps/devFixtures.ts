/**
 * components/comps/devFixtures.ts
 *
 * Mock PUBLIC-contract responses for the development preview harness.
 *
 * Every fixture is shaped exactly like a real `comps.forScan` response, so the
 * preview drives the production components rather than a parallel fake. If a
 * fixture renders correctly here and wrongly in production, the contract has
 * drifted — which is itself the signal worth having.
 *
 * Contains no debug fields, no rejected candidates, no provider objects. A
 * rejected Yankees listing belongs in a server test, never in a UI fixture: it
 * would suggest the public contract can carry one, and it cannot.
 */
import type { SoldCompsResponse } from './SoldCompsSection';
import type { PublicMatch } from './SoldCompCard';

/**
 * Deterministically unreachable, so the image-error path fires the same way
 * every time. A real-looking host that will never resolve beats waiting for a
 * flaky network to misbehave on cue.
 */
export const BROKEN_IMAGE_URL =
  'https://i.ebayimg.example.invalid/images/g/deliberately-unreachable/s-l500.jpg';

const IMG = 'https://i.ebayimg.com/images/g/mock/s-l500.jpg';

const m = (o: Partial<PublicMatch> & { id: string }): PublicMatch => ({
  marketplace: 'ebay',
  fullTitle: "Polo by Ralph Lauren Men's Navy Full Zip Hoodie Large",
  primaryImageUrl: IMG,
  imageStatus: 'available',
  soldPrice: { amount: 30, currency: 'USD' },
  shippingPrice: { amount: 8, currency: 'USD' },
  buyerPaidTotal: { amount: 38, currency: 'USD' },
  soldAt: '2026-07-22',
  bestOfferAccepted: false,
  matchScore: 88,
  matchClass: 'strong',
  ...o,
});

const stats = (o: Partial<SoldCompsResponse['publicStats'] & object> = {}) => ({
  medianSoldPrice: null, typicalLow: null, typicalHigh: null,
  reliableMatchCount: 1, canShowMedian: false, canShowTypicalRange: false,
  limitedSample: false, ...o,
});

/** Availability block for a successful search. */
const avail = (state: NonNullable<SoldCompsResponse['availability']>['state'],
               reviewed: number | null = 100, filtered: number | null = 99,
               searched = true) =>
  ({ state, reviewedCount: reviewed, filteredOutCount: filtered, searchPerformed: searched });

const base = (o: Partial<SoldCompsResponse> = {}): SoldCompsResponse => ({
  ok: true,
  availability: avail('limited'),
  displayMatches: [m({ id: 'a' })],
  publicStats: stats(),
  confidenceLabel: 'low',
  confidencePercent: 35,
  countSummary: { summaryText: '100 sold listings reviewed · 1 possible match' },
  source: { marketplaces: ['ebay'] },
  query: 'Polo by Ralph Lauren zip-up hoodie navy',
  historyDays: 90,
  cacheHit: false,
  ...o,
});

const LONG_TITLE =
  "Vintage Polo by Ralph Lauren Men's Navy Blue Full Zip Hooded Sweatshirt Hoodie " +
  "Embroidered Pony Logo Size Large L Cotton Blend Excellent Pre-Owned Condition NWOT";

export interface Fixture {
  key: string;
  name: string;
  loading?: boolean;
  data: SoldCompsResponse | null;
}

export const FIXTURES: Fixture[] = [
  { key: 'loading', name: '1 · Loading', loading: true, data: null },

  { key: 'one-img', name: '2 · One match, with image', data: base() },
  { key: 'one-noimg', name: '3 · One match, no image',
    data: base({ displayMatches: [m({ id: 'a', primaryImageUrl: null, imageStatus: 'missing' })] }) },
  { key: 'one-broken', name: '4 · One match, image FAILS to load',
    data: base({ displayMatches: [m({ id: 'a', primaryImageUrl: BROKEN_IMAGE_URL })] }) },

  { key: 'two', name: '5 · Two matches',
    data: base({
      displayMatches: [m({ id: 'a' }), m({ id: 'b', soldPrice: { amount: 34, currency: 'USD' } })],
      publicStats: stats({ reliableMatchCount: 2 }),
      countSummary: { summaryText: '100 sold listings reviewed · 2 possible matches' },
    }) },

  { key: 'three', name: '6 · Three matches',
    data: base({
      displayMatches: [
        m({ id: 'a' }),
        m({ id: 'b', soldPrice: { amount: 34, currency: 'USD' }, matchScore: 82, matchClass: 'moderate' }),
        m({ id: 'c', soldPrice: { amount: 28, currency: 'USD' }, matchScore: 76, matchClass: 'moderate' }),
      ],
      publicStats: stats({ reliableMatchCount: 3, canShowMedian: true, medianSoldPrice: 30, limitedSample: true }),
      confidenceLabel: 'moderate', confidencePercent: 58,
      countSummary: { summaryText: '100 sold listings reviewed · 92 filtered out · 3 reliable matches' },
    }) },

  { key: 'three-oneimg', name: '7 · Three matches, one image missing',
    data: base({
      displayMatches: [
        m({ id: 'a' }),
        m({ id: 'b', primaryImageUrl: null, imageStatus: 'missing' }),
        m({ id: 'c' }),
      ],
      publicStats: stats({ reliableMatchCount: 3, canShowMedian: true, medianSoldPrice: 30, limitedSample: true }),
    }) },

  { key: 'three-noimg', name: '8 · Three matches, ALL images missing',
    data: base({
      displayMatches: ['a', 'b', 'c'].map(id => m({ id, primaryImageUrl: null, imageStatus: 'missing' })),
      publicStats: stats({ reliableMatchCount: 3, canShowMedian: true, medianSoldPrice: 30, limitedSample: true }),
    }) },

  { key: 'long-titles', name: '9 · Three long titles',
    data: base({
      displayMatches: ['a', 'b', 'c'].map(id => m({ id, fullTitle: LONG_TITLE })),
      publicStats: stats({ reliableMatchCount: 3, canShowMedian: true, medianSoldPrice: 30, limitedSample: true }),
    }) },

  { key: 'extreme-title', name: '10 · One extremely long title (More/Less)',
    data: base({ displayMatches: [m({ id: 'a', fullTitle: `${LONG_TITLE} ${LONG_TITLE}` })] }) },

  { key: 'strong', name: '11 · STRONG — median + range + high confidence',
    data: base({
      displayMatches: [
        m({ id: 'a', soldPrice: { amount: 32, currency: 'USD' }, matchScore: 94 }),
        m({ id: 'b', soldPrice: { amount: 29, currency: 'USD' }, matchScore: 90 }),
        m({ id: 'c', soldPrice: { amount: 36, currency: 'USD' }, matchScore: 87 }),
      ],
      publicStats: stats({
        reliableMatchCount: 7, canShowMedian: true, canShowTypicalRange: true,
        medianSoldPrice: 32, typicalLow: 28, typicalHigh: 38, limitedSample: false,
      }),
      confidenceLabel: 'high', confidencePercent: 84,
      countSummary: { summaryText: '100 sold listings reviewed · 93 filtered out · 7 reliable matches' },
    }) },

  { key: 'moderate', name: '12 · Moderate sample',
    data: base({
      displayMatches: [m({ id: 'a' }), m({ id: 'b' }), m({ id: 'c' })],
      publicStats: stats({
        reliableMatchCount: 5, canShowMedian: true, canShowTypicalRange: true,
        medianSoldPrice: 31, typicalLow: 24, typicalHigh: 42,
      }),
      confidenceLabel: 'moderate', confidencePercent: 64,
      countSummary: { summaryText: '100 sold listings reviewed · 95 filtered out · 5 reliable matches' },
    }) },

  { key: 'ninety', name: '13 · 90 reliable — still only 3 cards',
    data: base({
      displayMatches: [m({ id: 'a' }), m({ id: 'b' }), m({ id: 'c' })],
      publicStats: stats({
        reliableMatchCount: 90, canShowMedian: true, canShowTypicalRange: true,
        medianSoldPrice: 33, typicalLow: 27, typicalHigh: 41,
      }),
      confidenceLabel: 'high', confidencePercent: 88,
      countSummary: { summaryText: '240 sold listings reviewed · 150 filtered out · 90 reliable matches' },
    }) },

  { key: 'weak', name: '14 · WEAK — no eligible statistics',
    data: base({
      displayMatches: [m({ id: 'a', matchScore: 71, matchClass: 'moderate' })],
      publicStats: stats({ reliableMatchCount: 1 }),
      confidenceLabel: 'low', confidencePercent: 22,
    }) },

  // ── Phase 5 final states ──────────────────────────────────────────────────
  // Every one carries only a PUBLIC category. No internal code appears in any
  // fixture, because none is sent to the app any more.
  { key: 'nomatch-100', name: '15 · NO MATCHES — 100 reviewed',
    data: base({ availability: avail('no_reliable_matches', 100, 100),
                 displayMatches: [], publicStats: null,
                 confidenceLabel: 'insufficient', confidencePercent: 0 }) },

  { key: 'nomatch-150', name: '16 · NO MATCHES — 150 reviewed',
    data: base({ availability: avail('no_reliable_matches', 150, 148),
                 displayMatches: [], publicStats: null }) },

  { key: 'nomatch-nosource', name: '17 · NO MATCHES — unknown source',
    data: base({ availability: avail('no_reliable_matches', 100, 100),
                 displayMatches: [], publicStats: null,
                 source: { marketplaces: ['unknown'] } }) },

  { key: 'insufficient-details', name: '18 · INSUFFICIENT DETAILS (no search ran)',
    data: { ok: false, availability: avail('insufficient_item_details', null, null, false),
            displayMatches: [], publicStats: null, source: { marketplaces: [] } } },

  { key: 'provider-fail', name: '19 · Provider / network failure',
    data: { ok: false, availability: avail('temporarily_unavailable', null, null, false),
            displayMatches: [], publicStats: null, source: { marketplaces: ['ebay'] } } },

  { key: 'timeout', name: '20 · Provider timeout (same safe copy)',
    data: { ok: false, availability: avail('temporarily_unavailable', null, null, false),
            displayMatches: [], publicStats: null, source: { marketplaces: ['ebay'] } } },

  { key: 'budget-daily', name: '21 · Daily budget exhausted → safe copy',
    data: { ok: false, availability: avail('temporarily_unavailable', null, null, false),
            displayMatches: [], publicStats: null } },

  { key: 'budget-monthly', name: '22 · Monthly budget exhausted → safe copy',
    data: { ok: false, availability: avail('temporarily_unavailable', null, null, false),
            displayMatches: [], publicStats: null } },

  { key: 'disabled', name: '23 · Feature disabled → safe copy',
    data: { ok: false, availability: avail('temporarily_unavailable', null, null, false),
            displayMatches: [], publicStats: null } },

  { key: 'no-config', name: '24 · Provider not configured → safe copy',
    data: { ok: false, availability: avail('temporarily_unavailable', null, null, false),
            displayMatches: [], publicStats: null } },

  { key: 'legacy-p0', name: '25 · Legacy Phase 0 scan',
    data: { ok: false, availability: avail('legacy_unavailable', null, null, false),
            displayMatches: [], publicStats: null } },

  { key: 'legacy-p1', name: '26 · Legacy Phase 1 scan',
    data: { ok: false, availability: avail('legacy_unavailable', null, null, false),
            displayMatches: [], publicStats: null } },

  { key: 'unknown-market', name: '27 · Unknown marketplace (no badge)',
    data: base({ displayMatches: [m({ id: 'a', marketplace: 'unknown' })],
                 source: { marketplaces: ['unknown'] } }) },

  { key: 'gbp', name: '28 · GBP £42',
    data: base({ displayMatches: [m({ id: 'a', soldPrice: { amount: 42, currency: 'GBP' },
                 shippingPrice: { amount: 4, currency: 'GBP' },
                 buyerPaidTotal: { amount: 46, currency: 'GBP' } })] }) },

  { key: 'eur', name: '29 · EUR €35',
    data: base({ displayMatches: [m({ id: 'a', soldPrice: { amount: 35, currency: 'EUR' },
                 shippingPrice: null, buyerPaidTotal: null })] }) },

  { key: 'decimal', name: '30 · Decimal price $29.99',
    data: base({ displayMatches: [m({ id: 'a', soldPrice: { amount: 29.99, currency: 'USD' },
                 shippingPrice: { amount: 6.5, currency: 'USD' },
                 buyerPaidTotal: { amount: 36.49, currency: 'USD' } })] }) },

  { key: 'free-ship', name: '31 · Free shipping ($0)',
    data: base({ displayMatches: [m({ id: 'a', shippingPrice: { amount: 0, currency: 'USD' },
                 buyerPaidTotal: { amount: 30, currency: 'USD' } })] }) },

  { key: 'best-offer', name: '32 · Best Offer accepted',
    data: base({ displayMatches: [m({ id: 'a', bestOfferAccepted: true })] }) },

  { key: 'no-date', name: '33 · Missing sold date',
    data: base({ displayMatches: [m({ id: 'a', soldAt: null })] }) },

  { key: 'no-title', name: '34 · Missing title (fallback)',
    data: base({ displayMatches: [m({ id: 'a', fullTitle: '' })] }) },

  { key: 'no-price', name: '35 · Missing sold price (no $0)',
    data: base({ displayMatches: [m({ id: 'a', soldPrice: { amount: 0, currency: 'USD' } })] }) },

  { key: 'short-plus-total', name: '36 · SHORT title + buyer total (Details control)',
    data: base({ displayMatches: [m({ id: 'a', fullTitle: 'Polo Hoodie L',
                 soldPrice: { amount: 30, currency: 'USD' },
                 shippingPrice: { amount: 8, currency: 'USD' },
                 buyerPaidTotal: { amount: 38, currency: 'USD' } })] }) },

  { key: 'legacy', name: '37 · Legacy scan (no comps contract)', data: null },
];
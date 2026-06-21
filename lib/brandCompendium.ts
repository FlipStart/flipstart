/**
 * lib/brandCompendium.ts
 *
 * FILE PATH: lib/brandCompendium.ts
 *
 * Brand Compendium data layer — Pass 1.
 *
 * Contains:
 *   - All 241 supported FlipStart brands with rarity + display category
 *   - Brand name normalization (aliases → canonical names)
 *   - Discovery computation from flips[] + HuntXpProfile.discoveredBrands
 *   - Async storage for "seen brand notifications" (drives Progress tab badge)
 *
 * Storage keys:
 *   @flipstart/seen_brand_discoveries — Set of canonical brand names already
 *     shown to the user as a notification. Cleared-per-brand once viewed.
 *
 * Local only in Pass 1. Supabase sync will be added in a later pass.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { HistoryEntry, FlipResult } from '@/types/flip';
import { isHuntBundle } from '@/types/flip';

// ─── Types ────────────────────────────────────────────────────────────────────

export type BrandRarity    = 'common' | 'uncommon' | 'rare' | 'legendary';
export type BrandCategory  =
  | 'sportswear' | 'denim'   | 'menswear'  | 'womenswear'
  | 'outdoor'    | 'workwear' | 'streetwear' | 'luxury'
  | 'footwear'   | 'accessories' | 'golf'   | 'basics' | 'kids';

export interface Brand {
  name:     string;         // canonical display name
  rarity:   BrandRarity;
  category: BrandCategory;
  /** Estimated % of users who have discovered this brand (0–100). Pass 2. */
  globalUnlockRate: number;
}

// ─── Rarity colours (for badges, bars, highlights) ───────────────────────────

export const RARITY_COLORS: Record<BrandRarity, string> = {
  common:    '#8A8A8A',
  uncommon:  '#2A7A2A',
  rare:      '#7A3ABF',
  legendary: '#BE9C2C',
};

export const RARITY_LABELS: Record<BrandRarity, string> = {
  common:    'Common',
  uncommon:  'Uncommon',
  rare:      'Rare',
  legendary: 'Legendary',
};

// ─── Category display labels ──────────────────────────────────────────────────

export const CATEGORY_LABELS: Record<BrandCategory, string> = {
  sportswear:  'Sportswear',
  denim:       'Denim',
  menswear:    'Menswear',
  womenswear:  'Womenswear',
  outdoor:     'Outdoor',
  workwear:    'Workwear',
  streetwear:  'Streetwear',
  luxury:      'Luxury',
  footwear:    'Footwear',
  accessories: 'Accessories',
  golf:        'Golf',
  basics:      'Basics',
  kids:        'Kids',
};

// ─── All 241 supported brands ─────────────────────────────────────────────────
// Format: [canonical name, rarity, display category]

const RAW: [string, BrandRarity, BrandCategory][] = [
  // ── COMMON — Sportswear / Athletic ───────────────────────────────────────
  ['Nike',              'common', 'sportswear'],
  ['Adidas',            'common', 'sportswear'],
  ['Air Jordan',        'common', 'sportswear'],
  ['Under Armour',      'common', 'sportswear'],
  ['Reebok',            'common', 'sportswear'],
  ['Puma',              'common', 'sportswear'],
  ['Champion',          'common', 'sportswear'],
  ['Fila',              'common', 'sportswear'],
  ['New Balance',       'common', 'sportswear'],
  ['ASICS',             'common', 'sportswear'],
  ['Skechers',          'common', 'sportswear'],
  ['Russell Athletic',  'common', 'sportswear'],
  ['Avia',              'common', 'sportswear'],
  ['Tek Gear',          'common', 'sportswear'],
  ['Danskin',           'common', 'sportswear'],
  ['Athletic Works',    'common', 'sportswear'],

  // ── COMMON — Denim / Mall Fashion ────────────────────────────────────────
  ["Levi's",            'common', 'denim'],
  ['Lee',               'common', 'denim'],
  ['Wrangler',          'common', 'denim'],
  ['Dickies',           'common', 'denim'],
  ['Rustler',           'common', 'denim'],
  ['American Eagle',    'common', 'denim'],
  ['Hollister',         'common', 'denim'],
  ['Abercrombie & Fitch','common','denim'],
  ['Aeropostale',       'common', 'denim'],
  ['Gap',               'common', 'denim'],
  ['Old Navy',          'common', 'denim'],
  ['Banana Republic',   'common', 'denim'],
  ['Express',           'common', 'denim'],
  ['Arizona',           'common', 'denim'],
  ['Lucky Brand',       'common', 'denim'],

  // Fast Fashion → denim bucket
  ['H&M',               'common', 'denim'],
  ['Zara',              'common', 'denim'],
  ['Forever 21',        'common', 'denim'],
  ['Shein',             'common', 'denim'],
  ['Fashion Nova',      'common', 'denim'],

  // ── COMMON — Classic Menswear ─────────────────────────────────────────────
  ['Tommy Bahama',      'common', 'menswear'],
  ['Tommy Hilfiger',    'common', 'menswear'],
  ['Calvin Klein',      'common', 'menswear'],
  ['Nautica',           'common', 'menswear'],
  ['Guess',             'common', 'menswear'],
  ['Izod',              'common', 'menswear'],
  ['Van Heusen',        'common', 'menswear'],
  ['Dockers',           'common', 'menswear'],
  ['Arrow',             'common', 'menswear'],
  ['Stafford',          'common', 'menswear'],
  ['Haggar',            'common', 'menswear'],
  ['Kenneth Cole Reaction','common','menswear'],
  ['Perry Ellis',       'common', 'menswear'],
  ['Claiborne',         'common', 'menswear'],
  ['Chaps',             'common', 'menswear'],
  ['Geoffrey Beene',    'common', 'menswear'],
  ['Brooks Brothers',   'common', 'menswear'],

  // ── COMMON — Department Store / Womenswear ────────────────────────────────
  ['Apt. 9',            'common', 'womenswear'],
  ['Croft & Barrow',    'common', 'womenswear'],
  ["St. John's Bay",    'common', 'womenswear'],
  ['Sonoma',            'common', 'womenswear'],
  ['Sonoma Goods for Life','common','womenswear'],
  ['A New Day',         'common', 'womenswear'],
  ['Ann Taylor',        'common', 'womenswear'],
  ['LOFT',              'common', 'womenswear'],
  ['Talbots',           'common', 'womenswear'],
  ["Chico's",           'common', 'womenswear'],
  ['J. Jill',           'common', 'womenswear'],
  ['Worthington',       'common', 'womenswear'],
  ['Dana Buchman',      'common', 'womenswear'],
  ['Cato',              'common', 'womenswear'],
  ['Charter Club',      'common', 'womenswear'],
  ['Lane Bryant',       'common', 'womenswear'],
  ['Torrid',            'common', 'womenswear'],
  ['Liz Claiborne',     'common', 'womenswear'],

  // ── COMMON — Outdoor / Casual Outdoor ────────────────────────────────────
  ['Columbia',          'common', 'outdoor'],
  ['Eddie Bauer',       'common', 'outdoor'],
  ["Lands' End",        'common', 'outdoor'],
  ['L.L.Bean',          'common', 'outdoor'],
  ['Woolrich',          'common', 'outdoor'],
  ['JanSport',          'common', 'outdoor'],
  ['Mossy Oak',         'common', 'outdoor'],
  ['Realtree',          'common', 'outdoor'],

  // ── COMMON — Footwear ─────────────────────────────────────────────────────
  ['Converse',          'common', 'footwear'],
  ['Vans',              'common', 'footwear'],
  ['Crocs',             'common', 'footwear'],

  // ── COMMON — Kids ────────────────────────────────────────────────────────
  ["Carter's",          'common', 'kids'],
  ['OshKosh B\'gosh',   'common', 'kids'],
  ['Jumping Beans',     'common', 'kids'],

  // ── COMMON — Basics / Blanks ──────────────────────────────────────────────
  ['Hanes',             'common', 'basics'],
  ['Fruit of the Loom', 'common', 'basics'],
  ['Gildan',            'common', 'basics'],
  ['Jerzees',           'common', 'basics'],
  ['Port & Company',    'common', 'basics'],
  ['Bella + Canvas',    'common', 'basics'],
  ['Tultex',            'common', 'basics'],
  ['Anvil',             'common', 'basics'],
  ['Comfort Colors',    'common', 'basics'],

  // ── COMMON — Golf ────────────────────────────────────────────────────────
  ['PGA Tour',          'common', 'golf'],
  ['Ben Hogan',         'common', 'golf'],

  // ── COMMON — Lifestyle (mapped to closest category) ───────────────────────
  ['Life is Good',      'common', 'sportswear'],
  ['Route 66',          'common', 'denim'],
  ['Uniqlo',            'common', 'denim'],
  ['Goodfellow & Co',   'common', 'basics'],
  ['George',            'common', 'basics'],
  ['Faded Glory',       'common', 'basics'],
  ['No Boundaries',     'common', 'denim'],
  ['Time and Tru',      'common', 'womenswear'],
  ['Universal Thread',  'common', 'womenswear'],
  ['Wild Fable',        'common', 'womenswear'],
  ['Mossimo',           'common', 'denim'],
  ['Merona',            'common', 'womenswear'],

  // ── UNCOMMON — Outdoor / Workwear ─────────────────────────────────────────
  ['The North Face',    'uncommon', 'outdoor'],
  ['Marmot',            'uncommon', 'outdoor'],
  ['Mountain Hardwear', 'uncommon', 'outdoor'],
  ['Prana',             'uncommon', 'outdoor'],
  ['KÜHL',              'uncommon', 'outdoor'],
  ['Outdoor Research',  'uncommon', 'outdoor'],
  ['Smartwool',         'uncommon', 'outdoor'],
  ['Cotopaxi',          'uncommon', 'outdoor'],
  ['Fjällräven',        'uncommon', 'outdoor'],
  ['Carhartt',          'uncommon', 'workwear'],
  ['Duluth Trading',    'uncommon', 'workwear'],
  ['Ariat',             'uncommon', 'workwear'],
  ['Timberland',        'uncommon', 'workwear'],
  ['Wolverine',         'uncommon', 'workwear'],
  ['Orvis',             'uncommon', 'outdoor'],

  // ── UNCOMMON — Surf / Skate ───────────────────────────────────────────────
  ['Quiksilver',        'uncommon', 'streetwear'],
  ['Billabong',         'uncommon', 'streetwear'],
  ['Volcom',            'uncommon', 'streetwear'],
  ["O'Neill",           'uncommon', 'streetwear'],
  ['Hurley',            'uncommon', 'streetwear'],
  ['RVCA',              'uncommon', 'streetwear'],
  ['Brixton',           'uncommon', 'streetwear'],

  // ── UNCOMMON — Preppy / Heritage ──────────────────────────────────────────
  ['Polo Ralph Lauren', 'uncommon', 'menswear'],
  ['J.Crew',            'uncommon', 'menswear'],
  ['Madewell',          'uncommon', 'menswear'],
  ['Vineyard Vines',    'uncommon', 'menswear'],
  ['Southern Tide',     'uncommon', 'menswear'],
  ['Pendleton',         'uncommon', 'menswear'],
  ['London Fog',        'uncommon', 'outdoor'],

  // ── UNCOMMON — Boutique Womenswear ────────────────────────────────────────
  ['Free People',       'uncommon', 'womenswear'],
  ['Anthropologie',     'uncommon', 'womenswear'],
  ['Urban Outfitters',  'uncommon', 'womenswear'],
  ['Johnny Was',        'uncommon', 'womenswear'],
  ['Eileen Fisher',     'uncommon', 'womenswear'],
  ['Soft Surroundings', 'uncommon', 'womenswear'],
  ['Sundance',          'uncommon', 'womenswear'],
  ['Boden',             'uncommon', 'womenswear'],
  ['Flax',              'uncommon', 'womenswear'],

  // ── UNCOMMON — Athleisure ─────────────────────────────────────────────────
  ['Lululemon',         'uncommon', 'sportswear'],
  ['Athleta',           'uncommon', 'sportswear'],
  ['Alo Yoga',          'uncommon', 'sportswear'],
  ['Gymshark',          'uncommon', 'sportswear'],
  ['Vuori',             'uncommon', 'sportswear'],

  // ── UNCOMMON — Golf Premium ───────────────────────────────────────────────
  ['TravisMathew',      'uncommon', 'golf'],
  ['Peter Millar',      'uncommon', 'golf'],
  ['FootJoy',           'uncommon', 'golf'],
  ['Titleist',          'uncommon', 'golf'],
  ['Callaway',          'uncommon', 'golf'],

  // ── UNCOMMON — Footwear Premium ───────────────────────────────────────────
  ['Birkenstock',       'uncommon', 'footwear'],
  ['Dr. Martens',       'uncommon', 'footwear'],
  ['Merrell',           'uncommon', 'footwear'],
  ['Keen',              'uncommon', 'footwear'],
  ['UGG',               'uncommon', 'footwear'],
  ['Sperry',            'uncommon', 'footwear'],

  // ── UNCOMMON — Accessories ────────────────────────────────────────────────
  ['Fossil',            'uncommon', 'accessories'],
  ['Tumi',              'uncommon', 'accessories'],
  ['Vera Bradley',      'uncommon', 'accessories'],
  ['Dooney & Bourke',   'uncommon', 'accessories'],
  ['Brighton',          'uncommon', 'accessories'],
  ['Oakley',            'uncommon', 'accessories'],
  ['Costa',             'uncommon', 'accessories'],
  ['Maui Jim',          'uncommon', 'accessories'],

  // ── UNCOMMON — Biker / Vintage ────────────────────────────────────────────
  ['Harley-Davidson',   'uncommon', 'workwear'],
  ['Members Only',      'uncommon', 'workwear'],
  ['Rock Revival',      'uncommon', 'workwear'],
  ['Miss Me',           'uncommon', 'workwear'],
  ['Silver Jeans',      'uncommon', 'workwear'],
  ['BKE',               'uncommon', 'workwear'],
  ['True Religion',     'uncommon', 'workwear'],
  ['Red Kap',           'uncommon', 'workwear'],
  ['Clints',            'uncommon', 'workwear'],

  // ── RARE — Outdoor Technical ──────────────────────────────────────────────
  ['Patagonia',         'rare', 'outdoor'],
  ["Arc'teryx",         'rare', 'outdoor'],
  ['Filson',            'rare', 'outdoor'],
  ['Sitka',             'rare', 'outdoor'],
  ['Kuiu',              'rare', 'outdoor'],
  ['Mystery Ranch',     'rare', 'outdoor'],
  ['Barbour',           'rare', 'outdoor'],

  // ── RARE — Streetwear ─────────────────────────────────────────────────────
  ['BAPE',              'rare', 'streetwear'],
  ['Kith',              'rare', 'streetwear'],
  ['Palace',            'rare', 'streetwear'],
  ['Anti Social Social Club','rare','streetwear'],
  ['FTP',               'rare', 'streetwear'],
  ['Pleasures',         'rare', 'streetwear'],
  ['Fear of God',       'rare', 'streetwear'],
  ['Stüssy',            'rare', 'streetwear'],
  ['Aimé Leon Dore',    'rare', 'streetwear'],

  // ── RARE — Designer Accessible ────────────────────────────────────────────
  ['Coach',             'rare', 'luxury'],
  ['MCM',               'rare', 'luxury'],
  ['Telfar',            'rare', 'luxury'],
  ['Rimowa',            'rare', 'accessories'],

  // ── RARE — Workwear Heritage ──────────────────────────────────────────────
  ['Schott NYC',        'rare', 'workwear'],
  ['Red Wing',          'rare', 'workwear'],
  ['Golden Goose',      'rare', 'footwear'],
  ['Ben Davis',         'rare', 'workwear'],
  ['Stan Ray',          'rare', 'workwear'],

  // ── RARE — Fashion Grails ────────────────────────────────────────────────
  ['Kapital',           'rare', 'streetwear'],
  ['Needles',           'rare', 'streetwear'],
  ['RRL',               'rare', 'menswear'],

  // ── LEGENDARY — Luxury Fashion ───────────────────────────────────────────
  ['Louis Vuitton',     'legendary', 'luxury'],
  ['Gucci',             'legendary', 'luxury'],
  ['Chanel',            'legendary', 'luxury'],
  ['Dior',              'legendary', 'luxury'],
  ['Hermès',            'legendary', 'luxury'],
  ['Prada',             'legendary', 'luxury'],
  ['Fendi',             'legendary', 'luxury'],
  ['Burberry',          'legendary', 'luxury'],
  ['Balenciaga',        'legendary', 'luxury'],
  ['Givenchy',          'legendary', 'luxury'],

  // ── LEGENDARY — Quiet Luxury ──────────────────────────────────────────────
  ['Loro Piana',        'legendary', 'luxury'],
  ['Brunello Cucinelli','legendary', 'luxury'],
  ['Kiton',             'legendary', 'luxury'],
  ['Stefano Ricci',     'legendary', 'luxury'],

  // ── LEGENDARY — Streetwear Grails ────────────────────────────────────────
  ['Chrome Hearts',         'legendary', 'streetwear'],
  ['Supreme',               'legendary', 'streetwear'],
  ['Hellstar',              'legendary', 'streetwear'],
  ['Stone Island',          'legendary', 'streetwear'],
  ['Pele Pele',             'legendary', 'streetwear'],
  ['Visvim',                'legendary', 'streetwear'],
  ['Undercover',            'legendary', 'streetwear'],
  ['Comme des Garçons',     'legendary', 'streetwear'],
  ['Yohji Yamamoto',        'legendary', 'streetwear'],
  ['Issey Miyake',          'legendary', 'streetwear'],
  ['Amiri',                 'legendary', 'streetwear'],
  ['Gallery Dept.',         'legendary', 'streetwear'],
  ['Rick Owens',            'legendary', 'streetwear'],
  ['Maison Margiela',       'legendary', 'streetwear'],
  ['Jean Paul Gaultier',    'legendary', 'streetwear'],

  // ── LEGENDARY — Outerwear Grails ─────────────────────────────────────────
  ['Canada Goose',      'legendary', 'luxury'],
  ['Moncler',           'legendary', 'luxury'],

  // ── LEGENDARY — Jewelry & Watches ────────────────────────────────────────
  ['Rolex',             'legendary', 'accessories'],
  ['Cartier',           'legendary', 'accessories'],
  ['Tiffany & Co.',     'legendary', 'accessories'],
];

/**
 * Estimated global unlock rate per brand (% of users who've discovered it).
 * Hand-estimated by brand ubiquity in thrift/resale. Will be replaced by a
 * live server-computed value later — the UI just reads brand.globalUnlockRate.
 * Any brand not listed falls back to a rarity-based default.
 */
const RARITY_DEFAULT_RATE: Record<BrandRarity, number> = {
  common: 55, uncommon: 18, rare: 4.5, legendary: 0.4,
};

const UNLOCK_RATES: Record<string, number> = {
  // ── COMMON (high ubiquity) ───────────────────────────────────────────────
  'Nike': 79.3, 'Adidas': 74.1, 'Air Jordan': 41.2, 'Under Armour': 58.6,
  'Champion': 61.4, 'Levi\'s': 72.8, 'Old Navy': 68.9, 'Gap': 64.3,
  'Hanes': 70.2, 'Gildan': 66.7, 'Carhartt': 38.4, 'Tommy Hilfiger': 52.1,
  'Calvin Klein': 49.7, 'Reebok': 47.3, 'Puma': 44.8, 'Fila': 39.6,
  'New Balance': 46.2, 'Converse': 55.9, 'Vans': 53.4, 'Wrangler': 57.8,
  'Lee': 51.3, 'Dickies': 48.9, 'American Eagle': 50.6, 'Hollister': 45.7,
  'Fruit of the Loom': 63.1, 'Columbia': 42.8, 'Eddie Bauer': 36.4,
  'H&M': 41.9, 'Zara': 38.2, 'Forever 21': 43.5, 'Nautica': 35.7,
  'Guess': 37.2, 'Izod': 33.8, 'Dockers': 34.1, 'Crocs': 40.3,

  // ── UNCOMMON (mid) ───────────────────────────────────────────────────────
  'The North Face': 31.6, 'Patagonia': 12.8, 'Timberland': 28.4,
  'Polo Ralph Lauren': 33.2, 'Lululemon': 19.7, 'Dr. Martens': 16.3,
  'Birkenstock': 14.8, 'UGG': 21.4, 'J.Crew': 22.9, 'Madewell': 15.6,
  'Free People': 17.2, 'Urban Outfitters': 18.9, 'Anthropologie': 14.1,
  'Harley-Davidson': 23.7, 'True Religion': 13.4, 'Quiksilver': 16.8,
  'Billabong': 15.2, 'Hurley': 14.7, 'Vineyard Vines': 12.3,
  'Oakley': 19.3, 'Fossil': 17.8, 'Vera Bradley': 13.9, 'Athleta': 11.6,
  'Merrell': 15.4, 'Keen': 12.7, 'Callaway': 13.2, 'Titleist': 12.1,

  // ── RARE (low) ───────────────────────────────────────────────────────────
  'Arc\'teryx': 3.2, 'Filson': 2.4, 'Barbour': 3.8, 'Coach': 6.7,
  'BAPE': 2.1, 'Stüssy': 4.3, 'Kith': 1.8, 'Palace': 1.4,
  'Fear of God': 1.9, 'Anti Social Social Club': 2.7, 'Aimé Leon Dore': 1.3,
  'Red Wing': 3.6, 'Golden Goose': 2.2, 'MCM': 3.1, 'Telfar': 1.6,
  'Schott NYC': 2.9, 'Kapital': 0.9, 'Needles': 0.8, 'RRL': 1.7,
  'Sitka': 2.3, 'Kuiu': 1.9, 'Mystery Ranch': 1.5, 'Ben Davis': 4.1,
  'FTP': 1.2, 'Pleasures': 1.1, 'Rimowa': 2.6, 'Stan Ray': 1.0,

  // ── LEGENDARY (ultra-rare) ───────────────────────────────────────────────
  'Gucci': 0.04, 'Louis Vuitton': 0.06, 'Chanel': 0.03, 'Dior': 0.04,
  'Hermès': 0.02, 'Prada': 0.07, 'Fendi': 0.05, 'Burberry': 0.11,
  'Balenciaga': 0.05, 'Givenchy': 0.04, 'Rolex': 0.03, 'Cartier': 0.02,
  'Tiffany & Co.': 0.06, 'Supreme': 0.38, 'Stone Island': 0.19,
  'Chrome Hearts': 0.07, 'Moncler': 0.14, 'Canada Goose': 0.21,
  'Amiri': 0.09, 'Rick Owens': 0.12, 'Maison Margiela': 0.15,
  'Comme des Garçons': 0.24, 'Visvim': 0.06, 'Hellstar': 0.16,
  'Gallery Dept.': 0.13, 'Undercover': 0.08, 'Yohji Yamamoto': 0.11,
  'Issey Miyake': 0.14, 'Jean Paul Gaultier': 0.17, 'Pele Pele': 0.22,
  'Loro Piana': 0.05, 'Brunello Cucinelli': 0.06, 'Kiton': 0.02,
  'Stefano Ricci': 0.02,
};

export const ALL_BRANDS: Brand[] = RAW.map(([name, rarity, category]) => ({
  name, rarity, category,
  globalUnlockRate: UNLOCK_RATES[name] ?? RARITY_DEFAULT_RATE[rarity],
}));

export const TOTAL_SUPPORTED_BRANDS = ALL_BRANDS.length; // 241

export const RARITY_TOTALS: Record<BrandRarity, number> = {
  common:    ALL_BRANDS.filter(b => b.rarity === 'common').length,
  uncommon:  ALL_BRANDS.filter(b => b.rarity === 'uncommon').length,
  rare:      ALL_BRANDS.filter(b => b.rarity === 'rare').length,
  legendary: ALL_BRANDS.filter(b => b.rarity === 'legendary').length,
};

// ─── Normalization ────────────────────────────────────────────────────────────

/** Brand names that should never be counted. */
const IGNORED: Set<string> = new Set([
  'unknown', 'unbranded', 'no brand', 'generic', 'handmade',
  'custom', 'assorted', 'unspecified', 'n/a', 'none', '',
]);

/** Alias map: lowercase alias → canonical name. */
const ALIASES: Record<string, string> = {
  // Air Jordan
  'jordan':              'Air Jordan',
  'jordans':             'Air Jordan',
  'air jordan':          'Air Jordan',
  'air jordans':         'Air Jordan',
  // Polo Ralph Lauren
  'polo':                'Polo Ralph Lauren',
  'ralph lauren':        'Polo Ralph Lauren',
  'polo ralph lauren':   'Polo Ralph Lauren',
  // L.L.Bean
  'll bean':             'L.L.Bean',
  'l.l. bean':           'L.L.Bean',
  'l.l.bean':            'L.L.Bean',
  'llbean':              'L.L.Bean',
  // Abercrombie & Fitch
  'abercrombie':         'Abercrombie & Fitch',
  'a&f':                 'Abercrombie & Fitch',
  'abercrombie and fitch':'Abercrombie & Fitch',
  'abercrombie & fitch': 'Abercrombie & Fitch',
  // The North Face
  'north face':          'The North Face',
  'the north face':      'The North Face',
  'northface':           'The North Face',
  // Comme des Garçons
  'cdg':                 'Comme des Garçons',
  'cdg play':            'Comme des Garçons',
  'comme des garcons':   'Comme des Garçons',
  'commes des garcons':  'Comme des Garçons',
  // Louis Vuitton
  'lv':                  'Louis Vuitton',
  'louis vuitton':       'Louis Vuitton',
  // Hermès
  'hermes':              'Hermès',
  // Stüssy
  'stussy':              'Stüssy',
  // Arc'teryx
  'arcteryx':            "Arc'teryx",
  "arc'teryx":           "Arc'teryx",
  // Fjällräven
  'fjallraven':          'Fjällräven',
  'fjallräven':          'Fjällräven',
  // KÜHL
  'kuhl':                'KÜHL',
  // Levi's
  'levis':               "Levi's",
  "levi's":              "Levi's",
  // Tiffany
  'tiffany':             'Tiffany & Co.',
  'tiffany and co':      'Tiffany & Co.',
  'tiffany & co':        'Tiffany & Co.',
  // ASICS
  'asics':               'ASICS',
  // Aimé Leon Dore
  'aime leon dore':      'Aimé Leon Dore',
  'ald':                 'Aimé Leon Dore',
  // OshKosh
  "oshkosh b'gosh":      "OshKosh B'gosh",
  'oshkosh':             "OshKosh B'gosh",
  // Gallery Dept
  'gallery dept':        'Gallery Dept.',
  // St. John's Bay
  "st. john's bay":      "St. John's Bay",
  "st johns bay":        "St. John's Bay",
  // Maison Margiela
  'margiela':            'Maison Margiela',
  'mm6':                 'Maison Margiela',
  // Yohji Yamamoto
  'yohji':               'Yohji Yamamoto',
  'y-3':                 'Yohji Yamamoto',
  // Additional common aliases
  'anti social social club': 'Anti Social Social Club',
  'assc':                'Anti Social Social Club',
  'a bathing ape':        'BAPE',
  'a bathing ape (bape)': 'BAPE',
  'bape':                 'BAPE',
  'off white':            'Off-White',
  'off-white c/o virgil abloh': 'Off-White',
  'virgil abloh':         'Off-White',
  'a.p.c':               'A.P.C.',
  'a.p.c.':              'A.P.C.',
  'apc':                 'A.P.C.',
  'raf simons':          'Raf Simons',
  'stone island':        'Stone Island',
  'fear of god essentials': 'Fear of God',
  'fog':                 'Fear of God',
  'dr martens':          'Dr. Martens',
  'doc martens':         'Dr. Martens',
  'docs':                'Dr. Martens',
  'golden goose deluxe': 'Golden Goose',
  'ggdb':                'Golden Goose',
  'canada goose':        'Canada Goose',
  'moncler':             'Moncler',
  'schott':              'Schott NYC',
  'rick owens':          'Rick Owens',
  'brunello':            'Brunello Cucinelli',
};

/** Lookup Map: lowercase canonical name → canonical name. */
const CANONICAL_MAP = new Map<string, string>(
  ALL_BRANDS.map(b => [b.name.toLowerCase(), b.name])
);

/**
 * Normalize a raw AI-generated brand string to a canonical name.
 * Returns null if not supported or should be ignored.
 */
export function normalizeBrand(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  if (!key || IGNORED.has(key)) return null;

  // 1. Check explicit alias map
  if (ALIASES[key]) return ALIASES[key];

  // 2. Check exact canonical match (case-insensitive)
  const canonical = CANONICAL_MAP.get(key);
  if (canonical) return canonical;

  return null;
}

// ─── Discovery computation ────────────────────────────────────────────────────

/**
 * Compute the set of discovered canonical brand names from both sources:
 *  - flips[]    → regular scan saves (FlipResult.brand)
 *  - huntBrands → HuntXpProfile.discoveredBrands (hunt mode saves)
 */
export function computeDiscoveredBrands(
  flips:      HistoryEntry[],
  huntBrands: string[],
): Set<string> {
  const discovered = new Set<string>();

  // From regular scan saves
  for (const entry of flips) {
    if (!isHuntBundle(entry)) {
      const flip = entry as FlipResult;
      const canonical = normalizeBrand(flip.brand);
      if (canonical) discovered.add(canonical);
    }
  }

  // From hunt mode saves (stored in HuntXpProfile)
  for (const brand of huntBrands) {
    const canonical = normalizeBrand(brand);
    if (canonical) discovered.add(canonical);
  }

  return discovered;
}

/**
 * Compute discovered brands with their discovery timestamp.
 * Timestamp = the first scan where that brand appeared (oldest flip first).
 * Hunt-mode-only brands get timestamp 1 (renders as "Discovered" with no date).
 * Returns Map<canonicalName, timestamp>.
 */
export function computeDiscoveredBrandsWithDates(
  flips:      HistoryEntry[],
  huntBrands: string[],
): Map<string, number> {
  const map = new Map<string, number>();

  // Sort oldest-first so the first time we see a brand = discovery date
  const sortedFlips = [...flips]
    .filter(f => !isHuntBundle(f))
    .sort((a, b) => (a as FlipResult).timestamp - (b as FlipResult).timestamp);

  for (const entry of sortedFlips) {
    const flip      = entry as FlipResult;
    const canonical = normalizeBrand(flip.brand);
    if (canonical && !map.has(canonical)) {
      map.set(canonical, flip.timestamp);
    }
  }

  // Hunt-discovered brands without a scan match
  for (const brand of huntBrands) {
    const canonical = normalizeBrand(brand);
    if (canonical && !map.has(canonical)) {
      map.set(canonical, 1); // epoch sentinel → "Discovered" without specific date
    }
  }

  return map;
}
export function getDiscoveredByRarity(
  discovered: Set<string>,
): Record<BrandRarity, number> {
  const counts: Record<BrandRarity, number> = {
    common: 0, uncommon: 0, rare: 0, legendary: 0,
  };
  for (const brand of ALL_BRANDS) {
    if (discovered.has(brand.name)) counts[brand.rarity]++;
  }
  return counts;
}

/**
 * Look up a single brand by canonical name (or any alias).
 */
export function getBrandByName(name: string): Brand | null {
  const canonical = normalizeBrand(name);
  if (!canonical) return null;
  return ALL_BRANDS.find(b => b.name === canonical) ?? null;
}

export interface BrandStats {
  scanCount:      number;
  totalProfit:    number;
  bestFlip:       number;
  bestFlipName:   string | null;
  dateDiscovered: number;       // timestamp; 0 if not discovered via scan
  collectionOrder: number;      // 1-based position among all discovered brands; 0 if not discovered
}

/**
 * Compute live per-brand stats from the user's flips.
 * collectionOrder = the brand's discovery rank among ALL discovered brands.
 */
export function getBrandStats(
  flips:      HistoryEntry[],
  brandName:  string,
  huntBrands: string[] = [],
): BrandStats {
  const canonical = normalizeBrand(brandName);
  const empty: BrandStats = {
    scanCount: 0, totalProfit: 0, bestFlip: 0, bestFlipName: null,
    dateDiscovered: 0, collectionOrder: 0,
  };
  if (!canonical) return empty;

  let scanCount   = 0;
  let totalProfit = 0;
  let bestFlip    = 0;
  let bestFlipName: string | null = null;
  let earliest    = Number.MAX_SAFE_INTEGER;

  for (const entry of flips) {
    if (isHuntBundle(entry)) continue;
    const flip = entry as FlipResult;
    if (normalizeBrand(flip.brand) !== canonical) continue;

    scanCount++;
    const profit = flip.profit ?? 0;
    totalProfit += profit;
    if (profit > bestFlip) {
      bestFlip = profit;
      bestFlipName = flip.itemName ?? null;
    }
    if (flip.timestamp < earliest) earliest = flip.timestamp;
  }

  const dateDiscovered = scanCount > 0 ? earliest : 0;

  // collectionOrder — rank among all discovered brands by discovery date
  const allDates = computeDiscoveredBrandsWithDates(flips, huntBrands);
  const sorted = [...allDates.entries()].sort((a, b) => a[1] - b[1]);
  const collectionOrder = sorted.findIndex(([name]) => name === canonical) + 1;

  return { scanCount, totalProfit, bestFlip, bestFlipName, dateDiscovered, collectionOrder };
}
// Tracks which brand discovery names the user has already seen
// as a Progress tab notification (badge). Cleared when Brand Compendium is opened.

const SEEN_BRANDS_KEY = '@flipstart/seen_brand_discoveries';
const REVEALED_BRANDS_KEY = '@flipstart/revealed_brand_discoveries';

// ─── Reveal-shown tracking (drives BrandRevealModal, fires once per brand) ──────

export async function getRevealedBrandNames(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(REVEALED_BRANDS_KEY);
    return new Set<string>(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set<string>();
  }
}

export async function markBrandRevealed(name: string): Promise<void> {
  try {
    const seen = await getRevealedBrandNames();
    seen.add(name);
    await AsyncStorage.setItem(REVEALED_BRANDS_KEY, JSON.stringify([...seen]));
  } catch {}
}

/** DEV ONLY — clear reveal history so reveals can be re-tested. */
export async function clearRevealedBrands(): Promise<void> {
  try { await AsyncStorage.removeItem(REVEALED_BRANDS_KEY); } catch {}
}

export async function getSeenBrandNames(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(SEEN_BRANDS_KEY);
    return new Set<string>(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set<string>();
  }
}

export async function markBrandNamesAsSeen(names: string[]): Promise<void> {
  try {
    const seen = await getSeenBrandNames();
    names.forEach(n => seen.add(n));
    await AsyncStorage.setItem(SEEN_BRANDS_KEY, JSON.stringify([...seen]));
  } catch {}
}

/**
 * Returns brand names in `discovered` that are NOT yet in the seen set.
 * These are the "new" discoveries that should show the notification badge.
 */
export async function getUnseenBrandNames(
  discovered: Set<string>,
): Promise<string[]> {
  const seen = await getSeenBrandNames();
  return [...discovered].filter(name => !seen.has(name));
}
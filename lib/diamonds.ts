/**
 * lib/diamonds.ts
 *
 * FILE PATH: lib/diamonds.ts
 *
 * "Diamonds in the Rough" — Pass 1 system.
 *
 * Diamonds are memorable, ITEM-BASED thrift finds (not just legendary brands).
 * A Diamond is UNLOCKED when a saved item (a confirmed flip OR a kept hunt item)
 * strongly matches one of the supported Diamond types.
 *
 * ARCHITECTURE
 * ────────────
 * Diamonds are DERIVED from the flip history (the same `flips` array exposed by
 * useFlipStore), exactly like brand discovery and achievements. This means:
 *   • Saving a scan to history OR keeping it in a hunt → it can unlock a Diamond.
 *   • Deleting / un-saving an item → it stops counting (the Diamond disappears
 *     unless another saved item also matches it).
 * No fragile hooks into the save flow are needed; detection runs wherever we
 * recompute from `flips` (Progress tab focus + the Diamonds screen).
 *
 * "New" / notification state (which Diamonds the user has already viewed) is the
 * only thing persisted here, in AsyncStorage — mirroring brand "seen" tracking.
 *
 * No Supabase imports. Safe to import anywhere.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { HistoryEntry, StructuredId } from '@/types/flip';
import { isHuntBundle } from '@/types/flip';

// ─── Categories ────────────────────────────────────────────────────────────────

export type DiamondCategory =
  | 'heritage'    // Vintage / Heritage
  | 'sportswear'  // Nike / Sportswear
  | 'music'       // Band / Music
  | 'americana'   // Racing / Americana
  | 'outdoor'     // Outdoor / Utility
  | 'streetwear'  // Streetwear
  | 'fashion'     // Women's / Bags / Fashion
  | 'y2k'         // Y2K
  | 'oddity';     // Accessories / Odd Finds

/** Display label + accent color + plaque "motto" middle line, per category. */
export const CATEGORY_META: Record<DiamondCategory, {
  label: string; accent: string; motto: string;
}> = {
  heritage:   { label: 'Heritage',   accent: '#8B5A2B', motto: 'WORN WITH HISTORY.' },
  sportswear: { label: 'Sportswear', accent: '#2A4A2A', motto: 'EARNED ON THE FIELD.' },
  music:      { label: 'Music',      accent: '#6A3AB0', motto: 'LOUD AND LEGENDARY.' },
  americana:  { label: 'Americana',  accent: '#A6432E', motto: 'BUILT FOR THE ROAD.' },
  outdoor:    { label: 'Outdoor',    accent: '#3A6B4A', motto: 'MADE FOR THE WILD.' },
  streetwear: { label: 'Streetwear', accent: '#1F1F1F', motto: 'DROPPED AND GONE.' },
  fashion:    { label: 'Fashion',    accent: '#A23A6B', motto: 'DRAPED IN STORY.' },
  y2k:        { label: 'Y2K',        accent: '#3A7EBF', motto: 'STRAIGHT FROM THE 2000S.' },
  oddity:     { label: 'Odd Finds',  accent: '#7A6526', motto: 'ODD AND UNFORGETTABLE.' },
};

// ─── Diamond definition ──────────────────────────────────────────────────────────

export interface DiamondDef {
  id:        string;
  title:     string;
  category:  DiamondCategory;
  badge:     string;
  flavorLine: string;          // one evocative sentence (shown as caption)
  prestige:  1 | 2 | 3;        // 1 nice · 2 grail · 3 holy-grail — drives "Rarest Find"
  detectionKeywords: string[]; // signal words; ≥1 must appear in the item haystack

  // ── Optional matcher refinements (to avoid false positives) ──
  /** Item brand/haystack must include ONE of these (e.g. ['nike']). */
  brandAny?: string[];
  /** Item name/category must include ONE of these garment types (e.g. ['tee','shirt']). */
  typeAny?: string[];
  /**
   * Strong "marker" keywords (collector terms). A marker hit satisfies IDENTITY.
   * For marker-identity Diamonds it is also MANDATORY (see markerRequired).
   * NOTE: markers no longer auto-bypass the era gate. Era is bypassed only by
   * (a) globally era-denoting collector terms baked into era detection, or
   * (b) this Diamond's own eraExemptMarkers.
   */
  markerAny?: string[];
  /**
   * Legacy era flag. Prefer `era`. When set, true ≈ era:'vintage', false ≈ era:'none'.
   */
  needsVintage?: boolean;
  /**
   * When true, a markerAny hit is MANDATORY — the marker IS the identity
   * (e.g. "Detroit", "Center Swoosh", "Trefoil"). Without the marker, the brand
   * alone must NOT unlock the Diamond. (Also driven by MARKER_REQUIRED_IDS.)
   */
  markerRequired?: boolean;

  // ── Strict-matching controls (Phase-1 correctness pass) ──
  /**
   * IDENTITY allow-list. When present, AT LEAST ONE of these exact phrases must
   * appear in the item haystack (whole-word/phrase match). This REPLACES the
   * loose "specific keyword" identity check — nothing else can satisfy identity.
   * Use this to forbid generic words ("team", "racing", "cap"…) from unlocking.
   */
  requireAny?: string[];
  /** If ANY of these phrases appear, the Diamond is rejected outright. */
  excludeAny?: string[];
  /**
   * Era requirement: 'none' (no era needed), 'vintage' (any vintage signal), or
   * 'y2k' (Y2K/2000s-specific signal only). Falls back to title inference.
   */
  era?: 'none' | 'vintage' | 'y2k';
  /**
   * Phrases that, if present, WAIVE the era requirement for THIS Diamond only
   * (e.g. 'jnco' implies Y2K; 'realtree' is a specific camo pattern). Use only
   * for terms that genuinely substitute for an era signal.
   */
  eraExemptMarkers?: string[];
}

/** Runtime record for an unlocked Diamond (derived from a matching saved item). */
export interface UnlockedDiamond {
  id:              string;
  discoveredAt:    number;        // earliest matching item's timestamp (permanent)
  sourceScanId:    string | null;
  isFromHunt:      boolean;       // true if the triggering scan came from a Hunt bundle
  imageUri:        string | null;
  estimatedProfit: number | null;
}

// ─── Era vocabulary ──────────────────────────────────────────────────────────────
// General vintage signals: an item is "vintage" if any appear in its era / labels.
const VINTAGE_SIGNALS = [
  'vintage', 'retro', 'antique', 'distressed', 'faded', 'worn',
  '50s', '60s', '70s', '80s', '90s', "1950's", "1960's", "1970's", "1980's",
  "1990's", 'mid-century', 'single stitch', 'single-stitch', 'made in usa',
  'union made', 'union-made', 'deadstock',
];

// Collector terms that INHERENTLY denote an old/vintage piece. These count as a
// vintage era signal for ANY Diamond (the "good bypass markers" from the brief).
// Deliberately EXCLUDES model names that still ship today (Detroit, Nuptse,
// Synchilla, 501, Trefoil) — those are identity markers, not era proof.
const ERA_BYPASS_VINTAGE = [
  'big e', 'big-e', 'orange tab', 'type iii', 'type 3',
  'selvedge', 'selvage', 'redline', 'red line',
  'grey tag', 'gray tag', 'orange tag', 'blue tag',
];

// Y2K / early-2000s specific signals (a generic "vintage" tag does NOT qualify).
const Y2K_SIGNALS = ['y2k', '2000s', 'early 2000s', '00s', 'aughts', 'millennium'];

// ─── The catalog (active launch list) ──────────────────────────────

export const DIAMONDS: DiamondDef[] = [
  // ── Vintage / Heritage ──────────────────────────────────────────────────────
  { id: 'vintage_harley_tee',        title: 'Vintage Harley-Davidson Tee',        category: 'americana', badge: 'Americana Grail',  prestige: 3, flavorLine: 'A road-worn relic from the biker archive.',           brandAny: ['harley'], typeAny: ['tee','t-shirt','shirt','tshirt'], markerAny: ['3d emblem'], era: 'vintage', detectionKeywords: ['harley-davidson','harley','motorcycle','tee','biker'] },
  { id: 'vintage_harley_jacket',     title: 'Vintage Harley-Davidson Jacket',     category: 'americana', badge: 'Americana Grail',  prestige: 3, flavorLine: 'Leather and chrome, straight off the highway.',         brandAny: ['harley'], typeAny: ['jacket','vest','leather'], era: 'vintage', detectionKeywords: ['harley-davidson','harley','motorcycle','jacket','leather'] },
  { id: 'motorcycle_rally_tee',      title: 'Motorcycle Rally Tee',               category: 'americana', badge: 'Rally Relic',      prestige: 2, flavorLine: 'A souvenir from a summer of open road.', typeAny: ['tee','t-shirt','shirt','tshirt'], requireAny: ['motorcycle rally','bike week','biker rally','rally tee','sturgis','daytona bike week','laconia'], era: 'none', detectionKeywords: ['motorcycle rally','bike week'] },
  { id: 'sturgis_tee',               title: 'Sturgis Tee',                        category: 'americana', badge: 'Rally Grail',      prestige: 3, flavorLine: 'Black Hills dust still clings to the cotton.', typeAny: ['tee','t-shirt','shirt','tshirt'], requireAny: ['sturgis'], era: 'none', detectionKeywords: ['sturgis'] },
  { id: 'vintage_levis_jacket',      title: "Vintage Levi's Denim Jacket",        category: 'heritage',  badge: 'Denim Grail',      prestige: 3, flavorLine: 'Indigo that took decades to fade just right.',         brandAny: ['levi'], typeAny: ['jacket','trucker','denim'], markerAny: ['type iii','big e','selvedge'], era: 'vintage', detectionKeywords: ['levi','levis',"levi's",'denim','jacket','trucker'] },
  { id: 'vintage_levis_501',         title: "Vintage Levi's 501 Jeans",           category: 'heritage',  badge: 'Denim Grail',      prestige: 3, flavorLine: 'The original blue jean, broken in by time.',            brandAny: ['levi'], typeAny: ['jeans','501'], markerAny: ['501','big e','selvedge','redline'], era: 'vintage', detectionKeywords: ['levi','levis',"levi's",'501','jeans'] },
  { id: 'made_in_usa_levis',         title: "Made in USA Levi's",                 category: 'heritage',  badge: 'Denim Relic',      prestige: 2, flavorLine: 'Stitched stateside, back when that was the rule.',       brandAny: ['levi'], markerAny: ['made in usa'], needsVintage: false, detectionKeywords: ['made in usa','levi','levis'] },
  { id: 'vintage_leather_jacket',    title: 'Vintage Leather Jacket',             category: 'heritage',  badge: 'Leather Relic',    prestige: 2, flavorLine: 'Cracked, supple, and impossible to fake.', typeAny: ['jacket','coat','bomber','moto','biker'], requireAny: ['leather'], excludeAny: ['bag','purse','handbag','satchel','tote','clutch','wallet','briefcase','belt','boots','gloves','hat','wallet'], era: 'vintage', detectionKeywords: ['leather'] },
  { id: 'vintage_military_jacket',   title: 'Vintage Military Jacket',            category: 'heritage',  badge: 'Surplus Grail',    prestige: 2, flavorLine: 'Field-issued, then handed down through decades.',       typeAny: ['jacket','field','parka','m-65','fatigue'], era: 'vintage', detectionKeywords: ['military','field jacket','m-65','m65','fatigue','surplus','army','jacket'] },
  { id: 'vintage_varsity_jacket',    title: 'Vintage Varsity Jacket',             category: 'heritage',  badge: 'Letterman Relic',  prestige: 2, flavorLine: 'Wool body, leather sleeves, hometown pride.', typeAny: ['jacket','varsity','letterman'], requireAny: ['varsity','letterman'], era: 'vintage', detectionKeywords: ['varsity','letterman'] },
  { id: 'vintage_western_shirt',     title: 'Vintage Western Pearl Snap Shirt',   category: 'heritage',  badge: 'Western Relic',    prestige: 2, flavorLine: 'Pearl snaps and prairie stitching.', typeAny: ['shirt','western'], requireAny: ['pearl snap','pearl-snap','western snap','snap button','rockmount'], era: 'vintage', detectionKeywords: ['pearl snap','rockmount'] },
  { id: 'polo_rl_rugby_shirt',       title: 'Ralph Lauren Rugby Shirt',           category: 'heritage',  badge: 'Preppy Grail',     prestige: 2, flavorLine: 'The sub-brand that closed its doors — and opened a resale market.',
    brandAny: ['ralph lauren','polo ralph lauren','polo','rugby ralph lauren'], typeAny: ['shirt','rugby'], requireAny: ['rugby'], era: 'none', detectionKeywords: ['rugby','ralph lauren'] },
  { id: 'vintage_flannel',           title: 'Vintage Flannel',                    category: 'heritage',  badge: 'Flannel Relic',    prestige: 1, flavorLine: 'Soft, faded plaid with a lived-in warmth.', typeAny: ['flannel','shirt'], requireAny: ['flannel'], era: 'vintage', detectionKeywords: ['flannel'] },
  { id: 'vintage_workwear',          title: 'Vintage Workwear Piece',             category: 'heritage',  badge: 'Workwear Relic',   prestige: 2, flavorLine: 'Built to outlast the job it was made for.',           typeAny: ['jacket','pants','coverall','chore','overall','shirt'], era: 'vintage', detectionKeywords: ['workwear','chore','coverall','overall','dickies','duck canvas'] },
  { id: 'vintage_carhartt_jacket',   title: 'Vintage Carhartt Jacket',            category: 'heritage',  badge: 'Workwear Grail',   prestige: 2, flavorLine: 'Duck canvas seasoned by years of labor.',             brandAny: ['carhartt'], typeAny: ['jacket','coat','vest'], era: 'vintage', detectionKeywords: ['carhartt','duck','canvas','jacket'] },
  { id: 'carhartt_detroit_jacket',   title: 'Carhartt Detroit Jacket',            category: 'heritage',  badge: 'Workwear Grail',   prestige: 3, flavorLine: 'The blanket-lined icon of American workwear.',         brandAny: ['carhartt'], typeAny: ['jacket','coat'], markerAny: ['detroit','detroit jacket'], needsVintage: false, detectionKeywords: ['detroit','carhartt','jacket','blanket lined'] },

  // ── Nike / Sportswear ─────────────────────────────────────────────────────────
  { id: 'nike_center_swoosh',        title: 'Nike Center Swoosh',                 category: 'sportswear', badge: 'Swoosh Grail',     prestige: 3, flavorLine: 'One swoosh, dead center — a vintage holy grail.',       brandAny: ['nike'], typeAny: ['hoodie','sweatshirt','crewneck','pullover','sweater'], markerAny: ['center swoosh','centre swoosh'], needsVintage: false, detectionKeywords: ['center swoosh','nike','swoosh'] },
  { id: 'vintage_nike_piece',        title: 'Vintage Nike Piece',                 category: 'sportswear', badge: 'Swoosh Relic',     prestige: 2, flavorLine: 'Old-school swoosh from the golden years.',            brandAny: ['nike'], needsVintage: true, detectionKeywords: ['nike','swoosh','vintage'] },
  { id: 'vintage_adidas_trefoil',    title: 'Vintage Adidas Trefoil Piece',       category: 'sportswear', badge: 'Trefoil Relic',    prestige: 2, flavorLine: 'The three-leaf mark from the tracksuit era.', brandAny: ['adidas'], markerAny: ['trefoil'], requireAny: ['trefoil'], era: 'vintage', detectionKeywords: ['trefoil'] },
  { id: 'vintage_starter_jacket',    title: 'Vintage Starter Jacket',             category: 'sportswear', badge: 'Starter Grail',    prestige: 3, flavorLine: 'Satin team colors from the playground glory days.',    brandAny: ['starter'], typeAny: ['jacket','pullover','satin'], era: 'vintage', detectionKeywords: ['starter','jacket','satin','pullover'] },
  { id: 'champion_reverse_weave',    title: 'Champion Reverse Weave',             category: 'sportswear', badge: 'Reverse Weave Relic', prestige: 2, flavorLine: 'The crewneck that refuses to shrink.',              brandAny: ['champion'], markerAny: ['reverse weave'], needsVintage: false, detectionKeywords: ['reverse weave','champion','crewneck'] },
  { id: 'vintage_sports_team_tee',   title: 'Vintage Sports Team Tee',            category: 'sportswear', badge: 'Fan Relic',        prestige: 1, flavorLine: 'Hometown loyalty, screen-printed and faded.', typeAny: ['tee','t-shirt','shirt','tshirt'], requireAny: ['nba','nfl','mlb','nhl','ncaa','bulls','lakers','celtics','knicks','yankees','red sox','dodgers','raiders','cowboys','packers','steelers','49ers','bruins'], era: 'vintage', detectionKeywords: ['nba','nfl','mlb','nhl'] },
  { id: 'vintage_college_sweat',     title: 'Vintage College Sweatshirt',         category: 'sportswear', badge: 'Campus Relic',     prestige: 1, flavorLine: 'Faded crewneck from a campus long ago.',             typeAny: ['sweatshirt','crewneck','hoodie'], era: 'vintage', detectionKeywords: ['college','university','sweatshirt','crewneck'] },
  { id: 'vintage_jersey',            title: 'Vintage Jersey',                     category: 'sportswear', badge: 'Jersey Grail',     prestige: 2, flavorLine: 'Stitched numbers from a bygone roster.',             typeAny: ['jersey'], era: 'vintage', detectionKeywords: ['jersey','stitched','throwback'] },

  // ── Band / Music ────────────────────────────────────────────────────────────
  { id: 'vintage_band_tee',          title: 'Vintage Band Tee',                   category: 'music',     badge: 'Band Grail',       prestige: 3, flavorLine: 'A faded tour shirt that still sings.', typeAny: ['tee','t-shirt','shirt','tshirt'], requireAny: ['band tee','tour tee','metallica','nirvana','ac dc','pink floyd','led zeppelin','rolling stones','beatles','grateful dead','guns n roses','tupac','biggie','nas','wu tang','prince','michael jackson','madonna','iron maiden','def leppard','aerosmith','queen','the who','slayer','megadeth','korn','slipknot'], era: 'vintage', detectionKeywords: ['band tee'] },
  { id: 'concert_tour_tee',          title: 'Concert Tour Tee',                   category: 'music',     badge: 'Tour Relic',       prestige: 2, flavorLine: 'Back-printed dates from a night to remember.', typeAny: ['tee','t-shirt','shirt','tshirt'], requireAny: ['tour','concert','world tour','tour dates'], era: 'vintage', detectionKeywords: ['tour','concert'] },
  { id: 'vintage_music_promo',       title: 'Vintage Music Promo Piece',          category: 'music',     badge: 'Promo Relic',      prestige: 2, flavorLine: 'Label promo swag that escaped the warehouse.', requireAny: ['music promo','record label','record company','records promo','album promo','artist promo','band promo','label promo'], era: 'vintage', detectionKeywords: ['music promo','record label'] },
  { id: 'vintage_rap_tee',           title: 'Vintage Rap Tee',                    category: 'music',     badge: 'Rap Tee Grail',    prestige: 3, flavorLine: 'Bootleg or official, the rap tee reigns.',             typeAny: ['tee','t-shirt','shirt','tshirt'], requireAny: ['rap','hip hop','hip-hop','tupac','2pac','biggie','notorious big','nas','wu tang','jay z','eminem','snoop','dr dre','bootleg rap','rap tee'], era: 'vintage', detectionKeywords: ['rap','hip hop','hip-hop','tupac','bootleg'] },

  // ── Racing / Americana ────────────────────────────────────────────────────────
  { id: 'nascar_jacket',             title: 'NASCAR Jacket',                      category: 'americana', badge: 'Racing Grail',     prestige: 2, flavorLine: 'Sponsor patches from the oval-track era.', typeAny: ['jacket','windbreaker'], requireAny: ['nascar'], era: 'none', detectionKeywords: ['nascar'] },
  { id: 'nascar_tee',                title: 'NASCAR Tee',                         category: 'americana', badge: 'Racing Relic',     prestige: 1, flavorLine: 'All-over print, full-throttle nostalgia.', typeAny: ['tee','t-shirt','shirt','tshirt'], requireAny: ['nascar'], era: 'none', detectionKeywords: ['nascar'] },
  { id: 'racing_team_jacket',        title: 'Racing Team Jacket',                 category: 'americana', badge: 'Pit Crew Relic',   prestige: 2, flavorLine: 'Crew colors covered in motor-oil glory.', typeAny: ['jacket','windbreaker'], requireAny: ['motorsport','formula 1','f1','indycar','motogp','racing team','pit crew','crew jacket','racing jacket','rally jacket','sponsor patches'], excludeAny: ['nascar'], era: 'none', detectionKeywords: ['motorsport','racing team'] },
  { id: 'vintage_beer_promo_tee',    title: 'Vintage Beer Promo Tee',             category: 'americana', badge: 'Tap Room Relic',   prestige: 1, flavorLine: 'A brewery throwback worth raising a glass to.',       typeAny: ['tee','t-shirt','shirt','tshirt'], requireAny: ['beer','brewery','budweiser','coors','miller','heineken','guinness','corona','pabst','pbr','michelob','beer promo'], era: 'vintage', detectionKeywords: ['beer','budweiser','brewery'] },
  { id: 'vintage_casino_tee',        title: 'Vintage Casino Tee',                 category: 'americana', badge: 'High Roller Relic', prestige: 1, flavorLine: 'Neon-lit souvenir from the strip.',                 typeAny: ['tee','t-shirt','shirt','tshirt'], requireAny: ['casino','vegas','las vegas','atlantic city','reno','harrah','caesars','mgm grand','bellagio','tropicana'], era: 'vintage', detectionKeywords: ['casino','vegas','las vegas'] },
  { id: 'vintage_souvenir_tee',      title: 'Vintage Souvenir Tee',               category: 'americana', badge: 'Souvenir Relic',   prestige: 1, flavorLine: 'A “wish you were here” from another decade.', typeAny: ['tee','t-shirt','shirt','tshirt'], requireAny: ['souvenir','tourist','vacation','travel'], era: 'vintage', detectionKeywords: ['souvenir'] },
  // ── Outdoor / Utility ──────────────────────────────────────────────────────────
  { id: 'patagonia_synchilla',       title: 'Patagonia Synchilla',               category: 'outdoor',   badge: 'Synchilla Grail',  prestige: 3, flavorLine: 'The fleece that started the gorpcore craze.',         brandAny: ['patagonia'], markerAny: ['synchilla','snap-t','snap t'], needsVintage: false, detectionKeywords: ['synchilla','patagonia','snap-t','fleece'] },
  { id: 'vintage_patagonia',         title: 'Vintage Patagonia Piece',            category: 'outdoor',   badge: 'Patagonia Relic',  prestige: 2, flavorLine: 'Trail-worn gear with a deep cult following.',         brandAny: ['patagonia'], needsVintage: true, detectionKeywords: ['patagonia','fleece','vintage'] },
  { id: 'filson_item',               title: 'Filson Item',                        category: 'outdoor',   badge: 'Filson Grail',     prestige: 2, flavorLine: 'Tin cloth built for a hundred winters.',             brandAny: ['filson'], detectionKeywords: ['filson','tin cloth','mackinaw'] },
  { id: 'vintage_hunting_jacket',    title: 'Vintage Hunting Jacket',             category: 'outdoor',   badge: 'Field Relic',      prestige: 2, flavorLine: 'Brush-beaten canvas from the back forty.', typeAny: ['jacket','coat','vest'], requireAny: ['hunting','duck hunting','upland','game pocket','field hunting','shooting jacket','hunting camo'], era: 'vintage', detectionKeywords: ['hunting'] },
  { id: 'vintage_camo_piece',        title: 'Vintage Camo Piece',                 category: 'outdoor',   badge: 'Camo Relic',       prestige: 1, flavorLine: 'Faded pattern that learned to disappear.', requireAny: ['camo','camouflage','realtree','mossy oak','tiger stripe','woodland camo','military camo'], era: 'vintage', eraExemptMarkers: ['realtree','mossy oak','tiger stripe'], detectionKeywords: ['camo','camouflage'] },
  { id: 'vintage_outdoor_vest',      title: 'Vintage Outdoor Vest',               category: 'outdoor',   badge: 'Vest Relic',       prestige: 1, flavorLine: 'Puffy or fleece, ready for the trailhead.',          typeAny: ['vest','gilet'], requireAny: ['puffer','fleece','down','outdoor','quilted'], era: 'vintage', detectionKeywords: ['vest','puffer','fleece','outdoor'] },
  { id: 'woolrich_wool_piece',       title: 'Woolrich Wool Piece',                category: 'outdoor',   badge: 'Woolrich Relic',   prestige: 2, flavorLine: 'Buffalo-check warmth from America’s oldest mill.',     brandAny: ['woolrich'], detectionKeywords: ['woolrich','wool','buffalo check','mackinaw'] },
  { id: 'llbean_vintage',            title: 'L.L.Bean Vintage Piece',             category: 'outdoor',   badge: 'Heritage Relic',   prestige: 2, flavorLine: 'Freeport-made gear with a lifetime of stories.',      brandAny: ['l.l.bean','llbean','l.l. bean','ll bean'], needsVintage: true, detectionKeywords: ['l.l.bean','llbean','bean boot','vintage'] },
  { id: 'tnf_nuptse',                title: 'The North Face Nuptse',              category: 'outdoor',   badge: 'Nuptse Grail',     prestige: 3, flavorLine: 'The 700-fill puffer that conquered the city.',        brandAny: ['north face','the north face','tnf'], markerAny: ['nuptse'], needsVintage: false, detectionKeywords: ['nuptse','north face','puffer','700 fill'] },
  { id: 'arcteryx_shell',            title: "Arc'teryx Shell",                    category: 'outdoor',   badge: 'Techwear Grail',   prestige: 3, flavorLine: 'Bird-logo Gore-Tex, coveted by techwear heads.',      brandAny: ['arcteryx',"arc'teryx",'arc teryx'], typeAny: ['shell','jacket','gore-tex','gore tex'], detectionKeywords: ['arcteryx',"arc'teryx",'gore-tex','shell','alpha sv'] },

  // ── Streetwear ────────────────────────────────────────────────────────────────
  { id: 'supreme_item',              title: 'Supreme Item',                       category: 'streetwear', badge: 'Hype Grail',       prestige: 3, flavorLine: 'A box-logo drop that vanished in seconds.',           brandAny: ['supreme'], detectionKeywords: ['supreme','box logo','bogo'] },
  { id: 'bape_item',                 title: 'BAPE Item',                          category: 'streetwear', badge: 'Hype Grail',       prestige: 3, flavorLine: 'Ape-camo from the Ura-Harajuku golden age.',         brandAny: ['bape','a bathing ape'], detectionKeywords: ['bape','bathing ape','shark hoodie','ape'] },
  { id: 'kith_item',                 title: 'Kith Item',                          category: 'streetwear', badge: 'Hype Relic',       prestige: 2, flavorLine: 'Quiet-luxe streetwear with a cult cosign.',          brandAny: ['kith'], detectionKeywords: ['kith'] },
  { id: 'palace_item',               title: 'Palace Item',                        category: 'streetwear', badge: 'Hype Relic',       prestige: 2, flavorLine: 'Tri-Ferg skate energy from across the pond.',         brandAny: ['palace'], detectionKeywords: ['palace','tri-ferg','triferg'] },
  { id: 'vintage_stussy',            title: 'Vintage Stussy Piece',               category: 'streetwear', badge: 'OG Streetwear',    prestige: 2, flavorLine: 'The scrawled signature that built streetwear.',       brandAny: ['stussy','stüssy'], needsVintage: true, detectionKeywords: ['stussy','stüssy','vintage'] },
  { id: 'fear_of_god_item',          title: 'Fear of God Item',                   category: 'streetwear', badge: 'Hype Grail',       prestige: 3, flavorLine: 'Elevated basics with a luxury price ceiling.', requireAny: ['fear of god','fog essentials','fear of god essentials'], era: 'none', detectionKeywords: ['fear of god'] },
  { id: 'chrome_hearts_item',        title: 'Chrome Hearts Item',                 category: 'streetwear', badge: 'Holy Grail Hype',  prestige: 3, flavorLine: 'Silver-cross excess, the rarest of the rare.',        brandAny: ['chrome hearts'], detectionKeywords: ['chrome hearts','ch plus','cross'] },

  // ── Women's / Bags / Fashion ────────────────────────────────────────────────────
  { id: 'vintage_coach_bag',         title: 'Vintage Coach Bag',                  category: 'fashion',   badge: 'Leather Grail',    prestige: 2, flavorLine: 'Glove-tanned leather that ages like a saddle.',       brandAny: ['coach'], typeAny: ['bag','purse','satchel','handbag'], needsVintage: true, detectionKeywords: ['coach','leather','bag','vintage'] },
  { id: 'vintage_dooney_bag',        title: 'Vintage Dooney & Bourke Bag',        category: 'fashion',   badge: 'Leather Relic',    prestige: 2, flavorLine: 'All-weather leather with a preppy pedigree.',        brandAny: ['dooney'], typeAny: ['bag','purse','satchel','handbag'], needsVintage: true, detectionKeywords: ['dooney','bourke','bag','vintage'] },
  { id: 'vintage_leather_purse',     title: 'Vintage Leather Purse',              category: 'fashion',   badge: 'Leather Relic',    prestige: 1, flavorLine: 'A patina that no new bag can buy.',                  typeAny: ['purse','bag','handbag','clutch'], requireAny: ['leather'], era: 'vintage', detectionKeywords: ['leather','purse','bag'] },
  { id: 'vintage_designer_silk_scarf', title: 'Vintage Designer Silk Scarf',      category: 'fashion',   badge: 'Silk Grail',       prestige: 2, flavorLine: 'Hand-rolled edges, storied house — silk that tells a story.',
    typeAny: ['scarf','wrap','stole'], requireAny: ['silk scarf','hermès','hermes','gucci','versace','chanel','dior','ysl','givenchy','ferragamo','designer silk','silk'], excludeAny: ['polyester','acrylic','cotton scarf'], era: 'vintage', detectionKeywords: ['silk','scarf'] },
  { id: 'vintage_designer_handbag',  title: 'Vintage Designer Handbag',           category: 'fashion',   badge: 'Designer Grail',   prestige: 3, flavorLine: 'A monogram with a market all its own.', typeAny: ['bag','purse','handbag','tote'], markerAny: ['gucci','prada','louis vuitton','fendi','dior','chanel'], requireAny: ['gucci','prada','louis vuitton','fendi','dior','chanel'], era: 'vintage', detectionKeywords: ['gucci','prada','louis vuitton'] },
  { id: 'juicy_couture_velour',      title: 'Juicy Couture Velour Piece',         category: 'fashion',   badge: 'Velour Icon',      prestige: 2, flavorLine: 'The tracksuit that defined an era of glam.', brandAny: ['juicy couture'], typeAny: ['velour','tracksuit','hoodie','zip','pants'], era: 'none', detectionKeywords: ['juicy couture','velour'] },
  { id: 'vintage_vs_piece',          title: "Vintage Victoria's Secret Piece",    category: 'fashion',   badge: 'Boudoir Relic',    prestige: 1, flavorLine: 'Pink-label nostalgia from the catalog years.',       brandAny: ["victoria's secret",'victorias secret','vs pink'], needsVintage: true, detectionKeywords: ["victoria's secret",'victorias secret','pink','vintage'] },
  { id: 'gunne_sax_dress',           title: 'Gunne Sax Dress',                    category: 'fashion',   badge: 'Prairie Grail',    prestige: 3, flavorLine: 'Lace-and-ribbon romance from the prairie revival.',   brandAny: ['gunne sax','gunne'], typeAny: ['dress','gown'], detectionKeywords: ['gunne sax','prairie','dress','lace'] },
  { id: 'vintage_formal_dress',      title: 'Vintage Formal Dress',               category: 'fashion',   badge: 'Gown Relic',       prestige: 2, flavorLine: 'Beaded, draped, and made for an entrance.',          typeAny: ['dress','gown','formal'], requireAny: ['gown','formal','evening','beaded','cocktail','ball gown'], era: 'vintage', detectionKeywords: ['formal','gown','beaded','evening'] },
  { id: 'vintage_fur_coat',          title: 'Vintage Fur or Faux Fur Coat',       category: 'fashion',   badge: 'Glamour Relic',    prestige: 2, flavorLine: 'Old-Hollywood warmth with serious drama.', typeAny: ['coat','jacket','stole'], requireAny: ['fur','faux fur','mink','shearling'], excludeAny: ['fur trim','fur trimmed','fur lined','fur lining','trim hood','lined hood','fur hood'], era: 'vintage', detectionKeywords: ['fur','mink'] },
  { id: 'vintage_leather_boots',     title: 'Vintage Leather Boots',              category: 'fashion',   badge: 'Boot Relic',       prestige: 1, flavorLine: 'Resoled, reloved, ready for more miles.', typeAny: ['boots','boot'], requireAny: ['leather','frye'], era: 'vintage', detectionKeywords: ['leather','frye'] },
  { id: 'vintage_denim_skirt',       title: 'Vintage Denim Skirt',                category: 'fashion',   badge: 'Denim Relic',      prestige: 1, flavorLine: 'A faded mini with decades of attitude.', typeAny: ['skirt'], requireAny: ['denim'], era: 'vintage', detectionKeywords: ['denim'] },
  { id: 'free_people_statement',     title: 'Free People Statement Piece',        category: 'fashion',   badge: 'Boho Relic',       prestige: 1, flavorLine: 'Free-spirited layering with a festival soul.',       brandAny: ['free people'], detectionKeywords: ['free people','boho','festival'] },
  { id: 'anthropologie_statement',   title: 'Anthropologie Statement Piece',      category: 'fashion',   badge: 'Boutique Relic',   prestige: 1, flavorLine: 'Whimsical, textured, quietly collectible.',          brandAny: ['anthropologie'], detectionKeywords: ['anthropologie','maeve','pilcro'] },

  // ── Y2K ──────────────────────────────────────────────────────────────────────
  { id: 'y2k_graphic_tee',           title: 'Y2K Graphic Tee',                    category: 'y2k',       badge: 'Y2K Grail',        prestige: 2, flavorLine: 'Glittered graphics straight out of 2003.',            typeAny: ['tee','t-shirt','shirt','tshirt','baby tee'], markerAny: ['y2k'], detectionKeywords: ['y2k','graphic','tee','2000s'] },
  { id: 'y2k_baggy_denim',           title: 'Y2K Baggy Denim',                    category: 'y2k',       badge: 'Y2K Relic',        prestige: 2, flavorLine: 'Wide-leg, low-rise, unapologetically baggy.', typeAny: ['jeans','denim','jnco'], requireAny: ['baggy','jnco','wide leg','wide-leg'], era: 'y2k', eraExemptMarkers: ['jnco'], detectionKeywords: ['baggy','jnco'] },
  { id: 'y2k_track_jacket',          title: 'Y2K Track Jacket',                   category: 'y2k',       badge: 'Y2K Relic',        prestige: 2, flavorLine: 'Zip-up shine from the mall-era heyday.', typeAny: ['track','jacket','zip'], requireAny: ['track jacket','track top'], era: 'y2k', detectionKeywords: ['track jacket'] },
  { id: 'y2k_cargo_pants',           title: 'Y2K Cargo Pants',                    category: 'y2k',       badge: 'Y2K Relic',        prestige: 2, flavorLine: 'Pockets for days, attitude to match.', typeAny: ['cargo','pants'], requireAny: ['cargo'], era: 'y2k', detectionKeywords: ['cargo'] },
  { id: 'y2k_rhinestone_piece',      title: 'Y2K Rhinestone Piece',               category: 'y2k',       badge: 'Bling Grail',      prestige: 3, flavorLine: 'Every sparkle says early-2000s glam.', requireAny: ['rhinestone','bedazzled','bling'], era: 'y2k', detectionKeywords: ['rhinestone','bedazzled'] },
  { id: 'y2k_baby_tee',              title: 'Y2K Baby Tee',                       category: 'y2k',       badge: 'Y2K Relic',        prestige: 2, flavorLine: 'Cropped, snug, peak millennium energy.', typeAny: ['baby tee','tee','t-shirt','shirt','crop'], requireAny: ['baby tee','baby fit','crop'], era: 'y2k', detectionKeywords: ['baby tee'] },
  { id: 'y2k_designer_bag',          title: 'Y2K Designer-Inspired Bag',          category: 'y2k',       badge: 'It-Bag Relic',     prestige: 2, flavorLine: 'The little shoulder bag everyone wanted.', typeAny: ['bag','purse','baguette','shoulder bag'], requireAny: ['baguette','designer inspired','it bag'], era: 'y2k', detectionKeywords: ['baguette'] },
  // ── Accessories / Odd Finds ──────────────────────────────────────────────────────
  { id: 'vintage_watch',             title: 'Vintage Watch',                      category: 'oddity',    badge: 'Timepiece Grail',  prestige: 3, flavorLine: 'A ticking heirloom from another wrist.',             typeAny: ['watch','timepiece'], era: 'vintage', detectionKeywords: ['watch','timepiece','automatic','seiko'] },
  { id: 'vintage_sunglasses',        title: 'Vintage Sunglasses',                 category: 'oddity',    badge: 'Shade Relic',      prestige: 1, flavorLine: 'Sun-faded frames with retro cool.',                 typeAny: ['sunglasses','shades','glasses'], era: 'vintage', detectionKeywords: ['sunglasses','shades','ray-ban'] },
  { id: 'vintage_belt_buckle',       title: 'Vintage Belt Buckle',                category: 'oddity',    badge: 'Buckle Relic',     prestige: 1, flavorLine: 'Solid brass with rodeo swagger.',                  typeAny: ['buckle','belt'], requireAny: ['buckle','belt buckle'], detectionKeywords: ['belt buckle','buckle','brass','western'] },
  { id: 'sterling_silver_jewelry',   title: 'Sterling Silver Jewelry',            category: 'oddity',    badge: 'Silver Grail',     prestige: 2, flavorLine: 'Stamped .925 — heavier than it looks.',             markerAny: ['sterling','.925','925'], detectionKeywords: ['sterling','silver','.925','925','jewelry'] },
  { id: 'turquoise_jewelry',         title: 'Turquoise Jewelry',                  category: 'oddity',    badge: 'Southwest Grail',  prestige: 2, flavorLine: 'Sky-blue stone set by desert hands.', typeAny: ['jewelry','necklace','ring','bracelet','earrings','pendant','cuff','bolo','brooch','accessory'], requireAny: ['turquoise','navajo','squash blossom'], era: 'none', detectionKeywords: ['turquoise','navajo','squash blossom'] },
  { id: 'vintage_snapback',          title: 'Vintage Snapback',                   category: 'oddity',    badge: 'Cap Relic',        prestige: 1, flavorLine: 'Flat-brim nostalgia, adjust to fit.', typeAny: ['snapback','hat','cap'], requireAny: ['snapback'], era: 'vintage', detectionKeywords: ['snapback'] },
  { id: 'vintage_trucker_hat',       title: 'Vintage Trucker Hat',                category: 'oddity',    badge: 'Mesh Relic',       prestige: 1, flavorLine: 'Foam front, mesh back, roadside charm.', typeAny: ['trucker','hat','cap'], requireAny: ['trucker','mesh back','mesh cap'], era: 'vintage', detectionKeywords: ['trucker','mesh back'] },
  { id: 'rare_plush',                title: 'Rare Plush',                         category: 'oddity',    badge: 'Plush Grail',      prestige: 2, flavorLine: 'A soft collectible with a devoted fanbase.', typeAny: ['plush','stuffed','toy','plushie','beanie baby'], requireAny: ['rare','retired','limited edition','first edition','collectible','vintage','90s','80s','beanie baby','ty beanie','princess diana','steiff','sanrio','pokemon','disney'], era: 'none', detectionKeywords: ['beanie baby','collectible'] },
  { id: 'vintage_video_game',        title: 'Vintage Video Game',                 category: 'oddity',    badge: 'Cartridge Grail',  prestige: 2, flavorLine: 'A cartridge that still holds its save.',            typeAny: ['game','cartridge','console'], requireAny: ['nes','snes','n64','super nintendo','nintendo 64','sega genesis','sega','genesis','atari','game boy','gameboy','game gear','famicom','cartridge'], excludeAny: ['switch','ps4','ps5','xbox one','series x','series s','digital download'], era: 'none', detectionKeywords: ['nes','snes','sega','atari','cartridge'] },
  { id: 'vintage_camera',            title: 'Vintage Camera',                     category: 'oddity',    badge: 'Optics Relic',     prestige: 2, flavorLine: 'Mechanical shutter, timeless results.',            typeAny: ['camera','slr','film camera'], requireAny: ['film camera','slr','35mm','polaroid','instant camera','rangefinder','tlr','medium format','vintage camera'], excludeAny: ['digital','dslr','mirrorless','webcam','gopro','phone'], era: 'none', detectionKeywords: ['film camera','slr','polaroid','35mm'] },
  { id: 'old_concert_poster',        title: 'Old Concert Poster',                 category: 'oddity',    badge: 'Print Grail',      prestige: 2, flavorLine: 'Wall-worthy proof of a legendary night.',          typeAny: ['poster','print'], requireAny: ['concert','tour','band poster','gig poster','music poster','festival'], era: 'vintage', detectionKeywords: ['concert','tour','gig poster'] },
];

export const TOTAL_DIAMONDS = DIAMONDS.length;

// ─── Lookup helpers ──────────────────────────────────────────────────────────────

const BY_ID: Record<string, DiamondDef> = Object.fromEntries(
  DIAMONDS.map(d => [d.id, d]),
);
export function getDiamondById(id: string): DiamondDef | undefined {
  return BY_ID[id];
}

// ─── Detection ─────────────────────────────────────────────────────────────────

/** Normalized candidate item drawn from a saved flip or kept hunt item. */
interface Candidate {
  scanId:      string | null;
  imageUri:    string | null;
  timestamp:   number;
  profit:      number | null;
  haystack:    string;   // lowercased brand + name + category + era + labels + material + structured
  typeText:    string;   // lowercased name + category (for garment-type checks)
  vintage:     boolean;  // whether era/labels indicate a genuinely old piece
  isFromHunt:  boolean;  // true when this candidate came from a kept hunt bundle item
  structured?: StructuredId; // v2 structured AI fields (undefined on older scans)
}

/**
 * Normalize a string to space-delimited lowercase alphanumeric tokens.
 * "Arc'teryx", "M-65", ".925", "1990's" → "arc teryx", "m 65", "925", "1990 s".
 */
function normToken(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Build a normalized haystack PADDED with spaces, for whole-token matching. */
function buildHaystack(parts: (string | undefined | null)[]): string {
  const joined = parts.filter(Boolean).map(p => normToken(String(p))).filter(Boolean).join(' ');
  return ` ${joined} `;
}

/** Whole-word / whole-phrase membership test (no substring false hits). */
function tok(haystackPadded: string, needle: string): boolean {
  const n = normToken(needle);
  return n.length > 0 && haystackPadded.includes(` ${n} `);
}

// Vintage signals as normalized tokens (general + collector era-markers).
const VINTAGE_SIGNAL_SET = new Set(
  [...VINTAGE_SIGNALS, ...ERA_BYPASS_VINTAGE].map(normToken),
);
const Y2K_SIGNAL_SET = new Set(Y2K_SIGNALS.map(normToken));

/** Scan haystack tokens for year/decade era hits, returning vintage + y2k flags. */
function eraYearHits(haystackPadded: string): { vintage: boolean; y2k: boolean } {
  let vintage = false, y2k = false;
  for (const t of haystackPadded.trim().split(' ')) {
    if (/^\d{4}$/.test(t)) {
      const y = parseInt(t, 10);
      if (y >= 1900 && y <= 2010) vintage = true;
      if (y >= 2000 && y <= 2009) y2k = true;
    } else {
      const m = t.match(/^(19\d0|20[0-2]0)s$/); // 1970s, 1990s, 2000s, 2010s…
      if (m) {
        const y = parseInt(m[1], 10);
        if (y >= 1900 && y <= 2010) vintage = true;
        if (y === 2000) y2k = true;
      }
    }
  }
  return { vintage, y2k };
}

/** True ONLY for Y2K / early-2000s signals (a generic "vintage" tag does NOT qualify). */
function isY2kEra(haystackPadded: string): boolean {
  for (const sig of Y2K_SIGNAL_SET) {
    if (haystackPadded.includes(` ${sig} `)) return true;
  }
  return eraYearHits(haystackPadded).y2k;
}

/** True if the item shows a general VINTAGE era signal (year ≤ 2010, decades, collector markers, or Y2K). */
function isVintageEra(haystackPadded: string): boolean {
  for (const sig of VINTAGE_SIGNAL_SET) {
    if (haystackPadded.includes(` ${sig} `)) return true;
  }
  return eraYearHits(haystackPadded).vintage || isY2kEra(haystackPadded);
}

/** Back-compat alias used when building candidates. */
function hasVintageSignal(haystackPadded: string): boolean {
  return isVintageEra(haystackPadded);
}

// ─── Strict vintage evidence (Phase-4 precision pass) ──────────────────────────
// "worn / faded / distressed / retro / rugged / old-looking" are SOFT cues that
// describe texture, not age. They must NOT, on their own, satisfy a strict
// vintage Diamond. Strong evidence = explicit era classification, decade/year,
// or a collector/construction marker.
const SOFT_VINTAGE_WORDS = new Set(
  ['worn', 'faded', 'distressed', 'retro', 'rugged', 'aged', 'old',
   'broken in', 'well worn', 'lived in', 'vintage inspired', 'vintage style',
   'vintage vibe', 'washed', 'weathered'].map(normToken),
);
// Strong textual signals = the vintage vocabulary MINUS the soft texture words.
const STRONG_VINTAGE_SET = new Set(
  [...VINTAGE_SIGNAL_SET].filter(sig => !SOFT_VINTAGE_WORDS.has(sig)),
);

/** True only for STRONG textual vintage evidence (excludes soft texture words). */
function hasStrongVintageEvidence(haystackPadded: string): boolean {
  for (const sig of STRONG_VINTAGE_SET) {
    if (haystackPadded.includes(` ${sig} `)) return true;
  }
  return eraYearHits(haystackPadded).vintage || isY2kEra(haystackPadded);
}

/**
 * Decide if a candidate is genuinely vintage.
 *  • Structured present → trust eraConfidence: 'high' passes; 'medium' passes
 *    only with concrete eraEvidence; otherwise require strong textual evidence.
 *  • No structured (legacy) → require strong textual evidence (never soft words).
 */
function candidateVintage(c: Candidate): boolean {
  const st = c.structured;
  if (st && st.eraConfidence) {
    if (st.eraConfidence === 'high') return true;
    if (st.eraConfidence === 'medium' && (st.eraEvidence?.length ?? 0) > 0) return true;
    return hasStrongVintageEvidence(c.haystack);
  }
  return hasStrongVintageEvidence(c.haystack);
}

/** Decide if a candidate is genuinely Y2K (structured-aware, else strong text). */
function candidateY2k(c: Candidate): boolean {
  const st = c.structured;
  if (st && st.eraConfidence && st.eraConfidence !== 'low') {
    const e = normToken(`${st.eraEstimate ?? ''} ${(st.eraEvidence ?? []).join(' ')}`);
    if (/\by2k\b|2000s|early 2000|aughts/.test(e)) return true;
  }
  return isY2kEra(c.haystack);
}

/**
 * Generic garment / silhouette words. These describe an item's TYPE, not its
 * identity, so a hit on one of these may satisfy the type gate but NEVER counts
 * as identity proof on its own. (A Columbia fleece is a "jacket" but that does
 * not make it a NASCAR Jacket.) Words that genuinely ARE a collectible's
 * identity — leather, fleece, flannel, fur, watch, camera, jersey, skirt, etc.
 * — are deliberately excluded from this set.
 */
const GENERIC_TYPE_WORDS = new Set([
  'jacket', 'coat', 'vest', 'gilet', 'tee', 't shirt', 'tshirt', 'shirt',
  'jeans', 'denim', 'pants', 'hoodie', 'sweatshirt', 'crewneck', 'pullover',
  'sweater', 'dress', 'bag', 'purse', 'handbag', 'tote', 'satchel', 'clutch',
  'shorts', 'top', 'shell', 'windbreaker', 'zip', 'tracksuit', 'baby tee',
  'crop', 'shoulder bag', 'baguette',
].map(normToken));

/**
 * Diamonds whose identity IS their marker — the marker is MANDATORY. Without it,
 * the brand/keyword alone must not unlock the Diamond (so a plain Carhartt does
 * not become a "Detroit Jacket", a plain Nike tee does not become a "Center Swoosh", etc.).
 */
const MARKER_REQUIRED_IDS = new Set<string>([
  'made_in_usa_levis', 'carhartt_detroit_jacket',
  'nike_center_swoosh', 'vintage_adidas_trefoil',
  'champion_reverse_weave', 'patagonia_synchilla', 'tnf_nuptse',
  'sterling_silver_jewelry', 'vintage_designer_handbag',
]);

/** Extra haystack tokens contributed by structured v2 fields (precise signals). */
function structuredHaystackParts(st: StructuredId | undefined): (string | undefined)[] {
  if (!st) return [];
  return [
    st.canonicalBrand, st.canonicalItemName, st.itemType, st.subType,
    st.styleVariant, st.modelName, st.sportsTeam, st.league,
    st.playerNumber, st.playerNameGuess,
    ...(st.eraEvidence ?? []), ...(st.materialSignals ?? []),
    ...(st.graphicSignals ?? []), ...(st.brandModelSignals ?? []),
  ];
}

/** Flatten the flip history into individual scannable candidate items. */
export function flipsToCandidates(flips: HistoryEntry[]): Candidate[] {
  const out: Candidate[] = [];
  for (const entry of flips) {
    if (isHuntBundle(entry)) {
      for (const item of entry.keptItems) {
        const snap = item.scanSnapshot?.identification as (StructuredId & {
          estimated_era?: string; style_labels?: string[]; material_guess?: string;
        }) | undefined;
        const st: StructuredId | undefined = snap ? {
          canonicalBrand: snap.canonicalBrand, canonicalItemName: snap.canonicalItemName,
          itemType: snap.itemType, subType: snap.subType, styleVariant: snap.styleVariant,
          modelName: snap.modelName, logoPlacement: snap.logoPlacement,
          eraEstimate: snap.eraEstimate, eraConfidence: snap.eraConfidence,
          eraEvidence: snap.eraEvidence, materialSignals: snap.materialSignals,
          graphicSignals: snap.graphicSignals, sportsTeam: snap.sportsTeam, league: snap.league,
          playerNumber: snap.playerNumber, playerNameGuess: snap.playerNameGuess,
          playerNameConfidence: snap.playerNameConfidence, brandModelSignals: snap.brandModelSignals,
          possibleDiamondIds: snap.possibleDiamondIds, diamondReasoningShort: snap.diamondReasoningShort,
        } : undefined;
        const hasStructured = !!st && Object.values(st).some(v => v != null && (!Array.isArray(v) || v.length > 0));
        const era    = snap?.estimated_era ?? '';
        const labels = (snap?.style_labels ?? []).join(' ');
        const mat    = snap?.material_guess ?? '';
        const haystack = buildHaystack([
          item.brand, item.itemName, item.category, era, labels, mat,
          ...structuredHaystackParts(hasStructured ? st : undefined),
        ]);
        const typeText = buildHaystack([item.itemName, item.category, st?.itemType, st?.subType]);
        out.push({
          scanId:     item.scanId ?? null,
          imageUri:   item.imageUri ?? null,
          timestamp:  entry.timestamp ?? entry.endedAt ?? Date.now(),
          profit:     typeof item.profit === 'number' ? item.profit : null,
          haystack,
          typeText,
          vintage:    hasVintageSignal(haystack),
          isFromHunt: true,
          structured: hasStructured ? st : undefined,
        });
      }
    } else {
      // FlipResult
      const st = entry.structured;
      const hasStructured = !!st && Object.values(st).some(v => v != null && (!Array.isArray(v) || v.length > 0));
      const labels = (entry.styleLabels ?? []).join(' ');
      const haystack = buildHaystack([
        entry.brand, entry.itemName, entry.category, entry.era, labels, entry.material,
        ...structuredHaystackParts(hasStructured ? st : undefined),
      ]);
      const typeText = buildHaystack([entry.itemName, entry.category, st?.itemType, st?.subType]);
      out.push({
        scanId:     entry.id ?? null,
        imageUri:   entry.imageUri ?? null,
        timestamp:  entry.timestamp ?? Date.now(),
        profit:     typeof entry.profit === 'number' ? entry.profit : null,
        haystack,
        typeText,
        vintage:    hasVintageSignal(haystack),
        isFromHunt: false,
        structured: hasStructured ? st : undefined,
      });
    }
  }
  return out;
}

/** Resolve the era requirement for a Diamond: explicit `era`, else inferred. */
function resolveEra(def: DiamondDef): 'none' | 'vintage' | 'y2k' {
  if (def.era) return def.era;
  const t = def.title.toLowerCase();
  if (t.includes('y2k') || def.category === 'y2k') return 'y2k';
  if (t.includes('vintage')) return 'vintage';
  if (def.needsVintage === true) return 'vintage';
  return 'none';
}

/**
 * Does this candidate satisfy this Diamond's match rule?
 *
 * Five SEPARATED gates, each independent (Phase-1 correctness pass). A Diamond
 * unlocks only when ALL applicable gates pass. False negatives are acceptable;
 * false positives are not.
 *
 *   0. EXCLUDE  — reject outright if any excludeAny phrase is present.
 *   1. BRAND    — if brand-specific, that brand must appear.
 *   2. TYPE     — if garment-typed, the garment type must be consistent.
 *   3. MARKER   — marker-identity Diamonds REQUIRE their marker.
 *   4. IDENTITY — requireAny (strict allow-list) if defined; otherwise a brand,
 *                 marker, or *specific* keyword (never a generic word) must hit.
 *   5. ERA      — 'vintage' needs a vintage signal; 'y2k' needs a Y2K-specific
 *                 signal; 'none' skips. eraExemptMarkers waive era for this
 *                 Diamond. Markers do NOT auto-bypass era.
 */
/** Build a small padded haystack from structured identity fields. */
function structuredText(parts: (string | undefined)[]): string {
  return buildHaystack(parts);
}

/** Does the candidate satisfy this Diamond's marker (structured-first)? */
function markerHits(def: DiamondDef, c: Candidate): boolean {
  if (!def.markerAny || def.markerAny.length === 0) return false;
  // 1) Legacy text.
  if (def.markerAny.some(m => tok(c.haystack, m))) return true;
  // 2) Structured identity (styleVariant / modelName / canonicalItemName).
  const st = c.structured;
  if (st) {
    const idText = structuredText([st.styleVariant, st.modelName, st.canonicalItemName]);
    if (def.markerAny.some(m => tok(idText, m))) return true;
    // 3) Nike Center Swoosh: a centered logoPlacement IS the marker.
    if (def.id === 'nike_center_swoosh' && st.logoPlacement) {
      const lp = normToken(st.logoPlacement);
      if (['centerchest', 'center chest', 'centered chest', 'centered front', 'center front', 'centre chest'].map(normToken).includes(lp)) {
        return true;
      }
    }
  }
  return false;
}

export type MatchSource = 'structured' | 'fallback_legacy';
export interface GateResult { ok: boolean; failedGate?: string; source: MatchSource; }

/**
 * Evaluate every gate for a Diamond against a candidate, structured-first.
 * Gate order: exclude → brand → type → marker → identity → era.
 * A Diamond unlocks only when ALL applicable gates pass. No blocking: multiple
 * Diamonds may pass independently. False negatives OK; false positives are not.
 */
function evalDiamond(def: DiamondDef, c: Candidate): GateResult {
  const st = c.structured;
  const source: MatchSource = st ? 'structured' : 'fallback_legacy';

  // 0) Exclusions.
  if (def.excludeAny && def.excludeAny.some(x => tok(c.haystack, x))) {
    return { ok: false, failedGate: 'exclude', source };
  }

  // 1) Brand gate (prefer canonicalBrand).
  if (def.brandAny && def.brandAny.length > 0) {
    const brandText = structuredText([st?.canonicalBrand]);
    const brandHit = def.brandAny.some(b => tok(c.haystack, b) || tok(brandText, b));
    if (!brandHit) return { ok: false, failedGate: 'brand', source };
  }

  // 2) Garment-type gate (prefer itemType / subType).
  if (def.typeAny && def.typeAny.length > 0) {
    const typeText2 = structuredText([st?.itemType, st?.subType, st?.canonicalItemName]);
    const typeHit = def.typeAny.some(t => tok(c.typeText, t) || tok(c.haystack, t) || tok(typeText2, t));
    if (!typeHit) return { ok: false, failedGate: 'type', source };
  }

  // 3) Marker gate (mandatory for marker-identity Diamonds).
  const markerHit = markerHits(def, c);
  const markerRequired = def.markerRequired ?? MARKER_REQUIRED_IDS.has(def.id);
  if (markerRequired && !markerHit) return { ok: false, failedGate: 'marker', source };

  // 4) Identity proof (prefer canonicalItemName / styleVariant / modelName).
  if (def.requireAny && def.requireAny.length > 0) {
    const idText = structuredText([st?.canonicalItemName, st?.styleVariant, st?.modelName]);
    const hit = def.requireAny.some(r => tok(c.haystack, r) || tok(idText, r));
    if (!hit) return { ok: false, failedGate: 'identity', source };
  } else {
    const brandHit = !!def.brandAny && def.brandAny.some(b => tok(c.haystack, b));
    const specificKeywordHit = def.detectionKeywords.some(k => {
      const nk = normToken(k);
      if (GENERIC_TYPE_WORDS.has(nk) || VINTAGE_SIGNAL_SET.has(nk) || Y2K_SIGNAL_SET.has(nk)) return false;
      return tok(c.haystack, k);
    });
    if (!brandHit && !markerHit && !specificKeywordHit) return { ok: false, failedGate: 'identity', source };
  }

  // 5) Era gate (structured-aware, strict).
  const era = resolveEra(def);
  if (era !== 'none') {
    const eraExempt = !!def.eraExemptMarkers && def.eraExemptMarkers.some(m => tok(c.haystack, m));
    if (!eraExempt) {
      if (era === 'vintage' && !candidateVintage(c)) return { ok: false, failedGate: 'era_vintage', source };
      if (era === 'y2k' && !candidateY2k(c)) return { ok: false, failedGate: 'era_y2k', source };
    }
  }

  return { ok: true, source };
}

function candidateMatchesDiamond(def: DiamondDef, c: Candidate): boolean {
  return evalDiamond(def, c).ok;
}

/**
 * Compute every unlocked Diamond from the flip history.
 * Returns a map keyed by Diamond id. Each Diamond keeps the EARLIEST matching
 * item (so its discovery date is permanent and its hero image is the find).
 */
export function computeUnlockedDiamonds(
  flips: HistoryEntry[],
): Record<string, UnlockedDiamond> {
  const candidates = flipsToCandidates(flips);
  const result: Record<string, UnlockedDiamond> = {};

  for (const def of DIAMONDS) {
    for (const c of candidates) {
      if (!candidateMatchesDiamond(def, c)) continue;
      const existing = result[def.id];
      if (!existing || c.timestamp < existing.discoveredAt) {
        result[def.id] = {
          id:              def.id,
          discoveredAt:    c.timestamp,
          sourceScanId:    c.scanId,
          isFromHunt:      c.isFromHunt,
          imageUri:        c.imageUri,
          estimatedProfit: c.profit,
        };
      }
    }
  }
  return result;
}

/** Convenience — just the set of unlocked ids. */
export function getUnlockedDiamondIds(flips: HistoryEntry[]): string[] {
  return Object.keys(computeUnlockedDiamonds(flips));
}

// ─── Dev / debug visibility (no blocking system — only why matched / why not) ──────
export interface DiamondMatchDebugItem {
  scanId: string | null;
  matchSource: MatchSource;
  structured: {
    canonicalItemName?: string; canonicalBrand?: string; itemType?: string;
    styleVariant?: string; modelName?: string; logoPlacement?: string;
    eraEstimate?: string; eraConfidence?: string; eraEvidence?: string[];
    sportsTeam?: string; league?: string; playerNumber?: string;
    playerNameGuess?: string; playerNameConfidence?: string;
    possibleDiamondIds?: string[];
  } | null;
  unlocked: { id: string; why: string }[];
  // Diamonds that passed the brand gate but failed later (the "near misses").
  notMatchedNearby: { id: string; failedGate: string }[];
}

/**
 * Dev-only: explain diamond matching for every candidate in the flip history.
 * Shows canonical fields, matchSource, which diamonds unlocked + why, and which
 * brand-relevant diamonds did NOT match + the gate they failed. No "blocked"
 * concept — diamonds are never suppressed by one another.
 */
export function debugDiamondMatching(flips: HistoryEntry[]): DiamondMatchDebugItem[] {
  const candidates = flipsToCandidates(flips);
  return candidates.map(c => {
    const st = c.structured;
    const unlocked: { id: string; why: string }[] = [];
    const notMatchedNearby: { id: string; failedGate: string }[] = [];

    for (const def of DIAMONDS) {
      const r = evalDiamond(def, c);
      if (r.ok) {
        unlocked.push({
          id: def.id,
          why: st ? `structured (${st.canonicalItemName ?? st.canonicalBrand ?? 'fields'})` : 'fallback_legacy',
        });
      } else {
        // Only surface "near misses": brand gate passed but a later gate failed.
        const brandOk = !def.brandAny || def.brandAny.length === 0 ||
          def.brandAny.some(b => tok(c.haystack, b) || tok(structuredText([st?.canonicalBrand]), b));
        if (brandOk && r.failedGate && r.failedGate !== 'brand' && r.failedGate !== 'identity') {
          notMatchedNearby.push({ id: def.id, failedGate: r.failedGate });
        }
      }
    }

    return {
      scanId: c.scanId,
      matchSource: (st ? 'structured' : 'fallback_legacy') as MatchSource,
      structured: st ? {
        canonicalItemName: st.canonicalItemName, canonicalBrand: st.canonicalBrand,
        itemType: st.itemType, styleVariant: st.styleVariant, modelName: st.modelName,
        logoPlacement: st.logoPlacement, eraEstimate: st.eraEstimate,
        eraConfidence: st.eraConfidence, eraEvidence: st.eraEvidence,
        sportsTeam: st.sportsTeam, league: st.league, playerNumber: st.playerNumber,
        playerNameGuess: st.playerNameGuess, playerNameConfidence: st.playerNameConfidence,
        possibleDiamondIds: st.possibleDiamondIds,
      } : null,
      unlocked,
      notMatchedNearby,
    };
  });
}

// ─── "Seen" / notification persistence (mirrors brand seen-tracking) ──────────────

const SEEN_KEY = '@flipstart/seen_diamond_ids_v1';

async function getSeenSet(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(SEEN_KEY);
    return new Set<string>(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set<string>();
  }
}

/** Given the currently-unlocked ids, return those the user hasn't viewed yet. */
export async function getUnseenDiamondIds(unlockedIds: string[]): Promise<string[]> {
  const seen = await getSeenSet();
  return unlockedIds.filter(id => !seen.has(id));
}

/** Persist that these Diamonds have now been viewed (clears their "New" badge). */
export async function markDiamondIdsSeen(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    const seen = await getSeenSet();
    ids.forEach(id => seen.add(id));
    await AsyncStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));
  } catch {
    // Never crash on notification storage
  }
}

// ─── Formatting helpers (used by the screen) ──────────────────────────────────────

const MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];

function ordinalSuffix(n: number): string {
  const j = n % 10, k = n % 100;
  if (j === 1 && k !== 11) return 'st';
  if (j === 2 && k !== 12) return 'nd';
  if (j === 3 && k !== 13) return 'rd';
  return 'th';
}

/** "July 21st, 2026" — matches the reference mockup. */
export function formatDiscoveredDate(ts: number): string {
  if (!ts || ts <= 1) return 'discovered in Hunt Mode';
  const d = new Date(ts);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}${ordinalSuffix(d.getDate())}, ${d.getFullYear()}`;
}

const ORDINAL_WORDS = [
  'First','Second','Third','Fourth','Fifth','Sixth','Seventh','Eighth','Ninth','Tenth',
  'Eleventh','Twelfth','Thirteenth','Fourteenth','Fifteenth','Sixteenth','Seventeenth',
  'Eighteenth','Nineteenth','Twentieth',
];

/** "First Diamond Found", "Second Diamond Found", … (numeric fallback past 20th). */
export function diamondFoundLabel(orderIndex: number): string {
  const n = orderIndex + 1;
  const word = ORDINAL_WORDS[orderIndex];
  if (word) return `${word} Diamond Found`;
  return `${n}${ordinalSuffix(n)} Diamond Found`;
}

/** The 3-line exhibit "motto" for the plaque (generic top, category middle, generic bottom). */
export function diamondMotto(def: DiamondDef): string[] {
  return ['AN ICONIC PIECE.', CATEGORY_META[def.category].motto, 'FOUND BY THE FEW.'];
}
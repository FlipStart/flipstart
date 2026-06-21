/**
 * lib/diamondArtwork.ts
 *
 * FILE PATH: lib/diamondArtwork.ts
 *
 * Static, pre-generated museum artwork for each Diamond. The Diamonds-in-the-Rough
 * gallery renders THIS art for a Diamond — never the user's scan image.
 *
 * RULES:
 *  - STATIC require() only. Metro/Expo cannot reliably bundle a require() path
 *    built from a runtime string, so every entry is a literal require.
 *  - Keyed by the Diamond's real `id` (see lib/diamonds.ts).
 *  - Filenames are used EXACTLY as they exist on disk — including the messy/typo
 *    ones (e.g. "vitnagedesignerhandbag", "arc'teryx shell.first.webp",
 *    "sterlingsilverjewelery"). Do NOT "fix" a name here without renaming the file.
 *
 * Assets live in:  assets/images/diamonds/
 */

// require() returns an opaque asset module ref at runtime; `any` is the honest type.
type ArtworkSource = ReturnType<typeof require>;

export const DIAMOND_ARTWORK_BY_ID: Record<string, ArtworkSource> = {
  // ── Vintage / Heritage ──
  vintage_harley_tee:        require('@/assets/images/diamonds/vintageharleytee.first.webp'),
  vintage_harley_jacket:     require('@/assets/images/diamonds/vintageharleyjacket.first.webp'),
  motorcycle_rally_tee:      require('@/assets/images/diamonds/motorcyclerallytee.first.webp'),
  sturgis_tee:               require('@/assets/images/diamonds/sturgistee.first.webp'),
  vintage_levis_jacket:      require('@/assets/images/diamonds/levisdenimjacket.first.webp'),
  vintage_levis_501:         require('@/assets/images/diamonds/vintagelevis501jeans.first.webp'),
  made_in_usa_levis:         require('@/assets/images/diamonds/madeinUSAlevis.first.webp'),
  vintage_leather_jacket:    require('@/assets/images/diamonds/vintageleatherjacket.first.webp'),
  vintage_military_jacket:   require('@/assets/images/diamonds/militaryjacket.first.webp'),
  vintage_varsity_jacket:    require('@/assets/images/diamonds/varsityjacket.first.webp'),
  vintage_western_shirt:     require('@/assets/images/diamonds/vintagewesternpearlsnapshirt.first.webp'),
  vintage_flannel:           require('@/assets/images/diamonds/vintageflannel.first.webp'),
  vintage_workwear:          require('@/assets/images/diamonds/vintageworkwearpiece.first.webp'),
  vintage_carhartt_jacket:   require('@/assets/images/diamonds/vintagecarharttjacket.first.webp'),
  carhartt_detroit_jacket:   require('@/assets/images/diamonds/carharttdetroitjacket.first.webp'),

  // ── Nike / Sportswear ──
  nike_center_swoosh:        require('@/assets/images/diamonds/nikecenterswoosh.first.webp'),
  vintage_nike_piece:        require('@/assets/images/diamonds/vintagenikepiece.first.webp'),
  vintage_adidas_trefoil:    require('@/assets/images/diamonds/vintageadidastrefoilpiece.first.webp'),
  vintage_starter_jacket:    require('@/assets/images/diamonds/vintagestarterjacket.first.webp'),
  champion_reverse_weave:    require('@/assets/images/diamonds/championreverseweave.first.webp'),
  vintage_sports_team_tee:   require('@/assets/images/diamonds/vintagesportsteamtee.first.webp'),
  vintage_college_sweat:     require('@/assets/images/diamonds/vintagecollegesweatshirt.first.webp'),
  vintage_jersey:            require('@/assets/images/diamonds/vintagejersey.first.webp'),

  // ── Band / Music ──
  vintage_band_tee:          require('@/assets/images/diamonds/vintagetourtee.first.webp'),
  concert_tour_tee:          require('@/assets/images/diamonds/concerttee.first.webp'),
  vintage_music_promo:       require('@/assets/images/diamonds/vintagemusicpromopiece.first.webp'),
  vintage_rap_tee:           require('@/assets/images/diamonds/vintageraptee.first.webp'),

  // ── Racing / Americana ──
  nascar_jacket:             require('@/assets/images/diamonds/NASCARjacket.first.webp'),
  nascar_tee:                require('@/assets/images/diamonds/nascartee.first.webp'),
  racing_team_jacket:        require('@/assets/images/diamonds/Racingteamjacket.webp'),
  vintage_beer_promo_tee:    require('@/assets/images/diamonds/vintagebeerpromotee.first.webp'),
  vintage_casino_tee:        require('@/assets/images/diamonds/vintagecasinotee.first.webp'),
  vintage_souvenir_tee:      require('@/assets/images/diamonds/vintagesouvenirtee.first.webp'),

  // ── Outdoor / Utility ──
  patagonia_synchilla:       require('@/assets/images/diamonds/patagoniasynchilla.first.webp'),
  vintage_patagonia:         require('@/assets/images/diamonds/vintagepatagoniapiece.first.webp'),
  filson_item:               require('@/assets/images/diamonds/filsonitem.first.webp'),
  vintage_hunting_jacket:    require('@/assets/images/diamonds/vintagehuntingjacket.first.webp'),
  vintage_camo_piece:        require('@/assets/images/diamonds/vintagecamopiece.first.webp'),
  vintage_outdoor_vest:      require('@/assets/images/diamonds/vintageoutdoorvest.first.webp'),
  woolrich_wool_piece:       require('@/assets/images/diamonds/woolrichwoolpiece.first.webp'),
  llbean_vintage:            require('@/assets/images/diamonds/L.Lbeanvintagepieceget.first.webp'),
  tnf_nuptse:                require('@/assets/images/diamonds/northfacenuptse.first.webp'),
  arcteryx_shell:            require("@/assets/images/diamonds/arc'teryx shell.first.webp"),

  // ── Streetwear ──
  supreme_item:              require('@/assets/images/diamonds/supreme.item.first.webp'),
  bape_item:                 require('@/assets/images/diamonds/BAPEitem.first.webp'),
  kith_item:                 require('@/assets/images/diamonds/kithitem.first.webp'),
  palace_item:               require('@/assets/images/diamonds/palaceitem.first.webp'),
  vintage_stussy:            require('@/assets/images/diamonds/vintagestussypiece.first.webp'),
  fear_of_god_item:          require('@/assets/images/diamonds/fearofgoditem.first.webp'),
  chrome_hearts_item:        require('@/assets/images/diamonds/chromeheartsitem.first.webp'),

  // ── Women's / Bags / Fashion ──
  vintage_coach_bag:         require('@/assets/images/diamonds/vintagecoachbag.first.webp'),
  vintage_dooney_bag:        require("@/assets/images/diamonds/vintagedooney&bourkebag.first.webp"),
  vintage_leather_purse:     require('@/assets/images/diamonds/vintageleatherpurse.first.webp'),
  vintage_designer_handbag:  require('@/assets/images/diamonds/vitnagedesignerhandbag.first.webp'),
  juicy_couture_velour:      require('@/assets/images/diamonds/juicycouturevelourpiece.first.webp'),
  vintage_vs_piece:          require('@/assets/images/diamonds/vintagevictoriasecret.first.webp'),
  gunne_sax_dress:           require('@/assets/images/diamonds/gunnesaxdress.first.webp'),
  vintage_formal_dress:      require('@/assets/images/diamonds/vintageformaldress.first.webp'),
  vintage_fur_coat:          require('@/assets/images/diamonds/vintagefurfauxcoat.first.webp'),
  vintage_leather_boots:     require('@/assets/images/diamonds/vintageleatherboots.first.webp'),
  vintage_denim_skirt:       require('@/assets/images/diamonds/vintagedenimskirt.first.webp'),
  free_people_statement:     require('@/assets/images/diamonds/freepeoplestatementpiece.first.webp'),
  anthropologie_statement:   require('@/assets/images/diamonds/anthropologiestatementpiece.first.webp'),

  // ── Y2K ──
  y2k_graphic_tee:           require('@/assets/images/diamonds/y2kgraphictee.first.webp'),
  y2k_baggy_denim:           require('@/assets/images/diamonds/y2kbaggydenim.first.webp'),
  y2k_track_jacket:          require('@/assets/images/diamonds/y2ktrackjacket.first.webp'),
  y2k_cargo_pants:           require('@/assets/images/diamonds/y2kcargopants.first.webp'),
  y2k_rhinestone_piece:      require('@/assets/images/diamonds/y2krhinestonepiece.first.webp'),
  y2k_baby_tee:              require('@/assets/images/diamonds/y2kbabytee.first.webp'),
  y2k_designer_bag:          require('@/assets/images/diamonds/y2kdesigner-inspiredbag.first.webp'),

  // ── Accessories / Odd Finds ──
  vintage_watch:             require('@/assets/images/diamonds/vintagewatch.first.webp'),
  vintage_sunglasses:        require('@/assets/images/diamonds/vintagesunglasses.first.webp'),
  vintage_belt_buckle:       require('@/assets/images/diamonds/vintagebeltbuckle.first.webp'),
  sterling_silver_jewelry:   require('@/assets/images/diamonds/sterlingsilverjewelery.first.webp'),
  turquoise_jewelry:         require('@/assets/images/diamonds/turquoisejewelry.first.webp'),
  vintage_snapback:          require('@/assets/images/diamonds/vintagesnapback.first.webp'),
  vintage_trucker_hat:       require('@/assets/images/diamonds/vintagetruckerhat.first.webp'),
  rare_plush:                require('@/assets/images/diamonds/rareplush.first.webp'),
  vintage_video_game:        require('@/assets/images/diamonds/vintagevideogame.first.webp'),
  vintage_camera:            require('@/assets/images/diamonds/vintagecamera.first.webp'),
  old_concert_poster:        require('@/assets/images/diamonds/vintageposter.first.webp'),

  // ── Added after the original 81-asset list ──
  polo_rl_rugby_shirt:         require('@/assets/images/diamonds/polorugby.first.webp'),
  vintage_designer_silk_scarf: require('@/assets/images/diamonds/vintagesilkscarf.webp'),
};

/**
 * Parallel filename map — ONLY for dev logging when an asset fails to load, so
 * the console can name the exact missing file. Keep in sync with the requires above.
 */
export const DIAMOND_ARTWORK_FILENAME_BY_ID: Record<string, string> = {
  vintage_harley_tee: 'vintageharleytee.first.webp',
  vintage_harley_jacket: 'vintageharleyjacket.first.webp',
  motorcycle_rally_tee: 'motorcyclerallytee.first.webp',
  sturgis_tee: 'sturgistee.first.webp',
  vintage_levis_jacket: 'levisdenimjacket.first.webp',
  vintage_levis_501: 'vintagelevis501jeans.first.webp',
  made_in_usa_levis: 'madeinUSAlevis.first.webp',
  vintage_leather_jacket: 'vintageleatherjacket.first.webp',
  vintage_military_jacket: 'militaryjacket.first.webp',
  vintage_varsity_jacket: 'varsityjacket.first.webp',
  vintage_western_shirt: 'vintagewesternpearlsnapshirt.first.webp',
  vintage_flannel: 'vintageflannel.first.webp',
  vintage_workwear: 'vintageworkwearpiece.first.webp',
  vintage_carhartt_jacket: 'vintagecarharttjacket.first.webp',
  carhartt_detroit_jacket: 'carharttdetroitjacket.first.webp',
  nike_center_swoosh: 'nikecenterswoosh.first.webp',
  vintage_nike_piece: 'vintagenikepiece.first.webp',
  vintage_adidas_trefoil: 'vintageadidastrefoilpiece.first.webp',
  vintage_starter_jacket: 'vintagestarterjacket.first.webp',
  champion_reverse_weave: 'championreverseweave.first.webp',
  vintage_sports_team_tee: 'vintagesportsteamtee.first.webp',
  vintage_college_sweat: 'vintagecollegesweatshirt.first.webp',
  vintage_jersey: 'vintagejersey.first.webp',
  vintage_band_tee: 'vintagetourtee.first.webp',
  concert_tour_tee: 'concerttee.first.webp',
  vintage_music_promo: 'vintagemusicpromopiece.first.webp',
  vintage_rap_tee: 'vintageraptee.first.webp',
  nascar_jacket: 'NASCARjacket.first.webp',
  nascar_tee: 'nascartee.first.webp',
  racing_team_jacket: 'Racingteamjacket.webp',
  vintage_beer_promo_tee: 'vintagebeerpromotee.first.webp',
  vintage_casino_tee: 'vintagecasinotee.first.webp',
  vintage_souvenir_tee: 'vintagesouvenirtee.first.webp',
  patagonia_synchilla: 'patagoniasynchilla.first.webp',
  vintage_patagonia: 'vintagepatagoniapiece.first.webp',
  filson_item: 'filsonitem.first.webp',
  vintage_hunting_jacket: 'vintagehuntingjacket.first.webp',
  vintage_camo_piece: 'vintagecamopiece.first.webp',
  vintage_outdoor_vest: 'vintageoutdoorvest.first.webp',
  woolrich_wool_piece: 'woolrichwoolpiece.first.webp',
  llbean_vintage: 'L.Lbeanvintagepieceget.first.webp',
  tnf_nuptse: 'northfacenuptse.first.webp',
  arcteryx_shell: "arc'teryx shell.first.webp",
  supreme_item: 'supreme.item.first.webp',
  bape_item: 'BAPEitem.first.webp',
  kith_item: 'kithitem.first.webp',
  palace_item: 'palaceitem.first.webp',
  vintage_stussy: 'vintagestussypiece.first.webp',
  fear_of_god_item: 'fearofgoditem.first.webp',
  chrome_hearts_item: 'chromeheartsitem.first.webp',
  vintage_coach_bag: 'vintagecoachbag.first.webp',
  vintage_dooney_bag: 'vintagedooney&bourkebag.first.webp',
  vintage_leather_purse: 'vintageleatherpurse.first.webp',
  vintage_designer_handbag: 'vitnagedesignerhandbag.first.webp',
  juicy_couture_velour: 'juicycouturevelourpiece.first.webp',
  vintage_vs_piece: 'vintagevictoriasecret.first.webp',
  gunne_sax_dress: 'gunnesaxdress.first.webp',
  vintage_formal_dress: 'vintageformaldress.first.webp',
  vintage_fur_coat: 'vintagefurfauxcoat.first.webp',
  vintage_leather_boots: 'vintageleatherboots.first.webp',
  vintage_denim_skirt: 'vintagedenimskirt.first.webp',
  free_people_statement: 'freepeoplestatementpiece.first.webp',
  anthropologie_statement: 'anthropologiestatementpiece.first.webp',
  y2k_graphic_tee: 'y2kgraphictee.first.webp',
  y2k_baggy_denim: 'y2kbaggydenim.first.webp',
  y2k_track_jacket: 'y2ktrackjacket.first.webp',
  y2k_cargo_pants: 'y2kcargopants.first.webp',
  y2k_rhinestone_piece: 'y2krhinestonepiece.first.webp',
  y2k_baby_tee: 'y2kbabytee.first.webp',
  y2k_designer_bag: 'y2kdesigner-inspiredbag.first.webp',
  vintage_watch: 'vintagewatch.first.webp',
  vintage_sunglasses: 'vintagesunglasses.first.webp',
  vintage_belt_buckle: 'vintagebeltbuckle.first.webp',
  sterling_silver_jewelry: 'sterlingsilverjewelery.first.webp',
  turquoise_jewelry: 'turquoisejewelry.first.webp',
  vintage_snapback: 'vintagesnapback.first.webp',
  vintage_trucker_hat: 'vintagetruckerhat.first.webp',
  rare_plush: 'rareplush.first.webp',
  vintage_video_game: 'vintagevideogame.first.webp',
  vintage_camera: 'vintagecamera.first.webp',
  old_concert_poster: 'vintageposter.first.webp',
  polo_rl_rugby_shirt: 'polorugby.first.webp',
  vintage_designer_silk_scarf: 'vintagesilkscarf.webp',
};

/** The static artwork for a Diamond id, or undefined if none is mapped. */
export function getDiamondArtwork(id: string): ArtworkSource | undefined {
  return DIAMOND_ARTWORK_BY_ID[id];
}

/** The on-disk filename for a Diamond id (dev logging only). */
export function getDiamondArtworkFilename(id: string): string | undefined {
  return DIAMOND_ARTWORK_FILENAME_BY_ID[id];
}

/**
 * Dev-only: warn if any active Diamond id is missing an artwork entry.
 * Call once when the Diamonds screen mounts. No-op in production.
 */
export function validateDiamondArtwork(activeIds: string[]): void {
  if (!__DEV__) return;
  const missing = activeIds.filter(id => !DIAMOND_ARTWORK_BY_ID[id]);
  if (missing.length) {
    // eslint-disable-next-line no-console
    console.warn(
      `[diamondArtwork] ${missing.length} active Diamond(s) missing artwork:`,
      missing.join(', '),
    );
  }
}
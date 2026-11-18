/**
 * components/hunt/leaderboard/theme.ts
 *
 * The Hunt Leaderboard's colours. Cream paper, forest ink, and antique gold
 * kept for two things only: first place and the viewer's own card.
 */
export const LB = {
    BG:          '#F0E8D4',
    CARD:        '#FFF9EE',
    CARD_EDGE:   '#DDD0B0',
    LINE:        '#D6C8A2',
    FOREST:      '#2A4A2A',
    FOREST_DEEP: '#1E3A1E',
    BROWN:       '#5A3A1A',
    MUTED:       '#8A7050',
    GOLD:        '#BE9C2C',
    GOLD_DEEP:   '#9A7C18',
    GOLD_WASH:   '#F6ECC8',
    CREAM:       '#F4EED8',
    AVATAR_BG:   '#E6ECEA',
    AVATAR_FG:   '#8AABBF',
    RED:         '#8A2A1A',
    SKELETON:    '#E3D8BC',
  } as const;
  
  /** Text grows with the phone's text size setting up to this, and no further. */
  export const MAX_TEXT_SCALE = 1.5;
/**
 * components/hunt/discovery/theme.ts
 *
 * Hunt Mode's Discovery Analysis palette — cream, forest green, antique gold,
 * brown ink. Same values the screen used before the rebuild, in one place.
 */
import type { HuntRating } from '@/lib/huntEconomics';

export const H = {
  bg:     '#F0E8D4',
  card:   '#FFF9EE',
  cardB:  '#DDD0B0',
  forest: '#2A4A2A',
  brown:  '#5A3A1A',
  muted:  '#8A7050',
  gold:   '#BE9C2C',
  goldL:  '#D4A72C',
  cream:  '#F4EED8',
  red:    '#8A2A1A',
  green:  '#2A6A2A',
  warn:   '#8A3A2A',
} as const;

export const HUNT_BADGE: Record<HuntRating, {
  label: string; emoji: string; bg: string; border: string; text: string; glow?: string;
}> = {
  legendary: { label: 'Legendary Loot', emoji: '👑', bg: '#2A1E04', border: '#D4A72C', text: '#D4A72C', glow: '#D4A72C55' },
  treasure:  { label: 'Treasure',       emoji: '💰', bg: '#1A2A06', border: '#BE9C2C', text: '#D9BE5C' },
  risky:     { label: 'Risky Buy',      emoji: '⚠️', bg: '#2A1A04', border: '#C89020', text: '#E0A93A' },
  trash:     { label: 'Skip',           emoji: '✕',  bg: '#6B1414', border: '#E05555', text: '#FFDADA', glow: '#E0555522' },
};
/**
 * lib/BrandRevealModal.tsx
 *
 * FILE PATH: lib/BrandRevealModal.tsx
 *
 * Pass 2 — Brand discovery reveal modal.
 * Four distinct experiences keyed off rarity:
 *
 *   common    → quick card flip, simple
 *   uncommon  → card slide + subtle glow
 *   rare      → background dim + card emerge + vintage sparkle
 *   legendary → full-screen treasure moment, gold light burst,
 *               per-brand variation (accent color + particles + tagline)
 *
 * Usage:
 *   <BrandRevealModal
 *     brand={{ name, rarity, category, globalUnlockRate }}
 *     totalDiscovered={13}
 *     totalBrands={241}
 *     visible={!!revealBrand}
 *     onContinue={() => setRevealBrand(null)}
 *   />
 */

import React, { useEffect, useRef } from 'react';
import {
  View, Text, Modal, StyleSheet, Pressable, Animated, Dimensions, Easing,
} from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { FONTS } from '@/constants/typography';
import {
  RARITY_COLORS, RARITY_LABELS, CATEGORY_LABELS,
  type Brand, type BrandRarity,
} from '@/lib/brandCompendium';

const { width: SW, height: SH } = Dimensions.get('window');

// ─── Palette ──────────────────────────────────────────────────────────────────
const FOREST = '#2A4A2A';
const GOLD   = '#BE9C2C';
const CARD   = '#F2EDD8';
const IVORY  = '#FAF6EE';
const BORDER = '#C8B88A';
const BROWN  = '#3D2A12';
const MUTED  = '#8A7050';

// ─── Per-legendary-brand variation ──────────────────────────────────────────────
// Different feel per legendary brand: accent, particle style, tagline.

type ParticleStyle = 'gold' | 'silver' | 'crimson' | 'emerald' | 'royal';

interface LegendaryVariant {
  accent:    string;
  particles: ParticleStyle;
  tagline:   string;
}

const LEGENDARY_VARIANTS: Record<string, LegendaryVariant> = {
  'Gucci':           { accent: '#1B5E20', particles: 'emerald', tagline: 'A house of Italian dynasty.' },
  'Louis Vuitton':   { accent: '#5D4037', particles: 'gold',    tagline: 'The monogram that defined luxury.' },
  'Chanel':          { accent: '#1A1A1A', particles: 'silver',  tagline: 'Timeless. Untouchable.' },
  'Dior':            { accent: '#2C2C2C', particles: 'silver',  tagline: 'Parisian haute couture.' },
  'Hermès':          { accent: '#E25822', particles: 'gold',    tagline: 'The pinnacle of craftsmanship.' },
  'Rolex':           { accent: '#006039', particles: 'gold',    tagline: 'A crown among watches.' },
  'Cartier':         { accent: '#9B1B30', particles: 'crimson', tagline: 'Jeweler to kings.' },
  'Supreme':         { accent: '#DA1F26', particles: 'crimson', tagline: 'The box logo grail.' },
  'Chrome Hearts':   { accent: '#1A1A1A', particles: 'silver',  tagline: 'Sterling silver rebellion.' },
  'Stone Island':    { accent: '#1B3A5C', particles: 'royal',   tagline: 'The compass badge.' },
  'Moncler':         { accent: '#1B3A5C', particles: 'royal',   tagline: 'Alpine luxury.' },
  'Canada Goose':    { accent: '#9B1B30', particles: 'crimson', tagline: 'Arctic-grade prestige.' },
  'Balenciaga':      { accent: '#1A1A1A', particles: 'silver',  tagline: 'Avant-garde dominance.' },
  'Prada':           { accent: '#1B3A5C', particles: 'royal',   tagline: 'Milanese icon.' },
  'Burberry':        { accent: '#5D4037', particles: 'gold',    tagline: 'The heritage check.' },
};

const DEFAULT_LEGENDARY: LegendaryVariant = {
  accent: GOLD, particles: 'gold', tagline: 'A true grail discovery.',
};

const PARTICLE_COLORS: Record<ParticleStyle, string> = {
  gold:    '#FFD700',
  silver:  '#D8D8E0',
  crimson: '#FF4D4D',
  emerald: '#3DDC84',
  royal:   '#5B90D8',
};

// ─── Particle systems ─────────────────────────────────────────────────────────

function SparkleField({ color, count = 8 }: { color: string; count?: number }) {
  const anims = useRef([...Array(count)].map(() => new Animated.Value(0))).current;

  useEffect(() => {
    const animations = anims.map((a, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 160),
          Animated.timing(a, { toValue: 1, duration: 1000, useNativeDriver: true }),
          Animated.timing(a, { toValue: 0, duration: 300, useNativeDriver: true }),
        ])
      )
    );
    Animated.parallel(animations).start();
    return () => animations.forEach(a => a.stop());
  }, []);

  const positions = [
    { x: -90, y: -70 }, { x: 90, y: -70 }, { x: -110, y: 10 }, { x: 110, y: 10 },
    { x: -70, y: 90 }, { x: 70, y: 90 }, { x: 0, y: -110 }, { x: 0, y: 120 },
  ];

  return (
    <>
      {anims.map((a, i) => {
        const p = positions[i % positions.length];
        return (
          <Animated.Text
            key={i}
            style={{
              position: 'absolute',
              left: SW / 2 + p.x,
              top: SH * 0.36 + p.y,
              fontSize: i % 2 === 0 ? 18 : 12,
              color,
              opacity: a,
              transform: [{ scale: a }],
            }}
          >
            ✦
          </Animated.Text>
        );
      })}
    </>
  );
}

function LightBurst({ color }: { color: string }) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 2200, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: SW / 2 - 150,
        top: SH * 0.36 - 150,
        width: 300, height: 300, borderRadius: 150,
        backgroundColor: color,
        opacity: anim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 0.18, 0] }),
        transform: [{ scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1.6] }) }],
      }}
    />
  );
}

// ─── Main modal ───────────────────────────────────────────────────────────────

interface Props {
  brand:           Brand | null;
  totalDiscovered: number;
  totalBrands:     number;
  visible:         boolean;
  onContinue:      () => void;
}

export function BrandRevealModal({
  brand, totalDiscovered, totalBrands, visible, onContinue,
}: Props) {
  const bgFade    = useRef(new Animated.Value(0)).current;
  const cardScale = useRef(new Animated.Value(0)).current;
  const cardSlide = useRef(new Animated.Value(0)).current;
  const flip      = useRef(new Animated.Value(0)).current;
  const contentFade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible && brand) {
      bgFade.setValue(0);
      cardScale.setValue(0);
      cardSlide.setValue(0);
      flip.setValue(0);
      contentFade.setValue(0);

      const rarity = brand.rarity;

      if (rarity === 'common') {
        // Quick flip
        Animated.sequence([
          Animated.timing(bgFade, { toValue: 1, duration: 180, useNativeDriver: true }),
          Animated.parallel([
            Animated.timing(flip, { toValue: 1, duration: 420, easing: Easing.out(Easing.ease), useNativeDriver: true }),
            Animated.timing(contentFade, { toValue: 1, duration: 380, useNativeDriver: true }),
          ]),
        ]).start();
      } else if (rarity === 'uncommon') {
        // Slide up + glow
        Animated.sequence([
          Animated.timing(bgFade, { toValue: 1, duration: 220, useNativeDriver: true }),
          Animated.parallel([
            Animated.spring(cardSlide, { toValue: 1, useNativeDriver: true, damping: 14, stiffness: 120 }),
            Animated.timing(contentFade, { toValue: 1, duration: 420, useNativeDriver: true }),
          ]),
        ]).start();
      } else {
        // Rare + legendary — dim, then card springs in
        Animated.sequence([
          Animated.timing(bgFade, { toValue: 1, duration: 350, useNativeDriver: true }),
          Animated.parallel([
            Animated.spring(cardScale, { toValue: 1, useNativeDriver: true, damping: 10, stiffness: 90, mass: 0.9 }),
            Animated.timing(contentFade, { toValue: 1, duration: 500, useNativeDriver: true }),
          ]),
        ]).start();
      }
    }
  }, [visible, brand]);

  if (!brand) return null;

  const rarity = brand.rarity;
  const color  = RARITY_COLORS[rarity];
  const isLegendary = rarity === 'legendary';
  const isRare      = rarity === 'rare';

  const variant = isLegendary
    ? (LEGENDARY_VARIANTS[brand.name] ?? DEFAULT_LEGENDARY)
    : null;

  const particleColor = variant ? PARTICLE_COLORS[variant.particles] : color;

  // ── Header copy per tier ───────────────────────────────────────────────────
  const eyebrow =
    isLegendary ? 'LEGENDARY BRAND FOUND' :
    isRare      ? 'RARE BRAND DISCOVERED' :
    rarity === 'uncommon' ? 'NEW UNCOMMON BRAND' :
    'NEW BRAND DISCOVERED';

  // ── Render: legendary gets full-screen treatment ───────────────────────────
  if (isLegendary) {
    return (
      <Modal visible={visible} transparent animationType="none" statusBarTranslucent onRequestClose={onContinue}>
        <Animated.View style={[s.legendaryRoot, { opacity: bgFade }]}>
          <LightBurst color={variant!.accent} />
          <SparkleField color={particleColor} count={10} />

          <Animated.Text style={[s.legEyebrow, { opacity: contentFade }]}>
            ✦  {eyebrow}  ✦
          </Animated.Text>

          {/* Badge */}
          <Animated.View style={[s.legBadgeWrap, { transform: [{ scale: cardScale }] }]}>
            <View style={[s.legGlow, { borderColor: GOLD + '40' }]} />
            <View style={[s.legBadge, { backgroundColor: variant!.accent, borderColor: GOLD }]}>
              <MaterialIcons name="workspace-premium" size={64} color={GOLD} />
            </View>
          </Animated.View>

          <Animated.View style={[s.legContent, { opacity: contentFade }]}>
            <Text style={s.legBrandName}>{brand.name}</Text>
            <Text style={s.legTagline}>{variant!.tagline}</Text>
            <Text style={s.legAdded}>Added To Your Collection</Text>

            <View style={s.legRatePill}>
              <Text style={s.legRateText}>
                Unlocked by only {brand.globalUnlockRate}% of users
              </Text>
            </View>

            <View style={s.legProgressBlock}>
              <Text style={s.legProgressLabel}>Collection Progress</Text>
              <Text style={s.legProgressCount}>
                {totalDiscovered} / {totalBrands} Brands
              </Text>
            </View>
          </Animated.View>

          <Animated.View style={{ opacity: contentFade, width: '100%', alignItems: 'center' }}>
            <Pressable
              onPress={onContinue}
              style={({ pressed }) => [s.legBtn, pressed && { opacity: 0.85, transform: [{ scale: 0.97 }] }]}
            >
              <Text style={s.legBtnText}>Continue</Text>
            </Pressable>
          </Animated.View>
        </Animated.View>
      </Modal>
    );
  }

  // ── Render: common / uncommon / rare share a centered card ──────────────────
  const cardTransform =
    rarity === 'common'
      ? [{ rotateY: flip.interpolate({ inputRange: [0, 1], outputRange: ['90deg', '0deg'] }) }]
      : rarity === 'uncommon'
        ? [{ translateY: cardSlide.interpolate({ inputRange: [0, 1], outputRange: [80, 0] }) }]
        : [{ scale: cardScale }];

  return (
    <Modal visible={visible} transparent animationType="none" statusBarTranslucent onRequestClose={onContinue}>
      <Animated.View style={[
        s.root,
        { opacity: bgFade, backgroundColor: isRare ? 'rgba(10,8,4,0.92)' : 'rgba(20,16,10,0.78)' },
      ]}>

        {/* Rare gets a sparkle field */}
        {isRare && <SparkleField color={color} count={6} />}

        <Animated.View style={[
          s.card,
          { borderColor: color },
          rarity === 'uncommon' && { shadowColor: color, shadowOpacity: 0.5, shadowRadius: 20, shadowOffset: { width: 0, height: 0 } },
          { transform: cardTransform },
        ]}>
          {/* Accent top bar */}
          <View style={[s.cardAccent, { backgroundColor: color }]} />

          {/* Icon */}
          <View style={[s.cardIcon, { backgroundColor: color + '1A', borderColor: color }]}>
            <MaterialIcons
              name={isRare ? 'diamond' : rarity === 'uncommon' ? 'grade' : 'local-offer'}
              size={40}
              color={color}
            />
          </View>

          <Animated.View style={{ opacity: contentFade, alignItems: 'center', gap: 6 }}>
            <Text style={[s.cardEyebrow, { color }]}>{eyebrow}</Text>
            <Text style={s.cardBrandName}>{brand.name}</Text>
            <Text style={s.cardCategory}>{CATEGORY_LABELS[brand.category]}</Text>

            <View style={[s.cardRarityBadge, { backgroundColor: color + '18', borderColor: color + '55' }]}>
              <Text style={[s.cardRarityText, { color }]}>{RARITY_LABELS[rarity]}</Text>
            </View>

            <Text style={s.cardAdded}>Added to Brand Compendium</Text>

            <Text style={s.cardRate}>
              Unlocked by {brand.globalUnlockRate}% of users
            </Text>
          </Animated.View>

          <Pressable
            onPress={onContinue}
            style={({ pressed }) => [s.cardBtn, { backgroundColor: color }, pressed && { opacity: 0.85 }]}
          >
            <Text style={s.cardBtnText}>Continue</Text>
          </Pressable>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  // Common / uncommon / rare
  root: {
    flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32,
  },
  card: {
    width: '100%', maxWidth: 340,
    backgroundColor: IVORY,
    borderRadius: 20, borderWidth: 2,
    paddingTop: 0, paddingBottom: 22, paddingHorizontal: 24,
    alignItems: 'center', gap: 14,
    overflow: 'hidden',
  },
  cardAccent: {
    position: 'absolute', top: 0, left: 0, right: 0, height: 5,
  },
  cardIcon: {
    width: 76, height: 76, borderRadius: 38, borderWidth: 2,
    justifyContent: 'center', alignItems: 'center',
    marginTop: 28,
  },
  cardEyebrow: {
    fontSize: 11, fontWeight: '800', letterSpacing: 1.6, textTransform: 'uppercase',
  },
  cardBrandName: {
    fontFamily: FONTS.serif, fontSize: 26, fontWeight: '900', color: BROWN, textAlign: 'center',
  },
  cardCategory: { fontSize: 12, color: MUTED },
  cardRarityBadge: {
    borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 3, marginTop: 2,
  },
  cardRarityText: { fontSize: 10, fontWeight: '900', letterSpacing: 0.6 },
  cardAdded: { fontSize: 13, color: FOREST, fontWeight: '600', marginTop: 4 },
  cardRate:  { fontSize: 11, color: MUTED, fontStyle: 'italic' },
  cardBtn: {
    borderRadius: 50, paddingVertical: 13, paddingHorizontal: 48, marginTop: 8, minWidth: 180, alignItems: 'center',
  },
  cardBtnText: { fontFamily: FONTS.serif, fontSize: 16, fontWeight: '900', color: '#FAF7EE', letterSpacing: 0.5 },

  // Legendary full-screen
  legendaryRoot: {
    flex: 1, backgroundColor: '#0A0700',
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 32, gap: 22,
  },
  legEyebrow: {
    fontSize: 13, fontWeight: '900', letterSpacing: 2.4, color: GOLD, textAlign: 'center',
  },
  legBadgeWrap: { position: 'relative', alignItems: 'center', justifyContent: 'center' },
  legGlow: {
    position: 'absolute', width: 180, height: 180, borderRadius: 90, borderWidth: 1.5,
  },
  legBadge: {
    width: 130, height: 130, borderRadius: 65, borderWidth: 3,
    justifyContent: 'center', alignItems: 'center',
  },
  legContent: { alignItems: 'center', gap: 8 },
  legBrandName: {
    fontFamily: FONTS.serif, fontSize: 38, fontWeight: '900', color: GOLD, textAlign: 'center', letterSpacing: 1,
  },
  legTagline: { fontSize: 14, color: '#D8C8A0', fontStyle: 'italic', textAlign: 'center' },
  legAdded:   { fontSize: 15, color: '#E8E0D0', fontWeight: '600', marginTop: 4 },
  legRatePill: {
    borderWidth: 1, borderColor: GOLD + '60', borderRadius: 50,
    paddingHorizontal: 16, paddingVertical: 7, marginTop: 8,
  },
  legRateText: { fontSize: 12, color: GOLD, fontWeight: '700' },
  legProgressBlock: { alignItems: 'center', gap: 3, marginTop: 14 },
  legProgressLabel: { fontSize: 11, color: '#A09080', letterSpacing: 1, textTransform: 'uppercase' },
  legProgressCount: { fontFamily: FONTS.serif, fontSize: 18, fontWeight: '800', color: '#F0E6D0' },
  legBtn: {
    backgroundColor: GOLD, borderRadius: 50, paddingVertical: 15, paddingHorizontal: 56, minWidth: 200, alignItems: 'center',
  },
  legBtnText: { fontFamily: FONTS.serif, fontSize: 17, fontWeight: '900', color: '#0A0700', letterSpacing: 0.5 },
});
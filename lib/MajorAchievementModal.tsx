/**
 * lib/MajorAchievementModal.tsx
 *
 * FILE PATH: lib/MajorAchievementModal.tsx
 *
 * Full-screen celebration modal for major FlipStart achievements.
 * Each achievement has a completely unique visual experience.
 *
 * Designs:
 *   first_achievement  — gold dawn, "Finally Flipping" (the first scan)
 *   weekly_podium      — bronze-gold, top 3 on a finished Weekly board
 *   weekly_champion    — crown gold, #1 on a finished Weekly board
 *   week_streak_2 … _26 — one design per streak length (2, 3, 4, 8, 12, 26
 *                        weeks), each its own colour, icon and words
 *   holy_grail / heavy_hitter / bin_diver / treasure_hunter / scan_machine /
 *   time_traveler      — mid-game milestones, shown on the main tabs
 *   jackpot            — blazing amber, cascading coin glow
 *   band_tee_bloodhound — warm sepia, drifting music notes
 *   master_scanner     — deep teal, animated scan beam
 *   flipstart_legend   — pure gold darkness, shooting stars
 *   brand_encyclopedia — dark navy, orbiting knowledge dots
 *   hunt_mode_legend   — blackest green, crown + star burst
 *   never_miss         — ember red, rising fire particles
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, Modal, StyleSheet, Pressable,
  Animated, Dimensions,
} from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { FONTS } from '@/constants/typography';
import { TOTAL_ACHIEVEMENTS } from '@/lib/achievements';

// Defined locally to avoid cross-lib import issues
export type MajorAchievementType =
  | 'first_achievement'
  | 'jackpot'
  | 'band_tee_bloodhound'
  | 'master_scanner'
  | 'flipstart_legend'
  | 'brand_encyclopedia'
  | 'hunt_mode_legend'
  | 'never_miss'
  | 'weekly_podium'
  | 'weekly_champion'
  | 'week_streak_2'
  | 'week_streak_3'
  | 'week_streak_4'
  | 'week_streak_8'
  | 'week_streak_12'
  | 'week_streak_26'
  | 'holy_grail'
  | 'heavy_hitter'
  | 'bin_diver'
  | 'treasure_hunter'
  | 'scan_machine'
  | 'time_traveler';

const { width: SW, height: SH } = Dimensions.get('window');

// ─── Per-achievement config ───────────────────────────────────────────────────

interface AchievementConfig {
  bg:          string;
  ringColor:   string;
  icon:        string;
  iconColor:   string;
  eyebrow:     string;
  title:       string;
  body:        string;
  subtext:     string;
  btnText:     string;
  btnBg:       string;
  btnText2:    string;
  particles:   'sparkles' | 'coins' | 'notes' | 'scan' | 'stars' | 'orbit' | 'fire';
}

const CONFIGS: Record<MajorAchievementType, AchievementConfig> = {
  first_achievement: {
    bg:        '#060F06',
    ringColor: '#BE9C2C',
    icon:      'emoji-events',
    iconColor: '#BE9C2C',
    eyebrow:   '✦  First Achievement  ✦',
    title:     'Finally\nFlipping',
    body:      'Scan your first item.',
    subtext:   `You got one. ${TOTAL_ACHIEVEMENTS - 1} more are waiting for you.`,
    btnText:   'Let\'s Go',
    btnBg:     '#BE9C2C',
    btnText2:  '#060F06',
    particles: 'sparkles',
  },
  jackpot: {
    bg:        '#120C00',
    ringColor: '#FFD700',
    icon:      'attach-money',
    iconColor: '#FFD700',
    eyebrow:   '✦  Rare Find Achievement  ✦',
    title:     'JACKPOT',
    body:      '$250+ profit on a single flip.',
    subtext:   'This is exactly why you hunt.',
    btnText:   'Bank It',
    btnBg:     '#2A5A20',
    btnText2:  '#FFD700',
    particles: 'coins',
  },
  band_tee_bloodhound: {
    bg:        '#0F0800',
    ringColor: '#D4943A',
    icon:      'local-offer',
    iconColor: '#D4943A',
    eyebrow:   '✦  Era Achievement  ✦',
    title:     'Band Tee\nBloodhound',
    body:      'You\'ve got a nose for rare vintage music.',
    subtext:   'The rarest finds in the thrift game.',
    btnText:   'Keep Hunting',
    btnBg:     '#D4943A',
    btnText2:  '#0F0800',
    particles: 'notes',
  },
  master_scanner: {
    bg:        '#040F0D',
    ringColor: '#3AB8A0',
    icon:      'camera-alt',
    iconColor: '#3AB8A0',
    eyebrow:   '✦  Scan Achievement  ✦',
    title:     'MASTER\nSCANNER',
    body:      '5,000 scans. The market knows your face.',
    subtext:   'You see what others walk past.',
    btnText:   'Keep Scanning',
    btnBg:     '#3AB8A0',
    btnText2:  '#040F0D',
    particles: 'scan',
  },
  flipstart_legend: {
    bg:        '#0D0900',
    ringColor: '#FFD700',
    icon:      'workspace-premium',
    iconColor: '#FFD700',
    eyebrow:   '✦  The Ultimate Achievement  ✦',
    title:     'FLIPSTART\nLEGEND',
    body:      '$10,000 in total profit.',
    subtext:   'You have mastered the flip.',
    btnText:   'Legendary',
    btnBg:     '#B8960C',
    btnText2:  '#0D0900',
    particles: 'stars',
  },
  brand_encyclopedia: {
    bg:        '#050910',
    ringColor: '#5B90D8',
    icon:      'auto-stories',
    iconColor: '#5B90D8',
    eyebrow:   '✦  Brand Achievement  ✦',
    title:     'Brand\nEncyclopedia',
    body:      '100 unique brands discovered.',
    subtext:   'Your knowledge is unmatched.',
    btnText:   'Continue',
    btnBg:     '#5B90D8',
    btnText2:  '#050910',
    particles: 'orbit',
  },
  hunt_mode_legend: {
    bg:        '#030C03',
    ringColor: '#BE9C2C',
    icon:      'emoji-events',
    iconColor: '#BE9C2C',
    eyebrow:   '✦  Hunt Mode Achievement  ✦',
    title:     'HUNT MODE\nLEGEND',
    body:      '250 Hunts completed.',
    subtext:   'You are the apex predator.',
    btnText:   'Continue',
    btnBg:     '#1A4A1A',
    btnText2:  '#BE9C2C',
    particles: 'sparkles',
  },
  never_miss: {
    bg:        '#130400',
    ringColor: '#FF6A20',
    icon:      'local-fire-department',
    iconColor: '#FF6A20',
    eyebrow:   '✦  Streak Achievement  ✦',
    title:     'NEVER MISS',
    body:      '52 weeks in a row.',
    subtext:   'Unbreakable.',
    btnText:   'Keep Going',
    btnBg:     '#CC4400',
    btnText2:  '#FFF8F0',
    particles: 'fire',
  },
  weekly_podium: {
    bg:        '#0C0A04',
    ringColor: '#D9A441',
    icon:      'military-tech',
    iconColor: '#D9A441',
    eyebrow:   '✦  Hunt Mode Achievement  ✦',
    title:     'PODIUM',
    body:      'You finished the week in the top 3.',
    subtext:   'Weekly XP leaderboard.',
    btnText:   'Continue',
    btnBg:     '#1A4A1A',
    btnText2:  '#D9A441',
    particles: 'sparkles',
  },
  weekly_champion: {
    bg:        '#0D0900',
    ringColor: '#FFD700',
    icon:      'emoji-events',
    iconColor: '#FFD700',
    eyebrow:   '✦  Hunt Mode Achievement  ✦',
    title:     'KING OF\nTHE WEEK',
    body:      'You finished the week at #1.',
    subtext:   'Nobody out-hunted you.',
    btnText:   'Take the Crown',
    btnBg:     '#B8960C',
    btnText2:  '#0D0900',
    particles: 'stars',
  },
  week_streak_2: {
    bg:        '#130400',
    ringColor: '#FF6A20',
    icon:      'local-fire-department',
    iconColor: '#FF6A20',
    eyebrow:   '✦  Hunt Streak: Back for More  ✦',
    title:     '2 WEEK\nSTREAK',
    body:      'You hunted 2 weeks in a row.',
    subtext:   'Your first streak. Hunt next week to make it 3.',
    btnText:   'Keep It Going',
    btnBg:     '#CC4400',
    btnText2:  '#FFF8F0',
    particles: 'fire',
  },
  week_streak_3: {
    bg:        '#140B00',
    ringColor: '#FFB020',
    icon:      'whatshot',
    iconColor: '#FFB020',
    eyebrow:   '✦  Hunt Streak: On Fire  ✦',
    title:     '3 WEEK\nSTREAK',
    body:      'You hunted 3 weeks in a row.',
    subtext:   'Three straight. This is becoming a habit.',
    btnText:   'Stay Hot',
    btnBg:     '#B87400',
    btnText2:  '#140B00',
    particles: 'sparkles',
  },
  week_streak_4: {
    bg:        '#12020A',
    ringColor: '#FF4D6D',
    icon:      'bolt',
    iconColor: '#FF4D6D',
    eyebrow:   '✦  Hunt Streak: Locked In  ✦',
    title:     '4 WEEK\nSTREAK',
    body:      'You hunted 4 weeks in a row.',
    subtext:   'A full month without missing a week.',
    btnText:   'Locked In',
    btnBg:     '#B3123A',
    btnText2:  '#FFF1F4',
    particles: 'stars',
  },
  week_streak_8: {
    bg:        '#030C03',
    ringColor: '#7CC576',
    icon:      'pets',
    iconColor: '#7CC576',
    eyebrow:   '✦  Hunt Streak: Hunt Predator  ✦',
    title:     '8 WEEK\nSTREAK',
    body:      'You hunted 8 weeks in a row.',
    subtext:   'Two months. The racks know you by now.',
    btnText:   'Keep Hunting',
    btnBg:     '#1A4A1A',
    btnText2:  '#D8F2D4',
    particles: 'orbit',
  },
  week_streak_12: {
    bg:        '#0A0514',
    ringColor: '#B48CFF',
    icon:      'rocket-launch',
    iconColor: '#B48CFF',
    eyebrow:   '✦  Hunt Streak: Unstoppable  ✦',
    title:     '12 WEEK\nSTREAK',
    body:      'You hunted 12 weeks in a row.',
    subtext:   'Three months straight. Almost nobody does this.',
    btnText:   'Unstoppable',
    btnBg:     '#5B2FC0',
    btnText2:  '#F3ECFF',
    particles: 'stars',
  },
  week_streak_26: {
    bg:        '#03101A',
    ringColor: '#4FC3F7',
    icon:      'military-tech',
    iconColor: '#4FC3F7',
    eyebrow:   '✦  Hunt Streak: Dedication Pays  ✦',
    title:     '26 WEEK\nSTREAK',
    body:      'You hunted 26 weeks in a row.',
    subtext:   'Half a year of Hunts, every single week.',
    btnText:   'Halfway to Never Miss',
    btnBg:     '#0B6FA4',
    btnText2:  '#EAF8FF',
    particles: 'coins',
  },
  holy_grail: {
    bg:        '#0D0900',
    ringColor: '#FFD700',
    icon:      'diamond',
    iconColor: '#FFD700',
    eyebrow:   '✦  Rare Find Achievement  ✦',
    title:     'HOLY GRAIL',
    body:      'An item worth $1,000 or more.',
    subtext:   'Most hunters never find one.',
    btnText:   'Unreal',
    btnBg:     '#B8960C',
    btnText2:  '#0D0900',
    particles: 'stars',
  },
  heavy_hitter: {
    bg:        '#120C00',
    ringColor: '#F2B632',
    icon:      'auto-awesome',
    iconColor: '#F2B632',
    eyebrow:   '✦  Rare Find Achievement  ✦',
    title:     'HEAVY\nHITTER',
    body:      'An item worth $500 or more.',
    subtext:   'That one pays for a lot of thrift trips.',
    btnText:   'Bank It',
    btnBg:     '#2A5A20',
    btnText2:  '#F2B632',
    particles: 'coins',
  },
  bin_diver: {
    bg:        '#061008',
    ringColor: '#7CC576',
    icon:      'savings',
    iconColor: '#7CC576',
    eyebrow:   '✦  Rare Find Achievement  ✦',
    title:     'BIN DIVER',
    body:      'You paid $5 or less for an item worth $100+.',
    subtext:   'This is the whole game.',
    btnText:   'Keep Digging',
    btnBg:     '#2A5A20',
    btnText2:  '#E8F5E4',
    particles: 'coins',
  },
  treasure_hunter: {
    bg:        '#0C0A04',
    ringColor: '#BE9C2C',
    icon:      'trending-up',
    iconColor: '#BE9C2C',
    eyebrow:   '✦  Profit Achievement  ✦',
    title:     'TREASURE\nHUNTER',
    body:      '$1,000 in total estimated profit.',
    subtext:   'Four figures. This is real now.',
    btnText:   'Keep Flipping',
    btnBg:     '#BE9C2C',
    btnText2:  '#0C0A04',
    particles: 'sparkles',
  },
  scan_machine: {
    bg:        '#040F0D',
    ringColor: '#3AB8A0',
    icon:      'camera-alt',
    iconColor: '#3AB8A0',
    eyebrow:   '✦  Scan Achievement  ✦',
    title:     'SCAN\nMACHINE',
    body:      '100 items scanned.',
    subtext:   'You are starting to see what others walk past.',
    btnText:   'Keep Scanning',
    btnBg:     '#3AB8A0',
    btnText2:  '#040F0D',
    particles: 'scan',
  },
  time_traveler: {
    bg:        '#0F0800',
    ringColor: '#D4943A',
    icon:      'history',
    iconColor: '#D4943A',
    eyebrow:   '✦  Era Achievement  ✦',
    title:     'TIME\nTRAVELER',
    body:      'An item made before 1970.',
    subtext:   'Older than almost anything on the rack.',
    btnText:   'Keep Hunting',
    btnBg:     '#D4943A',
    btnText2:  '#0F0800',
    particles: 'orbit',
  },
};

// ─── Particle systems ─────────────────────────────────────────────────────────

function SparkleParticles({ color }: { color: string }) {
  const anims = useRef([...Array(6)].map(() => new Animated.Value(0))).current;

  useEffect(() => {
    const animations = anims.map((a, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 200),
          Animated.parallel([
            Animated.timing(a, { toValue: 1, duration: 900, useNativeDriver: true }),
            Animated.timing(a, { toValue: 1, duration: 900, useNativeDriver: true }),
          ]),
          Animated.timing(a, { toValue: 0, duration: 300, useNativeDriver: true }),
        ])
      )
    );
    Animated.parallel(animations).start();
    return () => animations.forEach(a => a.stop());
  }, []);

  const positions = [
    { x: -80, y: -80 }, { x: 80, y: -80 },
    { x: -100, y: 0 }, { x: 100, y: 0 },
    { x: -60, y: 80 }, { x: 60, y: 80 },
  ];

  return (
    <>
      {anims.map((a, i) => (
        <Animated.View
          key={i}
          style={{
            position: 'absolute',
            left: SW / 2 + positions[i].x,
            top: SH * 0.38 + positions[i].y,
            opacity: a,
            transform: [{ scale: a }],
          }}
        >
          <Text style={{ fontSize: i % 2 === 0 ? 18 : 12, color }}>✦</Text>
        </Animated.View>
      ))}
    </>
  );
}

function CoinParticles({ color }: { color: string }) {
  const anims = useRef([...Array(7)].map(() => new Animated.Value(0))).current;

  useEffect(() => {
    const animations = anims.map((a, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 150),
          Animated.timing(a, { toValue: 1, duration: 1200, useNativeDriver: true }),
          Animated.timing(a, { toValue: 0, duration: 200, useNativeDriver: true }),
        ])
      )
    );
    Animated.parallel(animations).start();
    return () => animations.forEach(a => a.stop());
  }, []);

  const xOffsets = [-100, -60, -30, 0, 30, 65, 105];

  return (
    <>
      {anims.map((a, i) => (
        <Animated.View
          key={i}
          style={{
            position: 'absolute',
            left: SW / 2 + xOffsets[i] - 10,
            top: SH * 0.38,
            opacity: a.interpolate({ inputRange: [0, 0.7, 1], outputRange: [0, 1, 0] }),
            transform: [{
              translateY: a.interpolate({ inputRange: [0, 1], outputRange: [0, -140] }),
            }],
          }}
        >
          <Text style={{ fontSize: 16, color }}>$</Text>
        </Animated.View>
      ))}
    </>
  );
}

function NoteParticles({ color }: { color: string }) {
  const anims = useRef([...Array(5)].map(() => new Animated.Value(0))).current;
  const notes = ['♪', '♫', '♩', '♬', '♪'];
  const xPos = [-90, -40, 0, 45, 90];

  useEffect(() => {
    const animations = anims.map((a, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 300),
          Animated.timing(a, { toValue: 1, duration: 1400, useNativeDriver: true }),
          Animated.timing(a, { toValue: 0, duration: 100, useNativeDriver: true }),
        ])
      )
    );
    Animated.parallel(animations).start();
    return () => animations.forEach(a => a.stop());
  }, []);

  return (
    <>
      {anims.map((a, i) => (
        <Animated.Text
          key={i}
          style={{
            position: 'absolute',
            left: SW / 2 + xPos[i],
            top: SH * 0.36,
            fontSize: 20,
            color,
            opacity: a.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, 1, 0] }),
            transform: [
              { translateY: a.interpolate({ inputRange: [0, 1], outputRange: [0, -120] }) },
              { rotate: a.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '20deg'] }) },
            ],
          }}
        >
          {notes[i]}
        </Animated.Text>
      ))}
    </>
  );
}

function ScanBeam({ color }: { color: string }) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 1200, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: 1200, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: SW / 2 - 70,
        top: SH * 0.34,
        width: 140,
        height: 2,
        backgroundColor: color,
        opacity: 0.7,
        transform: [{
          translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-50, 50] }),
        }],
      }}
    />
  );
}

function ShootingStars({ color }: { color: string }) {
  const anims = useRef([...Array(5)].map(() => new Animated.Value(0))).current;
  const angles = [0, 72, 144, 216, 288];

  useEffect(() => {
    const animations = anims.map((a, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 180),
          Animated.timing(a, { toValue: 1, duration: 800, useNativeDriver: true }),
          Animated.timing(a, { toValue: 0, duration: 100, useNativeDriver: true }),
          Animated.delay(700),
        ])
      )
    );
    Animated.parallel(animations).start();
    return () => animations.forEach(a => a.stop());
  }, []);

  return (
    <>
      {anims.map((a, i) => {
        const rad = (angles[i] * Math.PI) / 180;
        const dx = Math.cos(rad);
        const dy = Math.sin(rad);
        return (
          <Animated.View
            key={i}
            style={{
              position: 'absolute',
              left: SW / 2,
              top: SH * 0.38,
              width: 3,
              height: 3,
              borderRadius: 2,
              backgroundColor: color,
              opacity: a.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 1, 0] }),
              transform: [
                { translateX: a.interpolate({ inputRange: [0, 1], outputRange: [0, dx * 120] }) },
                { translateY: a.interpolate({ inputRange: [0, 1], outputRange: [0, dy * 120] }) },
              ],
            }}
          />
        );
      })}
    </>
  );
}

function OrbitParticles({ color }: { color: string }) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(anim, { toValue: 1, duration: 3000, useNativeDriver: true })
    );
    loop.start();
    return () => loop.stop();
  }, []);

  return (
    <>
      {[0, 90, 180, 270].map((deg, i) => {
        const rad = ((deg) * Math.PI) / 180;
        return (
          <Animated.View
            key={i}
            style={{
              position: 'absolute',
              left: SW / 2,
              top: SH * 0.38,
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: color,
              opacity: 0.8,
              transform: [
                {
                  translateX: anim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [
                      Math.cos(rad) * 90,
                      Math.cos(rad + Math.PI * 2) * 90,
                    ],
                  }),
                },
                {
                  translateY: anim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [
                      Math.sin(rad) * 90,
                      Math.sin(rad + Math.PI * 2) * 90,
                    ],
                  }),
                },
              ],
            }}
          />
        );
      })}
    </>
  );
}

function FireParticles({ color }: { color: string }) {
  const anims = useRef([...Array(6)].map(() => new Animated.Value(0))).current;
  const xOffsets = [-70, -40, -10, 20, 50, 75];

  useEffect(() => {
    const animations = anims.map((a, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 180),
          Animated.timing(a, { toValue: 1, duration: 1000, useNativeDriver: true }),
          Animated.timing(a, { toValue: 0, duration: 100, useNativeDriver: true }),
        ])
      )
    );
    Animated.parallel(animations).start();
    return () => animations.forEach(a => a.stop());
  }, []);

  return (
    <>
      {anims.map((a, i) => (
        <Animated.Text
          key={i}
          style={{
            position: 'absolute',
            left: SW / 2 + xOffsets[i] - 10,
            top: SH * 0.44,
            fontSize: 14,
            color,
            opacity: a.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 0.9, 0] }),
            transform: [{
              translateY: a.interpolate({ inputRange: [0, 1], outputRange: [0, -100] }),
            }],
          }}
        >
          🔥
        </Animated.Text>
      ))}
    </>
  );
}

// ─── Main Modal ───────────────────────────────────────────────────────────────

/**
 * How long a celebration stays on screen before it can be closed. Long enough
 * to take it in (founder, Nov 18, 2026: pressing Continue the instant it
 * appeared killed the moment). The button fades in when the time is up; until
 * then nothing closes the screen, not even the Android back button.
 */
export const CELEBRATION_MIN_MS = 2500;

/** Words that depend on the moment ("3 weeks in a row"). Anything left out uses the design's own. */
export interface MajorAchievementText { title?: string; body?: string; subtext?: string }

interface Props {
  type:       MajorAchievementType | null;
  visible:    boolean;
  onContinue: () => void;
  text?:      MajorAchievementText;
}

export function MajorAchievementModal({ type, visible, onContinue, text }: Props) {
  // ── Hold the screen for CELEBRATION_MIN_MS, then let it be closed once ─────
  const btnFade = useRef(new Animated.Value(0)).current;
  const [canContinue, setCanContinue] = useState(false);
  const canContinueRef = useRef(false);
  const closedRef = useRef(false);
  useEffect(() => {
    canContinueRef.current = false;
    closedRef.current = false;
    setCanContinue(false);
    btnFade.setValue(0);
    if (!visible || !type) return;
    const t = setTimeout(() => {
      canContinueRef.current = true;
      setCanContinue(true);
      Animated.timing(btnFade, { toValue: 1, duration: 350, useNativeDriver: true }).start();
    }, CELEBRATION_MIN_MS);
    return () => clearTimeout(t);
  }, [visible, type]);
  /** Closes once, and only after the hold. A double tap never skips the next celebration in a queue. */
  const handleContinue = () => {
    if (!canContinueRef.current || closedRef.current) return;
    closedRef.current = true;
    onContinue();
  };

  const badgeScale   = useRef(new Animated.Value(0)).current;
  const contentFade  = useRef(new Animated.Value(0)).current;
  const bgFade       = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible && type) {
      badgeScale.setValue(0);
      contentFade.setValue(0);
      bgFade.setValue(0);

      Animated.sequence([
        Animated.timing(bgFade, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.parallel([
          Animated.spring(badgeScale, {
            toValue: 1, useNativeDriver: true,
            damping: 9, stiffness: 100, mass: 0.8,
          }),
          Animated.timing(contentFade, { toValue: 1, duration: 400, useNativeDriver: true }),
        ]),
      ]).start();
    }
  }, [visible, type]);

  if (!type) return null;

  const base = CONFIGS[type];
  const cfg = {
    ...base,
    title:   text?.title   || base.title,
    body:    text?.body    || base.body,
    subtext: text?.subtext || base.subtext,
  };

  const Particles = () => {
    switch (cfg.particles) {
      case 'sparkles': return <SparkleParticles color={cfg.ringColor} />;
      case 'coins':    return <CoinParticles color={cfg.ringColor} />;
      case 'notes':    return <NoteParticles color={cfg.ringColor} />;
      case 'scan':     return <ScanBeam color={cfg.ringColor} />;
      case 'stars':    return <ShootingStars color={cfg.ringColor} />;
      case 'orbit':    return <OrbitParticles color={cfg.ringColor} />;
      case 'fire':     return <FireParticles color={cfg.ringColor} />;
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={handleContinue}
    >
      <Animated.View style={[s.root, { backgroundColor: cfg.bg, opacity: bgFade }]}>

        {/* Particle layer */}
        <Particles />

        {/* Eyebrow label */}
        <Animated.View style={{ opacity: contentFade }}>
          <Text style={[s.eyebrow, { color: cfg.ringColor }]}>{cfg.eyebrow}</Text>
        </Animated.View>

        {/* Badge — springs in */}
        <Animated.View style={[s.badgeWrap, { transform: [{ scale: badgeScale }] }]}>
          {/* Outer glow ring */}
          <View style={[s.glowRing, { borderColor: cfg.ringColor + '30' }]} />
          {/* Mid ring */}
          <View style={[s.midRing, { borderColor: cfg.ringColor + '60' }]} />
          {/* Main badge */}
          <View style={[s.badge, { backgroundColor: cfg.ringColor + '18', borderColor: cfg.ringColor }]}>
            <MaterialIcons name={cfg.icon as any} size={72} color={cfg.iconColor} />
          </View>
        </Animated.View>

        {/* Text content */}
        <Animated.View style={[s.textBlock, { opacity: contentFade }]}>
          <Text style={[s.title, { color: cfg.ringColor }]}>{cfg.title}</Text>
          <Text style={s.body}>{cfg.body}</Text>
          <Text style={s.subtext}>{cfg.subtext}</Text>
        </Animated.View>

        {/* Continue button: appears once the screen has been held for CELEBRATION_MIN_MS */}
        <Animated.View
          pointerEvents={canContinue ? 'auto' : 'none'}
          style={{ opacity: btnFade, width: '100%', alignItems: 'center' }}
        >
          <Pressable
            onPress={handleContinue}
            disabled={!canContinue}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canContinue }}
            style={({ pressed }) => [
              s.btn,
              { backgroundColor: cfg.btnBg },
              pressed && { opacity: 0.85, transform: [{ scale: 0.97 }] },
            ]}
          >
            <Text style={[s.btnText, { color: cfg.btnText2 }]}>{cfg.btnText}</Text>
          </Pressable>
        </Animated.View>

      </Animated.View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
    paddingHorizontal: 32,
  },

  eyebrow: {
    fontSize: 11, fontWeight: '700', letterSpacing: 1.8, textAlign: 'center',
    textTransform: 'uppercase',
  },

  // Badge rings
  badgeWrap: { position: 'relative', alignItems: 'center', justifyContent: 'center' },
  glowRing: {
    position: 'absolute',
    width: 200, height: 200, borderRadius: 100,
    borderWidth: 1,
  },
  midRing: {
    position: 'absolute',
    width: 170, height: 170, borderRadius: 85,
    borderWidth: 1.5,
  },
  badge: {
    width: 140, height: 140, borderRadius: 70,
    borderWidth: 2.5,
    justifyContent: 'center', alignItems: 'center',
  },

  // Text
  textBlock: { alignItems: 'center', gap: 10 },
  title: {
    fontFamily: FONTS.serif,
    fontSize: 36,
    fontWeight: '900',
    textAlign: 'center',
    lineHeight: 42,
    letterSpacing: 1,
  },
  body: {
    fontSize: 16, color: '#E8E0D0', textAlign: 'center', lineHeight: 24,
  },
  subtext: {
    fontSize: 13, color: '#A09080', textAlign: 'center', fontStyle: 'italic',
  },

  // Button
  btn: {
    borderRadius: 50, paddingVertical: 16, paddingHorizontal: 52,
    minWidth: 200, alignItems: 'center',
  },
  btnText: {
    fontFamily: FONTS.serif, fontSize: 17, fontWeight: '900', letterSpacing: 0.5,
  },
});
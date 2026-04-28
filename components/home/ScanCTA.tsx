import { View, Text, Pressable, StyleSheet } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { V } from '@/constants/vintage';

// ── Card green ────────────────────────────────────────────────────────────────
// Richer olive-forest tone — warmer than pure dark green, matches the reference
// brand card feel. Sits between #1A3523 (too dark/flat) and #2F5D3A (too bright).
const CARD_GREEN        = '#1F4A2C';
const CARD_GREEN_LIGHT  = '#265934'; // used for the icon outer ring tint

interface ScanCTAProps {
  onPress: () => void;
  /**
   * When true, removes marginHorizontal and bottom borderRadius so the card
   * can sit as the top section of a unified grouped container.
   */
  attached?: boolean;
}

export function ScanCTA({ onPress, attached = false }: ScanCTAProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        attached && styles.cardAttached,
        pressed && { transform: [{ scale: 0.983 }], opacity: 0.92 },
      ]}
    >
      {/* ── Warm top-edge tint — like aged paint catching light ──────────── */}
      <View style={styles.topTint} />

      {/* ── Vintage crack — top-right corner (unchanged) ─────────────────── */}
      <View style={styles.crackMain} />
      <View style={styles.crackBranch1} />
      <View style={styles.crackBranch2} />
      <View style={styles.crackHair} />

      {/* ── Single background atmosphere circle (right edge only) ────────── */}
      <View style={styles.bgCircle} />

      {/* ── Camera icon — branded viewfinder frame ────────────────────────── */}
      <View style={styles.iconOuter}>
        <View style={styles.iconInner}>
          <MaterialIcons name="photo-camera" size={28} color="rgba(255,255,255,0.95)" />
        </View>
      </View>

      {/* ── Text ─────────────────────────────────────────────────────────── */}
      <View style={styles.textBlock}>
        <Text style={styles.title}>Scan Item</Text>
        <Text style={styles.subtitle}>
          Scan an item with your camera{'\n'}to find out its resale value in seconds!
        </Text>
      </View>

      {/* ── Arrow ────────────────────────────────────────────────────────── */}
      <MaterialIcons name="chevron-right" size={20} color="rgba(255,255,255,0.62)" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection:   'row',
    alignItems:      'center',
    backgroundColor: CARD_GREEN,
    borderRadius:    16,
    paddingVertical: 22,
    paddingLeft:     16,
    paddingRight:    14,
    marginHorizontal: V.screenPad,
    gap:             14,
    overflow:        'hidden',
    shadowColor:     '#0A1A0E',
    shadowOffset:    { width: 0, height: 4 },
    shadowOpacity:   0.30,
    shadowRadius:    14,
    elevation:       7,
  },
  // When part of a unified container — no own margin, no bottom radius
  cardAttached: {
    marginHorizontal:        0,
    borderBottomLeftRadius:  0,
    borderBottomRightRadius: 0,
  },

  // ── Warm top-edge tint ─────────────────────────────────────────────────────
  // A very thin strip at the top that catches a warm light tone.
  // Gives the card a slight dimensional quality — like sunlight on a shop sign.
  topTint: {
    position:        'absolute',
    top:             0,
    left:            0,
    right:           0,
    height:          56,
    backgroundColor: 'rgba(255, 240, 180, 0.045)',
  },

  // ── Crack detail (from previous pass — preserved exactly) ─────────────────
  crackMain: {
    position:        'absolute',
    top:             8,
    right:           22,
    width:           34,
    height:          1.5,
    borderRadius:    1,
    backgroundColor: 'rgba(255,255,255,0.20)',
    transform:       [{ rotate: '128deg' }],
  },
  crackBranch1: {
    position:        'absolute',
    top:             16,
    right:           30,
    width:           18,
    height:          1.2,
    borderRadius:    1,
    backgroundColor: 'rgba(255,255,255,0.14)',
    transform:       [{ rotate: '98deg' }],
  },
  crackBranch2: {
    position:        'absolute',
    top:             22,
    right:           10,
    width:           14,
    height:          1,
    borderRadius:    1,
    backgroundColor: 'rgba(255,255,255,0.12)',
    transform:       [{ rotate: '145deg' }],
  },
  crackHair: {
    position:        'absolute',
    top:             19,
    right:           36,
    width:           9,
    height:          1,
    borderRadius:    1,
    backgroundColor: 'rgba(255,255,255,0.09)',
    transform:       [{ rotate: '75deg' }],
  },

  // ── Single atmosphere circle — bottom-right only ───────────────────────────
  // Reduced from two circles to one so the right side behind the arrow is clean.
  bgCircle: {
    position:        'absolute',
    bottom:          -28,
    right:           -14,
    width:           110,
    height:          110,
    borderRadius:    55,
    backgroundColor: 'rgba(255,255,255,0.035)',
  },

  // ── Branded viewfinder frame ───────────────────────────────────────────────
  // Two-layer approach: outer ring provides framing, inner area holds the icon.
  // The outer ring uses a slightly lighter green tint as its background
  // so it reads as a deliberate frame rather than a floating square.
  iconOuter: {
    width:           62,
    height:          62,
    borderRadius:    16,
    backgroundColor: CARD_GREEN_LIGHT,
    borderWidth:     1.5,
    borderColor:     'rgba(255,255,255,0.22)',
    justifyContent:  'center',
    alignItems:      'center',
    // Inner shadow feel via nested view
  },
  iconInner: {
    width:           48,
    height:          48,
    borderRadius:    12,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth:     1,
    borderColor:     'rgba(255,255,255,0.14)',
    justifyContent:  'center',
    alignItems:      'center',
  },

  // ── Typography ─────────────────────────────────────────────────────────────
  textBlock: {
    flex: 1,
    gap:  5,
  },
  title: {
    fontSize:      21,
    fontWeight:    '800',
    color:         '#ECE7D3',
    letterSpacing: 0.3,   // slightly wider tracking → brand-stamp feel
    lineHeight:    26,
  },
  subtitle: {
    fontSize:   12.5,
    color:      'rgba(255,255,255,0.70)',
    lineHeight: 18,
  },
});
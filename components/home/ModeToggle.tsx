/**
 * components/home/ModeToggle.tsx
 *
 * Slim branded segmented control.
 * Scrolls naturally with page content — NOT sticky.
 * Each segment has icon + label + subtle subtext for instant clarity.
 */

import { useRef, useEffect } from 'react';
import {
  View, Text, Pressable, StyleSheet, Animated, Platform, Alert,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import type { UserMode } from '@/lib/onboarding-storage';

// ─── Palette — vintage FlipStart ─────────────────────────────────────────────
const TRACK_BG    = '#EAE0C6';   // warm parchment slightly darker than page
const THUMB_BG    = '#FFF8EC';   // active: warm cream fill
const FOREST      = '#2A4A2A';   // active label
const MUTED       = '#9A8060';   // inactive label
const GOLD        = '#BE9C2C';   // border + active underline
const TRACK_BORD  = '#C9B888';   // outer track border

const SEGMENTS: { value: UserMode; icon: string; label: string; sub: string }[] = [
  { value: 'resell',   icon: '💰', label: 'Flip for Profit',  sub: 'Resale value & profit'  },
  { value: 'personal', icon: '🛍️', label: 'Buy for Yourself', sub: 'Price & quality check'  },
];

interface ModeToggleProps {
  value:    UserMode;
  onChange: (mode: UserMode) => void;
}

export function ModeToggle({ value, onChange }: ModeToggleProps) {
  const anim = useRef(new Animated.Value(value === 'resell' ? 0 : 1)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue:         value === 'resell' ? 0 : 1,
      duration:        160,
      useNativeDriver: false,
    }).start();
  }, [value]);

  const handlePress = (mode: UserMode) => {
    if (mode === value) return;
    if (mode === 'personal') {
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      }
      Alert.alert(
        '🛍️ Buy for Yourself',
        'This mode is coming in the global release! For now, Flip for Profit mode gives you full AI-powered resale analysis.',
        [{ text: 'Got it', style: 'default' }]
      );
      return;
    }
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
    onChange(mode);
  };

  const thumbLeft = anim.interpolate({
    inputRange:  [0, 1],
    outputRange: ['0%', '50%'],
  });

  return (
    <View style={s.wrap}>
      <View style={s.track}>
        {/* Sliding thumb */}
        <Animated.View style={[s.thumb, { left: thumbLeft }]} />

        {/* Segments */}
        {SEGMENTS.map((seg) => {
          const active = seg.value === value;
          return (
            <Pressable
              key={seg.value}
              onPress={() => handlePress(seg.value)}
              style={s.segment}
              hitSlop={6}
            >
              <View style={s.segRow}>
                <Text style={s.icon}>{seg.icon}</Text>
                <View>
                  <Text style={[s.label, active ? s.labelActive : s.labelInactive]}>
                    {seg.label}
                  </Text>
                  <Text style={[s.sub, active ? s.subActive : s.subInactive]}>
                    {seg.sub}
                  </Text>
                </View>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  wrap: {
    marginTop:    0,
    marginBottom: 0,
  },
  track: {
    flexDirection:   'row',
    backgroundColor: TRACK_BG,
    borderRadius:    0,
    borderWidth:     0,
    borderBottomWidth: 1,
    borderColor:     TRACK_BORD,
    overflow:        'hidden',
    position:        'relative',
  },
  thumb: {
    position:        'absolute',
    width:           '50%',
    height:          '100%',
    backgroundColor: THUMB_BG,
    borderRadius:    0,
    borderWidth:     0,
    borderBottomWidth: 2,
    borderColor:     GOLD,
  },
  segment: {
    flex:            1,
    paddingVertical:  6,
    paddingHorizontal:6,
    alignItems:      'center',
    justifyContent:  'center',
    zIndex:          1,
  },
  segRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           5,
  },
  icon: {
    fontSize: 15,
  },
  label: {
    fontSize:    12,
    fontWeight:  '700',
    letterSpacing: 0.1,
  },
  labelActive:   { color: FOREST },
  labelInactive: { color: MUTED  },
  sub: {
    fontSize:   9,
    marginTop:  1,
    letterSpacing: 0.05,
  },
  subActive:   { color: MUTED   },
  subInactive: { color: '#BBA880' },
});
/**
 * components/DiamondsUnavailable.tsx
 *
 * What "Diamonds in the Rough" shows while the feature is paused
 * (lib/diamondsAvailability.ts). A plain, honest holding screen: no counts, no
 * collection, nothing that looks like it is loading or broken.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { FONTS } from '@/constants/typography';

const INK    = '#1F1B16';
const FOREST = '#214D2D';
const GOLD   = '#C4A334';
const CREAM  = '#FFFEFA';
const BORDER = '#DDD2AC';
const TINT   = '#F5EBCB';

export function DiamondsUnavailable() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const leave = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/progress' as any);
  };

  return (
    <View style={[s.root, { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 16) }]}>
      <View style={s.top}>
        <Pressable
          onPress={leave}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={s.back}
        >
          <MaterialIcons name="arrow-back" size={24} color={FOREST} />
        </Pressable>
      </View>

      <View style={s.body}>
        <View style={s.iconRing}>
          <MaterialIcons name="auto-awesome" size={34} color={GOLD} />
        </View>

        <Text style={s.title} accessibilityRole="header">Diamonds in the Rough</Text>

        <View style={s.pill}>
          <Text style={s.pillText}>TEMPORARILY UNAVAILABLE</Text>
        </View>

        <Text style={s.copy}>
          We're making Diamonds better, so it's paused for now. Your saved scans,
          achievements and Brand Compendium aren't affected.
        </Text>
      </View>

      <Pressable
        onPress={leave}
        accessibilityRole="button"
        accessibilityLabel="Back to Progress"
        style={({ pressed }) => [s.cta, pressed && { opacity: 0.85 }]}
      >
        <Text style={s.ctaText}>Back to Progress</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF', paddingHorizontal: 24 },
  top: { height: 48, justifyContent: 'center' },
  back: { width: 40, height: 40, alignItems: 'flex-start', justifyContent: 'center' },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 48 },
  iconRing: {
    width: 76, height: 76, borderRadius: 38, backgroundColor: CREAM,
    borderWidth: 1.5, borderColor: BORDER, alignItems: 'center', justifyContent: 'center', marginBottom: 20,
  },
  title: { fontFamily: FONTS.serif, fontSize: 26, lineHeight: 32, fontWeight: '800', color: INK, textAlign: 'center' },
  pill: {
    marginTop: 14, backgroundColor: TINT, borderRadius: 999, borderWidth: 1, borderColor: GOLD,
    paddingHorizontal: 12, paddingVertical: 5,
  },
  pillText: { fontSize: 11.5, lineHeight: 14, fontWeight: '800', letterSpacing: 0.8, color: INK },
  copy: { marginTop: 18, fontSize: 16, lineHeight: 23, color: INK, textAlign: 'center', maxWidth: 320 },
  cta: {
    minHeight: 54, borderRadius: 999, backgroundColor: FOREST, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 24,
  },
  ctaText: { fontFamily: FONTS.serif, fontSize: 16.5, fontWeight: '800', color: '#FFFFFF' },
});
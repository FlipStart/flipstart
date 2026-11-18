/**
 * app/hunt-demo-camera.tsx — the practice camera for the guided Hunt demo.
 *
 * Looks like the scan camera but is not one: no camera permission, no expo-camera,
 * no capture, and nothing is consumed. It "frames" a built-in photo of the demo find,
 * and the shutter hands the matching canned analysis to the live Hunt, exactly where
 * a real scan result lands (a pending find on its Discovery Analysis screen).
 *
 * Only reachable inside the demo. Opened outside it (a stale link, a restored route)
 * it leaves immediately, so a real user can never be shown a fake scan.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Animated, ActivityIndicator, Image as RNImage } from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { FONTS } from '@/constants/typography';
import { isHuntDemoActive } from '@/lib/huntDemoMode';
import { addPendingScanToHunt } from '@/lib/hunt-context';
import { demoScanFor, type DemoFindKey } from '@/lib/huntDemoSession';
import { advanceCoach } from '@/lib/huntDemoCoach';
import { demoPhotoUri } from '@/components/hunt/onboarding/demoAssets';
import { CoachOverlay } from '@/components/hunt/onboarding/coach/CoachOverlay';
import { useCoachRef } from '@/components/hunt/onboarding/coach/coachTargets';
import { useReduceMotion } from '@/components/hunt/HuntAttentionDot';

const GOLD  = '#BE9C2C';
const BG    = '#162D1A';
const CREAM = '#FFFEFA';
const ANALYZE_MS = 1500;

export default function HuntDemoCameraScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const reduce = useReduceMotion();
  const params = useLocalSearchParams<{ find?: string }>();
  const find: DemoFindKey = params.find === 'polo' ? 'polo' : 'jacket';
  const shutterRef = useCoachRef('demo-shutter');

  const [phase, setPhase] = useState<'ready' | 'analyzing'>('ready');
  const flash = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const taken = useRef(false);

  // A real user must never land here.
  useEffect(() => {
    if (!isHuntDemoActive()) router.replace('/(tabs)' as any);
  }, [router]);

  // Hardware / swipe back would leave the demo half-finished: the coach's Exit is the way out.
  useEffect(() => {
    const unsub = navigation.addListener('beforeRemove', (e: any) => {
      if (isHuntDemoActive() && !taken.current && e?.data?.action?.type !== 'REPLACE' && e?.data?.action?.type !== 'RESET') {
        e.preventDefault();
      }
    });
    return unsub;
  }, [navigation]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const photo = demoPhotoUri(find);

  const onShutter = useCallback(() => {
    if (taken.current || !isHuntDemoActive()) return;
    taken.current = true;
    setPhase('analyzing');
    if (!reduce) {
      flash.setValue(1);
      Animated.timing(flash, { toValue: 0, duration: 260, useNativeDriver: true }).start();
    }
    timer.current = setTimeout(() => {
      const scan = demoScanFor(find, demoPhotoUri);
      const item = addPendingScanToHunt(scan);
      advanceCoach('shutter');
      if (item) router.replace(`/hunt-item-detail?mode=pending&huntItemId=${item.huntItemId}` as any);
      else router.replace('/hunt-active' as any);
    }, reduce ? 600 : ANALYZE_MS);
  }, [find, flash, reduce, router]);

  return (
    <View style={[s.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]} testID="hunt-demo-camera">
      {/* The "viewfinder": blurred fill behind, the whole item in front. */}
      {!!photo && <Image source={{ uri: photo }} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={28} />}
      <View style={s.scrim} pointerEvents="none" />
      {!!photo && <Image source={{ uri: photo }} style={s.photo} contentFit="contain" accessibilityLabel="Demo find" />}

      <View style={s.corners} pointerEvents="none">
        <View style={[s.corner, s.tl]} /><View style={[s.corner, s.tr]} />
        <View style={[s.corner, s.bl]} /><View style={[s.corner, s.br]} />
      </View>

      <View style={[s.chip, { top: insets.top + 12 }]} pointerEvents="none">
        <MaterialIcons name="school" size={13} color={GOLD} />
        <Text style={s.chipText}>DEMO CAMERA</Text>
      </View>

      <View style={[s.bottom, { bottom: insets.bottom + 28 }]}>
        {phase === 'analyzing' ? (
          <View style={s.analyzing} accessibilityLiveRegion="polite">
            <ActivityIndicator color={GOLD} />
            <Text style={s.analyzingText}>Analyzing…</Text>
          </View>
        ) : (
          <Pressable
            ref={shutterRef as any}
            collapsable={false}
            onPress={onShutter}
            accessibilityRole="button"
            accessibilityLabel="Take photo"
            style={s.shutterOuter}
            testID="demo-shutter"
          >
            <View style={s.shutterInner} />
          </Pressable>
        )}
      </View>

      {!reduce && <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#fff', opacity: flash }]} />}

      <CoachOverlay screen="demo-camera" />
    </View>
  );
}

const s = StyleSheet.create({
  root:  { flex: 1, backgroundColor: BG },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(8,16,10,0.55)' },
  photo: { position: 'absolute', left: 24, right: 24, top: '14%', bottom: '24%' },
  corners: { position: 'absolute', left: 20, right: 20, top: '12%', bottom: '22%' },
  corner:  { position: 'absolute', width: 28, height: 28, borderColor: CREAM, opacity: 0.9 },
  tl: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 8 },
  tr: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 8 },
  bl: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 8 },
  br: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 8 },
  chip: {
    position: 'absolute', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.55)', borderWidth: 1, borderColor: GOLD + '88',
  },
  chipText: { fontSize: 10.5, fontWeight: '800', letterSpacing: 1.4, color: GOLD },
  bottom:   { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  shutterOuter: { width: 78, height: 78, borderRadius: 39, borderWidth: 4, borderColor: CREAM, alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: CREAM },
  analyzing:     { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.6)' },
  analyzingText: { fontFamily: FONTS.serif, fontSize: 16, fontWeight: '700', color: CREAM },
});
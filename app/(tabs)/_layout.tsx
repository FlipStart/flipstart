/**
 * app/(tabs)/_layout.tsx
 *
 * Tab bar: Home | History | [Camera center] | Hunt Mode | Progress
 * Profile removed from bottom tabs — accessible via header icon.
 */

import { View, Text, Pressable, StyleSheet, Platform, Animated } from 'react-native';
import { useRef, useEffect } from 'react';
import { Tabs, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import * as Haptics from 'expo-haptics';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Image } from 'expo-image';
import { useAudioPlayer } from 'expo-audio';

import { V } from '@/constants/vintage';
import { useAchievementNotifications } from '@/lib/AchievementNotificationContext';
import { useAuth } from '@/lib/auth-context';
import { FONTS } from '@/constants/typography';
import { useScanGate } from '@/lib/useScanGate';

// ─── Assets ───────────────────────────────────────────────────────────────────
const ROAR_SOUND = require('@/assets/images/lion-roar.m4a');

// ─── Tab definitions ──────────────────────────────────────────────────────────
// leftTabs: left of center camera button
// rightTabs: right of center camera button

const LEFT_TABS = [
  { name: 'index',    label: 'Home',    icon: 'home'    },
  { name: 'history',  label: 'History', icon: 'history' },
] as const;

const RIGHT_TABS = [
  { name: 'hunt-tab',  label: 'Hunt Mode', icon: 'pets'       },
  { name: 'progress',  label: 'Progress',  icon: 'bar-chart'  },
] as const;

type LeftTab  = typeof LEFT_TABS[number];
type RightTab = typeof RIGHT_TABS[number];

// ─── Custom tab bar ───────────────────────────────────────────────────────────

function VintageTabBar({ state, navigation }: BottomTabBarProps) {
  const router      = useRouter();
  const { unseenCount, unseenBrandCount, unseenDiamondCount } = useAchievementNotifications();
  const totalBadge  = unseenCount + unseenBrandCount + unseenDiamondCount;
  const { user }    = useAuth();
  const insets    = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, 8);
  const roar      = useAudioPlayer(ROAR_SOUND);

  // ── Progress tab notification animation ───────────────────────────────────
  // Urgent: rotation + scale pulse, both icon AND label move together.
  const wiggleAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim  = useRef(new Animated.Value(1)).current;
  const wiggleLoop = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (totalBadge > 0) {
      wiggleLoop.current = Animated.loop(
        Animated.sequence([
          // Sharp attention-grab: three rapid shakes + scale up
          Animated.parallel([
            Animated.sequence([
              Animated.timing(wiggleAnim, { toValue: 1,     duration: 50,  useNativeDriver: true }),
              Animated.timing(wiggleAnim, { toValue: -1,    duration: 90,  useNativeDriver: true }),
              Animated.timing(wiggleAnim, { toValue: 0.85,  duration: 70,  useNativeDriver: true }),
              Animated.timing(wiggleAnim, { toValue: -0.85, duration: 70,  useNativeDriver: true }),
              Animated.timing(wiggleAnim, { toValue: 0.5,   duration: 55,  useNativeDriver: true }),
              Animated.timing(wiggleAnim, { toValue: -0.5,  duration: 55,  useNativeDriver: true }),
              Animated.timing(wiggleAnim, { toValue: 0,     duration: 40,  useNativeDriver: true }),
            ]),
            Animated.sequence([
              Animated.timing(pulseAnim,  { toValue: 1.22,  duration: 120, useNativeDriver: true }),
              Animated.timing(pulseAnim,  { toValue: 0.92,  duration: 100, useNativeDriver: true }),
              Animated.timing(pulseAnim,  { toValue: 1.08,  duration: 80,  useNativeDriver: true }),
              Animated.timing(pulseAnim,  { toValue: 1,     duration: 60,  useNativeDriver: true }),
            ]),
          ]),
          Animated.delay(1200),
        ])
      );
      wiggleLoop.current.start();
    } else {
      wiggleLoop.current?.stop();
      wiggleLoop.current = null;
      Animated.parallel([
        Animated.timing(wiggleAnim, { toValue: 0, duration: 120, useNativeDriver: true }),
        Animated.timing(pulseAnim,  { toValue: 1, duration: 120, useNativeDriver: true }),
      ]).start();
    }
    return () => { wiggleLoop.current?.stop(); };
  }, [totalBadge]);

  const wiggleRotate = wiggleAnim.interpolate({
    inputRange: [-1, 0, 1],
    outputRange: ['-28deg', '0deg', '28deg'],
  });

  /** Tab-bar scan. Same preflight as Home — one gate, two buttons. */
  /** Shared scan preflight — see lib/useScanGate.ts. */
  const startScan = useScanGate();

  const handleCenterScan = () => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    startScan({
      origin: 'tab',
      run: () => router.push('/camera' as any),
      goToScanStore: () => router.push('/scan-store' as any),
    });
  };

  const renderTab = (item: LeftTab | RightTab) => {
    const routeIndex = state.routes.findIndex(r => r.name === item.name);
    const isActive   = state.index === routeIndex;
    const color      = isActive ? V.green : V.textMuted;

    const onPress = () => {
      if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      // Hunt-tab: signed-in users go to full-screen gameplay; guests see the
      // in-tab account gate (which keeps the bottom tab bar visible).
      if (item.name === 'hunt-tab') {
        try { roar.seekTo(0); roar.play(); } catch { /* never crash */ }
        if (user) { router.push('/hunt' as any); }
        else      { navigation.navigate(item.name); }
        return;
      }
      navigation.navigate(item.name);
    };

    // Hunt Mode gets a lion icon
    const isHunt     = item.name === 'hunt-tab';
    const isProgress = item.name === 'progress';
    const shouldAnimate = isProgress && totalBadge > 0;

    const tabContent = (
      <>
        <MaterialIcons name={(item as any).icon} size={22} color={color} />
        {shouldAnimate && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>
              {totalBadge > 99 ? '99+' : String(totalBadge)}
            </Text>
          </View>
        )}
        <Text style={[styles.tabLabel, { color }]}>{item.label}</Text>
        {isActive && !isHunt && <View style={[styles.activeBar, { backgroundColor: V.green }]} />}
      </>
    );

    return (
      <Pressable
        key={item.name}
        onPress={onPress}
        style={({ pressed }) => [styles.tabItem, pressed && { opacity: 0.7 }]}
      >
        {isHunt ? (
          <MaterialIcons name="pets" size={22} color={color} />
        ) : shouldAnimate ? (
          // Progress tab with notifications: animate icon + label + badge together
          <Animated.View style={{
            alignItems: 'center',
            transform: [{ rotate: wiggleRotate }, { scale: pulseAnim }],
          }}>
            {tabContent}
          </Animated.View>
        ) : (
          <View style={{ alignItems: 'center' }}>
            {tabContent}
          </View>
        )}
        {isHunt && <Text style={[styles.tabLabel, { color }]}>{item.label}</Text>}
        {isActive && isHunt && <View style={[styles.activeBar, { backgroundColor: V.green }]} />}
      </Pressable>
    );
  };

  return (
    <View style={[styles.barWrapper, { paddingBottom: bottomPad }]}>
      <View style={styles.bar}>
        {/* Left: Home, History */}
        <View style={styles.tabGroup}>
          {LEFT_TABS.map(renderTab)}
        </View>

        {/* Center: floating camera button */}
        <View style={styles.centerSlot}>
          <Pressable
            onPress={handleCenterScan}
            style={({ pressed }) => [
              styles.centerButton,
              pressed && { transform: [{ scale: 0.93 }], opacity: 0.9 },
            ]}
          >
            <MaterialIcons name="photo-camera" size={26} color={V.white} />
          </Pressable>
        </View>

        {/* Right: Hunt Mode, Progress */}
        <View style={styles.tabGroup}>
          {RIGHT_TABS.map(renderTab)}
        </View>
      </View>
    </View>
  );
}

// ─── Tab layout ───────────────────────────────────────────────────────────────

export default function TabLayout() {
  return (
    <Tabs
      tabBar={(props) => <VintageTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="index"       options={{ title: 'Home'      }} />
      <Tabs.Screen name="history"     options={{ title: 'History'   }} />
      <Tabs.Screen name="progress"    options={{ title: 'Progress'  }} />
      <Tabs.Screen name="hunt-tab"    options={{ href: null         }} />
      <Tabs.Screen name="profile"     options={{ href: null         }} />
      <Tabs.Screen name="settings"    options={{ href: null         }} />
      <Tabs.Screen name="leaderboard" options={{ href: null         }} />
    </Tabs>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  barWrapper: {
    backgroundColor: V.cardBg,
    borderTopWidth:  1,
    borderTopColor:  V.border,
    shadowColor:     V.green,
    shadowOffset:    { width: 0, height: -2 },
    shadowOpacity:   0.06,
    shadowRadius:    8,
    elevation:       8,
  },
  bar: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingTop:        8,
    paddingHorizontal: 8,
  },
  tabGroup: {
    flex:           1,
    flexDirection:  'row',
    justifyContent: 'space-around',
  },
  tabItem: {
    flex:            1,
    alignItems:      'center',
    paddingVertical: 4,
    gap:             2,
    position:        'relative',
  },
  tabLabel: {
    fontSize:      9,
    fontWeight:    '600',
    letterSpacing: 0.2,
    fontFamily:    FONTS.serif,
  },
  activeBar: {
    position:     'absolute',
    bottom:       -4,
    width:        20,
    height:       3,
    borderRadius: 2,
  },
  centerSlot: {
    width:          72,
    alignItems:     'center',
    justifyContent: 'flex-end',
    marginTop:      -22,
  },
  centerButton: {
    width:           58,
    height:          58,
    borderRadius:    29,
    backgroundColor: V.green,
    justifyContent:  'center',
    alignItems:      'center',
    borderWidth:     3,
    borderColor:     V.pageBg,
    shadowColor:     '#1A3020',
    shadowOffset:    { width: 0, height: 4 },
    shadowOpacity:   0.35,
    shadowRadius:    10,
    elevation:       8,
  },
  badge: {
    position:        'absolute',
    top:             -4,
    right:           -8,
    minWidth:        16,
    height:          16,
    borderRadius:    8,
    backgroundColor: '#CC2222',
    justifyContent:  'center',
    alignItems:      'center',
    paddingHorizontal: 3,
    borderWidth:     1,
    borderColor:     V.pageBg,
  },
  badgeText: { fontSize: 9, fontWeight: '800', color: '#fff' },
});
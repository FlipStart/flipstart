/**
 * app/(tabs)/_layout.tsx
 *
 * Tab bar: Home | History | [Camera center] | Hunt Mode | Progress
 * Profile removed from bottom tabs — accessible via header icon.
 */

import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import { Tabs, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import * as Haptics from 'expo-haptics';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Image } from 'expo-image';
import { useAudioPlayer } from 'expo-audio';

import { V } from '@/constants/vintage';
import { FONTS } from '@/constants/typography';

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
  const router    = useRouter();
  const insets    = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, 8);
  const roar      = useAudioPlayer(ROAR_SOUND);

  const handleCenterScan = () => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    router.push('/camera' as any);
  };

  const renderTab = (item: LeftTab | RightTab) => {
    const routeIndex = state.routes.findIndex(r => r.name === item.name);
    const isActive   = state.index === routeIndex;
    const color      = isActive ? V.green : V.textMuted;

    const onPress = () => {
      if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      // Hunt-tab navigates to the hunt entry screen, not a tab screen
      if (item.name === 'hunt-tab') {
        try { roar.seekTo(0); roar.play(); } catch { /* never crash */ }
        router.push('/hunt' as any);
        return;
      }
      navigation.navigate(item.name);
    };

    // Hunt Mode gets a lion icon
    const isHunt = item.name === 'hunt-tab';

    return (
      <Pressable
        key={item.name}
        onPress={onPress}
        style={({ pressed }) => [styles.tabItem, pressed && { opacity: 0.7 }]}
      >
        {isHunt ? (
          // Lion paw icon for Hunt Mode
          <MaterialIcons name="pets" size={22} color={color} />
        ) : (
          <MaterialIcons name={(item as any).icon} size={22} color={color} />
        )}
        <Text style={[styles.tabLabel, { color }]}>{item.label}</Text>
        {isActive && !isHunt && <View style={[styles.activeBar, { backgroundColor: V.green }]} />}
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
});
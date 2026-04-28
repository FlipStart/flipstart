import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import * as Haptics from 'expo-haptics';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

import { V } from '@/constants/vintage';
import { promptAndCapture } from '@/lib/capture';
import { setPendingCapture } from '@/lib/pending-capture';

// ─── Tab definitions ──────────────────────────────────────────────────────────

const TAB_ITEMS = [
  { name: 'index',       label: 'Home',        icon: 'home'        },
  { name: 'history',     label: 'History',     icon: 'history'     },
  { name: 'leaderboard', label: 'Leaderboard', icon: 'leaderboard' },
  { name: 'profile',     label: 'Profile',     icon: 'person'      },
] as const;

// ─── Custom tab bar ───────────────────────────────────────────────────────────

function VintageTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, 8);

  // Center button: delegate all capture logic to shared lib/capture.ts
  const handleCenterScan = () => {
    promptAndCapture((photo) => {
      // Store photo for the home screen to pick up via useFocusEffect
      setPendingCapture(photo);
      navigation.navigate('index');
    });
  };

  const leftTabs  = TAB_ITEMS.slice(0, 2);  // Home, History
  const rightTabs = TAB_ITEMS.slice(2);      // Leaderboard, Profile

  const renderTab = (tab: typeof TAB_ITEMS[number]) => {
    const routeIndex = state.routes.findIndex((r) => r.name === tab.name);
    const isActive = state.index === routeIndex;

    const handlePress = () => {
      if (Platform.OS !== 'web') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      }
      navigation.navigate(tab.name);
    };

    return (
      <Pressable
        key={tab.name}
        onPress={handlePress}
        style={styles.tabItem}
        hitSlop={4}
      >
        <MaterialIcons
          name={tab.icon as keyof typeof MaterialIcons.glyphMap}
          size={22}
          color={isActive ? V.green : V.muted}
        />
        <Text style={[styles.tabLabel, { color: isActive ? V.green : V.muted }]}>
          {tab.label}
        </Text>
        {isActive && <View style={[styles.activeBar, { backgroundColor: V.green }]} />}
      </Pressable>
    );
  };

  return (
    <View style={[styles.barWrapper, { paddingBottom: bottomPad }]}>
      <View style={styles.bar}>
        <View style={styles.tabGroup}>{leftTabs.map(renderTab)}</View>

        {/* Center floating scan button */}
        <View style={styles.centerSlot}>
          <Pressable
            onPress={handleCenterScan}
            style={({ pressed }) => [
              styles.centerButton,
              pressed && { transform: [{ scale: 0.94 }], opacity: 0.9 },
            ]}
          >
            <MaterialIcons name="photo-camera" size={26} color={V.white} />
          </Pressable>
        </View>

        <View style={styles.tabGroup}>{rightTabs.map(renderTab)}</View>
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
      <Tabs.Screen name="index"       options={{ title: 'Home'        }} />
      <Tabs.Screen name="history"     options={{ title: 'History'     }} />
      <Tabs.Screen name="leaderboard" options={{ title: 'Leaderboard' }} />
      <Tabs.Screen name="profile"     options={{ title: 'Profile'     }} />
      {/* Settings is accessible via the header gear icon but hidden from tab bar */}
      <Tabs.Screen name="settings"    options={{ href: null           }} />
    </Tabs>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  barWrapper: {
    backgroundColor: V.cardBg,
    borderTopWidth: 1,
    borderTopColor: V.border,
    shadowColor: V.brown,
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 8,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 8,
    paddingHorizontal: 8,
  },
  tabGroup: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 4,
    gap: 2,
    position: 'relative',
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  activeBar: {
    position: 'absolute',
    bottom: -4,
    width: 20,
    height: 3,
    borderRadius: 2,
  },
  centerSlot: {
    width: 72,
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: -22,
  },
  centerButton: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: V.green,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: V.cream,
    shadowColor: V.green,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 8,
  },
});
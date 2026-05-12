import { View, Text, Pressable, StyleSheet, Platform, Alert } from 'react-native';
import { Tabs, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import * as Haptics from 'expo-haptics';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

import { V } from '@/constants/vintage';

// ─── Tab definitions ──────────────────────────────────────────────────────────

const TAB_ITEMS = [
  { name: 'index',       label: 'Home',        icon: 'home'        },
  { name: 'history',     label: 'History',     icon: 'history'     },
  { name: 'leaderboard', label: 'Leaderboard', icon: 'leaderboard' },
  { name: 'profile',     label: 'Profile',     icon: 'person'      },
] as const;

const leftTabs  = TAB_ITEMS.slice(0, 2);
const rightTabs = TAB_ITEMS.slice(2);

// ─── Custom tab bar ───────────────────────────────────────────────────────────

function VintageTabBar({ state, navigation }: BottomTabBarProps) {
  const router    = useRouter();
  const insets    = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, 8);

  const handleCenterScan = () => {
    // Opens the custom camera screen — same as the Home "Scan Item" button.
    // Gallery upload is available inside the camera screen.
    router.push('/camera' as any);
  };

  const renderTab = (item: typeof TAB_ITEMS[number]) => {
    const routeIndex = state.routes.findIndex(r => r.name === item.name);
    const isActive   = state.index === routeIndex;

    const onPress = () => {
      if (item.name === 'leaderboard') {
        if (Platform.OS !== 'web') {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
        }
        Alert.alert(
          '🏆 Leaderboard',
          'The Leaderboard launches in the global release — rankings, weekly challenges, and top flippers are on the way!',
          [{ text: "Can't Wait!", style: 'default' }]
        );
        return;
      }
      if (Platform.OS !== 'web') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      }
      navigation.navigate(item.name);
    };

    return (
      <Pressable
        key={item.name}
        onPress={onPress}
        style={({ pressed }) => [
          styles.tabItem,
          pressed && { opacity: 0.7 },
        ]}
      >
        <MaterialIcons
          name={item.icon as any}
          size={22}
          color={isActive ? V.green : V.textMuted}
        />
        <Text style={[styles.tabLabel, { color: isActive ? V.green : V.textMuted }]}>
          {item.label}
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
              pressed && { transform: [{ scale: 0.93 }], opacity: 0.9 },
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
      <Tabs.Screen name="settings"    options={{ href: null           }} />
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
    fontSize:      10,
    fontWeight:    '600',
    letterSpacing: 0.2,
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
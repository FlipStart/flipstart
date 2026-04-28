/**
 * HomeHeader
 *
 * Imports font tokens from constants/typography.ts.
 * To swap from Georgia to Playfair Display, follow the instructions
 * in that file — no changes needed here.
 */

import { View, Text, Pressable, StyleSheet } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { V } from '@/constants/vintage';
import { FONTS, FONT_SIZES } from '@/constants/typography';

interface HomeHeaderProps {
  onProfilePress?: () => void;
  onNotificationsPress?: () => void;
  onSettingsPress?: () => void;
}

export function HomeHeader({
  onProfilePress,
  onNotificationsPress,
  onSettingsPress,
}: HomeHeaderProps) {
  return (
    <View style={styles.root}>
      <View style={styles.container}>

        {/* Left — profile */}
        <Pressable
          onPress={onProfilePress}
          style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.65 }]}
          hitSlop={8}
        >
          <View style={styles.iconCircle}>
            <MaterialIcons name="person" size={18} color={V.green} />
          </View>
        </Pressable>

        {/* Center — wordmark */}
        <View style={styles.wordmarkRow}>
          <Text style={styles.wordmark}>FlipStart</Text>
          <Text style={styles.wordmarkStar}>✦</Text>
        </View>

        {/* Right — notifications + settings */}
        <View style={styles.rightGroup}>
          <Pressable
            onPress={onNotificationsPress}
            style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.65 }]}
            hitSlop={8}
          >
            <View style={styles.iconCircle}>
              <MaterialIcons name="notifications-none" size={18} color={V.green} />
              <View style={styles.notifDot} />
            </View>
          </Pressable>

          <Pressable
            onPress={onSettingsPress}
            style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.65 }]}
            hitSlop={8}
          >
            <View style={styles.iconCircle}>
              <MaterialIcons name="settings" size={18} color={V.green} />
            </View>
          </Pressable>
        </View>

      </View>

      {/* 1px divider */}
      <View style={styles.divider} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: V.pageBg,
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: V.screenPad,
    paddingTop: 12,
    paddingBottom: 14,
  },
  wordmarkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  wordmark: {
    fontFamily:    FONTS.serif,
    fontSize:      FONT_SIZES.wordmark,
    fontWeight:    '700',
    color:         V.green,
    letterSpacing: -0.3,
  },
  wordmarkStar: {
    fontSize:  13,
    color:     V.gold,
    marginTop: -8,
  },
  iconBtn: {},
  iconCircle: {
    width:           34,
    height:          34,
    borderRadius:    17,
    backgroundColor: V.tan,
    borderWidth:     1.5,
    borderColor:     V.border,
    justifyContent:  'center',
    alignItems:      'center',
    ...V.shadowSm,
  },
  notifDot: {
    position:        'absolute',
    top:             7,
    right:           7,
    width:           6,
    height:          6,
    borderRadius:    3,
    backgroundColor: '#C0392B',
    borderWidth:     1,
    borderColor:     V.tan,
  },
  rightGroup: {
    flexDirection:  'row',
    gap:            8,
    width:          80,
    justifyContent: 'flex-end',
  },
  divider: {
    height:          1,
    backgroundColor: V.border,
  },
});
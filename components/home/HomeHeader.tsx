import { View, Text, Pressable, StyleSheet } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { V } from '@/constants/vintage';
import { FONTS, FONT_SIZES } from '@/constants/typography';

interface HomeHeaderProps {
  onProfilePress?:      () => void;
  onNotificationsPress?: () => void;
  onSettingsPress?:     () => void;
  onModeToggle?:        () => void;
  modeOpen?:            boolean;
}

export function HomeHeader({
  onProfilePress,
  onNotificationsPress,
  onSettingsPress,
  onModeToggle,
  modeOpen = false,
}: HomeHeaderProps) {
  return (
    <View style={s.root}>
      <View style={s.container}>

        {/* Left — profile */}
        <Pressable
          onPress={onProfilePress}
          hitSlop={8}
          style={({ pressed }) => [s.iconBtn, pressed && { opacity: 0.65 }]}
        >
          <View style={s.iconCircle}>
            <MaterialIcons name="person" size={18} color={V.green} />
          </View>
        </Pressable>

        {/* Center — wordmark box (tappable) */}
        <View style={s.wordmarkBox}>
          <Pressable
            onPress={onModeToggle}
            hitSlop={12}
            style={({ pressed }) => [s.wordmarkRow, pressed && { opacity: 0.72 }]}
          >
            <Text style={s.wordmarkStar}>✦</Text>
            <Text style={s.wordmark}>FlipStart</Text>
            <Text style={s.wordmarkStar}>✦</Text>
            <View style={[s.chevronPill, modeOpen && s.chevronPillOpen]}>
              <MaterialIcons
                name={modeOpen ? 'keyboard-arrow-up' : 'keyboard-arrow-down'}
                size={16}
                color={modeOpen ? V.gold : '#FFFFFF'}
              />
            </View>
          </Pressable>
        </View>

        {/* Right — notifications + settings */}
        <View style={s.rightGroup}>
          <Pressable
            onPress={onNotificationsPress}
            hitSlop={8}
            style={({ pressed }) => [s.iconBtn, pressed && { opacity: 0.65 }]}
          >
            <View style={s.iconCircle}>
              <MaterialIcons name="notifications-none" size={18} color={V.green} />
              <View style={s.notifDot} />
            </View>
          </Pressable>

          <Pressable
            onPress={onSettingsPress}
            hitSlop={8}
            style={({ pressed }) => [s.iconBtn, pressed && { opacity: 0.65 }]}
          >
            <View style={s.iconCircle}>
              <MaterialIcons name="settings" size={18} color={V.green} />
            </View>
          </Pressable>
        </View>

      </View>

      {/* 1px divider */}
      <View style={s.divider} />
    </View>
  );
}

const s = StyleSheet.create({
  root:      { backgroundColor: V.pageBg },
  container: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
    paddingHorizontal: V.screenPad,
    paddingTop:        12,
    paddingBottom:     14,
  },

  // Wordmark box — rounded container that makes it look tappable
  wordmarkBox: {
    backgroundColor:   '#EDE5CC',
    borderWidth:       1.5,
    borderColor:       V.gold,
    borderRadius:      14,
    paddingHorizontal: 10,
    paddingVertical:   5,
  },
  wordmarkRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           3,
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

  // Chevron pill
  chevronPill: {
    marginLeft:        6,
    backgroundColor:   V.green,
    borderRadius:      20,
    paddingHorizontal: 7,
    paddingVertical:   3,
    justifyContent:    'center',
    alignItems:        'center',
  },
  chevronPillOpen: {
    backgroundColor: '#1A2E1A',
  },

  // Icon buttons
  iconBtn:    {},
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
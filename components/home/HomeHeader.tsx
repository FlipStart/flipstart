import { View, Text, Pressable, StyleSheet } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { V } from '@/constants/vintage';
import { ScanBalancePill } from '@/components/home/ScanBalancePill';
import { FONTS, FONT_SIZES } from '@/constants/typography';

interface HomeHeaderProps {
  onProfilePress?:  () => void;
  onSettingsPress?: () => void;
}

export function HomeHeader({
  onProfilePress,
  onSettingsPress,
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

        {/* Center — wordmark (static, no toggle) */}
        <View style={s.wordmarkBox}>
          <View style={s.wordmarkRow}>
            <Text style={s.wordmarkStar}>✦</Text>
            <Text style={s.wordmark}>FlipStart</Text>
            <Text style={s.wordmarkStar}>✦</Text>
          </View>
        </View>

        {/* Right — scan balance pill */}
        <View style={s.rightGroup}>
          <ScanBalancePill />
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
    backgroundColor:   '#FFFEFA',
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
    borderColor:     V.gold,
    justifyContent:  'center',
    alignItems:      'center',
    ...V.shadowSm,
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
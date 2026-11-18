/**
 * components/hunt/leaderboard/HunterAvatar.tsx
 *
 * A hunter's picture on the leaderboard, and the Founding Hunter mark.
 *
 * The link is always the server's approved copy (or nothing). With no link, or
 * if the picture fails to load, the default picture is drawn instead.
 */
import { View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useEffect, useState } from 'react';
import { LB } from './theme';

export function HunterAvatar({ uri, size, ring = 'plain', style }: {
  uri: string | null;
  size: number;
  /** gold: first place and the viewer's own card. */
  ring?: 'gold' | 'plain';
  style?: StyleProp<ViewStyle>;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [uri]);
  const gold = ring === 'gold';
  const border = gold ? Math.max(2, Math.round(size / 22)) : 1;
  const inner = size - border * 2;
  return (
    <View
      style={[
        s.wrap,
        { width: size, height: size, borderRadius: size / 2, borderWidth: border, borderColor: gold ? LB.GOLD : LB.CARD_EDGE },
        style,
      ]}
      accessible={false}
    >
      {uri && !failed ? (
        <Image
          source={{ uri }}
          style={{ width: inner, height: inner, borderRadius: inner / 2 }}
          contentFit="cover"
          transition={120}
          onError={() => setFailed(true)}
          accessible={false}
        />
      ) : (
        <MaterialIcons name="person" size={Math.round(size * 0.6)} color={LB.AVATAR_FG} />
      )}
    </View>
  );
}

/** The small gold mark beside a Founding Hunter's name. */
export function FoundingMark({ size = 14 }: { size?: number }) {
  return (
    <MaterialIcons
      name="workspace-premium"
      size={size}
      color={LB.GOLD_DEEP}
      accessibilityLabel="Founding Hunter"
      testID="founding-mark"
    />
  );
}

const s = StyleSheet.create({
  wrap: { backgroundColor: LB.AVATAR_BG, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
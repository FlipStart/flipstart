import { View, Text, Pressable, StyleSheet } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { V } from '@/constants/vintage';

interface SectionHeaderProps {
  title: string;
  pillLabel?: string;
  pillIcon?: string;
  onPillPress?: () => void;
}

export function SectionHeader({ title, pillLabel, pillIcon, onPillPress }: SectionHeaderProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      {pillLabel ? (
        <Pressable
          onPress={onPillPress}
          style={({ pressed }) => [styles.pill, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.pillText}>{pillLabel}</Text>
          {pillIcon ? (
            <MaterialIcons name={pillIcon as keyof typeof MaterialIcons.glyphMap} size={12} color={V.brownMid} />
          ) : (
            <MaterialIcons name="chevron-right" size={14} color={V.brownMid} />
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: V.screenPad,
    marginBottom: 10,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: '#3D2A12',  // warm near-black brown
    letterSpacing: -0.2,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: V.pillRadius,
    backgroundColor: V.cardBg,
    borderWidth: 1,
    borderColor: V.border,
    ...V.shadowSm,
  },
  pillText: {
    fontSize: 12,
    fontWeight: '600',
    color: V.brownMid,
  },
});
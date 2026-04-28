import { View, Text, Pressable, StyleSheet } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { V } from '@/constants/vintage';

interface FeatureCardProps {
  title: string;
  subtitle: string;
  iconName: string;
  badge?: string;
  onPress?: () => void;
  accentColor?: string;
}

export function FeatureCard({
  title,
  subtitle,
  iconName,
  badge,
  onPress,
  accentColor = V.gold,
}: FeatureCardProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        pressed && { transform: [{ scale: 0.98 }], opacity: 0.92 },
      ]}
    >
      {/* Decorative background circle */}
      <View style={[styles.bgCircle, { backgroundColor: accentColor + '12' }]} />

      {/* Left: icon */}
      <View style={[styles.iconWrap, { backgroundColor: accentColor + '18', borderColor: accentColor + '30' }]}>
        <MaterialIcons name={iconName as any} size={24} color={accentColor} />
      </View>

      {/* Middle: text */}
      <View style={styles.textBlock}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>{title}</Text>
          {badge ? (
            <View style={[styles.badge, { backgroundColor: accentColor }]}>
              <Text style={styles.badgeText}>{badge}</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </View>

      {/* Right: arrow */}
      <MaterialIcons name="arrow-forward-ios" size={14} color={V.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: V.cardBg,
    borderRadius: V.cardRadius,
    padding: 16,
    marginHorizontal: V.screenPad,
    gap: 14,
    borderWidth: 1,
    borderColor: V.border,
    overflow: 'hidden',
    ...V.shadow,
  },
  bgCircle: {
    position: 'absolute',
    right: -20,
    top: -20,
    width: 80,
    height: 80,
    borderRadius: 40,
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
  },
  textBlock: {
    flex: 1,
    gap: 3,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: V.brown,
    letterSpacing: -0.1,
  },
  badge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: V.white,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  subtitle: {
    fontSize: 12,
    color: V.muted,
    lineHeight: 17,
  },
});
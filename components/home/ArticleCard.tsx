import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { V } from '@/constants/vintage';

export interface ArticleCardData {
  id: string;
  title: string;
  imageUri?: string;
  priceBadge?: string;
  badgeVariant?: 'green' | 'red' | 'gold';
  sourceName?: string;
  sourcePrice?: string;
}

interface ArticleCardProps {
  data: ArticleCardData;
  onPress?: () => void;
}

export function ArticleCard({ data, onPress }: ArticleCardProps) {
  const badgeColors: Record<string, string> = {
    green: V.green,
    red:   '#B85450',
    gold:  V.gold,
  };
  const badgeBg = badgeColors[data.badgeVariant ?? 'gold'] ?? V.gold;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.88 }]}
    >
      {/* Image */}
      <View style={styles.imageWrap}>
        {data.imageUri ? (
          <Image
            source={{ uri: data.imageUri }}
            style={styles.image}
            contentFit="cover"
          />
        ) : (
          <View style={[styles.image, styles.imagePlaceholder]} />
        )}

        {/* Price badge overlay */}
        {data.priceBadge ? (
          <View style={[styles.priceBadge, { backgroundColor: badgeBg }]}>
            <Text style={styles.priceBadgeText}>{data.priceBadge}</Text>
          </View>
        ) : null}
      </View>

      {/* Text */}
      <View style={styles.textBlock}>
        <Text style={styles.title} numberOfLines={2}>{data.title}</Text>
        {data.sourcePrice ? (
          <Text style={styles.sourceLine}>
            {data.sourcePrice}
            {data.sourceName ? (
              <Text style={styles.sourceName}> {data.sourceName}</Text>
            ) : null}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 160,
    backgroundColor: V.cardBg,
    borderRadius: V.cardRadius,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: V.border,
    ...V.shadowSm,
  },
  imageWrap: {
    position: 'relative',
  },
  image: {
    width: '100%',
    height: 110,
  },
  imagePlaceholder: {
    backgroundColor: V.tan,
  },
  priceBadge: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  priceBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: V.white,
  },
  textBlock: {
    padding: 10,
    gap: 4,
  },
  title: {
    fontSize: 12,
    fontWeight: '700',
    color: V.brown,
    lineHeight: 17,
  },
  sourceLine: {
    fontSize: 11,
    color: V.muted,
  },
  sourceName: {
    fontSize: 10,
    color: V.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
});
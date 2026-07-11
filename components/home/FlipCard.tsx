import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Image } from 'expo-image';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { V } from '@/constants/vintage';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FlipCardData {
  rank: number;
  /**
   * ISO 3166-1 alpha-2 country code, e.g. 'US', 'GB', 'CA'.
   * We render a two-letter text badge instead of an emoji flag so rendering
   * is 100% reliable across all React Native targets — emoji flag support is
   * inconsistent on Android and breaks entirely when injected via Python
   * unicode escapes (\U0001f1fa...) which JS does not parse.
   */
  countryCode: string;
  userName: string;
  itemName: string;
  thriftPrice: number;
  soldPrice: number;
  imageUri?: string;
}

interface FlipCardProps {
  data: FlipCardData;
  onPress?: () => void;
}

// Map common codes to display labels — extend as needed
const COUNTRY_LABELS: Record<string, string> = {
  US: '🇺🇸', GB: '🇬🇧', CA: '🇨🇦', AU: '🇦🇺',
  DE: '🇩🇪', FR: '🇫🇷', JP: '🇯🇵', BR: '🇧🇷',
};

function CountryBadge({ code }: { code: string }) {
  const emoji = COUNTRY_LABELS[code.toUpperCase()];
  if (emoji) {
    // Render as a plain string — React Native handles literal emoji
    // in JSX text nodes reliably. The broken rendering was caused by
    // Python unicode escape sequences, NOT by emoji in JSX strings.
    return <Text style={styles.flagEmoji}>{emoji}</Text>;
  }
  // Fallback: two-letter text badge for any unknown code
  return (
    <View style={styles.countryBadge}>
      <Text style={styles.countryCode}>{code.toUpperCase()}</Text>
    </View>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function FlipCard({ data, onPress }: FlipCardProps) {
  const profit = data.soldPrice - data.thriftPrice;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        pressed && { opacity: 0.88, transform: [{ scale: 0.99 }] },
      ]}
    >
      {/* ── Rank ─────────────────────────────────────────────────────────── */}
      <View style={styles.rankBadge}>
        <Text style={styles.rankText}>{data.rank}</Text>
      </View>

      {/* ── Thumbnail ────────────────────────────────────────────────────── */}
      <View style={styles.thumbWrap}>
        {data.imageUri ? (
          <Image
            source={{ uri: data.imageUri }}
            style={styles.thumb}
            contentFit="cover"
          />
        ) : (
          <View style={styles.thumbPlaceholder}>
            <MaterialIcons name="checkroom" size={24} color={V.muted} />
          </View>
        )}
      </View>

      {/* ── Info ─────────────────────────────────────────────────────────── */}
      <View style={styles.info}>
        {/* User row */}
        <View style={styles.userRow}>
          <CountryBadge code={data.countryCode} />
          <Text style={styles.userName} numberOfLines={1}>{data.userName}</Text>
        </View>
        {/* Item name */}
        <Text style={styles.itemName} numberOfLines={1}>{data.itemName}</Text>
        {/* Thrift price */}
        <Text style={styles.thriftLabel}>
          Thrift Price: <Text style={styles.thriftValue}>${data.thriftPrice}</Text>
        </Text>
      </View>

      {/* ── Price block ──────────────────────────────────────────────────── */}
      <View style={styles.priceBlock}>
        <View style={styles.soldBadge}>
          <Text style={styles.soldPrice}>${data.soldPrice}</Text>
        </View>
        <Text style={styles.profitText}>+${profit}</Text>
      </View>
    </Pressable>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    flexDirection:    'row',
    alignItems:       'center',
    backgroundColor:  V.cardBg,
    borderRadius:     14,
    paddingVertical:  13,
    paddingHorizontal: 13,
    marginHorizontal: V.screenPad,
    gap:              11,
    borderWidth:      1,
    borderColor:      V.border,
    shadowColor:      '#2F5D3A',
    shadowOffset:     { width: 0, height: 2 },
    shadowOpacity:    0.07,
    shadowRadius:     6,
    elevation:        2,
  },

  // ── Rank badge ─────────────────────────────────────────────────────────────
  rankBadge: {
    width:           30,
    height:          30,
    borderRadius:    9,
    backgroundColor: V.tan,
    borderWidth:     1,
    borderColor:     V.border,
    justifyContent:  'center',
    alignItems:      'center',
  },
  rankText: {
    fontSize:   12,
    fontWeight: '800',
    color:      V.textDark,
    letterSpacing: -0.3,
  },

  // ── Thumbnail ──────────────────────────────────────────────────────────────
  thumbWrap: {
    borderRadius: 11,
    overflow:     'hidden',
    borderWidth:  1,
    borderColor:  V.border,
  },
  thumb: {
    width:        54,
    height:       54,
    borderRadius: 10,
  },
  thumbPlaceholder: {
    width:           54,
    height:          54,
    borderRadius:    10,
    backgroundColor: V.tan,
    justifyContent:  'center',
    alignItems:      'center',
  },

  // ── Info block ─────────────────────────────────────────────────────────────
  info: {
    flex: 1,
    gap:  3,
  },
  userRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           5,
  },
  flagEmoji: {
    fontSize:   15,
    lineHeight: 18,
  },
  // Fallback text badge for unknown country codes
  countryBadge: {
    backgroundColor: V.tan,
    borderRadius:    4,
    paddingHorizontal: 4,
    paddingVertical:   1,
    borderWidth:     1,
    borderColor:     V.border,
  },
  countryCode: {
    fontSize:   9,
    fontWeight: '700',
    color:      V.textMuted,
    letterSpacing: 0.5,
  },
  userName: {
    fontSize:   14,
    fontWeight: '700',
    color:      V.textDark,
    flex:       1,
  },
  itemName: {
    fontSize:   12,
    fontWeight: '500',
    color:      V.textMuted,
    lineHeight: 17,
  },
  thriftLabel: {
    fontSize: 11,
    color:    V.textMuted,
  },
  thriftValue: {
    fontWeight: '600',
    color:      V.textMuted,
  },

  // ── Price block ────────────────────────────────────────────────────────────
  priceBlock: {
    alignItems: 'flex-end',
    gap:        5,
  },
  soldBadge: {
    backgroundColor:  V.green,
    paddingHorizontal: 11,
    paddingVertical:   6,
    borderRadius:      10,
  },
  soldPrice: {
    fontSize:   15,
    fontWeight: '800',
    color:      '#FFFEFA',
    letterSpacing: -0.3,
  },
  profitText: {
    fontSize:   11,
    fontWeight: '700',
    color:      V.green,
  },
});
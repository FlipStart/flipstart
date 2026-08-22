/**
 * app/scan-store.tsx
 *
 * Scan Store — placeholder.
 *
 * ── Purpose ─────────────────────────────────────────────────────────────────
 * Establishes the route, the header and the back behaviour so the entry point
 * in the scan-balance sheet has somewhere real to go. The store itself comes
 * later.
 *
 * ── Deliberately empty of commerce ──────────────────────────────────────────
 * No pack products, no prices, no quantities, no purchase buttons, no
 * RevenueCat, no Restore. A convincing-looking fake store is worse than an
 * honest placeholder: it invites taps that cannot be honoured, and it makes the
 * real build harder because someone has to work out which parts were real.
 *
 * ── Built to be replaced ────────────────────────────────────────────────────
 * The scroll container, header and safe-area handling are the parts that stay.
 * The real store fills <ScanStoreBody/> below — balance, five pack products,
 * prices, purchase state — without any navigation call changing.
 */
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { FONTS } from '@/constants/typography';

const BG     = '#FFFFFF';
const FOREST = '#2A4A2A';
const BROWN  = '#5A3A1A';
const MUTED  = '#8A7050';
const GOLD   = '#BE9C2C';
const CREAM  = '#F4EED8';

export default function ScanStoreScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={s.root}>
      {/* Header outside the ScrollView, matching analysis-details — avoids
          double safe-area stacking. */}
      <View style={[s.header, { paddingTop: insets.top + 14 }]}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={({ pressed }) => [pressed && { opacity: 0.6 }]}
        >
          <MaterialIcons name="arrow-back" size={22} color={CREAM} />
        </Pressable>

        <Text style={s.headerTitle} accessibilityRole="header">Scan Store</Text>

        {/* Balances the back arrow so the title sits centred. */}
        <View style={{ width: 22 }} />
      </View>

      <ScrollView
        contentContainerStyle={[s.body, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        <ScanStoreBody />
      </ScrollView>
    </View>
  );
}

/**
 * The replaceable part.
 *
 * Everything above is chrome that survives; this is what the real store
 * becomes. Kept as a separate component so that swap touches one function.
 */
function ScanStoreBody() {
  return (
    <View style={s.placeholder}>
      <View style={s.iconRing}>
        <MaterialIcons name="bolt" size={26} color={GOLD} />
      </View>

      <Text style={s.lead}>Stock up on extra scans whenever you need them.</Text>
      <Text style={s.soon}>Scan Store coming soon.</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingBottom: 14, backgroundColor: FOREST,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15, shadowRadius: 4, elevation: 4,
  },
  headerTitle: { fontFamily: FONTS.serif, fontSize: 18, fontWeight: '800', color: CREAM },
  body: { paddingHorizontal: 26, paddingTop: 56, alignItems: 'center' },
  placeholder: { alignItems: 'center', gap: 12 },
  iconRing: {
    width: 62, height: 62, borderRadius: 31,
    borderWidth: 1.5, borderColor: GOLD,
    alignItems: 'center', justifyContent: 'center', marginBottom: 6,
  },
  lead: { fontSize: 15, color: BROWN, textAlign: 'center', lineHeight: 22 },
  soon: { fontFamily: FONTS.serif, fontSize: 16, fontWeight: '800',
          color: MUTED, textAlign: 'center', marginTop: 2 },
});
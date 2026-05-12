/**
 * app/about.tsx
 *
 * About FlipStart — polished product overview screen.
 * Explains the app, AI analysis, scan flow, Hunt Mode vision,
 * beta status, and supported marketplaces.
 * Vintage/premium aesthetic matching FlipStart branding.
 */

import { ScrollView, View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { FONTS } from '@/constants/typography';

// ─── Palette ─────────────────────────────────────────────────────────────────

const FOREST = '#2A4A2A';
const GOLD   = '#BE9C2C';
const BROWN  = '#5A3A1A';
const MUTED  = '#8A7050';
const CARD   = '#FFF9EE';
const CARD_B = '#DDD0B0';
const BG     = '#F0E8D4';
const CREAM  = '#F4EED8';
const TAN    = '#E8DFC0';

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionLabel({ text }: { text: string }) {
  return <Text style={s.sectionLabel}>{text}</Text>;
}

function InfoCard({ icon, color, title, body }: {
  icon: string; color: string; title: string; body: string;
}) {
  return (
    <View style={s.infoCard}>
      <View style={[s.infoIconWrap, { backgroundColor: color + '18' }]}>
        <MaterialIcons name={icon as any} size={20} color={color} />
      </View>
      <View style={s.infoText}>
        <Text style={s.infoTitle}>{title}</Text>
        <Text style={s.infoBody}>{body}</Text>
      </View>
    </View>
  );
}

function StepRow({ step, title, body }: { step: string; title: string; body: string }) {
  return (
    <View style={s.stepRow}>
      <View style={s.stepBadge}>
        <Text style={s.stepNum}>{step}</Text>
      </View>
      <View style={s.stepText}>
        <Text style={s.stepTitle}>{title}</Text>
        <Text style={s.stepBody}>{body}</Text>
      </View>
    </View>
  );
}

function MarketplacePill({ name, emoji }: { name: string; emoji: string }) {
  return (
    <View style={s.marketplacePill}>
      <Text style={s.marketplaceEmoji}>{emoji}</Text>
      <Text style={s.marketplaceName}>{name}</Text>
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function AboutScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>

      {/* Header */}
      <View style={s.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          style={({ pressed }) => [s.backBtn, pressed && { opacity: 0.65 }]}
        >
          <MaterialIcons name="arrow-back" size={20} color={CREAM} />
        </Pressable>
        <Text style={s.headerTitle}>About FlipStart</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >

        {/* Hero block */}
        <View style={s.hero}>
          <Text style={s.heroWordmark}>FlipStart</Text>
          <Text style={s.heroTagline}>✦ THRIFT INTELLIGENCE ✦</Text>
          <Text style={s.heroDesc}>
            AI-powered resale analysis for thrift store shoppers. Know what's worth buying before you leave the rack.
          </Text>
          <View style={s.betaBadge}>
            <Text style={s.betaBadgeText}>CLOSED BETA · v1.0.0</Text>
          </View>
        </View>

        {/* What FlipStart does */}
        <SectionLabel text="WHAT FLIPSTART DOES" />
        <View style={s.card}>
          <InfoCard
            icon="photo-camera"
            color={FOREST}
            title="Photograph Any Thrift Item"
            body="Take up to 3 photos — front, tag, and a graphic or detail shot. The more context you give the AI, the more accurate the analysis."
          />
          <View style={s.cardDivider} />
          <InfoCard
            icon="psychology"
            color={GOLD}
            title="AI Resale Analysis"
            body="GPT-4o vision analyzes brand, era, condition, demand, and sell speed. Returns a resale value estimate, profit projection, and a Buy / Skip recommendation."
          />
          <View style={s.cardDivider} />
          <InfoCard
            icon="store"
            color="#5A8A5A"
            title="Ready-to-Post Listings"
            body="Generate a complete Depop or eBay listing in seconds — title, description, price, and platform recommendation included."
          />
        </View>

        {/* Scan flow */}
        <SectionLabel text="HOW A SCAN WORKS" />
        <View style={s.card}>
          <StepRow
            step="1"
            title="Open the App at the Thrift Store"
            body="Tap the camera button in the tab bar or the Scan Item card on the home screen."
          />
          <View style={s.cardDivider} />
          <StepRow
            step="2"
            title="Photograph Front, Tag, and Graphic"
            body="Front photo is required. Tag helps the AI read the brand and era. Graphic slot is for unique details, embroidery, flaws, or back prints."
          />
          <View style={s.cardDivider} />
          <StepRow
            step="3"
            title="Review the Analysis"
            body="See the AI's recommendation, resale estimate, confidence score, demand signal, and platform suggestion — in under 10 seconds."
          />
          <View style={s.cardDivider} />
          <StepRow
            step="4"
            title="Generate Your Listing"
            body="If you buy it, generate a Depop or eBay listing with one tap. Copy and paste directly into your listing app."
          />
        </View>

        {/* Hunt Mode */}
        <SectionLabel text="HUNT MODE (COMING SOON)" />
        <View style={[s.card, s.huntCard]}>
          <View style={s.huntHeader}>
            <Text style={s.huntIcon}>🦁</Text>
            <View style={s.huntTitleBlock}>
              <Text style={s.huntTitle}>Hunt Mode</Text>
              <View style={s.huntBadge}>
                <Text style={s.huntBadgeText}>GLOBAL RELEASE</Text>
              </View>
            </View>
          </View>
          <Text style={s.huntBody}>
            Hunt Mode turns FlipStart into a full store session tracker. Scan everything you find, track your haul, and get an end-of-session profit summary before you check out.
          </Text>
          <View style={s.huntFeatures}>
            {[
              'Full haul tracking across a single thrift session',
              'Session profit estimate before checkout',
              'Best-of-haul ranking to help prioritize limited budget',
              'Hunt history and session comparison over time',
            ].map((f, i) => (
              <View key={i} style={s.huntFeatureRow}>
                <View style={s.huntBullet} />
                <Text style={s.huntFeatureText}>{f}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Supported marketplaces */}
        <SectionLabel text="SUPPORTED MARKETPLACES" />
        <View style={s.card}>
          <Text style={s.cardBodyText}>
            FlipStart generates listings and pricing estimates optimized for these platforms.
          </Text>
          <View style={s.marketplaceRow}>
            <MarketplacePill name="Depop"    emoji="🛍️" />
            <MarketplacePill name="eBay"     emoji="🏷️" />
            <MarketplacePill name="Poshmark" emoji="👗" />
            <MarketplacePill name="Grailed"  emoji="👕" />
          </View>
          <Text style={s.cardSubText}>
            More marketplace integrations — including direct listing push — are planned for the global release.
          </Text>
        </View>

        {/* Beta disclaimer */}
        <SectionLabel text="BETA PROGRAM" />
        <View style={[s.card, s.betaCard]}>
          <MaterialIcons name="science" size={22} color={GOLD} style={{ marginBottom: 8 }} />
          <Text style={s.betaTitle}>You're in the Closed Beta</Text>
          <Text style={s.betaBody}>
            FlipStart is currently in a closed beta program. AI accuracy improves with every scan and every piece of feedback you submit. Your scans are actively shaping the product.
          </Text>
          <Text style={s.betaBody}>
            Features may change, pricing is not final, and some screens are intentionally marked as coming in the global release. Thank you for being here early.
          </Text>
          <View style={s.betaDivider} />
          <Text style={s.betaContact}>
            Feedback: <Text style={s.betaContactLink}>flipstartapp@gmail.com</Text>
          </Text>
        </View>

        {/* Footer */}
        <View style={s.footer}>
          <Text style={s.footerText}>✦ FlipStart · Thrift Intelligence ✦</Text>
          <Text style={s.footerSub}>Built for the rack. Powered by AI.</Text>
        </View>

      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },

  header: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
    paddingHorizontal: 16,
    paddingTop:        10,
    paddingBottom:     14,
    borderBottomWidth: 1,
    borderBottomColor: '#1A3A1A',
    backgroundColor:   FOREST,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center', alignItems: 'center',
  },
  headerTitle: {
    fontFamily: FONTS.serif, fontSize: 18, fontWeight: '700',
    color: CREAM, flex: 1, textAlign: 'center',
  },

  scroll: { paddingHorizontal: 16, paddingTop: 4 },

  // ── Hero ───────────────────────────────────────────────────────────────────
  hero: {
    alignItems: 'center',
    paddingVertical: 28,
    gap: 8,
  },
  heroWordmark: {
    fontFamily: FONTS.serif, fontSize: 36, fontWeight: '800',
    color: FOREST, letterSpacing: -0.5,
  },
  heroTagline: {
    fontSize: 10, fontWeight: '700', color: GOLD, letterSpacing: 2,
  },
  heroDesc: {
    fontSize: 15, color: MUTED, textAlign: 'center',
    lineHeight: 22, paddingHorizontal: 12, marginTop: 4,
  },
  betaBadge: {
    backgroundColor: FOREST, borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 5, marginTop: 4,
  },
  betaBadgeText: {
    fontFamily: FONTS.serif, fontSize: 9, fontWeight: '700',
    color: GOLD, letterSpacing: 1.5,
  },

  // ── Section label ──────────────────────────────────────────────────────────
  sectionLabel: {
    fontSize: 10, fontWeight: '700', color: MUTED,
    letterSpacing: 1.4, marginBottom: 8, marginLeft: 4, marginTop: 20,
  },

  // ── Card ───────────────────────────────────────────────────────────────────
  card: {
    backgroundColor: CARD, borderRadius: 16,
    borderWidth: 1, borderColor: CARD_B,
    overflow: 'hidden',
  },
  cardDivider: { height: 1, backgroundColor: CARD_B },
  cardBodyText: {
    fontSize: 13, color: MUTED, lineHeight: 20,
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 2,
  },
  cardSubText: {
    fontSize: 11, color: MUTED, lineHeight: 17,
    paddingHorizontal: 16, paddingBottom: 14,
  },

  // ── InfoCard ───────────────────────────────────────────────────────────────
  infoCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    paddingHorizontal: 16, paddingVertical: 14,
  },
  infoIconWrap: {
    width: 40, height: 40, borderRadius: 12,
    justifyContent: 'center', alignItems: 'center', flexShrink: 0,
  },
  infoText: { flex: 1, gap: 3 },
  infoTitle: {
    fontFamily: FONTS.serif, fontSize: 14, fontWeight: '700', color: BROWN,
  },
  infoBody: { fontSize: 13, color: MUTED, lineHeight: 19 },

  // ── Step row ───────────────────────────────────────────────────────────────
  stepRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    paddingHorizontal: 16, paddingVertical: 14,
  },
  stepBadge: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: FOREST, justifyContent: 'center', alignItems: 'center',
    flexShrink: 0, marginTop: 1,
  },
  stepNum: {
    fontFamily: FONTS.serif, fontSize: 12, fontWeight: '800', color: GOLD,
  },
  stepText: { flex: 1, gap: 3 },
  stepTitle: {
    fontFamily: FONTS.serif, fontSize: 14, fontWeight: '700', color: BROWN,
  },
  stepBody: { fontSize: 13, color: MUTED, lineHeight: 19 },

  // ── Hunt Mode card ─────────────────────────────────────────────────────────
  huntCard: { padding: 16 },
  huntHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10,
  },
  huntIcon: { fontSize: 28 },
  huntTitleBlock: { gap: 4 },
  huntTitle: {
    fontFamily: FONTS.serif, fontSize: 18, fontWeight: '800', color: '#162D1A',
  },
  huntBadge: {
    backgroundColor: '#162D1A', borderRadius: 20, alignSelf: 'flex-start',
    paddingHorizontal: 10, paddingVertical: 3,
  },
  huntBadgeText: {
    fontFamily: FONTS.serif, fontSize: 8, fontWeight: '700',
    color: GOLD, letterSpacing: 1.5,
  },
  huntBody: {
    fontSize: 13, color: MUTED, lineHeight: 20, marginBottom: 12,
  },
  huntFeatures: { gap: 8 },
  huntFeatureRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
  },
  huntBullet: {
    width: 5, height: 5, borderRadius: 3,
    backgroundColor: GOLD, marginTop: 7, flexShrink: 0,
  },
  huntFeatureText: { flex: 1, fontSize: 13, color: BROWN, lineHeight: 20 },

  // ── Marketplace pills ──────────────────────────────────────────────────────
  marketplaceRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
    paddingHorizontal: 16, paddingVertical: 12,
  },
  marketplacePill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: TAN, borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: 1, borderColor: CARD_B,
  },
  marketplaceEmoji: { fontSize: 14 },
  marketplaceName: {
    fontSize: 13, fontWeight: '700', color: BROWN,
  },

  // ── Beta card ──────────────────────────────────────────────────────────────
  betaCard: { padding: 16 },
  betaTitle: {
    fontFamily: FONTS.serif, fontSize: 16, fontWeight: '800',
    color: BROWN, marginBottom: 8,
  },
  betaBody: {
    fontSize: 13, color: MUTED, lineHeight: 20, marginBottom: 8,
  },
  betaDivider: { height: 1, backgroundColor: CARD_B, marginVertical: 12 },
  betaContact: { fontSize: 12, color: MUTED },
  betaContactLink: { color: FOREST, fontWeight: '700' },

  // ── Footer ─────────────────────────────────────────────────────────────────
  footer: {
    alignItems: 'center', paddingVertical: 24, gap: 6,
    borderTopWidth: 1, borderTopColor: CARD_B, marginTop: 8,
  },
  footerText: {
    fontFamily: FONTS.serif, fontSize: 11, color: MUTED, letterSpacing: 1,
  },
  footerSub: { fontSize: 11, color: MUTED },
});
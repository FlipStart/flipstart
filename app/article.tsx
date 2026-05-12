/**
 * app/article.tsx
 *
 * Article detail screen for FlipStart Guides.
 * Reads ?id= param from route, renders the matching article.
 * Vintage/premium aesthetic matching FlipStart branding.
 */

import { ScrollView, View, Text, Pressable, StyleSheet, Image } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
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

// ─── Article content ──────────────────────────────────────────────────────────

interface ArticleSection {
  type: 'heading' | 'body' | 'tip' | 'list';
  text?: string;
  items?: string[];
}

interface Article {
  id: string;
  title: string;
  subtitle: string;
  imageUri: string;
  readTime: string;
  sections: ArticleSection[];
}

const ARTICLES: Record<string, Article> = {
  a1: {
    id: 'a1',
    title: 'Thrift Brands Worth Real Money',
    subtitle: 'The brands serious resellers hunt for every time they walk into a thrift store.',
    imageUri: 'https://images.unsplash.com/photo-1441984904996-e0b6ba687e04?w=800&q=80',
    readTime: '4 min read',
    sections: [
      {
        type: 'body',
        text: "Not every thrift store find is worth flipping, but certain brands almost always are. Knowing which labels to look for before you even pick up a hanger is the difference between a $4 profit and a $120 payday.",
      },
      { type: 'heading', text: 'The Tier 1 Brands — Always Check' },
      {
        type: 'list',
        items: [
          'Ralph Lauren (Polo, Purple Label, RRL) — collars, crest polos, flannels',
          'Tommy Hilfiger — flag logos, rugby shirts, vintage spell-out',
          "Levi's — 501s, trucker jackets, deadstock orange tabs",
          'Carhartt — Detroit jackets, canvas work coats, double-knee pants',
          'Patagonia — fleeces, puffys, synchillas (anything with a logo)',
          'Arc\'teryx — any shell or mid-layer, even older pieces command $150+',
          'The North Face — purple label Japan, 700-fill down, vintage logos',
          'Harley-Davidson — band tees, flame graphics, anything pre-2000',
        ],
      },
      { type: 'heading', text: 'The Hidden Value Brands' },
      {
        type: 'body',
        text: "These brands get passed over by casual thrifters but resellers in the know clean up on them.",
      },
      {
        type: 'list',
        items: [
          'Pendleton — wool shirts and blankets have serious collector value',
          'Woolrich — vintage wool coats and mackinaws sell fast',
          'Eddie Bauer — Goose Down label pieces from the 80s–90s',
          'LL Bean — vintage field coats, Baxter State parkas, hunting flannels',
          'Wrangler Western Cut — 13MWZ, no-fault jeans, pearl snap shirts',
          'Lee — union-made, storm riders, riders jeans with original tags',
          'Starter — satin jackets with pro sports teams go for $80–$400',
          'Champion — reverse weave crewnecks with the C logo on the sleeve',
        ],
      },
      { type: 'heading', text: 'The Pro Tip' },
      {
        type: 'tip',
        text: "Always scan the tag before the front of the garment. Brand + era is determined at the label. A 1980s Polo tag on a faded polo shirt is worth more than a modern perfect-condition one.",
      },
      { type: 'heading', text: 'Brands to Skip (Usually)' },
      {
        type: 'body',
        text: "Croft & Barrow, Kirkland, St. John's Bay, Sonoma, Apt. 9, and most Target/Walmart house brands are almost never worth flipping unless there's a unusual graphic or co-lab. Your time is worth more than $4.",
      },
    ],
  },

  a2: {
    id: 'a2',
    title: 'Spotting Fake Designer Items',
    subtitle: 'How to authenticate before you buy — and avoid the costly mistakes that burn beginners.',
    imageUri: 'https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=800&q=80',
    readTime: '5 min read',
    sections: [
      {
        type: 'body',
        text: "Fakes end up in thrift stores more often than people realize — donated by previous owners who didn't know or didn't care. Listing a fake as authentic on Depop or eBay can get you permanently banned and charged back. Learn to authenticate before you buy.",
      },
      { type: 'heading', text: 'The Universal Authentication Checklist' },
      {
        type: 'list',
        items: [
          'Stitching — authentic luxury is perfectly even, never skips or puckers',
          'Font — logos have exact letterforms; any variation is a red flag',
          'Hardware — zippers, snaps, and buttons on real pieces feel heavy and solid',
          'Labels — check interior labels for font consistency, country of origin accuracy, and care instruction quality',
          'Smell — real leather smells like leather; fakes often have a chemical smell',
          'Weight — real wool, leather, and canvas pieces feel noticeably heavier',
        ],
      },
      { type: 'heading', text: 'Brand-Specific Red Flags' },
      {
        type: 'tip',
        text: "Louis Vuitton: never has a seam running through the center of the LV logo. The monogram pattern always lines up at seams on authentic pieces.",
      },
      {
        type: 'list',
        items: [
          "Supreme: box logo spacing is exact — fakes have slightly wider gaps between letters",
          "Gucci: interlocking G logo is always symmetrical; the G loops never touch",
          "North Face: zipper pulls are always branded YKK or Talon on authentic pieces",
          "Jordan/Nike: Jumpman proportions are very specific — the legs and arms are never thick",
          "Rolex: crown logo on the dial is razor-sharp even at 10x magnification",
          "Stone Island: the compass badge stitching has exactly 8 visible stitches per side",
        ],
      },
      { type: 'heading', text: 'Tools That Help' },
      {
        type: 'list',
        items: [
          "Loupe (10x magnifier) — $8 on Amazon, essential for logo detail checks",
          "Entrupy app — AI-powered leather goods authentication used by resellers",
          "CheckFresh — sneaker authentication database with production date codes",
          "Reddit r/Authenticate — free community authentication, usually fast responses",
          "StockX Verification — if you're selling sneakers, always verify before listing",
        ],
      },
      { type: 'heading', text: 'When in Doubt' },
      {
        type: 'body',
        text: "If you're not certain and can't authenticate on the spot, pass. A $15 thrift store item is not worth a $150 chargeback, a bad review, and a platform warning. Confident resellers walk away more than beginners think.",
      },
    ],
  },

  a3: {
    id: 'a3',
    title: 'Best Platforms for Flipping in 2025',
    subtitle: 'Where your items actually sell — and which platforms are worth your time.',
    imageUri: 'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=800&q=80',
    readTime: '5 min read',
    sections: [
      {
        type: 'body',
        text: "Listing in the wrong place is one of the most common beginner mistakes. Different platforms attract different buyers — knowing where your item's buyer lives before you list saves time, fees, and frustration.",
      },
      { type: 'heading', text: 'Depop' },
      {
        type: 'list',
        items: [
          'Best for: Y2K, streetwear, vintage tees, 90s/2000s fashion, graphic clothing',
          'Buyer age: 18–30, fashion-forward, style-driven',
          'Fees: 10% Depop + PayPal/Stripe processing',
          'Average sell speed: 3–10 days for well-priced items',
          'Pro tip: Aesthetic photos on white or clean backgrounds sell faster than rack shots',
        ],
      },
      { type: 'heading', text: 'eBay' },
      {
        type: 'list',
        items: [
          'Best for: workwear, outerwear, denim, vintage sportswear, branded basics',
          'Buyer age: 25–55, practical buyers, collectors, resellers buying to resell',
          'Fees: ~13.25% final value fee for most clothing',
          'Average sell speed: 7–21 days, faster with Best Offer',
          'Pro tip: Completed listings are the most accurate comp tool in the business',
        ],
      },
      { type: 'heading', text: 'Poshmark' },
      {
        type: 'list',
        items: [
          'Best for: women\'s clothing, handbags, shoes, activewear, athleisure',
          'Buyer age: 28–45, style-conscious, brand-aware women',
          'Fees: flat $2.95 under $15, 20% over $15',
          'Average sell speed: slower — expect 14–30 days unless you share aggressively',
          'Pro tip: Active sharing (re-sharing your own listings daily) is almost mandatory',
        ],
      },
      {
        type: 'tip',
        text: "The real move: cross-list on both Depop and eBay for most items. When one sells, delete the other. Tools like Vendoo and List Perfectly automate this. The exposure increase usually outweighs the extra work.",
      },
      { type: 'heading', text: 'Platform Quick-Match Guide' },
      {
        type: 'list',
        items: [
          'Vintage graphic tee from the 80s → Depop first, eBay second',
          'Carhartt Detroit jacket → eBay first, Depop second',
          "Women's Lululemon → Poshmark first, eBay second",
          'Nike Air Max 90s → StockX or GOAT first, eBay second',
          'Pendleton wool shirt → eBay only (older buyer, collector market)',
          'Y2K track pants → Depop only (younger buyer, style-driven)',
        ],
      },
      { type: 'heading', text: 'What FlipStart Recommends' },
      {
        type: 'body',
        text: "FlipStart's AI already factors platform fit into every scan result — the platform recommendation is based on category, brand, and era data from thousands of real sold listings. Use it as your starting point, then apply these rules to confirm.",
      },
    ],
  },
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function ArticleScreen() {
  const { id }  = useLocalSearchParams<{ id: string }>();
  const router  = useRouter();
  const insets  = useSafeAreaInsets();

  const article = ARTICLES[id ?? ''];

  if (!article) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <View style={s.header}>
          <Pressable onPress={() => router.back()} hitSlop={10} style={s.backBtn}>
            <MaterialIcons name="arrow-back" size={20} color={CREAM} />
          </Pressable>
          <Text style={s.headerTitle}>Guide</Text>
          <View style={{ width: 36 }} />
        </View>
        <View style={s.notFound}>
          <Text style={s.notFoundText}>Article not found.</Text>
        </View>
      </View>
    );
  }

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
        <Text style={s.headerTitle} numberOfLines={1}>FlipStart Guides</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero image */}
        <Image
          source={{ uri: article.imageUri }}
          style={s.heroImage}
          resizeMode="cover"
        />

        {/* Title block */}
        <View style={s.titleBlock}>
          <View style={s.guidePill}>
            <Text style={s.guidePillText}>✦ FLIPSTART GUIDE</Text>
          </View>
          <Text style={s.title}>{article.title}</Text>
          <Text style={s.subtitle}>{article.subtitle}</Text>
          <Text style={s.readTime}>{article.readTime}</Text>
        </View>

        {/* Divider */}
        <View style={s.hr} />

        {/* Body sections */}
        <View style={s.body}>
          {article.sections.map((section, i) => {
            if (section.type === 'heading') {
              return (
                <Text key={i} style={s.sectionHeading}>{section.text}</Text>
              );
            }
            if (section.type === 'body') {
              return (
                <Text key={i} style={s.bodyText}>{section.text}</Text>
              );
            }
            if (section.type === 'tip') {
              return (
                <View key={i} style={s.tipCard}>
                  <Text style={s.tipIcon}>💡</Text>
                  <Text style={s.tipText}>{section.text}</Text>
                </View>
              );
            }
            if (section.type === 'list') {
              return (
                <View key={i} style={s.list}>
                  {(section.items ?? []).map((item, j) => (
                    <View key={j} style={s.listItem}>
                      <View style={s.bullet} />
                      <Text style={s.listText}>{item}</Text>
                    </View>
                  ))}
                </View>
              );
            }
            return null;
          })}
        </View>

        {/* Footer */}
        <View style={s.footer}>
          <Text style={s.footerText}>✦ FlipStart · Thrift Intelligence ✦</Text>
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
    fontFamily: FONTS.serif, fontSize: 16, fontWeight: '700',
    color: CREAM, flex: 1, textAlign: 'center',
  },

  scroll: { flexGrow: 1 },

  heroImage: {
    width: '100%',
    height: 220,
  },

  titleBlock: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    gap: 8,
  },
  guidePill: {
    alignSelf: 'flex-start',
    backgroundColor: FOREST,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginBottom: 4,
  },
  guidePillText: {
    fontFamily: FONTS.serif, fontSize: 9, fontWeight: '700',
    color: GOLD, letterSpacing: 1.5,
  },
  title: {
    fontFamily: FONTS.serif, fontSize: 26, fontWeight: '800',
    color: BROWN, lineHeight: 32, letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 14, color: MUTED, lineHeight: 20,
  },
  readTime: {
    fontSize: 11, fontWeight: '600', color: GOLD, letterSpacing: 0.5,
  },

  hr: {
    height: 1, backgroundColor: CARD_B,
    marginHorizontal: 20, marginBottom: 8,
  },

  body: {
    paddingHorizontal: 20,
    paddingTop: 8,
    gap: 14,
  },

  sectionHeading: {
    fontFamily: FONTS.serif, fontSize: 18, fontWeight: '800',
    color: FOREST, marginTop: 8, letterSpacing: -0.2,
  },
  bodyText: {
    fontSize: 15, color: BROWN, lineHeight: 24,
  },

  tipCard: {
    flexDirection: 'row',
    backgroundColor: FOREST + '12',
    borderLeftWidth: 3,
    borderLeftColor: GOLD,
    borderRadius: 8,
    padding: 14,
    gap: 10,
    alignItems: 'flex-start',
  },
  tipIcon: { fontSize: 18, marginTop: 1 },
  tipText: {
    flex: 1, fontSize: 14, color: BROWN, lineHeight: 22, fontStyle: 'italic',
  },

  list: { gap: 10 },
  listItem: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
  },
  bullet: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: GOLD, marginTop: 7, flexShrink: 0,
  },
  listText: {
    flex: 1, fontSize: 14, color: BROWN, lineHeight: 22,
  },

  footer: {
    alignItems: 'center',
    marginTop: 32,
    paddingVertical: 20,
    borderTopWidth: 1,
    borderTopColor: CARD_B,
    marginHorizontal: 20,
  },
  footerText: {
    fontFamily: FONTS.serif, fontSize: 11, color: MUTED, letterSpacing: 1,
  },

  notFound: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
  },
  notFoundText: {
    fontSize: 16, color: MUTED,
  },
});
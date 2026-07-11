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
const CARD   = '#FFFEFA';
const CARD_B = '#DDD2AC';
const BG     = '#FFFFFF';
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
  'brands-worth-money': {
    id: 'brands-worth-money',
    title: 'Brands Worth Real Money',
    subtitle: 'A category-by-category field guide to the labels that actually sell — and the specific pieces to grab.',
    imageUri: 'https://images.unsplash.com/photo-1441984904996-e0b6ba687e04?w=800&q=80',
    readTime: '8 min read',
    sections: [
      {
        type: 'body',
        text: "Most racks are noise. The skill is knowing, before you even touch a hanger, which labels are worth pulling. This guide breaks the money brands down by category — because a brand that prints in denim can be worthless in activewear, and vice versa. Prices below are honest ranges, not promises: era, condition, and size swing everything.",
      },

      { type: 'heading', text: 'Denim' },
      {
        type: 'list',
        items: [
          "Levi's — the king. Vintage 501s are the grail: look for single-stitch back pockets, care tags with lowercase 'e' (pre-1971 Big E is a jackpot), selvedge/redline edges inside the outseam, and Made in USA. Rough range: $30–$150+, with true vintage far higher.",
          "Wrangler & Lee — vintage western pieces (sherpa denim jackets, Lee 101 rider jackets, sanforized tags) sell steadily. $25–$90.",
          "Carhartt — double-knee work pants, older square-label pieces, and anything heavily faded but intact. Distressing helps, holes in the wrong places don't. $25–$80.",
          "True Religion, Ed Hardy-era premium denim — the Y2K comeback is real. Big-stitch True Religions in good condition: $30–$80.",
          "AGOLDE, Citizens of Humanity, 7 For All Mankind, Frame — modern women's premium denim. Quieter money but constant demand: $25–$60.",
        ],
      },
      { type: 'tip', text: "Denim rule of thumb: check the back pocket stitching and the care tag before anything else. Ten seconds tells you the era." },

      { type: 'heading', text: 'Sportswear & Outdoor' },
      {
        type: 'list',
        items: [
          'Patagonia — Snap-T fleeces, Retro-X, Synchilla, older Made in USA tags. One of the most reliable flips in thrifting: $30–$90.',
          "The North Face — Denali fleeces, Nuptse puffers, vintage brown-label pieces. $25–$120 depending on line and era.",
          'Nike — vintage gray/orange tags, ACG line, embroidered center-swoosh crewnecks and hoodies. Modern basics are thin margins; vintage is where the money is. $20–$100+.',
          'Champion Reverse Weave — the thick side-gusset sweatshirts, especially older tags and collegiate prints. $20–$70.',
          'Adidas vintage trefoil, Starter jackets, and vintage team apparel (satin bombers, 90s NFL/NBA/MLB) — era sells: $25–$120.',
          'Lululemon — the highest sell-through in modern activewear. Align leggings, Scuba hoodies, ABC pants. Check for pilling and holes at seams: $20–$60.',
        ],
      },

      { type: 'heading', text: 'Workwear & Heritage' },
      {
        type: 'list',
        items: [
          'Filson — waxed jackets, Mackinaw wool. Rare in thrifts, but a single find can pay for the month: $80–$300+.',
          'Pendleton — wool board shirts and blankets. Check for moth holes against light: $25–$90.',
          'Woolrich, LL Bean (boots, chamois shirts, older tags), Orvis — steady heritage demand: $20–$70.',
          'Dickies vintage (Made in USA tags) and coveralls — workwear collectors pay for age: $20–$60.',
        ],
      },

      { type: 'heading', text: 'Streetwear & Tees' },
      {
        type: 'list',
        items: [
          "Vintage band, movie, and promo tees — single-stitch construction and faded prints are the tell. This is the highest-ceiling category in thrifting: $30 to genuinely hundreds.",
          'Harley-Davidson — vintage 3D Emblem and dealer-back tees are serious money: $40–$200+.',
          'Stüssy, Supreme, BAPE, Palace — verify authenticity carefully (see our fakes guide), but real pieces move fast: $30–$150+.',
          'Y2K mall brands are back: Ed Hardy, Affliction, Von Dutch, JNCO. Condition matters less than attitude: $20–$80.',
        ],
      },

      { type: 'heading', text: 'Designer & Bags' },
      {
        type: 'list',
        items: [
          'Coach — vintage glove-tanned leather (saddle bags, Court, Willis) with brass hardware and creed patches. Restorable leather is fine; peeling coated canvas is not. $40–$150.',
          'Ralph Lauren — Polo Bear anything, Polo Sport, RRL, hand-knit sweaters, and heavy flannels: $25–$150+.',
          'Dooney & Bourke all-weather leather, vintage Tommy Hilfiger flag pieces, Burberry nova check (authenticate!): $30–$120.',
        ],
      },

      { type: 'tip', text: "When you find one strong brand at a store, slow down. Donations arrive in batches from the same closet — the rest of that wardrobe is probably on the rack around you." },
      {
        type: 'body',
        text: "Scan anything you're unsure about. FlipStart's job is to catch the sleeper brands you don't recognize yet — and every scan teaches you the next label to pull on sight.",
      },
    ],
  },

  'thrifting-locations': {
    id: 'thrifting-locations',
    title: 'Where to Thrift: Every Store Type, Ranked',
    subtitle: 'Goodwill bins to estate sales — what each source is actually good for, what it costs, and how to work it.',
    imageUri: 'https://images.unsplash.com/photo-1567401893414-76b7b1e5a7a5?w=800&q=80',
    readTime: '7 min read',
    sections: [
      {
        type: 'body',
        text: "Not all thrifting is the same game. The bins reward stamina, estate sales reward speed, and regular thrifts reward consistency. Here's the honest breakdown of every major source — costs vary by region, so treat prices as ballparks.",
      },

      { type: 'heading', text: 'Goodwill Outlet ("The Bins")' },
      {
        type: 'body',
        text: "The final stop before salvage. Unsorted merchandise in giant rolling bins, sold by the pound — commonly somewhere around $1–$2/lb for clothing, varying by location. This is the highest profit ceiling in thrifting because nothing has been cherry-picked or priced by brand.",
      },
      {
        type: 'list',
        items: [
          'Bring gloves. Seriously. Bins are rough on hands.',
          'Learn the bin rotation schedule — regulars know when fresh bins roll out and line up for them.',
          'Feel for fabric first, look second: heavyweight cotton, wool, and real leather announce themselves by touch.',
          'Weight math matters: a wool coat at $2/lb might cost $6; a jersey tee costs cents.',
        ],
      },
      { type: 'tip', text: 'The bins are a volume game. Go with a scale of what you can list, not what you can carry.' },

      { type: 'heading', text: 'Regular Goodwill' },
      {
        type: 'list',
        items: [
          'Sorted and sized racks — the fastest hunting per hour.',
          'Color-tag discount rotations (a different tag color goes half-off each week at many regions).',
          "Prices have climbed in recent years, and some stores pull recognizable brands for their online auction site — you're hunting what the sorters missed.",
          'Restock happens continuously through the day, not just mornings. Ask staff when carts usually roll out.',
        ],
      },

      { type: 'heading', text: 'Salvation Army' },
      {
        type: 'list',
        items: [
          'Often older donor bases = more true vintage on the racks.',
          'Many locations run famous weekly half-off days (Wednesdays are common — confirm locally).',
          'Pricing is less brand-aware than Goodwill on average, which is exactly what you want.',
        ],
      },

      { type: 'heading', text: 'Savers / Value Village' },
      {
        type: 'list',
        items: [
          'Massive, well-organized inventory — great for long focused sessions.',
          'Higher baseline prices than Goodwill/Salvation Army, offset by sheer volume.',
          'Loyalty club coupons and sale days meaningfully change the math — sign up.',
        ],
      },

      { type: 'heading', text: 'The Sleepers: Church Shops, St. Vincent de Paul, Hospice Stores' },
      {
        type: 'body',
        text: "Small charity shops are the most underpriced rooms in America. Volunteer-priced, older donors, and almost zero brand awareness. Inventory is thin, so make them quick stops on a route rather than destinations.",
      },

      { type: 'heading', text: 'Estate Sales, Garage Sales & Flea Markets' },
      {
        type: 'list',
        items: [
          'Estate sales: the best source of untouched vintage. Day one has the goods at full price; the final day is often 50%+ off whatever survived.',
          'Garage sales: everything is negotiable, and bundling ("what for all five?") wins.',
          'Flea markets: build relationships — vendors save things for buyers they know.',
        ],
      },

      { type: 'heading', text: 'Route Strategy' },
      {
        type: 'list',
        items: [
          'Stores pull from nearby donations: locations bordering wealthy zip codes get wealthier closets.',
          'Consistency beats luck. A mediocre store visited twice a week outperforms a great store visited monthly.',
          'Track your own data: after a month of scans, your FlipStart history tells you which stores actually pay you.',
        ],
      },
      { type: 'tip', text: 'Build a 3–4 store loop you can run in two hours, anchored by your best bins or cheapest charity shop. Volume of good looks is everything.' },
    ],
  },

  'fake-vs-real': {
    id: 'fake-vs-real',
    title: 'Fake vs. Real: Authentication Basics',
    subtitle: "How to spot counterfeits before you buy them — and protect yourself when you're not sure.",
    imageUri: 'https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=800&q=80',
    readTime: '7 min read',
    sections: [
      {
        type: 'body',
        text: "Fakes are everywhere in the secondhand stream — some donated unknowingly, some laundered on purpose. Selling a counterfeit, even accidentally, can get your marketplace account suspended and is illegal. Here's how to filter most fakes with your eyes and hands, and what to do when you're not certain.",
      },

      { type: 'heading', text: 'The Universal Tells (Any Brand)' },
      {
        type: 'list',
        items: [
          'Stitching: real luxury and premium goods have straight, even, dense stitches. Wandering lines, loose threads, and inconsistent stitch length are the #1 giveaway.',
          'Hardware: authentic zippers and buckles are heavy, engraved cleanly, and operate smoothly. Fakes feel light, painted, gritty.',
          'Tags & fonts: counterfeiters get typography wrong constantly — spacing, letter thickness, blurry printing, misspellings. Compare against verified photos online.',
          'Consistency: does the country of origin on the tag match what that brand actually produced in that era? A "Made in France" bag with a plastic-smelling lining is answering its own question.',
          'Smell: strong chemical/glue odor is a red flag on leather goods.',
          'The price test: a $900 bag priced at $8 happens. A rack with FIVE of them does not.',
        ],
      },

      { type: 'heading', text: 'Brand-Specific Quick Checks' },
      {
        type: 'list',
        items: [
          'Nike: the size tag has a style/SKU code — on shoes it should match the box, and its format should match the era. Sloppy swoosh stitching and wrong-font sizing tags expose most fakes.',
          'Louis Vuitton: older pieces carry date codes (letters + numbers tied to factory and date — formats changed by era; post-2021 moved to chips). Monogram placement is deliberately symmetric on many styles; heat stamps are crisp, never blobby.',
          'Coach: vintage bags carry a creed patch with a serial number; leather should smell like leather, hardware is heavy brass, and vintage zippers are typically quality makes like YKK.',
          'Burberry: the nova check pattern aligns at seams on real pieces. Misaligned plaid at every seam is a fake screaming at you.',
          'Supreme & streetwear: box logo details (stitch density, letter spacing) are heavily documented online — always compare against legit-check photo guides before paying streetwear prices.',
          "Vintage Levi's: here authentication is really era-dating — single-stitch details, care tag formats, and selvedge tell you WHEN it was made, which is what the value hangs on.",
        ],
      },

      { type: 'heading', text: 'When You\'re Not Sure' },
      {
        type: 'list',
        items: [
          'Photograph the tags, serials, hardware, and stitching and compare against verified examples (brand archives, legit-check communities, sold listings from reputable sellers).',
          "Use marketplace protection: eBay's Authenticity Guarantee covers eligible sneakers, watches, and handbags over certain prices — route high-value items through platforms that verify.",
          "Price in the doubt: if you can't authenticate it, you can't sell it as authentic. Either buy cheap enough that it's worth it as-is, or walk.",
        ],
      },
      { type: 'tip', text: 'The reseller\'s rule: when in doubt, leave it out. One suspended account costs more than a hundred passed-up bags.' },
      {
        type: 'body',
        text: 'Never list an item you know or suspect is counterfeit — "replica" disclaimers don\'t make it legal. Your reputation is the actual asset you\'re building.',
      },
    ],
  },

  'resale-platforms': {
    id: 'resale-platforms',
    title: 'Where to Sell: Platform Playbook',
    subtitle: 'eBay, Depop, Poshmark, Mercari, Grailed, Vinted, and local — matched to what you\'re actually selling.',
    imageUri: 'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=800&q=80',
    readTime: '8 min read',
    sections: [
      {
        type: 'body',
        text: "The same jacket can sit for months on one platform and sell overnight on another. Fees and policies shift often, so always check current rates — but the audiences below are stable, and matching item to audience is most of the game.",
      },

      { type: 'heading', text: 'eBay — The Everything Engine' },
      {
        type: 'list',
        items: [
          'Best for: vintage, menswear, band tees, workwear, electronics, anything collectors search for by name.',
          'The biggest search demand in resale — obscure items find their buyer here.',
          'Fees: roughly low-teens percent for most clothing categories (varies — check current).',
          'Authenticity Guarantee on eligible sneakers/handbags/watches builds buyer trust on big-ticket flips.',
          'Learn: keyword-rich titles, sold-comps research, and offering Best Offer.',
        ],
      },

      { type: 'heading', text: 'Depop — Trend Culture' },
      {
        type: 'list',
        items: [
          'Best for: Y2K, vintage streetwear, trend pieces, anything that photographs with attitude.',
          'Young, style-driven buyers who shop the vibe — styled photos outsell flat lays here.',
          'Fee structure changed in recent years (US selling fees were dropped in favor of buyer-side fees) — verify current terms.',
          'Refresh listings and use hashtags; the feed rewards activity.',
        ],
      },

      { type: 'heading', text: 'Poshmark — Women\'s Closet Culture' },
      {
        type: 'list',
        items: [
          "Best for: women's contemporary fashion, premium denim, boutique brands, bags.",
          'Simple flat-rate shipping label system — genuinely the easiest shipping in resale.',
          'Fees: historically a flat fee under ~$15 and ~20% above (check current).',
          'Sharing listings and joining "parties" is how the algorithm feeds you buyers.',
        ],
      },

      { type: 'heading', text: 'Mercari — The Simple General Store' },
      {
        type: 'list',
        items: [
          'Best for: everything general — household, toys, mid-tier clothing, quick flips.',
          'Fast to list, less social upkeep than Poshmark/Depop.',
          'Fee structure has changed multiple times recently — confirm the current split before pricing.',
        ],
      },

      { type: 'heading', text: 'Grailed — Menswear & Streetwear' },
      {
        type: 'list',
        items: [
          'Best for: designer menswear, streetwear, archive pieces, quality denim and boots.',
          'Knowledgeable buyers who pay real prices for the right pieces — and lowball everything else. Negotiation is the culture.',
          'Commission plus payment processing, typically around 10% combined (verify current).',
        ],
      },

      { type: 'heading', text: 'Vinted & Facebook Marketplace' },
      {
        type: 'list',
        items: [
          'Vinted: no seller fees (buyers pay protection fees) — strongest in Europe, growing in the US. Great for volume clothing at lower price points.',
          'Facebook Marketplace: local, cash, zero shipping — the right answer for bulky items, furniture, and lots/bundles.',
        ],
      },

      { type: 'heading', text: 'The Matching Cheat Sheet' },
      {
        type: 'list',
        items: [
          'Vintage tee or workwear → eBay first, Depop second.',
          "Women's premium denim or boutique → Poshmark first, Depop second.",
          'Streetwear or menswear designer → Grailed first, eBay second.',
          'Trend/Y2K piece → Depop first.',
          'Under-$15 basics in volume → Vinted or Mercari.',
          'Anything heavy or awkward to ship → Facebook Marketplace.',
        ],
      },
      { type: 'tip', text: 'Cross-list your best items on 2–3 platforms and delist everywhere the moment one sells. FlipStart\'s generated listings give you the copy for both eBay and Depop in one tap.' },
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
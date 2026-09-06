/**
 * components/onboarding/ValueTeasers.tsx
 *
 * The three compact product visuals for the value screens. Same shell as the
 * questions, same tokens, one restrained card each. Every number on them is
 * illustrative and every card says so — this is a new user who has scanned
 * nothing, and an unlabelled figure would be a claim about a find that does
 * not exist.
 *
 * ── Product truth, checked against the shipped screens ──────────────────────
 *   Money:        Your Price / Est. Resale / Buy Under / Est. Profit are the
 *                 result and Deep Analysis screens' own labels. Never "Max Buy"
 *                 — results.tsx documents that name as the bug it removed.
 *   Intelligence: Brand / Era / Est. Resale / Confidence / Risk are real
 *                 scan-output fields; uncertainty is a first-class output and
 *                 the card says so in words. Deep Analysis is labelled PRO.
 *   Gamification: XP is awarded ONLY at Hunt completion (calculateHuntXp), so
 *                 the XP line is headed HUNT COMPLETE; 23 ranks, 40
 *                 achievements, 83 Diamonds and the Brand Compendium are the
 *                 real counts from lib/. No leaderboard, no per-scan XP.
 */
import React, { useEffect, useState } from "react";
import {
  AccessibilityInfo, ScrollView, StyleSheet, Text, View,
  type StyleProp, type TextStyle,
} from "react-native";
import Animated, {
  useAnimatedStyle, useSharedValue, withTiming, withDelay, Easing,
} from "react-native-reanimated";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import Svg, { Path } from "react-native-svg";
import { FONTS } from "@/constants/typography";
import { PW, PW_RADIUS, PW_SHADOW } from "@/components/monetization/paywall/paywallTheme";
import { RANK_LADDER, getCurrentRank, getNextRank } from "@/lib/huntXp";
import { CATEGORY_META, DIAMONDS, TOTAL_DIAMONDS } from "@/lib/diamonds";
import { ALL_BRANDS, RARITY_COLORS, RARITY_LABELS, TOTAL_SUPPORTED_BRANDS } from "@/lib/brandCompendium";
import { ACHIEVEMENT_CATEGORIES } from "@/lib/achievements";

/** Real counts, read from the systems themselves — never typed by hand here. */
export const RANK_COUNT = RANK_LADDER.length;

/**
 * The three showcase examples, LOOKED UP rather than transcribed.
 *
 * Each falls back to the first entry in its list if the id ever disappears, so
 * renaming a definition changes what onboarding shows — it never leaves a
 * stale hand-typed name behind, and it cannot crash the screen.
 */
const HUNT_CATEGORY = ACHIEVEMENT_CATEGORIES.find(c => c.id === "hunt") ?? ACHIEVEMENT_CATEGORIES[0];
const HUNT_FIRST = HUNT_CATEGORY.achievements.find(a => a.id === "hunt_1") ?? HUNT_CATEGORY.achievements[0];
export const SAMPLE_ACHIEVEMENT = {
  name: HUNT_FIRST.name,
  flavor: HUNT_FIRST.flavor,
  requirement: HUNT_FIRST.requirement,
  icon: HUNT_CATEGORY.icon,
  accent: HUNT_CATEGORY.iconColor,
};

const DIAMOND_DEF = DIAMONDS.find(d => d.id === "vintage_levis_jacket") ?? DIAMONDS[0];
export const SAMPLE_DIAMOND = {
  title: DIAMOND_DEF.title,
  badge: DIAMOND_DEF.badge,
  flavorLine: DIAMOND_DEF.flavorLine,
  accent: CATEGORY_META[DIAMOND_DEF.category].accent,
};

const BRAND_DEF = ALL_BRANDS.find(b => b.name === "Patagonia") ?? ALL_BRANDS[0];
export const SAMPLE_BRAND = {
  name: BRAND_DEF.name,
  rarityLabel: RARITY_LABELS[BRAND_DEF.rarity],
  accent: RARITY_COLORS[BRAND_DEF.rarity],
};
export const ACHIEVEMENT_COUNT = ACHIEVEMENT_CATEGORIES.reduce((n, c) => n + c.achievements.length, 0);

// ── Shared card chrome ──────────────────────────────────────────────────────

function SampleTag({ text }: { text: string }) {
  return (
    <View style={c.sampleTag}>
      <Text style={c.sampleTagText} allowFontScaling={false}>{text}</Text>
    </View>
  );
}

function Card({ children, gold = false }: { children: React.ReactNode; gold?: boolean }) {
  return (
    <View style={[c.card, gold && c.cardGold]}>
      <View pointerEvents="none" style={c.innerRule} />
      {children}
    </View>
  );
}

// ── Screen 6: the decision card ─────────────────────────────────────────────

/**
 * A resale range.
 *
 * The en dash is a LITERAL character in the source, not a \u escape. JSX
 * attribute values and JSX text are not JavaScript string literals — an escape
 * written there is not processed, and the user sees the six characters of the
 * escape instead of the dash. That is exactly the bug this screen shipped
 * with. One component now owns the separator so it cannot come back.
 */
export function ResaleRange({ low, high, style }: {
  low: string; high: string; style?: StyleProp<TextStyle>;
}) {
  return (
    <Text
      style={style}
      numberOfLines={1}
      adjustsFontSizeToFit
      minimumFontScale={0.7}
      accessibilityLabel={`Estimated resale ${low} to ${high}`}
    >
      {low}
      <Text style={mn.rangeDash}>{EN_DASH}</Text>
      {high}
    </Text>
  );
}

/** A real U+2013, held once. */
const EN_DASH = "–";

/**
 * The money screen's product proof: a decision, not a spreadsheet.
 *
 * ── Hierarchy, because four equal boxes answered nothing ────────────────────
 * The old card gave YOUR PRICE, EST. RESALE, BUY UNDER and EST. PROFIT the
 * same weight in a 2×2 grid, so the eye had to read all four to learn
 * anything. The order of the questions a reseller actually asks is:
 *
 *   1. What could this sell for?   → EST. RESALE, the headline
 *   2. What may I pay?             → BUY UNDER, the limit, in red
 *   3. What does that leave?       → YOUR PRICE and EST. PROFIT, the footing
 *
 * ── Red is a boundary, not an error ─────────────────────────────────────────
 * BUY UNDER is a ceiling on spending, so it must not read as a gain. It uses a
 * muted brick red (7.9:1 on card white) that is deliberately NOT the theme's
 * error colour — this is a limit, not a failure — and the meaning is also in
 * the words ("stay under") and the accessibility label, never colour alone.
 *
 * ── Sample, and said so ─────────────────────────────────────────────────────
 * The whole card is stamped SAMPLE FIND. A new user has scanned nothing; an
 * unlabelled number here would be a claim about a find that does not exist.
 */
export function MoneyTeaser() {
  return (
    <View style={mn.stack}>
      <View style={mn.card}>
        <View pointerEvents="none" style={c.innerRule} />

        {/* The find. */}
        <View style={mn.head}>
          <View style={mn.itemRow}>
            <View style={mn.itemSeal}>
              <MaterialIcons name="checkroom" size={15} color={PW.forest} />
            </View>
            <Text style={mn.item} numberOfLines={1}>Vintage fleece jacket</Text>
          </View>
          <SampleTag text="SAMPLE FIND" />
        </View>

        {/* 1. The opportunity. */}
        <View style={mn.heroBlock}>
          <Text style={mn.heroLabel} allowFontScaling={false}>EST. RESALE</Text>
          <ResaleRange low="$45" high="$60" style={mn.heroValue} />
        </View>

        <View style={mn.rule} />

        {/* 2. The limit. */}
        <View style={mn.limitRow}>
          <View style={mn.limitText}>
            <Text style={mn.limitLabel} allowFontScaling={false}>BUY UNDER</Text>
            <Text style={mn.limitHint}>Stay under this to keep the flip worth it</Text>
          </View>
          <Text
            style={mn.limitValue}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
            accessibilityLabel="Buy under $21 — a spending limit, not a target"
          >
            $21
          </Text>
        </View>

        {/* 3. The footing. */}
        <View style={mn.footRow}>
          <Foot label="YOUR PRICE" value="$12" />
          <View style={mn.footDivider} />
          <Foot label="EST. PROFIT" value="+$28" positive />
        </View>
      </View>

      {/* Supporting cues — three, not a dashboard. */}
      <View style={mn.cues}>
        <Cue icon="receipt-long" label="SOLD COMPS" value="Market-backed" />
        <Cue icon="trending-up" label="DEMAND" value="Strong" />
        <Cue icon="speed" label="SELL SPEED" value="Fast" />
      </View>

      <Text style={c.caption}>
        Estimates from sold-listing data, not a promise. Comps aren’t available for every item.
      </Text>
    </View>
  );
}

/** One of the two footing figures. Equal columns so neither shifts with its text. */
function Foot({ label, value, positive = false }: { label: string; value: string; positive?: boolean }) {
  return (
    <View style={mn.foot}>
      <Text style={mn.footLabel} allowFontScaling={false}>{label}</Text>
      <Text
        style={[mn.footValue, positive && mn.footPositive]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.75}
      >
        {value}
      </Text>
    </View>
  );
}

/** A supporting signal. Fixed thirds, so the row never re-flows around its text. */
function Cue({ icon, label, value }: {
  icon: React.ComponentProps<typeof MaterialIcons>["name"]; label: string; value: string;
}) {
  return (
    <View style={mn.cue}>
      <MaterialIcons name={icon} size={15} color={PW.forest} />
      <Text style={mn.cueLabel} allowFontScaling={false} numberOfLines={1}>{label}</Text>
      <Text style={mn.cueValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{value}</Text>
    </View>
  );
}

// ── Screen 7: the identity dossier ──────────────────────────────────────────

/**
 * Deliberately NOT the money screen's shape.
 *
 * Money is a ledger: figures in columns, one decision. This is a dossier: an
 * item being identified, then measured. It reads top-down as understanding
 * accumulating — a scan frame and what it found, then the estimate that
 * follows from it, then two meters showing how sure FlipStart is and what to
 * check. Bars rather than boxes, left-aligned rather than gridded.
 *
 * ── Uncertainty is the feature ──────────────────────────────────────────────
 * MATCH CONFIDENCE is shown as a partial bar, not a tick: 86% looks like 86%.
 * RISK reads "Low" in a calm neutral pill rather than a warning colour, because
 * low risk is not an error state. Nothing here says verified, guaranteed or
 * authentic — the closing line says plainly that this is what to verify.
 */
export function IntelligenceTeaser() {
  return (
    <View style={mn.stack}>
      <View style={mn.card}>
        <View pointerEvents="none" style={c.innerRule} />

        <View style={mn.head}>
          <Text style={c.kicker} allowFontScaling={false}>WHAT THE SCAN FOUND</Text>
          <SampleTag text="SAMPLE ANALYSIS" />
        </View>

        {/* Identity first: the frame, and what it resolved to. */}
        <View style={it.identity}>
          <View style={it.frame}>
            <ScanFrame />
            <MaterialIcons name="checkroom" size={30} color={PW.forest} style={{ opacity: 0.55 }} />
          </View>
          <View style={it.idText}>
            <Text style={it.brandLabel} allowFontScaling={false}>BRAND</Text>
            <Text style={it.brand} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>Patagonia</Text>
            <Text style={it.desc} numberOfLines={1}>Vintage fleece jacket</Text>
            <View style={it.eraRow}>
              <Text style={it.eraLabel} allowFontScaling={false}>ERA</Text>
              <Text style={it.era}>1990s</Text>
            </View>
          </View>
        </View>

        <View style={mn.rule} />

        {/* The estimate that follows from the identity. */}
        <View style={it.estimateRow}>
          <Text style={it.estimateLabel} allowFontScaling={false}>EST. RESALE</Text>
          <ResaleRange low="$55" high="$75" style={it.estimateValue} />
        </View>

        {/* How sure, and what to check. */}
        <View style={it.meters}>
          <View style={it.meter}>
            <View style={it.meterHead}>
              <Text style={it.meterLabel} allowFontScaling={false}>MATCH CONFIDENCE</Text>
              <Text style={it.meterValue} allowFontScaling={false}>86%</Text>
            </View>
            <View
              style={it.track}
              accessibilityRole="progressbar"
              accessibilityLabel="Match confidence 86 percent"
              accessibilityValue={{ min: 0, max: 100, now: 86 }}
            >
              <View style={it.fill} />
            </View>
          </View>

          <View style={it.riskRow}>
            <Text style={it.meterLabel} allowFontScaling={false}>RISK</Text>
            <View style={it.riskPill}>
              {/* A neutral level dot, not a shield or a tick: a verification
                  mark beside "Risk" would imply FlipStart checked authenticity,
                  which it does not do. */}
              <View style={it.riskDot} />
              <Text style={it.riskText} allowFontScaling={false}>Low</Text>
            </View>
          </View>
        </View>
      </View>

      <Text style={c.caption}>
        Confidence, evidence and risk show what FlipStart found — and what’s worth verifying yourself.
      </Text>

      {/* The Pro tease: compact, not a second paywall. */}
      <View style={it.deep}>
        <View style={it.deepHead}>
          <Text style={it.deepKicker} allowFontScaling={false}>GO DEEPER WITH PRO</Text>
          <ProSeal />
        </View>
        <Text style={it.deepTitle}>Deep Analysis</Text>
        <View style={it.deepList}>
          {["Confidence breakdown", "Evidence", "Pricing logic", "Risk flags"].map(t => (
            <View key={t} style={it.deepChip}>
              <Text style={it.deepChipText} allowFontScaling={false} numberOfLines={1}>{t}</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

/** Four corner ticks — the camera's own framing mark, drawn not photographed. */
function ScanFrame() {
  const S = 9, L = 1.4, O = 4;
  const corner = (x: number, y: number, sx: number, sy: number) =>
    `M ${x} ${y + sy * S} L ${x} ${y} L ${x + sx * S} ${y}`;
  return (
    <Svg width="100%" height="100%" style={StyleSheet.absoluteFill} pointerEvents="none">
      <Path d={corner(O, O, 1, 1)} stroke={PW.gold} strokeWidth={L} fill="none" />
      <Path d={corner(72 - O, O, -1, 1)} stroke={PW.gold} strokeWidth={L} fill="none" />
      <Path d={corner(O, 72 - O, 1, -1)} stroke={PW.gold} strokeWidth={L} fill="none" />
      <Path d={corner(72 - O, 72 - O, -1, -1)} stroke={PW.gold} strokeWidth={L} fill="none" />
    </Svg>
  );
}

/**
 * The small PRO seal, shared with the profile result.
 *
 * Brown ink on the gold wash: gold on gold measures about 1.3:1 and vanishes.
 */
export function ProSeal() {
  return (
    <View style={c.proSeal}>
      <Text style={c.proSealText} allowFontScaling={false}>PRO</Text>
    </View>
  );
}

// ── Screen 8: progression ───────────────────────────────────────────────────

/**
 * A sample profile mid-ladder, so the bar has somewhere to travel.
 *
 * Every number is run through the REAL ladder: 465 XP resolves to its rank and
 * next rank through getCurrentRank/getNextRank, and the two bar positions are
 * the true fractions between those thresholds. Change RANK_LADDER and this
 * screen follows it. Nothing here is a hand-typed rank name.
 */
const SAMPLE_XP_BEFORE = 340;
const SAMPLE_XP_GAIN = 125;
const SAMPLE_XP_AFTER = SAMPLE_XP_BEFORE + SAMPLE_XP_GAIN;

function rankFraction(xp: number): number {
  const cur = getCurrentRank(xp);
  const next = getNextRank(xp);
  if (!next) return 1;
  return Math.max(0, Math.min(1, (xp - cur.xp) / (next.xp - cur.xp)));
}

/** The bar fills over ~1s on entry, once. Reduce Motion lands on the end state. */
const XP_FILL_MS = 1000;
const XP_FILL_DELAY_MS = 260;

/**
 * Screen 8 in three layers: the hunt payoff, what it unlocks, one line of
 * explanation.
 *
 * ── XP comes from HUNTS ─────────────────────────────────────────────────────
 * calculateHuntXp runs at hunt completion and nowhere else, so the hero is
 * headed HUNT COMPLETE, the figure is captioned "for completing a Hunt", and
 * the caption says it again. A scan on its own earns nothing and this screen
 * must never suggest otherwise.
 *
 * ── Real examples, no invented artwork ──────────────────────────────────────
 * The achievement, Diamond and brand below are real definitions pulled from
 * the product: `hunt_1` from ACHIEVEMENT_CATEGORIES, a prestige-3 Diamond from
 * DIAMONDS with its own category accent, and a real brand from ALL_BRANDS with
 * its true rarity colour. Diamonds have no bundled art — their image is the
 * user's own scan photo, captured at discovery — so the showcase uses the
 * product's existing card language rather than inventing pictures, and never a
 * remote logo URL.
 *
 * ── No streaks ──────────────────────────────────────────────────────────────
 * Hunt Streaks are deliberately absent. The streak achievement category still
 * exists in the product and is untouched; it is simply not sold here.
 */
export function GamificationTeaser() {
  const beforePct = rankFraction(SAMPLE_XP_BEFORE);
  const afterPct = rankFraction(SAMPLE_XP_AFTER);
  const rank = getCurrentRank(SAMPLE_XP_AFTER);
  const next = getNextRank(SAMPLE_XP_AFTER);

  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
  }, []);

  const fill = useSharedValue(beforePct);
  useEffect(() => {
    if (reduceMotion) { fill.value = afterPct; return; }
    fill.value = beforePct;
    fill.value = withDelay(XP_FILL_DELAY_MS,
      withTiming(afterPct, { duration: XP_FILL_MS, easing: Easing.out(Easing.cubic) }));
  }, [reduceMotion, beforePct, afterPct, fill]);
  const barStyle = useAnimatedStyle(() => ({ width: `${fill.value * 100}%` }));

  return (
    <View style={g.stack}>
      {/* ── A. The hunt payoff ───────────────────────────────────────── */}
      <View style={[mn.card, g.hero]}>
        <View pointerEvents="none" style={c.innerRule} />

        <View style={mn.head}>
          <Text style={c.kicker} allowFontScaling={false}>HUNT COMPLETE</Text>
          <SampleTag text="SAMPLE HUNT" />
        </View>

        <View style={g.xpRow}>
          <Text style={g.xp} allowFontScaling={false}>+{SAMPLE_XP_GAIN} XP</Text>
          <Text style={g.xpFrom}>for completing a Hunt</Text>
        </View>

        <View style={g.rankBlock}>
          <View style={g.rankRow}>
            <Text style={g.rankNow} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
              {rank.rank}
            </Text>
            {!!next && (
              <Text style={g.rankNext} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
                next: {next.rank}
              </Text>
            )}
          </View>
          <View
            style={g.track}
            accessibilityRole="progressbar"
            accessibilityLabel={`Rank progress, ${rank.rank}${next ? `, next rank ${next.rank}` : ""}`}
            accessibilityValue={{ min: 0, max: 100, now: Math.round(afterPct * 100) }}
          >
            <Animated.View style={[g.fill, barStyle]} />
          </View>
        </View>
      </View>

      {/* ── B. What it unlocks ───────────────────────────────────────── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={g.showcase}
        /* Peeks the next card so it is obvious more exists, and never traps
           the vertical scroll or gates Continue behind an interaction. */
        decelerationRate="fast"
        snapToInterval={UNLOCK_W + UNLOCK_GAP}
        snapToAlignment="start"
      >
        <UnlockCard
          kicker="ACHIEVEMENT UNLOCKED"
          icon={SAMPLE_ACHIEVEMENT.icon as any}
          accent={SAMPLE_ACHIEVEMENT.accent}
          title={SAMPLE_ACHIEVEMENT.name}
          meta={SAMPLE_ACHIEVEMENT.flavor}
          body={SAMPLE_ACHIEVEMENT.requirement}
          footer={`${ACHIEVEMENT_COUNT} achievements to earn`}
        />
        <UnlockCard
          kicker="DIAMOND DISCOVERED"
          icon="auto-awesome"
          accent={SAMPLE_DIAMOND.accent}
          title={SAMPLE_DIAMOND.title}
          meta={SAMPLE_DIAMOND.badge}
          body={SAMPLE_DIAMOND.flavorLine}
          footer={`${TOTAL_DIAMONDS} Diamonds in the Rough`}
        />
        <UnlockCard
          kicker="NEW BRAND DISCOVERED"
          icon="local-offer"
          accent={SAMPLE_BRAND.accent}
          title={SAMPLE_BRAND.name}
          meta={SAMPLE_BRAND.rarityLabel}
          body="Added to your Brand Compendium the first time you find it."
          footer={`${TOTAL_SUPPORTED_BRANDS} brands to collect`}
        />
      </ScrollView>

      {/* ── C. One line ──────────────────────────────────────────────── */}
      <Text style={c.caption}>
        {RANK_COUNT} ranks, earned by completing Hunts — plus achievements, Diamonds and brand
        discoveries that build up as you thrift.
      </Text>
    </View>
  );
}

/**
 * Wide enough for a real title at a real size.
 *
 * At 232 the title had to sit at 15.5pt and the supporting lines at 10–11pt to
 * fit, which read as microtype next to the rest of onboarding. 268 buys 36
 * more points of line length — enough for a 19pt title and a 14.5pt
 * description — while still leaving ~75pt of the next card showing on a normal
 * iPhone and ~57pt on an SE, so the swipe affordance survives.
 */
const UNLOCK_W = 268;
/** Space between cards; also the snap stride with UNLOCK_W. */
const UNLOCK_GAP = 10;

/**
 * One unlock preview. The accent is the REAL colour the product gives that
 * thing — the achievement category's, the Diamond category's, the brand
 * rarity's — so a user meets these cards here in the same colours they will
 * meet them in the app.
 */
/**
 * One unlock preview.
 *
 * ── Hierarchy ───────────────────────────────────────────────────────────────
 *   eyebrow  11pt tracked   — the event: ACHIEVEMENT UNLOCKED
 *   TITLE    19pt serif     — the thing itself, the loudest line on the card
 *   badge    12.5pt         — its category or tier, in the product's colour
 *   body     14.5pt         — what it means
 *   footer   13pt           — how many there are to collect
 *
 * The title is the only line allowed to dominate, and it is never shrunk to
 * fit: it wraps to as many as three lines instead. "Vintage Levi's Denim
 * Jacket" is a real Diamond name and it has to look like a name, not a
 * caption. Nothing here uses adjustsFontSizeToFit — that was how the old card
 * ended up rendering its titles smaller than their own descriptions.
 *
 * Title and body reserve two and three lines respectively, so the three cards
 * are the same height whatever their content, and the footer never drifts.
 */
function UnlockCard({ kicker, icon, accent, title, meta, body, footer }: {
  kicker: string; icon: React.ComponentProps<typeof MaterialIcons>["name"]; accent: string;
  title: string; meta: string; body: string; footer: string;
}) {
  return (
    <View style={g.unlock} accessibilityLabel={`${kicker}. ${title}. ${meta}. ${body}. ${footer}`}>
      <View style={[g.unlockBar, { backgroundColor: accent }]} />

      <View style={g.unlockHead}>
        <View style={[g.unlockSeal, { borderColor: accent }]}>
          <MaterialIcons name={icon} size={18} color={accent} />
        </View>
        <Text style={g.unlockKicker} numberOfLines={2}>{kicker}</Text>
      </View>

      <Text style={g.unlockTitle} numberOfLines={3} maxFontSizeMultiplier={1.2}>{title}</Text>

      <View style={[g.unlockMeta, { borderColor: accent }]}>
        <Text style={[g.unlockMetaText, { color: accent }]} numberOfLines={1}>{meta}</Text>
      </View>

      <Text style={g.unlockBody} numberOfLines={3} maxFontSizeMultiplier={1.2}>{body}</Text>

      <View style={g.unlockFooter}>
        <Text style={g.unlockFooterText} numberOfLines={2} maxFontSizeMultiplier={1.2}>{footer}</Text>
      </View>
    </View>
  );
}

/** Small gold spark used by the result card. */
export function GoldSpark({ size = 10 }: { size?: number }) {
  const h = size / 2;
  return (
    <Svg width={size} height={size}>
      <Path d={`M${h} 0 L${h * 1.19} ${h * 0.81} L${size} ${h} L${h * 1.19} ${h * 1.19} L${h} ${size} L${h * 0.81} ${h * 1.19} L0 ${h} L${h * 0.81} ${h * 0.81} Z`} fill={PW.gold} />
    </Svg>
  );
}

const c = StyleSheet.create({
  card: {
    backgroundColor: PW.card, borderRadius: PW_RADIUS.card,
    borderWidth: 1.25, borderColor: PW.border,
    paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12, gap: 10,
    overflow: "hidden", ...PW_SHADOW,
  },
  cardGold: { borderColor: PW.gold, borderWidth: 1.6 },
  innerRule: {
    position: "absolute", top: 3, left: 3, right: 3, bottom: 3,
    borderRadius: PW_RADIUS.card - 3, borderWidth: 1, borderColor: "rgba(196,163,52,0.40)",
  },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  kicker: { fontFamily: FONTS.serif, fontSize: 10, fontWeight: "800", letterSpacing: 1.8, color: PW.brown },
  sampleTag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 3, borderWidth: 0.9, borderColor: PW.gold, backgroundColor: PW.goldTint },
  sampleTagText: { fontFamily: FONTS.serif, fontSize: 7.5, fontWeight: "800", letterSpacing: 1, color: PW.brown },
  caption: { fontSize: 12, lineHeight: 16.5, color: PW.brown, fontWeight: "500" },
  proSeal: { paddingHorizontal: 6, paddingVertical: 1.5, borderRadius: 3, borderWidth: 0.9, borderColor: PW.gold, backgroundColor: PW.goldTint },
  proSealText: { fontFamily: FONTS.serif, fontSize: 7.5, fontWeight: "800", letterSpacing: 1, color: PW.forest },
});

/**
 * BUY UNDER's red.
 *
 * Local, and deliberately NOT PW.error: the theme reserves that for failures,
 * and a spending ceiling is not a failure. A muted brick red at 7.9:1 on card
 * white — restrained enough to sit beside forest without shouting, distinct
 * enough that it can never be mistaken for a gain.
 */
const LIMIT_RED = "#8E3222";

const mn = StyleSheet.create({
  stack: { gap: 10 },
  card: {
    backgroundColor: PW.card, borderRadius: PW_RADIUS.card,
    borderWidth: 1.25, borderColor: PW.border,
    paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12, gap: 10,
    overflow: "hidden", ...PW_SHADOW,
  },

  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  itemRow: { flexDirection: "row", alignItems: "center", gap: 7, flexShrink: 1 },
  itemSeal: {
    width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(33,77,45,0.07)", borderWidth: 1, borderColor: "rgba(33,77,45,0.22)",
  },
  item: { flexShrink: 1, fontFamily: FONTS.serif, fontSize: 12.5, fontWeight: "700", color: PW.brown },

  /** 1. The opportunity — the largest thing on the card. */
  heroBlock: { alignItems: "center", gap: 1, paddingTop: 2 },
  heroLabel: { fontFamily: FONTS.serif, fontSize: 9, fontWeight: "800", letterSpacing: 1.8, color: PW.brown },
  heroValue: {
    fontFamily: FONTS.serif, fontSize: 36, fontWeight: "800", color: PW.forest,
    lineHeight: 42, textAlign: "center",
  },
  /** Slightly lighter so the dash separates without competing with the figures. */
  rangeDash: { color: PW.gold },

  rule: { height: 1, backgroundColor: "rgba(196,163,52,0.55)" },

  /** 2. The limit. */
  limitRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  limitText: { flex: 1, minWidth: 0, gap: 1 },
  limitLabel: { fontFamily: FONTS.serif, fontSize: 10, fontWeight: "800", letterSpacing: 1.6, color: LIMIT_RED },
  limitHint: { fontSize: 11.5, lineHeight: 15, color: PW.brown, fontWeight: "500" },
  limitValue: {
    fontFamily: FONTS.serif, fontSize: 27, fontWeight: "800", color: LIMIT_RED,
    lineHeight: 32, minWidth: 78, textAlign: "right",
  },

  /** 3. The footing — two equal columns, so neither moves with its own text. */
  footRow: { flexDirection: "row", alignItems: "stretch" },
  foot: { flex: 1, alignItems: "center", gap: 1 },
  footDivider: { width: 1, backgroundColor: PW.border, marginHorizontal: 8 },
  footLabel: { fontFamily: FONTS.serif, fontSize: 8.5, fontWeight: "800", letterSpacing: 1.4, color: PW.brown },
  footValue: { fontFamily: FONTS.serif, fontSize: 20, fontWeight: "800", color: PW.ink, lineHeight: 25 },
  footPositive: { color: PW.forest },

  /** Supporting cues: fixed thirds. */
  cues: { flexDirection: "row", gap: 8 },
  cue: {
    flex: 1, minWidth: 0, alignItems: "center", gap: 3,
    backgroundColor: PW.card, borderRadius: 12, borderWidth: 1.25, borderColor: PW.border,
    paddingVertical: 9, paddingHorizontal: 6, ...PW_SHADOW,
  },
  cueLabel: { fontFamily: FONTS.serif, fontSize: 7.5, fontWeight: "800", letterSpacing: 1.1, color: PW.brown },
  cueValue: { fontFamily: FONTS.serif, fontSize: 12.5, fontWeight: "800", color: PW.ink },
});

const it = StyleSheet.create({
  /** Identity first: frame on the left, what it resolved to on the right. */
  identity: { flexDirection: "row", alignItems: "center", gap: 12, paddingTop: 2 },
  frame: {
    width: 72, height: 72, borderRadius: 12,
    alignItems: "center", justifyContent: "center",
    backgroundColor: PW.parchment, borderWidth: 1, borderColor: PW.border,
  },
  idText: { flex: 1, minWidth: 0, gap: 1 },
  brandLabel: { fontFamily: FONTS.serif, fontSize: 8.5, fontWeight: "800", letterSpacing: 1.5, color: PW.brown },
  brand: { fontFamily: FONTS.serif, fontSize: 22, fontWeight: "800", color: PW.ink, lineHeight: 27 },
  desc: { fontSize: 12.5, lineHeight: 17, color: PW.brown, fontWeight: "500" },
  eraRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3 },
  eraLabel: { fontFamily: FONTS.serif, fontSize: 8.5, fontWeight: "800", letterSpacing: 1.5, color: PW.brown },
  era: { fontFamily: FONTS.serif, fontSize: 13, fontWeight: "800", color: PW.forest },

  /** The estimate follows the identity — one line, not a cell. */
  estimateRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 10 },
  estimateLabel: { fontFamily: FONTS.serif, fontSize: 9.5, fontWeight: "800", letterSpacing: 1.6, color: PW.brown },
  estimateValue: {
    fontFamily: FONTS.serif, fontSize: 24, fontWeight: "800", color: PW.forest,
    lineHeight: 29, textAlign: "right", flexShrink: 1,
  },

  /** Meters, not boxes: how sure, and what to check. */
  meters: { gap: 9, marginTop: 2 },
  meter: { gap: 5 },
  meterHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  meterLabel: { fontFamily: FONTS.serif, fontSize: 9, fontWeight: "800", letterSpacing: 1.5, color: PW.brown },
  meterValue: { fontFamily: FONTS.serif, fontSize: 14, fontWeight: "800", color: PW.ink },
  track: { height: 6, borderRadius: 3, backgroundColor: "rgba(196,163,52,0.25)", overflow: "hidden" },
  /** 86% shown as 86% — a partial bar, never a tick that implies certainty. */
  fill: { width: "86%", height: "100%", borderRadius: 3, backgroundColor: PW.forest },

  riskRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  /** Calm, not a warning: low risk is not an error state. */
  riskPill: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 9, paddingVertical: 3, borderRadius: PW_RADIUS.pill,
    backgroundColor: "rgba(33,77,45,0.07)", borderWidth: 1, borderColor: "rgba(33,77,45,0.22)",
  },
  riskDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: PW.forest },
  riskText: { fontFamily: FONTS.serif, fontSize: 12, fontWeight: "800", color: PW.forest },

  /** The Pro tease. */
  deep: {
    backgroundColor: PW.card, borderRadius: PW_RADIUS.card,
    borderWidth: 1.25, borderColor: PW.border,
    paddingHorizontal: 13, paddingVertical: 11, gap: 7, ...PW_SHADOW,
  },
  deepHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  deepKicker: { fontFamily: FONTS.serif, fontSize: 9, fontWeight: "800", letterSpacing: 1.6, color: PW.brown },
  deepTitle: { fontFamily: FONTS.serif, fontSize: 16, fontWeight: "800", color: PW.forest, marginTop: -2 },
  deepList: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  deepChip: {
    paddingHorizontal: 8, paddingVertical: 3.5, borderRadius: PW_RADIUS.pill,
    backgroundColor: PW.goldTint, borderWidth: 1, borderColor: "rgba(196,163,52,0.45)",
  },
  deepChipText: { fontSize: 10.5, fontWeight: "700", color: PW.brown },
});

const g = StyleSheet.create({
  stack: { gap: 10 },
  hero: { gap: 12 },

  xpRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "center", gap: 8, flexWrap: "wrap" },
  xp: { fontFamily: FONTS.serif, fontSize: 34, fontWeight: "800", color: PW.forest, lineHeight: 39 },
  /** Says where the XP came from, right beside the figure. */
  xpFrom: { fontSize: 12.5, fontWeight: "700", color: PW.brown },

  rankBlock: { gap: 6 },
  rankRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 10 },
  rankNow: { flexShrink: 1, fontFamily: FONTS.serif, fontSize: 14.5, fontWeight: "800", color: PW.ink },
  rankNext: { flexShrink: 1, fontSize: 11.5, fontWeight: "600", color: PW.brown, textAlign: "right" },
  track: { height: 8, borderRadius: 4, backgroundColor: "rgba(196,163,52,0.25)", overflow: "hidden" },
  fill: { height: "100%", borderRadius: 4, backgroundColor: PW.forest },

  /** Horizontal, with the next card peeking so more is obviously there. */
  showcase: { gap: UNLOCK_GAP, paddingRight: 20, paddingVertical: 2 },
  unlock: {
    width: UNLOCK_W,
    backgroundColor: PW.card, borderRadius: PW_RADIUS.card,
    borderWidth: 1.25, borderColor: PW.border,
    paddingHorizontal: 14, paddingTop: 14, paddingBottom: 11, gap: 7,
    overflow: "hidden", ...PW_SHADOW,
  },
  /** The product's own colour for this thing, along the top edge. */
  unlockBar: { position: "absolute", top: 0, left: 0, right: 0, height: 3 },
  unlockHead: { flexDirection: "row", alignItems: "center", gap: 9 },
  unlockSeal: {
    width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center",
    borderWidth: 1.25, backgroundColor: PW.parchment,
  },
  /** The event. Small and tracked because it IS a label — the one place small belongs. */
  unlockKicker: {
    flex: 1, fontFamily: FONTS.serif, fontSize: 11, fontWeight: "800",
    letterSpacing: 1.3, color: PW.brown, lineHeight: 14,
  },
  /** The loudest line. Wraps to three; never shrinks. */
  unlockTitle: {
    fontFamily: FONTS.serif, fontSize: 19, fontWeight: "800", color: PW.ink,
    lineHeight: 24, minHeight: 48,
  },
  unlockMeta: {
    alignSelf: "flex-start", paddingHorizontal: 9, paddingVertical: 3,
    borderRadius: PW_RADIUS.pill, borderWidth: 1, backgroundColor: PW.parchment,
  },
  unlockMetaText: { fontFamily: FONTS.serif, fontSize: 12.5, fontWeight: "800", letterSpacing: 0.5 },
  unlockBody: { fontSize: 14.5, lineHeight: 19.5, color: PW.brown, fontWeight: "500", minHeight: 58 },
  unlockFooter: { borderTopWidth: 1, borderTopColor: PW.border, paddingTop: 8 },
  unlockFooterText: { fontFamily: FONTS.serif, fontSize: 13, fontWeight: "800", color: PW.forest, lineHeight: 17 },
});
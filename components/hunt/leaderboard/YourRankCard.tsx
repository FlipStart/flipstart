/**
 * components/hunt/leaderboard/YourRankCard.tsx
 *
 * The card pinned to the bottom of the leaderboard: where the viewer stands on
 * the board they are looking at, and what it takes to move up.
 *
 *   ranked       YOUR RANK · picture · #34 · name · the number · level · "18 XP to pass #33"
 *   unranked     why, and a Start Hunt button
 *   signed out   "Sign in to join the leaderboard"
 *   loading      the card's shape
 *
 * Antique gold is used here and for first place, and nowhere else on the screen.
 */
import { View, Text, Pressable, StyleSheet } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { formatXp, SIGNED_OUT_COPY, PENDING_XP_COPY, type RankCard } from '@/lib/leaderboard';
import { FONTS } from '@/constants/typography';
import { HunterAvatar, FoundingMark } from './HunterAvatar';
import { LB, MAX_TEXT_SCALE } from './theme';

export function YourRankCard({ card, pendingXp, bottomInset, onStartHunt, onSignIn, onLayoutHeight }: {
  card: RankCard;
  /** A finished Hunt's XP has not reached the server yet. */
  pendingXp: boolean;
  bottomInset: number;
  onStartHunt: () => void;
  onSignIn: () => void;
  onLayoutHeight?: (h: number) => void;
}) {
  if (card.kind === 'hidden') return null;
  return (
    <View
      style={[s.dock, { paddingBottom: Math.max(bottomInset, 10) }]}
      onLayout={e => onLayoutHeight?.(e.nativeEvent.layout.height)}
      testID="lb-your-rank"
    >
      <View style={s.card}>
        {pendingXp && card.kind !== 'signed_out' && card.kind !== 'loading' && (
          <View style={s.pending} accessible accessibilityLabel={PENDING_XP_COPY} testID="lb-pending-xp">
            <MaterialIcons name="sync" size={13} color={LB.MUTED} />
            <Text style={s.pendingText} maxFontSizeMultiplier={MAX_TEXT_SCALE}>{PENDING_XP_COPY}</Text>
          </View>
        )}

        {card.kind === 'loading' && (
          <View style={s.line} accessible accessibilityLabel="Loading your rank" testID="lb-your-rank-loading">
            <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: LB.SKELETON }} />
            <View style={{ flex: 1 }}>
              <View style={[s.bone, { width: 90 }]} />
              <View style={[s.bone, { width: 150, marginTop: 8 }]} />
            </View>
          </View>
        )}

        {card.kind === 'signed_out' && (
          <View style={s.line} testID="lb-your-rank-signed-out">
            <Text style={[s.prompt, { flex: 1 }]} maxFontSizeMultiplier={MAX_TEXT_SCALE}>{SIGNED_OUT_COPY.title}</Text>
            <Pressable
              onPress={onSignIn}
              accessibilityRole="button"
              accessibilityLabel={SIGNED_OUT_COPY.cta}
              style={({ pressed }) => [s.cta, pressed && { opacity: 0.85 }]}
              testID="lb-sign-in"
            >
              <Text style={s.ctaText} maxFontSizeMultiplier={1.3}>{SIGNED_OUT_COPY.cta}</Text>
            </Pressable>
          </View>
        )}

        {card.kind === 'unranked' && (
          <View style={s.line} testID="lb-your-rank-unranked">
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={s.eyebrow} maxFontSizeMultiplier={MAX_TEXT_SCALE}>{card.copy.title}</Text>
              <Text style={s.body} maxFontSizeMultiplier={MAX_TEXT_SCALE}>{card.copy.body}</Text>
            </View>
            <Pressable
              onPress={onStartHunt}
              accessibilityRole="button"
              accessibilityLabel={card.copy.cta}
              style={({ pressed }) => [s.cta, pressed && { opacity: 0.85 }]}
              testID="lb-start-hunt"
            >
              <Text style={s.ctaText} maxFontSizeMultiplier={1.3}>{card.copy.cta}</Text>
            </Pressable>
          </View>
        )}

        {card.kind === 'ranked' && (
          <View
            accessible
            accessibilityLabel={
              `Your rank. Number ${card.me.position}. ${card.me.name}. ${formatXp(card.me.metric)}. ${card.me.rankTitle}. ${card.line}.`
            }
            testID="lb-your-rank-ranked"
          >
            <Text style={s.eyebrow} maxFontSizeMultiplier={MAX_TEXT_SCALE}>YOUR RANK</Text>
            <View style={[s.line, { marginTop: 7 }]}>
              <HunterAvatar uri={card.me.avatarUrl} size={44} ring="gold" />
              <Text style={s.position} numberOfLines={1} maxFontSizeMultiplier={1.3}>#{card.me.position}</Text>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={s.nameRow}>
                  <Text style={s.name} numberOfLines={1} maxFontSizeMultiplier={MAX_TEXT_SCALE}>{card.me.name}</Text>
                  {card.me.foundingHunter && <FoundingMark size={13} />}
                </View>
                <Text style={s.level} numberOfLines={1} maxFontSizeMultiplier={MAX_TEXT_SCALE}>{card.me.rankTitle}</Text>
              </View>
              <Text style={s.metric} numberOfLines={1} maxFontSizeMultiplier={MAX_TEXT_SCALE}>{formatXp(card.me.metric)}</Text>
            </View>
            <Text style={s.pass} maxFontSizeMultiplier={MAX_TEXT_SCALE} testID="lb-pass-line">{card.line}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  dock: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: 12, paddingTop: 8, backgroundColor: LB.BG,
    borderTopWidth: 1, borderTopColor: LB.CARD_EDGE,
  },
  card: {
    backgroundColor: LB.CARD, borderRadius: 16, borderWidth: 1.5, borderColor: LB.GOLD,
    paddingHorizontal: 14, paddingVertical: 12,
    shadowColor: '#3A2A0A', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.12, shadowRadius: 8, elevation: 4,
  },
  line: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  eyebrow: { fontSize: 10, fontWeight: '800', letterSpacing: 1.6, color: LB.GOLD_DEEP },
  body:    { fontSize: 13, fontWeight: '600', color: LB.BROWN, marginTop: 4, lineHeight: 18 },
  prompt:  { fontFamily: FONTS.serif, fontSize: 15, fontWeight: '800', color: LB.FOREST },
  cta: {
    backgroundColor: LB.FOREST_DEEP, borderRadius: 22, paddingVertical: 11, paddingHorizontal: 18,
    minHeight: 44, justifyContent: 'center',
  },
  ctaText: { fontFamily: FONTS.serif, fontSize: 14, fontWeight: '800', color: LB.CREAM },

  position: { fontFamily: FONTS.serif, fontSize: 19, fontWeight: '800', color: LB.GOLD_DEEP },
  nameRow:  { flexDirection: 'row', alignItems: 'center', gap: 4 },
  name:     { flexShrink: 1, fontFamily: FONTS.serif, fontSize: 15, fontWeight: '800', color: LB.FOREST },
  level:    { fontSize: 12, fontWeight: '600', color: LB.MUTED, marginTop: 2 },
  metric:   { fontSize: 15, fontWeight: '800', color: LB.FOREST, marginLeft: 6 },
  pass:     { fontSize: 13, fontWeight: '700', color: LB.BROWN, marginTop: 8 },

  pending: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 8 },
  pendingText: { fontSize: 11.5, fontWeight: '600', color: LB.MUTED },
  bone: { height: 11, borderRadius: 5.5, backgroundColor: LB.SKELETON },
});
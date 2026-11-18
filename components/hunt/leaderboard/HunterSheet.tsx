/**
 * components/hunt/leaderboard/HunterSheet.tsx
 *
 * Opened by tapping or holding another hunter on the leaderboard: who they are
 * (picture, name, level), and the two things a viewer can do about them.
 *
 *   Report   Inappropriate photo · Inappropriate name · Suspected cheating
 *   Block    they disappear from this viewer's boards (undone in Settings)
 *
 * This is the app's answer to App Store guideline 1.2: other people's names and
 * pictures are visible here, so reporting and blocking are one tap away from
 * every one of them.
 */
import { View, Text, Pressable, Modal, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useEffect, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  REPORT_REASONS, formatXp, type ActionOutcome, type BoardRow, type ReportReason,
} from '@/lib/leaderboard';
import { RANK_COUNT } from '@/lib/leaderboard';
import { FONTS } from '@/constants/typography';
import { HunterAvatar } from './HunterAvatar';
import { LB, MAX_TEXT_SCALE } from './theme';

export const REPORT_SENT_COPY = { title: 'Report sent', body: 'Thanks. We review every report.' };
export const ACTION_FAILED_COPY = "That didn't go through. Check your connection and try again.";
export const RATE_LIMITED_COPY = "You've sent a lot of reports. Try again later.";

export function HunterSheet({ row, signedIn, onClose, onReport, onBlock, onSignIn }: {
  /** The hunter to show. null keeps the sheet closed. */
  row: BoardRow | null;
  signedIn: boolean;
  onClose: () => void;
  onReport: (row: BoardRow, reason: ReportReason) => Promise<ActionOutcome>;
  /** Called after the viewer confirms. The screen removes the hunter and tells the server. */
  onBlock: (row: BoardRow) => void;
  onSignIn: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState<ReportReason | null>(null);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setBusy(null); setSent(false); setError(null); }, [row?.id]);

  const report = async (reason: ReportReason) => {
    if (!row || busy) return;
    setBusy(reason); setError(null);
    const out = await onReport(row, reason);
    setBusy(null);
    if (out === 'ok') setSent(true);
    else if (out === 'rate_limited') setError(RATE_LIMITED_COPY);
    else setError(ACTION_FAILED_COPY);
  };

  const confirmBlock = () => {
    if (!row) return;
    Alert.alert(
      `Block ${row.name}?`,
      "You won't see them on the leaderboard. You can unblock them any time in Settings.",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Block', style: 'destructive', onPress: () => onBlock(row) },
      ],
    );
  };

  return (
    <Modal visible={!!row} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={s.scrim} onPress={onClose} accessibilityLabel="Close" accessibilityRole="button" />
      {row && (
        <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 14) + 6 }]} testID="lb-hunter-sheet">
          <View style={s.grabber} />

          <View style={s.who}>
            <HunterAvatar uri={row.avatarUrl} size={64} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={s.name} numberOfLines={2} maxFontSizeMultiplier={MAX_TEXT_SCALE}>{row.name}</Text>
              <Text style={s.level} maxFontSizeMultiplier={MAX_TEXT_SCALE}>
                {row.rankTitle} · Rank {row.rankNumber} of {RANK_COUNT}
              </Text>
              <Text style={s.metric} maxFontSizeMultiplier={MAX_TEXT_SCALE}>#{row.position} · {formatXp(row.metric)}</Text>
            </View>
          </View>

          {row.foundingHunter && (
            <View style={s.founding} accessible accessibilityLabel="Founding Hunter. One of FlipStart's first hunters.">
              <MaterialIcons name="workspace-premium" size={16} color={LB.GOLD_DEEP} />
              <Text style={s.foundingText} maxFontSizeMultiplier={MAX_TEXT_SCALE}>
                <Text style={{ fontWeight: '800' }}>Founding Hunter</Text>  ·  One of FlipStart's first hunters
              </Text>
            </View>
          )}

          {!signedIn ? (
            <View style={s.block}>
              <Text style={s.note} maxFontSizeMultiplier={MAX_TEXT_SCALE}>Sign in to report or block a hunter.</Text>
              <Pressable onPress={onSignIn} style={({ pressed }) => [s.primary, pressed && { opacity: 0.85 }]} accessibilityRole="button">
                <Text style={s.primaryText} maxFontSizeMultiplier={1.3}>Sign in</Text>
              </Pressable>
            </View>
          ) : sent ? (
            <View style={s.block} testID="lb-report-sent">
              <Text style={s.sentTitle} maxFontSizeMultiplier={MAX_TEXT_SCALE}>{REPORT_SENT_COPY.title}</Text>
              <Text style={s.note} maxFontSizeMultiplier={MAX_TEXT_SCALE}>{REPORT_SENT_COPY.body}</Text>
              <Pressable onPress={onClose} style={({ pressed }) => [s.primary, pressed && { opacity: 0.85 }]} accessibilityRole="button">
                <Text style={s.primaryText} maxFontSizeMultiplier={1.3}>Done</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <Text style={s.section} maxFontSizeMultiplier={MAX_TEXT_SCALE}>REPORT</Text>
              <View style={s.group}>
                {REPORT_REASONS
                  // No picture, nothing to report about it.
                  .filter(r => r.reason !== 'photo' || !!row.avatarUrl)
                  .map((r, i) => (
                    <Pressable
                      key={r.reason}
                      onPress={() => report(r.reason)}
                      disabled={!!busy}
                      accessibilityRole="button"
                      accessibilityLabel={`Report: ${r.label}`}
                      style={({ pressed }) => [s.action, i > 0 && s.actionDivider, pressed && { opacity: 0.6 }]}
                      testID={`lb-report-${r.reason}`}
                    >
                      <MaterialIcons name="flag" size={18} color={LB.BROWN} />
                      <Text style={s.actionText} maxFontSizeMultiplier={MAX_TEXT_SCALE}>{r.label}</Text>
                      {busy === r.reason && <ActivityIndicator size="small" color={LB.MUTED} />}
                    </Pressable>
                  ))}
              </View>

              <View style={[s.group, { marginTop: 12 }]}>
                <Pressable
                  onPress={confirmBlock}
                  disabled={!!busy}
                  accessibilityRole="button"
                  accessibilityLabel={`Block ${row.name}`}
                  style={({ pressed }) => [s.action, pressed && { opacity: 0.6 }]}
                  testID="lb-block"
                >
                  <MaterialIcons name="block" size={18} color={LB.RED} />
                  <Text style={[s.actionText, { color: LB.RED }]} maxFontSizeMultiplier={MAX_TEXT_SCALE}>Block this hunter</Text>
                </Pressable>
              </View>

              {error && <Text style={s.error} maxFontSizeMultiplier={MAX_TEXT_SCALE} testID="lb-sheet-error">{error}</Text>}

              <Pressable onPress={onClose} style={({ pressed }) => [s.cancel, pressed && { opacity: 0.6 }]} accessibilityRole="button">
                <Text style={s.cancelText} maxFontSizeMultiplier={1.3}>Cancel</Text>
              </Pressable>
            </>
          )}
        </View>
      )}
    </Modal>
  );
}

const s = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(20, 28, 16, 0.5)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: LB.BG, borderTopLeftRadius: 22, borderTopRightRadius: 22,
    paddingHorizontal: 18, paddingTop: 10,
  },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: LB.LINE, marginBottom: 14 },
  who:    { flexDirection: 'row', alignItems: 'center', gap: 14 },
  name:   { fontFamily: FONTS.serif, fontSize: 19, fontWeight: '800', color: LB.FOREST },
  level:  { fontSize: 13, fontWeight: '600', color: LB.BROWN, marginTop: 3 },
  metric: { fontSize: 13, fontWeight: '700', color: LB.MUTED, marginTop: 2 },

  founding: {
    flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 14,
    backgroundColor: LB.GOLD_WASH, borderWidth: 1, borderColor: LB.GOLD, borderRadius: 12,
    paddingVertical: 9, paddingHorizontal: 12,
  },
  foundingText: { flex: 1, fontSize: 12.5, fontWeight: '600', color: LB.BROWN },

  section: { fontSize: 10, fontWeight: '800', letterSpacing: 1.6, color: LB.MUTED, marginTop: 18, marginBottom: 7, marginLeft: 4 },
  group:   { backgroundColor: LB.CARD, borderWidth: 1, borderColor: LB.CARD_EDGE, borderRadius: 14, overflow: 'hidden' },
  action:  { flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 14, minHeight: 50, paddingVertical: 12 },
  actionDivider: { borderTopWidth: 1, borderTopColor: LB.CARD_EDGE },
  actionText: { flex: 1, fontSize: 15, fontWeight: '700', color: LB.FOREST },

  error: { fontSize: 13, fontWeight: '600', color: LB.RED, marginTop: 12, textAlign: 'center' },
  cancel: { alignSelf: 'center', paddingVertical: 14, paddingHorizontal: 30, marginTop: 4 },
  cancelText: { fontSize: 15, fontWeight: '700', color: LB.MUTED },

  block: { marginTop: 18, alignItems: 'center', gap: 8 },
  note:  { fontSize: 14, fontWeight: '600', color: LB.BROWN, textAlign: 'center' },
  sentTitle: { fontFamily: FONTS.serif, fontSize: 18, fontWeight: '800', color: LB.FOREST },
  primary: {
    backgroundColor: LB.FOREST_DEEP, borderRadius: 24, paddingVertical: 13, paddingHorizontal: 44,
    marginTop: 8, minHeight: 46, justifyContent: 'center',
  },
  primaryText: { fontFamily: FONTS.serif, fontSize: 15, fontWeight: '800', color: LB.CREAM },
});
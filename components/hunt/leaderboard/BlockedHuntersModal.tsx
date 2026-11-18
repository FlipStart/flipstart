/**
 * components/hunt/leaderboard/BlockedHuntersModal.tsx
 *
 * Settings → Blocked hunters: everyone this account has blocked on the Hunt
 * Leaderboard, each with an Unblock button. Blocking happens on the leaderboard
 * itself; this is the way back.
 */
import { View, Text, Pressable, Modal, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useCallback, useEffect, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  fetchBlockedHunters, setHunterBlocked, clearBoardCaches, type BlockedHunter,
} from '@/lib/leaderboard';
import { FONTS } from '@/constants/typography';
import { HunterAvatar } from './HunterAvatar';
import { LB, MAX_TEXT_SCALE } from './theme';

export function BlockedHuntersModal({ visible, userId, onClose }: {
  visible: boolean;
  userId: string | null;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [list, setList] = useState<BlockedHunter[] | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState('loading'); setError(null);
    const users = await fetchBlockedHunters();
    if (users) { setList(users); setState('ready'); } else setState('failed');
  }, []);
  useEffect(() => { if (visible) void load(); }, [visible, load]);

  const unblock = async (h: BlockedHunter) => {
    if (busyId) return;
    setBusyId(h.id); setError(null);
    const out = await setHunterBlocked(h.id, false);
    setBusyId(null);
    if (out === 'ok') {
      setList(prev => (prev ?? []).filter(x => x.id !== h.id));
      // The saved boards were fetched without this hunter on them.
      void clearBoardCaches(userId);
    } else {
      setError("That didn't go through. Check your connection and try again.");
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[s.root, { paddingBottom: insets.bottom }]} testID="blocked-hunters">
        <View style={s.header}>
          <Text style={s.title} maxFontSizeMultiplier={MAX_TEXT_SCALE}>Blocked hunters</Text>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
            <MaterialIcons name="close" size={24} color={LB.BROWN} />
          </Pressable>
        </View>
        <Text style={s.sub} maxFontSizeMultiplier={MAX_TEXT_SCALE}>
          Blocked hunters don't appear on your Hunt Leaderboard.
        </Text>

        {state === 'loading' && <ActivityIndicator style={{ marginTop: 40 }} color={LB.MUTED} />}

        {state === 'failed' && (
          <View style={s.centre}>
            <Text style={s.note} maxFontSizeMultiplier={MAX_TEXT_SCALE}>Couldn't load your blocked list.</Text>
            <Pressable onPress={load} style={({ pressed }) => [s.retry, pressed && { opacity: 0.8 }]} accessibilityRole="button">
              <Text style={s.retryText} maxFontSizeMultiplier={1.3}>Try again</Text>
            </Pressable>
          </View>
        )}

        {state === 'ready' && (list?.length ?? 0) === 0 && (
          <View style={s.centre} testID="blocked-empty">
            <Text style={s.note} maxFontSizeMultiplier={MAX_TEXT_SCALE}>You haven't blocked anyone.</Text>
          </View>
        )}

        {state === 'ready' && (list?.length ?? 0) > 0 && (
          <ScrollView contentContainerStyle={{ padding: 16, gap: 8 }}>
            {list!.map(h => (
              <View key={h.id} style={s.row}>
                <HunterAvatar uri={h.avatarUrl} size={40} />
                <Text style={s.name} numberOfLines={1} maxFontSizeMultiplier={MAX_TEXT_SCALE}>{h.name}</Text>
                <Pressable
                  onPress={() => unblock(h)}
                  disabled={!!busyId}
                  accessibilityRole="button"
                  accessibilityLabel={`Unblock ${h.name}`}
                  style={({ pressed }) => [s.unblock, pressed && { opacity: 0.7 }]}
                >
                  {busyId === h.id
                    ? <ActivityIndicator size="small" color={LB.FOREST} />
                    : <Text style={s.unblockText} maxFontSizeMultiplier={1.3}>Unblock</Text>}
                </Pressable>
              </View>
            ))}
            {error && <Text style={s.error} maxFontSizeMultiplier={MAX_TEXT_SCALE}>{error}</Text>}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: LB.BG },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingTop: 20 },
  title:  { fontFamily: FONTS.serif, fontSize: 21, fontWeight: '800', color: LB.FOREST },
  sub:    { fontSize: 13, fontWeight: '600', color: LB.MUTED, paddingHorizontal: 18, marginTop: 6 },
  centre: { alignItems: 'center', marginTop: 48, paddingHorizontal: 30, gap: 14 },
  note:   { fontSize: 15, fontWeight: '600', color: LB.BROWN, textAlign: 'center' },
  retry:  { backgroundColor: LB.FOREST_DEEP, borderRadius: 22, paddingVertical: 11, paddingHorizontal: 26 },
  retryText: { fontFamily: FONTS.serif, fontSize: 14, fontWeight: '800', color: LB.CREAM },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: LB.CARD,
    borderWidth: 1, borderColor: LB.CARD_EDGE, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 12,
  },
  name: { flex: 1, fontFamily: FONTS.serif, fontSize: 15, fontWeight: '800', color: LB.FOREST },
  unblock: {
    borderWidth: 1.5, borderColor: LB.FOREST, borderRadius: 18, paddingVertical: 8, paddingHorizontal: 16,
    minWidth: 86, minHeight: 38, alignItems: 'center', justifyContent: 'center',
  },
  unblockText: { fontSize: 13, fontWeight: '800', color: LB.FOREST },
  error: { fontSize: 13, fontWeight: '600', color: LB.RED, textAlign: 'center', marginTop: 8 },
});
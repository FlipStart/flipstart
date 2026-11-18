/**
 * app/hunt-leaderboard.tsx
 *
 * The Hunt Leaderboard.
 *
 * Top to bottom:
 *   header          ♦ HUNT MODE ♦ · Hunt Leaderboard · "Compete. Earn XP. Climb."
 *   My Hunt Level   the viewer's place on all 23 ranks (HuntLevelTrack)
 *   tabs            WEEKLY XP | ALL-TIME | BEST HUNT, stuck to the top once scrolled
 *                   past, with the board's own line beneath ("Resets in 2d 14h")
 *   podium          #2 · #1 · #3, with "Open spot" plinths on a small board
 *   list            ranks 4 and below, 50 at a time
 *   your rank       pinned to the bottom
 *
 * The server ranks everyone (server/leaderboard). This screen only shows what it
 * sends: a public handle, a moderated name and picture, the Hunt level and a
 * number. Tapping or holding another hunter opens report and block.
 *
 * It never shows a blank screen. Before the first answer it draws the board's
 * shape; when the network is gone it keeps the last board it had, says what
 * time that board is from, and offers Retry.
 *
 * Opened from the HUNT LEADERBOARD button on the Hunt start screen, the Hunt
 * Mode card on Home, and the Hunt complete screen (`source` says which).
 */
import {
  View, Text, Pressable, StyleSheet, SectionList, RefreshControl, ActivityIndicator,
  AccessibilityInfo, Alert, AppState,
} from 'react-native';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useAuth } from '@/lib/auth-context';
import { loadXpProfile, refreshXpFromServer } from '@/lib/huntXp';
import { pendingCompletionIds } from '@/lib/huntCompletion';
import { useFlipStore } from '@/lib/useFlipStore';
import { useLeaderboard } from '@/lib/useLeaderboard';
import {
  BOARD_TABS, BOARDS, DEFAULT_BOARD, boardCaption, cachedAtLabel, listRows, msUntilReset, nextCountdownTickMs,
  nextRolloverTry, rankCardFor, reportHunter, setHunterBlocked, sparseLine, TOP_N, TOP_N_LINE,
  type Board, type BoardRow, type ReportReason, type RolloverState,
} from '@/lib/leaderboard';
import {
  createOncePer, logLeaderboardLevelTrackViewed, logLeaderboardOpened, logLeaderboardReportSubmitted,
  logLeaderboardStartHuntClicked, logLeaderboardTabSelected, logLeaderboardUserBlocked, logLeaderboardViewed,
} from '@/lib/leaderboardAnalytics';
import { rankIndexFor } from '@shared/hunt/ranks';
import { FONTS } from '@/constants/typography';
import { HuntLevelTrack } from '@/components/hunt/leaderboard/HuntLevelTrack';
import { LeaderboardPodium, PodiumSkeleton } from '@/components/hunt/leaderboard/LeaderboardPodium';
import { LeaderboardRow, RowSkeleton } from '@/components/hunt/leaderboard/LeaderboardRow';
import { YourRankCard } from '@/components/hunt/leaderboard/YourRankCard';
import { HunterSheet, ACTION_FAILED_COPY } from '@/components/hunt/leaderboard/HunterSheet';
import { LB, MAX_TEXT_SCALE } from '@/components/hunt/leaderboard/theme';

type Item =
  | { key: string; kind: 'skeleton' }
  | { key: string; kind: 'error' }
  | { key: string; kind: 'stale'; label: string }
  | { key: string; kind: 'podium' }
  | { key: string; kind: 'sparse'; text: string }
  | { key: string; kind: 'row'; row: BoardRow }
  | { key: string; kind: 'more' };

export const LOAD_FAILED_COPY = "Couldn't load the leaderboard. Check your connection and try again.";

export default function HuntLeaderboardScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ source?: string; board?: string }>();
  const { user, loading: authLoading } = useAuth();
  const uid = user?.id ?? null;
  const authReady = !authLoading;

  const initialBoard = BOARDS.includes(params.board as Board) ? (params.board as Board) : DEFAULT_BOARD;
  const lb = useLeaderboard(uid, authReady, initialBoard);
  const { board, entry } = lb;
  const view = entry.view;

  // ── Analytics: opened once; each board counted once when its fresh data shows ──
  useEffect(() => { void logLeaderboardOpened(params.source, initialBoard); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  const oncePer = useRef(createOncePer()).current;
  useEffect(() => {
    if (!view || entry.loading || entry.stale || view.board !== board) return;
    if (!oncePer(`viewed:${board}`)) return;
    logLeaderboardViewed({ board, position: view.me?.position ?? null, rankedCount: view.rankedCount, signedIn: !!uid });
  }, [board, view, entry.loading, entry.stale, uid, oncePer]);

  // ── My Hunt Level: the phone's copy at once, then the server's number ─────
  const [totalXp, setTotalXp] = useState(0);
  const [pendingXp, setPendingXp] = useState(false);
  const [levelKnown, setLevelKnown] = useState(false);
  const { settlePendingHuntXp } = useFlipStore();
  const settleRef = useRef(settlePendingHuntXp);
  settleRef.current = settlePendingHuntXp;
  const boardRefreshRef = useRef(lb.refresh);
  boardRefreshRef.current = lb.refresh;
  const refreshMine = useCallback(() => {
    if (!uid) { setTotalXp(0); setPendingXp(false); return; }
    let alive = true;
    loadXpProfile(uid).then(p => { if (alive) setTotalXp(p.totalXp); }).catch(() => {})
      .finally(() => { if (alive) setLevelKnown(true); });
    refreshXpFromServer(uid).then(p => { if (alive && p) setTotalXp(p.totalXp); }).catch(() => {});
    pendingCompletionIds(uid).then(async ids => {
      if (!alive) return;
      setPendingXp(ids.length > 0);
      if (ids.length === 0) return;
      // A Hunt is still waiting: send it now instead of waiting for the app to come back to the
      // foreground. The server awards a Hunt once, so asking again is always safe.
      const settled = await settleRef.current().catch(() => 0);
      const left = await pendingCompletionIds(uid).catch(() => ids);
      if (!alive) return;
      setPendingXp(left.length > 0);
      if (settled > 0) {
        refreshXpFromServer(uid).then(p => { if (alive && p) setTotalXp(p.totalXp); }).catch(() => {});
        void boardRefreshRef.current();
      }
    }).catch(() => {});
    return () => { alive = false; };
  }, [uid]);

  // My Hunt Level is at the top of the screen: counted once per open, with the viewer's own rank.
  useEffect(() => {
    if (!authReady || (uid && !levelKnown)) return;
    if (!oncePer('track')) return;
    logLeaderboardLevelTrackViewed(rankIndexFor(totalXp) + 1, !!uid);
  }, [authReady, uid, levelKnown, totalXp, oncePer]);

  // ── Refresh on open, on coming back to the screen, and on returning to the app ──
  const firstFocus = useRef(true);
  const refreshRef = useRef(lb.refresh);
  refreshRef.current = lb.refresh;
  useFocusEffect(useCallback(() => {
    const stop = refreshMine();
    // The board itself loads on mount (useLeaderboard). Later visits fetch again.
    if (firstFocus.current) firstFocus.current = false;
    else void refreshRef.current();
    return stop;
  }, [refreshMine]));
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') { refreshMine(); void refreshRef.current(); }
    });
    return () => sub.remove();
  }, [refreshMine]);

  // ── Reduce Motion ─────────────────────────────────────────────────────────
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled?.().then(v => { if (alive) setReduceMotion(!!v); }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', v => setReduceMotion(!!v));
    return () => { alive = false; sub?.remove?.(); };
  }, []);

  // ── "Resets in": counts down on the server's clock; a new week fetches itself ──
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => { if (board === 'weekly') setNowMs(Date.now()); }, [board]);
  // Works for a saved copy too: the server's time when it was fetched, plus the time since.
  const msLeft = view && entry.at != null ? msUntilReset(view, entry.at, nowMs) : null;
  // Looked at every 30 seconds, and right at the reset when that comes sooner.
  useEffect(() => {
    if (board !== 'weekly') return;
    const t = setTimeout(() => setNowMs(Date.now()), nextCountdownTickMs(msLeft));
    return () => clearTimeout(t);
  }, [board, msLeft, nowMs]);
  // The week ended with the screen open: fetch the new one. If the answer is
  // still the old week, ask again a few times, then stop.
  const rollover = useRef<RolloverState | null>(null);
  useEffect(() => {
    if (board !== 'weekly' || !view) return;
    const next = nextRolloverTry(rollover.current, view.weekEndsAt, msLeft, Date.now());
    if (!next) return;
    rollover.current = next;
    void refreshRef.current();
  }, [board, view, msLeft, nowMs]);

  // ── Pull to refresh ───────────────────────────────────────────────────────
  const [pulled, setPulled] = useState(false);
  const onPull = useCallback(async () => {
    setPulled(true);
    refreshMine();
    await lb.refresh();
    setPulled(false);
  }, [lb, refreshMine]);

  // ── Navigation ────────────────────────────────────────────────────────────
  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)' as any);
  };
  const startHunt = () => {
    logLeaderboardStartHuntClicked({ board, unranked: !view?.me });
    // Opened from the Hunt start screen: that screen is right underneath.
    if (params.source === 'hunt' && router.canGoBack()) router.back();
    else router.replace('/hunt' as any);
  };
  const signIn = () => router.push({ pathname: '/auth', params: { mode: 'login' } } as any);

  // ── Report and block ──────────────────────────────────────────────────────
  const [sheetRow, setSheetRow] = useState<BoardRow | null>(null);
  const openHunter = useCallback((row: BoardRow) => { if (!row.isMe) setSheetRow(row); }, []);
  const onReport = useCallback(async (row: BoardRow, reason: ReportReason) => {
    const out = await reportHunter(row.id, reason);
    if (out === 'ok') logLeaderboardReportSubmitted(reason);
    return out;
  }, []);
  const onBlock = useCallback(async (row: BoardRow) => {
    setSheetRow(null);
    lb.dropHunter(row.id);                              // gone from the screen straight away
    const out = await setHunterBlocked(row.id, true);
    if (out === 'ok') { logLeaderboardUserBlocked(); void lb.refresh(); }
    else {
      lb.reset();                                       // the block did not happen: show the real board again
      Alert.alert("Couldn't block this hunter", ACTION_FAILED_COPY);
    }
  }, [lb]);

  // ── What the list shows ───────────────────────────────────────────────────
  const items = useMemo<Item[]>(() => {
    if (!view) {
      return entry.loading || !authReady || !entry.stale
        ? [{ key: 'skeleton', kind: 'skeleton' }]
        : [{ key: 'error', kind: 'error' }];
    }
    const out: Item[] = [];
    if (entry.stale && entry.at != null) out.push({ key: 'stale', kind: 'stale', label: cachedAtLabel(entry.at) });
    out.push({ key: 'podium', kind: 'podium' });
    const sparse = sparseLine(board, view.rankedCount, !!view.me);
    if (sparse) out.push({ key: 'sparse', kind: 'sparse', text: sparse });
    for (const row of listRows(view.rows)) out.push({ key: row.id, kind: 'row', row });
    if (entry.loadingMore) out.push({ key: 'more', kind: 'more' });
    // The end of the top 100, when more hunters are ranked than are listed.
    else if (!view.hasMore && view.rankedCount > TOP_N && view.rows.length > 0) {
      out.push({ key: 'top-n', kind: 'sparse', text: TOP_N_LINE });
    }
    return out;
  }, [view, entry.loading, entry.stale, entry.at, entry.loadingMore, authReady, board]);

  const card = rankCardFor({ board, signedIn: !!uid, authReady, view, loading: entry.loading });
  const [cardH, setCardH] = useState(0);

  const renderItem = ({ item }: { item: Item }) => {
    switch (item.kind) {
      case 'skeleton':
        return (
          <View testID="lb-skeleton">
            <PodiumSkeleton />
            <View style={{ height: 14 }} />
            <RowSkeleton /><RowSkeleton /><RowSkeleton />
          </View>
        );
      case 'error':
        return (
          <View style={s.errorBox} testID="lb-error">
            <MaterialIcons name="cloud-off" size={30} color={LB.MUTED} />
            <Text style={s.errorText} maxFontSizeMultiplier={MAX_TEXT_SCALE}>{LOAD_FAILED_COPY}</Text>
            <Pressable
              onPress={() => void lb.refresh()}
              accessibilityRole="button"
              style={({ pressed }) => [s.retryBtn, pressed && { opacity: 0.85 }]}
              testID="lb-retry"
            >
              <Text style={s.retryBtnText} maxFontSizeMultiplier={1.3}>Retry</Text>
            </Pressable>
          </View>
        );
      case 'stale':
        return (
          <View style={s.stale} testID="lb-stale">
            <MaterialIcons name="cloud-off" size={15} color={LB.MUTED} />
            <Text style={s.staleText} maxFontSizeMultiplier={MAX_TEXT_SCALE}>{item.label}</Text>
            <Pressable
              onPress={() => void lb.refresh()}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Retry"
              testID="lb-retry"
            >
              {entry.loading
                ? <ActivityIndicator size="small" color={LB.MUTED} />
                : <Text style={s.staleRetry} maxFontSizeMultiplier={1.3}>Retry</Text>}
            </Pressable>
          </View>
        );
      case 'podium':
        return <LeaderboardPodium rows={view?.rows ?? []} onPress={openHunter} />;
      case 'sparse':
        return <Text style={s.sparse} maxFontSizeMultiplier={MAX_TEXT_SCALE} testID="lb-sparse">{item.text}</Text>;
      case 'row':
        return <LeaderboardRow row={item.row} onPress={openHunter} />;
      case 'more':
        return <ActivityIndicator style={{ marginVertical: 14 }} color={LB.MUTED} />;
    }
  };

  return (
    <View style={[s.root, { paddingTop: insets.top }]} testID="hunt-leaderboard">

      {/* ── Header ── */}
      <View style={s.header}>
        <Pressable onPress={goBack} hitSlop={12} style={s.headerBtn} accessibilityRole="button" accessibilityLabel="Back">
          <MaterialIcons name="arrow-back" size={22} color={LB.BROWN} />
        </Pressable>
        <View style={s.headerCenter} accessible accessibilityRole="header" accessibilityLabel="Hunt Mode. Hunt Leaderboard.">
          <Text style={s.headerMode} maxFontSizeMultiplier={1.3}>♦  HUNT MODE  ♦</Text>
          <Text style={s.headerTitle} numberOfLines={1} maxFontSizeMultiplier={1.3}>Hunt Leaderboard</Text>
        </View>
        <View style={{ width: 36 }} />
      </View>

      <SectionList<Item>
        sections={[{ key: board, data: items }]}
        keyExtractor={item => item.key}
        renderItem={renderItem}
        stickySectionHeadersEnabled
        ListHeaderComponent={
          <View>
            <Text style={s.tagline} maxFontSizeMultiplier={MAX_TEXT_SCALE}>Compete. Earn XP. Climb.</Text>
            <HuntLevelTrack totalXp={totalXp} signedIn={!!uid} reduceMotion={reduceMotion} />
          </View>
        }
        renderSectionHeader={() => (
          <View style={s.tabsWrap}>
            <View style={s.tabs} accessibilityRole="tablist">
              {BOARD_TABS.map(t => {
                const on = t.board === board;
                return (
                  <Pressable
                    key={t.board}
                    onPress={() => { if (!on) { logLeaderboardTabSelected(t.board); lb.select(t.board); } }}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={t.a11y}
                    style={[s.tab, on && s.tabOn]}
                    testID={`lb-tab-${t.board}`}
                  >
                    <Text
                      style={[s.tabText, on && s.tabTextOn]}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.8}
                      maxFontSizeMultiplier={1.3}
                    >
                      {t.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={s.caption} maxFontSizeMultiplier={MAX_TEXT_SCALE} testID="lb-caption">
              {boardCaption(board, msLeft)}
            </Text>
          </View>
        )}
        onEndReached={lb.loadMore}
        onEndReachedThreshold={0.6}
        refreshControl={<RefreshControl refreshing={pulled} onRefresh={onPull} tintColor={LB.MUTED} />}
        contentContainerStyle={{ paddingBottom: (cardH || insets.bottom) + 20 }}
        showsVerticalScrollIndicator={false}
        initialNumToRender={12}
      />

      <YourRankCard
        card={card}
        pendingXp={pendingXp}
        bottomInset={insets.bottom}
        onStartHunt={startHunt}
        onSignIn={signIn}
        onLayoutHeight={setCardH}
      />

      <HunterSheet
        row={sheetRow}
        signedIn={!!uid}
        onClose={() => setSheetRow(null)}
        onReport={onReport}
        onBlock={onBlock}
        onSignIn={() => { setSheetRow(null); signIn(); }}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: LB.BG },

  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingTop: 6, paddingBottom: 8 },
  headerBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerMode:  { fontSize: 10, fontWeight: '800', letterSpacing: 2, color: LB.GOLD_DEEP },
  headerTitle: { fontFamily: FONTS.serif, fontSize: 21, fontWeight: '800', color: LB.FOREST, marginTop: 2 },
  tagline: {
    textAlign: 'center', fontSize: 13, fontWeight: '600', fontStyle: 'italic', color: LB.BROWN,
    marginTop: 2, marginBottom: 14,
  },

  tabsWrap: { backgroundColor: LB.BG, paddingTop: 14, paddingBottom: 8, paddingHorizontal: 16 },
  tabs: {
    flexDirection: 'row', backgroundColor: LB.CARD, borderRadius: 14, padding: 4,
    borderWidth: 1, borderColor: LB.CARD_EDGE,
  },
  tab:     { flex: 1, minHeight: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  tabOn:   { backgroundColor: LB.FOREST_DEEP },
  tabText: { fontFamily: FONTS.serif, fontSize: 12.5, fontWeight: '800', letterSpacing: 0.8, color: LB.FOREST },
  tabTextOn: { color: LB.CREAM },
  caption: { textAlign: 'center', fontSize: 12, fontWeight: '700', color: LB.MUTED, marginTop: 8 },

  sparse: {
    textAlign: 'center', fontFamily: FONTS.serif, fontSize: 14, fontWeight: '700', color: LB.BROWN,
    marginHorizontal: 24, marginTop: 2, marginBottom: 16,
  },

  stale: {
    flexDirection: 'row', alignItems: 'center', gap: 7, marginHorizontal: 16, marginTop: 2,
    backgroundColor: LB.CARD, borderWidth: 1, borderColor: LB.CARD_EDGE, borderRadius: 12,
    paddingVertical: 9, paddingHorizontal: 12,
  },
  staleText:  { flex: 1, fontSize: 12.5, fontWeight: '600', color: LB.BROWN },
  staleRetry: { fontSize: 13, fontWeight: '800', color: LB.FOREST, textDecorationLine: 'underline' },

  errorBox:  { alignItems: 'center', marginTop: 36, paddingHorizontal: 36, gap: 12 },
  errorText: { fontSize: 14, fontWeight: '600', color: LB.BROWN, textAlign: 'center', lineHeight: 20 },
  retryBtn: {
    backgroundColor: LB.FOREST_DEEP, borderRadius: 24, paddingVertical: 12, paddingHorizontal: 36,
    minHeight: 44, justifyContent: 'center', marginTop: 4,
  },
  retryBtnText: { fontFamily: FONTS.serif, fontSize: 15, fontWeight: '800', color: LB.CREAM },
});
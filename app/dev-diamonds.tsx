/**
 * app/dev-diamonds.tsx
 *
 * FILE PATH: app/dev-diamonds.tsx
 *
 * DEV ONLY — "Test Diamonds in the Rough".
 * Accessible from Settings → "🔧 Test Diamonds in the Rough (Dev)" (dev builds only).
 *
 * Two modes:
 *   1. Force Unlock / Remove — bypasses the matcher (UI / storage / notification
 *      testing only). Writes to lib/devDiamondOverrides, which the Progress tab
 *      and the Diamonds screen merge in only under __DEV__.
 *   2. Simulate Diamond Scan — builds a realistic mock scan and runs it through the
 *      REAL matcher (computeUnlockedDiamonds). Never bypasses matching. Shows
 *      expected vs actual + pass/fail, and persists whatever genuinely unlocked
 *      (i.e. exactly what saving that scan would have done).
 *
 * Plus quick actions: reset, mark-all-seen, clear notifications, unlock random,
 * unlock random rare, print state.
 *
 * Nothing here affects production: the screen is only registered + linked under
 * __DEV__, and the override store is only read under __DEV__.
 */

import {
  View, Text, StyleSheet, ScrollView, Pressable, Alert, TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useState, useCallback, useMemo } from 'react';

import { FONTS } from '@/constants/typography';
import { useFlipStore } from '@/lib/useFlipStore';
import { useAchievementNotifications } from '@/lib/AchievementNotificationContext';
import { useAuth } from '@/lib/auth-context';
import {
  DIAMONDS, TOTAL_DIAMONDS, CATEGORY_META,
  computeUnlockedDiamonds, getUnlockedDiamondIds, markDiamondIdsSeen,
  debugDiamondMatching,
  type DiamondDef, type UnlockedDiamond,
} from '@/lib/diamonds';
import {
  getDevDiamondRecords, addDevDiamond, removeDevDiamond,
  clearAllDevDiamonds, removeFromDiamondSeen, clearAllDiamondSeen,
} from '@/lib/devDiamondOverrides';
import type { HistoryEntry } from '@/types/flip';

// ─── Palette (dark dev-tool theme, matches the other dev screens) ─────────────
const DEV_BG  = '#0A0A14';
const CARD_BG = '#15151F';
const LINE    = '#26263A';
const GREEN    = '#6BE08C';
const BLUE     = '#7FA8FF';
const GOLD      = '#E3C770';
const RED       = '#E07A7A';
const MUTED      = '#8A8AA0';
const TEXT       = '#E8E8F2';

const BY_ID: Record<string, DiamondDef> = Object.fromEntries(DIAMONDS.map(d => [d.id, d]));

// ─── Mock scan generation (for Simulate Scan) ─────────────────────────────────

/** The era token most likely to satisfy a Diamond's era gate. */
function eraTokenFor(def: DiamondDef): string {
  const t = def.title.toLowerCase();
  const era = def.era
    ?? (def.category === 'y2k' || t.includes('y2k') ? 'y2k'
      : (t.includes('vintage') || def.needsVintage ? 'vintage' : 'none'));
  if (era === 'y2k') return 'early 2000s';
  if (era === 'vintage') return '1990s';
  return '';
}

interface MockFields {
  brand: string; itemName: string; category: string;
  era: string; styleLabels: string[]; material: string;
}

/** Build realistic metadata that *should* satisfy this Diamond's matcher gates. */
function mockFieldsFor(def: DiamondDef): MockFields {
  const brand    = def.brandAny?.[0] ?? '';
  const typeWord = def.typeAny?.[0] ?? '';
  const ident0   = def.requireAny?.[0] ?? def.markerAny?.[0] ?? def.detectionKeywords[0] ?? '';
  const eraTok   = eraTokenFor(def);

  // For tightened Diamonds (with a requireAny allow-list) use just the primary
  // identity (+ its marker) for a clean, single-match sim. For older Diamonds
  // (identity via keyword fallback) include more signal so they still self-match.
  let idents: string[];
  if (def.requireAny && def.requireAny.length > 0) {
    idents = [def.requireAny[0], ...(def.markerAny?.slice(0, 1) ?? [])];
  } else {
    idents = [...(def.markerAny ?? []), ...def.detectionKeywords].slice(0, 6);
  }
  idents = Array.from(new Set(idents.filter(Boolean)));

  return {
    brand,
    itemName:    [ident0, typeWord].filter(Boolean).join(' ').trim() || def.title,
    category:    typeWord || 'Item',
    era:         eraTok,
    styleLabels: Array.from(new Set([...idents, eraTok].filter(Boolean))),
    material:    ident0,
  };
}

/** Wrap mock fields as a real HistoryEntry (scan or hunt) the matcher can read. */
function buildMockEntry(def: DiamondDef, source: 'scan' | 'hunt'): HistoryEntry {
  const f = mockFieldsFor(def);
  const now = Date.now();
  const scanId = `dev-sim-${def.id}`;

  if (source === 'hunt') {
    return {
      type: 'hunt_bundle',
      id: `dev-hunt-${def.id}`,
      timestamp: now,
      endedAt: now,
      keptItems: [{
        huntItemId: scanId,
        scanId,
        brand: f.brand,
        itemName: f.itemName,
        category: f.category,
        imageUri: '',
        profit: 0,
        scanSnapshot: {
          identification: {
            estimated_era: f.era,
            style_labels: f.styleLabels,
            material_guess: f.material,
          },
        },
      }],
    } as unknown as HistoryEntry;
  }

  return {
    id: scanId,
    imageUri: '',
    timestamp: now,
    itemName: f.itemName,
    brand: f.brand,
    category: f.category,
    era: f.era,
    styleLabels: f.styleLabels,
    material: f.material,
    profit: 0,
  } as unknown as HistoryEntry;
}

// ─── Simulation result type ───────────────────────────────────────────────────
interface SimResult {
  expectedId: string;
  expectedTitle: string;
  actualIds: string[];
  pass: boolean;
  extras: string[];
  source: 'scan' | 'hunt';
  fields: MockFields;
}

// ─────────────────────────────────────────────────────────────────────────────

export default function DevDiamondsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { flips } = useFlipStore();
  const {
    unseenDiamondIds, addUnseenDiamonds, markDiamondsSeen, markDiamondSeen,
  } = useAchievementNotifications();
  const { user } = useAuth();

  const [mode, setMode] = useState<'force' | 'sim'>('force');
  const [query, setQuery] = useState('');
  const [devMap, setDevMap] = useState<Record<string, UnlockedDiamond>>({});
  const [selectedSimId, setSelectedSimId] = useState<string | null>(null);
  const [simSource, setSimSource] = useState<'scan' | 'hunt'>('scan');
  const [simResult, setSimResult] = useState<SimResult | null>(null);

  // Real unlocks are derived from the flip history (the production source of truth).
  const realMap = useMemo(() => computeUnlockedDiamonds(flips), [flips]);
  const realIds = useMemo(() => new Set(Object.keys(realMap)), [realMap]);
  const devIds  = useMemo(() => new Set(Object.keys(devMap)),  [devMap]);

  const reloadDev = useCallback(async () => {
    setDevMap(await getDevDiamondRecords());
  }, []);
  useFocusEffect(useCallback(() => { reloadDev(); }, [reloadDev]));

  const allUnlockedIds = useMemo(
    () => Array.from(new Set([...realIds, ...devIds])),
    [realIds, devIds],
  );
  const totalUnlocked = allUnlockedIds.length;

  // ── Force unlock ────────────────────────────────────────────────────────────
  const forceUnlock = useCallback(async (id: string) => {
    await addDevDiamond(id, { discoveredAt: Date.now() });
    await removeFromDiamondSeen(id);   // so it shows as NEW
    addUnseenDiamonds([id]);           // bump Progress tab badge immediately
    // Signed-in: upsert to Supabase (dev tool) — background, fail-safe.
    const uid = user?.id;
    if (uid) {
      import('@/lib/diamondSync').then(({ upsertDiamondDiscovery }) =>
        upsertDiamondDiscovery(uid, {
          id, discoveredAt: Date.now(), sourceScanId: null,
          isFromHunt: false, imageUri: null, estimatedProfit: null,
        }, { isUnread: true }).catch(() => {})).catch(() => {});
    }
    await reloadDev();
  }, [addUnseenDiamonds, reloadDev, user?.id]);

  // ── Remove a dev-forced Diamond ──────────────────────────────────────────────
  const removeForced = useCallback(async (id: string) => {
    await removeDevDiamond(id);
    await removeFromDiamondSeen(id);   // allow it to re-notify later
    markDiamondSeen(id);               // clear its in-memory NEW badge
    // Signed-in: delete the remote row (dev tool) — background, fail-safe.
    const uid = user?.id;
    if (uid) {
      import('@/lib/diamondSync').then(({ deleteDiamondDiscoveryRemoteDevOnly }) =>
        deleteDiamondDiscoveryRemoteDevOnly(uid, id).catch(() => {})).catch(() => {});
    }
    await reloadDev();
  }, [markDiamondSeen, reloadDev, user?.id]);

  // ── Row tap router ────────────────────────────────────────────────────────────
  const onRowTap = useCallback((def: DiamondDef) => {
    if (mode === 'sim') { setSelectedSimId(def.id); setSimResult(null); return; }
    const isReal = realIds.has(def.id);
    const isDev  = devIds.has(def.id) && !isReal;

    if (isReal) {
      Alert.alert(
        def.title,
        'This Diamond is unlocked by a REAL saved scan in your history. Delete that scan from History to remove it — the dev tool only manages force-unlocked Diamonds.',
      );
      return;
    }
    if (isDev) {
      Alert.alert('Remove Diamond', `Remove "${def.title}" from the collection?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => removeForced(def.id) },
      ]);
      return;
    }
    forceUnlock(def.id);
  }, [mode, realIds, devIds, forceUnlock, removeForced]);

  // ── Simulate scan (REAL matcher) ─────────────────────────────────────────────
  const runSim = useCallback(async () => {
    if (!selectedSimId) { Alert.alert('Pick a Diamond', 'Select a Diamond to simulate first.'); return; }
    const def = BY_ID[selectedSimId];
    const entry = buildMockEntry(def, simSource);

    // *** Real matching logic — never bypassed. ***
    const resultMap = computeUnlockedDiamonds([entry]);
    const actualIds = Object.keys(resultMap);
    const pass = actualIds.includes(def.id);
    const extras = actualIds.filter(id => id !== def.id);

    // The unlock only happens if the matcher actually unlocked it (i.e. exactly
    // what saving this scan would do). Persist whatever genuinely matched.
    for (const id of actualIds) {
      await addDevDiamond(id, {
        discoveredAt: Date.now(),
        sourceScanId: resultMap[id].sourceScanId,
        imageUri: resultMap[id].imageUri,
      });
      await removeFromDiamondSeen(id);
    }
    if (actualIds.length > 0) addUnseenDiamonds(actualIds);

    setSimResult({
      expectedId: def.id,
      expectedTitle: def.title,
      actualIds,
      pass,
      extras,
      source: simSource,
      fields: mockFieldsFor(def),
    });
    await reloadDev();
  }, [selectedSimId, simSource, addUnseenDiamonds, reloadDev]);

  // ── Quick actions ─────────────────────────────────────────────────────────────
  const resetAll = useCallback(() => {
    Alert.alert(
      '⚠️ Reset Diamonds (Dev)',
      'Clears ALL force-unlocked Diamonds and the entire "seen" set. Diamonds unlocked by real saved scans are NOT affected.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset', style: 'destructive',
          onPress: async () => {
            await clearAllDevDiamonds();
            await clearAllDiamondSeen();
            markDiamondsSeen(unseenDiamondIds); // clear in-memory badge
            // Signed-in: reconcile remote to the real-scan truth — dev-only rows
            // are deleted, Diamonds still backed by saved scans are kept (matches
            // the local reset, which leaves scan-derived Diamonds intact).
            const uid = user?.id;
            if (uid) {
              const realIds = getUnlockedDiamondIds(flips);
              import('@/lib/diamondSync').then(({ reconcileDiamondsToLocalTruth }) =>
                reconcileDiamondsToLocalTruth(uid, realIds).catch(() => {})).catch(() => {});
            }
            await reloadDev();
            Alert.alert('Done', 'All dev Diamonds + seen flags cleared.');
          },
        },
      ],
    );
  }, [unseenDiamondIds, markDiamondsSeen, reloadDev, flips, user?.id]);

  const markAllSeen = useCallback(async () => {
    await markDiamondIdsSeen(allUnlockedIds);  // persisted
    markDiamondsSeen(allUnlockedIds);          // in-memory badge
    Alert.alert('Done', `Marked ${allUnlockedIds.length} Diamond(s) as seen.`);
  }, [allUnlockedIds, markDiamondsSeen]);

  const clearNotifs = useCallback(async () => {
    await markDiamondIdsSeen(unseenDiamondIds);
    markDiamondsSeen(unseenDiamondIds);
    Alert.alert('Done', 'Diamond notifications cleared.');
  }, [unseenDiamondIds, markDiamondsSeen]);

  const unlockRandom = useCallback((rareOnly: boolean) => {
    const pool = DIAMONDS.filter(d =>
      !realIds.has(d.id) && !devIds.has(d.id) && (!rareOnly || d.prestige === 3));
    if (pool.length === 0) { Alert.alert('None left', rareOnly ? 'All rare Diamonds already unlocked.' : 'All Diamonds already unlocked.'); return; }
    const pick = pool[Math.floor(Math.random() * pool.length)];
    forceUnlock(pick.id);
    Alert.alert('Unlocked', `${pick.title}${rareOnly ? ' (rare)' : ''}`);
  }, [realIds, devIds, forceUnlock]);

  const printState = useCallback(() => {
    /* eslint-disable no-console */
    console.log('═══ DIAMOND STATE (dev) ═══');
    console.log('Total unlocked:', totalUnlocked, '/', TOTAL_DIAMONDS);
    console.log('Real (from flips):', getUnlockedDiamondIds(flips));
    console.log('Dev-forced:', Object.keys(devMap));
    console.log('Unseen (badge):', unseenDiamondIds);
    console.log('Dev records:', devMap);

    console.log('═══ DIAMOND MATCH DEBUG (per saved item) ═══');
    const debug = debugDiamondMatching(flips);
    if (debug.length === 0) console.log('(no saved scans/hunt items yet)');
    debug.forEach((d, i) => {
      console.log(`\n#${i + 1} scanId=${d.scanId ?? '—'}  [matchSource: ${d.matchSource}]`);
      if (d.structured) {
        console.log('  canonical:', d.structured.canonicalItemName ?? '—',
          '| brand:', d.structured.canonicalBrand ?? '—',
          '| type:', d.structured.itemType ?? '—',
          '| variant/model:', d.structured.styleVariant ?? d.structured.modelName ?? '—',
          '| logo:', d.structured.logoPlacement ?? '—');
        console.log('  era:', d.structured.eraEstimate ?? '—',
          `(conf ${d.structured.eraConfidence ?? '—'})`,
          '| evidence:', (d.structured.eraEvidence ?? []).join(', ') || '—');
        if (d.structured.sportsTeam || d.structured.playerNumber || d.structured.playerNameGuess) {
          console.log('  jersey:', d.structured.sportsTeam ?? '—', d.structured.league ?? '',
            '#' + (d.structured.playerNumber ?? '—'),
            '| player:', d.structured.playerNameGuess ?? '—',
            `(conf ${d.structured.playerNameConfidence ?? '—'})`);
        }
        if (d.structured.possibleDiamondIds?.length) {
          console.log('  AI possibleDiamondIds:', d.structured.possibleDiamondIds.join(', '));
        }
      } else {
        console.log('  (no structured fields — legacy scan, strict fallback matching)');
      }
      console.log('  UNLOCKED:', d.unlocked.length ? d.unlocked.map(u => `${u.id} [${u.why}]`).join(', ') : 'none');
      if (d.notMatchedNearby.length) {
        console.log('  near-miss (brand ok, failed gate):',
          d.notMatchedNearby.map(n => `${n.id}→${n.failedGate}`).join(', '));
      }
    });
    /* eslint-enable no-console */
    Alert.alert('Printed', 'Diamond state + match debug logged to the Metro console.');
  }, [totalUnlocked, flips, devMap, unseenDiamondIds]);

  // ── Filtered list ─────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return DIAMONDS;
    return DIAMONDS.filter(d =>
      d.title.toLowerCase().includes(q) ||
      d.badge.toLowerCase().includes(q) ||
      CATEGORY_META[d.category].label.toLowerCase().includes(q));
  }, [query]);

  const statusOf = (id: string): 'real' | 'dev' | 'locked' =>
    realIds.has(id) ? 'real' : devIds.has(id) ? 'dev' : 'locked';

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={s.header}>
        <Pressable
          onPress={() => router.canGoBack() ? router.back() : router.replace('/settings' as any)}
          hitSlop={8}
          style={({ pressed }) => [s.headerBtn, pressed && { opacity: 0.6 }]}
        >
          <MaterialIcons name="arrow-back" size={20} color={GREEN} />
        </Pressable>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={s.headerTitle}>🔧 Diamond Tester</Text>
          <Text style={s.headerSub}>DEV BUILD ONLY</Text>
        </View>
        <View style={{ width: 34 }} />
      </View>

      <ScrollView
        contentContainerStyle={[s.scroll, { paddingBottom: Math.max(insets.bottom, 16) + 24 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Count */}
        <View style={s.metaCard}>
          <Text style={s.metaCount}>
            <Text style={s.metaNum}>{totalUnlocked}</Text>
            <Text style={s.metaDenom}> / {TOTAL_DIAMONDS}</Text>
            <Text style={s.metaLabel}>  unlocked</Text>
          </Text>
          <Text style={s.metaSub}>
            {realIds.size} real · {devIds.size} dev-forced · {unseenDiamondIds.length} unseen
          </Text>
        </View>

        {/* Quick actions */}
        <View style={s.quickGrid}>
          <QuickBtn icon="delete-sweep" color={RED}  label="Reset Diamonds"  onPress={resetAll} />
          <QuickBtn icon="visibility"   color={BLUE} label="Mark all seen"   onPress={markAllSeen} />
          <QuickBtn icon="notifications-off" color={BLUE} label="Clear notifs" onPress={clearNotifs} />
          <QuickBtn icon="casino"       color={GREEN} label="Unlock random" onPress={() => unlockRandom(false)} />
          <QuickBtn icon="diamond"      color={GOLD} label="Random rare"    onPress={() => unlockRandom(true)} />
          <QuickBtn icon="terminal"     color={MUTED} label="Print state"    onPress={printState} />
        </View>

        {/* Mode toggle */}
        <View style={s.modeRow}>
          <Pressable
            onPress={() => setMode('force')}
            style={[s.modeTab, mode === 'force' && s.modeTabActive]}
          >
            <Text style={[s.modeTabText, mode === 'force' && s.modeTabTextActive]}>Force Unlock / Remove</Text>
          </Pressable>
          <Pressable
            onPress={() => setMode('sim')}
            style={[s.modeTab, mode === 'sim' && s.modeTabActive]}
          >
            <Text style={[s.modeTabText, mode === 'sim' && s.modeTabTextActive]}>Simulate Scan</Text>
          </Pressable>
        </View>

        {/* Sim control panel */}
        {mode === 'sim' && (
          <View style={s.simPanel}>
            <Text style={s.simHint}>
              Builds a realistic mock scan for the selected Diamond and runs it through the REAL matcher.
              The Diamond only unlocks if the matcher actually matches it.
            </Text>
            <Text style={s.simSelected}>
              {selectedSimId ? `Selected: ${BY_ID[selectedSimId].title}` : 'Tap a Diamond below to select it.'}
            </Text>
            <View style={s.sourceRow}>
              <Text style={s.sourceLabel}>Save from:</Text>
              {(['scan', 'hunt'] as const).map(src => (
                <Pressable key={src} onPress={() => setSimSource(src)}
                  style={[s.sourceChip, simSource === src && s.sourceChipActive]}>
                  <Text style={[s.sourceChipText, simSource === src && s.sourceChipTextActive]}>
                    {src === 'scan' ? 'Normal scan' : 'Hunt save'}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Pressable onPress={runSim}
              style={({ pressed }) => [s.runBtn, pressed && { opacity: 0.8 }, !selectedSimId && { opacity: 0.4 }]}>
              <MaterialIcons name="play-arrow" size={16} color="#06110A" />
              <Text style={s.runBtnText}>Run simulated scan</Text>
            </Pressable>

            {simResult && (
              <View style={[s.resultCard, { borderColor: simResult.pass ? GREEN : RED }]}>
                <Text style={[s.resultVerdict, { color: simResult.pass ? GREEN : RED }]}>
                  {simResult.pass ? '✓ PASS' : '✗ FAIL'}  ·  {simResult.source === 'scan' ? 'Normal scan' : 'Hunt save'}
                </Text>
                <Text style={s.resultLine}><Text style={s.resultKey}>Expected: </Text>{simResult.expectedTitle}</Text>
                <Text style={s.resultLine}>
                  <Text style={s.resultKey}>Actually unlocked: </Text>
                  {simResult.actualIds.length
                    ? simResult.actualIds.map(id => BY_ID[id]?.title ?? id).join(', ')
                    : '(nothing — would not unlock)'}
                </Text>
                {simResult.extras.length > 0 && (
                  <Text style={[s.resultLine, { color: GOLD }]}>
                    <Text style={s.resultKey}>⚠ Also matched: </Text>
                    {simResult.extras.map(id => BY_ID[id]?.title ?? id).join(', ')}
                  </Text>
                )}
                <Text style={s.resultWhy}>Mock scan fed to matcher:</Text>
                <Text style={s.resultMock}>
                  brand: {simResult.fields.brand || '—'}{'\n'}
                  item: {simResult.fields.itemName}{'\n'}
                  category: {simResult.fields.category}{'\n'}
                  era: {simResult.fields.era || '—'}{'\n'}
                  material: {simResult.fields.material || '—'}{'\n'}
                  styleLabels: {simResult.fields.styleLabels.join(', ') || '—'}
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Search */}
        <View style={s.searchBox}>
          <MaterialIcons name="search" size={18} color={MUTED} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={`Search ${TOTAL_DIAMONDS} Diamonds…`}
            placeholderTextColor={MUTED}
            style={s.searchInput}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery('')} hitSlop={8}>
              <MaterialIcons name="close" size={18} color={MUTED} />
            </Pressable>
          )}
        </View>

        {/* Diamond list */}
        {filtered.map(def => {
          const st = statusOf(def.id);
          const selected = mode === 'sim' && selectedSimId === def.id;
          const isNew = unseenDiamondIds.includes(def.id);
          return (
            <Pressable
              key={def.id}
              onPress={() => onRowTap(def)}
              style={({ pressed }) => [
                s.row,
                selected && s.rowSelected,
                pressed && { opacity: 0.75 },
              ]}
            >
              <View style={[s.statusDot, {
                backgroundColor: st === 'real' ? GREEN : st === 'dev' ? GOLD : LINE,
              }]} />
              <View style={{ flex: 1 }}>
                <Text style={s.rowTitle} numberOfLines={1}>
                  {def.title}{isNew ? '  •NEW' : ''}
                </Text>
                <Text style={s.rowMeta} numberOfLines={1}>
                  {CATEGORY_META[def.category].label} · {def.badge}
                  {def.prestige === 3 ? ' · ★rare' : ''}
                </Text>
              </View>
              <View style={s.rowAction}>
                {mode === 'sim' ? (
                  <MaterialIcons
                    name={selected ? 'radio-button-checked' : 'radio-button-unchecked'}
                    size={20} color={selected ? GREEN : MUTED} />
                ) : st === 'real' ? (
                  <Text style={[s.rowTag, { color: GREEN }]}>REAL</Text>
                ) : st === 'dev' ? (
                  <MaterialIcons name="remove-circle-outline" size={20} color={RED} />
                ) : (
                  <MaterialIcons name="add-circle-outline" size={20} color={BLUE} />
                )}
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function QuickBtn({ icon, color, label, onPress }: {
  icon: string; color: string; label: string; onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.quickBtn, pressed && { opacity: 0.7 }]}>
      <MaterialIcons name={icon as any} size={16} color={color} />
      <Text style={[s.quickLabel, { color }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: DEV_BG },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12,
    paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: LINE,
  },
  headerBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: CARD_BG },
  headerTitle: { fontFamily: FONTS.serif, fontSize: 17, fontWeight: '700', color: TEXT },
  headerSub: { fontSize: 9, letterSpacing: 2, color: RED, marginTop: 1, fontWeight: '700' },

  scroll: { padding: 14 },

  metaCard: { backgroundColor: CARD_BG, borderRadius: 12, borderWidth: 1, borderColor: LINE, padding: 14, marginBottom: 12 },
  metaCount: { textAlign: 'center' },
  metaNum: { fontFamily: FONTS.serif, fontSize: 30, fontWeight: '800', color: GREEN },
  metaDenom: { fontFamily: FONTS.serif, fontSize: 18, color: MUTED },
  metaLabel: { fontSize: 13, color: TEXT },
  metaSub: { textAlign: 'center', color: MUTED, fontSize: 11, marginTop: 4 },

  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  quickBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 9, paddingHorizontal: 11,
    backgroundColor: CARD_BG, borderRadius: 9, borderWidth: 1, borderColor: LINE,
    width: '31.5%',
  },
  quickLabel: { fontSize: 11, fontWeight: '600' },

  modeRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  modeTab: { flex: 1, paddingVertical: 10, borderRadius: 9, borderWidth: 1, borderColor: LINE, backgroundColor: CARD_BG, alignItems: 'center' },
  modeTabActive: { borderColor: GREEN, backgroundColor: '#11261A' },
  modeTabText: { color: MUTED, fontSize: 12, fontWeight: '700' },
  modeTabTextActive: { color: GREEN },

  simPanel: { backgroundColor: CARD_BG, borderRadius: 12, borderWidth: 1, borderColor: LINE, padding: 12, marginBottom: 12 },
  simHint: { color: MUTED, fontSize: 11, lineHeight: 16, marginBottom: 8 },
  simSelected: { color: TEXT, fontSize: 13, fontWeight: '600', marginBottom: 10 },
  sourceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  sourceLabel: { color: MUTED, fontSize: 12 },
  sourceChip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 7, borderWidth: 1, borderColor: LINE },
  sourceChipActive: { borderColor: BLUE, backgroundColor: '#13203A' },
  sourceChipText: { color: MUTED, fontSize: 12, fontWeight: '600' },
  sourceChipTextActive: { color: BLUE },
  runBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: GREEN, paddingVertical: 11, borderRadius: 9,
  },
  runBtnText: { color: '#06110A', fontSize: 13, fontWeight: '800' },

  resultCard: { marginTop: 12, borderWidth: 1, borderRadius: 10, padding: 12, backgroundColor: '#0E0E18' },
  resultVerdict: { fontSize: 14, fontWeight: '800', marginBottom: 6 },
  resultLine: { color: TEXT, fontSize: 12, lineHeight: 18, marginBottom: 2 },
  resultKey: { color: MUTED },
  resultWhy: { color: MUTED, fontSize: 11, marginTop: 8, marginBottom: 2 },
  resultMock: { color: '#B8B8CC', fontSize: 11, lineHeight: 17, fontFamily: 'monospace' },

  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: CARD_BG,
    borderRadius: 9, borderWidth: 1, borderColor: LINE, paddingHorizontal: 11, marginBottom: 10,
  },
  searchInput: { flex: 1, color: TEXT, fontSize: 14, paddingVertical: 10 },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingHorizontal: 12,
    backgroundColor: CARD_BG, borderRadius: 9, borderWidth: 1, borderColor: LINE, marginBottom: 6,
  },
  rowSelected: { borderColor: GREEN, backgroundColor: '#10221A' },
  statusDot: { width: 9, height: 9, borderRadius: 5 },
  rowTitle: { color: TEXT, fontSize: 13, fontWeight: '600' },
  rowMeta: { color: MUTED, fontSize: 10.5, marginTop: 1 },
  rowAction: { width: 44, alignItems: 'flex-end' },
  rowTag: { fontSize: 10, fontWeight: '800', letterSpacing: 1 },
});
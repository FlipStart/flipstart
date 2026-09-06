/**
 * app/dev-purchase-complete.tsx
 *
 * DEVELOPMENT-ONLY preview of the post-purchase panels.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * "Purchase complete" has no route. It is a panel inside ProPaywallModal that
 * replaces the offer once the machine reaches a terminal phase, so the only
 * way to see it is to complete a sandbox purchase and catch it — and the
 * pending-activation variant needs the server to be SLOW, which you cannot
 * arrange on demand. This screen renders the same panels directly.
 *
 * ── It renders the real components ──────────────────────────────────────────
 * ResolutionPanel and AlreadyProPanel are imported from ProPaywallModal, not
 * reimplemented. Their emblem, ornament, type, spacing and button are the
 * production ones, so a change made here is a change you will see on device.
 * The only thing this file supplies is the parchment page around them, which
 * mirrors the modal's own `page` + `scroll` + `column` chrome.
 *
 * ── It cannot buy, grant, or confirm anything ───────────────────────────────
 * No RevenueCat, no entitlement hook, no server call, no navigation into the
 * funnel. It sets a local `phase` string and renders. The buttons call a local
 * no-op that shows which handler fired.
 *
 * ── Production safety ───────────────────────────────────────────────────────
 * Expo Router is file-based, so THIS FILE SHIPS AND ITS ROUTE EXISTS. What
 * protects it is the same three layers dev-monetization.tsx documents:
 *   1. <Stack.Protected guard={__DEV__}> in _layout.tsx blocks navigation
 *   2. this component's own __DEV__ check, for a direct deep link
 *   3. it has no privileged capability to abuse even if reached
 * Unlike the monetization harness there is no server gate, because there is
 * nothing here a server could grant.
 */
import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

import { FONTS } from '@/constants/typography';
import { PW } from '@/components/monetization/paywall/paywallTheme';
import {
  ResolutionPanel, AlreadyProPanel,
} from '@/components/monetization/paywall/ProPaywallModal';

/**
 * Every post-purchase state a user can actually land in.
 *
 * `phase` and `mustResolve` are the two inputs ResolutionPanel branches on;
 * `mustResolve` is true only on a non-dismissible source, which today means
 * the onboarding offer. That combination is why there are three resolution
 * variants rather than two.
 */
const CASES = [
  {
    key: 'unlocked',
    label: 'Pro unlocked',
    when: 'Purchase confirmed by the server. Any paywall.',
    phase: 'unlocked' as const,
    mustResolve: false,
    message: null as string | null,
  },
  {
    key: 'pending',
    label: 'Purchase complete — pending',
    when: 'Paid, server has not confirmed yet. A dismissible paywall.',
    phase: 'pending_activation' as const,
    mustResolve: false,
    message: null,
  },
  {
    key: 'pending_onboarding',
    label: 'Purchase complete — pending (onboarding)',
    when: 'Same, but on the onboarding offer, which has nowhere to close to.',
    phase: 'pending_activation' as const,
    mustResolve: true,
    message: null,
  },
  {
    key: 'pending_message',
    label: 'Purchase complete — with a notice',
    when: 'Pending, and the machine carried a notice through.',
    phase: 'pending_activation' as const,
    mustResolve: false,
    message: 'Your receipt is being verified. This usually takes a few seconds.',
  },
  {
    key: 'already_pro',
    label: 'Already a member',
    when: 'A Pro account opened a paywall.',
    phase: null,
    mustResolve: false,
    message: null,
  },
] as const;

type CaseKey = (typeof CASES)[number]['key'];

export default function DevPurchaseCompleteScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [active, setActive] = useState<CaseKey>('unlocked');
  const [lastAction, setLastAction] = useState<string | null>(null);

  // Layer 2: a direct deep link in a release build renders nothing.
  if (!__DEV__) return null;

  const current = CASES.find(c => c.key === active)!;

  return (
    <View style={[s.root, { paddingTop: Math.max(insets.top, 12) }]}>
      {/* ── Controls ──────────────────────────────────────────────────── */}
      <View style={s.bar}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={({ pressed }) => [s.back, pressed && { opacity: 0.6 }]}
        >
          <MaterialIcons name="close" size={22} color={PW.forest} />
        </Pressable>
        <Text style={s.barTitle}>Purchase Complete (Dev)</Text>
        <View style={s.back} />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tabs}>
        {CASES.map(c => (
          <Pressable
            key={c.key}
            onPress={() => { setActive(c.key); setLastAction(null); }}
            accessibilityRole="button"
            accessibilityState={{ selected: active === c.key }}
            style={({ pressed }) => [s.tab, active === c.key && s.tabOn, pressed && { opacity: 0.85 }]}
          >
            <Text style={[s.tabText, active === c.key && s.tabTextOn]} numberOfLines={1}>{c.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <Text style={s.when}>{current.when}</Text>

      {/* ── The real panel, on the modal's own parchment page ─────────── */}
      <ScrollView style={s.stage} contentContainerStyle={s.stageContent}>
        <View style={s.column}>
          {current.phase === null ? (
            <AlreadyProPanel onContinue={() => setLastAction('onContinue (Already a member)')} />
          ) : (
            <ResolutionPanel
              phase={current.phase}
              message={current.message}
              mustResolve={current.mustResolve}
              onContinue={() => setLastAction('onContinue — production: consumeUnlock() then dismiss(true)')}
              onClose={() => setLastAction(
                current.mustResolve
                  ? 'onClose — production: onPendingActivation() → completes as activation_pending'
                  : 'onClose — production: dismiss(false)',
              )}
            />
          )}
        </View>
      </ScrollView>

      {/* ── What the tapped button does in production ─────────────────── */}
      <View style={[s.foot, { paddingBottom: Math.max(insets.bottom, 12) + 8 }]}>
        <Text style={s.footLabel}>LAST ACTION</Text>
        <Text style={s.footText}>
          {lastAction ?? 'Tap the panel button — nothing is purchased, granted or navigated.'}
        </Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: PW.parchment },

  bar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, height: 44 },
  back: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  barTitle: { flex: 1, textAlign: 'center', fontFamily: FONTS.serif, fontSize: 15, fontWeight: '800', color: PW.forest },

  tabs: { paddingHorizontal: 14, gap: 8, paddingVertical: 6 },
  tab: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999,
    borderWidth: 1.25, borderColor: PW.border, backgroundColor: PW.card,
  },
  tabOn: { backgroundColor: PW.forest, borderColor: PW.forest },
  tabText: { fontSize: 12, fontWeight: '700', color: PW.ink },
  tabTextOn: { color: PW.cream },

  when: { paddingHorizontal: 18, paddingTop: 4, paddingBottom: 8, fontSize: 11.5, lineHeight: 16, color: PW.brown, fontStyle: 'italic' },

  /** Mirrors ProPaywallModal's page + scroll + column chrome. */
  stage: { flex: 1 },
  stageContent: { paddingHorizontal: 20, paddingVertical: 12, flexGrow: 1, justifyContent: 'center' },
  column: { width: '100%', maxWidth: 460, alignSelf: 'center' },

  foot: { paddingHorizontal: 18, paddingTop: 10, borderTopWidth: 1, borderTopColor: PW.border, gap: 3 },
  footLabel: { fontFamily: FONTS.serif, fontSize: 8.5, fontWeight: '800', letterSpacing: 1.5, color: PW.brown },
  footText: { fontSize: 12, lineHeight: 16.5, color: PW.ink, fontWeight: '500' },
});
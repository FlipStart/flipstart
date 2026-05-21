/**
 * app/hunt-xp-reveal.tsx
 *
 * Pass 3C — XP Reveal Screen
 *
 * Full-screen route shown between hunt-active (save) and hunt-complete.
 * Hosts XpBreakdownOverlay. When user taps Continue or X, navigates
 * to hunt-complete using the same bundleId param.
 *
 * XP duplication is impossible — applyHuntXp already ran in hunt-active.
 * This screen is display-only.
 */

import { View, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef } from 'react';

import { XpBreakdownOverlay } from '@/components/hunt/XpBreakdownOverlay';
import { consumeLastCompletionResult } from '@/lib/huntXp';
import type { HuntXpResult } from '@/lib/huntXp';

// ─── Component ────────────────────────────────────────────────────────────────

export default function HuntXpRevealScreen() {
  const router   = useRouter();
  const params   = useLocalSearchParams<{ bundleId?: string }>();
  const bundleId = params.bundleId ?? '';

  // Consume XP result once — clears module memory after read.
  // If the screen is re-mounted (hot reload, background), result is null
  // → fallback: navigate directly to hunt-complete so user isn't stuck.
  const xpResultRef = useRef<HuntXpResult | null>(consumeLastCompletionResult());
  const navigated   = useRef(false);

  const goToComplete = () => {
    if (navigated.current) return;   // prevent double-navigation on rapid taps
    navigated.current = true;
    router.replace(`/hunt-complete?bundleId=${bundleId}` as any);
  };

  // Fallback: if XP result lost (hot reload / app restart), skip straight to completion
  if (!xpResultRef.current) {
    // Navigate in next tick so we don't call replace inside render
    setTimeout(goToComplete, 0);
    return <View style={s.root} />;
  }

  return (
    <View style={s.root}>
      <XpBreakdownOverlay
        result={xpResultRef.current}
        bundleId={bundleId}
        onContinue={goToComplete}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#1A3320' },
});
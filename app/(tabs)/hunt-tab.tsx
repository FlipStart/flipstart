/**
 * app/(tabs)/hunt-tab.tsx
 * The Hunt Mode tab target. Keeps the bottom tab bar visible.
 *
 *  • Guest      → shows the in-app account gate (FeatureGate).
 *  • Signed in  → redirects to the full-screen Hunt Mode gameplay (/hunt),
 *                 which is unchanged.
 *
 * Guests reach this via the tab bar (navigation.navigate('hunt-tab')); signed-in
 * users are sent straight to /hunt by the tab bar, so they normally never render
 * this screen — the redirect here is just a safety net for state restoration.
 */

import { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { useAuth } from '@/lib/auth-context';
import FeatureGate from '@/components/FeatureGate';

export default function HuntTabScreen() {
  const router    = useRouter();
  const isFocused = useIsFocused();
  const { user, loading } = useAuth();

  // Only redirect to gameplay when THIS tab is actually focused.
  // Without the isFocused guard, any login from any gate (including Progress)
  // makes user truthy, this effect fires on ALL mounted tabs, and
  // router.replace('/hunt') overrides whatever destination was intended.
  useEffect(() => {
    if (!loading && user && isFocused) router.replace('/hunt' as any);
  }, [loading, user, isFocused, router]);

  if (loading || user) {
    return (
      <View style={{ flex: 1, backgroundColor: '#F0E8D4', justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color="#2A4A2A" />
      </View>
    );
  }

  return (
    <FeatureGate
      icon="travel-explore"
      title="Hunt Mode"
      subtitle="Turn thrift trips into a game."
      body="Create a free FlipStart account to save XP, ranks, streaks, and hunt progress across every session."
      benefits={[
        'Save Hunt Mode sessions',
        'Build XP and ranks',
        'Keep streaks across devices',
      ]}
      returnTo="hunt"
    />
  );
}
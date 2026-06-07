/**
 * app/auth/callback.tsx
 * Registered route for flipstart://auth/callback deep links.
 * Handles email OTP confirmation (?token_hash=xxx&type=email).
 * Shows a spinner while AuthProvider resolves the session, then routes.
 */

import { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@/lib/auth-context';

export default function AuthCallbackScreen() {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (user) { router.replace('/(tabs)' as any); }
    else       { router.replace('/auth' as any); }
  }, [user, loading]);

  return (
    <View style={s.root}>
      <ActivityIndicator size="large" color="#2A4A2A" />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F0E8D4' },
});
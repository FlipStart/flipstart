/**
 * app/auth/reset.tsx
 * Registered route for flipstart://auth/reset deep links (password recovery).
 *
 * SAFETY (respects the prior TestFlight startup-crash history):
 *   - This is a ROUTE screen. Its token handling runs ONLY when the user opens
 *     the reset link and this screen mounts — never at app startup.
 *   - _layout.tsx is NOT touched and no global deep-link handler is enabled.
 *   - supabase is imported the same way auth.tsx already does (stable in prod).
 *   - Recovery tokens are never logged, stored in AsyncStorage, or sent to
 *     analytics. Passwords are never logged or included in errors.
 *
 * FLOW (project uses Supabase flowType: 'pkce', detectSessionInUrl: false):
 *   - PKCE reset links arrive as ?code=... → exchangeCodeForSession(code).
 *   - Defensive fallbacks also handle token_hash+type=recovery and
 *     access_token/refresh_token, and parse URL hash fragments, in case the
 *     email template/version differs.
 */

import { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, ScrollView, Platform,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as Linking from 'expo-linking';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { supabase } from '@/lib/supabase';

// Palette — matches app/auth.tsx
const FOREST = '#2A4A2A';
const CREAM  = '#F4EED8';
const PAGE   = '#F0E8D4';
const MUTED  = '#8A7050';
const BORDER = '#C8B88A';
const DANGER = '#9E3A2A';

const MIN_PASSWORD_LEN = 8;

type Phase = 'verifying' | 'invalid' | 'ready' | 'success';

// ── Safe param parsing — query string + hash fragment, never throws, no logs ──
interface AuthLinkParams {
  code?: string;
  token_hash?: string;
  type?: string;
  access_token?: string;
  refresh_token?: string;
  error_description?: string;
}

function parseAuthLinkParams(url: string | null): AuthLinkParams {
  const out: AuthLinkParams = {};
  if (!url) return out;
  try {
    // Query params via expo-linking
    const parsed = Linking.parse(url);
    const q = (parsed.queryParams ?? {}) as Record<string, unknown>;
    const take = (k: keyof AuthLinkParams) => {
      const v = q[k];
      if (typeof v === 'string' && v.length) out[k] = v;
    };
    take('code'); take('token_hash'); take('type');
    take('access_token'); take('refresh_token'); take('error_description');

    // Hash fragment params (Supabase sometimes uses #access_token=...&...)
    const hashIdx = url.indexOf('#');
    if (hashIdx >= 0) {
      const frag = url.slice(hashIdx + 1);
      for (const pair of frag.split('&')) {
        const eq = pair.indexOf('=');
        if (eq < 0) continue;
        const key = decodeURIComponent(pair.slice(0, eq));
        const val = decodeURIComponent(pair.slice(eq + 1));
        if (!val) continue;
        if (key === 'code' && !out.code) out.code = val;
        else if (key === 'token_hash' && !out.token_hash) out.token_hash = val;
        else if (key === 'type' && !out.type) out.type = val;
        else if (key === 'access_token' && !out.access_token) out.access_token = val;
        else if (key === 'refresh_token' && !out.refresh_token) out.refresh_token = val;
        else if (key === 'error_description' && !out.error_description) out.error_description = val;
      }
    }
  } catch {
    /* never throw on a malformed link */
  }
  return out;
}

export default function ResetPasswordScreen() {
  const router = useRouter();
  const routeParams = useLocalSearchParams<{
    code?: string; token_hash?: string; type?: string;
    access_token?: string; refresh_token?: string;
  }>();

  const [phase, setPhase]       = useState<Phase>('verifying');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm]   = useState('');
  const [error, setError]       = useState<string | null>(null);
  const [saving, setSaving]     = useState(false);
  const verifiedRef = useRef(false); // guard: verify exactly once

  // ── Step 1: establish the recovery session from the link (on mount only) ──
  useEffect(() => {
    if (verifiedRef.current) return;
    verifiedRef.current = true;

    let cancelled = false;

    (async () => {
      try {
        if (!supabase) { if (!cancelled) setPhase('invalid'); return; }

        // Gather params from the router first, then fall back to the raw initial
        // URL (covers cold start + hash fragments the router doesn't expose).
        let p: AuthLinkParams = {
          code:          typeof routeParams.code === 'string' ? routeParams.code : undefined,
          token_hash:    typeof routeParams.token_hash === 'string' ? routeParams.token_hash : undefined,
          type:          typeof routeParams.type === 'string' ? routeParams.type : undefined,
          access_token:  typeof routeParams.access_token === 'string' ? routeParams.access_token : undefined,
          refresh_token: typeof routeParams.refresh_token === 'string' ? routeParams.refresh_token : undefined,
        };
        if (!p.code && !p.token_hash && !p.access_token) {
          const initialUrl = await Linking.getInitialURL().catch(() => null);
          const fromUrl = parseAuthLinkParams(initialUrl);
          p = { ...fromUrl, ...stripUndefined(p) };
        }

        // Preferred (this project): PKCE code exchange.
        if (p.code) {
          const { error: err } = await supabase.auth.exchangeCodeForSession(p.code);
          if (!cancelled) setPhase(err ? 'invalid' : 'ready');
          return;
        }

        // Fallback: token_hash + type=recovery (OTP verification).
        if (p.token_hash) {
          const { error: err } = await supabase.auth.verifyOtp({
            token_hash: p.token_hash,
            type: (p.type as any) || 'recovery',
          });
          if (!cancelled) setPhase(err ? 'invalid' : 'ready');
          return;
        }

        // Fallback: explicit access/refresh tokens.
        if (p.access_token && p.refresh_token) {
          const { error: err } = await supabase.auth.setSession({
            access_token: p.access_token,
            refresh_token: p.refresh_token,
          });
          if (!cancelled) setPhase(err ? 'invalid' : 'ready');
          return;
        }

        // Nothing usable in the link.
        if (!cancelled) setPhase('invalid');
      } catch {
        if (!cancelled) setPhase('invalid');
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Step 2: update the password ──
  const handleUpdate = async () => {
    if (saving) return;
    setError(null);
    if (!password || !confirm) { setError('Please enter and confirm your new password.'); return; }
    if (password.length < MIN_PASSWORD_LEN) {
      setError(`Password must be at least ${MIN_PASSWORD_LEN} characters.`); return;
    }
    if (password !== confirm) { setError('Passwords do not match.'); return; }

    setSaving(true);
    try {
      if (!supabase) { setError('Something went wrong. Please request a new reset link.'); setSaving(false); return; }
      const { error: err } = await supabase.auth.updateUser({ password });
      if (err) {
        // Never include the password; surface a safe message.
        setError(err.message || 'Could not update password. Please try again.');
        setSaving(false);
        return;
      }
      // Sign out the temporary recovery session so the user logs in fresh.
      await supabase.auth.signOut().catch(() => {});
      setPhase('success');
    } catch {
      setError('Could not update password. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const goToLogin = () => {
    router.replace({ pathname: '/auth', params: { mode: 'login' } } as any);
  };

  // ── Render ──
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={s.root} keyboardShouldPersistTaps="handled">
        <View style={s.headerBlock}>
          <Text style={s.wordmark}>FlipStart</Text>
        </View>

        {phase === 'verifying' && (
          <View style={s.centerBlock}>
            <ActivityIndicator size="large" color={FOREST} />
            <Text style={s.body}>Verifying reset link…</Text>
          </View>
        )}

        {phase === 'invalid' && (
          <View style={s.centerBlock}>
            <MaterialIcons name="link-off" size={44} color={MUTED} />
            <Text style={s.title}>Link invalid or expired</Text>
            <Text style={s.body}>
              This reset link is invalid or expired. Please request a new password reset email.
            </Text>
            <Pressable onPress={goToLogin} style={({ pressed }) => [s.primaryBtn, pressed && { opacity: 0.85 }]}>
              <Text style={s.primaryBtnText}>Back to Log In</Text>
            </Pressable>
          </View>
        )}

        {phase === 'ready' && (
          <>
            <Text style={s.title}>Set New Password</Text>
            <Text style={[s.body, { marginBottom: 18 }]}>
              Enter a new password for your FlipStart account.
            </Text>

            {error && (
              <View style={s.errorBox}>
                <MaterialIcons name="error-outline" size={14} color="#721C24" />
                <Text style={s.errorText}>{error}</Text>
              </View>
            )}

            <TextInput
              style={s.input}
              placeholder="New password"
              placeholderTextColor={MUTED}
              value={password}
              onChangeText={v => { setPassword(v); setError(null); }}
              secureTextEntry autoCapitalize="none" autoCorrect={false} editable={!saving}
            />
            <TextInput
              style={s.input}
              placeholder="Confirm new password"
              placeholderTextColor={MUTED}
              value={confirm}
              onChangeText={v => { setConfirm(v); setError(null); }}
              secureTextEntry autoCapitalize="none" autoCorrect={false} editable={!saving}
            />
            <Text style={s.hint}>At least {MIN_PASSWORD_LEN} characters.</Text>

            <Pressable onPress={handleUpdate} disabled={saving}
              style={({ pressed }) => [s.primaryBtn, (pressed || saving) && { opacity: 0.8 }]}>
              {saving ? <ActivityIndicator color={CREAM} /> : <Text style={s.primaryBtnText}>Update Password</Text>}
            </Pressable>

            <Pressable onPress={goToLogin} disabled={saving} style={({ pressed }) => [s.switchBtn, pressed && { opacity: 0.6 }]}>
              <Text style={s.switchText}>Cancel — <Text style={s.switchTextBold}>Back to Log In</Text></Text>
            </Pressable>
          </>
        )}

        {phase === 'success' && (
          <View style={s.centerBlock}>
            <MaterialIcons name="check-circle" size={48} color={FOREST} />
            <Text style={s.title}>Password Updated</Text>
            <Text style={s.body}>
              Your password has been updated. You can now log in with your new password.
            </Text>
            <Pressable onPress={goToLogin} style={({ pressed }) => [s.primaryBtn, pressed && { opacity: 0.85 }]}>
              <Text style={s.primaryBtnText}>Back to Log In</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k in o) if (o[k] !== undefined) out[k] = o[k];
  return out;
}

const s = StyleSheet.create({
  root: { flexGrow: 1, backgroundColor: PAGE, paddingHorizontal: 28, paddingTop: 80, paddingBottom: 40, justifyContent: 'flex-start' },
  headerBlock: { alignItems: 'center', marginBottom: 28 },
  wordmark: { fontSize: 30, fontWeight: '800', color: FOREST, letterSpacing: 0.5 },
  centerBlock: { alignItems: 'center', gap: 14, marginTop: 20 },
  title: { fontSize: 22, fontWeight: '800', color: FOREST, textAlign: 'center', marginBottom: 8 },
  body: { fontSize: 15, color: MUTED, textAlign: 'center', lineHeight: 22 },
  hint: { fontSize: 12, color: MUTED, marginBottom: 14, marginLeft: 4 },
  input: {
    backgroundColor: CREAM, borderWidth: 1, borderColor: BORDER, borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, color: '#3D2A12', marginBottom: 12,
  },
  primaryBtn: {
    backgroundColor: FOREST, borderRadius: 12, paddingVertical: 15, alignItems: 'center',
    marginTop: 6, minWidth: 200, alignSelf: 'stretch',
  },
  primaryBtnText: { color: CREAM, fontSize: 16, fontWeight: '700' },
  switchBtn: { alignItems: 'center', paddingVertical: 14 },
  switchText: { fontSize: 14, color: MUTED },
  switchTextBold: { color: FOREST, fontWeight: '700' },
  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#F8D7DA',
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12,
  },
  errorText: { color: '#721C24', fontSize: 13, flex: 1 },
});
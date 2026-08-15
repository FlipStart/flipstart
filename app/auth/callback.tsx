/**
 * app/auth/callback.tsx
 * Registered route for flipstart://auth/callback deep links — email confirmation.
 *
 * When a user taps the "Confirm your email" link, the app opens here. We:
 *   1. Try to process the confirmation token (PKCE 'code', or token_hash+type),
 *      so the account is definitively confirmed.
 *   2. Show a clear "Email confirmed" success screen telling them to log in.
 *   3. "Log In" routes straight to the login form (not the onboarding intro).
 *
 * SAFETY (respects the TestFlight startup-crash history):
 *   - This is a ROUTE screen; token handling runs only on mount, never at boot.
 *   - _layout.tsx is untouched; no global deep-link handler enabled.
 *   - Tokens are never logged or stored.
 *
 * NOTE: This is the EMAIL CONFIRMATION route. Password recovery has its own
 * dedicated route at app/auth/reset.tsx — the two are kept separate.
 */

import { useEffect, useRef, useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, ActivityIndicator, ScrollView,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as Linking from 'expo-linking';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { supabase } from '@/lib/supabase';
import { sanitizeAuthError } from '@/lib/authErrors';
import { claimAuthCode } from '@/lib/oauthCodeClaim';

const FOREST = '#2A4A2A';
const CREAM  = '#F4EED8';
const PAGE   = '#F0E8D4';
const MUTED  = '#8A7050';

type Phase = 'verifying' | 'confirmed' | 'invalid';

interface LinkParams {
  code?: string;
  token_hash?: string;
  type?: string;
}

function parseLink(url: string | null): LinkParams {
  const out: LinkParams = {};
  if (!url) return out;
  try {
    const parsed = Linking.parse(url);
    const q = (parsed.queryParams ?? {}) as Record<string, unknown>;
    const take = (k: keyof LinkParams) => {
      const v = q[k];
      if (typeof v === 'string' && v.length) out[k] = v;
    };
    take('code'); take('token_hash'); take('type');
    const hashIdx = url.indexOf('#');
    if (hashIdx >= 0) {
      for (const pair of url.slice(hashIdx + 1).split('&')) {
        const eq = pair.indexOf('=');
        if (eq < 0) continue;
        const key = decodeURIComponent(pair.slice(0, eq));
        const val = decodeURIComponent(pair.slice(eq + 1));
        if (!val) continue;
        if (key === 'code' && !out.code) out.code = val;
        else if (key === 'token_hash' && !out.token_hash) out.token_hash = val;
        else if (key === 'type' && !out.type) out.type = val;
      }
    }
  } catch { /* never throw on a bad link */ }
  return out;
}

export default function AuthCallbackScreen() {
  const router = useRouter();
  const routeParams = useLocalSearchParams<{ code?: string; token_hash?: string; type?: string }>();
  const [phase, setPhase] = useState<Phase>('verifying');
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    let cancelled = false;

    (async () => {
      try {
        if (!supabase) { if (!cancelled) setPhase('confirmed'); return; }

        let p: LinkParams = {
          code:       typeof routeParams.code === 'string' ? routeParams.code : undefined,
          token_hash: typeof routeParams.token_hash === 'string' ? routeParams.token_hash : undefined,
          type:       typeof routeParams.type === 'string' ? routeParams.type : undefined,
        };
        if (!p.code && !p.token_hash) {
          const initial = await Linking.getInitialURL().catch(() => null);
          const fromUrl = parseLink(initial);
          p = { code: p.code ?? fromUrl.code, token_hash: p.token_hash ?? fromUrl.token_hash, type: p.type ?? fromUrl.type };
        }

        let ok = false;
        if (p.code) {
          /**
           * DO NOT exchange a code that the OAuth flow already handled.
           *
           * Google's redirectTo is `flipstart://auth/callback`, which is also
           * this Expo Router route. So one deep link produced TWO exchanges:
           * app/auth.tsx did it inline (with the PKCE verifier it created) and
           * then this screen mounted and did it again. Supabase deletes the
           * verifier after a successful exchange, so the second attempt failed
           * with "PKCE code verifier not found in storage" — which was then
           * printed verbatim in the login form.
           *
           * An existing session means the first exchange won. Standing down is
           * the fix; there is nothing left for this screen to do.
           */
          /**
           * Claim, or stand down.
           *
           * The claim is synchronous, so if app/auth.tsx already owns this code
           * — including while its exchange is still awaiting — this returns
           * false and no second exchange happens. That replaces the previous
           * getSession() check, which was check-then-act and could let both
           * paths through if callback.tsx mounted mid-flight.
           *
           * Claiming SUCCEEDS only when auth.tsx never ran: the app was killed
           * mid-OAuth and this deep link cold-started it. Owning the exchange
           * there is correct, because auth.tsx's promise is gone.
           */
          if (!claimAuthCode(p.code)) {
            if (__DEV__) console.log("[auth/callback] code owned by the sign-in screen — standing down");
            if (!cancelled) setPhase("confirmed");
            return;
          }
          const { error } = await supabase.auth.exchangeCodeForSession(p.code);
          ok = !error;
          // A failed exchange here is almost always the duplicate above losing a
          // race. Never surface it: classify, log, and show the neutral screen.
          if (error) sanitizeAuthError(error);
        } else if (p.token_hash) {
          const { error } = await supabase.auth.verifyOtp({
            token_hash: p.token_hash,
            type: (p.type as any) || 'email',
          });
          ok = !error;
        } else {
          ok = true;
        }

        /**
         * signOut ONLY for the email-confirmation path.
         *
         * This used to run unconditionally, so a Google sign-in that reached
         * this screen would have its brand-new session destroyed — turning a
         * successful login into an immediate logout. Email confirmation genuinely
         * wants it (confirm the address, then sign in deliberately); OAuth
         * absolutely does not.
         */
        if (p.token_hash) {
          await supabase.auth.signOut().catch(() => {});
        }

        if (!cancelled) setPhase(ok ? 'confirmed' : 'invalid');
      } catch {
        if (!cancelled) setPhase('invalid');
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const goToLogin = () => {
    router.replace({ pathname: '/auth', params: { mode: 'login' } } as any);
  };

  return (
    <ScrollView contentContainerStyle={s.root}>
      <View style={s.headerBlock}>
        <Text style={s.wordmark}>FlipStart</Text>
      </View>

      {phase === 'verifying' && (
        <View style={s.center}>
          <ActivityIndicator size="large" color={FOREST} />
          <Text style={s.body}>Confirming your email…</Text>
        </View>
      )}

      {phase === 'confirmed' && (
        <View style={s.center}>
          <MaterialIcons name="check-circle" size={52} color={FOREST} />
          <Text style={s.title}>Email confirmed</Text>
          <Text style={s.body}>
            Your FlipStart account is active. Log in with the email and password you just created to continue.
          </Text>
          <Pressable onPress={goToLogin} style={({ pressed }) => [s.primaryBtn, pressed && { opacity: 0.85 }]}>
            <Text style={s.primaryBtnText}>Log In</Text>
          </Pressable>
          <Text style={s.welcome}>Welcome to FlipStart.</Text>
        </View>
      )}

      {phase === 'invalid' && (
        <View style={s.center}>
          <MaterialIcons name="link-off" size={44} color={MUTED} />
          <Text style={s.title}>Link expired</Text>
          <Text style={s.body}>
            This confirmation link is invalid or has expired. If your account isn't active yet, try logging in — or request a new confirmation email.
          </Text>
          <Pressable onPress={goToLogin} style={({ pressed }) => [s.primaryBtn, pressed && { opacity: 0.85 }]}>
            <Text style={s.primaryBtnText}>Go to Log In</Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flexGrow: 1, backgroundColor: PAGE, paddingHorizontal: 28, paddingTop: 90, paddingBottom: 40, justifyContent: 'flex-start' },
  headerBlock: { alignItems: 'center', marginBottom: 30 },
  wordmark: { fontSize: 30, fontWeight: '800', color: FOREST, letterSpacing: 0.5 },
  center: { alignItems: 'center', gap: 14 },
  title: { fontSize: 23, fontWeight: '800', color: FOREST, textAlign: 'center', marginTop: 4 },
  body: { fontSize: 15, color: MUTED, textAlign: 'center', lineHeight: 22, paddingHorizontal: 6 },
  primaryBtn: { backgroundColor: FOREST, borderRadius: 12, paddingVertical: 15, alignItems: 'center', alignSelf: 'stretch', marginTop: 10 },
  primaryBtnText: { color: CREAM, fontSize: 16, fontWeight: '700' },
  welcome: { fontSize: 13, color: MUTED, marginTop: 6, fontStyle: 'italic' },
});
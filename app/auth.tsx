/**
 * app/auth.tsx
 * Sign Up / Log In / Check Email confirmation screen.
 *
 * Modes: 'signup' | 'login' | 'confirm'
 * Reached via router.push('/auth') with optional ?mode=login param.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, Pressable, TextInput,
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams, useRouter } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { supabase } from '@/lib/supabase';
import { completeOnboarding } from '@/lib/onboarding-storage';
import { takeAuthReturnDest } from '@/lib/authReturn';
import { useAuth } from '@/lib/auth-context';
import { PENDING_USERNAME_KEY } from '@/lib/auth-context';
import { FONTS } from '@/constants/typography';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';

// Complete any pending auth sessions on mount (required by expo-web-browser)
WebBrowser.maybeCompleteAuthSession();

const FOREST    = '#2A4A2A';
const SCAN_DARK = '#152815';
const CREAM     = '#F4EED8';
const PARCHMENT = '#F0E8D4';
const CARD_B    = '#DDD0B0';
const BROWN     = '#5A3A1A';
const MUTED     = '#8A7050';
const GOLD      = '#BE9C2C';

export default function AuthScreen() {
  const router  = useRouter();
  const insets  = useSafeAreaInsets();
  const params  = useLocalSearchParams<{ mode?: string; authEntryPoint?: string }>();
  const { refreshProfile } = useAuth();

  // Entry context — drives whether the landing screen + guest skip are shown,
  // and where "back" goes. 'settings' = simple Log In/Create Account that returns
  // to Settings. 'onboarding' = full landing with guest skip, part of onboarding.
  const entryPoint: 'settings' | 'onboarding' =
    params.authEntryPoint === 'settings' ? 'settings' : 'onboarding';
  const fromSettings = entryPoint === 'settings';

  // After a successful auth, where to send the user.
  // - Settings: auth was pushed on top of Settings, so back() returns there cleanly.
  // - Feature gate: use the destination set in lib/authReturn by the gate.
  // - Onboarding / everything else: replace to the tab root.
  const goAfterAuth = useCallback(() => {
    if (fromSettings) {
      router.back();
      return;
    }
    const dest = takeAuthReturnDest() ?? '/(tabs)';
    router.replace(dest as any);
  }, [router, fromSettings]);

  const [mode, setMode] = useState<'entry' | 'signup' | 'login' | 'confirm'>(
    // From Settings we never show the landing — jump straight to the form.
    params.mode === 'login'  ? 'login'  :
    params.mode === 'signup' ? 'signup' :
    fromSettings             ? 'login'  :
    'entry'  // onboarding default: show polished entry landing
  );
  // True only when the user reached a form via the in-screen entry landing (the
  // Hunt/Progress guest-gate path). In that case "back" returns to the landing.
  // When the form was opened directly (Settings or the onboarding quiz screen),
  // "back" must return to whoever pushed us (router.back()).
  const [cameFromLanding, setCameFromLanding] = useState(false);
  const [email,        setEmail]        = useState('');
  const [password,     setPassword]     = useState('');
  const [username,     setUsername]     = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [saving,       setSaving]       = useState(false);
  const [resending,    setResending]    = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const [resendMsg,    setResendMsg]    = useState<string | null>(null);
  const [cooldown,     setCooldown]     = useState(0);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleError,   setGoogleError]   = useState<string | null>(null);
  // 'idle' | 'opening' | 'signing' | 'loading'
  const [appleStep,     setAppleStep]     = useState<'idle'|'opening'|'signing'|'loading'>('idle');
  const [appleError,    setAppleError]    = useState<string | null>(null);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Username availability
  const [unameStatus, setUnameStatus] = useState<'idle'|'checking'|'available'|'taken'|'invalid'>('idle');
  const unameDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Username: 3–24 chars, letters/numbers/underscores/periods/hyphens,
  // must start+end with letter or number, no consecutive special chars.
  const USERNAME_RE = /^(?!.*[._-]{2})[A-Za-z0-9][A-Za-z0-9._-]{1,22}[A-Za-z0-9]$|^[A-Za-z0-9]{3,4}$/;

  const checkUnameAvailability = useCallback(async (value: string) => {
    if (!USERNAME_RE.test(value)) { setUnameStatus('invalid'); return; }
    setUnameStatus('checking');
    try {
      const { data, error } = await supabase.rpc('check_username_available', { uname: value });
      if (error) { setUnameStatus('idle'); return; }
      setUnameStatus(data === true ? 'available' : 'taken');
    } catch { setUnameStatus('idle'); }
  }, []);

  useEffect(() => {
    if (mode !== 'signup') return;
    const trimmed = username.trim();
    if (!trimmed) { setUnameStatus('idle'); return; }
    if (unameDebounceRef.current) clearTimeout(unameDebounceRef.current);
    setUnameStatus('checking');
    unameDebounceRef.current = setTimeout(() => checkUnameAvailability(trimmed), 600);
    return () => { if (unameDebounceRef.current) clearTimeout(unameDebounceRef.current); };
  }, [username, mode, checkUnameAvailability]);

  useEffect(() => {
    return () => { if (cooldownRef.current) clearInterval(cooldownRef.current); };
  }, []);

  const startCooldown = () => {
    if (cooldownRef.current) clearInterval(cooldownRef.current);
    setCooldown(60);
    cooldownRef.current = setInterval(() => {
      setCooldown(prev => {
        if (prev <= 1) { clearInterval(cooldownRef.current!); cooldownRef.current = null; return 0; }
        return prev - 1;
      });
    }, 1000);
  };

  const clearError = () => { setError(null); setResendMsg(null); };

  // ── Google Sign-In ──────────────────────────────────────────────────────────
  const handleGoogleSignIn = async () => {
    if (googleLoading || saving || appleStep !== 'idle') return;
    setGoogleLoading(true);
    setGoogleError(null);
    try {
      const { data, error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: 'flipstart://auth/callback', skipBrowserRedirect: true },
      });
      if (oauthError || !data?.url) {
        setGoogleError('Could not start Google Sign-In. Please try again.');
        return;
      }
      const result = await WebBrowser.openAuthSessionAsync(data.url, 'flipstart://');
      if (result.type !== 'success') return; // user cancelled — no error

      const parsed = Linking.parse(result.url);
      const code = parsed.queryParams?.code as string | undefined;
      if (!code) {
        setGoogleError('Google Sign-In did not return a code. Please try again.');
        return;
      }
      const { error: sessionError } = await supabase.auth.exchangeCodeForSession(code);
      if (sessionError) {
        setGoogleError(`Sign-In failed: ${sessionError.message}`);
        return;
      }
      // SIGNED_IN fires → AuthProvider → ensureProfile
      // index.tsx profileChecked gate routes to username-setup or home
      await refreshProfile().catch(() => {});
      // Any successful auth catches the device up to the current onboarding
      // version, so the home gate won't bounce a freshly-signed-in user back.
      await completeOnboarding('resell').catch(() => {});
      goAfterAuth();
    } catch (err) {
      setGoogleError('Google Sign-In failed. Please try again.');
    } finally {
      setGoogleLoading(false);
    }
  };

  // ── Apple Sign-In ──────────────────────────────────────────────────────────
  const handleAppleSignIn = async () => {
    if (appleStep !== 'idle' || saving || googleLoading) return; // prevent double-tap / race
    setAppleStep('opening');
    setAppleError(null);
    try {
      const AppleAuth = await import('expo-apple-authentication');

      const available = await AppleAuth.isAvailableAsync();
      if (!available) {
        setAppleError('Apple Sign-In is not available on this device.');
        setAppleStep('idle');
        return;
      }

      // Show native Apple sheet
      const credential = await AppleAuth.signInAsync({
        requestedScopes: [
          AppleAuth.AppleAuthenticationScope.FULL_NAME,
          AppleAuth.AppleAuthenticationScope.EMAIL,
        ],
      });

      setAppleStep('signing'); // sheet returned, now exchange with Supabase

      const { identityToken, fullName } = credential;
      if (!identityToken) {
        setAppleError('Apple Sign-In failed. Please try again.');
        setAppleStep('idle');
        return;
      }

      const { error: sessionError } = await supabase.auth.signInWithIdToken({
        provider: 'apple',
        token:    identityToken,
      });

      if (sessionError) {
        setAppleError(`Sign-In failed: ${sessionError.message}`);
        setAppleStep('idle');
        return;
      }

      setAppleStep('loading'); // session created, loading profile

      // Save full name to metadata on first sign-in (Apple only sends it once)
      if (fullName?.givenName || fullName?.familyName) {
        const displayName = [fullName.givenName, fullName.familyName]
          .filter(Boolean).join(' ');
        supabase.auth.updateUser({ data: { full_name: displayName } }).catch(() => {});
      }

      // Wait for profile to load before navigating
      await refreshProfile().catch(() => {});
      // Catch the device up to the current onboarding version (prevents the
      // home gate from bouncing a freshly-signed-in user back to onboarding).
      await completeOnboarding('resell').catch(() => {});
      goAfterAuth();

    } catch (err: any) {
      if (err?.code === 'ERR_REQUEST_CANCELED' || err?.code === 'ERR_CANCELED') {
        setAppleStep('idle'); // cancelled silently
        return;
      }
      setAppleError('Apple Sign-In failed. Please try again.');
      setAppleStep('idle');
    }
    // Note: don't reset in finally — 'loading' state persists briefly until navigation
  };

  // ── Sign Up ────────────────────────────────────────────────────────────────
  const handleSignUp = async () => {
    const trimEmail    = email.trim().toLowerCase();
    const trimPassword = password.trim();
    const trimUsername = username.trim().toLowerCase();
    if (!trimEmail)    { setError('Email is required.');    return; }
    if (!trimPassword) { setError('Password is required.'); return; }
    if (!trimUsername) { setError('Username is required.'); return; }
    if (trimPassword.length < 6) { setError('Password must be at least 6 characters.'); return; }
    if (!USERNAME_RE.test(trimUsername)) { setError('3–24 characters: letters, numbers, underscores, periods, or hyphens. Must start and end with a letter or number.'); return; }
    if (saving) return;
    setSaving(true); setError(null);
    try {
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: trimEmail, password: trimPassword,
      });
      if (authError) {
        const msg = authError.message.toLowerCase();
        if (msg.includes('already registered')) { setError('__EMAIL_EXISTS__'); }
        else if (msg.includes('rate limit') || msg.includes('too many')) { setError('Too many attempts. Please wait a few minutes.'); }
        else { setError(authError.message); }
        setSaving(false); return;
      }
      // Duplicate email — Supabase returns empty identities array
      if ((authData.user?.identities ?? []).length === 0) {
        setError('__EMAIL_EXISTS__'); setSaving(false); return;
      }
      // Email confirmation required
      if (!authData.session) {
        await AsyncStorage.setItem(PENDING_USERNAME_KEY, trimUsername).catch(() => {});
        setConfirmEmail(trimEmail); setMode('confirm'); startCooldown();
        setSaving(false); return;
      }
      // Confirmation off — insert profile immediately
      const userId = authData.user!.id;
      const { error: profileError } = await supabase.from('profiles').insert({
        id: userId, username: trimUsername, display_name: trimUsername, onboarding_complete: true,
      });
      if (profileError) {
        if (profileError.code === '23505') { setError(`Username "${trimUsername}" is already taken.`); }
        else { setError('Could not save your profile. Please try again.'); }
        setSaving(false); return;
      }
      await completeOnboarding('resell');
      await refreshProfile().catch(() => {});
      goAfterAuth();
    } catch { setError('Something went wrong. Please try again.'); setSaving(false); }
  };

  // ── Log In ─────────────────────────────────────────────────────────────────
  const handleLogin = async () => {
    const trimEmail    = email.trim().toLowerCase();
    const trimPassword = password.trim();
    if (!trimEmail || !trimPassword) { setError('Email and password are required.'); return; }
    if (saving) return;
    setSaving(true); setError(null);
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: trimEmail, password: trimPassword,
      });
      if (authError) {
        const msg = authError.message.toLowerCase();
        if (msg.includes('invalid'))   setError('Incorrect email or password.');
        else if (msg.includes('confirm')) setError('Please confirm your email before logging in. Check your inbox.');
        else setError(authError.message);
        setSaving(false); return;
      }
      await completeOnboarding('resell');
      await refreshProfile().catch(() => {});
      goAfterAuth();
    } catch { setError('Something went wrong. Please try again.'); setSaving(false); }
  };

  // ── Resend ─────────────────────────────────────────────────────────────────
  const handleResend = async () => {
    if (resending || cooldown > 0 || !confirmEmail) return;
    setResending(true); setResendMsg(null);
    try {
      const { error } = await supabase.auth.resend({ type: 'signup', email: confirmEmail });
      if (error) {
        const msg = error.message.toLowerCase();
        setResendMsg(msg.includes('rate') || msg.includes('limit') ? 'Please wait a moment before resending.' : 'Could not resend. Please try again.');
      } else {
        setResendMsg('Email resent! Check your inbox.');
        startCooldown();
      }
    } catch { setResendMsg('Could not resend. Please try again.'); }
    finally { setResending(false); }
  };

  // ── Entry screen — polished account landing ──────────────────────────────────
  if (mode === 'entry') {
    const anyLoading = googleLoading || appleStep !== 'idle';
    return (
      <View style={[e.root, { paddingTop: insets.top }]}>
        <ScrollView
          contentContainerStyle={e.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Back / dismiss */}
          <Pressable onPress={() => router.back()} hitSlop={12}
            style={({ pressed }) => [{ alignSelf: 'flex-start', marginBottom: 8, opacity: pressed ? 0.5 : 1 }]}>
            <MaterialIcons name="close" size={22} color={MUTED} />
          </Pressable>

          {/* Header */}
          <View style={e.headerBlock}>
            <Text style={e.wordmark}>FlipStart</Text>
            <Text style={e.tagline}>Flip smarter.{'\n'}Track everything.</Text>
          </View>

          {/* Benefits */}
          <View style={e.benefitsCard}>
            {[
              { icon: 'sync',           text: 'Sync scans across all your devices'   },
              { icon: 'emoji-events',   text: 'Earn XP, climb ranks, build streaks'  },
              { icon: 'travel-explore', text: 'Save Hunt Mode progress automatically' },
              { icon: 'lock',           text: 'Secure account backup, always safe'   },
            ].map(({ icon, text }) => (
              <View key={text} style={e.benefitRow}>
                <MaterialIcons name={icon as any} size={18} color={GOLD} />
                <Text style={e.benefitText}>{text}</Text>
              </View>
            ))}
          </View>

          {/* Primary CTAs */}
          <View style={e.ctaBlock}>
            <Pressable
              onPress={() => { setError(null); setCameFromLanding(true); setMode('signup'); }}
              disabled={anyLoading}
              style={({ pressed }) => [e.createBtn, pressed && { opacity: 0.87 }]}
            >
              <Text style={e.createBtnText}>Create Account</Text>
            </Pressable>

            <Pressable
              onPress={() => { setError(null); setCameFromLanding(true); setMode('login'); }}
              disabled={anyLoading}
              style={({ pressed }) => [e.loginBtn, pressed && { opacity: 0.87 }]}
            >
              <Text style={e.loginBtnText}>Log In</Text>
            </Pressable>
          </View>

          {/* Divider */}
          <View style={s.dividerRow}>
            <View style={s.dividerLine} />
            <Text style={s.dividerText}>or continue with</Text>
            <View style={s.dividerLine} />
          </View>

          {/* Social buttons */}
          {googleError && (
            <View style={[s.errorBox, { marginBottom: 8 }]}>
              <MaterialIcons name="error-outline" size={14} color="#721C24" />
              <Text style={s.errorText}>{googleError}</Text>
            </View>
          )}
          {appleError && (
            <View style={[s.errorBox, { marginBottom: 8 }]}>
              <MaterialIcons name="error-outline" size={14} color="#721C24" />
              <Text style={s.errorText}>{appleError}</Text>
            </View>
          )}

          <Pressable
            onPress={handleGoogleSignIn}
            disabled={anyLoading}
            style={({ pressed }) => [s.googleBtn, (pressed || googleLoading) && { opacity: 0.8 }]}
          >
            {googleLoading ? <ActivityIndicator color="#3C4043" size="small" /> : (
              <>
                <Text style={s.googleG}>
                  <Text style={{ color: '#4285F4' }}>G</Text>
                  <Text style={{ color: '#EA4335' }}>o</Text>
                  <Text style={{ color: '#FBBC05' }}>o</Text>
                  <Text style={{ color: '#4285F4' }}>g</Text>
                  <Text style={{ color: '#34A853' }}>l</Text>
                  <Text style={{ color: '#EA4335' }}>e</Text>
                </Text>
                <Text style={s.googleBtnText}>Continue with Google</Text>
              </>
            )}
          </Pressable>

          <Pressable
            onPress={handleAppleSignIn}
            disabled={anyLoading}
            style={({ pressed }) => [s.appleBtn, { marginTop: 10 }, (pressed || appleStep !== 'idle') && { opacity: 0.8 }]}
          >
            {appleStep !== 'idle'
              ? <ActivityIndicator color="#FFFFFF" size="small" />
              : <Text style={s.appleBtnText}> Continue with Apple</Text>
            }
          </Pressable>

          {/* Guest skip */}
          <Pressable
            onPress={() => router.back()}
            disabled={anyLoading}
            style={({ pressed }) => [e.guestBtn, pressed && { opacity: 0.6 }]}
          >
            <Text style={e.guestText}>Continue as guest</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  // ── Confirm state ─────────────────────────────────────────────────────────
  if (mode === 'confirm') {
    return (
      <View style={[s.root, { paddingTop: insets.top + 16, justifyContent: 'center' }]}>
        <View style={{ alignItems: 'center', marginBottom: 20 }}>
          <MaterialIcons name="mark-email-unread" size={48} color={FOREST} />
        </View>
        <Text style={s.title}>Check your email</Text>
        <Text style={s.confirmBody}>
          We sent a confirmation link to{'\n'}
          <Text style={{ fontWeight: '700', color: FOREST }}>{confirmEmail}</Text>
          {'\n\n'}Confirm your email, then come back and log in.
        </Text>
        {resendMsg && <Text style={[s.confirmBody, { color: resendMsg.includes('resent') ? FOREST : '#B85450', marginBottom: 8 }]}>{resendMsg}</Text>}
        <Pressable onPress={() => { setMode('login'); clearError(); }} style={({ pressed }) => [s.primaryBtn, pressed && { opacity: 0.85 }]}>
          <Text style={s.primaryBtnText}>Back to Log In</Text>
        </Pressable>
        <Pressable onPress={handleResend} disabled={resending || cooldown > 0} style={({ pressed }) => [s.switchBtn, pressed && { opacity: 0.6 }, cooldown > 0 && { opacity: 0.45 }]}>
          {resending ? <ActivityIndicator color={MUTED} size="small" /> :
            cooldown > 0 ? <Text style={s.switchText}>Resend available in <Text style={s.switchTextBold}>{cooldown}s</Text></Text> :
            <Text style={s.switchText}>Didn't get it? <Text style={s.switchTextBold}>Resend Email</Text></Text>
          }
        </Pressable>
      </View>
    );
  }

  const isSignUp = mode === 'signup';

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={[s.root, { paddingTop: insets.top + 16 }]} keyboardShouldPersistTaps="handled">
        <Pressable
          onPress={() => {
            if (cameFromLanding) { setMode('entry'); setError(null); }
            else { router.back(); }
          }}
          hitSlop={12}
          style={({ pressed }) => [s.backBtn, pressed && { opacity: 0.6 }]}
        >
          <MaterialIcons name="arrow-back" size={22} color={FOREST} />
        </Pressable>
        <View style={s.headerBlock}>
          <Text style={s.wordmark}>FlipStart</Text>
          <Text style={s.subtitle}>{isSignUp ? 'Create your account' : 'Welcome back'}</Text>
        </View>

        {/* Email-exists special error — sign up attempted with existing account */}
        {error === '__EMAIL_EXISTS__' ? (
          <View style={s.emailExistsBox}>
            <Text style={s.emailExistsText}>An account with this email already exists.</Text>
            <Pressable onPress={() => { setMode('login'); setError(null); }}>
              <Text style={[s.emailExistsText, { fontWeight: '700', color: FOREST, textDecorationLine: 'underline' }]}>Log in instead →</Text>
            </Pressable>
          </View>
        ) : error ? (
          <View style={s.errorBox}>
            <MaterialIcons name="error-outline" size={14} color="#721C24" />
            <Text style={s.errorText}>{error}</Text>
          </View>
        ) : null}

        {/* Login failed nudge — if on login screen with an error, remind them they can sign up */}
        {!isSignUp && error && error !== '__EMAIL_EXISTS__' && (
          <Pressable
            onPress={() => { setMode('signup'); setError(null); }}
            style={({ pressed }) => [s.switchBtn, pressed && { opacity: 0.6 }, { marginTop: -8, marginBottom: 4 }]}
          >
            <Text style={s.switchText}>
              No account? <Text style={s.switchTextBold}>Create one instead →</Text>
            </Text>
          </Pressable>
        )}

        <TextInput style={s.input} placeholder="Email" placeholderTextColor={MUTED} value={email}
          onChangeText={v => { setEmail(v); clearError(); }} autoCapitalize="none" keyboardType="email-address" autoCorrect={false} editable={!saving} />
        <TextInput style={s.input} placeholder="Password (min 6 characters)" placeholderTextColor={MUTED} value={password}
          onChangeText={v => { setPassword(v); clearError(); }} secureTextEntry autoCapitalize="none" autoCorrect={false} editable={!saving} />

        {isSignUp && (
          <>
            <View style={s.unameRow}>
              <TextInput style={[s.input, { flex: 1, marginBottom: 0 }]} placeholder="Username"
                placeholderTextColor={MUTED} value={username}
                onChangeText={v => { setUsername(v.replace(/[^A-Za-z0-9._-]/g, '')); clearError(); }}
                autoCapitalize="none" autoCorrect={false} maxLength={24} editable={!saving} />
              {unameStatus === 'checking'  && <ActivityIndicator size="small" color={MUTED} style={s.unameIcon} />}
              {unameStatus === 'available' && <MaterialIcons name="check-circle" size={20} color="#2A7A3A" style={s.unameIcon} />}
              {unameStatus === 'taken'     && <MaterialIcons name="cancel"       size={20} color="#B85450" style={s.unameIcon} />}
            </View>
            {unameStatus === 'available' && <Text style={[s.unameHint, { color: '#2A7A3A' }]}>Available</Text>}
            {unameStatus === 'taken'     && <Text style={[s.unameHint, { color: '#B85450' }]}>Username already taken</Text>}
            {unameStatus === 'invalid' && username.trim().length > 0 && <Text style={[s.unameHint, { color: MUTED }]}>3–24 chars · letters, numbers, _ . - · must start and end with letter or number</Text>}
            {!['available','taken','invalid'].includes(unameStatus) && <Text style={s.fieldHint}>3–24 characters · letters, numbers, underscores, periods, or hyphens</Text>}
          </>
        )}

        <Pressable onPress={isSignUp ? handleSignUp : handleLogin} disabled={saving}
          style={({ pressed }) => [s.primaryBtn, (pressed || saving) && { opacity: 0.8 }]}>
          {saving ? <ActivityIndicator color={CREAM} /> : <Text style={s.primaryBtnText}>{isSignUp ? 'Create Account' : 'Log In'}</Text>}
        </Pressable>

        <Pressable onPress={() => { setMode(isSignUp ? 'login' : 'signup'); setError(null); }} disabled={saving}
          style={({ pressed }) => [s.switchBtn, pressed && { opacity: 0.6 }]}>
          <Text style={s.switchText}>
            {isSignUp ? 'Already have an account? ' : 'New to FlipStart? '}
            <Text style={s.switchTextBold}>{isSignUp ? 'Log In' : 'Sign Up'}</Text>
          </Text>
        </Pressable>

        {/* ── Google Sign-In ─────────────────────────────────────── */}
        <View style={s.dividerRow}>
          <View style={s.dividerLine} /><Text style={s.dividerText}>or</Text><View style={s.dividerLine} />
        </View>

        {googleError && (
          <View style={[s.errorBox, { marginBottom: 10 }]}>
            <MaterialIcons name="error-outline" size={14} color="#721C24" />
            <Text style={s.errorText}>{googleError}</Text>
          </View>
        )}

        <Pressable
          onPress={handleGoogleSignIn}
          disabled={googleLoading || saving || appleStep !== 'idle'}
          style={({ pressed }) => [s.googleBtn, (pressed || googleLoading) && { opacity: 0.8 }]}
        >
          {googleLoading ? (
            <ActivityIndicator color="#3C4043" size="small" />
          ) : (
            <>
              <Text style={s.googleG}>
                <Text style={{ color: '#4285F4' }}>G</Text>
                <Text style={{ color: '#EA4335' }}>o</Text>
                <Text style={{ color: '#FBBC05' }}>o</Text>
                <Text style={{ color: '#4285F4' }}>g</Text>
                <Text style={{ color: '#34A853' }}>l</Text>
                <Text style={{ color: '#EA4335' }}>e</Text>
              </Text>
              <Text style={s.googleBtnText}>Continue with Google</Text>
            </>
          )}
        </Pressable>

        {/* Apple Sign-In — iOS only, shown always (isAvailableAsync checked inside handler) */}
        {appleError && (
          <View style={[s.errorBox, { marginTop: 10 }]}>
            <MaterialIcons name="error-outline" size={14} color="#721C24" />
            <Text style={s.errorText}>{appleError}</Text>
          </View>
        )}
        <Pressable
          onPress={handleAppleSignIn}
          disabled={appleStep !== 'idle' || saving || googleLoading}
          style={({ pressed }) => [s.appleBtn, (pressed || appleStep !== 'idle') && { opacity: 0.8 }]}
        >
          {appleStep === 'idle'
            ? <Text style={s.appleBtnText}> Continue with Apple</Text>
            : appleStep === 'opening'
            ? <ActivityIndicator color="#FFFFFF" size="small" />
            : appleStep === 'signing'
            ? <Text style={s.appleBtnText}>Signing you in…</Text>
            : <Text style={s.appleBtnText}>Loading profile…</Text>
          }
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root:           { flexGrow: 1, backgroundColor: PARCHMENT, paddingHorizontal: 24, paddingBottom: 40 },
  backBtn:        { marginBottom: 8, alignSelf: 'flex-start' },
  headerBlock:    { alignItems: 'center', marginBottom: 28, marginTop: 8 },
  wordmark:       { fontFamily: FONTS.serif, fontSize: 32, fontWeight: '800', color: FOREST, marginBottom: 6 },
  subtitle:       { fontSize: 15, color: MUTED },
  title:          { fontFamily: FONTS.serif, fontSize: 26, fontWeight: '800', color: FOREST, textAlign: 'center', marginBottom: 14 },
  confirmBody:    { fontSize: 15, color: BROWN, textAlign: 'center', lineHeight: 23, marginBottom: 28 },
  errorBox:       { flexDirection: 'row', alignItems: 'flex-start', gap: 6, backgroundColor: '#F8D7DA', borderRadius: 10, padding: 12, marginBottom: 14 },
  errorText:      { fontSize: 13, color: '#721C24', flex: 1, lineHeight: 18 },
  emailExistsBox: { backgroundColor: '#FFF3CD', borderRadius: 10, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: '#FFEAA7' },
  emailExistsText:{ fontSize: 13, color: '#856404', lineHeight: 18, marginBottom: 6 },
  input:          { backgroundColor: '#FFF9EE', borderRadius: 12, borderWidth: 1, borderColor: CARD_B, paddingHorizontal: 16, paddingVertical: 14, fontSize: 15, color: FOREST, marginBottom: 12 },
  fieldHint:      { fontSize: 11, color: MUTED, marginBottom: 10, marginLeft: 4 },
  unameRow:       { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  unameIcon:      { marginLeft: 8 },
  unameHint:      { fontSize: 12, fontWeight: '600', marginBottom: 10, marginLeft: 4 },
  primaryBtn:     { backgroundColor: SCAN_DARK, borderRadius: 50, paddingVertical: 17, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  primaryBtnText: { fontFamily: FONTS.serif, fontSize: 17, fontWeight: '700', color: CREAM },
  switchBtn:      { alignItems: 'center', paddingVertical: 16 },
  switchText:     { fontSize: 14, color: MUTED },
  switchTextBold: { fontWeight: '700', color: BROWN, textDecorationLine: 'underline' },
  dividerRow:     { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  dividerLine:    { flex: 1, height: 1, backgroundColor: CARD_B },
  dividerText:    { fontSize: 12, color: MUTED, fontWeight: '600' },
  googleBtn:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: '#FFFFFF', borderRadius: 50, paddingVertical: 15, borderWidth: 1.5, borderColor: '#DADCE0' },
  googleG:        { fontSize: 15, fontWeight: '800' },
  googleBtnText:  { fontSize: 15, fontWeight: '600', color: '#3C4043' },
  appleBtn:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#000000', borderRadius: 50, paddingVertical: 15, marginTop: 10 },
  appleBtnText:   { fontSize: 15, fontWeight: '600', color: '#FFFFFF' },
});

// ─── Entry screen styles ──────────────────────────────────────────────────────
const e = StyleSheet.create({
  root:          { flex: 1, backgroundColor: PARCHMENT },
  scroll:        { paddingHorizontal: 24, paddingBottom: 48, paddingTop: 12 },
  headerBlock:   { alignItems: 'center', marginBottom: 28, marginTop: 16 },
  wordmark:      { fontFamily: FONTS.serif, fontSize: 42, fontWeight: '900', color: FOREST, letterSpacing: -0.5, marginBottom: 14 },
  tagline:       { fontFamily: FONTS.serif, fontSize: 24, fontWeight: '700', color: SCAN_DARK, textAlign: 'center', lineHeight: 32 },
  benefitsCard:  { backgroundColor: '#EDE0C4', borderRadius: 18, padding: 20, marginBottom: 28, gap: 14, borderWidth: 1, borderColor: CARD_B },
  benefitRow:    { flexDirection: 'row', alignItems: 'center', gap: 12 },
  benefitText:   { fontSize: 14, color: BROWN, flex: 1, lineHeight: 20 },
  ctaBlock:      { gap: 12, marginBottom: 24 },
  createBtn:     { backgroundColor: SCAN_DARK, borderRadius: 50, paddingVertical: 18, alignItems: 'center', justifyContent: 'center' },
  createBtnText: { fontFamily: FONTS.serif, fontSize: 17, fontWeight: '800', color: CREAM, letterSpacing: 0.2 },
  loginBtn:      { borderRadius: 50, paddingVertical: 17, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: FOREST },
  loginBtnText:  { fontFamily: FONTS.serif, fontSize: 17, fontWeight: '700', color: FOREST },
  guestBtn:      { alignItems: 'center', paddingVertical: 20 },
  guestText:     { fontSize: 13, color: MUTED, textDecorationLine: 'underline' },
});
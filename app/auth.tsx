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
import { useAuth } from '@/lib/auth-context';
import { PENDING_USERNAME_KEY } from '@/lib/auth-context';
import { FONTS } from '@/constants/typography';

const FOREST    = '#2A4A2A';
const SCAN_DARK = '#152815';
const CREAM     = '#F4EED8';
const PARCHMENT = '#F0E8D4';
const CARD_B    = '#DDD0B0';
const BROWN     = '#5A3A1A';
const MUTED     = '#8A7050';

export default function AuthScreen() {
  const router  = useRouter();
  const insets  = useSafeAreaInsets();
  const params  = useLocalSearchParams<{ mode?: string }>();
  const { refreshProfile } = useAuth();

  const [mode,         setMode]         = useState<'signup' | 'login' | 'confirm'>(
    params.mode === 'login' ? 'login' : 'signup'
  );
  const [email,        setEmail]        = useState('');
  const [password,     setPassword]     = useState('');
  const [username,     setUsername]     = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [saving,       setSaving]       = useState(false);
  const [resending,    setResending]    = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const [resendMsg,    setResendMsg]    = useState<string | null>(null);
  const [cooldown,     setCooldown]     = useState(0);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Username availability
  const [unameStatus, setUnameStatus] = useState<'idle'|'checking'|'available'|'taken'|'invalid'>('idle');
  const unameDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const checkUnameAvailability = useCallback(async (value: string) => {
    if (!/^[a-z0-9_]{3,20}$/.test(value)) { setUnameStatus('invalid'); return; }
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

  // ── Sign Up ────────────────────────────────────────────────────────────────
  const handleSignUp = async () => {
    const trimEmail    = email.trim().toLowerCase();
    const trimPassword = password.trim();
    const trimUsername = username.trim().toLowerCase();
    if (!trimEmail)    { setError('Email is required.');    return; }
    if (!trimPassword) { setError('Password is required.'); return; }
    if (!trimUsername) { setError('Username is required.'); return; }
    if (trimPassword.length < 6) { setError('Password must be at least 6 characters.'); return; }
    if (!/^[a-z0-9_]{3,20}$/.test(trimUsername)) { setError('Username: 3–20 characters, letters/numbers/underscores only.'); return; }
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
      router.replace('/(tabs)' as any);
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
      router.replace('/(tabs)' as any);
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
        <Pressable onPress={() => router.back()} hitSlop={12} style={({ pressed }) => [s.backBtn, pressed && { opacity: 0.6 }]}>
          <MaterialIcons name="arrow-back" size={22} color={FOREST} />
        </Pressable>
        <View style={s.headerBlock}>
          <Text style={s.wordmark}>FlipStart</Text>
          <Text style={s.subtitle}>{isSignUp ? 'Create your account' : 'Welcome back'}</Text>
        </View>

        {/* Email-exists special error */}
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

        <TextInput style={s.input} placeholder="Email" placeholderTextColor={MUTED} value={email}
          onChangeText={v => { setEmail(v); clearError(); }} autoCapitalize="none" keyboardType="email-address" autoCorrect={false} editable={!saving} />
        <TextInput style={s.input} placeholder="Password (min 6 characters)" placeholderTextColor={MUTED} value={password}
          onChangeText={v => { setPassword(v); clearError(); }} secureTextEntry autoCapitalize="none" autoCorrect={false} editable={!saving} />

        {isSignUp && (
          <>
            <View style={s.unameRow}>
              <TextInput style={[s.input, { flex: 1, marginBottom: 0 }]} placeholder="Username"
                placeholderTextColor={MUTED} value={username}
                onChangeText={v => { setUsername(v.toLowerCase().replace(/[^a-z0-9_]/g, '')); clearError(); }}
                autoCapitalize="none" autoCorrect={false} maxLength={20} editable={!saving} />
              {unameStatus === 'checking'  && <ActivityIndicator size="small" color={MUTED} style={s.unameIcon} />}
              {unameStatus === 'available' && <MaterialIcons name="check-circle" size={20} color="#2A7A3A" style={s.unameIcon} />}
              {unameStatus === 'taken'     && <MaterialIcons name="cancel"       size={20} color="#B85450" style={s.unameIcon} />}
            </View>
            {unameStatus === 'available' && <Text style={[s.unameHint, { color: '#2A7A3A' }]}>Available</Text>}
            {unameStatus === 'taken'     && <Text style={[s.unameHint, { color: '#B85450' }]}>Username already taken</Text>}
            {unameStatus === 'invalid' && username.trim().length > 0 && <Text style={[s.unameHint, { color: MUTED }]}>Use 3–20 letters, numbers, or underscores</Text>}
            {!['available','taken','invalid'].includes(unameStatus) && <Text style={s.fieldHint}>3–20 characters · letters, numbers, underscores</Text>}
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
});
/**
 * app/username-setup.tsx
 * Username collection for new users who authenticated but have no completed profile.
 * Reached when user && profile && !profile.onboarding_complete.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, Pressable, TextInput,
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { supabase } from '@/lib/supabase';
import { completeOnboarding } from '@/lib/onboarding-storage';
import { useAuth } from '@/lib/auth-context';
import { FONTS } from '@/constants/typography';

const FOREST    = '#2A4A2A';
const SCAN_DARK = '#152815';
const CREAM     = '#F4EED8';
const PARCHMENT = '#FFFFFF';
const CARD_B    = '#DDD2AC';
const MUTED     = '#8A7050';

// Rules: 3–24 chars, letters (any case) / numbers / _ / . / -
// Must start and end with letter or number.
// No consecutive special chars (.. -- __ .- etc.).
const USERNAME_RE = /^(?!.*[._-]{2})[A-Za-z0-9][A-Za-z0-9._-]{1,22}[A-Za-z0-9]$|^[A-Za-z0-9]{3,4}$/;
type Availability = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';

export default function UsernameSetupScreen() {
  const router  = useRouter();
  const insets  = useSafeAreaInsets();
  const { user, refreshProfile } = useAuth();

  const [username,     setUsername]     = useState('');
  const [availability, setAvailability] = useState<Availability>('idle');
  const [saving,       setSaving]       = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const checkAvailability = useCallback(async (value: string) => {
    if (!USERNAME_RE.test(value)) { setAvailability('invalid'); return; }
    setAvailability('checking');
    try {
      // Primary: RPC with security definer bypasses RLS
      const { data, error } = await supabase.rpc('check_username_available', { uname: value });
      if (!error) { setAvailability(data === true ? 'available' : 'taken'); return; }
      // Fallback: direct query (if RPC not deployed yet)
      const { data: row } = await supabase.from('profiles').select('username').eq('username', value).maybeSingle();
      setAvailability(row ? 'taken' : 'available');
    } catch { setAvailability('idle'); }
  }, []);

  useEffect(() => {
    const trimmed = username.trim();
    if (!trimmed) { setAvailability('idle'); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setAvailability('checking');
    debounceRef.current = setTimeout(() => checkAvailability(trimmed), 600);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [username, checkAvailability]);

  const handleContinue = async () => {
    const trimmed = username.trim().toLowerCase();
    if (!trimmed)                    { setError('Username is required.'); return; }
    if (!USERNAME_RE.test(trimmed))  { setError('3–24 characters: letters, numbers, underscores, periods, or hyphens. Must start and end with a letter or number.'); return; }
    if (availability === 'taken')    { setError(`"${trimmed}" is already taken. Choose another.`); return; }
    if (availability === 'checking') { setError('Still checking availability — please wait.'); return; }
    if (!user?.id) { setError('Session expired. Please log in again.'); return; }
    if (saving) return;
    setSaving(true); setError(null);
    try {
      const { error: upsertError } = await supabase.from('profiles').upsert(
        { id: user.id, username: trimmed, display_name: trimmed, onboarding_complete: true },
        { onConflict: 'id' }
      );
      if (upsertError) {
        if (upsertError.code === '23505') { setError(`"${trimmed}" was just taken. Choose another.`); setAvailability('taken'); }
        else { setError('Could not save your username. Please try again.'); }
        setSaving(false); return;
      }
      await completeOnboarding('resell');
      await refreshProfile().catch(() => {});
      router.replace('/(tabs)' as any);
    } catch { setError('Something went wrong. Please try again.'); setSaving(false); }
  };

  const canSubmit = availability === 'available' && !saving;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={[s.root, { paddingTop: insets.top + 24 }]} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: 'center', marginBottom: 16 }}>
          <MaterialIcons name="person-pin" size={44} color={FOREST} />
        </View>
        <Text style={s.title}>Choose your username</Text>
        <Text style={s.subtitle}>Your public handle on FlipStart.{'\n'}You can't change it later.</Text>

        {error && <View style={s.errorBox}><MaterialIcons name="error-outline" size={14} color="#721C24" /><Text style={s.errorText}>{error}</Text></View>}

        <View style={s.inputRow}>
          <TextInput style={[s.input, { flex: 1 }]} placeholder="username" placeholderTextColor={MUTED}
            value={username} onChangeText={v => {
              // Strip only characters that are never allowed; preserve case
              setUsername(v.replace(/[^A-Za-z0-9._-]/g, ''));
              setError(null);
            }}
            autoCapitalize="none" autoCorrect={false} maxLength={24} editable={!saving} autoFocus />
          {availability === 'checking'  && <ActivityIndicator size="small" color={MUTED} style={{ marginLeft: 8 }} />}
          {availability === 'available' && <MaterialIcons name="check-circle" size={18} color="#2A7A3A" style={{ marginLeft: 8 }} />}
          {availability === 'taken'     && <MaterialIcons name="cancel"       size={18} color="#B85450" style={{ marginLeft: 8 }} />}
        </View>

        {availability === 'available' && <Text style={[s.availText, { color: '#2A7A3A' }]}>Available</Text>}
        {availability === 'taken'     && <Text style={[s.availText, { color: '#B85450' }]}>Already taken</Text>}
        {!['available','taken'].includes(availability) && <Text style={s.fieldHint}>3–24 characters · letters, numbers, underscores, periods, or hyphens</Text>}

        <Pressable onPress={handleContinue} disabled={!canSubmit}
          style={({ pressed }) => [s.primaryBtn, !canSubmit && { opacity: 0.5 }, pressed && canSubmit && { opacity: 0.85 }]}>
          {saving ? <ActivityIndicator color={CREAM} /> : <Text style={s.primaryBtnText}>Continue</Text>}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root:       { flexGrow: 1, backgroundColor: PARCHMENT, paddingHorizontal: 24, paddingBottom: 40 },
  title:      { fontFamily: FONTS.serif, fontSize: 28, fontWeight: '800', color: FOREST, textAlign: 'center', marginBottom: 10 },
  subtitle:   { fontSize: 14, color: MUTED, textAlign: 'center', lineHeight: 21, marginBottom: 28 },
  errorBox:   { flexDirection: 'row', alignItems: 'flex-start', gap: 6, backgroundColor: '#F8D7DA', borderRadius: 10, padding: 12, marginBottom: 14 },
  errorText:  { fontSize: 13, color: '#721C24', flex: 1, lineHeight: 18 },
  inputRow:   { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  input:      { backgroundColor: '#FFFEFA', borderRadius: 12, borderWidth: 1, borderColor: CARD_B, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, color: FOREST },
  availText:  { fontSize: 12, fontWeight: '600', marginBottom: 16, marginLeft: 4 },
  fieldHint:  { fontSize: 11, color: MUTED, marginBottom: 16, marginLeft: 4 },
  primaryBtn: { backgroundColor: SCAN_DARK, borderRadius: 50, paddingVertical: 17, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  primaryBtnText: { fontFamily: FONTS.serif, fontSize: 17, fontWeight: '700', color: CREAM },
});
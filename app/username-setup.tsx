/**
 * app/username-setup.tsx
 * Username collection for new users who authenticated but have no completed profile.
 * Reached when user && profile && !profile.onboarding_complete.
 *
 * ── V2 Phase 4: layout only ─────────────────────────────────────────────────
 * Drawn in the same OnboardingShell as every other onboarding screen (no
 * progress bar, no back — the account already exists), with the approved
 * board's copy. Everything that DECIDES anything is unchanged: the username
 * rules, the availability check (RPC, then a direct query), the profiles
 * upsert that marks onboarding complete, and where it goes afterwards.
 *
 * The copy says "You can change it once later" because that is what
 * app/edit-profile.tsx enforces (profiles.username_changed_once). It used to
 * say the opposite, which was false.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, TextInput, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

import { supabase } from '@/lib/supabase';
import { completeOnboarding, readPendingNewUserOffer } from '@/lib/onboarding-storage';
import { useAuth } from '@/lib/auth-context';
import { OnboardingShell } from '@/components/onboarding/OnboardingShell';
import { OB } from '@/components/onboarding/onboardingTheme';

/** Errors and "taken". 6.5:1 on white — readable, not a pink box. */
const BAD = '#B42318';

// Rules: 3–24 chars, letters (any case) / numbers / _ / . / -
// Must start and end with letter or number.
// No consecutive special chars (.. -- __ .- etc.).
const USERNAME_RE = /^(?!.*[._-]{2})[A-Za-z0-9][A-Za-z0-9._-]{1,22}[A-Za-z0-9]$|^[A-Za-z0-9]{3,4}$/;
type Availability = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';

export default function UsernameSetupScreen() {
  const router  = useRouter();
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
      /**
       * A brand-new account created FROM onboarding is not finished here: its
       * final offer is waiting. completeOnboarding() was a no-op for it (the
       * pending marker gates that), and the Home gate would bounce it back to
       * /onboarding anyway — but only after Home rendered for a frame. Going
       * straight there removes that flash. Everyone else goes Home as before.
       */
      const pending = await readPendingNewUserOffer();
      router.replace((pending ? '/onboarding' : '/(tabs)') as any);
    } catch { setError('Something went wrong. Please try again.'); setSaving(false); }
  };

  const canSubmit = availability === 'available' && !saving;
  /** What will actually be saved: handleContinue lowercases, so say so. */
  const shown = username.trim().toLowerCase();
  const bad = availability === 'taken' || (availability === 'invalid' && username.length > 0);

  return (
    <OnboardingShell
      progress={null}
      headline="Choose your username" accent="username"
      support="This is your public name on FlipStart. You can change it once later."
      avoidKeyboard
      cta={{ label: saving ? 'Saving\u2026' : 'Continue', onPress: handleContinue, disabled: !canSubmit }}
    >
      {error && (
        <View style={s.errorBox} accessibilityRole="alert">
          <MaterialIcons name="error-outline" size={16} color={BAD} />
          <Text style={s.errorText}>{error}</Text>
        </View>
      )}

      <View style={s.field}>
        <Text style={s.label} maxFontSizeMultiplier={1.3}>Username</Text>
        <View style={s.inputWrap}>
          <TextInput
            style={[s.input, bad && s.inputBad]}
            placeholder="username" placeholderTextColor={OB.disabledText}
            value={username}
            onChangeText={v => {
              // Strip only characters that are never allowed; preserve case
              setUsername(v.replace(/[^A-Za-z0-9._-]/g, ''));
              setError(null);
            }}
            autoCapitalize="none" autoCorrect={false} maxLength={24} editable={!saving} autoFocus
            accessibilityLabel="Username"
            maxFontSizeMultiplier={1.3}
          />
          <View style={s.status} pointerEvents="none" importantForAccessibility="no-hide-descendants">
            {availability === 'checking'  && <ActivityIndicator size="small" color={OB.forest} />}
            {availability === 'available' && (
              <View style={s.okBadge}><MaterialIcons name="check" size={15} color="#FFFFFF" /></View>
            )}
            {availability === 'taken' && <MaterialIcons name="cancel" size={24} color={BAD} />}
          </View>
        </View>

        {availability === 'available' && (
          <Text style={[s.feedback, { color: OB.forest }]} accessibilityLiveRegion="polite" maxFontSizeMultiplier={1.3}>
            {shown} is available
          </Text>
        )}
        {availability === 'taken' && (
          <Text style={[s.feedback, { color: BAD }]} accessibilityLiveRegion="polite" maxFontSizeMultiplier={1.3}>
            {shown} is already taken
          </Text>
        )}
        {availability === 'checking' && (
          <Text style={[s.feedback, { color: OB.ink }]} maxFontSizeMultiplier={1.3}>Checking{'\u2026'}</Text>
        )}
        <Text style={[s.helper, availability === 'invalid' && username.length > 0 && s.helperBad]} maxFontSizeMultiplier={1.3}>
          3{'\u2013'}24 characters. Letters, numbers, periods, underscores, hyphens.
        </Text>
      </View>
    </OnboardingShell>
  );
}

const s = StyleSheet.create({
  errorBox:   { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: BAD, backgroundColor: '#FEF3F2' },
  errorText:  { flex: 1, fontSize: 14, lineHeight: 19, color: OB.ink },
  field:      { gap: 8 },
  label:      { fontSize: 13, lineHeight: 18, fontWeight: '700', color: OB.ink },
  inputWrap:  { justifyContent: 'center' },
  input: {
    height: 56, paddingLeft: 16, paddingRight: 48, borderRadius: 14,
    borderWidth: 2, borderColor: OB.forest, backgroundColor: '#FFFFFF',
    fontSize: 18, fontWeight: '600', color: OB.ink,
  },
  inputBad:   { borderColor: BAD },
  status:     { position: 'absolute', right: 14, width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  okBadge:    { width: 24, height: 24, borderRadius: 12, backgroundColor: OB.forest, alignItems: 'center', justifyContent: 'center' },
  feedback:   { fontSize: 14, lineHeight: 19, fontWeight: '700' },
  helper:     { fontSize: 13, lineHeight: 18, color: OB.ink },
  helperBad:  { color: BAD, fontWeight: '700' },
});
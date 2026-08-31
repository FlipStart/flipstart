/**
 * app/onboarding.tsx
 * First-time onboarding flow (full-screen, vintage aesthetic).
 *
 * Flow:
 *   1. Welcome / value prop
 *   2. What do you hunt for?  (interests — stored locally)
 *   3. How FlipStart helps    (3 cards)
 *   4. Account benefits       (Create Account / Log In / Continue as guest)
 *
 * Auth routes into app/auth.tsx with authEntryPoint='onboarding'.
 * No paywall in this pass. Reached via router.replace('/onboarding') from the
 * home screen when onboarding is not yet complete.
 */

import { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FONTS } from '@/constants/typography';
import { completeOnboarding, setOnboardingInterests } from '@/lib/onboarding-storage';
import { trackAnalyticsEvent } from '@/lib/analytics';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';

// Required by expo-web-browser for OAuth session handling.
WebBrowser.maybeCompleteAuthSession();

const FOREST    = '#2A4A2A';
const SCAN_DARK = '#152815';
// Page canvas only.
// Was '#F0E8D4' -- the Hunt Mode background colour. Onboarding is not a
// Hunt surface, so it now uses the app's white canvas. Cards, chips, the
// gold hero treatment and the notice box below are all unchanged.
const PARCHMENT = '#FFFFFF';
const CREAM     = '#F4EED8';
const CARD_B    = '#DDD0B0';
const CARD_BG   = '#EDE0C4';
const BROWN     = '#5A3A1A';
const MUTED     = '#8A7050';
const GOLD      = '#BE9C2C';

type Step = 0 | 1 | 2 | 3;

const INTERESTS = [
  'Vintage Clothing', 'Streetwear', 'Sneakers',
  'Sportswear', 'Designer', 'Accessories', 'Everything',
] as const;

const HELP_CARDS = [
  { icon: 'qr-code-scanner', title: 'Scan Finds', body: 'Estimate value before you buy.' },
  { icon: 'travel-explore',  title: 'Hunt Mode',  body: 'Turn thrift trips into a game.' },
  { icon: 'emoji-events',    title: 'Progress',   body: 'Unlock achievements, brands, and Diamonds in the Rough.' },
] as const;

const BENEFITS = [
  { icon: 'sync',           text: 'Sync scans across all your devices'    },
  { icon: 'emoji-events',   text: 'Earn XP, climb ranks, build streaks'   },
  { icon: 'travel-explore', text: 'Save Hunt Mode progress automatically' },
  { icon: 'lock',           text: 'Secure account backup, always safe'    },
] as const;

export default function OnboardingScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ notice?: string }>();
  // Shown when a social login on the "Log In to Existing Account" route turned
  // out to be a brand-new account (no quiz taken). We bounce them here.
  const [notice, setNotice] = useState<string | null>(
    params.notice === 'no_existing_account'
      ? "That sign-in created a new account, not an existing one. Please take the quiz to get started."
      : null,
  );
  const insets = useSafeAreaInsets();
  const { user, refreshProfile } = useAuth();
  const signedIn = !!user;

  const [step, setStep]           = useState<Step>(0);
  const [selected, setSelected]   = useState<Set<string>>(new Set());
  const [saving, setSaving]       = useState(false);

  // ── Social auth state (used on the final account prompt, step 3) ───────────
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleError,   setGoogleError]   = useState<string | null>(null);
  const [appleStep,     setAppleStep]     = useState<'idle'|'opening'|'signing'|'loading'>('idle');
  const [appleError,    setAppleError]    = useState<string | null>(null);

  // Analytics: onboarding screen entered (mount-once).
  useEffect(() => { trackAnalyticsEvent('onboarding_started', {}); }, []);

  // ── Google Sign-In ──────────────────────────────────────────────────────────
  const handleGoogleSignIn = useCallback(async () => {
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
      if (result.type !== 'success') return; // user cancelled — no error shown
      const parsed = Linking.parse(result.url);
      const code = parsed.queryParams?.code as string | undefined;
      if (!code) { setGoogleError('Google Sign-In did not return a code. Please try again.'); return; }
      const { error: sessionError } = await supabase.auth.exchangeCodeForSession(code);
      if (sessionError) { setGoogleError(`Sign-In failed: ${sessionError.message}`); return; }
      await refreshProfile().catch(() => {});
      trackAnalyticsEvent('login_success', { auth_method: 'google', entry_point: 'onboarding' });
      trackAnalyticsEvent('account_created', { auth_method: 'google', entry_point: 'onboarding' });
      trackAnalyticsEvent('onboarding_completed', { auth_method: 'google', completed_onboarding_version: 'resell' });
      await completeOnboarding('resell').catch(() => {});
      router.replace('/(tabs)' as any);
    } catch {
      setGoogleError('Google Sign-In failed. Please try again.');
    } finally {
      setGoogleLoading(false);
    }
  }, [googleLoading, saving, appleStep, router, refreshProfile]);

  // ── Apple Sign-In ───────────────────────────────────────────────────────────
  const handleAppleSignIn = useCallback(async () => {
    if (appleStep !== 'idle' || saving || googleLoading) return;
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
      const credential = await AppleAuth.signInAsync({
        requestedScopes: [
          AppleAuth.AppleAuthenticationScope.FULL_NAME,
          AppleAuth.AppleAuthenticationScope.EMAIL,
        ],
      });
      setAppleStep('signing');
      const { identityToken, fullName } = credential;
      if (!identityToken) {
        setAppleError('Apple Sign-In failed. Please try again.');
        setAppleStep('idle');
        return;
      }
      const { error: sessionError } = await supabase.auth.signInWithIdToken({
        provider: 'apple', token: identityToken,
      });
      if (sessionError) {
        setAppleError(`Sign-In failed: ${sessionError.message}`);
        setAppleStep('idle');
        return;
      }
      setAppleStep('loading');
      if (fullName?.givenName || fullName?.familyName) {
        const displayName = [fullName.givenName, fullName.familyName].filter(Boolean).join(' ');
        supabase.auth.updateUser({ data: { full_name: displayName } }).catch(() => {});
      }
      await refreshProfile().catch(() => {});
      trackAnalyticsEvent('login_success', { auth_method: 'apple', entry_point: 'onboarding' });
      trackAnalyticsEvent('account_created', { auth_method: 'apple', entry_point: 'onboarding' });
      trackAnalyticsEvent('onboarding_completed', { auth_method: 'apple', completed_onboarding_version: 'resell' });
      await completeOnboarding('resell').catch(() => {});
      router.replace('/(tabs)' as any);
    } catch (err: any) {
      if (err?.code === 'ERR_REQUEST_CANCELED' || err?.code === 'ERR_CANCELED') {
        setAppleStep('idle');
        return;
      }
      setAppleError('Apple Sign-In failed. Please try again.');
      setAppleStep('idle');
    }
    // Note: don't reset in finally — loading state persists briefly until navigation
  }, [appleStep, saving, googleLoading, router, refreshProfile]);

  const toggleInterest = useCallback((value: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (value === 'Everything') {
        // 'Everything' is exclusive — selecting it clears the rest.
        return next.has('Everything') ? new Set() : new Set(['Everything']);
      }
      next.delete('Everything');
      if (next.has(value)) next.delete(value); else next.add(value);
      return next;
    });
  }, []);

  // Persist interests (best-effort) then advance.
  const saveInterestsAndNext = useCallback(() => {
    const interests = Array.from(selected);
    trackAnalyticsEvent('onboarding_quiz_completed', { selected_interests: interests });
    setOnboardingInterests(interests).catch(() => {});
    setStep(2);
  }, [selected]);

  // Auth → reuse the shared auth screen with onboarding entry context.
  const goToAuth = useCallback((mode: 'signup' | 'login') => {
    trackAnalyticsEvent(
      mode === 'signup' ? 'onboarding_create_account_tapped' : 'onboarding_login_tapped',
      { entry_point: 'onboarding' },
    );
    router.push({ pathname: '/auth', params: { mode, authEntryPoint: 'onboarding' } } as any);
  }, [router]);

  // Finish onboarding → mark current version complete and enter the app.
  // Used by "Continue as guest" (guest) and "Enter FlipStart" (signed-in).
  const finishOnboarding = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    // Guests complete onboarding here (signed-in completion is tracked in the
    // OAuth success paths above, so don't double-count).
    if (!signedIn) {
      trackAnalyticsEvent('onboarding_continue_guest_tapped', { entry_point: 'onboarding' });
      trackAnalyticsEvent('guest_session_started', {});
      trackAnalyticsEvent('onboarding_completed', { auth_method: 'guest', completed_onboarding_version: 'resell' });
    }
    await completeOnboarding('resell').catch(() => {});
    router.replace('/(tabs)' as any);
  }, [saving, router, signedIn]);

  const back = useCallback(() => setStep(s => (s > 0 ? ((s - 1) as Step) : s)), []);

  // ── Progress dots ───────────────────────────────────────────────────────────
  const Dots = () => (
    <View style={st.dotsRow}>
      {[0, 1, 2, 3].map(i => (
        <View key={i} style={[st.dot, i === step && st.dotActive]} />
      ))}
    </View>
  );

  // ── Top bar (back chevron on steps > 0) ───────────────────────────────────────
  const TopBar = () => (
    <View style={st.topBar}>
      {step > 0 ? (
        <Pressable onPress={back} hitSlop={12} style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1 }]}>
          <MaterialIcons name="arrow-back" size={24} color={FOREST} />
        </Pressable>
      ) : <View style={{ width: 24 }} />}
      <Dots />
      <View style={{ width: 24 }} />
    </View>
  );

  return (
    <View style={[st.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <TopBar />

      {/* ── Step 1: Welcome ───────────────────────────────────────────────── */}
      {step === 0 && (
        <ScrollView contentContainerStyle={st.scroll} showsVerticalScrollIndicator={false}>
          <View style={st.brandBlock}>
            <Text style={st.wordmark}>FlipStart</Text>
            <Text style={st.kicker}>✦ THRIFT INTELLIGENCE ✦</Text>
          </View>

          <View style={st.heroIcon}>
            <MaterialIcons name="auto-awesome" size={44} color={GOLD} />
          </View>

          <Text style={st.headline}>Scan thrift finds.{'\n'}Know what to buy.</Text>
          <Text style={st.subtitle}>
            Your AI-powered resale assistant for spotting flips, tracking finds, and building your collection.
          </Text>

          {notice && (
            <View style={st.noticeBox}>
              <MaterialIcons name="info-outline" size={18} color={BROWN} />
              <Text style={st.noticeText}>{notice}</Text>
            </View>
          )}

          <View style={st.ctaBlock}>
            {signedIn ? (
              // Already signed in (e.g. re-onboarding after a version bump) — just
              // walk them through the refreshed quiz; no login needed.
              <Pressable onPress={() => setStep(1)} style={({ pressed }) => [st.primaryBtn, pressed && st.pressed]}>
                <Text style={st.primaryBtnText}>Take the Quiz</Text>
              </Pressable>
            ) : (
              <>
                {/* New users → start the quiz. This does NOT complete onboarding. */}
                <Pressable onPress={() => setStep(1)} style={({ pressed }) => [st.primaryBtn, pressed && st.pressed]}>
                  <Text style={st.primaryBtnText}>Take the Quiz</Text>
                </Pressable>
                {/* Returning users → log in and skip the quiz (Flow B). Onboarding
                    is marked complete by auth.tsx only on a SUCCESSFUL login. */}
                <Pressable onPress={() => goToAuth('login')} style={({ pressed }) => [st.secondaryBtn, pressed && st.pressed]}>
                  <Text style={st.secondaryBtnText}>Log In to Existing Account</Text>
                </Pressable>
              </>
            )}
          </View>
        </ScrollView>
      )}

      {/* ── Step 2: Interests ─────────────────────────────────────────────── */}
      {step === 1 && (
        <ScrollView contentContainerStyle={st.scroll} showsVerticalScrollIndicator={false}>
          <Text style={st.stepTitle}>What do you hunt for?</Text>
          <Text style={st.stepSub}>Pick anything that fits. You can change this later.</Text>

          <View style={st.chipsWrap}>
            {INTERESTS.map(label => {
              const on = selected.has(label);
              return (
                <Pressable
                  key={label}
                  onPress={() => toggleInterest(label)}
                  style={({ pressed }) => [st.chip, on && st.chipOn, pressed && { opacity: 0.85 }]}
                >
                  {on && <MaterialIcons name="check" size={15} color={CREAM} style={{ marginRight: 6 }} />}
                  <Text style={[st.chipText, on && st.chipTextOn]}>{label}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={st.bottomCta}>
            <Pressable onPress={saveInterestsAndNext} style={({ pressed }) => [st.primaryBtn, pressed && st.pressed]}>
              <Text style={st.primaryBtnText}>{selected.size > 0 ? 'Continue' : 'Skip for now'}</Text>
            </Pressable>
          </View>
        </ScrollView>
      )}

      {/* ── Step 3: How FlipStart helps ───────────────────────────────────── */}
      {step === 2 && (
        <ScrollView contentContainerStyle={st.scroll} showsVerticalScrollIndicator={false}>
          <Text style={st.stepTitle}>How FlipStart helps</Text>
          <Text style={st.stepSub}>Three tools to flip smarter.</Text>

          <View style={{ gap: 14, marginTop: 8 }}>
            {HELP_CARDS.map(c => (
              <View key={c.title} style={st.helpCard}>
                <View style={st.helpIconBox}>
                  <MaterialIcons name={c.icon as any} size={24} color={FOREST} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={st.helpTitle}>{c.title}</Text>
                  <Text style={st.helpBody}>{c.body}</Text>
                </View>
              </View>
            ))}
          </View>

          <View style={st.bottomCta}>
            <Pressable onPress={() => setStep(3)} style={({ pressed }) => [st.primaryBtn, pressed && st.pressed]}>
              <Text style={st.primaryBtnText}>Continue</Text>
            </Pressable>
          </View>
        </ScrollView>
      )}

      {/* ── Step 4: Account prompt — matches the Hunt Mode gate design ───── */}
      {step === 3 && (
        <ScrollView contentContainerStyle={ac.scroll} showsVerticalScrollIndicator={false}>
          {signedIn ? (
            // Already signed in (e.g. version-bump re-onboarding) — skip the auth pitch.
            <>
              <View style={ac.headerBlock}>
                <Text style={ac.wordmark}>FlipStart</Text>
                <Text style={ac.tagline}>Account secured.{'\n'}You{'\u2019'}re all set.</Text>
              </View>
              <View style={ac.signedInBadge}>
                <MaterialIcons name="verified-user" size={20} color={FOREST} />
                <Text style={ac.signedInText}>Your progress syncs and stays backed up.</Text>
              </View>
              <View style={ac.benefitsCard}>
                {BENEFITS.map(({ icon, text }) => (
                  <View key={text} style={ac.benefitRow}>
                    <MaterialIcons name={icon as any} size={18} color={GOLD} />
                    <Text style={ac.benefitText}>{text}</Text>
                  </View>
                ))}
              </View>
              <View style={ac.ctaBlock}>
                <Pressable onPress={finishOnboarding} disabled={saving} style={({ pressed }) => [ac.createBtn, (pressed || saving) && { opacity: 0.85 }]}>
                  {saving ? <ActivityIndicator color={CREAM} /> : <Text style={ac.createBtnText}>Enter FlipStart</Text>}
                </Pressable>
              </View>
            </>
          ) : (
            // Guest user — show the full auth pitch matching the Hunt Mode gate screen.
            <>
              <View style={ac.headerBlock}>
                <Text style={ac.wordmark}>FlipStart</Text>
                <Text style={ac.tagline}>Flip smarter.{'\n'}Track everything.</Text>
              </View>

              <View style={ac.benefitsCard}>
                {BENEFITS.map(({ icon, text }) => (
                  <View key={text} style={ac.benefitRow}>
                    <MaterialIcons name={icon as any} size={18} color={GOLD} />
                    <Text style={ac.benefitText}>{text}</Text>
                  </View>
                ))}
              </View>

              <View style={ac.ctaBlock}>
                <Pressable onPress={() => goToAuth('signup')} style={({ pressed }) => [ac.createBtn, pressed && { opacity: 0.87 }]}>
                  <Text style={ac.createBtnText}>Create Account</Text>
                </Pressable>
                <Pressable onPress={() => goToAuth('login')} style={({ pressed }) => [ac.loginBtn, pressed && { opacity: 0.87 }]}>
                  <Text style={ac.loginBtnText}>Log In</Text>
                </Pressable>
              </View>

              {/* ── Social auth ─────────────────────────────────── */}
              <View style={ac.dividerRow}>
                <View style={ac.dividerLine} />
                <Text style={ac.dividerText}>or continue with</Text>
                <View style={ac.dividerLine} />
              </View>

              {(googleError || appleError) && (
                <View style={ac.errorBox}>
                  <MaterialIcons name="error-outline" size={14} color="#721C24" />
                  <Text style={ac.errorText}>{googleError ?? appleError}</Text>
                </View>
              )}

              <Pressable
                onPress={handleGoogleSignIn}
                disabled={googleLoading || saving || appleStep !== 'idle'}
                style={({ pressed }) => [ac.googleBtn, (pressed || googleLoading) && { opacity: 0.8 }]}
              >
                {googleLoading ? (
                  <ActivityIndicator color="#3C4043" size="small" />
                ) : (
                  <>
                    <Text style={ac.googleG}>
                      <Text style={{ color: '#4285F4' }}>G</Text>
                      <Text style={{ color: '#EA4335' }}>o</Text>
                      <Text style={{ color: '#FBBC05' }}>o</Text>
                      <Text style={{ color: '#4285F4' }}>g</Text>
                      <Text style={{ color: '#34A853' }}>l</Text>
                      <Text style={{ color: '#EA4335' }}>e</Text>
                    </Text>
                    <Text style={ac.googleBtnText}>Continue with Google</Text>
                  </>
                )}
              </Pressable>

              <Pressable
                onPress={handleAppleSignIn}
                disabled={appleStep !== 'idle' || saving || googleLoading}
                style={({ pressed }) => [ac.appleBtn, (pressed || appleStep !== 'idle') && { opacity: 0.8 }]}
              >
                {appleStep === 'idle'
                  ? <Text style={ac.appleBtnText}> Continue with Apple</Text>
                  : appleStep === 'opening'
                  ? <ActivityIndicator color="#FFFFFF" size="small" />
                  : appleStep === 'signing'
                  ? <Text style={ac.appleBtnText}>Signing you in…</Text>
                  : <Text style={ac.appleBtnText}>Loading profile…</Text>
                }
              </Pressable>

              {/* Guest mode removed — an account is required to use FlipStart. */}
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  root:          { flex: 1, backgroundColor: PARCHMENT },
  topBar:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4 },
  dotsRow:       { flexDirection: 'row', gap: 7, alignItems: 'center' },
  dot:           { width: 7, height: 7, borderRadius: 4, backgroundColor: CARD_B },
  dotActive:     { backgroundColor: GOLD, width: 22 },

  scroll:        { paddingHorizontal: 24, paddingBottom: 32, flexGrow: 1 },

  brandBlock:    { alignItems: 'center', marginTop: 24, marginBottom: 24 },
  wordmark:      { fontFamily: FONTS.serif, fontSize: 40, fontWeight: '900', color: FOREST, letterSpacing: -0.5 },
  kicker:        { fontSize: 10, fontWeight: '700', color: GOLD, letterSpacing: 2, marginTop: 8 },
  tagline:       { fontFamily: FONTS.serif, fontSize: 24, fontWeight: '700', color: SCAN_DARK, textAlign: 'center', lineHeight: 32, marginTop: 14 },

  heroIcon:      { alignSelf: 'center', width: 92, height: 92, borderRadius: 24, backgroundColor: GOLD + '18', borderWidth: 1.5, borderColor: GOLD + '40', justifyContent: 'center', alignItems: 'center', marginTop: 8, marginBottom: 24 },
  headline:      { fontFamily: FONTS.serif, fontSize: 27, fontWeight: '800', color: FOREST, textAlign: 'center', lineHeight: 35, marginBottom: 14 },
  subtitle:      { fontSize: 15, color: BROWN, textAlign: 'center', lineHeight: 22, paddingHorizontal: 6 },
  noticeBox:     { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: '#F6E9C8', borderWidth: 1, borderColor: GOLD, borderRadius: 12, padding: 12, marginTop: 18 },
  noticeText:    { flex: 1, fontSize: 13, color: BROWN, lineHeight: 19 },

  stepTitle:     { fontFamily: FONTS.serif, fontSize: 26, fontWeight: '800', color: FOREST, marginTop: 24, marginBottom: 8 },
  stepSub:       { fontSize: 14, color: MUTED, lineHeight: 20, marginBottom: 20 },

  chipsWrap:     { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  chip:          { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 13, borderRadius: 50, borderWidth: 1.5, borderColor: CARD_B, backgroundColor: '#FFF9EE' },
  chipOn:        { backgroundColor: SCAN_DARK, borderColor: SCAN_DARK },
  chipText:      { fontSize: 14, fontWeight: '600', color: BROWN },
  chipTextOn:    { color: CREAM },

  helpCard:      { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: CARD_BG, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: CARD_B },
  helpIconBox:   { width: 48, height: 48, borderRadius: 12, backgroundColor: FOREST + '12', justifyContent: 'center', alignItems: 'center' },
  helpTitle:     { fontFamily: FONTS.serif, fontSize: 17, fontWeight: '800', color: FOREST, marginBottom: 3 },
  helpBody:      { fontSize: 13.5, color: BROWN, lineHeight: 19 },

  benefitsCard:  { backgroundColor: CARD_BG, borderRadius: 18, padding: 20, marginBottom: 28, gap: 14, borderWidth: 1, borderColor: CARD_B },
  benefitRow:    { flexDirection: 'row', alignItems: 'center', gap: 12 },
  benefitText:   { fontSize: 14, color: BROWN, flex: 1, lineHeight: 20 },

  signedInBadge: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: FOREST + '14', borderRadius: 14, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: FOREST + '33' },
  signedInText:  { flex: 1, fontSize: 13.5, color: FOREST, fontWeight: '600', lineHeight: 19 },
  accountPitch:  { fontSize: 15, color: BROWN, textAlign: 'center', fontWeight: '600', marginBottom: 18, lineHeight: 21 },

  ctaBlock:      { gap: 12, marginTop: 'auto', paddingTop: 24 },
  bottomCta:     { marginTop: 'auto', paddingTop: 28 },
  primaryBtn:    { backgroundColor: SCAN_DARK, borderRadius: 50, paddingVertical: 18, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText:{ fontFamily: FONTS.serif, fontSize: 17, fontWeight: '800', color: CREAM, letterSpacing: 0.2 },
  secondaryBtn:  { borderRadius: 50, paddingVertical: 17, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: FOREST },
  secondaryBtnText: { fontFamily: FONTS.serif, fontSize: 17, fontWeight: '700', color: FOREST },
  guestBtn:      { alignItems: 'center', paddingVertical: 16 },
  guestText:     { fontSize: 13, color: MUTED, textDecorationLine: 'underline' },
  pressed:       { opacity: 0.87 },
});

// ─── Account prompt styles (step 3) — mirrors auth.tsx entry-mode ─────────────
const ac = StyleSheet.create({
  scroll:       { paddingHorizontal: 24, paddingBottom: 48, paddingTop: 8, flexGrow: 1 },
  headerBlock:  { alignItems: 'center', marginBottom: 28, marginTop: 12 },
  wordmark:     { fontFamily: FONTS.serif, fontSize: 42, fontWeight: '900', color: FOREST, letterSpacing: -0.5, marginBottom: 14 },
  tagline:      { fontFamily: FONTS.serif, fontSize: 24, fontWeight: '700', color: SCAN_DARK, textAlign: 'center', lineHeight: 32 },

  benefitsCard: { backgroundColor: '#EDE0C4', borderRadius: 18, padding: 20, marginBottom: 28, gap: 14, borderWidth: 1, borderColor: CARD_B },
  benefitRow:   { flexDirection: 'row', alignItems: 'center', gap: 12 },
  benefitText:  { fontSize: 14, color: BROWN, flex: 1, lineHeight: 20 },

  ctaBlock:     { gap: 12, marginBottom: 8 },
  createBtn:    { backgroundColor: SCAN_DARK, borderRadius: 50, paddingVertical: 18, alignItems: 'center', justifyContent: 'center' },
  createBtnText:{ fontFamily: FONTS.serif, fontSize: 17, fontWeight: '800', color: CREAM, letterSpacing: 0.2 },
  loginBtn:     { borderRadius: 50, paddingVertical: 17, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: FOREST },
  loginBtnText: { fontFamily: FONTS.serif, fontSize: 17, fontWeight: '700', color: FOREST },

  dividerRow:   { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14, marginTop: 6 },
  dividerLine:  { flex: 1, height: 1, backgroundColor: CARD_B },
  dividerText:  { fontSize: 12, color: MUTED, fontWeight: '600' },

  errorBox:     { flexDirection: 'row', alignItems: 'flex-start', gap: 6, backgroundColor: '#F8D7DA', borderRadius: 10, padding: 12, marginBottom: 12 },
  errorText:    { fontSize: 13, color: '#721C24', flex: 1, lineHeight: 18 },

  googleBtn:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: '#FFFFFF', borderRadius: 50, paddingVertical: 16, borderWidth: 1.5, borderColor: '#DADCE0', marginBottom: 10 },
  googleG:      { fontSize: 15, fontWeight: '800' },
  googleBtnText:{ fontSize: 15, fontWeight: '600', color: '#3C4043' },
  appleBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#000000', borderRadius: 50, paddingVertical: 16 },
  appleBtnText: { fontSize: 15, fontWeight: '600', color: '#FFFFFF' },

  guestBtn:     { alignItems: 'center', paddingVertical: 20 },
  guestText:    { fontSize: 13, color: MUTED, textDecorationLine: 'underline' },

  signedInBadge:{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#2A4A2A14', borderRadius: 14, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: '#2A4A2A33' },
  signedInText: { flex: 1, fontSize: 13.5, color: '#2A4A2A', fontWeight: '600', lineHeight: 19 },
});
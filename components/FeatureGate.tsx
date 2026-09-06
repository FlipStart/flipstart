/**
 * components/FeatureGate.tsx
 * In-app account gate shown when a guest opens an account-required feature
 * (Hunt Mode, Progress). Renders INSIDE a tab so the bottom tab bar stays
 * visible — this is NOT onboarding and NOT a full-screen auth modal.
 *
 * Auth is opened with authEntryPoint='featureGate' and a returnTo target so the
 * user lands back on the locked feature after a successful sign-in.
 * There is no "continue as guest" action. It used to replace to Home, but the
 * home gate sends a signed-out user straight to /onboarding — so the control
 * that read as "decline the account" in fact walked the user into the signup
 * funnel. This is a tab screen; switching tabs is the way out.
 */

import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FONTS } from '@/constants/typography';
import { navGuard } from '@/lib/navGuard';
import { setAuthReturnDest } from '@/lib/authReturn';

const FOREST    = '#2A4A2A';
const SCAN_DARK = '#152815';
const PARCHMENT = '#F0E8D4';
const CREAM     = '#F4EED8';
const CARD_B    = '#DDD0B0';
const CARD_BG   = '#EDE0C4';
const BROWN     = '#5A3A1A';
const MUTED     = '#8A7050';
const GOLD      = '#BE9C2C';

export type GateReturnTo = 'hunt' | 'progress';

interface FeatureGateProps {
  icon:     keyof typeof MaterialIcons.glyphMap;
  title:    string;
  subtitle: string;
  body:     string;
  benefits: string[];
  returnTo: GateReturnTo;
}

export default function FeatureGate({ icon, title, subtitle, body, benefits, returnTo }: FeatureGateProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const openAuth = (mode: 'signup' | 'login') => {
    if (!navGuard()) return;
    // Declare where to land after a successful sign-in (robust against stale params).
    setAuthReturnDest(returnTo === 'hunt' ? '/hunt' : '/(tabs)/progress');
    router.push({
      pathname: '/auth',
      params: { mode, authEntryPoint: 'featureGate' },
    } as any);
  };

  // Declining the optional account → return to Home (stays inside the app).
  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <ScrollView
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* Icon medallion */}
        <View style={s.iconWrap}>
          <MaterialIcons name={icon} size={42} color={GOLD} />
        </View>

        <Text style={s.title}>{title}</Text>
        <Text style={s.subtitle}>{subtitle}</Text>
        <Text style={s.body}>{body}</Text>

        {/* Benefits card */}
        <View style={s.card}>
          {benefits.map(text => (
            <View key={text} style={s.row}>
              <MaterialIcons name="check-circle" size={18} color={GOLD} />
              <Text style={s.rowText}>{text}</Text>
            </View>
          ))}
        </View>

        {/* CTAs */}
        <View style={s.ctaBlock}>
          <Pressable onPress={() => openAuth('signup')} style={({ pressed }) => [s.primaryBtn, pressed && { opacity: 0.87 }]}>
            <Text style={s.primaryBtnText}>Create Account</Text>
          </Pressable>
          <Pressable onPress={() => openAuth('login')} style={({ pressed }) => [s.secondaryBtn, pressed && { opacity: 0.87 }]}>
            <Text style={s.secondaryBtnText}>Log In</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root:           { flex: 1, backgroundColor: PARCHMENT },
  scroll:         { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 28, paddingVertical: 32 },
  iconWrap:       {
    alignSelf: 'center', width: 88, height: 88, borderRadius: 24,
    backgroundColor: GOLD + '18', borderWidth: 1.5, borderColor: GOLD + '40',
    justifyContent: 'center', alignItems: 'center', marginBottom: 22,
  },
  title:          { fontFamily: FONTS.serif, fontSize: 28, fontWeight: '800', color: FOREST, textAlign: 'center', marginBottom: 8 },
  subtitle:       { fontFamily: FONTS.serif, fontSize: 17, fontWeight: '700', color: SCAN_DARK, textAlign: 'center', marginBottom: 14 },
  body:           { fontSize: 14.5, color: BROWN, textAlign: 'center', lineHeight: 22, marginBottom: 24, paddingHorizontal: 4 },
  card:           { backgroundColor: CARD_BG, borderRadius: 18, padding: 20, gap: 14, borderWidth: 1, borderColor: CARD_B, marginBottom: 28 },
  row:            { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowText:        { fontSize: 14, color: BROWN, flex: 1, lineHeight: 20 },
  ctaBlock:       { gap: 12 },
  primaryBtn:     { backgroundColor: SCAN_DARK, borderRadius: 50, paddingVertical: 18, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { fontFamily: FONTS.serif, fontSize: 17, fontWeight: '800', color: CREAM, letterSpacing: 0.2 },
  secondaryBtn:   { borderRadius: 50, paddingVertical: 17, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: FOREST },
  secondaryBtnText:{ fontFamily: FONTS.serif, fontSize: 17, fontWeight: '700', color: FOREST },
});
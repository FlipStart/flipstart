/**
 * app/dev-monetization.tsx
 *
 * DEVELOPMENT-ONLY RevenueCat verification screen.
 *
 * Replaces a curl command with a button. Same server harness, same founder
 * secret — this screen supplies no plan, no product and no override, so it
 * cannot grant entitlement any more than the endpoint can.
 *
 * ── Production safety ───────────────────────────────────────────────────────
 * Expo Router is file-based: THIS FILE EXISTS IN THE PRODUCTION BUNDLE AND ITS
 * ROUTE IS NAVIGABLE. A <Stack.Screen> declaration configures a route, it does
 * not create or remove one. What protects it:
 *   1. <Stack.Protected guard={__DEV__}> in _layout.tsx blocks navigation
 *   2. this component's own __DEV__ check, for a direct deep link
 *   3. the server gate — without MONETIZATION_DIAG_SECRET the endpoint refuses
 * Layers 1 and 2 are client-side controls; layer 3 is the real boundary.
 */
import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, TextInput, StyleSheet, ActivityIndicator } from 'react-native';
import { ScreenContainer } from '@/components/screen-container';
import { useAuth } from '@/lib/auth-context';
import { trpc } from '@/lib/trpc';

const FOREST = '#2A4A2A';
const BROWN  = '#5A3A1A';
const MUTED  = '#8A7050';
const GOLD   = '#BE9C2C';
const CREAM  = '#F4EED8';
const CARD   = '#FFFEFA';

type Check = { name: string; status: 'pass'|'fail'|'warn'|'skip'; detail: string; needsPurchase?: boolean };

const COLOR: Record<Check['status'], string> = {
  pass: '#1E7A34', fail: '#8A3A2A', warn: '#8A5A1A', skip: MUTED,
};
const ICON: Record<Check['status'], string> = {
  pass: '✓', fail: '✕', warn: '!', skip: '–',
};

export default function DevMonetization() {
  // Hooks run unconditionally — an early return above them would break the
  // Rules of Hooks and crash on any re-render. The __DEV__ gate is applied to
  // the RENDER instead, below, which is equally effective and legal.
  const { user } = useAuth();
  const [secret, setSecret] = useState('');
  const [useProbe, setUseProbe] = useState(true);
  const [report, setReport] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  const diagnose = trpc.monetization.diagnose.useMutation();

  const run = async () => {
    setError(null); setReport(null);
    try {
      const res: any = await diagnose.mutateAsync({
        secret: secret.trim(),
        // The user's OWN id, never typed in. There is deliberately no field for
        // probing another account.
        ...(useProbe && user?.id ? { probeUserId: user.id } : {}),
      });
      if (res?.errorCode === 'FOUNDER_ONLY') {
        setError('Wrong secret, or MONETIZATION_DIAG_SECRET is not set on the server.');
        return;
      }
      setReport(res);
    } catch (e: any) {
      setError(e?.message ?? 'Request failed.');
    }
  };

  const checks: Check[] = report?.checks ?? [];
  // Device-only items are informational, not failures. Grouped so they cannot be
  // mistaken for something broken.
  const real = checks.filter(c => !c.needsPurchase);
  const deviceOnly = checks.filter(c => c.needsPurchase);

  // Production denial, after all hooks.
  if (!__DEV__) {
    return (
      <ScreenContainer>
        <View style={s.denied}><Text style={s.deniedText}>Not available.</Text></View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <ScrollView contentContainerStyle={s.page}>
        <Text style={s.h1}>RevenueCat Diagnostics</Text>
        <Text style={s.note}>
          Verifies everything that does not need a device purchase. Read-only, except
          for applying the real subscription state the store already reports.
        </Text>

        <Text style={s.label}>MONETIZATION_DIAG_SECRET</Text>
        <TextInput
          style={s.input}
          value={secret}
          onChangeText={setSecret}
          placeholder="paste the Railway value"
          placeholderTextColor={MUTED}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
        />

        <Pressable onPress={() => setUseProbe(v => !v)} style={s.toggleRow}>
          <View style={[s.checkbox, useProbe && s.checkboxOn]}>
            {useProbe && <Text style={s.checkboxTick}>✓</Text>}
          </View>
          <Text style={s.toggleText}>
            Include a live RevenueCat lookup for my account
            {user?.id ? ` (${user.id.slice(0, 8)}…)` : ' — not signed in'}
          </Text>
        </Pressable>

        <Pressable
          onPress={run}
          disabled={!secret.trim() || diagnose.isPending}
          style={({ pressed }) => [
            s.runBtn,
            (!secret.trim() || diagnose.isPending) && s.runBtnDisabled,
            pressed && { opacity: 0.85 },
          ]}
        >
          {diagnose.isPending
            ? <ActivityIndicator size="small" color={CREAM} />
            : <Text style={s.runBtnText}>Run diagnostics</Text>}
        </Pressable>

        {!!error && <Text style={s.error}>{error}</Text>}

        {report && (
          <>
            <View style={s.summaryRow}>
              {([['pass','Pass'],['fail','Fail'],['warn','Warn'],['skip','Skip']] as const).map(([k,l]) => (
                <View key={k} style={s.summaryBox}>
                  <Text style={[s.summaryNum, { color: COLOR[k] }]}>{report.summary?.[k] ?? 0}</Text>
                  <Text style={s.summaryLabel}>{l}</Text>
                </View>
              ))}
            </View>

            <Text style={[s.verdict, { color: report.ok ? COLOR.pass : COLOR.fail }]}>
              {report.ok
                ? 'All server-side checks passed.'
                : 'Something needs fixing before a build is worth spending.'}
            </Text>

            <Text style={s.section}>Checks</Text>
            {real.map((c, i) => (
              <View key={i} style={s.check}>
                <Text style={[s.checkIcon, { color: COLOR[c.status] }]}>{ICON[c.status]}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={s.checkName}>{c.name}</Text>
                  <Text style={s.checkDetail}>{c.detail}</Text>
                </View>
              </View>
            ))}

            {deviceOnly.length > 0 && (
              <>
                <Text style={s.section}>Needs a real purchase</Text>
                <Text style={s.note}>
                  Not failures — these simply cannot be checked from the server.
                </Text>
                {deviceOnly.map((c, i) => (
                  <View key={i} style={s.check}>
                    <Text style={[s.checkIcon, { color: MUTED }]}>–</Text>
                    <Text style={[s.checkDetail, { flex: 1 }]}>{c.detail}</Text>
                  </View>
                ))}
              </>
            )}
          </>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const s = StyleSheet.create({
  page: { padding: 16, gap: 10, paddingBottom: 60 },
  h1: { fontSize: 20, fontWeight: '800', color: FOREST },
  note: { fontSize: 12, color: MUTED, lineHeight: 17 },
  label: { fontSize: 11, fontWeight: '800', color: BROWN, letterSpacing: 0.6, marginTop: 10 },
  input: { borderWidth: 1.5, borderColor: GOLD + '66', borderRadius: 10, backgroundColor: CARD,
           paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: FOREST },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
  checkbox: { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: GOLD,
              alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: FOREST, borderColor: FOREST },
  checkboxTick: { color: CREAM, fontSize: 13, fontWeight: '800' },
  toggleText: { flex: 1, fontSize: 12, color: BROWN, lineHeight: 17 },
  runBtn: { backgroundColor: FOREST, borderRadius: 12, paddingVertical: 14,
            alignItems: 'center', marginTop: 12 },
  runBtnDisabled: { opacity: 0.4 },
  runBtnText: { color: CREAM, fontSize: 15, fontWeight: '800' },
  error: { fontSize: 12.5, color: '#8A3A2A', marginTop: 10, lineHeight: 18 },
  summaryRow: { flexDirection: 'row', gap: 8, marginTop: 18 },
  summaryBox: { flex: 1, backgroundColor: CREAM, borderRadius: 10, borderWidth: 1,
                borderColor: GOLD + '55', paddingVertical: 9, alignItems: 'center' },
  summaryNum: { fontSize: 20, fontWeight: '800' },
  summaryLabel: { fontSize: 9.5, fontWeight: '700', color: BROWN, letterSpacing: 0.6 },
  verdict: { fontSize: 13, fontWeight: '700', marginTop: 12, lineHeight: 19 },
  section: { fontSize: 12, fontWeight: '800', color: BROWN, letterSpacing: 0.7,
             marginTop: 20, marginBottom: 4 },
  check: { flexDirection: 'row', gap: 10, paddingVertical: 7,
           borderBottomWidth: 1, borderBottomColor: GOLD + '22' },
  checkIcon: { fontSize: 14, fontWeight: '800', width: 16, textAlign: 'center' },
  checkName: { fontSize: 12.5, fontWeight: '700', color: FOREST },
  checkDetail: { fontSize: 11.5, color: MUTED, lineHeight: 16, marginTop: 1 },
  denied: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  deniedText: { fontSize: 14, color: MUTED },
});
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
import { purchase, restorePurchases, isPurchaseInProgress,
         purchaseScanPack, recoverPacksOnServer,
         SCAN_PACK_SKUS, type ScanPackSku } from '@/lib/purchases';

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
  const entitlement = trpc.monetization.entitlement.useQuery(undefined, { enabled: !!user?.id });

  const [busy, setBusy] = useState<null | 'monthly' | 'annual' | 'restore' | 'recover' | ScanPackSku>(null);
  const [purchaseMsg, setPurchaseMsg] = useState<string | null>(null);

  /**
   * Identity capture.
   *
   * The uid is read at the moment the button is tapped and re-checked by the
   * service after the store sheet closes. If the account changed in between,
   * User A's purchase is never applied to User B.
   */
  const runPurchase = async (target: 'monthly' | 'annual') => {
    const started = user?.id ?? null;
    setBusy(target); setPurchaseMsg(null);
    try {
      const r = await purchase(target, started, () => user?.id ?? null);
      setPurchaseMsg(
        r.status === 'success'      ? `Success — server plan: ${r.serverPlan ?? 'unknown'}`
      : r.status === 'cancelled'    ? 'Cancelled.'
      : r.status === 'pending'      ? (r.message ?? 'Pending approval.')
      : r.status === 'sync_pending'   ? (r.message ?? 'Purchased; sync pending.')
      : r.status === 'account_changed' ? (r.message ?? 'Account changed — not applied here.')
      : r.status === 'unavailable'  ? (r.message ?? 'Requires a development build.')
      :                               (r.message ?? 'Purchase failed.'),
      );
      // Re-read the authoritative server state after any terminal outcome.
      entitlement.refetch();
    } finally {
      setBusy(null);
    }
  };

  const [packMsg, setPackMsg] = useState<string | null>(null);

  const runPack = async (sku: ScanPackSku) => {
    const started = user?.id ?? null;
    setBusy(sku); setPackMsg(null);
    try {
      const r = await purchaseScanPack(sku, started, () => user?.id ?? null);
      setPackMsg(
        r.status === 'success'         ? `Granted +${r.scansGranted ?? 0} scans · balance ${r.packBalance ?? '?'}`
      : r.status === 'cancelled'       ? 'Cancelled.'
      : r.status === 'pending'         ? (r.message ?? 'Pending approval.')
      : r.status === 'sync_pending'    ? (r.message ?? 'Purchased; grant pending.')
      : r.status === 'account_changed' ? (r.message ?? 'Account changed — not granted here.')
      : r.status === 'unavailable'     ? (r.message ?? 'Requires a development build.')
      :                                  (r.message ?? 'Purchase failed.'),
      );
      entitlement.refetch();
    } finally { setBusy(null); }
  };

  const runRecover = async () => {
    setBusy('recover'); setPackMsg(null);
    try {
      const r = await recoverPacksOnServer();
      setPackMsg(r.ok
        ? `Recovery: ${r.grantedCount} granted (+${r.totalScansGranted} scans), ${r.alreadyGranted} already`
        : 'Recovery could not complete — try again.');
      entitlement.refetch();
    } finally { setBusy(null); }
  };

  const runRestore = async () => {
    const started = user?.id ?? null;
    setBusy('restore'); setPurchaseMsg(null);
    try {
      const r = await restorePurchases(started, () => user?.id ?? null);
      setPurchaseMsg(
        r.status === 'restored'           ? `Restored — server plan: ${r.serverPlan ?? 'unknown'}`
      : r.status === 'nothing_to_restore' ? 'Nothing to restore.'
      : r.status === 'unavailable'        ? (r.message ?? 'Requires a development build.')
      : r.status === 'sync_pending'       ? (r.message ?? 'Restored; sync pending.')
      : r.status === 'account_changed'    ? (r.message ?? 'Account changed — not applied here.')
      : r.status === 'owned_by_another_account'
                                          ? (r.message ?? 'Held by another FlipStart account.')
      :                                     (r.message ?? 'Restore failed.'),
      );
      entitlement.refetch();
    } finally {
      setBusy(null);
    }
  };

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

        {/* ── Purchase harness ──────────────────────────────────────────────
            Temporary engineering UI. Deliberately plain — the real paywall is a
            later phase. There is NO control here that writes plan state: every
            button initiates a real RevenueCat operation and the server decides
            the outcome. */}
        <Text style={s.section}>Subscription (DEV)</Text>
        <Text style={s.note}>
          Server plan: {entitlement.data?.entitlement?.plan ?? '—'}
          {entitlement.data?.entitlement?.balances
            ? `  ·  ${entitlement.data.entitlement.balances.totalUsableScans} usable scans`
            : ''}
        </Text>

        <View style={s.btnRow}>
          {(['monthly','annual'] as const).map(k => (
            <Pressable
              key={k}
              onPress={() => runPurchase(k)}
              disabled={busy !== null}
              style={({ pressed }) => [s.smallBtn, busy !== null && s.runBtnDisabled, pressed && { opacity: 0.85 }]}
            >
              {busy === k
                ? <ActivityIndicator size="small" color={CREAM} />
                : <Text style={s.smallBtnText}>Buy {k === 'monthly' ? 'Monthly' : 'Annual'}</Text>}
            </Pressable>
          ))}
        </View>
        <Pressable
          onPress={runRestore}
          disabled={busy !== null}
          style={({ pressed }) => [s.smallBtn, { marginTop: 8 }, busy !== null && s.runBtnDisabled, pressed && { opacity: 0.85 }]}
        >
          {busy === 'restore'
            ? <ActivityIndicator size="small" color={CREAM} />
            : <Text style={s.smallBtnText}>Restore Purchases</Text>}
        </Pressable>

        {!!purchaseMsg && <Text style={s.purchaseMsg}>{purchaseMsg}</Text>}

        {/* ── Scan packs (DEV) ──────────────────────────────────────────────
            Every button initiates a REAL RevenueCat purchase. There is no
            control here that writes a balance or names a scan count — the
            server resolves the grant from the store SKU it verifies itself. */}
        <Text style={s.section}>Scan Packs (DEV)</Text>
        <Text style={s.note}>
          Pack balance: {entitlement.data?.entitlement?.balances?.packScansRemaining ?? '—'}
        </Text>

        {SCAN_PACK_SKUS.map(sku => (
          <Pressable
            key={sku}
            onPress={() => runPack(sku)}
            disabled={busy !== null}
            style={({ pressed }) => [s.smallBtn, { marginTop: 8 },
              busy !== null && s.runBtnDisabled, pressed && { opacity: 0.85 }]}
          >
            {busy === sku
              ? <ActivityIndicator size="small" color={CREAM} />
              : <Text style={s.smallBtnText}>Buy {sku.replace('flipstart_scan_pack_', '')} scans</Text>}
          </Pressable>
        ))}

        <Pressable
          onPress={runRecover}
          disabled={busy !== null}
          style={({ pressed }) => [s.smallBtn, { marginTop: 8, backgroundColor: BROWN },
            busy !== null && s.runBtnDisabled, pressed && { opacity: 0.85 }]}
        >
          {busy === 'recover'
            ? <ActivityIndicator size="small" color={CREAM} />
            : <Text style={s.smallBtnText}>Recover unclaimed packs</Text>}
        </Pressable>

        {!!packMsg && <Text style={s.purchaseMsg}>{packMsg}</Text>}

        <Text style={s.section}>Diagnostics</Text>
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
  btnRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  smallBtn: { flex: 1, backgroundColor: FOREST, borderRadius: 10, paddingVertical: 11,
              alignItems: 'center' },
  smallBtnText: { color: CREAM, fontSize: 13, fontWeight: '800' },
  purchaseMsg: { fontSize: 12.5, color: BROWN, marginTop: 10, lineHeight: 18 },
  denied: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  deniedText: { fontSize: 14, color: MUTED },
});
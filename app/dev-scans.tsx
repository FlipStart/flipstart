/**
 * Dev — Scan Quota
 *
 * Raises the daily scan limit for THIS device's scannerId so testing does not
 * burn the normal 7/day.
 *
 * Security note for anyone reading this later: the __DEV__ gate on the settings
 * row only hides the button. It is not the protection. The server requires
 * DEV_SCAN_GRANT_SECRET, which lives in Railway and is never bundled into the
 * app — so a production build cannot grant itself anything even if someone
 * finds this screen. The secret is typed in at runtime and held in component
 * state only; it is never written to AsyncStorage, never logged, and is gone
 * the moment this screen unmounts.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, ScrollView, Alert, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/lib/auth-context';

const CREAM   = '#F4EED8';
const CARD    = '#FFFEFA';
const BORDER  = '#DDD2AC';
const GREEN   = '#214D2D';
const DARK    = '#2B2118';
const MUTED   = '#7A6A55';
const DANGER  = '#B85450';

export default function DevScansScreen() {
  const router  = useRouter();
  const insets  = useSafeAreaInsets();

  const { user } = useAuth();
  const [scannerId, setScannerId] = useState('');
  const [secret, setSecret]       = useState('');
  const [limit, setLimit]         = useState('200');
  const [hours, setHours]         = useState('4');
  const [busy, setBusy]           = useState(false);

  // Must match exactly what loading.tsx sends on a scan (line 272): the auth
  // user id when signed in, the analytics fallback otherwise. A grant keyed to
  // a different id would silently do nothing.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (user?.id) { if (!cancelled) setScannerId(user.id); return; }
      try {
        const { getScannerId } = await import('@/lib/analytics');
        const fallback = await getScannerId();
        if (!cancelled && fallback && fallback !== 'anon_unknown') setScannerId(fallback);
      } catch { /* leave blank; the UI shows it */ }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  const statusQ = trpc.dev.grantStatus.useQuery(
    { scannerId },
    { enabled: !!scannerId, refetchInterval: 30_000 },
  );
  const grantM  = trpc.dev.grantScans.useMutation();
  const revokeM = trpc.dev.revokeScans.useMutation();

  const refresh = useCallback(() => { statusQ.refetch().catch(() => {}); }, [statusQ]);

  const onGrant = async () => {
    if (!secret.trim()) { Alert.alert('Secret required', 'Enter the dev grant secret.'); return; }
    if (!scannerId)     { Alert.alert('No scanner id', 'Could not read this device id.'); return; }
    setBusy(true);
    try {
      const res = await grantM.mutateAsync({
        secret: secret.trim(),
        scannerId,
        limit: Math.max(1, Math.min(500, parseInt(limit, 10) || 200)),
        hours: Math.max(1, Math.min(12, parseInt(hours, 10) || 4)),
      });
      if (res.ok) {
        setSecret('');   // clear immediately on success
        Alert.alert(
          'Granted',
          `Limit raised to ${res.limit}.\nExpires ${new Date(res.expiresAt).toLocaleTimeString()}.`,
        );
        refresh();
      } else {
        const msg = res.reason === 'not_configured'
          ? 'DEV_SCAN_GRANT_SECRET is not set on the server, or is under 16 characters.'
          : res.reason === 'locked_out'
          ? 'Too many failed attempts. Locked for 15 minutes.'
          : 'Rejected.';
        Alert.alert('Not granted', msg);
      }
    } catch {
      Alert.alert('Request failed', 'Could not reach the server.');
    } finally { setBusy(false); }
  };

  const onRevoke = async () => {
    if (!secret.trim()) { Alert.alert('Secret required', 'Enter the secret to revoke.'); return; }
    setBusy(true);
    try {
      const res = await revokeM.mutateAsync({ secret: secret.trim(), scannerId });
      setSecret('');
      Alert.alert(res.ok ? 'Revoked' : 'Nothing to revoke',
                  res.ok ? 'Limit is back to normal.' : 'No active grant for this device.');
      refresh();
    } catch {
      Alert.alert('Request failed', 'Could not reach the server.');
    } finally { setBusy(false); }
  };

  const st = statusQ.data;

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.headerBtn} hitSlop={8}>
          <MaterialIcons name="arrow-back" size={20} color={CREAM} />
        </Pressable>
        <Text style={s.headerTitle}>Scan Quota (Dev)</Text>
        <View style={s.headerBtn} />
      </View>

      <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">

        <View style={s.card}>
          <Text style={s.cardLabel}>STATUS</Text>
          {statusQ.isLoading ? <ActivityIndicator color={GREEN} /> : (
            <>
              <Text style={s.statusLine}>
                {st?.configured ? '● Server secret configured' : '○ Server secret NOT set'}
              </Text>
              <Text style={[s.statusLine, { color: st?.active ? GREEN : MUTED }]}>
                {st?.active
                  ? `● Active grant — limit ${st.limit}, expires ${st.expiresAt ? new Date(st.expiresAt).toLocaleTimeString() : '?'}`
                  : '○ No active grant — normal limit applies'}
              </Text>
              <Text style={s.mono}>{scannerId || 'reading device id…'}</Text>
            </>
          )}
        </View>

        <View style={s.card}>
          <Text style={s.cardLabel}>GRANT</Text>
          <Text style={s.hint}>
            The secret lives on the server and is never stored on this device.
            You will re-enter it each time.
          </Text>

          <TextInput
            value={secret}
            onChangeText={setSecret}
            placeholder="Dev grant secret"
            placeholderTextColor={MUTED}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="password"
            style={s.input}
          />

          <View style={s.row}>
            <View style={s.half}>
              <Text style={s.fieldLabel}>Scans</Text>
              <TextInput value={limit} onChangeText={setLimit} keyboardType="number-pad" style={s.input} />
            </View>
            <View style={s.half}>
              <Text style={s.fieldLabel}>Hours</Text>
              <TextInput value={hours} onChangeText={setHours} keyboardType="number-pad" style={s.input} />
            </View>
          </View>

          <Pressable onPress={onGrant} disabled={busy}
            style={({ pressed }) => [s.btn, pressed && { opacity: 0.75 }, busy && { opacity: 0.5 }]}>
            <Text style={s.btnText}>{busy ? 'Working…' : 'Grant'}</Text>
          </Pressable>

          <Pressable onPress={onRevoke} disabled={busy}
            style={({ pressed }) => [s.btnGhost, pressed && { opacity: 0.75 }]}>
            <Text style={s.btnGhostText}>Revoke</Text>
          </Pressable>
        </View>

        <Text style={s.footnote}>
          Max 500 scans, max 12 hours. Grants clear on server restart and never
          bypass the global daily cost cap. Five wrong secrets locks this for 15 minutes.
        </Text>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root:        { flex: 1, backgroundColor: CREAM },
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                 backgroundColor: GREEN, paddingHorizontal: 14, paddingVertical: 12 },
  headerBtn:   { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: CREAM, fontSize: 16, fontWeight: '800', letterSpacing: 0.5 },
  body:        { padding: 14, gap: 14, paddingBottom: 40 },
  card:        { backgroundColor: CARD, borderRadius: 14, borderWidth: 1, borderColor: BORDER,
                 padding: 14, gap: 10 },
  cardLabel:   { fontSize: 10, fontWeight: '800', color: MUTED, letterSpacing: 1.2 },
  statusLine:  { fontSize: 13, color: DARK, fontWeight: '600' },
  mono:        { fontSize: 11, color: MUTED, marginTop: 2 },
  hint:        { fontSize: 12, color: MUTED, lineHeight: 17 },
  fieldLabel:  { fontSize: 11, fontWeight: '700', color: MUTED, marginBottom: 4 },
  input:       { borderWidth: 1, borderColor: BORDER, borderRadius: 10, paddingHorizontal: 12,
                 paddingVertical: 10, fontSize: 15, color: DARK, backgroundColor: '#FFF' },
  row:         { flexDirection: 'row', gap: 10 },
  half:        { flex: 1 },
  btn:         { backgroundColor: GREEN, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  btnText:     { color: CREAM, fontWeight: '800', fontSize: 15 },
  btnGhost:    { borderWidth: 1, borderColor: DANGER, borderRadius: 12, paddingVertical: 11,
                 alignItems: 'center' },
  btnGhostText:{ color: DANGER, fontWeight: '700', fontSize: 14 },
  footnote:    { fontSize: 11, color: MUTED, lineHeight: 16, paddingHorizontal: 4 },
});
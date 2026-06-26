/**
 * components/UpdateGate.tsx
 *
 * Renders a blocking ("hard") or dismissable ("soft") update prompt based on the
 * remote version config. Mount this once near the app root. It:
 *   - checks on mount and whenever the app returns to foreground
 *   - fails safe: any error → renders nothing (never blocks)
 *   - hard modal cannot be dismissed (only "Update" or "Check again")
 *   - soft modal can be dismissed with "Later"
 *
 * No startup-critical imports: version-check lazy-loads Supabase itself.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, Modal, ActivityIndicator,
  AppState, AppStateStatus, Linking, Platform,
} from 'react-native';
import {
  getCurrentAppVersion, fetchVersionConfig, decideUpdate, type UpdateDecision,
} from '@/lib/version-check';

const FOREST = '#2A4A2A';
const CREAM  = '#F4EED8';
const PAGE   = '#F0E8D4';
const MUTED  = '#8A7050';
const BORDER = '#C8B88A';
const GOLD   = '#BE9C2C';

// Fallback store URL if the remote config doesn't supply one (hard blocks still
// require a URL, but soft prompts can use this).
const DEFAULT_STORE_URL = 'https://apps.apple.com/app/id6770193673';

export default function UpdateGate() {
  const [decision, setDecision] = useState<UpdateDecision>({ kind: 'none' });
  const [checking, setChecking] = useState(false);
  const [dismissedSoft, setDismissedSoft] = useState(false);
  const inFlight = useRef(false);

  const runCheck = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setChecking(true);
    try {
      const current = getCurrentAppVersion();
      const cfg = await fetchVersionConfig();
      const d = decideUpdate(current, cfg);
      setDecision(d);
    } catch {
      setDecision({ kind: 'none' }); // fail safe
    } finally {
      setChecking(false);
      inFlight.current = false;
    }
  }, []);

  // Check on mount.
  useEffect(() => { void runCheck(); }, [runCheck]);

  // Re-check when the app returns to foreground.
  useEffect(() => {
    const onChange = (next: AppStateStatus) => {
      if (next === 'active') void runCheck();
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [runCheck]);

  const openStore = useCallback((url: string | null) => {
    const target = url || DEFAULT_STORE_URL;
    Linking.openURL(target).catch(() => {});
  }, []);

  if (decision.kind === 'none') return null;
  if (decision.kind === 'soft' && dismissedSoft) return null;

  const isHard = decision.kind === 'hard';

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      // Hard modal: swallow the Android back button so it can't be dismissed.
      onRequestClose={() => { if (!isHard) setDismissedSoft(true); }}
    >
      <View style={s.backdrop}>
        <View style={s.card}>
          <View style={s.iconWrap}>
            <Text style={s.iconText}>↑</Text>
          </View>

          <Text style={s.title}>{decision.title}</Text>
          <Text style={s.message}>{decision.message}</Text>

          <Pressable
            onPress={() => openStore(decision.storeUrl)}
            style={({ pressed }) => [s.primaryBtn, pressed && { opacity: 0.85 }]}
          >
            <Text style={s.primaryBtnText}>Update FlipStart</Text>
          </Pressable>

          {isHard ? (
            // Hard block: only a "check again" affordance, no dismiss.
            <Pressable
              onPress={() => void runCheck()}
              disabled={checking}
              style={({ pressed }) => [s.secondaryBtn, pressed && { opacity: 0.6 }]}
            >
              {checking
                ? <ActivityIndicator color={MUTED} size="small" />
                : <Text style={s.secondaryText}>Check again</Text>}
            </Pressable>
          ) : (
            // Soft prompt: allow "Later".
            <Pressable
              onPress={() => setDismissedSoft(true)}
              style={({ pressed }) => [s.secondaryBtn, pressed && { opacity: 0.6 }]}
            >
              <Text style={s.secondaryText}>Later</Text>
            </Pressable>
          )}
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: 'rgba(26,33,22,0.75)',
    alignItems: 'center', justifyContent: 'center', padding: 28,
  },
  card: {
    width: '100%', maxWidth: 380, backgroundColor: PAGE,
    borderRadius: 18, borderWidth: 1, borderColor: BORDER,
    padding: 26, alignItems: 'center',
  },
  iconWrap: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: FOREST,
    alignItems: 'center', justifyContent: 'center', marginBottom: 16,
    borderWidth: 1, borderColor: GOLD,
  },
  iconText: { color: CREAM, fontSize: 28, fontWeight: '800', lineHeight: 30 },
  title: {
    fontSize: 20, fontWeight: '800', color: FOREST,
    textAlign: 'center', marginBottom: 10, fontFamily: Platform.OS === 'ios' ? 'Georgia' : undefined,
  },
  message: { fontSize: 15, color: MUTED, textAlign: 'center', lineHeight: 22, marginBottom: 22 },
  primaryBtn: {
    backgroundColor: FOREST, borderRadius: 12, paddingVertical: 14,
    alignSelf: 'stretch', alignItems: 'center', borderWidth: 1, borderColor: GOLD,
  },
  primaryBtnText: { color: CREAM, fontSize: 16, fontWeight: '700' },
  secondaryBtn: { paddingVertical: 14, alignItems: 'center', alignSelf: 'stretch' },
  secondaryText: { color: MUTED, fontSize: 14, fontWeight: '600' },
});
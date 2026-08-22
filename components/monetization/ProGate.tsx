/**
 * components/monetization/ProGate.tsx
 *
 * THE single abstraction every premium gate routes through.
 *
 * ── Why one component ───────────────────────────────────────────────────────
 * Four features gate today and the real paywall replaces all of them next
 * phase. If each screen owned its own Alert or modal, that swap would mean
 * rewriting four call sites and hoping none were missed. Every gate calls
 * `openProGate(feature)`, so replacing the presentation is a one-file change.
 *
 * ── Deliberately not a paywall ──────────────────────────────────────────────
 * No prices, no Subscribe button, no plan comparison. This states the feature
 * is Pro and dismisses. The conversion surface comes next.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { View, Text, Modal, Pressable, StyleSheet } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

const FOREST = '#214D2D';
const GOLD   = '#C4A334';
const CREAM  = '#F4EED8';
const CARD   = '#FFFEFA';
const MUTED  = '#8A7658';

/** Every gateable capability. Mirrors the server's Feature union. */
export type ProFeature =
  | 'third_photo'
  | 'camera_context'
  | 'generate_listings'
  | 'deep_analysis';

const FEATURE_NAME: Record<ProFeature, string> = {
  third_photo:       'Third Photo',
  camera_context:    'AI Context',
  generate_listings: 'Generate Listings',
  deep_analysis:     'Deep Analysis',
};

/**
 * Optional one-time offer attached to a gate.
 *
 * Used for the Deep Analysis preview: rather than a flat refusal, a Free user
 * who still has their preview is offered it here. Same premium sheet, one extra
 * button — so there is still exactly one gate component to replace with the
 * real paywall.
 */
export interface ProGateOffer {
  label: string;
  onAccept: () => void;
}

interface ProGateContextValue {
  openProGate: (feature: ProFeature, offer?: ProGateOffer) => void;
  /** Internal — used by ProGateHost. */
  _feature: ProFeature | null;
  _offer: ProGateOffer | null;
  _close: () => void;
  /** Internal — how many hosts are mounted; the last one wins. */
  _claimHost: () => number;
  _releaseHost: () => void;
  _topHost: number;
}

const Ctx = createContext<ProGateContextValue>({
  openProGate: () => {}, _feature: null, _offer: null, _close: () => {},
  _claimHost: () => 0, _releaseHost: () => {}, _topHost: 0,
});

/** Call from any screen: `const { openProGate } = useProGate();` */
export function useProGate(): ProGateContextValue {
  return useContext(Ctx);
}

export function ProGateProvider({ children }: { children: React.ReactNode }) {
  const [feature, setFeature] = useState<ProFeature | null>(null);
  const [offer, setOffer] = useState<ProGateOffer | null>(null);
  const [topHost, setTopHost] = useState(0);
  const hostSeq = React.useRef(0);

  const openProGate = useCallback((f: ProFeature, o?: ProGateOffer) => {
    setFeature(f);
    setOffer(o ?? null);
  }, []);
  const _close = useCallback(() => { setFeature(null); setOffer(null); }, []);

  /**
   * Host registry.
   *
   * A React Native <Modal> rendered at the root cannot appear above a screen
   * presented with `presentation: "fullScreenModal"` — the camera lives in its
   * own native modal window, so a root-level gate stayed hidden underneath it
   * and only surfaced once the camera was dismissed.
   *
   * Screens that present modally mount their own <ProGateHost/>. The most
   * recently mounted host renders the modal, so the gate always appears in the
   * window the user is actually looking at. The provider still owns the STATE,
   * so `openProGate` remains one call and the real paywall still replaces one
   * component.
   */
  const _claimHost = useCallback(() => {
    hostSeq.current += 1;
    const id = hostSeq.current;
    setTopHost(id);
    return id;
  }, []);
  const _releaseHost = useCallback(() => {
    // Fall back to the root host (id 0) when a screen-level host unmounts.
    setTopHost(prev => (prev > 0 ? 0 : prev));
  }, []);

  const value = useMemo(
    () => ({ openProGate, _feature: feature, _offer: offer, _close,
             _claimHost, _releaseHost, _topHost: topHost }),
    [openProGate, feature, offer, _close, _claimHost, _releaseHost, topHost],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {/* Root host, id 0. Renders whenever no screen-level host is mounted. */}
      <ProGateHost rootHost />
    </Ctx.Provider>
  );
}

/**
 * Renders the gate modal.
 *
 * Mount this near the root of any screen presented with `presentation: "modal"`
 * or `"fullScreenModal"` — otherwise the gate is rendered beneath that screen's
 * native window and only appears after it is dismissed.
 *
 * Screens that are pushed normally need nothing; the root host covers them.
 */
export function ProGateHost({ rootHost = false }: { rootHost?: boolean }) {
  const { _feature, _offer, _close, _claimHost, _releaseHost, _topHost } = useContext(Ctx);
  const [id, setId] = useState<number | null>(rootHost ? 0 : null);

  useEffect(() => {
    if (rootHost) return;
    const claimed = _claimHost();
    setId(claimed);
    return () => _releaseHost();
    // Claim once per mount: re-claiming on every render would thrash the id.
  }, [rootHost, _claimHost, _releaseHost]);

  // Only the topmost host renders, so the modal never appears twice.
  if (id === null || id !== _topHost) return null;

  return (
    <Modal
      visible={_feature !== null}
      transparent
      animationType="fade"
      onRequestClose={_close}
    >
      <Pressable style={s.backdrop} onPress={_close}>
        <Pressable style={s.card} onPress={e => e.stopPropagation()}>
          <View style={s.header}>
            <MaterialIcons name="workspace-premium" size={22} color={GOLD} />
            <Text style={s.title}>FlipStart Pro</Text>
          </View>

          <Text style={s.body}>
            {_offer
              // With an offer, the copy leads with what they CAN do rather than
              // what they cannot — the refusal reads second.
              ? `${FEATURE_NAME[_feature ?? 'deep_analysis']} is a Pro feature. Here's one free look.`
              : _feature
                ? `${FEATURE_NAME[_feature]} is available with FlipStart Pro.`
                : 'This feature is available with FlipStart Pro.'}
          </Text>

          <View style={s.actions}>
            <Pressable
              onPress={_close}
              style={({ pressed }) => [s.btnGhost, pressed && { opacity: 0.7 }]}
            >
              <Text style={s.btnGhostText}>{_offer ? 'Not Now' : 'Got It'}</Text>
            </Pressable>

            {_offer && (
              <Pressable
                onPress={() => { const fn = _offer.onAccept; _close(); fn(); }}
                style={({ pressed }) => [s.btn, pressed && { opacity: 0.85 }]}
              >
                <Text style={s.btnText}>{_offer.label}</Text>
              </Pressable>
            )}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(20,16,10,0.45)',
              alignItems: 'center', justifyContent: 'center', padding: 28 },
  card: { backgroundColor: CARD, borderRadius: 18, paddingHorizontal: 22,
          paddingTop: 20, paddingBottom: 18, width: '100%', maxWidth: 340, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 18, fontWeight: '800', color: FOREST },
  body: { fontSize: 14, color: MUTED, lineHeight: 20 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end',
             alignItems: 'center', gap: 8, marginTop: 2 },
  btn: { backgroundColor: FOREST, borderRadius: 10,
         paddingVertical: 10, paddingHorizontal: 20 },
  btnGhost: { paddingVertical: 10, paddingHorizontal: 14 },
  btnGhostText: { color: MUTED, fontSize: 14, fontWeight: '700' },
  btnText: { color: CREAM, fontSize: 14, fontWeight: '800' },
});
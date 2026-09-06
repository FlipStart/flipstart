/**
 * components/monetization/paywall/ProPaywallProvider.tsx
 *
 * `openProPaywall(source)` — the single entry point, from anywhere.
 *
 * ── Why a provider and not a route ──────────────────────────────────────────
 * A pushed route would unmount the screen underneath, and every contextual
 * paywall needs to hand the user back to exactly what they were doing —
 * mid-scan, mid-results, with a photo already framed. An overlay keeps that
 * screen mounted, so "close" costs nothing and loses nothing.
 *
 * ── The host registry, inherited from ProGate ───────────────────────────────
 * A React Native <Modal> rendered at the root CANNOT appear above a screen
 * presented with `presentation: "fullScreenModal"` — it renders underneath and
 * only surfaces once that screen is dismissed. app/camera.tsx is exactly such a
 * screen, and ProGate already solved this by letting a screen mount its own
 * host.
 *
 * The same mechanism is here for the same reason: the STATE lives in the
 * provider so `openProPaywall` stays one call, and whichever host was mounted
 * most recently does the rendering, so the paywall appears in the window the
 * user is actually looking at.
 *
 * Any future modal-presented screen that opens a paywall must mount
 * <ProPaywallHost /> near its root. app/dev-monetization.tsx does this today —
 * it is presented modally, so the preview genuinely exercises the mechanism
 * rather than leaving it untested until Phase 5.
 *
 * ── Placement ───────────────────────────────────────────────────────────────
 * This provider must sit INSIDE the tRPC/QueryClient providers, because the
 * modal reads useEntitlement. ProGateProvider sits above them and does not,
 * which is why the two are mounted at different depths in app/_layout.tsx.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "expo-router";
import { resolvePaywallConfig, type PaywallConfig, type ProPaywallSource } from "@/lib/paywallConfig";
import { ProPaywallModal } from "./ProPaywallModal";

export interface OpenPaywallOptions {
  /**
   * Runs after the SERVER has confirmed Pro and the user taps Continue.
   *
   * Never fires on a store success alone, never fires when activation is still
   * pending, and never fires when the user closes with the X. Phase 3+ passes
   * the real continuations here — start Generate Listings, open Deep Analysis,
   * resume the third-photo intent — which is why it is a call-site callback
   * rather than a field in the static config.
   */
  onUnlocked?: () => void;
  /**
   * Runs when the user resolves the paywall WITHOUT Pro: the explicit free
   * option on a source that has one, or Close on a paid-but-unconfirmed
   * activation when the source is not dismissible. Never fires on the X.
   * Only the onboarding offer passes this today.
   */
  onDeclined?: () => void;
  /**
   * Runs when the user PAID but the server has not confirmed yet, and they
   * chose to carry on rather than wait. Distinct from onDeclined on purpose:
   * these two outcomes must never be recorded as the same thing, because one
   * of them has a purchase behind it. Only the onboarding offer passes this.
   */
  onPendingActivation?: () => void;
}

interface PaywallRequest {
  /** Bumped on every open so reopening the same source resets the modal. */
  id: number;
  config: PaywallConfig;
  onUnlocked?: () => void;
  onDeclined?: () => void;
  onPendingActivation?: () => void;
}

interface ProPaywallContextValue {
  openProPaywall: (source: ProPaywallSource, options?: OpenPaywallOptions) => void;
  closeProPaywall: () => void;
  isPaywallOpen: boolean;
  /** Internal — used by ProPaywallHost. */
  _request: PaywallRequest | null;
  /**
   * Hand out the current request's onUnlocked callback, ONCE.
   *
   * Returns null on every call after the first for a given request. This is the
   * structural half of the exactly-once guarantee: the continuation cannot fire
   * twice because after the first call there is nothing left to fire.
   */
  _consumeUnlock: () => (() => void) | null;
  _dismiss: () => void;
  _claimHost: () => number;
  _releaseHost: () => void;
  _topHost: number;
}

const Ctx = createContext<ProPaywallContextValue>({
  openProPaywall: () => {},
  closeProPaywall: () => {},
  isPaywallOpen: false,
  _request: null,
  _consumeUnlock: () => null,
  _dismiss: () => {},
  _claimHost: () => 0,
  _releaseHost: () => {},
  _topHost: 0,
});

/** `const { openProPaywall } = useProPaywall();` */
export function useProPaywall(): ProPaywallContextValue {
  return useContext(Ctx);
}

export function ProPaywallProvider({ children }: { children: React.ReactNode }) {
  const [request, setRequest] = useState<PaywallRequest | null>(null);
  const [topHost, setTopHost] = useState(0);
  const seq = useRef(0);
  const hostSeq = useRef(0);

  const openProPaywall = useCallback(
    (source: ProPaywallSource, options?: OpenPaywallOptions) => {
      seq.current += 1;
      setRequest({
        id: seq.current,
        config: resolvePaywallConfig(source),
        onUnlocked: options?.onUnlocked,
        onDeclined: options?.onDeclined,
        onPendingActivation: options?.onPendingActivation,
      });
    },
    [],
  );

  /**
   * Request ids whose continuation has already been handed out.
   *
   * A ref rather than state: consuming must take effect on the SAME tick as the
   * tap. Routing it through setState would leave a window in which a second tap
   * — a fast double-press on Continue, or a re-render mid-dismissal — reads the
   * old value and gets the callback a second time. One unlock, one generation.
   */
  const consumedRef = useRef<Set<number>>(new Set());
  const requestRef = useRef<PaywallRequest | null>(null);
  requestRef.current = request;

  const _consumeUnlock = useCallback((): (() => void) | null => {
    const req = requestRef.current;
    if (!req) return null;
    if (consumedRef.current.has(req.id)) return null;
    consumedRef.current.add(req.id);
    return req.onUnlocked ?? null;
  }, []);

  const _dismiss = useCallback(() => setRequest(null), []);
  const closeProPaywall = _dismiss;

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
    () => ({
      openProPaywall,
      closeProPaywall,
      isPaywallOpen: request !== null,
      _request: request,
      _consumeUnlock,
      _dismiss,
      _claimHost,
      _releaseHost,
      _topHost: topHost,
    }),
    [openProPaywall, closeProPaywall, request, _consumeUnlock, _dismiss, _claimHost, _releaseHost, topHost],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {/* Root host, id 0. Renders whenever no screen-level host is mounted. */}
      <ProPaywallHost rootHost />
    </Ctx.Provider>
  );
}

/**
 * Renders the paywall modal.
 *
 * Mount near the root of any screen presented with `presentation: "modal"` or
 * `"fullScreenModal"`. Screens pushed normally need nothing — the root host
 * covers them.
 */
export function ProPaywallHost({ rootHost = false }: { rootHost?: boolean }) {
  const { _request, _consumeUnlock, _dismiss, _claimHost, _releaseHost, _topHost } =
    useContext(Ctx);
  const [id, setId] = useState<number | null>(rootHost ? 0 : null);
  const router = useRouter();

  useEffect(() => {
    if (rootHost) return;
    const claimed = _claimHost();
    setId(claimed);
    return () => _releaseHost();
    // Claim once per mount; re-claiming on every render would thrash the id.
  }, [rootHost, _claimHost, _releaseHost]);

  // Only the topmost host renders, so the modal never appears twice.
  if (id === null || id !== _topHost) return null;

  return (
    <ProPaywallModal
      request={_request}
      consumeUnlock={_consumeUnlock}
      onDismiss={() => _dismiss()}
      onScanStore={() => router.push("/scan-store" as any)}
    />
  );
}
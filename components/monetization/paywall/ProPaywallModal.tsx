/**
 * components/monetization/paywall/ProPaywallModal.tsx
 *
 * The shared full-screen paywall. One of these exists; every source renders
 * through it.
 *
 * ── What this file is responsible for ───────────────────────────────────────
 * Layout, and sequencing calls. It owns no purchase logic and no entitlement
 * logic: purchases go through lib/purchases.ts, entitlement comes from
 * useEntitlement, and every state transition is decided by the pure reducers in
 * lib/paywallMachine.ts. If a rule about money is being decided in this file,
 * it is in the wrong place.
 *
 * ── The rule that shapes everything ─────────────────────────────────────────
 * A successful store call is not an entitlement. `purchase()` returning
 * "success" moves this screen to ACTIVATING, not to unlocked. Only the server
 * reporting monthly or annual — re-read through useEntitlement — resolves the
 * paywall. There is no setIsPro anywhere in this component, and no branch where
 * a RevenueCat response alone opens a feature.
 *
 * ── Presentation ────────────────────────────────────────────────────────────
 * `transparent` with no presentationStyle, which RN resolves to overFullScreen:
 * the screen underneath stays mounted, so closing returns the user exactly
 * where they were, with no remount and no lost state. The parchment background
 * is painted by this component rather than by the modal, which is what makes it
 * read as full-screen while still being an overlay.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { FONTS } from "@/constants/typography";
import { ParchmentOverlay } from "@/lib/ParchmentOverlay";
import { useAuth } from "@/lib/auth-context";
import { useEntitlement, useRefreshEntitlement } from "@/lib/useEntitlement";
import { usePaywallProducts } from "@/lib/usePaywallProducts";
import { purchase, restorePurchases, type PurchaseTarget } from "@/lib/purchases";
import { renewalDisclosure } from "@/lib/paywallPricing";
import { paywallAnalytics } from "@/lib/paywallAnalytics";
import {
  INITIAL_STATE,
  afterActivation,
  canPurchase,
  isBusy,
  isTerminal,
  purchaseBlockedReason,
  purchaseSettled,
  purchaseStarted,
  restoreSettled,
  restoreStarted,
  shouldShowAlreadyPro,
  type PaywallState,
  type TerminalPhase,
} from "@/lib/paywallMachine";
import type { PaywallConfig } from "@/lib/paywallConfig";
import { PaywallFooter } from "./PaywallFooter";
import { PaywallHero } from "./PaywallHero";
import { PaywallPurchaseButton } from "./PaywallPurchaseButton";
import { PlanSelector } from "./PlanSelector";
import { OrnamentRule, ParchmentAging } from "./Ornament";
import { PW, PW_RADIUS } from "./paywallTheme";

/**
 * Bounded activation window: 4 reads over roughly 4 seconds.
 *
 * Deliberately finite. The purchase is already safe on RevenueCat's side, so
 * polling forever would only turn a slow server into a stuck screen — and would
 * hammer Railway during exactly the outage that caused the delay. When the
 * window closes we say so honestly and let the webhook finish the job.
 */
const ACTIVATION_ATTEMPTS = 4;
const ACTIVATION_BACKOFF_MS = 650;

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export interface ProPaywallModalProps {
  /** Null when closed. A new object identity means "reopen and reset". */
  request: { id: number; config: PaywallConfig; onUnlocked?: () => void } | null;
  onDismiss: (resolved: boolean) => void;
  /** Called when the user chooses to continue from the Scan Store alternative. */
  onScanStore: () => void;
}

export function ProPaywallModal({ request, onDismiss, onScanStore }: ProPaywallModalProps) {
  const open = request !== null;
  const config = request?.config ?? null;
  const source = config?.source ?? "dev_preview";

  const { user } = useAuth();
  const ent = useEntitlement();
  const invalidateEntitlement = useRefreshEntitlement();
  const products = usePaywallProducts(open);
  const insets = useSafeAreaInsets();

  const [selected, setSelected] = useState<PurchaseTarget>("annual");
  const [state, setState] = useState<PaywallState>(INITIAL_STATE);
  const [reduceMotion, setReduceMotion] = useState(false);

  /**
   * A stable handle on the latest entitlement refresh.
   *
   * `ent` is a fresh object every render, so closing over `ent.refresh` inside
   * an async loop captures whichever render started it. This project has
   * already shipped one stale-closure bug in refreshProfile; a ref is the
   * cheap way not to ship a second one.
   */
  const entRef = useRef(ent);
  entRef.current = ent;

  // ── Reduce Motion — same pattern as PremiumGlimmer / Skeleton ─────────────
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => sub?.remove?.();
  }, []);

  // ── Reset on every open ───────────────────────────────────────────────────
  useEffect(() => {
    if (!request) return;
    setState(INITIAL_STATE);
    setSelected("annual"); // Annual is the default, every time.
    paywallAnalytics.opened(request.config.source);
  }, [request?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * ── Account switch while the paywall is open ─────────────────────────────
   *
   * The purchase service already refuses to sync a mismatched account. This
   * covers the OTHER half: what is on screen. If A reached "unlocked" and B
   * signs in, B must not be looking at A's confirmation — so the whole screen
   * drops back to its initial state.
   *
   * Nothing about A's plan is stored in this component, so resetting is
   * sufficient; there is no cached entitlement here to leak.
   */
  const uidRef = useRef<string | null>(user?.id ?? null);
  useEffect(() => {
    const uid = user?.id ?? null;
    if (uidRef.current === uid) return;
    uidRef.current = uid;
    setState(INITIAL_STATE);
  }, [user?.id]);

  // ── Authoritative confirmation ────────────────────────────────────────────
  /**
   * Ask the SERVER whether this account is Pro, up to ACTIVATION_ATTEMPTS times.
   *
   * Reads the plan off the refetch result rather than waiting for a re-render,
   * so the loop cannot deadlock against React's scheduling. Only "monthly" or
   * "annual" counts — never `isPro` derived on the client, never CustomerInfo.
   */
  const confirmProWithServer = useCallback(async (): Promise<boolean> => {
    for (let i = 0; i < ACTIVATION_ATTEMPTS; i++) {
      try {
        const res: any = await entRef.current.refresh();
        const plan = res?.data?.entitlement?.plan;
        if (plan === "monthly" || plan === "annual") return true;
      } catch {
        // Swallowed on purpose: a failed read is one lost attempt, not a
        // failed purchase. The bound is what stops this being an infinite loop.
      }
      if (i < ACTIVATION_ATTEMPTS - 1) await sleep(ACTIVATION_BACKOFF_MS * (i + 1));
    }
    return false;
  }, []);

  // ── Purchase ──────────────────────────────────────────────────────────────
  const runPurchase = useCallback(async () => {
    if (!config) return;
    const target = selected;

    /**
     * Identity captured BEFORE the store sheet opens, re-checked by the service
     * after it closes. Passing a getter rather than a value is what lets
     * lib/purchases.ts see the CURRENT uid at re-check time.
     */
    const startedUid = user?.id ?? null;

    setState(purchaseStarted(target));
    paywallAnalytics.purchaseStarted(config.source, target);

    const result = await purchase(target, startedUid, () => user?.id ?? null);
    const settled = purchaseSettled({ ...result, target });
    setState(settled);

    if (result.status === "cancelled") {
      paywallAnalytics.purchaseCancelled(config.source, target);
      return;
    }

    if (settled.phase !== "activating") {
      paywallAnalytics.purchaseFailed(config.source, target, result.status);
      return;
    }

    // Paid. Now find out whether the server agrees.
    const confirmed = await confirmProWithServer();
    setState(afterActivation(confirmed, target));

    // Propagate to every other consumer — the home scan pill above all, which
    // is the first place a paying user looks to check the purchase landed.
    await invalidateEntitlement();

    if (confirmed) paywallAnalytics.purchaseCompleted(config.source, target);
  }, [config, selected, user?.id, confirmProWithServer, invalidateEntitlement]);

  // ── Restore ───────────────────────────────────────────────────────────────
  const runRestore = useCallback(async () => {
    if (!config) return;
    const startedUid = user?.id ?? null;

    setState(restoreStarted());
    paywallAnalytics.restoreStarted(config.source);

    const result = await restorePurchases(startedUid, () => user?.id ?? null);
    const settled = restoreSettled(result);
    setState(settled);
    paywallAnalytics.restoreCompleted(config.source, result.status);

    if (settled.phase !== "activating") return;

    // A restored receipt is not an entitlement either.
    const confirmed = await confirmProWithServer();
    setState(afterActivation(confirmed, null));
    await invalidateEntitlement();
  }, [config, user?.id, confirmProWithServer, invalidateEntitlement]);

  // ── Dismissal ─────────────────────────────────────────────────────────────
  const dismiss = useCallback(
    (resolved: boolean) => {
      if (config) paywallAnalytics.dismissed(config.source, resolved);
      onDismiss(resolved);
    },
    [config, onDismiss],
  );

  /**
   * Hardware back and the X behave identically: plain dismissal, no
   * continuation. Even from the unlocked state — someone who taps the close
   * button has said "not now", and silently starting Generate Listings because
   * they happen to have paid would be startling.
   */
  const requestClose = useCallback(() => {
    if (isBusy(state.phase)) return; // Never abandon a live transaction.
    dismiss(false);
  }, [state.phase, dismiss]);

  /** Continue = dismiss AND run the source's continuation. */
  const continueUnlocked = useCallback(() => {
    const fn = request?.onUnlocked;
    dismiss(true);
    fn?.();
  }, [request, dismiss]);

  const goScanStore = useCallback(() => {
    // Dismiss FIRST, then navigate. Pushing while the sheet is mounted leaves
    // it floating over the new screen on iOS — the same fix already applied to
    // the scan-balance modal in app/(tabs)/index.tsx.
    dismiss(false);
    onScanStore();
  }, [dismiss, onScanStore]);

  // ── Derived UI state ──────────────────────────────────────────────────────
  const selectedProduct = selected === "annual" ? products.annual : products.monthly;

  const availability = {
    phase: state.phase,
    productsStatus: products.status,
    selectedProductAvailable: selectedProduct.available,
    entitlementStatus: ent.status,
    isPro: ent.isPro,
  };

  const blocked = purchaseBlockedReason(availability);
  const purchaseEnabled = canPurchase(availability);
  const busy = isBusy(state.phase);
  const alreadyPro = shouldShowAlreadyPro(ent.status, ent.isPro, state.phase);

  const blockedLabel =
    blocked === "entitlement_unresolved"
      ? "Checking your account…"
      : blocked === "products"
        ? "Plans unavailable"
        : null;

  const disclosure = useMemo(
    () => renewalDisclosure(selectedProduct.pricing, selected === "annual" ? "year" : "month"),
    [selectedProduct.pricing, selected],
  );

  const topPad = Math.max(insets.top, 24);
  const bottomPad = Math.max(insets.bottom, 14);

  const onSelectPlan = useCallback(
    (t: PurchaseTarget) => {
      if (busy || !config) return; // Target must not move mid-transaction.
      setSelected(t);
      paywallAnalytics.planSelected(config.source, t);
    },
    [busy, config],
  );

  return (
    <Modal
      visible={open}
      // transparent with no presentationStyle resolves to overFullScreen, which
      // keeps the screen beneath mounted.
      transparent
      animationType={reduceMotion ? "fade" : "slide"}
      statusBarTranslucent
      onRequestClose={requestClose}
    >
      <View style={s.page}>
        {/* Aged paper, in two nearly invisible layers. Grain first, then the
            edge warmth on top of it. */}
        <ParchmentOverlay opacity={0.05} />
        <ParchmentAging />

        {/* Outside the ScrollView: dismissal must never require scrolling. */}
        <Pressable
          onPress={requestClose}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Close"
          accessibilityState={{ disabled: busy }}
          hitSlop={12}
          style={({ pressed }) => [
            s.close,
            { top: topPad + 2 },
            busy && { opacity: 0.35 },
            pressed && !busy && { opacity: 0.6 },
          ]}
        >
          <MaterialIcons name="close" size={20} color={PW.brown} />
        </Pressable>

        <ScrollView
          contentContainerStyle={[
            s.scroll,
            { paddingTop: topPad + 46, paddingBottom: bottomPad + 22 },
          ]}
          showsVerticalScrollIndicator={false}
          // One scroll container only — no nested scrollables anywhere below.
          keyboardShouldPersistTaps="handled"
        >
          <View style={s.column}>
            {isTerminal(state.phase) ? (
              <ResolutionPanel
                phase={state.phase}
                message={state.notice?.text ?? null}
                onContinue={continueUnlocked}
                onClose={() => dismiss(false)}
              />
            ) : alreadyPro ? (
              <AlreadyProPanel onContinue={continueUnlocked} />
            ) : (
              <>
                {config && <PaywallHero config={config} />}

                <View style={s.plansBlock}>
                  <PlanSelector
                    selected={selected}
                    onSelect={onSelectPlan}
                    monthlyPricing={products.monthly.pricing}
                    annualPricing={products.annual.pricing}
                    monthlyAvailable={products.monthly.available}
                    annualAvailable={products.annual.available}
                    locked={busy}
                  />

                  {/* Product failure: stable layout, concise retry, no crash. */}
                  {products.status === "error" && (
                    <View style={s.retryRow}>
                      <Text style={s.retryText}>
                        {products.message ?? "We couldn't load the plans."}
                      </Text>
                      <Pressable
                        onPress={products.reload}
                        accessibilityRole="button"
                        accessibilityLabel="Try loading plans again"
                        hitSlop={10}
                        style={({ pressed }) => pressed && { opacity: 0.6 }}
                      >
                        <Text style={s.retryAction}>Try again</Text>
                      </Pressable>
                    </View>
                  )}

                  {state.notice && <Notice tone={state.notice.tone} text={state.notice.text} />}

                  <PaywallPurchaseButton
                    label={config?.ctaLabel ?? "Unlock FlipStart Pro"}
                    onPress={runPurchase}
                    busy={state.phase === "purchasing" || state.phase === "activating"}
                    disabled={!purchaseEnabled}
                    blockedLabel={blockedLabel}
                  />

                  {state.phase === "activating" && (
                    <Text style={s.activating} accessibilityLiveRegion="polite">
                      Activating Pro…
                    </Text>
                  )}
                </View>

                <PaywallFooter
                  disclosure={disclosure}
                  onRestore={runRestore}
                  restoreBusy={state.phase === "restoring"}
                  restoreDisabled={busy && state.phase !== "restoring"}
                  showScanStore={!!config?.showScanStoreAlternative}
                  onScanStore={goScanStore}
                />
              </>
            )}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ── Sub-views ───────────────────────────────────────────────────────────────

function Notice({ tone, text }: { tone: "info" | "error"; text: string }) {
  const isError = tone === "error";
  return (
    <View
      style={[s.notice, isError ? s.noticeError : s.noticeInfo]}
      accessibilityLiveRegion="polite"
    >
      <MaterialIcons
        name={isError ? "error-outline" : "info-outline"}
        size={14}
        color={isError ? PW.error : PW.gold}
      />
      <Text style={[s.noticeText, isError && { color: PW.error }]}>{text}</Text>
    </View>
  );
}

/**
 * Shown when the paywall opens for somebody who already pays.
 *
 * No plan cards, no CTA, no price. Selling a second copy of a subscription
 * somebody already owns is the clearest possible way to lose their trust, and
 * Apple would refuse the transaction anyway.
 */
function AlreadyProPanel({ onContinue }: { onContinue: () => void }) {
  return (
    <View style={s.panel}>
      <View style={s.panelEmblem}>
        <MaterialIcons name="verified" size={30} color={PW.gold} />
      </View>
      <OrnamentRule width={132} />
      <Text style={s.panelEyebrow}>FLIPSTART PRO</Text>
      <Text style={s.panelTitle}>You’re already a member</Text>
      <Text style={s.panelBody}>
        Your Pro features are active on this account. Nothing more to buy.
      </Text>
      <Pressable
        onPress={onContinue}
        accessibilityRole="button"
        accessibilityLabel="Continue"
        style={({ pressed }) => [s.panelBtn, pressed && { opacity: 0.86 }]}
      >
        <Text style={s.panelBtnText}>Continue</Text>
      </Pressable>
    </View>
  );
}

/**
 * The two terminal outcomes.
 *
 * `unlocked` — the server confirmed the plan. Continue runs the source's
 * continuation.
 *
 * `pending_activation` — they paid and the server has not caught up inside the
 * bounded window. There is deliberately NO Continue here: the continuation
 * would open a feature the server has not authorised, and the gate would refuse
 * it a second later. Close is the only honest option, and the copy says why.
 */
function ResolutionPanel({
  phase,
  message,
  onContinue,
  onClose,
}: {
  // TerminalPhase, not a repeated literal union — if a third terminal phase is
  // ever added, this panel is forced to handle it rather than silently
  // drifting out of sync with the machine.
  phase: TerminalPhase;
  message: string | null;
  onContinue: () => void;
  onClose: () => void;
}) {
  const unlocked = phase === "unlocked";

  return (
    <View style={s.panel}>
      <View style={s.panelEmblem}>
        {unlocked ? (
          <MaterialIcons name="workspace-premium" size={30} color={PW.gold} />
        ) : (
          <ActivityIndicator size="small" color={PW.forest} />
        )}
      </View>
      <OrnamentRule width={132} />
      <Text style={s.panelEyebrow}>FLIPSTART PRO</Text>
      <Text style={s.panelTitle}>{unlocked ? "Pro unlocked" : "Purchase complete"}</Text>
      <Text style={s.panelBody}>
        {unlocked
          ? "Every Pro feature is now open on this account. Happy hunting."
          : (message ??
            "Your Pro access is finishing activation and will appear shortly.")}
      </Text>
      <Pressable
        onPress={unlocked ? onContinue : onClose}
        accessibilityRole="button"
        accessibilityLabel={unlocked ? "Continue" : "Close"}
        style={({ pressed }) => [s.panelBtn, pressed && { opacity: 0.86 }]}
      >
        <Text style={s.panelBtnText}>{unlocked ? "Continue" : "Close"}</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: PW.parchment },

  close: {
    position: "absolute",
    right: 16,
    zIndex: 20,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: PW.card,
    borderWidth: 1,
    borderColor: PW.border,
  },

  scroll: { paddingHorizontal: 20, flexGrow: 1 },
  /** Caps the measure on iPad and Pro Max without affecting phones. */
  column: { width: "100%", maxWidth: 460, alignSelf: "center", gap: 20 },

  plansBlock: { gap: 12 },

  activating: {
    fontSize: 12.5,
    color: PW.brown,
    textAlign: "center",
    fontWeight: "600",
    marginTop: -2,
  },

  notice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  noticeInfo: { backgroundColor: PW.goldTint, borderColor: "rgba(196,163,52,0.45)" },
  noticeError: { backgroundColor: PW.errorTint, borderColor: PW.errorBorder },
  noticeText: { flex: 1, fontSize: 12, lineHeight: 17, color: PW.brown, fontWeight: "600" },

  retryRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: 2,
  },
  retryText: { flex: 1, fontSize: 12, lineHeight: 17, color: PW.brown },
  retryAction: {
    fontFamily: FONTS.serif,
    fontSize: 13,
    fontWeight: "800",
    color: PW.forest,
    textDecorationLine: "underline",
  },

  // ── Panels ────────────────────────────────────────────────────────────────
  panel: { alignItems: "center", gap: 10, paddingTop: 28, paddingHorizontal: 8 },
  panelEmblem: {
    width: 66,
    height: 66,
    borderRadius: 33,
    borderWidth: 1.5,
    borderColor: PW.gold,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  panelEyebrow: {
    fontFamily: FONTS.serif,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 2.6,
    color: PW.forest,
    marginTop: 2,
  },
  panelTitle: {
    fontFamily: FONTS.serif,
    fontSize: 25,
    fontWeight: "800",
    color: PW.ink,
    textAlign: "center",
    lineHeight: 31,
  },
  panelBody: {
    fontSize: 14,
    color: PW.brown,
    textAlign: "center",
    lineHeight: 20,
    maxWidth: 320,
  },
  panelBtn: {
    marginTop: 12,
    backgroundColor: PW.forest,
    borderRadius: PW_RADIUS.pill,
    paddingVertical: 13,
    paddingHorizontal: 46,
    minHeight: 48,
    justifyContent: "center",
  },
  panelBtnText: {
    fontFamily: FONTS.serif,
    fontSize: 15.5,
    fontWeight: "800",
    color: PW.cream,
  },
});
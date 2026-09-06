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
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { offerNeedsCompactHeight } from "@/lib/paywallLayout";
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
import { ProBenefits, type BenefitKey } from "./ProBenefits";

/** Which benefit each contextual paywall should quietly emphasize. */
const BENEFIT_FOR_SOURCE: Partial<Record<string, BenefitKey>> = {
  third_photo: "photos",
  deep_analysis: "deep",
  generate_listings: "listings",
  camera_context: "context",
};
import { ScanStoreAlternative } from "./ScanStoreAlternative";
import { planCtaLabel } from "@/lib/paywallPricing";
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

/**
 * How long "Pro unlocked" stays on screen before the paywall continues by
 * itself.
 *
 * Long enough to register that the payment worked, short enough that it never
 * feels like a step. Someone who just spent money deserves to SEE that it
 * landed — dismissing instantly reads as though the app swallowed the purchase.
 * Beyond about a second it stops being confirmation and becomes a wait.
 */
const AUTO_CONTINUE_MS = 900;

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export interface ProPaywallModalProps {
  /** Null when closed. A new object identity means "reopen and reset". */
  request: { id: number; config: PaywallConfig; onUnlocked?: () => void; onDeclined?: () => void; onPendingActivation?: () => void } | null;
  /**
   * Claims the continuation, once. Returns null if it has already been claimed.
   *
   * The modal never reads `request.onUnlocked` directly — going through the
   * provider is what makes a double-tapped Continue structurally incapable of
   * running the continuation twice.
   */
  consumeUnlock: () => (() => void) | null;
  onDismiss: (resolved: boolean) => void;
  /** Called when the user chooses to continue from the Scan Store alternative. */
  onScanStore: () => void;
}

export function ProPaywallModal({
  request,
  consumeUnlock,
  onDismiss,
  onScanStore,
}: ProPaywallModalProps) {
  const open = request !== null;
  const config = request?.config ?? null;
  const source = config?.source ?? "dev_preview";

  const { user } = useAuth();
  const ent = useEntitlement();
  const invalidateEntitlement = useRefreshEntitlement();
  const products = usePaywallProducts(open);
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();

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
  /**
   * Not dismissible (the onboarding offer): the X is not rendered and hardware
   * back does nothing. The explicit Free button is the way out, so the user is
   * never trapped — they are asked to decide.
   */
  const dismissible = config?.dismissible !== false;
  const requestClose = useCallback(() => {
    if (!dismissible) return;
    if (isBusy(state.phase)) return; // Never abandon a live transaction.
    dismiss(false);
  }, [dismissible, state.phase, dismiss]);

  /**
   * Continue = dismiss AND run the source's continuation, exactly once.
   *
   * The callback is CLAIMED before dismissing, so a second press during the
   * dismissal animation gets null and does nothing. Reading
   * `request.onUnlocked` directly here would leave that window open.
   */
  const continueUnlocked = useCallback(() => {
    const fn = consumeUnlock();
    dismiss(true);
    fn?.();
  }, [consumeUnlock, dismiss]);

  /**
   * The explicit Free path. Resolves the paywall without any store call, any
   * grant, or any balance change — the account simply stays on the Free plan
   * it already has. Never fires while a transaction is live.
   */
  const continueFree = useCallback(() => {
    if (isBusy(state.phase)) return;
    dismiss(false);
    request?.onDeclined?.();
  }, [state.phase, dismiss, request]);

  /**
   * The button on the paid-but-unconfirmed panel.
   *
   * Dismissible sources just close — the contextual paywalls have a screen
   * behind them to return to.
   *
   * The onboarding offer has nothing behind it, so it must resolve. It
   * resolves through onPendingActivation, NEVER onDeclined: this user has
   * already paid, and recording them as having chosen the Free plan would be
   * false. Nothing here grants Pro, cancels the purchase, or touches the
   * server — the existing reconciliation continues and surfaces Pro on its own.
   */
  const closeResolution = useCallback(() => {
    dismiss(false);
    if (dismissible) return;
    if (state.phase === "pending_activation") request?.onPendingActivation?.();
    else request?.onDeclined?.();
  }, [dismiss, dismissible, state.phase, request]);

  /**
   * ── Automatic continuation ──────────────────────────────────────────────
   *
   * The user pressed Generate Listings, not "subscribe". Making them tap
   * Continue and then find the button again is the exact friction this whole
   * phase exists to remove, so a confirmed unlock continues on its own.
   *
   * Only from "unlocked" — never from "pending_activation", where the server
   * has NOT confirmed and continuing would start work the gate would refuse a
   * second later.
   *
   * Only when there is something to continue to. Without a continuation there
   * is nothing to rush toward, and auto-dismissing would make the dev preview
   * flash open and shut for a Pro tester.
   *
   * The Continue button stays live throughout. Racing the timer is harmless:
   * the callback is claimed from the provider, so whichever arrives first is
   * the only one that runs.
   */
  const hasContinuation = !!request?.onUnlocked;
  useEffect(() => {
    if (state.phase !== "unlocked" || !hasContinuation) return;
    const t = setTimeout(() => continueUnlocked(), AUTO_CONTINUE_MS);
    return () => clearTimeout(t);
  }, [state.phase, hasContinuation, continueUnlocked]);

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

  /**
   * Short-screen mode — opt-in per source, decided by height, not by device.
   *
   * On an SE-class phone the approved spacing puts the Free button ~65pt under
   * the fold, which for the onboarding offer means the second of its two
   * choices is invisible until the user scrolls. When the source asks for it
   * AND the normal stack genuinely will not fit, the column tightens: smaller
   * emblem, closer gaps, less card padding. Nothing is removed and no text
   * shrinks; the MORE WITH PRO strip and the legal footer are what move below.
   *
   * The bar is deliberately low — see lib/paywallLayout.ts. Only phones that
   * cannot fit the stack compact; everything from the 12/13 mini upward keeps
   * the approved spacing.
   */
  const compact = !!config?.compactAboveFoldActions
    && offerNeedsCompactHeight(windowHeight, insets.top, insets.bottom);
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

        {/* Outside the ScrollView: dismissal must never require scrolling.
            Absent entirely on a non-dismissible source — see requestClose. */}
        {dismissible && (
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
        )}

        <ScrollView
          contentContainerStyle={[
            s.scroll,
            // The 46pt above the hero exists for the close X. Without an X
            // (the onboarding offer) it is dead space that pushes the free
            // option toward the fold, so it collapses to a margin.
            { paddingTop: topPad + (dismissible ? 46 : compact ? 6 : 14), paddingBottom: bottomPad + 22 },
          ]}
          showsVerticalScrollIndicator={false}
          // One scroll container only — no nested scrollables anywhere below.
          keyboardShouldPersistTaps="handled"
        >
          <View style={[s.column, compact && s.columnCompact]}>
            {isTerminal(state.phase) ? (
              <ResolutionPanel
                phase={state.phase}
                message={state.notice?.text ?? null}
                onContinue={continueUnlocked}
                onClose={closeResolution}
                /* A source that cannot be dismissed has nowhere to close TO, so
                   its paid-but-unconfirmed button carries on into the app. */
                mustResolve={!dismissible}
              />
            ) : alreadyPro ? (
              <AlreadyProPanel onContinue={continueUnlocked} />
            ) : (
              <>
                {config && <PaywallHero config={config} compact={compact} />}

                <View style={[s.plansBlock, compact && s.plansBlockCompact]}>
                  <PlanSelector
                    selected={selected}
                    onSelect={onSelectPlan}
                    monthlyPricing={products.monthly.pricing}
                    annualPricing={products.annual.pricing}
                    monthlyAvailable={products.monthly.available}
                    annualAvailable={products.annual.available}
                    locked={busy}
                    compact={compact}
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
                    /*
                     * "Start Annual Pro — $39.99/year". Names the plan AND the
                     * live price, so what is about to be charged is never
                     * ambiguous. Updates as the selection changes.
                     */
                    label={planCtaLabel(selected, selected === "annual" ? products.annual.pricing : products.monthly.pricing)}
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

                  {/*
                   * What else the subscription includes — one sentence, and
                   * only where the source defines one.
                   *
                   * Placed UNDER the CTA on purpose. A contextual paywall sells
                   * the feature the user reached for; the rest of Pro is a
                   * reason to feel good about the price, not the pitch. Above
                   * the button it would compete with the headline.
                   */}
                  {/* The explicit Free option — the onboarding offer's way out.
                      Directly under the purchase CTA so it is on the first
                      screen, never something to scroll for. Secondary by
                      design: outlined card white, forest text, hairline gold
                      detail — visible and tappable, but not competing with the
                      forest CTA above it. */}
                  {!!config?.freeContinueLabel && (
                    <Pressable
                      onPress={continueFree}
                      disabled={busy}
                      accessibilityRole="button"
                      accessibilityLabel={config.freeContinueLabel}
                      accessibilityState={{ disabled: busy }}
                      style={({ pressed }) => [s.freeBtn, busy && { opacity: 0.45 }, pressed && !busy && { opacity: 0.85 }]}
                    >
                      <View pointerEvents="none" style={s.freeTrim} />
                      <Text style={s.freeText} allowFontScaling={false}>{config.freeContinueLabel}</Text>
                    </Pressable>
                  )}

                  {!!config?.secondaryValueLine && (
                    <Text style={s.secondaryValue}>{config.secondaryValueLine}</Text>
                  )}

                  {/*
                   * The standardized Pro set — identical on every trigger.
                   *
                   * Skipped for settings_upgrade only: its plaque hero already
                   * engraves the same four lines, and showing them twice on one
                   * screen would look like a mistake.
                   */}
                  {config?.source !== "settings_upgrade" && (
                    <ProBenefits emphasize={BENEFIT_FOR_SOURCE[config?.source ?? "dev_preview"] ?? null} />
                  )}

                  {/*
                   * The one paywall where packs solve the problem. Rendered here,
                   * above the footer, so it lands inside the first viewport.
                   */}
                  {!!config?.showScanStoreAlternative && (
                    <ScanStoreAlternative onPress={goScanStore} disabled={busy} />
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
/**
 * Exported for app/dev-purchase-complete.tsx, which renders it directly so the
 * preview cannot drift from what ships. Nothing else outside this file uses it.
 */
export function AlreadyProPanel({ onContinue }: { onContinue: () => void }) {
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
/**
 * The post-purchase surface: "Pro unlocked" when the server has confirmed, and
 * "Purchase complete" when payment succeeded but confirmation is still
 * pending. Exported for app/dev-purchase-complete.tsx — see AlreadyProPanel.
 */
export function ResolutionPanel({
  phase,
  message,
  onContinue,
  onClose,
  mustResolve = false,
}: {
  // TerminalPhase, not a repeated literal union — if a third terminal phase is
  // ever added, this panel is forced to handle it rather than silently
  // drifting out of sync with the machine.
  phase: TerminalPhase;
  message: string | null;
  onContinue: () => void;
  onClose: () => void;
  /** True on a non-dismissible source: the button continues rather than closes. */
  mustResolve?: boolean;
}) {
  const unlocked = phase === "unlocked";
  /**
   * Paid, unconfirmed, and nowhere to close to. The copy states exactly that
   * — it does not claim Pro is active, and it does not pretend the purchase
   * failed.
   */
  const carryOn = !unlocked && mustResolve;

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
          : carryOn
            ? "Your Pro access is still activating. You can enter FlipStart now \u2014 Pro unlocks automatically once it\u2019s confirmed."
            : (message ??
              "Your Pro access is finishing activation and will appear shortly.")}
      </Text>
      <Pressable
        onPress={unlocked ? onContinue : onClose}
        accessibilityRole="button"
        accessibilityLabel={unlocked ? "Continue" : carryOn ? "Continue to FlipStart" : "Close"}
        style={({ pressed }) => [s.panelBtn, pressed && { opacity: 0.86 }]}
      >
        <Text style={s.panelBtnText}>{unlocked ? "Continue" : carryOn ? "Continue to FlipStart" : "Close"}</Text>
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
  /** Outlined, card white, forest text: clearly second to the forest CTA above. */
  freeBtn: {
    backgroundColor: PW.card,
    borderRadius: PW_RADIUS.pill,
    borderWidth: 1.6,
    borderColor: PW.forest,
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    overflow: "hidden",
  },
  freeTrim: {
    position: "absolute", top: 3, left: 3, right: 3, bottom: 3,
    borderRadius: PW_RADIUS.pill - 3, borderWidth: 1, borderColor: "rgba(196,163,52,0.45)",
  },
  freeText: { fontFamily: FONTS.serif, fontSize: 15.5, fontWeight: "800", color: PW.forest },
  /** Caps the measure on iPad and Pro Max without affecting phones. */
  column: { width: "100%", maxWidth: 460, alignSelf: "center", gap: 20 },
  /** Short screens: hero → plans 20 → 12. */
  columnCompact: { gap: 12 },

  plansBlock: { gap: 12 },
  /** Short screens: selector → CTA → Free 12 → 9. Both buttons keep their height. */
  plansBlockCompact: { gap: 9 },

  activating: {
    fontSize: 12.5,
    color: PW.brown,
    textAlign: "center",
    fontWeight: "600",
    marginTop: -2,
  },

  /** Brown, not muted: still has to be readable, just not loud. */
  secondaryValue: {
    fontSize: 11.5,
    lineHeight: 16,
    color: PW.brown,
    textAlign: "center",
    paddingHorizontal: 8,
    marginTop: 2,
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
/**
 * lib/useDeepAnalysisGate.ts
 *
 * ONE hook for opening Deep Analysis, used by every entry point.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * Deep Analysis is reachable from FOUR screens: results, scan-detail,
 * diamonds-in-the-rough and hunt-history. Only results was gated originally —
 * the other three opened it freely for anyone, which made the gate decorative.
 * Four copies of the same check would drift the same way again.
 *
 *   const openDeepAnalysis = useDeepAnalysisGate();
 *   openDeepAnalysis(() => router.push(...), { contextRef: scanIdRef });
 *
 * ── Three tiers, in this order ──────────────────────────────────────────────
 *   Pro                    → open immediately, no paywall flash
 *   Free, preview unused   → the EXISTING preview offer (ProGate)
 *   Free, preview spent    → the Phase 4 contextual paywall
 *
 * The preview stays ahead of the paywall on purpose. Someone who has never seen
 * Deep Analysis converts better after looking at it once than after being asked
 * to buy something they have never seen — and they were already promised that
 * look. This is the one place a temporary ProGate legitimately survives, and it
 * is not a gate in the old sense: it IS the offer.
 *
 * ── What is NOT gated ───────────────────────────────────────────────────────
 * Every Deep Analysis teaser — the coach-mark on results and scan-detail, the
 * pulsing gold arrow, the doorway card — renders with no entitlement condition
 * at all. Free users must keep seeing that Deep Analysis exists; those moments
 * are the conversion surface this phase depends on.
 *
 * ── Not authorization ───────────────────────────────────────────────────────
 * Deep Analysis is derived on-device from data the normal scan already
 * returned (utils/deepAnalysis.ts imports only types and a local util — no
 * fetch, no tRPC, no Supabase). So this hook governs PRESENTATION: opening it
 * costs no model call and consumes no scan. The one server interaction here is
 * the atomic preview consume, which is a counter, not AI.
 */
import { useCallback, useRef } from "react";
import type { RefObject } from "react";
import { trpc } from "@/lib/trpc";
import {
  decideAfterResolve,
  decideDeepAnalysisAction,
  previewConsumeOpens,
} from "@/lib/deepAnalysisDecision";
import { useAuth } from "@/lib/auth-context";
import { useEntitlement, useRefreshEntitlement } from "@/lib/useEntitlement";
import { useProGate } from "@/components/monetization/ProGate";
import { useProPaywall } from "@/components/monetization/paywall/ProPaywallProvider";

export interface DeepAnalysisOptions {
  /**
   * Live identity of the item being analysed — a scan id or flip id.
   *
   * A REF, not a value: read when the paywall opens and again immediately
   * before the continuation runs. A value captured at tap time cannot tell us
   * whether the screen has since moved to a different item.
   */
  contextRef?: RefObject<string | null>;
}

export function useDeepAnalysisGate(): (open: () => void, options?: DeepAnalysisOptions) => void {
  const ent = useEntitlement();
  const { user } = useAuth();
  const { openProGate } = useProGate();
  const { openProPaywall } = useProPaywall();
  const refresh = useRefreshEntitlement();
  const consume = trpc.monetization.useDeepAnalysisPreview.useMutation();

  /**
   * Stable handles for the async paths.
   *
   * The gate awaits an entitlement refetch, a preview consume, and later a
   * continuation fired from inside the paywall. Each resumes on a render newer
   * than the one that started it, so reading `ent` or `user` from the closure
   * would read tap-time values.
   */
  const entRef = useRef(ent);
  entRef.current = ent;
  const uidRef = useRef<string | null>(user?.id ?? null);
  uidRef.current = user?.id ?? null;

  return useCallback(
    (open: () => void, options?: DeepAnalysisOptions) => {
      const contextRef = options?.contextRef;

      /** Identity as it stands the moment the user taps. */
      const openedUid = uidRef.current;
      const openedContext = contextRef?.current ?? null;

      /**
       * Is this continuation still the thing the user asked for?
       *
       * Checked immediately before opening, never at tap time. Either the
       * signed-in account changed (opening A's analysis under B), or the screen
       * moved to a different item (analysing the wrong find).
       *
       * Applied to the PREVIEW path too, not only the purchase path: a preview
       * is a one-time lifetime grant, and spending A's preview to show B
       * something is worse than either mistake alone.
       */
      const stillValid = (): boolean => {
        if ((uidRef.current ?? null) !== openedUid) return false;
        if (contextRef && (contextRef.current ?? null) !== openedContext) return false;
        return true;
      };

      /**
       * EXACTLY ONCE.
       *
       * ProPaywallProvider already refuses to hand the same request's callback
       * out twice, covering a double-tapped Continue. This is the second layer,
       * local to THIS invocation. A duplicate here is a duplicate navigation —
       * two Deep Analysis screens stacked on the router.
       */
      let fired = false;
      const openOnce = () => {
        if (fired) return;
        fired = true;
        if (!stillValid()) return;
        open();
      };

      /**
       * The preview offer, behaviourally unchanged from what already shipped.
       *
       * Deliberately still ProGate: this is an OFFER surface, not a paywall.
       * Rebuilding it inside the new modal would mean inventing an accept
       * action the paywall does not have, and putting the atomic consume at
       * risk for no user-visible gain.
       *
       * Dismissing consumes nothing and opens no paywall — ProGate's own
       * dismissal already returns the user to the screen they were on, which is
       * why there is no onDismiss here.
       */
      const offerPreview = () => {
        openProGate("deep_analysis", {
          label: "View Preview",
          onAccept: async () => {
            try {
              const res: any = await consume.mutateAsync();
              await refresh();
              /**
               * Opens ONLY on an explicit `granted: true`. If the server says
               * the preview was already used — another device, a race —
               * nothing opens, and the next attempt reaches the paywall.
               */
              if (previewConsumeOpens(res)) openOnce();
            } catch {
              // Network failure. Do NOT open: an unverified grant for a
              // paid-tier feature is worse than making them tap again. The
              // preview is not consumed, so nothing is lost.
            }
          },
        });
      };

      const openPaywall = () => {
        openProPaywall("deep_analysis", { onUnlocked: openOnce });
      };

      const current = entRef.current;

      const action = decideDeepAnalysisAction({
        entitlementStatus: current.status,
        canDeepAnalysis: current.status === "ready" && current.can("deep_analysis"),
        previewAvailable: current.status === "ready" && current.deepAnalysisPreviewAvailable,
      });

      /**
       * Pro. Straight through — no paywall, no preview offer.
       *
       * Reads `can()`, not `isPro`: it is the server's per-feature answer and
       * stays correct if the capability matrix changes. Pack balance is not a
       * parameter of it — server/monetization/policy.ts derives features from
       * PLAN alone, so a Free account holding 2,310 pack scans still lands
       * below.
       */
      if (action === "open") { openOnce(); return; }
      if (action === "offer_preview") { offerPreview(); return; }
      if (action === "paywall") { openPaywall(); return; }

      /**
       * ── Unresolved or errored: resolve once, then decide ─────────────────
       *
       * One bounded refetch, read straight off the result rather than waiting
       * for a re-render, so it cannot deadlock against React's scheduling. If
       * it still cannot be resolved, NOTHING happens — no open, no preview
       * spent, no paywall. The next tap tries again; the guess is never cached.
       */
      void (async () => {
        let plan: string | null = null;
        let previewAvailable = false;
        try {
          const res: any = await entRef.current.refresh();
          plan = res?.data?.entitlement?.plan ?? null;
          previewAvailable = Boolean(res?.data?.entitlement?.deepAnalysisPreviewAvailable);
        } catch {
          // Swallowed: a failed read is not a finding in either direction.
        }

        // The account may have changed during the refetch.
        if ((uidRef.current ?? null) !== openedUid) return;

        const resolved = decideAfterResolve(plan, previewAvailable);
        if (resolved === "open") { openOnce(); return; }
        if (resolved === "offer_preview") { offerPreview(); return; }
        if (resolved === "paywall") { openPaywall(); return; }
        // Still unknown. Do nothing rather than guess.
      })();
    },
    [openProGate, openProPaywall, consume, refresh],
  );
}
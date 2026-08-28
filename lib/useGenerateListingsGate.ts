/**
 * lib/useGenerateListingsGate.ts
 *
 * ONE hook for Generate Listings, used by every entry point.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * Generate Listings is reachable from THREE screens: results, scan-detail and
 * analysis-details. Each had its own copy of the entitlement check, and they
 * had already drifted — results checked in the Pressable, the other two checked
 * inside the handler. Three copies of a rule about money will drift again.
 *
 * lib/useDeepAnalysisGate.ts solved the identical problem for Deep Analysis and
 * is the pattern followed here. Every caller now does:
 *
 *   const openGenerateListings = useGenerateListingsGate();
 *   openGenerateListings({ contextRef: scanIdRef, run: runGenerateListings });
 *
 * ── What this hook guarantees ───────────────────────────────────────────────
 * 0. Listings that ALREADY exist are shown to anyone, with no gate at all.
 *    Only the CREATION of new listings is a Pro capability.
 * 1. Pro runs immediately. No paywall flash for a resolved subscriber.
 * 2. Free opens the contextual paywall. Never a generation, never a mutation.
 * 3. Unresolved entitlement resolves ONCE, then decides. Never assumes either
 *    way, and never caches the guess.
 * 4. The continuation fires EXACTLY ONCE per unlock.
 * 5. The continuation belongs to the same USER and the same ITEM that opened
 *    the paywall, or it does not fire at all.
 *
 * ── What it deliberately does NOT do ────────────────────────────────────────
 * It is not authorization. server/routers.ts independently rejects a Free
 * `generateListings` call before any model invocation, and that check is what
 * actually protects the AI spend. This hook decides what the UI does.
 */
import { useCallback, useRef } from "react";
import type { RefObject } from "react";
import {
  decideAfterResolve,
  decideGenerateListingsAction,
} from "@/lib/generateListingsDecision";
import { useAuth } from "@/lib/auth-context";
import { useEntitlement } from "@/lib/useEntitlement";
import { useProPaywall } from "@/components/monetization/paywall/ProPaywallProvider";

export interface GenerateListingsRequest {
  /**
   * Does generated content already exist for this item?
   *
   * A getter, not a boolean, so it is evaluated at tap time rather than at
   * render time — a generation that finished moments ago must count.
   */
  hasExisting?: () => boolean;
  /**
   * Show the existing listings. MUST be a local read: open a modal, set some
   * state. It must never call the generateListings mutation, because this path
   * deliberately runs with no entitlement check at all.
   */
  viewExisting?: () => void;
  /**
   * Live identity of the item the user is acting on — a scan id or flip id.
   *
   * A REF, not a value, on purpose. The hook reads it twice: once when the
   * paywall opens and again immediately before the continuation runs. A plain
   * value captured at tap time cannot tell us whether the screen has since
   * moved to a different item, which is precisely the thing worth checking.
   *
   * Optional: a caller with no meaningful item identity passes nothing and gets
   * the user check only.
   */
  contextRef?: RefObject<string | null>;
  /** The actual work. Runs only when the user is authoritatively Pro. */
  run: () => void | Promise<void>;
}

export function useGenerateListingsGate(): (req: GenerateListingsRequest) => void {
  const ent = useEntitlement();
  const { user } = useAuth();
  const { openProPaywall } = useProPaywall();

  /**
   * Stable handles for the async path.
   *
   * The gate awaits an entitlement refetch and, later, runs a continuation from
   * inside the paywall. Both resume on a render that may be newer than the one
   * that started them, so reading `ent` or `user` from the closure would read
   * whatever they were at tap time. This project has already shipped one
   * stale-closure bug; refs are the cheap way not to ship another.
   */
  const entRef = useRef(ent);
  entRef.current = ent;
  const uidRef = useRef<string | null>(user?.id ?? null);
  uidRef.current = user?.id ?? null;

  return useCallback(
    (req: GenerateListingsRequest) => {
      const { contextRef, hasExisting, viewExisting, run } = req;

      const current = entRef.current;

      /**
       * The decision itself lives in lib/generateListingsDecision.ts so it can
       * be tested without React. This function only carries it out.
       */
      const action = decideGenerateListingsAction({
        hasExisting: !!hasExisting?.(),
        entitlementStatus: current.status,
        canGenerateListings: current.status === "ready" && current.can("generate_listings"),
      });

      /**
       * ── Existing content is never gated ────────────────────────────────
       *
       * Decided FIRST, ahead of every entitlement read, because the rule is
       * about what the action COSTS rather than who the user is: showing text
       * already stored on the device makes no model call, spends no scan and
       * touches no server. Charging for a second look at something already
       * paid for would be indefensible, and the button says "View Listings"
       * here — a paywall would answer a question the user did not ask.
       *
       * Ahead of the unresolved branch too, so viewing keeps working when
       * entitlement cannot be resolved at all: offline, mid-refresh, or after a
       * failed fetch. There is nothing to fail closed about.
       */
      if (action === "view_existing") {
        viewExisting?.();
        return;
      }

      /** Identity as it stands the moment the user taps. */
      const openedUid = uidRef.current;
      const openedContext = contextRef?.current ?? null;

      /**
       * Is the continuation still the thing the user actually asked for?
       *
       * Checked immediately before running, never at open time. Two ways it can
       * come back false:
       *
       *   • the signed-in account changed — running A's generation under B
       *     would bill B's entitlement for A's item
       *   • the screen moved to a different item — the paywall covers the
       *     screen so this is unlikely, but "unlikely" is not "impossible" and
       *     a listing generated for the wrong find is worse than none
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
       * out twice, which covers a double-tapped Continue. This is the second
       * layer, and it is local to THIS invocation: it also covers a caller that
       * somehow wires the same continuation into two paywall opens.
       *
       * Belt and braces is warranted — a duplicate here is a duplicate AI
       * charge and a duplicate listing.
       */
      let fired = false;
      const runOnce = () => {
        if (fired) return;
        fired = true;
        if (!stillValid()) return;
        void run();
      };

      const openPaywall = () => {
        openProPaywall("generate_listings", { onUnlocked: runOnce });
      };

      /**
       * Pro. Straight through, no paywall.
       *
       * The decision read `can()`, not `isPro`. They agree today, but `can()`
       * is the server's per-feature answer and stays correct if the capability
       * matrix ever changes. Pack balance is not a parameter of it —
       * server/monetization/policy.ts computes features from PLAN alone, so a
       * Free account holding 2,310 pack scans still lands on the paywall.
       */
      if (action === "run") {
        void run();
        return;
      }

      if (action === "paywall") {
        openPaywall();
        return;
      }

      /**
       * ── Unresolved or errored: resolve once, then decide ────────────────
       *
       * Never assume Free (that would show a paying subscriber a paywall) and
       * never assume Pro (that would let a Free user fire a mutation). One
       * bounded refetch, read straight off the result rather than waiting for a
       * re-render, so this cannot deadlock against React's scheduling.
       *
       * If it still cannot be resolved, NOTHING happens: no generation and no
       * paywall. Failing closed on an unknown is the only safe direction, and
       * the next tap tries again — the guess is never cached.
       */
      void (async () => {
        let plan: string | null = null;
        try {
          const res: any = await entRef.current.refresh();
          plan = res?.data?.entitlement?.plan ?? null;
        } catch {
          // Swallowed. A failed read is not a finding in either direction.
        }

        // The user may have changed accounts during the refetch.
        if ((uidRef.current ?? null) !== openedUid) return;

        const resolved = decideAfterResolve(plan);
        if (resolved === "run") {
          if (stillValid()) void run();
          return;
        }
        if (resolved === "paywall") {
          openPaywall();
          return;
        }
        // Still unknown. Do nothing rather than guess.
      })();
    },
    [openProPaywall],
  );
}
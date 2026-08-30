/**
 * lib/useScanGate.ts
 *
 * ONE gate for starting a scan, used by every scan-start entry point.
 *
 * ── Why the gate moved forward ──────────────────────────────────────────────
 * Before this, an exhausted user went: tap Scan → camera → frame the item →
 * take two photos → Done → loading → server refuses → fail screen. All of that
 * effort spent to learn something we knew before the camera opened.
 *
 * The preflight moves the answer to the tap. The server check stays exactly
 * where it was — this changes when the user finds out, not who decides.
 *
 * ── Origin matters ──────────────────────────────────────────────────────────
 * Hunt Mode logs its own analytics and returns to the hunt; Home does not.
 * Resuming a Hunt scan as a Home scan would drop the user out of their session,
 * so the caller passes the exact continuation it wants resumed rather than the
 * hook reconstructing one.
 */
import { useCallback, useRef } from "react";
import { useAuth } from "@/lib/auth-context";
import { useEntitlement } from "@/lib/useEntitlement";
import { useProPaywall } from "@/components/monetization/paywall/ProPaywallProvider";
import {
  canResumeScanAfterUnlock,
  decideAfterRefresh,
  decideScanAvailability,
  type ScanAvailabilityDecision,
} from "@/lib/scanAvailability";
import { setScanStoreIntent } from "@/lib/scanStoreIntent";

/**
 * Where the attempt came from.
 *
 * Carried for analytics and, later, for post-Scan-Store resumption. It does NOT
 * decide behaviour — `run` does — so a new origin cannot silently change what
 * gets resumed.
 */
export type ScanOrigin = "home" | "hunt" | "tab" | "retry";

export interface ScanAttempt {
  origin: ScanOrigin;
  /** Exactly what to do when a scan is permitted. Runs at most once. */
  run: () => void;
  /** Navigate to the Scan Store. Provided by the caller so this hook owns no routing. */
  goToScanStore: () => void;
}

/**
 * How many times to re-read entitlement while waiting for a fresh allowance to
 * appear after activation.
 *
 * Bounded on purpose. RevenueCat has already taken the money and the webhook
 * will land; polling forever would only turn a slow sync into a stuck screen
 * and hammer Railway during the outage that caused it.
 */
const ALLOWANCE_ATTEMPTS = 3;
const ALLOWANCE_BACKOFF_MS = 700;
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export function useScanGate(): (attempt: ScanAttempt) => void {
  const ent = useEntitlement();
  const { user } = useAuth();
  const { openProPaywall } = useProPaywall();

  /**
   * Stable handles for the async paths.
   *
   * The gate awaits a refetch and, later, resumes from inside the paywall. Both
   * continue on a render newer than the one that started them, so reading `ent`
   * or `user` from the closure would read tap-time values.
   */
  const entRef = useRef(ent);
  entRef.current = ent;
  const uidRef = useRef<string | null>(user?.id ?? null);
  uidRef.current = user?.id ?? null;

  return useCallback(
    (attempt: ScanAttempt) => {
      const { run, goToScanStore } = attempt;
      const openedUid = uidRef.current ?? null;

      /**
       * EXACTLY ONCE.
       *
       * The provider already refuses to hand the same request's callback out
       * twice. This is the second layer, local to this invocation — a duplicate
       * here is two cameras or two Hunt scans launched from one purchase.
       */
      let fired = false;
      const runOnce = () => {
        if (fired) return;
        fired = true;
        // Identity re-checked at RESUME time: a purchase takes seconds, and
        // account B must never inherit account A's scan intent.
        if ((uidRef.current ?? null) !== openedUid) return;
        run();
      };

      /**
       * Resume only once a spendable scan actually exists.
       *
       * Authoritative Pro is not enough here — see canResumeScanAfterUnlock.
       * Opening the camera against a stale zero would let the user photograph
       * an item and then fail at reservation.
       */
      const resumeWhenScannable = async () => {
        for (let i = 0; i < ALLOWANCE_ATTEMPTS; i++) {
          try {
            const res: any = await entRef.current.refresh();
            const e = res?.data?.entitlement;
            if (canResumeScanAfterUnlock(e?.plan, e?.totalUsableScans)) {
              runOnce();
              return;
            }
          } catch {
            // A failed read is one lost attempt, not a failed purchase.
          }
          if (i < ALLOWANCE_ATTEMPTS - 1) await sleep(ALLOWANCE_BACKOFF_MS * (i + 1));
        }
        /**
         * Pro is real but the allowance has not landed yet. Do NOT open the
         * camera. The paywall has already closed and the subscription is
         * active; the next tap will work. Nothing is lost but one tap, and
         * nothing is falsely promised.
         */
      };

      /**
       * Hand the ORIGINAL continuation to the Scan Store.
       *
       * `runOnce`, not `run` — the store and the subscription path share one
       * guard, so buying a pack and subscribing in the same session cannot both
       * launch a scan.
       *
       * Passed through a module slot rather than route params: the
       * continuation is a function, and navigation params are serialized.
       */
      const armStoreIntent = () => {
        setScanStoreIntent({ origin: attempt.origin, uid: openedUid, resume: runOnce });
      };

      const act = (decision: ScanAvailabilityDecision) => {
        if (decision === "allow_scan") { runOnce(); return; }

        if (decision === "pro_scan_store") {
          /**
           * Already a subscriber with an empty bucket. They need quantity, not
           * another subscription — so this never opens the Pro paywall.
           *
           * The intent is armed first: the user got here by trying to scan, so
           * a successful pack purchase should resume that scan rather than
           * leaving them to tap again.
           */
          armStoreIntent();
          goToScanStore();
          return;
        }

        if (decision === "free_scan_limit_paywall") {
          /**
           * Armed BEFORE the paywall opens, because the Scan Store is one tap
           * away inside it. If the user takes the pack route instead of the
           * subscription, the store already knows what to resume.
           */
          armStoreIntent();
          openProPaywall("scan_limit", { onUnlocked: () => { void resumeWhenScannable(); } });
        }
        // "unresolved" is handled by the caller below, never here.
      };

      const current = entRef.current;
      const decision = decideScanAvailability({
        entitlementStatus: current.status,
        plan: current.plan as any,
        totalUsableScans: current.totalUsableScans,
      });

      if (decision !== "unresolved") { act(decision); return; }

      /**
       * ── Unknown: resolve once, then decide ───────────────────────────────
       *
       * Never assume scans remain and never assume they are gone. If it still
       * cannot be resolved, NOTHING happens — no camera, no paywall, no Scan
       * Store. The next tap tries again; the guess is never cached.
       */
      void (async () => {
        try {
          const res: any = await entRef.current.refresh();
          const e = res?.data?.entitlement;
          if ((uidRef.current ?? null) !== openedUid) return;
          const resolved = decideAfterRefresh(e?.plan, e?.totalUsableScans);
          if (resolved) act(resolved);
        } catch {
          // Fail closed: do nothing rather than guess.
        }
      })();
    },
    [openProPaywall],
  );
}
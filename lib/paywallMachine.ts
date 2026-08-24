/**
 * lib/paywallMachine.ts
 *
 * The paywall's lifecycle, as pure functions.
 *
 * ── Why the state machine is not inside the component ───────────────────────
 * The rules that matter here are commercial, not visual: a cancellation must
 * never look like a failure, a delayed sync must never look like a failure, a
 * successful payment must never grant Pro on its own, and an account switch
 * must never carry the other account's plan across. Those are exactly the rules
 * that are hardest to verify through a rendered tree and easiest to verify as
 * input/output.
 *
 * Extracting them means every one of those guarantees is asserted by a test
 * that runs in plain Node, with no native modules, no renderer and no store.
 * The modal becomes a component that draws whatever this returns.
 *
 * ── Type-only imports, deliberately ─────────────────────────────────────────
 * `import type` is erased at compile time, so this module pulls in nothing at
 * runtime — not lib/purchases, not the SDK, not `__DEV__`. That is what keeps
 * it importable from a bare test runner.
 */
import type { PurchaseStatus, RestoreStatus, PurchaseTarget } from "@/lib/purchases";

export type PaywallPhase =
  /** Plans visible, purchase available. */
  | "idle"
  /** Store sheet is open, or the purchase call is in flight. */
  | "purchasing"
  /** Paid. Waiting for the SERVER to agree. */
  | "activating"
  /** Restore in flight. */
  | "restoring"
  /** Server confirmed monthly or annual. The only phase that may continue. */
  | "unlocked"
  /**
   * Paid, but the server has not confirmed within the bounded window.
   *
   * Its own terminal phase, deliberately NOT folded into "unlocked" or "idle".
   * Calling it unlocked would grant access the server has not authorised;
   * calling it idle would invite a second purchase of a subscription they
   * already own.
   */
  | "pending_activation";

export type NoticeTone = "info" | "error";

export interface PaywallNotice {
  tone: NoticeTone;
  text: string;
}

export interface PaywallState {
  phase: PaywallPhase;
  notice: PaywallNotice | null;
  /** Which plan the in-flight or completed operation applies to. */
  target: PurchaseTarget | null;
}

export const INITIAL_STATE: PaywallState = { phase: "idle", notice: null, target: null };

/** Any phase where the UI must not start a second operation. */
export function isBusy(phase: PaywallPhase): boolean {
  return phase === "purchasing" || phase === "activating" || phase === "restoring";
}

/**
 * The two phases where the purchase decision is over.
 *
 * Named so the modal's resolution panel can accept exactly these and stay in
 * sync automatically if the union ever grows.
 */
export type TerminalPhase = Extract<PaywallPhase, "unlocked" | "pending_activation">;

/**
 * Terminal phases: the purchase decision is over, one way or another.
 *
 * A TYPE PREDICATE, not a boolean. Returning `boolean` compiled fine here and
 * then failed at the call site — `<ResolutionPanel phase={state.phase} />`
 * cannot narrow `PaywallPhase` down to the two phases that panel accepts unless
 * the guard tells the compiler what it proved. Casting at the call site would
 * have hidden that instead of fixing it, and the cast would still be there the
 * day a third terminal phase is added.
 */
export function isTerminal(phase: PaywallPhase): phase is TerminalPhase {
  return phase === "unlocked" || phase === "pending_activation";
}

// ── Purchase ────────────────────────────────────────────────────────────────

export function purchaseStarted(target: PurchaseTarget): PaywallState {
  // Clears any previous notice: a stale error sitting above a fresh attempt
  // reads as though the new attempt already failed.
  return { phase: "purchasing", notice: null, target };
}

/** The subset of PurchaseResult this machine reads. */
export interface PurchaseOutcome {
  status: PurchaseStatus;
  message?: string;
  target?: PurchaseTarget;
}

/**
 * What to do when the store call returns — BEFORE the server is consulted.
 *
 * `success` and `sync_pending` both move to "activating" rather than to
 * "unlocked". That is the whole point: the store telling us it took the money
 * is not the server telling us the account is entitled, and the two are
 * genuinely different events. See afterActivation.
 */
export function purchaseSettled(r: PurchaseOutcome): PaywallState {
  const target = r.target ?? null;

  switch (r.status) {
    // Paid. The server has not been asked yet, or was asked and did not answer.
    case "success":
    case "sync_pending":
      return { phase: "activating", notice: null, target };

    /**
     * Dismissing the Apple sheet is a decision, not a fault.
     *
     * Returns to exactly the state the paywall was in, with NO notice at all.
     * An "ERROR: PURCHASE_CANCELLED" banner — or any banner — punishes someone
     * for changing their mind and makes the app look broken.
     */
    case "cancelled":
      return { phase: "idle", notice: null, target: null };

    /**
     * Ask to Buy / deferred. Nothing is owed and nothing is granted, so this is
     * information, not an error.
     */
    case "pending":
      return {
        phase: "idle",
        notice: { tone: "info", text: r.message ?? "Your purchase is pending approval." },
        target: null,
      };

    /**
     * The signed-in account changed while the sheet was open.
     *
     * Informational, not an error — the purchase service already refused to
     * sync it, which is the protection working. Critically, the machine carries
     * NO plan and NO target out of this branch, so nothing about account A can
     * be rendered while account B is signed in.
     */
    case "account_changed":
      return {
        phase: "idle",
        notice: {
          tone: "info",
          text:
            r.message ??
            "That purchase belongs to a different account. Sign in to it to see the subscription.",
        },
        target: null,
      };

    /** Expo Go, or a build with no native purchase module. */
    case "unavailable":
      return {
        phase: "idle",
        notice: { tone: "info", text: r.message ?? "Purchases need a development build." },
        target: null,
      };

    case "error":
    default:
      return {
        phase: "idle",
        notice: {
          tone: "error",
          text: r.message ?? "Something went wrong with the purchase. Please try again.",
        },
        target: null,
      };
  }
}

/**
 * What to do once the authoritative entitlement check finishes.
 *
 * `confirmed` means the SERVER reported monthly or annual. Nothing else counts
 * — not a RevenueCat CustomerInfo, not a successful store call, not an
 * optimistic guess.
 */
export function afterActivation(confirmed: boolean, target: PurchaseTarget | null): PaywallState {
  if (confirmed) return { phase: "unlocked", notice: null, target };

  /**
   * They paid and the server has not caught up.
   *
   * Tone is "info" and the wording never suggests failure, because no failure
   * occurred: RevenueCat holds the purchase, and the webhook or the next
   * authenticated reconciliation will apply it. Showing an error here would
   * send a paying customer to support over a few seconds of lag.
   */
  return {
    phase: "pending_activation",
    notice: {
      tone: "info",
      text: "Purchase complete. Your Pro access is finishing activation and will appear shortly.",
    },
    target,
  };
}

// ── Restore ─────────────────────────────────────────────────────────────────

export function restoreStarted(): PaywallState {
  return { phase: "restoring", notice: null, target: null };
}

export interface RestoreOutcome {
  status: RestoreStatus;
  message?: string;
}

/**
 * Restore follows the same rule as purchase: a restored receipt is not an
 * entitlement until the server says so, so `restored` moves to "activating".
 */
export function restoreSettled(r: RestoreOutcome): PaywallState {
  switch (r.status) {
    case "restored":
    case "sync_pending":
      return { phase: "activating", notice: null, target: null };

    /**
     * Nothing found is a clean, ordinary answer.
     *
     * Phrased around the Apple Account rather than around FlipStart, because
     * the usual cause is being signed into a different one — and that is
     * actionable, where "restore failed" is not.
     */
    case "nothing_to_restore":
      return {
        phase: "idle",
        notice: {
          tone: "info",
          text: "No previous subscription was found on this Apple Account.",
        },
        target: null,
      };

    /**
     * The receipt belongs to another FlipStart account that still has an active
     * subscription. This is the RevenueCat transfer policy doing its job, so it
     * must not read as a fault — and the copy must not say "try Restore", which
     * is what just happened.
     */
    case "owned_by_another_account":
      return {
        phase: "idle",
        notice: {
          tone: "info",
          text:
            r.message ??
            "This subscription is active on another FlipStart account. Sign in to that account to use it.",
        },
        target: null,
      };

    case "account_changed":
      return {
        phase: "idle",
        notice: {
          tone: "info",
          text: r.message ?? "The account changed. Sign in to the original account to restore it.",
        },
        target: null,
      };

    case "unavailable":
      return {
        phase: "idle",
        notice: { tone: "info", text: r.message ?? "Restore needs a development build." },
        target: null,
      };

    case "error":
    default:
      return {
        phase: "idle",
        // Sanitized upstream by lib/purchaseErrors.ts. Never a raw SDK string.
        notice: {
          tone: "error",
          text: r.message ?? "We couldn't restore your purchases. Please try again.",
        },
        target: null,
      };
  }
}

// ── Whether the CTA may fire ────────────────────────────────────────────────

export type ProductsStatus = "loading" | "ready" | "error" | "unavailable";
export type EntitlementStatus = "unresolved" | "ready" | "error";

export interface PurchaseAvailability {
  phase: PaywallPhase;
  productsStatus: ProductsStatus;
  /** The specific selected plan resolved to a real store package. */
  selectedProductAvailable: boolean;
  entitlementStatus: EntitlementStatus;
  isPro: boolean;
}

/**
 * One predicate, used for both the disabled state and the tap handler.
 *
 * Deriving the button's appearance and its behaviour from the same function is
 * what stops a button that looks enabled from doing nothing, or worse, a button
 * that looks disabled from still firing on a fast double tap.
 */
export function canPurchase(a: PurchaseAvailability): boolean {
  return purchaseBlockedReason(a) === null;
}

/**
 * Why the CTA is unavailable, or null when it is available.
 *
 * Ordered by precedence, most specific first. The string is a short internal
 * reason, not user copy — the component maps it to a label.
 */
export function purchaseBlockedReason(
  a: PurchaseAvailability,
): "busy" | "terminal" | "already_pro" | "entitlement_unresolved" | "products" | null {
  if (isBusy(a.phase)) return "busy";
  if (isTerminal(a.phase)) return "terminal";

  /**
   * Already Pro — never sell the same subscription twice.
   *
   * Checked only when entitlement is READY. An `isPro` of false while
   * unresolved is a type placeholder, not a finding, so it must not be read as
   * "this user is Free".
   */
  if (a.entitlementStatus === "ready" && a.isPro) return "already_pro";

  /**
   * Unresolved identity blocks purchase.
   *
   * Not because the store would refuse, but because we cannot yet tell whether
   * this person already pays us. A second or two of a disabled button is a far
   * better outcome than charging an existing subscriber again.
   *
   * An entitlement ERROR does NOT block. A failed read tells us nothing, and
   * refusing to sell on a transient network failure loses a sale for no safety
   * gain — Apple independently refuses a duplicate subscription, and that path
   * has its own clear copy.
   */
  if (a.entitlementStatus === "unresolved") return "entitlement_unresolved";

  if (a.productsStatus !== "ready" || !a.selectedProductAvailable) return "products";

  return null;
}

/**
 * Whether the already-Pro panel should replace the purchase UI.
 *
 * READY-only, for the same reason as above: showing "You're already Pro" to
 * someone whose entitlement has not loaded is the Pro flash the neutral-loading
 * rule exists to prevent.
 */
export function shouldShowAlreadyPro(
  entitlementStatus: EntitlementStatus,
  isPro: boolean,
  phase: PaywallPhase,
): boolean {
  if (isTerminal(phase) || isBusy(phase)) return false;
  return entitlementStatus === "ready" && isPro;
}
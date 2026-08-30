/**
 * lib/scanStoreIntent.ts
 *
 * Why the user is in the Scan Store: browsing, or resuming a blocked scan.
 *
 * ── Why this is a module and not a route param ──────────────────────────────
 * The continuation is a FUNCTION — "push the camera and log a hunt scan" — and
 * functions cannot be serialized into navigation params. Encoding an origin
 * string and rebuilding the callback on the other side would mean the store
 * knowing how every caller starts a scan, which is exactly the coupling the
 * shared gate exists to avoid.
 *
 * A tiny module-scoped slot holds it instead. No provider, no persistence, no
 * new dependency — the intent lives for one navigation and is thrown away.
 *
 * ── Ephemeral on purpose ────────────────────────────────────────────────────
 * An intent that outlives its moment is dangerous: an "old exhausted scan"
 * launching the camera days later, on a different account, is the failure mode
 * worth designing against. So it is cleared on consumption, on abandonment, on
 * account change, and whenever a new intent replaces it. Nothing here is
 * written to disk, so a cold start begins with none.
 */

/** No imports, by design — testable in a bare runner. */

export type ScanOrigin = "home" | "hunt" | "tab" | "retry";

export interface ScanStoreIntent {
  origin: ScanOrigin;
  /** Who created it. A different signed-in user may never consume it. */
  uid: string | null;
  /** What to do once scans are genuinely available. Runs at most once. */
  resume: () => void;
}

/**
 * The single slot.
 *
 * Module scope rather than React state: it is read during a navigation, by a
 * screen that has not mounted yet, and it must not cause a render anywhere.
 */
let pending: ScanStoreIntent | null = null;

/**
 * Arm a resume intent. Replaces any previous one.
 *
 * Replacement is deliberate: a newer scan attempt is what the user actually
 * wants resumed, and keeping a queue would mean an old intent eventually firing
 * for a scan they have long forgotten.
 */
export function setScanStoreIntent(intent: ScanStoreIntent): void {
  pending = intent;
}

/** Read without consuming — for deciding which mode the store renders in. */
export function peekScanStoreIntent(): ScanStoreIntent | null {
  return pending;
}

export type StoreEntryMode = "browse" | "resume_scan";

export function scanStoreEntryMode(): StoreEntryMode {
  return pending ? "resume_scan" : "browse";
}

/**
 * Take the intent, once.
 *
 * Clears the slot BEFORE returning, so two callers racing on the same grant
 * cannot both receive it. That is the structural half of exactly-once: after
 * the first take there is nothing left to take.
 *
 * Returns null when the signed-in user is not the one who armed it — account A
 * must never resume under account B, and the intent is discarded rather than
 * left for them.
 */
export function consumeScanStoreIntent(currentUid: string | null): ScanStoreIntent | null {
  const intent = pending;
  pending = null;
  if (!intent) return null;
  if ((intent.uid ?? null) !== (currentUid ?? null)) return null;
  return intent;
}

/**
 * Drop the intent without running it.
 *
 * Called when the user backs out of the store, on sign-out, and on any account
 * change. Backing out is a decision — the scan they abandoned must not launch
 * later because they happened to buy a pack next week.
 */
export function clearScanStoreIntent(): void {
  pending = null;
}

/** Test seam. Mirrors __resetPurchaseGuard in lib/purchases.ts. */
export function __resetScanStoreIntent(): void {
  pending = null;
}
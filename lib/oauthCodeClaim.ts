/**
 * lib/oauthCodeClaim.ts
 *
 * Guarantees that exactly ONE code path exchanges any given OAuth
 * authorization code.
 *
 * ── Why `getSession()` was not enough ───────────────────────────────────────
 * The first fix had callback.tsx call getSession() and stand down if a session
 * existed. That is check-then-act: if callback.tsx mounts while auth.tsx is
 * still awaiting its own exchange, no session exists yet, and BOTH proceed.
 * Unlikely under current iOS mechanics — ASWebAuthenticationSession returns the
 * redirect to the promise rather than delivering it as a deep link — but
 * "unlikely" is not an invariant, and Android Custom Tabs behave differently.
 *
 * ── Why a synchronous claim IS enough ───────────────────────────────────────
 * JavaScript is single-threaded. A claim taken synchronously, before any
 * `await`, cannot be interleaved: whichever caller reaches `claimAuthCode`
 * first wins outright, and the loser sees `false` immediately. No timing
 * assumption, no OS behaviour dependency.
 *
 * ── Cold start is handled by the same mechanism ─────────────────────────────
 * If the app was killed mid-OAuth, module state is empty on relaunch, so
 * auth.tsx holds no claim. callback.tsx then claims successfully and owns the
 * exchange — which is exactly right, because auth.tsx's promise no longer
 * exists. The claim is deliberately in-memory for this reason: it should NOT
 * survive a restart.
 */

/** Codes already claimed this process lifetime. */
const claimed = new Set<string>();

/**
 * Take exclusive ownership of a code. Synchronous and atomic by virtue of the
 * single-threaded event loop.
 *
 * @returns true if the caller now owns the exchange, false if someone else does.
 */
export function claimAuthCode(code: string): boolean {
  if (!code) return false;
  if (claimed.has(code)) return false;
  claimed.add(code);
  // Bounded: an OAuth code is single-use and short-lived, so retaining a few is
  // enough to reject a duplicate delivery without growing without limit.
  if (claimed.size > 20) {
    const oldest = claimed.values().next().value;
    if (oldest) claimed.delete(oldest);
  }
  return true;
}

/** Whether a code has been claimed. Diagnostics only — never gate on this, as
 *  reading and then acting reintroduces the race this module removes. */
export function isAuthCodeClaimed(code: string): boolean {
  return claimed.has(code);
}

/** Test seam. */
export function __resetAuthCodeClaims(): void {
  claimed.clear();
}
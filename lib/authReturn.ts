/**
 * lib/authReturn.ts
 * Where to send the user after a successful sign-in/sign-up.
 *
 * Passing this through navigation params on the shared /auth screen proved
 * fragile (stale/reused params sent users to the wrong tab). Instead, whoever
 * opens auth declares the return destination here, and the auth success handler
 * consumes it exactly once.
 *
 *   Feature gate (Hunt):     setAuthReturnDest('/hunt')
 *   Feature gate (Progress): setAuthReturnDest('/(tabs)/progress')
 *   Settings / onboarding:   clearAuthReturnDest()  (default → tab root)
 *
 * auth.tsx on success: const dest = takeAuthReturnDest() ?? '/(tabs)';
 */

let pendingDest: string | null = null;

export function setAuthReturnDest(dest: string): void {
  pendingDest = dest;
}

export function clearAuthReturnDest(): void {
  pendingDest = null;
}

/** Returns the pending destination and clears it (consume-once). */
export function takeAuthReturnDest(): string | null {
  const d = pendingDest;
  pendingDest = null;
  return d;
}
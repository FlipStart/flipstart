/**
 * lib/syncDiag.ts
 *
 * Quiet, dev-only breadcrumb for cloud-sync write errors. Supabase writes are
 * fail-safe (errors are swallowed so the app keeps working locally); this just
 * leaves a console note in development so a real setup problem isn't completely
 * invisible. It NEVER shows a user-facing alert and logs NOTHING in production.
 *
 * (Earlier this surfaced a one-time dev Alert with the Postgres code/hint while
 * we were diagnosing the 42501 GRANT issue. That's resolved, so the alert is
 * removed — only a silent __DEV__ console.warn remains.)
 *
 * Reference Postgres codes, for when a dev log does appear:
 *   42501  → RLS / missing table GRANT
 *   42P10  → no unique constraint matching ON CONFLICT
 *   42703  → undefined column (payload/schema mismatch)
 *   42P01  → undefined table (SQL not run)
 *
 * Purely diagnostic — never throws, never blocks the caller.
 */

interface SupabaseErrorLike {
  message?: string;
  code?:    string;
  details?: string;
  hint?:    string;
}

export function reportSyncWriteError(tag: string, error: SupabaseErrorLike | null | undefined): void {
  if (!error) return;
  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.warn(`[${tag}] Supabase write failed (local state is still correct):`, {
      message: error.message, code: error.code, hint: error.hint,
    });
  }
}
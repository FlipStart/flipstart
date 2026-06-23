/**
 * server/supabaseAdmin.ts
 *
 * Server-side Supabase client for Founder Dashboard V3 (read-only analytics).
 * Uses the service-role key which bypasses RLS — ONLY safe server-side.
 * Never import this from mobile/client code.
 *
 * Required Railway env vars (server-side only):
 *   SUPABASE_URL              — https://xxxx.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY — the service_role secret (not the anon key)
 */

import { createClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _client: any = null;
let _triedInit = false;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getSupabaseAdmin(): any {
  if (_client) return _client;
  if (_triedInit) return null;
  _triedInit = true;

  const url = process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) {
    console.warn(
      "[supabaseAdmin] Missing env vars — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Railway.",
    );
    return null;
  }

  try {
    _client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return _client;
  } catch (e) {
    console.error("[supabaseAdmin] createClient failed:", e);
    return null;
  }
}

export function isSupabaseAdminConfigured(): boolean {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}
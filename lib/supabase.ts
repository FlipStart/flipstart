/**
 * lib/supabase.ts
 *
 * Supabase client with defensive startup guarantees:
 *   - react-native-url-polyfill applied via setupURLPolyfill() in try/catch
 *     (NOT via the side-effect "auto" import which crashes on some iOS builds)
 *   - createClient() guarded against missing env vars
 *   - No network/session calls at module level
 *   - App boots safely even if Supabase config is missing or broken
 */

// ─── URL Polyfill ─────────────────────────────────────────────────────────────
// Use explicit function call instead of `import "react-native-url-polyfill/auto"`
// The auto import runs synchronously as a module-level side effect before any
// error boundary exists, which causes a crash on iOS standalone builds.
// setupURLPolyfill() does the same work but inside a try/catch.
try {
  const { setupURLPolyfill } = require("react-native-url-polyfill");
  setupURLPolyfill();
  if (__DEV__) console.log("[supabase] URL polyfill applied");
} catch (err) {
  if (__DEV__) console.warn("[supabase] URL polyfill failed — app will continue without it:", err);
}

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";

// ─── Env var validation ───────────────────────────────────────────────────────
const supabaseUrl     = process.env.EXPO_PUBLIC_SUPABASE_URL      ?? "";
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    "[supabase] Missing env vars — auth will not work.\n" +
    "  EXPO_PUBLIC_SUPABASE_URL:", supabaseUrl ? "set" : "MISSING",
    "\n  EXPO_PUBLIC_SUPABASE_ANON_KEY:", supabaseAnonKey ? "set" : "MISSING"
  );
}

// ─── SecureStore adapter with chunking ───────────────────────────────────────
// SecureStore has a ~2048-byte limit per key.
// Supabase session tokens can exceed this, so large values are split across
// multiple keys and reassembled transparently.
const CHUNK_SIZE = 1900;

/**
 * Remove a chunked representation entirely.
 *
 * Deletes a few extra indices past the recorded count as cheap insurance
 * against a previously interrupted write leaving an orphan behind.
 */
async function clearChunks(key: string): Promise<void> {
  try {
    const recorded = await SecureStore.getItemAsync(`${key}_chunks`);
    const n = recorded ? parseInt(recorded, 10) : 0;
    const upTo = Number.isFinite(n) && n > 0 ? n + 3 : 3;
    for (let i = 0; i < upTo; i++) {
      await SecureStore.deleteItemAsync(`${key}_chunk_${i}`).catch(() => {});
    }
    await SecureStore.deleteItemAsync(`${key}_chunks`).catch(() => {});
  } catch { /* non-fatal */ }
}

const ExpoSecureStoreAdapter = {
  async getItem(key: string): Promise<string | null> {
    try {
      const chunkCount = await SecureStore.getItemAsync(`${key}_chunks`);
      if (chunkCount) {
        const n = parseInt(chunkCount, 10);
        const chunks: string[] = [];
        for (let i = 0; i < n; i++) {
          const chunk = await SecureStore.getItemAsync(`${key}_chunk_${i}`);
          // An incomplete chunk set is corrupt. Returning null makes Supabase
          // treat it as "no stored session" — the user signs in again once,
          // which is far better than restoring a half-read session that then
                    // fails to refresh and looks like a random logout.
          if (chunk == null) {
            await clearChunks(key);
            return await SecureStore.getItemAsync(key);
          }
          chunks.push(chunk);
        }
        return chunks.join("");
      }
      return await SecureStore.getItemAsync(key);
    } catch {
      return null;
    }
  },

  /**
   * CRITICAL: every write must destroy the OTHER representation.
   *
   * ── The bug this fixes (random logouts) ───────────────────────────────────
   * getItem() checks `${key}_chunks` FIRST. The old setItem wrote the plain key
   * for small values and the chunked keys for large ones, but never removed the
   * form it was not using. Session JSON crosses the 1900-byte line as token
   * claims change, so:
   *
   *   1. login          2400 bytes -> chunked, _chunks = 2
   *   2. token refresh  1800 bytes -> plain key written, _chunks STILL 2
   *   3. next launch    getItem sees _chunks, returns the OLD chunks
   *
   * Supabase then refreshed with an already-rotated token, got
   * "Invalid Refresh Token", and signed the user out. Intermittent, because it
   * depended on token length — which is exactly how it presented.
   *
   * Cleanup happens BEFORE the write, so a crash mid-operation leaves no
   * readable stale value rather than a plausible-looking wrong one.
   */
  async setItem(key: string, value: string): Promise<void> {
    try {
      if (value.length <= CHUNK_SIZE) {
        // Destroy any chunked form first, or getItem would prefer it forever.
        await clearChunks(key);
        await SecureStore.setItemAsync(key, value);
        return;
      }
      const chunks: string[] = [];
      for (let i = 0; i < value.length; i += CHUNK_SIZE) {
        chunks.push(value.slice(i, i + CHUNK_SIZE));
      }
      // Drop the old chunk set before writing: a shrinking session (3 chunks to
      // 2) would otherwise leave _chunk_2 behind as a readable fragment.
      await clearChunks(key);
      // And drop the plain form, so the two can never disagree.
      await SecureStore.deleteItemAsync(key).catch(() => {});
      for (let i = 0; i < chunks.length; i++) {
        await SecureStore.setItemAsync(`${key}_chunk_${i}`, chunks[i]);
      }
      // Written LAST: until this exists, getItem falls back to the plain key, so
      // a crash mid-write cannot surface a half-written chunk set.
      await SecureStore.setItemAsync(`${key}_chunks`, String(chunks.length));
    } catch {
      /* never crash — session persistence failure is non-fatal */
    }
  },

  async removeItem(key: string): Promise<void> {
    try {
      await clearChunks(key);
      await SecureStore.deleteItemAsync(key).catch(() => {});
    } catch {
      /* never crash */
    }
  },
};

// ─── Supabase client ──────────────────────────────────────────────────────────
// Wrapped in IIFE with try/catch — createClient() throws if env vars are
// empty strings (falsy). If it throws, supabase is null. Every caller in
// auth-context.tsx is already wrapped in try/catch, so a null client causes
// a caught TypeError that sets guest state — the app never crashes.
export const supabase: SupabaseClient = (() => {
  try {
    if (!supabaseUrl || !supabaseAnonKey) {
      console.warn("[supabase] env vars missing — auth disabled, app will run as guest");
      return null as unknown as SupabaseClient;
    }
    const client = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        storage:            ExpoSecureStoreAdapter,
        persistSession:     true,
        autoRefreshToken:   true,
        detectSessionInUrl: false,
        flowType:           "pkce",
      },
    });
    if (__DEV__) console.log("[supabase] client created successfully");
    return client;
  } catch (err) {
    console.warn("[supabase] createClient threw — auth disabled, app will run as guest:", err);
    return null as unknown as SupabaseClient;
  }
})();
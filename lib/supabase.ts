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

const ExpoSecureStoreAdapter = {
  async getItem(key: string): Promise<string | null> {
    try {
      const chunkCount = await SecureStore.getItemAsync(`${key}_chunks`);
      if (chunkCount) {
        const n = parseInt(chunkCount, 10);
        const chunks: string[] = [];
        for (let i = 0; i < n; i++) {
          const chunk = await SecureStore.getItemAsync(`${key}_chunk_${i}`);
          if (chunk == null) return null;
          chunks.push(chunk);
        }
        return chunks.join("");
      }
      return await SecureStore.getItemAsync(key);
    } catch {
      return null;
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    try {
      if (value.length <= CHUNK_SIZE) {
        await SecureStore.setItemAsync(key, value);
        return;
      }
      const chunks: string[] = [];
      for (let i = 0; i < value.length; i += CHUNK_SIZE) {
        chunks.push(value.slice(i, i + CHUNK_SIZE));
      }
      for (let i = 0; i < chunks.length; i++) {
        await SecureStore.setItemAsync(`${key}_chunk_${i}`, chunks[i]);
      }
      await SecureStore.setItemAsync(`${key}_chunks`, String(chunks.length));
    } catch {
      /* never crash — session persistence failure is non-fatal */
    }
  },

  async removeItem(key: string): Promise<void> {
    try {
      const chunkCount = await SecureStore.getItemAsync(`${key}_chunks`);
      if (chunkCount) {
        const n = parseInt(chunkCount, 10);
        for (let i = 0; i < n; i++) {
          await SecureStore.deleteItemAsync(`${key}_chunk_${i}`);
        }
        await SecureStore.deleteItemAsync(`${key}_chunks`);
      }
      await SecureStore.deleteItemAsync(key);
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
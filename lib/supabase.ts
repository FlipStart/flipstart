/**
 * lib/supabase.ts
 * Supabase client for FlipStart.
 * Session stored securely in expo-secure-store.
 *
 * Required env vars in .env:
 *   EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
 *   EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
 */

import "react-native-url-polyfill/auto";
import { createClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";

const supabaseUrl     = process.env.EXPO_PUBLIC_SUPABASE_URL      ?? "";
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";

if (__DEV__) {
  if (!supabaseUrl)     console.warn("[supabase] EXPO_PUBLIC_SUPABASE_URL not set");
  if (!supabaseAnonKey) console.warn("[supabase] EXPO_PUBLIC_SUPABASE_ANON_KEY not set");
}

// ─── SecureStore adapter with chunking ───────────────────────────────────────
// SecureStore has a 2048-byte limit per key. Supabase session tokens can exceed
// this, so we split large values across multiple keys transparently.
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
    } catch { return null; }
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
    } catch { /* never crash */ }
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
    } catch { /* never crash */ }
  },
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage:            ExpoSecureStoreAdapter,
    persistSession:     true,
    autoRefreshToken:   true,
    detectSessionInUrl: false,
    flowType:           "pkce",
  },
});
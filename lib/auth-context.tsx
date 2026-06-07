/**
 * lib/auth-context.tsx  —  DIAGNOSTIC STUB
 *
 * This stub exists ONLY to confirm AuthProvider mounts safely without
 * importing any Supabase, SecureStore, or URL polyfill code.
 *
 * Imports nothing from:
 *   - lib/supabase.ts
 *   - @supabase/supabase-js
 *   - react-native-url-polyfill
 *   - expo-secure-store
 *   - @react-native-async-storage
 *
 * Returns hardcoded guest state. No network calls. No native module calls.
 *
 * If TestFlight opens with this stub → crash is caused by Supabase/polyfill/
 * SecureStore import or runtime logic, NOT the AuthProvider wrapper itself.
 */

import { createContext, useContext, type ReactNode } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Profile {
  id:                  string;
  username:            string;
  display_name:        string | null;
  onboarding_complete: boolean;
  created_at:          string;
}

interface AuthState {
  session:        null;
  user:           null;
  profile:        null;
  loading:        false;
  profileChecked: true;
  signOut:        () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

// Kept for compatibility — nothing writes to it in this stub
export const PENDING_USERNAME_KEY = "@flipstart/pendingUsername";

// ─── Stub state ───────────────────────────────────────────────────────────────

const STUB_STATE: AuthState = {
  session:        null,
  user:           null,
  profile:        null,
  loading:        false,
  profileChecked: true,
  signOut:        async () => {},
  refreshProfile: async () => {},
};

// ─── Context ──────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthState>(STUB_STATE);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  // No Supabase calls. No SecureStore. No network. No native modules.
  // Just wraps children with the hardcoded guest state.
  return (
    <AuthContext.Provider value={STUB_STATE}>
      {children}
    </AuthContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
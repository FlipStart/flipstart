/**
 * lib/auth-context.tsx
 *
 * Defensive AuthProvider — safe for TestFlight standalone builds.
 *
 * Every Supabase call is wrapped in try/catch.
 * Any failure → sets safe logged-out state.
 * App NEVER crashes because of auth/profile errors.
 * App boots even if Supabase is offline, misconfigured, or returns errors.
 */

import {
  createContext, useCallback, useContext,
  useEffect, useRef, useState, type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "@/lib/supabase";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Profile {
  id:                  string;
  username:            string;
  display_name:        string | null;
  onboarding_complete: boolean;
  created_at:          string;
}

interface AuthState {
  session:        Session | null;
  user:           User    | null;
  profile:        Profile | null;
  loading:        boolean;       // true until initial session check resolves
  profileChecked: boolean;       // true after ensureProfile completes
  signOut:        () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

export const PENDING_USERNAME_KEY = "@flipstart/pendingUsername";

const DEFAULT_STATE: AuthState = {
  session:        null,
  user:           null,
  profile:        null,
  loading:        true,
  profileChecked: false,
  signOut:        async () => {},
  refreshProfile: async () => {},
};

const AuthContext = createContext<AuthState>(DEFAULT_STATE);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session,        setSession]        = useState<Session | null>(null);
  const [user,           setUser]           = useState<User    | null>(null);
  const [profile,        setProfile]        = useState<Profile | null>(null);
  const [loading,        setLoading]        = useState(true);
  const [profileChecked, setProfileChecked] = useState(false);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // ── Safe state setter helpers ─────────────────────────────────────────────
  const safeSetLoading        = (v: boolean) => { if (mounted.current) setLoading(v); };
  const safeSetProfileChecked = (v: boolean) => { if (mounted.current) setProfileChecked(v); };
  const safeSetProfile        = (v: Profile | null) => { if (mounted.current) setProfile(v); };

  // ── fetchProfile ──────────────────────────────────────────────────────────
  const fetchProfile = useCallback(async (userId: string): Promise<void> => {
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .single();
      if (!mounted.current) return;
      if (error) {
        if (__DEV__) console.warn("[auth] fetchProfile error:", error.message);
        safeSetProfile(null);
        return;
      }
      safeSetProfile(data as Profile);
      if (__DEV__) console.log("[auth] profile loaded:", (data as Profile)?.username);
    } catch (err) {
      if (__DEV__) console.warn("[auth] fetchProfile threw:", err);
      safeSetProfile(null);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── ensureProfile ─────────────────────────────────────────────────────────
  const ensureProfile = useCallback(async (userId: string): Promise<void> => {
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .single();

      if (!mounted.current) return;

      if (!error && data) {
        safeSetProfile(data as Profile);
        if (__DEV__) console.log("[auth] ensureProfile: loaded:", (data as Profile)?.username);
        return;
      }

      // Profile missing — check for pending username from email signup
      let pendingUsername: string | null = null;
      try {
        pendingUsername = await AsyncStorage.getItem(PENDING_USERNAME_KEY);
      } catch { /* ignore */ }

      if (pendingUsername) {
        if (__DEV__) console.log("[auth] creating profile with pending username:", pendingUsername);
        try {
          const { error: insertError } = await supabase.from("profiles").insert({
            id:                  userId,
            username:            pendingUsername,
            display_name:        pendingUsername,
            onboarding_complete: true,
          });
          if (insertError && insertError.code === "23505") {
            // Username conflict — insert fallback
            await supabase.from("profiles").insert({
              id:                  userId,
              username:            `user_${userId.slice(0, 8)}`,
              display_name:        "Flipper",
              onboarding_complete: false,
            });
          }
        } catch (err) {
          if (__DEV__) console.warn("[auth] profile insert threw:", err);
        }
        try { await AsyncStorage.removeItem(PENDING_USERNAME_KEY); } catch { /* ignore */ }
        if (mounted.current) await fetchProfile(userId);
      } else {
        // No pending username (social login edge case) — insert fallback
        if (__DEV__) console.log("[auth] no pending username — inserting fallback profile");
        try {
          await supabase.from("profiles").insert({
            id:                  userId,
            username:            `user_${userId.slice(0, 8)}`,
            display_name:        "Flipper",
            onboarding_complete: false,
          });
        } catch { /* ignore */ }
        if (mounted.current) await fetchProfile(userId);
      }
    } catch (err) {
      if (__DEV__) console.warn("[auth] ensureProfile threw:", err);
      safeSetProfile(null);
    }
  }, [fetchProfile]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── signOut ───────────────────────────────────────────────────────────────
  const signOut = useCallback(async (): Promise<void> => {
    try {
      await supabase.auth.signOut();
    } catch (err) {
      if (__DEV__) console.warn("[auth] signOut threw:", err);
    }
  }, []);

  // ── refreshProfile ────────────────────────────────────────────────────────
  const refreshProfile = useCallback(async (): Promise<void> => {
    if (user?.id) {
      try { await ensureProfile(user.id); } catch { /* never crash */ }
    }
  }, [user, ensureProfile]);

  // ── Startup: load persisted session ──────────────────────────────────────
  useEffect(() => {
    if (__DEV__) console.log("[auth] AuthProvider mounted — loading session");

    // Step 1: load persisted session from SecureStore
    supabase.auth.getSession()
      .then(({ data, error }) => {
        if (!mounted.current) return;
        if (error) {
          if (__DEV__) console.warn("[auth] getSession error:", error.message);
          safeSetLoading(false);
          safeSetProfileChecked(true);
          return;
        }
        const s = data.session ?? null;
        setSession(s);
        setUser(s?.user ?? null);
        if (__DEV__) console.log("[auth] getSession — user:", s?.user?.id ?? "none");

        if (s?.user?.id) {
          ensureProfile(s.user.id)
            .catch((err) => { if (__DEV__) console.warn("[auth] startup ensureProfile threw:", err); })
            .finally(() => {
              safeSetLoading(false);
              safeSetProfileChecked(true);
            });
        } else {
          safeSetLoading(false);
          safeSetProfileChecked(true);
        }
      })
      .catch((err) => {
        if (__DEV__) console.warn("[auth] getSession threw:", err);
        // Auth completely failed — boot in guest state, never crash
        if (mounted.current) {
          safeSetLoading(false);
          safeSetProfileChecked(true);
        }
      });

    // Step 2: subscribe to future auth changes
    let subscription: { unsubscribe: () => void } | null = null;
    try {
      const result = supabase.auth.onAuthStateChange((event, newSession) => {
        if (!mounted.current) return;
        if (__DEV__) console.log("[auth] onAuthStateChange:", event, newSession?.user?.id ?? "no user");

        try {
          setSession(newSession);
          setUser(newSession?.user ?? null);

          if (event === "SIGNED_IN" && newSession?.user?.id) {
            safeSetProfileChecked(false);
            ensureProfile(newSession.user.id)
              .catch((err) => { if (__DEV__) console.warn("[auth] SIGNED_IN ensureProfile threw:", err); })
              .finally(() => safeSetProfileChecked(true));
          } else if (event === "SIGNED_OUT") {
            safeSetProfile(null);
            safeSetProfileChecked(true);
          }
        } catch (err) {
          if (__DEV__) console.warn("[auth] onAuthStateChange handler threw:", err);
        }
      });
      subscription = result.data.subscription;
    } catch (err) {
      if (__DEV__) console.warn("[auth] onAuthStateChange setup threw:", err);
      // Subscription failed — app still boots, just won't react to future auth events
    }

    return () => {
      try { subscription?.unsubscribe(); } catch { /* never crash on cleanup */ }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const value: AuthState = {
    session, user, profile, loading, profileChecked, signOut, refreshProfile,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
// Returns DEFAULT_STATE instead of throwing if called outside AuthProvider.
// This prevents crashes if a component accidentally calls useAuth() without a provider.
export function useAuth(): AuthState {
  return useContext(AuthContext);
}
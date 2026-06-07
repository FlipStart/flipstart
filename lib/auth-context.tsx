/**
 * lib/auth-context.tsx
 * Global auth state for FlipStart.
 *
 * Tracks: session, user, profile, loading, profileChecked.
 * profileChecked prevents race conditions where user is set but
 * profile fetch is still in flight — routing gates wait for it.
 *
 * Usage:
 *   import { useAuth } from '@/lib/auth-context';
 *   const { user, profile, loading, profileChecked, signOut } = useAuth();
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
    loading:        boolean;       // true until initial session resolves
    profileChecked: boolean;       // true after ensureProfile completes — safe to route
    signOut:        () => Promise<void>;
    refreshProfile: () => Promise<void>;
  }
  
  // ─── Pending username key ─────────────────────────────────────────────────────
  // Written by auth.tsx after signUp when email confirmation is required.
  // Read here after SIGNED_IN to create the profile row once a session exists.
  export const PENDING_USERNAME_KEY = "@flipstart/pendingUsername";
  
  // ─── Context ──────────────────────────────────────────────────────────────────
  
  const AuthContext = createContext<AuthState | null>(null);
  
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
  
    // ── fetchProfile ──────────────────────────────────────────────────────────
    const fetchProfile = useCallback(async (userId: string): Promise<void> => {
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", userId)
          .single();
        if (!mounted.current) return;
        if (error) { setProfile(null); return; }
        setProfile(data as Profile);
        if (__DEV__) console.log("[auth] profile loaded:", (data as Profile)?.username);
      } catch {
        if (mounted.current) setProfile(null);
      }
    }, []);
  
    // ── ensureProfile ─────────────────────────────────────────────────────────
    // Fetches profile. If missing, reads pendingUsername from AsyncStorage
    // (written by auth.tsx during email-confirmation signup) and creates the row.
    // Falls back to a placeholder profile with onboarding_complete:false so the
    // app never hard-crashes — the username-setup screen handles completion.
    const ensureProfile = useCallback(async (userId: string): Promise<void> => {
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", userId)
          .single();
  
        if (!mounted.current) return;
  
        if (!error && data) {
          setProfile(data as Profile);
          if (__DEV__) console.log("[auth] profile loaded:", (data as Profile)?.username);
          return;
        }
  
        // Profile missing — check for pending username from signup
        const pendingUsername = await AsyncStorage.getItem(PENDING_USERNAME_KEY).catch(() => null);
        if (pendingUsername) {
          if (__DEV__) console.log("[auth] creating profile with pending username:", pendingUsername);
          const { error: insertError } = await supabase.from("profiles").insert({
            id:                  userId,
            username:            pendingUsername,
            display_name:        pendingUsername,
            onboarding_complete: true,
          });
          if (insertError?.code === "23505") {
            // Username taken — insert fallback, route to username-setup
            await supabase.from("profiles").insert({
              id:                  userId,
              username:            `user_${userId.slice(0, 8)}`,
              display_name:        "Flipper",
              onboarding_complete: false,
            });
          }
          await AsyncStorage.removeItem(PENDING_USERNAME_KEY).catch(() => {});
          if (mounted.current) await fetchProfile(userId);
        } else {
          // No pending username — social or edge case — insert fallback
          if (__DEV__) console.log("[auth] no pending username, inserting fallback profile");
          await supabase.from("profiles").insert({
            id:                  userId,
            username:            `user_${userId.slice(0, 8)}`,
            display_name:        "Flipper",
            onboarding_complete: false,
          });
          if (mounted.current) await fetchProfile(userId);
        }
      } catch (err) {
        if (__DEV__) console.warn("[auth] ensureProfile error:", err);
        if (mounted.current) setProfile(null);
      }
    }, [fetchProfile]);
  
    // ── Public: refreshProfile ────────────────────────────────────────────────
    const refreshProfile = useCallback(async (): Promise<void> => {
      if (user?.id) await ensureProfile(user.id);
    }, [user, ensureProfile]);
  
    // ── Public: signOut ───────────────────────────────────────────────────────
    const signOut = useCallback(async (): Promise<void> => {
      await supabase.auth.signOut().catch(() => {});
    }, []);
  
    // ── Initial session + subscription ───────────────────────────────────────
    useEffect(() => {
      // Load persisted session from SecureStore
      supabase.auth.getSession().then(({ data }) => {
        if (!mounted.current) return;
        const s = data.session ?? null;
        setSession(s);
        setUser(s?.user ?? null);
        if (s?.user?.id) {
          ensureProfile(s.user.id).finally(() => {
            if (mounted.current) { setLoading(false); setProfileChecked(true); }
          });
        } else {
          setLoading(false);
          setProfileChecked(true);
        }
      }).catch(() => {
        if (mounted.current) { setLoading(false); setProfileChecked(true); }
      });
  
      // Subscribe to auth changes
      const { data: { subscription } } = supabase.auth.onAuthStateChange((event, newSession) => {
        if (!mounted.current) return;
        if (__DEV__) console.log("[auth] onAuthStateChange:", event);
        setSession(newSession);
        setUser(newSession?.user ?? null);
  
        if (event === "SIGNED_IN" && newSession?.user?.id) {
          if (__DEV__) console.log("[auth] SIGNED_IN userId:", newSession.user.id);
          setProfileChecked(false);
          ensureProfile(newSession.user.id).finally(() => {
            if (mounted.current) setProfileChecked(true);
          });
        } else if (event === "SIGNED_OUT") {
          setProfile(null);
          setProfileChecked(true);
        } else if (event === "TOKEN_REFRESHED") {
          // Session refreshed silently — no profile change needed
        }
      });
  
      return () => subscription.unsubscribe();
    }, [ensureProfile]);
  
    const value: AuthState = {
      session, user, profile, loading, profileChecked, signOut, refreshProfile,
    };
  
    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
  }
  
  // ─── Hook ─────────────────────────────────────────────────────────────────────
  
  export function useAuth(): AuthState {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
    return ctx;
  }
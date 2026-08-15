/**
 * lib/auth-context.tsx
 *
 * AuthProvider with LAZY Supabase import.
 *
 * lib/supabase.ts is NOT imported at module level. It is dynamically
 * imported inside useEffect — after the first render — via:
 *   const { supabase } = await import("@/lib/supabase")
 *
 * This prevents react-native-url-polyfill, @supabase/supabase-js, and
 * expo-secure-store from loading during startup, which was crashing
 * TestFlight builds.
 *
 * Top-level imports: only "react" and "@react-native-async-storage/async-storage".
 * Everything Supabase-related loads after the first frame has rendered.
 *
 * Failure contract: if dynamic import or any Supabase call fails, the app
 * silently falls back to guest state. Never crashes startup.
 */

import {
  createContext, useCallback, useContext,
  useEffect, useRef, useState, type ReactNode,
} from "react";
import { AppState } from "react-native";

// import type is compile-time only — completely erased by Metro/Babel.
// These types create zero runtime dependency on @supabase/supabase-js.
import type { Session, User } from "@supabase/supabase-js";

import AsyncStorage from "@react-native-async-storage/async-storage";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Profile {
  id:                    string;
  username:              string;
  display_name:          string | null;
  onboarding_complete:   boolean;
  created_at:            string;
  // Added for one-time username change enforcement.
  // Optional so the app works before the SQL migration runs.
  username_changed_once?: boolean;
  // Hosted avatar URL (Supabase Storage 'avatars' bucket). Optional so the
  // app works before the avatar SQL migration runs.
  avatar_url?:            string | null;
}

interface AuthState {
  session:        Session | null;
  user:           User    | null;
  profile:        Profile | null;
  loading:        boolean;
  profileChecked: boolean;
  /**
   * True when the profile query FAILED, as distinct from "loaded and empty".
   *
   * This is the field whose absence sent an existing account to username
   * creation. `profile?.onboarding_complete` was falsy for three different
   * situations — still loading, query failed, genuinely incomplete — and only
   * the third should ever route to setup.
   */
  profileError: boolean;
  signOut:        () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

export const PENDING_USERNAME_KEY = "@flipstart/pendingUsername";

// ─── Default guest state ──────────────────────────────────────────────────────

const GUEST_STATE: AuthState = {
  session:        null,
  user:           null,
  profile:        null,
  loading:        true,   // true until dynamic import + getSession resolves
  profileChecked: false,
  profileError: false,
  signOut:        async () => {},
  refreshProfile: async () => {},
};

const AuthContext = createContext<AuthState>(GUEST_STATE);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session,        setSession]        = useState<Session | null>(null);
  const [user,           setUser]           = useState<User    | null>(null);
  const [profile,        setProfile]        = useState<Profile | null>(null);
  const [loading,        setLoading]        = useState(true);
  const [profileChecked, setProfileChecked] = useState(false);
  const [profileError, setProfileError]     = useState(false);
  // signOut and refreshProfile are useCallbacks using refs — no stale closures

  // refreshProfile and signOut are defined as useCallbacks that read from refs
  // so they always have the current user/supabase even after lazy init().
  const refreshProfile = useCallback(async (): Promise<void> => {
    const userId = userRef.current?.id;
    if (userId && ensureProfileRef.current) {
      try { await ensureProfileRef.current(userId); } catch { /* ok */ }
    }
  }, []);

  const signOut = useCallback(async (): Promise<void> => {
    if (__DEV__) console.log('[auth] signOut: tapped');

    // ── Step 1: Optimistic clear — instant UI response ─────────────────────
    // State setters from useState are stable references — safe to call in
    // useCallback with [] deps. This re-renders the UI to logged-out state
    // immediately without waiting for the network call.
    setSession(null);
    setUser(null);
    setProfile(null);
    setProfileChecked(true);
    if (__DEV__) console.log('[auth] signOut: local state cleared (UI now logged-out)');

    // ── Step 2: Background — tell Supabase to invalidate server session ────
    // Fire-and-forget. Failure is non-fatal — user is already shown logged out.
    if (__DEV__) console.log('[auth] signOut: calling Supabase signOut');
    try {
      if (supabaseRef.current) {
        await supabaseRef.current.auth.signOut();
        if (__DEV__) console.log('[auth] signOut: Supabase signOut complete');
      }
    } catch (err) {
      if (__DEV__) console.warn('[auth] signOut: Supabase signOut failed (non-fatal):', err);
      // Non-fatal — local state is already cleared. Server session will
      // expire naturally. User cannot get stuck in logged-in UI.
    }
    if (__DEV__) console.log('[auth] signOut: done');
  }, []); // setSession/setUser/setProfile/setProfileChecked are stable React setters

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // Refs so refreshProfile/signOut always have the current user and ensureProfile
  // without depending on stale closures from the lazy init() useEffect.
  const userRef           = useRef<User | null>(null);
  const ensureProfileRef  = useRef<((userId: string) => Promise<void>) | null>(null);
  const supabaseRef       = useRef<any>(null);

  // Keep userRef in sync with user state
  useEffect(() => { userRef.current = user; }, [user]);

  const safe = {
    setLoading:        (v: boolean)        => { if (mounted.current) setLoading(v); },
    setProfileChecked: (v: boolean)        => { if (mounted.current) setProfileChecked(v); },
    setProfileError:   (v: boolean)        => { if (mounted.current) setProfileError(v); },
    setProfile:        (v: Profile | null) => { if (mounted.current) setProfile(v); },
    setSession:        (v: Session | null) => { if (mounted.current) setSession(v); },
    setUser:           (v: User    | null) => { if (mounted.current) setUser(v); },
  };

  // ── Lazy Supabase initialisation ──────────────────────────────────────────
  // Runs AFTER first render. This prevents supabase.ts (and its imports of
  // react-native-url-polyfill, @supabase/supabase-js, expo-secure-store)
  // from executing during startup.
  useEffect(() => {
    let subscription: { unsubscribe: () => void } | null = null;
    let appStateSub: { remove: () => void } | null = null;

    const init = async () => {
      // ── Step 1: dynamic import ───────────────────────────────────────────
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let supabase: any;
      try {
        const mod = await import("@/lib/supabase");
        supabase = mod.supabase;
        if (__DEV__) console.log("[auth] Supabase dynamically imported");
      } catch (err) {
        if (__DEV__) console.warn("[auth] dynamic import of supabase failed:", err);
        safe.setLoading(false);
        safe.setProfileChecked(true);
        return;
      }

      if (!mounted.current) return;

      // ── Step 1b: keep the access token fresh while the app is foregrounded.
      // Official supabase-js React Native recipe: the auto-refresh timer only
      // runs reliably when explicitly started/stopped around AppState changes.
      // Without this, a session left open past token expiry (~1h) starts
      // failing API calls (sync, profile) even though the user is "logged in".
      // Cold-start recovery after days away is unaffected (handled by
      // persistSession + refresh token) — this protects LIVE sessions.
      try {
        if (AppState.currentState === "active") supabase.auth.startAutoRefresh();
        appStateSub = AppState.addEventListener("change", (state) => {
          try {
            if (state === "active") supabase.auth.startAutoRefresh();
            else supabase.auth.stopAutoRefresh();
          } catch { /* non-fatal */ }
        });
      } catch (err) {
        if (__DEV__) console.warn("[auth] AppState auto-refresh wiring failed:", err);
      }

      // ── Step 2: helper — fetch profile ──────────────────────────────────
      const fetchProfile = async (userId: string): Promise<void> => {
        try {
          const { data, error } = await supabase
            .from("profiles")
            .select("*")
            .eq("id", userId)
            .single();
          if (!mounted.current) return;
          if (!error && data) {
            safe.setProfile(data as Profile);
            if (__DEV__) console.log("[auth] profile loaded:", data?.username);
          } else {
            safe.setProfile(null);
          }
        } catch (err) {
          if (__DEV__) console.warn("[auth] fetchProfile threw:", err);
          safe.setProfile(null);
        }
      };

      // ── Step 3: helper — ensure profile ─────────────────────────────────
      const ensureProfile = async (userId: string): Promise<void> => {
        try {
          const { data, error } = await supabase
            .from("profiles")
            .select("*")
            .eq("id", userId)
            .maybeSingle();
          if (!mounted.current) return;

          if (!error && data) {
            safe.setProfileError(false);
            safe.setProfile(data as Profile);
            if (__DEV__) console.log("[auth] ensureProfile: loaded:", data?.username);
            return;
          }

          /**
           * A QUERY FAILURE IS NOT A MISSING PROFILE.
           *
           * This is the bug that sent a real existing account to username
           * creation. The old code read `if (!error && data)` and treated
           * everything else as "profile missing" — including a network timeout,
           * a transient 5xx, and an RLS hiccup. It then attempted to INSERT a
           * replacement profile with a generated `user_xxxxxxxx` username and
           * `onboarding_complete: false`.
           *
           * The primary key on `profiles.id` is the only reason no data was
           * destroyed: the insert conflicted and was swallowed. But `profile`
           * stayed null, so the home gate routed to username setup anyway.
           *
           * `.maybeSingle()` replaces `.single()` deliberately: `.single()`
           * raises an error for zero rows, which is precisely the case we need
           * to tell apart from a real failure.
           */
          if (error) {
            if (__DEV__) console.warn("[auth] ensureProfile: query FAILED (not treating as new account):", error.code ?? error.message);
            safe.setProfileError(true);
            safe.setProfileChecked(true);
            return;   // leave any previously-loaded profile intact
          }

          // error === null && data === null: the row genuinely does not exist.
          safe.setProfileError(false);

          // Profile missing. Before trying to CREATE one, confirm the auth user
          // still exists server-side. If the account was deleted (e.g. from the
          // Supabase dashboard) but this device still holds a cached session,
          // getUser() returns an error/null. In that case we must NOT try to
          // insert a profile (its id FK references auth.users and would fail,
          // stranding the user forever on username-setup). Instead, sign out so
          // the app drops cleanly to guest/login.
          try {
            const { data: userData, error: userErr } = await supabase.auth.getUser();
            if (userErr || !userData?.user) {
              if (__DEV__) console.warn("[auth] session user no longer exists — signing out ghost session");
              try { await supabase.auth.signOut(); } catch { /* ok */ }
              if (mounted.current) {
                safe.setSession(null);
                safe.setUser(null);
                safe.setProfile(null);
                safe.setProfileChecked(true);
              }
              return;
            }
          } catch {
            // If the check itself throws (offline, etc.), fall through to the
            // normal path rather than forcing a sign-out on a flaky network.
          }

          // Profile missing but user is valid — check for pending username
          let pendingUsername: string | null = null;
          try { pendingUsername = await AsyncStorage.getItem(PENDING_USERNAME_KEY); } catch { /* ok */ }

          if (pendingUsername) {
            try {
              const { error: insertError } = await supabase.from("profiles").insert({
                id: userId, username: pendingUsername,
                display_name: pendingUsername, onboarding_complete: true,
              });
              if (insertError?.code === "23505") {
                await supabase.from("profiles").insert({
                  id: userId, username: `user_${userId.slice(0, 8)}`,
                  display_name: "Flipper", onboarding_complete: false,
                });
              }
            } catch { /* ok */ }
            try { await AsyncStorage.removeItem(PENDING_USERNAME_KEY); } catch { /* ok */ }
            if (mounted.current) await fetchProfile(userId);
          } else {
            try {
              await supabase.from("profiles").insert({
                id: userId, username: `user_${userId.slice(0, 8)}`,
                display_name: "Flipper", onboarding_complete: false,
              });
            } catch { /* ok */ }
            if (mounted.current) await fetchProfile(userId);
          }
        } catch (err) {
          // A thrown error is a failure, not an empty account. Do NOT clear a
          // profile that may already be loaded and correct.
          if (__DEV__) console.warn("[auth] ensureProfile threw:", err);
          safe.setProfileError(true);
          safe.setProfileChecked(true);
        }
      };

      // ── Step 4: wire up refs so refreshProfile/signOut have live access ────
      supabaseRef.current      = supabase;
      ensureProfileRef.current = ensureProfile;

      // ── Step 5: subscribe to auth state changes ──────────────────────────
      try {
        const result = supabase.auth.onAuthStateChange(
          (event: string, newSession: Session | null) => {
            if (!mounted.current) return;
            if (__DEV__) console.log("[auth] onAuthStateChange:", event, newSession?.user?.id ?? "none");
            try {
              safe.setSession(newSession);
              safe.setUser(newSession?.user ?? null);
              if (event === "SIGNED_IN" && newSession?.user?.id) {
                safe.setProfileChecked(false);
                ensureProfile(newSession.user.id)
                  .catch((e) => { if (__DEV__) console.warn("[auth] ensureProfile error:", e); })
                  .finally(() => safe.setProfileChecked(true));
              } else if (event === "SIGNED_OUT") {
                safe.setProfile(null);
                safe.setProfileChecked(true);
              }
            } catch (e) {
              if (__DEV__) console.warn("[auth] onAuthStateChange handler threw:", e);
            }
          }
        );
        subscription = result.data.subscription;
      } catch (err) {
        if (__DEV__) console.warn("[auth] onAuthStateChange setup threw:", err);
      }

      // ── Step 6: load persisted session ──────────────────────────────────
      try {
        const { data, error } = await supabase.auth.getSession();
        if (!mounted.current) return;
        if (error) {
          if (__DEV__) console.warn("[auth] getSession error:", error.message);
          safe.setLoading(false);
          safe.setProfileChecked(true);
          return;
        }
        const s = data.session ?? null;
        safe.setSession(s);
        safe.setUser(s?.user ?? null);
        if (__DEV__) console.log("[auth] getSession — userId:", s?.user?.id ?? "none");

        if (s?.user?.id) {
          await ensureProfile(s.user.id)
            .catch((e) => { if (__DEV__) console.warn("[auth] startup ensureProfile threw:", e); });
        }
      } catch (err) {
        if (__DEV__) console.warn("[auth] getSession threw:", err);
      } finally {
        if (mounted.current) {
          safe.setLoading(false);
          safe.setProfileChecked(true);
        }
      }
    };

    init();

    return () => {
      try { subscription?.unsubscribe(); } catch { /* ok */ }
      try { appStateSub?.remove(); } catch { /* ok */ }
      try { supabaseRef.current?.auth?.stopAutoRefresh?.(); } catch { /* ok */ }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const value: AuthState = {
    session, user, profile, loading, profileChecked, profileError,
    signOut,
    refreshProfile,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
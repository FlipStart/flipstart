/**
 * lib/deepAnalysisTip.ts
 *
 * The "tap the item name to open Deep Analysis" coach-mark on the analysis screens
 * (results.tsx and scan-detail.tsx). ONE place decides whether it shows.
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 * The tip is an introduction. Once it has done its job it NEVER comes back:
 *
 *   • the user opens Deep Analysis, from ANY entry point (title, arrow, card,
 *     Hunt, history…). Counted at tap time, so a tap that lands on the paywall
 *     still counts: they found the feature, which is all the tip is for.
 *   • the user spends their free preview (checked from the server's entitlement,
 *     so it also covers people who used it before this rule existed)
 *   • the user closes it with the X. They said they do not need it.
 *
 * The old rule re-showed it after 5 scans without opening Deep Analysis. That
 * nagged people who had already seen the feature and chosen not to use it.
 * There is no streak, counter or "scans since" anymore.
 *
 * ── Storage ─────────────────────────────────────────────────────────────────
 * Same account-scoped key as before, so anyone who already tapped in keeps
 * `seen: true` and stays quiet (and the old `streak` field is ignored). A
 * missing, corrupt or unreadable value means "not seen yet": the worst case of a
 * storage failure is one more showing of a one-line tip, never a broken screen.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { useAuth } from "@/lib/auth-context";
import { useEntitlement } from "@/lib/useEntitlement";

export const deepTipKey = (uid: string | null | undefined): string =>
  `@flipstart/deep_analysis_state:${uid ?? "guest"}`;

/** Only an explicit `seen: true` counts; anything else is "not seen". */
export function parseTipSeen(raw: string | null | undefined): boolean {
  if (!raw) return false;
  try {
    return (JSON.parse(raw) as { seen?: unknown } | null)?.seen === true;
  } catch {
    return false;
  }
}

/**
 * A free account whose lifetime preview is gone has used it. Needs a RESOLVED
 * entitlement: while loading, `deepAnalysisPreviewAvailable` is false as a type
 * placeholder and must not be read as "used". Pro is excluded: the server reports
 * the preview as unavailable for Pro because they have the real thing, not
 * because they spent anything.
 */
export function previewSpent(e: { status: string; plan: string; deepAnalysisPreviewAvailable: boolean }): boolean {
  return e.status === "ready" && e.plan === "free" && !e.deepAnalysisPreviewAvailable;
}

/** `seen === null` means storage has not been read yet: show nothing until it has. */
export function shouldShowDeepTip(seen: boolean | null, spent: boolean): boolean {
  return seen === false && !spent;
}

// ── seen-marker + live notification ─────────────────────────────────────────
// A mounted screen must hide the tip the moment ANOTHER entry point (the gate
// hook, the arrow, the Deep Analysis card) marks it seen, not only on its own tap.
type Listener = (uid: string | null) => void;
const listeners = new Set<Listener>();

/** Persist "seen" for this account and tell mounted screens. Never throws. */
export function markDeepTipSeen(uid: string | null | undefined): void {
  const u = uid ?? null;
  listeners.forEach(l => { try { l(u); } catch { /* a listener must not block the others */ } });
  void (async () => {
    try {
      const key = deepTipKey(u);
      let prev: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse((await AsyncStorage.getItem(key)) ?? "null");
        if (parsed && typeof parsed === "object") prev = parsed as Record<string, unknown>;
      } catch { /* corrupt value: overwrite it */ }
      if (prev.seen === true) return;
      await AsyncStorage.setItem(key, JSON.stringify({ ...prev, seen: true }));
    } catch { /* non-fatal: the in-memory hide above still applies this session */ }
  })();
}

export interface DeepTip {
  show: boolean;
  /** The X: same as using it. Never shows again. */
  dismiss: () => void;
}

/** The tip's visibility for the signed-in account. Used by both analysis screens. */
export function useDeepAnalysisTip(): DeepTip {
  const { user } = useAuth();
  const ent = useEntitlement();
  const uid = user?.id ?? null;

  // Which account `seen` belongs to, so a stale read or a switch can't leak across accounts.
  const [state, setState] = useState<{ uid: string | null; seen: boolean | null }>({ uid, seen: null });
  const uidRef = useRef(uid);
  uidRef.current = uid;

  useEffect(() => {
    let alive = true;
    setState({ uid, seen: null });
    AsyncStorage.getItem(deepTipKey(uid))
      .then(raw => { if (alive) setState({ uid, seen: parseTipSeen(raw) }); })
      .catch(() => { if (alive) setState({ uid, seen: false }); });
    return () => { alive = false; };
  }, [uid]);

  useEffect(() => {
    const l: Listener = u => {
      if (u === uidRef.current) setState(s => (s.uid === u ? { uid: u, seen: true } : s));
    };
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);

  const seen = state.uid === uid ? state.seen : null;
  const spent = previewSpent(ent);

  // A spent preview is permanent: write it down so it holds even if the entitlement
  // is slow or unavailable on a later launch.
  useEffect(() => {
    if (seen === false && spent) markDeepTipSeen(uid);
  }, [seen, spent, uid]);

  const dismiss = useCallback(() => markDeepTipSeen(uidRef.current), []);

  return { show: shouldShowDeepTip(seen, spent), dismiss };
}
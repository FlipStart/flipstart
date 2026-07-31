/**
 * lib/uiHints.ts
 *
 * FILE PATH: lib/uiHints.ts
 *
 * One-time discoverability hints.
 *
 * Built as a small registry rather than a one-off flag because hints of this
 * kind multiply: each is individually cheap and collectively becomes clutter
 * with its own ad-hoc AsyncStorage key and its own dismissal rule. One
 * mechanism, one storage convention, one subscribe API.
 *
 * Semantics:
 *   - A hint shows until it is dismissed, then never again on this device.
 *   - Dismissal is triggered by the user PERFORMING the action, not by tapping
 *     an X. Once someone has swiped a row, they have learned the gesture and
 *     the tip has done its job.
 *   - State is in memory for synchronous reads, backed by AsyncStorage so it
 *     survives restarts. A failed write is non-fatal — worst case the hint
 *     reappears next launch.
 */
import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type HintId = 'swipeToDelete';

const STORAGE_PREFIX = 'flipstart.hint.';

/** undefined = not loaded yet, true = dismissed, false = still show. */
const state = new Map<HintId, boolean>();
const listeners = new Map<HintId, Set<() => void>>();
let loadStarted = false;

const keyFor = (id: HintId) => `${STORAGE_PREFIX}${id}.v1`;

function notify(id: HintId) {
  listeners.get(id)?.forEach(fn => { try { fn(); } catch { /* ignore */ } });
}

/** Read persisted state once per app session. Safe to call repeatedly. */
async function loadOnce(): Promise<void> {
  if (loadStarted) return;
  loadStarted = true;
  try {
    const ids: HintId[] = ['swipeToDelete'];
    const pairs = await AsyncStorage.multiGet(ids.map(keyFor));
    pairs.forEach(([k, v]) => {
      const id = ids.find(i => keyFor(i) === k);
      if (id) { state.set(id, v === '1'); notify(id); }
    });
  } catch {
    // Unreadable storage: treat as not dismissed. Showing a tip twice is a
    // far smaller cost than hiding it from someone who needs it.
    state.set('swipeToDelete', false);
    notify('swipeToDelete');
  }
}

/**
 * Dismiss permanently. Updates memory immediately so the UI reacts on the same
 * frame, then persists in the background.
 */
export function dismissHint(id: HintId): void {
  if (state.get(id) === true) return;   // already gone; skip the write
  state.set(id, true);
  notify(id);
  AsyncStorage.setItem(keyFor(id), '1').catch(() => { /* local-only ok */ });
}

/** Synchronous read. False while still loading, so nothing flashes on mount. */
export function isHintDismissed(id: HintId): boolean {
  return state.get(id) === true;
}

/**
 * Whether to show a hint right now.
 *
 * Returns false until storage has been read, so a dismissed hint never flashes
 * on screen for a frame before disappearing.
 */
export function useHint(id: HintId): boolean {
  const [, force] = useState(0);
  const [loaded, setLoaded] = useState(state.has(id));

  useEffect(() => {
    let alive = true;
    const set = listeners.get(id) ?? new Set();
    const fn = () => { if (alive) { setLoaded(true); force(n => n + 1); } };
    set.add(fn);
    listeners.set(id, set);

    loadOnce().then(() => { if (alive && state.has(id)) { setLoaded(true); force(n => n + 1); } });

    return () => { alive = false; set.delete(fn); };
  }, [id]);

  return loaded && state.get(id) === false;
}
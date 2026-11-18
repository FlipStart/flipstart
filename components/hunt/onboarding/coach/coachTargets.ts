/**
 * components/hunt/onboarding/coach/coachTargets.ts
 *
 * Where the real controls are on screen. A screen attaches `ref={coachRef('id')}` to
 * a control it already renders; the overlay later asks for the measured rectangle
 * of one or more ids. Nothing here changes layout or behaviour: it only remembers
 * which native view an id points at, and removes it again when that view goes away.
 */
import { useCallback } from 'react';
import type { View } from 'react-native';

export interface Rect { x: number; y: number; w: number; h: number }

const registry = new Map<string, View>();

/** A callback ref that registers the view under `id` (and forgets it on unmount). */
export function coachRef(id: string): (v: View | null) => void {
  let mine: View | null = null;
  return (v: View | null) => {
    if (v) { mine = v; registry.set(id, v); }
    // Only forget the view THIS ref registered: when a screen is replaced by a fresh
    // copy of itself, the old copy unmounting must not erase the new copy's entry.
    else { if (registry.get(id) === mine) registry.delete(id); mine = null; }
  };
}

/** Stable per-id callback refs, for function components. */
export function useCoachRef(id: string): (v: View | null) => void {
  return useCallback(coachRef(id), [id]);   // eslint-disable-line react-hooks/exhaustive-deps
}

function measureOne(v: View): Promise<Rect | null> {
  return new Promise(resolve => {
    try {
      v.measureInWindow((x, y, w, h) => {
        resolve(Number.isFinite(x) && Number.isFinite(y) && w > 0 && h > 0 ? { x, y, w, h } : null);
      });
    } catch { resolve(null); }
  });
}

/** The smallest rectangle covering every id that is currently on screen, or null. */
export function unionRect(rects: Array<Rect | null>): Rect | null {
  const r = rects.filter((x): x is Rect => !!x);
  if (r.length === 0) return null;
  const x1 = Math.min(...r.map(a => a.x)), y1 = Math.min(...r.map(a => a.y));
  const x2 = Math.max(...r.map(a => a.x + a.w)), y2 = Math.max(...r.map(a => a.y + a.h));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export async function measureTargets(ids: string[]): Promise<Rect | null> {
  const views = ids.map(id => registry.get(id)).filter((v): v is View => !!v);
  return unionRect(await Promise.all(views.map(measureOne)));
}

/** Test seam. */
export function __clearCoachTargetsForTests(): void { registry.clear(); }
export function __registeredCoachIds(): string[] { return [...registry.keys()]; }
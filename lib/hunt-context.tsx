/**
 * lib/hunt-context.tsx
 *
 * Module-level hunt session state for V1.
 * No React context overhead — module memory survives tab switches.
 * Future: add persistence, XP, badges, leaderboard hooks.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type HuntRating = 'legendary' | 'treasure' | 'risky' | 'trash';

export interface HuntItem {
  scanId:         string;
  itemName:       string;
  brand:          string;
  category:       string;
  imageUri:       string;
  estimatedValue: number;
  thriftPrice:    number;
  profit:         number;
  kept:           boolean;
  huntRating:     HuntRating;
  addedAt:        number;
}

export interface HuntSession {
  id:        string;
  name:      string;
  startedAt: number;
  isActive:  boolean;
  items:     HuntItem[];
}

// ─── Module-level state ───────────────────────────────────────────────────────

let _activeHunt: HuntSession | null = null;
const _listeners = new Set<() => void>();

function _notify() {
  _listeners.forEach(fn => fn());
}

// ─── Hunt rating helper ───────────────────────────────────────────────────────

export function computeHuntRating(profit: number, confidence: number): HuntRating {
  if (profit >= 30 && confidence >= 75) return 'legendary';
  if (profit >= 10)                      return 'treasure';
  if (profit >= 1)                       return 'risky';
  return 'trash';
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function startHunt(name?: string): HuntSession {
  _activeHunt = {
    id:        `hunt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name:      name?.trim() || 'Thrift Hunt',
    startedAt: Date.now(),
    isActive:  true,
    items:     [],
  };
  _notify();
  return _activeHunt;
}

export function getActiveHunt(): HuntSession | null {
  return _activeHunt;
}

export function isHuntActive(): boolean {
  return _activeHunt !== null && _activeHunt.isActive;
}

export function addItemToHunt(item: HuntItem): void {
  if (!_activeHunt) return;
  const idx = _activeHunt.items.findIndex(i => i.scanId === item.scanId);
  if (idx !== -1) {
    _activeHunt.items[idx] = item;
  } else {
    _activeHunt.items.unshift(item); // newest first
  }
  _notify();
}

export function toggleHuntItemKept(scanId: string): void {
  if (!_activeHunt) return;
  const item = _activeHunt.items.find(i => i.scanId === scanId);
  if (item) {
    item.kept = !item.kept;
    _notify();
  }
}

export function endHunt(): HuntSession | null {
  if (!_activeHunt) return null;
  const ended = { ..._activeHunt, isActive: false };
  _activeHunt  = null;
  _notify();
  return ended;
}

export function subscribeToHunt(fn: () => void): () => void {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

// ─── Derived helpers ──────────────────────────────────────────────────────────

export function getHuntStats(session: HuntSession) {
  const kept   = session.items.filter(i => i.kept);
  const profit = kept.reduce((s, i) => s + i.profit, 0);
  return {
    scanned:         session.items.length,
    kept:            kept.length,
    passed:          session.items.length - kept.length,
    estimatedProfit: Math.round(profit),
  };
}

// ─── Hunt Item Detail → Live Hunt return intent flag ──────────────────────────
// Used to prevent the "End Hunt?" modal from appearing when the user
// intentionally returns to Live Hunt after confirming Save or Remove on
// the Hunt Item Detail screen.
//
// mark  → called immediately before router.back() in handleSave / handleRemove
// consume → called once inside hunt-active's beforeRemove; reads AND resets
//           atomically so the flag can never accidentally stay true.

let _huntItemDetailReturnPending = false;

export function markReturningFromHuntItemDetail(): void {
  _huntItemDetailReturnPending = true;
}

export function consumeReturningFromHuntItemDetail(): boolean {
  const was = _huntItemDetailReturnPending;
  _huntItemDetailReturnPending = false; // reset immediately — single-use
  return was;
}
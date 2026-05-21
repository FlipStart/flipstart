/**
 * lib/hunt-context.tsx
 *
 * Module-level hunt session state.
 * No React context overhead — module memory survives tab switches.
 */

import type { ScanResult } from './types';

// ─── Types ────────────────────────────────────────────────────────────────────

export type HuntRating = 'legendary' | 'treasure' | 'risky' | 'trash';

export interface HuntItem {
  huntItemId:     string;       // stable unique ID — used for route params
  scanId:         string;       // matches ScanResult.id
  itemName:       string;
  brand:          string;
  category:       string;
  imageUri:       string;
  allImageUris:   string[];     // all photos for carousel
  estimatedValue: number;
  thriftPrice:    number;
  profit:         number;
  kept:           boolean;      // true = kept, false = removed/skipped
  huntRating:     HuntRating;
  addedAt:        number;
  scanSnapshot:   ScanResult;   // full scan data for read-only Discovery Analysis
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

/**
 * Map the AI recommendation label (from computeFlipCalc) to a HuntRating.
 * This ensures the rating shown on the item card in Live Hunt
 * matches the badge shown on Discovery Analysis.
 */
export function recLabelToHuntRating(recLabel: string | undefined): HuntRating {
  switch (recLabel) {
    case 'STRONG_BUY': return 'legendary';
    case 'BUY':        return 'treasure';
    case 'RISKY_BUY':  return 'risky';
    default:           return 'trash';   // SKIP and anything unknown
  }
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
  // Deduplicate by scanId — one scan can only produce one hunt item
  const idx = _activeHunt.items.findIndex(i => i.scanId === item.scanId);
  if (idx !== -1) {
    _activeHunt.items[idx] = item;   // update in place (e.g. kept→removed or price change)
  } else {
    _activeHunt.items.unshift(item); // newest first
  }
  _notify();
}

/** Look up a hunt item by its stable huntItemId across kept + removed. */
export function getHuntItemById(huntItemId: string): HuntItem | null {
  if (!_activeHunt) return null;
  return _activeHunt.items.find(i => i.huntItemId === huntItemId) ?? null;
}

/** Move a kept item to the removed list (swipe-delete in Live Hunt). */
export function moveHuntItemToRemoved(scanId: string): void {
  if (!_activeHunt) return;
  const item = _activeHunt.items.find(i => i.scanId === scanId);
  if (item) {
    item.kept = false;
    // Force new session reference so React re-renders subscribers
    _activeHunt = { ..._activeHunt, items: [..._activeHunt.items] };
    _notify();
  }
}

/** Move a removed/skipped item back to kept. */
export function restoreHuntItem(huntItemId: string): void {
  if (!_activeHunt) return;
  const item = _activeHunt.items.find(i => i.huntItemId === huntItemId);
  if (item) {
    item.kept = true;
    // Move to front of list so it appears as most recent kept item
    const reordered = [
      item,
      ..._activeHunt.items.filter(i => i.huntItemId !== huntItemId),
    ];
    // Force new session reference so React re-renders subscribers
    _activeHunt = { ..._activeHunt, items: reordered };
    _notify();
  }
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

let _huntItemDetailReturnPending = false;

export function markReturningFromHuntItemDetail(): void {
  _huntItemDetailReturnPending = true;
}

export function consumeReturningFromHuntItemDetail(): boolean {
  const was = _huntItemDetailReturnPending;
  _huntItemDetailReturnPending = false;
  return was;
}
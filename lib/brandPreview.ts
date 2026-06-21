/**
 * lib/brandPreview.ts
 *
 * FILE PATH: lib/brandPreview.ts
 *
 * Pass 2 — Mystery Preview system.
 *
 * Rules:
 *   - 1 preview per 24 hours (local calendar day).
 *   - Using it on a locked brand reveals its name/rarity/category for that day.
 *   - Does NOT discover or unlock the brand.
 *   - Expires automatically when the local date changes (no banking/stacking).
 *
 * Storage: @flipstart/mystery_preview_v1 → { dateKey, brandName }
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const PREVIEW_KEY = '@flipstart/mystery_preview_v1';

interface PreviewRecord {
  dateKey:   string;   // YYYY-MM-DD (local)
  brandName: string;   // canonical name that was revealed
}

/** Local calendar day key, e.g. "2026-06-14". */
export function todayKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function readRecord(): Promise<PreviewRecord | null> {
  try {
    const raw = await AsyncStorage.getItem(PREVIEW_KEY);
    return raw ? (JSON.parse(raw) as PreviewRecord) : null;
  } catch {
    return null;
  }
}

export interface PreviewState {
  /** True if today's preview has already been used. */
  usedToday:     boolean;
  /** The brand name revealed today, or null. */
  previewedBrand: string | null;
}

/**
 * Current preview state for today. If the stored record is from a previous
 * day, it's treated as expired (usedToday=false, previewedBrand=null).
 */
export async function getPreviewState(): Promise<PreviewState> {
  const rec = await readRecord();
  if (rec && rec.dateKey === todayKey()) {
    return { usedToday: true, previewedBrand: rec.brandName };
  }
  return { usedToday: false, previewedBrand: null };
}

/**
 * Consume today's preview on a brand. Returns true if it was available and
 * is now used; false if a preview was already used today.
 */
export async function consumePreview(brandName: string): Promise<boolean> {
  const state = await getPreviewState();
  if (state.usedToday) return false;
  try {
    const rec: PreviewRecord = { dateKey: todayKey(), brandName };
    await AsyncStorage.setItem(PREVIEW_KEY, JSON.stringify(rec));
    return true;
  } catch {
    return false;
  }
}

// ─── DEV ONLY helpers (for the brand dev testing screen) ─────────────────────

/**
 * DEV — force a preview on a brand regardless of today's cooldown.
 * Lets the dev tool preview multiple brands without waiting 24h.
 */
export async function devForcePreview(brandName: string): Promise<void> {
  try {
    const rec: PreviewRecord = { dateKey: todayKey(), brandName };
    await AsyncStorage.setItem(PREVIEW_KEY, JSON.stringify(rec));
  } catch {}
}

/**
 * DEV — reset the daily preview cooldown so a new preview can be used today.
 */
export async function devResetPreviewCooldown(): Promise<void> {
  try { await AsyncStorage.removeItem(PREVIEW_KEY); } catch {}
}

/** DEV — clear all preview state. */
export async function devClearAllPreviews(): Promise<void> {
  try { await AsyncStorage.removeItem(PREVIEW_KEY); } catch {}
}
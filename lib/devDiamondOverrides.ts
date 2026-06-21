/**
 * lib/devDiamondOverrides.ts
 *
 * FILE PATH: lib/devDiamondOverrides.ts
 *
 * DEV ONLY — manually force-unlocked Diamonds for testing.
 *
 * Real Diamonds are DERIVED from the saved flip history (computeUnlockedDiamonds).
 * There is no way to "force unlock" one without a real scan — so this module keeps
 * a small AsyncStorage-backed map of dev-forced UnlockedDiamond records that the
 * Progress tab and the Diamonds screen merge in *only* when __DEV__ is true.
 *
 * It has ZERO effect in production: nothing imports it outside of `if (__DEV__)`
 * guards, so it tree-shakes away from production bundles and can be deleted
 * wholesale when the feature ships.
 *
 * Also exposes helpers to clear the "seen" set (shared with diamonds.ts) so a
 * removed Diamond can re-trigger its NEW state next time it unlocks.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { UnlockedDiamond } from '@/lib/diamonds';

const DEV_KEY  = '@flipstart/dev_unlocked_diamonds_v1';
const SEEN_KEY = '@flipstart/seen_diamond_ids_v1'; // MUST match diamonds.ts

export type DevDiamondRecord = UnlockedDiamond;

// ─── Dev unlocked map ────────────────────────────────────────────────────────

export async function getDevDiamondRecords(): Promise<Record<string, DevDiamondRecord>> {
  try {
    const raw = await AsyncStorage.getItem(DEV_KEY);
    return raw ? (JSON.parse(raw) as Record<string, DevDiamondRecord>) : {};
  } catch {
    return {};
  }
}

export async function getDevDiamondIds(): Promise<string[]> {
  return Object.keys(await getDevDiamondRecords());
}

/** Force-unlock a Diamond with an optional fake source item (for the detail page). */
export async function addDevDiamond(
  id: string,
  record?: Partial<DevDiamondRecord>,
): Promise<void> {
  try {
    const map = await getDevDiamondRecords();
    map[id] = {
      id,
      discoveredAt:    record?.discoveredAt    ?? Date.now(),
      sourceScanId:    record?.sourceScanId    ?? null,
      isFromHunt:      record?.isFromHunt      ?? false,
      imageUri:        record?.imageUri        ?? null,
      estimatedProfit: record?.estimatedProfit ?? null,
    };
    await AsyncStorage.setItem(DEV_KEY, JSON.stringify(map));
  } catch {}
}

export async function removeDevDiamond(id: string): Promise<void> {
  try {
    const map = await getDevDiamondRecords();
    delete map[id];
    await AsyncStorage.setItem(DEV_KEY, JSON.stringify(map));
  } catch {}
}

export async function clearAllDevDiamonds(): Promise<void> {
  try {
    await AsyncStorage.removeItem(DEV_KEY);
  } catch {}
}

// ─── Seen-set helpers (shared with diamonds.ts) ──────────────────────────────

/** Remove one id from the persisted "seen" set, so it can re-notify as NEW. */
export async function removeFromDiamondSeen(id: string): Promise<void> {
  try {
    const raw  = await AsyncStorage.getItem(SEEN_KEY);
    const seen = new Set<string>(raw ? JSON.parse(raw) : []);
    seen.delete(id);
    await AsyncStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));
  } catch {}
}

/** Wipe the entire persisted "seen" set. */
export async function clearAllDiamondSeen(): Promise<void> {
  try {
    await AsyncStorage.removeItem(SEEN_KEY);
  } catch {}
}
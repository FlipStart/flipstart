/**
 * lib/devBrandOverrides.ts
 *
 * FILE PATH: lib/devBrandOverrides.ts
 *
 * DEV ONLY — manually force-discovered brands for testing the Brand Compendium.
 * Merged with real discoveries (from flips + hunt profile) in the compendium
 * screens, but ONLY in __DEV__ builds. No effect in production.
 *
 * Also stores discovery metadata (date + source) so future profile/showcase
 * features have a clean data shape to read from.
 *
 * Storage keys (all dev/local only):
 *   @flipstart/dev_unlocked_brands  → string[] of canonical brand names
 *   @flipstart/brand_discovery_meta → Record<brandName, BrandDiscoveryMeta>
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const DEV_BRANDS_KEY = '@flipstart/dev_unlocked_brands';
const META_KEY       = '@flipstart/brand_discovery_meta';

// ─── Discovery metadata (future profile/showcase architecture) ───────────────

export type DiscoverySource = 'normal_scan' | 'hunt_mode' | 'dev_tool';

export interface BrandDiscoveryMeta {
  brandName:        string;
  rarity:           string;
  category:         string;
  dateDiscovered:   number;          // epoch ms
  discoverySource:  DiscoverySource;
  // Optional extension fields — populated when available, safe to omit:
  scanId?:          string;
  huntId?:          string;
  itemName?:        string;
  estimatedProfit?: number;
  roi?:             number;
}

// ─── Dev unlocked brand set ──────────────────────────────────────────────────

export async function getDevUnlockedBrands(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(DEV_BRANDS_KEY);
    return new Set<string>(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set<string>();
  }
}

export async function addDevUnlockedBrand(name: string): Promise<void> {
  try {
    const set = await getDevUnlockedBrands();
    set.add(name);
    await AsyncStorage.setItem(DEV_BRANDS_KEY, JSON.stringify([...set]));
  } catch {}
}

export async function removeDevUnlockedBrand(name: string): Promise<void> {
  try {
    const set = await getDevUnlockedBrands();
    set.delete(name);
    await AsyncStorage.setItem(DEV_BRANDS_KEY, JSON.stringify([...set]));
  } catch {}
}

export async function clearAllDevUnlockedBrands(): Promise<void> {
  try { await AsyncStorage.removeItem(DEV_BRANDS_KEY); } catch {}
}

// ─── Discovery metadata store ────────────────────────────────────────────────

export async function getAllDiscoveryMeta(): Promise<Record<string, BrandDiscoveryMeta>> {
  try {
    const raw = await AsyncStorage.getItem(META_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export async function setDiscoveryMeta(meta: BrandDiscoveryMeta): Promise<void> {
  try {
    const all = await getAllDiscoveryMeta();
    all[meta.brandName] = meta;
    await AsyncStorage.setItem(META_KEY, JSON.stringify(all));
  } catch {}
}

export async function removeDiscoveryMeta(brandName: string): Promise<void> {
  try {
    const all = await getAllDiscoveryMeta();
    delete all[brandName];
    await AsyncStorage.setItem(META_KEY, JSON.stringify(all));
  } catch {}
}

export async function clearAllDiscoveryMeta(): Promise<void> {
  try { await AsyncStorage.removeItem(META_KEY); } catch {}
}
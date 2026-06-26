/**
 * lib/version-check.ts
 *
 * Lightweight, fail-safe app update checker.
 *  - Reads the running app version from expo-constants.
 *  - Fetches a remote config row from Supabase (table: app_version_config).
 *  - Compares versions semantically (NOT string compare).
 *
 * SAFETY: every failure mode returns "do not block" — a bad/missing config,
 * network error, or parse failure must NEVER trap the user. Blocking only
 * happens on an explicit, successfully-fetched signal.
 *
 * Uses the lazy Supabase import pattern (await import) to avoid pulling the
 * client into the startup path.
 */

import Constants from 'expo-constants';

export interface VersionConfig {
  platform: string;
  minimum_supported_version: string | null;
  latest_version: string | null;
  update_required: boolean;
  update_recommended: boolean;
  app_store_url: string | null;
  title: string | null;
  message: string | null;
}

export type UpdateDecision =
  | { kind: 'none' }
  | { kind: 'soft'; title: string; message: string; storeUrl: string | null }
  | { kind: 'hard'; title: string; message: string; storeUrl: string | null };

/** Current running app version, e.g. "1.2.0". Empty string if unknown. */
export function getCurrentAppVersion(): string {
  try {
    return (Constants.expoConfig?.version as string | undefined) ?? '';
  } catch {
    return '';
  }
}

/**
 * Compare two semantic version strings.
 * Returns -1 if a < b, 0 if equal, 1 if a > b.
 * Returns null if either is unparseable (caller treats null as "can't compare").
 */
export function compareVersions(a: string, b: string): number | null {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

function parseVersion(v: string): [number, number, number] | null {
  if (typeof v !== 'string') return null;
  // Strip any build metadata / pre-release suffix (e.g. "1.2.0-beta.1" → "1.2.0")
  const core = v.trim().split(/[-+]/)[0];
  const parts = core.split('.');
  if (parts.length === 0 || parts.length > 3) return null;
  const nums: number[] = [];
  for (let i = 0; i < 3; i++) {
    const raw = parts[i] ?? '0';
    if (!/^\d+$/.test(raw)) return null;
    nums.push(parseInt(raw, 10));
  }
  return [nums[0], nums[1], nums[2]];
}

/**
 * Fetch the remote version config for iOS. Returns null on any failure.
 */
export async function fetchVersionConfig(): Promise<VersionConfig | null> {
  try {
    const { supabase } = await import('@/lib/supabase');
    if (!supabase) return null;

    const { data, error } = await supabase
      .from('app_version_config')
      .select('platform, minimum_supported_version, latest_version, update_required, update_recommended, app_store_url, title, message')
      .eq('platform', 'ios')
      .maybeSingle();

    if (error || !data) return null;
    return data as VersionConfig;
  } catch {
    return null;
  }
}

/**
 * Decide what (if anything) to show the user. Pure + fail-safe:
 *   - hard block if current < minimum_supported_version, OR update_required.
 *   - soft prompt if current < latest_version, OR update_recommended.
 *   - otherwise none.
 * Any inability to compare → treated as "none" (never block).
 */
export function decideUpdate(current: string, cfg: VersionConfig | null): UpdateDecision {
  if (!cfg) return { kind: 'none' };
  if (!current) return { kind: 'none' };

  const storeUrl = cfg.app_store_url ?? null;
  const title    = cfg.title ?? 'Update FlipStart';
  const message  = cfg.message ?? 'A new version of FlipStart is available.';

  // ── Hard block ──
  let mustUpdate = false;
  if (cfg.minimum_supported_version) {
    const cmp = compareVersions(current, cfg.minimum_supported_version);
    if (cmp === -1) mustUpdate = true; // current is below the minimum
  }
  if (cfg.update_required === true) mustUpdate = true;

  // Safety: never hard-block if there's no store URL to send them to — a block
  // with no escape route would trap the user. Downgrade to soft instead.
  if (mustUpdate && storeUrl) {
    return { kind: 'hard', title, message, storeUrl };
  }
  if (mustUpdate && !storeUrl) {
    return { kind: 'soft', title, message, storeUrl: null };
  }

  // ── Soft recommend ──
  let recommend = false;
  if (cfg.latest_version) {
    const cmp = compareVersions(current, cfg.latest_version);
    if (cmp === -1) recommend = true; // current is below the latest
  }
  if (cfg.update_recommended === true) recommend = true;

  if (recommend) {
    return { kind: 'soft', title, message, storeUrl };
  }

  return { kind: 'none' };
}
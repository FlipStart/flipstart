/**
 * lib/forceUpdate.ts
 *
 * Reads the force-update gate and decides whether this build may run.
 *
 * ── Fails open, everywhere ──────────────────────────────────────────────────
 * Every failure path returns "allowed": no network, Supabase unconfigured, the
 * row missing, RLS refusing, `enabled` false, a version string this build
 * cannot parse. The asymmetry is deliberate. A gate that wrongly lets an old
 * build run costs one stale user; a gate that wrongly blocks costs the entire
 * install base and the fix ships through App Review. Only a row that is
 * present, enabled, and holds a genuinely higher version blocks anyone.
 *
 * ── Read straight from Supabase, not through our API ────────────────────────
 * Deliberately not a tRPC call. The gate must work for a signed-out user, and
 * it must work when the Railway backend is the thing that is down — which is
 * one of the situations where you most want to push people onto a new build.
 * The row is world-readable by design (see drizzle/sql/app_min_version.sql).
 */
import { Platform } from "react-native";
import Constants from "expo-constants";
import { supabase } from "@/lib/supabase";
import { isBelowMinimum } from "@/lib/appVersion";

export interface UpdateGate {
  /** True only when we are confident this build is too old. */
  required: boolean;
  /** Where to send the user. Null means show instructions without a button. */
  storeUrl: string | null;
  /** Server-supplied copy, or null to use the built-in wording. */
  message: string | null;
  /** The minimum we read, for logging. Null when we could not read one. */
  minVersion: string | null;
}

const ALLOW: UpdateGate = { required: false, storeUrl: null, message: null, minVersion: null };

/** The version from app.config.ts, as built into this binary. */
export function installedVersion(): string | null {
  return Constants.expoConfig?.version ?? null;
}

function platformKey(): "ios" | "android" | null {
  if (Platform.OS === "ios") return "ios";
  if (Platform.OS === "android") return "android";
  return null;                       // web and anything else: never gated
}

/**
 * Ask whether this build must be updated.
 *
 * Never throws and never rejects — callers can await it without a try/catch
 * and treat the result as final.
 */
export async function checkForceUpdate(): Promise<UpdateGate> {
  try {
    const platform = platformKey();
    if (!platform) return ALLOW;

    const installed = installedVersion();
    if (!installed) return ALLOW;    // no version to compare: let them in

    if (!supabase) return ALLOW;

    const { data, error } = await supabase
      .from("app_min_version")
      .select("min_version, store_url, message, enabled")
      .eq("platform", platform)
      .maybeSingle();

    // An error here is a network or policy problem, not a verdict.
    if (error || !data) return ALLOW;
    if (data.enabled !== true) return ALLOW;

    // isBelowMinimum is itself fail-open on anything it cannot parse.
    if (!isBelowMinimum(installed, data.min_version)) return ALLOW;

    return {
      required: true,
      storeUrl: typeof data.store_url === "string" && data.store_url.trim() ? data.store_url.trim() : null,
      message: typeof data.message === "string" && data.message.trim() ? data.message.trim() : null,
      minVersion: typeof data.min_version === "string" ? data.min_version : null,
    };
  } catch {
    // Including the case where the table does not exist yet.
    return ALLOW;
  }
}
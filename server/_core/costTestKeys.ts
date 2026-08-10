/**
 * server/_core/costTestKeys.ts
 *
 * TEMPORARY founder-only OpenAI key selector for controlled cost measurement.
 *
 * ── DELETE THIS FILE WHEN MEASUREMENT IS DONE ────────────────────────────────
 * Removal instructions are at the bottom. Nothing else depends on it once the
 * three-line hook in llm.ts is reverted.
 *
 * ── What it does ─────────────────────────────────────────────────────────────
 * Routes a request to one of five dedicated OpenAI keys so spend for each
 * action type lands in its own bucket, without swapping the production key and
 * redeploying between batches.
 *
 * ── What it deliberately does NOT do ────────────────────────────────────────
 * No prompt change, no model change, no token limits, no image changes, no
 * retry or timeout changes, no extra request. The ONLY variable is which key
 * receives the charge — otherwise the measurement measures the instrumentation.
 *
 * ── Contamination is the whole design problem ───────────────────────────────
 * A bucket is only meaningful if nothing else charges it. So the match must be
 * EXACT on every dimension, and a mismatch falls back to production rather than
 * guessing. A wrongly-charged key silently corrupts a number you cannot
 * un-corrupt without re-running the batch.
 */
import { ENV } from "./env";

export type CostTestBucket =
  | "1photo" | "2photo" | "3photo" | "listings" | "3photo_context";

const VALID_BUCKETS: readonly CostTestBucket[] =
  ["1photo", "2photo", "3photo", "listings", "3photo_context"] as const;

/** The kind of OpenAI work being performed. Supplied by the call site. */
export type CostTestAction = "scan" | "listings" | "other";

export interface KeyContext {
  action: CostTestAction;
  /** Photos actually sent. Undefined for non-scan actions. */
  photoCount?: number;
  /** True only for real, confirmed, non-empty user context. */
  hasUserContext?: boolean;
}

export interface ResolvedKey {
  key: string;
  /** Safe for logs. NEVER contains any part of the key. */
  keyLabel: string;
  /** True when a test key was used rather than production. */
  isTestKey: boolean;
}

const ENV_FOR_BUCKET: Record<CostTestBucket, string> = {
  "1photo":         "OPENAI_TEST_KEY_1PHOTO",
  "2photo":         "OPENAI_TEST_KEY_2PHOTO",
  "3photo":         "OPENAI_TEST_KEY_3PHOTO",
  "listings":       "OPENAI_TEST_KEY_LISTINGS",
  "3photo_context": "OPENAI_TEST_KEY_3PHOTO_CONTEXT",
};

export function costTestModeOn(): boolean {
  return (process.env.OPENAI_COST_TEST_MODE ?? "").trim() === "true";
}

/** Returns null for an unset OR invalid bucket — an invalid value must never
 *  fall through to some other bucket's key. */
export function selectedBucket(): CostTestBucket | null {
  const raw = (process.env.OPENAI_COST_TEST_BUCKET ?? "").trim() as CostTestBucket;
  return VALID_BUCKETS.includes(raw) ? raw : null;
}

/**
 * Does this request exactly match the selected bucket?
 *
 * Every condition is positive and explicit. There is no "close enough" branch,
 * because a near-match is exactly how a bucket gets contaminated.
 *
 * Note the 3photo / 3photo_context split: both require three photos, and they
 * are separated ONLY by whether real user context is present. A 3-photo scan
 * with context must never charge the plain 3photo key, or the very comparison
 * this experiment exists to make becomes meaningless.
 */
function matchesBucket(bucket: CostTestBucket, ctx: KeyContext): boolean {
  const photos = ctx.photoCount ?? 0;
  const hasCtx = ctx.hasUserContext === true;
  switch (bucket) {
    case "1photo":         return ctx.action === "scan" && photos === 1;
    case "2photo":         return ctx.action === "scan" && photos === 2;
    case "3photo":         return ctx.action === "scan" && photos === 3 && !hasCtx;
    case "3photo_context": return ctx.action === "scan" && photos === 3 && hasCtx;
    case "listings":       return ctx.action === "listings";
    default:               return false;
  }
}

/**
 * The single place a key is chosen.
 *
 * Falls back to production on ANY doubt — mode off, invalid bucket, action
 * mismatch, or a missing test key. Falling back is safe: it charges the
 * production key, which is a known quantity. Guessing at a test key would
 * silently poison a measurement, which is not recoverable.
 */
export function resolveOpenAIKey(ctx: KeyContext): ResolvedKey {
  const production: ResolvedKey = {
    key: ENV.openaiApiKey,
    keyLabel: "production",
    isTestKey: false,
  };

  if (!costTestModeOn()) return production;

  const bucket = selectedBucket();
  if (!bucket) {
    // Loud, because a typo'd bucket means the whole batch is silently landing
    // on the production key and the founder would otherwise not know.
    console.warn(
      `[COST_TEST] invalid or missing OPENAI_COST_TEST_BUCKET ` +
      `("${(process.env.OPENAI_COST_TEST_BUCKET ?? "").trim()}") — using production`,
    );
    return production;
  }

  if (!matchesBucket(bucket, ctx)) {
    console.log(
      `[COST_TEST] selectedBucket=${bucket} actualAction=${ctx.action} ` +
      `photos=${ctx.photoCount ?? "-"} userContext=${ctx.hasUserContext === true} using=production`,
    );
    return production;
  }

  const envName = ENV_FOR_BUCKET[bucket];
  const testKey = (process.env[envName] ?? "").trim();
  if (!testKey) {
    console.warn(
      `[COST_TEST] bucket=${bucket} matched but ${envName} is not set — using production. ` +
      `This batch will NOT be measured.`,
    );
    return production;
  }

  console.log(
    `[COST_TEST] bucket=${bucket} action=${ctx.action} ` +
    `photos=${ctx.photoCount ?? "-"} userContext=${ctx.hasUserContext === true} ` +
    `keyLabel=test-${bucket}`,
  );
  return { key: testKey, keyLabel: `test-${bucket}`, isTestKey: true };
}

/**
 * ── HOW TO REMOVE THIS ENTIRELY ──────────────────────────────────────────────
 * 1. In llm.ts: delete the `costTest` param from InvokeParams, the import of
 *    this file, and restore the authorization header to
 *      `Bearer ${ENV.forgeApiUrl ? ENV.forgeApiKey : ENV.openaiApiKey}`
 * 2. In scanV1.ts and scan.ts: delete the `costTest: { ... }` properties.
 * 3. Delete this file.
 * 4. Remove the OPENAI_COST_TEST_* and OPENAI_TEST_KEY_* Railway variables.
 * Nothing else references it.
 */
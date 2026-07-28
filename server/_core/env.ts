/**
 * Resolve a model env var to a usable model name.
 *
 * Falls back through: the specific variable -> the legacy OPENAI_MODEL
 * (kept so an already-deployed OPENAI_MODEL does not silently stop taking
 * effect) -> gpt-4o. Blank or whitespace-only values are treated as unset.
 */
function modelOr(value: string | undefined, fallback = "gpt-4o"): string {
  const specific = (value ?? "").trim();
  if (specific) return specific;
  const legacy = (process.env.OPENAI_MODEL ?? "").trim();
  if (legacy) return legacy;
  return fallback;
}

export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  // ── Model selection ───────────────────────────────────────────────────────
  // Env-driven so a migration or rollback is a Railway variable edit, not a
  // redeploy. Both default to gpt-4o = current production behaviour.
  //
  // Scan and listing are SEPARATE variables on purpose: the scan call is a
  // vision call with three images, the listing call is text-only. They have
  // different cost profiles and different quality requirements, so moving one
  // must not silently move the other.
  //
  // `?? "gpt-4o"` alone would not catch a variable that exists but is blank
  // (Railway lets you save an empty value), and an empty model string is a
  // hard 400 from the API. modelOr() treats blank and whitespace as unset.
  openaiScanModel:    modelOr(process.env.OPENAI_SCAN_MODEL),
  openaiListingModel: modelOr(process.env.OPENAI_LISTING_MODEL),

  // ── CanonicalAnalysisV1 rollout ──────────────────────────────────────────
  // Off by default. The legacy scan path stays intact and is the immediate
  // rollback: unset this variable and the old route resumes on restart.
  canonicalV1Enabled: (process.env.CANONICAL_ANALYSIS_V1_ENABLED ?? "").trim() === "true",

  // Comma-separated user ids allowed onto V1 while the flag is off. Lets the
  // founder account test in production without exposing anyone else.
  canonicalV1AllowedUserIds: (process.env.CANONICAL_ANALYSIS_V1_USER_IDS ?? "")
    .split(",").map(s => s.trim()).filter(Boolean),
};

/** V1 is on for everyone, or this specific user is on the allow-list. */
export function canonicalV1EnabledFor(userId: string | undefined | null): boolean {
  if (ENV.canonicalV1Enabled) return true;
  if (!userId) return false;
  return ENV.canonicalV1AllowedUserIds.includes(userId);
}
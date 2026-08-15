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

  // ── Monetization V1 rollout ───────────────────────────────────────────────
  //
  // OFF by default, and it must stay off until purchases exist. Turning it on
  // today would strand every user at 15 lifetime scans with no way to buy more
  // — the beta 7/day quota is wrong, but it is not "wall with no door" wrong.
  //
  // OFF:  the beta JSON quota decides access, exactly as now. The Supabase
  //       ledger is written by nothing and enforces nothing.
  // ON:   an authenticated Supabase user is required, the ledger is
  //       authoritative, and the beta counter stops deciding anything.
  monetizationV1Enabled: (process.env.MONETIZATION_V1_ENABLED ?? "").trim() === "true",

  // Per-account V1 testing while the flag is off, so the ledger can be
  // exercised in production without exposing anyone else to it. Same pattern as
  // the canonical V1 rollout.
  monetizationV1UserIds: (process.env.MONETIZATION_V1_USER_IDS ?? "")
    .split(",").map(s => s.trim()).filter(Boolean),

  // ── Pro camera context ────────────────────────────────────────────────────
  //
  // Deliberately its OWN flag, separate from canonicalV1Enabled.
  //
  // Both features previously read canonicalV1Enabled, which meant opening the
  // AI to everyone also handed every free user the Pro camera text box. There
  // was no way to launch one without the other.
  //
  // Left OFF for launch: the box stays on the allow-list until entitlements
  // exist. When they do, PRO_CONTEXT_ENABLED becomes the kill switch and the
  // real check happens per-user in userContextServer.ts.
  proContextEnabled: (process.env.PRO_CONTEXT_ENABLED ?? "").trim() === "true",

  proContextAllowedUserIds: (process.env.PRO_CONTEXT_USER_IDS ?? "")
    .split(",").map(s => s.trim()).filter(Boolean),
};

/** V1 is on for everyone, or this specific user is on the allow-list. */
export function canonicalV1EnabledFor(userId: string | undefined | null): boolean {
  if (ENV.canonicalV1Enabled) return true;
  if (!userId) return false;
  return ENV.canonicalV1AllowedUserIds.includes(userId);
}

/**
 * Is this user entitled to the Pro camera context box?
 *
 * Falls back to PRO_CONTEXT_USER_IDS, then to the V1 allow-list, so the founder
 * account keeps access without a second variable to maintain. Never opens to
 * everyone just because the AI did.
 *
 * When subscriptions land, the plan lookup goes in the marked block below and
 * nothing else changes — every call site already routes through here.
 */
export function proContextEnabledFor(userId: string | undefined | null): boolean {
  if (ENV.proContextEnabled) return true;
  if (!userId) return false;
  if (ENV.proContextAllowedUserIds.includes(userId)) return true;
  // ── SUBSCRIPTION HOOK ────────────────────────────────────────────────────
  // Replace with the real entitlement lookup when monetization exists:
  //   if (await isProSubscriber(userId)) return true;
  // Kept synchronous for now so no call site needs to become async today.
  return ENV.canonicalV1AllowedUserIds.includes(userId);
}
/**
 * Is Monetization V1 authoritative for this user?
 *
 * Mirrors canonicalV1EnabledFor. The allow-list exists so the ledger can be
 * tested against a real account in production while everyone else stays on the
 * beta path — and, critically, a normal client cannot put itself on that list.
 */
export function monetizationV1EnabledFor(userId: string | undefined | null): boolean {
  if (ENV.monetizationV1Enabled) return true;
  if (!userId) return false;
  return ENV.monetizationV1UserIds.includes(userId);
}
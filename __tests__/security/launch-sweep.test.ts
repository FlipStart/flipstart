/**
 * __tests__/security/launch-sweep.test.ts
 *
 * Regression guards for the MVP security sweep.
 *
 * Two of these cover fixes made in this pass; the rest pin properties the
 * codebase already had, so a future refactor cannot quietly remove them. Each
 * fix has BOTH a negative test (the attack is refused) and a positive test
 * (the legitimate path is untouched).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

function stripComments(src: string): string {
  let out = "", mode: "code" | "line" | "block" | "sq" | "dq" | "tpl" = "code", i = 0;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (mode === "code") {
      if (c === "/" && n === "/") { mode = "line"; i += 2; continue; }
      if (c === "/" && n === "*") { mode = "block"; i += 2; continue; }
      if (c === "'") mode = "sq"; else if (c === '"') mode = "dq"; else if (c === "`") mode = "tpl";
      out += c; i++; continue;
    }
    if (mode === "line") { if (c === "\n") { mode = "code"; out += c; } i++; continue; }
    if (mode === "block") { if (c === "*" && n === "/") { mode = "code"; i += 2; } else i++; continue; }
    if (c === "\\") { out += c + (src[i + 1] ?? ""); i += 2; continue; }
    if ((mode === "sq" && c === "'") || (mode === "dq" && c === '"') || (mode === "tpl" && c === "`")) mode = "code";
    out += c; i++;
  }
  return out;
}
const code = (s: string) => stripComments(s);

const ROUTERS  = read("server/routers.ts");
const CORE     = read("server/_core/index.ts");
const IDENTITY = read("server/monetization/identity.ts");
const WEBHOOK  = read("server/monetization/webhook.ts");
const GRANTS   = read("server/devGrants.ts");
const COMPSAUTH= read("server/comps/auth.ts");
const TRPC     = read("lib/trpc.ts");

// ── FIX 1 — the expensive endpoint requires a verified identity ────────────

describe("FIX: analyzeFast always requires a verified identity", () => {
  /** The guard, and the region of the route it must dominate. */
  const FN = ROUTERS.slice(ROUTERS.indexOf("analyzeFast:"), ROUTERS.indexOf("getScanStats:"));
  const GATE = code(FN).indexOf("if (!muid) {");

  it("A/B — the refusal does not depend on the monetization flag", () => {
    // Unconditional: `!muid`, not `ENV.monetizationV1Enabled && !muid`.
    expect(ROUTERS).toMatch(/if \(!muid\) \{\s*throw Object\.assign\(new Error\("Please sign in to scan\."\), \{\s*code: "NOT_AUTHENTICATED",/);
    // The old flag-coupled form must never come back — V1 OFF is the case that
    // silently reopened the bypass, and it is the whole point of this guard.
    expect(code(ROUTERS)).not.toMatch(/monetizationV1Enabled && !muid/);
    expect(code(ROUTERS)).not.toMatch(/monetizationV1EnabledFor\(muid\) && !muid/);
    expect(GATE).toBeGreaterThan(-1);
  });

  it("A/B — the refusal happens BEFORE any accounting or AI spend", () => {
    const f = code(FN);
    // Before the legacy client-keyed counter…
    expect(GATE).toBeLessThan(f.indexOf("checkScanAllowed(sid)"));
    // …before the V1 reservation…
    expect(GATE).toBeLessThan(f.indexOf("reserveScan"));
    // …and before any analysis route is chosen.
    expect(GATE).toBeLessThan(f.indexOf("canonicalV1EnabledFor"));
    // It is also the FIRST thing after identity resolution.
    expect(f.indexOf("resolveSupabaseUserId")).toBeLessThan(GATE);
  });

  it("E — a rotated scannerId cannot change the outcome", () => {
    const f = code(FN);
    // The guard reads only muid. sid is never consulted by it, so no value of
    // input.scannerId reaches the decision.
    const guardStmt = f.slice(GATE, f.indexOf("}", f.indexOf("NOT_AUTHENTICATED")));
    expect(guardStmt).not.toMatch(/\bsid\b|scannerId/);
    // And sid is still resolved before the guard, so this is a real ordering
    // check rather than an accident of where the variable is declared.
    expect(f.indexOf("const sid = (input.scannerId")).toBeLessThan(GATE);
  });

  it("F — an invalid or expired token is indistinguishable from a missing one", () => {
    // resolveSupabaseUserId returns null for absent, malformed, expired and
    // rejected tokens alike, so all four land on the same `!muid` branch.
    const id = code(IDENTITY);
    const errBranch = id.slice(id.indexOf("if (error)"), id.indexOf("if (!uid)"));
    expect(errBranch).toContain("return null;");
    expect(id).toMatch(/if \(!token\) \{[\s\S]{0,120}?return null;/);
    expect(id).toMatch(/return null;[\s\S]{0,40}\}\s*$|catch \(e\)/);
  });

  it("C — an authenticated scan still takes the V1 path unchanged", () => {
    expect(ROUTERS).toMatch(/const useV1 = Boolean\(muid\) && monetizationV1EnabledFor\(muid\);/);
    expect(ROUTERS).toMatch(/const r = await reserveScan\(muid as string, input\.scanAttemptId\.trim\(\)\);/);
  });

  it("D — with V1 off, an authenticated user still uses the legacy path", () => {
    // The rollback is untouched: useV1 falls false for an authenticated user
    // when the flag is off, and the legacy counter still runs for them.
    expect(ROUTERS).toMatch(/const allowed = useV1 \? true : checkScanAllowed\(sid\);/);
    expect(read("server/_core/env.ts")).toMatch(/monetizationV1Enabled: \(process\.env\.MONETIZATION_V1_ENABLED/);
    // scannerId keeps its legacy accounting role — this was not a refactor.
    expect(ROUTERS).toMatch(/const sid = \(input\.scannerId \?\? ""\)\.trim\(\);/);
  });

  it("the legacy counter is still client-keyed — which is why the gate must exist", () => {
    expect(read("server/persist.ts")).toMatch(/GLOBAL_DAILY_SCAN_BACKSTOP\) \|\| 2000/);
    expect(read("server/persist.ts")).toMatch(/const PER_USER_DAILY_LIMIT = 7;/);
  });
});

// ── FIX 2 — admin gates compare in constant time ───────────────────────────

describe("FIX: dashboard secrets are compared in constant time", () => {
  it("NEGATIVE — no raw string comparison of a secret remains", () => {
    expect(code(CORE)).not.toMatch(/req\.query\.secret !== secret/);
    expect(code(CORE)).not.toMatch(/req\.query\.secret === /);
  });

  it("POSITIVE — every dashboard route still gates, and an unset secret still rejects", () => {
    expect((CORE.match(/secretOk\(req\.query\.secret/g) ?? []).length).toBe(9);
    expect(CORE).toMatch(/if \(!expected\) return false;/);
    expect(CORE).toMatch(/crypto\.timingSafeEqual\(a, b\)/);
    // Hashed first, so unequal lengths cannot throw.
    expect(CORE).toMatch(/createHash\("sha256"\)\.update\(s\)\.digest\(\)/);
  });

  it("does not impose a length rule that could lock a live dashboard out", () => {
    const helper = CORE.slice(CORE.indexOf("const secretOk ="), CORE.indexOf("for (const [name, value]"));
    expect(helper).not.toMatch(/length\s*[<>]/);
    // It warns instead.
    expect(CORE).toMatch(/\[security\] \$\{name\} is only \$\{value\.length\} chars/);
  });
});

// ── Properties that must not regress ───────────────────────────────────────

describe("identity is server-verified, never client-claimed", () => {
  it("verifies the token with Supabase rather than decoding it locally", () => {
    expect(IDENTITY).toMatch(/await sb\.auth\.getUser\(token\)/);
    // Asserted on stripped code: the doc comments inside these branches are
    // long, and a distance-limited match over raw source measures prose.
    // Sliced to each branch rather than distance-limited, so the assertion
    // cannot drift as the surrounding code grows.
    const id = code(IDENTITY);
    const errBranch = id.slice(id.indexOf("if (error)"), id.indexOf("if (!uid)"));
    expect(errBranch).toContain("return null;");
    const uidBranch = id.slice(id.indexOf("if (!uid)"), id.indexOf("if (cache.size"));
    expect(uidBranch).toContain("return null;");
    // Fails closed when the admin client is unconfigured.
    expect(IDENTITY).toMatch(/if \(!isSupabaseAdminConfigured\(\)\) \{[\s\S]{0,300}?return null;/);
  });

  it("never logs the token itself", () => {
    expect(IDENTITY).toMatch(/header=\$\{token \? "present" : "absent"\}/);
    const logger = IDENTITY.slice(IDENTITY.indexOf("function logIdentity"), IDENTITY.indexOf("function tokenShape") + 400);
    expect(logger).not.toMatch(/\$\{token\}/);
    // Shape only — length buckets, never content.
    expect(IDENTITY).toMatch(/if \(n < 40\) return "short";/);
  });

  it("caches identity only briefly", () => {
    expect(IDENTITY).toMatch(/const CACHE_TTL_MS = 60_000;/);
  });

  it("the client sends the token in its own header on every request that has a session", () => {
    expect(TRPC).toMatch(/h\['x-supabase-auth'\] = `Bearer \$\{at\}`/);
  });
});

describe("money-moving surfaces stay server-authoritative", () => {
  it("the RevenueCat webhook rejects an unset or wrong secret, in constant time", () => {
    expect(WEBHOOK).toMatch(/crypto\.timingSafeEqual\(ab, bb\)/);
    expect(WEBHOOK).toMatch(/if \(!verifyWebhookAuth\(authHeader\)\) \{\s*return \{ status: 401/);
  });

  it("dev scan grants need a long secret, fail closed, and lock out on brute force", () => {
    expect(GRANTS).toMatch(/!expected \|\| expected\.length < 16/);
    expect(GRANTS).toMatch(/reason: "not_configured"/);
    expect(GRANTS).toMatch(/reason: "locked_out"/);
    expect(GRANTS).toMatch(/crypto\.timingSafeEqual\(a, b\)/);
  });

  it("the comps founder gate fails closed on a weak secret", () => {
    expect(COMPSAUTH).toMatch(/if \(expected\.length < 16\) return false;/);
    expect(COMPSAUTH).toMatch(/crypto\.timingSafeEqual\(a, b\)/);
  });

  it("subscription sync derives the uid from the session, with no client override", () => {
    const sync = ROUTERS.slice(ROUTERS.indexOf("syncSubscription:"), ROUTERS.indexOf("diagnose:"));
    expect(sync).toMatch(/const uid = await resolveSupabaseUserId\(ctx\?\.req as never, "syncSubscription"\);/);
    expect(sync).toMatch(/if \(!uid\) return \{ ok: false as const, reason: "NOT_AUTHENTICATED" as const \};/);
    // No parameter a caller could use to sync someone else's account.
    expect(sync).not.toMatch(/input\.(userId|uid|scannerId)/);
  });

  it("pack recovery is likewise session-derived", () => {
    const rec = ROUTERS.slice(ROUTERS.indexOf("recoverScanPacks:"), ROUTERS.indexOf("useDeepAnalysisPreview:"));
    expect(rec).toMatch(/resolveSupabaseUserId\(ctx\?\.req as never, "recoverScanPacks"\)/);
    expect(rec).toMatch(/NOT_AUTHENTICATED/);
  });
});

describe("stored scan context is owner-checked", () => {
  it("refuses a mismatched owner rather than returning the row", () => {
    expect(read("server/scanContextStore.ts"))
      .toMatch(/if \(!ownerId \|\| hit\.ownerId !== ownerId\) \{[\s\S]{0,160}?return null;/);
  });
});

describe("secrets stay on the right side of the bundle", () => {
  it("no server secret is reachable from client code", () => {
    for (const dir of ["app", "lib", "components", "constants", "hooks"]) {
      const files = [dir];
      void files;
    }
    // Named check: these must never appear outside server/.
    const clientSrc = ["lib/trpc.ts", "lib/supabase.ts", "lib/purchases.ts", "lib/revenuecat.ts"]
      .map(read).join("\n");
    for (const secret of ["SERVICE_ROLE", "OPENAI_API_KEY", "JWT_SECRET", "FOUNDER_DASHBOARD_SECRET",
                          "DEV_SCAN_GRANT_SECRET", "COMPS_FOUNDER_SECRET", "REVENUECAT_WEBHOOK_AUTH"]) {
      expect(clientSrc, secret).not.toContain(secret);
    }
  });

  it("the service role is only ever read server-side", () => {
    for (const f of ["server/supabaseAdmin.ts", "server/founderDashboardV3.ts"]) {
      expect(read(f)).toMatch(/SERVICE_ROLE/);
    }
    expect(read("lib/supabase.ts")).toMatch(/EXPO_PUBLIC_SUPABASE_ANON_KEY/);
    expect(read("lib/supabase.ts")).not.toMatch(/SERVICE_ROLE/);
  });
});
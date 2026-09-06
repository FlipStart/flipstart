/**
 * __tests__/security/production-cleanup.test.ts
 *
 * Production must not expose developer surfaces — and development must keep
 * them. Both directions are tested, because a cleanup that quietly removes
 * Dylan's tooling is its own kind of regression.
 *
 * The distinction these tests encode: in Expo Router the route exists because
 * the FILE exists. `{__DEV__ && <Stack.Screen …>}` omits the screen's options
 * and leaves the route navigable; `<Stack.Protected guard={__DEV__}>` refuses
 * navigation. The first looks like a gate and is not one.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { MONETIZATION_HARNESS_VISIBLE } from "@/lib/devFlags";

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

/** Comments here legitimately quote the weak pattern in order to warn about it. */
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

const LAYOUT   = read("app/_layout.tsx");
const SETTINGS = read("app/(tabs)/settings.tsx");

/** Every route file whose path marks it as a developer surface. */
const DEV_ROUTES = [
  ...readdirSync(path.join(root, "app")).filter(f => /^dev-.*\.tsx$/.test(f)).map(f => `app/${f}`),
  ...readdirSync(path.join(root, "app/dev")).map(f => `app/dev/${f}`),
];

describe("dev route inventory", () => {
  it("finds every dev route, including nested ones", () => {
    // A top-level `dev-*` scan alone missed app/dev/theme-lab.tsx.
    expect(DEV_ROUTES.length).toBeGreaterThanOrEqual(8);
    expect(DEV_ROUTES).toContain("app/dev/theme-lab.tsx");
    expect(DEV_ROUTES).toContain("app/dev-scans.tsx");
  });

  it("PRODUCTION — every dev screen refuses to render outside a dev build", () => {
    for (const rel of DEV_ROUTES) {
      const src = read(rel);
      const guarded = /if \(!__DEV__\)/.test(src)
        // The monetization harness is gated on its own single flag instead.
        || /MONETIZATION_HARNESS_VISIBLE/.test(src);
      expect(guarded, `${rel} has no production guard`).toBe(true);
    }
  });

  it("PRODUCTION — every dev route is behind Stack.Protected, not a bare conditional", () => {
    // The weaker form must not come back: it does not block navigation.
    // Checked on stripped code — the comment above the block quotes the very
    // pattern it warns against, and banning the words would ban the warning.
    expect(stripComments(LAYOUT)).not.toMatch(/\{__DEV__ && <Stack\.Screen/);
    for (const rel of DEV_ROUTES) {
      const routeName = rel.replace(/^app\//, "").replace(/\.tsx$/, "");
      const at = LAYOUT.indexOf(`name="${routeName}"`);
      expect(at, `${routeName} is not registered`).toBeGreaterThan(-1);
      // The nearest enclosing block before it must be a Stack.Protected open tag.
      const before = LAYOUT.slice(0, at);
      const lastOpen = before.lastIndexOf("<Stack.Protected");
      const lastClose = before.lastIndexOf("</Stack.Protected>");
      expect(lastOpen, `${routeName} is not inside Stack.Protected`).toBeGreaterThan(lastClose);
    }
  });

  it("PRODUCTION — the harness flag is off, so its route and row need a dev build", () => {
    expect(MONETIZATION_HARNESS_VISIBLE).toBe(false);
    expect(LAYOUT).toMatch(/<Stack\.Protected guard=\{__DEV__ \|\| MONETIZATION_HARNESS_VISIBLE\}>/);
  });
});

describe("Settings", () => {
  it("PRODUCTION — Reset Onboarding and every dev row are inside a __DEV__ block", () => {
    const devBlockStart = SETTINGS.indexOf("{__DEV__ && (");
    expect(devBlockStart).toBeGreaterThan(-1);
    for (const marker of [
      "Reset Onboarding (Dev)", "/dev-achievements", "/dev-brand-compendium",
      "/dev-diamonds", "/dev-scans", "/dev-purchase-complete",
    ]) {
      const at = SETTINGS.indexOf(marker);
      expect(at, `${marker} not found`).toBeGreaterThan(-1);
      expect(at, `${marker} sits outside the __DEV__ block`).toBeGreaterThan(devBlockStart);
    }
  });

  it("PRODUCTION — the control is not merely disabled, it is not rendered", () => {
    // A `disabled` prop would leave the row visible; the block is conditional.
    const block = SETTINGS.slice(SETTINGS.indexOf("{__DEV__ && ("));
    expect(block).not.toMatch(/Reset Onboarding \(Dev\)[\s\S]{0,200}disabled=/);
  });

  it("DEVELOPMENT — the tools are still there for Dylan", () => {
    for (const marker of ["Reset Onboarding (Dev)", "/dev-scans", "/dev-purchase-complete", "/dev-monetization"]) {
      expect(SETTINGS).toContain(marker);
    }
    expect(read("lib/onboarding-storage.ts")).toMatch(/export async function resetOnboarding/);
  });
});

describe("paywall preview", () => {
  it("PRODUCTION — no production path can open dev_preview", () => {
    const callers = ["app", "components", "lib"].flatMap(dir => {
      const walk = (d: string): string[] => readdirSync(path.join(root, d), { withFileTypes: true })
        .flatMap(e => e.isDirectory() ? walk(`${d}/${e.name}`)
          : /\.tsx?$/.test(e.name) ? [`${d}/${e.name}`] : []);
      return walk(dir);
    }).filter(f => read(f).includes("dev_preview"));

    for (const f of callers) {
      const src = read(f);
      // Three legitimate appearances, and no others:
      //   - the config that DEFINES the source (kept deliberately, see §5)
      //   - the guarded harness, the only UI that may select it
      //   - the modal's fallback default for a null config — not an entry point
      const isDefinition = f === "lib/paywallConfig.ts";
      const isHarness = f === "app/dev-monetization.tsx";
      const isFallbackDefault = /config\?\.source \?\? "dev_preview"/.test(src);
      expect(isDefinition || isHarness || isFallbackDefault, `${f} can open dev_preview`).toBe(true);
    }
  });

  it("openProPaywall is never called with dev_preview from ordinary UI", () => {
    expect(read("app/onboarding.tsx")).toMatch(/openProPaywall\('onboarding_offer'/);
    for (const f of ["app/onboarding.tsx", "app/(tabs)/index.tsx", "app/results.tsx"]) {
      expect(read(f)).not.toMatch(/openProPaywall\(\s*['"]dev_preview['"]/);
    }
  });
});

describe("hiding UI is not authorization", () => {
  it("the scan-grant screen's real gate is a server secret, never the client", () => {
    // Client gating hides the form; the server refuses without the secret.
    expect(read("app/dev-scans.tsx")).toMatch(/DEV_SCAN_GRANT_SECRET/);
    const grants = read("server/devGrants.ts");
    expect(grants).toMatch(/!expected \|\| expected\.length < 16/);
    expect(grants).toMatch(/reason: "locked_out"/);
    expect(grants).toMatch(/crypto\.timingSafeEqual\(a, b\)/);
    // And the secret is never bundled into the app.
    expect(read("app/dev-scans.tsx")).not.toMatch(/process\.env\.DEV_SCAN_GRANT_SECRET/);
  });

  it("no client file can grant entitlement or scans on its own", () => {
    for (const f of ["app/dev-scans.tsx", "app/dev-monetization.tsx", "app/dev-purchase-complete.tsx"]) {
      const src = read(f);
      expect(src).not.toMatch(/isPro\s*=\s*true|setPro\(|grantPro\(/);
    }
  });
});

describe("logging", () => {
  it("no OAuth code or state fragment is written to the log", () => {
    const cb = read("app/oauth/callback.tsx");
    expect(cb).not.toMatch(/code\.substring|state\.substring/);
    expect(cb).toMatch(/codeLength: code\.length/);
  });

  it("the scan route logs sizes and booleans, never image payloads", () => {
    const routers = read("server/routers.ts");
    expect(routers).toMatch(/console\.log\("\[analyze\] base64 length:", input\.imageBase64\?\.length \?\? 0\);/);
    expect(routers).not.toMatch(/console\.log\([^)]*input\.imageBase64\s*\)/);
  });

  it("identity logging still records presence, not the token", () => {
    const id = read("server/monetization/identity.ts");
    expect(id).toMatch(/header=\$\{token \? "present" : "absent"\}/);
  });
});

describe("no guest path is advertised", () => {
  /**
   * The product has no guest mode: app/(tabs)/index.tsx sends every signed-out
   * user to /onboarding, and analyzeFast requires a verified account. Three
   * screens still offered "Continue as guest" — one of which replaced to Home
   * and therefore walked the user into onboarding while claiming to decline it.
   */
  it("no screen offers a guest action", () => {
    for (const f of ["app/auth.tsx", "app/hunt.tsx", "components/FeatureGate.tsx"]) {
      const src = stripComments(read(f));
      expect(src, f).not.toMatch(/Continue as guest/i);
      expect(src, f).not.toMatch(/continueAsGuest|guestBtn|guestText/);
    }
  });

  it("each gate still offers a real way forward", () => {
    for (const f of ["app/hunt.tsx", "components/FeatureGate.tsx"]) {
      expect(read(f), f).toMatch(/Create Account/);
      expect(read(f), f).toMatch(/Log ?[Ii]n/);
    }
    // And the auth landing keeps its close control, which is what the removed
    // button actually did.
    expect(read("app/auth.tsx")).toMatch(/<MaterialIcons name="close"/);
  });

  it("the home gate is what makes guest mode impossible", () => {
    const home = read("app/(tabs)/index.tsx");
    expect(home).toMatch(/if \(!user\) \{[\s\S]{0,400}?router\.replace\('\/onboarding' as any\);/);
  });
});

describe("build configuration", () => {
  it("the production EAS profile enables no development client or debug flag", () => {
    const eas = JSON.parse(read("eas.json"));
    expect(eas.build.production.developmentClient).toBeUndefined();
    expect(eas.build.development.developmentClient).toBe(true);
    // TestFlight-style internal builds are release-mode too.
    expect(eas.build.preview.developmentClient).toBeUndefined();
  });
});
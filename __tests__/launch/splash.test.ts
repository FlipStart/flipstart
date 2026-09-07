/**
 * __tests__/launch/splash.test.ts
 *
 * The native launch screen's configuration and handoff.
 *
 * The splash image itself is a binary asset that cannot be asserted on here.
 * What CAN be pinned is everything around it: the brand colour, that every
 * platform and appearance mode agrees on it, and that the app stops holding
 * the splash open for branding.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PW } from "@/components/monetization/paywall/paywallTheme";

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

/** The comment above the colour explains what it replaced, and names it. */
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

const CONFIG = stripComments(read("app.config.ts"));
const LAYOUT = stripComments(read("app/_layout.tsx"));

describe("splash background colour", () => {
  it("uses the app's real forest token, not an invented shade", () => {
    expect(PW.forest).toBe("#214D2D");
    expect(CONFIG).toContain('backgroundColor: "#214D2D"');
    // The old sand colour matched nothing else in the app.
    expect(CONFIG).not.toContain("#E8C99A");
  });

  it("agrees across every platform and appearance mode", () => {
    // Five entries: top level, ios, android, dark.ios, dark.android. Any one
    // of them disagreeing shows as a colour flash on some device.
    const hits = CONFIG.match(/backgroundColor: "#214D2D"/g) ?? [];
    expect(hits).toHaveLength(5);
    // No other colour may appear in the splash plugin block.
    const block = CONFIG.slice(CONFIG.indexOf('"expo-splash-screen"'),
                               CONFIG.indexOf('"expo-build-properties"'));
    const colours = new Set(block.match(/#[0-9A-Fa-f]{6}/g) ?? []);
    expect([...colours]).toEqual(["#214D2D"]);
  });

  it("keeps the full-bleed settings the project already worked out", () => {
    // Both are load-bearing per the comments in app.config.ts; changing either
    // reintroduces a letterboxed or constrained launch image on iOS.
    expect(CONFIG).toMatch(/enableFullScreenImage_legacy: true/);
    expect(CONFIG).toMatch(/resizeMode: "cover"/);
  });

  it("loads the image from a bundled path, never the network", () => {
    const paths = CONFIG.match(/image:\s*"([^"]+)"/g) ?? [];
    expect(paths.length).toBeGreaterThanOrEqual(4);
    for (const p of paths) {
      expect(p).toContain("./assets/");
      expect(p).not.toMatch(/https?:/);
    }
  });
});

describe("splash handoff", () => {
  it("hides on readiness, not after a fixed wait", () => {
    // OR, not AND: whichever comes first. The previous AND-condition with a
    // 1800ms timer meant a launch ready in 400ms still waited 1.4s more.
    expect(LAYOUT).toMatch(/if \(!layoutFired\.current && !timerFired\.current\) return;/);
    expect(LAYOUT).not.toMatch(/if \(!layoutFired\.current \|\| !timerFired\.current\) return;/);
  });

  it("adds no artificial branding delay", () => {
    expect(LAYOUT).not.toMatch(/\b1800\b/);
    expect(LAYOUT).toMatch(/const SPLASH_FAILSAFE_MS = 4000;/);
    // The remaining timer is a failsafe, and long enough never to win a
    // normal launch.
    // (the "Failsafe only" rationale lives in a comment, stripped above)
  });

  it("still gates on layout, so the app is painted before the fade", () => {
    expect(LAYOUT).toMatch(/const onRootLayout = useCallback\(\(\) => \{/);
    expect(LAYOUT).toMatch(/layoutFired\.current = true;/);
    expect(LAYOUT).toMatch(/SplashScreen\.preventAutoHideAsync\(\)/);
    expect(LAYOUT).toMatch(/SplashScreen\.hideAsync\(\)/);
  });

  it("hides exactly once", () => {
    expect(LAYOUT).toMatch(/if \(hideCalled\.current\) return;\s*hideCalled\.current = true;/);
  });

  it("does not show a second branded screen after the native one", () => {
    // No JS splash re-render: the app fades in, it does not replay the logo.
    expect(LAYOUT).toMatch(/Animated\.timing\(appOpacity/);
    expect(LAYOUT).not.toMatch(/<SplashScreenComponent|FakeSplash|BrandedLoading/);
  });
});
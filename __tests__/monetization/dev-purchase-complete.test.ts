/**
 * __tests__/monetization/dev-purchase-complete.test.ts
 *
 * The dev preview of the post-purchase panels.
 *
 * Two things must stay true: it renders the REAL panels (so what it shows is
 * what ships), and it can buy, grant or confirm nothing (so a dev route that
 * exists in the production bundle stays harmless).
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

const DEV      = read("app/dev-purchase-complete.tsx");
const MODAL    = read("components/monetization/paywall/ProPaywallModal.tsx");
const LAYOUT   = read("app/_layout.tsx");
const SETTINGS = read("app/(tabs)/settings.tsx");

describe("dev purchase-complete preview", () => {
  it("renders the production panels, not copies of them", () => {
    expect(DEV).toMatch(/import \{\s*ResolutionPanel, AlreadyProPanel,\s*\} from '@\/components\/monetization\/paywall\/ProPaywallModal';/);
    expect(MODAL).toMatch(/^export function ResolutionPanel\(/m);
    expect(MODAL).toMatch(/^export function AlreadyProPanel\(/m);
    // No reimplementation. Checked on STRUCTURE, not on words: the panel copy
    // legitimately appears here as tab labels, so banning the words would ban
    // the wrong thing. What must not exist is a second panel — its styles, its
    // emblem, or its ornament.
    expect(DEV).not.toMatch(/s\.panel(Title|Body|Emblem|Btn|Eyebrow)\b/);
    expect(DEV).not.toMatch(/<OrnamentRule|workspace-premium|name="verified"/);
    expect(DEV.match(/^\s{2}panel\w*:/gm) ?? []).toEqual([]);
  });

  it("covers every state a user can land in, including the onboarding variant", () => {
    for (const key of ["unlocked", "pending", "pending_onboarding", "pending_message", "already_pro"]) {
      expect(DEV).toContain(`key: '${key}'`);
    }
    // The two inputs ResolutionPanel branches on are both exercised.
    expect(DEV).toMatch(/phase: 'unlocked' as const/);
    expect(DEV).toMatch(/phase: 'pending_activation' as const/);
    expect(DEV).toMatch(/mustResolve: true/);
    expect(DEV).toMatch(/mustResolve: false/);
  });

  it("cannot purchase, restore, grant, confirm, or complete onboarding", () => {
    // Capability comes from imports and calls, not from the word "purchase"
    // appearing in a label — so both are checked directly.
    const imports = [...DEV.matchAll(/from '([^']+)'/g)].map(m => m[1]).sort();
    expect(imports).toEqual([
      "@/components/monetization/paywall/ProPaywallModal",
      "@/components/monetization/paywall/paywallTheme",
      "@/constants/typography",
      "@expo/vector-icons/MaterialIcons",
      "expo-router",
      "react",
      "react-native",
      "react-native-safe-area-context",
    ]);
    // Nothing that moves money, entitlement or onboarding state is called.
    expect(code(DEV)).not.toMatch(
      /\b(purchase|purchaseScanPack|restorePurchases|recoverPacksOnServer|confirmProWithServer|useEntitlement|useRefreshEntitlement|completeOnboarding|finishNewUserOnboarding|openProPaywall)\s*\(/,
    );
    // And no client for a backend of any kind.
    expect(code(DEV)).not.toMatch(/\b(trpc|supabase|fetch)\s*[.(]/);
  });

  it("navigates nowhere except back", () => {
    const pushes = code(DEV).match(/router\.(push|replace|navigate)\(/g) ?? [];
    expect(pushes).toEqual([]);
    expect(DEV).toMatch(/router\.back\(\)/);
  });

  it("is gated by the two client-side layers the other dev screens use", () => {
    expect(DEV).toMatch(/if \(!__DEV__\) return null;/);
    expect(LAYOUT).toMatch(/<Stack\.Protected guard=\{__DEV__\}>\s*<Stack\.Screen name="dev-purchase-complete"/);
    // Reachable the same way as the rest, and only in dev.
    expect(SETTINGS).toMatch(/router\.push\('\/dev-purchase-complete' as any\)/);
    const at = SETTINGS.indexOf("dev-purchase-complete");
    expect(SETTINGS.lastIndexOf("{__DEV__ && (", at)).toBeGreaterThan(-1);
  });

  it("leaves the modal's own behaviour untouched — export only", () => {
    // The panels are still rendered by the modal exactly as before.
    expect(MODAL).toMatch(/<ResolutionPanel\s+phase=\{state\.phase\}/);
    expect(MODAL).toMatch(/mustResolve=\{!dismissible\}/);
    expect(MODAL).toMatch(/if \(state\.phase !== "unlocked" \|\| !hasContinuation\) return;/);
    expect(MODAL).toMatch(/const confirmed = await confirmProWithServer\(\);/);
  });
});
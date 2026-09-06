/**
 * __tests__/monetization/scan-store-redesign.test.ts
 *
 * The Scan Store redesign: what changed visually, and what must not have
 * changed underneath it. The purchase/balance/recovery pins live in
 * scan-store.test.ts and still pass unchanged; this file pins the new shell.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { bestValueSku, SCAN_PACKS, type PackPricing } from "@/lib/scanPackCatalog";

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

const STORE = read("app/scan-store.tsx");
const ORIG_LOGIC_MARKERS = [
  "export default function ScanStoreScreen()",
  "const [entryMode] = useState(() => scanStoreEntryMode());",
  "const runId = useRef(0);",
  "const lastUid = useRef<string | null>(user?.id ?? null);",
  "const pricingBySku = useMemo(() => {",
  "const bestValue = useMemo<PackSku | null>(() => {",
  "const balanceReady = ent.status === 'ready';",
  "const packBalance = ent.packScansRemaining;",
  "const busy = phase !== 'idle';",
  "const resumedRef = useRef(false);",
  "const maybeResume = useCallback(async () => {",
  "const buy = useCallback(async (sku: ScanPackSku) => {",
  "const recover = useCallback(async () => {",
  "const goBack = useCallback(() => {",
];

// ── The shell shares the paywalls' system ───────────────────────────────────

describe("shared system", () => {
  it("uses the paywall palette tokens, not a private copy", () => {
    expect(STORE).toMatch(/import \{ PW, PW_RADIUS, PW_SHADOW \} from '@\/components\/monetization\/paywall\/paywallTheme';/);
    expect(code(STORE)).not.toMatch(/const (PARCHMENT|CARD|GOLD_TINT|FOREST|INK|BROWN|BORDER|GOLD|CREAM)\s*=/);
    // The one literal left is the success-notice tint, which has no token.
    const hexes = [...code(STORE).matchAll(/#[0-9A-Fa-f]{6}/g)].map(m => m[0].toUpperCase());
    expect(new Set(hexes)).toEqual(new Set(["#EDF3EC", "#FFF4C8"]));
  });

  it("balances the back button with a width-only spacer — never a second ring", () => {
    // Regression: the spacer once reused s.backBtn, which carries the hairline
    // ring, and drew an empty "ghost" circle in the top-right corner.
    expect(STORE).toMatch(/<View style=\{s\.headerSpacer\} \/>\s*<\/View>\s*<ScrollView/);
    expect(STORE).toMatch(/headerSpacer: \{ width: 36, height: 36 \},/);
    expect((STORE.match(/style=\{s\.backBtn\}/g) ?? []).length).toBe(0);
    expect((STORE.match(/\[s\.backBtn,/g) ?? []).length).toBe(1);
  });

  it("opens with the masthead brand row and a paywall-sized serif title", () => {
    expect(STORE).toMatch(/import \{ Spark \} from '@\/components\/monetization\/paywall\/PaywallMasthead';/);
    expect(STORE).toMatch(/<Spark size=\{13\} \/>\s*<Text style=\{s\.brand\}[^>]*>FLIPSTART<\/Text>\s*<Spark size=\{13\} \/>/);
    expect(STORE).toMatch(/brand: \{[^}]*fontSize: 19[^}]*letterSpacing: 5[^}]*color: PW\.forest/);
    expect(STORE).toMatch(/<Text style=\{s\.headerTitle\}>Scan Store<\/Text>/);
    expect(STORE).toMatch(/headerTitle: \{[^}]*fontSize: 32/);
  });

  it("uses the PlanSelector's ✦-rule heading for the catalogue", () => {
    expect(STORE).toMatch(/<Text style=\{s\.sectionSpark\}>✦<\/Text>\s*<View style=\{s\.sectionRule\} \/>\s*<Text style=\{s\.sectionLabel\}[^>]*>CHOOSE A SCAN PACK<\/Text>/);
    expect(STORE).toMatch(/sectionRule: \{[^}]*backgroundColor: 'rgba\(196,163,52,0\.55\)'/);
  });

  it("enters once through the shared reveal and respects Reduce Motion", () => {
    expect(STORE).toMatch(/import \{ Reveal, useHeroReveal \} from '@\/components\/monetization\/paywall\/HeroReveal';/);
    expect(STORE).toMatch(/const \{ progress \} = useHeroReveal\(\);/);
    expect(STORE).toMatch(/<Reveal key=\{pack\.sku\} progress=\{progress\} at=\{0\.25 \+ i \* 0\.08\}/);
    // The seal glint is the only loop, on the masthead's cadence, and off under Reduce Motion.
    expect(STORE).toMatch(/const GLINT_PERIOD_MS = 11000;/);
    expect(STORE).toMatch(/if \(reduceMotion\) return null;/);
    expect((code(STORE).match(/withRepeat\(/g) ?? []).length).toBe(1);
  });
});

// ── Balance card ────────────────────────────────────────────────────────────

describe("balance card", () => {
  it("keeps the authoritative number and the neutral skeleton, now with presence", () => {
    expect(STORE).toMatch(/balanceReady \? \(/);
    expect(STORE).toMatch(/\{formatScans\(packBalance\)\}/);
    expect(STORE).toMatch(/<Skeleton width=\{104\} height=\{30\} radius=\{6\} \/>/);
    expect(STORE).toMatch(/balanceValue: \{[^}]*fontSize: 36[^}]*color: PW\.forest/);
    expect(STORE).toMatch(/<MaterialIcons name="style" size=\{26\} color=\{PW\.forest\} \/>/);
    expect(STORE).toContain("FUEL{'\\n'}YOUR{'\\n'}NEXT{'\\n'}FIND");
  });

  it("never renders a literal zero as a fallback", () => {
    const c = code(STORE);
    expect(c).not.toMatch(/packScansRemaining \?\? 0|\?\? 0\)|formatScans\(0\)|>0<\/Text>/);
  });

  it("keeps 'never expire' visible directly under the balance, with the infinity mark", () => {
    const c = STORE;
    const balance = c.indexOf("YOUR PACK BALANCE");
    const rule = c.indexOf("Pack Scans never expire and are used after your included scans.");
    const heading = c.indexOf("CHOOSE A SCAN PACK");
    expect(balance).toBeLessThan(rule);
    expect(rule).toBeLessThan(heading);
    expect(STORE).toMatch(/<MaterialIcons name="all-inclusive" size=\{13\} color=\{PW\.gold\} \/>/);
  });
});

// ── Pack cards ──────────────────────────────────────────────────────────────

describe("pack cards", () => {
  it("gives every SKU a tier glyph, smallest to largest: sprout, rocket, star, crown, diamond", () => {
    expect(STORE).toMatch(/flipstart_scan_pack_40:\s+'eco'/);
    expect(STORE).toMatch(/flipstart_scan_pack_110:\s+'rocket-launch'/);
    expect(STORE).toMatch(/flipstart_scan_pack_300:\s+'star'/);
    expect(STORE).toMatch(/flipstart_scan_pack_700:\s+'crown'/);
    expect(STORE).toMatch(/flipstart_scan_pack_1200:\s+'diamond'/);
    for (const p of SCAN_PACKS) expect(STORE).toContain(`${p.sku}:`);
    expect(STORE).toMatch(/function Crown\(/);
  });

  it("wires gold to bestValue only — never to a pack name", () => {
    expect(STORE).toMatch(/<TierSeal glyph=\{glyph\} gold=\{bestValue\} \/>/);
    expect(STORE).toMatch(/\{bestValue && <View pointerEvents="none" style=\{s\.cardInnerRule\} \/>\}/);
    expect(STORE).toMatch(/<View style=\{\[s\.card, bestValue && s\.cardBest\]\}>/);
    expect(code(STORE)).not.toMatch(/name === ['"]FlipGod['"]|sku === ['"]flipstart_scan_pack_1200['"]/);
  });

  it("says BEST PACK VALUE, not BEST VALUE", () => {
    expect(STORE).toContain(">BEST PACK VALUE</Text>");
    expect(code(STORE)).not.toMatch(/>BEST VALUE</);
  });

  it("shows no per-scan price on any card", () => {
    expect(code(STORE)).not.toMatch(/per scan|perScan|¢|\/ ?scan\b/i);
  });

  it("gives the Buy pill the gold trim and a chevron, and keeps the busy/disabled states", () => {
    expect(STORE).toMatch(/<View pointerEvents="none" style=\{s\.buyTrim\} \/>/);
    expect(STORE).toMatch(/buyTrim: \{[^}]*borderColor: 'rgba\(212,180,84,0\.55\)'/);
    expect(STORE).toMatch(/<MaterialIcons name="chevron-right" size=\{17\} color=\{PW\.cream\}/);
    expect(STORE).toMatch(/disabled=\{!available \|\| busy\}/);
    expect(STORE).toMatch(/<ActivityIndicator size="small" color=\{PW\.cream\} \/>\s*<Text style=\{s\.buyBusyText\}>Adding scans…<\/Text>/);
    expect(STORE).toMatch(/minHeight: 44/);
  });

  it("keeps the name to one line and the price to one, so nothing clips on a narrow phone", () => {
    expect(STORE).toMatch(/<Text style=\{s\.packName\} numberOfLines=\{1\} adjustsFontSizeToFit minimumFontScale=\{0\.85\}>/);
    expect(STORE).toMatch(/numberOfLines=\{priceString \? 1 : 2\}/);
    expect(STORE).toMatch(/cardText: \{ flex: 1, minWidth: 0/);
  });
});

// ── Disclaimer + recovery ───────────────────────────────────────────────────

describe("disclaimer and recovery", () => {
  it("keeps 'does not unlock Pro' with an icon, above the recovery row", () => {
    expect(STORE).toMatch(/<MaterialIcons name="info-outline" size=\{13\} color=\{PW\.brown\} \/>\s*<Text style=\{s\.footer\}>\s*Scan Packs add scan quantity only and do not unlock FlipStart Pro\./);
    const disclaimer = STORE.indexOf("Scan Packs add scan quantity only");
    const recover = STORE.indexOf('accessibilityLabel="Recover Scan Purchases"');
    expect(disclaimer).toBeLessThan(recover);
  });

  it("frames Recover Scan Purchases between gold rules and keeps it accessible", () => {
    expect(STORE).toMatch(/<View style=\{s\.recoverRule\} \/>\s*<Pressable[\s\S]*?accessibilityLabel="Recover Scan Purchases"[\s\S]*?<\/Pressable>\s*<View style=\{s\.recoverRule\} \/>/);
    expect(STORE).toMatch(/accessibilityState=\{\{ disabled: busy, busy: phase === 'recovering' \}\}/);
    expect(STORE).toMatch(/\{phase === 'recovering' \? 'Checking…' : 'Recover Scan Purchases'\}/);
    expect(code(STORE)).not.toContain("Restore Purchases");
  });
});

// ── Nothing underneath moved ────────────────────────────────────────────────

describe("logic untouched", () => {
  it("still contains every logic anchor from the Phase 3 screen, in order", () => {
    let last = -1;
    for (const m of ORIG_LOGIC_MARKERS) {
      const i = STORE.indexOf(m);
      expect(i, m).toBeGreaterThan(last);
      last = i;
    }
  });

  it("computes best value from live prices via the existing helper, and suppresses on incomplete data", () => {
    expect(STORE).toMatch(/return bestValueSku\(rows\);/);
    expect(STORE).toMatch(/if \(products\?\.status !== 'ready'\) return null;/);
    const usd = (amounts: number[]): PackPricing[] =>
      SCAN_PACKS.map((p, i) => ({ sku: p.sku, priceAmount: amounts[i] ?? null, currencyCode: "USD" }));
    expect(bestValueSku(usd([1.99, 4.99, 11.99, 24.99, 39.99]))).toBe("flipstart_scan_pack_1200");
    expect(bestValueSku(usd([1.99, 4.99, 11.99, 24.99]))).toBeNull();
  });

  it("adds no scan-pack purchasing, balance arithmetic, or Pro upsell", () => {
    const c = code(STORE);
    expect(c).not.toMatch(/react-native-purchases|purchasePackage\(|setPackBalance|balance\s*\+=|\+\s*pack\.scans/);
    expect(c).not.toMatch(/Upgrade to Pro|Unlock Pro|Monthly Pro|Annual Pro|openProPaywall|Subscribe/);
    for (const p of ["$1.99", "$4.99", "$11.99", "$24.99", "$39.99"]) expect(c).not.toContain(p);
  });
});
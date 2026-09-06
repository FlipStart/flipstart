/**
 * __tests__/comps/relevance.test.ts
 *
 * Sold Comps relevance: similarity first, recency second.
 *
 * The scorer is a pure function of (analysis, listing), so these are real unit
 * tests against `scoreComp` and `canonicalPhrase` with hand-built fixtures —
 * no network, no provider, no live API.
 *
 * The cases are the ones from the brief: a modern scan must not be beaten by a
 * fresher vintage listing, a vintage scan must not be beaten by a fresher
 * modern one, an exact model must beat a same-brand different garment, and
 * "VTG" must mean vintage everywhere.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { scoreComp, MIN_ACCEPT_SCORE } from "@/server/comps/matching";
import { canonicalPhrase, tokens } from "@/server/comps/normalize";
import type { NormalizedSoldComp } from "@/server/comps/types";

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

// ── Fixtures ────────────────────────────────────────────────────────────────

/** Only the fields scoreComp actually reads. Everything else is left empty. */
function analysis(over: {
  brand?: string; itemType?: string; model?: string; genericName?: string;
  era?: string; eraConfidence?: number;
}): any {
  return {
    ai: {
      identification: {
        // canonical_brand is what the matcher reads; `brand` is the raw model
        // output and is not consulted here.
        canonical_brand: over.brand ?? "", item_type: over.itemType ?? "", subtype: "",
        generic_item_name: over.genericName ?? over.itemType ?? "",
        model_or_product_number: over.model ?? "", product_line: "",
        subject: "", team: "", artist: "", event: "", character_or_license: "",
      },
      visible_attributes: { size_label: "", target_department: "unknown" },
      features: {},
      era: { style_era: "" },
    },
    derived: {
      era_effective: { status: over.era ?? "unknown", confidence: over.eraConfidence ?? 0 },
    },
  };
}

function listing(title: string, soldAt: string, id = title.slice(0, 14)): NormalizedSoldComp {
  return {
    provider: "test", externalId: id, title,
    soldPrice: 45, shippingPrice: null, buyerPaidTotal: null, currency: "USD",
    condition: "used", soldAt, listingUrl: null, imageUrl: null, bestOfferAccepted: null,
  };
}

const DAYS = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const result = (a: any, c: NormalizedSoldComp) => scoreComp(a, c, new Set());
const score = (a: any, c: NormalizedSoldComp) => result(a, c).score;

// ── CASE D / E — shorthand normalization ────────────────────────────────────

describe("marketplace shorthand", () => {
  it("VTG normalizes to vintage, case-insensitively", () => {
    const t = canonicalPhrase("VTG Patagonia Synchilla Fleece");
    for (const w of ["vintage", "patagonia", "synchilla", "fleece"]) expect(t).toContain(w);
    expect(tokens(t)).toContain("vintage");
    expect(canonicalPhrase("vtg levis 550")).toContain("vintage");
  });

  it("VNTG normalizes the same way", () => {
    expect(canonicalPhrase("VNTG Patagonia Fleece")).toContain("vintage");
    expect(canonicalPhrase("vntg nike acg")).toContain("vintage");
  });

  it("expands only the unambiguous abbreviations", () => {
    expect(canonicalPhrase("NWT nike tee")).toContain("new with tags");
    expect(canonicalPhrase("NWOT nike tee")).toContain("new without tags");
    // OG and DS are ambiguous in resale and are deliberately NOT expanded.
    expect(canonicalPhrase("og colorway")).not.toContain("original");
    expect(canonicalPhrase("ds sneakers")).not.toContain("deadstock");
  });

  it("never rewrites the title shown to the user", () => {
    const scored = result(analysis({ brand: "Patagonia", itemType: "fleece" }),
                          listing("VTG Patagonia Synchilla Fleece", DAYS(2)));
    expect(scored.comp.title).toBe("VTG Patagonia Synchilla Fleece");
  });
});

// ── CASE A — modern scan must not lose to a fresher vintage listing ─────────

describe("CASE A — modern scan vs fresher vintage comp", () => {
  const scan = analysis({ brand: "Patagonia", itemType: "fleece", era: "modern", eraConfidence: 85 });
  const modernOlder = listing("Patagonia Synchilla Fleece Mens Medium", DAYS(120), "a-modern");
  const vintageFresh = listing("VTG Patagonia Fleece Mens Medium", DAYS(2), "a-vintage");

  it("ranks the older modern comp above the fresher vintage one", () => {
    expect(score(scan, modernOlder)).toBeGreaterThan(score(scan, vintageFresh));
  });

  it("rejects the vintage listing outright when the scan is confidently modern", () => {
    const r = result(scan, vintageFresh);
    expect(r.accepted).toBe(false);
    expect(r.rejection).toBe("WRONG_ERA");
  });

  it("catches it through the VTG shorthand, not only the spelled-out word", () => {
    const spelled = listing("Vintage Patagonia Fleece Mens Medium", DAYS(2), "a-spelled");
    expect(result(scan, spelled).rejection).toBe("WRONG_ERA");
  });
});

// ── CASE B — vintage scan must not lose to a fresher modern listing ────────

describe("CASE B — vintage scan vs fresher modern comp", () => {
  const scan = analysis({ brand: "Levis", itemType: "jeans", model: "550", era: "confirmed_vintage", eraConfidence: 90 });

  it("ranks the older vintage comp above the fresher reissue", () => {
    const vintageOlder = listing("VTG Levis 550 Jeans", DAYS(240), "b-vintage");
    const modernFresh = listing("Levis 550 Jeans Reissue", DAYS(5), "b-modern");
    expect(score(scan, vintageOlder)).toBeGreaterThan(score(scan, modernFresh));
    expect(result(scan, modernFresh).accepted).toBe(false);
  });

  it("does not punish a genuine vintage listing that simply omits the word", () => {
    expect(result(scan, listing("Levis 550 Jeans", DAYS(200), "b-plain")).accepted).toBe(true);
  });
});

// ── CASE C — exact model beats same brand, different garment ───────────────

describe("CASE C — model beats brand", () => {
  const scan = analysis({ brand: "Levis", itemType: "jeans", model: "550", era: "modern", eraConfidence: 80 });

  it("ranks the older exact-model comp above the newer different-garment one", () => {
    const exactOlder = listing("Levis 550 Jeans Mens 34x32", DAYS(150), "c-exact");
    const otherNewer = listing("Levis Denim Jacket Mens Large", DAYS(3), "c-jacket");
    expect(score(scan, exactOlder)).toBeGreaterThan(score(scan, otherNewer));
    expect(result(scan, otherNewer).accepted).toBe(false);
  });
});

// ── CASE F — recency is the tie-breaker ────────────────────────────────────

describe("CASE F — recency breaks ties, and only ties", () => {
  const scan = analysis({ brand: "Patagonia", itemType: "fleece", era: "modern", eraConfidence: 80 });

  it("two equally similar comps score the same — the sort settles it by date", () => {
    const older = listing("Patagonia Fleece Mens Medium", DAYS(90), "f-old");
    const newer = listing("Patagonia Fleece Mens Medium", DAYS(1), "f-new");
    expect(score(scan, older)).toBe(score(scan, newer));

    const index = read("server/comps/index.ts");
    const sortBlock = index.slice(index.indexOf("const accepted = scored.filter"), index.indexOf("const weak ="));
    expect(sortBlock).toMatch(/b\.score - a\.score \|\|/);
    expect(sortBlock).toMatch(/soldAt/);
    // Date is a LATER key than score, never the first.
    expect(sortBlock.indexOf("b.score - a.score")).toBeLessThan(sortBlock.indexOf("soldAt"));
  });

  it("has no recency term inside the similarity score at all", () => {
    expect(read("server/comps/matching.ts")).not.toMatch(/soldAt|daysAgo|recency|freshness/);
  });
});

// ── CASE G — an uncertain era must not throw comps away ────────────────────

describe("CASE G — uncertain era", () => {
  const vintageComp = listing("VTG Patagonia Fleece Mens Medium", DAYS(30), "g-vtg");

  it("keeps an opposite-era listing when the scan's era confidence is low", () => {
    const unsure = analysis({ brand: "Patagonia", itemType: "fleece", era: "modern", eraConfidence: 30 });
    const r = result(unsure, vintageComp);
    expect(r.rejection).not.toBe("WRONG_ERA");
    expect(r.penalties.join(" ")).toMatch(/claims vintage/);
    // Same listing, confident scan: now rejected.
    const confident = analysis({ brand: "Patagonia", itemType: "fleece", era: "modern", eraConfidence: 85 });
    expect(result(confident, vintageComp).accepted).toBe(false);
  });

  it("does not score era at all when the scan's era is unknown", () => {
    const noEra = analysis({ brand: "Patagonia", itemType: "fleece", era: "unknown" });
    const plain = listing("Patagonia Fleece Mens Medium", DAYS(30), "g-plain");
    // An unknown era can neither agree nor disagree with a listing, so the
    // vintage claim is simply not evidence here.
    expect(score(noEra, vintageComp)).toBe(score(noEra, plain));
    // And era must be left OUT of the achievable total, not counted as a miss.
    // Counting it would divide by a weight nothing could ever earn, pushing an
    // otherwise good comp under the floor purely for the scan being unsure.
    const r = result(noEra, plain);
    expect(r.accepted).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(80);
    expect(r.components.era ?? 0).toBe(0);
  });

  it("demotes an unsure-era conflict enough to matter", () => {
    // The graded middle: not a hard reject, but the conflict has to cost real
    // score or it changes nothing. On a thin fixture it lands under the display
    // floor; on a richer one it survives, ranked below its consistent peers.
    const unsure = analysis({ brand: "Patagonia", itemType: "fleece", era: "modern", eraConfidence: 30 });
    const plain = listing("Patagonia Fleece Mens Medium", DAYS(30), "g-unsure-plain");
    const conflict = result(unsure, vintageComp);
    expect(conflict.rejection).not.toBe("WRONG_ERA");
    expect(score(unsure, plain) - conflict.score).toBeGreaterThanOrEqual(15);
    expect(conflict.score).toBeLessThan(MIN_ACCEPT_SCORE);
  });

  it("leaves a consistent comp comfortably acceptable", () => {
    const scan = analysis({ brand: "Patagonia", itemType: "fleece", era: "modern", eraConfidence: 80 });
    expect(score(scan, listing("Patagonia Fleece Mens Medium", DAYS(10), "g-ok")))
      .toBeGreaterThanOrEqual(MIN_ACCEPT_SCORE);
  });
});

// ── CASE H — weak candidates must not look strong ──────────────────────────

describe("CASE H — no strong match", () => {
  it("does not hand a mediocre comp a high similarity score", () => {
    const scan = analysis({ brand: "Patagonia", itemType: "fleece", model: "Synchilla", era: "modern", eraConfidence: 80 });
    const r = result(scan, listing("Patagonia Mens Shirt", DAYS(4), "h-weak"));
    expect(r.accepted).toBe(false);
    expect(r.score).toBeLessThan(MIN_ACCEPT_SCORE);
  });

  it("keeps the acceptance floor rather than padding the list", () => {
    expect(read("server/comps/index.ts")).toMatch(/scored\.filter\(s => s\.accepted\)/);
    expect(MIN_ACCEPT_SCORE).toBeGreaterThanOrEqual(70);
  });
});

// ── Retrieval window ───────────────────────────────────────────────────────

describe("candidate pool", () => {
  it("requests the provider's deepest single-call window", () => {
    const index = read("server/comps/index.ts");
    expect(index).toMatch(/const CANDIDATE_POOL = 240;/);
    expect(index).toMatch(/count: CANDIDATE_POOL,/);
    expect(index).not.toMatch(/count: 120/);
    expect(read("server/comps/soldCompsAdapter.ts")).toMatch(/Math\.min\(240/);
  });
});

// ── Era vocabulary discipline ──────────────────────────────────────────────

describe("era claim vocabularies", () => {
  const matching = read("server/comps/matching.ts");

  it("treats only EXPLICIT claims as era evidence", () => {
    expect(matching).toMatch(/const VINTAGE_CLAIM = \[/);
    expect(matching).toMatch(/const MODERN_CLAIM  = \[/);
    const lists = matching.slice(matching.indexOf("const VINTAGE_CLAIM"), matching.indexOf("const ERA_CONFIDENT_AT"));
    for (const weak of ["made in usa", "single stitch", "copyright"]) expect(lists).not.toContain(weak);
  });

  it("grades rejection on the scan's own confidence", () => {
    expect(matching).toMatch(/const ERA_CONFIDENT_AT = 70;/);
    expect(matching).toMatch(/eraEff\.confidence \?\? 0\) >= ERA_CONFIDENT_AT/);
  });

  it("never treats vintage-inspired as vintage", () => {
    const scan = analysis({ brand: "Patagonia", itemType: "fleece", era: "vintage_inspired", eraConfidence: 90 });
    const r = result(scan, listing("VTG Patagonia Fleece Mens Medium", DAYS(10), "vi-comp"));
    expect(r.rejection).not.toBe("WRONG_ERA");   // styling is not a claim about age
    expect(r.components.era).toBe(0);            // but it earns no era credit
  });
});
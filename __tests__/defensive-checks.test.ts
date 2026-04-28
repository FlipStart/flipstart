import { describe, it, expect } from "vitest";

/**
 * Tests for defensive data handling across the FlipStart pipeline.
 * Validates that partial, missing, or malformed data doesn't crash the app.
 */

// ─── Simulate the safe defaults used in results.tsx ──────────────────────────

const EMPTY_IDENTIFICATION = {
  item_name: "Unknown Item",
  brand: "Unknown",
  category: "Other",
  estimated_era: "Unknown",
  style_labels: [] as string[],
  material_guess: "Unknown",
};

const EMPTY_MARKET_DATA = {
  estimated_resale_range: { low: 0, high: 0 },
  average_sold_price: 0,
  suggested_buy_price: 0,
  demand: "Medium" as const,
  sell_speed: "Moderate" as const,
  competition_level: "Unknown",
  base_estimated_value: 0,
  price_adjustments: [] as any[],
  adjusted_estimated_value: 0,
};

const EMPTY_RISK_ANALYSIS = {
  match_confidence: 0,
  risk_flags: [] as string[],
};

const EMPTY_LISTINGS = {
  ebay: { title: "Generating...", description: "Listing is being generated..." },
  depop: { title: "Generating...", description: "Listing is being generated..." },
};

function safeIdentification(raw: any) {
  const result = { ...EMPTY_IDENTIFICATION, ...(raw || {}) };
  if (!Array.isArray(result.style_labels)) result.style_labels = [];
  return result;
}

function safeMarketData(raw: any) {
  const result = { ...EMPTY_MARKET_DATA, ...(raw || {}) };
  if (!result.estimated_resale_range) result.estimated_resale_range = { low: 0, high: 0 };
  if (!Array.isArray(result.price_adjustments)) result.price_adjustments = [];
  return result;
}

function safeRiskAnalysis(raw: any) {
  const result = { ...EMPTY_RISK_ANALYSIS, ...(raw || {}) };
  if (!Array.isArray(result.risk_flags)) result.risk_flags = [];
  return result;
}

function safeListings(raw: any) {
  if (!raw) return EMPTY_LISTINGS;
  return {
    ebay: raw.ebay || EMPTY_LISTINGS.ebay,
    depop: raw.depop || EMPTY_LISTINGS.depop,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Defensive data handling", () => {
  describe("safeIdentification", () => {
    it("returns defaults when given null", () => {
      const result = safeIdentification(null);
      expect(result.item_name).toBe("Unknown Item");
      expect(result.brand).toBe("Unknown");
      expect(Array.isArray(result.style_labels)).toBe(true);
    });

    it("returns defaults when given undefined", () => {
      const result = safeIdentification(undefined);
      expect(result.item_name).toBe("Unknown Item");
      expect(result.style_labels).toEqual([]);
    });

    it("merges partial data correctly", () => {
      const result = safeIdentification({ item_name: "Nike Hoodie", brand: "Nike" });
      expect(result.item_name).toBe("Nike Hoodie");
      expect(result.brand).toBe("Nike");
      expect(result.category).toBe("Other"); // default
      expect(result.style_labels).toEqual([]); // default
    });

    it("handles style_labels being a non-array", () => {
      const result = safeIdentification({ style_labels: "not an array" });
      expect(Array.isArray(result.style_labels)).toBe(true);
      expect(result.style_labels).toEqual([]);
    });
  });

  describe("safeMarketData", () => {
    it("returns defaults when given null", () => {
      const result = safeMarketData(null);
      expect(result.average_sold_price).toBe(0);
      expect(result.estimated_resale_range.low).toBe(0);
      expect(Array.isArray(result.price_adjustments)).toBe(true);
    });

    it("handles missing estimated_resale_range", () => {
      const result = safeMarketData({ estimated_resale_range: null });
      expect(result.estimated_resale_range).toEqual({ low: 0, high: 0 });
    });

    it("handles price_adjustments being a non-array", () => {
      const result = safeMarketData({ price_adjustments: "broken" });
      expect(Array.isArray(result.price_adjustments)).toBe(true);
      expect(result.price_adjustments).toEqual([]);
    });

    it("preserves valid data", () => {
      const result = safeMarketData({
        adjusted_estimated_value: 42,
        demand: "High",
        price_adjustments: [{ reason: "Rare", impact: 5, type: "positive" }],
      });
      expect(result.adjusted_estimated_value).toBe(42);
      expect(result.demand).toBe("High");
      expect(result.price_adjustments).toHaveLength(1);
    });
  });

  describe("safeRiskAnalysis", () => {
    it("returns defaults when given null", () => {
      const result = safeRiskAnalysis(null);
      expect(result.match_confidence).toBe(0);
      expect(result.risk_flags).toEqual([]);
    });

    it("handles risk_flags being undefined", () => {
      const result = safeRiskAnalysis({ match_confidence: 75 });
      expect(result.match_confidence).toBe(75);
      expect(Array.isArray(result.risk_flags)).toBe(true);
    });
  });

  describe("safeListings", () => {
    it("returns defaults when given null", () => {
      const result = safeListings(null);
      expect(result.ebay.title).toBe("Generating...");
      expect(result.depop.title).toBe("Generating...");
    });

    it("handles partial listings", () => {
      const result = safeListings({ ebay: { title: "Test", description: "Desc" } });
      expect(result.ebay.title).toBe("Test");
      expect(result.depop.title).toBe("Generating...");
    });
  });
});

describe("JSON parsing resilience", () => {
  it("parses clean JSON", () => {
    const raw = '{"identification": {"item_name": "Test"}}';
    const parsed = JSON.parse(raw);
    expect(parsed.identification.item_name).toBe("Test");
  });

  it("extracts JSON from markdown code blocks", () => {
    const raw = '```json\n{"identification": {"item_name": "Test"}}\n```';
    const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    expect(match).not.toBeNull();
    const parsed = JSON.parse(match![1].trim());
    expect(parsed.identification.item_name).toBe("Test");
  });

  it("handles response.choices being undefined safely", () => {
    const response: any = {};
    const rawContent = response?.choices?.[0]?.message?.content;
    expect(rawContent).toBeUndefined();
  });

  it("handles response.choices[0] being undefined safely", () => {
    const response: any = { choices: [] };
    const rawContent = response?.choices?.[0]?.message?.content;
    expect(rawContent).toBeUndefined();
  });
});

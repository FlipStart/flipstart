import { describe, it, expect } from "vitest";

// Test the sanitization logic and data flow for the fast analysis pipeline

describe("Fast Analysis Pipeline", () => {
  // Simulate what sanitizeFullResult does
  function sanitizeFullResult(raw: any): any {
    const id = raw.identification || {};
    const md = raw.market_data || {};
    const ra = raw.risk_analysis || {};
    const li = raw.listings || {};

    const itemName = String(id.item_name || "Unknown Item");
    const brand = String(id.brand || "Unbranded");
    const category = String(id.category || "Other");

    const demandRaw = String(md.demand || "Medium");
    const demand = (["High", "Medium", "Low"].includes(demandRaw) ? demandRaw : "Medium");

    const speedRaw = String(md.sell_speed || "Moderate");
    const sellSpeed = (["Fast", "Moderate", "Slow"].includes(speedRaw) ? speedRaw : "Moderate");

    const competitionLevel = String(md.competition_level || "Moderate");

    let baseValue = Number(md.base_estimated_value) || 25;
    let adjustments = Array.isArray(md.price_adjustments)
      ? md.price_adjustments.map((adj: any) => ({
          reason: String(adj.reason || "Unknown factor"),
          impact: Number(adj.impact) || 0,
          type: adj.type === "negative" ? "negative" : "positive",
        }))
      : [];

    let adjustedValue = Number(md.adjusted_estimated_value) || baseValue;

    const isCommonMallBrand = /ralph lauren|polo|tommy hilfiger|gap/i.test(brand);
    const isBasicItem = /polo shirt|t-shirt|tee|basic/i.test(itemName);
    const isHighCompetition = /high|saturated/i.test(competitionLevel);

    if (isCommonMallBrand && isBasicItem && adjustedValue > 25) {
      const correction = -(adjustedValue - 25);
      adjustments.push({
        reason: "Common mall brand basic — saturated market",
        impact: Math.round(correction * 0.6),
        type: "negative",
      });
      adjustedValue = Math.max(8, adjustedValue + Math.round(correction * 0.6));
    }

    if (isHighCompetition && adjustedValue > 15) {
      const penalty = Math.round(adjustedValue * -0.1);
      adjustments.push({
        reason: "High market competition",
        impact: penalty,
        type: "negative",
      });
      adjustedValue += penalty;
    }

    adjustedValue = Math.max(5, adjustedValue);

    let buyPriceRatio: number;
    if (demand === "Low" || sellSpeed === "Slow") {
      buyPriceRatio = 0.25;
    } else if (demand === "Medium" || sellSpeed === "Moderate") {
      buyPriceRatio = 0.35;
    } else {
      buyPriceRatio = 0.45;
    }
    if (isCommonMallBrand && isHighCompetition) {
      buyPriceRatio *= 0.8;
    }
    const suggestedBuyPrice = Math.max(1, Math.round(adjustedValue * buyPriceRatio));

    return {
      identification: {
        item_name: itemName,
        brand,
        category,
        estimated_era: String(id.estimated_era || "Unknown"),
        style_labels: Array.isArray(id.style_labels) ? id.style_labels.map(String) : [],
        material_guess: String(id.material_guess || "Unknown"),
      },
      market_data: {
        estimated_resale_range: {
          low: Number(md.estimated_resale_range?.low) || Math.round(adjustedValue * 0.75),
          high: Number(md.estimated_resale_range?.high) || Math.round(adjustedValue * 1.25),
        },
        average_sold_price: Math.round(adjustedValue),
        suggested_buy_price: suggestedBuyPrice,
        demand,
        sell_speed: sellSpeed,
        competition_level: competitionLevel,
        base_estimated_value: Math.round(baseValue),
        price_adjustments: adjustments,
        adjusted_estimated_value: Math.round(adjustedValue),
      },
      risk_analysis: {
        match_confidence: Math.min(100, Math.max(0, Number(ra.match_confidence) || 50)),
        risk_flags: Array.isArray(ra.risk_flags) ? ra.risk_flags.map(String) : [],
      },
      listings: {
        ebay: {
          title: String(li.ebay?.title || "Item for Sale"),
          description: String(li.ebay?.description || "Item in good condition."),
        },
        depop: {
          title: String(li.depop?.title || "Cool find"),
          description: String(li.depop?.description || "Great item!"),
        },
      },
    };
  }

  it("should sanitize a complete LLM response", () => {
    const raw = {
      identification: {
        item_name: "Nike Air Max 90",
        brand: "Nike",
        category: "Shoes",
        estimated_era: "2020s",
        style_labels: ["sneaker", "athletic"],
        material_guess: "Leather/Mesh",
      },
      market_data: {
        estimated_resale_range: { low: 45, high: 75 },
        average_sold_price: 60,
        suggested_buy_price: 25,
        demand: "High",
        sell_speed: "Fast",
        competition_level: "Moderate",
        base_estimated_value: 60,
        price_adjustments: [
          { reason: "Popular brand", impact: 5, type: "positive" },
        ],
        adjusted_estimated_value: 65,
      },
      risk_analysis: {
        match_confidence: 85,
        risk_flags: ["Verify authenticity"],
      },
      listings: {
        ebay: { title: "Nike Air Max 90 Sneakers", description: "Great condition Nike shoes" },
        depop: { title: "Nike Air Max 90", description: "Fire kicks #nike #airmax" },
      },
    };

    const result = sanitizeFullResult(raw);
    expect(result.identification.item_name).toBe("Nike Air Max 90");
    expect(result.identification.brand).toBe("Nike");
    expect(result.listings.ebay.title).toBe("Nike Air Max 90 Sneakers");
    expect(result.listings.depop.title).toBe("Nike Air Max 90");
    expect(result.risk_analysis.match_confidence).toBe(85);
  });

  it("should handle completely empty response", () => {
    const result = sanitizeFullResult({});
    expect(result.identification.item_name).toBe("Unknown Item");
    expect(result.identification.brand).toBe("Unbranded");
    expect(result.market_data.adjusted_estimated_value).toBeGreaterThanOrEqual(5);
    expect(result.listings.ebay.title).toBe("Item for Sale");
    expect(result.listings.depop.title).toBe("Cool find");
    expect(result.risk_analysis.match_confidence).toBe(50);
  });

  it("should cap common mall brand basics at realistic prices", () => {
    const raw = {
      identification: {
        item_name: "Polo Ralph Lauren Polo Shirt",
        brand: "Ralph Lauren",
        category: "Clothing",
      },
      market_data: {
        base_estimated_value: 45,
        adjusted_estimated_value: 45,
        demand: "High",
        sell_speed: "Fast",
        competition_level: "High - saturated",
        price_adjustments: [],
      },
    };

    const result = sanitizeFullResult(raw);
    // Should be capped well below 45
    expect(result.market_data.adjusted_estimated_value).toBeLessThanOrEqual(30);
    // Buy price should be very conservative
    expect(result.market_data.suggested_buy_price).toBeLessThan(15);
  });

  it("should include listings in single-call result", () => {
    const raw = {
      identification: { item_name: "Test Item", brand: "TestBrand" },
      market_data: { base_estimated_value: 20, adjusted_estimated_value: 20 },
      listings: {
        ebay: { title: "Test eBay Title", description: "Test eBay desc" },
        depop: { title: "Test Depop Title", description: "Test Depop desc" },
      },
    };

    const result = sanitizeFullResult(raw);
    expect(result.listings.ebay.title).toBe("Test eBay Title");
    expect(result.listings.depop.description).toBe("Test Depop desc");
  });

  it("should handle missing listings gracefully", () => {
    const raw = {
      identification: { item_name: "No Listing Item" },
      market_data: { adjusted_estimated_value: 15 },
    };

    const result = sanitizeFullResult(raw);
    expect(result.listings.ebay.title).toBe("Item for Sale");
    expect(result.listings.depop.title).toBe("Cool find");
  });

  it("should apply high competition penalty", () => {
    const raw = {
      identification: { item_name: "Generic Jacket", brand: "Generic" },
      market_data: {
        base_estimated_value: 40,
        adjusted_estimated_value: 40,
        competition_level: "High - many sellers",
        price_adjustments: [],
      },
    };

    const result = sanitizeFullResult(raw);
    expect(result.market_data.adjusted_estimated_value).toBeLessThan(40);
  });
});

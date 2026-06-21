import { describe, it, expect } from "vitest";
import { getRandomMockResult } from "../lib/mock-data";
import { ScanResult } from "../lib/types";

describe("Mock Data", () => {
  it("should return a valid ScanResult with all required fields", () => {
    const result = getRandomMockResult("test-image-uri");

    // Check top-level fields
    expect(result.id).toBeDefined();
    expect(result.imageUri).toBe("test-image-uri");
    expect(result.timestamp).toBeGreaterThan(0);

    // Check identification
    expect(result.identification).toBeDefined();
    expect(result.identification.item_name).toBeTruthy();
    expect(result.identification.brand).toBeTruthy();
    expect(result.identification.category).toBeTruthy();
    expect(result.identification.estimated_era).toBeTruthy();
    expect(Array.isArray(result.identification.style_labels)).toBe(true);
    expect(result.identification.style_labels.length).toBeGreaterThan(0);
    expect(result.identification.material_guess).toBeTruthy();

    // Check market data
    expect(result.market_data).toBeDefined();
    expect(result.market_data.estimated_resale_range.low).toBeGreaterThan(0);
    expect(result.market_data.estimated_resale_range.high).toBeGreaterThan(
      result.market_data.estimated_resale_range.low
    );
    expect(result.market_data.average_sold_price).toBeGreaterThan(0);
    expect(result.market_data.suggested_buy_price).toBeGreaterThan(0);
    expect(["High", "Medium", "Low"]).toContain(result.market_data.demand);
    expect(["Fast", "Moderate", "Slow"]).toContain(result.market_data.sell_speed);
    expect(result.market_data.competition_level).toBeTruthy();
    expect(result.market_data.base_estimated_value).toBeGreaterThan(0);
    expect(result.market_data.adjusted_estimated_value).toBeGreaterThan(0);

    // Check price adjustments
    expect(Array.isArray(result.market_data.price_adjustments)).toBe(true);
    expect(result.market_data.price_adjustments.length).toBeGreaterThan(0);
    result.market_data.price_adjustments.forEach((adj) => {
      expect(adj.reason).toBeTruthy();
      expect(typeof adj.impact).toBe("number");
      expect(["positive", "negative"]).toContain(adj.type);
    });

    // Check risk analysis
    expect(result.risk_analysis).toBeDefined();
    expect(result.risk_analysis.match_confidence).toBeGreaterThanOrEqual(0);
    expect(result.risk_analysis.match_confidence).toBeLessThanOrEqual(100);
    expect(Array.isArray(result.risk_analysis.risk_flags)).toBe(true);

    // Check listings
    expect(result.listings).toBeDefined();
    const listings = result.listings!;
    expect(listings.ebay.title).toBeTruthy();
    expect(listings.ebay.description).toBeTruthy();
    expect(listings.depop.title).toBeTruthy();
    expect(listings.depop.description).toBeTruthy();

    // eBay and Depop listings should be different
    expect(listings.ebay.title).not.toBe(listings.depop.title);
    expect(listings.ebay.description).not.toBe(listings.depop.description);
  });

  it("should generate unique IDs for each call", () => {
    const result1 = getRandomMockResult("uri1");
    const result2 = getRandomMockResult("uri2");
    expect(result1.id).not.toBe(result2.id);
  });

  it("should use the provided imageUri", () => {
    const uri = "file:///test/image.jpg";
    const result = getRandomMockResult(uri);
    expect(result.imageUri).toBe(uri);
  });
});
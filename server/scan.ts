import { invokeLLM } from "./_core/llm";
import { storagePut } from "./storage";

/**
 * Upload a base64 image to S3 and return the public URL.
 *
 * LOCAL DEV BEHAVIOR:
 * If Forge/storage credentials are not configured, the upload is silently
 * skipped and an empty string is returned. Analysis continues normally —
 * the client falls back to the local image URI for display.
 *
 * PRODUCTION BEHAVIOR:
 * If credentials are present and the upload fails, the error is thrown so
 * it surfaces in server logs.
 */
export async function uploadScanImage(base64Data: string, mimeType: string): Promise<string> {
  const { ENV } = await import("./_core/env");

  // Skip upload when Forge storage is not configured (local dev mode)
  if (!ENV.forgeApiUrl || !ENV.forgeApiKey) {
    console.log("[scan] Forge storage not configured — skipping image upload (local dev mode)");
    return "";
  }

  const ext = mimeType.includes("png") ? "png" : "jpg";
  const randomSuffix = Math.random().toString(36).substring(2, 10);
  const key = `scans/${Date.now()}-${randomSuffix}.${ext}`;

  const buffer = Buffer.from(base64Data, "base64");
  const { url } = await storagePut(key, buffer, mimeType);
  return url;
}

// ─── Single Combined Prompt (optimized for speed) ────────────────────────────

const FAST_ANALYSIS_PROMPT = `You are FlipStart, an AI resale analyst. Analyze the item image and return a COMPLETE resale analysis as JSON.

IDENTIFICATION RULES:
- Only describe what you can CLEARLY SEE in the image
- Do NOT guess details you cannot verify (sleeve length, specific year, material)
- Use broad wording when uncertain
- item_name PRIORITY ORDER: [Visible Brand] → [Visible Team/Logo] → [Item Type] → [Edition/Style if visible]
  * Sports example: "Chicago Bulls City Edition Jersey" NOT "Zach LaVine Jersey" unless player name is CLEARLY printed
  * Clothing example: "Polo Ralph Lauren Rugby Shirt" NOT "Ralph Lauren Vintage 90s Shirt" unless era tag is visible
  * No brand visible: use item type only, e.g. "Vintage Denim Jacket"
- Player/athlete names: ONLY include if name or number is clearly printed AND you are highly confident
- estimated_era/material_guess: use "Unknown" if not clearly identifiable from the image

LOW-VALUE ITEM GUARDRAILS — CRITICAL:
The following are NEVER profitable flips. Price at real garage-sale value:
- Pencils, pens, highlighters, markers, crayons → max $3 total, demand=Low, sell_speed=Slow
- Basic school supplies (notebooks, folders, rulers, erasers) → max $5, demand=Low
- Generic office supplies → max $5, demand=Low
- Single playing cards (non-collectible) → max $2
- Cheap plastic toys, dollar-store items → max $5
- Common paperback books (non-first edition) → max $4
- Generic keychains, magnets, cheap souvenirs → max $3
- Basic food containers / tupperware → max $8
- If item appears worth under $10 resale: demand=Low, sell_speed=Slow, competition=High, match_confidence=45-60

PRICING RULES — BE CONSERVATIVE:
- Price for REAL secondhand resale (eBay, Depop, Poshmark)
- Common mall brands (Ralph Lauren, Tommy, Gap, H&M, Zara, Old Navy, J.Crew, Hollister, AE) = LOW prices
- Basic used Ralph Lauren polo = $8-18 NOT $30+
- Basic used Tommy shirt = $8-15
- Only price higher for rare tag, deadstock, collab, or licensed team gear
- Common basics: demand=Low/Medium, sell_speed=Slow/Moderate, competition=High
- suggested_buy_price: 20-40% of adjusted_estimated_value based on demand
- When confidence under 60%: price conservatively, add risk flags, lower buy price
- UNDER-PROMISE rather than OVER-PROMISE

LISTING TITLE RULES:
- eBay title (max 80 chars): [Brand] [Team/License] [Item Type] [Size if visible] [Key Detail]
  * Good: "Chicago Bulls Nike City Edition Swingman Jersey XL"
  * Good: "Polo Ralph Lauren Cable Knit Sweater Men L"
  * Bad: "Nice Vintage Shirt Great Condition"
- Depop title: shorter, casual, hashtags in description

CRITICAL PRICE ADJUSTMENT RULES:
- ALL adjustment impact values MUST be WHOLE DOLLAR integers. NEVER use decimals.
- base_estimated_value + sum of all adjustment impacts MUST EXACTLY equal adjusted_estimated_value
- Example: base=30, adjustments=[+5, -3, +8] → adjusted=40
- Each adjustment: $2 minimum absolute value
- Positive type="positive", negative type="negative"

Return ONLY this JSON (no markdown, no explanation):
{"identification":{"item_name":"","brand":"","category":"","estimated_era":"","style_labels":[],"material_guess":""},"market_data":{"estimated_resale_range":{"low":0,"high":0},"average_sold_price":0,"suggested_buy_price":0,"demand":"","sell_speed":"","competition_level":"","base_estimated_value":0,"price_adjustments":[{"reason":"","impact":0,"type":"positive|negative"}],"adjusted_estimated_value":0},"risk_analysis":{"match_confidence":0,"risk_flags":[]}}`

/**
 * Single fast analysis — everything in one LLM call.
 */
export async function analyzeItemFast(base64Data: string, mimeType: string): Promise<any> {
  const dataUrl = `data:${mimeType};base64,${base64Data}`;

  const response = await invokeLLM({
    messages: [
      { role: "system", content: FAST_ANALYSIS_PROMPT },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Analyze this item for resale. Be conservative. All price adjustments must be whole dollar amounts. Return JSON only.",
          },
          {
            type: "image_url",
            image_url: { url: dataUrl, detail: "low" },
          },
        ],
      },
    ],
    response_format: { type: "json_object" },
    // Tight token limit — the analysis JSON is ~350-500 tokens.
    // 800 gives a safety margin without the 32K reservation overhead.
    max_tokens: 800,
  });

  const rawContent = response?.choices?.[0]?.message?.content;
  if (!rawContent) throw new Error("No response from AI analysis");

  const contentStr = typeof rawContent === "string"
    ? rawContent
    : Array.isArray(rawContent)
      ? rawContent.filter((p: any) => p.type === "text").map((p: any) => p.text).join("")
      : String(rawContent);

  let parsed: any;
  try {
    parsed = JSON.parse(contentStr);
  } catch (jsonErr) {
    const jsonMatch = contentStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[1].trim());
    } else {
      throw new Error("Failed to parse AI response as JSON");
    }
  }
  return sanitizeFullResult(parsed);
}

// ─── Listing generation ──────────────────────────────────────────────────────

const LISTING_PROMPT = `You are a resale listing copywriter. Generate concise, compelling eBay and Depop listings.

RULES:
- eBay title: max 80 chars. Format: [Brand] [Item Type] [Key Detail] [Size if known]
- eBay description: 3-5 sentences. Condition, notable features, what makes it worth buying.
- Depop title: max 60 chars. Casual tone.
- Depop description: 2-3 short sentences + relevant hashtags at end.
- Do NOT invent details not provided. Stay factual.
- Pricing context is for tone only — do not mention prices in listings.

Return ONLY JSON: {"ebay":{"title":"","description":""},"depop":{"title":"","description":""}}`;

interface ListingInput {
  item_name:                string;
  brand:                    string;
  category:                 string;
  estimated_era?:           string;
  material_guess?:          string;
  style_labels?:            string[];
  adjusted_estimated_value: number;
  demand?:                  string;
}

export async function generateItemListings(input: ListingInput): Promise<{
  ebay: { title: string; description: string };
  depop: { title: string; description: string };
}> {
  const styleText = (input.style_labels ?? []).join(", ");
  const userMessage =
    `Item: ${input.item_name}` +
    `\nBrand: ${input.brand}` +
    `\nCategory: ${input.category}` +
    (input.estimated_era ? `\nEra: ${input.estimated_era}` : "") +
    (input.material_guess && input.material_guess !== "Unknown" ? `\nMaterial: ${input.material_guess}` : "") +
    (styleText ? `\nStyle: ${styleText}` : "") +
    `\nEst. resale value: $${input.adjusted_estimated_value}` +
    `\nDemand: ${input.demand ?? "Medium"}`;

  const response = await invokeLLM({
    messages: [
      { role: "system", content: LISTING_PROMPT },
      { role: "user",   content: userMessage },
    ],
    response_format: { type: "json_object" },
    max_tokens: 500,
  });

  const rawContent = response?.choices?.[0]?.message?.content;
  if (!rawContent) throw new Error("No response from listings generation");

  const contentStr = typeof rawContent === "string" ? rawContent : String(rawContent);
  let parsed: any;
  try {
    parsed = JSON.parse(contentStr);
  } catch {
    throw new Error("Failed to parse listings response as JSON");
  }

  return {
    ebay: {
      title:       String(parsed.ebay?.title       || `${input.brand} ${input.item_name}`).slice(0, 80),
      description: String(parsed.ebay?.description || "See photos for details."),
    },
    depop: {
      title:       String(parsed.depop?.title       || input.item_name).slice(0, 60),
      description: String(parsed.depop?.description || "Great find! DM for details."),
    },
  };
}

// ─── Legacy stubs ────────────────────────────────────────────────────────────

export async function analyzeCoreItem(imageUrl: string): Promise<any> {
  return analyzeItemFast("", "image/jpeg");
}

export async function generateListings(identification: any, marketData: any): Promise<any> {
  return {
    ebay: { title: "Item for Sale", description: "See photos for details." },
    depop: { title: "Cool find", description: "Great item! DM for details." },
  };
}

export async function analyzeItemFull(imageUrl: string): Promise<any> {
  return analyzeItemFast("", "image/jpeg");
}

// ─── Sanitization with math-correct price adjustments ────────────────────────

function sanitizeFullResult(raw: any): any {
  const id = raw.identification || {};
  const md = raw.market_data || {};
  const ra = raw.risk_analysis || {};
  const li = raw.listings || {};

  // Clean identification
  const itemName = String(id.item_name || "Unknown Item");
  const brand = String(id.brand || "Unbranded");
  const category = String(id.category || "Other");

  // Normalize demand/sell_speed
  const demandRaw = String(md.demand || "Medium");
  const demand = (["High", "Medium", "Low"].includes(demandRaw) ? demandRaw : "Medium") as "High" | "Medium" | "Low";

  const speedRaw = String(md.sell_speed || "Moderate");
  const sellSpeed = (["Fast", "Moderate", "Slow"].includes(speedRaw) ? speedRaw : "Moderate") as "Fast" | "Moderate" | "Slow";

  const competitionLevel = String(md.competition_level || "Moderate");

  // ── Round base value to whole dollar ──
  let baseValue = Math.round(Number(md.base_estimated_value) || 25);

  // ── Round ALL adjustment impacts to whole dollars ──
  let adjustments: { reason: string; impact: number; type: "positive" | "negative" }[] = [];
  if (Array.isArray(md.price_adjustments)) {
    adjustments = md.price_adjustments
      .filter((adj: any) => adj && adj.reason && adj.impact !== 0 && adj.impact !== undefined)
      .map((adj: any) => {
        const rawImpact = Number(adj.impact) || 0;
        // Round to whole dollar — if the AI returned 0.2, scale it up to be meaningful
        let impact = Math.round(rawImpact);
        // If the AI returned tiny decimals (like 0.1, 0.2), they were likely meant to be percentages or the AI misunderstood
        // Scale them up: if |rawImpact| < 1 and baseValue exists, treat as percentage of base
        if (Math.abs(rawImpact) < 1 && Math.abs(rawImpact) > 0) {
          impact = Math.round(rawImpact * baseValue);
          if (impact === 0) impact = rawImpact > 0 ? 2 : -2; // minimum $2 impact
        }
        if (impact === 0) return null; // skip zero-impact adjustments
        return {
          reason: String(adj.reason || "Market factor"),
          impact,
          type: (impact < 0 ? "negative" : "positive") as "positive" | "negative",
        };
      })
      .filter(Boolean) as { reason: string; impact: number; type: "positive" | "negative" }[];
  }

  // ── Calculate adjusted value from base + adjustments (math MUST add up) ──
  const totalAdjustment = adjustments.reduce((sum, adj) => sum + adj.impact, 0);
  let adjustedValue = baseValue + totalAdjustment;

  // ── Conservative pricing corrections ──
  const isCommonMallBrand = /ralph lauren|polo|tommy hilfiger|gap|aeropostale|h&m|zara|old navy|j\.?crew|american eagle|hollister|abercrombie/i.test(brand);
  const isBasicItem = /polo shirt|t-shirt|tee|basic|plain|crew neck|v-neck/i.test(itemName);
  const isHighCompetition = /high|saturated/i.test(competitionLevel);

  // Hard cap for provably low-value items — server-side safety net even if
  // the model ignores the prompt guardrails
  const isJunkItem = /^(pencil|pen|highlighter|marker|crayon|eraser|ruler|notebook|folder|binder|stapler|paperclip|keychain|magnet|souvenir|toy|card|bookmark|sticker)/i.test(itemName.trim());
  if (isJunkItem && adjustedValue > 8) {
    const capCorrection = -(adjustedValue - 5);
    adjustments.push({ reason: "Low-value common item — minimal resale demand", impact: capCorrection, type: "negative" });
    adjustedValue = 5;
  }

  // Cap common mall brand basics
  if (isCommonMallBrand && isBasicItem && adjustedValue > 25) {
    const correction = -(adjustedValue - 18); // bring down to ~$18
    adjustments.push({
      reason: "Common mall brand basic — saturated market",
      impact: correction,
      type: "negative",
    });
    adjustedValue += correction;
  }

  // High competition penalty
  if (isHighCompetition && adjustedValue > 15) {
    const penalty = -Math.round(adjustedValue * 0.1);
    if (penalty !== 0) {
      adjustments.push({
        reason: "High market competition",
        impact: penalty,
        type: "negative",
      });
      adjustedValue += penalty;
    }
  }

  adjustedValue = Math.max(5, Math.round(adjustedValue));

  // ── FINAL MATH CORRECTION: ensure base + adjustments = adjusted ──
  // Recalculate what the total should be
  const currentTotal = baseValue + adjustments.reduce((sum, adj) => sum + adj.impact, 0);
  if (currentTotal !== adjustedValue) {
    const diff = adjustedValue - currentTotal;
    if (diff !== 0) {
      adjustments.push({
        reason: diff > 0 ? "Market demand premium" : "Market saturation discount",
        impact: diff,
        type: diff > 0 ? "positive" : "negative",
      });
    }
  }

  const avgSold = Math.round(Number(md.average_sold_price) || adjustedValue);
  const finalAvgSold = Math.min(avgSold, Math.round(adjustedValue * 1.1));

  // Conservative buy price
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

  // Override demand/speed for common basics
  const finalDemand = (isCommonMallBrand && isBasicItem && demand === "High") ? "Medium" : demand;
  const finalSpeed = (isCommonMallBrand && isBasicItem && sellSpeed === "Fast") ? "Moderate" : sellSpeed;

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
        low: Math.round(Number(md.estimated_resale_range?.low) || Math.round(adjustedValue * 0.75)),
        high: Math.round(Number(md.estimated_resale_range?.high) || Math.round(adjustedValue * 1.25)),
      },
      average_sold_price: finalAvgSold,
      suggested_buy_price: suggestedBuyPrice,
      demand: finalDemand,
      sell_speed: finalSpeed,
      competition_level: competitionLevel,
      base_estimated_value: baseValue,
      price_adjustments: adjustments,
      adjusted_estimated_value: adjustedValue,
    },
    risk_analysis: {
      match_confidence: Math.min(100, Math.max(0, Math.round(Number(ra.match_confidence) || 50))),
      risk_flags: Array.isArray(ra.risk_flags) ? ra.risk_flags.map(String) : [],
    },
    listings: {
      ebay: {
        title: String(li.ebay?.title || "Item for Sale"),
        description: String(li.ebay?.description || "Item in good condition. See photos for details."),
      },
      depop: {
        title: String(li.depop?.title || "Cool item for sale"),
        description: String(li.depop?.description || "Great find! DM for details."),
      },
    },
  };
}
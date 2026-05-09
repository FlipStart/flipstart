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

const FAST_ANALYSIS_PROMPT = `You are FlipStart, an AI resale analyst. You may receive 1–3 labeled photos: [FRONT], [TAG], and/or [DETAIL]. Use all available photos to produce the most accurate resale analysis. Tag photos are especially valuable for brand, material, era, and authenticity. Detail photos are flexible — treat them as supporting evidence regardless of angle. Return a COMPLETE resale analysis as JSON.

IDENTIFICATION RULES:
- Only describe what you can CLEARLY SEE in the image
- Do NOT guess details you cannot verify (sleeve length, specific year, material)
- Use broad wording when uncertain
- item_name ASSEMBLY — THIS IS CRITICAL. You are naming items like an expert Depop/eBay reseller, not a chatbot.

  TITLE STRUCTURE: [ERA if confident] + [BRAND] + [GRAPHIC/LOCATION/EVENT/CHARACTER if visible] + [SPECIFIC ITEM TYPE] + [OPTIONAL ATTRIBUTE]

  STEP 1 — ERA: Include ONLY if visually supported. Use: "Vintage", "Y2K", "90s", "Early 2000s". Skip if modern or uncertain.

  STEP 2 — BRAND: Always prioritize visible brand name. e.g. "Gap", "Nike", "Harley Davidson", "Carhartt"

  STEP 3 — GRAPHIC/LOCATION/EVENT (CRITICAL — this separates good titles from generic ones):
    Actively look for and include:
    - Location/destination printed on item: "Key West", "Florida Keys", "Daytona", "Oregon", "Myrtle Beach"
    - Event/occasion: "Daytona Bike Week", "Sturgis Rally", "50th Anniversary"
    - Character/license: "Betty Boop", "Looney Tunes", "NASCAR", "NFL team name"
    - Sports team: "Packers", "Bulls", "Oregon Ducks"
    - College/university: "University of Florida", "Michigan"
    - Slogan/text if prominent and short: spellout text counts
    - Collection name if on tag or graphic
    This is the most important differentiator. "Harley Davidson Key West Tee" beats "Harley Davidson Tee" every time.

  ⚠️  GRAPHIC RULE — ONE IDENTITY ONLY:
    Pick the SINGLE most recognizable thing. Never stack multiple graphic elements.
    BAD: "Vintage Harley Davidson Motorcycle Eagle Fire Skull Tee" (spam)
    BAD: "Vintage Betty Boop Looney Tunes Character Graphic Tee" (spam)
    GOOD: "Harley Davidson Key West Long Sleeve Tee" (one location)
    GOOD: "Vintage Betty Boop Graphic Tee" (one character)
    If multiple graphics exist, pick the ONE most reseller-relevant. Location > event > character > generic graphic.

  STEP 4 — SPECIFIC ITEM TYPE (never generic):
    NEVER use: "shirt", "hoodie", "jacket" alone
    ALWAYS use the most specific type:
    - "zip-up hoodie" / "pullover hoodie" / "crewneck" / "quarter-zip"
    - "long sleeve tee" / "graphic tee" / "pocket tee" / "thermal"
    - "knit sweater" / "coogi-style sweater" / "cable knit"
    - "work jacket" / "chore coat" / "varsity jacket" / "windbreaker"
    - "mesh jersey" / "basketball jersey" / "football jersey"
    - "cargo pants" / "double knee pants" / "work pants"
    - "denim jacket" / "trucker jacket"

  STEP 5 — OPTIONAL ATTRIBUTE (only if clearly visible and adds value):
    - "mini swoosh" / "embroidered logo" / "spellout"
    - "single stitch" / "heavyweight" / "faded" / "distressed"
    - "oversized" / "boxy" / "cropped"
    - Color: OMIT unless unmistakably obvious AND confidence is extremely high. If there is ANY doubt about the color, omit it entirely. A wrong color destroys listing trust. When in doubt, leave it out.

  TARGET LENGTH: 4–11 words. Never shorter than 4. Never a SEO spam list.

  GOOD EXAMPLES (write like these):
    "Vintage Gap Zip-Up Hoodie"
    "Y2K Nike Mini Swoosh Hoodie"
    "Vintage Oregon Ducks Crewneck"
    "Harley Davidson Key West Long Sleeve Tee"
    "Vintage Florida Keys Graphic Tee"
    "Vintage Betty Boop Graphic T-Shirt"
    "50th Anniversary Harley Davidson Tee"
    "Vintage NASCAR Racing Tee"
    "Vintage Carhartt Double Knee Pants"
    "Coogi Style Knit Sweater"

  BAD EXAMPLES (never write these):
    "Gap Hoodie" / "Nike Sweatshirt" / "Harley Tee" / "Florida Shirt"
    "Comfortable Fit Hoodie" / "Stylish Casual Tee" / "Blue Shirt"

- Player/athlete names: ONLY include if name or number is clearly printed AND you are highly confident
- No brand visible: lead with era + item type, e.g. "Vintage Graphic Crewneck" or "Y2K Knit Sweater"
- material_guess: use "Unknown" only if fabric/material truly cannot be inferred
- estimated_era: NEVER default to "Unknown" — use all available evidence (see ERA DETECTION below)

COLOR SAFETY RULE — CRITICAL:
Do NOT include item color in item_name, eBay title, Depop title, or any listing copy unless:
  - The color is unmistakably, unambiguously obvious from the image
  - You have extremely high confidence (>90%) in the exact color
  - Getting the color wrong would not mislead a buyer

Most colors are ambiguous under thrift store / user photography lighting. When uncertain:
  - OMIT color from item_name and all titles/listings entirely
  - Do NOT say "appears white" or "possibly gray" — just omit
  - Do NOT guess at off-white, cream, beige, light gray — these are all easily confused
  - Colors frequently confused: white/cream/gray, navy/black/dark blue, brown/tan/rust

Safe to include color ONLY when:
  - Item is a bold, saturated, unmistakable single color (e.g. fire-engine red graphic tee, bright yellow windbreaker)
  - OR color is part of a recognizable named pattern ("striped", "plaid", "colorblock") that is visually confirmed
  - OR color is printed on the tag and confirmed with high certainty

Return colorConfidence field:
  - "high": include color in titles/listings
  - "medium": omit from titles, may note in description with caveat
  - "low": omit color entirely from all output


ERA DETECTION — CRITICAL. Determine era using every available clue:

TAG CLUES (most reliable — use the [TAG] photo heavily):
  - Tag typography, color, layout style
  - Country of manufacture: "Made in USA" (likely pre-2000s), Mexico/Honduras (90s-2000s), China/Vietnam/Bangladesh (2000s-present)
  - RN/WPL/CA numbers if visible (support age estimates)
  - Union labels = strong vintage indicator
  - Nike silver/grey tag = early 2000s
  - Woven tag vs printed tag (older woven = likely more vintage)
  - Single-line brand tag vs modern multi-info tag
  - Care label layout and symbols

CONSTRUCTION CLUES:
  - Single stitch = pre-mid 90s
  - Double stitch = 90s onward
  - Raglan vs set-in sleeve
  - Zipper style (YKK metal, plastic, etc.)
  - Heavyweight cotton vs modern blends

VISUAL/STYLE CLUES:
  - Graphic print style (airbrushed, screen print, embroidered)
  - Fading, distressing, cracking on graphic
  - Color palette and design aesthetics
  - Sports/team logo era (check if logo is current or retired)
  - College/school branding style
  - Silhouette: oversized boxy (90s/Y2K) vs slim fit (2010s) vs modern relaxed

ERA LABELS TO USE:
  - "1980s" / "Early 1980s" / "Late 1980s"
  - "1990s" / "Early 90s" / "Late 90s"
  - "Y2K / Early 2000s"
  - "2000s"
  - "2010s"
  - "Modern / 2010s–2020s"
  - "Modern, vintage-inspired"
  - "Late 90s–early 2000s"
  - "Vintage (pre-1990s)"
  - "Insufficient evidence" (ONLY when truly no clues exist — prefer a range over Unknown)

RULES:
  - Use "likely" or a range when uncertain: "Likely 90s–2000s"
  - "Unknown" is only acceptable if: no tag visible, no style clues, no construction evidence
  - Never say Unknown when modern Dri-FIT, modern logo, or new-style tag is visible — say "Modern"
  - Vintage-aesthetic modern items: "Modern, vintage-inspired"

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
{"identification":{"item_name":"","brand":"","category":"","estimated_era":"[required — use era label, not Unknown unless truly no evidence]","style_labels":[],"material_guess":"","colorConfidence":"low|medium|high","color_note":"[only populate if colorConfidence is high; otherwise empty string]"},"market_data":{"estimated_resale_range":{"low":0,"high":0},"average_sold_price":0,"suggested_buy_price":0,"demand":"","sell_speed":"","competition_level":"","base_estimated_value":0,"price_adjustments":[{"reason":"","impact":0,"type":"positive|negative"}],"adjusted_estimated_value":0},"risk_analysis":{"match_confidence":0,"risk_flags":[]}}`

/**
 * Single fast analysis — everything in one LLM call.
 */
export async function analyzeItemFast(
  base64Data: string,
  mimeType:   string,
  back?:      { base64: string; mimeType: string },
  tag?:       { base64: string; mimeType: string },
): Promise<any> {
  // Build image parts — front always present, back/tag added when available
  const imageParts: any[] = [
    {
      type:      "text",
      text:      "[FRONT] This is the front of the item. Use it for item type, style, shape, and general condition.",
    },
    {
      type:      "image_url",
      image_url: { url: `data:${mimeType};base64,${base64Data}`, detail: "high" },
    },
  ];

  if (back?.base64) {
    imageParts.push(
      { type: "text", text: "[DETAIL] This is a detail photo — flexible supporting evidence. It may show: the back of the item, a graphic close-up, embroidery, a flaw, logo, sleeve hit, texture, or any special feature. If it contains a graphic, logo, or character close-up, weight it heavily for identification and pricing." },
      { type: "image_url", image_url: { url: `data:${back.mimeType};base64,${back.base64}`, detail: "high" } },
    );
  }

  if (tag?.base64) {
    imageParts.push(
      { type: "text", text: "[TAG] This is the item's tag. Extract: brand, size, material composition, country of manufacture, RN/WPL/CA numbers, union labels, tag typography/style, care label layout. CRITICAL: Use all of this to determine the item's era. A tag is the single most reliable era indicator — do not ignore it." },
      { type: "image_url", image_url: { url: `data:${tag.mimeType};base64,${tag.base64}`, detail: "high" } },
    );
  }

  const photoCount = 1 + (back ? 1 : 0) + (tag ? 1 : 0);
  imageParts.unshift({
    type: "text",
    text: `Analyze this item for resale using ${photoCount} photo${photoCount > 1 ? 's' : ''}. Be conservative. All price adjustments must be whole dollar amounts. Return JSON only.`,
  });

  const response = await invokeLLM({
    messages: [
      { role: "system", content: FAST_ANALYSIS_PROMPT },
      {
        role:    "user",
        content: imageParts,
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

const LISTING_PROMPT = `You are writing resale listings for two platforms. Match each platform's exact culture.


COLOR SAFETY RULE (applies to ALL titles and descriptions):
- Do NOT include item color in any title or listing copy unless colorConfidence is "high"
- If colorConfidence is "medium" or "low": omit color completely
- Do NOT say "appears white", "may be gray", or any hedged color language in listings
- Buyers trust exact descriptions — wrong colors cause returns and bad reviews
- When omitting color, simply write a better title without it

EBAY:
- Title: max 80 chars. [Brand] [Item Type] [Key Detail] [Size if known]
- Description: 3-5 sentences. Professional resale tone. Cover condition, features, sizing.

DEPOP — YOU ARE A REAL DEPOP RESELLER, NOT AN AI COPYWRITER:

Title format (max 60 chars): start with the most recognizable descriptor.
Good examples: "Vintage Harley Davidson long sleeve tee" / "Nike mini swoosh hoodie" / "Y2K Coogi knit sweater" / "Vintage Packers crewneck"

Description structure:
1. Natural item ID (color + brand + type, add vintage/y2k if applicable)
2. Condition — sound human: "excellent condition" / "good vintage condition" / "lightly worn" / "minor vintage wear" / "faded perfectly" / "no major flaws" / "cracking on graphic"
3. Style note if visually obvious: oversized / boxy / heavyweight / single stitch / embroidered logo / cracked graphic / 90s vibe
4. One closing line: "ships fast" / "dm for measurements" / "open to offers" / "message with questions"
5. Exactly 5 hashtags — mix broad + niche + item-specific

CRITICAL DEPOP TONE RULES:
- Sound like a 22 year old thrift reseller, not a copywriter
- Short sentences. Casual. Confident.
- NEVER say: "perfect for" / "must-have" / "ideal for" / "fashion enthusiast" / "stylish" / "versatile" / "comfortable"
- NEVER use fake enthusiasm or Amazon/corporate language
- DO mention specific details that make this item interesting (graphic, era, brand detail, colorway)
- Keep it under 60 words total (not counting hashtags)

BAD (never write this): "This stylish vintage hoodie is perfect for casual wear. Must-have for fashion enthusiasts!"
GOOD (write like this): "Vintage Harley Davidson long sleeve from the 90s. Single stitch, faded perfectly, graphic still intact. Oversized fit.\nships fast, open to offers\n#vintage #harleydavidson #90s #streetwear #graphictee"

Do NOT invent details. Do NOT mention prices.
Return ONLY valid JSON: {"ebay":{"title":"","description":""},"depop":{"title":"","description":""}}`

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
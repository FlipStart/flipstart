/**
 * lib/color-sanitizer.ts
 *
 * Strips ambiguous color words from AI-generated titles and listing copy
 * when colorConfidence is not "high".
 *
 * This is a safety net — the AI prompt already instructs omission,
 * but this catches any leakage before it reaches the user.
 *
 * Rules:
 *   - colorConfidence "high"   → pass through unchanged
 *   - colorConfidence "medium" → strip color words from titles only
 *   - colorConfidence "low"    → strip color words from all copy
 *   - colorConfidence absent   → treat as "low"
 */

// Colors frequently guessed incorrectly under variable lighting
const AMBIGUOUS_COLORS = [
    // neutrals — most commonly wrong
    "white", "off-white", "cream", "ivory", "beige", "ecru",
    "gray", "grey", "light gray", "light grey", "charcoal",
    "black",
    // blues — navy vs black confusion is common
    "navy", "navy blue", "dark blue", "royal blue", "light blue",
    "blue", "cobalt", "powder blue", "sky blue",
    // browns/tans — tan vs beige vs brown
    "brown", "tan", "khaki", "camel", "rust", "cognac",
    // greens
    "green", "olive", "forest green", "sage", "mint",
    // reds/pinks
    "red", "burgundy", "maroon", "wine", "pink", "rose", "mauve",
    // others
    "yellow", "mustard", "orange", "purple", "lavender", "violet",
    "teal", "turquoise", "coral",
  ];
  
  /**
   * Build a regex that matches color words at word boundaries,
   * case-insensitive. Handles multi-word colors (e.g. "navy blue").
   */
  function buildColorRegex(): RegExp {
    // Sort longest first so multi-word variants match before single-word
    const sorted = [...AMBIGUOUS_COLORS].sort((a, b) => b.length - a.length);
    const escaped = sorted.map(c => c.replace(/-/g, "[-\\s]?"));
    return new RegExp(`\\b(${escaped.join("|")})\\b`, "gi");
  }
  
  const COLOR_REGEX = buildColorRegex();
  
  /**
   * Remove leading/trailing/double spaces left after stripping a word.
   */
  function cleanSpaces(text: string): string {
    return text.replace(/\s{2,}/g, " ").trim();
  }
  
  /**
   * Strip ambiguous color words from a single string.
   */
  export function stripColors(text: string): string {
    return cleanSpaces(text.replace(COLOR_REGEX, ""));
  }
  
  export type ColorConfidence = "high" | "medium" | "low" | undefined;
  
  /**
   * Sanitize an item title based on color confidence.
   * - "high"  → return as-is
   * - anything else → strip colors
   */
  export function sanitizeTitle(
    title: string,
    colorConfidence: ColorConfidence,
  ): string {
    if (colorConfidence === "high") return title;
    return stripColors(title);
  }
  
  /**
   * Sanitize a full listing object (eBay + Depop).
   * Titles always get colors stripped unless confidence high.
   * Descriptions get stripped only on "low" (or absent).
   */
  export function sanitizeListings(
    listings: {
      ebay:  { title: string; description: string };
      depop: { title: string; description: string };
    },
    colorConfidence: ColorConfidence,
  ): typeof listings {
    if (colorConfidence === "high") return listings;
  
    const stripDesc = !colorConfidence || colorConfidence === "low";
  
    return {
      ebay: {
        title:       sanitizeTitle(listings.ebay.title, colorConfidence),
        description: stripDesc ? stripColors(listings.ebay.description) : listings.ebay.description,
      },
      depop: {
        title:       sanitizeTitle(listings.depop.title, colorConfidence),
        description: stripDesc ? stripColors(listings.depop.description) : listings.depop.description,
      },
    };
  }
  
  /**
   * Sanitize just an item_name (the short display title).
   */
  export function sanitizeItemName(
    itemName: string,
    colorConfidence: ColorConfidence,
  ): string {
    return sanitizeTitle(itemName, colorConfidence);
  }
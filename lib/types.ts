export interface ScanResult {
  id: string;
  imageUri: string;
  allImageUris?: string[];  // all photos captured — front + tag + detail URIs
  timestamp: number;
  identification: {
    item_name: string;
    brand: string;
    category: string;
    estimated_era: string;
    style_labels: string[];
    material_guess: string;

    // ── Structured ID fields (v2 scan output; all optional for back-compat) ──
    // Populated on new scans. Older saved scans omit these → matcher falls back.
    canonicalBrand?: string;
    canonicalItemName?: string;
    itemType?: string;              // hoodie, jacket, jersey, jeans, bag, etc.
    subType?: string;               // pullover, zip-front, bomber, mesh, etc.
    styleVariant?: string;          // "Detroit", "Center Swoosh", "Trefoil", etc.
    modelName?: string;             // "Detroit Jacket", "Nuptse", etc.
    logoPlacement?: string;         // centerChest | leftChest | fullFront | sleeve | back | none
    eraEstimate?: string;          // canonical era guess (mirrors estimated_era)
    eraConfidence?: 'low' | 'medium' | 'high';
    eraEvidence?: string[];         // concrete evidence: "single stitch", "made in usa tag", etc.
    materialSignals?: string[];     // "duck canvas", "genuine leather", "polyester mesh"
    graphicSignals?: string[];      // graphic/print observations
    sportsTeam?: string;
    league?: string;                // NFL | NBA | MLB | NHL | NASCAR | NCAA, etc.
    playerNumber?: string;
    playerNameGuess?: string;
    playerNameConfidence?: 'low' | 'medium' | 'high';
    brandModelSignals?: string[];   // raw structured cues that fed model/variant inference
    possibleDiamondIds?: string[];  // AI's hint of which diamonds may apply
    diamondReasoningShort?: string; // one-line AI rationale (dev/debug only)
  };
  market_data: {
    estimated_resale_range: {
      low: number;
      high: number;
    };
    average_sold_price: number;
    suggested_buy_price: number;
    demand: "High" | "Medium" | "Low";
    sell_speed: "Fast" | "Moderate" | "Slow";
    competition_level: string;
    base_estimated_value: number;
    price_adjustments: {
      reason: string;
      impact: number;
      type: "positive" | "negative";
    }[];
    adjusted_estimated_value: number;
  };
  risk_analysis: {
    match_confidence: number;
    risk_flags: string[];
  };
  // Listings — undefined until user explicitly generates them.
  // Never initialized with empty strings — presence alone means real content exists.
  listings?: {
    ebay:  { title: string; description: string };
    depop: { title: string; description: string };
  } | undefined;
}
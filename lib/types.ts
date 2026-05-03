export interface ScanResult {
  id: string;
  imageUri: string;
  timestamp: number;
  identification: {
    item_name: string;
    brand: string;
    category: string;
    estimated_era: string;
    style_labels: string[];
    material_guess: string;
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
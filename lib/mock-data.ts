import { ScanResult } from "./types";

const MOCK_ITEMS: Omit<ScanResult, "id" | "imageUri" | "timestamp">[] = [
  {
    identification: {
      item_name: "Vintage Levi's 501 Jeans",
      brand: "Levi's",
      category: "Denim / Jeans",
      estimated_era: "1990s",
      style_labels: ["Vintage", "Streetwear", "Americana"],
      material_guess: "100% Cotton Denim",
    },
    market_data: {
      estimated_resale_range: { low: 45, high: 85 },
      average_sold_price: 62,
      suggested_buy_price: 15,
      demand: "High",
      sell_speed: "Fast",
      competition_level: "Medium",
      base_estimated_value: 65,
      price_adjustments: [
        { reason: "Vintage 90s era — high demand", impact: 12, type: "positive" },
        { reason: "Made in USA tag present", impact: 8, type: "positive" },
        { reason: "Minor fading on knees", impact: -5, type: "negative" },
        { reason: "Original rivets intact", impact: 5, type: "positive" },
      ],
      adjusted_estimated_value: 85,
    },
    risk_analysis: {
      match_confidence: 92,
      risk_flags: ["Minor wear visible", "Size tag faded"],
    },
    listings: {
      ebay: {
        title: "Vintage Levi's 501 Jeans 90s Made in USA Original Rivets Denim W32 L30",
        description:
          "Authentic vintage Levi's 501 button-fly jeans from the 1990s. Made in USA with original rivets and classic straight-leg fit. Features natural fading on the knees that adds character. 100% cotton denim in excellent vintage condition. Waist 32, Length 30. A must-have for any vintage denim collector.",
      },
      depop: {
        title: "90s Levi's 501 vintage jeans 🔥 made in USA",
        description:
          "the most perfect vintage 501s!! authentic 90s levi's made in usa. amazing natural fade on the knees. straight leg, button fly. these are SO good. size w32 l30. grab before they're gone 🖤",
      },
    },
  },
  {
    identification: {
      item_name: "Ralph Lauren Polo Shirt",
      brand: "Ralph Lauren",
      category: "Polo Shirt",
      estimated_era: "2000s",
      style_labels: ["Preppy", "Classic", "Casual"],
      material_guess: "100% Cotton Piqué",
    },
    market_data: {
      estimated_resale_range: { low: 18, high: 35 },
      average_sold_price: 24,
      suggested_buy_price: 6,
      demand: "Medium",
      sell_speed: "Moderate",
      competition_level: "High",
      base_estimated_value: 25,
      price_adjustments: [
        { reason: "Recognizable brand logo", impact: 5, type: "positive" },
        { reason: "Common colorway (navy)", impact: -3, type: "negative" },
        { reason: "Good overall condition", impact: 4, type: "positive" },
        { reason: "High market saturation", impact: -6, type: "negative" },
      ],
      adjusted_estimated_value: 25,
    },
    risk_analysis: {
      match_confidence: 88,
      risk_flags: ["High competition", "Common item"],
    },
    listings: {
      ebay: {
        title: "Ralph Lauren Polo Shirt Men's Navy Blue Short Sleeve Cotton Piqué Size L",
        description:
          "Classic Ralph Lauren polo shirt in navy blue. Short sleeve, 100% cotton piqué fabric with the iconic embroidered pony logo on the chest. Size Large. In excellent pre-owned condition with no stains, holes, or significant wear. Perfect for casual or smart-casual occasions.",
      },
      depop: {
        title: "Ralph Lauren polo shirt navy 💙 classic fit",
        description:
          "classic ralph lauren polo in navy blue. the logo is clean and the fabric is super soft cotton piqué. size L, fits true. no flaws at all. perfect everyday shirt ✨",
      },
    },
  },
  {
    identification: {
      item_name: "Nike Air Force 1 Low",
      brand: "Nike",
      category: "Sneakers",
      estimated_era: "2010s",
      style_labels: ["Streetwear", "Classic", "Athleisure"],
      material_guess: "Leather / Synthetic Upper",
    },
    market_data: {
      estimated_resale_range: { low: 40, high: 75 },
      average_sold_price: 55,
      suggested_buy_price: 20,
      demand: "High",
      sell_speed: "Fast",
      competition_level: "Medium",
      base_estimated_value: 55,
      price_adjustments: [
        { reason: "All-white colorway — always in demand", impact: 10, type: "positive" },
        { reason: "Sole yellowing present", impact: -8, type: "negative" },
        { reason: "Original box included", impact: 7, type: "positive" },
        { reason: "Creasing on toe box", impact: -4, type: "negative" },
      ],
      adjusted_estimated_value: 60,
    },
    risk_analysis: {
      match_confidence: 95,
      risk_flags: ["Sole yellowing", "Toe box creasing"],
    },
    listings: {
      ebay: {
        title: "Nike Air Force 1 Low White Sneakers Men's Size 10 With Original Box",
        description:
          "Nike Air Force 1 Low in the classic triple white colorway. Men's size 10. Comes with the original box. Leather and synthetic upper in good pre-owned condition. Some minor sole yellowing and toe box creasing consistent with normal wear. Still plenty of life left in these iconic sneakers.",
      },
      depop: {
        title: "Nike Air Force 1 white 🤍 with box",
        description:
          "classic white AF1s!! comes with the og box. size 10 mens. some light yellowing on the sole and minor creasing but they still look fire. the shoe that goes with everything 🔥",
      },
    },
  },
  {
    identification: {
      item_name: "Carhartt WIP Detroit Jacket",
      brand: "Carhartt WIP",
      category: "Jacket / Outerwear",
      estimated_era: "2010s",
      style_labels: ["Workwear", "Streetwear", "Utility"],
      material_guess: "Organic Cotton Canvas",
    },
    market_data: {
      estimated_resale_range: { low: 80, high: 140 },
      average_sold_price: 105,
      suggested_buy_price: 30,
      demand: "High",
      sell_speed: "Fast",
      competition_level: "Low",
      base_estimated_value: 110,
      price_adjustments: [
        { reason: "WIP line — premium resale", impact: 15, type: "positive" },
        { reason: "Detroit jacket — iconic silhouette", impact: 10, type: "positive" },
        { reason: "Small stain on cuff", impact: -7, type: "negative" },
        { reason: "Blanket-lined interior", impact: 8, type: "positive" },
      ],
      adjusted_estimated_value: 136,
    },
    risk_analysis: {
      match_confidence: 90,
      risk_flags: ["Stain on cuff — may affect price"],
    },
    listings: {
      ebay: {
        title: "Carhartt WIP Detroit Jacket Blanket Lined Organic Cotton Canvas Size M",
        description:
          "Carhartt WIP Detroit Jacket in the classic chore coat silhouette. Size Medium. Organic cotton canvas exterior with warm blanket lining. Features the iconic Carhartt WIP logo patch. Pre-owned with a small stain on the cuff (see photos). Otherwise in excellent condition. A timeless workwear piece with strong streetwear appeal.",
      },
      depop: {
        title: "Carhartt WIP Detroit jacket 🧥 blanket lined",
        description:
          "carhartt wip detroit jacket!! blanket lined so it's super warm. organic cotton canvas. size M. tiny stain on the cuff but barely noticeable. these jackets are so hard to find for a good price. don't sleep 🔥",
      },
    },
  },
];

export function getRandomMockResult(imageUri: string): ScanResult {
  const randomIndex = Math.floor(Math.random() * MOCK_ITEMS.length);
  const item = MOCK_ITEMS[randomIndex];
  return {
    ...item,
    id: Date.now().toString() + Math.random().toString(36).substring(2, 9),
    imageUri,
    timestamp: Date.now(),
  };
}

/**
 * server/founderCatalogs.ts
 *
 * Static catalog snapshot for Founder Dashboard V3 — used to label achievements,
 * brands, and diamonds and to compute "never unlocked" lists by diffing the
 * catalog against the Supabase discovery tables.
 *
 * Generated from lib/achievements.ts, lib/brandCompendium.ts, lib/diamonds.ts.
 * If you add or rename catalog entries, regenerate this file or the dashboard
 * labels / never-unlocked lists will lag the live app catalog.
 */

export interface CatalogAchievement { id: string; name: string; category: string; categoryName?: string | null; }
export interface CatalogBrand       { id: string; name: string; rarity: string; category: string | null; }
export interface CatalogDiamond     { id: string; title: string; category: string | null; label: string | null; }

export interface FounderCatalogs {
  achievements: CatalogAchievement[];
  brands: CatalogBrand[];
  diamonds: CatalogDiamond[];
}

const catalogs: FounderCatalogs = {
  "achievements": [
    {
      "id": "profit_1",
      "name": "First Dollar",
      "category": "profit"
    },
    {
      "id": "profit_50",
      "name": "Side Hustle",
      "category": "profit"
    },
    {
      "id": "profit_100",
      "name": "Flipping Forward",
      "category": "profit"
    },
    {
      "id": "profit_500",
      "name": "Gas Money",
      "category": "profit"
    },
    {
      "id": "profit_1000",
      "name": "Treasure Hunter",
      "category": "profit"
    },
    {
      "id": "profit_5000",
      "name": "Part-Time Job",
      "category": "profit"
    },
    {
      "id": "profit_10000",
      "name": "FlipStart Legend",
      "category": "profit"
    },
    {
      "id": "scan_1",
      "name": "Finally Flipping",
      "category": "scan"
    },
    {
      "id": "scan_10",
      "name": "Looking Around",
      "category": "scan"
    },
    {
      "id": "scan_100",
      "name": "Scan Machine",
      "category": "scan"
    },
    {
      "id": "scan_500",
      "name": "Scanning Fiend",
      "category": "scan"
    },
    {
      "id": "scan_1000",
      "name": "Data Hunter",
      "category": "scan"
    },
    {
      "id": "scan_5000",
      "name": "Master Scanner",
      "category": "scan"
    },
    {
      "id": "hunt_1",
      "name": "Welcome to the Hunt",
      "category": "hunt"
    },
    {
      "id": "hunt_10",
      "name": "Weekend Warrior",
      "category": "hunt"
    },
    {
      "id": "hunt_50",
      "name": "Workhorse",
      "category": "hunt"
    },
    {
      "id": "hunt_100",
      "name": "Store Raider",
      "category": "hunt"
    },
    {
      "id": "hunt_500",
      "name": "Safari Veteran",
      "category": "hunt"
    },
    {
      "id": "hunt_1000",
      "name": "King of the Hunt",
      "category": "hunt"
    },
    {
      "id": "hunt_2500",
      "name": "Hunt Mode Legend",
      "category": "hunt"
    },
    {
      "id": "streak_3",
      "name": "On Fire",
      "category": "streak"
    },
    {
      "id": "streak_7",
      "name": "Locked In",
      "category": "streak"
    },
    {
      "id": "streak_14",
      "name": "Hunt Predator",
      "category": "streak"
    },
    {
      "id": "streak_30",
      "name": "Unstoppable",
      "category": "streak"
    },
    {
      "id": "streak_100",
      "name": "Dedication Pays",
      "category": "streak"
    },
    {
      "id": "streak_365",
      "name": "Never Miss",
      "category": "streak"
    },
    {
      "id": "rare_50profit",
      "name": "Grail Find",
      "category": "rareFind"
    },
    {
      "id": "rare_100profit",
      "name": "Jackpot",
      "category": "rareFind"
    },
    {
      "id": "rare_500roi",
      "name": "Perfect Flip",
      "category": "rareFind"
    },
    {
      "id": "rare_risky",
      "name": "Risk Taker",
      "category": "rareFind"
    },
    {
      "id": "era_vintage",
      "name": "Vintage Hunter",
      "category": "era"
    },
    {
      "id": "era_y2k",
      "name": "Y2K Demon",
      "category": "era"
    },
    {
      "id": "era_modern",
      "name": "Modern Merchant",
      "category": "era"
    },
    {
      "id": "era_2010s",
      "name": "New Age Flipper",
      "category": "era"
    },
    {
      "id": "era_bandtee",
      "name": "Band Tee Bloodhound",
      "category": "era"
    },
    {
      "id": "brand_1",
      "name": "Brand Beginner",
      "category": "brand"
    },
    {
      "id": "brand_10",
      "name": "Brand Explorer",
      "category": "brand"
    },
    {
      "id": "brand_50",
      "name": "Brand Collector",
      "category": "brand"
    },
    {
      "id": "brand_100",
      "name": "Brand Encyclopedia",
      "category": "brand"
    }
  ],
  "brands": [
    {
      "id": "Nike",
      "name": "Nike",
      "rarity": "common",
      "category": "sportswear"
    },
    {
      "id": "Adidas",
      "name": "Adidas",
      "rarity": "common",
      "category": "sportswear"
    },
    {
      "id": "Air Jordan",
      "name": "Air Jordan",
      "rarity": "common",
      "category": "sportswear"
    },
    {
      "id": "Under Armour",
      "name": "Under Armour",
      "rarity": "common",
      "category": "sportswear"
    },
    {
      "id": "Reebok",
      "name": "Reebok",
      "rarity": "common",
      "category": "sportswear"
    },
    {
      "id": "Puma",
      "name": "Puma",
      "rarity": "common",
      "category": "sportswear"
    },
    {
      "id": "Champion",
      "name": "Champion",
      "rarity": "common",
      "category": "sportswear"
    },
    {
      "id": "Fila",
      "name": "Fila",
      "rarity": "common",
      "category": "sportswear"
    },
    {
      "id": "New Balance",
      "name": "New Balance",
      "rarity": "common",
      "category": "sportswear"
    },
    {
      "id": "ASICS",
      "name": "ASICS",
      "rarity": "common",
      "category": "sportswear"
    },
    {
      "id": "Skechers",
      "name": "Skechers",
      "rarity": "common",
      "category": "sportswear"
    },
    {
      "id": "Russell Athletic",
      "name": "Russell Athletic",
      "rarity": "common",
      "category": "sportswear"
    },
    {
      "id": "Avia",
      "name": "Avia",
      "rarity": "common",
      "category": "sportswear"
    },
    {
      "id": "Tek Gear",
      "name": "Tek Gear",
      "rarity": "common",
      "category": "sportswear"
    },
    {
      "id": "Danskin",
      "name": "Danskin",
      "rarity": "common",
      "category": "sportswear"
    },
    {
      "id": "Athletic Works",
      "name": "Athletic Works",
      "rarity": "common",
      "category": "sportswear"
    },
    {
      "id": "Levi's",
      "name": "Levi's",
      "rarity": "common",
      "category": "denim"
    },
    {
      "id": "Lee",
      "name": "Lee",
      "rarity": "common",
      "category": "denim"
    },
    {
      "id": "Wrangler",
      "name": "Wrangler",
      "rarity": "common",
      "category": "denim"
    },
    {
      "id": "Dickies",
      "name": "Dickies",
      "rarity": "common",
      "category": "denim"
    },
    {
      "id": "Rustler",
      "name": "Rustler",
      "rarity": "common",
      "category": "denim"
    },
    {
      "id": "American Eagle",
      "name": "American Eagle",
      "rarity": "common",
      "category": "denim"
    },
    {
      "id": "Hollister",
      "name": "Hollister",
      "rarity": "common",
      "category": "denim"
    },
    {
      "id": "Abercrombie & Fitch",
      "name": "Abercrombie & Fitch",
      "rarity": "common",
      "category": "denim"
    },
    {
      "id": "Aeropostale",
      "name": "Aeropostale",
      "rarity": "common",
      "category": "denim"
    },
    {
      "id": "Gap",
      "name": "Gap",
      "rarity": "common",
      "category": "denim"
    },
    {
      "id": "Old Navy",
      "name": "Old Navy",
      "rarity": "common",
      "category": "denim"
    },
    {
      "id": "Banana Republic",
      "name": "Banana Republic",
      "rarity": "common",
      "category": "denim"
    },
    {
      "id": "Express",
      "name": "Express",
      "rarity": "common",
      "category": "denim"
    },
    {
      "id": "Arizona",
      "name": "Arizona",
      "rarity": "common",
      "category": "denim"
    },
    {
      "id": "Lucky Brand",
      "name": "Lucky Brand",
      "rarity": "common",
      "category": "denim"
    },
    {
      "id": "H&M",
      "name": "H&M",
      "rarity": "common",
      "category": "denim"
    },
    {
      "id": "Zara",
      "name": "Zara",
      "rarity": "common",
      "category": "denim"
    },
    {
      "id": "Forever 21",
      "name": "Forever 21",
      "rarity": "common",
      "category": "denim"
    },
    {
      "id": "Shein",
      "name": "Shein",
      "rarity": "common",
      "category": "denim"
    },
    {
      "id": "Fashion Nova",
      "name": "Fashion Nova",
      "rarity": "common",
      "category": "denim"
    },
    {
      "id": "Tommy Bahama",
      "name": "Tommy Bahama",
      "rarity": "common",
      "category": "menswear"
    },
    {
      "id": "Tommy Hilfiger",
      "name": "Tommy Hilfiger",
      "rarity": "common",
      "category": "menswear"
    },
    {
      "id": "Calvin Klein",
      "name": "Calvin Klein",
      "rarity": "common",
      "category": "menswear"
    },
    {
      "id": "Nautica",
      "name": "Nautica",
      "rarity": "common",
      "category": "menswear"
    },
    {
      "id": "Guess",
      "name": "Guess",
      "rarity": "common",
      "category": "menswear"
    },
    {
      "id": "Izod",
      "name": "Izod",
      "rarity": "common",
      "category": "menswear"
    },
    {
      "id": "Van Heusen",
      "name": "Van Heusen",
      "rarity": "common",
      "category": "menswear"
    },
    {
      "id": "Dockers",
      "name": "Dockers",
      "rarity": "common",
      "category": "menswear"
    },
    {
      "id": "Arrow",
      "name": "Arrow",
      "rarity": "common",
      "category": "menswear"
    },
    {
      "id": "Stafford",
      "name": "Stafford",
      "rarity": "common",
      "category": "menswear"
    },
    {
      "id": "Haggar",
      "name": "Haggar",
      "rarity": "common",
      "category": "menswear"
    },
    {
      "id": "Kenneth Cole Reaction",
      "name": "Kenneth Cole Reaction",
      "rarity": "common",
      "category": "menswear"
    },
    {
      "id": "Perry Ellis",
      "name": "Perry Ellis",
      "rarity": "common",
      "category": "menswear"
    },
    {
      "id": "Claiborne",
      "name": "Claiborne",
      "rarity": "common",
      "category": "menswear"
    },
    {
      "id": "Chaps",
      "name": "Chaps",
      "rarity": "common",
      "category": "menswear"
    },
    {
      "id": "Geoffrey Beene",
      "name": "Geoffrey Beene",
      "rarity": "common",
      "category": "menswear"
    },
    {
      "id": "Brooks Brothers",
      "name": "Brooks Brothers",
      "rarity": "common",
      "category": "menswear"
    },
    {
      "id": "Apt. 9",
      "name": "Apt. 9",
      "rarity": "common",
      "category": "womenswear"
    },
    {
      "id": "Croft & Barrow",
      "name": "Croft & Barrow",
      "rarity": "common",
      "category": "womenswear"
    },
    {
      "id": "St. John's Bay",
      "name": "St. John's Bay",
      "rarity": "common",
      "category": "womenswear"
    },
    {
      "id": "Sonoma",
      "name": "Sonoma",
      "rarity": "common",
      "category": "womenswear"
    },
    {
      "id": "Sonoma Goods for Life",
      "name": "Sonoma Goods for Life",
      "rarity": "common",
      "category": "womenswear"
    },
    {
      "id": "A New Day",
      "name": "A New Day",
      "rarity": "common",
      "category": "womenswear"
    },
    {
      "id": "Ann Taylor",
      "name": "Ann Taylor",
      "rarity": "common",
      "category": "womenswear"
    },
    {
      "id": "LOFT",
      "name": "LOFT",
      "rarity": "common",
      "category": "womenswear"
    },
    {
      "id": "Talbots",
      "name": "Talbots",
      "rarity": "common",
      "category": "womenswear"
    },
    {
      "id": "Chico's",
      "name": "Chico's",
      "rarity": "common",
      "category": "womenswear"
    },
    {
      "id": "J. Jill",
      "name": "J. Jill",
      "rarity": "common",
      "category": "womenswear"
    },
    {
      "id": "Worthington",
      "name": "Worthington",
      "rarity": "common",
      "category": "womenswear"
    },
    {
      "id": "Dana Buchman",
      "name": "Dana Buchman",
      "rarity": "common",
      "category": "womenswear"
    },
    {
      "id": "Cato",
      "name": "Cato",
      "rarity": "common",
      "category": "womenswear"
    },
    {
      "id": "Charter Club",
      "name": "Charter Club",
      "rarity": "common",
      "category": "womenswear"
    },
    {
      "id": "Lane Bryant",
      "name": "Lane Bryant",
      "rarity": "common",
      "category": "womenswear"
    },
    {
      "id": "Torrid",
      "name": "Torrid",
      "rarity": "common",
      "category": "womenswear"
    },
    {
      "id": "Liz Claiborne",
      "name": "Liz Claiborne",
      "rarity": "common",
      "category": "womenswear"
    },
    {
      "id": "Columbia",
      "name": "Columbia",
      "rarity": "common",
      "category": "outdoor"
    },
    {
      "id": "Eddie Bauer",
      "name": "Eddie Bauer",
      "rarity": "common",
      "category": "outdoor"
    },
    {
      "id": "Lands' End",
      "name": "Lands' End",
      "rarity": "common",
      "category": "outdoor"
    },
    {
      "id": "L.L.Bean",
      "name": "L.L.Bean",
      "rarity": "common",
      "category": "outdoor"
    },
    {
      "id": "Woolrich",
      "name": "Woolrich",
      "rarity": "common",
      "category": "outdoor"
    },
    {
      "id": "JanSport",
      "name": "JanSport",
      "rarity": "common",
      "category": "outdoor"
    },
    {
      "id": "Mossy Oak",
      "name": "Mossy Oak",
      "rarity": "common",
      "category": "outdoor"
    },
    {
      "id": "Realtree",
      "name": "Realtree",
      "rarity": "common",
      "category": "outdoor"
    },
    {
      "id": "Converse",
      "name": "Converse",
      "rarity": "common",
      "category": "footwear"
    },
    {
      "id": "Vans",
      "name": "Vans",
      "rarity": "common",
      "category": "footwear"
    },
    {
      "id": "Crocs",
      "name": "Crocs",
      "rarity": "common",
      "category": "footwear"
    },
    {
      "id": "Carter's",
      "name": "Carter's",
      "rarity": "common",
      "category": "kids"
    },
    {
      "id": "OshKosh B'gosh",
      "name": "OshKosh B'gosh",
      "rarity": "common",
      "category": "kids"
    },
    {
      "id": "Jumping Beans",
      "name": "Jumping Beans",
      "rarity": "common",
      "category": "kids"
    },
    {
      "id": "Hanes",
      "name": "Hanes",
      "rarity": "common",
      "category": "basics"
    },
    {
      "id": "Fruit of the Loom",
      "name": "Fruit of the Loom",
      "rarity": "common",
      "category": "basics"
    },
    {
      "id": "Gildan",
      "name": "Gildan",
      "rarity": "common",
      "category": "basics"
    },
    {
      "id": "Jerzees",
      "name": "Jerzees",
      "rarity": "common",
      "category": "basics"
    },
    {
      "id": "Port & Company",
      "name": "Port & Company",
      "rarity": "common",
      "category": "basics"
    },
    {
      "id": "Bella + Canvas",
      "name": "Bella + Canvas",
      "rarity": "common",
      "category": "basics"
    },
    {
      "id": "Tultex",
      "name": "Tultex",
      "rarity": "common",
      "category": "basics"
    },
    {
      "id": "Anvil",
      "name": "Anvil",
      "rarity": "common",
      "category": "basics"
    },
    {
      "id": "Comfort Colors",
      "name": "Comfort Colors",
      "rarity": "common",
      "category": "basics"
    },
    {
      "id": "PGA Tour",
      "name": "PGA Tour",
      "rarity": "common",
      "category": "golf"
    },
    {
      "id": "Ben Hogan",
      "name": "Ben Hogan",
      "rarity": "common",
      "category": "golf"
    },
    {
      "id": "Life is Good",
      "name": "Life is Good",
      "rarity": "common",
      "category": "sportswear"
    },
    {
      "id": "Route 66",
      "name": "Route 66",
      "rarity": "common",
      "category": "denim"
    },
    {
      "id": "Uniqlo",
      "name": "Uniqlo",
      "rarity": "common",
      "category": "denim"
    },
    {
      "id": "Goodfellow & Co",
      "name": "Goodfellow & Co",
      "rarity": "common",
      "category": "basics"
    },
    {
      "id": "George",
      "name": "George",
      "rarity": "common",
      "category": "basics"
    },
    {
      "id": "Faded Glory",
      "name": "Faded Glory",
      "rarity": "common",
      "category": "basics"
    },
    {
      "id": "No Boundaries",
      "name": "No Boundaries",
      "rarity": "common",
      "category": "denim"
    },
    {
      "id": "Time and Tru",
      "name": "Time and Tru",
      "rarity": "common",
      "category": "womenswear"
    },
    {
      "id": "Universal Thread",
      "name": "Universal Thread",
      "rarity": "common",
      "category": "womenswear"
    },
    {
      "id": "Wild Fable",
      "name": "Wild Fable",
      "rarity": "common",
      "category": "womenswear"
    },
    {
      "id": "Mossimo",
      "name": "Mossimo",
      "rarity": "common",
      "category": "denim"
    },
    {
      "id": "Merona",
      "name": "Merona",
      "rarity": "common",
      "category": "womenswear"
    },
    {
      "id": "The North Face",
      "name": "The North Face",
      "rarity": "uncommon",
      "category": "outdoor"
    },
    {
      "id": "Marmot",
      "name": "Marmot",
      "rarity": "uncommon",
      "category": "outdoor"
    },
    {
      "id": "Mountain Hardwear",
      "name": "Mountain Hardwear",
      "rarity": "uncommon",
      "category": "outdoor"
    },
    {
      "id": "Prana",
      "name": "Prana",
      "rarity": "uncommon",
      "category": "outdoor"
    },
    {
      "id": "KÜHL",
      "name": "KÜHL",
      "rarity": "uncommon",
      "category": "outdoor"
    },
    {
      "id": "Outdoor Research",
      "name": "Outdoor Research",
      "rarity": "uncommon",
      "category": "outdoor"
    },
    {
      "id": "Smartwool",
      "name": "Smartwool",
      "rarity": "uncommon",
      "category": "outdoor"
    },
    {
      "id": "Cotopaxi",
      "name": "Cotopaxi",
      "rarity": "uncommon",
      "category": "outdoor"
    },
    {
      "id": "Fjällräven",
      "name": "Fjällräven",
      "rarity": "uncommon",
      "category": "outdoor"
    },
    {
      "id": "Carhartt",
      "name": "Carhartt",
      "rarity": "uncommon",
      "category": "workwear"
    },
    {
      "id": "Duluth Trading",
      "name": "Duluth Trading",
      "rarity": "uncommon",
      "category": "workwear"
    },
    {
      "id": "Ariat",
      "name": "Ariat",
      "rarity": "uncommon",
      "category": "workwear"
    },
    {
      "id": "Timberland",
      "name": "Timberland",
      "rarity": "uncommon",
      "category": "workwear"
    },
    {
      "id": "Wolverine",
      "name": "Wolverine",
      "rarity": "uncommon",
      "category": "workwear"
    },
    {
      "id": "Orvis",
      "name": "Orvis",
      "rarity": "uncommon",
      "category": "outdoor"
    },
    {
      "id": "Quiksilver",
      "name": "Quiksilver",
      "rarity": "uncommon",
      "category": "streetwear"
    },
    {
      "id": "Billabong",
      "name": "Billabong",
      "rarity": "uncommon",
      "category": "streetwear"
    },
    {
      "id": "Volcom",
      "name": "Volcom",
      "rarity": "uncommon",
      "category": "streetwear"
    },
    {
      "id": "O'Neill",
      "name": "O'Neill",
      "rarity": "uncommon",
      "category": "streetwear"
    },
    {
      "id": "Hurley",
      "name": "Hurley",
      "rarity": "uncommon",
      "category": "streetwear"
    },
    {
      "id": "RVCA",
      "name": "RVCA",
      "rarity": "uncommon",
      "category": "streetwear"
    },
    {
      "id": "Brixton",
      "name": "Brixton",
      "rarity": "uncommon",
      "category": "streetwear"
    },
    {
      "id": "Polo Ralph Lauren",
      "name": "Polo Ralph Lauren",
      "rarity": "uncommon",
      "category": "menswear"
    },
    {
      "id": "J.Crew",
      "name": "J.Crew",
      "rarity": "uncommon",
      "category": "menswear"
    },
    {
      "id": "Madewell",
      "name": "Madewell",
      "rarity": "uncommon",
      "category": "menswear"
    },
    {
      "id": "Vineyard Vines",
      "name": "Vineyard Vines",
      "rarity": "uncommon",
      "category": "menswear"
    },
    {
      "id": "Southern Tide",
      "name": "Southern Tide",
      "rarity": "uncommon",
      "category": "menswear"
    },
    {
      "id": "Pendleton",
      "name": "Pendleton",
      "rarity": "uncommon",
      "category": "menswear"
    },
    {
      "id": "London Fog",
      "name": "London Fog",
      "rarity": "uncommon",
      "category": "outdoor"
    },
    {
      "id": "Free People",
      "name": "Free People",
      "rarity": "uncommon",
      "category": "womenswear"
    },
    {
      "id": "Anthropologie",
      "name": "Anthropologie",
      "rarity": "uncommon",
      "category": "womenswear"
    },
    {
      "id": "Urban Outfitters",
      "name": "Urban Outfitters",
      "rarity": "uncommon",
      "category": "womenswear"
    },
    {
      "id": "Johnny Was",
      "name": "Johnny Was",
      "rarity": "uncommon",
      "category": "womenswear"
    },
    {
      "id": "Eileen Fisher",
      "name": "Eileen Fisher",
      "rarity": "uncommon",
      "category": "womenswear"
    },
    {
      "id": "Soft Surroundings",
      "name": "Soft Surroundings",
      "rarity": "uncommon",
      "category": "womenswear"
    },
    {
      "id": "Sundance",
      "name": "Sundance",
      "rarity": "uncommon",
      "category": "womenswear"
    },
    {
      "id": "Boden",
      "name": "Boden",
      "rarity": "uncommon",
      "category": "womenswear"
    },
    {
      "id": "Flax",
      "name": "Flax",
      "rarity": "uncommon",
      "category": "womenswear"
    },
    {
      "id": "Lululemon",
      "name": "Lululemon",
      "rarity": "uncommon",
      "category": "sportswear"
    },
    {
      "id": "Athleta",
      "name": "Athleta",
      "rarity": "uncommon",
      "category": "sportswear"
    },
    {
      "id": "Alo Yoga",
      "name": "Alo Yoga",
      "rarity": "uncommon",
      "category": "sportswear"
    },
    {
      "id": "Gymshark",
      "name": "Gymshark",
      "rarity": "uncommon",
      "category": "sportswear"
    },
    {
      "id": "Vuori",
      "name": "Vuori",
      "rarity": "uncommon",
      "category": "sportswear"
    },
    {
      "id": "TravisMathew",
      "name": "TravisMathew",
      "rarity": "uncommon",
      "category": "golf"
    },
    {
      "id": "Peter Millar",
      "name": "Peter Millar",
      "rarity": "uncommon",
      "category": "golf"
    },
    {
      "id": "FootJoy",
      "name": "FootJoy",
      "rarity": "uncommon",
      "category": "golf"
    },
    {
      "id": "Titleist",
      "name": "Titleist",
      "rarity": "uncommon",
      "category": "golf"
    },
    {
      "id": "Callaway",
      "name": "Callaway",
      "rarity": "uncommon",
      "category": "golf"
    },
    {
      "id": "Birkenstock",
      "name": "Birkenstock",
      "rarity": "uncommon",
      "category": "footwear"
    },
    {
      "id": "Dr. Martens",
      "name": "Dr. Martens",
      "rarity": "uncommon",
      "category": "footwear"
    },
    {
      "id": "Merrell",
      "name": "Merrell",
      "rarity": "uncommon",
      "category": "footwear"
    },
    {
      "id": "Keen",
      "name": "Keen",
      "rarity": "uncommon",
      "category": "footwear"
    },
    {
      "id": "UGG",
      "name": "UGG",
      "rarity": "uncommon",
      "category": "footwear"
    },
    {
      "id": "Sperry",
      "name": "Sperry",
      "rarity": "uncommon",
      "category": "footwear"
    },
    {
      "id": "Fossil",
      "name": "Fossil",
      "rarity": "uncommon",
      "category": "accessories"
    },
    {
      "id": "Tumi",
      "name": "Tumi",
      "rarity": "uncommon",
      "category": "accessories"
    },
    {
      "id": "Vera Bradley",
      "name": "Vera Bradley",
      "rarity": "uncommon",
      "category": "accessories"
    },
    {
      "id": "Dooney & Bourke",
      "name": "Dooney & Bourke",
      "rarity": "uncommon",
      "category": "accessories"
    },
    {
      "id": "Brighton",
      "name": "Brighton",
      "rarity": "uncommon",
      "category": "accessories"
    },
    {
      "id": "Oakley",
      "name": "Oakley",
      "rarity": "uncommon",
      "category": "accessories"
    },
    {
      "id": "Costa",
      "name": "Costa",
      "rarity": "uncommon",
      "category": "accessories"
    },
    {
      "id": "Maui Jim",
      "name": "Maui Jim",
      "rarity": "uncommon",
      "category": "accessories"
    },
    {
      "id": "Harley-Davidson",
      "name": "Harley-Davidson",
      "rarity": "uncommon",
      "category": "workwear"
    },
    {
      "id": "Members Only",
      "name": "Members Only",
      "rarity": "uncommon",
      "category": "workwear"
    },
    {
      "id": "Rock Revival",
      "name": "Rock Revival",
      "rarity": "uncommon",
      "category": "workwear"
    },
    {
      "id": "Miss Me",
      "name": "Miss Me",
      "rarity": "uncommon",
      "category": "workwear"
    },
    {
      "id": "Silver Jeans",
      "name": "Silver Jeans",
      "rarity": "uncommon",
      "category": "workwear"
    },
    {
      "id": "BKE",
      "name": "BKE",
      "rarity": "uncommon",
      "category": "workwear"
    },
    {
      "id": "True Religion",
      "name": "True Religion",
      "rarity": "uncommon",
      "category": "workwear"
    },
    {
      "id": "Red Kap",
      "name": "Red Kap",
      "rarity": "uncommon",
      "category": "workwear"
    },
    {
      "id": "Clints",
      "name": "Clints",
      "rarity": "uncommon",
      "category": "workwear"
    },
    {
      "id": "Patagonia",
      "name": "Patagonia",
      "rarity": "rare",
      "category": "outdoor"
    },
    {
      "id": "Arc'teryx",
      "name": "Arc'teryx",
      "rarity": "rare",
      "category": "outdoor"
    },
    {
      "id": "Filson",
      "name": "Filson",
      "rarity": "rare",
      "category": "outdoor"
    },
    {
      "id": "Sitka",
      "name": "Sitka",
      "rarity": "rare",
      "category": "outdoor"
    },
    {
      "id": "Kuiu",
      "name": "Kuiu",
      "rarity": "rare",
      "category": "outdoor"
    },
    {
      "id": "Mystery Ranch",
      "name": "Mystery Ranch",
      "rarity": "rare",
      "category": "outdoor"
    },
    {
      "id": "Barbour",
      "name": "Barbour",
      "rarity": "rare",
      "category": "outdoor"
    },
    {
      "id": "BAPE",
      "name": "BAPE",
      "rarity": "rare",
      "category": "streetwear"
    },
    {
      "id": "Kith",
      "name": "Kith",
      "rarity": "rare",
      "category": "streetwear"
    },
    {
      "id": "Palace",
      "name": "Palace",
      "rarity": "rare",
      "category": "streetwear"
    },
    {
      "id": "Anti Social Social Club",
      "name": "Anti Social Social Club",
      "rarity": "rare",
      "category": "streetwear"
    },
    {
      "id": "FTP",
      "name": "FTP",
      "rarity": "rare",
      "category": "streetwear"
    },
    {
      "id": "Pleasures",
      "name": "Pleasures",
      "rarity": "rare",
      "category": "streetwear"
    },
    {
      "id": "Fear of God",
      "name": "Fear of God",
      "rarity": "rare",
      "category": "streetwear"
    },
    {
      "id": "Stüssy",
      "name": "Stüssy",
      "rarity": "rare",
      "category": "streetwear"
    },
    {
      "id": "Aimé Leon Dore",
      "name": "Aimé Leon Dore",
      "rarity": "rare",
      "category": "streetwear"
    },
    {
      "id": "Coach",
      "name": "Coach",
      "rarity": "rare",
      "category": "luxury"
    },
    {
      "id": "MCM",
      "name": "MCM",
      "rarity": "rare",
      "category": "luxury"
    },
    {
      "id": "Telfar",
      "name": "Telfar",
      "rarity": "rare",
      "category": "luxury"
    },
    {
      "id": "Rimowa",
      "name": "Rimowa",
      "rarity": "rare",
      "category": "accessories"
    },
    {
      "id": "Schott NYC",
      "name": "Schott NYC",
      "rarity": "rare",
      "category": "workwear"
    },
    {
      "id": "Red Wing",
      "name": "Red Wing",
      "rarity": "rare",
      "category": "workwear"
    },
    {
      "id": "Golden Goose",
      "name": "Golden Goose",
      "rarity": "rare",
      "category": "footwear"
    },
    {
      "id": "Ben Davis",
      "name": "Ben Davis",
      "rarity": "rare",
      "category": "workwear"
    },
    {
      "id": "Stan Ray",
      "name": "Stan Ray",
      "rarity": "rare",
      "category": "workwear"
    },
    {
      "id": "Kapital",
      "name": "Kapital",
      "rarity": "rare",
      "category": "streetwear"
    },
    {
      "id": "Needles",
      "name": "Needles",
      "rarity": "rare",
      "category": "streetwear"
    },
    {
      "id": "RRL",
      "name": "RRL",
      "rarity": "rare",
      "category": "menswear"
    },
    {
      "id": "Louis Vuitton",
      "name": "Louis Vuitton",
      "rarity": "legendary",
      "category": "luxury"
    },
    {
      "id": "Gucci",
      "name": "Gucci",
      "rarity": "legendary",
      "category": "luxury"
    },
    {
      "id": "Chanel",
      "name": "Chanel",
      "rarity": "legendary",
      "category": "luxury"
    },
    {
      "id": "Dior",
      "name": "Dior",
      "rarity": "legendary",
      "category": "luxury"
    },
    {
      "id": "Hermès",
      "name": "Hermès",
      "rarity": "legendary",
      "category": "luxury"
    },
    {
      "id": "Prada",
      "name": "Prada",
      "rarity": "legendary",
      "category": "luxury"
    },
    {
      "id": "Fendi",
      "name": "Fendi",
      "rarity": "legendary",
      "category": "luxury"
    },
    {
      "id": "Burberry",
      "name": "Burberry",
      "rarity": "legendary",
      "category": "luxury"
    },
    {
      "id": "Balenciaga",
      "name": "Balenciaga",
      "rarity": "legendary",
      "category": "luxury"
    },
    {
      "id": "Givenchy",
      "name": "Givenchy",
      "rarity": "legendary",
      "category": "luxury"
    },
    {
      "id": "Loro Piana",
      "name": "Loro Piana",
      "rarity": "legendary",
      "category": "luxury"
    },
    {
      "id": "Brunello Cucinelli",
      "name": "Brunello Cucinelli",
      "rarity": "legendary",
      "category": "luxury"
    },
    {
      "id": "Kiton",
      "name": "Kiton",
      "rarity": "legendary",
      "category": "luxury"
    },
    {
      "id": "Stefano Ricci",
      "name": "Stefano Ricci",
      "rarity": "legendary",
      "category": "luxury"
    },
    {
      "id": "Chrome Hearts",
      "name": "Chrome Hearts",
      "rarity": "legendary",
      "category": "streetwear"
    },
    {
      "id": "Supreme",
      "name": "Supreme",
      "rarity": "legendary",
      "category": "streetwear"
    },
    {
      "id": "Hellstar",
      "name": "Hellstar",
      "rarity": "legendary",
      "category": "streetwear"
    },
    {
      "id": "Stone Island",
      "name": "Stone Island",
      "rarity": "legendary",
      "category": "streetwear"
    },
    {
      "id": "Pele Pele",
      "name": "Pele Pele",
      "rarity": "legendary",
      "category": "streetwear"
    },
    {
      "id": "Visvim",
      "name": "Visvim",
      "rarity": "legendary",
      "category": "streetwear"
    },
    {
      "id": "Undercover",
      "name": "Undercover",
      "rarity": "legendary",
      "category": "streetwear"
    },
    {
      "id": "Comme des Garçons",
      "name": "Comme des Garçons",
      "rarity": "legendary",
      "category": "streetwear"
    },
    {
      "id": "Yohji Yamamoto",
      "name": "Yohji Yamamoto",
      "rarity": "legendary",
      "category": "streetwear"
    },
    {
      "id": "Issey Miyake",
      "name": "Issey Miyake",
      "rarity": "legendary",
      "category": "streetwear"
    },
    {
      "id": "Amiri",
      "name": "Amiri",
      "rarity": "legendary",
      "category": "streetwear"
    },
    {
      "id": "Gallery Dept.",
      "name": "Gallery Dept.",
      "rarity": "legendary",
      "category": "streetwear"
    },
    {
      "id": "Rick Owens",
      "name": "Rick Owens",
      "rarity": "legendary",
      "category": "streetwear"
    },
    {
      "id": "Maison Margiela",
      "name": "Maison Margiela",
      "rarity": "legendary",
      "category": "streetwear"
    },
    {
      "id": "Jean Paul Gaultier",
      "name": "Jean Paul Gaultier",
      "rarity": "legendary",
      "category": "streetwear"
    },
    {
      "id": "Canada Goose",
      "name": "Canada Goose",
      "rarity": "legendary",
      "category": "luxury"
    },
    {
      "id": "Moncler",
      "name": "Moncler",
      "rarity": "legendary",
      "category": "luxury"
    },
    {
      "id": "Rolex",
      "name": "Rolex",
      "rarity": "legendary",
      "category": "accessories"
    },
    {
      "id": "Cartier",
      "name": "Cartier",
      "rarity": "legendary",
      "category": "accessories"
    },
    {
      "id": "Tiffany & Co.",
      "name": "Tiffany & Co.",
      "rarity": "legendary",
      "category": "accessories"
    }
  ],
  "diamonds": [
    {
      "id": "vintage_harley_tee",
      "title": "Vintage Harley-Davidson Tee",
      "category": "americana",
      "label": "Americana Grail"
    },
    {
      "id": "vintage_harley_jacket",
      "title": "Vintage Harley-Davidson Jacket",
      "category": "americana",
      "label": "Americana Grail"
    },
    {
      "id": "motorcycle_rally_tee",
      "title": "Motorcycle Rally Tee",
      "category": "americana",
      "label": "Rally Relic"
    },
    {
      "id": "sturgis_tee",
      "title": "Sturgis Tee",
      "category": "americana",
      "label": "Rally Grail"
    },
    {
      "id": "vintage_levis_jacket",
      "title": "Vintage Levi's Denim Jacket",
      "category": "heritage",
      "label": "Denim Grail"
    },
    {
      "id": "vintage_levis_501",
      "title": "Vintage Levi's 501 Jeans",
      "category": "heritage",
      "label": "Denim Grail"
    },
    {
      "id": "made_in_usa_levis",
      "title": "Made in USA Levi's",
      "category": "heritage",
      "label": "Denim Relic"
    },
    {
      "id": "vintage_leather_jacket",
      "title": "Vintage Leather Jacket",
      "category": "heritage",
      "label": "Leather Relic"
    },
    {
      "id": "vintage_military_jacket",
      "title": "Vintage Military Jacket",
      "category": "heritage",
      "label": "Surplus Grail"
    },
    {
      "id": "vintage_varsity_jacket",
      "title": "Vintage Varsity Jacket",
      "category": "heritage",
      "label": "Letterman Relic"
    },
    {
      "id": "vintage_western_shirt",
      "title": "Vintage Western Pearl Snap Shirt",
      "category": "heritage",
      "label": "Western Relic"
    },
    {
      "id": "polo_rl_rugby_shirt",
      "title": "Ralph Lauren Rugby Shirt",
      "category": "heritage",
      "label": "Preppy Grail"
    },
    {
      "id": "vintage_flannel",
      "title": "Vintage Flannel",
      "category": "heritage",
      "label": "Flannel Relic"
    },
    {
      "id": "vintage_workwear",
      "title": "Vintage Workwear Piece",
      "category": "heritage",
      "label": "Workwear Relic"
    },
    {
      "id": "vintage_carhartt_jacket",
      "title": "Vintage Carhartt Jacket",
      "category": "heritage",
      "label": "Workwear Grail"
    },
    {
      "id": "carhartt_detroit_jacket",
      "title": "Carhartt Detroit Jacket",
      "category": "heritage",
      "label": "Workwear Grail"
    },
    {
      "id": "nike_center_swoosh",
      "title": "Nike Center Swoosh",
      "category": "sportswear",
      "label": "Swoosh Grail"
    },
    {
      "id": "vintage_nike_piece",
      "title": "Vintage Nike Piece",
      "category": "sportswear",
      "label": "Swoosh Relic"
    },
    {
      "id": "vintage_adidas_trefoil",
      "title": "Vintage Adidas Trefoil Piece",
      "category": "sportswear",
      "label": "Trefoil Relic"
    },
    {
      "id": "vintage_starter_jacket",
      "title": "Vintage Starter Jacket",
      "category": "sportswear",
      "label": "Starter Grail"
    },
    {
      "id": "champion_reverse_weave",
      "title": "Champion Reverse Weave",
      "category": "sportswear",
      "label": "Reverse Weave Relic"
    },
    {
      "id": "vintage_sports_team_tee",
      "title": "Vintage Sports Team Tee",
      "category": "sportswear",
      "label": "Fan Relic"
    },
    {
      "id": "vintage_college_sweat",
      "title": "Vintage College Sweatshirt",
      "category": "sportswear",
      "label": "Campus Relic"
    },
    {
      "id": "vintage_jersey",
      "title": "Vintage Jersey",
      "category": "sportswear",
      "label": "Jersey Grail"
    },
    {
      "id": "vintage_band_tee",
      "title": "Vintage Band Tee",
      "category": "music",
      "label": "Band Grail"
    },
    {
      "id": "concert_tour_tee",
      "title": "Concert Tour Tee",
      "category": "music",
      "label": "Tour Relic"
    },
    {
      "id": "vintage_music_promo",
      "title": "Vintage Music Promo Piece",
      "category": "music",
      "label": "Promo Relic"
    },
    {
      "id": "vintage_rap_tee",
      "title": "Vintage Rap Tee",
      "category": "music",
      "label": "Rap Tee Grail"
    },
    {
      "id": "nascar_jacket",
      "title": "NASCAR Jacket",
      "category": "americana",
      "label": "Racing Grail"
    },
    {
      "id": "nascar_tee",
      "title": "NASCAR Tee",
      "category": "americana",
      "label": "Racing Relic"
    },
    {
      "id": "racing_team_jacket",
      "title": "Racing Team Jacket",
      "category": "americana",
      "label": "Pit Crew Relic"
    },
    {
      "id": "vintage_beer_promo_tee",
      "title": "Vintage Beer Promo Tee",
      "category": "americana",
      "label": "Tap Room Relic"
    },
    {
      "id": "vintage_casino_tee",
      "title": "Vintage Casino Tee",
      "category": "americana",
      "label": "High Roller Relic"
    },
    {
      "id": "vintage_souvenir_tee",
      "title": "Vintage Souvenir Tee",
      "category": "americana",
      "label": "Souvenir Relic"
    },
    {
      "id": "patagonia_synchilla",
      "title": "Patagonia Synchilla",
      "category": "outdoor",
      "label": "Synchilla Grail"
    },
    {
      "id": "vintage_patagonia",
      "title": "Vintage Patagonia Piece",
      "category": "outdoor",
      "label": "Patagonia Relic"
    },
    {
      "id": "filson_item",
      "title": "Filson Item",
      "category": "outdoor",
      "label": "Filson Grail"
    },
    {
      "id": "vintage_hunting_jacket",
      "title": "Vintage Hunting Jacket",
      "category": "outdoor",
      "label": "Field Relic"
    },
    {
      "id": "vintage_camo_piece",
      "title": "Vintage Camo Piece",
      "category": "outdoor",
      "label": "Camo Relic"
    },
    {
      "id": "vintage_outdoor_vest",
      "title": "Vintage Outdoor Vest",
      "category": "outdoor",
      "label": "Vest Relic"
    },
    {
      "id": "woolrich_wool_piece",
      "title": "Woolrich Wool Piece",
      "category": "outdoor",
      "label": "Woolrich Relic"
    },
    {
      "id": "llbean_vintage",
      "title": "L.L.Bean Vintage Piece",
      "category": "outdoor",
      "label": "Heritage Relic"
    },
    {
      "id": "tnf_nuptse",
      "title": "The North Face Nuptse",
      "category": "outdoor",
      "label": "Nuptse Grail"
    },
    {
      "id": "arcteryx_shell",
      "title": "Arc'teryx Shell",
      "category": "outdoor",
      "label": "Techwear Grail"
    },
    {
      "id": "supreme_item",
      "title": "Supreme Item",
      "category": "streetwear",
      "label": "Hype Grail"
    },
    {
      "id": "bape_item",
      "title": "BAPE Item",
      "category": "streetwear",
      "label": "Hype Grail"
    },
    {
      "id": "kith_item",
      "title": "Kith Item",
      "category": "streetwear",
      "label": "Hype Relic"
    },
    {
      "id": "palace_item",
      "title": "Palace Item",
      "category": "streetwear",
      "label": "Hype Relic"
    },
    {
      "id": "vintage_stussy",
      "title": "Vintage Stussy Piece",
      "category": "streetwear",
      "label": "OG Streetwear"
    },
    {
      "id": "fear_of_god_item",
      "title": "Fear of God Item",
      "category": "streetwear",
      "label": "Hype Grail"
    },
    {
      "id": "chrome_hearts_item",
      "title": "Chrome Hearts Item",
      "category": "streetwear",
      "label": "Holy Grail Hype"
    },
    {
      "id": "vintage_coach_bag",
      "title": "Vintage Coach Bag",
      "category": "fashion",
      "label": "Leather Grail"
    },
    {
      "id": "vintage_dooney_bag",
      "title": "Vintage Dooney & Bourke Bag",
      "category": "fashion",
      "label": "Leather Relic"
    },
    {
      "id": "vintage_leather_purse",
      "title": "Vintage Leather Purse",
      "category": "fashion",
      "label": "Leather Relic"
    },
    {
      "id": "vintage_designer_silk_scarf",
      "title": "Vintage Designer Silk Scarf",
      "category": "fashion",
      "label": "Silk Grail"
    },
    {
      "id": "vintage_designer_handbag",
      "title": "Vintage Designer Handbag",
      "category": "fashion",
      "label": "Designer Grail"
    },
    {
      "id": "juicy_couture_velour",
      "title": "Juicy Couture Velour Piece",
      "category": "fashion",
      "label": "Velour Icon"
    },
    {
      "id": "vintage_vs_piece",
      "title": "Vintage Victoria's Secret Piece",
      "category": "fashion",
      "label": "Boudoir Relic"
    },
    {
      "id": "gunne_sax_dress",
      "title": "Gunne Sax Dress",
      "category": "fashion",
      "label": "Prairie Grail"
    },
    {
      "id": "vintage_formal_dress",
      "title": "Vintage Formal Dress",
      "category": "fashion",
      "label": "Gown Relic"
    },
    {
      "id": "vintage_fur_coat",
      "title": "Vintage Fur or Faux Fur Coat",
      "category": "fashion",
      "label": "Glamour Relic"
    },
    {
      "id": "vintage_leather_boots",
      "title": "Vintage Leather Boots",
      "category": "fashion",
      "label": "Boot Relic"
    },
    {
      "id": "vintage_denim_skirt",
      "title": "Vintage Denim Skirt",
      "category": "fashion",
      "label": "Denim Relic"
    },
    {
      "id": "free_people_statement",
      "title": "Free People Statement Piece",
      "category": "fashion",
      "label": "Boho Relic"
    },
    {
      "id": "anthropologie_statement",
      "title": "Anthropologie Statement Piece",
      "category": "fashion",
      "label": "Boutique Relic"
    },
    {
      "id": "y2k_graphic_tee",
      "title": "Y2K Graphic Tee",
      "category": "y2k",
      "label": "Y2K Grail"
    },
    {
      "id": "y2k_baggy_denim",
      "title": "Y2K Baggy Denim",
      "category": "y2k",
      "label": "Y2K Relic"
    },
    {
      "id": "y2k_track_jacket",
      "title": "Y2K Track Jacket",
      "category": "y2k",
      "label": "Y2K Relic"
    },
    {
      "id": "y2k_cargo_pants",
      "title": "Y2K Cargo Pants",
      "category": "y2k",
      "label": "Y2K Relic"
    },
    {
      "id": "y2k_rhinestone_piece",
      "title": "Y2K Rhinestone Piece",
      "category": "y2k",
      "label": "Bling Grail"
    },
    {
      "id": "y2k_baby_tee",
      "title": "Y2K Baby Tee",
      "category": "y2k",
      "label": "Y2K Relic"
    },
    {
      "id": "y2k_designer_bag",
      "title": "Y2K Designer-Inspired Bag",
      "category": "y2k",
      "label": "It-Bag Relic"
    },
    {
      "id": "vintage_watch",
      "title": "Vintage Watch",
      "category": "oddity",
      "label": "Timepiece Grail"
    },
    {
      "id": "vintage_sunglasses",
      "title": "Vintage Sunglasses",
      "category": "oddity",
      "label": "Shade Relic"
    },
    {
      "id": "vintage_belt_buckle",
      "title": "Vintage Belt Buckle",
      "category": "oddity",
      "label": "Buckle Relic"
    },
    {
      "id": "sterling_silver_jewelry",
      "title": "Sterling Silver Jewelry",
      "category": "oddity",
      "label": "Silver Grail"
    },
    {
      "id": "turquoise_jewelry",
      "title": "Turquoise Jewelry",
      "category": "oddity",
      "label": "Southwest Grail"
    },
    {
      "id": "vintage_snapback",
      "title": "Vintage Snapback",
      "category": "oddity",
      "label": "Cap Relic"
    },
    {
      "id": "vintage_trucker_hat",
      "title": "Vintage Trucker Hat",
      "category": "oddity",
      "label": "Mesh Relic"
    },
    {
      "id": "rare_plush",
      "title": "Rare Plush",
      "category": "oddity",
      "label": "Plush Grail"
    },
    {
      "id": "vintage_video_game",
      "title": "Vintage Video Game",
      "category": "oddity",
      "label": "Cartridge Grail"
    },
    {
      "id": "vintage_camera",
      "title": "Vintage Camera",
      "category": "oddity",
      "label": "Optics Relic"
    },
    {
      "id": "old_concert_poster",
      "title": "Old Concert Poster",
      "category": "oddity",
      "label": "Print Grail"
    }
  ]
};

export const achievements = catalogs.achievements;
export const brands       = catalogs.brands;
export const diamonds     = catalogs.diamonds;
export default catalogs;
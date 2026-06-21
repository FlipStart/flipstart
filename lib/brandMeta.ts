/**
 * lib/brandMeta.ts
 *
 * FILE PATH: lib/brandMeta.ts
 *
 * Pass 2 — static brand metadata for the Brand Detail Page.
 * Keyed by canonical brand name (from brandCompendium ALL_BRANDS).
 *
 * Only a curated subset of brands has full metadata; everything else
 * falls back to a sensible rarity/category-based default via getBrandMeta().
 * This keeps the file maintainable while every brand still renders a page.
 *
 * `domain` is the brand's primary web domain (e.g. "gucci.com"). It is used
 * to construct a logo URL at runtime via a logo API (Clearbit / Brandfetch);
 * no logo images are bundled into the app. See getBrandLogoUrl() below.
 */

import { ALL_BRANDS, CATEGORY_LABELS, RARITY_LABELS, type BrandRarity } from '@/lib/brandCompendium';

export type ResalePotential = 'Low' | 'Moderate' | 'High' | 'Very High' | 'Elite';

export interface BrandMeta {
  country:      string;
  founded:      string;        // year as string ("1938"), or "—" if unknown
  description:  string;        // 100–150 words for curated brands
  resale:       ResalePotential;
  demand:       number;        // 0–10, one decimal
  sellSpeed:    string;        // "Fast" | "Moderate" | "Slow" etc.
  products:     string[];      // common product types
  domain?:      string;        // primary web domain for logo API (e.g. "nike.com")
}

/**
 * Build a logo URL from a brand's domain using a logo API.
 * Swap the provider here in one place. Clearbit is free + no key required.
 * Brandfetch alt: `https://cdn.brandfetch.io/${domain}/w/400/h/400`
 * Returns null when no domain is known (caller shows the letter monogram).
 */
export function getBrandLogoUrl(domain?: string): string | null {
  if (!domain) return null;
  return `https://logo.clearbit.com/${domain}`;
}

// ─── Curated metadata ─────────────────────────────────────────────────────────

const META: Record<string, BrandMeta> = {
  // ── Sportswear / common (Pass-1 curated; descriptions expand in their tier pass) ──
  'Nike': {
    country: 'United States', founded: '1964', domain: 'nike.com',
    description: 'Nike was founded in 1964 as Blue Ribbon Sports by Phil Knight and his track coach Bill Bowerman, rebranding as Nike (for the Greek goddess of victory) in 1971 with the now-ubiquitous Swoosh. It is the world\'s largest athletic brand, spanning footwear, apparel, and the Jordan and Converse subsidiaries. On the resale market Nike is the dominant force in sneakers and a thrift powerhouse in apparel: limited and collaboration sneakers (Travis Scott, Off-White, Sacai, Dunk SB) command large premiums and sell out instantly, while vintage tees, windbreakers, and pieces with older "swoosh" tags or the vintage "blue tag" are actively collected. Value depends on the model, collaboration, colorway, era of the tag, size, and condition; hyped collaborations and rare vintage carry the highest premiums, and authentication is critical since Nike is among the most counterfeited brands worldwide.',
    resale: 'High', demand: 8.4, sellSpeed: 'Fast',
    products: ['Sneakers', 'Hoodies', 'Track Jackets', 'Vintage Tees'],
  },
  'Adidas': {
    country: 'Germany', founded: '1949', domain: 'adidas.com',
    description: 'Adidas was founded in 1949 in Herzogenaurach, Germany, by Adi Dassler (after splitting from his brother Rudolf, who founded Puma), and built a global sportswear empire around its three-stripe branding and trefoil logo. Icons include the Stan Smith, Superstar, Samba, Gazelle, and the Originals heritage line. On the resale market Adidas is strong and fast-moving: the Samba and Gazelle surged into must-have status, collaborations (Wales Bonner, Bad Bunny, and the now-ended Yeezy line) command significant premiums, and vintage trefoil track jackets and pieces from the 70s–90s are actively collected. Value depends on the model, collaboration, colorway, era, size, and condition; sought-after collaborations and rare vintage carry the strongest premiums, and authentication matters for hyped silhouettes since popular models are widely faked.',
    resale: 'High', demand: 8.1, sellSpeed: 'Fast',
    products: ['Track Jackets', 'Sneakers', 'Soccer Jerseys', 'Windbreakers'],
  },
  'Air Jordan': {
    country: 'United States', founded: '1984', domain: 'nike.com',
    description: 'Air Jordan is Nike\'s premium basketball line, established in 1984 around Michael Jordan, with the first Air Jordan 1 releasing in 1985 amid an NBA "banned" marketing legend that helped launch sneaker culture itself. Now a standalone Jordan Brand, it spans the numbered AJ1 through AJ39 plus lifestyle apparel. On the resale market Air Jordan is the single most influential name in sneaker reselling: retro releases, original "OG" colorways, and collaborations (Travis Scott, Dior, Off-White, Fragment) are among the most traded and most valuable sneakers in the world, often reselling well above retail. The AJ1 in particular anchors the entire resale market. Value depends on the model, colorway, collaboration, size, and condition (deadstock commands the most); hyped and OG colorways carry the strongest premiums, and authentication is essential given rampant counterfeiting.',
    resale: 'Very High', demand: 9.1, sellSpeed: 'Fast',
    products: ['Sneakers', 'Jerseys', 'Hoodies'],
  },
  'Carhartt': {
    country: 'United States', founded: '1889', domain: 'carhartt.com',
    description: 'Carhartt was founded in Detroit in 1889 by Hamilton Carhartt, who began making sturdy overalls for railroad workers and built the brand on a "honest value for an honest dollar" philosophy. For over a century it has been the definitive American workwear name, known for duck canvas chore coats, the Detroit and Active jackets, bib overalls, and the durable construction that holds up to hard labor. On the resale market Carhartt is a thrift-and-reseller powerhouse with broad, fast demand: well-worn vintage chore coats and jackets are highly sought for their patina, and the streetwear-focused Carhartt WIP (Work In Progress) line and its collaborations command premiums well above the mainline. Faded, broken-in pieces are often more valuable, not less. Value depends on the line (mainline vs. WIP), era, model, and condition; WIP collaborations carry the strongest premiums.',
    resale: 'High', demand: 8.0, sellSpeed: 'Fast',
    products: ['Work Jackets', 'Overalls', 'Beanies', 'Hoodies'],
  },
  'Levi\'s': {
    country: 'United States', founded: '1853', domain: 'levi.com',
    description: 'Levi Strauss & Co. was founded in 1853 in San Francisco, and in 1873 patented the copper-riveted work pant—inventing the modern blue jean—with the 501 becoming the most iconic denim garment ever made. It remains the world\'s most recognizable denim brand. On the resale market Levi\'s has strong, steady demand driven heavily by vintage: pre-1971 "Big E" pieces, redline selvedge denim, the 501XX, vintage Type I/II/III trucker jackets, and rare washes are avidly collected and can command high premiums, while Levi\'s Vintage Clothing reissues and collaborations add further interest. Value depends heavily on the era (vintage selvedge and Big E lead), the cut, any hidden-rivet or single-stitch details, size, and condition; sought-after vintage denim and trucker jackets are the most valuable resale items, while modern mainline jeans trade at accessible prices.',
    resale: 'Moderate', demand: 7.2, sellSpeed: 'Moderate',
    products: ['Denim Jeans', 'Trucker Jackets', 'Vintage Selvedge', '501 Originals'],
  },
  'The North Face': {
    country: 'United States', founded: '1966', domain: 'thenorthface.com',
    description: 'The North Face was founded in 1966 by Doug and Susie Tompkins as a small mountaineering retail and mail-order shop in San Francisco\'s North Beach—its grand opening famously featured the Grateful Dead. Named for the coldest, most demanding side of a mountain, it grew into one of the world\'s leading outdoor brands and is now owned by VF Corporation. Signature products include the Nuptse down jacket, Denali fleece, and Summit Series technical shells. On the resale market The North Face is a thrift-and-reseller staple with broad, fast-moving demand: vintage 90s fleece and Nuptse puffers, retro logo pieces, and especially the sold-out Supreme x The North Face and Gucci collaborations command strong premiums. Value depends on the era, model, colorway, and condition; collaborations and discontinued vintage pieces carry the highest premiums, and authenticating tags and logos matters for hyped items.',
    resale: 'High', demand: 8.3, sellSpeed: 'Fast',
    products: ['Fleece Jackets', 'Puffer Jackets', 'Shells', 'Backpacks'],
  },
  'Patagonia': {
    country: 'United States', founded: '1973', domain: 'patagonia.com',
    description: 'Patagonia was founded in 1973 by climber Yvon Chouinard, growing out of his earlier business making climbing hardware. It became the benchmark for high-quality technical outdoor apparel and a pioneer of corporate environmentalism—famously pledging its profits to the planet and running its "Don\'t Buy This Jacket" anti-consumption campaign. The Synchilla fleece, Retro-X, Nano Puff, and Baggies shorts are signatures. On the resale market Patagonia is a thrift-and-reseller favorite with unusually durable demand: vintage fleece and the "deep pile" pieces from the 80s and 90s are highly collectible, older labels (especially the original logo tags) command premiums, and the brand\'s lifetime repair guarantee keeps even used pieces desirable. Patagonia rarely discounts, which supports secondhand prices. Condition, era of the tag, and rare colorways are the main value drivers for collectors.',
    resale: 'Very High', demand: 8.7, sellSpeed: 'Fast',
    products: ['Fleece Jackets', 'Hiking Pants', 'Vests', 'Technical Shells'],
  },
  'Polo Ralph Lauren': {
    country: 'United States', founded: '1967', domain: 'ralphlauren.com',
    description: 'Ralph Lauren launched his company in 1967, beginning with a line of wide neckties before building an all-American lifestyle empire under the Polo Ralph Lauren label, anchored by the embroidered polo-player logo and a preppy, aspirational aesthetic. The brand spans the iconic mesh polo shirt, oxford button-downs, cable-knit sweaters, and a deep catalog of sub-lines. On the resale market Polo is a thrift-and-collector favorite with broad demand: vintage 80s and 90s pieces are especially hot, with the Polo Sport, Snow Beach (made legendary by Raekwon), Stadium 1992, and P-Wing collections commanding serious premiums, and the CP-93 and other rare sportswear capsules treated as grails. Big embroidered logos and bold vintage prints drive value. Value depends on the era, sub-line, rarity, and condition; the sought-after vintage capsules are heavily faked, so authentication of tags and embroidery matters.',
    resale: 'High', demand: 7.9, sellSpeed: 'Moderate',
    products: ['Polo Shirts', 'Knit Sweaters', 'Oxford Shirts', 'Vintage Outerwear'],
  },
  'Arc\'teryx': {
    country: 'Canada', founded: '1989', domain: 'arcteryx.com',
    description: 'Arc\'teryx was founded in 1989 in North Vancouver, British Columbia, Canada, becoming the benchmark for premium technical outerwear through obsessive precision construction, minimal-seam designs, and GORE-TEX shells—symbolized by its Archaeopteryx fossil logo. On the resale market Arc\'teryx has intense, fast demand: its hardshell jackets (Alpha SV, Beta), the Atom and Cerium insulation pieces, and especially the Veilance line and collaborations (with Beams, Palace, and others) are avidly sought by outdoor, gorpcore, and techwear buyers, with discontinued colorways, hard-to-find sizes, and collaborations commanding significant premiums. Value depends on the model (Alpha SV and Veilance lead), any collaboration, the colorway, size, and condition; sought-after shells and collaboration pieces carry the strongest premiums and resell quickly, while even standard pieces hold value well, making Arc\'teryx one of the strongest resale performers in outerwear.',
    resale: 'Very High', demand: 9.0, sellSpeed: 'Fast',
    products: ['Gore-Tex Shells', 'Hardshell Jackets', 'Insulated Coats', 'Veilance'],
  },
  'Stüssy': {
    country: 'United States', founded: '1980', domain: 'stussy.com',
    description: 'Stüssy was founded around 1980 by Shawn Stussy, who began scrawling his now-iconic hand-styled signature logo—derived from his own surname tag—onto surfboards he shaped in Laguna Beach, California, then onto T-shirts. It is widely credited as one of the original streetwear brands, bridging surf, skate, punk, and hip-hop, and its "International Stüssy Tribe" helped pioneer the global streetwear network. On the resale market Stüssy holds steady, broad demand: vintage 80s and 90s pieces with the original scrawl logo are collectible, and the brand\'s modern collaborations (Nike, Dior, Birkenstock, Our Legacy) sell out and command premiums. Its World Tour and chapter-store tees are perennial favorites. Authentication centers on the hand-style logo accuracy, era-correct tags and stitching, and—for collaborations—standard verification of the partner brand\'s details.',
    resale: 'High', demand: 8.2, sellSpeed: 'Fast',
    products: ['Graphic Tees', 'Hoodies', 'Caps', 'Crewnecks'],
  },

  // ── LEGENDARY TIER (fully curated, 100–150 words each) ──────────────────────
  'Louis Vuitton': {
    country: 'France', founded: '1854', domain: 'louisvuitton.com',
    description: 'Founded in Paris in 1854 by trunk-maker Louis Vuitton, the house began by crafting flat-topped, stackable luggage for the era of rail and steamship travel. Its signature Monogram canvas, introduced in 1896, remains one of the most recognized patterns in the world and the most counterfeited, which is why authentication matters enormously at resale. Now the flagship label of the LVMH group, Louis Vuitton spans handbags, leather goods, ready-to-wear, and luggage. On the secondhand market it is a blue-chip name: classic Speedy, Neverfull, and Keepall styles hold value exceptionally well, vintage monogram pieces are perennially in demand, and limited artist collaborations (Murakami, Supreme, Yayoi Kusama) can sell for multiples of retail. Date codes, stitching, and hardware are the first things experienced buyers check.',
    resale: 'Elite', demand: 9.6, sellSpeed: 'Fast',
    products: ['Monogram Bags', 'Wallets', 'Belts', 'Luggage'],
  },
  'Gucci': {
    country: 'Italy', founded: '1921', domain: 'gucci.com',
    description: 'Gucci was founded in Florence in 1921 by Guccio Gucci, who began selling fine leather goods and luggage inspired by the luxury luggage he saw working at London hotels. The house built its identity on Italian craftsmanship and signature motifs: the interlocking double-G, the green-red-green web stripe, the horsebit loafer, and the bamboo-handle bag. After a creative resurgence under Tom Ford in the 1990s and again under Alessandro Michele in the 2010s, Gucci became one of fashion\'s most commercially powerful names. On the resale market it is consistently strong: vintage monogram bags, horsebit loafers, and logo knitwear move quickly, and well-kept handbags retain solid value. Because Gucci is heavily faked, serial tags, controlled-quality cards, and hardware finishing are key authentication points.',
    resale: 'Elite', demand: 9.5, sellSpeed: 'Fast',
    products: ['Handbags', 'Loafers', 'Belts', 'Logo Knitwear'],
  },
  'Chanel': {
    country: 'France', founded: '1910', domain: 'chanel.com',
    description: 'Chanel was founded by Gabrielle "Coco" Chanel in Paris in 1910, beginning with a millinery shop before revolutionizing womenswear with jersey fabrics, the little black dress, and relaxed elegance that freed women from corsetry. Karl Lagerfeld\'s long tenure from 1983 cemented its modern dominance. Icons include the quilted 2.55 and Classic Flap bags, the collarless tweed jacket, costume pearls, and the interlocking double-C logo. Chanel is among the most investment-grade names in fashion resale: the brand raises retail prices aggressively and frequently, which pushes secondhand values of classic flap bags steadily upward, often beating inflation. Authentic vintage Chanel, especially flap bags and tweed, is highly liquid. Serial stickers, hologram cards, and consistent quilting and hardware are essential authentication markers given the volume of counterfeits.',
    resale: 'Elite', demand: 9.6, sellSpeed: 'Fast',
    products: ['Flap Bags', 'Tweed Jackets', 'Costume Jewelry', 'Quilted Leather'],
  },
  'Dior': {
    country: 'France', founded: '1946', domain: 'dior.com',
    description: 'Christian Dior founded his Paris house in 1946, and his 1947 debut collection—nicknamed the "New Look" for its nipped waists and full skirts—redefined postwar fashion overnight. Now part of LVMH, Dior spans haute couture, ready-to-wear, leather goods, and a powerful menswear line revitalized by Kim Jones. Signature pieces include the Lady Dior bag (made famous by Princess Diana), the Saddle bag, the Book Tote, and the cannage quilting motif. On the resale market Dior is a top-tier performer: the Saddle bag\'s nostalgia-driven comeback sent vintage examples soaring, the Lady Dior holds value strongly, and Dior menswear sneakers and collaborations carry hype premiums. Authentication centers on date stamps, "Christian Dior" heat stamps, and the quality of hardware and cannage stitching.',
    resale: 'Elite', demand: 9.4, sellSpeed: 'Fast',
    products: ['Saddle Bags', 'Lady Dior', 'Book Tote', 'Sneakers'],
  },
  'Hermès': {
    country: 'France', founded: '1837', domain: 'hermes.com',
    description: 'Hermès began in 1837 as a Paris harness and saddle workshop serving European nobility, and that equestrian heritage still defines its obsessive leather craftsmanship. It remains family-controlled and famously refuses to chase trends. The Birkin and Kelly bags are the pinnacle of the entire luxury resale market: hand-made by a single artisan over many hours, sold in deliberately limited quantities, and often impossible to buy at retail without history with the brand. As a result, sought-after Birkins routinely resell above retail and are treated as genuine alternative assets, with exotic leathers reaching six figures. Silk scarves, Oran sandals, and H-buckle belts are more accessible entry points. Authentication is highly specialized—blind stamps, even stitching, and hardware are scrutinized closely given the stakes.',
    resale: 'Elite', demand: 9.7, sellSpeed: 'Fast',
    products: ['Birkin Bags', 'Kelly Bags', 'Silk Scarves', 'Leather Belts'],
  },
  'Prada': {
    country: 'Italy', founded: '1913', domain: 'prada.com',
    description: 'Prada was founded in Milan in 1913 by Mario Prada as a luxury leather goods and luggage house. It transformed under his granddaughter Miuccia Prada, who took over in 1978 and introduced the now-iconic black nylon (Pocono) backpacks and bags in the 1980s—turning an industrial fabric into a status symbol. Prada is known for intellectual, often deliberately "ugly-chic" design and the triangular metal logo plate. On the resale market it is consistently strong, and the early-2000s nylon revival has made vintage Prada nylon bags and the re-issued Cleo and Re-Edition lines especially hot with younger buyers. Saffiano leather totes and logo accessories also move well. Authentication focuses on the enameled logo triangle, lining stitching, and metal hardware stamps.',
    resale: 'Elite', demand: 9.2, sellSpeed: 'Fast',
    products: ['Nylon Bags', 'Saffiano Leather', 'Re-Edition Bags', 'Logo Accessories'],
  },
  'Fendi': {
    country: 'Italy', founded: '1925', domain: 'fendi.com',
    description: 'Fendi was founded in Rome in 1925 as a fur and leather house by Edoardo and Adele Fendi. Karl Lagerfeld joined in 1965 and stayed for over five decades—one of fashion\'s longest creative partnerships—creating the double-F "Zucca" logo and reinventing fur as a modern luxury. Now part of LVMH, Fendi is known for the Baguette bag (immortalized by Sex and the City), the Peekaboo, and the Selleria leather line. On the resale market the Baguette\'s nostalgia comeback has driven strong demand for vintage examples, FF-logo pieces are perennially popular, and Fendi\'s collaborations (notably with Versace as "Fendace") attract collectors. Authentication relies on the precise FF pattern alignment, hologram tags, and the quality of zippers and hardware.',
    resale: 'Elite', demand: 9.0, sellSpeed: 'Fast',
    products: ['Baguette Bags', 'Peekaboo', 'FF Logo Pieces', 'Leather Goods'],
  },
  'Burberry': {
    country: 'United Kingdom', founded: '1856', domain: 'burberry.com',
    description: 'Burberry was founded in 1856 by Thomas Burberry, who invented gabardine—a breathable, weatherproof fabric that led to the trench coat worn by British officers in WWI. That trench, along with the instantly recognizable camel-black-red-white check, remains the brand\'s core identity. Burberry occupies an accessible-luxury position, blending heritage British outerwear with modern fashion under designers like Christopher Bailey and Riccardo Tisci. On the resale market the trench coat is an evergreen staple that holds value well, vintage Nova-check scarves and shirts are highly sought, and the early-2000s logomania revival has lifted demand for checked accessories. Burberry is heavily counterfeited, so buyers check check-pattern alignment, authentic woven labels, horse-knight logos, and the quality of buttons and lining.',
    resale: 'Very High', demand: 8.6, sellSpeed: 'Fast',
    products: ['Trench Coats', 'Check Scarves', 'Shirts', 'Outerwear'],
  },
  'Balenciaga': {
    country: 'Spain', founded: '1919', domain: 'balenciaga.com',
    description: 'Balenciaga was founded by Spanish couturier Cristóbal Balenciaga in 1919, opening in San Sebastián before moving to Paris in 1937. Revered by peers as "the master" of cut and construction, the house was historically a couture powerhouse. Its modern era under Demna transformed it into a streetwear-influenced juggernaut known for chunky Triple S and Speed sneakers, the City and Hourglass bags, oversized hoodies, and deliberately provocative "irony" pieces. On the resale market Balenciaga is hype-driven and trend-sensitive: sneakers and logo apparel move fast when a silhouette is current, the City bag retains a loyal vintage following, and limited collaborations carry premiums. Because demand can swing with trends, timing matters. Authentication checks serial cards, mirror tags, and hardware and stitching quality.',
    resale: 'Very High', demand: 8.9, sellSpeed: 'Fast',
    products: ['Sneakers', 'City Bag', 'Hourglass Bag', 'Logo Apparel'],
  },
  'Givenchy': {
    country: 'France', founded: '1952', domain: 'givenchy.com',
    description: 'Hubert de Givenchy founded his Paris house in 1952 and became synonymous with refined elegance, most famously dressing Audrey Hepburn on and off screen, including the little black dress in Breakfast at Tiffany\'s. Now part of LVMH, Givenchy gained a major streetwear-luxury following under Riccardo Tisci (2005–2017), whose Rottweiler and shark-print sweatshirts and Bambi tees became defining hype pieces of the early 2010s. The house is known for the Antigona bag, gothic-leaning graphics, and sharp tailoring. On the resale market Tisci-era graphic pieces remain collectible and sought, the Antigona holds steady demand, and logo apparel moves at moderate-to-fast pace. Authentication focuses on print quality and placement, interior tags, date stamps, and the finishing of zippers and hardware.',
    resale: 'Very High', demand: 8.5, sellSpeed: 'Fast',
    products: ['Antigona Bag', 'Graphic Sweatshirts', 'Tees', 'Tailoring'],
  },
  'Loro Piana': {
    country: 'Italy', founded: '1924', domain: 'loropiana.com',
    description: 'Loro Piana, formally established in 1924 in northern Italy, is the world\'s foremost name in ultra-luxury textiles, specializing in cashmere, vicuña, baby cashmere, and superfine merino. The family business controls its supply chain from raw fiber to finished garment and is now majority-owned by LVMH. It is the definitive "quiet luxury" brand—almost entirely logo-free, recognized instead by exceptional material quality and craftsmanship, including the iconic Open Walk suede shoe and the Summer Walk loafer. On the resale market Loro Piana attracts a discerning, knowledgeable buyer: prices are high because raw materials (vicuña especially) are extraordinarily expensive, and well-kept knitwear, jackets, and shoes hold value steadily rather than spiking. Demand is durable rather than hype-driven; condition and fiber content drive value.',
    resale: 'Elite', demand: 8.8, sellSpeed: 'Moderate',
    products: ['Cashmere Knitwear', 'Open Walk Shoes', 'Jackets', 'Scarves'],
  },
  'Brunello Cucinelli': {
    country: 'Italy', founded: '1978', domain: 'brunellocucinelli.com',
    description: 'Brunello Cucinelli founded his namesake company in 1978 in the medieval Italian village of Solomeo, beginning with dyed cashmere sweaters. Built on a philosophy of "humanistic capitalism," the brand is a pillar of quiet luxury, prized for impeccable Italian cashmere, relaxed tailoring, and an understated neutral palette with virtually no visible logos. It signals wealth through fabric, fit, and finishing rather than branding—the so-called "stealth wealth" aesthetic that surged in popularity in recent years. On the resale market Cucinelli is sought by buyers who recognize quality without logos: cashmere knitwear, sport coats, and the monili-beaded pieces hold value well, and the brand\'s consistency keeps demand steady. Because there are no loud logos, authentication relies on labels, material hand-feel, and the distinctive quality of construction and detailing.',
    resale: 'Elite', demand: 8.6, sellSpeed: 'Moderate',
    products: ['Cashmere Sweaters', 'Sport Coats', 'Trousers', 'Knitwear'],
  },
  'Kiton': {
    country: 'Italy', founded: '1968', domain: 'kiton.com',
    description: 'Kiton was founded in Naples in 1968 by Ciro Paone, built on the Neapolitan tradition of hand-tailoring widely regarded as the finest in the world. The brand\'s motto is "the best of the best plus one," and its suits and sport coats are largely handmade by master tailors, with the most exclusive K50 line limited to a tiny annual production. Kiton is the connoisseur\'s tailoring house—soft-shouldered Neapolitan construction, exceptional fabrics, and almost no overt branding. On the resale market it appeals to a niche of menswear enthusiasts who understand its value: hand-tailored suits, sport coats, and the famously expensive vicuña pieces hold value among informed buyers, though liquidity is slower than logo-driven luxury. Fit, fabric, hand-stitching evidence, and the seven-fold ties are key authenticity signals.',
    resale: 'Elite', demand: 8.4, sellSpeed: 'Moderate',
    products: ['Hand-Tailored Suits', 'Sport Coats', 'Seven-Fold Ties', 'Knitwear'],
  },
  'Stefano Ricci': {
    country: 'Italy', founded: '1972', domain: 'stefanoricci.com',
    description: 'Stefano Ricci founded his luxury menswear house in Florence in 1972, beginning with neckties and growing into a full ultra-premium lifestyle brand. It is among the most exclusive and expensive menswear labels in the world, known for opulent silk ties, hand-finished shirts, crocodile-leather goods, and richly detailed tailoring aimed at a clientele that prizes overt, confident luxury rather than understatement. The aesthetic is bold—eagle-crest hardware, intricate jacquards, and statement materials. On the resale market Stefano Ricci is a niche name with a smaller buyer pool, but authentic pieces—particularly silk ties, crocodile accessories, and outerwear—command high prices among those who recognize the brand. Liquidity is slower than mainstream luxury. Authentication centers on the eagle logo, silk quality, exotic-leather CITES documentation, and the standard of hand-finishing.',
    resale: 'Elite', demand: 8.2, sellSpeed: 'Moderate',
    products: ['Silk Ties', 'Dress Shirts', 'Crocodile Goods', 'Outerwear'],
  },
  'Chrome Hearts': {
    country: 'United States', founded: '1988', domain: 'chromehearts.com',
    description: 'Chrome Hearts was founded in Los Angeles in 1988 by Richard Stark, beginning with handcrafted sterling silver jewelry and leather goods rooted in motorcycle and rock culture. It grew into a cult luxury powerhouse defined by gothic cross motifs, fleur-de-lis dagger designs, and heavy sterling hardware. The brand deliberately limits distribution—no e-commerce, products sold only through a handful of boutiques—which manufactures scarcity and fuels resale. On the secondhand market Chrome Hearts commands elite prices: silver rings, pendants, and the heavily branded graphic tees and hoodies (often featuring the cross and "Chrome Hearts" Old English text) resell for large multiples of an accessible brand, and rare pieces or celebrity collaborations soar. Heavy counterfeiting makes authentication critical—silver hallmarks, weight, stamping precision, and stitching are all scrutinized closely.',
    resale: 'Elite', demand: 9.3, sellSpeed: 'Fast',
    products: ['Silver Jewelry', 'Graphic Tees', 'Hoodies', 'Leather Goods'],
  },
  'Supreme': {
    country: 'United States', founded: '1994', domain: 'supremenewyork.com',
    description: 'Supreme was founded in 1994 by James Jebbia as a downtown Manhattan skate shop, and it became the defining streetwear brand of its era by mastering scarcity. Weekly "drops" of limited quantities, the instantly recognizable red box logo, and a relentless stream of collaborations created a hype engine that turned T-shirts and accessories into resale commodities. On the secondhand market Supreme is a benchmark: box-logo tees and hoodies hold strong value, sold-out collaborations (Louis Vuitton, Nike, The North Face) command large premiums, and bizarre branded "accessories"—from bricks to crowbars—have become collector novelties. The brand was acquired by VF Corporation and later EssilorLuxottica. Because fakes are rampant, buyers verify box-logo font and stitching, tagging, season-specific details, and provenance from the original drop.',
    resale: 'Very High', demand: 9.2, sellSpeed: 'Fast',
    products: ['Box Logo Tees', 'Hoodies', 'Accessories', 'Collab Pieces'],
  },
  'Hellstar': {
    country: 'United States', founded: '2020', domain: 'hellstarstudios.com',
    description: 'Hellstar (Hellstar Studios) is a Los Angeles streetwear label founded in 2020 by Sean Holland alongside a group of high-school friends, reportedly starting with a modest budget during the pandemic. The brand rose meteorically on the back of bold, dark graphics—flames, skeletons, and reinterpreted religious and sci-fi imagery—delivered through limited drops in its signature black, deep-red, and grey palette. Distressed, vintage-washed hoodies and graphic tees are its core, and high-profile co-signs (including Post Malone) accelerated its rise. On the resale market Hellstar is currently hype-driven and fast-moving: in-demand drops and sold-out graphics resell above retail while a release is current, though as a young brand its long-term value is less established than heritage names. Authentication focuses on print quality, fabric wash, tags, and stitching, since fakes appear quickly for hyped releases.',
    resale: 'Very High', demand: 8.8, sellSpeed: 'Fast',
    products: ['Graphic Hoodies', 'Tees', 'Sweatpants', 'Shorts'],
  },
  'Stone Island': {
    country: 'Italy', founded: '1982', domain: 'stoneisland.com',
    description: 'Stone Island was founded in 1982 by designer Massimo Osti, a pioneer of garment dyeing and experimental fabric research. Its detachable compass-rose badge, fastened by two buttons so it can be removed, is one of the most recognizable emblems in menswear. The brand is renowned for technical innovation—heat-reactive thermo fabrics, reflective coatings, and unusual dyeing processes—and built a devoted following spanning techwear enthusiasts and European football casual culture. Now majority-owned by Moncler, Stone Island commands strong resale demand: badge jackets, knitwear, and limited fabric-research pieces move quickly, and rare archival or collaboration items (notably with Supreme) carry significant premiums. Heavy counterfeiting makes the badge, button stamping, fabric authenticity, and seasonal tagging essential authentication checkpoints for serious buyers.',
    resale: 'Very High', demand: 9.0, sellSpeed: 'Fast',
    products: ['Badge Jackets', 'Knitwear', 'Overshirts', 'Cargo Pants'],
  },
  'Pele Pele': {
    country: 'United States', founded: '1978', domain: 'pellepelle.com',
    description: 'Pelle Pelle—Italian for "leather leather"—was founded in Detroit in 1978 by designer Marc Buchanan, who had begun in the leather trade earlier that decade. The brand became one of the most successful urban fashion labels of the 1980s and 1990s, famous for boldly colored, heavily embellished and embroidered leather jackets that became staples of hip-hop style, worn by stars from Will Smith to Notorious B.I.G. Although the brand\'s mainstream popularity faded in the 2000s, it has retained a strong vintage following and has seen periodic revivals. On the resale market vintage Pelle Pelle leather jackets—especially the elaborate embroidered Marc Buchanan designs—command solid prices among collectors of 90s hip-hop fashion. Authentication relies on Marc Buchanan labels, embroidery quality, leather feel, and era-correct hardware and lining.',
    resale: 'High', demand: 7.6, sellSpeed: 'Moderate',
    products: ['Leather Jackets', 'Embroidered Coats', 'Denim', 'Outerwear'],
  },
  'Visvim': {
    country: 'Japan', founded: '2000', domain: 'visvim.tv',
    description: 'Visvim was founded in 2000 by Hiroki Nakamura in Tokyo, and it occupies a rarefied space where Americana heritage, traditional craft, and obsessive material sourcing meet. The brand is known for reinterpreting classic forms—moccasins, Native American–inspired footwear, denim, and outerwear—using natural dyes, hand-construction, and rare materials, often at extremely high price points. Its FBT moccasin-sneaker and ICT down pieces are signatures. Visvim attracts a deeply knowledgeable global following that values process over logos. On the resale market it holds value strongly among connoisseurs: well-kept footwear, kimono-influenced outerwear, and naturally dyed denim retain demand, and rare items appreciate, though the buyer pool is niche and liquidity slower than hype streetwear. Authentication centers on construction quality, materials, interior tags, and the distinctive craft details that are hard to fake.',
    resale: 'Very High', demand: 8.5, sellSpeed: 'Moderate',
    products: ['FBT Moccasins', 'Denim', 'Down Jackets', 'Outerwear'],
  },
  'Undercover': {
    country: 'Japan', founded: '1990', domain: 'undercoverism.com',
    description: 'Undercover was founded in 1990 by Jun Takahashi in Tokyo, emerging from the Harajuku scene to become one of Japan\'s most influential avant-garde labels. Takahashi fuses punk attitude, conceptual art, and impeccable construction, often built around dark, narrative themes and the brand\'s "We Make Noise Not Clothes" ethos. Undercover gained global recognition through Paris runway shows and a long creative friendship with Nigo and collaborations with Nike (notably the Gyakusou running line) and Supreme. On the resale market it is sought by collectors of conceptual Japanese fashion: archival runway pieces, graphic outerwear, and Nike collaborations command premiums, while general-line pieces move at a steady pace. Authentication relies on season-specific tags, print and construction quality, and provenance, since archival Undercover is both valuable and frequently misrepresented.',
    resale: 'Very High', demand: 8.4, sellSpeed: 'Moderate',
    products: ['Graphic Outerwear', 'Tees', 'Collab Sneakers', 'Conceptual Pieces'],
  },
  'Comme des Garçons': {
    country: 'Japan', founded: '1969', domain: 'comme-des-garcons.com',
    description: 'Comme des Garçons was founded by Rei Kawakubo in Tokyo in 1969, debuting in Paris in 1981 with deconstructed, asymmetric, predominantly black designs that challenged Western ideas of beauty and reshaped fashion. Kawakubo\'s avant-garde main line is intellectual and sculptural, while sub-labels broaden reach: PLAY, with its Filip Pagowski heart-with-eyes logo, is a widely collected entry point, and the brand runs influential Dover Street Market retail and countless collaborations (Nike, Converse, Supreme). On the resale market CdG spans accessible to elite: PLAY tees and Converse collabs move fast and steadily, while archival Kawakubo runway pieces are serious collector items that can appreciate significantly. Authentication varies by line—PLAY focuses on the heart-logo embroidery and tags, while main-line pieces require knowledge of season-specific construction and labeling.',
    resale: 'Very High', demand: 8.7, sellSpeed: 'Fast',
    products: ['PLAY Tees', 'Converse Collabs', 'Avant-Garde Pieces', 'Wallets'],
  },
  'Yohji Yamamoto': {
    country: 'Japan', founded: '1972', domain: 'yohjiyamamoto.co.jp',
    description: 'Yohji Yamamoto established his company in Tokyo in 1972 and debuted in Paris in 1981, becoming—alongside Rei Kawakubo—a leader of the Japanese avant-garde that upended 1980s fashion. His work is defined by oversized, draped, predominantly black silhouettes, masterful tailoring, and a poetic, anti-trend philosophy. The Y-3 collaboration with Adidas, launched in 2002, brought his aesthetic to sportswear and a broader audience. On the resale market Yohji spans two worlds: Y-3 sneakers and apparel move at a steady, accessible pace, while main-line and archival runway pieces are prized by collectors and can command high prices, with rare archival items appreciating over time. Demand is durable among those who understand the design language. Authentication relies on season tags, fabric and construction quality, and—for Y-3—standard sneaker verification points.',
    resale: 'Very High', demand: 8.5, sellSpeed: 'Moderate',
    products: ['Draped Tailoring', 'Y-3 Sneakers', 'Black Outerwear', 'Knitwear'],
  },
  'Issey Miyake': {
    country: 'Japan', founded: '1970', domain: 'isseymiyake.com',
    description: 'Issey Miyake founded the Miyake Design Studio in Tokyo in 1970, pioneering a technology-driven approach to clothing built on innovative pleating and material research. His PLEATS PLEASE line and the Bao Bao geometric bag became globally recognized signatures, blending engineering and art into wearable, travel-friendly garments. The fragrance L\'Eau d\'Issey is another household name. Miyake\'s philosophy—"a piece of cloth"—produced sub-labels like HOMME PLISSÉ that surged in popularity for their pleated, sculptural menswear. On the resale market Issey Miyake is robust and broad: Bao Bao bags and PLEATS PLEASE pieces move quickly and hold value, HOMME PLISSÉ has strong current demand, and vintage and archival pieces (including pre-2000 designs) are increasingly collectible. Authentication focuses on line-specific tags, the distinctive pleating quality, and—for Bao Bao—tile construction and hardware.',
    resale: 'Very High', demand: 8.6, sellSpeed: 'Fast',
    products: ['Pleated Garments', 'Bao Bao Bags', 'HOMME PLISSÉ', 'Knitwear'],
  },
  'Amiri': {
    country: 'United States', founded: '2014', domain: 'amiri.com',
    description: 'Amiri was founded in Los Angeles in 2014 by designer Mike Amiri, who began by hand-distressing and customizing denim with a rock-and-roll sensibility rooted in the city\'s music scene. The brand rapidly ascended into luxury streetwear, known for skinny distressed jeans, the MA bone-runner sneaker, leather jackets, and bandana and skeleton motifs at premium price points. It became a favorite of musicians and athletes and now shows on the Paris runway. On the resale market Amiri is hype-adjacent and active: signature distressed denim, MA sneakers, and logo pieces move at a fast pace while current, and sold-out or collaboration items carry premiums, though as a relatively young luxury brand value is more trend-linked than heritage labels. Authentication relies on stitching and distressing quality, leather patches, tags, and hardware finishing.',
    resale: 'Very High', demand: 8.9, sellSpeed: 'Fast',
    products: ['Distressed Denim', 'MA Sneakers', 'Leather Jackets', 'Graphic Tees'],
  },
  'Gallery Dept.': {
    country: 'United States', founded: '2017', domain: 'gallerydept.com',
    description: 'Gallery Dept. was founded in Los Angeles in 2017 by artist and designer Josué Thomas, who repurposes and hand-alters vintage garments into one-of-a-kind, art-driven pieces from his LA studio. The brand\'s aesthetic is deliberately DIY and painterly—paint splatters, flared and distressed denim, hand-screened logos, and slogans like "Art That Kills"—blurring the line between fashion and fine art. Early co-signs from Virgil Abloh and rappers including Drake and the Migos propelled it into luxury streetwear prominence. On the resale market Gallery Dept. is hype-driven and fast-moving: hand-painted flared Carhartt-style pants, logo hoodies and tees, and limited collaborations resell above retail while in demand. Because each genuine piece is hand-finished, authentication focuses on paint and screen-print quality, the irregular hand-done details, tags, and provenance, as fakes are common.',
    resale: 'Very High', demand: 8.7, sellSpeed: 'Fast',
    products: ['Painted Denim', 'Flared Pants', 'Hoodies', 'Graphic Tees'],
  },
  'Rick Owens': {
    country: 'United States', founded: '1994', domain: 'rickowens.eu',
    description: 'Rick Owens founded his label in Los Angeles in 1994 before relocating to Paris, building one of fashion\'s most singular and recognizable aesthetics—dark, draped, post-apocalyptic "glunge" (glam-grunge) defined by elongated silhouettes, muted palettes, and architectural cuts. His Geobasket and Ramones high-top sneakers, DRKSHDW diffusion denim line, and dramatic leather jackets are signatures. Owens commands an intensely devoted global following that treats the brand as a lifestyle. On the resale market Rick Owens is strong and active: sneakers (especially Geobaskets and adidas collaborations), leather jackets, and main-line pieces hold value well and move at a fast pace, while archival and runway items are serious collector pieces. Demand is durable rather than fleeting. Authentication relies on construction and leather quality, season-specific tags, and standard sneaker verification points for collaborations.',
    resale: 'Very High', demand: 8.8, sellSpeed: 'Fast',
    products: ['Geobasket Sneakers', 'Leather Jackets', 'DRKSHDW Denim', 'Draped Knitwear'],
  },
  'Maison Margiela': {
    country: 'France', founded: '1988', domain: 'maisonmargiela.com',
    description: 'Maison Margiela was founded in Paris in 1988 by Belgian designer Martin Margiela, a leader of the deconstructionist movement who famously shunned personal publicity and left garments anonymous, marked only by a blank white label held by four corner stitches. The house is known for conceptual deconstruction, the Replica sneaker, the split-toe Tabi boot and sneaker (its most iconic and recognizable item), and the diffusion-line numbering system (0–23). Now creatively shaped in recent years by John Galliano, it blends avant-garde concept with luxury craft. On the resale market Margiela is strong: Tabi footwear and Replica sneakers move fast and hold value, while archival Martin Margiela–era pieces are highly prized collector items that appreciate. Authentication focuses on the four-stitch label, numbering, Tabi construction, and season-specific details.',
    resale: 'Very High', demand: 8.8, sellSpeed: 'Fast',
    products: ['Tabi Boots', 'Replica Sneakers', 'Deconstructed Pieces', 'Five-AC Bags'],
  },
  'Jean Paul Gaultier': {
    country: 'France', founded: '1976', domain: 'jeanpaulgaultier.com',
    description: 'Jean Paul Gaultier launched his Paris house in 1976 and earned the title "enfant terrible" of French fashion for provocative, boundary-pushing design—the cone bra he created for Madonna\'s 1990 tour, the trompe-l\'œil tattoo and mesh tops, sailor stripes, and a playful subversion of gender norms. After Gaultier retired from couture in 2020, the brand reinvented itself through buzzy guest-couturier collaborations and a younger-skewing line. On the resale market vintage JPG has surged: the mesh and tattoo-print tops from the 1990s and 2000s are highly sought by a new generation, archival couture and runway pieces command strong prices, and the recent revived pieces sell quickly. Demand is currently elevated by the vintage and Y2K revival. Authentication relies on era-specific labels, print quality, mesh construction, and knowledge of the brand\'s many diffusion lines.',
    resale: 'Very High', demand: 8.6, sellSpeed: 'Fast',
    products: ['Mesh Tops', 'Tattoo Prints', 'Striped Knits', 'Tailoring'],
  },
  'Canada Goose': {
    country: 'Canada', founded: '1957', domain: 'canadagoose.com',
    description: 'Canada Goose was founded in Toronto in 1957 (originally as Metro Sportswear) and built its reputation on extreme-cold-weather down parkas engineered for Arctic conditions, including gear worn by scientists in Antarctica. The brand became a global luxury-outerwear status symbol in the 2010s, identified by its circular Arctic-program arm patch. Its Expedition and Chilliwack parkas and Kensington styles are signatures, with premium pricing reflecting genuine technical performance and down quality. On the resale market Canada Goose is strong in cold-climate regions and during winter: well-kept parkas hold value seasonally, popular colorways move quickly, and demand spikes with temperature. The brand has shifted toward more sustainable materials in recent years. Heavily counterfeited, authentication relies on the hologram patch, stitching, zipper quality, the embroidered logo, and serial documentation.',
    resale: 'Very High', demand: 8.5, sellSpeed: 'Fast',
    products: ['Down Parkas', 'Expedition Coats', 'Vests', 'Bomber Jackets'],
  },
  'Moncler': {
    country: 'France', founded: '1952', domain: 'moncler.com',
    description: 'Moncler was founded in 1952 in Monestier-de-Clermont, near Grenoble, France, originally making quilted down jackets and sleeping bags for mountaineers and Alpine expeditions. Now headquartered in Italy, it transformed into a luxury fashion powerhouse, best known for glossy quilted down puffer jackets bearing its rooster-and-mountain logo. The Moncler Genius project—rotating collaborations with designers like Rick Owens, Palm Angels, and others—keeps the brand culturally relevant and drives hype. On the resale market Moncler is a top performer: classic Maya and quilted puffers hold value strongly, popular colorways and sizes move fast, and limited Genius collaborations command significant premiums. Demand strengthens in cold seasons. Because counterfeits are widespread, authentication relies on the QR-code authentication card, logo patch quality, stitching, zipper branding, and fabric feel.',
    resale: 'Elite', demand: 8.9, sellSpeed: 'Fast',
    products: ['Down Puffers', 'Maya Jacket', 'Vests', 'Genius Collabs'],
  },
  'Rolex': {
    country: 'Switzerland', founded: '1905', domain: 'rolex.com',
    description: 'Rolex was founded in 1905 by Hans Wilsdorf in London (as Wilsdorf and Davis), adopting the Rolex name in 1908 and later moving to Geneva. It pioneered the waterproof Oyster case and the self-winding Perpetual rotor, and its models—Submariner, Daytona, GMT-Master, Datejust, Day-Date—are the most recognized and aspirational watches in the world. Rolex is the benchmark of the entire watch resale and investment market: demand for steel sport models vastly exceeds supply, pushing secondhand prices of pieces like the Daytona and Submariner well above retail, and vintage references (especially rare dials) reach extraordinary auction figures. Watches hold and often appreciate in value like few collectibles. Given the stakes and counterfeit volume, authentication is highly specialized—movement, serial and reference numbers, case finishing, and paperwork all matter.',
    resale: 'Elite', demand: 9.8, sellSpeed: 'Fast',
    products: ['Wristwatches', 'Dive Watches', 'Chronographs', 'Vintage Timepieces'],
  },
  'Cartier': {
    country: 'France', founded: '1847', domain: 'cartier.com',
    description: 'Cartier was founded in Paris in 1847 by Louis-François Cartier and became known as "the jeweler of kings and the king of jewelers" for serving royalty across Europe. It is a titan of fine jewelry and watchmaking, behind icons including the Tank watch, the Santos (one of the first purpose-built wristwatches), the Love bracelet with its screw motif, the Juste un Clou nail bracelet, and the Trinity ring. On the resale market Cartier is elite and highly liquid: the Love bracelet and Juste un Clou hold value exceptionally well, vintage Tank and Santos watches are strongly collected, and gold and diamond pieces retain intrinsic value. Demand is durable across economic cycles. Authentication is specialized—serial numbers, hallmarks, screw and engraving precision, and accompanying certificates are scrutinized given heavy counterfeiting.',
    resale: 'Elite', demand: 9.5, sellSpeed: 'Fast',
    products: ['Love Bracelet', 'Tank Watch', 'Juste un Clou', 'Fine Jewelry'],
  },
  'Tiffany & Co.': {
    country: 'United States', founded: '1837', domain: 'tiffany.com',
    description: 'Tiffany & Co. was founded in New York in 1837 by Charles Lewis Tiffany and became America\'s most storied luxury jeweler, instantly identified by its trademarked robin\'s-egg "Tiffany Blue" box. It set the U.S. standard for the engagement ring (introducing the six-prong Tiffany Setting in 1886) and is behind icons like the Return to Tiffany line, Tiffany T, and Elsa Peretti and Paloma Picasso designs. Acquired by LVMH in 2021, the brand has skewed younger and more fashion-forward. On the resale market Tiffany is strong and liquid: sterling silver pieces (especially Return to Tiffany), diamond jewelry, and engagement rings hold value well, and vintage designer-collaboration pieces are collectible. Authentication relies on hallmarks and stamping ("T & CO.," metal purity marks), engraving quality, and original documentation and packaging.',
    resale: 'Elite', demand: 9.2, sellSpeed: 'Fast',
    products: ['Silver Jewelry', 'Diamond Rings', 'Tiffany T', 'Necklaces'],
  },

  // ── RARE TIER (fully curated, 100–150 words each) ───────────────────────────
  'Filson': {
    country: 'United States', founded: '1897', domain: 'filson.com',
    description: 'C.C. Filson founded his Seattle outfitter in 1897 to equip prospectors heading north for the Klondike Gold Rush, and that rugged heritage still defines the brand. Filson is renowned for its Tin Cloth (oil-finished waxed cotton), Mackinaw wool, and bridle leather, building outerwear, bags, and accessories designed to last decades and earn a patina with use. The Cruiser jacket and Tin Cloth work coats are signatures, and the brand carries a lifetime guarantee. On the resale market Filson holds solid, steady demand among workwear and heritage-Americana collectors: well-kept waxed jackets and the rugged twill bags retain value, and discontinued or vintage "Made in USA" pieces with older talon-zipper details are especially sought. Demand is durable rather than hype-driven. Condition, country of manufacture, and the waxed-cotton finish are the main value factors.',
    resale: 'High', demand: 7.8, sellSpeed: 'Moderate',
    products: ['Waxed Jackets', 'Tin Cloth Coats', 'Bags', 'Wool Vests'],
  },
  'Sitka': {
    country: 'United States', founded: '2005', domain: 'sitkagear.com',
    description: 'Sitka Gear was founded in 2005 in Bozeman, Montana, applying serious materials science to hunting apparel—pairing GORE-TEX, WINDSTOPPER, and PrimaLoft with the patented OPTIFADE concealment camouflage developed with Gore and based on animal vision. Now owned by W.L. Gore, Sitka is a premium, system-based brand that hunters layer for specific terrain and game. On the resale market Sitka is strong within its niche: demand is intense among serious hunters, used pieces in discontinued camo patterns (Open Country, Subalpine) and out-of-season layers move well, and the high retail prices keep secondhand values elevated. Demand spikes seasonally around hunting openers. Because the brand is technical and pattern-specific, value depends heavily on the camo pattern, the specific layer in the system, sizing, and condition—worn-out waterproofing reduces value notably.',
    resale: 'High', demand: 7.9, sellSpeed: 'Moderate',
    products: ['Camo Jackets', 'Hunting Pants', 'Base Layers', 'Insulated Gear'],
  },
  'Kuiu': {
    country: 'United States', founded: '2011', domain: 'kuiu.com',
    description: 'KUIU (pronounced "koo-you") was founded in 2011 by Jason Hairston—a former NFL player who had earlier co-founded Sitka Gear—and is based in Dixon, California. It built its reputation on ultralight, high-performance hunting apparel and gear aimed at mountain and expedition-style backcountry pursuits, selling direct-to-consumer to keep premium materials affordable. Signature elements include its proprietary Vias and Verde camo patterns and weight-obsessed layering systems. On the resale market KUIU has a devoted following among western and mountain hunters: used pieces hold value well, discontinued patterns and limited colorways are sought, and the direct-to-consumer model with frequent sellouts feeds secondhand demand. Like other technical hunting brands, demand is seasonal and pattern-specific. Value depends on the camo pattern, specific garment, sizing, and the condition of waterproof membranes and insulation.',
    resale: 'High', demand: 7.7, sellSpeed: 'Moderate',
    products: ['Camo Jackets', 'Hunting Pants', 'Packs', 'Down Layers'],
  },
  'Mystery Ranch': {
    country: 'United States', founded: '2000', domain: 'mysteryranch.com',
    description: 'Mystery Ranch was founded in 2000 in Bozeman, Montana, by legendary pack designer Dana Gleason and Renée Sippel-Baker—Gleason\'s third pack company after Kletterwerks and Dana Design. The brand is built around serious load-carriage engineering, famous for its three-zip (Tri-Zip) access design and Futura Yoke suspension, with packs trusted by the military, wildland firefighters, hunters, and mountaineers. Many mission-specific lines are still made in the USA. On the resale market Mystery Ranch holds strong, durable demand among the outdoor and EDC (everyday-carry) communities: models like the 3-Day Assault and Urban Assault retain value, discontinued military-spec and limited colorways command premiums, and the famously low return/failure rate keeps used packs desirable. Demand is steady rather than hype-driven. Value depends on the model, colorway, country of manufacture, and condition of the suspension and zippers.',
    resale: 'High', demand: 8.0, sellSpeed: 'Moderate',
    products: ['Backpacks', 'Assault Packs', 'Duffels', 'Hunting Packs'],
  },
  'Barbour': {
    country: 'United Kingdom', founded: '1894', domain: 'barbour.com',
    description: 'Barbour was founded in 1894 by John Barbour in South Shields, England, originally supplying oilskins and waxed outerwear to sailors and dockworkers. It became a quintessential British countryside brand, holding Royal Warrants and best known for its waxed-cotton jackets—the Bedale and Beaufort especially—with corduroy collars and tartan linings. On the resale market Barbour has steady, broad demand and an unusual secondhand dynamic: the waxed jackets are designed to be re-waxed and repaired for life, so vintage examples remain wearable and desirable, and discontinued models, collaborations (with brands like Supreme and Engineered Garments), and rare tartan linings command premiums. The brand offers an official re-waxing service that supports long-term value. Condition of the wax finish, model, country of manufacture, and any collaboration branding are the key value drivers.',
    resale: 'High', demand: 8.0, sellSpeed: 'Moderate',
    products: ['Waxed Jackets', 'Quilted Jackets', 'Tartan Scarves', 'Field Coats'],
  },
  'BAPE': {
    country: 'Japan', founded: '1993', domain: 'bape.com',
    description: 'A Bathing Ape (BAPE) was founded in 1993 by Nigo (Tomoaki Nagao) in the Ura-Harajuku district of Tokyo, and it became one of the most influential streetwear brands in the world. It is defined by instantly recognizable motifs: the ABC camo, the Ape Head logo, the Shark hoodie with its full-zip face, and BAPE STA sneakers. Deliberately limited early production and a deep connection to hip-hop (Pharrell, Kanye, the Soulja Boy era) built enormous hype. On the resale market BAPE is a heavyweight: Shark hoodies, camo pieces, and collaborations (with Nike, Coca-Cola, countless others) move quickly and command premiums, while rare early-2000s "Nowhere"-era pieces are serious collector grails. Because BAPE is among the most counterfeited brands in the world, authentication—stitching, camo print accuracy, tags, and hardware—is critical to value.',
    resale: 'Very High', demand: 8.8, sellSpeed: 'Fast',
    products: ['Shark Hoodies', 'Camo Pieces', 'BAPE STA Sneakers', 'Graphic Tees'],
  },
  'Kith': {
    country: 'United States', founded: '2011', domain: 'kith.com',
    description: 'Kith was founded in 2011 by Ronnie Fieg in New York, evolving from a footwear-focused boutique into a full lifestyle brand and retail empire with elevated, design-forward streetwear and a famous in-store cereal bar (Kith Treats). It built its reputation on premium basics, prolific collaborations, and a polished aesthetic that sits between streetwear and contemporary fashion. On the resale market Kith is consistently strong: its weekly Monday-program drops, sold-out collaborations (Nike, New Balance, Versace, BMW, countless others), and seasonal box-logo and Williams III hoodies move quickly and command premiums when sold out. Ronnie Fieg\'s New Balance collaborations in particular are major resale items. Demand is broad and steady. Value depends on the specific drop, collaboration partner, sellout status, and condition, with limited colorways carrying the strongest premiums.',
    resale: 'Very High', demand: 8.6, sellSpeed: 'Fast',
    products: ['Hoodies', 'Sneaker Collabs', 'Knitwear', 'Logo Tees'],
  },
  'Palace': {
    country: 'United Kingdom', founded: '2009', domain: 'palaceskateboards.com',
    description: 'Palace Skateboards was founded in 2009 by Lev Tanju in London, emerging from the city\'s skate scene with an irreverent, humor-driven sensibility and the instantly recognizable Tri-Ferg (triangle) logo designed by Fergus Purcell. It became the defining British streetwear brand and a counterpart to Supreme, built on weekly drops, witty graphics, and a strong skate authenticity. On the resale market Palace is a major name: its drop model creates immediate sellouts, and collaborations (Adidas, Polo Ralph Lauren, Reebok, Gucci) and rare graphic pieces command premiums on the secondhand market. Tri-Ferg hoodies and tees are perennial favorites. Demand is strong and fast-moving, especially around fresh drops. Value depends on the season, collaboration partner, sellout status, and condition; like all hyped streetwear, authentication of tags and print quality matters.',
    resale: 'Very High', demand: 8.7, sellSpeed: 'Fast',
    products: ['Tri-Ferg Hoodies', 'Graphic Tees', 'Adidas Collabs', 'Jackets'],
  },
  'Anti Social Social Club': {
    country: 'United States', founded: '2015', domain: 'antisocialsocialclub.com',
    description: 'Anti Social Social Club (ASSC) was founded in 2015 by Neek Lurk, a former Stüssy marketing manager, in Los Angeles. The brand became a viral streetwear phenomenon on the strength of a single recognizable element—its hand-styled logo, usually screen-printed on hoodies and tees in bold colorways with melancholic, ironic slogans. It rode a wave of hype-driven drops and high-profile collaborations (Undefeated, BAPE, Playboy, Dover Street Market). On the resale market ASSC is volatile: at its peak, drops resold for large multiples, but the brand became known for long shipping delays and oversupply, which softened secondhand values over time. Sold-out collaborations and early pieces hold the most value, while general logo hoodies are more abundant. Because it is heavily counterfeited, logo accuracy, tags, and print quality are the main authentication and value factors.',
    resale: 'High', demand: 8.0, sellSpeed: 'Moderate',
    products: ['Logo Hoodies', 'Graphic Tees', 'Caps', 'Collab Pieces'],
  },
  'FTP': {
    country: 'United States', founded: '2010', domain: 'fuckthepopulation.com',
    description: 'FTP (FuckThePopulation) was founded in 2010 by Zac Clark, who started the brand as a Los Angeles high-schooler—initially spelling the name backwards to dodge school rules—and built it into a cult streetwear label on a foundation of deliberately provocative, anti-establishment graphics. The brand is defined by its bold logo, camo and tie-dye treatments, and a brash, defiant attitude that echoes streetwear\'s confrontational roots. On the resale market FTP has a dedicated following: limited drops sell out and resell above retail while current, memorial and one-off graphic pieces are collectible, and the brand\'s scarcity-driven release model fuels secondhand demand. Hype can be cyclical and trend-sensitive. Value depends on the specific drop, graphic, sellout status, and condition; as with other hyped streetwear, tag and print authentication matters since fakes circulate quickly.',
    resale: 'High', demand: 8.1, sellSpeed: 'Moderate',
    products: ['Logo Hoodies', 'Graphic Tees', 'Camo Pieces', 'Accessories'],
  },
  'Pleasures': {
    country: 'United States', founded: '2015', domain: 'pleasuresnow.com',
    description: 'Pleasures was founded in 2015 by Alex James—drawing on his background as a vintage reseller—in Los Angeles. The brand channels punk, grunge, and hardcore subcultures into graphic-driven streetwear, layering subversive cultural references, band-inspired imagery, and a DIY sensibility across seasonal collections. It has built credibility through frequent collaborations spanning music estates and brands (Joy Division, Marilyn Manson, Kiss, Reebok, and others). On the resale market Pleasures has a steady following among streetwear and music-nostalgia buyers: graphic tees, hoodies, and licensed-band collaborations move at a moderate pace, with sold-out drops and collaboration pieces holding the most value. Demand is driven by the strength of each graphic and cultural reference rather than pure logo hype. Value depends on the specific collaboration, sellout status, graphic appeal, and condition.',
    resale: 'High', demand: 7.9, sellSpeed: 'Moderate',
    products: ['Graphic Tees', 'Hoodies', 'Band Collabs', 'Sweatpants'],
  },
  'Fear of God': {
    country: 'United States', founded: '2013', domain: 'fearofgod.com',
    description: 'Fear of God was founded in 2013 by self-taught designer Jerry Lorenzo in Los Angeles, pioneering an elevated, luxury-leaning approach to American streetwear—oversized silhouettes, muted earth tones, elongated hems, and a refined take on basics and outerwear. Its main-line collections are premium-priced, while the diffusion line Essentials brought the aesthetic to a mass audience and became enormously popular. On the resale market Fear of God is strong across both tiers: main-line pieces (especially the flannel and bomber outerwear and the Nike Air Fear of God sneakers) command high prices, while Essentials hoodies, sweatpants, and tees move in huge volume with steady demand and frequent sellouts. Adidas now partners on Fear of God Athletics. Value depends on the line (main vs. Essentials), season, colorway, sellout status, and condition; authentication matters as Essentials is heavily faked.',
    resale: 'Very High', demand: 8.8, sellSpeed: 'Fast',
    products: ['Essentials Hoodies', 'Outerwear', 'Sneakers', 'Sweatpants'],
  },
  'Aimé Leon Dore': {
    country: 'United States', founded: '2014', domain: 'aimeleondore.com',
    description: 'Aimé Leon Dore (ALD) was founded in 2014 by Teddy Santis in Queens, New York, blending 1990s New York sportswear nostalgia, Mediterranean and Greek-American influences, and an elevated, design-forward sensibility. The brand built a devoted following through its Manhattan flagship and adjacent café, polished lookbooks, and a reputation for premium fabrics and considered tailoring. Its New Balance collaborations—Santis also became creative director of New Balance\'s Made in USA line—are among the most coveted sneakers of recent years. On the resale market ALD is strong and fast-moving: New Balance collaborations (990, 550, 993) command significant premiums, and sold-out apparel, knitwear, and the Porsche collaboration pieces resell above retail. Demand is broad and trend-positive. Value depends on the specific drop or collaboration, sellout status, colorway, and condition.',
    resale: 'Very High', demand: 8.7, sellSpeed: 'Fast',
    products: ['New Balance Collabs', 'Knitwear', 'Hoodies', 'Polo Shirts'],
  },
  'Coach': {
    country: 'United States', founded: '1941', domain: 'coach.com',
    description: 'Coach was founded in New York in 1941 as a family-run leather-goods workshop, becoming famous in the 1970s and 80s for durable, classic American glove-tanned leather handbags and accessories—an accessible-luxury alternative to European houses. After decades as a mass brand, it has been creatively revitalized in recent years with a focus on its heritage and a younger audience. On the resale market Coach has a notable two-tier dynamic: contemporary bags depreciate like most mall-luxury, but vintage Coach—especially the 1970s–90s Bonnie Cashin–era and "Made in USA" NYC pieces in classic leather styles—has surged with collectors and thrifters, often reselling well above thrift-find prices. The recent Coachtopia and reissued archive bags also draw interest. Value depends heavily on era and origin: vintage USA-made leather is the prize; condition and the creed stamp matter for authentication.',
    resale: 'High', demand: 7.5, sellSpeed: 'Moderate',
    products: ['Leather Handbags', 'Vintage Bags', 'Wallets', 'Accessories'],
  },
  'MCM': {
    country: 'Germany', founded: '1976', domain: 'mcmworldwide.com',
    description: 'MCM (Mode Creation Munich) was founded in Munich, Germany, in 1976, rising to prominence in the 1980s with its signature cognac-colored Visetos monogram canvas on luggage and bags. After a quieter period, the brand—now owned by South Korea\'s Sungjoo Group—was revived as a logo-forward luxury label that became especially popular in streetwear and hip-hop circles in the 2010s. On the resale market MCM is moderately strong: the monogram backpacks, belt bags, and the early studded "Stark" backpack hold steady demand, vintage 80s Visetos luggage has a nostalgic collector following, and logo-heavy pieces appeal to the logomania trend. Demand is more trend-linked than blue-chip luxury. Value depends on the style, condition, and era, and because the monogram is widely faked, authentication of the Visetos print, hardware, and serial details matters.',
    resale: 'High', demand: 7.8, sellSpeed: 'Moderate',
    products: ['Monogram Backpacks', 'Belt Bags', 'Luggage', 'Wallets'],
  },
  'Telfar': {
    country: 'United States', founded: '2005', domain: 'telfar.net',
    description: 'Telfar was founded in 2005 by Liberian-American designer Telfar Clemens in New York, built on a radically inclusive ethos captured by its slogan, "Not for you—for everyone." The brand became a cultural phenomenon through its vegan-leather Shopping Bag—nicknamed the "Bushwick Birkin"—an accessible, gender-neutral tote bearing the embossed T-logo that became a genuine status symbol while staying democratically priced. Its "Bag Security Program" releases and frequent sellouts created intense demand. On the resale market Telfar is strong and fast-moving: the Shopping Bag in popular sizes and colors regularly resells above retail, limited colorways and collaborations (UGG, Eastpak, Converse) command premiums, and rare drops are highly sought. Demand is broad and culturally driven. Value depends on size, colorway, drop rarity, and condition; the embossed logo and hardware are key authentication points as fakes exist.',
    resale: 'Very High', demand: 8.6, sellSpeed: 'Fast',
    products: ['Shopping Bags', 'Totes', 'Apparel', 'Collab Accessories'],
  },
  'Rimowa': {
    country: 'Germany', founded: '1898', domain: 'rimowa.com',
    description: 'Rimowa was founded in Cologne, Germany, in 1898, and pioneered the aluminum suitcase in 1937 and the now-iconic grooved (ridged) aluminum design in the 1950s. Now majority-owned by LVMH, it is the premier luxury luggage brand, prized for lightweight aluminum and polycarbonate cases with distinctive parallel grooves that develop a well-traveled patina of dents and stickers. On the resale market Rimowa holds value strongly for a luggage brand: the aluminum Original line and Classic cases retain value well, discontinued finishes and collaborations (Supreme, Dior, Off-White, Tiffany & Co.) command significant premiums, and the Supreme x Rimowa cases in particular are major resale items. Demand is steady among travelers and collectors. Value depends on the line (aluminum holds best), size, collaboration branding, and condition—functional wheels, handles, and latches matter.',
    resale: 'Very High', demand: 8.4, sellSpeed: 'Moderate',
    products: ['Aluminum Suitcases', 'Polycarbonate Luggage', 'Carry-Ons', 'Collab Cases'],
  },
  'Schott NYC': {
    country: 'United States', founded: '1913', domain: 'schottnyc.com',
    description: 'Schott NYC was founded in 1913 by brothers Irving and Jack Schott on the Lower East Side of New York, and in 1928 it created the Perfecto—the first leather motorcycle jacket with a zipper, named after Irving\'s favorite cigar. That asymmetrical-zip biker jacket became a 20th-century icon, worn by Marlon Brando in The Wild One and adopted by punk and rock culture. The family-run brand still manufactures heavily in the USA. On the resale market Schott has steady heritage demand: the Perfecto and other steerhide and cowhide jackets are durable, age beautifully, and hold value, while vintage examples and collaborations (with brands like Supreme and BAPE) command premiums. Demand is durable rather than hype-driven. Value depends on the model, leather type, era, country of manufacture, and condition—genuine patina is often a plus.',
    resale: 'High', demand: 7.9, sellSpeed: 'Moderate',
    products: ['Leather Jackets', 'Perfecto Biker', 'Peacoats', 'Sheepskin Coats'],
  },
  'Red Wing': {
    country: 'United States', founded: '1905', domain: 'redwingshoes.com',
    description: 'Red Wing Shoes was founded in 1905 by Charles Beckman in Red Wing, Minnesota, originally making durable work boots for miners, farmers, and laborers. It became an American heritage icon, best known for the Iron Ranger and Moc Toe (875) boots in oil-tanned leather built to last for years and improve with wear. The Red Wing Heritage line and the brand\'s recraft/resole service reinforce its lifetime-product reputation. On the resale market Red Wing is strong among workwear and heritage-boot enthusiasts: the Iron Ranger and Moc Toe hold value well, discontinued leathers and limited makes (and collaborations) command premiums, and vintage USA-made pairs are sought. Demand is steady and durable. Value depends on the model, leather, size (a major factor for footwear), country of manufacture, and condition—resoleable boots retain value even when worn.',
    resale: 'Very High', demand: 8.3, sellSpeed: 'Fast',
    products: ['Work Boots', 'Iron Ranger', 'Moc Toe Boots', 'Leather Care'],
  },
  'Golden Goose': {
    country: 'Italy', founded: '2000', domain: 'goldengoose.com',
    description: 'Golden Goose was founded in 2000 in Venice, Italy, by Alessandro Gallo and Francesca Rinaldo, and became globally recognized for its Superstar sneakers—Italian-made leather low-tops featuring a signature star patch and a deliberately distressed, pre-worn "lived-in" finish. The intentionally scuffed, vintage-look aesthetic at a luxury price point became both highly popular and frequently debated. On the resale market Golden Goose has steady demand: the Superstar and Ball Star sneakers retain moderate value, limited colorways and collaborations are sought, and the brand\'s broad popularity keeps a liquid secondhand market. Because the distressing is part of the design, condition assessment differs from typical sneakers—structural integrity matters more than scuffs. Value depends on the model, colorway, size, and authenticity; given heavy counterfeiting, the star patch, leather quality, made-in-Italy markings, and hardware are key authentication points.',
    resale: 'Very High', demand: 8.4, sellSpeed: 'Fast',
    products: ['Superstar Sneakers', 'Ball Star Sneakers', 'Leather Goods', 'Apparel'],
  },
  'Ben Davis': {
    country: 'United States', founded: '1935', domain: 'bendavis.com',
    description: 'Ben Davis was founded in 1935 in San Francisco by Ben Davis, whose grandfather Jacob Davis co-invented the riveted blue jean with Levi Strauss. The brand is a workwear institution recognized by its gorilla logo (a nod to founder Ben Davis being called "the Gorilla"), making sturdy, affordable work pants, shirts, and jackets. It became a staple of West Coast workwear, skate, and Bay Area street culture. On the resale market Ben Davis is more of a value-workwear staple than a hype brand: demand is steady and practical, with vintage pieces, the classic gorilla-cut work pants, and any Japanese-market or limited collaborations holding the most interest among workwear collectors. Prices are generally accessible. Value depends on vintage status, condition, and rarity of any special makes; the gorilla patch and era-correct construction are the main authenticity markers.',
    resale: 'Moderate', demand: 7.0, sellSpeed: 'Moderate',
    products: ['Work Pants', 'Work Shirts', 'Jackets', 'Half-Zip Tops'],
  },
  'Stan Ray': {
    country: 'United States', founded: '1972', domain: 'stanray.com',
    description: 'Stan Ray is an American workwear brand with roots tracing to 1972 in Texas, originally manufacturing military fatigue pants and painter\'s pants. It built its reputation on simple, no-nonsense, made-in-the-USA basics in durable cotton twill and ripstop—classic fatigue pants, painter pants with the signature hammer loop, and chore-style pieces—at accessible prices. The brand found renewed popularity in the workwear and Americana-revival scene of the 2010s. On the resale market Stan Ray is a value-driven staple rather than a hype name: demand is steady among workwear enthusiasts, with discontinued colorways, the made-in-USA painter pants, and any collaborations (with brands and select retailers) drawing the most interest. Prices remain accessible. Value depends on fit, fabric, made-in-USA status, and condition; the straightforward construction means authenticity is rarely a concern compared with hyped labels.',
    resale: 'Moderate', demand: 7.0, sellSpeed: 'Moderate',
    products: ['Fatigue Pants', 'Painter Pants', 'Chore Coats', 'Shorts'],
  },
  'Kapital': {
    country: 'Japan', founded: '1985', domain: 'kapital.jp',
    description: 'Kapital was founded in 1985 by Toshikiyo Hirata in the Kojima district of Okayama, Japan—the heartland of Japanese denim. Now creatively driven by his son Kiro Hirata, the brand is a cult favorite renowned for its eccentric, craft-intensive reinterpretations of Americana: boro (patchwork mending), sashiko stitching, indigo dyeing, bandana and "smiley" motifs, and wildly inventive, often whimsical garments. Each piece reflects deep textile craft and Japanese artisanship. On the resale market Kapital is strongly sought by a global community of collectors: boro and sashiko pieces, the Century Denim, ring-coats, and bandana items command high prices, and rare or archival pieces appreciate. Demand is durable and craft-driven rather than logo-hype. Value depends on the specific piece, fabric, craftsmanship, and condition; the elaborate, hard-to-replicate construction is itself a strong authenticity signal.',
    resale: 'Very High', demand: 8.5, sellSpeed: 'Fast',
    products: ['Boro Denim', 'Sashiko Pieces', 'Bandana Items', 'Indigo Garments'],
  },
  'Needles': {
    country: 'Japan', founded: '1997', domain: 'nepenthes.co.jp',
    description: 'Needles is a Japanese label launched in the late 1990s by Keizo Shimizu as an in-house brand of his Nepenthes group (founded 1988), the same family that includes Engineered Garments. Needles reinterprets American influences—western wear, prep, military, and sportswear—through a refined Japanese lens, using Japanese textiles and craftsmanship. It is best known for its Track Pant featuring the signature butterfly embroidery, and its Rebuild by Needles line that reconstructs vintage garments into new pieces. On the resale market Needles is strongly sought: the butterfly Track Pants in their many fabrics and colorways move quickly, AWGE collaborations (with A$AP Rocky\'s collective) command premiums, and Rebuild one-of-a-kind pieces are collectible. Demand is steady and fashion-driven. Value depends on the fabric, colorway, collaboration status, and condition; the butterfly embroidery and Nepenthes tagging are key authenticity markers.',
    resale: 'Very High', demand: 8.5, sellSpeed: 'Fast',
    products: ['Track Pants', 'Western Shirts', 'Rebuild Pieces', 'Mohair Cardigans'],
  },
  'RRL': {
    country: 'United States', founded: '1993', domain: 'ralphlauren.com',
    description: 'RRL (Double RL), founded in 1993 by Ralph Lauren and named after his Colorado ranch, is the designer\'s vintage-Americana and workwear-inspired line. It is devoted to rugged heritage style—selvedge denim, repro military and workwear, hand-distressed pieces, western shirts, and vintage-inspired knitwear—using premium fabrics and detailing, positioned well above the main Polo line. On the resale market RRL has a dedicated following among heritage and workwear enthusiasts: its limited production, selvedge denim, leather jackets, and distinctive vintage-reproduction pieces hold value well, and discontinued or harder-to-find items command premiums. Demand is durable and craft-appreciative rather than hype-driven. Value depends on the specific piece, fabric (selvedge denim and leather are prized), limited availability, and condition; the RRL branding, era of production, and construction quality are the main authentication and value factors.',
    resale: 'High', demand: 8.2, sellSpeed: 'Moderate',
    products: ['Selvedge Denim', 'Workwear', 'Western Shirts', 'Leather Jackets'],
  },

  // ── UNCOMMON TIER, BATCH 1 (fully curated, 100–150 words each) ──────────────
  'Marmot': {
    country: 'United States', founded: '1974', domain: 'marmot.com',
    description: 'Marmot was founded in 1974 by Eric Reynolds and Dave Huntley, who began making down garments and sleeping bags after a glacier expedition in Alaska—the brand name comes from their "Marmot Club." It became a respected technical outdoor brand known for down insulation, Gore-Tex shells (it was an early Gore-Tex adopter), and the PreCip rain jacket. On the resale market Marmot has steady, practical demand among hikers and value-focused outdoor buyers: down jackets, the Precip shell, and fleece move at a moderate pace, with vintage pieces and the retro down sweaters drawing some collector interest. It sits below the top hype-outdoor names in resale value but holds up well for a technical brand. Value depends on the specific garment, insulation type, season, and condition; functional waterproofing and intact down loft matter most for resale.',
    resale: 'Moderate', demand: 7.0, sellSpeed: 'Moderate',
    products: ['Down Jackets', 'Rain Shells', 'Fleece', 'Sleeping Bags'],
  },
  'Mountain Hardwear': {
    country: 'United States', founded: '1993', domain: 'mountainhardwear.com',
    description: 'Mountain Hardwear was founded in 1993 in Richmond, California, by former Sierra Designs staff aiming to make uncompromising, expedition-grade gear. Now owned by Columbia Sportswear, it built a reputation for serious alpine equipment—high-altitude tents, technical down (the Ghost Whisperer ultralight jacket is a signature), and Gore-Tex shells trusted on major expeditions. On the resale market Mountain Hardwear has steady, niche demand among serious mountaineers and backcountry users: the Ghost Whisperer down pieces, technical shells, and expedition tents hold the most interest, while general apparel moves at a moderate pace. It is more performance-driven than fashion-driven, so resale skews toward function over hype. Value depends on the specific technical piece, insulation or membrane condition, and how current the model is; ultralight down and proven expedition gear retain value best.',
    resale: 'Moderate', demand: 6.9, sellSpeed: 'Moderate',
    products: ['Down Jackets', 'Technical Shells', 'Tents', 'Fleece'],
  },
  'Prana': {
    country: 'United States', founded: '1992', domain: 'prana.com',
    description: 'prAna was founded in 1992 by Beaver and Pam Theodosakis out of their California garage, originally focused on climbing and yoga apparel with a sustainability-minded, lifestyle bent. Now owned by Columbia, the brand is known for stretchy climbing pants (the Stretch Zion is a signature), yoga-friendly basics, and an early commitment to organic cotton, hemp, and fair-trade manufacturing. On the resale market prAna has steady, modest demand among climbers, yogis, and sustainability-focused buyers: the Stretch Zion pants and versatile travel apparel move at a moderate pace, with durable construction keeping used pieces wearable. It is a practical lifestyle brand rather than a hype name, so resale values are accessible and demand is function-driven. Value depends on the specific item, fabric, fit, and condition; the popular climbing pants hold value best.',
    resale: 'Moderate', demand: 6.8, sellSpeed: 'Moderate',
    products: ['Climbing Pants', 'Yoga Apparel', 'Tops', 'Shorts'],
  },
  'KÜHL': {
    country: 'United States', founded: '1983', domain: 'kuhl.com',
    description: 'KÜHL traces to 1983 in Utah, when it began as Alfwear selling the Peruvian-inspired "Alf" fleece ski hat; Kevin Boyle took the company solo in the late 1980s and rebranded it KÜHL (German for "cool") in 1994. The brand is known for rugged, distinctively styled technical sportswear—durable pants, fleece, and outerwear designed to look casual while performing outdoors. It remains privately, independently owned and is one of the largest such outdoor brands. On the resale market KÜHL has steady, modest demand among outdoor and everyday-wear buyers: its durable pants and fleece move at a moderate pace, with the rugged construction keeping used pieces serviceable. It is a function-and-value brand rather than a hype name. Value depends on the specific garment, fabric, fit, and condition; the technical pants are the most sought secondhand pieces.',
    resale: 'Moderate', demand: 6.8, sellSpeed: 'Moderate',
    products: ['Technical Pants', 'Fleece', 'Outerwear', 'Shirts'],
  },
  'Outdoor Research': {
    country: 'United States', founded: '1981', domain: 'outdoorresearch.com',
    description: 'Outdoor Research was founded in 1981 in Seattle by physicist Ron Gregg, after a gear failure on a climbing trip convinced him to build better, more reliable equipment. The brand is known for technical accessories and apparel—gloves, gaiters, hats, and Gore-Tex shells—with a strong "Infinite Guarantee" reputation and deep ties to the mountaineering and military communities. On the resale market Outdoor Research has steady, niche demand among climbers, skiers, and backcountry users: its gloves, gaiters, and technical shells hold practical value, while general apparel moves at a moderate pace. It is performance-focused rather than fashion-driven, so resale skews toward function. Value depends on the specific technical piece, membrane or insulation condition, and how current the model is; proven gloves and waterproof shells retain value best secondhand.',
    resale: 'Moderate', demand: 6.9, sellSpeed: 'Moderate',
    products: ['Gloves', 'Gaiters', 'Technical Shells', 'Hats'],
  },
  'Smartwool': {
    country: 'United States', founded: '1994', domain: 'smartwool.com',
    description: 'Smartwool was founded in 1994 in Steamboat Springs, Colorado, by ski instructors who pioneered using fine merino wool in performance socks—solving the itch and bulk problems of traditional wool. Now owned by VF Corporation, the brand is best known for its merino socks and base layers prized for warmth, breathability, and odor resistance. On the resale market Smartwool has steady, practical demand among hikers, skiers, and outdoor enthusiasts: base layers and the merino tops hold modest value, though socks (its core product) are rarely resold for hygiene reasons. It is a function-and-comfort brand rather than a hype name, so resale skews toward apparel basics. Value depends on the specific garment, the wool weight, and condition; lightly used merino base layers and tops are the most viable resale pieces.',
    resale: 'Moderate', demand: 7.0, sellSpeed: 'Moderate',
    products: ['Merino Socks', 'Base Layers', 'Tops', 'Beanies'],
  },
  'Cotopaxi': {
    country: 'United States', founded: '2014', domain: 'cotopaxi.com',
    description: 'Cotopaxi was founded in 2014 in Salt Lake City by Davis Smith as a "Gear for Good" public-benefit company, pairing colorful, adventure-ready products with a social mission and donating a percentage of revenue to alleviate poverty. It is best known for its vibrant Del Día line—bags and jackets sewn from surplus fabric, each in a one-of-a-kind color combination—plus the Allpa travel pack and llama-fleece pieces. On the resale market Cotopaxi has solid, growing demand among younger outdoor and travel buyers: the colorful Del Día packs, the Allpa, and the fleeces move at a moderate-to-fast pace, with rare or discontinued colorways drawing extra interest. The playful aesthetic and mission appeal support steady demand. Value depends on the product, the specific (sometimes unique) colorway, and condition; popular bags and standout Del Día combinations hold value best.',
    resale: 'High', demand: 7.4, sellSpeed: 'Moderate',
    products: ['Backpacks', 'Fleece Jackets', 'Travel Packs', 'Vests'],
  },
  'Fjällräven': {
    country: 'Sweden', founded: '1960', domain: 'fjallraven.com',
    description: 'Fjällräven was founded in 1960 in Örnsköldsvik, Sweden, by Åke Nordin, who began by building a better wooden-framed backpack. The brand (its name means "Arctic fox," its logo) is known for durable, functional Scandinavian outdoor goods—especially the waxed G-1000 fabric and the instantly recognizable boxy Kånken backpack, introduced in 1978 to save schoolchildren\'s backs. On the resale market Fjällräven has strong, steady demand driven largely by the Kånken, which has become a global lifestyle staple: the classic and mini Kånken in popular and discontinued colorways move quickly, and G-1000 jackets and vintage pieces draw collector interest. The brand\'s durability and design longevity support resale. Value depends on the product, colorway (limited and discontinued colors command premiums), and condition; the Kånken is the most liquid and sought-after resale item.',
    resale: 'High', demand: 7.8, sellSpeed: 'Moderate',
    products: ['Kånken Backpacks', 'G-1000 Jackets', 'Trousers', 'Vests'],
  },
  'Duluth Trading': {
    country: 'United States', founded: '1989', domain: 'duluthtrading.com',
    description: 'Duluth Trading Company was founded in 1989, originally selling organization products for tradespeople before evolving into a workwear and casual apparel brand known for humorous, problem-solving marketing (the "Longtail T" that ends "plumber\'s butt," Buck Naked underwear, and Fire Hose work pants). It targets practical, hardworking customers with durable, function-first clothing. On the resale market Duluth Trading has modest, practical demand: its Fire Hose pants, Longtail tees, and flannel-lined workwear hold accessible value among value-focused buyers, though it is not a collector or hype brand. Demand is steady and utility-driven rather than fashion-led. Value depends on the specific garment, durability, and condition; the rugged work pants and flannel-lined pieces are the most viable resale items, generally trading at accessible prices well below heritage-workwear names.',
    resale: 'Moderate', demand: 6.7, sellSpeed: 'Moderate',
    products: ['Work Pants', 'Longtail Tees', 'Flannel Shirts', 'Jackets'],
  },
  'Ariat': {
    country: 'United States', founded: '1993', domain: 'ariat.com',
    description: 'Ariat was founded in 1993 by Beth Cross and Pam Parker, named after the racehorse Secretariat, with the goal of bringing athletic-shoe technology and comfort to equestrian and western footwear. It became a leader in riding boots, western boots, and work boots, blending performance features with traditional cowboy-boot styling. On the resale market Ariat has steady, practical demand within the western, equestrian, and workwear communities: its riding boots, western boots, and rugged work footwear hold solid value among buyers who know the brand, and discontinued styles draw interest. It is a function-and-heritage brand rather than a fashion-hype name. Value depends heavily on the model, leather, size (a major factor for boots), and condition; well-kept western and riding boots in popular sizes retain value best secondhand.',
    resale: 'Moderate', demand: 7.0, sellSpeed: 'Moderate',
    products: ['Western Boots', 'Riding Boots', 'Work Boots', 'Apparel'],
  },
  'Timberland': {
    country: 'United States', founded: '1973', domain: 'timberland.com',
    description: 'The Timberland brand was born in 1973, when the Boston-based Abington Shoe Company (run by the Swartz family) used injection-molding technology to create its first truly waterproof leather boot—the now-iconic wheat-nubuck "Yellow Boot." The company renamed itself Timberland in 1978 and is now owned by VF Corporation. The 6-inch boot became a cultural icon far beyond workwear, deeply tied to hip-hop and New York street style. On the resale market Timberland has strong, fast demand: the classic 6-inch wheat boot is an evergreen staple, while collaborations (Supreme, BAPE, Off-White, and others) and discontinued colorways command significant premiums. Vintage and limited makes draw collector interest. Value depends on the model, colorway, size, collaboration status, and condition; sold-out collaborations carry the highest premiums, and authentication matters for hyped releases.',
    resale: 'High', demand: 7.8, sellSpeed: 'Fast',
    products: ['6-Inch Boots', 'Field Boots', 'Boat Shoes', 'Collab Boots'],
  },
  'Wolverine': {
    country: 'United States', founded: '1883', domain: 'wolverine.com',
    description: 'Wolverine was founded in 1883 in Rockford, Michigan, by G.A. Krause, building durable leather work boots and becoming one of America\'s oldest continuously operating footwear companies. It is best known for the heritage 1000 Mile boot—a Goodyear-welted, resoleable leather boot named for its durability—and a long history supplying work and military footwear. On the resale market Wolverine has steady demand among heritage-footwear and workwear enthusiasts: the 1000 Mile boot and other Goodyear-welted leather styles hold value well, especially limited makes and collaborations (with brands and shops), and vintage USA-made pairs are sought. It is a heritage-craft brand rather than a hype name, so demand is durable. Value depends on the model, leather, size, country of manufacture, and condition; resoleable welted boots retain value even with wear, as they can be restored.',
    resale: 'Moderate', demand: 7.0, sellSpeed: 'Moderate',
    products: ['1000 Mile Boots', 'Work Boots', 'Leather Boots', 'Chukkas'],
  },
  'Orvis': {
    country: 'United States', founded: '1856', domain: 'orvis.com',
    description: 'Orvis was founded in 1856 by Charles F. Orvis in Manchester, Vermont, making it one of the oldest mail-order retailers in the United States. Rooted in fly fishing—it is a legendary name in rods, reels, and angling gear—the brand expanded into upscale country-lifestyle and sporting apparel, wingshooting gear, and dog products. On the resale market Orvis has steady, niche demand: its fly-fishing equipment (especially higher-end and vintage rods and reels) holds value among anglers, while its sporting apparel and waxed/field jackets draw moderate interest. The fishing gear is the strongest resale category, with classic bamboo and discontinued premium rods sought by collectors. Value depends heavily on the category—fishing equipment outperforms apparel—plus the model, vintage status, and condition; well-kept rods and reels are the most liquid and valuable secondhand items.',
    resale: 'Moderate', demand: 6.8, sellSpeed: 'Moderate',
    products: ['Fly Rods', 'Reels', 'Field Jackets', 'Sporting Apparel'],
  },
  'Quiksilver': {
    country: 'Australia', founded: '1969', domain: 'quiksilver.com',
    description: 'Quiksilver was founded in 1969 in Torquay, Australia, by Alan Green and John Law, beginning with innovative boardshorts and growing into one of the largest surf brands in the world, recognizable by its mountain-and-wave logo. It defined surf-lifestyle apparel for decades alongside its sister brand Roxy. On the resale market Quiksilver has steady demand among surf-culture and vintage enthusiasts: 80s and 90s pieces with the classic logo, vintage boardshorts, and any collaborations draw the most interest, while general modern apparel moves at a moderate pace. The surf-heritage appeal and Y2K nostalgia support vintage demand. Value depends on the era, design, and condition; vintage logo pieces and rare collaborations carry the strongest premiums, while contemporary mall-stock items trade at accessible prices.',
    resale: 'Moderate', demand: 7.0, sellSpeed: 'Moderate',
    products: ['Boardshorts', 'Graphic Tees', 'Hoodies', 'Jackets'],
  },
  'Billabong': {
    country: 'Australia', founded: '1973', domain: 'billabong.com',
    description: 'Billabong was founded in 1973 on Australia\'s Gold Coast by Gordon and Rena Merchant, starting with hand-made boardshorts sold to local surf shops and growing into a global surf-and-skate apparel giant. The name comes from an Australian term for a watering hole. On the resale market Billabong has steady demand among surf-culture and vintage buyers: vintage 80s and 90s logo pieces, classic boardshorts, and any collaborations draw the most collector interest, while modern apparel moves at a moderate pace. Surf-heritage nostalgia and the Y2K revival support secondhand demand for older pieces. Value depends on the era, design, and condition; vintage logo apparel and rare pieces carry the strongest premiums, while current mass-market stock trades at accessible prices well below the vintage market.',
    resale: 'Moderate', demand: 7.0, sellSpeed: 'Moderate',
    products: ['Boardshorts', 'Graphic Tees', 'Hoodies', 'Flannels'],
  },
  'Volcom': {
    country: 'United States', founded: '1991', domain: 'volcom.com',
    description: 'Volcom was founded in 1991 in California by Richard Woolcott and Tucker Hall, becoming the first brand to unite surf, skate, and snowboarding under one "Youth Against Establishment" banner, marked by its stone diamond logo. It built strong credibility across boardsports with team riders and an irreverent, art-driven identity. On the resale market Volcom has steady demand among boardsports and streetwear-nostalgia buyers: vintage stone-logo pieces, snowboarding outerwear, and collaborations draw the most interest, while general apparel moves at a moderate pace. The cross-boardsport heritage and 90s/Y2K nostalgia support demand for older pieces. Value depends on the era, design, category (technical snow outerwear can hold more value), and condition; vintage logo apparel and limited collaborations carry the strongest premiums, with mainstream stock trading at accessible prices.',
    resale: 'Moderate', demand: 7.1, sellSpeed: 'Moderate',
    products: ['Graphic Tees', 'Snowboard Outerwear', 'Hoodies', 'Boardshorts'],
  },
  'Hurley': {
    country: 'United States', founded: '1999', domain: 'hurley.com',
    description: 'Hurley was founded in 1999 in Costa Mesa, California, by Bob Hurley, who had previously licensed Billabong in the US before launching his own youth-focused surf brand. Owned by Nike from 2002 to 2019, Hurley became a major name in surf apparel and boardshorts, blending surf culture with a streetwear edge and notable Nike-backed technical innovation (like Phantom boardshorts). On the resale market Hurley has steady, modest demand among surf and casual buyers: boardshorts, logo tees, and the Nike-era technical pieces move at a moderate pace, with some interest in vintage and Nike-collaboration items. It is a mainstream surf-lifestyle brand rather than a hype name, so resale values are generally accessible. Value depends on the era, design, and condition; Nike-era technical boardshorts and vintage logo pieces hold the most interest secondhand.',
    resale: 'Moderate', demand: 6.9, sellSpeed: 'Moderate',
    products: ['Boardshorts', 'Graphic Tees', 'Hoodies', 'Hats'],
  },
  'RVCA': {
    country: 'United States', founded: '2001', domain: 'rvca.com',
    description: 'RVCA (pronounced "ruca") was founded in 2001 by Pat Tenore in California, built around the "Balance of Opposites" philosophy that blends art, surf, skate, and fashion. Its ANP (Artist Network Program) collaborations with artists and the brand\'s crossover into MMA (through VA Sport) gave it a distinctive identity beyond typical boardsports labels. On the resale market RVCA has steady, modest demand among surf, skate, and art-streetwear buyers: graphic tees, artist-collaboration pieces, and the cleaner lifestyle apparel move at a moderate pace, with ANP and limited art collaborations drawing the most collector interest. The art-driven identity supports demand for distinctive graphics. Value depends on the design, collaboration status, and condition; sought-after artist collaborations and standout graphics carry the strongest premiums, while basics trade at accessible prices.',
    resale: 'Moderate', demand: 7.0, sellSpeed: 'Moderate',
    products: ['Graphic Tees', 'Hoodies', 'Button-Ups', 'Joggers'],
  },
  'Brixton': {
    country: 'United States', founded: '2004', domain: 'brixton.com',
    description: 'Brixton was founded in 2004 in Southern California, drawing on music, art, and a vintage-Americana sensibility to build a lifestyle brand best known for its hats—fedoras, flat caps, and the popular Hooligan snap cap—alongside apparel with a retro, working-class aesthetic. On the resale market Brixton has steady, modest demand: its hats are the core draw, with the Hooligan and felt fedoras holding accessible value, while flannels, tees, and outerwear move at a moderate pace. It is a lifestyle-and-headwear brand rather than a hype name, so resale skews toward accessible pricing and steady, design-driven demand. Value depends on the product (hats lead), style, and condition; popular and discontinued hat models are the most viable resale pieces, with apparel trading at modest prices.',
    resale: 'Moderate', demand: 6.9, sellSpeed: 'Moderate',
    products: ['Hats', 'Flannels', 'Graphic Tees', 'Jackets'],
  },
  'J.Crew': {
    country: 'United States', founded: '1983', domain: 'jcrew.com',
    description: 'J.Crew launched as a brand in 1983, growing from a catalog operation into a defining American "accessible luxury" preppy retailer, especially influential in the 2000s and early 2010s under creative director Jenna Lyons, when it was celebrated for polished, design-forward classics. On the resale market J.Crew has modest, practical demand: its cashmere sweaters, quality outerwear, and the Ludlow tailoring hold accessible value, while the Lyons-era pieces and certain collaborations (with Timex, New Balance, and others) draw the most collector interest. It is a mainstream contemporary brand rather than a hype name, so resale values are generally accessible and demand is style-driven. Value depends on the era (Lyons-era pieces are more sought), category, and condition; quality knitwear, tailoring, and collaborations are the most viable resale items.',
    resale: 'Moderate', demand: 6.8, sellSpeed: 'Moderate',
    products: ['Cashmere Sweaters', 'Tailoring', 'Oxford Shirts', 'Outerwear'],
  },
  'Madewell': {
    country: 'United States', founded: '2006', domain: 'madewell.com',
    description: 'Madewell, originally a 1937 New England workwear-and-denim manufacturer, was relaunched in 2006 by J.Crew (under Mickey Drexler) as a denim-focused contemporary brand aimed at millennial women. It became J.Crew Group\'s strongest performer, known for its high-quality jeans, casual basics, leather totes, and an approachable, lived-in aesthetic. On the resale market Madewell has steady, modest demand: its denim is the core draw and holds accessible value, while the leather Transport tote, boots, and casual staples move at a moderate pace. It is a contemporary mall-luxury brand rather than a hype name, so resale skews toward accessible pricing and practical, denim-led demand. Value depends on the category (denim and leather goods lead), style, and condition; well-kept jeans and the leather totes are the most viable resale items.',
    resale: 'Moderate', demand: 7.0, sellSpeed: 'Moderate',
    products: ['Denim Jeans', 'Leather Totes', 'Tees', 'Boots'],
  },
  'Vineyard Vines': {
    country: 'United States', founded: '1998', domain: 'vineyardvines.com',
    description: 'Vineyard Vines was founded in 1998 by brothers Shep and Ian Murray on Martha\'s Vineyard, who famously quit their corporate jobs to make neckties before building a full preppy lifestyle brand around the smiling-pink-whale logo. It became a staple of East Coast coastal-prep style, known for ties, polos, the Shep Shirt, and brightly colored casualwear. On the resale market Vineyard Vines has modest, steady demand among preppy-style buyers: its whale-logo polos, ties, and quarter-zips hold accessible value, with limited collaborations (such as licensed sports and Disney tie-ins) drawing some extra interest. It is a mainstream lifestyle brand rather than a hype name, so resale values stay accessible. Value depends on the item, any licensed collaboration, and condition; logo polos, ties, and special licensed pieces are the most viable resale items.',
    resale: 'Moderate', demand: 6.9, sellSpeed: 'Moderate',
    products: ['Polo Shirts', 'Neckties', 'Quarter-Zips', 'Shep Shirts'],
  },
  'Southern Tide': {
    country: 'United States', founded: '2006', domain: 'southerntide.com',
    description: 'Southern Tide was founded in 2006 by Allen Stephenson in Greenville, South Carolina, built around its Skipjack fish logo and a refined Southern-prep aesthetic, anchored by the premium Skipjack polo. It occupies a similar coastal-preppy lane to Vineyard Vines, with classic polos, performance fabrics, and casual Southern-lifestyle apparel. On the resale market Southern Tide has modest, niche demand among preppy and Southern-lifestyle buyers: its Skipjack polos and quarter-zips hold accessible value, while general apparel moves at a moderate-to-slow pace. It is a mainstream regional lifestyle brand rather than a hype or heritage name, so resale values are generally modest. Value depends on the item, style, and condition; the signature logo polos are the most recognizable and viable resale pieces, generally trading at accessible prices.',
    resale: 'Moderate', demand: 6.6, sellSpeed: 'Moderate',
    products: ['Skipjack Polos', 'Quarter-Zips', 'Shorts', 'Button-Ups'],
  },
  'Pendleton': {
    country: 'United States', founded: '1863', domain: 'pendleton-usa.com',
    description: 'Pendleton Woolen Mills traces its roots to 1863 and the Bishop family\'s Oregon woolen heritage, with its landmark Pendleton mill opening in 1909. It is a storied American maker famed for its Native American–inspired trade blankets, virgin-wool plaid shirts (the Board Shirt), and the National Park blanket series. On the resale market Pendleton has strong, steady demand among heritage and Americana collectors: vintage wool blankets (especially rare patterns and the Beaver State and National Park designs), vintage Board Shirts, and the Pendleton x brands collaborations command solid premiums. The blankets in particular have a robust collector market. Value depends heavily on the item—blankets and vintage wool lead—plus the pattern, age, and condition; rare and discontinued blanket patterns in good condition are the most sought and valuable secondhand.',
    resale: 'High', demand: 7.6, sellSpeed: 'Moderate',
    products: ['Wool Blankets', 'Board Shirts', 'Wool Coats', 'Bags'],
  },
  'London Fog': {
    country: 'United States', founded: '1923', domain: 'londonfog.com',
    description: 'London Fog traces to 1923, founded in Baltimore as the Londontown Clothing Company, and adopted the London Fog name in the 1950s. It became the best-known American maker of trench coats and rainwear in the mid-20th century, supplying weather-resistant coats (including for the US Navy in WWII) and becoming a household name for the classic belted trench. On the resale market London Fog has modest, steady demand: vintage mid-century trench coats and rainwear hold the most interest among vintage-fashion buyers, while modern licensed-era pieces trade at accessible prices. The brand sits below luxury-trench names in resale value but the classic vintage coats have a dependable secondhand following. Value depends on the era (vintage outperforms modern), style, and condition; well-kept vintage trench coats are the most viable resale items.',
    resale: 'Moderate', demand: 6.5, sellSpeed: 'Moderate',
    products: ['Trench Coats', 'Raincoats', 'Outerwear', 'Jackets'],
  },
  'Free People': {
    country: 'United States', founded: '1984', domain: 'freepeople.com',
    description: 'Free People launched as a wholesale label in 1984 under Urban Outfitters founder Dick Hayne (the original early-1970s store name was revived for the brand). It became a leading bohemian women\'s apparel and lifestyle brand, known for flowy dresses, romantic boho aesthetics, the FP Movement activewear line, and an eclectic, festival-friendly sensibility. On the resale market Free People has strong, steady demand among younger women and boho-style buyers: its dresses, the Adella and intimates pieces, and FP Movement activewear move at a moderate-to-fast pace, with discontinued and sold-out styles drawing extra interest. The distinctive aesthetic and loyal following support a healthy secondhand market. Value depends on the specific style, rarity (discontinued pieces command more), and condition; popular dresses and sought-after sold-out items are the most viable resale pieces.',
    resale: 'High', demand: 7.4, sellSpeed: 'Moderate',
    products: ['Dresses', 'Boho Tops', 'FP Movement Activewear', 'Intimates'],
  },
  'Anthropologie': {
    country: 'United States', founded: '1992', domain: 'anthropologie.com',
    description: 'Anthropologie was founded in 1992 in Wayne, Pennsylvania, as part of the Urban Outfitters group, targeting a slightly older, design-conscious woman with a curated, eclectic mix of apparel, home goods, and accessories in a distinctive bohemian-meets-vintage aesthetic. It is known for unique prints, romantic dresses, and a strong home and décor business. On the resale market Anthropologie has steady, healthy demand among women who appreciate its distinctive style: its dresses, the in-house labels (Maeve, Pilcro), and sought-after home pieces move at a moderate pace, with discontinued and limited prints drawing extra interest. The curated, often hard-to-replace designs support secondhand demand. Value depends on the specific piece, the in-house brand, rarity, and condition; distinctive dresses and discontinued prints are the most viable and sought resale items.',
    resale: 'High', demand: 7.3, sellSpeed: 'Moderate',
    products: ['Dresses', 'Blouses', 'Home Goods', 'Accessories'],
  },
  'Urban Outfitters': {
    country: 'United States', founded: '1970', domain: 'urbanoutfitters.com',
    description: 'Urban Outfitters was founded in 1970 near the University of Pennsylvania by Dick Hayne (originally as the "Free People\'s Store," renamed in 1976), growing into a major youth-focused lifestyle retailer and the flagship of the URBN group (which also owns Anthropologie and Free People). It is known for trend-driven apparel, vintage-inspired and reworked pieces, music and pop-culture merch, quirky home goods, and exclusive brand collaborations. On the resale market Urban Outfitters has steady, modest demand among younger and vintage-leaning buyers: its UO-exclusive collaborations, reworked vintage, branded band and pop-culture tees, and trend pieces draw the most interest, while general apparel moves at a moderate pace. Value depends on the specific item, exclusivity or collaboration status, and condition; UO-exclusive collaborations and standout reworked or graphic pieces are the most viable resale items.',
    resale: 'Moderate', demand: 7.0, sellSpeed: 'Moderate',
    products: ['Graphic Tees', 'Trend Apparel', 'Home Goods', 'Vintage Pieces'],
  },
  'Johnny Was': {
    country: 'United States', founded: '1987', domain: 'johnnywas.com',
    description: 'Johnny Was was founded in 1987 in Los Angeles, building its identity around intricate signature embroidery and a bohemian, free-spirited aesthetic rooted in California style. It is known for elaborately embroidered blouses, dresses, kimonos, and tunics in flowing silhouettes and rich prints, positioned as an elevated boho brand. On the resale market Johnny Was has steady, niche demand among boho and embroidery-loving buyers: its signature embroidered blouses, dresses, and kimonos hold solid value, with the labor-intensive embroidery and distinctive prints supporting secondhand desirability. It commands higher resale than typical boho-mall brands thanks to its craftsmanship and price point. Value depends on the specific piece, the intricacy of the embroidery, and condition; the elaborately embroidered tops, dresses, and kimonos are the most sought and valuable resale items.',
    resale: 'Moderate', demand: 7.0, sellSpeed: 'Moderate',
    products: ['Embroidered Blouses', 'Dresses', 'Kimonos', 'Tunics'],
  },
  'Eileen Fisher': {
    country: 'United States', founded: '1984', domain: 'eileenfisher.com',
    description: 'Eileen Fisher was founded in 1984 in New York by Eileen Fisher, built on a philosophy of simple, timeless, comfortable women\'s clothing in a minimalist, fluid silhouette with high-quality natural fabrics. The brand is also a sustainability leader, pioneering its Renew take-back-and-resell program for circular fashion. On the resale market Eileen Fisher has steady, healthy demand among buyers who value quality, comfort, and sustainability: its silk and linen pieces, fine knitwear, and timeless basics hold solid value, helped by the brand\'s own resale ecosystem (Renew) which legitimizes secondhand demand. The understated, durable designs age well. Value depends on the fabric (silk, linen, and fine wool lead), the piece, and condition; high-quality natural-fiber tops, knitwear, and dresses are the most viable and consistently demanded resale items.',
    resale: 'High', demand: 7.2, sellSpeed: 'Moderate',
    products: ['Silk Tops', 'Linen Pieces', 'Knitwear', 'Dresses'],
  },
  'Soft Surroundings': {
    country: 'United States', founded: '1999', domain: 'softsurroundings.com',
    description: 'Soft Surroundings was founded in 1999, beginning as a catalog and growing into a women\'s apparel, beauty, and home brand focused on comfortable, flowing, relaxed-fit clothing in soft natural fabrics, aimed largely at an older demographic seeking ease and elegance. It is known for drapey tunics, comfortable knits, and a soothing lifestyle aesthetic. On the resale market Soft Surroundings has modest, niche demand: its comfortable tunics, knits, and flowing pieces in quality fabrics hold accessible value among buyers who favor the relaxed aesthetic, while demand moves at a moderate-to-slow pace. It is a comfort-and-lifestyle brand rather than a hype or heritage name, so resale values are generally modest. Value depends on the fabric, the specific piece, and condition; soft natural-fiber tunics and knits are the most viable resale items, typically trading at accessible prices.',
    resale: 'Moderate', demand: 6.5, sellSpeed: 'Moderate',
    products: ['Tunics', 'Knit Tops', 'Dresses', 'Loungewear'],
  },
  'Sundance': {
    country: 'United States', founded: '1989', domain: 'sundancecatalog.com',
    description: 'The Sundance Catalog was founded in 1989 by Robert Redford, extending the spirit of his Sundance community in the Utah mountains into a women\'s apparel, jewelry, and home brand. It is known for artisan-made and Western-influenced pieces—distinctive handcrafted jewelry, flowing apparel, and a rustic-elegant aesthetic rooted in the American West. On the resale market Sundance has steady, niche demand, strongest in its jewelry: handcrafted sterling silver and artisan pieces hold solid value among buyers who appreciate the Western-artisan aesthetic, while apparel moves at a moderate pace. The jewelry\'s craftsmanship and the Redford association support its secondhand desirability. Value depends on the category (artisan jewelry leads), craftsmanship, and condition; distinctive handcrafted sterling and stone jewelry pieces are the most sought and valuable resale items, with apparel trading at more accessible prices.',
    resale: 'Moderate', demand: 6.6, sellSpeed: 'Moderate',
    products: ['Artisan Jewelry', 'Dresses', 'Tops', 'Accessories'],
  },

  // ── UNCOMMON TIER, BATCH 2 (fully curated, 100–150 words each) ──────────────
  'Boden': {
    country: 'United Kingdom', founded: '1991', domain: 'bodenusa.com',
    description: 'Boden was founded in 1991 in London by Johnnie Boden, starting as a small menswear catalog of eight products before growing into a beloved British lifestyle brand for women, men, and children. It is known for cheerful prints, bright colors, quality fabrics, and a distinctly British sense of playful, polished casualwear sold largely direct through catalog and online. On the resale market Boden has modest, steady demand among buyers who favor its colorful, well-made aesthetic: its dresses, printed pieces, and quality knitwear hold accessible value, with discontinued prints drawing some extra interest. It is a mainstream lifestyle brand rather than a hype or heritage name, so resale values stay accessible. Value depends on the specific piece, the print, and condition; distinctive printed dresses and well-kept quality basics are the most viable resale items.',
    resale: 'Moderate', demand: 6.6, sellSpeed: 'Moderate',
    products: ['Printed Dresses', 'Knitwear', 'Casualwear', 'Childrenswear'],
  },
  'Flax': {
    country: 'United States', founded: '1985', domain: 'flaxdesigns.com',
    description: 'FLAX is a linen-focused clothing line created by designer Jeanne Engelhart under Angelheart Designs, emerging in the mid-1980s and becoming a cult favorite for its relaxed, artistic, layerable garments cut almost entirely from natural linen. The brand built a devoted following—especially among artists, educators, and an older creative demographic—for its easy silhouettes, earthy palette, and comfortable, timeless aesthetic. On the resale market FLAX has steady, niche demand among linen devotees and vintage-clothing buyers: its breathable linen tops, dresses, and trousers hold accessible value, and out-of-production vintage FLAX pieces are actively sought by collectors who prize the older designs. The natural-fiber appeal and durable fabric keep used pieces wearable. Value depends on the era (vintage Engelhart-era pieces command more), the garment, and condition; well-kept linen pieces in distinctive cuts are the most viable resale items.',
    resale: 'Moderate', demand: 6.7, sellSpeed: 'Moderate',
    products: ['Linen Tops', 'Linen Dresses', 'Trousers', 'Layering Pieces'],
  },
  'Lululemon': {
    country: 'Canada', founded: '1998', domain: 'lululemon.com',
    description: 'Lululemon was founded in 1998 by Chip Wilson in Vancouver, Canada, pioneering technical yoga apparel and effectively creating the premium "athleisure" category. It is best known for the Align leggings (in buttery Nulu fabric), the ABC pants, and the Define jacket, built on proprietary performance fabrics and a strong community-driven retail model. On the resale market Lululemon is a powerhouse with broad, fast demand: leggings (especially the Align), Scuba hoodies, and bags like the Everywhere Belt Bag move quickly, while limited "We Made Too Much" drops, seasonal colors, and discontinued shades command premiums above retail. The loyal following and frequent sellouts support a very active secondhand market. Value depends on the style, the specific (often discontinued) color, size, and condition; popular leggings in sought-after colors and limited seasonal pieces hold value best.',
    resale: 'High', demand: 8.0, sellSpeed: 'Fast',
    products: ['Align Leggings', 'Scuba Hoodies', 'Belt Bags', 'ABC Pants'],
  },
  'Athleta': {
    country: 'United States', founded: '1998', domain: 'athleta.com',
    description: 'Athleta was founded in 1998 as a women\'s performance-apparel catalog and was acquired by Gap Inc. in 2008, growing into a major activewear and athleisure brand and a certified B Corp with a focus on women\'s sport, inclusivity, and sustainability. It is known for versatile leggings, the Salutation and Ultra-High Rise styles, and outdoor-to-studio crossover pieces. On the resale market Athleta has steady, modest demand among activewear buyers: its leggings, dresses, and versatile performance pieces hold accessible value, often positioned as a value alternative to pricier athleisure names, with discontinued styles and prints drawing some interest. It is a mainstream activewear brand rather than a hype name, so resale values stay accessible. Value depends on the style, color, size, and condition; popular leggings and versatile dresses in good condition are the most viable resale items.',
    resale: 'Moderate', demand: 7.0, sellSpeed: 'Moderate',
    products: ['Leggings', 'Activewear Dresses', 'Sports Bras', 'Joggers'],
  },
  'Alo Yoga': {
    country: 'United States', founded: '2007', domain: 'aloyoga.com',
    description: 'Alo Yoga was founded in 2007 in Los Angeles by Danny Harris and Marco DeGeorge (the name stands for Air, Land, Ocean), building a premium yoga and athleisure brand with a strong fashion-forward, celebrity-and-influencer-driven identity. It is known for sleek leggings (the Airbrush and 7/8 High-Waist), the Accolade hoodie, and a polished, studio-to-street aesthetic. On the resale market Alo has strong, steady demand among activewear and fashion buyers: its leggings, matching sets, and the Accolade hoodie move at a moderate-to-fast pace, with limited colors and collaborations drawing extra interest. The brand\'s trend relevance and celebrity association support secondhand demand. Value depends on the style, the specific color, size, and condition; popular leggings, sought-after sets, and limited seasonal colorways hold value best, while basics trade at more accessible prices.',
    resale: 'High', demand: 7.6, sellSpeed: 'Moderate',
    products: ['Leggings', 'Matching Sets', 'Hoodies', 'Sports Bras'],
  },
  'Gymshark': {
    country: 'United Kingdom', founded: '2012', domain: 'gymshark.com',
    description: 'Gymshark was founded in 2012 in the UK by teenager Ben Francis, who began screen-printing and sewing gym apparel in his garage before building one of the fastest-growing fitness brands in the world, largely through influencer marketing and a direct-to-consumer model. It is known for fitted, performance gymwear—seamless leggings, the Vital and Adapt lines, and bodybuilding-friendly fits. On the resale market Gymshark has modest, steady demand among fitness buyers: its leggings, seamless sets, and popular training pieces hold accessible value, with limited drops and collaborations drawing the most interest. It is a mainstream fitness brand rather than a luxury or hype-streetwear name, so resale values are generally accessible. Value depends on the style, color, size, and condition; popular seamless leggings, matching sets, and sold-out limited releases are the most viable resale items.',
    resale: 'Moderate', demand: 7.0, sellSpeed: 'Moderate',
    products: ['Seamless Leggings', 'Training Sets', 'Sports Bras', 'Shorts'],
  },
  'Vuori': {
    country: 'United States', founded: '2015', domain: 'vuoriclothing.com',
    description: 'Vuori was founded in 2015 by Joe Kudla in Encinitas, California, built around a coastal, surf-and-yoga-inspired lifestyle and an emphasis on versatile, ultra-soft performance apparel that crosses from workout to everyday wear. It became a fast-rising athleisure brand best known for the Kore short and the buttery Ponto and DreamKnit fabrics, with a relaxed Southern California sensibility. On the resale market Vuori has solid, growing demand among athleisure and lifestyle buyers: its joggers, the Kore and Ponto shorts, and soft everyday pieces move at a moderate pace, with discontinued colors drawing some interest. The brand\'s comfort reputation and rising popularity support steady secondhand demand. Value depends on the style, color, size, and condition; the popular joggers and shorts in good condition are the most viable resale items, generally trading at accessible prices.',
    resale: 'High', demand: 7.4, sellSpeed: 'Moderate',
    products: ['Joggers', 'Kore Shorts', 'Tees', 'Hoodies'],
  },
  'TravisMathew': {
    country: 'United States', founded: '2007', domain: 'travismathew.com',
    description: 'TravisMathew was co-founded in 2007 in Huntington Beach, California, by Travis Johnson, Travis Brasher, and John Kruger, and was acquired by Callaway in 2017. It redefined golf apparel by blending performance with a relaxed Southern California lifestyle aesthetic, building pieces that move easily from the course to everyday wear, anchored by polos, performance pants, and its popular hats. On the resale market TravisMathew has modest, steady demand among golf and lifestyle buyers: its polos, performance pants, and especially its hats hold accessible value, with limited and tour-collection pieces drawing some interest. It is a mid-premium lifestyle-golf brand rather than a hype name, so resale values stay accessible. Value depends on the item, style, and condition; popular polos and the sought-after hats are the most viable resale pieces, while basics trade at modest prices.',
    resale: 'Moderate', demand: 7.0, sellSpeed: 'Moderate',
    products: ['Polo Shirts', 'Performance Pants', 'Hats', 'Hoodies'],
  },
  'Peter Millar': {
    country: 'United States', founded: '2001', domain: 'petermillar.com',
    description: 'Peter Millar was founded in 2001 in Raleigh, North Carolina, by Chris Knott, Greg Oakley, and Chet Sikorsky, beginning with a single signature cashmere sweater before building a premium golf-and-lifestyle apparel brand. Now owned by Richemont, it is known for refined craftsmanship, luxurious fabrics, and a classic country-club aesthetic spanning performance golf wear, tailored clothing, and the Crown Sport and Crown Crafted lines. On the resale market Peter Millar has steady, modest demand among golf and upscale-casual buyers: its quarter-zips, performance polos, and cashmere hold solid accessible value thanks to the premium materials, with the brand\'s quality supporting secondhand desirability. It sits above mass golf brands but below luxury-fashion names in resale. Value depends on the fabric (cashmere and premium performance pieces lead), style, and condition; quality knitwear, quarter-zips, and polos are the most viable resale items.',
    resale: 'Moderate', demand: 7.1, sellSpeed: 'Moderate',
    products: ['Cashmere Sweaters', 'Performance Polos', 'Quarter-Zips', 'Tailoring'],
  },
  'FootJoy': {
    country: 'United States', founded: '1857', domain: 'footjoy.com',
    description: 'FootJoy traces its roots to 1857 and the Burt and Packard Shoe Company of Brockton, Massachusetts (later Field and Flint), which first used the FootJoy name in 1923 and eventually adopted it as the company name. Now owned by Acushnet (the parent of Titleist), FootJoy is the dominant name in golf footwear—the #1 shoe on the PGA Tour since 1945—and also a leader in golf gloves (the Sta-Sof) and socks. On the resale market FootJoy has steady, niche demand among golfers: its golf shoes and gloves hold practical value, with the classic Premiere Series and Classics, plus limited and tour styles, drawing the most interest. It is a function-and-heritage golf brand rather than a fashion-hype name. Value depends on the model, size, and condition; well-kept golf shoes in popular sizes are the most viable resale items.',
    resale: 'Moderate', demand: 6.8, sellSpeed: 'Moderate',
    products: ['Golf Shoes', 'Golf Gloves', 'Socks', 'Outerwear'],
  },
  'Titleist': {
    country: 'United States', founded: '1932', domain: 'titleist.com',
    description: 'Titleist was founded in 1932 when Phil Young, frustrated by a misbehaving golf ball, set out to build a better one under the Acushnet Company in Massachusetts. It became the dominant premium golf-ball brand—the Pro V1 is the most-played ball on tour—and also makes acclaimed clubs and the coveted Scotty Cameron putters. On the resale market Titleist has steady demand within golf, strongest in equipment and accessories: while balls are consumables, its Scotty Cameron putters are serious collector items that hold and appreciate in value, and its hats, headcovers, and apparel have a loyal following. The branded headwear and tour-issue gear move well. Value depends heavily on the category—Scotty Cameron putters and limited tour items lead—plus the model, rarity, and condition; collectible putters and limited headcovers are the most valuable and sought secondhand items.',
    resale: 'Moderate', demand: 7.2, sellSpeed: 'Moderate',
    products: ['Golf Hats', 'Headcovers', 'Apparel', 'Golf Gloves'],
  },
  'Callaway': {
    country: 'United States', founded: '1982', domain: 'callawaygolf.com',
    description: 'Callaway Golf was founded in 1982 by Ely Callaway in Carlsbad, California, and revolutionized the game with oversized, forgiving club designs—most famously the Big Bertha driver, which made the brand a household name. It is a leading maker of clubs, balls, and golf gear, and owns lifestyle brands including TravisMathew and Ogio. On the resale market Callaway has steady demand within golf, strongest in equipment: its drivers, irons, and the Big Bertha and Rogue/Paradym lines hold solid resale value among golfers, while its branded apparel, hats, and accessories have a modest following. Used clubs in good condition trade actively. Value depends heavily on the category—clubs lead—plus the model, how current it is, and condition; recent-generation drivers and complete iron sets in good shape are the most valuable and liquid resale items, with apparel trading at accessible prices.',
    resale: 'Moderate', demand: 7.0, sellSpeed: 'Moderate',
    products: ['Golf Clubs', 'Hats', 'Apparel', 'Golf Balls'],
  },
  'Birkenstock': {
    country: 'Germany', founded: '1774', domain: 'birkenstock.com',
    description: 'Birkenstock traces its roots to 1774 in Germany, when Johann Adam Birkenstock was registered as a cobbler, though the modern brand is built on the contoured cork-and-latex footbed developed by the family in the 20th century. It is famous for the Arizona two-strap sandal, the Boston clog, and the Gizeh, all prized for their orthopedic support and broken-in comfort. On the resale market Birkenstock has strong, fast demand: the Boston clog in particular became a major sought-after item, while the Arizona, limited collaborations (with brands like Dior, Stüssy, and others), and discontinued colors and materials command premiums. The cork footbed wears in rather than out, keeping used pairs desirable. Value depends on the model, material (suede, leather, special editions), size, collaboration status, and condition; the Boston clog and limited collaborations carry the strongest premiums.',
    resale: 'High', demand: 7.8, sellSpeed: 'Fast',
    products: ['Arizona Sandals', 'Boston Clogs', 'Gizeh Sandals', 'Footbeds'],
  },
  'Dr. Martens': {
    country: 'United Kingdom', founded: '1960', domain: 'drmartens.com',
    description: 'Dr. Martens as the world recognizes it began on April 1, 1960, when England\'s Griggs family started making the air-cushioned boot in Northamptonshire—hence the flagship 1460 boot\'s name. The bouncy sole itself was invented in 1945 by Dr. Klaus Märtens in Germany. The brand became a counterculture icon, adopted by skinheads, punks, grunge fans, and generations of subcultures. On the resale market Dr. Martens has strong, fast demand: the 1460 eight-eye boot and 1461 shoe are evergreen staples, while vintage "Made in England" pairs, discontinued leathers, and collaborations (with brands and designers) command premiums. The durable, resoleable construction keeps used pairs wearable. Value depends on the model, the leather, size, country of manufacture (England-made is prized), collaboration status, and condition; vintage England-made pairs and sold-out collaborations carry the strongest premiums.',
    resale: 'High', demand: 7.9, sellSpeed: 'Fast',
    products: ['1460 Boots', '1461 Shoes', 'Chelsea Boots', 'Sandals'],
  },
  'Merrell': {
    country: 'United States', founded: '1981', domain: 'merrell.com',
    description: 'Merrell was founded in 1981 by Randy Merrell, Clark Matis, and John Schweizer, beginning with handcrafted hiking boots and growing into a major outdoor-footwear brand (now part of Wolverine World Wide). It is best known for the Moab hiking shoe—one of the best-selling hikers in the world—plus trail runners and the Jungle Moc. On the resale market Merrell has modest, steady demand among hikers and outdoor buyers: the Moab and other hiking shoes hold accessible practical value, while the brand\'s experimental 1TRL line and the Hydro Moc clog have generated genuine streetwear hype and command premiums on limited drops and collaborations. Value depends on the line—mainstream hikers trade at accessible prices while 1TRL and collaborations carry premiums—plus the model, size, and condition; sought-after 1TRL releases and well-kept popular hikers are the most viable resale items.',
    resale: 'Moderate', demand: 7.0, sellSpeed: 'Moderate',
    products: ['Moab Hikers', 'Trail Runners', 'Hydro Moc Clogs', 'Boots'],
  },
  'Keen': {
    country: 'United States', founded: '2003', domain: 'keenfootwear.com',
    description: 'KEEN was founded in 2003 by Martin Keen and Rory Fuerst, launching with the Newport sandal—a hybrid sport sandal with a distinctive protective toe bumper that became its signature and reshaped the category. The brand is known for rugged, comfortable, foot-shaped outdoor footwear with a values-driven, independently owned ethos. On the resale market KEEN has modest, steady demand among outdoor and casual buyers: the Newport sandal, the Targhee hiker, and the Uneek hold accessible practical value, with limited collaborations and discontinued colors drawing some interest. It is a function-and-comfort brand rather than a hype name, so resale values stay accessible. Value depends on the model, size, and condition; the signature Newport sandals and Targhee hikers in good condition are the most viable resale items, generally trading at accessible prices.',
    resale: 'Moderate', demand: 6.8, sellSpeed: 'Moderate',
    products: ['Newport Sandals', 'Targhee Hikers', 'Uneek Sandals', 'Boots'],
  },
  'UGG': {
    country: 'United States', founded: '1978', domain: 'ugg.com',
    description: 'UGG as a brand was founded in 1978 by Australian surfer Brian Smith, who brought sheepskin boots to California; it is now owned by Deckers. Famous for its plush sheepskin Classic boots—which became a 2000s phenomenon—UGG has cycled back into intense popularity through Gen Z, driven by the Tasman slipper, the Ultra Mini, and the Tazz. On the resale market UGG has strong, fast demand: the Tasman, Ultra Mini, and Tazz frequently sell out and resell above retail, while limited collaborations (with brands like Telfar and others) and seasonal colors command significant premiums. Trend cycles drive sharp demand spikes. Value depends on the model, the specific (often sold-out) color, size, collaboration status, and condition; sought-after sold-out colorways and collaborations carry the strongest premiums, and authentication matters as UGG is heavily counterfeited.',
    resale: 'High', demand: 7.8, sellSpeed: 'Fast',
    products: ['Classic Boots', 'Tasman Slippers', 'Ultra Mini Boots', 'Slippers'],
  },
  'Sperry': {
    country: 'United States', founded: '1935', domain: 'sperry.com',
    description: 'Sperry was founded in 1935 by Paul Sperry, who invented the original boat shoe—the Top-Sider—after noticing how his dog gripped icy surfaces and cutting a siped, non-slip pattern into the rubber sole. The Authentic Original boat shoe became an enduring American preppy and nautical staple. On the resale market Sperry has modest, steady demand: its boat shoes and the classic Top-Sider hold accessible value among preppy and nautical-style buyers, with collaborations and limited editions drawing some interest. It is a heritage-casual brand rather than a hype name, so resale values stay accessible. Value depends on the model, leather, size, and condition; the classic boat shoes in good condition are the most viable resale items, typically trading at accessible prices, with broken-in pairs still desirable for the worn-in nautical look.',
    resale: 'Moderate', demand: 6.7, sellSpeed: 'Moderate',
    products: ['Boat Shoes', 'Top-Siders', 'Loafers', 'Duck Boots'],
  },
  'Fossil': {
    country: 'United States', founded: '1984', domain: 'fossil.com',
    description: 'Fossil was founded in 1984 in Texas by Tom Kartsotis, building an accessible fashion-watch brand with a vintage-Americana aesthetic (its retro tins became a signature). It grew into a major accessories company, also producing watches under license for many fashion houses, plus leather goods and the Gen-series smartwatches. On the resale market Fossil has modest, steady demand: its automatic and mechanical watches, leather bags, and the limited-edition and vintage tin-packaged pieces hold accessible value, while smartwatches depreciate quickly. The mechanical watches and distinctive vintage pieces draw the most collector interest. It is a mainstream accessories brand rather than a luxury or hype name. Value depends on the category (mechanical watches and leather goods lead), the model, and condition; well-kept automatic watches and quality leather bags are the most viable resale items, with smartwatches holding little value.',
    resale: 'Moderate', demand: 6.8, sellSpeed: 'Moderate',
    products: ['Watches', 'Leather Bags', 'Wallets', 'Sunglasses'],
  },
  'Tumi': {
    country: 'United States', founded: '1975', domain: 'tumi.com',
    description: 'Tumi was founded in 1975 by Charlie Clifford (named after a Peruvian friend), and built its reputation in the late 1980s on its signature soft black ballistic-nylon luggage favored by business travelers. Now owned by Samsonite, it is a premium travel and lifestyle brand known for durable, highly functional bags, the Alpha collection, and the FXT ballistic nylon. On the resale market Tumi holds value well for a bag brand: its carry-ons, the Alpha business cases, and backpacks retain solid value, with limited collaborations (with brands like McLaren and others) and discontinued lines drawing extra interest. The durability and repair program support secondhand demand. Value depends on the line, material, and condition—functional wheels, zippers, and handles matter—plus any collaboration branding; well-kept Alpha luggage and business bags are the most viable resale items.',
    resale: 'High', demand: 7.6, sellSpeed: 'Moderate',
    products: ['Carry-On Luggage', 'Business Bags', 'Backpacks', 'Travel Accessories'],
  },
  'Vera Bradley': {
    country: 'United States', founded: '1982', domain: 'verabradley.com',
    description: 'Vera Bradley was founded in 1982 by Barbara Bradley Baekgaard and Patricia Miller (named for Barbara\'s mother), launching with colorful quilted-cotton handbags and accessories that became a signature look. The brand is known for its distinctive paisley and floral patterns on lightweight, washable quilted bags, totes, and travel goods. On the resale market Vera Bradley has modest but devoted demand, especially for its patterns: retired and limited-edition prints are actively collected, and discontinued patterns in popular bag styles can command premiums well above their original accessible prices. The pattern-collecting community drives much of the secondhand interest. Value depends heavily on the pattern (retired and rare prints lead) plus the bag style and condition; bags in sought-after discontinued patterns are the most valuable resale items, while current common prints trade at modest prices.',
    resale: 'Moderate', demand: 6.6, sellSpeed: 'Moderate',
    products: ['Quilted Handbags', 'Totes', 'Travel Bags', 'Accessories'],
  },
  'Dooney & Bourke': {
    country: 'United States', founded: '1975', domain: 'dooney.com',
    description: 'Dooney & Bourke was founded in 1975 by Peter Dooney and Frederic Bourke in Connecticut, becoming known for sturdy, classic American leather handbags—especially the All-Weather Leather collection with its duck-tag logo, a preppy staple of the 1980s and 90s. The brand also produces signature-print coated-canvas bags and a long-running series of Disney collaborations. On the resale market Dooney & Bourke has steady, modest demand with a notable vintage angle: vintage 80s All-Weather Leather bags have a dedicated collector following, the Disney-collaboration pieces draw active interest, and classic leather styles hold accessible value, while contemporary signature-canvas bags depreciate more. Value depends on the era and line—vintage AWL and Disney collaborations lead—plus the style and condition; well-kept vintage leather bags and sought-after Disney pieces are the most viable and valuable resale items.',
    resale: 'Moderate', demand: 6.9, sellSpeed: 'Moderate',
    products: ['Leather Handbags', 'Signature Totes', 'Disney Bags', 'Wallets'],
  },
  'Brighton': {
    country: 'United States', founded: '1991', domain: 'brighton.com',
    description: 'Brighton Collectibles launched in 1991 when founders Jerry and Terri Kohl introduced a single collection of belts, though the couple\'s accessories business dates to the early 1970s. The California brand grew into a full accessories maker known for intricately detailed silver-tone hardware, heart motifs, leather handbags, and charm jewelry, sold largely through its own boutiques and specialty stores. On the resale market Brighton has modest, steady demand among its loyal, collector-minded customer base: its detailed jewelry, charms, and leather handbags hold accessible value, with discontinued and limited pieces drawing the most interest from devoted collectors. It is a specialty lifestyle-accessories brand rather than a hype or luxury name. Value depends on the piece, its detailing, and condition; distinctive jewelry, sought-after charms, and well-kept leather handbags are the most viable resale items, generally trading at accessible prices.',
    resale: 'Moderate', demand: 6.6, sellSpeed: 'Moderate',
    products: ['Charm Jewelry', 'Leather Handbags', 'Belts', 'Watches'],
  },
  'Oakley': {
    country: 'United States', founded: '1975', domain: 'oakley.com',
    description: 'Oakley was founded in 1975 by Jim Jannard (starting with a motocross grip before moving into eyewear), and built a reputation for bold, futuristic, performance-driven sunglasses with patented lens technology. Now owned by EssilorLuxottica, it is a sports-eyewear leader known for the Frogskins, Holbrook, Radar, and the cult-favorite metal Juliet and other "X-Metal" frames. On the resale market Oakley has strong demand with a serious collector scene: vintage and discontinued frames—especially the X-Metal Juliet, Romeo, and Penny, plus rare colorways and limited collaborations—command significant premiums, while current performance models hold moderate value. The dedicated collector community drives much of the secondhand market. Value depends heavily on the model and rarity—discontinued X-Metal and vintage frames lead—plus colorway and condition; rare vintage frames and limited editions are the most valuable, and authentication matters as Oakley is widely faked.',
    resale: 'High', demand: 7.6, sellSpeed: 'Moderate',
    products: ['Sunglasses', 'Frogskins', 'Holbrook Frames', 'Goggles'],
  },
  'Costa': {
    country: 'United States', founded: '1983', domain: 'costadelmar.com',
    description: 'Costa Del Mar (often just Costa) was founded in 1983 by Ray Ferguson in Daytona Beach, Florida, building high-performance polarized sunglasses specifically for fishermen and people who spend long days on the water. Now owned by EssilorLuxottica, it is known for premium glare-cutting polarized lenses, the 580 lens technology, and a strong fishing and outdoor following. On the resale market Costa has steady, niche demand among anglers and outdoor buyers: its polarized sunglasses hold accessible value, with popular models, the 580G glass-lens versions, and limited or discontinued frames drawing the most interest. It is a function-driven performance-eyewear brand rather than a fashion-hype name. Value depends on the model, the lens type (glass 580G commands more), and condition—lens quality is critical—plus any limited-edition status; well-kept premium-lens frames are the most viable resale items.',
    resale: 'Moderate', demand: 7.0, sellSpeed: 'Moderate',
    products: ['Polarized Sunglasses', 'Fishing Eyewear', 'Apparel', 'Hats'],
  },
  'Maui Jim': {
    country: 'United States', founded: '1980', domain: 'mauijim.com',
    description: 'Maui Jim began in 1980 when a fisherman started selling sunglasses on the beaches of Lahaina, Hawaii, growing into a major premium sunglass brand now headquartered in Peoria, Illinois (and owned by Kering). It is renowned for its PolarizedPlus2 lens technology, engineered to cut glare while enhancing color and contrast in bright, high-glare environments. On the resale market Maui Jim has steady, niche demand among buyers who prize its lens quality: its polarized sunglasses hold accessible value, with popular and discontinued frames drawing the most interest, though the brand\'s strong prescription-lens business means many pairs are personalized. It is a premium-performance eyewear brand rather than a fashion-hype name. Value depends on the model, lens type and condition (lens quality is critical), and whether lenses are non-prescription; well-kept frames with clean original lenses are the most viable resale items.',
    resale: 'Moderate', demand: 7.0, sellSpeed: 'Moderate',
    products: ['Polarized Sunglasses', 'Eyewear', 'Readers', 'Accessories'],
  },
  'Harley-Davidson': {
    country: 'United States', founded: '1903', domain: 'harley-davidson.com',
    description: 'Harley-Davidson was founded in 1903 in Milwaukee, Wisconsin, by William Harley and the Davidson brothers, becoming the most iconic American motorcycle company and a global symbol of freedom and rebellion. Beyond bikes, its apparel arm—leather jackets, vests, and especially graphic T-shirts—is deeply woven into American culture. On the resale market Harley-Davidson apparel is a major vintage category: vintage graphic tees (especially single-stitch 80s and 90s shirts, 3D Emblem prints, and dealership/event shirts) have a robust, fast-moving collector market and can command high prices, while leather jackets and vintage pieces also hold strong value. The vintage-tee scene drives much of the demand. Value depends heavily on the era and graphic—single-stitch vintage tees and rare prints lead—plus condition and rarity; sought-after vintage shirts and well-kept leather are the most valuable resale items.',
    resale: 'High', demand: 7.9, sellSpeed: 'Fast',
    products: ['Vintage Tees', 'Leather Jackets', 'Vests', 'Graphic Apparel'],
  },
  'Members Only': {
    country: 'United States', founded: '1975', domain: 'membersonly.com',
    description: 'Members Only was created in 1975 by clothing entrepreneur Herb Goldsmith and introduced to the broad American market in 1980 by Europe Craft Imports, becoming one of the defining fashion brands of the 1980s. Its signature racer jacket—distinguished by narrow epaulettes, a collar strap, and knit trim, with the tagline "When you put it on, something happens"—was a massive 80s phenomenon. On the resale market Members Only has steady, nostalgia-driven demand: vintage 80s racer jackets are the core draw and hold accessible value among retro-fashion buyers, with rare colors and well-preserved original examples drawing the most interest, while modern relaunch pieces trade at lower prices. Value depends on the era (vintage 80s leads), color, and condition; well-kept vintage racer jackets in desirable colors are the most viable and sought resale items.',
    resale: 'Moderate', demand: 6.7, sellSpeed: 'Moderate',
    products: ['Racer Jackets', 'Bombers', 'Outerwear', 'Apparel'],
  },
  'Rock Revival': {
    country: 'United States', founded: '2005', domain: 'rockrevival.com',
    description: 'Rock Revival is a premium denim brand designed in Los Angeles and launched in 2005, recognizable by its signature Fleur-de-Lis coin-pocket hardware, bold washes, heavy stitching, and stretch denim. Sold heavily through The Buckle (alongside sister brand Miss Me), it became a staple of mid-2000s embellished-denim fashion. On the resale market Rock Revival has modest, steady demand boosted by the Y2K and early-2000s revival: its embellished bootcut and skinny jeans hold accessible value, with the bold-wash and heavily decorated styles drawing renewed nostalgic interest among younger buyers. It is a mall-premium denim brand rather than a luxury or hype name, so resale values stay accessible. Value depends on the wash, the embellishment, fit, size, and condition; distinctive heavily-decorated pairs and sought-after washes are the most viable resale items, riding the current nostalgia wave.',
    resale: 'Moderate', demand: 6.8, sellSpeed: 'Moderate',
    products: ['Bootcut Jeans', 'Skinny Jeans', 'Embellished Denim', 'Shorts'],
  },
  'Miss Me': {
    country: 'United States', founded: '2001', domain: 'missme.com',
    description: 'Miss Me was founded in 2001 in Los Angeles, launching its first collection that spring as embellished denim aimed at the modern, multi-dimensional young woman. Owned by Miss Me, Inc. (which also runs sister brand Rock Revival), it became a defining name in 2000s rhinestone-and-embroidery bootcut jeans, recognizable by its stylized "M" coin-pocket logo and elaborate back-pocket designs. On the resale market Miss Me has modest, steady demand lifted by the Y2K revival: its embellished low- and mid-rise jeans hold accessible value, with the heavily decorated and bootcut styles drawing renewed nostalgic interest, and the trend has gone viral among younger buyers. It is a mall-premium denim brand rather than a luxury name, so resale values stay accessible. Value depends on the embellishment, wash, fit, size, and condition; distinctive decorated pairs ride the nostalgia wave best.',
    resale: 'Moderate', demand: 6.8, sellSpeed: 'Moderate',
    products: ['Bootcut Jeans', 'Embellished Denim', 'Skinny Jeans', 'Capris'],
  },
  'Silver Jeans': {
    country: 'Canada', founded: '1991', domain: 'silverjeans.com',
    description: 'Silver Jeans Co. was founded in 1991 in Winnipeg, Canada, by Michael Silver, produced by the family-owned Western Glove Works (a denim manufacturer since 1921). The brand focuses on fit-driven, fashion-forward denim with a wide range of curve-conscious and signature fits (like Suki and the Fit No. systems) at an accessible mid-market price. On the resale market Silver Jeans has modest, steady demand: its denim holds accessible value among value-focused buyers who favor its fit options, with popular and discontinued washes drawing some interest. It is a mainstream mall-denim brand rather than a premium or hype name, so resale values stay accessible. Value depends on the fit, wash, size, and condition; well-kept jeans in popular fits and sizes are the most viable resale items, generally trading at accessible prices well below premium-denim labels.',
    resale: 'Moderate', demand: 6.5, sellSpeed: 'Moderate',
    products: ['Jeans', 'Denim Jackets', 'Shorts', 'Curve-Fit Denim'],
  },
  'BKE': {
    country: 'United States', founded: '1948', domain: 'buckle.com',
    description: 'BKE is the in-house denim and apparel label of The Buckle, the American retailer founded in 1948 in Kearney, Nebraska (originally Mills Clothing, renamed The Buckle in 1965). Sold exclusively at Buckle alongside brands like Rock Revival and Miss Me, BKE offers fashion-driven, value-priced denim in a wide range of fits and washes, plus tops and casualwear aimed at a youthful demographic. On the resale market BKE has modest, steady demand: its jeans hold accessible value among Buckle shoppers and value-focused denim buyers, with popular fits and washes drawing the most interest. As a store private label rather than a premium or hype brand, resale values stay accessible. Value depends on the fit, wash, size, and condition; well-kept jeans in sought-after fits are the most viable resale items, generally trading at modest prices.',
    resale: 'Moderate', demand: 6.4, sellSpeed: 'Moderate',
    products: ['Jeans', 'Denim', 'Tops', 'Casualwear'],
  },
  'True Religion': {
    country: 'United States', founded: '2002', domain: 'truereligion.com',
    description: 'True Religion was founded in 2002 by Jeffrey and Kym Lubell in Los Angeles, becoming a defining premium-denim brand of the 2000s. It is recognizable by its thick contrast stitching, the horseshoe logo, the Buddha logo, and flap-pocket jeans like the Joey and Ricky—styles that became status symbols at premium price points. On the resale market True Religion has strong, fast demand fueled heavily by the Y2K and 2000s revival: its flap-pocket bootcut and the super-stitched jeans have surged with younger buyers, vintage and rare washes command premiums, and the brand\'s recent hip-hop-driven resurgence keeps demand high. Value depends on the style, the wash, the stitching/embellishment, size, and condition; sought-after vintage flap-pocket pairs and bold washes ride the nostalgia wave best, and authentication matters since the logo-heavy jeans are widely counterfeited.',
    resale: 'High', demand: 7.6, sellSpeed: 'Fast',
    products: ['Bootcut Jeans', 'Flap-Pocket Denim', 'Hoodies', 'Jackets'],
  },
  'Red Kap': {
    country: 'United States', founded: '1923', domain: 'redkap.com',
    description: 'Red Kap traces to 1923 and is one of America\'s oldest industrial-workwear brands, now part of VF Corporation. It specializes in durable, functional uniform apparel for tradespeople and industry—work shirts, work pants, coveralls, and mechanic shirts built for hard use and easy care. Its retro-styled work shirts, with chain-stitched name patches and a mid-century aesthetic, have crossed over into vintage-workwear and streetwear fashion. On the resale market Red Kap has modest, steady demand with a notable vintage-fashion angle: its mechanic and work shirts—especially vintage examples and ones with authentic patches—are sought for the workwear-revival look, while new pieces hold accessible value. Value depends on the era (vintage leads), the style, any authentic patches, and condition; vintage work shirts with character and patches are the most sought resale items, while current uniform stock trades at accessible prices.',
    resale: 'Moderate', demand: 6.6, sellSpeed: 'Moderate',
    products: ['Work Shirts', 'Work Pants', 'Coveralls', 'Mechanic Shirts'],
  },
  'Clints': {
    country: 'United Kingdom', founded: '2020', domain: 'clintsinc.com',
    description: 'Clints (Clints Inc.) was founded in 2020 in Manchester by self-taught designer Junior Clint, who began hand-making sneakers in his bedroom before launching the brand, whose debut "TRL Footprints" drop sold out within an hour. It became one of the most exciting names in UK streetwear and footwear, known for chunky, trail-inspired sneaker silhouettes (the TRL and Stepper), bold branded outsoles, and a strong Black British and Manchester cultural identity. On the resale market Clints has strong, fast demand among UK streetwear and sneaker buyers: its limited footwear drops and the Patta collaboration sell out rapidly and resell above retail, with rare colorways drawing premiums. Demand is hype- and scarcity-driven. Value depends on the model, colorway, collaboration status, sellout status, and condition; sold-out drops and collaborations carry the strongest premiums.',
    resale: 'High', demand: 7.6, sellSpeed: 'Moderate',
    products: ['TRL Sneakers', 'Stepper Sneakers', 'Apparel', 'Outerwear'],
  },

  // ── COMMON TIER, BATCH 1 (fully curated, 100–150 words each) ────────────────
  'Under Armour': {
    country: 'United States', founded: '1996', domain: 'underarmour.com',
    description: 'Under Armour was founded in 1996 by Kevin Plank, a former University of Maryland football player, who started by making moisture-wicking compression shirts to keep athletes dry—launching the brand from his grandmother\'s basement. It grew into a major performance-apparel company known for compression base layers, the HeatGear and ColdGear lines, training gear, and athletic footwear. On the resale market Under Armour has modest demand: as a mass-produced performance brand, most apparel and footwear trade at accessible prices, with limited athlete collaborations (such as the Stephen Curry signature line) and special editions drawing the most interest. It is a mainstream athletic brand rather than a hype or collector name, so resale values stay low. Value depends on the item, any signature or limited status, size, and condition; the Curry basketball line and limited releases are the most viable resale items.',
    resale: 'Moderate', demand: 6.0, sellSpeed: 'Moderate',
    products: ['Compression Shirts', 'Training Gear', 'Hoodies', 'Footwear'],
  },
  'Reebok': {
    country: 'United Kingdom', founded: '1958', domain: 'reebok.com',
    description: 'Reebok was founded in 1958 in England by Joe and Jeff Foster (the company traces back to their grandfather\'s 1895 athletic-shoe firm, J.W. Foster and Sons). It became a fitness and sportswear giant—huge in the 1980s aerobics boom and the 90s with the Pump technology—and is known for the Club C, Classic Leather, and Instapump Fury. On the resale market Reebok has modest, steady demand with a strong vintage angle: the Club C and Classic Leather hold accessible value, while collaborations (with brands and designers) and vintage 90s pieces, plus the Allen Iverson "Question" basketball line, draw the most collector interest. Value depends on the model, collaboration, colorway, size, and condition; sought-after collaborations and vintage silhouettes carry the strongest premiums, while general retro models trade at accessible prices.',
    resale: 'Moderate', demand: 6.8, sellSpeed: 'Moderate',
    products: ['Sneakers', 'Track Jackets', 'Vintage Tees', 'Hoodies'],
  },
  'Puma': {
    country: 'Germany', founded: '1948', domain: 'puma.com',
    description: 'Puma was founded in 1948 in Herzogenaurach, Germany, by Rudolf Dassler after he split from his brother Adi (who founded Adidas), creating a famous sibling rivalry that divided their hometown. Puma became a global sportswear brand known for the Suede (an icon of hip-hop and B-boy culture), the Clyde, and a long history in soccer and motorsport. On the resale market Puma has modest, steady demand with a notable collaboration scene: the Suede and Clyde hold accessible value, while collaborations (with Rihanna\'s Fenty, designers, and brands) and limited motorsport and soccer pieces draw the most interest. Value depends on the model, collaboration, colorway, size, and condition; sought-after collaborations like Fenty and limited releases carry the strongest premiums, while general models trade at accessible prices.',
    resale: 'Moderate', demand: 6.8, sellSpeed: 'Moderate',
    products: ['Suede Sneakers', 'Track Jackets', 'Soccer Gear', 'Hoodies'],
  },
  'Champion': {
    country: 'United States', founded: '1919', domain: 'champion.com',
    description: 'Champion was founded in 1919 in Rochester, New York, by the Feinbloom brothers, and is credited with inventing the hooded sweatshirt and pioneering the reverse-weave construction (which resists shrinkage) in the 1930s. A longtime supplier of athletic wear to universities and the military, it became a streetwear staple. On the resale market Champion has steady demand with a strong vintage focus: vintage reverse-weave hoodies and crewnecks—especially 80s and 90s pieces with the embroidered "C" logo, single-stitch construction, and college or team prints—are actively collected and can command solid premiums, while modern pieces and designer collaborations also draw interest. Value depends heavily on the era (vintage reverse weave leads), the graphic or college branding, construction, and condition; sought-after vintage hoodies and rare prints are the most valuable resale items.',
    resale: 'Moderate', demand: 7.0, sellSpeed: 'Moderate',
    products: ['Reverse Weave Hoodies', 'Crewnecks', 'Vintage Tees', 'Sweatpants'],
  },
  'Fila': {
    country: 'Italy', founded: '1911', domain: 'fila.com',
    description: 'Fila was founded in 1911 in Biella, Italy, originally making textiles and knitwear before becoming a sportswear brand in the 1970s, prominent in tennis (Björn Borg) and later a 90s hip-hop and streetwear staple. Now South Korean–owned, it is known for the Disruptor chunky sneaker, the F-Box logo, and bold retro athletic apparel. On the resale market Fila has modest demand boosted by Y2K nostalgia: the Disruptor II and vintage logo pieces hold accessible value, with 90s tracksuits, vintage tees, and collaborations drawing the most interest among retro-fashion buyers. Value depends on the item, the era (vintage and Y2K pieces lead), the graphic, size, and condition; sought-after vintage tracksuits and distinctive logo pieces are the most viable resale items, while general modern stock trades at accessible prices.',
    resale: 'Moderate', demand: 6.7, sellSpeed: 'Moderate',
    products: ['Disruptor Sneakers', 'Track Jackets', 'Vintage Tees', 'Hoodies'],
  },
  'New Balance': {
    country: 'United States', founded: '1906', domain: 'newbalance.com',
    description: 'New Balance was founded in 1906 in Boston as the New Balance Arch Support Company, originally making arch supports before moving into performance running shoes. Famous for its width sizing, "dad shoe" aesthetic, and Made in USA/UK premium lines, it remains privately owned and became one of the most coveted sneaker brands of recent years. On the resale market New Balance is strong and fast-moving: the 990 series, 2002R, and 550 command premiums, while collaborations—especially with Aimé Leon Dore, Joe Freshgoods, Salehe Bembury, and Miu Miu—sell out and resell well above retail. The Made in USA lines also hold value. Value depends on the model, collaboration, colorway, size, and condition; sought-after collaborations and Made in USA pairs carry the strongest premiums, with the 990 and 550 anchoring broad demand.',
    resale: 'High', demand: 8.0, sellSpeed: 'Fast',
    products: ['990 Sneakers', '550 Sneakers', '2002R Sneakers', 'Apparel'],
  },
  'ASICS': {
    country: 'Japan', founded: '1949', domain: 'asics.com',
    description: 'ASICS traces to 1949, when Kihachiro Onitsuka founded Onitsuka Co. in Kobe, Japan, making basketball shoes; the modern ASICS name (an acronym for the Latin "anima sana in corpore sano," a sound mind in a sound body) was adopted in 1977. It is known for the Gel cushioning technology, the Gel-Kayano and Gel-Lyte running shoes, and the heritage Onitsuka Tiger line. On the resale market ASICS surged with the "gorpcore" and Y2K running-shoe trends: the Gel-Kayano 14, Gel-1130, and GT-2160 command premiums, while collaborations (with brands and designers) and limited colorways sell quickly. Value depends on the model, collaboration, colorway, size, and condition; trending silhouettes like the Gel-Kayano 14 and sought-after collaborations carry the strongest premiums, while general running models trade at accessible prices.',
    resale: 'Moderate', demand: 7.2, sellSpeed: 'Moderate',
    products: ['Gel Running Shoes', 'Gel-Kayano', 'Onitsuka Tiger', 'Apparel'],
  },
  'Skechers': {
    country: 'United States', founded: '1992', domain: 'skechers.com',
    description: 'Skechers was founded in 1992 in Manhattan Beach, California, by Robert Greenberg (who had earlier founded LA Gear) and his son Michael, building a comfort-focused footwear empire spanning casual, walking, and athletic shoes. It is known for memory-foam comfort lines, slip-on styles, and broad mass-market appeal at accessible prices. On the resale market Skechers has low demand: as a comfort-and-value footwear brand, its shoes are abundant and inexpensive new, leaving little secondhand premium, though the occasional collaboration or nostalgic early-2000s style draws minor interest. It is a mainstream value brand rather than a collector or hype name. Value depends on the model, condition, and any rare or collaboration status; most pairs trade at low prices, and resale is driven by practical value rather than collectibility, making it one of the lower-demand footwear names secondhand.',
    resale: 'Low', demand: 5.0, sellSpeed: 'Slow',
    products: ['Walking Shoes', 'Slip-Ons', 'Sneakers', 'Sandals'],
  },
  'Russell Athletic': {
    country: 'United States', founded: '1902', domain: 'russellathletic.com',
    description: 'Russell Athletic was founded in 1902 by Benjamin Russell in Alexander City, Alabama, and is credited with developing the cotton athletic sweatshirt in the 1920s, becoming a longtime supplier of team uniforms and blank athletic wear. It is known for durable, no-frills sweatshirts, jerseys, and the "eagle R" logo. On the resale market Russell Athletic has modest, niche demand centered on vintage: blank and college-branded vintage sweatshirts, single-stitch tees, and 80s–90s athletic pieces are sought by vintage sellers and those after plain heavyweight blanks, while modern pieces hold little premium. Value depends on the era (vintage leads), any college or team branding, construction, and condition; sought-after vintage sweatshirts and college pieces are the most viable resale items, while current basics trade at low prices as a value blank brand.',
    resale: 'Low', demand: 5.5, sellSpeed: 'Moderate',
    products: ['Sweatshirts', 'Jerseys', 'Vintage Tees', 'Sweatpants'],
  },
  'Avia': {
    country: 'United States', founded: '1979', domain: 'avia.com',
    description: 'Avia was founded in 1979 in Oregon by Jerry Stubblefield, a former discus thrower who named the brand from the Latin "avis" (bird). It became a notable athletic-footwear brand in the 1980s, known for its patented cantilever sole and a strong line of women\'s aerobics and walking shoes, before being acquired by Reebok and later other owners; it now sells largely as a value brand. On the resale market Avia has low, niche demand with a small vintage angle: original 1980s basketball and cantilever-sole models draw interest from vintage-sneaker collectors during retro revivals, while modern value-line shoes hold little premium. Value depends on the era (vintage 80s leads), the model, size, and condition; sought-after vintage hoop and cantilever silhouettes are the most viable resale items, while current stock trades at low prices.',
    resale: 'Low', demand: 5.5, sellSpeed: 'Moderate',
    products: ['Athletic Shoes', 'Walking Shoes', 'Vintage Sneakers', 'Activewear'],
  },
  'Tek Gear': {
    country: 'United States', founded: '—', domain: 'kohls.com',
    description: 'Tek Gear is a private-label activewear brand sold exclusively at Kohl\'s, offering value-priced workout and casual athletic apparel—fleece, joggers, tees, and basics—aimed at everyday fitness and loungewear at accessible price points. As a store house brand, it competes with mass athletic labels on affordability rather than performance prestige or fashion cachet. On the resale market Tek Gear has very low demand: as an inexpensive store-brand line that is abundant and cheap when new, it carries essentially no secondhand premium and is not a collector or hype name. Value depends almost entirely on practical condition and basic utility rather than brand desirability; pieces trade at minimal prices, making Tek Gear one of the lowest-demand apparel brands for resale, typically sold in bulk or as inexpensive basics rather than individually for value.',
    resale: 'Low', demand: 4.5, sellSpeed: 'Slow',
    products: ['Fleece', 'Joggers', 'Activewear Tees', 'Hoodies'],
  },
  'Danskin': {
    country: 'United States', founded: '1882', domain: 'danskin.com',
    description: 'Danskin was founded in 1882 in New York City by brothers Joel and Benson Goodman, beginning as a dry-goods store importing hosiery and tights before becoming America\'s leading dancewear maker. It pioneered knit tights, leotards, and fishnet stockings, and popularized "ballet pink," later expanding into women\'s fitness and activewear during the 1980s aerobics boom. On the resale market Danskin has modest, niche demand: vintage leotards, dancewear, and 80s activewear draw interest from dance, vintage-fashion, and nostalgia buyers, while modern mass-retail Danskin (sold widely at value retailers) holds little premium. Value depends on the era (vintage and distinctive dancewear lead), the piece, and condition; sought-after vintage leotards and bodywear are the most viable resale items, while current value-line basics trade at low prices.',
    resale: 'Low', demand: 5.5, sellSpeed: 'Moderate',
    products: ['Leotards', 'Tights', 'Activewear', 'Dancewear'],
  },
  'Athletic Works': {
    country: 'United States', founded: '—', domain: 'walmart.com',
    description: 'Athletic Works is a private-label athletic and activewear brand sold primarily at Walmart, offering value-priced workout and casual sportswear—fleece, joggers, shorts, tees, and basic athletic footwear—aimed at everyday wear at the lowest price points. As a store house brand, it competes purely on affordability rather than performance reputation or fashion appeal. On the resale market Athletic Works has very low demand: as an inexpensive mass store-brand line that is abundant and cheap new, it carries essentially no secondhand premium and is not a collector or hype name. Value depends almost entirely on practical condition and basic utility rather than brand desirability; pieces trade at minimal prices, making Athletic Works one of the lowest-demand apparel brands for resale, typically moved in bulk or as cheap basics rather than sold individually for any meaningful value.',
    resale: 'Low', demand: 4.0, sellSpeed: 'Slow',
    products: ['Fleece', 'Joggers', 'Athletic Shorts', 'Tees'],
  },
  'Lee': {
    country: 'United States', founded: '1889', domain: 'lee.com',
    description: 'Lee was founded in 1889 by Henry David Lee in Salina, Kansas, as the H.D. Lee Mercantile Company, becoming a major American denim and workwear maker—it introduced the union-all coverall, the Lee Rider jacket, and the "Lazy S" back-pocket stitching. Now owned by Kontoor Brands (alongside Wrangler), it is a heritage denim staple. On the resale market Lee has steady demand with a strong vintage focus: vintage Lee denim, the 101 jeans, and especially the Lee Rider/Storm Rider jackets (with their corduroy or blanket-lined collars) are actively collected, with rare older pieces and union-made vintage commanding premiums. Value depends heavily on the era (vintage leads), the piece, construction, and condition; sought-after vintage jackets and jeans are the most valuable resale items, while current mainline denim trades at accessible prices.',
    resale: 'Moderate', demand: 6.8, sellSpeed: 'Moderate',
    products: ['Denim Jeans', 'Rider Jackets', 'Vintage Denim', 'Workwear'],
  },
  'Wrangler': {
    country: 'United States', founded: '1947', domain: 'wrangler.com',
    description: 'The Wrangler brand of jeans launched in 1947 under Blue Bell (its roots trace to C.C. Hudson\'s 1904 Hudson Overall Company), designed with input from a rodeo tailor to fit cowboys—becoming the definitive Western and rodeo denim brand. Now owned by Kontoor Brands, it is known for the 13MWZ cowboy-cut jean and the "W" stitching. On the resale market Wrangler has steady demand with a strong vintage and Western angle: vintage Wrangler denim, the Blue Bell–era pieces, vintage western shirts and jackets, and any collaborations (such as with fashion brands) draw the most interest, while modern mainline jeans are abundant and accessible. Value depends on the era (vintage Blue Bell leads), the piece, and condition; sought-after vintage western wear and rare older pieces are the most valuable resale items, with current denim trading at accessible prices.',
    resale: 'Moderate', demand: 6.8, sellSpeed: 'Moderate',
    products: ['Cowboy-Cut Jeans', 'Western Shirts', 'Denim Jackets', 'Vintage Denim'],
  },
  'Dickies': {
    country: 'United States', founded: '1922', domain: 'dickies.com',
    description: 'Dickies was founded in 1922 in Fort Worth, Texas, as the Williamson-Dickie Manufacturing Company, building durable, affordable workwear that became an American institution and later a skate and streetwear staple. It is best known for the 874 work pant, the Eisenhower jacket, and coveralls. On the resale market Dickies has steady demand with workwear-streetwear crossover: the 874 pants, work jackets, and coveralls hold accessible value, while vintage pieces, the Dickies 1922 premium line, and collaborations (with brands and designers) command the most interest. Value depends on the item, era, any collaboration status, size, and condition; sought-after collaborations and vintage workwear carry the strongest premiums, while the core 874 pants and standard workwear trade at accessible prices, supported by durable construction that keeps used pieces wearable.',
    resale: 'Moderate', demand: 6.8, sellSpeed: 'Moderate',
    products: ['874 Work Pants', 'Work Jackets', 'Coveralls', 'Shirts'],
  },
  'Rustler': {
    country: 'United States', founded: '1973', domain: 'wrangler.com',
    description: 'Rustler is a budget denim brand owned by Kontoor Brands and sold under the Wrangler family (its value line, widely available at Walmart and similar retailers since the 1970s). It focuses on simple, durable, low-cost jeans and basics—straight and regular fits in cotton denim—aimed at the most price-conscious shoppers, typically retailing for very low prices. On the resale market Rustler has very low demand: as an inexpensive value-denim line that is abundant and cheap when new, it carries essentially no secondhand premium and is not a collector or hype brand. Value depends almost entirely on practical condition and basic utility rather than brand desirability; pieces trade at minimal prices, making Rustler one of the lowest-demand denim brands for resale, generally moved as cheap everyday basics rather than sold individually for any meaningful value.',
    resale: 'Low', demand: 4.5, sellSpeed: 'Slow',
    products: ['Jeans', 'Denim', 'Work Pants', 'Basics'],
  },
  'American Eagle': {
    country: 'United States', founded: '1977', domain: 'ae.com',
    description: 'American Eagle Outfitters was founded in 1977, growing into a major mall retailer for teens and young adults centered on casual, denim-focused apparel with an accessible, all-American aesthetic. It is known for its jeans (and the AE and Aerie sub-brands), graphic tees, and laid-back basics. On the resale market American Eagle has low, modest demand: as a mass mall brand, most apparel and denim trade at accessible prices, though the early-2000s Y2K revival has lent some nostalgic interest to vintage logo pieces and low-rise denim among younger buyers. It is a mainstream value-fashion brand rather than a collector or hype name. Value depends on the item, any Y2K-nostalgia appeal, size, and condition; vintage logo pieces and sought-after older denim are the most viable resale items, while current stock trades at low prices.',
    resale: 'Low', demand: 5.5, sellSpeed: 'Moderate',
    products: ['Jeans', 'Graphic Tees', 'Hoodies', 'Flannels'],
  },
  'Hollister': {
    country: 'United States', founded: '2000', domain: 'hollisterco.com',
    description: 'Hollister Co. was founded in 2000 by Abercrombie & Fitch as a lower-priced sister brand built around a fictional Southern California surf lifestyle, with a beachy, casual aesthetic aimed at teens. It is known for its seagull logo, soft graphic tees, hoodies, and skinny jeans, and its dimly lit, heavily fragranced mall stores. On the resale market Hollister has low, modest demand lifted somewhat by Y2K and 2000s nostalgia: vintage logo hoodies, graphic tees, and the heavily branded mid-2000s pieces draw renewed interest from younger buyers, while general apparel trades at accessible prices. It is a mass mall brand rather than a collector or hype name. Value depends on the item, the Y2K-nostalgia appeal, size, and condition; sought-after vintage logo pieces ride the nostalgia wave best, while current stock trades at low prices.',
    resale: 'Low', demand: 5.8, sellSpeed: 'Moderate',
    products: ['Logo Hoodies', 'Graphic Tees', 'Skinny Jeans', 'Joggers'],
  },
  'Abercrombie & Fitch': {
    country: 'United States', founded: '1892', domain: 'abercrombie.com',
    description: 'Abercrombie & Fitch was founded in 1892 by David Abercrombie and Ezra Fitch as an upscale outdoor and sporting-goods outfitter in New York, later reinvented in the 1990s and 2000s into a youth-focused lifestyle brand defined by its moose logo, logo-heavy casualwear, and provocative marketing. On the resale market Abercrombie has modest demand boosted strongly by Y2K nostalgia: vintage early-2000s logo pieces—graphic tees, the moose polos, distressed denim, and heavy logo hoodies—are actively sought by younger buyers riding the 2000s revival, and the brand\'s recent fashion turnaround has lifted interest. Value depends on the item, the era (vintage Y2K logo pieces lead), size, and condition; sought-after vintage logo apparel carries the strongest premiums, while current and non-logo stock trades at accessible prices.',
    resale: 'Moderate', demand: 6.5, sellSpeed: 'Moderate',
    products: ['Logo Tees', 'Polos', 'Distressed Denim', 'Hoodies'],
  },
  'Aeropostale': {
    country: 'United States', founded: '1987', domain: 'aeropostale.com',
    description: 'Aéropostale was founded in 1987, originally as a Macy\'s private label before becoming a standalone mall retailer for teens, built on logo-heavy, value-priced casualwear with a collegiate, all-American aesthetic. It is known for its big-logo graphic tees, hoodies, and jeans that were ubiquitous in the 2000s. On the resale market Aéropostale has low, modest demand lifted by Y2K nostalgia: vintage early-2000s logo tees, hoodies, and the heavily branded mid-2000s pieces draw renewed interest from younger buyers riding the 2000s revival, while general apparel trades at accessible prices. It is a mass mall value brand rather than a collector or hype name. Value depends on the item, the Y2K-nostalgia appeal, size, and condition; sought-after vintage logo pieces are the most viable resale items, while current stock trades at low prices.',
    resale: 'Low', demand: 5.5, sellSpeed: 'Moderate',
    products: ['Logo Tees', 'Hoodies', 'Jeans', 'Graphic Apparel'],
  },
  'Gap': {
    country: 'United States', founded: '1969', domain: 'gap.com',
    description: 'Gap was founded in 1969 in San Francisco by Don and Doris Fisher, growing into an iconic American casualwear brand known for accessible basics—denim, the logo hoodie, pocket tees, and khakis—and culture-defining 1990s advertising. It anchors a group that includes Old Navy, Banana Republic, and Athleta. On the resale market Gap has modest demand with a notable vintage and collaboration angle: vintage Gap pieces (especially 90s logo sweatshirts and denim), the arch-logo hoodies, and high-profile collaborations—most notably the Yeezy Gap line and the Gap x designer capsules—draw the most interest, while general basics are abundant. Value depends on the item, era, any collaboration status, size, and condition; sought-after collaborations like Yeezy Gap and vintage logo pieces carry the strongest premiums, while standard current basics trade at accessible prices.',
    resale: 'Moderate', demand: 6.2, sellSpeed: 'Moderate',
    products: ['Logo Hoodies', 'Denim', 'Pocket Tees', 'Khakis'],
  },
  'Old Navy': {
    country: 'United States', founded: '1994', domain: 'oldnavy.com',
    description: 'Old Navy was founded in 1994 by Gap Inc. as a lower-priced sister brand, offering budget-friendly, family-oriented casualwear—basics, denim, graphic tees, and seasonal staples—across all ages at the most accessible price points in the Gap family. On the resale market Old Navy has low demand: as a mass value brand whose clothing is inexpensive and abundant when new, it carries essentially no secondhand premium, and resale is driven by practical value rather than collectibility. The occasional nostalgic graphic tee (such as its long-running Fourth of July flag tees) draws minor novelty interest, but it is not a collector or hype name. Value depends almost entirely on practical condition and basic utility; pieces trade at minimal prices, making Old Navy one of the lower-demand apparel brands for resale, typically moved in bulk or as cheap basics.',
    resale: 'Low', demand: 4.5, sellSpeed: 'Slow',
    products: ['Basics', 'Denim', 'Graphic Tees', 'Seasonal Apparel'],
  },
  'Banana Republic': {
    country: 'United States', founded: '1978', domain: 'bananarepublic.com',
    description: 'Banana Republic was founded in 1978 by Mel and Patricia Ziegler as a quirky safari-and-travel-themed catalog and store, before being acquired by Gap Inc. in 1983 and repositioned as the group\'s upscale, refined brand for elevated workwear and contemporary basics. It is known for tailored pieces, quality knitwear, and a polished aesthetic. On the resale market Banana Republic has low, modest demand: its quality cashmere, leather goods, and tailored pieces hold accessible value, while the rare early-1980s original safari-era catalog pieces have a small cult following among vintage collectors. It is a mainstream contemporary brand rather than a hype or luxury name, so resale values stay accessible. Value depends on the category (cashmere and leather lead), the era, and condition; quality knitwear and the cult vintage safari-era pieces are the most viable resale items.',
    resale: 'Low', demand: 5.8, sellSpeed: 'Moderate',
    products: ['Tailoring', 'Cashmere Sweaters', 'Leather Goods', 'Workwear'],
  },
  'Express': {
    country: 'United States', founded: '1980', domain: 'express.com',
    description: 'Express was founded in 1980 as part of The Limited, growing into a mall mainstay for young professionals centered on going-out and workwear-adjacent fashion—dress shirts, suiting separates, and trend-driven apparel for men and women. On the resale market Express has low, modest demand: as a mass mall fashion brand, most pieces trade at accessible prices, with the occasional well-made suiting separate or trend piece drawing minor interest. It is a mainstream value-fashion brand rather than a collector or hype name, and its trend-led inventory dates relatively quickly. Value depends on the item, style, size, and condition; quality suiting separates and current-trend pieces in good condition are the most viable resale items, while general apparel trades at low prices, making Express a lower-demand brand on the secondhand market.',
    resale: 'Low', demand: 5.5, sellSpeed: 'Moderate',
    products: ['Dress Shirts', 'Suiting', 'Trend Apparel', 'Denim'],
  },
  'Arizona': {
    country: 'United States', founded: '1990', domain: 'jcpenney.com',
    description: 'Arizona Jean Co. is a private-label brand launched by JCPenney in 1990, built as an accessible, all-American denim and casualwear line for teens and families, with a Southwestern-tinged identity. It is sold exclusively at JCPenney and known for value-priced jeans, basics, and casual apparel. On the resale market Arizona has low demand: as a store house brand whose clothing is inexpensive and abundant when new, it carries essentially no secondhand premium, though the early-2000s Y2K revival lends minor nostalgic interest to some vintage logo denim among younger buyers. It is a mass value brand rather than a collector or hype name. Value depends almost entirely on practical condition and basic utility, with occasional Y2K-nostalgia appeal; pieces trade at low prices, making Arizona one of the lower-demand denim brands for resale.',
    resale: 'Low', demand: 4.5, sellSpeed: 'Slow',
    products: ['Jeans', 'Denim', 'Graphic Tees', 'Casualwear'],
  },
  'Lucky Brand': {
    country: 'United States', founded: '1990', domain: 'luckybrand.com',
    description: 'Lucky Brand was founded in 1990 in Los Angeles by Gene Montesano and Barry Perlman, building a denim-centered brand with a vintage-Americana, rock-and-roll sensibility (famous for the "Lucky You" message stitched inside the fly). It is known for its jeans, western-tinged casualwear, and graphic tees. On the resale market Lucky Brand has modest demand: its denim and casualwear hold accessible value, with vintage early pieces and distinctive western-style items drawing some interest, while general apparel is abundant. It is a mainstream contemporary-denim brand rather than a hype or luxury name, so resale values stay accessible. Value depends on the item (denim leads), the era, fit, size, and condition; well-kept jeans in popular fits and distinctive vintage pieces are the most viable resale items, while general apparel trades at accessible prices.',
    resale: 'Moderate', demand: 6.0, sellSpeed: 'Moderate',
    products: ['Denim Jeans', 'Graphic Tees', 'Western Shirts', 'Jackets'],
  },
  'H&M': {
    country: 'Sweden', founded: '1947', domain: 'hm.com',
    description: 'H&M (Hennes & Mauritz) was founded in 1947 in Västerås, Sweden, by Erling Persson as a women\'s clothing store called Hennes, growing into one of the world\'s largest fast-fashion retailers offering trend-driven, low-priced apparel for all ages. On the resale market H&M has low demand overall: as a fast-fashion brand whose clothing is inexpensive and produced in enormous volume, most pieces carry essentially no secondhand premium. The major exception is its celebrated designer collaborations (with houses like Versace, Balmain, Maison Margiela, and others), which sell out instantly and command significant premiums on the resale market. Value depends heavily on whether an item is a designer collaboration—those are the only consistently valuable H&M resale pieces—versus standard stock, which trades at minimal prices; condition and the specific collaboration drive the premiums.',
    resale: 'Low', demand: 5.0, sellSpeed: 'Slow',
    products: ['Trend Apparel', 'Basics', 'Designer Collabs', 'Outerwear'],
  },
  'Zara': {
    country: 'Spain', founded: '1975', domain: 'zara.com',
    description: 'Zara was founded in 1975 in A Coruña, Spain, by Amancio Ortega, becoming the flagship of the Inditex group and a pioneer of fast fashion through its rapid design-to-shelf cycle that quickly translates runway trends into affordable apparel. On the resale market Zara has low-to-modest demand: as a fast-fashion brand with high production volume, most pieces trade at accessible prices, though its on-trend designs, well-made outerwear and tailoring, and the occasional viral "it" piece or designer collaboration (such as with Studio Nicholson or others) draw more interest than typical fast fashion. It is a trend-driven mass brand rather than a collector or hype name. Value depends on the item, how current and sought-after the trend is, size, and condition; viral trend pieces and quality outerwear are the most viable resale items, while general stock trades at low prices.',
    resale: 'Low', demand: 5.5, sellSpeed: 'Moderate',
    products: ['Trend Apparel', 'Outerwear', 'Tailoring', 'Dresses'],
  },
  'Forever 21': {
    country: 'United States', founded: '1984', domain: 'forever21.com',
    description: 'Forever 21 was founded in 1984 in Los Angeles by Do Won Chang and Jin Sook Chang (originally as Fashion 21), becoming a major fast-fashion retailer known for extremely low-priced, trend-chasing apparel and accessories aimed at teens and young adults. On the resale market Forever 21 has very low demand: as an ultra-fast-fashion brand whose clothing is inexpensive and produced in massive volume, it carries essentially no secondhand premium, and resale is driven purely by practical value rather than collectibility or brand desirability. It is not a collector or hype name. Value depends almost entirely on condition and basic utility; pieces trade at minimal prices, making Forever 21 one of the lowest-demand apparel brands for resale, typically moved in bulk or as inexpensive trend basics rather than sold individually for any meaningful value.',
    resale: 'Low', demand: 4.5, sellSpeed: 'Slow',
    products: ['Trend Apparel', 'Dresses', 'Accessories', 'Basics'],
  },
  'Shein': {
    country: 'China', founded: '2008', domain: 'shein.com',
    description: 'Shein was founded in 2008 in Nanjing, China, by entrepreneur Chris Xu (originally named ZZKKO, later SheInside, and rebranded SHEIN around 2015). It became the world\'s largest fast-fashion retailer through an online-only, data-driven "ultra-fast fashion" model that produces enormous volumes of extremely low-priced, trend-chasing apparel. On the resale market Shein has minimal demand: as the archetypal ultra-fast-fashion brand whose items are very inexpensive and produced in vast quantities, it carries essentially no secondhand value, and the brand also faces ongoing scrutiny over quality, labor, and environmental practices. It is not a collector or hype name in any sense. Value depends almost entirely on practical condition and basic utility; pieces trade at negligible prices, making Shein the lowest-demand apparel brand for resale, rarely worth listing individually rather than bundling.',
    resale: 'Low', demand: 3.5, sellSpeed: 'Slow',
    products: ['Trend Apparel', 'Dresses', 'Accessories', 'Basics'],
  },

  // ── COMMON TIER, BATCH 2 (fully curated, 100–150 words each) ────────────────
  'Fashion Nova': {
    country: 'United States', founded: '2006', domain: 'fashionnova.com',
    description: 'Fashion Nova was founded in 2006 by Richard Saghian, beginning with boutiques in Los Angeles malls before exploding into an online "ultra-fast fashion" powerhouse driven by Instagram, influencers, and celebrity partnerships. It is known for trend-chasing, body-conscious apparel—especially jeans and going-out looks—produced rapidly at very low prices. On the resale market Fashion Nova has very low demand: as a fast-fashion brand whose clothing is inexpensive and produced in enormous, quickly-dated volumes, it carries essentially no secondhand premium, and resale is driven purely by practical value rather than collectibility. It is not a collector or heritage name. Value depends almost entirely on condition and basic utility; pieces trade at minimal prices, making Fashion Nova one of the lowest-demand apparel brands for resale, typically moved in bulk or as inexpensive trend basics rather than sold individually for meaningful value.',
    resale: 'Low', demand: 4.5, sellSpeed: 'Slow',
    products: ['Jeans', 'Dresses', 'Going-Out Tops', 'Bodysuits'],
  },
  'Tommy Bahama': {
    country: 'United States', founded: '1992', domain: 'tommybahama.com',
    description: 'Tommy Bahama was founded in 1992 in Seattle, building an "island lifestyle" brand around relaxed, upscale-casual menswear and womenswear—most famously its silk camp shirts and Hawaiian-inspired prints—plus a retail-and-restaurant concept. It targets an older, affluent leisure customer with a tropical, refined-resort aesthetic. On the resale market Tommy Bahama has modest, steady demand: its silk and linen camp shirts hold accessible value, with bold vintage prints and the higher-end silk pieces drawing the most interest among buyers after the distinctive resort look, while general apparel trades at accessible prices. It is a lifestyle brand rather than a hype or heritage-collector name. Value depends on the fabric (silk camp shirts lead), the print, size, and condition; distinctive printed silk shirts are the most viable resale items, while standard pieces trade at modest prices.',
    resale: 'Moderate', demand: 6.0, sellSpeed: 'Moderate',
    products: ['Silk Camp Shirts', 'Linen Pants', 'Polos', 'Swimwear'],
  },
  'Tommy Hilfiger': {
    country: 'United States', founded: '1985', domain: 'tommy.com',
    description: 'Tommy Hilfiger founded his namesake brand in 1985, building a preppy, all-American aesthetic with bold red-white-and-blue flag logos that became a defining look of 1990s hip-hop and streetwear. Now owned by PVH, it spans casualwear, denim, and accessories. On the resale market Tommy Hilfiger has steady demand with a strong vintage focus: vintage 90s pieces—big-flag-logo sweatshirts, color-blocked jackets, sailing gear, and spell-out tees—are actively collected and ride the Y2K and 90s-streetwear revival, while collaborations (such as with Aaliyah reissues and designers) draw extra interest. Value depends heavily on the era (vintage 90s leads), the logo prominence, the piece, size, and condition; sought-after big-logo vintage pieces and rare colorways carry the strongest premiums, while modern mainline apparel trades at accessible prices.',
    resale: 'Moderate', demand: 6.8, sellSpeed: 'Moderate',
    products: ['Flag-Logo Sweatshirts', 'Polos', 'Denim', 'Color-Block Jackets'],
  },
  'Calvin Klein': {
    country: 'United States', founded: '1968', domain: 'calvinklein.com',
    description: 'Calvin Klein was founded in 1968 by designer Calvin Klein and Barry Schwartz in New York, becoming an icon of minimalist American fashion and provocative advertising. Now owned by PVH, it is famous for its logo-waistband underwear, denim, fragrances, and clean, modern aesthetic. On the resale market Calvin Klein has steady demand with notable vintage and collaboration angles: vintage CK denim and the 90s logo pieces draw collector interest amid the Y2K revival, the underwear and basics move steadily, and collaborations (such as the Heron Preston–era CK205 and Raf Simons-era runway pieces) command premiums. Value depends on the line, era, any collaboration or runway status, size, and condition; sought-after vintage logo pieces and designer-era runway collaborations carry the strongest premiums, while standard modern basics trade at accessible prices.',
    resale: 'Moderate', demand: 6.8, sellSpeed: 'Moderate',
    products: ['Logo Underwear', 'Denim', 'Logo Tees', 'Outerwear'],
  },
  'Nautica': {
    country: 'United States', founded: '1983', domain: 'nautica.com',
    description: 'Nautica was founded in 1983 by designer David Chu, building a nautical, sailing-inspired American sportswear brand recognizable by its J-class sailboat logo and bold color-blocked outerwear. It became a 90s staple and is now owned by Authentic Brands Group. On the resale market Nautica has modest, steady demand with a strong vintage focus: vintage 90s color-blocked sailing jackets, spell-out pieces, and the reverse-logo windbreakers are actively sought amid the 90s and vintage-outdoor revival, with bold colorways drawing the most interest, while modern mainline apparel trades at accessible prices. Value depends heavily on the era (vintage 90s leads), the piece, the colorway, size, and condition; sought-after vintage sailing jackets and color-blocked pieces carry the strongest premiums, while current stock trades at accessible prices.',
    resale: 'Moderate', demand: 6.5, sellSpeed: 'Moderate',
    products: ['Sailing Jackets', 'Windbreakers', 'Polos', 'Color-Block Pieces'],
  },
  'Guess': {
    country: 'United States', founded: '1981', domain: 'guess.com',
    description: 'Guess was founded in 1981 in Los Angeles by the Marciano brothers (Georges, Maurice, Paul, and Armand), becoming famous for its sexy, provocative black-and-white advertising and its designer denim with the inverted-triangle logo. On the resale market Guess has modest, steady demand with a strong vintage and collaboration angle: vintage 80s and 90s Guess denim, the triangle-logo pieces, and vintage tees are sought amid the Y2K revival, while high-profile collaborations—especially the Guess x ASAP Rocky "GUESS Originals" line and others—command premiums. Value depends on the era (vintage and Y2K pieces lead), any collaboration status, the piece, size, and condition; sought-after vintage denim and collaboration pieces carry the strongest premiums, while general modern apparel trades at accessible prices, supported by the brand\'s enduring logo recognition.',
    resale: 'Moderate', demand: 6.5, sellSpeed: 'Moderate',
    products: ['Denim', 'Logo Tees', 'Dresses', 'Outerwear'],
  },
  'Izod': {
    country: 'United States', founded: '1922', domain: 'izod.com',
    description: 'Izod traces its name to the 1920s and British tailor Jack Izod, becoming an American sportswear brand best known for the decades it spent as "Izod Lacoste"—the US home of the Lacoste crocodile polo from the 1950s through the early 1990s, a preppy staple. After the Lacoste partnership ended in 1993, Izod continued as a moderately priced American sportswear and golf brand, now owned by Authentic Brands Group. On the resale market Izod has low, modest demand: vintage "Izod Lacoste" crocodile polos and sweaters from the 70s–80s draw collector interest among preppy-vintage buyers, while modern Izod golf and sportswear hold little premium. Value depends heavily on the era (vintage Izod Lacoste leads), the piece, size, and condition; sought-after vintage crocodile pieces are the most viable resale items, while current stock trades at low prices.',
    resale: 'Low', demand: 5.5, sellSpeed: 'Moderate',
    products: ['Polo Shirts', 'Sweaters', 'Golf Apparel', 'Vintage Polos'],
  },
  'Van Heusen': {
    country: 'United States', founded: '1881', domain: 'vanheusen.com',
    description: 'Van Heusen traces to 1881, when Moses Phillips began selling hand-sewn shirts from a pushcart in Pottsville, Pennsylvania; the brand name comes from John Van Heusen, whose 1919 patented self-folding collar (released 1921) made it famous. It became one of America\'s best-known dress-shirt brands and the foundation of what is now PVH. On the resale market Van Heusen has low demand: as a mass-produced, widely available dress-shirt and menswear brand, its pieces are abundant and inexpensive, leaving little secondhand premium, and resale is driven by practical value rather than collectibility. It is a mainstream value brand rather than a collector or hype name. Value depends almost entirely on condition, size, and basic utility; dress shirts and suiting separates trade at low prices, making Van Heusen one of the lower-demand menswear brands for resale.',
    resale: 'Low', demand: 5.0, sellSpeed: 'Slow',
    products: ['Dress Shirts', 'Ties', 'Suiting', 'Sweaters'],
  },
  'Dockers': {
    country: 'United States', founded: '1986', domain: 'dockers.com',
    description: 'Dockers was founded in 1986 by Levi Strauss & Co. as a khaki-focused brand that popularized "business casual," becoming synonymous with the pleated, casual cotton trouser that defined 1990s office wear. It offers accessible khakis, chinos, and casual menswear. On the resale market Dockers has low, modest demand: as a mass khaki-and-casual brand, most pieces are abundant and inexpensive, though the normcore and vintage-casual revivals lend minor interest to pleated vintage khakis and 90s pieces among certain buyers. It is a mainstream value brand rather than a collector or hype name. Value depends on the item, any vintage or normcore appeal, fit, size, and condition; vintage pleated khakis ride the occasional trend, while general current stock trades at low prices, keeping Dockers among the lower-demand menswear brands on the secondhand market.',
    resale: 'Low', demand: 5.5, sellSpeed: 'Moderate',
    products: ['Khakis', 'Chinos', 'Casual Pants', 'Polos'],
  },
  'Arrow': {
    country: 'United States', founded: '1905', domain: 'arrowusa.com',
    description: 'Arrow is an American dress-shirt brand from Cluett, Peabody & Company, a Troy, New York maker whose roots run to the mid-19th century; the brand became iconic through the "Arrow Collar Man" advertising campaign (1905–1931) for its detachable collars, and Cluett established a national Arrow menswear line by 1929. Now licensed under Authentic Brands Group, it remains a value dress-shirt name. On the resale market Arrow has low demand: as a mass, widely distributed dress-shirt and menswear brand, its modern pieces are abundant and inexpensive, while only rare vintage early-20th-century collars and advertising memorabilia draw niche collector interest. Value depends almost entirely on condition and basic utility for modern stock (which trades at low prices), with antique Arrow collar items and original Arrow Collar Man advertising being the rare exceptions of collector value.',
    resale: 'Low', demand: 5.0, sellSpeed: 'Slow',
    products: ['Dress Shirts', 'Ties', 'Sport Shirts', 'Suiting'],
  },
  'Stafford': {
    country: 'United States', founded: '—', domain: 'jcpenney.com',
    description: 'Stafford is a private-label menswear brand sold exclusively at JCPenney, focused on affordable dress clothing—dress shirts, suits, suiting separates, ties, and dress shoes—aimed at value-conscious shoppers needing office and formal wear. As a store house brand, it competes on price and accessibility rather than fashion prestige or heritage. On the resale market Stafford has low demand: as a store-brand dress-clothing line that is inexpensive and abundant when new, it carries essentially no secondhand premium, and resale is driven purely by practical value rather than collectibility. It is not a collector or hype name. Value depends almost entirely on condition, size, and basic utility; dress shirts, suiting, and dress shoes trade at low prices, making Stafford one of the lower-demand menswear brands for resale, typically sold as inexpensive wardrobe basics.',
    resale: 'Low', demand: 4.5, sellSpeed: 'Slow',
    products: ['Dress Shirts', 'Suits', 'Ties', 'Dress Shoes'],
  },
  'Haggar': {
    country: 'United States', founded: '1926', domain: 'haggar.com',
    description: 'Haggar was founded in 1926 in Dallas, Texas, by Lebanese immigrant Joseph Marion Haggar Sr., who is credited with coining the term "slacks" for casual pants worn during "slack" time and pioneering the ready-to-wear finished-bottom trouser. It became one of America\'s leading makers of men\'s dress pants and slacks, later known for wrinkle-free fabrics. On the resale market Haggar has low demand: as a mass, widely available menswear-pants brand, its pieces are abundant and inexpensive, leaving little secondhand premium, and resale is driven by practical value rather than collectibility. It is a mainstream value brand rather than a collector or hype name. Value depends almost entirely on condition, size, and basic utility; slacks, dress pants, and suiting separates trade at low prices, making Haggar one of the lower-demand menswear brands for resale.',
    resale: 'Low', demand: 5.0, sellSpeed: 'Slow',
    products: ['Slacks', 'Dress Pants', 'Suiting', 'Blazers'],
  },
  'Kenneth Cole Reaction': {
    country: 'United States', founded: '1996', domain: 'kennethcole.com',
    description: 'Kenneth Cole Reaction is the diffusion line of designer Kenneth Cole (whose namesake company was founded in 1982), launched in the 1990s as a more affordable, youthful range of footwear, accessories, and apparel with the brand\'s urban, socially-conscious sensibility. It is known for dress shoes, casual footwear, bags, and outerwear at accessible price points. On the resale market Kenneth Cole Reaction has low, modest demand: as a moderately priced diffusion brand, its pieces are widely available and trade at accessible prices, with the occasional well-made leather shoe, bag, or outerwear piece drawing minor interest. It is a mainstream contemporary brand rather than a collector or hype name. Value depends on the item (leather goods and footwear lead), size, and condition; quality shoes and bags are the most viable resale items, while general apparel trades at low prices.',
    resale: 'Low', demand: 5.5, sellSpeed: 'Moderate',
    products: ['Dress Shoes', 'Bags', 'Outerwear', 'Watches'],
  },
  'Perry Ellis': {
    country: 'United States', founded: '1978', domain: 'perryellis.com',
    description: 'Perry Ellis is an American sportswear brand founded in 1978 by the influential designer Perry Ellis (who first presented his Portfolio line in 1976), known for redefining relaxed, witty, quintessentially American sportswear and especially his sweaters. After the designer\'s death in 1986, the brand continued and is now part of Perry Ellis International. On the resale market Perry Ellis has low, modest demand: vintage pieces from the designer\'s era (late 1970s–80s), especially distinctive sweaters and tailored sportswear, draw interest among vintage-fashion collectors, while modern mainline Perry Ellis menswear is widely available and trades at accessible prices. Value depends heavily on the era (vintage designer-era pieces lead), the piece, size, and condition; sought-after vintage sweaters and sportswear are the most viable resale items, while current stock trades at low prices.',
    resale: 'Low', demand: 5.8, sellSpeed: 'Moderate',
    products: ['Sweaters', 'Dress Shirts', 'Suiting', 'Polos'],
  },
  'Claiborne': {
    country: 'United States', founded: '1976', domain: 'jcpenney.com',
    description: 'Claiborne is the menswear brand derived from Liz Claiborne Inc. (founded in 1976), launched to bring the company\'s accessible, polished sensibility to men\'s dress and casual clothing; it is now a JCPenney-exclusive private brand. It offers dress shirts, suiting, casual apparel, and accessories at value price points. On the resale market Claiborne has low demand: as a store-exclusive moderate menswear brand, its pieces are widely available and inexpensive, leaving little secondhand premium, with only occasional vintage Liz Claiborne–era menswear drawing minor interest. It is a mainstream value brand rather than a collector or hype name. Value depends almost entirely on condition, size, and basic utility; dress shirts and suiting trade at low prices, making Claiborne one of the lower-demand menswear brands for resale, typically sold as inexpensive wardrobe basics rather than for collector value.',
    resale: 'Low', demand: 5.0, sellSpeed: 'Slow',
    products: ['Dress Shirts', 'Suiting', 'Casual Shirts', 'Ties'],
  },
  'Chaps': {
    country: 'United States', founded: '1978', domain: 'chapsbrand.com',
    description: 'Chaps was founded in 1978 as a more affordable diffusion line of Ralph Lauren, offering the preppy, classic-American aesthetic at accessible prices; it later became a standalone brand sold at Kohl\'s and other retailers. It is known for polos, oxford shirts, sweaters, and casual menswear and womenswear with a traditional sensibility. On the resale market Chaps has low, modest demand: as a value brand carrying a watered-down preppy look, its pieces are widely available and inexpensive, though the Ralph Lauren heritage lends minor interest to some vintage Chaps pieces among preppy-vintage buyers. It is a mainstream value brand rather than a collector or hype name. Value depends on the item, any vintage appeal, size, and condition; vintage Chaps with classic styling draws occasional interest, while current stock trades at low prices.',
    resale: 'Low', demand: 5.5, sellSpeed: 'Moderate',
    products: ['Polo Shirts', 'Oxford Shirts', 'Sweaters', 'Casualwear'],
  },
  'Geoffrey Beene': {
    country: 'United States', founded: '1963', domain: 'geoffreybeene.com',
    description: 'Geoffrey Beene founded his namesake fashion house in New York in 1963, becoming one of America\'s most acclaimed designers, celebrated for artistic, technically masterful, and comfortable womenswear that won numerous Coty Awards. After the designer\'s death in 2004, the name continued primarily as a licensed menswear brand (dress shirts and furnishings), now under Authentic Brands. On the resale market Geoffrey Beene has a split profile: the designer\'s vintage couture and ready-to-wear womenswear from the 1960s–90s is genuinely collectible and sought by vintage-fashion connoisseurs, while the modern licensed menswear (dress shirts, ties) is mass-market and holds little premium. Value depends heavily on whether a piece is vintage designer work (which leads) versus modern licensed product; sought-after vintage Beene womenswear is the most valuable, while current dress shirts trade at low prices.',
    resale: 'Low', demand: 5.5, sellSpeed: 'Moderate',
    products: ['Dress Shirts', 'Ties', 'Vintage Womenswear', 'Suiting'],
  },
  'Brooks Brothers': {
    country: 'United States', founded: '1818', domain: 'brooksbrothers.com',
    description: 'Brooks Brothers was founded in 1818 in New York City, making it the oldest continuously operating apparel brand in the United States. A pillar of American "trad" and Ivy style, it introduced the button-down "polo" collar shirt, the no. 1 sack suit, and Madras, and has dressed numerous US presidents. On the resale market Brooks Brothers has steady demand with a strong heritage and quality focus: its oxford button-downs, tailored suits and sport coats, and especially vintage "Golden Fleece" and Made in USA pieces are sought by trad-style and vintage-menswear enthusiasts, while collaborations (such as with Supreme) command premiums. Value depends on the line (Golden Fleece and Made in USA lead), the piece, era, size, and condition; quality vintage tailoring, USA-made oxfords, and sought-after collaborations are the most viable resale items.',
    resale: 'Moderate', demand: 6.5, sellSpeed: 'Moderate',
    products: ['Oxford Shirts', 'Suits', 'Sport Coats', 'Ties'],
  },
  'Apt. 9': {
    country: 'United States', founded: '—', domain: 'kohls.com',
    description: 'Apt. 9 is a private-label brand sold exclusively at Kohl\'s, offering moderately priced contemporary apparel and accessories for men and women—dress shirts, sweaters, suiting separates, and casual pieces—with a slightly more elevated, modern aesthetic than Kohl\'s most basic lines. As a store house brand, it competes on value and accessibility rather than fashion prestige or heritage. On the resale market Apt. 9 has low demand: as a store-brand line that is inexpensive and abundant when new, it carries essentially no secondhand premium, and resale is driven purely by practical value rather than collectibility. It is not a collector or hype name. Value depends almost entirely on condition, size, and basic utility; pieces trade at low prices, making Apt. 9 one of the lower-demand apparel brands for resale, typically sold as inexpensive basics.',
    resale: 'Low', demand: 4.5, sellSpeed: 'Slow',
    products: ['Sweaters', 'Dress Shirts', 'Suiting', 'Casualwear'],
  },
  'Croft & Barrow': {
    country: 'United States', founded: '—', domain: 'kohls.com',
    description: 'Croft & Barrow is a private-label brand sold exclusively at Kohl\'s, focused on affordable, comfort-oriented casual apparel for men and women—polos, knit tops, casual pants, sweaters, and loungewear—aimed at older, value-conscious shoppers seeking easy, classic basics. As a store house brand, it competes purely on price and comfort rather than fashion appeal or heritage. On the resale market Croft & Barrow has low demand: as a store-brand line that is inexpensive and abundant when new, it carries essentially no secondhand premium, and resale is driven purely by practical value rather than collectibility. It is not a collector or hype name. Value depends almost entirely on condition, size, and basic utility; pieces trade at low prices, making Croft & Barrow one of the lower-demand apparel brands for resale, typically moved as inexpensive everyday basics.',
    resale: 'Low', demand: 4.5, sellSpeed: 'Slow',
    products: ['Polos', 'Knit Tops', 'Casual Pants', 'Sweaters'],
  },
  'Sonoma': {
    country: 'United States', founded: '—', domain: 'kohls.com',
    description: 'Sonoma is a private-label casual-apparel brand sold exclusively at Kohl\'s (later expanded and rebranded as Sonoma Goods for Life), offering affordable everyday basics for the whole family—tees, flannels, casual pants, and relaxed weekend wear—with a laid-back, value-focused identity. As a store house brand, it competes on price and accessibility rather than fashion prestige. On the resale market Sonoma has low demand: as a store-brand line that is inexpensive and abundant when new, it carries essentially no secondhand premium, and resale is driven purely by practical value rather than collectibility. It is not a collector or hype name. Value depends almost entirely on condition, size, and basic utility; pieces trade at low prices, making Sonoma one of the lower-demand apparel brands for resale, typically sold as inexpensive everyday basics rather than for any collector value.',
    resale: 'Low', demand: 4.5, sellSpeed: 'Slow',
    products: ['Tees', 'Flannels', 'Casual Pants', 'Weekend Wear'],
  },
  'Sonoma Goods for Life': {
    country: 'United States', founded: '—', domain: 'kohls.com',
    description: 'Sonoma Goods for Life is Kohl\'s private-label casual-lifestyle brand (an expansion and rebrand of the earlier Sonoma line), offering affordable, comfortable everyday apparel and home basics for the whole family—tees, flannels, casual pants, weekend wear, and some home goods—with a relaxed, value-driven identity. As a store house brand, it competes on price and comfort rather than fashion prestige or heritage. On the resale market Sonoma Goods for Life has low demand: as a store-brand line that is inexpensive and abundant when new, it carries essentially no secondhand premium, and resale is driven purely by practical value rather than collectibility. It is not a collector or hype name. Value depends almost entirely on condition, size, and basic utility; pieces trade at low prices, making it one of the lower-demand apparel brands for resale, typically moved as inexpensive basics.',
    resale: 'Low', demand: 4.5, sellSpeed: 'Slow',
    products: ['Tees', 'Flannels', 'Casual Pants', 'Home Basics'],
  },
  'A New Day': {
    country: 'United States', founded: '2017', domain: 'target.com',
    description: 'A New Day is a women\'s private-label brand launched by Target in 2017 as part of its push into in-house apparel labels, offering affordable, on-trend contemporary basics—tops, dresses, workwear-adjacent pieces, and accessories—with a modern, approachable aesthetic. As a store house brand, it competes on value and accessible style rather than fashion prestige or heritage. On the resale market A New Day has low demand: as a store-brand line that is inexpensive and abundant when new, it carries essentially no secondhand premium, and resale is driven purely by practical value rather than collectibility. It is not a collector or hype name. Value depends almost entirely on condition, size, and basic utility; pieces trade at low prices, making A New Day one of the lower-demand apparel brands for resale, typically sold as inexpensive everyday basics.',
    resale: 'Low', demand: 4.5, sellSpeed: 'Slow',
    products: ['Tops', 'Dresses', 'Workwear', 'Accessories'],
  },
  'Ann Taylor': {
    country: 'United States', founded: '1954', domain: 'anntaylor.com',
    description: 'Ann Taylor was founded in 1954 in New Haven, Connecticut, by Richard Liebeskind, becoming a leading American brand for polished professional womenswear—tailored suits, dresses, and workwear aimed at career women. It anchors a group that includes its diffusion line LOFT. On the resale market Ann Taylor has low, modest demand: its tailored workwear, dresses, and quality blazers hold accessible value among buyers seeking professional attire, while general apparel is widely available. It is a mainstream contemporary brand rather than a hype or collector name, so resale values stay accessible. Value depends on the piece (quality tailoring and dresses lead), style, size, and condition; well-kept blazers, suits, and dresses are the most viable resale items, while general apparel trades at low prices, making Ann Taylor a lower-demand brand on the secondhand market.',
    resale: 'Low', demand: 5.8, sellSpeed: 'Moderate',
    products: ['Tailoring', 'Dresses', 'Blazers', 'Workwear'],
  },
  'LOFT': {
    country: 'United States', founded: '1998', domain: 'loft.com',
    description: 'LOFT was launched in 1998 as the more casual, relaxed, and affordable diffusion line of Ann Taylor, offering softer, easygoing womenswear—casual tops, dresses, denim, and relaxed workwear—at lower price points for a broader, more laid-back audience. On the resale market LOFT has low, modest demand: its casual dresses, tops, and relaxed workwear hold accessible value among buyers seeking affordable everyday and office-casual pieces, while general apparel is widely available. It is a mainstream value-fashion brand rather than a hype or collector name, so resale values stay accessible. Value depends on the piece, style, size, and condition; well-kept dresses and versatile casual-workwear pieces are the most viable resale items, while general apparel trades at low prices, keeping LOFT among the lower-demand womenswear brands on the secondhand market.',
    resale: 'Low', demand: 5.5, sellSpeed: 'Moderate',
    products: ['Casual Tops', 'Dresses', 'Denim', 'Relaxed Workwear'],
  },
  'Talbots': {
    country: 'United States', founded: '1947', domain: 'talbots.com',
    description: 'Talbots was founded in 1947 in Hingham, Massachusetts, building a classic, timeless New England aesthetic for women\'s apparel—tailored separates, twin sets, polished casualwear, and accessories—aimed at a refined, older customer through stores and catalog. On the resale market Talbots has low, modest demand: its quality classic pieces, knitwear, and tailored separates hold accessible value among buyers seeking timeless, well-made womenswear, while general apparel is widely available. It is a mainstream classic brand rather than a hype or collector name, so resale values stay accessible. Value depends on the piece (quality knitwear and tailoring lead), style, size, and condition; well-kept classic separates, sweaters, and blazers are the most viable resale items, while general apparel trades at low prices, making Talbots a lower-demand brand on the secondhand market.',
    resale: 'Low', demand: 5.8, sellSpeed: 'Moderate',
    products: ['Tailored Separates', 'Knitwear', 'Dresses', 'Blazers'],
  },
  'J. Jill': {
    country: 'United States', founded: '1955', domain: 'jjill.com',
    description: 'J.Jill was founded in 1955 in Great Barrington, Massachusetts, by Karl Lipsky (who named it for his wife Jenifer and daughter Jill), growing from a specialty store and catalog into a women\'s apparel brand known for relaxed, comfortable, natural-fiber clothing in an understated, artistic aesthetic aimed at an older customer. On the resale market J.Jill has low, modest demand: its linen and natural-fiber pieces, easy knits, and relaxed silhouettes hold accessible value among buyers who favor the comfortable, understated look, while general apparel is widely available. It is a mainstream comfort-and-lifestyle brand rather than a hype or collector name, so resale values stay accessible. Value depends on the fabric and piece (linen and quality knits lead), size, and condition; well-kept natural-fiber pieces are the most viable resale items, while general apparel trades at low prices.',
    resale: 'Low', demand: 5.5, sellSpeed: 'Moderate',
    products: ['Linen Pieces', 'Knit Tops', 'Relaxed Dresses', 'Trousers'],
  },
  'Worthington': {
    country: 'United States', founded: '—', domain: 'jcpenney.com',
    description: 'Worthington is a women\'s private-label brand sold exclusively at JCPenney, focused on affordable professional and career wear—tailored blazers, dress pants, blouses, and suiting separates—aimed at value-conscious shoppers building an office wardrobe. As a store house brand, it competes on price and accessibility rather than fashion prestige or heritage. On the resale market Worthington has low demand: as a store-brand workwear line that is inexpensive and abundant when new, it carries essentially no secondhand premium, and resale is driven purely by practical value rather than collectibility. It is not a collector or hype name. Value depends almost entirely on condition, size, and basic utility; blazers, dress pants, and suiting separates trade at low prices, making Worthington one of the lower-demand womenswear brands for resale, typically sold as inexpensive office-wardrobe basics.',
    resale: 'Low', demand: 4.5, sellSpeed: 'Slow',
    products: ['Blazers', 'Dress Pants', 'Blouses', 'Suiting'],
  },
  'Dana Buchman': {
    country: 'United States', founded: '1987', domain: 'kohls.com',
    description: 'Dana Buchman began in 1987 as a "bridge" designer line under Liz Claiborne Inc., offering elevated, tailored career and special-occasion womenswear positioned between mass and designer pricing; it later became an exclusive brand at Kohl\'s at more accessible price points. It is known for polished suiting, dresses, and refined separates. On the resale market Dana Buchman has low, modest demand: vintage pieces from the original bridge-line era (late 1980s–2000s), especially quality tailored suits and silk pieces, draw some interest among vintage and workwear buyers, while the modern Kohl\'s-era line is widely available and trades at accessible prices. Value depends heavily on the era (original bridge-line pieces lead) and the piece; sought-after vintage tailoring and silk are the most viable resale items, while current store-brand pieces trade at low prices.',
    resale: 'Low', demand: 5.5, sellSpeed: 'Moderate',
    products: ['Tailored Suits', 'Dresses', 'Silk Blouses', 'Separates'],
  },
  'Cato': {
    country: 'United States', founded: '1946', domain: 'catofashions.com',
    description: 'The Cato Corporation was founded in 1946 in Charlotte, North Carolina, by Wayland Cato Sr. and his sons, building a chain of value-priced women\'s fashion stores serving small-town and suburban Southern markets through low-overhead strip-mall locations. It sells trend-right apparel, accessories, jewelry, and shoes—largely under its own private labels—at very low prices. On the resale market Cato has low demand: as a value-chain whose merchandise is inexpensive and abundant when new, it carries essentially no secondhand premium, and resale is driven purely by practical value rather than collectibility. It is not a collector or hype name. Value depends almost entirely on condition, size, and basic utility; pieces trade at low prices, making Cato one of the lower-demand apparel brands for resale, typically sold as inexpensive everyday and trend basics rather than for any collector value.',
    resale: 'Low', demand: 4.5, sellSpeed: 'Slow',
    products: ['Dresses', 'Tops', 'Jewelry', 'Accessories'],
  },
  'Charter Club': {
    country: 'United States', founded: '—', domain: 'macys.com',
    description: 'Charter Club is a women\'s private-label brand sold exclusively at Macy\'s, offering classic, polished casual and career apparel plus cashmere sweaters and home textiles—aimed at a refined, value-conscious customer seeking timeless basics. As a store house brand (one of Macy\'s flagship private labels), it competes on accessible quality rather than fashion prestige or independent heritage. On the resale market Charter Club has low, modest demand: its cashmere sweaters and classic knits are the main draw and hold accessible value, while general apparel is widely available and inexpensive. It is a store-brand line rather than a collector or hype name, so resale values stay low. Value depends on the piece (cashmere and quality knits lead), size, and condition; well-kept cashmere sweaters are the most viable resale items, while general apparel trades at low prices.',
    resale: 'Low', demand: 4.5, sellSpeed: 'Slow',
    products: ['Cashmere Sweaters', 'Knit Tops', 'Casualwear', 'Home Textiles'],
  },
  'Lane Bryant': {
    country: 'United States', founded: '1904', domain: 'lanebryant.com',
    description: 'Lane Bryant was founded in 1904 in New York City by Lena Himmelstein Bryant, a pioneer who began with maternity designs and then built the first major retailer dedicated to plus-size women\'s clothing, creating an entire market category. It remains a leading plus-size apparel and intimates brand. On the resale market Lane Bryant has low-to-modest demand: its dresses, denim, and especially its well-regarded intimates and bras hold accessible value within the plus-size resale niche, where size-inclusive options are sought, while general apparel is widely available. It is a mainstream specialty retailer rather than a hype or collector name, so resale values stay accessible. Value depends on the piece (intimates and dresses lead within the plus niche), size, and condition; well-kept bras, dresses, and denim are the most viable resale items, while general apparel trades at low prices.',
    resale: 'Low', demand: 5.5, sellSpeed: 'Moderate',
    products: ['Dresses', 'Intimates', 'Denim', 'Tops'],
  },
  'Torrid': {
    country: 'United States', founded: '2001', domain: 'torrid.com',
    description: 'Torrid was founded in 2001 as a plus-size spinoff of Hot Topic, building a fashion-forward, on-trend plus-size brand for younger women with an edgier, alternative-leaning aesthetic—offering trend pieces, dresses, denim, intimates, and licensed pop-culture apparel in extended sizes. On the resale market Torrid has modest demand, strong within the plus-size resale niche: its dresses, denim, intimates, and especially limited licensed collaborations (Disney, Marvel, and other pop-culture tie-ins) draw active interest among plus-size and fandom buyers, where size-inclusive and sold-out items are sought. Value depends on the piece, any licensed-collaboration status, size, and condition; sought-after licensed-collaboration pieces and well-kept dresses and denim are the most viable resale items, while general apparel trades at accessible prices, making Torrid one of the more resale-active plus-size brands thanks to its fandom collaborations.',
    resale: 'Moderate', demand: 6.0, sellSpeed: 'Moderate',
    products: ['Dresses', 'Denim', 'Licensed Apparel', 'Intimates'],
  },
  'Liz Claiborne': {
    country: 'United States', founded: '1976', domain: 'lizclaiborne.com',
    description: 'Liz Claiborne was founded in 1976 by designer Liz Claiborne and her husband Art Ortenberg in New York, pioneering accessible, mix-and-match professional womenswear for the growing ranks of working women and becoming the first company founded by a woman to make the Fortune 500. It is now a licensed brand (sold largely through JCPenney). On the resale market Liz Claiborne has low, modest demand with a vintage angle: vintage 1980s–90s Liz Claiborne pieces—bold-print blouses, tailored separates, and the Liz Sport and Lizwear lines—draw interest among vintage-fashion and workwear buyers, while modern licensed pieces are widely available. Value depends heavily on the era (vintage 80s–90s leads), the piece, size, and condition; sought-after vintage prints and tailored pieces are the most viable resale items, while current licensed apparel trades at low prices.',
    resale: 'Low', demand: 5.5, sellSpeed: 'Moderate',
    products: ['Blouses', 'Tailored Separates', 'Dresses', 'Vintage Pieces'],
  },

  // ── COMMON TIER, BATCH 3 / FINAL (fully curated, 100–150 words each) ────────
  'Columbia': {
    country: 'United States', founded: '1938', domain: 'columbia.com',
    description: 'Columbia Sportswear traces to 1938 in Portland, Oregon, founded by Paul Lazarus and built into a powerhouse by Gert Boyle ("One Tough Mother") and her son Tim. It is a leading mass-market outdoor brand known for accessible technical outerwear—Bugaboo and Interchange jackets, Omni-Heat and Omni-Tech technologies, and the PFG (Performance Fishing Gear) line. On the resale market Columbia has modest, steady demand with a vintage angle: vintage 90s fleece, ski jackets, and color-blocked pieces draw interest amid the gorpcore and vintage-outdoor revival, while the PFG line has a regional following, and general modern outerwear trades at accessible prices. Value depends on the era (vintage 90s leads), the piece, the colorway, size, and condition; sought-after vintage fleece and color-blocked jackets are the most viable resale items, while current mass stock trades at accessible prices.',
    resale: 'Moderate', demand: 6.5, sellSpeed: 'Moderate',
    products: ['Fleece Jackets', 'Ski Jackets', 'PFG Shirts', 'Rain Shells'],
  },
  'Eddie Bauer': {
    country: 'United States', founded: '1920', domain: 'eddiebauer.com',
    description: 'Eddie Bauer was founded in 1920 in Seattle by its namesake outdoorsman, who patented the first quilted goose-down jacket (the Skyliner) in 1936 and outfitted expeditions including the first American ascent of K2. It became a heritage American outdoor and casual brand known for down outerwear and rugged sportswear. On the resale market Eddie Bauer has modest, steady demand with a vintage focus: vintage down jackets, the heritage goose-down pieces, flannels, and 90s outdoor sportswear draw interest among heritage and gorpcore buyers, while general modern apparel trades at accessible prices. Value depends on the era (vintage down and heritage pieces lead), the piece, size, and condition; well-kept vintage down jackets and rugged sportswear are the most viable resale items, while current mainline apparel trades at accessible prices as a mass outdoor-casual brand.',
    resale: 'Moderate', demand: 6.2, sellSpeed: 'Moderate',
    products: ['Down Jackets', 'Flannels', 'Outdoor Sportswear', 'Vests'],
  },
  'L.L.Bean': {
    country: 'United States', founded: '1912', domain: 'llbean.com',
    description: 'L.L.Bean was founded in 1912 in Freeport, Maine, by Leon Leonwood Bean, who launched the company with the Maine Hunting Shoe (the original "Bean Boot," still a signature). It became a heritage American outdoor and preppy staple known for the Bean Boot duck boot, the Boat and Tote bag, flannels, and a famous lifetime-satisfaction guarantee. On the resale market L.L.Bean has modest, steady demand with a strong heritage and vintage angle: the Bean Boots, vintage flannels and chamois shirts, the Boat and Tote (especially custom-monogram and collaboration versions), and vintage outerwear draw the most interest, while general apparel trades at accessible prices. Value depends on the item (Bean Boots and the Boat and Tote lead), era, any collaboration, size, and condition; sought-after heritage pieces and collaborations are the most viable resale items.',
    resale: 'Moderate', demand: 6.5, sellSpeed: 'Moderate',
    products: ['Bean Boots', 'Boat and Tote Bags', 'Flannels', 'Outerwear'],
  },
  'Woolrich': {
    country: 'United States', founded: '1830', domain: 'woolrich.com',
    description: 'Woolrich was founded in 1830 in Pennsylvania by John Rich, making it one of the oldest continuously operating woolen mills in the United States. It is known for heavy wool outerwear, the buffalo-check wool shirt (which it popularized), the Arctic Parka, and rugged heritage Americana, and has gained renewed fashion relevance through Italian ownership and design collaborations. On the resale market Woolrich has modest, steady demand with a strong heritage and vintage focus: vintage wool coats and buffalo-plaid shirts, the Arctic Parka, and Made in USA pieces draw interest among heritage and Americana buyers, while collaborations (with brands and designers) command premiums. Value depends on the era (vintage and Made in USA lead), the piece, size, and condition; sought-after vintage wool outerwear, buffalo-check pieces, and collaborations are the most viable resale items, while current mainline apparel trades at accessible prices.',
    resale: 'Moderate', demand: 6.5, sellSpeed: 'Moderate',
    products: ['Wool Coats', 'Buffalo-Check Shirts', 'Arctic Parkas', 'Blankets'],
  },
  'JanSport': {
    country: 'United States', founded: '1967', domain: 'jansport.com',
    description: 'JanSport was founded in 1967 in Seattle by Skip Yowell, Murray Pletz, and Jan Lewis (for whom the brand is named), pioneering lightweight aluminum-frame backpacks before becoming the dominant name in everyday school backpacks. Now owned by VF Corporation, it is known for the SuperBreak and Right Pack daypacks. On the resale market JanSport has modest, steady demand with a vintage angle: vintage leather-bottom Right Pack backpacks, USA-made pieces, and 90s colorways draw interest among vintage and nostalgia buyers, while general modern backpacks are abundant and trade at accessible prices. Value depends on the era (vintage USA-made and leather-bottom packs lead), the model, colorway, and condition; sought-after vintage and leather-bottom backpacks are the most viable resale items, while current mass-market packs trade at accessible prices as an everyday staple.',
    resale: 'Moderate', demand: 6.0, sellSpeed: 'Moderate',
    products: ['Backpacks', 'Daypacks', 'Right Pack', 'Bags'],
  },
  'Mossy Oak': {
    country: 'United States', founded: '1986', domain: 'mossyoak.com',
    description: 'Mossy Oak was founded in 1986 in West Point, Mississippi, by Toxey Haas (under parent Haas Outdoors), who created a new style of realistic camouflage from natural elements—its original Bottomland pattern launched the brand. It became one of the two dominant names in hunting camouflage, licensing its patterns across apparel and gear. On the resale market Mossy Oak has low-to-modest demand within the hunting niche: licensed camo apparel and gear hold accessible value among hunters, with discontinued and vintage patterns (especially the original Bottomland) drawing the most collector interest, and demand spiking seasonally around hunting openers. It is a function-and-licensing brand rather than a fashion-hype name. Value depends on the pattern (vintage Bottomland leads), the item, size, and condition; sought-after vintage camo patterns are the most viable resale items, while current licensed gear trades at accessible prices.',
    resale: 'Low', demand: 5.5, sellSpeed: 'Moderate',
    products: ['Camo Apparel', 'Hunting Gear', 'Caps', 'Jackets'],
  },
  'Realtree': {
    country: 'United States', founded: '1986', domain: 'realtree.com',
    description: 'Realtree was founded in 1986 in Columbus, Georgia, by Bill Jordan (under Jordan Outdoor Enterprises), who hand-drew a realistic tree-bark camouflage pattern that he introduced at the SHOT Show. It became one of the two dominant hunting-camo brands, licensing its patterns across thousands of apparel and gear products. On the resale market Realtree has low-to-modest demand within the hunting niche: licensed camo apparel and gear hold accessible value among hunters, with discontinued and vintage patterns (such as early All-Purpose and Advantage designs) drawing the most collector interest, and demand spiking seasonally. It is a function-and-licensing brand rather than a fashion-hype name. Value depends on the pattern (vintage and discontinued patterns lead), the item, size, and condition; sought-after vintage camo is the most viable resale, while current licensed gear trades at accessible prices, supported by the brand\'s broad licensing footprint.',
    resale: 'Low', demand: 5.5, sellSpeed: 'Moderate',
    products: ['Camo Apparel', 'Hunting Gear', 'Caps', 'Jackets'],
  },
  'Converse': {
    country: 'United States', founded: '1908', domain: 'converse.com',
    description: 'Converse was founded in 1908 in Malden, Massachusetts, by Marquis Mills Converse, and became iconic through the Chuck Taylor All Star (introduced 1917 and endorsed by basketball player Chuck Taylor) and the One Star. Now owned by Nike, it is a foundational sneaker brand woven through sports, punk, skate, and music culture. On the resale market Converse has steady, fast demand: while standard Chuck Taylors are abundant and inexpensive, limited collaborations (Comme des Garçons PLAY, Off-White, Tyler the Creator\'s Golf le Fleur, Fear of God) and vintage "Made in USA" Chucks command significant premiums and sell out quickly. Value depends on the model, collaboration, era (vintage USA-made leads for collectors), colorway, size, and condition; sought-after collaborations and vintage Chucks carry the strongest premiums, while standard pairs trade at accessible prices.',
    resale: 'Moderate', demand: 7.0, sellSpeed: 'Fast',
    products: ['Chuck Taylor Sneakers', 'One Star', 'Collab Sneakers', 'Apparel'],
  },
  'Vans': {
    country: 'United States', founded: '1966', domain: 'vans.com',
    description: 'Vans was founded in 1966 in Anaheim, California, by Paul Van Doren and partners, originally selling shoes directly from its factory before becoming the defining skateboarding footwear brand. It is known for the Authentic, Old Skool, Sk8-Hi, and Slip-On, built on the signature waffle sole. On the resale market Vans has steady, fast demand: while core models are abundant and affordable, limited collaborations (Supreme, Fear of God, Vault by Vans designer projects, anime and brand tie-ins) and vintage "Made in USA" pairs command premiums and sell out, and the Knu Skool and other revived silhouettes ride trend cycles. Value depends on the model, collaboration, era, colorway, size, and condition; sought-after collaborations and vintage pairs carry the strongest premiums, while standard models trade at accessible prices, supported by the brand\'s deep skate and streetwear credibility.',
    resale: 'Moderate', demand: 7.2, sellSpeed: 'Fast',
    products: ['Old Skool Sneakers', 'Sk8-Hi', 'Slip-Ons', 'Authentic'],
  },
  'Crocs': {
    country: 'United States', founded: '2002', domain: 'crocs.com',
    description: 'Crocs was founded in 2002 in Boulder, Colorado, launching its signature foam clog—made from the proprietary Croslite material—as a boating shoe before it became a global comfort-footwear phenomenon (and a fashion meme turned genuine trend). It is known for the Classic Clog, customizable with Jibbitz charms. On the resale market Crocs has moderate, steady demand driven heavily by collaborations: limited tie-ins (with Balenciaga, Salehe Bembury\'s Pollex, Post Malone, McDonald\'s, and many brands) sell out and command significant premiums, while standard clogs are abundant and affordable. The charm (Jibbitz) ecosystem and frequent hype drops sustain interest. Value depends on the model, collaboration, colorway, size, and condition; sought-after collaborations—especially the Pollex and Balenciaga pieces—carry the strongest premiums, while standard Classic Clogs trade at accessible prices.',
    resale: 'Moderate', demand: 6.8, sellSpeed: 'Moderate',
    products: ['Classic Clogs', 'Collab Clogs', 'Jibbitz Charms', 'Sandals'],
  },
  'Jumping Beans': {
    country: 'United States', founded: '—', domain: 'kohls.com',
    description: 'Jumping Beans is a private-label children\'s apparel brand sold exclusively at Kohl\'s, offering affordable, playful everyday clothing for babies and young kids—tees, leggings, rompers, and casual basics with bright graphics and durable, easy-care construction. As a store house brand, it competes on value and parent-friendly practicality rather than fashion prestige. On the resale market Jumping Beans has very low demand: as inexpensive children\'s store-brand clothing that is abundant when new and quickly outgrown, it carries essentially no secondhand premium, and resale is driven purely by practical value—typically bundled lots of kids\' clothing rather than individual pieces. It is not a collector or hype name. Value depends almost entirely on condition and bundle utility; pieces trade at minimal prices, making Jumping Beans one of the lowest-demand brands for individual resale, usually moved in mixed children\'s-clothing lots.',
    resale: 'Low', demand: 4.0, sellSpeed: 'Slow',
    products: ['Kids Tees', 'Leggings', 'Rompers', 'Casualwear'],
  },
  'Hanes': {
    country: 'United States', founded: '1901', domain: 'hanes.com',
    description: 'Hanes traces to 1901 in Winston-Salem, North Carolina (when Pleasant H. Hanes founded the P.H. Hanes Knitting Company), and became one of America\'s most recognizable everyday-basics brands—underwear, undershirts, socks, and blank tees and sweatshirts—and was first to market tagless tees. It is now part of Hanesbrands. On the resale market Hanes has low demand: as a mass producer of inexpensive, abundant basics and blanks, its products carry essentially no secondhand premium, and resale is driven purely by practical value. The narrow exception is vintage single-stitch blank tees and sweatshirts, which draw minor interest from vintage-blank enthusiasts. It is a value-basics brand rather than a collector or hype name. Value depends almost entirely on condition and basic utility; modern basics trade at minimal prices, with only vintage single-stitch blanks drawing occasional niche interest.',
    resale: 'Low', demand: 4.5, sellSpeed: 'Slow',
    products: ['Underwear', 'Blank Tees', 'Socks', 'Sweatshirts'],
  },
  'Fruit of the Loom': {
    country: 'United States', founded: '1851', domain: 'fruit.com',
    description: 'Fruit of the Loom traces to 1851 in Rhode Island, making it one of the oldest apparel brands in the United States, recognizable by its fruit-cluster logo. Now owned by Berkshire Hathaway, it is a mass producer of everyday basics—underwear, undershirts, socks, and blank tees and sweatshirts—at the most accessible price points. On the resale market Fruit of the Loom has low demand: as a maker of inexpensive, abundant basics and blanks, its products carry essentially no secondhand premium, and resale is driven purely by practical value. The narrow exception is vintage single-stitch blank tees and sweatshirts (and vintage logo pieces), which draw minor interest from vintage-blank collectors. It is a value-basics brand rather than a collector or hype name. Value depends almost entirely on condition and basic utility; modern basics trade at minimal prices, with only vintage blanks drawing occasional niche interest.',
    resale: 'Low', demand: 4.5, sellSpeed: 'Slow',
    products: ['Underwear', 'Blank Tees', 'Socks', 'Sweatshirts'],
  },
  'Gildan': {
    country: 'Canada', founded: '1984', domain: 'gildan.com',
    description: 'Gildan was founded in 1984 in Montreal, Canada, by Glenn and Greg Chamandy, growing through vertical integration into the largest manufacturer of blank activewear in North America—undecorated tees, hoodies, and fleece sold by the dozen to screen printers and promotional decorators. It also owns American Apparel and Comfort Colors. On the resale market Gildan has low demand: as the archetypal blank-apparel supplier whose garments are inexpensive and produced in enormous volume for decoration, its undecorated products carry essentially no secondhand premium, and resale is driven purely by practical value. It is a wholesale-basics manufacturer rather than a consumer fashion, collector, or hype brand. Value depends almost entirely on condition and basic utility; blank Gildan garments trade at minimal prices, making it one of the lowest-demand apparel brands for individual resale, typically moved in bulk.',
    resale: 'Low', demand: 4.0, sellSpeed: 'Slow',
    products: ['Blank Tees', 'Hoodies', 'Fleece', 'Activewear Blanks'],
  },
  'Jerzees': {
    country: 'United States', founded: '—', domain: 'jerzees.com',
    description: 'Jerzees is a blank-activewear brand owned by Fruit of the Loom, offering value-priced undecorated tees, sweatshirts, and fleece aimed at the screen-printing, promotional, and team-apparel markets. Positioned as an affordable workhorse blank, it competes on low cost and broad availability rather than premium fabric or fashion appeal. On the resale market Jerzees has very low demand: as an inexpensive blank-apparel line produced in high volume for decoration, its undecorated garments carry essentially no secondhand premium, and resale is driven purely by practical value. It is a wholesale-basics brand rather than a consumer fashion, collector, or hype name. Value depends almost entirely on condition and basic utility; blank Jerzees garments trade at minimal prices, making it one of the lowest-demand apparel brands for individual resale, typically moved in bulk for printing rather than sold as finished consumer pieces.',
    resale: 'Low', demand: 4.0, sellSpeed: 'Slow',
    products: ['Blank Tees', 'Sweatshirts', 'Fleece', 'Hoodies'],
  },
  'Port & Company': {
    country: 'United States', founded: '—', domain: 'sanmar.com',
    description: 'Port & Company is a private blank-apparel brand owned by SanMar (a major US apparel wholesaler founded in 1971), offering the most budget-friendly undecorated essentials—tees, fleece, hoodies, bags, and caps—aimed squarely at the screen-printing and promotional-products markets. It is positioned as an entry-level value blank. On the resale market Port & Company has very low demand: as an inexpensive wholesale blank produced for decoration, its undecorated garments carry essentially no secondhand premium, and resale is driven purely by practical value. It is a wholesale-basics brand rather than a consumer fashion, collector, or hype name. Value depends almost entirely on condition and basic utility; blank Port & Company garments trade at minimal prices, making it one of the lowest-demand apparel brands for individual resale, typically moved in bulk for printing rather than sold as finished consumer pieces.',
    resale: 'Low', demand: 3.8, sellSpeed: 'Slow',
    products: ['Blank Tees', 'Fleece', 'Bags', 'Caps'],
  },
  'Bella + Canvas': {
    country: 'United States', founded: '1992', domain: 'bellacanvas.com',
    description: 'BELLA+CANVAS was founded in 1992 in Los Angeles by Danny Harris and Marco DeGeorge, growing into the largest US manufacturer of premium blank apparel—retail-fit, fashion-forward, soft ringspun tees, tanks, and fleece favored by decorators, brands, and promotional distributors. It emphasizes ethical, US-based, sustainable manufacturing. On the resale market Bella+Canvas has low demand as a brand: although its blanks are considered premium and are widely used by clothing labels, the undecorated garments themselves carry little secondhand premium, and resale is driven by practical value rather than collectibility. It is a wholesale-and-manufacturing brand rather than a consumer fashion, collector, or hype name. Value depends almost entirely on condition and basic utility; blank Bella+Canvas garments trade at low prices, though their premium reputation can make them marginally more desirable than budget blanks when resold in bulk.',
    resale: 'Low', demand: 5.0, sellSpeed: 'Slow',
    products: ['Premium Blank Tees', 'Tanks', 'Fleece', 'Hoodies'],
  },
  'Tultex': {
    country: 'United States', founded: '1937', domain: 'tultex.com',
    description: 'Tultex traces to 1937 in Martinsville, Virginia, when textile magnate W.L. Pannill established Sale Knitting Co. as a separate fleecewear company; it grew into a major maker of fleece sweatshirts and blank activewear (and later branded lines like Discus Athletic) before the original corporation\'s decline. The Tultex name continues as a blank-apparel label. On the resale market Tultex has low demand overall, with a niche vintage angle: vintage 80s–90s Tultex blank sweatshirts and fleece are sought by vintage-blank enthusiasts for their heavyweight, period-correct construction (often used as canvases for vintage prints), while modern blanks carry little premium. Value depends heavily on the era (vintage heavyweight blanks lead), the piece, and condition; sought-after vintage Tultex fleece and single-stitch blanks are the most viable resale items, while current blanks trade at low prices.',
    resale: 'Low', demand: 5.0, sellSpeed: 'Moderate',
    products: ['Blank Sweatshirts', 'Fleece', 'Tees', 'Hoodies'],
  },
  'Anvil': {
    country: 'United States', founded: '1976', domain: 'anvilknitwear.com',
    description: 'Anvil began operating as Anvil Knitwear in 1976 (with roots in the much older BVD undergarment business), becoming a maker of blank tees and activewear for the screen-printing and promotional markets, with an early reputation for organic-cotton and sustainability-minded blanks. It was acquired by Gildan in 2012. On the resale market Anvil has low demand: as an inexpensive blank-apparel brand produced for decoration, its undecorated garments carry essentially no secondhand premium, and resale is driven purely by practical value, with only the occasional vintage blank drawing minor niche interest. It is a wholesale-basics brand rather than a consumer fashion, collector, or hype name. Value depends almost entirely on condition and basic utility; blank Anvil garments trade at minimal prices, making it one of the lowest-demand apparel brands for individual resale, typically moved in bulk for printing.',
    resale: 'Low', demand: 4.5, sellSpeed: 'Slow',
    products: ['Blank Tees', 'Sweatshirts', 'Hoodies', 'Activewear Blanks'],
  },
  'Comfort Colors': {
    country: 'United States', founded: '1975', domain: 'comfortcolors.com',
    description: 'Comfort Colors was founded in 1975, building its identity around garment-dyed blank apparel—pigment-dyed tees and sweatshirts with a soft, broken-in feel and a distinctive vintage-washed color palette that look lived-in right away. Now owned by Gildan, it is a favorite blank for college, coastal, and fashion brands. On the resale market Comfort Colors has moderate demand for a blank brand: unlike commodity blanks, its garment-dyed tees and crewnecks are genuinely sought-after as desirable finished pieces—popular for greek-life, beach-town, and small-brand merch—and discontinued or rare dye colors draw extra interest, giving it more secondhand appeal than typical blanks. Value depends on the garment, the dye color (rare and discontinued shades lead), any desirable print, size, and condition; sought-after colors and well-printed pieces are the most viable resale items, while plain blanks trade at accessible prices.',
    resale: 'Moderate', demand: 6.0, sellSpeed: 'Moderate',
    products: ['Garment-Dyed Tees', 'Crewnecks', 'Hoodies', 'Long-Sleeves'],
  },
  'PGA Tour': {
    country: 'United States', founded: '1968', domain: 'pgatour.com',
    description: 'PGA Tour apparel is the licensed clothing line bearing the name of the PGA TOUR—the organization of professional golfers that formed in 1968 when tournament players split from the PGA of America. The apparel line offers accessible performance golf wear—moisture-wicking polos, shorts, pants, and outerwear—sold widely at mid-market and value retailers. On the resale market PGA Tour apparel has low demand: as a licensed, mass-market golf-wear line, its pieces are widely available and inexpensive, carrying little secondhand premium, and resale is driven purely by practical value rather than collectibility. It is a value licensed brand rather than a premium golf label or collector name. Value depends almost entirely on condition, size, and basic utility; performance polos and golf pants trade at low prices, making PGA Tour apparel one of the lower-demand golf brands on the secondhand market.',
    resale: 'Low', demand: 5.0, sellSpeed: 'Slow',
    products: ['Golf Polos', 'Golf Shorts', 'Pants', 'Outerwear'],
  },
  'Ben Hogan': {
    country: 'United States', founded: '1953', domain: 'benhogangolf.com',
    description: 'The Ben Hogan Company was founded in 1953 by legendary golfer Ben Hogan in Fort Worth, Texas, with a stated goal of making the finest forged irons—clubs meant to look "like a piece of fine jewelry." The brand has been revived several times and spans golf equipment and licensed apparel. On the resale market Ben Hogan has a split profile: vintage Ben Hogan forged irons, wedges, and persimmon woods from the brand\'s classic era are genuinely collectible among golf-equipment enthusiasts and hold solid value, while licensed apparel is mass-market and carries little premium. Value depends heavily on the category—vintage forged clubs lead—plus the model, era, and condition; sought-after classic-era forged irons and rare club sets are the most valuable resale items, while modern apparel and value-line gear trade at low prices.',
    resale: 'Low', demand: 5.5, sellSpeed: 'Moderate',
    products: ['Golf Clubs', 'Forged Irons', 'Golf Apparel', 'Wedges'],
  },
  'Life is Good': {
    country: 'United States', founded: '1994', domain: 'lifeisgood.com',
    description: 'Life is Good was founded in 1994 in Boston by brothers Bert and John Jacobs, built around its optimistic stick-figure character "Jake" and a relentlessly positive, simple-pleasures message, with a portion of profits going to its kids\' foundation. It is known for upbeat graphic tees, hats, and casualwear. On the resale market Life is Good has low demand: as a mass producer of inexpensive, widely available graphic apparel, its pieces carry little secondhand premium, and resale is driven purely by practical value rather than collectibility. It is a feel-good lifestyle brand rather than a collector or hype name. Value depends almost entirely on the graphic appeal, condition, size, and basic utility; graphic tees and hats trade at low prices, making Life is Good one of the lower-demand apparel brands on the secondhand market, typically sold as inexpensive casual basics.',
    resale: 'Low', demand: 5.0, sellSpeed: 'Slow',
    products: ['Graphic Tees', 'Hats', 'Hoodies', 'Casualwear'],
  },
  'Route 66': {
    country: 'United States', founded: '—', domain: 'kmart.com',
    description: 'Route 66 is a private-label denim and casualwear brand historically sold at Kmart, offering value-priced jeans, casual apparel, and basics with an Americana-tinged identity aimed at budget-conscious family shoppers. As a store house brand, it competed purely on price and accessibility rather than fashion prestige or heritage. On the resale market Route 66 has very low demand: as an inexpensive store-brand line produced in volume and now tied to a largely defunct retailer, it carries essentially no secondhand premium, and resale is driven purely by practical value, with only occasional Y2K-nostalgia interest in some vintage denim. It is not a collector or hype name. Value depends almost entirely on condition and basic utility; pieces trade at minimal prices, making Route 66 one of the lowest-demand denim brands for resale, typically moved as inexpensive basics or in bulk.',
    resale: 'Low', demand: 4.0, sellSpeed: 'Slow',
    products: ['Jeans', 'Denim', 'Casual Apparel', 'Basics'],
  },
  'Uniqlo': {
    country: 'Japan', founded: '1984', domain: 'uniqlo.com',
    description: 'Uniqlo opened its first store in 1984 in Hiroshima, Japan, under parent Fast Retailing (Tadashi Yanai), growing into a global "LifeWear" giant focused on high-quality, affordable, minimalist basics and fabric innovation—HEATTECH, AIRism, and Ultra Light Down. On the resale market Uniqlo has modest, steady demand with a strong collaboration angle: while everyday basics are abundant and affordable, its designer and licensed collaborations—especially the +J line with Jil Sander, Uniqlo U with Christophe Lemaire, JW Anderson, and the UT graphic tees with artists and franchises—sell out and command premiums. Value depends on whether a piece is a sought-after collaboration (which leads) versus standard stock, plus the season, size, and condition; +J, Uniqlo U, and popular UT collaborations are the most viable resale items, while general basics trade at accessible prices.',
    resale: 'Moderate', demand: 6.2, sellSpeed: 'Moderate',
    products: ['Basics', 'HEATTECH', 'Ultra Light Down', 'UT Graphic Tees'],
  },
  'Goodfellow & Co': {
    country: 'United States', founded: '2017', domain: 'target.com',
    description: 'Goodfellow & Co is a men\'s private-label brand launched by Target in 2017 as part of its push into in-house apparel, offering affordable, classic-casual menswear—tees, henleys, sweaters, chinos, and casual basics—with an approachable, everyday aesthetic. As a store house brand, it competes on value and accessible style rather than fashion prestige or heritage. On the resale market Goodfellow & Co has low demand: as a store-brand line that is inexpensive and abundant when new, it carries essentially no secondhand premium, and resale is driven purely by practical value rather than collectibility. It is not a collector or hype name. Value depends almost entirely on condition, size, and basic utility; pieces trade at low prices, making Goodfellow & Co one of the lower-demand menswear brands for resale, typically sold as inexpensive everyday basics.',
    resale: 'Low', demand: 4.5, sellSpeed: 'Slow',
    products: ['Tees', 'Henleys', 'Sweaters', 'Chinos'],
  },
  'George': {
    country: 'United Kingdom', founded: '1990', domain: 'walmart.com',
    description: 'George was founded in 1990 by British designer George Davies as a value clothing brand for the UK supermarket ASDA; after Walmart acquired ASDA, George became a value apparel brand in Walmart stores as well. It offers affordable everyday menswear, womenswear, and kids\' clothing—basics, casualwear, and workwear-adjacent pieces. As a supermarket-and-store brand, it competes purely on price and accessibility rather than fashion prestige. On the resale market George has very low demand: as an inexpensive store-brand line that is abundant when new, it carries essentially no secondhand premium, and resale is driven purely by practical value rather than collectibility. It is not a collector or hype name. Value depends almost entirely on condition, size, and basic utility; pieces trade at minimal prices, making George one of the lowest-demand apparel brands for resale.',
    resale: 'Low', demand: 4.0, sellSpeed: 'Slow',
    products: ['Casualwear', 'Basics', 'Kidswear', 'Workwear'],
  },
  'Faded Glory': {
    country: 'United States', founded: '—', domain: 'walmart.com',
    description: 'Faded Glory is a private-label family-apparel brand sold at Walmart, offering value-priced everyday clothing for men, women, and children—denim, tees, casual basics, and seasonal pieces with an all-American, budget-friendly identity. As a store house brand, it competes purely on price and accessibility rather than fashion prestige or heritage. On the resale market Faded Glory has very low demand: as an inexpensive store-brand line that is abundant when new, it carries essentially no secondhand premium, and resale is driven purely by practical value rather than collectibility. It is not a collector or hype name. Value depends almost entirely on condition and basic utility; pieces trade at minimal prices, making Faded Glory one of the lowest-demand apparel brands for individual resale, typically moved as inexpensive basics or in mixed bulk lots rather than sold individually for any meaningful value.',
    resale: 'Low', demand: 4.0, sellSpeed: 'Slow',
    products: ['Denim', 'Tees', 'Casual Basics', 'Seasonal Apparel'],
  },
  'No Boundaries': {
    country: 'United States', founded: '—', domain: 'walmart.com',
    description: 'No Boundaries (often "No Bo") is a juniors and young-adult private-label brand sold at Walmart, offering trend-driven, very low-priced apparel—graphic tees, denim, casual and going-out pieces—aimed at teens and budget-conscious young shoppers. As a store house brand, it competes purely on price and on-trend looks rather than fashion prestige. On the resale market No Boundaries has very low demand: as an inexpensive store-brand line that is abundant when new, it carries essentially no secondhand premium, though the Y2K and 2000s revival lends rare nostalgic interest to some vintage No Bo pieces among younger buyers. It is not a collector or hype name. Value depends almost entirely on condition and basic utility (with occasional Y2K-nostalgia appeal); pieces trade at minimal prices, making No Boundaries one of the lowest-demand apparel brands for resale.',
    resale: 'Low', demand: 4.0, sellSpeed: 'Slow',
    products: ['Graphic Tees', 'Denim', 'Trend Apparel', 'Casualwear'],
  },
  'Time and Tru': {
    country: 'United States', founded: '2017', domain: 'walmart.com',
    description: 'Time and Tru is a women\'s private-label brand launched by Walmart in 2017 as part of its in-house apparel expansion, offering affordable, versatile everyday womenswear—tops, dresses, denim, activewear, and casual basics—aimed at value-conscious shoppers seeking accessible style. As a store house brand, it competes on value and everyday practicality rather than fashion prestige. On the resale market Time and Tru has very low demand: as a store-brand line that is inexpensive and abundant when new, it carries essentially no secondhand premium, and resale is driven purely by practical value rather than collectibility. It is not a collector or hype name. Value depends almost entirely on condition, size, and basic utility; pieces trade at minimal prices, making Time and Tru one of the lowest-demand womenswear brands for resale, typically sold as inexpensive everyday basics.',
    resale: 'Low', demand: 4.0, sellSpeed: 'Slow',
    products: ['Tops', 'Dresses', 'Denim', 'Casual Basics'],
  },
  'Universal Thread': {
    country: 'United States', founded: '2017', domain: 'target.com',
    description: 'Universal Thread is a women\'s private-label brand launched by Target in 2017, focused on affordable, denim-centered everyday womenswear with a relaxed, casual aesthetic—jeans, tees, dresses, and basics—designed to be versatile and inclusive across sizes. As a store house brand, it competes on value and accessible style rather than fashion prestige. On the resale market Universal Thread has low demand: as a store-brand line that is inexpensive and abundant when new, it carries essentially no secondhand premium, and resale is driven purely by practical value rather than collectibility. It is not a collector or hype name. Value depends almost entirely on condition, size, and basic utility; denim and basics trade at low prices, making Universal Thread one of the lower-demand womenswear brands for resale, typically sold as inexpensive everyday pieces.',
    resale: 'Low', demand: 4.5, sellSpeed: 'Slow',
    products: ['Denim', 'Tees', 'Dresses', 'Casual Basics'],
  },
  'Wild Fable': {
    country: 'United States', founded: '2018', domain: 'target.com',
    description: 'Wild Fable is a young women\'s private-label brand launched by Target in 2018, aimed at Gen Z with trend-forward, very affordable apparel—crop tops, going-out pieces, denim, and of-the-moment styles reflecting current social-media trends. As a store house brand, it competes on low prices and fast-moving trends rather than fashion prestige. On the resale market Wild Fable has low demand: as a trend-driven store-brand line that is inexpensive and abundant when new, it carries essentially no secondhand premium, and its fast-fashion nature means styles date quickly, so resale is driven purely by practical value rather than collectibility. It is not a collector or hype name. Value depends almost entirely on condition, size, and how current the trend is; pieces trade at minimal prices, making Wild Fable one of the lower-demand womenswear brands for resale.',
    resale: 'Low', demand: 4.5, sellSpeed: 'Slow',
    products: ['Crop Tops', 'Denim', 'Trend Apparel', 'Going-Out Pieces'],
  },
  'Mossimo': {
    country: 'United States', founded: '1986', domain: 'mossimo.com',
    description: 'Mossimo was founded in 1986 by Mossimo Giannulli in Laguna Beach, California, beginning with surf-and-volleyball shorts before booming into a major 1990s casualwear and denim brand with its distinctive "M" logo. It later became a long-running Target-exclusive brand (2000–2017). On the resale market Mossimo has low demand with a Y2K-nostalgia angle: vintage 1990s Mossimo pieces—logo tees, denim, and surf-influenced casualwear from its independent heyday—draw renewed interest among younger buyers riding the 2000s revival, while the later Target-era pieces are abundant and carry little premium. Value depends heavily on the era (vintage 90s independent-era pieces lead) and the item; sought-after vintage logo and surf pieces are the most viable resale items, while Target-era and general stock trade at low prices, keeping Mossimo a lower-demand brand overall.',
    resale: 'Low', demand: 5.0, sellSpeed: 'Moderate',
    products: ['Logo Tees', 'Denim', 'Casualwear', 'Vintage Pieces'],
  },
  'Merona': {
    country: 'United States', founded: '—', domain: 'target.com',
    description: 'Merona was a long-running private-label brand owned by Target, offering affordable, classic-casual apparel and basics for men and women—polos, sweaters, tailored separates, and everyday pieces—before Target discontinued it around 2017 in favor of newer in-house labels. As a store house brand, it competed on value and approachable style rather than fashion prestige. On the resale market Merona has very low demand: as a now-discontinued store-brand line whose clothing was inexpensive and abundant, it carries essentially no secondhand premium, and resale is driven purely by practical value rather than collectibility. It is not a collector or hype name. Value depends almost entirely on condition, size, and basic utility; pieces trade at minimal prices, making Merona one of the lowest-demand apparel brands for resale, typically sold as inexpensive basics or in mixed lots.',
    resale: 'Low', demand: 4.0, sellSpeed: 'Slow',
    products: ['Polos', 'Sweaters', 'Tailored Separates', 'Basics'],
  },
  'OshKosh B\'gosh': {
    country: 'United States', founded: '1895', domain: 'oshkoshbgosh.com',
    description: 'OshKosh B\'gosh was founded in 1895 in Oshkosh, Wisconsin, as the Grove Manufacturing Company, originally making hickory-striped denim bib overalls for railroad workers and farmers; it adopted its distinctive name in 1937 and became best known for children\'s clothing, especially kids\' bib overalls. It is now a subsidiary of Carter\'s. On the resale market OshKosh B\'gosh has low demand overall, with a niche vintage angle: vintage adult hickory-stripe overalls, union-made workwear, and denim chore pieces from its early decades draw genuine interest among workwear-vintage collectors, while modern children\'s clothing is abundant, quickly outgrown, and carries little premium (typically moved in bundled kids\' lots). Value depends heavily on the era and category—vintage adult workwear leads—plus condition; sought-after vintage hickory-stripe overalls are the most viable resale items, while current kidswear trades at low prices.',
    resale: 'Low', demand: 5.0, sellSpeed: 'Moderate',
    products: ['Kids Overalls', 'Vintage Workwear', 'Denim', 'Childrenswear'],
  },
  // ── FINAL 5: apostrophe-named brands (completes the compendium) ───────────
  'St. John\'s Bay': {
    country: 'United States', founded: '—', domain: 'jcpenney.com',
    description: 'St. John\'s Bay is a private-label brand owned by JCPenney, offering affordable, classic-casual everyday apparel for men and women—polos, woven shirts, jeans, fleece, sweaters, and casual basics with a relaxed, all-American sensibility aimed at value-conscious shoppers. As one of JCPenney\'s longest-running house brands, it competes on price and accessibility rather than fashion prestige or independent heritage. On the resale market St. John\'s Bay has very low demand: as a store-brand line that is inexpensive and abundant when new, it carries essentially no secondhand premium, and resale is driven purely by practical value rather than collectibility. It is not a collector or hype name. Value depends almost entirely on condition, size, and basic utility; pieces trade at minimal prices, making St. John\'s Bay one of the lowest-demand apparel brands for individual resale, typically sold as inexpensive everyday basics or moved in mixed lots.',
    resale: 'Low', demand: 4.5, sellSpeed: 'Slow',
    products: ['Polos', 'Woven Shirts', 'Jeans', 'Fleece'],
  },
  'Chico\'s': {
    country: 'United States', founded: '1983', domain: 'chicos.com',
    description: 'Chico\'s was founded in 1983 on Sanibel Island, Florida, by Marvin and Helene Gralnick—beginning as a tiny Mexican folk-art shop before its cotton sweaters drove a pivot into women\'s apparel. It became a popular brand for women in their 40s through 60s, known for relaxed artisanal pieces, bold prints, easy knits, travel-friendly fabrics, and its distinctive 0–4 sizing system. On the resale market Chico\'s has low, modest demand: its quality knits, wrinkle-resistant Travelers pieces, jackets, and statement jewelry hold accessible value among its loyal older customer base, while general apparel is widely available. It is a mainstream specialty brand rather than a hype or collector name, so resale values stay accessible. Value depends on the piece (Travelers knits and jackets lead), size, and condition; well-kept knits and accessories are the most viable resale items, while general apparel trades at low prices.',
    resale: 'Low', demand: 5.5, sellSpeed: 'Moderate',
    products: ['Knit Tops', 'Travelers Pieces', 'Jackets', 'Jewelry'],
  },
  'Lands\' End': {
    country: 'United States', founded: '1963', domain: 'landsend.com',
    description: 'Lands\' End was founded in 1963 in Chicago by Gary Comer with partners, starting as a mail-order supplier of sailing equipment before evolving into a major catalog and retail brand for classic, durable, value-oriented American basics—oxford shirts, chinos, swimwear, and especially its heavyweight canvas tote bags and outerwear. It was owned by Sears for years before spinning off as an independent company. On the resale market Lands\' End has modest, steady demand with a heritage-quality angle: its sturdy canvas tote bags (especially monogrammed and older USA-made versions), classic outerwear, and well-made basics hold accessible value among buyers seeking durable, timeless pieces, while general apparel is widely available. Value depends on the item (canvas totes and outerwear lead), era, size, and condition; well-kept totes and quality outerwear are the most viable resale items, while general apparel trades at accessible prices.',
    resale: 'Moderate', demand: 5.8, sellSpeed: 'Moderate',
    products: ['Tote Bags', 'Oxford Shirts', 'Outerwear', 'Chinos'],
  },
  'Carter\'s': {
    country: 'United States', founded: '1865', domain: 'carters.com',
    description: 'Carter\'s was founded in 1865 in Needham, Massachusetts, by William Carter, beginning with knitted undershirts and growing into the largest and most recognized children\'s apparel brand in the United States—accounting for a substantial share of all newborn-to-toddler clothing sales. It owns OshKosh B\'gosh and makes exclusive lines for major retailers. On the resale market Carter\'s has low demand: as a maker of inexpensive, abundant baby and children\'s clothing that is quickly outgrown, its pieces carry essentially no secondhand premium, and resale is driven by practical value—typically bundled lots of baby and kids\' clothing rather than individual pieces. It is a trusted mass children\'s brand rather than a collector or hype name. Value depends almost entirely on condition and bundle utility; individual pieces trade at minimal prices, making Carter\'s a low-demand brand for individual resale but a staple of bulk children\'s-clothing lots.',
    resale: 'Low', demand: 4.5, sellSpeed: 'Slow',
    products: ['Baby Bodysuits', 'Sleepwear', 'Kids Sets', 'Layette'],
  },
  'O\'Neill': {
    country: 'United States', founded: '1952', domain: 'oneill.com',
    description: 'O\'Neill was founded in 1952 by Jack O\'Neill, who opened one of California\'s first surf shops in a San Francisco garage before relocating to Santa Cruz; a pioneer of the neoprene wetsuit, he built O\'Neill into a foundational surf brand. It spans wetsuits, boardshorts, swimwear, and casual surf-and-snow lifestyle apparel, recognizable by its breaking-wave logo. On the resale market O\'Neill has modest, steady demand within surf culture: its wetsuits hold practical value, while vintage O\'Neill surf tees, jackets, and wave-logo pieces draw interest among surf-heritage and vintage buyers, and boardshorts move seasonally. It is a heritage surf brand rather than a high-hype streetwear name, so resale values stay accessible. Value depends on the item (wetsuits and vintage logo pieces lead), era, size, and condition; sought-after vintage surf pieces and quality wetsuits are the most viable resale items, while general apparel trades at accessible prices.',
    resale: 'Moderate', demand: 6.0, sellSpeed: 'Moderate',
    products: ['Wetsuits', 'Boardshorts', 'Surf Tees', 'Swimwear'],
  },
};

// ─── Defaults by resale potential ──────────────────────────────────────────────

const RESALE_BY_RARITY: Record<BrandRarity, ResalePotential> = {
  common: 'Moderate', uncommon: 'High', rare: 'Very High', legendary: 'Elite',
};

const DEMAND_BY_RARITY: Record<BrandRarity, number> = {
  common: 6.5, uncommon: 7.5, rare: 8.5, legendary: 9.3,
};

const SPEED_BY_RARITY: Record<BrandRarity, string> = {
  common: 'Moderate', uncommon: 'Moderate', rare: 'Fast', legendary: 'Fast',
};

/**
 * Get full metadata for a brand. Falls back to rarity/category-based defaults
 * for brands without curated entries, so every brand renders a complete page.
 */
export function getBrandMeta(brandName: string): BrandMeta | null {
  const brand = ALL_BRANDS.find(b => b.name === brandName) ?? null;
  if (!brand) return null;

  const curated = META[brand.name];
  if (curated) return curated;

  // Generated fallback
  const cat = CATEGORY_LABELS[brand.category];
  return {
    country: 'Various',
    founded: '—',
    description: `${brand.name} is a ${RARITY_LABELS[brand.rarity].toLowerCase()} ${cat.toLowerCase()} brand tracked in the FlipStart Brand Compendium. Detailed history and market notes are expanding over time.`,
    resale:    RESALE_BY_RARITY[brand.rarity],
    demand:    DEMAND_BY_RARITY[brand.rarity],
    sellSpeed: SPEED_BY_RARITY[brand.rarity],
    products:  [cat],
  };
}
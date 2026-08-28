/**
 * lib/paywallConfig.ts
 *
 * What each paywall SOURCE says. Static copy and flags only.
 *
 * ── Why this file has no React in it ────────────────────────────────────────
 * Two reasons. It stays unit-testable without a native tree or a renderer —
 * every assertion about ordering, copy and the Scan Store rule runs as plain
 * Node. And it keeps the boundary honest: config owns WORDS, composition owns
 * PIXELS. The moment a `renderHero` function lands in here, the registry stops
 * being data and starts being a second component tree expressed in JSON.
 *
 * Phase 3+ adds contextual heroes as real components, selected by source in
 * components/monetization/paywall/PaywallHero.tsx. The mapping lives there, not
 * here.
 *
 * ── Two sources are real; three are still placeholders ──────────────────────
 * generate_listings (Phase 3) and deep_analysis (Phase 4) carry their own copy.
 * third_photo, camera_context and scan_limit keep the generic wording
 * deliberately: their paywalls are designed one at a time, and writing
 * "Unlock Third Photo" before that paywall exists would ship the unfinished
 * generic UI the brief forbids. Their real entry points still use the temporary
 * ProGate, so nothing user-facing depends on those values yet.
 */

/**
 * Every place a paywall can be opened from.
 *
 * `dev_preview` is deliberately a first-class member rather than a boolean flag
 * threaded through the engine: the preview is not pretending to be a gate, and
 * a source it can never share with a real entry point means preview-only
 * behaviour can never leak into one. It is unreachable in production because
 * the only caller is the harness screen — see app/dev-monetization.tsx.
 */
export type ProPaywallSource =
  | "generate_listings"
  | "deep_analysis"
  | "third_photo"
  | "camera_context"
  | "scan_limit"
  | "dev_preview";

export interface PaywallConfig {
  source: ProPaywallSource;
  /** Small label above the headline. Kept short — it is set in wide caps. */
  eyebrow: string;
  headline: string;
  subtitle: string;
  /** Primary button wording. Later phases override per source. */
  ctaLabel: string;
  /**
   * Whether a route to the Scan Store appears as a secondary option.
   *
   * FALSE for every capability paywall, and that is a product rule rather than
   * a layout preference: scan packs buy QUANTITY, never CAPABILITY. Offering
   * packs to someone who wants Generate Listings sells them something that
   * cannot possibly unlock it.
   *
   * Only a scan-limit paywall — where quantity genuinely IS the problem — turns
   * this on.
   */
  showScanStoreAlternative: boolean;
  /**
   * One quiet line under the plans naming what else Pro includes.
   *
   * Exists so a contextual paywall can acknowledge the rest of the subscription
   * WITHOUT turning into a feature checklist. It is a single sentence in small
   * brown type below the plan cards, not a column of ticks — the brief is
   * explicit that this screen sells the thing the user just reached for.
   *
   * Null on the generic paywall, which has no specific feature to be secondary
   * to.
   */
  secondaryValueLine: string | null;
}

/**
 * The generic Phase 2 content.
 *
 * NOT final user-facing copy. Every contextual paywall replaces the headline
 * and subtitle with something about the feature the user actually reached for.
 */
const GENERIC = {
  eyebrow: "FLIPSTART PRO",
  headline: "Unlock More From Every Find",
  subtitle:
    "Get the complete FlipStart experience with premium scanning, analysis, and selling tools.",
  ctaLabel: "Unlock FlipStart Pro",
} as const;

/**
 * Generate Listings — the first contextual paywall (Phase 3).
 *
 * The user pressed a button because they want to sell an item, so the headline
 * promises the LISTING, not the subscription. "Upgrade to Pro" would answer a
 * question they did not ask.
 *
 * The subtitle names what they get and where it goes, and stops. No promise
 * about sales, prices, buyers or speed — none of those are things FlipStart
 * controls, and a paywall implying otherwise is a refund request with extra
 * steps.
 */
const GENERATE_LISTINGS: PaywallConfig = {
  source: "generate_listings",
  eyebrow: "FLIPSTART PRO",
  headline: "Turn Your Find Into a Listing",
  subtitle:
    "Generate ready-to-edit eBay and Depop titles and descriptions in seconds, built from your scan.",
  ctaLabel: "Unlock Generate Listings",
  /**
   * FALSE, and this is the source where it matters most.
   *
   * Someone here wants a listing. Scan packs buy scan QUANTITY and would not
   * unlock this feature no matter how many they bought, so offering them would
   * be selling a thing that cannot solve the problem.
   */
  showScanStoreAlternative: false,
  secondaryValueLine: "Pro also includes 3-photo scans, AI Context, Deep Analysis, and more.",
};

/** The four sources still awaiting their own phase. */
const placeholder = (
  source: ProPaywallSource,
  showScanStoreAlternative = false,
): PaywallConfig => ({ source, ...GENERIC, showScanStoreAlternative, secondaryValueLine: null });

/**
 * Deep Analysis — the second contextual paywall (Phase 4).
 *
 * The user pressed this because they want to know MORE about an item before
 * deciding, so the headline promises understanding rather than a subscription.
 * "Deep Analysis Locked" would describe our billing; "See the Full Picture"
 * describes what they get.
 *
 * The subtitle names the four dimensions the real feature actually covers and
 * stops there. No promise of accurate pricing, guaranteed profit or verified
 * authenticity — Deep Analysis is reasoning over a scan, not an appraisal, and
 * copy implying otherwise would be a claim we cannot stand behind.
 */
const DEEP_ANALYSIS: PaywallConfig = {
  source: "deep_analysis",
  eyebrow: "FLIPSTART PRO",
  headline: "See the Full Picture",
  subtitle:
    "Go beyond the quick scan with deeper pricing, market, risk, and resale insights.",
  ctaLabel: "Unlock Deep Analysis",
  /**
   * FALSE. Scan packs buy scan QUANTITY and cannot unlock this capability at
   * any balance, so routing someone here to the Scan Store would sell them
   * something that does not solve their problem.
   */
  showScanStoreAlternative: false,
  secondaryValueLine: "Dig deeper before you buy or sell.",
};

const CONFIGS: Record<ProPaywallSource, PaywallConfig> = {
  generate_listings: GENERATE_LISTINGS,
  deep_analysis:     DEEP_ANALYSIS,
  third_photo:       placeholder("third_photo"),
  camera_context:    placeholder("camera_context"),
  /** The one source where extra scans are a real answer to the user's problem. */
  scan_limit:        placeholder("scan_limit", true),
  dev_preview:       placeholder("dev_preview"),
};

/**
 * Unknown source falls back to the generic capability config with the Scan
 * Store OFF.
 *
 * Fail-closed on the commercial rule: a typo must never accidentally offer
 * packs on a capability paywall, because that sells something that does not
 * unlock the thing the user asked for.
 */
export function resolvePaywallConfig(source: ProPaywallSource): PaywallConfig {
  return CONFIGS[source] ?? placeholder(source);
}

/** Every source, for tests and the dev preview picker. */
export const PAYWALL_SOURCES = Object.keys(CONFIGS) as ProPaywallSource[];

/**
 * Scan allowances, mirrored from server/monetization/policy.ts.
 *
 * The client cannot import that module — it reads Railway environment. The
 * same mirroring already exists in lib/scanBalanceDisplay.ts, so this follows
 * an established convention rather than inventing one.
 *
 * These are FlipStart's own product configuration, not store data, which is
 * why they are constants here while prices are never hardcoded: RevenueCat is
 * the authority on what something costs, and we are the authority on what it
 * includes.
 */
export const MONTHLY_SCANS = 300;
export const ANNUAL_SCANS = 4000;
/**
 * components/monetization/paywall/OnboardingOffer.tsx
 *
 * The new-user Pro offer (Onboarding V2): the last screen before the Camera.
 *
 *              FlipStart
 *               ✦ PRO ✦
 *   ──────────────────────────────────
 *      Get more from every thrift trip.
 *      ✓ More scans      ✓ 3-photo scans
 *      ✓ AI Context      ✓ Generate Listings
 *      [ Deep Analysis: the full reasoning … ]
 *      ( Annual   Save 69%          $29.99 )
 *      ( Monthly                     $7.99 )
 *      [ ✦  Start Annual Pro · $29.99/year  ✦ ]
 *      [          Continue Free            ]
 *      15 lifetime scans included · Upgrade anytime
 *      Restore Purchases · disclosure · links
 *
 * ── Layout only ─────────────────────────────────────────────────────────────
 * This file draws. It owns no purchase, restore or entitlement logic and holds
 * no state: ProPaywallModal runs the same machine it runs for every other
 * source and passes the results in. If a rule about money is being decided
 * here, it is in the wrong place.
 *
 * ── The order is the point ──────────────────────────────────────────────────
 * Everything Pro adds is listed BEFORE the plans and the button, so nobody is
 * asked to pay for something they have not been shown. Both decisions, Pro
 * and Free, sit on the first frame on every iPhone; on a normal iPhone the
 * whole screen fits without scrolling. The scroll view around this is the
 * fallback for large text, not the plan.
 *
 * ── The two buttons are the shared paywall's ───────────────────────────────
 * PaywallPurchaseButton (deep forest, a gold spark either side, the sheen)
 * and PaywallFreeButton, unchanged. Free is a real button, never a link.
 *
 * ── Prices ──────────────────────────────────────────────────────────────────
 * Every figure comes from the store through lib/paywallPricing.ts. Nothing is
 * typed here: a price that has not loaded is a skeleton, and a saving or a
 * per-month figure that cannot be worked out honestly is simply not shown.
 */
import React from "react";
import { Linking, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { FONTS } from "@/constants/typography";
import { Skeleton } from "@/components/monetization/Skeleton";
import { OnboardingHeader } from "@/components/onboarding/OnboardingHeader";
import { OB, OB_SPACE } from "@/components/onboarding/onboardingTheme";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ANNUAL_SCANS, MONTHLY_SCANS, ONBOARDING_DEEP_ANALYSIS, ONBOARDING_PRO_FEATURES,
  type PaywallConfig,
} from "@/lib/paywallConfig";
import {
  annualMonthlyEquivalent, annualSavingsPercent, type ProductPricing,
} from "@/lib/paywallPricing";
import type { ProductsStatus } from "@/lib/paywallMachine";
import type { PurchaseTarget } from "@/lib/purchases";
import { PaywallFreeButton } from "./PaywallFreeButton";
import { PaywallPurchaseButton } from "./PaywallPurchaseButton";

/** Verbatim from app/(tabs)/settings.tsx and PaywallFooter. Do not invent alternatives. */
const PRIVACY_URL = "https://flipstartapp.com/privacy";
const TERMS_URL = "https://flipstartapp.com/terms";

/**
 * Below this much usable height the screen tightens: a one-line headline and
 * closer spacing, nothing removed. 740 rather than onboarding's 700 because
 * this screen carries more than a question does: the 8 Plus (716) and the
 * 12/13 mini (728) need the tighter column to stay on one frame.
 */
export const OFFER_COMPACT_USABLE_PT = 740;
/** Pro Max and up get a little more air. Same content. */
export const OFFER_ROOMY_WINDOW_PT = 900;
/** Georgia heavy sets this headline about 13.6pt wide per point of size. */
const HEADLINE_WIDTH_PER_PT = 14;

/** Dynamic Type may grow the copy this far; past it the screen scrolls instead. */
const MAX_SCALE = 1.3;
/** The words of the headline set in forest. */
const HEADLINE_ACCENT = "thrift trip.";
/** Error red, the same one the username screen uses. */
const BAD = "#B42318";

export interface OfferPlan {
  available: boolean;
  pricing: ProductPricing;
}

export interface OnboardingOfferProps {
  config: PaywallConfig;

  selected: PurchaseTarget;
  onSelect: (t: PurchaseTarget) => void;
  annual: OfferPlan;
  monthly: OfferPlan;
  /** "loading" until the store answers; "error" when it could not be reached. */
  productsStatus: ProductsStatus;
  productsMessage: string | null;
  onReloadProducts: () => void;

  /** From the purchase machine: a cancelled, failed or pending purchase. */
  notice: { tone: "info" | "error"; text: string } | null;

  ctaLabel: string;
  onPurchase: () => void;
  /** Spinner on the button: the store sheet is up, or Pro is activating. */
  purchaseBusy: boolean;
  purchaseEnabled: boolean;
  blockedLabel: string | null;
  activating: boolean;

  /** Any transaction in flight. Locks the plan rows and the Free button. */
  busy: boolean;
  onContinueFree: () => void;

  disclosure: string;
  onRestore: () => void;
  restoreBusy: boolean;
  restoreDisabled: boolean;
}

export function OnboardingOffer(p: OnboardingOfferProps) {
  const insets = useSafeAreaInsets();
  const { height, width, fontScale } = useWindowDimensions();
  // Large text eats height exactly as a short screen does.
  const compact = height - insets.top - insets.bottom < OFFER_COMPACT_USABLE_PT || fontScale > 1.25;
  const roomy = !compact && height >= OFFER_ROOMY_WINDOW_PT;
  /** Compact only: the largest size at which the headline still sits on one line. */
  const oneLineSize = Math.max(20, Math.min(26, Math.floor(((Math.min(width, 460) - OB_SPACE.gutter * 2) / HEADLINE_WIDTH_PER_PT) * 2) / 2));

  const percent = annualSavingsPercent(p.monthly.pricing, p.annual.pricing);
  const perMonth = annualMonthlyEquivalent(p.annual.pricing);
  const annualScans = `${ANNUAL_SCANS.toLocaleString("en-US")} scans/yr`;

  const [lead, accent] = splitHeadline(p.config.headline);

  const loading = p.productsStatus === "loading";
  const failed = p.productsStatus === "error";
  /** The store answered. Only then can a plan be called unavailable. */
  const settled = !loading && !failed;
  /**
   * A message above the buttons (a failed purchase, the store unreachable)
   * needs room the normal spacing does not have, so the column closes up for
   * as long as it is showing. Nothing is removed and no text shrinks.
   */
  const tight = compact || failed || !!p.notice || p.activating;

  return (
    <View style={s.page}>
      <OnboardingHeader line="PRO" compact={compact} />

      <View style={[s.body, roomy && s.bodyRoomy, tight && s.bodyCompact]}>
        {/* Two deliberate lines where there is room; one fitted line where there is not. */}
        {compact ? (
          <Text
            style={[s.h1, { fontSize: oneLineSize, lineHeight: oneLineSize + 5 }]}
            accessibilityRole="header"
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.85}
            allowFontScaling={false}
          >
            {lead}{accent ? <Text style={s.h1Accent}>{accent}</Text> : null}
          </Text>
        ) : (
          <Text style={s.h1} accessibilityRole="header" maxFontSizeMultiplier={MAX_SCALE}>
            {accent ? lead.trimEnd() + "\n" : lead}{accent ? <Text style={s.h1Accent}>{accent}</Text> : null}
          </Text>
        )}

        {/* ── Everything Pro adds, before any price ─────────────────────── */}
        <View
          style={[s.features, compact && s.featuresCompact]}
          accessibilityRole="summary"
          accessibilityLabel={
            "FlipStart Pro includes: " +
            [...ONBOARDING_PRO_FEATURES, ONBOARDING_DEEP_ANALYSIS].map(f => `${f.title}, ${f.detail}`).join(". ")
          }
        >
          {[0, 2].map(i => (
            <View key={i} style={s.gridRow} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              {ONBOARDING_PRO_FEATURES.slice(i, i + 2).map(f => (
                <View key={f.key} style={s.cell}>
                  <MaterialIcons name="check-circle" size={17} color={OB.gold} style={s.tick} />
                  <View style={s.cellText}>
                    <Text style={s.fTitle} numberOfLines={1} maxFontSizeMultiplier={MAX_SCALE}>{f.title}</Text>
                    <Text style={s.fDetail} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85} maxFontSizeMultiplier={MAX_SCALE}>
                      {f.detail}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          ))}

          {/* The tick sits with the title so the sentence gets the full width. */}
          <View style={[s.deep, compact && s.deepCompact]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <View style={s.deepHead}>
              <MaterialIcons name="check-circle" size={17} color={OB.gold} />
              <Text style={s.fTitle} maxFontSizeMultiplier={MAX_SCALE}>{ONBOARDING_DEEP_ANALYSIS.title}</Text>
            </View>
            <Text style={s.deepDetail} maxFontSizeMultiplier={MAX_SCALE}>{ONBOARDING_DEEP_ANALYSIS.detail}</Text>
          </View>
        </View>

        {/* ── Plans. Annual first and selected by default, always. ───────── */}
        <View style={[s.plans, compact && s.plansCompact]} accessibilityRole="radiogroup" accessibilityLabel="Choose your plan">
          <PlanRow
            name="Annual"
            badge={percent === null ? "Best value" : `Save ${percent}%`}
            detail={perMonth ? `${annualScans} · ${perMonth}/mo` : annualScans}
            price={p.annual.pricing.priceString}
            period="per year"
            selected={p.selected === "annual"}
            unavailable={settled && !p.annual.available}
            loading={loading}
            locked={p.busy || failed}
            compact={tight}
            roomy={roomy && !tight}
            onSelect={() => p.onSelect("annual")}
          />
          <PlanRow
            name="Monthly"
            detail={`${MONTHLY_SCANS.toLocaleString("en-US")} scans a month`}
            price={p.monthly.pricing.priceString}
            period="per month"
            selected={p.selected === "monthly"}
            unavailable={settled && !p.monthly.available}
            loading={loading}
            locked={p.busy || failed}
            compact={tight}
            roomy={roomy && !tight}
            onSelect={() => p.onSelect("monthly")}
          />
        </View>

        {/* Store unreachable: stable layout, one short retry. Free still works. */}
        {failed && (
          <View style={s.retryRow}>
            <Text style={s.retryText} maxFontSizeMultiplier={MAX_SCALE}>
              {p.productsMessage ?? "We couldn't load the plans."}
            </Text>
            <Pressable
              onPress={p.onReloadProducts}
              accessibilityRole="button"
              accessibilityLabel="Try loading plans again"
              hitSlop={12}
              style={({ pressed }) => pressed && { opacity: 0.6 }}
            >
              <Text style={s.retryAction} maxFontSizeMultiplier={MAX_SCALE}>Try again</Text>
            </Pressable>
          </View>
        )}

        {p.notice && (
          <View
            style={[s.notice, p.notice.tone === "error" ? s.noticeError : s.noticeInfo]}
            accessibilityLiveRegion="polite"
          >
            <MaterialIcons
              name={p.notice.tone === "error" ? "error-outline" : "info-outline"}
              size={15}
              color={p.notice.tone === "error" ? BAD : OB.goldText}
            />
            <Text style={[s.noticeText, p.notice.tone === "error" && { color: BAD }]} maxFontSizeMultiplier={MAX_SCALE}>
              {p.notice.text}
            </Text>
          </View>
        )}

        {/* ── The two decisions ──────────────────────────────────────────── */}
        <View style={[s.actions, compact && s.actionsCompact]}>
          <PaywallPurchaseButton
            label={p.ctaLabel}
            onPress={p.onPurchase}
            busy={p.purchaseBusy}
            disabled={!p.purchaseEnabled}
            blockedLabel={p.blockedLabel}
          />

          {p.activating && (
            <Text style={s.activating} accessibilityLiveRegion="polite" maxFontSizeMultiplier={MAX_SCALE}>
              Activating Pro…
            </Text>
          )}

          {!!p.config.freeContinueLabel && (
            <PaywallFreeButton
              label={p.config.freeContinueLabel}
              onPress={p.onContinueFree}
              busy={p.busy}
              minHeight={compact ? 50 : 54}
            />
          )}

          {!!p.config.secondaryValueLine && (
            <Text style={s.freeNote} maxFontSizeMultiplier={MAX_SCALE}>{p.config.secondaryValueLine}</Text>
          )}
        </View>

        {/* On a tall phone the fine print settles at the bottom edge. */}
        <View style={s.spring} />

        {/* ── Fine print: restore, renewal terms, the two links ──────────── */}
        <View style={[s.fine, compact && s.fineCompact]}>
          <View style={s.fineRow}>
            <Pressable
              onPress={p.restoreDisabled || p.restoreBusy ? undefined : p.onRestore}
              disabled={p.restoreDisabled || p.restoreBusy}
              accessibilityRole="button"
              accessibilityLabel="Restore purchases"
              accessibilityState={{ disabled: p.restoreDisabled || p.restoreBusy, busy: p.restoreBusy }}
              hitSlop={14}
              style={({ pressed }) => [
                (p.restoreDisabled || p.restoreBusy) && { opacity: 0.45 },
                pressed && { opacity: 0.6 },
              ]}
            >
              <Text style={s.restore} maxFontSizeMultiplier={MAX_SCALE}>
                {p.restoreBusy ? "Restoring…" : "Restore Purchases"}
              </Text>
            </Pressable>
            <Text style={s.fineDot}>{"·"}</Text>
            <Text style={s.trust} maxFontSizeMultiplier={MAX_SCALE}>Cancel anytime</Text>
          </View>

          <Text style={s.legal} maxFontSizeMultiplier={MAX_SCALE}>{p.disclosure}</Text>

          <View style={s.fineRow}>
            <Pressable onPress={() => open(PRIVACY_URL)} accessibilityRole="link" hitSlop={12}>
              <Text style={s.link} maxFontSizeMultiplier={MAX_SCALE}>Privacy Policy</Text>
            </Pressable>
            <Text style={s.fineDot}>{"·"}</Text>
            <Pressable onPress={() => open(TERMS_URL)} accessibilityRole="link" hitSlop={12}>
              <Text style={s.link} maxFontSizeMultiplier={MAX_SCALE}>Terms of Service</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

// ── Pieces ──────────────────────────────────────────────────────────────────

/** Never throws. A dead link must not take the paywall down with it. */
function open(url: string) {
  Linking.openURL(url).catch(() => {});
}

/** "Get more from every thrift trip." → ["Get more from every ", "thrift trip."] */
export function splitHeadline(headline: string): [string, string] {
  const i = headline.lastIndexOf(HEADLINE_ACCENT);
  if (i < 0) return [headline, ""];
  return [headline.slice(0, i), headline.slice(i)];
}

/**
 * One plan as a single row: marker, name, what it includes, price.
 *
 * Selection is never colour alone: the marker fills with a check, the border
 * thickens and the row tints. Unavailable is said in words and cannot be
 * chosen. Locked while a purchase is in flight so the target cannot move.
 */
function PlanRow({
  name, badge, detail, price, period, selected, unavailable, loading, locked, compact, roomy, onSelect,
}: {
  name: string;
  badge?: string;
  detail: string;
  /** The store's own localized string, or null while it loads. */
  price: string | null;
  period: string;
  selected: boolean;
  unavailable: boolean;
  /** The store has not answered yet: the price is a skeleton, not a guess. */
  loading: boolean;
  locked: boolean;
  compact: boolean;
  roomy: boolean;
  onSelect: () => void;
}) {
  const inert = locked || unavailable;
  const a11y = [
    `${name} Pro`,
    price ? `${price} ${period}` : loading ? "price loading" : "",
    detail,
    badge ?? "",
    unavailable ? "currently unavailable" : "",
  ].filter(Boolean).join(", ");

  return (
    <Pressable
      onPress={onSelect}
      disabled={inert}
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled: inert }}
      accessibilityLabel={a11y}
      style={({ pressed }) => [
        r.row, compact && r.rowCompact, roomy && r.rowRoomy,
        selected && r.rowOn,
        unavailable && r.rowOff,
        pressed && !inert && { opacity: 0.9 },
      ]}
    >
      {selected ? (
        <View style={r.markOn}><MaterialIcons name="check" size={15} color="#FFFFFF" /></View>
      ) : (
        <View style={r.mark} />
      )}

      <View style={r.mid}>
        <View style={r.nameRow}>
          <Text style={r.name} allowFontScaling={false}>{name}</Text>
          {!!badge && !unavailable && (
            <View style={r.badge}><Text style={r.badgeText} allowFontScaling={false}>{badge}</Text></View>
          )}
        </View>
        <Text style={r.detail} numberOfLines={1} allowFontScaling={false}>
          {unavailable ? "Not available right now" : detail}
        </Text>
      </View>

      <View style={r.priceCol}>
        {price ? (
          <>
            <Text style={r.price} allowFontScaling={false}>{price}</Text>
            <Text style={r.period} allowFontScaling={false}>{period}</Text>
          </>
        ) : loading ? (
          <Skeleton width={62} height={22} radius={6} />
        ) : null}
      </View>
    </Pressable>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

/** Fine print: a neutral dark grey. Never the old brown. */
const FINE = "#5C5850";

const s = StyleSheet.create({
  page: { flexGrow: 1, backgroundColor: OB.background },

  body: {
    flexGrow: 1,
    width: "100%", maxWidth: 460, alignSelf: "center",
    paddingHorizontal: OB_SPACE.gutter,
    paddingTop: 18,
    gap: 15,
  },
  bodyCompact: { paddingTop: 8, gap: 8 },
  bodyRoomy: { paddingTop: 30, gap: 24 },

  h1: {
    fontFamily: FONTS.serif, fontSize: 26, lineHeight: 31, fontWeight: "800",
    color: OB.ink, textAlign: "center",
  },
  h1Accent: { color: OB.forest },

  // Features
  features: { gap: 10 },
  featuresCompact: { gap: 7 },
  /** Two columns, two rows. */
  gridRow: { flexDirection: "row", gap: 10 },
  cell: { flex: 1, flexDirection: "row", alignItems: "flex-start", gap: 7 },
  tick: { marginTop: 1 },
  cellText: { flex: 1 },
  fTitle: { fontSize: 14, lineHeight: 18, fontWeight: "800", color: OB.ink },
  fDetail: { fontSize: 12.5, lineHeight: 16, color: OB.ink },
  /** Full width, lightly set apart: the one feature that earns a sentence. */
  deep: {
    gap: 3,
    backgroundColor: OB.goldTint,
    borderRadius: 12, borderWidth: 1, borderColor: "rgba(196,163,52,0.55)",
    paddingVertical: 9, paddingHorizontal: 12,
  },
  deepCompact: { paddingVertical: 7, gap: 2 },
  deepHead: { flexDirection: "row", alignItems: "center", gap: 7 },
  deepDetail: { fontSize: 12.5, lineHeight: 17, color: OB.ink },

  // Plans
  plans: { gap: 8 },
  plansCompact: { gap: 7 },

  retryRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingHorizontal: 2 },
  retryText: { flex: 1, fontSize: 12.5, lineHeight: 17, color: OB.ink },
  retryAction: { fontFamily: FONTS.serif, fontSize: 13.5, fontWeight: "800", color: OB.forest, textDecorationLine: "underline" },

  notice: {
    flexDirection: "row", alignItems: "flex-start", gap: 8,
    borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8,
  },
  noticeInfo: { backgroundColor: OB.goldTint, borderColor: "rgba(196,163,52,0.45)" },
  noticeError: { backgroundColor: "#FDF1EF", borderColor: "#F0C4BE" },
  noticeText: { flex: 1, fontSize: 12.5, lineHeight: 17, color: OB.ink, fontWeight: "600" },

  // Actions
  actions: { gap: 10 },
  actionsCompact: { gap: 8 },
  activating: { fontSize: 12.5, color: OB.ink, textAlign: "center", fontWeight: "600", marginVertical: -2 },
  freeNote: { fontSize: 12.5, lineHeight: 16, color: OB.ink, textAlign: "center", marginTop: -2 },

  spring: { flexGrow: 1, minHeight: 0 },

  // Fine print
  fine: { alignItems: "center", gap: 7, paddingBottom: 2 },
  fineCompact: { gap: 5 },
  fineRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  fineDot: { fontSize: 12, color: FINE },
  restore: { fontSize: 12.5, fontWeight: "700", color: OB.ink, textDecorationLine: "underline" },
  trust: { fontSize: 12.5, color: FINE, fontWeight: "600" },
  legal: { fontSize: 10.5, lineHeight: 14.5, color: FINE, textAlign: "center" },
  link: { fontSize: 11, color: FINE, fontWeight: "700", textDecorationLine: "underline" },
});

const r = StyleSheet.create({
  row: {
    flexDirection: "row", alignItems: "center", gap: 12,
    minHeight: 66,
    backgroundColor: OB.card,
    borderRadius: OB_SPACE.radius, borderWidth: 1.5, borderColor: OB.border,
    paddingVertical: 9, paddingHorizontal: 14,
  },
  rowCompact: { minHeight: 54, paddingVertical: 5 },
  rowRoomy: { minHeight: 72 },
  /** 2pt border, so the padding gives back the half point each side. */
  rowOn: { borderWidth: 2, borderColor: OB.forest, backgroundColor: OB.greenTint, paddingHorizontal: 13.5 },
  rowOff: { opacity: 0.55 },

  mark: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: OB.goldText },
  markOn: { width: 24, height: 24, borderRadius: 12, backgroundColor: OB.forest, alignItems: "center", justifyContent: "center" },

  mid: { flex: 1, minWidth: 0, gap: 2 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { fontFamily: FONTS.serif, fontSize: 17, lineHeight: 21, fontWeight: "800", color: OB.ink },
  badge: { backgroundColor: OB.forest, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  badgeText: { fontSize: 10.5, lineHeight: 13, fontWeight: "800", letterSpacing: 0.3, color: OB.cream },
  /** Fixed size, no shrink-to-fit: iOS can collapse an auto-fitted line to its minimum inside a flex row. */
  detail: { fontSize: 13, lineHeight: 17, color: OB.ink },

  priceCol: { alignItems: "flex-end", minWidth: 62 },
  price: { fontFamily: FONTS.serif, fontSize: 19, lineHeight: 23, fontWeight: "800", color: OB.ink },
  period: { fontSize: 11.5, lineHeight: 14, color: OB.ink },
});
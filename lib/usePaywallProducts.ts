/**
 * lib/usePaywallProducts.ts
 *
 * Loads the two subscription plans for display, with retry.
 *
 * ── Display only ────────────────────────────────────────────────────────────
 * Nothing here authorises anything and nothing here is cached for purchase.
 * `purchase()` resolves its own package from a fresh getOfferings() at the
 * moment of the tap, so what this hook holds can never be what gets charged.
 * Its entire job is to answer "what does this cost, in this user's currency".
 *
 * ── Why prices are never faked ──────────────────────────────────────────────
 * There is no default price anywhere in this file. If RevenueCat has not
 * answered, `pricing.priceString` is null and the card renders a skeleton. A
 * placeholder "$7.99" would be a real price on screen — correct for one
 * storefront and wrong for every other, and indistinguishable from a loaded
 * one.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  loadSubscriptionProducts,
  type SubscriptionProductsResult,
  type SubscriptionProductView,
} from "@/lib/purchases";
import { readProductPricing, NO_PRICING, type ProductPricing } from "@/lib/paywallPricing";
import type { ProductsStatus } from "@/lib/paywallMachine";

export interface PaywallPlanProduct {
  available: boolean;
  productId: string | null;
  pricing: ProductPricing;
}

export interface PaywallProducts {
  status: ProductsStatus;
  monthly: PaywallPlanProduct;
  annual: PaywallPlanProduct;
  /** Safe to show. Never a raw SDK string. */
  message: string | null;
  reload: () => void;
}

const MISSING: PaywallPlanProduct = { available: false, productId: null, pricing: NO_PRICING };

function toPlan(view: SubscriptionProductView | null): PaywallPlanProduct {
  if (!view) return MISSING;
  return {
    available: true,
    productId: view.productId,
    pricing: readProductPricing(view.pkg),
  };
}

export function usePaywallProducts(enabled: boolean): PaywallProducts {
  const [result, setResult] = useState<SubscriptionProductsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);

  /**
   * Guards a setState after unmount, and — more importantly — discards the
   * result of a superseded load. Tapping Retry twice quickly would otherwise
   * let the first, older response land last and overwrite the newer one.
   */
  const runId = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const id = ++runId.current;
    setLoading(true);

    void (async () => {
      let r: SubscriptionProductsResult;
      try {
        r = await loadSubscriptionProducts();
      } catch {
        // loadSubscriptionProducts already swallows its own failures; this is
        // belt and braces so a paywall can never be taken down by the store.
        r = {
          status: "error",
          monthly: null,
          annual: null,
          message: "Could not load subscription options.",
        };
      }
      if (!mounted.current || id !== runId.current) return;
      setResult(r);
      setLoading(false);
    })();
  }, [enabled, attempt]);

  const reload = useCallback(() => setAttempt(n => n + 1), []);

  /**
   * Loading wins over a previous result.
   *
   * On retry the old failure must not stay on screen looking like a live
   * answer — the user tapped Retry and should see it doing something.
   */
  const status: ProductsStatus = !enabled || loading || !result ? "loading" : result.status;

  return {
    status,
    monthly: toPlan(result?.monthly ?? null),
    annual: toPlan(result?.annual ?? null),
    message: result?.message ?? null,
    reload,
  };
}
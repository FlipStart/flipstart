/**
 * lib/purchaseErrors.ts
 *
 * One place that turns a RevenueCat/StoreKit purchase failure into something a
 * person should read.
 *
 * ── Why codes are matched as STRINGS, not imported enums ────────────────────
 * `react-native-purchases` exports PURCHASES_ERROR_CODE, and importing it would
 * be the tidy thing to do. It would also make this module fail to load if the
 * SDK is absent — which is exactly the Expo Go case FlipStart has to survive.
 *
 * More importantly: I could not inspect the installed SDK's typings (the package
 * is not installed in this environment), so importing specific enum members
 * would be guessing at names. Matching the documented string codes defensively
 * means an unfamiliar or renamed code falls through to `unknown` with a safe
 * message rather than crashing or leaking.
 *
 * `userCancelled` is checked first and separately because it is the most stable
 * part of the purchase API and the one outcome that must never look like an
 * error.
 */

export type PurchaseErrorKind =
  | "cancelled"
  | "pending"
  | "network"
  | "store_unavailable"
  | "purchase_not_allowed"
  | "product_unavailable"
  | "already_purchased"
  /**
   * The store receipt is bound to a DIFFERENT FlipStart account.
   *
   * Its own kind, deliberately not folded into `already_purchased`. Under the
   * "Transfer if there are no active subscriptions" restore behavior, RevenueCat
   * returns RECEIPT_ALREADY_IN_USE when someone tries to restore or buy while
   * another App User ID holds an ACTIVE subscription on the same Apple Account.
   *
   * That is the setting working correctly — it is what stops User B taking User
   * A's subscription — but it needs its own message. The `already_purchased`
   * copy said "Try Restore Purchases", which sends the user straight back to the
   * button that just failed.
   */
  | "owned_by_another_account"
  | "configuration"
  | "unknown";

export interface SanitizedPurchaseError {
  kind: PurchaseErrorKind;
  /** Safe to render. No StoreKit internals, no receipts, no tokens. */
  userMessage: string;
  /** True when retrying could plausibly help. */
  retryable: boolean;
  /** True when this is a normal outcome, not a failure worth alarming anyone. */
  benign: boolean;
}

const MESSAGES: Record<PurchaseErrorKind, { msg: string; retry: boolean; benign: boolean }> = {
  // Dismissing the sheet is a decision, not a fault.
  cancelled:            { msg: "Purchase cancelled.", retry: true, benign: true },
  // Deferred/pending (e.g. Ask to Buy). Pro must NOT be granted yet.
  pending:              { msg: "Your purchase is pending approval. We'll unlock Pro as soon as it completes.", retry: false, benign: true },
  network:              { msg: "We couldn't reach the store. Check your connection and try again.", retry: true, benign: false },
  store_unavailable:    { msg: "The App Store is unavailable right now. Please try again shortly.", retry: true, benign: false },
  purchase_not_allowed: { msg: "Purchases aren't allowed on this device. Check Screen Time or restrictions.", retry: false, benign: false },
  product_unavailable:  { msg: "This plan isn't available right now. Please try again later.", retry: true, benign: false },
  already_purchased:    { msg: "You already have an active subscription. Try Restore Purchases.", retry: false, benign: true },
  // Names the actual problem and the actual fix. Deliberately does NOT suggest
  // Restore — restore is what just failed.
  owned_by_another_account: {
    msg: "This subscription is already active on another FlipStart account. Sign in to that account to use it.",
    retry: false, benign: true,
  },
  configuration:        { msg: "Subscriptions aren't set up correctly. Please try again later.", retry: false, benign: false },
  unknown:              { msg: "Something went wrong with the purchase. Please try again.", retry: true, benign: false },
};

/**
 * Documented RevenueCat error codes, matched as strings.
 *
 * Both the SCREAMING_SNAKE constant names and the human-readable code strings
 * are covered, because different SDK versions surface different shapes and I
 * could not verify which one this project resolves to.
 */
function classifyCode(code: string): PurchaseErrorKind | null {
  const c = code.toUpperCase().replace(/\s+/g, "_");
  if (/PURCHASE_CANCELLED|USER_CANCELLED/.test(c))       return "cancelled";
  if (/PAYMENT_PENDING/.test(c))                          return "pending";
  if (/NETWORK/.test(c))                                  return "network";
  if (/STORE_PROBLEM|OFFLINE_CONNECTION/.test(c))         return "store_unavailable";
  if (/PURCHASE_NOT_ALLOWED|PURCHASE_INVALID/.test(c))    return "purchase_not_allowed";
  if (/PRODUCT_NOT_AVAILABLE|PRODUCT_NOT_FOR_SALE/.test(c)) return "product_unavailable";
  // BEFORE the generic already-purchased match: RECEIPT_ALREADY_IN_USE also
  // contains "ALREADY", and ordering is what keeps the two distinct.
  if (/RECEIPT_ALREADY_IN_USE/.test(c))                   return "owned_by_another_account";
  if (/PRODUCT_ALREADY_PURCHASED/.test(c))                return "already_purchased";
  if (/CONFIGURATION|INVALID_CREDENTIALS|INVALID_APP_USER_ID|UNSUPPORTED/.test(c)) return "configuration";
  return null;
}

/** Strip anything token- or receipt-shaped before a message reaches a log. */
function redact(raw: string): string {
  return raw
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "[jwt]")
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[redacted]")
    .slice(0, 300);
}

/**
 * The only function purchase code should call.
 *
 * Accepts anything, because errors arrive from the native bridge in several
 * shapes and no call site should have to narrow a type before showing copy.
 */
export function sanitizePurchaseError(err: unknown): SanitizedPurchaseError {
  const e = (err ?? {}) as {
    userCancelled?: boolean;
    code?: unknown;
    message?: unknown;
    underlyingErrorMessage?: unknown;
    info?: { readableErrorCode?: unknown };
  };

  // FIRST and separately. The most stable signal in the API, and the one
  // outcome that must never be presented as a failure.
  if (e.userCancelled === true) {
    return { kind: "cancelled", ...pick("cancelled") };
  }

  const codeStr = [
    typeof e.code === "string" ? e.code : "",
    typeof e.code === "number" ? `CODE_${e.code}` : "",
    typeof e.info?.readableErrorCode === "string" ? e.info.readableErrorCode : "",
  ].filter(Boolean).join(" ");

  const raw = [
    codeStr,
    typeof e.message === "string" ? e.message : "",
    typeof e.underlyingErrorMessage === "string" ? e.underlyingErrorMessage : "",
  ].filter(Boolean).join(" ");

  let kind = classifyCode(codeStr) ?? classifyCode(raw);

  // Message-shape fallbacks, only when no code matched.
  if (!kind) {
    const s = raw.toLowerCase();
    if (/cancel|dismiss/.test(s))                    kind = "cancelled";
    else if (/pending|deferred|ask to buy/.test(s))  kind = "pending";
    else if (/network|offline|timed? ?out/.test(s))  kind = "network";
    else if (/store|storekit|app store/.test(s))     kind = "store_unavailable";
    else if (/not allowed|restricted/.test(s))       kind = "purchase_not_allowed";
    else if (/unavailable|not found|no product/.test(s)) kind = "product_unavailable";
    // Receipt-specific wording first, for the same ordering reason.
    else if (/receipt.*(already|in use)|another (subscriber|user|account)/.test(s))
                                                     kind = "owned_by_another_account";
    else if (/already/.test(s))                      kind = "already_purchased";
    else                                              kind = "unknown";
  }

  if (__DEV__) console.warn(`[purchase] ${kind}: ${redact(raw)}`);
  else console.warn(`[purchase] ${kind}`);

  return { kind, ...pick(kind) };
}

function pick(kind: PurchaseErrorKind) {
  const m = MESSAGES[kind];
  return { userMessage: m.msg, retryable: m.retry, benign: m.benign };
}

/** Cancellation is a normal outcome. Callers usually show nothing at all. */
export function isPurchaseCancellation(err: unknown): boolean {
  return sanitizePurchaseError(err).kind === "cancelled";
}
/**
 * lib/paywallLayout.ts
 *
 * One responsive decision for the onboarding offer: does the normal, spacious
 * layout leave the Free button on the first frame, or must the column tighten?
 *
 * ── Why a height model, not a device name ───────────────────────────────────
 * The question is not "is this an iPhone SE" but "does the stack from the top
 * of the hero to the bottom of the Free button fit in what the screen has
 * left after the safe areas". Answering that directly means an iPhone 8 Plus
 * (735pt of content on a 736pt screen) is caught too, and a future short
 * phone is caught without anyone listing it.
 *
 * OFFER_STACK_NORMAL_PT is that stack at normal spacing — hero, plan
 * selector, purchase CTA, the gaps between them, and the Free button — summed
 * from the components' real style values. BREATHING is the minimum clearance
 * the Free button must keep below it.
 *
 * ── Why the threshold is deliberately tight ─────────────────────────────────
 * These numbers are ARITHMETIC. Nothing here has been rendered, so the stack
 * could be off by tens of points either way, and every device the threshold
 * catches pays for that uncertainty with a tighter layout it may not need.
 * So the bar is set to catch only phones that genuinely cannot fit:
 *
 *   SE / 8 / 7 (usable 629)      −65pt — cannot fit, compacts
 *   8 Plus / 7 Plus  (698)        +4pt — flush against the edge, compacts
 *   12–13 mini       (714)       +20pt — fits, stays normal
 *   X / XS / 11 Pro  (720)       +26pt — fits, stays normal
 *   12 / 13 / 14+    (745+)      +51pt — fits comfortably
 *
 * An earlier version compacted everything below 724pt, which swept in the
 * 812pt devices on the strength of an estimate. If a real device shows the
 * Free button too low on one of those, raise BREATHING — that single number
 * is the whole tuning surface.
 */

/**
 * Hero → plan cards → CTA → Free button, at the approved spacing. Summed from
 * the real style values: hero 241, column gap 20, plan selector 306, block
 * gaps 12 + 12, CTA 56, Free button 50.
 */
export const OFFER_STACK_NORMAL_PT = 694;
/** Minimum clearance the Free button keeps above the usable bottom edge. */
export const OFFER_BREATHING_PT = 12;
/** The modal's own inset above the hero when there is no close X. */
const OFFER_TOP_PAD_MIN = 24;
const OFFER_TOP_PAD_EXTRA = 14;

/**
 * True when the onboarding offer should use its compact vertical layout.
 *
 * `windowHeight` is the logical window height; the two insets are the safe
 * areas that the modal itself already honours.
 */
export function offerNeedsCompactHeight(windowHeight: number, topInset: number, bottomInset: number): boolean {
  const topPad = Math.max(topInset, OFFER_TOP_PAD_MIN) + OFFER_TOP_PAD_EXTRA;
  const usable = windowHeight - Math.max(bottomInset, 0) - topPad;
  return usable < OFFER_STACK_NORMAL_PT + OFFER_BREATHING_PT;
}
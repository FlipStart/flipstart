/**
 * components/onboarding/useOnboardingLayout.ts
 *
 * One responsive decision for onboarding: is this a short phone?
 *
 * Measured on the usable height (window minus safe areas), not a device name,
 * so an SE, an 8, or a large accessibility text size on a mid phone all get
 * the tighter spacing, and a future short phone is caught without a list.
 *
 *   SE / 8 / 7          667pt window → ~627 usable → compact
 *   12–16 mini/standard 812–852pt    → 718–793     → normal
 *   Plus / Pro Max      926–956pt    → 832–897     → normal
 *
 * Compact only tightens spacing and steps a few display sizes down. It never
 * hides a decision-making element.
 */
import { useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** Below this usable height, onboarding tightens. */
export const COMPACT_USABLE_PT = 700;

export function isCompactHeight(windowHeight: number, insetTop: number, insetBottom: number): boolean {
  return windowHeight - insetTop - insetBottom < COMPACT_USABLE_PT;
}

export function useOnboardingLayout() {
  const { height, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // Large text eats height like a short screen does.
  const compact = isCompactHeight(height, insets.top, insets.bottom) || fontScale > 1.25;
  return { compact, insets };
}
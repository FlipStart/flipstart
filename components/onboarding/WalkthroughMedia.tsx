/**
 * components/onboarding/WalkthroughMedia.tsx
 *
 * The real-product images for the two walkthrough screens (onboarding V2,
 * Phase 2). Dylan's own crops, shown exactly as supplied: no re-crop, no
 * frame, no rounded mask, no stretching.
 *
 * Each component fills the space the shell leaves between the supporting
 * line and Continue, measures it, and scales its images uniformly to fit —
 * so every image is fully visible on an SE and as large as the screen allows
 * on a Pro Max. Sizing lives in walkthroughLayout.ts and is tested there.
 *
 *   Analysis  — one image, centred.
 *   Progress  — Hunt on the left; Brand above Achievement on the right;
 *               a badge under each — the app's dark-green-and-gold language
 *               (BUY card, Start Pro button), with the app's own icon for each
 *               system: paw = Hunt Mode (its tab icon), gem = brands, trophy.
 */
import React, { useState } from "react";
import { Image, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import Animated, { FadeIn } from "react-native-reanimated";
import { OB } from "./onboardingTheme";
import { BADGE, BADGE_H, COLLAGE_GAP, WALKTHROUGH_ASPECT, badgeFontSize, fitAspect, layoutProgressCollage, type Box } from "./walkthroughLayout";

const IMG = {
  analysis: require("@/assets/images/onboarding/walkthrough-analysis.jpg"),
  hunt: require("@/assets/images/onboarding/walkthrough-hunt.png"),
  brand: require("@/assets/images/onboarding/walkthrough-brand.png"),
  achievement: require("@/assets/images/onboarding/walkthrough-achievement.png"),
};

/** Measures the space it is given; renders nothing until it knows. */
function useSpace() {
  const [space, setSpace] = useState<Box | null>(null);
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (!space || Math.abs(space.width - width) > 0.5 || Math.abs(space.height - height) > 0.5) {
      setSpace({ width, height });
    }
  };
  return { space, onLayout };
}

export function WalkthroughAnalysisMedia() {
  const { space, onLayout } = useSpace();
  const box = space ? fitAspect(space.width, space.height, WALKTHROUGH_ASPECT.analysis) : null;

  return (
    <View style={s.fill} onLayout={onLayout}>
      {box && box.width > 0 && (
        <Animated.View entering={FadeIn.duration(260)} style={s.center}>
          <View style={s.above} />
          <Image
            source={IMG.analysis}
            resizeMode="contain"
            style={{ width: box.width, height: box.height }}
            accessible
            accessibilityRole="image"
            accessibilityLabel="A real FlipStart result: Logo Athletic New England Patriots puffer jacket, high confidence, likely vintage. Buy, worth grabbing at $34 or less. Estimated resale $48, estimated profit $28, ROI 200 percent, market range $30 to $65."
          />
          <View style={s.below} />
        </Animated.View>
      )}
    </View>
  );
}

export function WalkthroughProgressMedia() {
  const { space, onLayout } = useSpace();
  const L = space ? layoutProgressCollage(space.width, space.height) : null;

  return (
    <View style={s.fill} onLayout={onLayout}>
      {L && L.width > 0 && (
        <Animated.View entering={FadeIn.duration(260)} style={s.center}>
          <View style={s.above} />
          <View style={[s.collage, { width: L.width }]}>
            <View style={{ width: L.left.width }}>
              <Image source={IMG.hunt} resizeMode="contain" style={[L.left, s.shadow]}
                accessible accessibilityRole="image"
                accessibilityLabel="Hunt complete: Great Hunt. 3 items scanned, 3 kept, $79 estimated profit, top finds listed. You earned 141 XP, rank Meerkat Menace, level up." />
              <Badge icon="pets" text="HUNT XP" width={L.left.width} />
            </View>
            <View style={{ width: L.rightWidth }}>
              <Image source={IMG.brand} resizeMode="contain" style={[L.brand, s.shadow]}
                accessible accessibilityRole="image"
                accessibilityLabel="Rare brand discovered: Arc'teryx, Outdoor. Added to Brand Compendium, unlocked by 3.2 percent of users." />
              <Badge icon="diamond" text="BRANDS" width={L.rightWidth} />
              <Image source={IMG.achievement} resizeMode="contain" style={[L.achievement, s.shadow, { marginTop: COLLAGE_GAP }]}
                accessible accessibilityRole="image"
                accessibilityLabel="Achievement unlocked: Part-Time Job, $5,000 profit." />
              <Badge icon="emoji-events" text="ACHIEVEMENTS" width={L.rightWidth} />
            </View>
          </View>
          <View style={s.below} />
        </Animated.View>
      )}
    </View>
  );
}

type IconName = React.ComponentProps<typeof MaterialIcons>["name"];

/**
 * The label under each image: a forest pill with a gold edge, a gold icon and
 * cream tracked caps — the same materials as the result screen's BUY card and
 * the Pro button, so it reads as part of FlipStart rather than text on top.
 * Sized to its column so it never truncates.
 */
function Badge({ icon, text, width }: { icon: IconName; text: string; width: number }) {
  const size = badgeFontSize(width, text);
  return (
    <View style={s.badgeRow} importantForAccessibility="no-hide-descendants">
      <View style={s.badge}>
        <MaterialIcons name={icon} size={BADGE.icon} color={OB.gold} />
        <Text style={[s.badgeText, { fontSize: size }]} numberOfLines={1} allowFontScaling={false}>{text}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1, minHeight: 120 },
  center: { flex: 1, alignItems: "center" },
  /** Spare height splits 1 : 2, so the image sits under its headline, not adrift mid-screen. */
  above: { flex: 1, maxHeight: 40 },
  below: { flex: 2 },
  collage: { flexDirection: "row", gap: COLLAGE_GAP, alignItems: "flex-start" },
  /** Follows each image's own rounded edges on iOS (no background set). */
  shadow: { shadowColor: "#1F1B16", shadowOpacity: 0.16, shadowRadius: 9, shadowOffset: { width: 0, height: 6 } },
  badgeRow: { marginTop: 8, height: BADGE_H, alignItems: "center" },
  badge: {
    height: BADGE_H, borderRadius: BADGE_H / 2, paddingHorizontal: BADGE.pad,
    flexDirection: "row", alignItems: "center", gap: BADGE.gap,
    backgroundColor: OB.forest, borderWidth: 1, borderColor: OB.gold,
  },
  badgeText: { fontWeight: "800", letterSpacing: BADGE.tracking, color: OB.cream },
});
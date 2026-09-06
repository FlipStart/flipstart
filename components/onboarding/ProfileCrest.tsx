/**
 * components/onboarding/ProfileCrest.tsx
 *
 * The FlipStart profile crest — the one mark shared by the building screen and
 * the finished result, so the second reads as the first completed.
 *
 * A ring, four gold sparks at the compass points, and a centre that fills
 * forest once the profile is complete. Drawn in SVG: no asset, no image.
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { PW } from "@/components/monetization/paywall/paywallTheme";

export function ProfileCrest({ size = 46, lit = false }: { size?: number; lit?: boolean }) {
  const r = size / 2;
  const spark = (cx: number, cy: number, s: number) =>
    `M${cx} ${cy - s} L${cx + s * 0.28} ${cy - s * 0.28} L${cx + s} ${cy} L${cx + s * 0.28} ${cy + s * 0.28} ` +
    `L${cx} ${cy + s} L${cx - s * 0.28} ${cy + s * 0.28} L${cx - s} ${cy} L${cx - s * 0.28} ${cy - s * 0.28} Z`;
  const t = size * 0.09;

  return (
    <View style={s.wrap}>
      <Svg width={size} height={size}>
        <Circle cx={r} cy={r} r={r - t - 1} fill={lit ? PW.forest : "transparent"}
          stroke={lit ? PW.forest : PW.border} strokeWidth={1.5} />
        <Circle cx={r} cy={r} r={r - t - 4.5} fill="none"
          stroke={lit ? "rgba(196,163,52,0.85)" : "rgba(196,163,52,0.35)"} strokeWidth={1} />
        {[[r, t], [size - t, r], [r, size - t], [t, r]].map(([cx, cy], i) => (
          <Path key={i} d={spark(cx, cy, t)} fill={lit ? PW.gold : "rgba(196,163,52,0.45)"} />
        ))}
      </Svg>
    </View>
  );
}

const s = StyleSheet.create({ wrap: { alignItems: "center", justifyContent: "center" } });
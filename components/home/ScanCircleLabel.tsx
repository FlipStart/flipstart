/**
 * components/home/ScanCircleLabel.tsx
 *
 * Curved label wrapping the OUTSIDE of the scan circle.
 *
 * ── Why SVG ─────────────────────────────────────────────────────────────────
 * React Native cannot curve text. Rotating individual <Text> views into an arc
 * is possible but fragile — kerning drifts and every glyph needs its own
 * transform origin recomputed whenever the size changes. `<TextPath>` follows a
 * path natively and handles spacing itself. react-native-svg is already a
 * project dependency.
 *
 * ── Why the sweep is wider than a semicircle ────────────────────────────────
 * "REMAINING SCANS" is fifteen characters. A 180° arc over a 46pt circle is
 * ~92pt long, and fifteen readable characters need ~104pt — so a semicircle
 * either clips the word or forces it down to an illegible size.
 *
 * A 220° sweep lets the text wrap slightly down both shoulders, which is where
 * a curved label naturally sits anyway, and buys ~18pt of arc at no cost to
 * legibility.
 *
 * ── Layout note ─────────────────────────────────────────────────────────────
 * The canvas is larger than the circle and positioned with a negative offset,
 * so the circle stays where layout puts it and the label overhangs. The parent
 * must NOT set overflow:'hidden', and needs a margin of at least
 * scanLabelOverhang(size) to keep the text off the screen edge.
 */
import React from 'react';
import Svg, { Defs, Path, Text as SvgText, TextPath } from 'react-native-svg';

/**
 * Deep forest green, sampled to match the circle this label wraps.
 *
 * Gold read as a third competing accent beside the gold "ANALYSIS" subtitle and
 * the gold bolt. Matching the circle instead makes the label read as part of the
 * same object rather than decoration floating near it — and dark green on the
 * near-white background gives far more contrast at 6.5pt than gold managed.
 */
const LABEL_COLOR = '#122E1B';

/** Degrees of arc the text sweeps. Centred on the top. */
const SWEEP_DEG = 220;

export interface ScanCircleLabelProps {
  size: number;
  text?: string;
  color?: string;
}

function geometry(size: number) {
  const font = size * 0.141;              // 6.5 at 46pt
  const arcR = size / 2 + 2.5 + font / 2; // outside the rim, small gap
  const canvas = (arcR + font / 2 + 1) * 2;
  return { font, arcR, canvas };
}

/** How far the label extends beyond the circle, per side. */
export function scanLabelOverhang(size: number): number {
  const { arcR, font, canvas } = geometry(size);
  return Math.ceil((canvas - size) / 2);
}

export function ScanCircleLabel({
  size, text = 'REMAINING SCANS', color = LABEL_COLOR,
}: ScanCircleLabelProps) {
  const { font, arcR, canvas } = geometry(size);
  const c = canvas / 2;

  /**
   * Arc centred on the top, sweeping SWEEP_DEG degrees.
   *
   * In SVG's y-down space "up" is 270°, so the arc runs from 270 - half to
   * 270 + half. large-arc-flag is 1 whenever the sweep exceeds 180°, and
   * sweep-flag 1 means increasing angle, which travels over the top.
   */
  const half = SWEEP_DEG / 2;
  const a0 = ((270 - half) * Math.PI) / 180;
  const a1 = ((270 + half) * Math.PI) / 180;
  const x0 = c + arcR * Math.cos(a0), y0 = c + arcR * Math.sin(a0);
  const x1 = c + arcR * Math.cos(a1), y1 = c + arcR * Math.sin(a1);
  const largeArc = SWEEP_DEG > 180 ? 1 : 0;

  const d = `M ${x0.toFixed(2)} ${y0.toFixed(2)} ` +
            `A ${arcR.toFixed(2)} ${arcR.toFixed(2)} 0 ${largeArc} 1 ` +
            `${x1.toFixed(2)} ${y1.toFixed(2)}`;

  return (
    <Svg
      width={canvas}
      height={canvas}
      viewBox={`0 0 ${canvas} ${canvas}`}
      style={{ position: 'absolute', top: -(canvas - size) / 2, left: -(canvas - size) / 2 }}
      pointerEvents="none"
    >
      <Defs>
        <Path id="scanArc" d={d} />
      </Defs>
      <SvgText
        fill={color}
        fontSize={font}
        fontWeight="800"
        // Modest tracking: enough to stop the letters crowding on the curve,
        // not so much that fifteen characters overrun the arc.
        letterSpacing={font * 0.1}
        textAnchor="middle"
      >
        {/* 50% centres the phrase at the apex regardless of its length. */}
        <TextPath href="#scanArc" startOffset="50%">
          {text}
        </TextPath>
      </SvgText>
    </Svg>
  );
}
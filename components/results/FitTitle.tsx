/**
 * components/results/FitTitle.tsx
 *
 * The results card's item title. Starts at the size pickTitleSize() estimated,
 * then corrects itself from the REAL layout: if iOS lays it out in more than
 * three lines, it steps down one size and re-measures, down to the 17pt floor.
 *
 * Never truncated. No numberOfLines, no ellipsis: at the floor a very long
 * name simply takes a fourth line. ("Eddie Bauer Hooded Waterproof Jack..."
 * is exactly what this exists to prevent.)
 *
 * Its own component so the measuring state lives in hooks that always run,
 * independent of the results screen's early returns.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';
import { nextTitleStepDown, titleLineHeight, TITLE_MAX_LINES } from '@/lib/resultsTitleSize';

export function FitTitle({
  startSize, style, children,
}: {
  startSize: number;
  style: StyleProp<TextStyle>;
  /** Rendered inside the title Text; receives the current size (for the "›"). */
  children: (size: number) => ReactNode;
}) {
  const [size, setSize] = useState(startSize);
  useEffect(() => { setSize(startSize); }, [startSize]);
  const onTextLayout = useCallback((e: { nativeEvent: { lines?: unknown[] } }) => {
    if ((e.nativeEvent.lines?.length ?? 0) > TITLE_MAX_LINES) {
      setSize(cur => nextTitleStepDown(cur) ?? cur);
    }
  }, []);
  return (
    <Text
      style={[style, { fontSize: size, lineHeight: titleLineHeight(size) }]}
      allowFontScaling={false}
      onTextLayout={onTextLayout}
    >
      {children(size)}
    </Text>
  );
}
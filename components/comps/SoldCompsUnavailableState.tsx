/**
 * components/comps/SoldCompsUnavailableState.tsx
 *
 * The final state shown when no reliable comp cards exist.
 *
 * ── When this appears, and when it must not ───────────────────────────────────
 * Only when there are ZERO usable cards. One reliable match is not a failure —
 * it is a card plus a limited-data note, and replacing it with a sad face would
 * throw away real evidence the user can look at.
 *
 * ── Why the face is typographic ──────────────────────────────────────────────
 * `☹` (U+2639) renders as a glyph in the app's own font, so it inherits the
 * colour and weight and looks the same everywhere. A colour emoji would render
 * as a different picture on every OS version and fight the vintage palette.
 *
 * ── Why five variants share one component ────────────────────────────────────
 * The layout is identical; only the words and whether counts are truthful
 * differ. Five near-duplicate components would drift apart the first time
 * someone adjusted spacing.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { C } from './tokens';

export type UnavailableVariant =
  | 'no_reliable_matches'
  | 'insufficient_item_details'
  | 'temporarily_unavailable'
  | 'legacy_unavailable';

interface Copy {
  headline: string;
  body: string;
  suggestion?: string;
  /** Counts are only ever shown where a real search happened. */
  allowCounts: boolean;
}

/**
 * Allowlisted copy. The UI never renders a server-supplied string, so a provider
 * error message, an HTTP status or a stack trace cannot reach the screen even if
 * one were somehow present in the payload.
 */
const COPY: Record<UnavailableVariant, Copy> = {
  no_reliable_matches: {
    headline: 'No reliable sold comps',
    body: 'FlipStart reviewed recent sales, but none matched this item closely enough. Your AI estimate is still ready.',
    suggestion: 'A clearer tag, logo, model, or full-item photo may improve matching.',
    allowCounts: true,
  },
  insufficient_item_details: {
    headline: 'Not enough identifying details',
    body: 'FlipStart could not build a confident sold-listing search from this scan. Your AI estimate is still ready.',
    suggestion: 'Try including a clear brand tag, model number, logo, graphic, or full-item photo.',
    // No provider call happened, so "100 reviewed" would be a lie.
    allowCounts: false,
  },
  temporarily_unavailable: {
    headline: 'Sold comps temporarily unavailable',
    body: 'Your FlipStart analysis and AI estimate are still available. Sold comps can be checked again later.',
    // Deliberately no suggestion: the item is not the problem, so telling
    // someone to take a better photo would be misleading.
    allowCounts: false,
  },
  legacy_unavailable: {
    headline: 'Sold comps unavailable for this scan',
    body: 'This older analysis does not contain the sold-listing data needed for the new Sold Comps view.',
    suggestion: 'Your original FlipStart estimate is unchanged.',
    allowCounts: false,
  },
};

export function SoldCompsUnavailableState({
  variant, reviewedCount, filteredOutCount,
}: {
  variant: UnavailableVariant;
  reviewedCount?: number | null;
  filteredOutCount?: number | null;
}) {
  const copy = COPY[variant] ?? COPY.temporarily_unavailable;

  // Shown only when the search genuinely ran and the numbers mean something.
  const countLine = copy.allowCounts && typeof reviewedCount === 'number' && reviewedCount > 0
    ? (typeof filteredOutCount === 'number' && filteredOutCount > 0
        ? `${reviewedCount} sales reviewed · ${filteredOutCount} filtered out`
        : `${reviewedCount} sales reviewed · no reliable matches`)
    : null;

  return (
    <View
      style={s.wrap}
      accessible
      accessibilityLabel={
        `${copy.headline}. ${countLine ? `${countLine}. ` : ''}${copy.body}`
      }
    >
      {/* Decorative: the headline already carries the meaning, so announcing
          "sad face" again would only add noise for a screen-reader user. */}
      <View style={s.badge} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Text style={s.face}>☹</Text>
      </View>

      <Text style={s.headline} accessibilityRole="header">{copy.headline}</Text>
      {!!countLine && <Text style={s.counts}>{countLine}</Text>}
      <Text style={s.body}>{copy.body}</Text>
      {!!copy.suggestion && <Text style={s.suggestion}>{copy.suggestion}</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { alignItems: 'center', paddingTop: 18, paddingBottom: 6, paddingHorizontal: 6, gap: 7 },
  badge: { width: 84, height: 84, borderRadius: 42, backgroundColor: C.cream,
           borderWidth: 2, borderColor: C.gold, alignItems: 'center', justifyContent: 'center',
           marginBottom: 4 },
  // Deep green, never red. This is "no useful data", not a malfunction.
  face: { fontSize: 46, lineHeight: 54, color: C.forest, textAlign: 'center' },
  headline: { fontSize: 15.5, fontWeight: '800', color: C.forest, textAlign: 'center' },
  counts: { fontSize: 11, color: C.muted, textAlign: 'center' },
  body: { fontSize: 12.5, color: C.brown, textAlign: 'center', lineHeight: 18, maxWidth: 320 },
  suggestion: { fontSize: 11.5, color: C.muted, textAlign: 'center', lineHeight: 16,
                fontStyle: 'italic', maxWidth: 320, marginTop: 2 },
});
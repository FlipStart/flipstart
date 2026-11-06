/**
 * utils/confidenceDisplay.ts
 *
 * How a screen shows identification confidence: HIGH / MEDIUM / LOW CONFIDENCE
 * with the server's one-line reason underneath. Never a percentage.
 *
 * match_confidence (the 0-100 number) still exists for compatibility and still
 * drives the Buy rating, but it is an ordinal position, not a probability, so
 * no screen shows it. The tier comes from the server (identification level);
 * scans saved before the server sent one work it out from the number.
 *
 * Authenticity is a separate signal: a suspected fake can be HIGH confidence
 * about what it is. The concern is returned beside the tier, never folded in.
 */
import {
  resolveConfidenceTier, TIER_LABEL, TIER_LABEL_CAPS, type ConfidenceTier,
} from '@shared/confidenceTier';

export type ConfidenceTone = ConfidenceTier | 'problem';

export interface ConfidenceDisplay {
  /** null = problem state (couldn't identify, no item, several items). */
  tier: ConfidenceTier | null;
  tone: ConfidenceTone;
  /** "HIGH CONFIDENCE" … or "COULDN'T IDENTIFY". */
  label: string;
  /** "High confidence" … or "Couldn't identify". */
  short: string;
  /** What was observed, from the server. Null on older scans: no made-up reasons. */
  reason: string | null;
  /** The first authenticity concern, when there is one. Shown separately. */
  authenticity: string | null;
  color: string;
  bg: string;
  border: string;
}

/** The v1 passthrough fields this reads. Every one is optional. */
export interface ConfidenceSource {
  confidenceTier?: ConfidenceTier | null;
  confidenceTierReason?: string;
  authenticityConcerns?: string[];
}

const TONES: Record<ConfidenceTone, { color: string; bg: string; border: string }> = {
  high:    { color: '#2A4A2A', bg: '#EFF6EC', border: '#7CA87C' },
  medium:  { color: '#7A5C1E', bg: '#FBF5E6', border: '#D9C38A' },
  low:     { color: '#8A4A1A', bg: '#FBEFE6', border: '#D9A27A' },
  problem: { color: '#6A2A2A', bg: '#F8ECEA', border: '#C99A94' },
};

/**
 * Null means show nothing: an old scan with no tier and no usable number
 * (a v0 scan saved with 0). A problem state is shown as "Couldn't identify",
 * never dressed up as "Low confidence".
 */
export function getConfidenceDisplay(
  v1: ConfidenceSource | null | undefined,
  score: number | null | undefined,
): ConfidenceDisplay | null {
  const serverTier = v1?.confidenceTier;
  const tier = resolveConfidenceTier(serverTier, score);
  const reason = typeof v1?.confidenceTierReason === 'string' && v1.confidenceTierReason.trim()
    ? v1.confidenceTierReason.trim() : null;
  const firstConcern = (v1?.authenticityConcerns ?? []).map(s => String(s ?? '').trim()).find(Boolean);
  const authenticity = firstConcern ?? null;

  if (tier === null) {
    const problem = serverTier === null || (typeof score === 'number' && score > 0);
    if (!problem) return null;
    return {
      tier: null, tone: 'problem', label: "COULDN'T IDENTIFY", short: "Couldn't identify",
      reason, authenticity, ...TONES.problem,
    };
  }
  return {
    tier, tone: tier, label: TIER_LABEL_CAPS[tier], short: TIER_LABEL[tier],
    reason, authenticity, ...TONES[tier],
  };
}
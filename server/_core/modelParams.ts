/**
 * Output-limit and reasoning parameters, chosen per model.
 *
 * Why this exists: OpenAI's reasoning models (gpt-5.x, gpt-6.x, the o-series)
 * reject the old `max_tokens` with a hard 400 ("Use 'max_completion_tokens'
 * instead"), and they count their hidden reasoning tokens against that cap. A
 * cap sized for the visible JSON (900, 380) can be eaten entirely by thinking,
 * which returns an empty string with finish_reason "length". So for reasoning
 * models we send `max_completion_tokens` = visible budget + headroom for
 * thinking, and set `reasoning_effort` explicitly.
 *
 * Non-reasoning models (gpt-4o, gpt-4.1 and friends) get exactly what they got
 * before: `max_tokens`, no reasoning field. That keeps a rollback to the old
 * model a one-variable change on Railway.
 */

export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh" | "max";

/** gpt-5*, gpt-6*, and o1/o3/o4-style ids. Snapshot suffixes do not matter. */
export function isReasoningModel(model: string): boolean {
  const m = (model ?? "").trim().toLowerCase();
  // "gpt-5-chat-latest" is the non-reasoning chat variant and rejects reasoning_effort.
  if (/^gpt-\d+(\.\d+)?-chat/.test(m)) return false;
  return /^(gpt-([5-9]|\d{2,})|o\d)/.test(m);
}

/** Extra completion tokens reserved for thinking, on top of the visible answer. */
const HEADROOM: Record<ReasoningEffort, number> = {
  none: 0,
  // Room for thinking on a 3-photo scan with a long prompt. Only a cap: unused
  // tokens cost nothing. Too small and the thinking eats the answer (empty
  // reply, finish_reason "length"), which fails the scan.
  low: 3000,
  medium: 4000,
  high: 8000,
  xhigh: 16000,
  max: 24000,
};

export type OutputLimitParams =
  | { max_tokens: number }
  | { max_completion_tokens: number; reasoning_effort: ReasoningEffort };

export function outputLimitParams(
  model: string,
  visibleTokens: number,
  effort: ReasoningEffort,
  opts: { hasTools?: boolean } = {},
): OutputLimitParams {
  if (!isReasoningModel(model)) return { max_tokens: visibleTokens };
  // Chat Completions only allows function calling with reasoning off.
  const e: ReasoningEffort = opts.hasTools ? "none" : effort;
  return {
    max_completion_tokens: visibleTokens + HEADROOM[e],
    reasoning_effort: e,
  };
}
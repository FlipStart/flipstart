/**
 * lib/deepAnalysisAnalytics.ts
 *
 * The Deep Analysis events, in one place, so the founder dashboard and the app
 * agree on their names. Everything goes through trackAnalyticsEvent, which
 * already attaches the plan at that moment (entitlement_state_snapshot), so no
 * event here carries a plan of its own.
 *
 *   deep_analysis_tapped            a tap on Deep Analysis, and what it led to:
 *                                   open | offer_preview | paywall | unresolved
 *   deep_analysis_viewed            the Deep Analysis screen opened (source says from where)
 *   deep_analysis_preview_offered   the one-free-look sheet was shown
 *   deep_analysis_preview_accepted  "Try Deep Analysis" tapped
 *   deep_analysis_preview_result    granted | already_used | error
 *   deep_analysis_preview_dismissed "Not Now" / tapped away
 *
 * The paywall itself is already tracked as paywall_opened with
 * paywall_source = "deep_analysis"; nothing here repeats it.
 */
import { trackAnalyticsEvent } from "@/lib/analytics";

export type DeepTapOutcome = "open" | "offer_preview" | "paywall" | "unresolved";
export type PreviewResult = "granted" | "already_used" | "error";

function emit(event: string, extra: Record<string, unknown> = {}): void {
  try {
    trackAnalyticsEvent(event, extra);
  } catch {
    // Telemetry must never get in the way of opening the screen.
  }
}

export const deepAnalysisAnalytics = {
  tapped:           (outcome: DeepTapOutcome) => emit("deep_analysis_tapped", { outcome }),
  viewed:           (source: string | null)   => emit("deep_analysis_viewed", { source: source ?? "unknown" }),
  previewOffered:   ()                        => emit("deep_analysis_preview_offered"),
  previewAccepted:  ()                        => emit("deep_analysis_preview_accepted"),
  previewResult:    (result: PreviewResult)   => emit("deep_analysis_preview_result", { result }),
  previewDismissed: ()                        => emit("deep_analysis_preview_dismissed"),
};
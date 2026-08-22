/**
 * lib/useDeepAnalysisGate.ts
 *
 * ONE hook for opening Deep Analysis, used by every entry point.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * Deep Analysis is reachable from FOUR screens: results, scan-detail,
 * diamonds-in-the-rough and hunt-history. Only results was gated — the other
 * three opened it freely for anyone, which made the gate decorative.
 *
 * Four copies of the same check would drift the same way again. Every caller
 * now does:
 *
 *   const openDeepAnalysis = useDeepAnalysisGate();
 *   openDeepAnalysis(() => router.push(...));
 *
 * and the entitlement rules live in one place.
 */
import { useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { useEntitlement, useRefreshEntitlement } from "@/lib/useEntitlement";
import { useProGate } from "@/components/monetization/ProGate";

export function useDeepAnalysisGate(): (open: () => void) => void {
  const ent = useEntitlement();
  const { openProGate } = useProGate();
  const refresh = useRefreshEntitlement();
  const consume = trpc.monetization.useDeepAnalysisPreview.useMutation();

  return useCallback((open: () => void) => {
    // Fail closed while unresolved — a premium action must never be granted by
    // a loading state.
    if (ent.status !== 'ready') return;

    if (ent.can('deep_analysis')) { open(); return; }

    /**
     * Free user with their preview still unused: offer it rather than refuse.
     *
     * The consume call is SERVER-side and atomic, so a double-tap cannot yield
     * two previews. It only opens on `granted` — if the server says the preview
     * was already used (another device, a race), the gate simply closes rather
     * than opening something they no longer have.
     */
    if (ent.deepAnalysisPreviewAvailable) {
      openProGate('deep_analysis', {
        label: 'View Preview',
        onAccept: async () => {
          try {
            const res: any = await consume.mutateAsync();
            await refresh();
            if (res?.granted) open();
            // Not granted: already used elsewhere. Nothing opens, and the next
            // attempt shows the ordinary gate.
          } catch {
            // Network failure — do NOT open. The preview is a paid-tier feature
            // and an unverified grant is worse than a retry.
          }
        },
      });
      return;
    }

    openProGate('deep_analysis');
  }, [ent, openProGate, consume, refresh]);
}
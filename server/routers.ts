import { z } from "zod";
import { checkScanAllowed, commitScanCount, getScanStats, getUserScanStats, submitFeedback, getFeedbackByScanId } from "./persist";
import { COOKIE_NAME } from "../shared/const.js";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { uploadScanImage, analyzeItemFast, generateItemListings } from "./scan";

// ─── Successful-analysis cache (keyed by scanAttemptId) ──────────────────────
// A retry re-sends the SAME scanAttemptId. Without this, every retry re-runs
// the AI at full cost — and in the worst case (server succeeded at 31s but the
// client had already timed out at 30s) we'd pay two or three times and the user
// would still never see the result we already produced.
//
// Caching the successful result means a retry returns instantly, costs nothing,
// and hands the user the analysis that was already paid for. In-memory on
// purpose: results only need to survive the retry window, and losing the cache
// on restart is harmless (worst case = one extra AI call).
const RESULT_TTL_MS  = 10 * 60 * 1000; // 10 minutes
const RESULT_CACHE_MAX = 200;
const analysisCache = new Map<string, { at: number; result: any }>();

function getCachedAnalysis(attemptId?: string): any | null {
  if (!attemptId) return null;
  const hit = analysisCache.get(attemptId);
  if (!hit) return null;
  if (Date.now() - hit.at > RESULT_TTL_MS) {
    analysisCache.delete(attemptId);
    return null;
  }
  return hit.result;
}

function cacheAnalysis(attemptId: string | undefined, result: any): void {
  if (!attemptId) return;
  // Bound the map — drop the oldest entries once over the cap.
  if (analysisCache.size >= RESULT_CACHE_MAX) {
    const cutoff = Date.now() - RESULT_TTL_MS;
    for (const [k, v] of analysisCache) if (v.at < cutoff) analysisCache.delete(k);
    while (analysisCache.size >= RESULT_CACHE_MAX) {
      const oldestKey = analysisCache.keys().next().value;
      if (oldestKey === undefined) break;
      analysisCache.delete(oldestKey);
    }
  }
  analysisCache.set(attemptId, { at: Date.now(), result });
}
const appRouter_scan = router({
    /**
     * Fast single-call analysis: image → AI → full results (identification + pricing + listings).
     * Uploads to S3 in parallel with analysis for speed.
     */
    analyzeFast: publicProcedure
      .input(
        z.object({
          imageBase64:     z.string().min(1, "Image data is required"),
          mimeType:        z.string().default("image/jpeg"),
          detailImageBase64: z.string().optional(),
          detailMimeType:    z.string().optional(),
          tagImageBase64:  z.string().optional(),
          tagMimeType:     z.string().optional(),
          scannerId:       z.string().optional(), // per-user/guest daily limit key
          scanAttemptId:   z.string().optional(), // stable id per item; dedupes retries so 1 item = 1 count
        })
      )
      .mutation(async ({ input }) => {
        console.log("[analyze] request received");
        console.log("[analyze] mimeType:", input.mimeType);
        console.log("[analyze] base64 length:", input.imageBase64?.length ?? 0);

        // ── RETRY SHORT-CIRCUIT ─────────────────────────────────────────────
        // This exact attempt already produced a successful analysis (the client
        // timed out, lost the response, or the user hit retry). Return the
        // result we already paid for: no second AI charge, no double count,
        // and the user finally gets their scan.
        const cached = getCachedAnalysis(input.scanAttemptId);
        if (cached) {
          console.log("[analyze] served from cache — attempt", input.scanAttemptId?.slice(0, 16), "(no AI cost)");
          return cached;
        }

        // ── IDENTITY REQUIRED ───────────────────────────────────────────────
        // A request with no scannerId used to fall back to a SHARED "_legacy"
        // bucket in checkScanAllowed/commitScanCount. Because the client never
        // sent scannerId, EVERY user's scans landed in that one bucket — so
        // after 7 scans total across the whole user base, every user (including
        // brand-new accounts on other devices) was told they were out of scans.
        // Refusing to proceed without an identity makes that class of bug
        // structurally impossible rather than relying on the client to comply.
        const sid = (input.scannerId ?? "").trim();
        if (!sid) {
          console.warn("[analyze] rejected — no scannerId supplied (outdated client?)");
          throw Object.assign(
            new Error("SCANNER_ID_MISSING: cannot identify this device's scan quota."),
            { code: "SCANNER_ID_MISSING" },
          );
        }

        // ── PER-USER SCAN LIMIT CHECK (read-only) ───────────────────────────
        // Check quota BEFORE the AI call so over-limit users don't cost us AI
        // spend — but do NOT consume the count here. The count is only committed
        // AFTER a successful analysis (below), so failed/timed-out/canceled
        // scans never burn a scan. Keyed by scannerId (user id or guest id).
        const allowed = checkScanAllowed(sid);
        if (!allowed) {
          const stats = getUserScanStats(sid);
          throw Object.assign(
            new Error("Daily scan limit reached. Try again tomorrow."),
            {
              code:                     "GLOBAL_SCAN_LIMIT_REACHED",
              dailyLimit:               stats.dailyLimit,
              usedToday:                stats.usedToday,
              remainingToday:           stats.remainingToday,
              resetTime:                stats.resetTime,
            }
          );
        }

        try {
          const callStart = Date.now();
          console.log("[analyze] image processing start");
          console.log("[analyze] images — front:true detail:", !!input.detailImageBase64, "tag:", !!input.tagImageBase64);
          console.log("[analyze] AI request start");

          // Run S3 upload and AI analysis in PARALLEL
          const [imageUrl, analysisResult] = await Promise.all([
            uploadScanImage(input.imageBase64, input.mimeType),
            analyzeItemFast(
              input.imageBase64,
              input.mimeType,
              input.detailImageBase64 ? { base64: input.detailImageBase64, mimeType: input.detailMimeType ?? 'image/jpeg' } : undefined,
              input.tagImageBase64    ? { base64: input.tagImageBase64,    mimeType: input.tagMimeType    ?? 'image/jpeg' } : undefined,
            ),
          ]);

          const durationMs = Date.now() - callStart;
          console.log(`[analyze] complete — ${durationMs}ms | confidence:${analysisResult?.risk_analysis?.match_confidence ?? '?'} | value:$${analysisResult?.market_data?.adjusted_estimated_value ?? '?'}`);

          // ── COMMIT THE SCAN COUNT — only now that analysis succeeded ────────
          // Idempotent per scanAttemptId: retries of the same item won't double
          // count. A failed AI call above throws before reaching this line, so
          // failed scans cost nothing.
          commitScanCount(sid, input.scanAttemptId);

          const payload = {
            imageUrl,
            ...analysisResult,
          };
          // Store so any retry of THIS attempt is free and instant.
          cacheAnalysis(input.scanAttemptId, payload);
          return payload;
        } catch (err: any) {
          console.error("[analyze] ERROR:", err?.message ?? String(err));
          if (err?.stack) console.error("[analyze] STACK:", err.stack);
          throw err;
        }
      }),
    /**
     * Returns global scan stats — used by the ScanBalancePill on Home screen.
     */
    getScanStats: publicProcedure.query(() => {
      return getScanStats();
    }),

    /**
     * Per-user scan stats — used by the ScanBalancePill so each user/guest sees
     * their own remaining daily scans (7/day). Pass the same scannerId the scan
     * mutation uses (logged-in user id or guest anon id).
     */
    getUserScanStats: publicProcedure
      .input(z.object({ scannerId: z.string().optional() }))
      .query(({ input }) => {
        return getUserScanStats(input.scannerId);
      }),

    /**
     * Generate eBay + Depop listing copy for a confirmed flip.
     * Called on-demand from the results and analysis-details screens.
     */
    generateListings: publicProcedure
      .input(
        z.object({
          item_name:                z.string(),
          brand:                    z.string(),
          category:                 z.string(),
          estimated_era:            z.string().optional().default("Unknown"),
          material_guess:           z.string().optional().default("Unknown"),
          style_labels:             z.array(z.string()).optional().default([]),
          adjusted_estimated_value: z.number(),
          demand:                   z.string().optional().default("Medium"),
        })
      )
      .mutation(async ({ input }) => {
        const start = Date.now();
        console.log(`[listings] generate — item:"${input.item_name}" brand:"${input.brand}"`);
        const result = await generateItemListings(input);
        console.log(`[listings] complete — ${Date.now() - start}ms`);
        return result;
      }),
  })

// ─── Feedback router ─────────────────────────────────────────────────────────

const feedbackRouter = router({

  submit: publicProcedure
    .input(z.object({
      scanId:             z.string(),
      // Prediction snapshot
      itemName:           z.string(),
      brand:              z.string(),
      category:           z.string(),
      resaleLow:          z.number(),
      resaleHigh:         z.number(),
      suggestedBuy:       z.number(),
      demand:             z.string(),
      bestPlatform:       z.string(),
      confidenceScore:    z.number(),
      recommendation:     z.string(),
      aiEstimatedResale:  z.number().nullable().optional(),
      // User feedback
      accuracyRating:     z.enum(["accurate", "somewhat", "bad"]).nullable(),
      buyDecision:        z.enum(["bought", "passed", "unsure"]).nullable(),
      userEstimatedValue: z.number().nullable().optional(),
      notes:              z.string().max(150).nullable().optional(),
    }))
    .mutation(({ input }) => {
      const entry = {
        id:        `fb_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        scanId:    input.scanId,
        timestamp: Date.now(),
        prediction: {
          itemName:        input.itemName,
          brand:           input.brand,
          category:        input.category,
          resaleLow:       input.resaleLow,
          resaleHigh:      input.resaleHigh,
          suggestedBuy:    input.suggestedBuy,
          demand:          input.demand,
          bestPlatform:       input.bestPlatform,
          confidenceScore:    input.confidenceScore,
          recommendation:     input.recommendation,
          aiEstimatedResale:  input.aiEstimatedResale ?? undefined,
        },
        feedback: {
          accuracyRating:     input.accuracyRating,
          buyDecision:        input.buyDecision,
          userEstimatedValue: input.userEstimatedValue ?? null,
          notes:              input.notes ?? null,
        },
      };
      submitFeedback(entry);
      return { ok: true };
    }),

  getByScanId: publicProcedure
    .input(z.object({ scanId: z.string() }))
    .query(({ input }) => getFeedbackByScanId(input.scanId)),

});

// ─── App router ───────────────────────────────────────────────────────────────

export const appRouter = router({
  scan:     appRouter_scan,
  feedback: feedbackRouter,
  system:   systemRouter,
});

export type AppRouter = typeof appRouter;
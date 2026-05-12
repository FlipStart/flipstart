import { z } from "zod";
import { tryIncrementScanCount, getScanStats, submitFeedback, getFeedbackByScanId } from "./persist";
import { COOKIE_NAME } from "../shared/const.js";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { uploadScanImage, analyzeItemFast, generateItemListings } from "./scan";
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
        })
      )
      .mutation(async ({ input }) => {
        console.log("[analyze] request received");
        console.log("[analyze] mimeType:", input.mimeType);
        console.log("[analyze] base64 length:", input.imageBase64?.length ?? 0);

        // ── GLOBAL SCAN LIMIT CHECK ─────────────────────────────────────────
        // Must be BEFORE any AI call. Atomic increment prevents race conditions.
        const allowed = tryIncrementScanCount();
        if (!allowed) {
          const stats = getScanStats();
          throw Object.assign(
            new Error("Beta scan limit reached for today. Try again tomorrow."),
            {
              code:                     "GLOBAL_SCAN_LIMIT_REACHED",
              globalDailyLimit:         stats.globalDailyLimit,
              globalScansUsedToday:     stats.globalScansUsedToday,
              globalScansRemainingToday: stats.globalScansRemainingToday,
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

          return {
            imageUrl,
            ...analysisResult,
          };
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
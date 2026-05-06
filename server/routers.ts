import { z } from "zod";
import { submitFeedback, getFeedbackByScanId } from "./feedback";
import { COOKIE_NAME } from "../shared/const.js";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { uploadScanImage, analyzeItemFast, generateItemListings } from "./scan";
// ── Single global scan counter ───────────────────────────────────────────────
// Date key uses America/Chicago timezone — resets at midnight Chicago time.
// Same object used by both analyzeFast (increment) and /api/scan-stats (read).
const SCAN_LIMIT = 200;
const TZ         = 'America/Chicago';

function todayChicago(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
  // en-CA gives YYYY-MM-DD format natively
}

function nextMidnightChicago(): Date {
  // Get tomorrow's date string in Chicago time, then parse as midnight Chicago
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(tomorrow);
  // Build a Date representing midnight Chicago time for that date
  return new Date(`${tomorrowStr}T00:00:00-05:00`); // CST offset; close enough for display
}

function getGlobalCounter(): { date: string; count: number } {
  const today = todayChicago();
  const c     = (global as any).__flipScanCounter;
  if (!c || c.date !== today) {
    (global as any).__flipScanCounter = { date: today, count: 0 };
  }
  return (global as any).__flipScanCounter;
}

function tryIncrementScanCount(): boolean {
  const c = getGlobalCounter();
  if (c.count >= SCAN_LIMIT) return false;
  c.count++;
  console.log(`[scan] ${c.count}/${SCAN_LIMIT} used today (${c.date})`);
  return true;
}

function getScanStats() {
  const c         = getGlobalCounter();
  const remaining = Math.max(0, SCAN_LIMIT - c.count);
  return {
    globalDailyLimit:          SCAN_LIMIT,
    globalScansUsedToday:      c.count,
    globalScansRemainingToday: remaining,
    resetTime:                 nextMidnightChicago().toISOString(),
  };
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
          backImageBase64: z.string().optional(),
          backMimeType:    z.string().optional(),
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
          console.log("[analyze] image processing start");
          console.log("[analyze] AI request start");

          // Run S3 upload and AI analysis in PARALLEL
          const [imageUrl, analysisResult] = await Promise.all([
            uploadScanImage(input.imageBase64, input.mimeType),
            analyzeItemFast(
              input.imageBase64,
              input.mimeType,
              input.backImageBase64 ? { base64: input.backImageBase64, mimeType: input.backMimeType ?? 'image/jpeg' } : undefined,
              input.tagImageBase64  ? { base64: input.tagImageBase64,  mimeType: input.tagMimeType  ?? 'image/jpeg' } : undefined,
            ),
          ]);

          console.log("[analyze] AI request complete");
          console.log("[analyze] image processing complete");
          console.log("[analyze] returning response");

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
        return generateItemListings(input);
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
          bestPlatform:    input.bestPlatform,
          confidenceScore: input.confidenceScore,
          recommendation:  input.recommendation,
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
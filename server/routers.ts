import { z } from "zod";
import { COOKIE_NAME } from "../shared/const.js";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { uploadScanImage, analyzeItemFast, generateItemListings } from "./scan";
// ── Single global scan counter ───────────────────────────────────────────────
// Uses global.__flipScanCounter — the SAME object that /api/scan-stats reads.
// This is the only counter. Any scan anywhere in the app decrements this.
const SCAN_LIMIT = 200;

function getGlobalCounter(): { date: string; count: number } {
  const today = new Date().toISOString().slice(0, 10);
  if (!(global as any).__flipScanCounter || (global as any).__flipScanCounter.date !== today) {
    (global as any).__flipScanCounter = { date: today, count: 0 };
    console.log(`[scan-counter] new day (${today}), count reset to 0`);
  }
  return (global as any).__flipScanCounter;
}

function tryIncrementScanCount(): boolean {
  const c = getGlobalCounter();
  if (c.count >= SCAN_LIMIT) {
    console.log(`[scan-counter] BLOCKED — limit ${SCAN_LIMIT} reached`);
    return false;
  }
  c.count++;
  console.log(`[scan-counter] scan ${c.count}/${SCAN_LIMIT} allowed`);
  return true;
}

function getScanStats() {
  const c         = getGlobalCounter();
  const remaining = Math.max(0, SCAN_LIMIT - c.count);
  const tomorrow  = new Date();
  tomorrow.setUTCHours(24, 0, 0, 0);
  return {
    globalDailyLimit:          SCAN_LIMIT,
    globalScansUsedToday:      c.count,
    globalScansRemainingToday: remaining,
    resetTime:                 tomorrow.toISOString(),
  };
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  scan: router({
    /**
     * Fast single-call analysis: image → AI → full results (identification + pricing + listings).
     * Uploads to S3 in parallel with analysis for speed.
     */
    analyzeFast: publicProcedure
      .input(
        z.object({
          imageBase64: z.string().min(1, "Image data is required"),
          mimeType: z.string().default("image/jpeg"),
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
            analyzeItemFast(input.imageBase64, input.mimeType),
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
  }),
});

export type AppRouter = typeof appRouter;
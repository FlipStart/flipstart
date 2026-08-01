import { z } from "zod";
import { checkScanAllowed, commitScanCount, getScanStats, getUserScanStats, submitFeedback, getFeedbackByScanId } from "./persist";
import { COOKIE_NAME } from "../shared/const.js";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { canonicalV1EnabledFor, ENV } from "./_core/env.js";
import { analyzeItemV1, ScanV1Error } from "./scanV1.js";
import { persistScanPhotos } from "./photoPersistence.js";
import { toLegacyShape } from "./compat/toLegacyShape.js";
import { grantDevScans, revokeDevGrant, devGrantStatus } from "./devGrants.js";
import { buildServerUserContext, userContextAllowedFor } from "./userContextServer.js";
import { renderUserContextBlock } from "../shared/userContext.js";
import { saveScanContext, getScanContext } from "./scanContextStore.js";
import { randomUUID } from "node:crypto";
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

/**
 * Cache key = attempt id + context hash.
 *
 * Keying on attempt id alone would let the same photos with DIFFERENT context
 * reuse one result: scan an item, retry with "big stain on right sleeve" added,
 * and you would get back the stainless analysis. The hash keeps the retry
 * dedupe working while making a context change a genuine cache miss.
 */
function cacheKey(attemptId: string, contextHash: string | null): string {
  return contextHash ? `${attemptId}::${contextHash}` : attemptId;
}

function getCachedAnalysis(attemptId?: string, contextHash: string | null = null): any | null {
  if (!attemptId) return null;
  const hit = analysisCache.get(cacheKey(attemptId, contextHash));
  if (!hit) return null;
  if (Date.now() - hit.at > RESULT_TTL_MS) {
    analysisCache.delete(cacheKey(attemptId, contextHash));
    return null;
  }
  return hit.result;
}

function cacheAnalysis(
  attemptId: string | undefined, result: any, contextHash: string | null = null,
): void {
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
  analysisCache.set(cacheKey(attemptId, contextHash), { at: Date.now(), result });
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
          // Camera-confirmed user context. Capped generously here and hard-capped
          // by normalization; a modified client cannot smuggle a longer string
          // past USER_CONTEXT_MAX_LEN because the server re-normalizes.
          userContext:     z.string().max(2000).optional(),
        })
      )
      .mutation(async ({ input }) => {
        console.log("[analyze] request received");
        console.log("[analyze] mimeType:", input.mimeType);
        console.log("[analyze] base64 length:", input.imageBase64?.length ?? 0);

        // ── USER CONTEXT ────────────────────────────────────────────────────
        // Normalized up front because the result cache key includes its hash.
        // The server always re-normalizes: a modified client cannot bypass the
        // length cap or push control characters through.
        //
        // Entitlement is applied below once sid is known. Normalizing first is
        // safe — an unentitled context is discarded before it reaches the AI.
        const rawCtx = buildServerUserContext(input.userContext);

        // ── RETRY SHORT-CIRCUIT ─────────────────────────────────────────────
        // This exact attempt already produced a successful analysis (the client
        // timed out, lost the response, or the user hit retry). Return the
        // result we already paid for: no second AI charge, no double count,
        // and the user finally gets their scan.
        const cached = getCachedAnalysis(input.scanAttemptId, rawCtx.hash);
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

        // ── CanonicalAnalysisV1 route (feature-flagged) ─────────────────────
        // Off by default. When enabled for this user, run V1 and FAIL CLOSED:
        // no analysis saved, no scan consumed, nothing unlocked. The legacy
        // path below is untouched and is the immediate rollback.
        if (canonicalV1EnabledFor(sid)) {
          const analysisId = randomUUID();

          // ── Entitlement, enforced here rather than by hiding the UI ────────
          // analyzeFast is a publicProcedure; a modified client can post
          // anything. An unauthorised caller has their context stripped and the
          // scan proceeds normally — failing the whole scan would punish the
          // user for a client bug they cannot see.
          const entitled = userContextAllowedFor(sid);
          const userCtx = entitled ? rawCtx : buildServerUserContext(null);
          if (!entitled && (input.userContext ?? "").trim()) {
            console.warn(`[context] stripped — ${String(sid).slice(0, 12)}… not entitled`);
          }
          try {
            const images = {
              front:  input.imageBase64,
              detail: input.detailImageBase64,
              tag:    input.tagImageBase64,
            };

            // Persist first so meta.photo_refs is populated on the stored
            // analysis. A failed upload leaves a null ref but never fails the
            // scan — the analysis is still valid.
            const photoRefs = await persistScanPhotos({
              userId: sid,
              analysisId,
              scanAttemptId: input.scanAttemptId ?? analysisId,
              images,
              mimeType: input.mimeType,
            });

            const v1Start = Date.now();
            const { canonical, telemetry } = await analyzeItemV1({
              images,
              mimeType: input.mimeType,
              userId: sid,
              scanAttemptId: input.scanAttemptId ?? analysisId,
              analysisId,
              planAtScan: "free",
              photoRefs,
              userContext: userCtx,
            });

            // Store for Generate Listings, tied to the owner so the listing
            // endpoint can verify the caller owns this analysis rather than
            // trusting a context string posted at listing time.
            if (userCtx.user_context) {
              saveScanContext({
                analysisId,
                scanAttemptId: input.scanAttemptId ?? analysisId,
                ownerId: sid ?? "",
                text: userCtx.user_context,
                hash: userCtx.hash,
              });
            }

            console.log(
              `[analyzeV1] ok — ${Date.now() - v1Start}ms | model:${telemetry.model}` +
              ` | prompt:${telemetry.prompt_tokens} cached:${telemetry.cached_tokens}` +
              ` completion:${telemetry.completion_tokens}` +
              ` | cost:$${telemetry.estimated_cost_usd?.toFixed(6) ?? "?"}` +
              ` | era:${canonical.derived.era_effective.status}` +
              `/${canonical.derived.era_effective.confirmed_vintage_route ?? "-"}` +
              ` | downgrades:${canonical.derived.validation.downgrades.length}` +
              // Presence, length and hash only — never the text itself.
              ` | ctx:${userCtx.confirmed ? `${userCtx.char_count}c/${userCtx.hash}` : "none"}`
            );

            // Only NOW is the scan consumed. Skipped while V1 is allow-list
            // only, so founder testing does not burn the 7/day quota on
            // results that are still being validated.
            const testingOnly = !ENV.canonicalV1Enabled;
            if (!testingOnly) commitScanCount(sid, input.scanAttemptId);
            else console.log("[analyzeV1] allow-list scan — quota NOT consumed");

            // Emit BOTH shapes. The shipped app reads the legacy keys and
            // renders normally with no EAS build; `canonical` rides along for
            // the new screens. The adapter is deleted once the client reads
            // canonical directly.
            const v1Payload = {
              ...toLegacyShape(canonical),
              canonical,
              schemaVersion: "1" as const,
            };
            cacheAnalysis(input.scanAttemptId, v1Payload, userCtx.hash);
            return v1Payload;
          } catch (err) {
            const kind = err instanceof ScanV1Error ? err.kind : "transport_error";
            const diag = err instanceof ScanV1Error ? err.diagnostics : {};
            console.error(
              `[analyzeV1] FAILED kind=${kind} analysis=${analysisId} —`,
              err instanceof Error ? err.message : String(err),
              JSON.stringify(diag).slice(0, 800),
            );
            // Fail closed. No scan consumed, nothing saved, nothing unlocked.
            // Deliberately NOT silently downgraded to the legacy route: that
            // would hide a broken V1 behind a working-looking response.
            throw Object.assign(
              new Error("Scan could not be completed. Please try again."),
              { code: "SCAN_V1_FAILED", kind }
            );
          }
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
          cacheAnalysis(input.scanAttemptId, payload, rawCtx.hash);
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
          // Identity + analysis reference. Required to look the confirmed
          // context up server-side; a context string posted directly by the
          // client is never trusted.
          scannerId:                z.string().optional(),
          analysisId:               z.string().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const start = Date.now();

        // ── Confirmed context, loaded server-side ──────────────────────────
        // Deliberately NOT accepted from the client. Taking a context string at
        // listing time would let anyone write arbitrary text into a listing
        // without it ever passing analysis or the entitlement check. The store
        // returns null when the analysis does not exist, has expired, or
        // belongs to someone else — the caller cannot tell which.
        const sid = (input.scannerId ?? "").trim();
        const stored = input.analysisId ? getScanContext(input.analysisId, sid) : null;
        const userContext = stored?.text ?? "";

        console.log(
          `[listings] generate — item:"${input.item_name}" brand:"${input.brand}"` +
          ` | ctx:${userContext ? `${userContext.length}c/${stored?.hash}` : "none"}`
        );

        const result = await generateItemListings({ ...input, userContext });
        console.log(`[listings] complete — ${Date.now() - start}ms`);
        return result;
      }),
  })

// ─── Feedback router ─────────────────────────────────────────────────────────

/**
 * Dev-only quota grants.
 *
 * Every procedure here requires DEV_SCAN_GRANT_SECRET, which lives in Railway
 * and is never compiled into the app. The client asks the user to type it.
 * Hiding the UI behind __DEV__ is convenience, not security — this is the
 * boundary that actually holds.
 */
const devRouter = router({
  /** Never returns the secret or any hint about it. Safe to call unauthenticated. */
  grantStatus: publicProcedure
    .input(z.object({ scannerId: z.string().min(1) }))
    .query(({ input }) => devGrantStatus(input.scannerId)),

  grantScans: publicProcedure
    .input(z.object({
      secret:    z.string().min(1).max(512),
      scannerId: z.string().min(1).max(200),
      limit:     z.number().int().positive().max(500).optional(),
      hours:     z.number().int().positive().max(12).optional(),
    }))
    .mutation(({ input }) => {
      const res = grantDevScans({
        secret: input.secret,
        scannerId: input.scannerId,
        limit: input.limit,
        ttlMs: input.hours ? input.hours * 3_600_000 : undefined,
      });
      // Uniform shape on failure. The caller learns THAT it failed and the
      // broad reason, never anything that narrows the secret.
      if (!res.ok) return { ok: false as const, reason: res.reason };
      return { ok: true as const, limit: res.limit, expiresAt: res.expiresAt };
    }),

  revokeScans: publicProcedure
    .input(z.object({ secret: z.string().min(1).max(512), scannerId: z.string().min(1).max(200) }))
    .mutation(({ input }) => ({ ok: revokeDevGrant(input.secret, input.scannerId) })),
});

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
  dev: devRouter,
  scan:     appRouter_scan,
  feedback: feedbackRouter,
  system:   systemRouter,
});

export type AppRouter = typeof appRouter;
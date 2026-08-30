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
import { conditionFactKey } from "./canonical/validate.js";
import { runCompsForAnalysis } from "./comps/index.js";
import { compsFounderAuthorised } from "./comps/auth.js";
import { monetizationV1EnabledFor } from "./_core/env.js";
import { resolveSupabaseUserId } from "./monetization/identity.js";
import { reserveScan, commitScan, refundScan } from "./monetization/ledger.js";
import { requireFeature, requirePhotoCount } from "./monetization/enforce.js";
import { saveAnalysis, getLatestAnalysis, getAnalysis } from "./analysisStore.js";
import { compsCacheStats } from "./comps/cache.js";
import { budgetState, budgetSource } from "./comps/budget.js";
import { resolveAvailability, buildDiagnostic } from "./comps/availability.js";
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
      .mutation(async ({ input, ctx }) => {
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

        // ── MONETIZATION IDENTITY ───────────────────────────────────────────
        //
        // `sid` above is input.scannerId — CLIENT-SUPPLIED and unverified. Fine
        // for the legacy beta counter, which only ever separated devices, but it
        // must never key a ledger that holds money: a modified client could post
        // any string and spend another account's scans.
        //
        // muid is the Supabase uid the SERVER verified from the x-supabase-auth
        // header. Null means unverified, and V1 then does not apply.
        const muid = await resolveSupabaseUserId(ctx?.req as never, "analyze");
        const useV1 = Boolean(muid) && monetizationV1EnabledFor(muid);

        /**
         * ── PREMIUM ENFORCEMENT, BEFORE ANY AI SPEND ────────────────────────
         *
         * UI gates are presentation. A modified or stale client can post three
         * images and a context string straight to this endpoint, so the limit
         * has to hold here or it does not hold at all.
         *
         * Placed before the scan reservation and before the OpenAI call, so a
         * rejected request costs neither a scan nor a cent.
         *
         * Pack ownership is deliberately irrelevant: requirePhotoCount and
         * requireFeature both derive from the PLAN, and a Free user with 2,310
         * pack scans is still Free.
         */
        {
          // The analyze input carries flat base64 fields, not an images map:
          // imageBase64 is required, tag/detail are optional.
          const photoCount =
            1 +
            ((input.tagImageBase64 ?? "").length > 0 ? 1 : 0) +
            ((input.detailImageBase64 ?? "").length > 0 ? 1 : 0);

          const photoCheck = await requirePhotoCount(muid, photoCount);
          if (!photoCheck.allowed && !photoCheck.bypassed) {
            console.warn(`[analyze] REJECTED — ${photoCount} photos on plan ${photoCheck.plan}`);
            throw Object.assign(
              new Error("A third photo is available with FlipStart Pro."),
              { code: "PHOTO_LIMIT_EXCEEDED" },
            );
          }

          /**
           * Camera context: REJECT rather than strip.
           *
           * Stripping would silently return an analysis that ignored what the
           * user typed, and they would have no way to tell. Rejecting before
           * the AI call is both honest and cheaper — and it means a Free client
           * cannot spend our money probing whether the context was used.
           */
          const sentContext = typeof (input as { userContext?: unknown }).userContext === "string"
            && ((input as { userContext?: string }).userContext ?? "").trim().length > 0;
          if (sentContext) {
            const ctxCheck = await requireFeature(muid, "camera_context");
            if (!ctxCheck.allowed && !ctxCheck.bypassed) {
              console.warn(`[analyze] REJECTED — camera context on plan ${ctxCheck.plan}`);
              throw Object.assign(
                new Error("AI Context is available with FlipStart Pro."),
                { code: "PRO_REQUIRED" },
              );
            }
          }
        }

        // Non-null ONLY when this request created a NEW reservation. A replay
        // leaves it null, which is what stops a retry committing twice.
        let reservationId: string | null = null;

        if (useV1) {
          /**
           * The attempt id is the idempotency key, and the schema marks it
           * optional — an outdated client can omit it. Without one, a retry
           * cannot be recognised and would spend a second scan, so V1 requires
           * it rather than inventing a random id that would defeat the whole
           * dedupe mechanism.
           */
          if (!input.scanAttemptId?.trim()) {
            console.warn("[analyze] V1 rejected — no scanAttemptId (outdated client?)");
            throw Object.assign(
              new Error("Please update FlipStart to continue scanning."),
              { code: "SCAN_ATTEMPT_ID_MISSING" },
            );
          }
          /**
           * Reserve BEFORE the AI call.
           *
           * Expired reservations for this user are recovered inside reserve_scan
           * in the same statement, so the balance read here cannot be stale —
           * an async sweep could still have been running.
           */
          const r = await reserveScan(muid as string, input.scanAttemptId.trim());
          if (!r.ok) {
            console.warn(`[analyze] V1 refused — ${r.reason} (plan ${r.plan ?? "?"})`);
            throw Object.assign(
              new Error("You're out of scans. Add more to keep going."),
              { code: r.reason ?? "NO_SCANS_REMAINING" },
            );
          }
          /**
           * A REPLAY THAT REACHED HERE MUST NOT RUN THE AI.
           *
           * The retry cache is written only AFTER success, so during a pending
           * first request it is empty. A duplicate attempt therefore reached
           * this point, found an existing reservation, set reservationId to null
           * — and would then have run a SECOND OpenAI call that consumed no
           * scan. A bounded but real cost leak.
           *
           * Refusing is correct: the original request is still in flight and
           * will populate the cache. The client's next retry gets that cached
           * result for free, which is the behaviour the cache exists for.
           */
          if (r.replayed) {
            console.warn("[analyze] duplicate attempt while original is pending — refusing to re-run AI");
            throw Object.assign(
              new Error("This scan is already being processed. One moment."),
              { code: "SCAN_IN_PROGRESS" },
            );
          }
          reservationId = r.reservationId ?? null;
          console.log(`[analyze] V1 reserved from ${r.source} plan:${r.plan}`);
        }

        // ── PER-USER SCAN LIMIT CHECK (read-only) ───────────────────────────
        // Legacy beta path. Skipped entirely for a V1 user so exactly ONE quota
        // system decides any given request — never both.
        const allowed = useV1 ? true : checkScanAllowed(sid);
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

            // Stored so comps (and later, anything else) can be run against
            // this exact analysis without the client re-posting 15KB of JSON.
            saveAnalysis({
              analysisId,
              scanAttemptId: input.scanAttemptId ?? analysisId,
              ownerId: sid ?? "",
              canonical,
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
                // Derived from the canonical analysis, which exists here;
                // v1Payload is built further down.
                //
                // Deliberately sourced from VALIDATED evidence objects rather
                // than the raw note. That is what keeps "worth $500", "super
                // rare" and "guaranteed authentic" out of listings — they never
                // become evidence, so they can never be appended as facts.
                //
                // Conflicted facts are excluded too: a fact the photos dispute
                // must not be stated flatly in a listing as though it were
                // settled. It stays in the analysis where the conflict is shown
                // alongside it.
                confirmedFacts: (() => {
                  // Conflicts are matched PER FACT, not per category. Excluding
                  // a whole category meant one disputed finding suppressed every
                  // other user-confirmed fact of that kind — a note reading
                  // "hole in elbow, zipper broken" lost the undisputed broken
                  // zipper along with the disputed hole, and shipped a listing
                  // with an undisclosed defect.
                  //
                  // Holding back a disputed fact is cautious and stays visible
                  // in the analysis. Dropping an undisputed flaw is a live
                  // listing with a hidden problem. Those are not symmetric.
                  const conflictedKeys = new Set(
                    canonical.derived.validation.downgrades
                      .filter(d => d.rule_id === "SOURCE_CONFLICT" &&
                                   d.field === "condition.condition_findings")
                      .map(d => d.from),
                  );
                  const out: string[] = [];
                  out.push(...canonical.ai.condition.condition_findings
                    .filter(f => f.photo_slot === "user_confirmed")
                    .filter(f => !conflictedKeys.has(conditionFactKey(f.type, f.location)))
                    .map(f => `${f.type.replace(/_/g, " ")} at ${f.location}`));
                  out.push(...canonical.ai.era.era_evidence
                    .filter(e => e.photo_slot === "user_confirmed")
                    .map(e => e.observation));
                  out.push(...canonical.ai.photo_evidence.observable_field_evidence
                    .filter(e => e.photo_slot === "user_confirmed")
                    .map(e => e.observation));
                  return out.slice(0, 8);
                })(),
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
            if (useV1) {
              // Exactly once. A replay left reservationId null, so a retried
              // attempt cannot consume a second scan.
              if (reservationId) {
                await commitScan(reservationId);
                console.log("[analyzeV1] V1 scan COMMITTED");
              }
            } else {
              const testingOnly = !ENV.canonicalV1Enabled;
              if (!testingOnly) commitScanCount(sid, input.scanAttemptId);
              else console.log("[analyzeV1] allow-list scan — quota NOT consumed");
            }

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
            // Refund to the SAME bucket. Only a reservation THIS request made.
            if (useV1 && reservationId) {
              await refundScan(reservationId).catch(() => {});
              console.log("[analyzeV1] V1 scan REFUNDED after failure");
            }
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
          // Legacy AI path. A V1 user still commits through the ledger, so
          // success is never recorded in two systems.
          if (useV1) {
            if (reservationId) {
              await commitScan(reservationId);
              console.log("[analyze] V1 scan COMMITTED (legacy AI path)");
            }
          } else {
            commitScanCount(sid, input.scanAttemptId);
          }

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
          // Refund to the SAME bucket. Guarded on reservationId, so a replay —
          // which never reserved — cannot credit a scan it did not spend.
          if (useV1 && reservationId) {
            await refundScan(reservationId).catch(() => {});
            console.log("[analyze] V1 scan REFUNDED after failure");
          }
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
      .mutation(async ({ input, ctx }) => {
        /**
         * ── GENERATE LISTINGS IS PRO ────────────────────────────────────────
         *
         * This endpoint previously had NO entitlement check at all — a Free
         * client calling it directly got a full gpt-4.1-mini generation on our
         * account. Enforced here, before any model invocation.
         *
         * Identity is the server-verified Supabase uid, never a client claim.
         * Pack ownership does not change the answer: packs buy scan quantity,
         * not capability.
         */
        {
          const muid = await resolveSupabaseUserId(ctx?.req as never, "generateListings");
          const check = await requireFeature(muid, "generate_listings");
          if (!check.allowed && !check.bypassed) {
            console.warn(`[generateListings] REJECTED — plan ${check.plan ?? "unknown"}`);
            throw Object.assign(
              new Error("Generate Listings is available with FlipStart Pro."),
              { code: "PRO_REQUIRED" },
            );
          }
        }

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

        // Item 4: the confirmed facts must actually reach the listing text, not
        // just the raw note. The note is the user's words; the facts are what
        // the model concluded from them, already normalised and validated.
        const result = await generateItemListings({
          ...input,
          userContext,
          userConfirmedFacts: stored?.confirmedFacts ?? [],
        });
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

/**
 * Sold comps — PHASE 0, founder-only manual validation.
 *
 * Deliberately NOT wired into the scan pipeline. Nothing here touches pricing,
 * ratings, listings or the UI. Its only job is to let a founder run comps by
 * hand against a stored analysis and see whether the data is trustworthy before
 * any of it influences a buy/skip decision.
 *
 * Gated on COMPS_FOUNDER_SECRET with a timing-safe comparison. Two independent
 * gates: the feature flag AND the secret. Either being absent means no request
 * reaches the provider, so a misconfigured deploy cannot quietly start spending
 * quota.
 */
/**
 * Monetization entitlement + subscription sync.
 *
 * Separate router so subscription concerns never tangle with scanning.
 */
const monetizationRouter = router({
  /**
   * "Refresh my subscription."
   *
   * The client supplies NOTHING about itself — no plan, no product, no isPro.
   * The uid comes from the verified session and the server asks RevenueCat about
   * that uid. There is deliberately no parameter a client could use to sync, or
   * inspect, another account.
   */
  syncSubscription: publicProcedure
    .mutation(async ({ ctx }) => {
      const uid = await resolveSupabaseUserId(ctx?.req as never, "syncSubscription");
      if (!uid) return { ok: false as const, reason: "NOT_AUTHENTICATED" as const };

      const { reconcileUser } = await import("./monetization/revenuecatServer.js");
      const { getEntitlementReadModel } = await import("./monetization/enforce.js");

      const r = await reconcileUser(uid);
      // A failed sync still returns the read model: the stored state is the last
      // authoritative snapshot, and showing it beats showing an error when the
      // subscription is perfectly valid and RevenueCat is merely down.
      return {
        ok: r.ok,
        reason: r.ok ? undefined : r.reason,
        // undefined when the row is UNREADABLE. The client treats a missing
        // model as unresolved rather than as Free.
        entitlement: (await getEntitlementReadModel(uid)) ?? undefined,
      };
    }),

  /**
   * Founder-only RevenueCat verification harness.
   *
   * Exists so the integration can be validated WITHOUT spending 45 minutes on an
   * EAS build discovering that an env var is wrong. Every check is read-only or
   * applies the real fetched state; nothing here can fabricate a plan, grant
   * scans, or simulate a purchase.
   *
   * Gated on its own secret. Fails closed when unset, so leaving this deployed
   * without the variable means the endpoint effectively does not exist.
   */
  diagnose: publicProcedure
    .input(z.object({
      secret: z.string().min(1).max(512),
      /** Optional Supabase uuid to probe live. Never a plan, never an override. */
      probeUserId: z.string().uuid().optional(),
    }))
    .mutation(async ({ input }) => {
      const { diagnosticsAuthorised, runDiagnostics } =
        await import("./monetization/diagnostics.js");
      if (!diagnosticsAuthorised(input.secret)) {
        return { ok: false as const, errorCode: "FOUNDER_ONLY" as const };
      }
      const report = await runDiagnostics(input.probeUserId ?? null);
      console.log(
        `[monetization:diagnose] ${report.summary.pass} pass, ${report.summary.fail} fail, ` +
        `${report.summary.warn} warn, ${report.summary.skip} skip`,
      );
      return report;
    }),

  /**
   * Scan-pack recovery.
   *
   * Grants any purchase RevenueCat knows about that FlipStart has not yet
   * recorded. Exists because a webhook can be delayed or dropped, and someone
   * who paid should not wait on delivery.
   *
   * Takes NO parameters describing the purchase — no transaction id, no product,
   * no scan count. The uid comes from the verified session and RevenueCat is the
   * authority on what was bought. Idempotent by construction.
   */
  recoverScanPacks: publicProcedure
    .mutation(async ({ ctx }) => {
      const uid = await resolveSupabaseUserId(ctx?.req as never, "recoverScanPacks");
      if (!uid) return { ok: false as const, reason: "NOT_AUTHENTICATED" as const };

      const { recoverScanPacks } = await import("./monetization/scanPackGrant.js");
      const { getEntitlementReadModel } = await import("./monetization/enforce.js");

      // Environment is resolved inside the service from configuration and is
      // never passed in — a caller-supplied environment would be a way to reach
      // sandbox purchases from production.
      const r = await recoverScanPacks(uid);

      console.log(
        `[scan-pack] recovery via endpoint: granted=${r.grantedCount} ` +
        `scans=${r.totalScansGranted} already=${r.alreadyGranted}`,
      );
      return {
        ok: r.ok,
        grantedCount: r.grantedCount,
        totalScansGranted: r.totalScansGranted,
        alreadyGranted: r.alreadyGranted,
        // undefined when the row is UNREADABLE. The client treats a missing
        // model as unresolved rather than as Free.
        entitlement: (await getEntitlementReadModel(uid)) ?? undefined,
      };
    }),

  /**
   * Consume the one-time Deep Analysis preview.
   *
   * Server-authoritative and atomic: the RPC locks the row, so a double-tap or
   * two devices cannot both be granted. Returns `granted` so the client can
   * tell "opened for you now" from "you already used this".
   *
   * Takes NO parameters — the uid comes from the verified session, and there is
   * nothing a client could send to grant itself a second preview.
   */
  useDeepAnalysisPreview: publicProcedure
    .mutation(async ({ ctx }) => {
      const uid = await resolveSupabaseUserId(ctx?.req as never, "deepAnalysisPreview");
      if (!uid) return { ok: false as const, reason: "NOT_AUTHENTICATED" as const };

      const { getSupabaseAdmin } = await import("./supabaseAdmin.js");
      const { getEntitlementReadModel } = await import("./monetization/enforce.js");
      const sb = getSupabaseAdmin();
      if (!sb) return { ok: false as const, reason: "UNAVAILABLE" as const };

      const { data, error } = await sb.rpc("consume_deep_analysis_preview", { p_user_id: uid });
      if (error) {
        console.error("[deep-preview] consume failed:", error.message);
        return { ok: false as const, reason: "UNAVAILABLE" as const };
      }
      const row = Array.isArray(data) ? data[0] : data;
      console.log(`[deep-preview] granted=${row?.granted} alreadyUsed=${row?.already_used}`);

      return {
        ok: true as const,
        granted: Boolean(row?.granted),
        alreadyUsed: Boolean(row?.already_used),
        // undefined when the row is UNREADABLE. The client treats a missing
        // model as unresolved rather than as Free.
        entitlement: (await getEntitlementReadModel(uid)) ?? undefined,
      };
    }),

  /** Read-only entitlement state for the UI. No mutation, no sync. */
  entitlement: publicProcedure
    .query(async ({ ctx }) => {
      const uid = await resolveSupabaseUserId(ctx?.req as never, "entitlement");
      if (!uid) return { ok: false as const, reason: "NOT_AUTHENTICATED" as const };
      const { getEntitlementReadModel } = await import("./monetization/enforce.js");
      const entitlement = await getEntitlementReadModel(uid);
      /**
       * A null read model means the authoritative row was UNREADABLE, not that
       * the user is Free. Reporting ok:false keeps the client in its UNRESOLVED
       * state -- no plan shown, nothing unlocked -- which is the correct answer
       * to "we do not know". Returning a Free model here is the exact bug that
       * showed a Monthly subscriber 15 free scans.
       */
      if (!entitlement) return { ok: false as const, reason: "USAGE_UNAVAILABLE" as const };
      return { ok: true as const, entitlement };
    }),
});

const compsRouter = router({
  status: publicProcedure
    .input(z.object({ secret: z.string().min(1).max(512) }))
    .query(({ input }) => {
      if (!compsFounderAuthorised(input.secret)) return { ok: false as const, reason: "FOUNDER_ONLY" };
      return {
        ok: true as const,
        enabled: (process.env.COMPS_ENABLED ?? "").trim() === "true",
        // Presence only. The key itself never leaves the adapter.
        providerConfigured: Boolean((process.env.SOLDCOMPS_API_KEY ?? "").trim()),
        cache: compsCacheStats(),
        budget: budgetState(),
        // Which env var name supplied each limit, so a typo shows up here
        // instead of silently applying the default.
        budgetSource: budgetSource(),
      };
    }),

  /**
   * In-app comps for a scan the caller owns.
   *
   * No founder secret: this is the path the app itself uses. Gated on the same
   * allow-list as CanonicalAnalysisV1, so during testing it reaches your account
   * only and cannot leak to real users — but it needs no terminal.
   *
   * PHASE 1a: DISPLAY ONLY. The result is shown next to the AI estimate and does
   * not change it. Pricing stays on the AI number until comps have proven
   * accurate on real items; wiring them in first would risk making prices worse
   * than they are today, which is the one outcome worth avoiding more than
   * shipping late.
   */
  forScan: publicProcedure
    .input(z.object({
      scannerId: z.string().min(1).max(200),
      analysisId: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const sid = input.scannerId.trim();
      // Same gate as V1 scanning. Ordinary users get a clean "unavailable".
      // Public category only. The internal reason stays in the server log — a
      // user cannot act on "not on the allow-list" and does not need to know it.
      if (!canonicalV1EnabledFor(sid)) {
        return { ok: false as const, availability: { state: "temporarily_unavailable" as const,
          reviewedCount: null, filteredOutCount: null, searchPerformed: false } };
      }
      const stored = input.analysisId
        ? getAnalysis(input.analysisId, sid)
        : getLatestAnalysis(sid);
      // A stored analysis we cannot find is, from the screen's point of view, an
      // older scan without the current contract.
      if (!stored) {
        return { ok: false as const, availability: { state: "legacy_unavailable" as const,
          reviewedCount: null, filteredOutCount: null, searchPerformed: false } };
      }

      // userId charges this against the caller's per-user daily cap, so one heavy
      // user cannot drain the shared monthly pool.
      const rec = await runCompsForAnalysis(stored.canonical, { founderAuthorised: true, userId: sid });
      const ai = stored.canonical.derived.pricing;
      const diag = buildDiagnostic({
        ok: rec.ok,
        errorCode: rec.errorCode ?? null,
        ineligibleReason: rec.ineligibleReason ?? null,
        detail: rec.detail ?? null,
        reliableMatchCount: rec.evaluation?.counts.finalSample ?? 0,
        providerCalled: Boolean(rec.provider),
      });
      console.log(
        `[comps:forScan] "${stored.canonical.derived.identification.display_item_name}"` +
        // FOUNDER DIAGNOSTIC. The public payload carries no internal code, so
        // this line is the only place the real reason survives — including the
        // detail that separates a daily from a monthly budget stop, which the
        // previous version dropped. Contains no key, secret or provider body.
        ` ${diag.internalCode}/${diag.stage}` +
        (diag.detail ? `(${diag.detail})` : "") +
        ` reached:${diag.providerReached} reserved:${diag.requestReserved}` +
        (rec.query ? ` q:"${rec.query.text}"` : "") +
        (rec.evaluation ? ` reliable:${rec.evaluation.counts.finalSample}` +
          ` median:${rec.evaluation.public.canShowMedian ? `$${rec.evaluation.public.medianSoldPrice}` : "suppressed"}` +
          ` conf:${rec.evaluation.confidencePercent}%/${rec.evaluation.confidenceLabel}` +
          ` state:${rec.evaluation.resultState} disp:${rec.evaluation.debug.dispersion}` +
          (rec.evaluation.public.statisticsSuppressedReason ? ` why:${rec.evaluation.public.statisticsSuppressedReason}` : "") : "") +
        // Contract telemetry. Image HOSTS only, never full URLs — those carry
        // query parameters that should not sit in logs.
        (rec.displayMatches ? ` shown:${rec.displayMatches.length}` +
          ` img:${rec.displayMatches.filter(m => m.imageStatus === "available").length}/${rec.displayMatches.length}` +
          ` mkt:${rec.source?.marketplaces.join("+") ?? "?"}` : "") +
        ` ai:$${ai.resale_low}-$${ai.resale_high} ${rec.totalMs}ms`
      );

      // Trimmed to what the screen needs. Full diagnostics stay on runLatest.
      return {
        ok: rec.ok,
        // errorCode and ineligibleReason are NO LONGER returned to the app.
        // `availability.state` carries everything the screen may safely know;
        // the exact reason remains in the server log and founder tooling.
        query: rec.query?.text ?? null,
        historyDays: rec.query?.historyDays ?? null,
        cacheHit: rec.provider?.cacheHit ?? false,
        // ── Phase 5: safe public availability category ─────────────────────
        // Internal codes (COMPS_BUDGET_EXHAUSTED, PROVIDER_TIMEOUT,
        // PROVIDER_NOT_CONFIGURED, FOUNDER_ONLY) are deliberately NOT returned.
        // They were previously in this payload, which put our billing and
        // configuration one error-boundary dump away from a user's screen.
        availability: resolveAvailability({
          ok: rec.ok,
          errorCode: rec.errorCode ?? null,
          ineligibleReason: rec.ineligibleReason ?? null,
          reliableMatchCount: rec.evaluation?.counts.finalSample ?? 0,
          displayMatchCount: rec.displayMatches?.length ?? 0,
          rawCount: rec.provider?.rawCount ?? null,
          filteredOutCount: rec.evaluation?.summary.filteredOutCount ?? null,
        }),

        // ── Phase 2: only ELIGIBLE numbers cross the wire ──────────────────
        // A suppressed median is null here, so the screen cannot render it by
        // mistake. That was the entire bug: summarize() reported "insufficient"
        // and handed over a $65 median anyway.
        publicStats: rec.evaluation?.public ?? null,
        resultState: rec.evaluation?.resultState ?? null,
        confidencePercent: rec.evaluation?.confidencePercent ?? null,
        confidenceLabel: rec.evaluation?.confidenceLabel ?? null,
        countSummary: rec.evaluation?.summary ?? null,
        statsVersion: rec.evaluation?.statsVersion ?? null,
        matchScore: rec.evaluation?.debug.medianMatchScore ?? null,
        examined: rec.provider?.rawCount ?? 0,
        rejectedCount: rec.rejected?.length ?? 0,
        // Why listings were dropped. This was the only thing the removed
        // terminal endpoints gave that the screen did not — it is the fastest
        // signal when a median looks wrong, so it moves here rather than dying
        // with them.
        rejectionCounts: rec.rejectionCounts ?? {},
        // Phase 3 contract: up to three fully normalised matches for the future
        // carousel. Complete titles, validated image URLs, honest marketplace.
        displayMatches: rec.displayMatches ?? [],
        source: rec.source ?? null,
        contractVersion: rec.versions.compContract,
        // Phase 1/2 shape, retained so nothing breaks mid-deploy.
        comps: (rec.displayMatches ?? []).map(m => ({
          title: m.fullTitle, price: m.soldPrice.amount, shipping: m.shippingPrice?.amount ?? null,
          soldAt: m.soldAt, score: m.matchScore, url: m.listingUrl,
        })),
        aiLow: ai.resale_low, aiHigh: ai.resale_high,
      };
    }),
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
  comps: compsRouter,
  monetization: monetizationRouter,
  scan:     appRouter_scan,
  feedback: feedbackRouter,
  system:   systemRouter,
});

export type AppRouter = typeof appRouter;
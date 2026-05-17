import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import * as fs from "fs";
import * as path from "path";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

// ─── One-time analytics reset ─────────────────────────────────────────────────
// Set RESET_ON_STARTUP=true in Railway Variables to wipe analytics on next boot.
// Remove the variable immediately after deploy — it runs ONCE then you delete it.
// Clears: feedback[], events[], sessions[], scanRecords[]
// Preserves: scanCounter, unknown keys, Railway volume

function runStartupResetIfRequested(): void {
  if (process.env.RESET_ON_STARTUP !== "true") return;

  try {
    const DATA_DIR  = process.env.DATA_DIR ?? "/tmp";
    const DATA_FILE = path.join(DATA_DIR, "flipstart-beta.json");
    const TMP_FILE  = DATA_FILE + ".tmp";

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("  ⚠️  RESET_ON_STARTUP=true detected");
    console.log("  Running analytics reset before server starts...");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    if (!fs.existsSync(DATA_FILE)) {
      console.log("  No data file found — nothing to reset. Starting fresh.");
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      return;
    }

    const current = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8")) as Record<string, unknown>;

    // Print before counts
    console.log("  BEFORE:");
    console.log(`    feedback[]    : ${Array.isArray(current.feedback)    ? (current.feedback as unknown[]).length    : 0}`);
    console.log(`    events[]      : ${Array.isArray(current.events)      ? (current.events as unknown[]).length      : 0}`);
    console.log(`    sessions[]    : ${Array.isArray(current.sessions)    ? (current.sessions as unknown[]).length    : 0}`);
    console.log(`    scanRecords[] : ${Array.isArray(current.scanRecords) ? (current.scanRecords as unknown[]).length : 0}`);

    // Backup first
    const timestamp  = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const backupFile = path.join(DATA_DIR, `flipstart-beta-backup-${timestamp}.json`);
    fs.copyFileSync(DATA_FILE, backupFile);
    console.log(`  Backup saved: ${backupFile}`);

    // Clear analytics, preserve everything else
    const reset = { ...current, feedback: [], events: [], sessions: [], scanRecords: [] };
    fs.writeFileSync(TMP_FILE, JSON.stringify(reset, null, 2), "utf-8");
    fs.renameSync(TMP_FILE, DATA_FILE);

    console.log("  AFTER:");
    console.log("    feedback[]    : 0");
    console.log("    events[]      : 0");
    console.log("    sessions[]    : 0");
    console.log("    scanRecords[] : 0");
    console.log("  ✅ Analytics reset complete. Remove RESET_ON_STARTUP from Railway Variables now.");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  } catch (e) {
    console.error("  ❌ Reset failed:", e);
    console.error("  Server will continue starting with existing data.");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  }
}

async function startServer() {
  // Run reset before anything else if requested
  runStartupResetIfRequested();

  const app = express();
  const server = createServer(app);

  // Enable CORS for all routes - reflect the request origin to support credentials
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      res.header("Access-Control-Allow-Origin", origin);
    }
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header(
      "Access-Control-Allow-Headers",
      "Origin, X-Requested-With, Content-Type, Accept, Authorization",
    );
    res.header("Access-Control-Allow-Credentials", "true");

    // Handle preflight requests
    if (req.method === "OPTIONS") {
      res.sendStatus(200);
      return;
    }
    next();
  });

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  registerOAuthRoutes(app);

  app.get("/api/health", (_req, res) => {
    console.log("[health] backend reachable");
    res.json({ ok: true, time: Date.now(), server: "FlipStart API" });
  });

  // ── Scan stats REST endpoint ────────────────────────────────────────────────
  app.get("/api/scan-stats", (_req, res) => {
    try {
      const { getScanStats } = require("../persist");
      res.json(getScanStats());
    } catch (e: any) {
      res.status(500).json({ error: e?.message });
    }
  });

  // ── Founder Analytics Dashboard ──────────────────────────────────────────────
  app.get("/api/dev/dashboard", (req, res) => {
    const secret = process.env.DEV_SECRET;
    if (!secret || req.query.secret !== secret) {
      return res.status(401).send("<h1>401 Unauthorized</h1>");
    }
    try {
      const { generateDashboard } = require("../dashboard");
      const { getAllFeedback, getFeedbackSummary, getScanStats, getAnalyticsSummary } = require("../persist");
      const html = generateDashboard({
        entries:   getAllFeedback(),
        summary:   getFeedbackSummary(),
        scanStats: getScanStats(),
        analytics: getAnalyticsSummary(),
        secret:    req.query.secret as string,
      });
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(html);
    } catch (e: any) {
      res.status(500).send("<pre>Dashboard error: " + (e?.message ?? e) + "</pre>");
    }
  });

  app.get("/api/dev/feedback", (req, res) => {
    const secret = process.env.DEV_SECRET;
    if (!secret || req.query.secret !== secret) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const { getAllFeedback, getFeedbackSummary } = require("../persist");
      res.json({ summary: getFeedbackSummary(), entries: getAllFeedback() });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "persist module not loaded" });
    }
  });

  app.get("/api/dev/feedback.csv", (req, res) => {
    const secret = process.env.DEV_SECRET;
    if (!secret || req.query.secret !== secret) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const { getAllFeedback } = require("../persist");
      const entries = getAllFeedback();
      const header  = "scanId,timestamp,itemName,brand,category,resaleLow,resaleHigh,suggestedBuy,demand,confidenceScore,recommendation,accuracyRating,buyDecision,userEstimatedValue,notes";
      const rows    = entries.map((e: any) =>
        [
          e.scanId, new Date(e.timestamp).toISOString(),
          `"${e.prediction.itemName}"`, `"${e.prediction.brand}"`,
          `"${e.prediction.category}"`, e.prediction.resaleLow,
          e.prediction.resaleHigh, e.prediction.suggestedBuy,
          e.prediction.demand, e.prediction.confidenceScore,
          e.prediction.recommendation,
          e.feedback.accuracyRating ?? "",
          e.feedback.buyDecision    ?? "",
          e.feedback.userEstimatedValue ?? "",
          `"${(e.feedback.notes ?? "").replace(/"/g, "'")}"`,
        ].join(",")
      );
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=flipstart-feedback.csv");
      res.send([header, ...rows].join("\n"));
    } catch (e: any) {
      res.status(500).json({ error: e?.message });
    }
  });

  app.get("/api/dev/analytics-dashboard", (req, res) => {
    const secret = process.env.DEV_SECRET;
    if (!secret || req.query.secret !== secret) {
      return res.status(401).send("<h1>401 Unauthorized</h1>");
    }
    try {
      const { generateAnalyticsDashboard } = require("../analytics-dashboard");
      const { getAllEvents, getAllSessions, getAllScanRecords, getAnalyticsSummary } = require("../persist");
      const html = generateAnalyticsDashboard({
        summary:     getAnalyticsSummary(),
        events:      getAllEvents(),
        sessions:    getAllSessions(),
        scanRecords: getAllScanRecords(),
        secret:      req.query.secret as string,
      });
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(html);
    } catch (e: any) {
      res.status(500).send("<pre>Analytics dashboard error: " + (e?.message ?? e) + "</pre>");
    }
  });

  app.get("/api/dev/analytics", (req, res) => {
    const secret = process.env.DEV_SECRET;
    if (!secret || req.query.secret !== secret) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const { getAllEvents, getAllSessions, getAllScanRecords, getAnalyticsSummary } = require("../persist");
      res.json({
        summary:     getAnalyticsSummary(),
        events:      getAllEvents(),
        sessions:    getAllSessions(),
        scanRecords: getAllScanRecords(),
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message });
    }
  });

  app.get("/api/dev/analytics.csv", (req, res) => {
    const secret = process.env.DEV_SECRET;
    if (!secret || req.query.secret !== secret) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const { getAllEvents } = require("../persist");
      const events = getAllEvents();
      const header = "eventId,eventName,anonymousUserId,sessionId,timestamp,platform,metadata";
      const rows   = events.map((e: any) =>
        [
          e.eventId, e.eventName, e.anonymousUserId, e.sessionId,
          new Date(e.timestamp).toISOString(), e.platform,
          `"${JSON.stringify(e.metadata ?? {}).replace(/"/g, "'")}"`,
        ].join(",")
      );
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=flipstart-analytics.csv");
      res.send([header, ...rows].join("\n"));
    } catch (e: any) {
      res.status(500).json({ error: e?.message });
    }
  });

  app.post("/api/analytics/event", (req, res) => {
    try {
      const { logEvent } = require("../persist");
      const { eventName, anonymousUserId, sessionId, timestamp, platform, metadata } = req.body ?? {};
      if (!eventName || !anonymousUserId) { res.json({ ok: false }); return; }
      logEvent({
        eventName:       String(eventName).slice(0, 64),
        anonymousUserId: String(anonymousUserId).slice(0, 64),
        sessionId:       String(sessionId ?? "no_session").slice(0, 64),
        timestamp:       typeof timestamp === "number" ? timestamp : Date.now(),
        platform:        String(platform ?? "unknown").slice(0, 16),
        metadata:        (metadata && typeof metadata === "object") ? metadata : {},
      });
      res.json({ ok: true });
    } catch {
      res.json({ ok: false });
    }
  });

  app.post("/api/analytics/session/start", (req, res) => {
    try {
      const { startSession } = require("../persist");
      const { sessionId, anonymousUserId, startedAt, platform } = req.body ?? {};
      if (!sessionId || !anonymousUserId) { res.json({ ok: false }); return; }
      startSession({
        sessionId:       String(sessionId).slice(0, 64),
        anonymousUserId: String(anonymousUserId).slice(0, 64),
        startedAt:       typeof startedAt === "number" ? startedAt : Date.now(),
        platform:        String(platform ?? "unknown").slice(0, 16),
      });
      res.json({ ok: true });
    } catch {
      res.json({ ok: false });
    }
  });

  app.post("/api/analytics/session/end", (req, res) => {
    try {
      const { endSession } = require("../persist");
      const b = req.body ?? {};
      if (!b.sessionId || !b.anonymousUserId) { res.json({ ok: false }); return; }
      endSession({
        sessionId:             String(b.sessionId).slice(0, 64),
        anonymousUserId:       String(b.anonymousUserId).slice(0, 64),
        endedAt:               typeof b.endedAt    === "number" ? b.endedAt    : Date.now(),
        durationMs:            typeof b.durationMs  === "number" ? b.durationMs  : 0,
        scanCount:             Number(b.scanCount              ?? 0),
        completedScanCount:    Number(b.completedScanCount     ?? 0),
        failedScanCount:       Number(b.failedScanCount        ?? 0),
        listingGeneratedCount: Number(b.listingGeneratedCount  ?? 0),
        feedbackSubmittedCount:Number(b.feedbackSubmittedCount ?? 0),
      });
      res.json({ ok: true });
    } catch {
      res.json({ ok: false });
    }
  });

  app.post("/api/analytics/scan-record", (req, res) => {
    try {
      const { saveScanRecord } = require("../persist");
      const b = req.body ?? {};
      if (!b.scanId || !b.anonymousUserId) { res.json({ ok: false }); return; }
      saveScanRecord({
        scanId:             String(b.scanId).slice(0, 64),
        anonymousUserId:    String(b.anonymousUserId).slice(0, 64),
        sessionId:          String(b.sessionId ?? "no_session").slice(0, 64),
        timestamp:          typeof b.timestamp === "number" ? b.timestamp : Date.now(),
        imageUri:           String(b.imageUri         ?? ""),
        tagImagePresent:    Boolean(b.tagImagePresent),
        detailImagePresent: Boolean(b.detailImagePresent),
        aiTitle:            String(b.aiTitle          ?? ""),
        aiCategory:         String(b.aiCategory       ?? ""),
        aiBrand:            String(b.aiBrand          ?? ""),
        aiEra:              String(b.aiEra             ?? ""),
        aiMaterial:         String(b.aiMaterial        ?? ""),
        aiRecommendation:   String(b.aiRecommendation  ?? ""),
        aiResaleLow:        Number(b.aiResaleLow       ?? 0),
        aiResaleHigh:       Number(b.aiResaleHigh      ?? 0),
        aiEstimatedValue:   Number(b.aiEstimatedValue  ?? 0),
        aiPlatform:         String(b.aiPlatform        ?? ""),
        aiSellSpeed:        String(b.aiSellSpeed       ?? ""),
        aiDemand:           String(b.aiDemand          ?? ""),
        aiConfidence:       Number(b.aiConfidence      ?? 0),
        styleLabels:        Array.isArray(b.styleLabels) ? b.styleLabels : [],
        riskFlags:          Array.isArray(b.riskFlags)   ? b.riskFlags   : [],
        feedbackId:         null,
        listingIds:         [],
        imageEmbeddingId:   null,
        visualFingerprint:  null,
        similarScanMatchId: null,
        cacheHit:           false,
        cacheConfidence:    null,
      });
      res.json({ ok: true });
    } catch {
      res.json({ ok: false });
    }
  });

  // ── Emergency analytics reset ─────────────────────────────────────────────
  // POST /api/dev/reset-analytics?secret=DEV_SECRET
  // Body: { passcode: "FLIPSTARTDESTRUCTION" }
  // Clears feedback[], events[], sessions[], scanRecords[]. Preserves scanCounter.
  app.post("/api/dev/reset-analytics", (req, res) => {
    const secret = process.env.DEV_SECRET;
    if (!secret || req.query.secret !== secret) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }
    const { passcode } = req.body ?? {};
    if (passcode !== "FLIPSTARTDESTRUCTION") {
      return res.status(403).json({ ok: false, error: "Incorrect passcode." });
    }
    try {
      const DATA_DIR  = process.env.DATA_DIR ?? "/tmp";
      const DATA_FILE = path.join(DATA_DIR, "flipstart-beta.json");
      const TMP_FILE  = DATA_FILE + ".tmp";

      if (!fs.existsSync(DATA_FILE)) {
        return res.json({ ok: true, message: "No data file found — already clean." });
      }

      const current = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8")) as Record<string, unknown>;

      // Backup before clearing
      const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const backupFile = path.join(DATA_DIR, `flipstart-beta-backup-${ts}.json`);
      fs.copyFileSync(DATA_FILE, backupFile);

      const before = {
        feedback:    Array.isArray(current.feedback)    ? (current.feedback as unknown[]).length    : 0,
        events:      Array.isArray(current.events)      ? (current.events as unknown[]).length      : 0,
        sessions:    Array.isArray(current.sessions)    ? (current.sessions as unknown[]).length    : 0,
        scanRecords: Array.isArray(current.scanRecords) ? (current.scanRecords as unknown[]).length : 0,
      };

      // Clear analytics arrays, preserve everything else (scanCounter, unknown keys)
      const reset = { ...current, feedback: [], events: [], sessions: [], scanRecords: [] };
      fs.writeFileSync(TMP_FILE, JSON.stringify(reset, null, 2), "utf-8");
      fs.renameSync(TMP_FILE, DATA_FILE);

      console.log("[reset] Analytics cleared by dashboard emergency reset. Before:", before);
      return res.json({ ok: true, before, backup: backupFile });
    } catch (e: any) {
      console.error("[reset] Failed:", e);
      return res.status(500).json({ ok: false, error: e?.message ?? "Reset failed" });
    }
  });

  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    }),
  );

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, "0.0.0.0", () => {
    console.log(`[api] server listening on http://0.0.0.0:${port}`);
  });
}

startServer().catch(console.error);
import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
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

async function startServer() {
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
  // Reads global.__flipScanCounter — same object routers.ts increments.
  // Date key uses America/Chicago so reset is at midnight Chicago time.
  app.get("/api/scan-stats", (_req, res) => {
    const LIMIT = 200;
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
    const c = (global as any).__flipScanCounter;
    if (!c || c.date !== today) {
      (global as any).__flipScanCounter = { date: today, count: 0 };
    }
    const counter   = (global as any).__flipScanCounter as { date: string; count: number };
    const remaining = Math.max(0, LIMIT - counter.count);
    // Next midnight in Chicago
    const tomorrow  = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(tomorrow);
    res.json({
      globalDailyLimit:          LIMIT,
      globalScansUsedToday:      counter.count,
      globalScansRemainingToday: remaining,
      resetTime:                 new Date(`${tStr}T00:00:00-05:00`).toISOString(),
    });
  });

  // ── Dev feedback inspector — GET /api/dev/feedback ──────────────────────────
  // Protected by DEV_SECRET env var. Set this in Railway environment variables.
  // Access: /api/dev/feedback?secret=YOUR_SECRET
  app.get("/api/dev/feedback", (req, res) => {
    const secret = process.env.DEV_SECRET;
    if (!secret || req.query.secret !== secret) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const { getAllFeedback, getFeedbackSummary } = require("../feedback");
      res.json({
        summary: getFeedbackSummary(),
        entries: getAllFeedback(),
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "feedback module not loaded" });
    }
  });

  // ── Dev feedback CSV export ───────────────────────────────────────────────
  app.get("/api/dev/feedback.csv", (req, res) => {
    const secret = process.env.DEV_SECRET;
    if (!secret || req.query.secret !== secret) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const { getAllFeedback } = require("../feedback");
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
    console.log(`[api] server listening on http://0.0.0.0:${port} — reachable at http://YOUR_LAN_IP:${port}`);
  });
}

startServer().catch(console.error);
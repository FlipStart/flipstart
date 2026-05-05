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
  // Reads global.__flipScanCounter — the SAME counter routers.ts increments.
  // One counter, one source of truth.
  app.get("/api/scan-stats", (_req, res) => {
    const LIMIT = 200;
    const today = new Date().toISOString().slice(0, 10);
    if (!(global as any).__flipScanCounter || (global as any).__flipScanCounter.date !== today) {
      (global as any).__flipScanCounter = { date: today, count: 0 };
    }
    const c         = (global as any).__flipScanCounter as { date: string; count: number };
    const remaining = Math.max(0, LIMIT - c.count);
    const tomorrow  = new Date();
    tomorrow.setUTCHours(24, 0, 0, 0);
    console.log(`[scan-stats] used=${c.count} remaining=${remaining}`);
    res.json({
      globalDailyLimit:          LIMIT,
      globalScansUsedToday:      c.count,
      globalScansRemainingToday: remaining,
      resetTime:                 tomorrow.toISOString(),
    });
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
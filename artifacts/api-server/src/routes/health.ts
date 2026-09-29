import { Router, type IRouter } from "express";
import { getAllowedOrigins } from "../lib/corsConfig";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const router: IRouter = Router();

// Root API endpoint — returns 200 so uptime monitors hitting /api don't get a 404
router.get("/", (_req, res) => {
  res.json({ status: "ok", name: "ChargeBridge API" });
});

// NOTE: allowedOrigins reflects the live cached origin set, not necessarily the
// current env var value. It may lag up to CORS_CACHE_TTL_MS ms (default 60 000)
// behind a recent ALLOWED_ORIGINS / REPLIT_DOMAINS change. Call
// POST /api/admin/cors-cache/reset to force an immediate refresh.
router.get("/healthz", async (_req, res) => {
  const t0 = Date.now();
  let dbStatus: "ok" | "error" = "ok";
  try {
    await db.execute(sql`SELECT 1`);
  } catch {
    dbStatus = "error";
  }
  const dbLatencyMs = Date.now() - t0;

  const httpStatus = dbStatus === "ok" ? 200 : 503;
  res.status(httpStatus).json({
    status: dbStatus === "ok" ? "ok" : "degraded",
    allowedOrigins: Array.from(getAllowedOrigins()),
    db: { status: dbStatus, latencyMs: dbLatencyMs },
  });
});

export default router;

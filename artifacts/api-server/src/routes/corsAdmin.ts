import { Router } from "express";
import { getAuth } from "@clerk/express";
import { isAdmin } from "../middlewares/requireAuth";
import { resetAllowedOriginsCache, getAllowedOrigins } from "../lib/corsConfig";
import { logger } from "../lib/logger";

const router = Router();

/**
 * POST /api/admin/cors-cache/reset
 *
 * Immediately invalidates the in-memory CORS origin cache so the next CORS
 * check rebuilds it from current env vars. Useful when an operator updates
 * ALLOWED_ORIGINS or REPLIT_DOMAINS without restarting the server.
 *
 * Requires admin role.
 */
router.post("/admin/cors-cache/reset", (req, res) => {
  const auth = getAuth(req);
  if (!isAdmin(auth)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  resetAllowedOriginsCache();

  const freshOrigins = Array.from(getAllowedOrigins());
  logger.info({ origins: freshOrigins }, "CORS origin cache flushed by admin");

  return res.json({ ok: true, allowedOrigins: freshOrigins });
});

export default router;

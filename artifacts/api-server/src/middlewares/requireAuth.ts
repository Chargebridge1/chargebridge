import { getAuth } from "@clerk/express";
import { createHash } from "crypto";
import type { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { stationsTable, chargingSessionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// ── Helpers ───────────────────────────────────────────────────────────────────

const GUEST_READ_ACCESS_TTL_MS = 2 * 60 * 60 * 1000;
const GUEST_READABLE_SESSION_STATUSES = new Set(["pending", "stopping", "completed"]);

function parsePositiveId(value: string | string[] | undefined): number | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function isAdmin(auth: ReturnType<typeof getAuth>): boolean {
  if (!auth?.userId) return false;
  // Check ADMIN_CLERK_USER_IDS env var (comma-separated)
  const envIds = (process.env.ADMIN_CLERK_USER_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (envIds.includes(auth.userId)) return true;
  // Check Clerk public metadata role claim
  const claims = auth.sessionClaims as { publicMetadata?: { role?: string } } | null;
  return claims?.publicMetadata?.role === "admin";
}

// ── Auth DIAG manifest ────────────────────────────────────────────────────────
// Exported so /api/version can report instrumentation status by referencing
// live code rather than line numbers (which change with every build).

export const AUTH_DIAG = {
  /** Bump this string when the shape or fields of the DIAG log change. */
  version: "AuthDiag v1",
  status: "ENABLED",
  /** True means the WARN block below is compiled and will execute. */
  compiled: true,
  /** Fields emitted inside every requireAuth_rejected WARN log entry. */
  fields: ["hasAuthHeader", "authHeaderPrefix", "clerkUserId", "clerkSessionId"],
} as const;

// ── requireAuth — 401 if not authenticated ────────────────────────────────────

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const auth = getAuth(req);
  if (!auth?.userId) {
    // [DIAG] Log auth state when rejecting so server logs show exactly what
    // Clerk returned — distinguishes missing token from invalid/expired token.
    req.log.warn({
      diag: "requireAuth_rejected",
      method: req.method,
      path: req.path,
      hasAuthHeader: !!req.headers.authorization,
      authHeaderPrefix: req.headers.authorization
        ? req.headers.authorization.substring(0, 15) + "…"
        : null,
      clerkUserId: auth?.userId ?? null,
      clerkSessionId: auth?.sessionId ?? null,
    }, "[requireAuth] 401 — no userId from clerkMiddleware");
    return res.status(401).json({ error: "Unauthorized" });
  }
  (req as any).clerkUserId = auth.userId;
  return next();
}

// ── requireAdmin — 401 unauthenticated, 403 non-admin ────────────────────────

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const auth = getAuth(req);
  if (!auth?.userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!isAdmin(auth)) {
    return res.status(403).json({ error: "Forbidden — admin access required" });
  }
  (req as any).clerkUserId = auth.userId;
  return next();
}

// ── requireStationOwnerOrAdmin ────────────────────────────────────────────────
// Requires the caller to be the station owner (stations.ownerClerkUserId) or admin.
// Reads station ID from req.params.id. Attaches req.station for downstream use.

export async function requireStationOwnerOrAdmin(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const auth = getAuth(req);
  if (!auth?.userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (isAdmin(auth)) {
    (req as any).clerkUserId = auth.userId;
    return next();
  }

  const stationId = parsePositiveId(req.params.id ?? req.params.stationId);
  if (stationId === null) {
    return res.status(400).json({ error: "Invalid station ID" });
  }

  const [station] = await db
    .select({ id: stationsTable.id, ownerClerkUserId: stationsTable.ownerClerkUserId })
    .from(stationsTable)
    .where(eq(stationsTable.id, stationId))
    .limit(1);

  if (!station) {
    return res.status(404).json({ error: "Station not found" });
  }

  if (!station.ownerClerkUserId || station.ownerClerkUserId !== auth.userId) {
    return res.status(403).json({ error: "Forbidden — station owner or admin access required" });
  }

  (req as any).clerkUserId = auth.userId;
  (req as any).station = station;
  return next();
}

// ── requireChargingSessionOwnerOrAdmin ────────────────────────────────────────
// Accepts (in priority order):
//   1. Authenticated admin — can act on any session
//   2. Authenticated session owner — clerkUserId matches the session's owner
//   3. Authenticated station owner — owns the station tied to this session;
//      this is the "secondary credential" that lets station owners stop
//      orphaned sessions even when the original guest token is lost/expired
//   4. Valid guest token in the X-Guest-Token header
//
// Attaches req.chargingSession (and req.clerkUserId when authenticated).

async function authorizeChargingSession(
  req: Request,
  res: Response,
  next: NextFunction,
  options: { guestReadPolicy: boolean }
) {
  const auth = getAuth(req);
  const id = parsePositiveId(req.params.id ?? req.params.sessionId);
  if (id === null) {
    return res.status(400).json({ error: "Invalid session ID" });
  }

  const [session] = await db
    .select()
    .from(chargingSessionsTable)
    .where(eq(chargingSessionsTable.id, id))
    .limit(1);

  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  (req as any).chargingSession = session;

  // Authenticated path
  if (auth?.userId) {
    // 1. Admin — can act on any session
    if (isAdmin(auth)) {
      (req as any).clerkUserId = auth.userId;
      return next();
    }

    // 2. Session owner
    if (session.clerkUserId && session.clerkUserId === auth.userId) {
      (req as any).clerkUserId = auth.userId;
      return next();
    }

    // 3. Station owner — fallback credential for owners whose guest
    //    sessions have an expired/lost token but the charger is still running.
    //    Skip if the station has been deleted (stationId is null).
    const [station] = session.stationId != null
      ? await db
          .select({ ownerClerkUserId: stationsTable.ownerClerkUserId })
          .from(stationsTable)
          .where(eq(stationsTable.id, session.stationId))
          .limit(1)
      : [];

    if (station?.ownerClerkUserId && station.ownerClerkUserId === auth.userId) {
      (req as any).clerkUserId = auth.userId;
      return next();
    }

    // Authenticated but not session owner, station owner, or admin
    return res.status(403).json({ error: "Forbidden — not your charging session" });
  }

  // Guest token path
  const guestToken = req.headers["x-guest-token"] as string | undefined;
  if (guestToken && session.guestTokenHash) {
    const hash = createHash("sha256").update(guestToken).digest("hex");
    if (hash === session.guestTokenHash) {
      if (options.guestReadPolicy) {
        const createdAtMs = session.createdAt?.getTime();
        const expired = typeof createdAtMs !== "number"
          || !Number.isFinite(createdAtMs)
          || Date.now() - createdAtMs >= GUEST_READ_ACCESS_TTL_MS;
        if (expired || !GUEST_READABLE_SESSION_STATUSES.has(session.status)) {
          return res.status(403).json({ error: "Forbidden — guest access unavailable" });
        }
      }
      return next();
    }
    return res.status(403).json({ error: "Forbidden — invalid guest token" });
  }

  // No auth and no guest token
  return res.status(401).json({ error: "Unauthorized" });
}

export async function requireChargingSessionOwnerOrAdmin(
  req: Request,
  res: Response,
  next: NextFunction
) {
  return authorizeChargingSession(req, res, next, {
    // Only Stage 1 read/invoice/receipt routes set this marker. Operational
    // start/stop routes retain their existing guest-token lifecycle.
    guestReadPolicy: (req as any).guestReadPolicy === true,
  });
}

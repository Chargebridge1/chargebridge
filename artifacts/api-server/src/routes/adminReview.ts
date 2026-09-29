import { Router } from "express";
import { randomBytes } from "crypto";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import {
  stationsTable,
  operatorApplicationsTable,
  reviewLogsTable,
  reviewerAccessTable,
  usersTable,
  adminEventsTable,
  adminRoleEventsTable,
  stationStatusReportsTable,
  chargingHistoryTable,
  chargingSessionsTable,
  stripeRefundJobsTable,
} from "@workspace/db";
import { eq, ne, desc, inArray, or, sql, and, gte, lte } from "drizzle-orm";
import { logger } from "../lib/logger";
import { isAdmin } from "../middlewares/requireAuth";

// ── In-memory store for pending hard-delete confirmation tokens ───────────────
// token → { stationId, adminClerkId, expiresAt }
const pendingDeleteTokens = new Map<string, { stationId: number; adminClerkId: string; expiresAt: number }>();
const DELETE_TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ── In-memory audit gap store ─────────────────────────────────────────────────
// When an adminRoleEventsTable insert fails after a Clerk role change, the role
// change is already live but the audit record is missing. We record each failure
// here so the admin panel can surface a visible warning. Entries are kept for
// 24 hours; the server restart clears them (acceptable — this is a "recent
// failures" signal, not a persistent audit trail; a retry queue is a separate concern).

export interface AuditGap {
  detectedAt: string;   // ISO timestamp of when the failure was detected
  action: string;       // e.g. "promote_admin"
  actorClerkId: string;
  actorName: string | null;
  targetClerkId: string;
  targetEmail: string;
  targetName: string | null;
}

const AUDIT_GAP_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const auditGapStore: AuditGap[] = [];

function recordAuditGap(gap: Omit<AuditGap, "detectedAt">): void {
  // Prune stale entries first
  const cutoff = Date.now() - AUDIT_GAP_TTL_MS;
  for (let i = auditGapStore.length - 1; i >= 0; i--) {
    if (new Date(auditGapStore[i].detectedAt).getTime() < cutoff) {
      auditGapStore.splice(i, 1);
    }
  }
  auditGapStore.push({ ...gap, detectedAt: new Date().toISOString() });
}

// ── Audit-insert retry helper ─────────────────────────────────────────────────
// Wraps a single DB insert with up to AUDIT_RETRY_ATTEMPTS tries, separated by
// AUDIT_RETRY_DELAY_MS. On success it returns immediately. If every attempt
// fails, it calls onAllFailed with the last error so the caller can log and/or
// record an audit gap — preserving exactly the same observable behaviour as the
// original bare try/catch while recovering from transient DB blips.

const AUDIT_RETRY_ATTEMPTS = 3;
const AUDIT_RETRY_DELAY_MS = 2_000;

async function withAuditRetry(
  fn: () => Promise<unknown>,
  onAllFailed: (err: unknown) => void,
): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= AUDIT_RETRY_ATTEMPTS; attempt++) {
    try {
      await fn();
      return;
    } catch (err) {
      lastErr = err;
      if (attempt < AUDIT_RETRY_ATTEMPTS) {
        await new Promise<void>((resolve) => setTimeout(resolve, AUDIT_RETRY_DELAY_MS));
      }
    }
  }
  onAllFailed(lastErr);
}

const router = Router();

// ── Clerk fetch with AbortController timeout ──────────────────────────────────
// A slow or unresponsive Clerk API call would otherwise hang the route handler
// indefinitely, preventing audit rows from being written. We cap every Clerk
// call at 10 seconds and return null on timeout so callers can decide how to
// proceed (fail the request vs. continue to the audit insert).
const CLERK_TIMEOUT_MS = 10_000;

async function clerkFetch(
  url: string,
  options: RequestInit,
): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLERK_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err: any) {
    if (err?.name === "AbortError") {
      logger.warn({ url }, "Clerk API call timed out after 10 s");
      return null;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ── Exported helper: delete a station and all non-cascaded child rows ──────────
//
// HOW STATION DELETION WORKS
// ──────────────────────────
// When the station row is deleted, the DB automatically removes or nulls any child
// row whose stationId column carries an ON DELETE CASCADE / SET NULL foreign key:
//
//   reviews          — CASCADE (deleted automatically)
//   favorites        — CASCADE (deleted automatically)
//   stationPhotos    — CASCADE (deleted automatically)
//   stationCheckins  — CASCADE (deleted automatically)
//   chargingSessions — SET NULL (stationId nulled automatically + explicit step in deleteStationChildren)
//   ocpiTariffs      — SET NULL (stationId nulled automatically)
//
// Two tables store stationId as TEXT so they can also reference external/OCPI
// stations. They have NO foreign key, so they are NOT covered by any DB cascade
// and MUST be handled explicitly inside this function:
//
//   [x] stationStatusReports — DELETED on hard-delete
//         Rationale: ephemeral operational data; has no user-facing value once the
//         station is gone. Keyed as "db-<id>" or "<id>" (legacy bare integer string).
//
//   [x] chargingHistory — stationId NULLED on hard-delete (rows preserved)
//         Rationale: user billing/session records; must survive station removal so
//         drivers retain a complete history. The stationName column is denormalized
//         and preserved, so the entry stays readable without an active station link.
//         Keyed as "db-<id>" or "<id>" (legacy bare integer string).
//
// ── DEVELOPER CHECKLIST — adding a new table that references a station ────────
//
// Before merging, decide which of the three patterns applies to your new table:
//
//   A) Integer stationId with .references(() => stationsTable.id, { onDelete: "cascade" })
//      → Nothing to do here; the DB cascade handles deletion automatically.
//
//   B) Integer stationId with .references(() => stationsTable.id, { onDelete: "set null" })
//      → Nothing to do here; the DB nulls the column automatically.
//
//   C) Text stationId (needed to reference external/OCPI stations — no FK possible)
//      → YOU MUST add an explicit step in deleteStationChildren() below.
//        Choose one of:
//          • DELETE the rows (ephemeral/operational data, no user value)
//          • NULL the stationId (user data that must survive the station removal)
//        Then add an [x] entry to this comment listing the table name and the
//        chosen policy + rationale so the next developer understands the intent.
//
// To audit which tables currently have a text stationId without an FK constraint,
// run this query against the database (requires psql or Drizzle Studio access):
//
//   SELECT
//     c.table_name,
//     c.column_name,
//     c.data_type
//   FROM information_schema.columns c
//   WHERE c.table_schema = 'public'
//     AND c.column_name IN ('station_id', 'stationId')
//     AND c.data_type IN ('text', 'character varying')
//     AND NOT EXISTS (
//       SELECT 1
//       FROM information_schema.key_column_usage kcu
//       JOIN information_schema.referential_constraints rc
//         ON rc.constraint_name = kcu.constraint_name
//       WHERE kcu.table_name   = c.table_name
//         AND kcu.column_name  = c.column_name
//     )
//   ORDER BY c.table_name;
//
// Any table returned by that query but NOT listed with an [x] above is missing
// a hard-delete policy and will silently orphan rows when a station is deleted.
//
// ─────────────────────────────────────────────────────────────────────────────
// This function is exported so it can be called in integration tests, ensuring the
// test exercises the exact same deletion path as the production route handler.

type DeleteTx = Parameters<Parameters<(typeof db)["transaction"]>[0]>[0];

export async function deleteStationChildren(
  tx: DeleteTx,
  stationId: number,
): Promise<void> {
  await tx.delete(stationStatusReportsTable).where(
    or(
      eq(stationStatusReportsTable.stationId, `db-${stationId}`),
      eq(stationStatusReportsTable.stationId, String(stationId)),
    ),
  );
  // Null out stationId rather than deleting — users keep their charging history
  // records with the station name intact; only the active station link is cleared.
  await tx.update(chargingHistoryTable).set({ stationId: null }).where(
    or(
      eq(chargingHistoryTable.stationId, `db-${stationId}`),
      eq(chargingHistoryTable.stationId, String(stationId)),
    ),
  );
  // Null out stationId on charging sessions — users retain a complete record of
  // every charging session (billing history) even after the station is removed.
  // The stationName column preserves the display name for history entries.
  // The FK is ON DELETE SET NULL so the DB would handle this automatically,
  // but we do it explicitly here to match the chargingHistory pattern and
  // ensure the update runs inside the same transaction as the station delete.
  await tx.update(chargingSessionsTable).set({ stationId: null }).where(
    eq(chargingSessionsTable.stationId, stationId),
  );
  await tx.delete(stationsTable).where(eq(stationsTable.id, stationId));
}

// ── POST /api/admin/claim — first-time admin setup via env key ────────────────

router.post("/admin/claim", async (req, res) => {
  const auth = getAuth(req as any);
  if (!auth?.userId) return res.status(401).json({ error: "You must be signed in to claim admin access." });

  const { key } = req.body as { key?: string };
  const setupKey = process.env.ADMIN_SETUP_KEY;

  if (!setupKey) return res.status(500).json({ error: "Admin setup key not configured on server." });
  if (!key || key.trim() !== setupKey.trim()) return res.status(403).json({ error: "Incorrect setup key. Check your ADMIN_SETUP_KEY environment variable." });

  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) return res.status(500).json({ error: "Server Clerk integration not configured." });

  const clerkRes = await clerkFetch(`https://api.clerk.com/v1/users/${auth.userId}/metadata`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ public_metadata: { role: "admin" } }),
  });

  if (!clerkRes) {
    logger.error({ userId: auth.userId }, "Clerk metadata update timed out during admin claim");
    return res.status(504).json({ error: "Clerk API timed out. Try again." });
  }
  if (!clerkRes.ok) {
    const err = await clerkRes.text();
    logger.error({ err }, "Clerk metadata update failed during admin claim");
    return res.status(500).json({ error: "Failed to update role. Check server logs." });
  }

  logger.info({ userId: auth.userId }, "Admin role claimed via setup key");
  return res.json({ ok: true });
});

// ── Auth helpers ─────────────────────────────────────────────────────────────

function getAdminRole(req: any): "admin" | null {
  const auth = getAuth(req);
  if (isAdmin(auth)) return "admin";
  return null;
}

async function getReviewAccess(req: any): Promise<{ clerkId: string; role: "admin" | "reviewer" } | null> {
  const auth = getAuth(req);
  if (!auth?.userId) return null;

  const adminRole = getAdminRole(req);
  if (adminRole) return { clerkId: auth.userId, role: "admin" };

  const [reviewer] = await db
    .select()
    .from(reviewerAccessTable)
    .where(eq(reviewerAccessTable.clerkId, auth.userId))
    .limit(1);

  if (reviewer) return { clerkId: auth.userId, role: "reviewer" };
  return null;
}

async function middlewareReviewAccess(req: any, res: any, next: any) {
  const access = await getReviewAccess(req);
  if (!access) return res.status(403).json({ error: "Forbidden — admin or reviewer access required" });
  req.reviewAccess = access;
  return next();
}

function middlewareAdminOnly(req: any, res: any, next: any) {
  if (req.reviewAccess?.role !== "admin") return res.status(403).json({ error: "Admin-only action" });
  return next();
}

async function getAdminName(clerkId: string): Promise<string | null> {
  const [u] = await db.select({ name: usersTable.name, email: usersTable.email })
    .from(usersTable).where(eq(usersTable.clerkId, clerkId)).limit(1);
  return u ? (u.name ?? u.email) : null;
}

// ── GET /api/admin/review-queue ───────────────────────────────────────────────

router.get("/admin/review-queue", middlewareReviewAccess, async (req: any, res) => {
  try {
    const [pendingStations, pendingApps] = await Promise.all([
      db.select().from(stationsTable)
        .where(eq(stationsTable.status, "pending"))
        .orderBy(desc(stationsTable.createdAt)),
      db.select().from(operatorApplicationsTable)
        .where(inArray(operatorApplicationsTable.status, ["pending", "reviewing"]))
        .orderBy(desc(operatorApplicationsTable.createdAt)),
    ]);
    return res.json({ stations: pendingStations, applications: pendingApps });
  } catch (err) {
    logger.error({ err }, "Failed to fetch review queue");
    return res.status(500).json({ error: "Failed to fetch review queue" });
  }
});

// ── GET /api/admin/review-stats ──────────────────────────────────────────────

router.get("/admin/review-stats", middlewareReviewAccess, async (req: any, res) => {
  try {
    const isAdminUser = req.reviewAccess?.role === "admin";
    const [stations, apps, removed] = await Promise.all([
      db.select({ id: stationsTable.id }).from(stationsTable).where(eq(stationsTable.status, "pending")),
      db.select({ id: operatorApplicationsTable.id }).from(operatorApplicationsTable)
        .where(inArray(operatorApplicationsTable.status, ["pending", "reviewing"])),
      isAdminUser
        ? db.select({ id: stationsTable.id }).from(stationsTable).where(sql`${stationsTable.status} = 'removed'`)
        : Promise.resolve([]),
    ]);
    return res.json({
      pendingStations: stations.length,
      pendingApplications: apps.length,
      removedStations: removed.length,
    });
  } catch (err) {
    logger.error({ err }, "Failed to fetch review stats");
    return res.status(500).json({ error: "Failed to fetch stats" });
  }
});

// ── PATCH /api/admin/stations/:id/review ─────────────────────────────────────

router.patch("/admin/stations/:id/review", middlewareReviewAccess, async (req: any, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  const { action, notes } = req.body as { action: "approved" | "rejected" | "reviewing"; notes?: string };
  if (!["approved", "rejected", "reviewing"].includes(action)) {
    return res.status(400).json({ error: "action must be approved | rejected | reviewing" });
  }

  try {
    const [existing] = await db.select().from(stationsTable).where(eq(stationsTable.id, id)).limit(1);
    if (!existing) return res.status(404).json({ error: "Station not found" });
    if (existing.status === "removed") {
      return res.status(409).json({ error: "Station has been removed and cannot be reviewed. Use the restore endpoint to reinstate it first." });
    }

    const newStatus = action === "approved" ? "available" : action === "rejected" ? "offline" : "pending";
    const adminName = await getAdminName(req.reviewAccess.clerkId);

    const [updated] = await db.update(stationsTable)
      .set({
        status: newStatus as any,
        reviewedBy: req.reviewAccess.clerkId,
        reviewedAt: new Date(),
        adminNotes: notes ?? null,
      })
      .where(eq(stationsTable.id, id))
      .returning();

    await db.insert(reviewLogsTable).values({
      entityType: "station",
      entityId: id,
      entityName: existing.name,
      adminClerkId: req.reviewAccess.clerkId,
      adminName,
      action,
      previousAction: existing.status,
      notes: notes ?? null,
    });

    logger.info({ id, action, admin: req.reviewAccess.clerkId }, "Station review action");
    return res.json(updated);
  } catch (err) {
    logger.error({ err }, "Failed to review station");
    return res.status(500).json({ error: "Failed to review station" });
  }
});

// ── PATCH /api/admin/operator-applications/:id/review ────────────────────────

router.patch("/admin/operator-applications/:id/review", middlewareReviewAccess, async (req: any, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  const { action, notes } = req.body as { action: "approved" | "rejected" | "reviewing" | "pending"; notes?: string };
  if (!["approved", "rejected", "reviewing", "pending"].includes(action)) {
    return res.status(400).json({ error: "action must be approved | rejected | reviewing | pending" });
  }

  try {
    const [existing] = await db.select().from(operatorApplicationsTable)
      .where(eq(operatorApplicationsTable.id, id)).limit(1);
    if (!existing) return res.status(404).json({ error: "Application not found" });

    const adminName = await getAdminName(req.reviewAccess.clerkId);

    const [updated] = await db.update(operatorApplicationsTable)
      .set({
        status: action as any,
        reviewedBy: req.reviewAccess.clerkId,
        reviewedAt: new Date(),
        adminNotes: notes ?? null,
      })
      .where(eq(operatorApplicationsTable.id, id))
      .returning();

    await db.insert(reviewLogsTable).values({
      entityType: "operator_application",
      entityId: id,
      entityName: existing.companyName,
      adminClerkId: req.reviewAccess.clerkId,
      adminName,
      action,
      previousAction: existing.status,
      notes: notes ?? null,
    });

    logger.info({ id, action, admin: req.reviewAccess.clerkId }, "Operator application review action");
    return res.json(updated);
  } catch (err) {
    logger.error({ err }, "Failed to review application");
    return res.status(500).json({ error: "Failed to review application" });
  }
});

// ── GET /api/admin/review-logs ───────────────────────────────────────────────
// Query params:
//   action    — "approved" | "rejected" | "reviewing" | "restored"
//               "restored" is a virtual value: action='approved' AND previousAction='removed'
//               "approved" excludes restored entries (previousAction IS DISTINCT FROM 'removed')
//   since     — YYYY-MM-DD (inclusive day start, UTC)
//   until     — YYYY-MM-DD (inclusive day end, UTC)
//   limit     — max rows (default 100, max 200)
//   entityType — "station" | "operator_application"
// Returns: { logs, total }

router.get("/admin/review-logs", middlewareReviewAccess, async (req: any, res) => {
  try {
    const {
      entityType,
      limit = "100",
      action,
      since: sinceStr,
      until: untilStr,
    } = req.query as { entityType?: string; limit?: string; action?: string; since?: string; until?: string };

    const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
    if (sinceStr && !ISO_DATE.test(sinceStr.trim())) {
      return res.status(400).json({ error: "Invalid 'since' date — use YYYY-MM-DD" });
    }
    if (untilStr && !ISO_DATE.test(untilStr.trim())) {
      return res.status(400).json({ error: "Invalid 'until' date — use YYYY-MM-DD" });
    }
    const since = sinceStr?.trim() ? new Date(`${sinceStr.trim()}T00:00:00.000Z`) : null;
    const until = untilStr?.trim() ? new Date(`${untilStr.trim()}T23:59:59.999Z`) : null;

    let actionCondition;
    if (action === "restored") {
      actionCondition = eq(reviewLogsTable.previousAction, "removed");
    } else if (action === "approved") {
      actionCondition = and(
        eq(reviewLogsTable.action, "approved"),
        sql`${reviewLogsTable.previousAction} IS DISTINCT FROM 'removed'`,
      );
    } else if (action === "rejected" || action === "reviewing" || action === "pending") {
      actionCondition = eq(reviewLogsTable.action, action as "rejected" | "reviewing" | "pending");
    }

    const entityCondition =
      entityType === "station" || entityType === "operator_application"
        ? eq(reviewLogsTable.entityType, entityType)
        : undefined;

    const whereClause = and(
      entityCondition,
      actionCondition,
      since ? gte(reviewLogsTable.createdAt, since) : undefined,
      until ? lte(reviewLogsTable.createdAt, until) : undefined,
    );

    const cap = Math.min(Number(limit), 200);
    const [logs, countResult] = await Promise.all([
      db.select().from(reviewLogsTable).where(whereClause).orderBy(desc(reviewLogsTable.createdAt)).limit(cap),
      db.select({ count: sql<number>`count(*)::int` }).from(reviewLogsTable).where(whereClause),
    ]);

    return res.json({ logs, total: countResult[0]?.count ?? 0 });
  } catch (err) {
    logger.error({ err }, "Failed to fetch review logs");
    return res.status(500).json({ error: "Failed to fetch review logs" });
  }
});

// ── GET /api/admin/reviewers ──────────────────────────────────────────────────

router.get("/admin/reviewers", middlewareReviewAccess, middlewareAdminOnly, async (_req, res) => {
  try {
    const reviewers = await db.select().from(reviewerAccessTable)
      .orderBy(desc(reviewerAccessTable.createdAt));
    return res.json(reviewers);
  } catch (err) {
    logger.error({ err }, "Failed to fetch reviewers");
    return res.status(500).json({ error: "Failed to fetch reviewers" });
  }
});

// ── POST /api/admin/reviewers — grant access by email ─────────────────────────

router.post("/admin/reviewers", middlewareReviewAccess, middlewareAdminOnly, async (req: any, res) => {
  const { email } = req.body as { email: string };
  if (!email?.includes("@")) return res.status(400).json({ error: "Valid email required" });

  try {
    const [user] = await db.select().from(usersTable)
      .where(sql`lower(${usersTable.email}) = lower(${email.trim()})`)
      .limit(1);
    if (!user) return res.status(404).json({ error: "User not found. They must have signed in to ChargeBridge at least once." });

    const adminName = await getAdminName(req.reviewAccess.clerkId);

    // Use onConflictDoNothing so two concurrent grant requests for the same
    // user are handled atomically by the DB's UNIQUE constraint on clerkId.
    // If the row already exists the INSERT is silently skipped and returning()
    // yields an empty array — we surface that as a clean 409 to both callers.
    const [granted] = await db.insert(reviewerAccessTable).values({
      clerkId: user.clerkId,
      email: user.email,
      name: user.name ?? null,
      grantedBy: req.reviewAccess.clerkId,
      grantedByName: adminName,
    }).onConflictDoNothing().returning();
    if (!granted) return res.status(409).json({ error: "User already has reviewer access" });

    // Update Clerk metadata to reflect reviewer role.
    // The DB row (reviewerAccessTable) is the source of truth — Clerk metadata
    // is a cache for JWT claims. Wrap this call so a Clerk timeout or network
    // error never causes us to skip the audit inserts below.
    const secretKey = process.env.CLERK_SECRET_KEY;
    if (secretKey) {
      try {
        const clerkRes = await clerkFetch(`https://api.clerk.com/v1/users/${user.clerkId}/metadata`, {
          method: "PATCH",
          headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ public_metadata: { role: "reviewer" } }),
        });
        if (!clerkRes) {
          logger.warn({ clerkId: user.clerkId }, "Clerk metadata update timed out after promote_reviewer — reviewer access is active in DB; Clerk role may be stale until next sign-in");
        } else if (!clerkRes.ok) {
          const clerkErr = await clerkRes.text();
          logger.warn({ clerkErr, clerkId: user.clerkId }, "Clerk metadata update returned non-OK after promote_reviewer — reviewer access is active in DB");
        }
      } catch (clerkErr) {
        logger.warn({ clerkErr, clerkId: user.clerkId }, "Clerk metadata update failed after promote_reviewer — reviewer access is active in DB");
      }
    }

    // Each audit insert uses withAuditRetry (3 attempts, 2 s apart) so a
    // transient DB blip has a recovery path before the error is logged/recorded.
    // A failure of one insert never prevents the other from being attempted.
    await withAuditRetry(
      () => db.insert(adminRoleEventsTable).values({
        action: "promote_reviewer",
        actorClerkId: req.reviewAccess.clerkId,
        actorName: adminName,
        targetClerkId: user.clerkId,
        targetEmail: user.email,
        targetName: user.name ?? null,
      }),
      (auditErr) => {
        logger.error({ auditErr, targetClerkId: user.clerkId, actorClerkId: req.reviewAccess.clerkId }, "adminRoleEventsTable insert failed after promote_reviewer — role change already applied");
        recordAuditGap({ action: "promote_reviewer", actorClerkId: req.reviewAccess.clerkId, actorName: adminName, targetClerkId: user.clerkId, targetEmail: user.email, targetName: user.name ?? null });
      },
    );

    await withAuditRetry(
      () => db.insert(adminEventsTable).values({
        adminClerkId: req.reviewAccess.clerkId,
        action: "grant_reviewer",
        targetType: "user",
        targetName: user.name ?? user.email,
        details: JSON.stringify({ targetClerkId: user.clerkId, email: user.email, role: "reviewer" }),
      }),
      (auditErr) => {
        logger.error({ auditErr, targetClerkId: user.clerkId, actorClerkId: req.reviewAccess.clerkId }, "adminEventsTable insert failed after promote_reviewer — role change already applied");
      },
    );

    logger.info({ clerkId: user.clerkId, grantedBy: req.reviewAccess.clerkId }, "Reviewer access granted");
    return res.status(201).json(granted);
  } catch (err) {
    logger.error({ err }, "Failed to grant reviewer access");
    return res.status(500).json({ error: "Failed to grant access" });
  }
});

// ── DELETE /api/admin/reviewers/:clerkId — revoke access ─────────────────────

router.delete("/admin/reviewers/:clerkId", middlewareReviewAccess, middlewareAdminOnly, async (req: any, res) => {
  const { clerkId } = req.params;
  try {
    await db.delete(reviewerAccessTable).where(eq(reviewerAccessTable.clerkId, clerkId));

    // Update Clerk metadata — best effort, same as the grant path.
    // The DB delete above is the authoritative revocation; Clerk metadata is a
    // cache. A timeout or network error must not skip the audit inserts below.
    const secretKey = process.env.CLERK_SECRET_KEY;
    if (secretKey) {
      try {
        const clerkRes = await clerkFetch(`https://api.clerk.com/v1/users/${clerkId}/metadata`, {
          method: "PATCH",
          headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ public_metadata: { role: null } }),
        });
        if (!clerkRes) {
          logger.warn({ clerkId }, "Clerk metadata update timed out after revoke_reviewer — access is revoked in DB; Clerk role may be stale until next sign-in");
        } else if (!clerkRes.ok) {
          const clerkErr = await clerkRes.text();
          logger.warn({ clerkErr, clerkId }, "Clerk metadata update returned non-OK after revoke_reviewer — access is revoked in DB");
        }
      } catch (clerkErr) {
        logger.warn({ clerkErr, clerkId }, "Clerk metadata update failed after revoke_reviewer — access is revoked in DB");
      }
    }

    const [revokedUser] = await db.select({ email: usersTable.email, name: usersTable.name })
      .from(usersTable).where(eq(usersTable.clerkId, clerkId)).limit(1);
    const actorName = await getAdminName(req.reviewAccess.clerkId);

    // Each audit insert uses withAuditRetry (3 attempts, 2 s apart) so a
    // transient DB blip has a recovery path before the error is logged/recorded.
    // A failure of one insert never prevents the other from being attempted.
    await withAuditRetry(
      () => db.insert(adminRoleEventsTable).values({
        action: "revoke_reviewer",
        actorClerkId: req.reviewAccess.clerkId,
        actorName,
        targetClerkId: clerkId,
        targetEmail: revokedUser?.email ?? clerkId,
        targetName: revokedUser?.name ?? null,
      }),
      (auditErr) => {
        logger.error({ auditErr, targetClerkId: clerkId, actorClerkId: req.reviewAccess.clerkId }, "adminRoleEventsTable insert failed after revoke_reviewer — role change already applied");
        recordAuditGap({ action: "revoke_reviewer", actorClerkId: req.reviewAccess.clerkId, actorName, targetClerkId: clerkId, targetEmail: revokedUser?.email ?? clerkId, targetName: revokedUser?.name ?? null });
      },
    );

    await withAuditRetry(
      () => db.insert(adminEventsTable).values({
        adminClerkId: req.reviewAccess.clerkId,
        action: "revoke_reviewer",
        targetType: "user",
        targetName: revokedUser?.name ?? revokedUser?.email ?? clerkId,
        details: JSON.stringify({ targetClerkId: clerkId, email: revokedUser?.email ?? null, role: "reviewer" }),
      }),
      (auditErr) => {
        logger.error({ auditErr, targetClerkId: clerkId, actorClerkId: req.reviewAccess.clerkId }, "adminEventsTable insert failed after revoke_reviewer — role change already applied");
      },
    );

    logger.info({ clerkId, revokedBy: req.reviewAccess.clerkId }, "Reviewer access revoked");
    return res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Failed to revoke reviewer access");
    return res.status(500).json({ error: "Failed to revoke access" });
  }
});

// ── GET /api/admin/role-events — audit log of role promotions/revocations ─────
// Query params:
//   limit  — max rows (default 100, cap 500)
//   action — comma-separated action filter, e.g. "promote_admin,revoke_admin"
//             or a group shorthand: "admins" | "reviewers" | "promotions" | "revocations"

const ACTION_GROUPS: Record<string, string[]> = {
  admins:      ["promote_admin", "revoke_admin"],
  reviewers:   ["promote_reviewer", "revoke_reviewer"],
  promotions:  ["promote_admin", "promote_reviewer"],
  revocations: ["revoke_admin", "revoke_reviewer"],
};

router.get("/admin/role-events", middlewareReviewAccess, middlewareAdminOnly, async (req: any, res) => {
  try {
    const { limit = "100", action } = req.query as { limit?: string; action?: string };

    let actionFilter: string[] | null = null;
    if (action && action !== "all") {
      actionFilter = ACTION_GROUPS[action] ?? action.split(",").map((a) => a.trim()).filter(Boolean);
    }

    const query = db
      .select()
      .from(adminRoleEventsTable)
      .orderBy(desc(adminRoleEventsTable.createdAt))
      .limit(Math.min(Number(limit), 500));

    const events = await (actionFilter && actionFilter.length > 0
      ? db
          .select()
          .from(adminRoleEventsTable)
          .where(inArray(adminRoleEventsTable.action, actionFilter))
          .orderBy(desc(adminRoleEventsTable.createdAt))
          .limit(Math.min(Number(limit), 500))
      : query);

    return res.json(events);
  } catch (err) {
    logger.error({ err }, "Failed to fetch role events");
    return res.status(500).json({ error: "Failed to fetch role events" });
  }
});

// ── GET /api/admin/role-events/gaps — audit gaps detected since last restart ──
// Returns role changes whose adminRoleEventsTable insert failed, meaning the
// Clerk role is live but there is no corresponding audit record.
//
// Reconciliation: before returning, the handler queries adminRoleEventsTable for
// each stored gap. If a matching row now exists (same action + actorClerkId +
// targetClerkId), that gap is considered resolved and is removed from the store.
// This means the warning clears as soon as the missing audit record appears —
// whether written by a retry, a manual fix, or any other mechanism.
//
// Returns: { gaps: AuditGap[] }  — only unresolved, non-expired gaps

router.get("/admin/role-events/gaps", middlewareReviewAccess, middlewareAdminOnly, async (_req, res) => {
  // Prune gaps older than TTL first
  const cutoff = Date.now() - AUDIT_GAP_TTL_MS;
  for (let i = auditGapStore.length - 1; i >= 0; i--) {
    if (new Date(auditGapStore[i].detectedAt).getTime() < cutoff) {
      auditGapStore.splice(i, 1);
    }
  }

  if (auditGapStore.length === 0) return res.json({ gaps: [] });

  // Reconcile: check each gap against adminRoleEventsTable. A gap is resolved
  // when a row with the same (action, actorClerkId, targetClerkId) exists AND
  // was created at or after the gap was detected.
  //
  // Temporal constraint is critical: without it, an earlier audit row from a
  // prior operation with the same actor/action/target (e.g., the same admin
  // previously promoted the same user) would incorrectly clear a newer gap.
  // A 60-second look-back buffer accounts for any clock skew between the gap
  // detection timestamp and the DB row's createdAt.
  const RECONCILE_LOOKBACK_MS = 60_000; // 1 minute

  try {
    const resolvedIndices = new Set<number>();
    await Promise.all(
      auditGapStore.map(async (gap, idx) => {
        const resolveAfter = new Date(
          new Date(gap.detectedAt).getTime() - RECONCILE_LOOKBACK_MS,
        );
        const rows = await db
          .select({ id: adminRoleEventsTable.id })
          .from(adminRoleEventsTable)
          .where(
            and(
              eq(adminRoleEventsTable.action, gap.action),
              eq(adminRoleEventsTable.actorClerkId, gap.actorClerkId),
              eq(adminRoleEventsTable.targetClerkId, gap.targetClerkId),
              gte(adminRoleEventsTable.createdAt, resolveAfter),
            ),
          )
          .limit(1);
        if (rows.length > 0) resolvedIndices.add(idx);
      }),
    );

    // Remove resolved gaps from the store (iterate backwards to keep indices stable)
    for (let i = auditGapStore.length - 1; i >= 0; i--) {
      if (resolvedIndices.has(i)) auditGapStore.splice(i, 1);
    }
  } catch (err) {
    logger.error({ err }, "Failed to reconcile audit gaps against adminRoleEventsTable — returning unfiltered list");
    // Fall through: return current store contents rather than failing the request
  }

  return res.json({ gaps: [...auditGapStore] });
});

// ── GET /api/admin/admins — list users with admin role ───────────────────────

router.get("/admin/admins", middlewareReviewAccess, middlewareAdminOnly, async (_req, res) => {
  try {
    const secretKey = process.env.CLERK_SECRET_KEY;
    if (!secretKey) return res.status(500).json({ error: "Server Clerk integration not configured." });

    const clerkRes = await fetch(
      "https://api.clerk.com/v1/users?limit=500",
      { headers: { Authorization: `Bearer ${secretKey}` } }
    );
    if (!clerkRes.ok) {
      return res.status(502).json({ error: "Failed to fetch users from Clerk." });
    }
    const users = await clerkRes.json() as Array<{
      id: string;
      email_addresses: Array<{ email_address: string }>;
      first_name: string | null;
      last_name: string | null;
      public_metadata: { role?: string };
    }>;
    const admins = users
      .filter((u) => u.public_metadata?.role === "admin")
      .map((u) => ({
        clerkId: u.id,
        email: u.email_addresses[0]?.email_address ?? null,
        name: [u.first_name, u.last_name].filter(Boolean).join(" ") || null,
      }));

    const envIds = (process.env.ADMIN_CLERK_USER_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    return res.json({ admins, envAdminIds: envIds });
  } catch (err) {
    logger.error({ err }, "Failed to list admins");
    return res.status(500).json({ error: "Failed to list admins" });
  }
});

// ── GET /api/admin/users — look up a user by email before promoting ──────────

router.get("/admin/users", middlewareReviewAccess, middlewareAdminOnly, async (req: any, res) => {
  const { email } = req.query as { email?: string };
  if (!email?.includes("@")) return res.status(400).json({ error: "Valid email required" });

  try {
    const [user] = await db.select().from(usersTable)
      .where(sql`lower(${usersTable.email}) = lower(${email.trim()})`)
      .limit(1);
    if (!user) {
      return res.status(404).json({
        error: "No ChargeBridge account found for that email. The user must sign in at least once before being promoted.",
      });
    }

    let avatarUrl: string | null = null;
    let existingRole: "admin" | "reviewer" | null = null;

    const secretKey = process.env.CLERK_SECRET_KEY;
    if (secretKey) {
      try {
        const clerkRes = await fetch(`https://api.clerk.com/v1/users/${user.clerkId}`, {
          headers: { Authorization: `Bearer ${secretKey}` },
        });
        if (clerkRes.ok) {
          const clerkUser = await clerkRes.json() as { image_url?: string; public_metadata?: { role?: string } };
          avatarUrl = clerkUser.image_url ?? null;
          if (clerkUser.public_metadata?.role === "admin") existingRole = "admin";
          else if (clerkUser.public_metadata?.role === "reviewer") existingRole = "reviewer";
        }
      } catch {
        // avatar is optional; never fail the request over it
      }
    }

    // Also check env-var admin list (covers admins not yet granted via Clerk metadata)
    if (!existingRole) {
      const envIds = (process.env.ADMIN_CLERK_USER_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      if (envIds.includes(user.clerkId)) existingRole = "admin";
    }

    // Fall back to DB reviewer table if Clerk metadata wasn't available
    if (!existingRole) {
      const [reviewer] = await db.select({ clerkId: reviewerAccessTable.clerkId })
        .from(reviewerAccessTable)
        .where(eq(reviewerAccessTable.clerkId, user.clerkId))
        .limit(1);
      if (reviewer) existingRole = "reviewer";
    }

    return res.json({ clerkId: user.clerkId, email: user.email, name: user.name ?? null, avatarUrl, existingRole });
  } catch (err) {
    logger.error({ err }, "Failed to look up user by email");
    return res.status(500).json({ error: "Failed to look up user" });
  }
});

// ── POST /api/admin/admins — promote a user to admin role ────────────────────

router.post("/admin/admins", middlewareReviewAccess, middlewareAdminOnly, async (req: any, res) => {
  const { email } = req.body as { email?: string };
  if (!email?.includes("@")) return res.status(400).json({ error: "Valid email required" });

  try {
    const secretKey = process.env.CLERK_SECRET_KEY;
    if (!secretKey) return res.status(500).json({ error: "Server Clerk integration not configured." });

    const [user] = await db.select().from(usersTable)
      .where(sql`lower(${usersTable.email}) = lower(${email.trim()})`)
      .limit(1);
    if (!user) return res.status(404).json({ error: "User not found. They must have signed in to ChargeBridge at least once." });

    const clerkRes = await clerkFetch(`https://api.clerk.com/v1/users/${user.clerkId}/metadata`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ public_metadata: { role: "admin" } }),
    });

    if (!clerkRes) {
      logger.error({ clerkId: user.clerkId }, "Clerk metadata update timed out during admin promotion");
      return res.status(504).json({ error: "Clerk API timed out. Try again." });
    }
    if (!clerkRes.ok) {
      const err = await clerkRes.text();
      logger.error({ err }, "Clerk metadata update failed during admin promotion");
      return res.status(500).json({ error: "Failed to promote user. Check server logs." });
    }

    // Clerk PATCH succeeded — role is live. Each audit insert uses withAuditRetry
    // (3 attempts, 2 s apart) so a transient DB blip has a recovery path. A
    // failure of one insert never prevents the other from being attempted.
    const actorName = await getAdminName(req.reviewAccess.clerkId);
    await withAuditRetry(
      () => db.insert(adminRoleEventsTable).values({
        action: "promote_admin",
        actorClerkId: req.reviewAccess.clerkId,
        actorName,
        targetClerkId: user.clerkId,
        targetEmail: user.email,
        targetName: user.name ?? null,
      }),
      (auditErr) => {
        logger.error({ auditErr, targetClerkId: user.clerkId, actorClerkId: req.reviewAccess.clerkId }, "adminRoleEventsTable insert failed after promote_admin — role change already applied in Clerk");
        recordAuditGap({ action: "promote_admin", actorClerkId: req.reviewAccess.clerkId, actorName, targetClerkId: user.clerkId, targetEmail: user.email, targetName: user.name ?? null });
      },
    );

    await withAuditRetry(
      () => db.insert(adminEventsTable).values({
        adminClerkId: req.reviewAccess.clerkId,
        action: "promote_admin",
        targetType: "user",
        targetName: user.name ?? user.email,
        details: JSON.stringify({ targetClerkId: user.clerkId, email: user.email, role: "admin" }),
      }),
      (auditErr) => {
        logger.error({ auditErr, targetClerkId: user.clerkId, actorClerkId: req.reviewAccess.clerkId }, "adminEventsTable insert failed after promote_admin — role change already applied in Clerk");
      },
    );

    logger.info({ clerkId: user.clerkId, promotedBy: req.reviewAccess.clerkId }, "Admin role granted");
    return res.status(201).json({ ok: true, clerkId: user.clerkId, email: user.email });
  } catch (err) {
    logger.error({ err }, "Failed to promote user to admin");
    return res.status(500).json({ error: "Failed to promote user" });
  }
});

// ── DELETE /api/admin/admins/:clerkId — revoke admin role ────────────────────

router.delete("/admin/admins/:clerkId", middlewareReviewAccess, middlewareAdminOnly, async (req: any, res) => {
  const { clerkId } = req.params;

  if (clerkId === req.reviewAccess.clerkId) {
    return res.status(400).json({ error: "You cannot revoke your own admin role." });
  }

  try {
    const secretKey = process.env.CLERK_SECRET_KEY;
    if (!secretKey) return res.status(500).json({ error: "Server Clerk integration not configured." });

    // ── Minimum-admin-count guard ──────────────────────────────────────────────
    // Build the full set of admin IDs by paginating through ALL Clerk users.
    // A single /v1/users?limit=500 call covers at most 500 users; deployments
    // with more than 500 total users would silently miss any admins beyond the
    // first page, making the guard bypassable. We paginate (offset=0, 500, …)
    // until a page shorter than the limit signals exhaustion.
    const PAGE_LIMIT = 500;
    const clerkAdminIds = new Set<string>();
    let guardPageOffset = 0;
    let paginationError: "timeout" | "rate_limited" | "fetch_error" | null = null;
    let clerkRetryAfter: string | null = null;

    while (true) {
      const listRes = await clerkFetch(
        `https://api.clerk.com/v1/users?limit=${PAGE_LIMIT}&offset=${guardPageOffset}`,
        { headers: { Authorization: `Bearer ${secretKey}` } },
      );
      if (!listRes) { paginationError = "timeout"; break; }
      if (listRes.status === 429) {
        clerkRetryAfter = listRes.headers.get("Retry-After");
        paginationError = "rate_limited";
        break;
      }
      if (!listRes.ok) { paginationError = "fetch_error"; break; }
      const page = await listRes.json() as Array<{ id: string; public_metadata: { role?: string } }>;
      for (const u of page) {
        if (u.public_metadata?.role === "admin") clerkAdminIds.add(u.id);
      }
      if (page.length < PAGE_LIMIT) break; // last page — no more users
      guardPageOffset += PAGE_LIMIT;
    }

    if (paginationError === "timeout") {
      logger.error({}, "Clerk user list timed out during admin revoke guard");
      return res.status(504).json({ error: "Clerk API timed out while verifying admin count. Try again later." });
    }
    if (paginationError === "rate_limited") {
      logger.warn({ retryAfter: clerkRetryAfter }, "Clerk rate-limited admin revoke guard user-list request");
      const body: { error: string; retryAfter?: string } = {
        error: "Clerk API is rate-limiting requests. Admin count could not be verified — revocation blocked for safety. Try again later.",
      };
      if (clerkRetryAfter) body.retryAfter = clerkRetryAfter;
      const response = res.status(503);
      if (clerkRetryAfter) response.set("Retry-After", clerkRetryAfter);
      return response.json(body);
    }
    if (paginationError === "fetch_error") {
      logger.error({}, "Failed to fetch Clerk user list during admin revoke guard");
      return res.status(502).json({ error: "Failed to verify admin count. Try again later." });
    }

    const envAdminIds = new Set(
      (process.env.ADMIN_CLERK_USER_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean)
    );
    const allAdminIds = new Set([...clerkAdminIds, ...envAdminIds]);
    // Simulate the revocation
    allAdminIds.delete(clerkId);
    if (allAdminIds.size < 2) {
      return res.status(400).json({
        error: "Cannot revoke this admin. At least 2 admins must remain at all times to prevent any single admin from consolidating sole control.",
      });
    }
    // ── End guard ──────────────────────────────────────────────────────────────

    const clerkRes = await clerkFetch(`https://api.clerk.com/v1/users/${clerkId}/metadata`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ public_metadata: { role: null } }),
    });

    if (!clerkRes) {
      logger.error({ clerkId }, "Clerk metadata update timed out during admin demotion");
      return res.status(504).json({ error: "Clerk API timed out. Try again." });
    }
    if (!clerkRes.ok) {
      const err = await clerkRes.text();
      logger.error({ err }, "Clerk metadata update failed during admin demotion");
      return res.status(500).json({ error: "Failed to revoke admin. Check server logs." });
    }

    // Clerk PATCH succeeded — role is revoked. Each audit insert uses withAuditRetry
    // (3 attempts, 2 s apart) so a transient DB blip has a recovery path. A
    // failure of one insert never prevents the other from being attempted.
    const [targetUser] = await db.select({ email: usersTable.email, name: usersTable.name })
      .from(usersTable).where(eq(usersTable.clerkId, clerkId)).limit(1);
    const actorName = await getAdminName(req.reviewAccess.clerkId);
    await withAuditRetry(
      () => db.insert(adminRoleEventsTable).values({
        action: "revoke_admin",
        actorClerkId: req.reviewAccess.clerkId,
        actorName,
        targetClerkId: clerkId,
        targetEmail: targetUser?.email ?? clerkId,
        targetName: targetUser?.name ?? null,
      }),
      (auditErr) => {
        logger.error({ auditErr, targetClerkId: clerkId, actorClerkId: req.reviewAccess.clerkId }, "adminRoleEventsTable insert failed after revoke_admin — role change already applied in Clerk");
        recordAuditGap({ action: "revoke_admin", actorClerkId: req.reviewAccess.clerkId, actorName, targetClerkId: clerkId, targetEmail: targetUser?.email ?? clerkId, targetName: targetUser?.name ?? null });
      },
    );

    await withAuditRetry(
      () => db.insert(adminEventsTable).values({
        adminClerkId: req.reviewAccess.clerkId,
        action: "revoke_admin",
        targetType: "user",
        targetName: targetUser?.name ?? targetUser?.email ?? clerkId,
        details: JSON.stringify({ targetClerkId: clerkId, email: targetUser?.email ?? null, role: "admin" }),
      }),
      (auditErr) => {
        logger.error({ auditErr, targetClerkId: clerkId, actorClerkId: req.reviewAccess.clerkId }, "adminEventsTable insert failed after revoke_admin — role change already applied in Clerk");
      },
    );

    logger.info({ clerkId, revokedBy: req.reviewAccess.clerkId }, "Admin role revoked");
    return res.json({ ok: true, remaining: allAdminIds.size });
  } catch (err) {
    logger.error({ err }, "Failed to revoke admin role");
    return res.status(500).json({ error: "Failed to revoke admin" });
  }
});

// ── GET /api/admin/all-stations — paginated list of all community stations ───
// Optional query param: ?status=removed  to filter to only removed stations.
// Without status, returns all non-removed stations (default behaviour).

router.get("/admin/all-stations", middlewareReviewAccess, async (req: any, res) => {
  try {
    const { status } = req.query as { status?: string };
    let query = db.select().from(stationsTable).orderBy(desc(stationsTable.createdAt)).$dynamic();
    if (status === "removed") {
      query = query.where(eq(stationsTable.status, "removed"));
    } else {
      query = query.where(ne(stationsTable.status, "removed"));
    }
    const stations = await query.limit(200);
    return res.json(stations);
  } catch (err) {
    logger.error({ err }, "Failed to fetch all stations");
    return res.status(500).json({ error: "Failed to fetch stations" });
  }
});

// ── PATCH /api/admin/stations/:id/restore — restore a soft-deleted station ───
// Admin-only. Sets status back to "available" or "offline" (caller chooses).

router.patch("/admin/stations/:id/restore", middlewareReviewAccess, middlewareAdminOnly, async (req: any, res) => {
  const stationId = Number(req.params.id);
  if (isNaN(stationId)) return res.status(400).json({ error: "Invalid station id" });

  const { status = "available", notes } = req.body as { status?: string; notes?: string };
  if (!["available", "offline"].includes(status)) {
    return res.status(400).json({ error: "status must be 'available' or 'offline'" });
  }
  if (notes !== undefined && typeof notes !== "string") {
    return res.status(400).json({ error: "notes must be a string" });
  }

  try {
    const [existing] = await db.select().from(stationsTable)
      .where(eq(stationsTable.id, stationId)).limit(1);
    if (!existing) return res.status(404).json({ error: "Station not found" });
    if (existing.status !== "removed") {
      return res.status(409).json({ error: "Station is not in removed status" });
    }

    const adminName = await getAdminName(req.reviewAccess.clerkId);

    const [updated] = await db.update(stationsTable)
      .set({
        status: status as any,
        reviewedBy: req.reviewAccess.clerkId,
        reviewedAt: new Date(),
      })
      .where(eq(stationsTable.id, stationId))
      .returning();

    const logNote = notes?.trim()
      ? `Restored by admin to ${status}. Reason: ${notes.trim()}`
      : `Restored by admin to ${status}`;

    await db.insert(reviewLogsTable).values({
      entityType: "station",
      entityId: stationId,
      entityName: existing.name,
      adminClerkId: req.reviewAccess.clerkId,
      adminName,
      action: "approved",
      previousAction: "removed",
      notes: logNote,
    });

    logger.info({ stationId, status, admin: req.reviewAccess.clerkId }, "Station restored from removed");
    return res.json(updated);
  } catch (err) {
    logger.error({ err }, "Failed to restore station");
    return res.status(500).json({ error: "Failed to restore station" });
  }
});

// ── POST /api/admin/stations/:id/delete-token — issue a hard-delete confirmation token ──
// Admin-only. Returns a short-lived token (5 min) the caller must echo back in the
// DELETE request below. Two-step prevents accidental or scripted mass deletions.

router.post("/admin/stations/:id/delete-token", middlewareReviewAccess, middlewareAdminOnly, async (req: any, res) => {
  const stationId = Number(req.params.id);
  if (isNaN(stationId)) return res.status(400).json({ error: "Invalid station id" });

  try {
    const [station] = await db.select({ id: stationsTable.id, name: stationsTable.name })
      .from(stationsTable).where(eq(stationsTable.id, stationId)).limit(1);
    if (!station) return res.status(404).json({ error: "Station not found" });

    // Prune expired tokens to prevent unbounded growth
    const now = Date.now();
    for (const [tok, entry] of pendingDeleteTokens) {
      if (entry.expiresAt < now) pendingDeleteTokens.delete(tok);
    }

    const token = randomBytes(32).toString("hex");
    pendingDeleteTokens.set(token, {
      stationId,
      adminClerkId: req.reviewAccess.clerkId,
      expiresAt: now + DELETE_TOKEN_TTL_MS,
    });

    logger.info({ stationId, admin: req.reviewAccess.clerkId }, "Hard-delete token issued for station");
    return res.json({
      token,
      stationId,
      stationName: station.name,
      expiresAt: new Date(now + DELETE_TOKEN_TTL_MS).toISOString(),
      warning: "This token authorizes permanent deletion of the station and all associated data. Use DELETE /api/admin/stations/:id?confirmToken=<token> within 5 minutes.",
    });
  } catch (err) {
    logger.error({ err }, "Failed to issue delete token");
    return res.status(500).json({ error: "Failed to issue delete token" });
  }
});

// ── DELETE /api/admin/stations/:id — hard-delete a station (admin + confirmation token required) ──
// Permanently removes the station row. Associates reviews, favorites, and photos
// are cascade-deleted by FK constraints. All hard-deletes are logged to admin_events.

router.delete("/admin/stations/:id", middlewareReviewAccess, middlewareAdminOnly, async (req: any, res) => {
  const stationId = Number(req.params.id);
  if (isNaN(stationId)) return res.status(400).json({ error: "Invalid station id" });

  const confirmToken = typeof req.query.confirmToken === "string" ? req.query.confirmToken : null;
  if (!confirmToken) {
    return res.status(400).json({
      error: "confirmToken query parameter is required. First call POST /api/admin/stations/:id/delete-token to obtain a confirmation token.",
    });
  }

  const entry = pendingDeleteTokens.get(confirmToken);
  if (!entry) {
    return res.status(403).json({ error: "Invalid or expired confirmation token. Request a new token via POST /api/admin/stations/:id/delete-token." });
  }
  if (entry.expiresAt < Date.now()) {
    pendingDeleteTokens.delete(confirmToken);
    return res.status(403).json({ error: "Confirmation token has expired. Request a new token via POST /api/admin/stations/:id/delete-token." });
  }
  if (entry.stationId !== stationId) {
    return res.status(403).json({ error: "Confirmation token was issued for a different station." });
  }
  if (entry.adminClerkId !== req.reviewAccess.clerkId) {
    return res.status(403).json({ error: "Confirmation token was issued for a different admin account." });
  }

  pendingDeleteTokens.delete(confirmToken);

  try {
    const [station] = await db.select().from(stationsTable).where(eq(stationsTable.id, stationId)).limit(1);
    if (!station) return res.status(404).json({ error: "Station not found" });

    // Atomic: delete station and write audit log in a single transaction.
    // If either fails, both are rolled back — no silent data loss without an audit trail.
    await db.transaction(async (tx) => {
      await deleteStationChildren(tx, stationId);
      await tx.insert(adminEventsTable).values({
        adminClerkId: req.reviewAccess.clerkId,
        action: "hard_delete_station",
        targetType: "station",
        targetId: stationId,
        targetName: station.name,
        details: JSON.stringify({
          address: station.address,
          city: station.city,
          state: station.state,
          country: station.country,
          status: station.status,
          ownerClerkUserId: station.ownerClerkUserId ?? null,
          createdAt: station.createdAt.toISOString(),
        }),
      });
    });

    logger.info({ stationId, stationName: station.name, admin: req.reviewAccess.clerkId }, "Station hard-deleted by admin");
    return res.json({ ok: true, deleted: { id: stationId, name: station.name } });
  } catch (err) {
    logger.error({ err }, "Failed to hard-delete station");
    return res.status(500).json({ error: "Failed to delete station" });
  }
});

// ── GET /api/admin/events — paginated audit log of admin actions ──────────────
// Admin-only. Returns rows from admin_events sorted by newest first, with the
// acting admin's display name resolved from the users table.

router.get("/admin/events", middlewareReviewAccess, middlewareAdminOnly, async (req: any, res) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const offset = Number(req.query.offset ?? 0);
    const actionFilter = typeof req.query.action === "string" && req.query.action ? req.query.action : null;

    // Accept plain YYYY-MM-DD strings and resolve to UTC day boundaries so the
    // backend (UTC) and the database timestamps are compared consistently.
    const sinceStr = typeof req.query.since === "string" ? req.query.since.trim() : "";
    const untilStr = typeof req.query.until === "string" ? req.query.until.trim() : "";
    const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
    if (sinceStr && !ISO_DATE.test(sinceStr)) return res.status(400).json({ error: "Invalid 'since' date — use YYYY-MM-DD" });
    if (untilStr && !ISO_DATE.test(untilStr)) return res.status(400).json({ error: "Invalid 'until' date — use YYYY-MM-DD" });
    const since = sinceStr ? new Date(`${sinceStr}T00:00:00.000Z`) : null;
    const until = untilStr ? new Date(`${untilStr}T23:59:59.999Z`) : null;

    const whereClause = and(
      actionFilter ? eq(adminEventsTable.action, actionFilter) : undefined,
      since ? gte(adminEventsTable.createdAt, since) : undefined,
      until ? lte(adminEventsTable.createdAt, until) : undefined,
    );

    const [events, countResult] = await Promise.all([
      db
        .select({
          id: adminEventsTable.id,
          adminClerkId: adminEventsTable.adminClerkId,
          adminName: sql<string | null>`${usersTable.name}`,
          adminEmail: sql<string | null>`${usersTable.email}`,
          action: adminEventsTable.action,
          targetType: adminEventsTable.targetType,
          targetId: adminEventsTable.targetId,
          targetName: adminEventsTable.targetName,
          details: adminEventsTable.details,
          createdAt: adminEventsTable.createdAt,
        })
        .from(adminEventsTable)
        .leftJoin(usersTable, eq(usersTable.clerkId, adminEventsTable.adminClerkId))
        .where(whereClause)
        .orderBy(desc(adminEventsTable.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(adminEventsTable)
        .where(whereClause),
    ]);

    return res.json({ events, total: countResult[0]?.count ?? 0 });
  } catch (err) {
    logger.error({ err }, "Failed to fetch admin events");
    return res.status(500).json({ error: "Failed to fetch audit log" });
  }
});

// ── GET /api/admin/refund-jobs — pending Stripe refund jobs ──────────────────
// Returns refund jobs that have not yet succeeded (succeededAt IS NULL),
// ordered by creation time descending. Admins use this to monitor automatic
// refunds queued by the session sweeper, force-stop route, and webhook handler.

router.get("/admin/refund-jobs", middlewareReviewAccess, middlewareAdminOnly, async (_req, res) => {
  try {
    const jobs = await db
      .select({
        id: stripeRefundJobsTable.id,
        sessionId: stripeRefundJobsTable.sessionId,
        paymentIntentId: stripeRefundJobsTable.paymentIntentId,
        idempotencyKey: stripeRefundJobsTable.idempotencyKey,
        reason: stripeRefundJobsTable.reason,
        jobType: stripeRefundJobsTable.jobType,
        attempts: stripeRefundJobsTable.attempts,
        lastAttemptAt: stripeRefundJobsTable.lastAttemptAt,
        nextRetryAt: stripeRefundJobsTable.nextRetryAt,
        succeededAt: stripeRefundJobsTable.succeededAt,
        createdAt: stripeRefundJobsTable.createdAt,
      })
      .from(stripeRefundJobsTable)
      .orderBy(desc(stripeRefundJobsTable.createdAt))
      .limit(200);

    return res.json(jobs);
  } catch (err) {
    logger.error({ err }, "Failed to fetch refund jobs");
    return res.status(500).json({ error: "Failed to fetch refund jobs" });
  }
});

export default router;

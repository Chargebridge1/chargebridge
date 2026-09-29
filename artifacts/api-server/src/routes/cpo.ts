import { Router } from "express";
import { getAuth } from "@clerk/express";
import {
  db,
  stationsTable,
  chargingSessionsTable,
  organizationsTable,
  orgMembershipsTable,
  stationAlertsTable,
} from "@workspace/db";
import { eq, and, inArray, gte, sql, isNull, ne } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { getOcppLiveStatus } from "../lib/ocppCsms";
import { logger } from "../lib/logger";
import type { OrgRole } from "@workspace/db";

const router = Router();

// ── Helpers ──────────────────────────────────────────────────────────────────

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

async function getCallerEmail(req: any): Promise<string> {
  const auth = getAuth(req);
  return ((auth as any)?.sessionClaims?.email ?? "") as string;
}

async function resolveOrgMembership(orgId: number, clerkUserId: string, email: string) {
  const [membership] = await db
    .select()
    .from(orgMembershipsTable)
    .where(
      and(
        eq(orgMembershipsTable.orgId, orgId),
        eq(orgMembershipsTable.email, email.toLowerCase())
      )
    );
  if (membership) return membership;

  const [org] = await db
    .select()
    .from(organizationsTable)
    .where(and(eq(organizationsTable.id, orgId), eq(organizationsTable.plan, "cpo")));
  if (org?.ownerClerkId === clerkUserId) {
    return {
      id: -1, orgId, clerkUserId, email, name: null,
      role: "admin" as OrgRole, joinedAt: org.createdAt,
    };
  }
  return null;
}

function requireCpoRole(...roles: OrgRole[]) {
  return async (req: any, res: any, next: any) => {
    const clerkUserId = req.clerkUserId as string;
    const email = await getCallerEmail(req);
    const orgId = Number(req.params.orgId);
    if (isNaN(orgId)) return res.status(400).json({ error: "Invalid orgId" });

    const m = await resolveOrgMembership(orgId, clerkUserId, email);
    if (!m) return res.status(403).json({ error: "Not a member of this CPO organization" });
    if (roles.length && !roles.includes(m.role as OrgRole))
      return res.status(403).json({ error: "Insufficient role" });

    req.cpoMembership = m;
    req.orgId = orgId;
    next();
  };
}

async function getOrgStations(orgId: number) {
  return db
    .select()
    .from(stationsTable)
    .where(eq(stationsTable.cpoOrgId, orgId));
}

// ── GET /api/me/cpo-orgs — orgs the caller belongs to (plan=cpo) ────────────
router.get("/me/cpo-orgs", requireAuth, async (req, res) => {
  const clerkUserId = (req as any).clerkUserId as string;
  const email = await getCallerEmail(req as any);

  try {
    const memberships = await db
      .select()
      .from(orgMembershipsTable)
      .where(eq(orgMembershipsTable.email, email.toLowerCase()));

    const ownedOrgs = await db
      .select()
      .from(organizationsTable)
      .where(
        and(
          eq(organizationsTable.ownerClerkId, clerkUserId),
          eq(organizationsTable.plan, "cpo")
        )
      );

    const memberOrgIds = new Set(memberships.map((m) => m.orgId));
    const allOrgIds = [
      ...memberships.map((m) => m.orgId),
      ...ownedOrgs.filter((o) => !memberOrgIds.has(o.id)).map((o) => o.id),
    ];

    if (allOrgIds.length === 0) return res.json([]);

    const orgs = await db
      .select()
      .from(organizationsTable)
      .where(
        and(inArray(organizationsTable.id, allOrgIds), eq(organizationsTable.plan, "cpo"))
      );

    return res.json(
      orgs.map((org) => {
        const m = memberships.find((m) => m.orgId === org.id);
        return { ...org, role: m?.role ?? "admin", membershipId: m?.id ?? null };
      })
    );
  } catch (err) {
    logger.error({ err }, "Failed to list CPO orgs");
    return res.status(500).json({ error: "Failed to load CPO organizations" });
  }
});

// ── POST /api/cpo/orgs — create CPO organization ────────────────────────────
router.post("/cpo/orgs", requireAuth, async (req, res) => {
  const clerkUserId = (req as any).clerkUserId as string;
  const email = await getCallerEmail(req as any);
  const { name, description } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "name is required" });

  try {
    const base = slugify(name.trim());
    const existing = await db
      .select({ slug: organizationsTable.slug })
      .from(organizationsTable)
      .where(sql`slug LIKE ${base + "%"}`);
    const usedSlugs = new Set(existing.map((r) => r.slug));
    let slug = base;
    let n = 2;
    while (usedSlugs.has(slug)) slug = `${base}-${n++}`;

    const [org] = await db
      .insert(organizationsTable)
      .values({
        name: name.trim(), slug, description: description?.trim() || null,
        ownerClerkId: clerkUserId, plan: "cpo",
      })
      .returning();

    await db.insert(orgMembershipsTable).values({
      orgId: org.id, clerkUserId, email: email.toLowerCase(), role: "admin",
    });

    req.log.info({ orgId: org.id }, "CPO organization created");
    return res.status(201).json({ ...org, role: "admin" });
  } catch (err: any) {
    if (err?.cause?.code === "23505" || err?.code === "23505")
      return res.status(409).json({ error: "Organization slug already exists" });
    logger.error({ err }, "Failed to create CPO organization");
    return res.status(500).json({ error: "Failed to create organization" });
  }
});

// ── GET /api/cpo/orgs/:orgId ─────────────────────────────────────────────────
router.get("/cpo/orgs/:orgId", requireAuth, requireCpoRole(), async (req: any, res) => {
  try {
    const [org] = await db
      .select()
      .from(organizationsTable)
      .where(eq(organizationsTable.id, req.orgId));
    if (!org) return res.status(404).json({ error: "Not found" });
    const stationCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(stationsTable)
      .where(eq(stationsTable.cpoOrgId, req.orgId));
    return res.json({ ...org, role: req.cpoMembership.role, stationCount: Number(stationCount[0]?.count ?? 0) });
  } catch (err) {
    logger.error({ err }, "Failed to get CPO org");
    return res.status(500).json({ error: "Failed to load organization" });
  }
});

// ── PATCH /api/cpo/orgs/:orgId ───────────────────────────────────────────────
router.patch("/cpo/orgs/:orgId", requireAuth, requireCpoRole("admin"), async (req: any, res) => {
  const { name, description } = req.body;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (name?.trim()) updates.name = name.trim();
  if (description !== undefined) updates.description = description?.trim() || null;
  try {
    const [org] = await db
      .update(organizationsTable)
      .set(updates)
      .where(eq(organizationsTable.id, req.orgId))
      .returning();
    return res.json(org);
  } catch (err) {
    logger.error({ err }, "Failed to update CPO org");
    return res.status(500).json({ error: "Failed to update organization" });
  }
});

// ── GET /api/cpo/orgs/:orgId/dashboard ───────────────────────────────────────
router.get("/cpo/orgs/:orgId/dashboard", requireAuth, requireCpoRole(), async (req: any, res) => {
  try {
    const stations = await getOrgStations(req.orgId);
    const stationIds = stations.map((s) => s.id);

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

    let todaySessions: any[] = [];
    let monthSessions: any[] = [];
    let activeSessions: any[] = [];

    if (stationIds.length > 0) {
      [todaySessions, monthSessions] = await Promise.all([
        db.select().from(chargingSessionsTable).where(
          and(inArray(chargingSessionsTable.stationId, stationIds), gte(chargingSessionsTable.createdAt, today))
        ),
        db.select().from(chargingSessionsTable).where(
          and(inArray(chargingSessionsTable.stationId, stationIds), gte(chargingSessionsTable.createdAt, monthStart))
        ),
      ]);
      activeSessions = todaySessions.filter((s) =>
        s.chargingState === "charging" || s.chargingState === "remote_start_sent"
      );
    }

    const onlineStations = stations.filter((s) => s.status !== "offline").length;
    const todayKwh = todaySessions.reduce((a, s) => a + (s.kwh ?? 0), 0);
    const monthKwh = monthSessions.reduce((a, s) => a + (s.kwh ?? 0), 0);
    const todayCents = todaySessions.reduce((a, s) => a + (s.amountCents ?? 0), 0);
    const monthCents = monthSessions.reduce((a, s) => a + (s.amountCents ?? 0), 0);

    const [alertRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(stationAlertsTable)
      .where(and(eq(stationAlertsTable.orgId, req.orgId), eq(stationAlertsTable.resolved, false)));

    const totalPorts = stations.reduce((a, s) => a + s.totalPorts, 0);
    const avgUtilizationPct = totalPorts > 0
      ? Math.round((activeSessions.length / totalPorts) * 100)
      : 0;

    return res.json({
      totalStations: stations.length,
      onlineStations,
      offlineStations: stations.length - onlineStations,
      activeSessionCount: activeSessions.length,
      todaySessions: todaySessions.length,
      todayRevenueCents: todayCents,
      todayKwh: Math.round(todayKwh * 10) / 10,
      monthRevenueCents: monthCents,
      monthKwh: Math.round(monthKwh * 10) / 10,
      avgUtilizationPct,
      unresolvedAlerts: Number(alertRow?.count ?? 0),
      activeSessions: activeSessions.slice(0, 8),
      totalPorts,
    });
  } catch (err) {
    logger.error({ err }, "Failed to load CPO dashboard");
    return res.status(500).json({ error: "Failed to load dashboard" });
  }
});

// ── GET /api/cpo/orgs/:orgId/stations — list with live status ────────────────
router.get("/cpo/orgs/:orgId/stations", requireAuth, requireCpoRole(), async (req: any, res) => {
  try {
    const stations = await getOrgStations(req.orgId);
    const stationIds = stations.map((s) => s.id);

    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);

    let sessionStats: Record<number, { monthCents: number; monthSessions: number; todaySessions: number }> = {};
    if (stationIds.length > 0) {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const [monthRows, todayRows] = await Promise.all([
        db.select().from(chargingSessionsTable).where(
          and(inArray(chargingSessionsTable.stationId, stationIds), gte(chargingSessionsTable.createdAt, monthStart))
        ),
        db.select().from(chargingSessionsTable).where(
          and(inArray(chargingSessionsTable.stationId, stationIds), gte(chargingSessionsTable.createdAt, today))
        ),
      ]);
      for (const s of monthRows) {
        const sid = s.stationId!;
        if (!sessionStats[sid]) sessionStats[sid] = { monthCents: 0, monthSessions: 0, todaySessions: 0 };
        sessionStats[sid].monthCents += s.amountCents ?? 0;
        sessionStats[sid].monthSessions += 1;
      }
      for (const s of todayRows) {
        const sid = s.stationId!;
        if (!sessionStats[sid]) sessionStats[sid] = { monthCents: 0, monthSessions: 0, todaySessions: 0 };
        sessionStats[sid].todaySessions += 1;
      }
    }

    const result = stations.map((s) => ({
      ...s,
      ocppStatus: getOcppLiveStatus(s.id),
      ...(sessionStats[s.id] ?? { monthCents: 0, monthSessions: 0, todaySessions: 0 }),
    }));

    return res.json(result);
  } catch (err) {
    logger.error({ err }, "Failed to list CPO stations");
    return res.status(500).json({ error: "Failed to list stations" });
  }
});

// ── POST /api/cpo/orgs/:orgId/stations/claim — associate station with org ────
router.post(
  "/cpo/orgs/:orgId/stations/claim",
  requireAuth,
  requireCpoRole("admin", "manager"),
  async (req: any, res) => {
    const { stationId } = req.body;
    const sid = Number(stationId);
    if (isNaN(sid)) return res.status(400).json({ error: "stationId is required" });

    try {
      const [station] = await db
        .select()
        .from(stationsTable)
        .where(eq(stationsTable.id, sid));
      if (!station) return res.status(404).json({ error: "Station not found" });
      if (station.cpoOrgId && station.cpoOrgId !== req.orgId)
        return res.status(409).json({ error: "Station already claimed by another organization" });

      const clerkUserId = req.clerkUserId as string;
      const isOwner = station.ownerClerkUserId === clerkUserId;
      const isOrgAdmin = req.cpoMembership.role === "admin" || req.cpoMembership.role === "manager";

      if (!isOwner && !isOrgAdmin)
        return res.status(403).json({ error: "You must own this station to claim it" });

      const [updated] = await db
        .update(stationsTable)
        .set({ cpoOrgId: req.orgId })
        .where(eq(stationsTable.id, sid))
        .returning();

      req.log.info({ stationId: sid, orgId: req.orgId }, "Station claimed by CPO org");
      return res.json({ ...updated, ocppStatus: getOcppLiveStatus(sid) });
    } catch (err) {
      logger.error({ err }, "Failed to claim station");
      return res.status(500).json({ error: "Failed to claim station" });
    }
  }
);

// ── DELETE /api/cpo/orgs/:orgId/stations/:sid/unclaim ────────────────────────
router.delete(
  "/cpo/orgs/:orgId/stations/:sid/unclaim",
  requireAuth,
  requireCpoRole("admin"),
  async (req: any, res) => {
    const sid = Number(req.params.sid);
    if (isNaN(sid)) return res.status(400).json({ error: "Invalid station ID" });

    const [station] = await db
      .select()
      .from(stationsTable)
      .where(and(eq(stationsTable.id, sid), eq(stationsTable.cpoOrgId, req.orgId)));
    if (!station) return res.status(404).json({ error: "Station not found in this organization" });

    try {
      await db.update(stationsTable).set({ cpoOrgId: null }).where(eq(stationsTable.id, sid));
      return res.status(204).send();
    } catch (err) {
      logger.error({ err }, "Failed to unclaim station");
      return res.status(500).json({ error: "Failed to unclaim station" });
    }
  }
);

// ── GET /api/cpo/orgs/:orgId/stations/:sid ───────────────────────────────────
router.get(
  "/cpo/orgs/:orgId/stations/:sid",
  requireAuth,
  requireCpoRole(),
  async (req: any, res) => {
    const sid = Number(req.params.sid);
    if (isNaN(sid)) return res.status(400).json({ error: "Invalid station ID" });

    try {
      const [station] = await db
        .select()
        .from(stationsTable)
        .where(and(eq(stationsTable.id, sid), eq(stationsTable.cpoOrgId, req.orgId)));
      if (!station) return res.status(404).json({ error: "Station not found" });

      const recentSessions = await db
        .select()
        .from(chargingSessionsTable)
        .where(eq(chargingSessionsTable.stationId, sid))
        .orderBy(sql`${chargingSessionsTable.createdAt} desc`)
        .limit(10);

      const [alertCount] = await db
        .select({ count: sql<number>`count(*)` })
        .from(stationAlertsTable)
        .where(and(eq(stationAlertsTable.stationId, sid), eq(stationAlertsTable.resolved, false)));

      return res.json({
        ...station,
        ocppStatus: getOcppLiveStatus(sid),
        recentSessions,
        unresolvedAlerts: Number(alertCount?.count ?? 0),
      });
    } catch (err) {
      logger.error({ err }, "Failed to get CPO station detail");
      return res.status(500).json({ error: "Failed to load station" });
    }
  }
);

// ── PATCH /api/cpo/orgs/:orgId/stations/:sid — edit station ──────────────────
router.patch(
  "/cpo/orgs/:orgId/stations/:sid",
  requireAuth,
  requireCpoRole("admin", "manager"),
  async (req: any, res) => {
    const sid = Number(req.params.sid);
    if (isNaN(sid)) return res.status(400).json({ error: "Invalid station ID" });

    const [station] = await db
      .select()
      .from(stationsTable)
      .where(and(eq(stationsTable.id, sid), eq(stationsTable.cpoOrgId, req.orgId)));
    if (!station) return res.status(404).json({ error: "Station not found" });

    const {
      name, description, pricePerKwh, totalPorts, network, photoUrl,
    } = req.body;

    const updates: Record<string, unknown> = {};
    if (name?.trim()) updates.name = name.trim();
    if (description !== undefined) updates.description = description?.trim() || null;
    if (pricePerKwh !== undefined) updates.pricePerKwh = Number(pricePerKwh);
    if (totalPorts !== undefined) updates.totalPorts = Number(totalPorts);
    if (network !== undefined) updates.network = network?.trim() || null;
    if (photoUrl !== undefined) updates.photoUrl = photoUrl?.trim() || null;

    try {
      const [updated] = await db
        .update(stationsTable)
        .set(updates)
        .where(eq(stationsTable.id, sid))
        .returning();
      return res.json({ ...updated, ocppStatus: getOcppLiveStatus(sid) });
    } catch (err) {
      logger.error({ err }, "Failed to update station");
      return res.status(500).json({ error: "Failed to update station" });
    }
  }
);

// ── GET /api/cpo/orgs/:orgId/analytics ───────────────────────────────────────
router.get("/cpo/orgs/:orgId/analytics", requireAuth, requireCpoRole(), async (req: any, res) => {
  try {
    const stations = await getOrgStations(req.orgId);
    const stationIds = stations.map((s) => s.id);

    if (stationIds.length === 0) {
      return res.json({
        peakHours: Array.from({ length: 24 }, (_, i) => ({ hour: i, sessions: 0 })),
        topStations: [], avgDurationMin: 0, avgKwh: 0, uniqueDrivers: 0, totalSessions30d: 0,
      });
    }

    const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const sessions = await db
      .select()
      .from(chargingSessionsTable)
      .where(
        and(
          inArray(chargingSessionsTable.stationId, stationIds),
          gte(chargingSessionsTable.createdAt, thirtyDaysAgo)
        )
      );

    // Peak hours (0-23)
    const hourBuckets = Array.from({ length: 24 }, (_, i) => ({ hour: i, sessions: 0 }));
    for (const s of sessions) {
      const h = s.createdAt.getHours();
      hourBuckets[h].sessions += 1;
    }

    // Top stations by session count
    const stationMap = new Map<number, { name: string; sessions: number; kwh: number }>();
    for (const st of stations) stationMap.set(st.id, { name: st.name, sessions: 0, kwh: 0 });
    for (const s of sessions) {
      const entry = stationMap.get(s.stationId!);
      if (entry) { entry.sessions += 1; entry.kwh += s.kwh ?? 0; }
    }
    const topStations = [...stationMap.values()]
      .sort((a, b) => b.sessions - a.sessions)
      .slice(0, 10)
      .map((s) => ({ ...s, kwh: Math.round(s.kwh * 10) / 10 }));

    // Avg session duration (minutes) — from startedAt to completedAt
    const durSessions = sessions.filter((s) => s.startedAt && s.completedAt);
    const avgDurationMin = durSessions.length > 0
      ? Math.round(durSessions.reduce((a, s) => {
          const ms = new Date(s.completedAt!).getTime() - new Date(s.startedAt!).getTime();
          return a + ms / 60000;
        }, 0) / durSessions.length)
      : 0;

    const avgKwh = sessions.length > 0
      ? Math.round((sessions.reduce((a, s) => a + (s.kwh ?? 0), 0) / sessions.length) * 10) / 10
      : 0;

    // Anonymized unique driver count
    const uniqueDrivers = new Set(sessions.map((s) => s.driverEmail)).size;

    return res.json({
      peakHours: hourBuckets,
      topStations,
      avgDurationMin,
      avgKwh,
      uniqueDrivers,
      totalSessions30d: sessions.length,
    });
  } catch (err) {
    logger.error({ err }, "Failed to load CPO analytics");
    return res.status(500).json({ error: "Failed to load analytics" });
  }
});

// ── GET /api/cpo/orgs/:orgId/revenue ─────────────────────────────────────────
router.get("/cpo/orgs/:orgId/revenue", requireAuth, requireCpoRole(), async (req: any, res) => {
  try {
    const stations = await getOrgStations(req.orgId);
    const stationIds = stations.map((s) => s.id);

    if (stationIds.length === 0) {
      return res.json({ daily: [], byStation: [], totalCents: 0, totalKwh: 0, avgTransactionCents: 0 });
    }

    const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const sessions = await db
      .select()
      .from(chargingSessionsTable)
      .where(
        and(
          inArray(chargingSessionsTable.stationId, stationIds),
          gte(chargingSessionsTable.createdAt, thirtyDaysAgo)
        )
      );

    // Daily aggregation
    const byDay = new Map<string, { cents: number; kwh: number; sessions: number }>();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      byDay.set(d.toISOString().slice(0, 10), { cents: 0, kwh: 0, sessions: 0 });
    }
    for (const s of sessions) {
      const key = s.createdAt.toISOString().slice(0, 10);
      const curr = byDay.get(key);
      if (curr) { curr.cents += s.amountCents ?? 0; curr.kwh += s.kwh ?? 0; curr.sessions += 1; }
    }
    const daily = [...byDay.entries()].map(([date, v]) => ({
      date, cents: v.cents, kwh: Math.round(v.kwh * 10) / 10, sessions: v.sessions,
    }));

    // By station
    const stationRevMap = new Map<number, { name: string; cents: number; kwh: number; sessions: number }>();
    for (const st of stations) stationRevMap.set(st.id, { name: st.name, cents: 0, kwh: 0, sessions: 0 });
    for (const s of sessions) {
      const entry = stationRevMap.get(s.stationId!);
      if (entry) { entry.cents += s.amountCents ?? 0; entry.kwh += s.kwh ?? 0; entry.sessions += 1; }
    }
    const byStation = [...stationRevMap.values()]
      .sort((a, b) => b.cents - a.cents)
      .map((s) => ({ ...s, kwh: Math.round(s.kwh * 10) / 10 }));

    const totalCents = sessions.reduce((a, s) => a + (s.amountCents ?? 0), 0);
    const totalKwh = sessions.reduce((a, s) => a + (s.kwh ?? 0), 0);
    const avgTransactionCents = sessions.length > 0 ? Math.round(totalCents / sessions.length) : 0;

    return res.json({
      daily, byStation, totalCents, totalKwh: Math.round(totalKwh * 10) / 10,
      avgTransactionCents, sessionCount: sessions.length,
    });
  } catch (err) {
    logger.error({ err }, "Failed to load CPO revenue");
    return res.status(500).json({ error: "Failed to load revenue" });
  }
});

// ── GET /api/cpo/orgs/:orgId/revenue/export.csv ───────────────────────────────
router.get(
  "/cpo/orgs/:orgId/revenue/export.csv",
  requireAuth,
  requireCpoRole("admin", "manager", "finance", "analyst"),
  async (req: any, res) => {
    try {
      const stations = await getOrgStations(req.orgId);
      const stationIds = stations.map((s) => s.id);
      const stationNames = new Map(stations.map((s) => [s.id, s.name]));

      if (stationIds.length === 0) {
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", 'attachment; filename="cpo-revenue.csv"');
        return res.send("Date,Station,Driver,kWh,Cost (USD),Status\n");
      }

      const sessions = await db
        .select()
        .from(chargingSessionsTable)
        .where(inArray(chargingSessionsTable.stationId, stationIds))
        .orderBy(sql`${chargingSessionsTable.createdAt} desc`);

      const lines = [
        "Date,Station,Driver,kWh,Cost (USD),Status",
        ...sessions.map((s) => {
          const date = s.createdAt.toISOString().slice(0, 10);
          const station = (stationNames.get(s.stationId!) ?? "Unknown").replace(/,/g, " ");
          const driver = (s.driverName ?? "").replace(/,/g, " ");
          const cost = ((s.amountCents ?? 0) / 100).toFixed(2);
          const kwh = (s.kwh ?? 0).toFixed(2);
          return `${date},${station},${driver},${kwh},${cost},${s.status}`;
        }),
      ];

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", 'attachment; filename="cpo-revenue.csv"');
      return res.send(lines.join("\n"));
    } catch (err) {
      logger.error({ err }, "Failed to export CPO revenue CSV");
      return res.status(500).json({ error: "Failed to export" });
    }
  }
);

// ── GET /api/cpo/orgs/:orgId/alerts ──────────────────────────────────────────
router.get("/cpo/orgs/:orgId/alerts", requireAuth, requireCpoRole(), async (req: any, res) => {
  try {
    const alerts = await db
      .select()
      .from(stationAlertsTable)
      .where(eq(stationAlertsTable.orgId, req.orgId))
      .orderBy(sql`${stationAlertsTable.createdAt} desc`)
      .limit(100);

    // Enrich with station names
    const stationIds = [...new Set(alerts.map((a) => a.stationId).filter(Boolean))] as number[];
    let stationNames: Record<number, string> = {};
    if (stationIds.length > 0) {
      const rows = await db
        .select({ id: stationsTable.id, name: stationsTable.name })
        .from(stationsTable)
        .where(inArray(stationsTable.id, stationIds));
      stationNames = Object.fromEntries(rows.map((r) => [r.id, r.name]));
    }

    return res.json(
      alerts.map((a) => ({ ...a, stationName: a.stationId ? stationNames[a.stationId] ?? null : null }))
    );
  } catch (err) {
    logger.error({ err }, "Failed to load CPO alerts");
    return res.status(500).json({ error: "Failed to load alerts" });
  }
});

// ── POST /api/cpo/orgs/:orgId/alerts/refresh — scan & auto-generate ──────────
router.post(
  "/cpo/orgs/:orgId/alerts/refresh",
  requireAuth,
  requireCpoRole("admin", "manager", "technician"),
  async (req: any, res) => {
    try {
      const stations = await getOrgStations(req.orgId);
      const newAlerts: Array<{ orgId: number; stationId: number; type: string; severity: string; message: string }> = [];
      const resolved: number[] = [];

      // Get existing unresolved alerts for this org
      const existingAlerts = await db
        .select()
        .from(stationAlertsTable)
        .where(and(eq(stationAlertsTable.orgId, req.orgId), eq(stationAlertsTable.resolved, false)));

      const existingByStation = new Map<number, typeof existingAlerts>();
      for (const a of existingAlerts) {
        if (!a.stationId) continue;
        if (!existingByStation.has(a.stationId)) existingByStation.set(a.stationId, []);
        existingByStation.get(a.stationId)!.push(a);
      }

      for (const station of stations) {
        const ocpp = getOcppLiveStatus(station.id);
        const stationAlerts = existingByStation.get(station.id) ?? [];

        // Offline check
        const isOffline = station.status === "offline" || (ocpp && !ocpp.connected && station.ocppChargePointId);
        const hasOfflineAlert = stationAlerts.some((a) => a.type === "station_offline");

        if (isOffline && !hasOfflineAlert) {
          newAlerts.push({
            orgId: req.orgId, stationId: station.id,
            type: "station_offline", severity: "critical",
            message: `Station "${station.name}" is offline`,
          });
        } else if (!isOffline && hasOfflineAlert) {
          const toResolve = stationAlerts.filter((a) => a.type === "station_offline").map((a) => a.id);
          resolved.push(...toResolve);
        }

        // Faulted connector check
        if (ocpp?.connectorStatus === "Faulted" && ocpp.errorCode && ocpp.errorCode !== "NoError") {
          const hasFaultAlert = stationAlerts.some((a) => a.type === "connector_fault");
          if (!hasFaultAlert) {
            newAlerts.push({
              orgId: req.orgId, stationId: station.id,
              type: "connector_fault", severity: "critical",
              message: `Connector fault on "${station.name}": ${ocpp.errorCode}`,
            });
          }
        }
      }

      // Insert new alerts
      if (newAlerts.length > 0) {
        await db.insert(stationAlertsTable).values(newAlerts);
      }

      // Resolve auto-recovered alerts
      if (resolved.length > 0) {
        await db
          .update(stationAlertsTable)
          .set({ resolved: true, resolvedAt: new Date(), resolvedBy: "auto" })
          .where(inArray(stationAlertsTable.id, resolved));
      }

      req.log.info({ orgId: req.orgId, newAlerts: newAlerts.length, resolved: resolved.length }, "Alert scan complete");
      return res.json({ created: newAlerts.length, autoResolved: resolved.length });
    } catch (err) {
      logger.error({ err }, "Failed to refresh CPO alerts");
      return res.status(500).json({ error: "Failed to refresh alerts" });
    }
  }
);

// ── POST /api/cpo/orgs/:orgId/alerts/:aid/resolve ────────────────────────────
router.post(
  "/cpo/orgs/:orgId/alerts/:aid/resolve",
  requireAuth,
  requireCpoRole("admin", "manager", "technician"),
  async (req: any, res) => {
    const aid = Number(req.params.aid);
    if (isNaN(aid)) return res.status(400).json({ error: "Invalid alert ID" });
    const email = await getCallerEmail(req as any);

    try {
      const [alert] = await db
        .update(stationAlertsTable)
        .set({ resolved: true, resolvedAt: new Date(), resolvedBy: email })
        .where(and(eq(stationAlertsTable.id, aid), eq(stationAlertsTable.orgId, req.orgId)))
        .returning();
      if (!alert) return res.status(404).json({ error: "Alert not found" });
      return res.json(alert);
    } catch (err) {
      logger.error({ err }, "Failed to resolve alert");
      return res.status(500).json({ error: "Failed to resolve alert" });
    }
  }
);

// ── GET /api/cpo/orgs/:orgId/members ─────────────────────────────────────────
router.get("/cpo/orgs/:orgId/members", requireAuth, requireCpoRole(), async (req: any, res) => {
  try {
    const members = await db
      .select()
      .from(orgMembershipsTable)
      .where(eq(orgMembershipsTable.orgId, req.orgId));
    return res.json(members);
  } catch (err) {
    logger.error({ err }, "Failed to list CPO members");
    return res.status(500).json({ error: "Failed to list members" });
  }
});

// ── POST /api/cpo/orgs/:orgId/members ────────────────────────────────────────
router.post(
  "/cpo/orgs/:orgId/members",
  requireAuth,
  requireCpoRole("admin", "manager"),
  async (req: any, res) => {
    const { email, name, role = "technician" } = req.body;
    const emailStr = typeof email === "string" ? email.trim().toLowerCase() : "";
    if (!emailStr || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailStr))
      return res.status(400).json({ error: "A valid email is required" });

    const cpoRoles: OrgRole[] = ["admin", "manager", "regional_manager", "technician", "finance", "analyst"];
    if (!cpoRoles.includes(role))
      return res.status(400).json({ error: "Invalid role" });
    if (role === "admin" && req.cpoMembership.role !== "admin")
      return res.status(403).json({ error: "Only admins can add other admins" });

    try {
      const [existing] = await db
        .select()
        .from(orgMembershipsTable)
        .where(and(eq(orgMembershipsTable.orgId, req.orgId), eq(orgMembershipsTable.email, emailStr)));
      if (existing) return res.status(409).json({ error: "Member already exists" });

      const [member] = await db
        .insert(orgMembershipsTable)
        .values({ orgId: req.orgId, email: emailStr, name: name?.trim() || null, role: role as OrgRole })
        .returning();
      return res.status(201).json(member);
    } catch (err) {
      logger.error({ err }, "Failed to add CPO member");
      return res.status(500).json({ error: "Failed to add member" });
    }
  }
);

// ── PATCH /api/cpo/orgs/:orgId/members/:mid ───────────────────────────────────
router.patch(
  "/cpo/orgs/:orgId/members/:mid",
  requireAuth,
  requireCpoRole("admin"),
  async (req: any, res) => {
    const mid = Number(req.params.mid);
    if (isNaN(mid)) return res.status(400).json({ error: "Invalid member ID" });
    const { role } = req.body;
    const cpoRoles: OrgRole[] = ["admin", "manager", "regional_manager", "technician", "finance", "analyst"];
    if (!cpoRoles.includes(role)) return res.status(400).json({ error: "Invalid role" });

    try {
      const [updated] = await db
        .update(orgMembershipsTable)
        .set({ role: role as OrgRole })
        .where(and(eq(orgMembershipsTable.id, mid), eq(orgMembershipsTable.orgId, req.orgId)))
        .returning();
      if (!updated) return res.status(404).json({ error: "Member not found" });
      return res.json(updated);
    } catch (err) {
      logger.error({ err }, "Failed to update CPO member role");
      return res.status(500).json({ error: "Failed to update role" });
    }
  }
);

// ── DELETE /api/cpo/orgs/:orgId/members/:mid ─────────────────────────────────
router.delete(
  "/cpo/orgs/:orgId/members/:mid",
  requireAuth,
  requireCpoRole("admin", "manager"),
  async (req: any, res) => {
    const mid = Number(req.params.mid);
    if (isNaN(mid)) return res.status(400).json({ error: "Invalid member ID" });

    try {
      await db
        .delete(orgMembershipsTable)
        .where(and(eq(orgMembershipsTable.id, mid), eq(orgMembershipsTable.orgId, req.orgId)));
      return res.status(204).send();
    } catch (err) {
      logger.error({ err }, "Failed to remove CPO member");
      return res.status(500).json({ error: "Failed to remove member" });
    }
  }
);

export default router;

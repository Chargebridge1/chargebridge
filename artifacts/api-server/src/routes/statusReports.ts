import { Router } from "express";
import { db } from "@workspace/db";
import { stationStatusReportsTable } from "@workspace/db";
import { eq, gte, sql } from "drizzle-orm";

const router = Router();

router.get("/ev-stations/:stationId/latest-report", async (req, res) => {
  const { stationId } = req.params;
  const since = new Date(Date.now() - 4 * 60 * 60 * 1000);
  const rows = await db
    .select()
    .from(stationStatusReportsTable)
    .where(
      sql`${stationStatusReportsTable.stationId} = ${stationId} and ${stationStatusReportsTable.createdAt} >= ${since}`
    )
    .orderBy(sql`${stationStatusReportsTable.createdAt} desc`)
    .limit(1);
  if (rows.length === 0) return res.json(null);
  const r = rows[0];
  return res.json({ id: r.id, reportType: r.reportType, confirmations: r.confirmations, createdAt: r.createdAt });
});

router.get("/ev-stations/:stationId/status-summary", async (req, res) => {
  const { stationId } = req.params;
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      reportType: stationStatusReportsTable.reportType,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(stationStatusReportsTable)
    .where(
      sql`${stationStatusReportsTable.stationId} = ${stationId} and ${stationStatusReportsTable.createdAt} >= ${since}`
    )
    .groupBy(stationStatusReportsTable.reportType);

  const summary: Record<string, number> = { working: 0, busy: 0, issue: 0 };
  for (const r of rows) summary[r.reportType] = r.count;
  return res.json(summary);
});

router.get("/ev-stations/:stationId/status-history", async (req, res) => {
  const { stationId } = req.params;
  const rawLimit = parseInt((req.query.limit as string) ?? "10", 10);
  const limit = isNaN(rawLimit) ? 10 : Math.min(Math.max(rawLimit, 1), 20);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await db
    .select()
    .from(stationStatusReportsTable)
    .where(
      sql`${stationStatusReportsTable.stationId} = ${stationId} and ${stationStatusReportsTable.createdAt} >= ${since}`
    )
    .orderBy(sql`${stationStatusReportsTable.createdAt} desc`)
    .limit(limit);
  return res.json(
    rows.map((r) => ({
      id: r.id,
      reportType: r.reportType,
      confirmations: r.confirmations,
      createdAt: r.createdAt,
    }))
  );
});

router.post("/ev-stations/:stationId/status-report", async (req, res) => {
  const { stationId } = req.params;
  const { reportType } = req.body ?? {};
  const clerkUserId: string | null = (req as any).auth?.userId ?? null;
  if (!["working", "busy", "issue"].includes(reportType)) {
    return res.status(400).json({ error: "reportType must be working | busy | issue" });
  }
  await db.insert(stationStatusReportsTable).values({ stationId, reportType, clerkUserId });
  return res.status(201).json({ ok: true });
});

// Confirm / upvote a status report
router.post("/ev-stations/:stationId/status-report/:reportId/confirm", async (req, res) => {
  const reportId = parseInt(req.params.reportId, 10);
  if (isNaN(reportId)) return res.status(400).json({ error: "Invalid reportId" });
  await db
    .update(stationStatusReportsTable)
    .set({ confirmations: sql`${stationStatusReportsTable.confirmations} + 1` })
    .where(eq(stationStatusReportsTable.id, reportId));
  return res.json({ ok: true });
});

export default router;

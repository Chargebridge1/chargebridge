import { Router } from "express";
import { db } from "@workspace/db";
import { stationCheckinsTable } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";

const router = Router();

router.get("/stations/:id/queue", async (req, res) => {
  const stationId = parseInt(String(req.params.id), 10);
  if (isNaN(stationId)) { res.status(400).json({ error: "Invalid station id" }); return; }
  const active = await db.select().from(stationCheckinsTable)
    .where(and(eq(stationCheckinsTable.stationId, stationId), isNull(stationCheckinsTable.leftAt)));
  res.json({
    count: active.length,
    checkins: active.map(c => ({ id: c.id, portNumber: c.portNumber, checkedInAt: c.checkedInAt.toISOString() })),
  });
});

router.post("/stations/:id/checkin", requireAuth, async (req, res) => {
  const stationId = parseInt(String(req.params.id), 10);
  if (isNaN(stationId)) { res.status(400).json({ error: "Invalid station id" }); return; }
  const clerkUserId = (req as any).clerkUserId as string;
  const { portNumber } = req.body;

  const existing = await db.select().from(stationCheckinsTable)
    .where(and(eq(stationCheckinsTable.stationId, stationId), eq(stationCheckinsTable.clerkUserId, clerkUserId), isNull(stationCheckinsTable.leftAt)))
    .limit(1);
  if (existing.length) { res.status(409).json({ error: "Already checked in" }); return; }

  const [checkin] = await db.insert(stationCheckinsTable).values({ stationId, clerkUserId, portNumber: portNumber ?? null }).returning();
  res.status(201).json({ ...checkin, checkedInAt: checkin.checkedInAt.toISOString() });
});

router.delete("/stations/:id/checkin", requireAuth, async (req, res) => {
  const stationId = parseInt(String(req.params.id), 10);
  const clerkUserId = (req as any).clerkUserId as string;
  const now = new Date();
  await db.update(stationCheckinsTable)
    .set({ leftAt: now })
    .where(and(eq(stationCheckinsTable.stationId, stationId), eq(stationCheckinsTable.clerkUserId, clerkUserId), isNull(stationCheckinsTable.leftAt)));
  res.status(204).end();
});

export default router;

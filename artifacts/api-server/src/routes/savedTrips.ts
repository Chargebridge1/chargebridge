import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { db } from "@workspace/db";
import { savedTripsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const router = Router();

router.get("/trip/saved", requireAuth, async (req, res) => {
  const userId = (req as any).auth?.userId as string;
  const trips = await db
    .select()
    .from(savedTripsTable)
    .where(eq(savedTripsTable.clerkUserId, userId))
    .orderBy(savedTripsTable.createdAt);
  return res.json(trips.map(t => ({ ...t, createdAt: t.createdAt.toISOString() })));
});

router.post("/trip/saved", requireAuth, async (req, res) => {
  const userId = (req as any).auth?.userId as string;
  const { name, originLabel, originLat, originLng, destLabel, destLat, destLng, rangeKm } = req.body ?? {};
  if (!name || !originLabel || originLat == null || originLng == null || !destLabel || destLat == null || destLng == null) {
    return res.status(400).json({ error: "Missing required fields" });
  }
  const [trip] = await db
    .insert(savedTripsTable)
    .values({
      clerkUserId: userId,
      name: String(name).trim().slice(0, 80),
      originLabel: String(originLabel).trim(),
      originLat: Number(originLat),
      originLng: Number(originLng),
      destLabel: String(destLabel).trim(),
      destLat: Number(destLat),
      destLng: Number(destLng),
      rangeKm: Number(rangeKm) || 300,
    })
    .returning();
  return res.status(201).json({ ...trip, createdAt: trip.createdAt.toISOString() });
});

router.delete("/trip/saved/:id", requireAuth, async (req, res) => {
  const userId = (req as any).auth?.userId as string;
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  await db
    .delete(savedTripsTable)
    .where(and(eq(savedTripsTable.id, id), eq(savedTripsTable.clerkUserId, userId)));
  return res.status(204).end();
});

export default router;

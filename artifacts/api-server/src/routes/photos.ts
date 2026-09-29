import { Router } from "express";
import { db } from "@workspace/db";
import { stationPhotosTable, stationsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";

const router = Router();

router.get("/stations/:id/photos", async (req, res) => {
  const stationId = parseInt(String(req.params.id), 10);
  if (isNaN(stationId)) { res.status(400).json({ error: "Invalid station id" }); return; }
  const rows = await db
    .select({
      id: stationPhotosTable.id,
      stationId: stationPhotosTable.stationId,
      clerkUserId: stationPhotosTable.clerkUserId,
      photoUrl: stationPhotosTable.photoUrl,
      caption: stationPhotosTable.caption,
      photoType: stationPhotosTable.photoType,
      businessName: stationPhotosTable.businessName,
      businessLat: stationPhotosTable.businessLat,
      businessLng: stationPhotosTable.businessLng,
      createdAt: stationPhotosTable.createdAt,
      contributorName: usersTable.name,
      contributorEmail: usersTable.email,
    })
    .from(stationPhotosTable)
    .leftJoin(usersTable, eq(stationPhotosTable.clerkUserId, usersTable.clerkId))
    .where(eq(stationPhotosTable.stationId, stationId))
    .orderBy(stationPhotosTable.createdAt);
  res.json(rows.map(p => ({
    ...p,
    createdAt: p.createdAt.toISOString(),
    contributorName: p.contributorName ?? (p.contributorEmail ? p.contributorEmail.split("@")[0] : null),
    contributorEmail: undefined,
  })));
});

router.post("/stations/:id/photos", requireAuth, async (req, res) => {
  const stationId = parseInt(String(req.params.id), 10);
  if (isNaN(stationId)) { res.status(400).json({ error: "Invalid station id" }); return; }
  const clerkUserId = (req as any).clerkUserId as string;
  const { photoUrl, caption, photoType, businessName, businessLat, businessLng } = req.body;
  if (!photoUrl || typeof photoUrl !== "string") { res.status(400).json({ error: "photoUrl required" }); return; }

  const station = await db.select().from(stationsTable).where(eq(stationsTable.id, stationId)).limit(1);
  if (!station.length) { res.status(404).json({ error: "Station not found" }); return; }

  const resolvedType = photoType === "nearby_business" ? "nearby_business" : "station";
  const bLat = resolvedType === "nearby_business" && typeof businessLat === "number" ? businessLat : null;
  const bLng = resolvedType === "nearby_business" && typeof businessLng === "number" ? businessLng : null;
  const bName = resolvedType === "nearby_business" && typeof businessName === "string" && businessName.trim() ? businessName.trim() : null;

  const [photo] = await db.insert(stationPhotosTable).values({
    stationId,
    clerkUserId,
    photoUrl,
    caption: caption ?? null,
    photoType: resolvedType,
    businessName: bName,
    businessLat: bLat,
    businessLng: bLng,
  }).returning();
  res.status(201).json({ ...photo, createdAt: photo.createdAt.toISOString() });
});

router.delete("/stations/:stationId/photos/:photoId", requireAuth, async (req, res) => {
  const clerkUserId = (req as any).clerkUserId as string;
  const photoId = parseInt(String(req.params.photoId), 10);
  const photos = await db.select().from(stationPhotosTable).where(eq(stationPhotosTable.id, photoId)).limit(1);
  if (!photos.length) { res.status(404).json({ error: "Photo not found" }); return; }
  if (photos[0].clerkUserId !== clerkUserId) { res.status(403).json({ error: "Forbidden" }); return; }
  await db.delete(stationPhotosTable).where(eq(stationPhotosTable.id, photoId));
  res.status(204).end();
});

export default router;

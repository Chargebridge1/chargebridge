import { Router } from "express";
import { db } from "@workspace/db";
import { reviewsTable, reviewRepliesTable, stationsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { CreateReviewBody, CreateReviewParams, GetStationReviewsParams, UpdateReviewBody, UpdateReviewParams } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { z } from "zod/v4";
import { getAuth } from "@clerk/express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";

const router = Router();

// POST /stations/:id/reviews — 10 reviews per hour per IP
const postReviewRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? ""),
  message: { error: "Too many reviews submitted. Please wait before submitting another." },
  standardHeaders: true,
  legacyHeaders: false,
});

router.get("/reviews/mine", requireAuth, async (req, res) => {
  const clerkUserId = (req as any).clerkUserId as string;

  const reviews = await db
    .select({
      id: reviewsTable.id,
      stationId: reviewsTable.stationId,
      stationName: stationsTable.name,
      authorName: reviewsTable.authorName,
      rating: reviewsTable.rating,
      comment: reviewsTable.comment,
      clerkUserId: reviewsTable.clerkUserId,
      createdAt: reviewsTable.createdAt,
    })
    .from(reviewsTable)
    .innerJoin(stationsTable, eq(reviewsTable.stationId, stationsTable.id))
    .where(eq(reviewsTable.clerkUserId, clerkUserId))
    .orderBy(reviewsTable.createdAt);

  const replyMap = new Map<number, typeof reviewRepliesTable.$inferSelect>();
  if (reviews.length > 0) {
    const reviewIds = reviews.map((r) => r.id);
    const replies = await db
      .select()
      .from(reviewRepliesTable)
      .where(inArray(reviewRepliesTable.reviewId, reviewIds));
    for (const reply of replies) {
      replyMap.set(reply.reviewId, reply);
    }
  }

  return res.json(
    reviews.map((r) => {
      const reply = replyMap.get(r.id) ?? null;
      return {
        ...r,
        createdAt: r.createdAt.toISOString(),
        reply: reply ? { ...reply, createdAt: reply.createdAt.toISOString() } : null,
      };
    })
  );
});

router.get("/stations/:id/reviews", async (req, res) => {
  const parsed = GetStationReviewsParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) return res.status(400).json({ error: "Invalid id" });

  const reviews = await db
    .select()
    .from(reviewsTable)
    .where(eq(reviewsTable.stationId, parsed.data.id))
    .orderBy(reviewsTable.createdAt);

  const replyMap = new Map<number, typeof reviewRepliesTable.$inferSelect>();
  if (reviews.length > 0) {
    const reviewIds = reviews.map((r) => r.id);
    const replies = await db
      .select()
      .from(reviewRepliesTable)
      .where(inArray(reviewRepliesTable.reviewId, reviewIds));
    for (const reply of replies) {
      replyMap.set(reply.reviewId, reply);
    }
  }

  return res.json(
    reviews.map((r) => {
      const reply = replyMap.get(r.id) ?? null;
      return {
        ...r,
        createdAt: r.createdAt.toISOString(),
        reply: reply
          ? { ...reply, createdAt: reply.createdAt.toISOString() }
          : null,
      };
    })
  );
});

router.post("/stations/:id/reviews", postReviewRateLimit, async (req, res) => {
  const paramsParsed = CreateReviewParams.safeParse({ id: Number(req.params.id) });
  const bodyParsed = CreateReviewBody.safeParse(req.body);

  if (!paramsParsed.success || !bodyParsed.success) {
    return res.status(400).json({ error: "Invalid request" });
  }

  const station = await db.query.stationsTable.findFirst({
    where: eq(stationsTable.id, paramsParsed.data.id),
  });
  if (!station) return res.status(404).json({ error: "Station not found" });

  const { getAuth } = await import("@clerk/express");
  const clerkUserId = getAuth(req)?.userId ?? null;

  const [review] = await db
    .insert(reviewsTable)
    .values({
      stationId: paramsParsed.data.id,
      authorName: bodyParsed.data.authorName,
      rating: bodyParsed.data.rating,
      comment: bodyParsed.data.comment ?? null,
      clerkUserId,
    })
    .returning();

  return res.status(201).json({
    ...review,
    createdAt: review.createdAt.toISOString(),
    reply: null,
  });
});

router.patch("/reviews/:id", requireAuth, async (req, res) => {
  const paramsParsed = UpdateReviewParams.safeParse({ id: Number(req.params.id) });
  const bodyParsed = UpdateReviewBody.safeParse(req.body);

  if (!paramsParsed.success || !bodyParsed.success) {
    return res.status(400).json({ error: "Invalid request" });
  }

  const clerkUserId = (req as any).clerkUserId as string;

  const existing = await db
    .select()
    .from(reviewsTable)
    .where(eq(reviewsTable.id, paramsParsed.data.id))
    .limit(1);

  if (!existing.length) return res.status(404).json({ error: "Review not found" });
  if (existing[0].clerkUserId !== clerkUserId) return res.status(403).json({ error: "Forbidden" });

  const updates: Partial<typeof reviewsTable.$inferInsert> = {};
  if (bodyParsed.data.rating !== undefined) updates.rating = bodyParsed.data.rating;
  if (bodyParsed.data.comment !== undefined) updates.comment = bodyParsed.data.comment ?? null;

  const [updated] = await db
    .update(reviewsTable)
    .set(updates)
    .where(eq(reviewsTable.id, paramsParsed.data.id))
    .returning();

  const replyRows = await db
    .select()
    .from(reviewRepliesTable)
    .where(eq(reviewRepliesTable.reviewId, updated.id))
    .limit(1);
  const reply = replyRows[0] ?? null;

  return res.json({
    ...updated,
    createdAt: updated.createdAt.toISOString(),
    reply: reply ? { ...reply, createdAt: reply.createdAt.toISOString() } : null,
  });
});

router.delete("/reviews/:id", requireAuth, async (req, res) => {
  const reviewId = parseInt(String(req.params.id), 10);
  if (isNaN(reviewId)) return res.status(400).json({ error: "Invalid id" });

  const clerkUserId = (req as any).clerkUserId as string;

  const existing = await db
    .select()
    .from(reviewsTable)
    .where(eq(reviewsTable.id, reviewId))
    .limit(1);

  if (!existing.length) return res.status(404).json({ error: "Review not found" });
  if (existing[0].clerkUserId !== clerkUserId) return res.status(403).json({ error: "Forbidden" });

  await db.delete(reviewsTable).where(eq(reviewsTable.id, reviewId));

  return res.status(204).end();
});

const CreateReviewReplyBodySchema = z.object({
  body: z.string().min(1).max(2000),
});

router.post("/reviews/:id/reply", requireAuth, async (req, res) => {
  const reviewId = parseInt(String(req.params.id), 10);
  if (isNaN(reviewId)) return res.status(400).json({ error: "Invalid id" });

  const bodyParsed = CreateReviewReplyBodySchema.safeParse(req.body);
  if (!bodyParsed.success) return res.status(400).json({ error: "Invalid request" });

  const clerkUserId = (req as any).clerkUserId as string;

  const existing = await db
    .select()
    .from(reviewsTable)
    .where(eq(reviewsTable.id, reviewId))
    .limit(1);
  if (!existing.length) return res.status(404).json({ error: "Review not found" });

  const station = await db
    .select()
    .from(stationsTable)
    .where(eq(stationsTable.id, existing[0].stationId))
    .limit(1);
  if (!station.length) return res.status(404).json({ error: "Station not found" });
  if (station[0].ownerClerkUserId !== clerkUserId) {
    return res.status(403).json({ error: "Only the station owner can reply to reviews" });
  }

  const existingReply = await db
    .select()
    .from(reviewRepliesTable)
    .where(eq(reviewRepliesTable.reviewId, reviewId))
    .limit(1);
  if (existingReply.length) return res.status(409).json({ error: "A reply already exists for this review" });

  const [reply] = await db
    .insert(reviewRepliesTable)
    .values({ reviewId, clerkUserId, body: bodyParsed.data.body })
    .returning();

  return res.status(201).json({
    ...reply,
    createdAt: reply.createdAt.toISOString(),
  });
});

router.delete("/reviews/:id/reply", requireAuth, async (req, res) => {
  const reviewId = parseInt(String(req.params.id), 10);
  if (isNaN(reviewId)) return res.status(400).json({ error: "Invalid id" });

  const clerkUserId = (req as any).clerkUserId as string;

  const existing = await db
    .select()
    .from(reviewRepliesTable)
    .where(eq(reviewRepliesTable.reviewId, reviewId))
    .limit(1);

  if (!existing.length) return res.status(404).json({ error: "Reply not found" });
  if (existing[0].clerkUserId !== clerkUserId) return res.status(403).json({ error: "Forbidden" });

  await db.delete(reviewRepliesTable).where(eq(reviewRepliesTable.reviewId, reviewId));

  return res.status(204).end();
});

export default router;

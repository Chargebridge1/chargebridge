import { Router } from "express";
import { db } from "@workspace/db";
import { householdMembersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";

const router = Router();

router.get("/household/members", requireAuth, async (req, res) => {
  const clerkUserId = (req as any).clerkUserId as string;
  const members = await db
    .select()
    .from(householdMembersTable)
    .where(eq(householdMembersTable.ownerClerkId, clerkUserId));
  return res.json(members.map(m => ({ ...m, invitedAt: m.invitedAt.toISOString() })));
});

router.post("/household/invite", requireAuth, async (req, res) => {
  // The prior four-additional-members rule is not part of the approved Family
  // contract. Existing records remain readable; no new unverified access claim.
  return res.status(409).json({
    code: "HOUSEHOLD_INVITES_NOT_READY",
    error: "New household invitations are unavailable until household access rules are approved.",
  });
});

router.delete("/household/members/:id", requireAuth, async (req, res) => {
  const clerkUserId = (req as any).clerkUserId as string;
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  await db
    .delete(householdMembersTable)
    .where(and(eq(householdMembersTable.id, id), eq(householdMembersTable.ownerClerkId, clerkUserId)));

  return res.status(204).end();
});

export default router;

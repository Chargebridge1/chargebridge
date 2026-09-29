import { Router } from "express";
import { getAuth } from "@clerk/express";
import {
  db,
  fleetVehiclesTable,
  userVehiclesTable,
  fleetDriverAssignmentsTable,
  organizationsTable,
  orgMembershipsTable,
} from "@workspace/db";
import { eq, and, inArray, gte, isNull, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import type { OrgRole } from "@workspace/db";
import { resolveMembershipEntitlement } from "../lib/membershipEntitlements";
import {
  inspectPersonalVehicleAllowance,
  personalVehicleAllowanceFailure,
  type PersonalVehicleUsage,
} from "../lib/personalVehicleLimits";
import {
  assertFleetVehicleMutationHasConfirmedBilling,
  FleetBillingSafetyError,
} from "../lib/fleetBilling";

const router = Router();

function rejectUnconfirmedFleetVehicleQuantityChange(
  res: import("express").Response,
  currentActiveVehicleCount: number,
  targetActiveVehicleCount: number,
) {
  try {
    assertFleetVehicleMutationHasConfirmedBilling({
      currentActiveVehicleCount,
      targetActiveVehicleCount,
      // This API does not issue Stripe mutations in this development phase.
      confirmedStripeQuantity: null,
    });
    return null;
  } catch (err) {
    if (!(err instanceof FleetBillingSafetyError)) throw err;
    return res.status(409).json({
      code: err.code,
      error: err.message,
    });
  }
}

function rejectPersonalVehicleLimit(
  res: import("express").Response,
  usage: PersonalVehicleUsage,
) {
  if (usage.allowed) return null;
  const failure = personalVehicleAllowanceFailure(usage);
  return res.status(failure.status).json(failure);
}

async function assignDriverWithinScope(
  tx: any,
  vehicleId: number,
  driverEmail: string,
  driverName: string | null,
  scope: { organizationId: number | null; ownerClerkId: string },
) {
  // Serialize all assignments for a normalized driver address, regardless
  // of whether the caller is using a personal or organization route.
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(701732, hashtext(${driverEmail}))`,
  );

  const vehicleScope = scope.organizationId === null
    ? and(
        eq(fleetVehiclesTable.ownerClerkId, scope.ownerClerkId),
        isNull(fleetVehiclesTable.organizationId),
      )
    : eq(fleetVehiclesTable.organizationId, scope.organizationId);
  const [targetVehicle] = await tx
    .select({ id: fleetVehiclesTable.id })
    .from(fleetVehiclesTable)
    .where(and(eq(fleetVehiclesTable.id, vehicleId), vehicleScope))
    .for("update");
  if (!targetVehicle) return { kind: "notFound" } as const;

  const [targetAssignment] = await tx
    .select()
    .from(fleetDriverAssignmentsTable)
    .where(eq(fleetDriverAssignmentsTable.vehicleId, vehicleId))
    .for("update");
  const currentDriverAssignments = await tx
    .select()
    .from(fleetDriverAssignmentsTable)
    .where(eq(fleetDriverAssignmentsTable.driverEmail, driverEmail))
    .for("update");
  const relevantVehicleIds: number[] = [
    ...new Set<number>(
      currentDriverAssignments.map((assignment: any) => assignment.vehicleId as number),
    ),
  ];
  const relevantVehicles: Array<typeof fleetVehiclesTable.$inferSelect> = relevantVehicleIds.length
    ? await tx
        .select()
        .from(fleetVehiclesTable)
        .where(inArray(fleetVehiclesTable.id, relevantVehicleIds))
    : [];
  const vehicleById = new Map<number, typeof fleetVehiclesTable.$inferSelect>(
    relevantVehicles.map((vehicle: any) => [vehicle.id, vehicle]),
  );
  const conflict = currentDriverAssignments.some((assignment: any) => {
    const assignedVehicle = vehicleById.get(assignment.vehicleId);
    if (!assignedVehicle) return true;
    return scope.organizationId === null
      ? assignedVehicle.organizationId !== null
        || assignedVehicle.ownerClerkId !== scope.ownerClerkId
      : assignedVehicle.organizationId !== scope.organizationId;
  });
  if (conflict) {
    return {
      kind: "conflict",
      error: "This driver is already assigned outside the authorized vehicle scope.",
    } as const;
  }

  const removeAssignmentIds: number[] = [
    ...new Set<number>([
      ...currentDriverAssignments.map((assignment: any) => assignment.id),
      ...(targetAssignment ? [targetAssignment.id] : []),
    ]),
  ];
  if (removeAssignmentIds.length) {
    await tx
      .delete(fleetDriverAssignmentsTable)
      .where(inArray(fleetDriverAssignmentsTable.id, removeAssignmentIds));
  }
  const [assignment] = await tx
    .insert(fleetDriverAssignmentsTable)
    .values({ vehicleId, driverEmail, driverName })
    .returning();
  return { kind: "assigned", assignment } as const;
}

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

async function resolveOrgMembership(
  orgId: number,
  clerkUserId: string,
  email: string
) {
  // Check direct membership
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

  // Check if org owner (owner always has admin)
  const [org] = await db
    .select()
    .from(organizationsTable)
    .where(eq(organizationsTable.id, orgId));
  if (org?.ownerClerkId === clerkUserId) {
    return {
      id: -1,
      orgId,
      clerkUserId,
      email,
      name: null,
      role: "admin" as OrgRole,
      joinedAt: org.createdAt,
    };
  }

  return null;
}

function requireOrgRole(...roles: OrgRole[]) {
  return async (req: any, res: any, next: any) => {
    const clerkUserId = req.clerkUserId as string;
    const email = await getCallerEmail(req);
    const orgId = Number(req.params.orgId);
    if (isNaN(orgId)) return res.status(400).json({ error: "Invalid orgId" });

    const m = await resolveOrgMembership(orgId, clerkUserId, email);
    if (!m) return res.status(403).json({ error: "Not a member of this organization" });
    if (roles.length && !roles.includes(m.role as OrgRole))
      return res.status(403).json({ error: "Insufficient role" });

    req.orgMembership = m;
    req.orgId = orgId;
    next();
  };
}

async function getVehiclesWithDrivers(orgId: number) {
  const vehicles = await db
    .select()
    .from(fleetVehiclesTable)
    .where(eq(fleetVehiclesTable.organizationId, orgId));

  return Promise.all(
    vehicles.map(async (v) => {
      const [driver] = await db
        .select()
        .from(fleetDriverAssignmentsTable)
        .where(eq(fleetDriverAssignmentsTable.vehicleId, v.id));
      return { ...v, driver: driver ?? null };
    })
  );
}

// ── GET /api/me/fleet-orgs — orgs the caller belongs to ─────────────────────
router.get("/me/fleet-orgs", requireAuth, async (req, res) => {
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
      .where(eq(organizationsTable.ownerClerkId, clerkUserId));

    // Merge and deduplicate
    const memberOrgIds = new Set(memberships.map((m) => m.orgId));
    const orgsToFetch = [
      ...memberships.map((m) => m.orgId),
      ...ownedOrgs.filter((o) => !memberOrgIds.has(o.id)).map((o) => o.id),
    ];

    if (orgsToFetch.length === 0) return res.json([]);

    const orgs = await db
      .select()
      .from(organizationsTable)
      .where(inArray(organizationsTable.id, orgsToFetch));

    const result = orgs.map((org) => {
      const m = memberships.find((m) => m.orgId === org.id);
      return {
        ...org,
        role: m?.role ?? "admin",
        membershipId: m?.id ?? null,
      };
    });

    return res.json(result);
  } catch (err) {
    logger.error({ err }, "Failed to list fleet orgs");
    return res.status(500).json({ error: "Failed to load organizations" });
  }
});

// ── POST /api/fleet/orgs — create organization ───────────────────────────────
router.post("/fleet/orgs", requireAuth, async (req, res) => {
  const clerkUserId = (req as any).clerkUserId as string;
  const email = await getCallerEmail(req as any);
  const { name, description } = req.body;

  if (!name?.trim()) return res.status(400).json({ error: "name is required" });

  try {
    // Generate unique slug
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
        name: name.trim(),
        slug,
        description: description?.trim() || null,
        ownerClerkId: clerkUserId,
      })
      .returning();

    // Auto-enroll creator as admin member
    await db.insert(orgMembershipsTable).values({
      orgId: org.id,
      clerkUserId,
      email: email.toLowerCase(),
      role: "admin",
    });

    req.log.info({ orgId: org.id }, "Fleet organization created");
    return res.status(201).json({ ...org, role: "admin" });
  } catch (err: any) {
    if (err?.cause?.code === "23505" || err?.code === "23505") {
      return res.status(409).json({ error: "Organization slug already exists" });
    }
    logger.error({ err }, "Failed to create organization");
    return res.status(500).json({ error: "Failed to create organization" });
  }
});

// ── GET /api/fleet/orgs/:orgId — get org info ────────────────────────────────
router.get(
  "/fleet/orgs/:orgId",
  requireAuth,
  requireOrgRole(),
  async (req: any, res) => {
    try {
      const [org] = await db
        .select()
        .from(organizationsTable)
        .where(eq(organizationsTable.id, req.orgId));
      if (!org) return res.status(404).json({ error: "Organization not found" });

      const members = await db
        .select()
        .from(orgMembershipsTable)
        .where(eq(orgMembershipsTable.orgId, req.orgId));

      return res.json({ ...org, role: req.orgMembership.role, memberCount: members.length });
    } catch (err) {
      logger.error({ err }, "Failed to get org");
      return res.status(500).json({ error: "Failed to load organization" });
    }
  }
);

// ── PATCH /api/fleet/orgs/:orgId — update org ────────────────────────────────
router.patch(
  "/fleet/orgs/:orgId",
  requireAuth,
  requireOrgRole("admin"),
  async (req: any, res) => {
    const { name, description } = req.body;
    const updates: Partial<typeof organizationsTable.$inferInsert> = {
      updatedAt: new Date(),
    };
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
      logger.error({ err }, "Failed to update org");
      return res.status(500).json({ error: "Failed to update organization" });
    }
  }
);

// ── GET /api/fleet/orgs/:orgId/dashboard ─────────────────────────────────────
router.get(
  "/fleet/orgs/:orgId/dashboard",
  requireAuth,
  requireOrgRole(),
  async (req: any, res) => {
    try {
      const vehicles = await getVehiclesWithDrivers(req.orgId);
      const members = await db
        .select()
        .from(orgMembershipsTable)
        .where(eq(orgMembershipsTable.orgId, req.orgId));

      const drivers = members.filter((m) =>
        ["driver", "supervisor"].includes(m.role)
      );
      const driverEmails = drivers.map((d) => d.email.toLowerCase());

      // Pull sessions for all driver emails in this org
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

      let todaySessions: any[] = [];
      let monthSessions: any[] = [];

      if (driverEmails.length > 0) {
        const { chargingSessionsTable } = await import("@workspace/db");

        todaySessions = await db
          .select()
          .from(chargingSessionsTable)
          .where(
            and(
              inArray(chargingSessionsTable.driverEmail, driverEmails),
              gte(chargingSessionsTable.createdAt, today)
            )
          );

        monthSessions = await db
          .select()
          .from(chargingSessionsTable)
          .where(
            and(
              inArray(chargingSessionsTable.driverEmail, driverEmails),
              gte(chargingSessionsTable.createdAt, monthStart)
            )
          );
      }

      const activeVehicles = vehicles.filter((v) => v.status === "active");
      const assignedVehicles = vehicles.filter((v) => v.driver !== null);

      const todayKwh = todaySessions.reduce((s, r) => s + (r.kwh ?? 0), 0);
      const todayCents = todaySessions.reduce((s, r) => s + (r.amountCents ?? 0), 0);
      const monthCents = monthSessions.reduce((s, r) => s + (r.amountCents ?? 0), 0);
      const monthKwh = monthSessions.reduce((s, r) => s + (r.kwh ?? 0), 0);

      const activeSessions = todaySessions.filter(
        (s) => s.chargingState === "charging" || s.chargingState === "remote_start_sent"
      );

      return res.json({
        totalVehicles: vehicles.length,
        activeVehicles: activeVehicles.length,
        assignedVehicles: assignedVehicles.length,
        totalMembers: members.length,
        totalDrivers: driverEmails.length,
        activeSessionCount: activeSessions.length,
        todayKwh: Math.round(todayKwh * 10) / 10,
        todayCostCents: todayCents,
        monthKwh: Math.round(monthKwh * 10) / 10,
        monthCostCents: monthCents,
        todaySessionCount: todaySessions.length,
        monthSessionCount: monthSessions.length,
        activeSessions,
        recentSessions: todaySessions.slice(0, 5),
      });
    } catch (err) {
      logger.error({ err }, "Failed to load fleet dashboard");
      return res.status(500).json({ error: "Failed to load dashboard" });
    }
  }
);

// ── GET /api/fleet/orgs/:orgId/vehicles ──────────────────────────────────────
router.get(
  "/fleet/orgs/:orgId/vehicles",
  requireAuth,
  requireOrgRole(),
  async (req: any, res) => {
    try {
      const vehicles = await getVehiclesWithDrivers(req.orgId);
      return res.json(vehicles);
    } catch (err) {
      logger.error({ err }, "Failed to list org vehicles");
      return res.status(500).json({ error: "Failed to list vehicles" });
    }
  }
);

// ── POST /api/fleet/orgs/:orgId/vehicles ─────────────────────────────────────
router.post(
  "/fleet/orgs/:orgId/vehicles",
  requireAuth,
  requireOrgRole("admin", "manager"),
  async (req: any, res) => {
    const clerkUserId = (req as any).clerkUserId as string;
    const {
      nickname, make, model, year, licensePlate, vin, color,
      department, batteryKwh, rangePerCharge, connectorType,
    } = req.body;
    const requestedStatus = req.body.status === "inactive" ? "inactive" : "active";

    if (!nickname?.trim()) return res.status(400).json({ error: "nickname is required" });

    try {
      if (requestedStatus === "active") {
        const currentActive = await db
          .select({ id: fleetVehiclesTable.id })
          .from(fleetVehiclesTable)
          .where(
            and(
              eq(fleetVehiclesTable.organizationId, req.orgId),
              eq(fleetVehiclesTable.status, "active"),
            ),
          );
        const blocked = rejectUnconfirmedFleetVehicleQuantityChange(
          res,
          currentActive.length,
          currentActive.length + 1,
        );
        if (blocked) return blocked;
      }

      const [vehicle] = await db
        .insert(fleetVehiclesTable)
        .values({
          ownerClerkId: clerkUserId,
          organizationId: req.orgId,
          nickname: nickname.trim(),
          make: make?.trim() || null,
          model: model?.trim() || null,
          year: year?.trim() || null,
          licensePlate: licensePlate?.trim() || null,
          vin: vin?.trim() || null,
          color: color?.trim() || null,
          department: department?.trim() || null,
          batteryKwh: batteryKwh ? Number(batteryKwh) : null,
          rangePerCharge: rangePerCharge ? Number(rangePerCharge) : null,
          connectorType: connectorType?.trim() || null,
          status: requestedStatus,
        })
        .returning();
      return res.status(201).json({ ...vehicle, driver: null });
    } catch (err) {
      logger.error({ err }, "Failed to add org vehicle");
      return res.status(500).json({ error: "Failed to add vehicle" });
    }
  }
);

// ── PUT /api/fleet/orgs/:orgId/vehicles/:vid ─────────────────────────────────
router.put(
  "/fleet/orgs/:orgId/vehicles/:vid",
  requireAuth,
  requireOrgRole("admin", "manager"),
  async (req: any, res) => {
    const vid = Number(req.params.vid);
    if (isNaN(vid)) return res.status(400).json({ error: "Invalid vehicle ID" });

    const [existing] = await db
      .select()
      .from(fleetVehiclesTable)
      .where(
        and(
          eq(fleetVehiclesTable.id, vid),
          eq(fleetVehiclesTable.organizationId, req.orgId)
        )
      );
    if (!existing) return res.status(404).json({ error: "Vehicle not found" });

    const {
      nickname, make, model, year, licensePlate, vin, color,
      department, batteryKwh, rangePerCharge, connectorType, status,
    } = req.body;

    if (
      (status === "active" || status === "inactive")
      && status !== existing.status
    ) {
      const currentActive = await db
        .select({ id: fleetVehiclesTable.id })
        .from(fleetVehiclesTable)
        .where(
          and(
            eq(fleetVehiclesTable.organizationId, req.orgId),
            eq(fleetVehiclesTable.status, "active"),
          ),
        );
      const targetCount = currentActive.length + (status === "active" ? 1 : -1);
      const blocked = rejectUnconfirmedFleetVehicleQuantityChange(
        res,
        currentActive.length,
        targetCount,
      );
      if (blocked) return blocked;
    }

    const updates: Partial<typeof fleetVehiclesTable.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (nickname?.trim()) updates.nickname = nickname.trim();
    if (make !== undefined) updates.make = make?.trim() || null;
    if (model !== undefined) updates.model = model?.trim() || null;
    if (year !== undefined) updates.year = year?.trim() || null;
    if (licensePlate !== undefined) updates.licensePlate = licensePlate?.trim() || null;
    if (vin !== undefined) updates.vin = vin?.trim() || null;
    if (color !== undefined) updates.color = color?.trim() || null;
    if (department !== undefined) updates.department = department?.trim() || null;
    if (batteryKwh !== undefined) updates.batteryKwh = batteryKwh ? Number(batteryKwh) : null;
    if (rangePerCharge !== undefined) updates.rangePerCharge = rangePerCharge ? Number(rangePerCharge) : null;
    if (connectorType !== undefined) updates.connectorType = connectorType?.trim() || null;
    if (status === "active" || status === "inactive") updates.status = status;

    try {
      const [updated] = await db
        .update(fleetVehiclesTable)
        .set(updates)
        .where(eq(fleetVehiclesTable.id, vid))
        .returning();
      const [driver] = await db
        .select()
        .from(fleetDriverAssignmentsTable)
        .where(eq(fleetDriverAssignmentsTable.vehicleId, vid));
      return res.json({ ...updated, driver: driver ?? null });
    } catch (err) {
      logger.error({ err }, "Failed to update org vehicle");
      return res.status(500).json({ error: "Failed to update vehicle" });
    }
  }
);

// ── DELETE /api/fleet/orgs/:orgId/vehicles/:vid ───────────────────────────────
router.delete(
  "/fleet/orgs/:orgId/vehicles/:vid",
  requireAuth,
  requireOrgRole("admin", "manager"),
  async (req: any, res) => {
    const vid = Number(req.params.vid);
    if (isNaN(vid)) return res.status(400).json({ error: "Invalid vehicle ID" });

    const [existing] = await db
      .select()
      .from(fleetVehiclesTable)
      .where(
        and(
          eq(fleetVehiclesTable.id, vid),
          eq(fleetVehiclesTable.organizationId, req.orgId)
        )
      );
    if (!existing) return res.status(404).json({ error: "Vehicle not found" });

    try {
      if (existing.status === "active") {
        const currentActive = await db
          .select({ id: fleetVehiclesTable.id })
          .from(fleetVehiclesTable)
          .where(
            and(
              eq(fleetVehiclesTable.organizationId, req.orgId),
              eq(fleetVehiclesTable.status, "active"),
            ),
          );
        const blocked = rejectUnconfirmedFleetVehicleQuantityChange(
          res,
          currentActive.length,
          currentActive.length - 1,
        );
        if (blocked) return blocked;
      }
      await db.delete(fleetVehiclesTable).where(eq(fleetVehiclesTable.id, vid));
      return res.status(204).send();
    } catch (err) {
      logger.error({ err }, "Failed to delete org vehicle");
      return res.status(500).json({ error: "Failed to delete vehicle" });
    }
  }
);

// ── POST /api/fleet/orgs/:orgId/vehicles/:vid/driver ─────────────────────────
router.post(
  "/fleet/orgs/:orgId/vehicles/:vid/driver",
  requireAuth,
  requireOrgRole("admin", "manager"),
  async (req: any, res) => {
    const vid = Number(req.params.vid);
    if (isNaN(vid)) return res.status(400).json({ error: "Invalid vehicle ID" });

    const { driverEmail, driverName } = req.body;
    const emailStr = typeof driverEmail === "string" ? driverEmail.trim().toLowerCase() : "";
    if (!emailStr || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailStr)) {
      return res.status(400).json({ error: "A valid driverEmail is required" });
    }

    try {
      const result = await db.transaction((tx) =>
        assignDriverWithinScope(
          tx,
          vid,
          emailStr,
          driverName?.trim() || null,
          {
            organizationId: req.orgId,
            ownerClerkId: req.clerkUserId,
          },
        ),
      );
      if (result.kind === "notFound") {
        return res.status(404).json({ error: "Vehicle not found" });
      }
      if (result.kind === "conflict") {
        return res.status(409).json({
          code: "DRIVER_ASSIGNMENT_SCOPE_CONFLICT",
          error: result.error,
        });
      }
      return res.status(201).json(result.assignment);
    } catch (err) {
      logger.error({ err }, "Failed to assign driver to org vehicle");
      return res.status(500).json({ error: "Failed to assign driver" });
    }
  }
);

// ── DELETE /api/fleet/orgs/:orgId/vehicles/:vid/driver ───────────────────────
router.delete(
  "/fleet/orgs/:orgId/vehicles/:vid/driver",
  requireAuth,
  requireOrgRole("admin", "manager"),
  async (req: any, res) => {
    const vid = Number(req.params.vid);
    if (isNaN(vid)) return res.status(400).json({ error: "Invalid vehicle ID" });

    try {
      const vehicleFound = await db.transaction(async (tx) => {
        const [vehicle] = await tx
          .select({ id: fleetVehiclesTable.id })
          .from(fleetVehiclesTable)
          .where(
            and(
              eq(fleetVehiclesTable.id, vid),
              eq(fleetVehiclesTable.organizationId, req.orgId),
            ),
          )
          .for("update");
        if (!vehicle) return false;

        // Keep the organization predicate on the destructive statement too.
        // Repeated and concurrent removals are idempotent: deleting no
        // assignment still returns success.
        await tx
          .delete(fleetDriverAssignmentsTable)
          .where(
            and(
              eq(fleetDriverAssignmentsTable.vehicleId, vid),
              inArray(
                fleetDriverAssignmentsTable.vehicleId,
                tx
                  .select({ id: fleetVehiclesTable.id })
                  .from(fleetVehiclesTable)
                  .where(
                    and(
                      eq(fleetVehiclesTable.id, vid),
                      eq(fleetVehiclesTable.organizationId, req.orgId),
                    ),
                  ),
              ),
            ),
          );
        return true;
      });
      if (!vehicleFound) return res.status(404).json({ error: "Vehicle not found" });
      return res.status(204).send();
    } catch (err) {
      logger.error({ err }, "Failed to remove driver");
      return res.status(500).json({ error: "Failed to remove driver" });
    }
  }
);

// ── GET /api/fleet/orgs/:orgId/members ───────────────────────────────────────
router.get(
  "/fleet/orgs/:orgId/members",
  requireAuth,
  requireOrgRole(),
  async (req: any, res) => {
    try {
      const members = await db
        .select()
        .from(orgMembershipsTable)
        .where(eq(orgMembershipsTable.orgId, req.orgId));
      return res.json(members);
    } catch (err) {
      logger.error({ err }, "Failed to list org members");
      return res.status(500).json({ error: "Failed to list members" });
    }
  }
);

// ── POST /api/fleet/orgs/:orgId/members — invite by email ────────────────────
router.post(
  "/fleet/orgs/:orgId/members",
  requireAuth,
  requireOrgRole("admin", "manager"),
  async (req: any, res) => {
    const { email, name, role = "driver" } = req.body;
    const emailStr = typeof email === "string" ? email.trim().toLowerCase() : "";
    if (!emailStr || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailStr)) {
      return res.status(400).json({ error: "A valid email is required" });
    }

    const validRoles: OrgRole[] = ["admin", "manager", "supervisor", "driver", "analyst"];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: "Invalid role" });
    }

    // Only admins can add admins
    if (role === "admin" && req.orgMembership.role !== "admin") {
      return res.status(403).json({ error: "Only admins can add other admins" });
    }

    try {
      // Check existing
      const [existing] = await db
        .select()
        .from(orgMembershipsTable)
        .where(
          and(
            eq(orgMembershipsTable.orgId, req.orgId),
            eq(orgMembershipsTable.email, emailStr)
          )
        );
      if (existing) {
        return res.status(409).json({ error: "Member already exists" });
      }

      const [member] = await db
        .insert(orgMembershipsTable)
        .values({
          orgId: req.orgId,
          email: emailStr,
          name: name?.trim() || null,
          role: role as OrgRole,
        })
        .returning();
      return res.status(201).json(member);
    } catch (err) {
      logger.error({ err }, "Failed to add member");
      return res.status(500).json({ error: "Failed to add member" });
    }
  }
);

// ── PATCH /api/fleet/orgs/:orgId/members/:mid — change role ──────────────────
router.patch(
  "/fleet/orgs/:orgId/members/:mid",
  requireAuth,
  requireOrgRole("admin"),
  async (req: any, res) => {
    const mid = Number(req.params.mid);
    if (isNaN(mid)) return res.status(400).json({ error: "Invalid member ID" });

    const { role } = req.body;
    const validRoles: OrgRole[] = ["admin", "manager", "supervisor", "driver", "analyst"];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: "Invalid role" });
    }

    try {
      const [updated] = await db
        .update(orgMembershipsTable)
        .set({ role: role as OrgRole })
        .where(
          and(
            eq(orgMembershipsTable.id, mid),
            eq(orgMembershipsTable.orgId, req.orgId)
          )
        )
        .returning();
      if (!updated) return res.status(404).json({ error: "Member not found" });
      return res.json(updated);
    } catch (err) {
      logger.error({ err }, "Failed to update member role");
      return res.status(500).json({ error: "Failed to update role" });
    }
  }
);

// ── DELETE /api/fleet/orgs/:orgId/members/:mid ───────────────────────────────
router.delete(
  "/fleet/orgs/:orgId/members/:mid",
  requireAuth,
  requireOrgRole("admin", "manager"),
  async (req: any, res) => {
    const mid = Number(req.params.mid);
    if (isNaN(mid)) return res.status(400).json({ error: "Invalid member ID" });

    try {
      await db
        .delete(orgMembershipsTable)
        .where(
          and(
            eq(orgMembershipsTable.id, mid),
            eq(orgMembershipsTable.orgId, req.orgId)
          )
        );
      return res.status(204).send();
    } catch (err) {
      logger.error({ err }, "Failed to remove member");
      return res.status(500).json({ error: "Failed to remove member" });
    }
  }
);

// ── GET /api/fleet/orgs/:orgId/sessions ──────────────────────────────────────
router.get(
  "/fleet/orgs/:orgId/sessions",
  requireAuth,
  requireOrgRole(),
  async (req: any, res) => {
    try {
      const members = await db
        .select()
        .from(orgMembershipsTable)
        .where(eq(orgMembershipsTable.orgId, req.orgId));

      const driverEmails = members
        .filter((m) => ["driver", "supervisor"].includes(m.role))
        .map((m) => m.email.toLowerCase());

      if (driverEmails.length === 0) return res.json([]);

      const { chargingSessionsTable } = await import("@workspace/db");
      const limit = Math.min(Number(req.query.limit ?? 50), 200);
      const sessions = await db
        .select()
        .from(chargingSessionsTable)
        .where(inArray(chargingSessionsTable.driverEmail, driverEmails))
        .orderBy(sql`${chargingSessionsTable.createdAt} desc`)
        .limit(limit);

      return res.json(sessions);
    } catch (err) {
      logger.error({ err }, "Failed to load fleet sessions");
      return res.status(500).json({ error: "Failed to load sessions" });
    }
  }
);

// ── GET /api/fleet/orgs/:orgId/analytics ─────────────────────────────────────
router.get(
  "/fleet/orgs/:orgId/analytics",
  requireAuth,
  requireOrgRole(),
  async (req: any, res) => {
    try {
      const members = await db
        .select()
        .from(orgMembershipsTable)
        .where(eq(orgMembershipsTable.orgId, req.orgId));

      const driverEmails = members
        .filter((m) => ["driver", "supervisor"].includes(m.role))
        .map((m) => m.email.toLowerCase());

      if (driverEmails.length === 0) {
        return res.json({ daily: [], byVehicle: [], byDriver: [] });
      }

      const { chargingSessionsTable } = await import("@workspace/db");
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const sessions = await db
        .select()
        .from(chargingSessionsTable)
        .where(
          and(
            inArray(chargingSessionsTable.driverEmail, driverEmails),
            gte(chargingSessionsTable.createdAt, thirtyDaysAgo)
          )
        );

      // Aggregate by day
      const byDay = new Map<string, { kwh: number; costCents: number; count: number }>();
      for (const s of sessions) {
        const day = s.createdAt.toISOString().slice(0, 10);
        const curr = byDay.get(day) ?? { kwh: 0, costCents: 0, count: 0 };
        curr.kwh += s.kwh ?? 0;
        curr.costCents += s.amountCents ?? 0;
        curr.count += 1;
        byDay.set(day, curr);
      }

      // Fill missing days
      const daily: Array<{ date: string; kwh: number; costCents: number; sessions: number }> = [];
      for (let i = 29; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        const val = byDay.get(key) ?? { kwh: 0, costCents: 0, count: 0 };
        daily.push({ date: key, kwh: Math.round(val.kwh * 10) / 10, costCents: val.costCents, sessions: val.count });
      }

      // By driver
      const byDriver = new Map<string, { kwh: number; costCents: number; count: number }>();
      for (const s of sessions) {
        const curr = byDriver.get(s.driverEmail) ?? { kwh: 0, costCents: 0, count: 0 };
        curr.kwh += s.kwh ?? 0;
        curr.costCents += s.amountCents ?? 0;
        curr.count += 1;
        byDriver.set(s.driverEmail, curr);
      }

      return res.json({
        daily,
        byDriver: [...byDriver.entries()].map(([email, v]) => ({
          email,
          kwh: Math.round(v.kwh * 10) / 10,
          costCents: v.costCents,
          sessions: v.count,
        })),
      });
    } catch (err) {
      logger.error({ err }, "Failed to load fleet analytics");
      return res.status(500).json({ error: "Failed to load analytics" });
    }
  }
);

// ── GET /api/fleet/orgs/:orgId/billing ───────────────────────────────────────
router.get(
  "/fleet/orgs/:orgId/billing",
  requireAuth,
  requireOrgRole("admin", "manager", "analyst"),
  async (req: any, res) => {
    try {
      const vehicles = await getVehiclesWithDrivers(req.orgId);
      const members = await db
        .select()
        .from(orgMembershipsTable)
        .where(eq(orgMembershipsTable.orgId, req.orgId));

      const driverEmails = members
        .filter((m) => ["driver", "supervisor"].includes(m.role))
        .map((m) => m.email.toLowerCase());

      if (driverEmails.length === 0) {
        return res.json({ summary: [], totalCents: 0, totalKwh: 0, sessionCount: 0 });
      }

      const { chargingSessionsTable } = await import("@workspace/db");
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);

      const sessions = await db
        .select()
        .from(chargingSessionsTable)
        .where(
          and(
            inArray(chargingSessionsTable.driverEmail, driverEmails),
            gte(chargingSessionsTable.createdAt, monthStart)
          )
        );

      // Build per-driver summary
      const driverMap = new Map<string, { name: string | null; kwh: number; costCents: number; count: number }>();
      for (const m of members) {
        driverMap.set(m.email.toLowerCase(), { name: m.name, kwh: 0, costCents: 0, count: 0 });
      }
      for (const s of sessions) {
        const curr = driverMap.get(s.driverEmail) ?? { name: s.driverName, kwh: 0, costCents: 0, count: 0 };
        curr.kwh += s.kwh ?? 0;
        curr.costCents += s.amountCents ?? 0;
        curr.count += 1;
        driverMap.set(s.driverEmail, curr);
      }

      const summary = [...driverMap.entries()].map(([email, v]) => ({
        email,
        name: v.name,
        kwh: Math.round(v.kwh * 10) / 10,
        costCents: v.costCents,
        sessions: v.count,
      }));

      const totalCents = sessions.reduce((s, r) => s + (r.amountCents ?? 0), 0);
      const totalKwh = sessions.reduce((s, r) => s + (r.kwh ?? 0), 0);

      return res.json({
        summary,
        totalCents,
        totalKwh: Math.round(totalKwh * 10) / 10,
        sessionCount: sessions.length,
        month: monthStart.toISOString().slice(0, 7),
      });
    } catch (err) {
      logger.error({ err }, "Failed to load fleet billing");
      return res.status(500).json({ error: "Failed to load billing" });
    }
  }
);

// ── GET /api/fleet/orgs/:orgId/billing/export.csv ────────────────────────────
router.get(
  "/fleet/orgs/:orgId/billing/export.csv",
  requireAuth,
  requireOrgRole("admin", "manager", "analyst"),
  async (req: any, res) => {
    try {
      const members = await db
        .select()
        .from(orgMembershipsTable)
        .where(eq(orgMembershipsTable.orgId, req.orgId));

      const driverEmails = members
        .filter((m) => ["driver", "supervisor"].includes(m.role))
        .map((m) => m.email.toLowerCase());

      if (driverEmails.length === 0) {
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", 'attachment; filename="fleet-billing.csv"');
        return res.send("Driver,Email,Sessions,kWh,Cost (USD)\n");
      }

      const { chargingSessionsTable } = await import("@workspace/db");
      const sessions = await db
        .select()
        .from(chargingSessionsTable)
        .where(inArray(chargingSessionsTable.driverEmail, driverEmails))
        .orderBy(sql`${chargingSessionsTable.createdAt} desc`);

      const lines = [
        "Date,Station,Driver,Driver Email,kWh,Cost (USD),Status",
        ...sessions.map((s) => {
          const date = s.createdAt.toISOString().slice(0, 10);
          const cost = ((s.amountCents ?? 0) / 100).toFixed(2);
          const kwh = (s.kwh ?? 0).toFixed(2);
          const station = (s.stationName ?? "Unknown").replace(/,/g, " ");
          const driver = (s.driverName ?? "").replace(/,/g, " ");
          const email = s.driverEmail.replace(/,/g, " ");
          return `${date},${station},${driver},${email},${kwh},${cost},${s.status}`;
        }),
      ];

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", 'attachment; filename="fleet-billing.csv"');
      return res.send(lines.join("\n"));
    } catch (err) {
      logger.error({ err }, "Failed to export billing CSV");
      return res.status(500).json({ error: "Failed to export" });
    }
  }
);

// ── Legacy personal fleet endpoints (backward compat) ────────────────────────

async function resolvePersonalFleetRole(clerkUserId: string, email: string) {
  const ownedVehicles = await db
    .select()
    .from(fleetVehiclesTable)
    .where(
      and(
        eq(fleetVehiclesTable.ownerClerkId, clerkUserId),
        sql`${fleetVehiclesTable.organizationId} IS NULL`
      )
    );

  if (ownedVehicles.length > 0) {
    const vehiclesWithDrivers = await Promise.all(
      ownedVehicles.map(async (v) => {
        const [driver] = await db
          .select()
          .from(fleetDriverAssignmentsTable)
          .where(eq(fleetDriverAssignmentsTable.vehicleId, v.id));
        return { ...v, driver: driver ?? null };
      })
    );
    return { role: "owner" as const, vehicles: vehiclesWithDrivers };
  }

  const [assignment] = await db
    .select()
    .from(fleetDriverAssignmentsTable)
    .where(eq(fleetDriverAssignmentsTable.driverEmail, email.toLowerCase()));

  if (assignment) {
    const [vehicle] = await db
      .select()
      .from(fleetVehiclesTable)
      .where(eq(fleetVehiclesTable.id, assignment.vehicleId));
    if (vehicle) {
      return {
        role: "driver" as const,
        vehicle: { ...vehicle, driver: assignment },
        ownerClerkId: vehicle.ownerClerkId,
      };
    }
  }

  return { role: "none" as const };
}

router.get("/fleet/me", requireAuth, async (req, res) => {
  const clerkUserId = (req as any).clerkUserId as string;
  const email = await getCallerEmail(req as any);
  try {
    const result = await resolvePersonalFleetRole(clerkUserId, email);
    return res.json(result);
  } catch (err) {
    logger.error({ err }, "Failed to resolve fleet role");
    return res.status(500).json({ error: "Failed to load fleet data" });
  }
});

router.get("/fleet/vehicles", requireAuth, async (req, res) => {
  const clerkUserId = (req as any).clerkUserId as string;
  const email = await getCallerEmail(req as any);
  try {
    const result = await resolvePersonalFleetRole(clerkUserId, email);
    if (result.role === "owner") return res.json({ role: "owner", vehicles: result.vehicles });
    if (result.role === "driver") return res.json({ role: "driver", vehicle: result.vehicle });
    return res.json({ role: "none", vehicles: [] });
  } catch (err) {
    logger.error({ err }, "Failed to list fleet vehicles");
    return res.status(500).json({ error: "Failed to list vehicles" });
  }
});

router.post("/fleet/vehicles", requireAuth, async (req, res) => {
  const clerkUserId = (req as any).clerkUserId as string;
  const membership = resolveMembershipEntitlement(getAuth(req as any).sessionClaims);
  const { nickname, make, model, year, licensePlate, vin, color } = req.body;
  if (req.body.organizationId != null || req.body.orgId != null) {
    return res.status(400).json({
      code: "ORGANIZATION_VEHICLE_REQUIRES_ORG_ROUTE",
      error: "Create organization vehicles through the organization Fleet route.",
    });
  }
  if (!nickname?.trim()) return res.status(400).json({ error: "nickname is required" });
  try {
    const result = await db.transaction(async (tx) => {
      const usage = await inspectPersonalVehicleAllowance(
        {
          lockUser: async (id) => {
            await tx.execute(sql`SELECT pg_advisory_xact_lock(701731, hashtext(${id}))`);
          },
          countProfileVehicles: async (id) => {
            const rows = await tx
              .select({ id: userVehiclesTable.id })
              .from(userVehiclesTable)
              .where(eq(userVehiclesTable.clerkUserId, id));
            return rows.length;
          },
          countPersonalFleetVehicles: async (id) => {
            const rows = await tx
              .select({ id: fleetVehiclesTable.id })
              .from(fleetVehiclesTable)
              .where(
                and(
                  eq(fleetVehiclesTable.ownerClerkId, id),
                  isNull(fleetVehiclesTable.organizationId),
                  eq(fleetVehiclesTable.status, "active"),
                ),
              );
            return rows.length;
          },
        },
        clerkUserId,
        membership.plan,
      );
      if (!usage.allowed) return { usage } as const;

      const [vehicle] = await tx
        .insert(fleetVehiclesTable)
        .values({
          ownerClerkId: clerkUserId,
          organizationId: null,
          nickname: nickname.trim(),
          make: make?.trim() || null,
          model: model?.trim() || null,
          year: year?.trim() || null,
          licensePlate: licensePlate?.trim() || null,
          vin: vin?.trim() || null,
          color: color?.trim() || null,
          status: "active",
        })
        .returning();
      return { vehicle } as const;
    });
    if ("usage" in result && result.usage) return rejectPersonalVehicleLimit(res, result.usage);
    const { vehicle } = result;
    return res.status(201).json({ ...vehicle, driver: null });
  } catch (err) {
    logger.error({ err }, "Failed to add fleet vehicle");
    return res.status(500).json({ error: "Failed to add vehicle" });
  }
});

router.put("/fleet/vehicles/:id", requireAuth, async (req, res) => {
  const clerkUserId = (req as any).clerkUserId as string;
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid vehicle ID" });
  const { nickname, make, model, year, licensePlate, vin, color, status } = req.body;
  const updates: Partial<typeof fleetVehiclesTable.$inferInsert> = { updatedAt: new Date() };
  if (nickname?.trim()) updates.nickname = nickname.trim();
  if (make !== undefined) updates.make = make?.trim() || null;
  if (model !== undefined) updates.model = model?.trim() || null;
  if (year !== undefined) updates.year = year?.trim() || null;
  if (licensePlate !== undefined) updates.licensePlate = licensePlate?.trim() || null;
  if (vin !== undefined) updates.vin = vin?.trim() || null;
  if (color !== undefined) updates.color = color?.trim() || null;
  if (status === "active" || status === "inactive") updates.status = status;
  try {
    let updated: typeof fleetVehiclesTable.$inferSelect | undefined;
    if (status === "active") {
      const activation = await db.transaction(async (tx) => {
        // Every request targeting active enters the shared per-user critical
        // section. Do not choose the guarded path from a stale pre-lock read.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(701731, hashtext(${clerkUserId}))`);
        const [current] = await tx
          .select()
          .from(fleetVehiclesTable)
          .where(
            and(
              eq(fleetVehiclesTable.id, id),
              eq(fleetVehiclesTable.ownerClerkId, clerkUserId),
              isNull(fleetVehiclesTable.organizationId),
            ),
          )
          .for("update");
        if (!current) return { notFound: true } as const;

        const usage = await inspectPersonalVehicleAllowance(
          {
            lockUser: async (ownerId) => {
              await tx.execute(sql`SELECT pg_advisory_xact_lock(701731, hashtext(${ownerId}))`);
            },
            countProfileVehicles: async (ownerId) => {
              const rows = await tx
                .select({ id: userVehiclesTable.id })
                .from(userVehiclesTable)
                .where(eq(userVehiclesTable.clerkUserId, ownerId));
              return rows.length;
            },
            countPersonalFleetVehicles: async (ownerId) => {
              const rows = await tx
                .select({ id: fleetVehiclesTable.id })
                .from(fleetVehiclesTable)
                .where(
                  and(
                    eq(fleetVehiclesTable.ownerClerkId, ownerId),
                    isNull(fleetVehiclesTable.organizationId),
                    eq(fleetVehiclesTable.status, "active"),
                  ),
                );
              return rows.length;
            },
          },
          clerkUserId,
          resolveMembershipEntitlement(getAuth(req as any).sessionClaims).plan,
        );
        if (current.status !== "active" && !usage.allowed) {
          return { usage } as const;
        }
        const [activated] = await tx
          .update(fleetVehiclesTable)
          .set(updates)
          .where(
            and(
              eq(fleetVehiclesTable.id, id),
              eq(fleetVehiclesTable.ownerClerkId, clerkUserId),
              isNull(fleetVehiclesTable.organizationId),
            ),
          )
          .returning();
        return { updated: activated } as const;
      });
      if ("usage" in activation && activation.usage) {
        return rejectPersonalVehicleLimit(res, activation.usage);
      }
      if ("notFound" in activation) {
        return res.status(404).json({ error: "Vehicle not found" });
      }
      updated = activation.updated;
    } else {
      const [existing] = await db
        .select()
        .from(fleetVehiclesTable)
        .where(
          and(
            eq(fleetVehiclesTable.id, id),
            eq(fleetVehiclesTable.ownerClerkId, clerkUserId),
            isNull(fleetVehiclesTable.organizationId),
          ),
        );
      if (!existing) return res.status(404).json({ error: "Vehicle not found" });
      [updated] = await db
        .update(fleetVehiclesTable)
        .set(updates)
        .where(
          and(
            eq(fleetVehiclesTable.id, id),
            eq(fleetVehiclesTable.ownerClerkId, clerkUserId),
            isNull(fleetVehiclesTable.organizationId),
          ),
        )
        .returning();
    }
    if (!updated) return res.status(404).json({ error: "Vehicle not found" });
    const [driver] = await db
      .select()
      .from(fleetDriverAssignmentsTable)
      .where(eq(fleetDriverAssignmentsTable.vehicleId, id));
    return res.json({ ...updated, driver: driver ?? null });
  } catch (err) {
    logger.error({ err }, "Failed to update fleet vehicle");
    return res.status(500).json({ error: "Failed to update vehicle" });
  }
});

router.delete("/fleet/vehicles/:id", requireAuth, async (req, res) => {
  const clerkUserId = (req as any).clerkUserId as string;
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid vehicle ID" });
  const [existing] = await db
    .select()
    .from(fleetVehiclesTable)
    .where(
      and(
        eq(fleetVehiclesTable.id, id),
        eq(fleetVehiclesTable.ownerClerkId, clerkUserId),
        isNull(fleetVehiclesTable.organizationId),
      ),
    );
  if (!existing) return res.status(404).json({ error: "Vehicle not found" });
  try {
    const [deleted] = await db
      .delete(fleetVehiclesTable)
      .where(
        and(
          eq(fleetVehiclesTable.id, id),
          eq(fleetVehiclesTable.ownerClerkId, clerkUserId),
          isNull(fleetVehiclesTable.organizationId),
        ),
      )
      .returning();
    if (!deleted) return res.status(404).json({ error: "Vehicle not found" });
    return res.status(204).send();
  } catch (err) {
    logger.error({ err }, "Failed to delete fleet vehicle");
    return res.status(500).json({ error: "Failed to delete vehicle" });
  }
});

router.post("/fleet/vehicles/:id/driver", requireAuth, async (req, res) => {
  const clerkUserId = (req as any).clerkUserId as string;
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid vehicle ID" });
  const { driverEmail, driverName } = req.body;
  const emailStr = typeof driverEmail === "string" ? driverEmail.trim().toLowerCase() : "";
  if (!emailStr || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailStr)) {
    return res.status(400).json({ error: "A valid driverEmail is required" });
  }
  try {
    const result = await db.transaction((tx) =>
      assignDriverWithinScope(
        tx,
        id,
        emailStr,
        driverName?.trim() || null,
        { organizationId: null, ownerClerkId: clerkUserId },
      ),
    );
    if (result.kind === "notFound") {
      return res.status(404).json({ error: "Vehicle not found" });
    }
    if (result.kind === "conflict") {
      return res.status(409).json({
        code: "DRIVER_ASSIGNMENT_SCOPE_CONFLICT",
        error: result.error,
      });
    }
    return res.status(201).json(result.assignment);
  } catch (err) {
    logger.error({ err }, "Failed to assign driver");
    return res.status(500).json({ error: "Failed to assign driver" });
  }
});

router.delete("/fleet/vehicles/:id/driver", requireAuth, async (req, res) => {
  const clerkUserId = (req as any).clerkUserId as string;
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid vehicle ID" });
  const [vehicle] = await db
    .select()
    .from(fleetVehiclesTable)
    .where(
      and(
        eq(fleetVehiclesTable.id, id),
        eq(fleetVehiclesTable.ownerClerkId, clerkUserId),
        isNull(fleetVehiclesTable.organizationId),
      ),
    );
  if (!vehicle) return res.status(404).json({ error: "Vehicle not found" });
  try {
    await db.delete(fleetDriverAssignmentsTable).where(eq(fleetDriverAssignmentsTable.vehicleId, id));
    return res.status(204).send();
  } catch (err) {
    logger.error({ err }, "Failed to remove driver");
    return res.status(500).json({ error: "Failed to remove driver" });
  }
});

export default router;

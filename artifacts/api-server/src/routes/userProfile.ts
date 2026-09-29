import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { usersTable, chargingHistoryTable, chargingSessionsTable, stationsTable, favoritesTable, userVehiclesTable, fleetVehiclesTable, profileChangelogTable, connectorAffinitiesTable } from "@workspace/db";
import { eq, desc, and, or, gte, lte, ilike, asc, ne, sql, isNull } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { resolveMembershipEntitlement } from "../lib/membershipEntitlements";
import {
  inspectPersonalVehicleAllowance,
  personalVehicleAllowanceFailure,
} from "../lib/personalVehicleLimits";

const router = Router();

async function logProfileChange(
  clerkUserId: string,
  deviceId: string,
  deviceType: string,
  fieldGroup: string,
  action: "added" | "updated" | "removed",
  label: string
) {
  try {
    await db.insert(profileChangelogTable).values({
      clerkUserId,
      deviceId,
      deviceType,
      fieldGroup,
      changeSummary: { action, label },
    });
  } catch {}
}

router.get("/me", requireAuth, async (req, res) => {
  const clerkUserId = (req as any).clerkUserId as string;
  const auth = getAuth(req);
  const membership = resolveMembershipEntitlement(auth.sessionClaims);

  let user = await db.query.usersTable.findFirst({
    where: eq(usersTable.clerkId, clerkUserId),
  });

  if (!user) {
    const auth = getAuth(req);
    const email = ((auth as any)?.sessionClaims?.email ?? "").toLowerCase();
    const name = (auth as any)?.sessionClaims?.fullName ?? null;
    const [inserted] = await db
      .insert(usersTable)
      .values({ clerkId: clerkUserId, email, name })
      .onConflictDoUpdate({
        target: usersTable.clerkId,
        set: { email, name },
      })
      .returning();
    user = inserted;
  }

  const favCount = await db
    .select()
    .from(favoritesTable)
    .where(eq(favoritesTable.clerkUserId, clerkUserId));

  // Include primary vehicle from the vehicles table so mobile stays in sync with web
  const primaryVehicle = await db.query.userVehiclesTable.findFirst({
    where: and(eq(userVehiclesTable.clerkUserId, clerkUserId), eq(userVehiclesTable.isPrimary, true)),
  }) ?? await db.query.userVehiclesTable.findFirst({
    where: eq(userVehiclesTable.clerkUserId, clerkUserId),
    orderBy: desc(userVehiclesTable.createdAt),
  });

  return res.json({
    ...user,
    createdAt: user.createdAt.toISOString(),
    favoritesCount: favCount.length,
    // Always expose primary vehicle fields so mobile effectiveVehicle stays consistent with web
    vehicleMake: primaryVehicle?.make ?? user.vehicleMake,
    vehicleModel: primaryVehicle?.model ?? user.vehicleModel,
    vehicleYear: primaryVehicle?.year ?? user.vehicleYear,
    connectorType: primaryVehicle?.connectorType ?? user.connectorType,
    batteryKwh: primaryVehicle?.batteryKwh ?? user.batteryKwh,
    rangePerCharge: primaryVehicle?.rangePerCharge ?? user.rangePerCharge,
    fuelType: primaryVehicle?.fuelType ?? user.fuelType,
    mpg: primaryVehicle?.mpg ?? user.mpg,
    membership: {
      plan: membership.plan,
      features: membership.features,
      personalVehicleLimit: membership.personalVehicleLimit,
    },
  });
});

router.get("/charging-history", requireAuth, async (req, res) => {
  const clerkUserId = (req as any).clerkUserId as string;
  const { from, to, stationName } = req.query as { from?: string; to?: string; stationName?: string };

  const fromDate = from ? new Date(from) : null;
  const toDate = to ? new Date(to) : null;

  const user = await db.query.usersTable.findFirst({
    where: eq(usersTable.clerkId, clerkUserId),
  });

  const legacyConditions: Parameters<typeof and>[] = [
    eq(chargingHistoryTable.clerkUserId, clerkUserId) as any,
  ];
  if (fromDate) legacyConditions.push(gte(chargingHistoryTable.chargedAt, fromDate) as any);
  if (toDate) legacyConditions.push(lte(chargingHistoryTable.chargedAt, toDate) as any);
  if (stationName) legacyConditions.push(ilike(chargingHistoryTable.stationName, `%${stationName}%`) as any);

  const legacyEntries = await db
    .select()
    .from(chargingHistoryTable)
    .where(and(...(legacyConditions as any[])))
    .orderBy(desc(chargingHistoryTable.chargedAt))
    .limit(50);

  const sessionConditions: Parameters<typeof and>[] = [
    eq(chargingSessionsTable.status, "completed") as any,
  ];
  if (user) sessionConditions.push(eq(chargingSessionsTable.driverEmail, user.email) as any);
  if (fromDate) sessionConditions.push(gte(chargingSessionsTable.completedAt, fromDate) as any);
  if (toDate) sessionConditions.push(lte(chargingSessionsTable.completedAt, toDate) as any);
  if (stationName)
    sessionConditions.push(
      or(
        ilike(stationsTable.name, `%${stationName}%`),
        ilike(chargingSessionsTable.stationName, `%${stationName}%`),
      ) as any,
    );

  const sessionEntries = user
    ? await db
        .select({
          id: chargingSessionsTable.id,
          stationId: chargingSessionsTable.stationId,
          stationName: sql<string | null>`coalesce(${stationsTable.name}, ${chargingSessionsTable.stationName})`,
          stationAddress: sql<string | null>`${stationsTable.address}`,
          chargerType: sql<string | null>`${stationsTable.chargerType}`,
          kwh: chargingSessionsTable.kwh,
          amountCents: chargingSessionsTable.amountCents,
          currency: chargingSessionsTable.currency,
          chargedAt: chargingSessionsTable.completedAt,
        })
        .from(chargingSessionsTable)
        .leftJoin(stationsTable, eq(chargingSessionsTable.stationId, stationsTable.id))
        .where(and(...(sessionConditions as any[])))
        .orderBy(desc(chargingSessionsTable.completedAt))
        .limit(50)
    : [];

  const legacyMapped = legacyEntries.map((h) => ({
    id: h.id,
    stationId: h.stationId ? Number(h.stationId) : null,
    stationName: h.stationName,
    stationAddress: h.stationAddress,
    chargerType: h.chargerType,
    kwh: h.kwh,
    amountCents: h.amountCents,
    currency: h.currency,
    chargedAt: h.chargedAt.toISOString(),
    source: "legacy" as const,
  }));

  const sessionMapped = sessionEntries.map((s) => ({
    id: s.id,
    stationId: s.stationId,
    stationName: s.stationName ?? "Charging Station",
    stationAddress: s.stationAddress ?? null,
    chargerType: (s.chargerType as string | null) ?? null,
    kwh: s.kwh,
    amountCents: s.amountCents,
    currency: s.currency,
    chargedAt: (s.chargedAt ?? new Date()).toISOString(),
    source: "session" as const,
  }));

  const seen = new Set<string>();
  const merged = [...sessionMapped, ...legacyMapped]
    .filter((e) => {
      const key = `${e.source}-${e.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.chargedAt.localeCompare(a.chargedAt))
    .slice(0, 50);

  return res.json(merged);
});

router.patch("/me", requireAuth, async (req, res) => {
  const clerkUserId = (req as any).clerkUserId as string;
  const { vehicleMake, vehicleModel, vehicleYear, connectorType, batteryKwh, rangePerCharge, fuelType, mpg, preferences, _deviceId, _deviceType } = req.body;

  const deviceId = (_deviceId as string) || "unknown";
  const deviceType = (_deviceType as string) || "web";

  const auth = getAuth(req);
  const email = ((auth as any)?.sessionClaims?.email ?? "").toLowerCase();
  const name = (auth as any)?.sessionClaims?.fullName ?? null;

  let mergedPreferences: Record<string, unknown> | undefined;
  if (preferences !== undefined && typeof preferences === "object" && preferences !== null) {
    const existing = await db.query.usersTable.findFirst({ where: eq(usersTable.clerkId, clerkUserId) });
    mergedPreferences = { ...(existing?.preferences ?? {}), ...preferences };
    await logProfileChange(clerkUserId, deviceId, deviceType, "preferences", "updated", "Preferences updated");
  }

  const vehicleFields = {
    ...(vehicleMake !== undefined && { vehicleMake }),
    ...(vehicleModel !== undefined && { vehicleModel }),
    ...(vehicleYear !== undefined && { vehicleYear }),
    ...(connectorType !== undefined && { connectorType }),
    ...(batteryKwh !== undefined && { batteryKwh: batteryKwh === null ? null : Number(batteryKwh) }),
    ...(rangePerCharge !== undefined && { rangePerCharge: rangePerCharge === null ? null : Number(rangePerCharge) }),
    ...(fuelType !== undefined && { fuelType }),
    ...(mpg !== undefined && { mpg: mpg === null ? null : Number(mpg) }),
    ...(mergedPreferences !== undefined && { preferences: mergedPreferences }),
  };

  const [updated] = await db
    .insert(usersTable)
    .values({ clerkId: clerkUserId, email, name, ...vehicleFields })
    .onConflictDoUpdate({ target: usersTable.clerkId, set: vehicleFields })
    .returning();

  return res.json({ ...updated, createdAt: updated.createdAt.toISOString() });
});

router.post("/charging-history", requireAuth, async (req, res) => {
  const clerkUserId = (req as any).clerkUserId as string;
  const { stationId, stationName, stationAddress, chargerType, kwh, amountCents, currency } = req.body;

  if (!stationName) return res.status(400).json({ error: "stationName required" });

  const [entry] = await db
    .insert(chargingHistoryTable)
    .values({
      clerkUserId,
      stationId: stationId ?? null,
      stationName,
      stationAddress: stationAddress ?? null,
      chargerType: chargerType ?? null,
      kwh: kwh ?? null,
      amountCents: amountCents ?? null,
      currency: currency ?? "usd",
    })
    .returning();

  return res.status(201).json({ ...entry, chargedAt: entry.chargedAt.toISOString() });
});

// ── Vehicle CRUD ─────────────────────────────────────────────────────────────

router.get("/me/vehicles", requireAuth, async (req, res) => {
  const clerkUserId = (req as any).clerkUserId as string;
  const vehicles = await db
    .select()
    .from(userVehiclesTable)
    .where(eq(userVehiclesTable.clerkUserId, clerkUserId))
    .orderBy(desc(userVehiclesTable.isPrimary), asc(userVehiclesTable.createdAt));
  const payload = vehicles.map(v => ({ ...v, createdAt: v.createdAt.toISOString() }));
  req.log.info({
    _diag: "GET /me/vehicles",
    clerkUserId,
    vehicleCount: payload.length,
    vehicleIds: payload.map(v => v.id),
    sqlRows: vehicles,
    jsonResponse: payload,
  }, "[DIAG] vehicle sync probe");
  return res.json(payload);
});

router.post("/me/vehicles", requireAuth, async (req, res) => {
  const clerkUserId = (req as any).clerkUserId as string;
  const { nickname, make, model, year, connectorType, batteryKwh, rangePerCharge, fuelType, mpg, plugTypes, color, catalogTrimId, _deviceId, _deviceType } = req.body;
  const auth = getAuth(req);
  const membership = resolveMembershipEntitlement(auth.sessionClaims);
  const deviceId = (_deviceId as string) || "unknown";
  const deviceType = (_deviceType as string) || "web";

  // Serialize every personal create path on the same Clerk-user transaction
  // lock and count both personal stores before applying the canonical limit.
  let vehicle;
  try {
    vehicle = await db.transaction(async (tx) => {
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

      if (!usage.allowed) {
        const failure = personalVehicleAllowanceFailure(usage);
        const error = new Error(failure.error) as Error & {
          code?: string;
          response?: typeof failure;
        };
        error.code = failure.code;
        error.response = failure;
        throw error;
      }

      const [created] = await tx
        .insert(userVehiclesTable)
        .values({
          clerkUserId,
          nickname: nickname || null,
          make: make || null,
          model: model || null,
          year: year || null,
          connectorType: connectorType || null,
          batteryKwh: batteryKwh ? Number(batteryKwh) : null,
          rangePerCharge: rangePerCharge ? Number(rangePerCharge) : null,
          fuelType: fuelType || null,
          mpg: mpg ? Number(mpg) : null,
          plugTypes: Array.isArray(plugTypes) ? plugTypes : (plugTypes ? [plugTypes] : null),
          color: color || null,
          catalogTrimId: catalogTrimId ? Number(catalogTrimId) : null,
          isPrimary: usage.activeVehicleCount === 0,
        })
        .returning();
      return created;
    });
  } catch (error) {
    const typedError = error as Error & { code?: string };
    if (
      typedError.code === "PLAN_VEHICLE_ACCESS_REQUIRED"
      || typedError.code === "PLAN_VEHICLE_LIMIT_REACHED"
      || typedError.code === "PERSONAL_VEHICLE_RECONCILIATION_REQUIRED"
    ) {
      const response = (error as Error & { response?: { status: number } & Record<string, unknown> }).response;
      res.status(response?.status ?? 403).json(response ?? {
        error: typedError.message,
        code: typedError.code,
        plan: membership.plan,
        maxActiveVehicles: membership.personalVehicleLimit,
      });
      return;
    }
    throw error;
  }

  const vehicleLabel = [make, model, year].filter(Boolean).join(" ") || "New vehicle";
  await logProfileChange(clerkUserId, deviceId, deviceType, "vehicles", "added", `Added vehicle: ${vehicleLabel}`);

  return res.status(201).json({ ...vehicle, createdAt: vehicle.createdAt.toISOString() });
});

router.patch("/me/vehicles/:id", requireAuth, async (req, res) => {
  const clerkUserId = (req as any).clerkUserId as string;
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  const { nickname, make, model, year, connectorType, batteryKwh, rangePerCharge, fuelType, mpg, plugTypes, color, catalogTrimId, _deviceId, _deviceType } = req.body;
  const deviceId = (_deviceId as string) || "unknown";
  const deviceType = (_deviceType as string) || "web";

  const [updated] = await db
    .update(userVehiclesTable)
    .set({
      nickname: nickname ?? null,
      make: make ?? null,
      model: model ?? null,
      year: year ?? null,
      connectorType: connectorType ?? null,
      batteryKwh: batteryKwh ? Number(batteryKwh) : null,
      rangePerCharge: rangePerCharge ? Number(rangePerCharge) : null,
      fuelType: fuelType ?? null,
      mpg: mpg ? Number(mpg) : null,
      plugTypes: Array.isArray(plugTypes) ? plugTypes : (plugTypes ? [plugTypes] : null),
      color: color ?? null,
      catalogTrimId: catalogTrimId !== undefined ? (catalogTrimId ? Number(catalogTrimId) : null) : undefined,
    })
    .where(and(eq(userVehiclesTable.id, id), eq(userVehiclesTable.clerkUserId, clerkUserId)))
    .returning();

  if (!updated) return res.status(404).json({ error: "Vehicle not found" });

  const vehicleLabel = [make, model, year].filter(Boolean).join(" ") || "Vehicle";
  await logProfileChange(clerkUserId, deviceId, deviceType, "vehicles", "updated", `Updated vehicle: ${vehicleLabel}`);

  return res.json({ ...updated, createdAt: updated.createdAt.toISOString() });
});

router.post("/me/vehicles/:id/primary", requireAuth, async (req, res) => {
  const clerkUserId = (req as any).clerkUserId as string;
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  await db
    .update(userVehiclesTable)
    .set({ isPrimary: false })
    .where(eq(userVehiclesTable.clerkUserId, clerkUserId));

  const [updated] = await db
    .update(userVehiclesTable)
    .set({ isPrimary: true })
    .where(and(eq(userVehiclesTable.id, id), eq(userVehiclesTable.clerkUserId, clerkUserId)))
    .returning();

  if (!updated) return res.status(404).json({ error: "Vehicle not found" });
  return res.json({ ...updated, createdAt: updated.createdAt.toISOString() });
});

router.delete("/me/vehicles/:id", requireAuth, async (req, res) => {
  const clerkUserId = (req as any).clerkUserId as string;
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  const deviceId = (req.query._deviceId as string) || (req.body?._deviceId as string) || "unknown";
  const deviceType = (req.query._deviceType as string) || (req.body?._deviceType as string) || "web";

  const [removed] = await db
    .select()
    .from(userVehiclesTable)
    .where(and(eq(userVehiclesTable.id, id), eq(userVehiclesTable.clerkUserId, clerkUserId)));

  await db
    .delete(userVehiclesTable)
    .where(and(eq(userVehiclesTable.id, id), eq(userVehiclesTable.clerkUserId, clerkUserId)));

  if (removed) {
    const vehicleLabel = [removed.make, removed.model, removed.year].filter(Boolean).join(" ") || "Vehicle";
    await logProfileChange(clerkUserId, deviceId, deviceType, "vehicles", "removed", `Removed vehicle: ${vehicleLabel}`);
  }

  const remaining = await db
    .select()
    .from(userVehiclesTable)
    .where(eq(userVehiclesTable.clerkUserId, clerkUserId))
    .orderBy(asc(userVehiclesTable.createdAt));

  if (remaining.length > 0 && !remaining.some(v => v.isPrimary)) {
    await db
      .update(userVehiclesTable)
      .set({ isPrimary: true })
      .where(eq(userVehiclesTable.id, remaining[0].id));
  }

  return res.status(204).end();
});

// ── Personal info change logging (called by Clerk webhook or direct) ───────────

router.post("/me/log-change", requireAuth, async (req, res) => {
  const clerkUserId = (req as any).clerkUserId as string;
  const { deviceId, deviceType, fieldGroup, action, label } = req.body;

  if (!fieldGroup || !action || !label) {
    return res.status(400).json({ error: "fieldGroup, action, and label are required" });
  }

  await logProfileChange(
    clerkUserId,
    deviceId || "unknown",
    deviceType || "web",
    fieldGroup,
    action,
    label
  );

  return res.status(201).json({ ok: true });
});

// ── Connector affinity ───────────────────────────────────────────────────────

router.get("/me/connector-affinity", requireAuth, async (req, res) => {
  const clerkUserId = (req as any).clerkUserId as string;
  try {
    const rows = await db
      .select({
        connectorType: connectorAffinitiesTable.connectorType,
        weight: connectorAffinitiesTable.weight,
        sessionCount: connectorAffinitiesTable.sessionCount,
        updatedAt: connectorAffinitiesTable.updatedAt,
      })
      .from(connectorAffinitiesTable)
      .where(eq(connectorAffinitiesTable.clerkUserId, clerkUserId))
      .orderBy(desc(connectorAffinitiesTable.weight));

    return res.json(
      rows.map((r) => ({
        connectorType: r.connectorType,
        weight: r.weight,
        sessionCount: r.sessionCount,
        updatedAt: r.updatedAt.toISOString(),
      })),
    );
  } catch (err) {
    req.log.warn({ err, clerkUserId }, "failed to load connector affinity");
    return res.json([]);
  }
});

// ── Cross-device change feed ──────────────────────────────────────────────────

router.get("/me/changes", requireAuth, async (req, res) => {
  const clerkUserId = (req as any).clerkUserId as string;
  const { since, deviceId } = req.query as { since?: string; deviceId?: string };

  if (!since) return res.json([]);

  const sinceDate = new Date(since);
  if (isNaN(sinceDate.getTime())) return res.status(400).json({ error: "Invalid since timestamp" });

  const conditions: any[] = [
    eq(profileChangelogTable.clerkUserId, clerkUserId),
    gte(profileChangelogTable.changedAt, sinceDate),
  ];

  if (deviceId) {
    conditions.push(ne(profileChangelogTable.deviceId, deviceId));
  }

  const changes = await db
    .select()
    .from(profileChangelogTable)
    .where(and(...conditions))
    .orderBy(desc(profileChangelogTable.changedAt))
    .limit(50);

  return res.json(
    changes.map(c => ({
      id: c.id,
      changedAt: c.changedAt.toISOString(),
      deviceType: c.deviceType,
      fieldGroup: c.fieldGroup,
      changeSummary: c.changeSummary,
    }))
  );
});

export default router;

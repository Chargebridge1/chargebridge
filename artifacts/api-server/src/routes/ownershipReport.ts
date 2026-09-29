import { Router } from "express";
import { db } from "@workspace/db";
import {
  usersTable,
  chargingHistoryTable,
  chargingSessionsTable,
  stationsTable,
  userVehiclesTable,
} from "@workspace/db";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";

const router = Router();

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface UnifiedEntry {
  stationName: string;
  stationAddress: string | null;
  chargerType: string | null;
  kwh: number;
  amountCents: number;
  chargedAt: Date;
  durationMinutes: number | null;
  source: "legacy" | "session";
  sourceId: number;
}

router.get("/me/ownership-report", requireAuth, async (req, res) => {
  const clerkUserId = (req as any).clerkUserId as string;
  const {
    period = "monthly",
    year: yearStr,
    month: monthStr,
  } = req.query as { period?: string; year?: string; month?: string };

  const now = new Date();
  const year = yearStr ? parseInt(yearStr, 10) : now.getFullYear();
  const month = monthStr ? parseInt(monthStr, 10) : now.getMonth() + 1;

  let fromDate: Date;
  let toDate: Date;
  let label: string;

  if (period === "annual") {
    fromDate = new Date(year, 0, 1);
    toDate = new Date(year + 1, 0, 1);
    label = String(year);
  } else {
    fromDate = new Date(year, month - 1, 1);
    toDate = new Date(year, month, 1);
    label = `${MONTHS[month - 1]} ${year}`;
  }

  const [user, primaryVehicle] = await Promise.all([
    db.query.usersTable.findFirst({ where: eq(usersTable.clerkId, clerkUserId) }),
    db.query.userVehiclesTable.findFirst({
      where: and(
        eq(userVehiclesTable.clerkUserId, clerkUserId),
        eq(userVehiclesTable.isPrimary, true),
      ),
    }),
  ]);

  const [legacyEntries, sessionEntries] = await Promise.all([
    db
      .select()
      .from(chargingHistoryTable)
      .where(
        and(
          eq(chargingHistoryTable.clerkUserId, clerkUserId),
          gte(chargingHistoryTable.chargedAt, fromDate),
          lte(chargingHistoryTable.chargedAt, toDate),
        ),
      ),
    user
      ? db
          .select({
            id: chargingSessionsTable.id,
            stationName: sql<string>`coalesce(${stationsTable.name}, ${chargingSessionsTable.stationName})`,
            stationAddress: sql<string | null>`${stationsTable.address}`,
            chargerType: sql<string | null>`${stationsTable.chargerType}`,
            kwh: chargingSessionsTable.kwh,
            amountCents: chargingSessionsTable.amountCents,
            chargedAt: chargingSessionsTable.completedAt,
            startedAt: chargingSessionsTable.startedAt,
          })
          .from(chargingSessionsTable)
          .leftJoin(stationsTable, eq(chargingSessionsTable.stationId, stationsTable.id))
          .where(
            and(
              eq(chargingSessionsTable.status, "completed"),
              eq(chargingSessionsTable.driverEmail, user.email),
              gte(chargingSessionsTable.completedAt, fromDate),
              lte(chargingSessionsTable.completedAt, toDate),
            ),
          )
      : Promise.resolve([]),
  ]);

  const allEntries: UnifiedEntry[] = [
    ...legacyEntries.map((h) => ({
      stationName: h.stationName,
      stationAddress: h.stationAddress ?? null,
      chargerType: h.chargerType ?? null,
      kwh: h.kwh ?? 0,
      amountCents: h.amountCents ?? 0,
      chargedAt: h.chargedAt,
      durationMinutes: null,
      source: "legacy" as const,
      sourceId: h.id,
    })),
    ...sessionEntries.map((s) => {
      const endMs = s.chargedAt?.getTime() ?? null;
      const startMs = s.startedAt?.getTime() ?? null;
      const durationMinutes =
        endMs !== null && startMs !== null ? Math.round((endMs - startMs) / 60000) : null;
      return {
        stationName: s.stationName ?? "Charging Station",
        stationAddress: s.stationAddress ?? null,
        chargerType: s.chargerType ?? null,
        kwh: s.kwh ?? 0,
        amountCents: s.amountCents ?? 0,
        chargedAt: s.chargedAt ?? new Date(),
        durationMinutes,
        source: "session" as const,
        sourceId: s.id,
      };
    }),
  ];

  const seen = new Set<string>();
  const deduped = allEntries.filter((e) => {
    const key = `${e.source}-${e.sourceId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const totalKwh = deduped.reduce((s, e) => s + e.kwh, 0);
  const totalCostCents = deduped.reduce((s, e) => s + e.amountCents, 0);
  const sessionCount = deduped.length;
  const avgCostPerKwh = totalKwh > 0 ? (totalCostCents / 100) / totalKwh : null;
  const totalMinutesCharging = deduped.reduce((s, e) => s + (e.durationMinutes ?? 0), 0);

  const stationMap = new Map<
    string,
    { name: string; sessions: number; kwh: number; address: string | null }
  >();
  for (const e of deduped) {
    const existing = stationMap.get(e.stationName);
    if (existing) {
      existing.sessions += 1;
      existing.kwh += e.kwh;
    } else {
      stationMap.set(e.stationName, {
        name: e.stationName,
        sessions: 1,
        kwh: e.kwh,
        address: e.stationAddress,
      });
    }
  }
  const topStations = Array.from(stationMap.values())
    .sort((a, b) => b.sessions - a.sessions || b.kwh - a.kwh)
    .slice(0, 5);

  const chargerTypeBreakdown = { dcfc: 0, level2: 0, level1: 0, unknown: 0 };
  for (const e of deduped) {
    const t = (e.chargerType ?? "").toLowerCase();
    if (t === "dcfc") chargerTypeBreakdown.dcfc += 1;
    else if (t === "level2" || t === "level 2") chargerTypeBreakdown.level2 += 1;
    else if (t === "level1" || t === "level 1") chargerTypeBreakdown.level1 += 1;
    else chargerTypeBreakdown.unknown += 1;
  }

  const monthlyBreakdown = MONTHS.map((name, i) => {
    const inMonth = deduped.filter((e) => e.chargedAt.getMonth() === i);
    return {
      month: name,
      kwh: Math.round(inMonth.reduce((s, e) => s + e.kwh, 0) * 100) / 100,
      costCents: inMonth.reduce((s, e) => s + e.amountCents, 0),
      sessions: inMonth.length,
    };
  });

  let vehicleEfficiency: number | null = null;
  if (primaryVehicle?.rangePerCharge && primaryVehicle.batteryKwh && primaryVehicle.batteryKwh > 0) {
    vehicleEfficiency = Math.round((primaryVehicle.rangePerCharge / primaryVehicle.batteryKwh) * 10) / 10;
  }

  res.json({
    period: period === "annual" ? "annual" : "monthly",
    label,
    sessionCount,
    totalKwh: Math.round(totalKwh * 100) / 100,
    totalCostCents,
    avgCostPerKwh: avgCostPerKwh !== null ? Math.round(avgCostPerKwh * 1000) / 1000 : null,
    totalMinutesCharging,
    topStations,
    chargerTypeBreakdown,
    monthlyBreakdown,
    vehicle: {
      efficiencyMiPerKwh: vehicleEfficiency,
      mpg: primaryVehicle?.mpg ?? null,
      make: primaryVehicle?.make ?? null,
      model: primaryVehicle?.model ?? null,
    },
  });
});

export default router;

import { Router } from "express";
import { db } from "@workspace/db";
import { chargingSessionsTable, stationsTable } from "@workspace/db";
import { eq, gte, and } from "drizzle-orm";

const router = Router();

type Period = "daily" | "weekly" | "monthly" | "quarterly" | "halfyear" | "annual";

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const QUARTER_LABELS = ["Q1", "Q2", "Q3", "Q4"];

function startOfDay(d: Date) {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function endOfDay(d: Date) {
  const r = new Date(d);
  r.setHours(23, 59, 59, 999);
  return r;
}

function addDays(d: Date, n: number) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function startOfWeek(d: Date) {
  const r = new Date(d);
  const day = r.getDay();
  r.setDate(r.getDate() - day);
  r.setHours(0, 0, 0, 0);
  return r;
}

function formatDateShort(d: Date) {
  return `${MONTH_SHORT[d.getMonth()]} ${d.getDate()}`;
}

interface Bucket {
  start: Date;
  end: Date;
  label: string;
}

function generateBuckets(period: Period, count: number): Bucket[] {
  const now = new Date();
  const buckets: Bucket[] = [];

  if (period === "daily") {
    for (let i = count - 1; i >= 0; i--) {
      const d = addDays(now, -i);
      buckets.push({ start: startOfDay(d), end: endOfDay(d), label: formatDateShort(d) });
    }
    return buckets;
  }

  if (period === "weekly") {
    for (let i = count - 1; i >= 0; i--) {
      const weekStart = startOfWeek(addDays(now, -i * 7));
      const weekEnd = endOfDay(addDays(weekStart, 6));
      buckets.push({ start: weekStart, end: weekEnd, label: `${formatDateShort(weekStart)}` });
    }
    return buckets;
  }

  if (period === "monthly") {
    for (let i = count - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const start = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
      buckets.push({ start, end, label: `${MONTH_SHORT[d.getMonth()]} '${String(d.getFullYear()).slice(2)}` });
    }
    return buckets;
  }

  if (period === "quarterly") {
    const curQ = Math.floor(now.getMonth() / 3);
    for (let i = count - 1; i >= 0; i--) {
      const absQ = curQ - i;
      const yearsBack = Math.floor(absQ < 0 ? (-absQ + 3) / 4 : 0);
      const q = ((absQ % 4) + 4) % 4;
      const year = now.getFullYear() + Math.floor((curQ - i) / 4) - (curQ - i < 0 && (curQ - i) % 4 !== 0 ? 0 : 0);
      const actualYear = now.getFullYear() + Math.floor((curQ - i - (curQ - i < 0 && ((curQ - i) % 4) !== 0 ? 1 : 0)) / 4);
      const start = new Date(actualYear, q * 3, 1, 0, 0, 0, 0);
      const end = new Date(actualYear, q * 3 + 3, 0, 23, 59, 59, 999);
      buckets.push({ start, end, label: `${QUARTER_LABELS[q]} ${actualYear}` });
    }
    return buckets;
  }

  if (period === "halfyear") {
    const curH = now.getMonth() < 6 ? 0 : 1;
    for (let i = count - 1; i >= 0; i--) {
      const absH = curH - i;
      const year = now.getFullYear() + Math.floor(absH / 2) - (absH < 0 && absH % 2 !== 0 ? 1 : 0);
      const h = ((absH % 2) + 2) % 2;
      const start = new Date(year, h === 0 ? 0 : 6, 1, 0, 0, 0, 0);
      const end = new Date(year, h === 0 ? 6 : 12, 0, 23, 59, 59, 999);
      buckets.push({ start, end, label: `${h === 0 ? "H1" : "H2"} ${year}` });
    }
    return buckets;
  }

  if (period === "annual") {
    for (let i = count - 1; i >= 0; i--) {
      const year = now.getFullYear() - i;
      const start = new Date(year, 0, 1, 0, 0, 0, 0);
      const end = new Date(year, 11, 31, 23, 59, 59, 999);
      buckets.push({ start, end, label: `${year}` });
    }
    return buckets;
  }

  return buckets;
}

const DEFAULT_COUNTS: Record<Period, number> = {
  daily: 30,
  weekly: 12,
  monthly: 12,
  quarterly: 8,
  halfyear: 6,
  annual: 5,
};

router.get("/analytics", async (req, res) => {
  const period = ((req.query.period as string) || "monthly") as Period;
  const validPeriods: Period[] = ["daily", "weekly", "monthly", "quarterly", "halfyear", "annual"];
  if (!validPeriods.includes(period)) return res.status(400).json({ error: "Invalid period" });

  const count = Math.min(Number(req.query.count) || DEFAULT_COUNTS[period], 60);
  const buckets = generateBuckets(period, count);
  const rangeStart = buckets[0]?.start ?? new Date(0);

  const sessions = await db
    .select({
      id: chargingSessionsTable.id,
      stationId: chargingSessionsTable.stationId,
      kwh: chargingSessionsTable.kwh,
      amountCents: chargingSessionsTable.amountCents,
      completedAt: chargingSessionsTable.completedAt,
      status: chargingSessionsTable.status,
    })
    .from(chargingSessionsTable)
    .where(
      and(
        eq(chargingSessionsTable.status, "completed"),
        gte(chargingSessionsTable.completedAt, rangeStart)
      )
    );

  const stations = await db.select({ id: stationsTable.id, name: stationsTable.name }).from(stationsTable);
  const stationMap = new Map(stations.map((s) => [s.id, s.name]));

  const bucketData = buckets.map((b) => {
    const inBucket = sessions.filter((s) => {
      const t = s.completedAt ? new Date(s.completedAt) : null;
      return t && t >= b.start && t <= b.end;
    });
    return {
      label: b.label,
      revenue: Math.round(inBucket.reduce((sum, s) => sum + s.amountCents, 0)) / 100,
      sessions: inBucket.length,
      kwh: Math.round(inBucket.reduce((sum, s) => sum + s.kwh, 0) * 100) / 100,
    };
  });

  const stationMap2 = new Map<number, { id: number; name: string; revenue: number; sessions: number; kwh: number }>();
  for (const s of sessions) {
    if (s.stationId == null) continue;
    const stationId = s.stationId;
    const existing = stationMap2.get(stationId) ?? {
      id: stationId,
      name: stationMap.get(stationId) ?? `Station #${stationId}`,
      revenue: 0,
      sessions: 0,
      kwh: 0,
    };
    existing.revenue = Math.round((existing.revenue + s.amountCents / 100) * 100) / 100;
    existing.sessions += 1;
    existing.kwh = Math.round((existing.kwh + s.kwh) * 100) / 100;
    stationMap2.set(stationId, existing);
  }

  const totalRevenue = sessions.reduce((sum, s) => sum + s.amountCents / 100, 0);
  const totalSessions = sessions.length;
  const totalKwh = sessions.reduce((sum, s) => sum + s.kwh, 0);

  return res.json({
    period,
    buckets: bucketData,
    totals: {
      revenue: Math.round(totalRevenue * 100) / 100,
      sessions: totalSessions,
      kwh: Math.round(totalKwh * 100) / 100,
      avgPerSession: totalSessions > 0 ? Math.round((totalRevenue / totalSessions) * 100) / 100 : 0,
    },
    stations: Array.from(stationMap2.values()).sort((a, b) => b.revenue - a.revenue),
  });
});

export default router;

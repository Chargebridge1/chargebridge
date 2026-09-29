import { db } from "@workspace/db";
import { connectorAffinitiesTable, stationsTable, userVehiclesTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

/** Exponential decay factor applied to old weights on each new session. */
export const AFFINITY_DECAY = 0.85;

/**
 * Apply one decay step to an existing affinity weight, mirroring the DB upsert:
 *   new_weight = old_weight * AFFINITY_DECAY + 1.0
 *
 * Exported for unit-test use only. All production writes go through incrementAffinity.
 */
export function applyDecayStep(oldWeight: number): number {
  return oldWeight * AFFINITY_DECAY + 1.0;
}

/**
 * Normalise a raw connector type string to the canonical forms used by
 * vehicleMatch.ts. Mirrors the `normalizeConnector` function in that module.
 */
function normalizeConnector(raw: string): string {
  const t = raw.toUpperCase().trim().replace(/[\s_\-]/g, "");
  if (t === "NACS" || t === "J3400" || t === "TESLA" || t === "TESLASUPERCHARGER") return "NACS";
  if (t.includes("CCS") || t.includes("COMBO")) return "CCS";
  if (t.includes("CHADEMO")) return "CHAdeMO";
  if (t.includes("J1772") || t === "TYPE1" || t === "TYPE2" || t === "IEC62196T1" || t === "IEC62196T2") return "J1772";
  return t;
}

/**
 * Infer the single connector type the user most likely used during a session.
 *
 * For Level 1 / Level 2 chargers the connector is unambiguously J1772.
 * For DCFC the connector depends on the vehicle: we look up the user's primary
 * vehicle (or most-recently-created vehicle if no primary is set) and return
 * their DC connector type. If no vehicle or DC connector is found we return
 * null and skip the affinity update for this session.
 *
 * Returning a single connector type per session ensures the affinity model
 * learns which connector the user *actually* uses rather than crediting all
 * connectors a station happens to support.
 */
async function inferConnectorUsed(
  clerkUserId: string,
  stationChargerType: string,
): Promise<string | null> {
  // Level 1 and Level 2 chargers use J1772 universally
  if (stationChargerType !== "DCFC") return "J1772";

  // For DCFC, derive from the user's vehicle profile
  const vehicles = await db
    .select({
      connectorType: userVehiclesTable.connectorType,
      plugTypes: userVehiclesTable.plugTypes,
      isPrimary: userVehiclesTable.isPrimary,
    })
    .from(userVehiclesTable)
    .where(eq(userVehiclesTable.clerkUserId, clerkUserId))
    .orderBy(desc(userVehiclesTable.isPrimary), desc(userVehiclesTable.createdAt))
    .limit(5);

  for (const v of vehicles) {
    const rawConnectors: string[] = [
      ...(v.connectorType ? [v.connectorType] : []),
      ...(v.plugTypes ?? []),
    ];
    for (const raw of rawConnectors) {
      const norm = normalizeConnector(raw);
      if (norm === "NACS" || norm === "CCS" || norm === "CHAdeMO") {
        return norm;
      }
    }
  }

  // No recognised DC connector found — skip update
  return null;
}

/**
 * Persist the affinity weight increase for a single connector type.
 * Uses an upsert with exponential decay so older sessions count less:
 *
 *   new_weight = old_weight * DECAY + 1.0
 */
async function incrementAffinity(clerkUserId: string, connectorType: string): Promise<void> {
  await db
    .insert(connectorAffinitiesTable)
    .values({
      clerkUserId,
      connectorType,
      weight: 1.0,
      sessionCount: 1,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [connectorAffinitiesTable.clerkUserId, connectorAffinitiesTable.connectorType],
      set: {
        weight: sql`${connectorAffinitiesTable.weight} * ${AFFINITY_DECAY} + 1.0`,
        sessionCount: sql`${connectorAffinitiesTable.sessionCount} + 1`,
        updatedAt: new Date(),
      },
    });
}

/**
 * Update connector affinity after a session completed at a community DB
 * station (by numeric station ID). Looks up the station's chargerType and
 * the user's vehicle profile to infer the single connector type actually used.
 *
 * Fire-and-forget — safe to call without awaiting. Errors are logged only.
 */
export function recordSessionConnectorAffinity(
  clerkUserId: string | null | undefined,
  stationId: number | null | undefined,
): void {
  if (!clerkUserId || stationId == null) return;

  Promise.all([
    db
      .select({ chargerType: stationsTable.chargerType })
      .from(stationsTable)
      .where(eq(stationsTable.id, stationId))
      .limit(1),
  ])
    .then(([[station]]) => {
      if (!station) return;
      return inferConnectorUsed(clerkUserId, station.chargerType).then((connector) => {
        if (!connector) return;
        return incrementAffinity(clerkUserId, connector);
      });
    })
    .catch((err) => {
      logger.warn({ err, clerkUserId, stationId }, "connector affinity update failed (non-fatal)");
    });
}

/**
 * Load the connector affinity weights for a user.
 * Returns a plain object mapping normalised connector type → weight.
 * Returns an empty object if the user has no affinity data.
 */
export async function loadConnectorAffinity(
  clerkUserId: string | null | undefined,
): Promise<Record<string, number>> {
  if (!clerkUserId) return {};
  try {
    const rows = await db
      .select({
        connectorType: connectorAffinitiesTable.connectorType,
        weight: connectorAffinitiesTable.weight,
      })
      .from(connectorAffinitiesTable)
      .where(eq(connectorAffinitiesTable.clerkUserId, clerkUserId));

    const result: Record<string, number> = {};
    for (const row of rows) {
      result[row.connectorType] = row.weight;
    }
    return result;
  } catch (err) {
    logger.warn({ err, clerkUserId }, "failed to load connector affinity (non-fatal)");
    return {};
  }
}

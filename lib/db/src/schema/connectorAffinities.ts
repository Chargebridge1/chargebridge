import { pgTable, text, real, integer, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * Stores a recency-weighted affinity score per (user, connector type) pair.
 *
 * After every completed charging session, the row for the session's connector
 * type is upserted using exponential decay:
 *
 *   new_weight = old_weight * DECAY + 1.0
 *
 * where DECAY = 0.85. This means:
 *   - First session: weight = 1.0
 *   - Steady-state (same connector every session): weight → 1 / (1 - 0.85) ≈ 6.67
 *   - A session from long ago contributes 0.85^n to today's weight
 *
 * `connectorType` is stored in the normalised form used by vehicleMatch.ts:
 *   "CCS" | "NACS" | "CHAdeMO" | "J1772" | (other raw strings)
 */
export const connectorAffinitiesTable = pgTable(
  "connector_affinities",
  {
    clerkUserId: text("clerk_user_id")
      .notNull()
      .references(() => usersTable.clerkId, { onDelete: "cascade" }),
    connectorType: text("connector_type").notNull(),
    weight: real("weight").notNull().default(0),
    sessionCount: integer("session_count").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.clerkUserId, t.connectorType] })],
);

export type ConnectorAffinity = typeof connectorAffinitiesTable.$inferSelect;

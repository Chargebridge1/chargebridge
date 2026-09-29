import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

export const phoneOtpsTable = pgTable("phone_otps", {
  id: serial("id").primaryKey(),
  phone: text("phone").notNull(),
  codeHash: text("code_hash").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  attempts: integer("attempts").notNull().default(0),
  verifiedAt: timestamp("verified_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type PhoneOtp = typeof phoneOtpsTable.$inferSelect;

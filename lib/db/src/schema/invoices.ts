import { pgTable, serial, text, integer, numeric, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const invoiceStatusEnum = pgEnum("invoice_status", ["draft", "sent", "paid", "overdue"]);

export const invoicesTable = pgTable("invoices", {
  id: serial("id").primaryKey(),
  ownerClerkId: text("owner_clerk_id"),
  invoiceNumber: text("invoice_number").notNull().unique(),
  businessName: text("business_name").notNull(),
  businessEmail: text("business_email").notNull(),
  status: invoiceStatusEnum("status").notNull().default("draft"),
  dueDate: timestamp("due_date").notNull(),
  notes: text("notes"),
  // Nullable FK to charging_sessions. A partial unique index on this column
  // (WHERE charging_session_id IS NOT NULL, see migration 0002) prevents
  // duplicate invoices from Stripe webhook retries while allowing multiple
  // non-charging invoices that carry NULL.
  chargingSessionId: integer("charging_session_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const invoiceItemsTable = pgTable("invoice_items", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull().references(() => invoicesTable.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  quantity: numeric("quantity", { precision: 10, scale: 2 }).notNull(),
  unitPrice: numeric("unit_price", { precision: 10, scale: 2 }).notNull(),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
});

export const invoicesRelations = relations(invoicesTable, ({ many }) => ({
  items: many(invoiceItemsTable),
}));

export const invoiceItemsRelations = relations(invoiceItemsTable, ({ one }) => ({
  invoice: one(invoicesTable, { fields: [invoiceItemsTable.invoiceId], references: [invoicesTable.id] }),
}));

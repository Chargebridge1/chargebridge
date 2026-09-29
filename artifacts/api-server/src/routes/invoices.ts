import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { invoicesTable, invoiceItemsTable } from "@workspace/db";
import { eq, and, gte } from "drizzle-orm";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { sendEmail } from "../lib/emailSender";
import { buildInvoiceEmailHtml } from "../lib/invoiceEmailTemplate";
import { requireAuth, isAdmin } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";

const router = Router();

// ── Plan limits ───────────────────────────────────────────────────────────────
const INVOICE_MONTHLY_LIMITS: Record<string, number | null> = {
  explorer: 5,
  driver: 10,
  fleet: null, // unlimited
};

function getPlanFromClaims(req: Parameters<typeof getAuth>[0]): string {
  const auth = getAuth(req);
  return ((auth?.sessionClaims?.publicMetadata as { plan?: string } | undefined)?.plan ?? "free");
}

function getMonthlyLimit(plan: string): number | null {
  return INVOICE_MONTHLY_LIMITS[plan] ?? 0; // unknown plan = 0 (no access)
}

function generateInvoiceNumber() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const rand = Math.floor(Math.random() * 9000) + 1000;
  return `INV-${year}${month}-${rand}`;
}

async function getInvoiceWithItems(invoiceId: number) {
  const invoice = await db.query.invoicesTable.findFirst({
    where: eq(invoicesTable.id, invoiceId),
    with: { items: true },
  });
  if (!invoice) return null;

  const totalAmount = invoice.items.reduce(
    (sum, item) => sum + parseFloat(String(item.amount)),
    0
  );

  return {
    ...invoice,
    totalAmount,
    dueDate: invoice.dueDate.toISOString(),
    createdAt: invoice.createdAt.toISOString(),
    items: invoice.items.map((item) => ({
      ...item,
      quantity: parseFloat(String(item.quantity)),
      unitPrice: parseFloat(String(item.unitPrice)),
      amount: parseFloat(String(item.amount)),
    })),
  };
}

function serializeInvoice(inv: typeof invoicesTable.$inferSelect & { items: typeof invoiceItemsTable.$inferSelect[] }) {
  return {
    ...inv,
    totalAmount: inv.items.reduce((s, i) => s + parseFloat(String(i.amount)), 0),
    dueDate: inv.dueDate.toISOString(),
    createdAt: inv.createdAt.toISOString(),
    items: inv.items.map((item) => ({
      ...item,
      quantity: parseFloat(String(item.quantity)),
      unitPrice: parseFloat(String(item.unitPrice)),
      amount: parseFloat(String(item.amount)),
    })),
  };
}

// Rate limit for invoice email sending — 10 emails/hour per user
// This endpoint is behind requireAuth so clerkUserId is always present;
// fall back to ipKeyGenerator only as a safety net.
const invoiceEmailRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  keyGenerator: (req) => (req as any).clerkUserId ?? ipKeyGenerator(req.ip ?? ""),
  message: { error: "Too many invoice emails sent. Please wait before sending more." },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Admin: list all invoices ─────────────────────────────────────────────────
// Intentionally restricted to admin only — returns all invoices in the system.
router.get("/invoices", requireAuth, async (req, res) => {
  const auth = getAuth(req);
  if (!isAdmin(auth)) {
    return res.status(403).json({ error: "Forbidden — admin access required" });
  }

  const { status, search } = req.query as { status?: string; search?: string };

  let invoices = await db.query.invoicesTable.findMany({
    with: { items: true },
    orderBy: (t, { desc }) => [desc(t.createdAt)],
  });

  if (status) invoices = invoices.filter((inv) => inv.status === status);
  if (search) {
    const lower = (search as string).toLowerCase();
    invoices = invoices.filter(
      (inv) =>
        inv.businessName.toLowerCase().includes(lower) ||
        inv.invoiceNumber.toLowerCase().includes(lower)
    );
  }

  return res.json(invoices.map(serializeInvoice));
});

router.post("/invoices", async (req, res) => {
  const { businessName, businessEmail, dueDate, notes, items } = req.body;

  if (!businessName || !businessEmail || !dueDate || !items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Invalid invoice data" });
  }

  // Optional auth — stamp ownerClerkId when a valid token is present
  const auth = getAuth(req);
  const ownerClerkId = auth?.userId ?? null;

  // If authenticated, enforce monthly plan limit
  if (ownerClerkId) {
    const plan = getPlanFromClaims(req);
    const limit = getMonthlyLimit(plan);

    if (limit === 0) {
      return res.status(403).json({ error: "Your plan does not include invoice creation.", plan });
    }

    if (limit !== null) {
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const existing = await db.query.invoicesTable.findMany({
        where: and(
          eq(invoicesTable.ownerClerkId, ownerClerkId),
          gte(invoicesTable.createdAt, startOfMonth)
        ),
        columns: { id: true },
      });

      if (existing.length >= limit) {
        return res.status(403).json({
          error: `Monthly invoice limit reached (${limit}/${limit}). Upgrade your plan for more.`,
          limit,
          used: existing.length,
          plan,
        });
      }
    }
  }

  const [invoice] = await db
    .insert(invoicesTable)
    .values({
      ownerClerkId,
      invoiceNumber: generateInvoiceNumber(),
      businessName,
      businessEmail,
      dueDate: new Date(dueDate),
      notes: notes || null,
      status: "draft",
    })
    .returning();

  const itemRows = items.map((item: { description: string; quantity: number; unitPrice: number }) => ({
    invoiceId: invoice.id,
    description: item.description,
    quantity: String(item.quantity),
    unitPrice: String(item.unitPrice),
    amount: String(parseFloat(String(item.quantity)) * parseFloat(String(item.unitPrice))),
  }));

  await db.insert(invoiceItemsTable).values(itemRows);

  const full = await getInvoiceWithItems(invoice.id);
  return res.status(201).json(full);
});

// ── Authenticated "my invoices" routes (mobile) — MUST come before /:id ──────

router.get("/invoices/my/count", requireAuth, async (req, res) => {
  const ownerClerkId = (req as any).clerkUserId as string;
  const plan = getPlanFromClaims(req);
  const limit = getMonthlyLimit(plan);

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const rows = await db.query.invoicesTable.findMany({
    where: and(
      eq(invoicesTable.ownerClerkId, ownerClerkId),
      gte(invoicesTable.createdAt, startOfMonth)
    ),
    columns: { id: true },
  });

  return res.json({ used: rows.length, limit, plan });
});

router.get("/invoices/my", requireAuth, async (req, res) => {
  const ownerClerkId = (req as any).clerkUserId as string;
  const plan = getPlanFromClaims(req);

  if (getMonthlyLimit(plan) === 0) {
    return res.status(403).json({ error: "Invoice access requires a paid plan.", plan });
  }

  const { status } = req.query as { status?: string };

  let invoices = await db.query.invoicesTable.findMany({
    with: { items: true },
    where: eq(invoicesTable.ownerClerkId, ownerClerkId),
    orderBy: (t, { desc }) => [desc(t.createdAt)],
  });

  if (status && status !== "all") {
    invoices = invoices.filter((inv) => inv.status === status);
  }

  return res.json({
    invoices: invoices.map(serializeInvoice),
    plan,
    limit: getMonthlyLimit(plan),
  });
});

// ── Per-invoice routes — authenticated + ownership enforced ────────────────────

router.get("/invoices/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  const auth = getAuth(req);
  const invoice = await getInvoiceWithItems(id);
  if (!invoice) return res.status(404).json({ error: "Invoice not found" });

  // Ownership check: admin OR invoice owner
  if (!isAdmin(auth) && invoice.ownerClerkId !== auth?.userId) {
    return res.status(403).json({ error: "Forbidden — not your invoice" });
  }

  return res.json(invoice);
});

router.patch("/invoices/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body;

  if (isNaN(id) || !["draft", "sent", "paid", "overdue"].includes(status)) {
    return res.status(400).json({ error: "Invalid request" });
  }

  const auth = getAuth(req);

  // Load invoice to check ownership before modifying
  const existing = await db.query.invoicesTable.findFirst({
    where: eq(invoicesTable.id, id),
  });
  if (!existing) return res.status(404).json({ error: "Invoice not found" });

  if (!isAdmin(auth) && existing.ownerClerkId !== auth?.userId) {
    return res.status(403).json({ error: "Forbidden — not your invoice" });
  }

  await db.update(invoicesTable).set({ status }).where(eq(invoicesTable.id, id));

  const invoice = await getInvoiceWithItems(id);
  return res.json(invoice);
});

router.delete("/invoices/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  const auth = getAuth(req);

  const existing = await db.query.invoicesTable.findFirst({
    where: eq(invoicesTable.id, id),
  });
  if (!existing) return res.status(404).json({ error: "Invoice not found" });

  if (!isAdmin(auth) && existing.ownerClerkId !== auth?.userId) {
    return res.status(403).json({ error: "Forbidden — not your invoice" });
  }

  await db.delete(invoicesTable).where(eq(invoicesTable.id, id));
  return res.status(204).send();
});

router.post("/invoices/:id/send-email", requireAuth, invoiceEmailRateLimit, async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  const auth = getAuth(req);

  const { toEmail } = req.body;
  // Validate email with a proper regex
  if (!toEmail || typeof toEmail !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail.trim())) {
    return res.status(400).json({ error: "A valid email address is required" });
  }

  const invoice = await getInvoiceWithItems(id);
  if (!invoice) return res.status(404).json({ error: "Invoice not found" });

  // Ownership check: admin OR invoice owner
  if (!isAdmin(auth) && invoice.ownerClerkId !== auth?.userId) {
    return res.status(403).json({ error: "Forbidden — not your invoice" });
  }

  const isReceipt = !!invoice.notes?.includes("[charging-receipt:");
  const html = buildInvoiceEmailHtml(invoice, isReceipt);

  const result = await sendEmail({
    to: toEmail.trim(),
    subject: `${isReceipt ? "Your charging receipt" : "Invoice"} — ${invoice.invoiceNumber}`,
    html,
    replyTo: invoice.businessEmail,
  });

  return res.json({ ok: result.ok, message: result.message });
});

export default router;

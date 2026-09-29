import { Router } from "express";
import { db } from "@workspace/db";
import { operatorApplicationsTable } from "@workspace/db";
import { z } from "zod";

const router = Router();

const SubmitApplicationBody = z.object({
  companyName: z.string().min(2, "Company name is required"),
  contactName: z.string().min(2, "Contact name is required"),
  email: z.string().email("Valid email is required"),
  phone: z.string().optional(),
  chargerBrand: z.string().min(1, "Charger brand is required"),
  chargerModel: z.string().optional(),
  ocppVersion: z.string().optional(),
  currentNetwork: z.string().optional(),
  stationCount: z.string().optional(),
  locations: z.string().optional(),
  notes: z.string().optional(),
});

type SubmitApplicationData = z.infer<typeof SubmitApplicationBody>;

router.post("/operator-applications", async (req, res) => {
  const parsed = SubmitApplicationBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid submission", details: parsed.error });
  }

  const data: SubmitApplicationData = parsed.data;

  const [application] = await db
    .insert(operatorApplicationsTable)
    .values({
      companyName: data.companyName,
      contactName: data.contactName,
      email: data.email,
      phone: data.phone ?? null,
      chargerBrand: data.chargerBrand,
      chargerModel: data.chargerModel ?? null,
      ocppVersion: data.ocppVersion ?? null,
      currentNetwork: data.currentNetwork ?? null,
      stationCount: data.stationCount ?? null,
      locations: data.locations ?? null,
      notes: data.notes ?? null,
    })
    .returning();

  req.log.info({ id: application.id, email: application.email }, "Operator application submitted");
  return res.status(201).json({ id: application.id, message: "Application submitted successfully" });
});

router.get("/operator-applications", async (_req, res) => {
  const applications = await db
    .select()
    .from(operatorApplicationsTable)
    .orderBy(operatorApplicationsTable.createdAt);
  return res.json(applications);
});

export default router;

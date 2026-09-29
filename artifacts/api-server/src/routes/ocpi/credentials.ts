import { Router } from "express";
import { randomBytes } from "crypto";
import { db } from "@workspace/db";
import { ocpiPartiesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { OcpiParty } from "@workspace/db";
import {
  ocpiResponse, ocpiError, requireOcpiAuth,
  getOcpiBaseUrl, OCPI_COUNTRY_CODE, OCPI_PARTY_ID,
} from "../../lib/ocpiHelpers";
import type { Credentials } from "../../lib/ocpiTypes";

const router = Router();

function makeToken(): string {
  return randomBytes(32).toString("hex");
}

function ourCredentials(base: string): Credentials {
  return {
    token: "",
    url: `${base}/api/ocpi/versions`,
    roles: [{
      role: "CPO",
      business_details: { name: "ChargeBridge" },
      party_id: OCPI_PARTY_ID,
      country_code: OCPI_COUNTRY_CODE,
    }],
  };
}

router.get("/credentials", requireOcpiAuth, (req, res) => {
  const party = res.locals.ocpiParty as OcpiParty;
  const base = getOcpiBaseUrl(req);
  res.json(ocpiResponse({ ...ourCredentials(base), token: party.inboundToken }));
});

router.post("/credentials", requireOcpiAuth, async (req, res) => {
  const party = res.locals.ocpiParty as OcpiParty;
  if (party.status === "CONNECTED") {
    ocpiError(res, 405, 2019, "Already registered. Use PUT to update credentials.");
    return;
  }

  const body = req.body as Partial<Credentials>;
  if (!body.token || !body.url || !Array.isArray(body.roles)) {
    ocpiError(res, 400, 2001, "token, url, and roles are required");
    return;
  }

  const tokenC = makeToken();
  const base = getOcpiBaseUrl(req);

  await db.update(ocpiPartiesTable).set({
    outboundToken: body.token,
    versionsUrl: body.url,
    inboundToken: tokenC,
    businessDetails: body.roles[0]?.business_details ?? party.businessDetails,
    status: "CONNECTED",
    updatedAt: new Date(),
  }).where(eq(ocpiPartiesTable.id, party.id));

  res.json(ocpiResponse({ ...ourCredentials(base), token: tokenC }));
});

router.put("/credentials", requireOcpiAuth, async (req, res) => {
  const party = res.locals.ocpiParty as OcpiParty;
  if (party.status !== "CONNECTED") {
    ocpiError(res, 405, 2019, "Not registered. Use POST to register.");
    return;
  }

  const body = req.body as Partial<Credentials>;
  if (!body.token || !body.url) {
    ocpiError(res, 400, 2001, "token and url are required");
    return;
  }

  const tokenC = makeToken();
  const base = getOcpiBaseUrl(req);

  await db.update(ocpiPartiesTable).set({
    outboundToken: body.token,
    versionsUrl: body.url,
    inboundToken: tokenC,
    businessDetails: body.roles?.[0]?.business_details ?? party.businessDetails,
    updatedAt: new Date(),
  }).where(eq(ocpiPartiesTable.id, party.id));

  res.json(ocpiResponse({ ...ourCredentials(base), token: tokenC }));
});

router.delete("/credentials", requireOcpiAuth, async (_req, res) => {
  const party = res.locals.ocpiParty as OcpiParty;
  await db.update(ocpiPartiesTable).set({
    status: "REMOVED",
    outboundToken: null,
    updatedAt: new Date(),
  }).where(eq(ocpiPartiesTable.id, party.id));
  res.json(ocpiResponse(null, 1000, "Registration removed"));
});

router.post("/admin/parties", async (req, res) => {
  if (req.headers["x-admin-key"] !== process.env.ADMIN_SETUP_KEY) {
    ocpiError(res, 401, 2010, "Unauthorized"); return;
  }
  const { country_code, party_id, role, name } = req.body as {
    country_code?: string; party_id?: string; role?: string; name?: string;
  };
  if (!country_code || !party_id || !role) {
    ocpiError(res, 400, 2001, "country_code, party_id, role are required"); return;
  }
  const tokenA = makeToken();
  const [party] = await db.insert(ocpiPartiesTable).values({
    countryCode: country_code.toUpperCase(),
    partyId: party_id.toUpperCase(),
    role: role.toUpperCase(),
    inboundToken: tokenA,
    status: "PLANNED",
    businessDetails: name ? { name } : null,
  }).returning();
  res.status(201).json(ocpiResponse({ id: party.id, token_a: tokenA, status: "PLANNED" }));
});

router.get("/admin/parties", async (req, res) => {
  if (req.headers["x-admin-key"] !== process.env.ADMIN_SETUP_KEY) {
    ocpiError(res, 401, 2010, "Unauthorized"); return;
  }
  const parties = await db.select({
    id: ocpiPartiesTable.id,
    countryCode: ocpiPartiesTable.countryCode,
    partyId: ocpiPartiesTable.partyId,
    role: ocpiPartiesTable.role,
    status: ocpiPartiesTable.status,
    versionsUrl: ocpiPartiesTable.versionsUrl,
    businessDetails: ocpiPartiesTable.businessDetails,
    createdAt: ocpiPartiesTable.createdAt,
  }).from(ocpiPartiesTable);
  res.json(ocpiResponse(parties));
});

export default router;

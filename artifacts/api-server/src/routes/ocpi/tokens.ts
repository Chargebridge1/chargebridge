import { Router } from "express";
import { db } from "@workspace/db";
import { ocpiTokensTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import type { OcpiParty } from "@workspace/db";
import {
  ocpiResponse, ocpiError, requireOcpiAuth, applyOcpiPagination,
} from "../../lib/ocpiHelpers";
import type { Token, AuthorizationInfo } from "../../lib/ocpiTypes";

const router = Router();

function rowToToken(t: typeof ocpiTokensTable.$inferSelect): Token {
  return {
    country_code: t.countryCode,
    party_id: t.partyId,
    uid: t.uid,
    type: t.type as Token["type"],
    contract_id: t.contractId,
    visual_number: t.visualNumber ?? undefined,
    issuer: t.issuer,
    group_id: t.groupId ?? undefined,
    valid: t.valid,
    whitelist: t.whitelist as Token["whitelist"],
    language: t.language ?? undefined,
    last_updated: t.lastUpdated.toISOString(),
  };
}

router.get("/tokens", requireOcpiAuth, async (req, res) => {
  const party = res.locals.ocpiParty as OcpiParty;
  const all = await db.select().from(ocpiTokensTable).where(
    and(
      eq(ocpiTokensTable.countryCode, party.countryCode),
      eq(ocpiTokensTable.partyId, party.partyId),
    ),
  );
  const page = applyOcpiPagination(all.map(rowToToken), req, res);
  res.json(ocpiResponse(page));
});

router.get("/tokens/:uid", requireOcpiAuth, async (req, res) => {
  const uid = String(req.params.uid);
  const party = res.locals.ocpiParty as OcpiParty;
  const [token] = await db.select().from(ocpiTokensTable).where(
    and(
      eq(ocpiTokensTable.uid, uid),
      eq(ocpiTokensTable.countryCode, party.countryCode),
      eq(ocpiTokensTable.partyId, party.partyId),
    ),
  ).limit(1);
  if (!token) { ocpiError(res, 404, 2004, "Unknown Token"); return; }
  res.json(ocpiResponse(rowToToken(token)));
});

router.post("/tokens/:uid/authorize", requireOcpiAuth, async (req, res) => {
  const uid = String(req.params.uid);
  const locationId = (req.query.location_id as string) ?? null;
  const evseUid = (req.query.evse_uid as string) ?? null;

  const [token] = await db.select().from(ocpiTokensTable)
    .where(eq(ocpiTokensTable.uid, uid))
    .limit(1);

  if (!token) {
    res.json(ocpiResponse({
      allowed: "NOT_ALLOWED",
      token: {
        country_code: "??", party_id: "???", uid,
        type: "RFID", contract_id: "", issuer: "", valid: false,
        whitelist: "NEVER", last_updated: new Date().toISOString(),
      },
      info: { language: "en", text: "Token not found" },
    } satisfies AuthorizationInfo));
    return;
  }

  const allowed: AuthorizationInfo["allowed"] = token.valid
    ? (token.whitelist === "NEVER" ? "NOT_ALLOWED" : "ALLOWED")
    : "BLOCKED";

  res.json(ocpiResponse({
    allowed,
    token: rowToToken(token),
    location: locationId ? {
      location_id: locationId,
      evse_uids: evseUid ? [evseUid] : undefined,
    } : undefined,
  } satisfies AuthorizationInfo));
});

router.put("/tokens/:uid", requireOcpiAuth, async (req, res) => {
  const uid = String(req.params.uid);
  const party = res.locals.ocpiParty as OcpiParty;
  const body = req.body as Partial<Token>;
  if (!body.type || !body.contract_id || !body.issuer) {
    ocpiError(res, 400, 2001, "type, contract_id, issuer are required"); return;
  }

  const existing = await db.select({ id: ocpiTokensTable.id }).from(ocpiTokensTable).where(
    and(
      eq(ocpiTokensTable.uid, uid),
      eq(ocpiTokensTable.countryCode, party.countryCode),
      eq(ocpiTokensTable.partyId, party.partyId),
    ),
  ).limit(1);

  if (existing.length > 0) {
    await db.update(ocpiTokensTable).set({
      type: body.type, contractId: body.contract_id, issuer: body.issuer,
      visualNumber: body.visual_number ?? null, groupId: body.group_id ?? null,
      valid: body.valid ?? true, whitelist: body.whitelist ?? "ALLOWED",
      language: body.language ?? null, lastUpdated: new Date(),
    }).where(
      and(
        eq(ocpiTokensTable.uid, uid),
        eq(ocpiTokensTable.countryCode, party.countryCode),
        eq(ocpiTokensTable.partyId, party.partyId),
      ),
    );
    res.json(ocpiResponse(null, 1000, "Token updated"));
  } else {
    await db.insert(ocpiTokensTable).values({
      countryCode: party.countryCode, partyId: party.partyId, uid,
      type: body.type, contractId: body.contract_id, issuer: body.issuer,
      visualNumber: body.visual_number ?? null, groupId: body.group_id ?? null,
      valid: body.valid ?? true, whitelist: body.whitelist ?? "ALLOWED",
      language: body.language ?? null,
    });
    res.status(201).json(ocpiResponse(null, 1000, "Token created"));
  }
});

router.patch("/tokens/:uid", requireOcpiAuth, async (req, res) => {
  const uid = String(req.params.uid);
  const party = res.locals.ocpiParty as OcpiParty;
  const body = req.body as Partial<Token>;
  const updateFields: Record<string, unknown> = { lastUpdated: new Date() };
  if (body.valid !== undefined) updateFields.valid = body.valid;
  if (body.whitelist !== undefined) updateFields.whitelist = body.whitelist;
  if (body.language !== undefined) updateFields.language = body.language;
  if (body.group_id !== undefined) updateFields.groupId = body.group_id;

  await db.update(ocpiTokensTable).set(updateFields).where(
    and(
      eq(ocpiTokensTable.uid, uid),
      eq(ocpiTokensTable.countryCode, party.countryCode),
      eq(ocpiTokensTable.partyId, party.partyId),
    ),
  );
  res.json(ocpiResponse(null, 1000, "Token updated"));
});

export default router;

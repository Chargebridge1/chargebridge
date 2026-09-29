import { Router } from "express";
import { db } from "@workspace/db";
import { ocpiTariffsTable, stationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  ocpiResponse, ocpiError, requireOcpiAuth,
  applyOcpiPagination, OCPI_COUNTRY_CODE, OCPI_PARTY_ID,
} from "../../lib/ocpiHelpers";
import type { Tariff } from "../../lib/ocpiTypes";

const router = Router();

function buildTariffFromStation(stationId: number, pricePerKwh: number, lastUpdated: Date): Tariff {
  return {
    country_code: OCPI_COUNTRY_CODE,
    party_id: OCPI_PARTY_ID,
    id: `${OCPI_COUNTRY_CODE}*${OCPI_PARTY_ID}*T${stationId}`,
    currency: "USD",
    type: "AD_HOC_PAYMENT",
    elements: [{
      price_components: [
        { type: "ENERGY", price: pricePerKwh, step_size: 1 },
      ],
    }],
    last_updated: lastUpdated.toISOString(),
  };
}

router.get("/tariffs", requireOcpiAuth, async (req, res) => {
  const stored = await db.select().from(ocpiTariffsTable);
  const linkedStationIds = new Set(stored.map(t => t.stationId).filter(Boolean));

  const stations = await db.select({
    id: stationsTable.id,
    pricePerKwh: stationsTable.pricePerKwh,
    createdAt: stationsTable.createdAt,
  }).from(stationsTable).where(eq(stationsTable.status, "available"));

  const derived: Tariff[] = stations
    .filter(s => !linkedStationIds.has(s.id))
    .map(s => buildTariffFromStation(s.id, s.pricePerKwh, s.createdAt));

  const fromStored: Tariff[] = stored.map(t => ({
    country_code: OCPI_COUNTRY_CODE,
    party_id: OCPI_PARTY_ID,
    id: t.tariffId,
    currency: t.currency,
    type: t.type as Tariff["type"],
    elements: t.elements as Tariff["elements"],
    last_updated: t.lastUpdated.toISOString(),
  }));

  const page = applyOcpiPagination([...fromStored, ...derived], req, res);
  res.json(ocpiResponse(page));
});

router.get("/tariffs/:tariffId", requireOcpiAuth, async (req, res) => {
  const tariffId = String(req.params.tariffId);
  const [stored] = await db
    .select()
    .from(ocpiTariffsTable)
    .where(eq(ocpiTariffsTable.tariffId, tariffId))
    .limit(1);

  if (stored) {
    res.json(ocpiResponse({
      country_code: OCPI_COUNTRY_CODE,
      party_id: OCPI_PARTY_ID,
      id: stored.tariffId,
      currency: stored.currency,
      type: stored.type as Tariff["type"],
      elements: stored.elements as Tariff["elements"],
      last_updated: stored.lastUpdated.toISOString(),
    } satisfies Tariff));
    return;
  }

  const match = tariffId.match(/^US\*CBR\*T(\d+)$/);
  if (match) {
    const stationId = parseInt(match[1], 10);
    const [station] = await db
      .select({ id: stationsTable.id, pricePerKwh: stationsTable.pricePerKwh, createdAt: stationsTable.createdAt })
      .from(stationsTable)
      .where(eq(stationsTable.id, stationId))
      .limit(1);
    if (station) {
      res.json(ocpiResponse(buildTariffFromStation(station.id, station.pricePerKwh, station.createdAt)));
      return;
    }
  }

  ocpiError(res, 404, 2003, "Tariff not found");
});

router.put("/tariffs/:tariffId", requireOcpiAuth, async (req, res) => {
  const tariffId = String(req.params.tariffId);
  const body = req.body as Partial<Tariff>;
  if (!body.currency || !Array.isArray(body.elements)) {
    ocpiError(res, 400, 2001, "currency and elements are required"); return;
  }

  const existing = await db
    .select({ id: ocpiTariffsTable.id })
    .from(ocpiTariffsTable)
    .where(eq(ocpiTariffsTable.tariffId, tariffId))
    .limit(1);

  if (existing.length > 0) {
    await db.update(ocpiTariffsTable)
      .set({ currency: body.currency, elements: body.elements, type: body.type ?? null, lastUpdated: new Date() })
      .where(eq(ocpiTariffsTable.tariffId, tariffId));
    res.json(ocpiResponse(null, 1000, "Tariff updated"));
  } else {
    await db.insert(ocpiTariffsTable).values({
      tariffId,
      currency: body.currency,
      elements: body.elements,
      type: body.type ?? null,
    });
    res.status(201).json(ocpiResponse(null, 1000, "Tariff created"));
  }
});

router.delete("/tariffs/:tariffId", requireOcpiAuth, async (req, res) => {
  await db.delete(ocpiTariffsTable).where(eq(ocpiTariffsTable.tariffId, String(req.params.tariffId)));
  res.json(ocpiResponse(null, 1000, "Tariff deleted"));
});

export default router;

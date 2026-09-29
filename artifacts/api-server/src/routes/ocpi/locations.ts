import { Router } from "express";
import { db } from "@workspace/db";
import { stationsTable } from "@workspace/db";
import { eq, gte, lte, and } from "drizzle-orm";
import {
  ocpiResponse, ocpiError, requireOcpiAuth,
  stationToLocation, applyOcpiPagination, getStationByLocationId,
} from "../../lib/ocpiHelpers";

const router = Router();

router.get("/locations", requireOcpiAuth, async (req, res) => {
  let query = db.select().from(stationsTable).$dynamic();

  const dateFrom = req.query.date_from as string | undefined;
  const dateTo = req.query.date_to as string | undefined;
  const conditions = [];
  if (dateFrom) conditions.push(gte(stationsTable.createdAt, new Date(dateFrom)));
  if (dateTo) conditions.push(lte(stationsTable.createdAt, new Date(dateTo)));
  if (conditions.length > 0) query = query.where(and(...conditions));

  const stations = await query;
  const locations = stations.map(stationToLocation);
  const page = applyOcpiPagination(locations, req, res);
  res.json(ocpiResponse(page));
});

router.get("/locations/:locationId", requireOcpiAuth, async (req, res) => {
  const station = await getStationByLocationId(String(req.params.locationId));
  if (!station) { ocpiError(res, 404, 2003, "Unknown Location"); return; }
  res.json(ocpiResponse(stationToLocation(station)));
});

router.get("/locations/:locationId/:evseUid", requireOcpiAuth, async (req, res) => {
  const station = await getStationByLocationId(String(req.params.locationId));
  if (!station) { ocpiError(res, 404, 2003, "Unknown Location"); return; }
  const location = stationToLocation(station);
  const evse = location.evses?.find(e => e.uid === String(req.params.evseUid));
  if (!evse) { ocpiError(res, 404, 2003, "Unknown EVSE"); return; }
  res.json(ocpiResponse(evse));
});

router.get("/locations/:locationId/:evseUid/:connectorId", requireOcpiAuth, async (req, res) => {
  const station = await getStationByLocationId(String(req.params.locationId));
  if (!station) { ocpiError(res, 404, 2003, "Unknown Location"); return; }
  const location = stationToLocation(station);
  const evse = location.evses?.find(e => e.uid === String(req.params.evseUid));
  if (!evse) { ocpiError(res, 404, 2003, "Unknown EVSE"); return; }
  const connector = evse.connectors.find(c => c.id === String(req.params.connectorId));
  if (!connector) { ocpiError(res, 404, 2003, "Unknown Connector"); return; }
  res.json(ocpiResponse(connector));
});

export default router;

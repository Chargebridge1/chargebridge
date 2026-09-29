import { Router } from "express";
import { ocpiResponse, requireOcpiAuth, getOcpiBaseUrl, OCPI_COUNTRY_CODE, OCPI_PARTY_ID } from "../../lib/ocpiHelpers";
import credentialsRouter from "./credentials";
import locationsRouter from "./locations";
import sessionsRouter from "./sessions";
import cdrsRouter from "./cdrs";
import tariffsRouter from "./tariffs";
import tokensRouter from "./tokens";
import commandsRouter from "./commands";

export const ocpiRouter = Router();

ocpiRouter.get("/ocpi/versions", (_req, res) => {
  const base = getOcpiBaseUrl(_req);
  res.json(ocpiResponse([
    { version: "2.2.1", url: `${base}/api/ocpi/cpo/2.2.1` },
  ]));
});

ocpiRouter.get("/ocpi/cpo/2.2.1", requireOcpiAuth, (req, res) => {
  const base = getOcpiBaseUrl(req);
  const mb = `${base}/api/ocpi/cpo/2.2.1`;
  res.json(ocpiResponse({
    version: "2.2.1",
    endpoints: [
      { identifier: "credentials",  role: "SENDER",   url: `${mb}/credentials` },
      { identifier: "credentials",  role: "RECEIVER",  url: `${mb}/credentials` },
      { identifier: "locations",    role: "SENDER",    url: `${mb}/locations` },
      { identifier: "sessions",     role: "SENDER",    url: `${mb}/sessions` },
      { identifier: "cdrs",         role: "SENDER",    url: `${mb}/cdrs` },
      { identifier: "cdrs",         role: "RECEIVER",  url: `${mb}/cdrs` },
      { identifier: "tariffs",      role: "SENDER",    url: `${mb}/tariffs` },
      { identifier: "tokens",       role: "RECEIVER",  url: `${mb}/tokens` },
      { identifier: "commands",     role: "RECEIVER",  url: `${mb}/commands` },
    ],
  }));
});

ocpiRouter.use("/ocpi/cpo/2.2.1", credentialsRouter);
ocpiRouter.use("/ocpi/cpo/2.2.1", locationsRouter);
ocpiRouter.use("/ocpi/cpo/2.2.1", sessionsRouter);
ocpiRouter.use("/ocpi/cpo/2.2.1", cdrsRouter);
ocpiRouter.use("/ocpi/cpo/2.2.1", tariffsRouter);
ocpiRouter.use("/ocpi/cpo/2.2.1", tokensRouter);
ocpiRouter.use("/ocpi/cpo/2.2.1", commandsRouter);

export { OCPI_COUNTRY_CODE, OCPI_PARTY_ID };

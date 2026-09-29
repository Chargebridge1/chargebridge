import { runStagingDatabasePreflight } from "@workspace/db/staging-identity";
import { assertStagingEnvironmentSelection, startAfterStagingPreflight } from "./startupGate";
import { runStagingSchemaReadiness } from "./stagingReadiness";

// Keep application imports (including background jobs) behind both staging
// checks. Production follows its existing startup path.
assertStagingEnvironmentSelection(process.env);
await startAfterStagingPreflight(
  process.env.CHARGEBRIDGE_ENVIRONMENT,
  () => runStagingDatabasePreflight(),
  () => import("./index"),
  () => runStagingSchemaReadiness(),
);
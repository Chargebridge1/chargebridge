import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";

const router = Router();

// Strict limit: unauthenticated write endpoints — abuse would write junk to DB
router.use(rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests" },
}));

/**
 * POST /api/diagnostics/native-trace
 *
 * Receives the native module invocation trace captured by the
 * withNativeCrashDiagnostics config plugin (Build 162+).
 * The mobile app reads NSUserDefaults["CBNativeTrace"] on next launch
 * (after a crash) and POSTs here before clearing it.
 *
 * Unauthenticated — called at startup before Clerk auth is ready.
 */
router.post("/native-trace", (req: Request, res: Response) => {
  const body = req.body as {
    buildNumber?: number;
    timestamp?: string;
    entries?: Array<{
      ms: number;
      type: string;
      module: string;
      method: string;
      detail: string;
    }>;
  };

  const { buildNumber, timestamp, entries } = body;
  const count = Array.isArray(entries) ? entries.length : 0;

  req.log.warn(
    { buildNumber, timestamp, entryCount: count },
    "CB-DIAG native trace received"
  );

  if (Array.isArray(entries) && entries.length > 0) {
    const exceptions = entries.filter(
      (e) => e.type === "void_exception" || e.type === "method_exception" || e.type === "uncaught"
    );
    if (exceptions.length > 0) {
      req.log.warn({ exceptions }, "CB-DIAG native trace exceptions");
    }

    const lastBefore = entries.slice(-10);
    req.log.warn({ lastBefore }, "CB-DIAG native trace last 10 entries");
  }

  res.json({ ok: true, received: count });
});

/**
 * POST /api/diagnostics/startup-trace
 *
 * Receives batches from the JS-level __turboModuleProxy wrapper installed by
 * utils/nativeModuleTrace.ts. The mobile app flushes every 100 ms for 2 s,
 * so data arrives even when the app crashes during startup.
 *
 * Two sources:
 *   source = "live"         — current-run batches (batchNumber 0, 1, 2…)
 *   source = "previous_run" — trace left by the prior launch (read at module scope)
 *
 * Look for the last entry in the last batch received from a session to identify
 * the native module/method called immediately before a crash.
 *
 * Unauthenticated — called before Clerk auth is ready.
 */
router.post("/startup-trace", (req: Request, res: Response) => {
  const { buildNumber, sessionId, batchNumber, t0, complete, source, entries } =
    req.body as {
      buildNumber?: number;
      sessionId?: string;
      batchNumber?: number;
      t0?: string;
      complete?: boolean;
      source?: "live" | "previous_run";
      entries?: Array<{
        ms: number;
        type: string;
        module: string;
        method: string;
        detail?: string;
      }>;
    };

  const count = Array.isArray(entries) ? entries.length : 0;
  const last = count > 0 ? entries![count - 1] : null;
  const tag = source === "previous_run" ? "PREV-RUN" : `batch=${batchNumber ?? "?"}`;
  const label = last
    ? `last=${last.module}.${last.method}(${last.type}) at ${last.ms}ms`
    : "no entries";

  req.log.warn(
    { buildNumber, sessionId, batchNumber, source: source ?? "live", complete, entryCount: count, last },
    `CB-DIAG startup-trace ${tag} [${sessionId ?? "?"}] — ${count} entries, ${label}`,
  );

  if (Array.isArray(entries)) {
    const exceptions = entries.filter(
      (e) => e.type === "throw" || e.type === "reject",
    );
    if (exceptions.length > 0) {
      req.log.error(
        { exceptions },
        `CB-DIAG startup-trace EXCEPTIONS [${sessionId ?? "?"}]`,
      );
    }
  }

  res.json({ ok: true });
});

/**
 * POST /api/diagnostics/void-exception
 *
 * Receives the CBVoidExc* NSUserDefaults payload written by Patch 3 inside
 * performVoidMethodInvocation's @catch block. The mobile app reads and clears
 * these keys at module scope (before any component renders) on the launch
 * following a crash, then POSTs here.
 *
 * This is the primary evidence path for answering:
 *   - Does @catch ever get entered?          (if this fires: yes)
 *   - Which native module throws?            (module field)
 *   - Which method?                          (method field)
 *   - What exception name / reason?          (name / reason fields)
 *
 * Unauthenticated — called before Clerk auth is ready.
 */
router.post("/void-exception", (req: Request, res: Response) => {
  const { buildNumber, timestamp, module, method, name, reason } = req.body as {
    buildNumber?: number;
    timestamp?: string;
    module?: string;
    method?: string;
    name?: string;
    reason?: string;
  };

  req.log.error(
    { buildNumber, timestamp, module, method, exceptionName: name, reason },
    `CB-DIAG *** VOID EXCEPTION CAPTURED *** ${module ?? "?"}.${method ?? "?"} threw ${name ?? "?"}: ${reason ?? "?"}`,
  );

  res.json({ ok: true });
});

export default router;

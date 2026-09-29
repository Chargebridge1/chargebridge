import { db } from "@workspace/db";
import { stripeRefundJobsTable } from "@workspace/db";
import { isNull, lte, and, eq } from "drizzle-orm";
import { getUncachableStripeClient } from "../stripeClient";
import { logger } from "./logger";

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

// Maximum attempts before giving up and requiring manual action.
// Exponential backoff base 2 min, doubling each try, capped at 6 h → ~2 days coverage.
const MAX_ATTEMPTS = 20;

function nextRetryDelay(attempts: number): number {
  const baseMs = 2 * 60 * 1000;
  const maxMs = 6 * 60 * 60 * 1000;
  return Math.min(baseMs * Math.pow(2, attempts), maxMs);
}

async function handleRefundJob(
  stripe: Awaited<ReturnType<typeof getUncachableStripeClient>>,
  job: {
    id: number;
    sessionId: number;
    paymentIntentId: string;
    idempotencyKey: string;
    reason: string;
    attempts: number;
  }
): Promise<void> {
  const newAttempts = job.attempts + 1;
  try {
    await stripe.refunds.create(
      {
        payment_intent: job.paymentIntentId,
        reason: "fraudulent",
        metadata: { sessionId: String(job.sessionId), reason: job.reason },
      },
      { idempotencyKey: job.idempotencyKey }
    );
    await db
      .update(stripeRefundJobsTable)
      .set({ succeededAt: new Date(), attempts: newAttempts, lastAttemptAt: new Date() })
      .where(eq(stripeRefundJobsTable.id, job.id));
    logger.warn(
      { refundJobId: job.id, sessionId: job.sessionId, paymentIntentId: job.paymentIntentId },
      "Refund sweeper: refund issued successfully for force-stopped session"
    );
  } catch (err: any) {
    await recordFailure(job.id, job.sessionId, job.paymentIntentId, newAttempts, err, "refund");
  }
}

async function handleReconcileJob(
  stripe: Awaited<ReturnType<typeof getUncachableStripeClient>>,
  job: {
    id: number;
    sessionId: number;
    paymentIntentId: string;
    idempotencyKey: string;
    reason: string;
    attempts: number;
  }
): Promise<void> {
  // Stripe was unavailable when force-stop ran. Re-fetch PI state now and
  // cancel (if uncaptured) or refund (if captured). The idempotency key for
  // refunds is "force_stop_refund_session_{id}" — shared with the direct
  // force-stop and webhook paths so Stripe deduplicates.
  const refundIdempotencyKey = `force_stop_refund_session_${job.sessionId}`;
  const newAttempts = job.attempts + 1;
  try {
    const pi = await stripe.paymentIntents.retrieve(job.paymentIntentId);

    if (
      pi.status === "requires_capture" ||
      pi.status === "requires_confirmation" ||
      pi.status === "requires_payment_method" ||
      pi.status === "requires_action"
    ) {
      await stripe.paymentIntents.cancel(job.paymentIntentId);
      await db
        .update(stripeRefundJobsTable)
        .set({ succeededAt: new Date(), attempts: newAttempts, lastAttemptAt: new Date() })
        .where(eq(stripeRefundJobsTable.id, job.id));
      logger.warn(
        { refundJobId: job.id, sessionId: job.sessionId, paymentIntentId: job.paymentIntentId, piStatus: pi.status },
        "Refund sweeper: reconcile — PaymentIntent cancelled (was not yet captured)"
      );
    } else if (pi.status === "succeeded") {
      await stripe.refunds.create(
        {
          payment_intent: job.paymentIntentId,
          reason: "fraudulent",
          metadata: { sessionId: String(job.sessionId), reason: job.reason },
        },
        { idempotencyKey: refundIdempotencyKey }
      );
      await db
        .update(stripeRefundJobsTable)
        .set({ succeededAt: new Date(), attempts: newAttempts, lastAttemptAt: new Date() })
        .where(eq(stripeRefundJobsTable.id, job.id));
      logger.warn(
        { refundJobId: job.id, sessionId: job.sessionId, paymentIntentId: job.paymentIntentId },
        "Refund sweeper: reconcile — charge was captured, refund issued"
      );
    } else {
      // "canceled" or "processing" — terminal or in-flight; mark done
      await db
        .update(stripeRefundJobsTable)
        .set({ succeededAt: new Date(), attempts: newAttempts, lastAttemptAt: new Date() })
        .where(eq(stripeRefundJobsTable.id, job.id));
      logger.info(
        { refundJobId: job.id, sessionId: job.sessionId, piStatus: pi.status },
        "Refund sweeper: reconcile — PaymentIntent in terminal or processing state, no action needed"
      );
    }
  } catch (err: any) {
    await recordFailure(job.id, job.sessionId, job.paymentIntentId, newAttempts, err, "reconcile");
  }
}

async function recordFailure(
  jobId: number,
  sessionId: number,
  paymentIntentId: string,
  newAttempts: number,
  err: any,
  type: string
): Promise<void> {
  const alreadyRefunded = err?.code === "charge_already_refunded";
  const isTerminal =
    alreadyRefunded ||
    (err?.type === "StripeInvalidRequestError" && err?.code === "payment_intent_unexpected_state") ||
    newAttempts >= MAX_ATTEMPTS;

  if (alreadyRefunded) {
    await db
      .update(stripeRefundJobsTable)
      .set({ succeededAt: new Date(), attempts: newAttempts, lastAttemptAt: new Date() })
      .where(eq(stripeRefundJobsTable.id, jobId));
    logger.info({ refundJobId: jobId, sessionId }, "Refund sweeper: already refunded — marking complete");
  } else if (isTerminal) {
    await db
      .update(stripeRefundJobsTable)
      .set({ attempts: newAttempts, lastAttemptAt: new Date() })
      .where(eq(stripeRefundJobsTable.id, jobId));
    logger.error(
      { err, refundJobId: jobId, sessionId, paymentIntentId, attempts: newAttempts, type },
      "Refund sweeper: exhausted max attempts — MANUAL ACTION REQUIRED"
    );
  } else {
    const delay = nextRetryDelay(newAttempts);
    await db
      .update(stripeRefundJobsTable)
      .set({ attempts: newAttempts, lastAttemptAt: new Date(), nextRetryAt: new Date(Date.now() + delay) })
      .where(eq(stripeRefundJobsTable.id, jobId));
    logger.warn(
      { refundJobId: jobId, sessionId, attempts: newAttempts, retryInMs: delay },
      "Refund sweeper: transient failure — will retry"
    );
  }
}

async function processRefundJobs(): Promise<void> {
  let jobs: Array<{
    id: number;
    sessionId: number;
    paymentIntentId: string;
    idempotencyKey: string;
    reason: string;
    attempts: number;
    jobType: string;
  }>;

  try {
    jobs = await db
      .select({
        id: stripeRefundJobsTable.id,
        sessionId: stripeRefundJobsTable.sessionId,
        paymentIntentId: stripeRefundJobsTable.paymentIntentId,
        idempotencyKey: stripeRefundJobsTable.idempotencyKey,
        reason: stripeRefundJobsTable.reason,
        attempts: stripeRefundJobsTable.attempts,
        jobType: stripeRefundJobsTable.jobType,
      })
      .from(stripeRefundJobsTable)
      .where(
        and(
          isNull(stripeRefundJobsTable.succeededAt),
          lte(stripeRefundJobsTable.nextRetryAt, new Date())
        )
      );
  } catch (err) {
    logger.error({ err }, "Refund sweeper: failed to query pending jobs");
    return;
  }

  if (jobs.length === 0) return;

  logger.info({ count: jobs.length }, "Refund sweeper: processing pending jobs");

  const stripe = await getUncachableStripeClient();

  for (const job of jobs) {
    if (job.jobType === "reconcile") {
      await handleReconcileJob(stripe, job);
    } else {
      await handleRefundJob(stripe, job);
    }
  }
}

export function startRefundSweeper(): NodeJS.Timeout {
  logger.info({ intervalMinutes: SWEEP_INTERVAL_MS / 60_000 }, "Stripe refund/reconcile sweeper started");

  processRefundJobs().catch((err) =>
    logger.error({ err }, "Refund sweeper: initial sweep error")
  );

  return setInterval(() => {
    processRefundJobs().catch((err) =>
      logger.error({ err }, "Refund sweeper: periodic sweep error")
    );
  }, SWEEP_INTERVAL_MS);
}

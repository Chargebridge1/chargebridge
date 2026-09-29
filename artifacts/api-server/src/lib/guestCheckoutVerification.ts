import { createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import {
  abuseRateLimitBucketsTable,
  checkoutEmailVerificationsTable,
  db,
  paymentCreationRequestsTable,
} from "@workspace/db";
import { and, eq, gte, gt, sql } from "drizzle-orm";

const MINUTE_MS = 60_000;
const HALF_HOUR_MS = 30 * MINUTE_MS;
const DAY_MS = 24 * 60 * MINUTE_MS;
const HMAC_KEY_VERSION = 1;
const EMAIL_LOCK_NAMESPACE = 619_271;
const IP_LOCK_NAMESPACE = 619_272;
const EMAIL_SEND_ACTION = "guest_checkout_otp_email_send";
const IP_SEND_ACTION = "guest_checkout_otp_ip_send";

export const GUEST_CHECKOUT_OTP_POLICY = Object.freeze({
  validityMs: 10 * MINUTE_MS,
  resendCooldownMs: MINUTE_MS,
  maxSendsPerEmail: 3,
  maxSendsPerIp: 5,
  sendWindowMs: HALF_HOUR_MS,
  maxFailedAttempts: 5,
  grantValidityMs: 15 * MINUTE_MS,
});

export type GuestCheckoutPurpose = "charging_checkout" | "charging_payment_intent";
export type VerificationDeliveryState = "accepted" | "failed" | "unknown";

export type IssueVerificationInput = {
  email: string;
  ipAddress: string;
  purpose: GuestCheckoutPurpose;
  purchaseDraft: unknown;
};

export type VerifyCodeInput = {
  verificationId: string;
  email: string;
  purchaseDraft: unknown;
  code: string;
};

export type ConsumeGrantInput = {
  verificationId: string;
  email: string;
  purchaseDraft: unknown;
  grantToken: string;
  paymentRequestId: string;
};

export type VerificationResult =
  | { status: "verified"; grantToken: string; grantExpiresAt: Date }
  | { status: "invalid_code" }
  | { status: "expired" }
  | { status: "locked" }
  | { status: "conflict" }
  | { status: "not_found" };

export type GrantConsumptionResult =
  | { status: "consumed" }
  | { status: "expired" }
  | { status: "conflict" }
  | { status: "not_found" };

export type GuestPaymentAuthorizationResult =
  | { authorized: true }
  | { authorized: false; reason: "expired" | "conflict" | "not_found" };

export type GuestPaymentGrantConsumer = {
  consumeGrant(input: ConsumeGrantInput): Promise<GrantConsumptionResult>;
};

/**
 * Development integration contract for payment entry points: a persisted,
 * request-bound grant must be consumed before the caller may authorize any
 * payment work. This helper deliberately does not create payment requests or
 * call Stripe. Storage errors propagate so callers cannot treat them as grants.
 */
export async function authorizeGuestPayment(
  consumer: GuestPaymentGrantConsumer,
  input: ConsumeGrantInput,
): Promise<GuestPaymentAuthorizationResult> {
  const result = await consumer.consumeGrant(input);
  return result.status === "consumed"
    ? { authorized: true }
    : { authorized: false, reason: result.status };
}

export class GuestCheckoutVerificationError extends Error {
  constructor(
    public readonly code:
      | "INVALID_INPUT"
      | "OTP_RATE_LIMITED"
      | "OTP_RESEND_COOLDOWN"
      | "OTP_SECURITY_NOT_CONFIGURED"
      | "OTP_STORAGE_UNAVAILABLE"
      | "OTP_DELIVERY_UNAVAILABLE",
    message: string,
    public readonly httpStatus: 400 | 429 | 503,
  ) {
    super(message);
    this.name = "GuestCheckoutVerificationError";
  }
}

export type PersistVerificationInput = {
  id: string;
  purpose: GuestCheckoutPurpose;
  emailHmac: string;
  purchaseDraftHash: string;
  otpHash: string;
  emailLimitHmac: string;
  ipLimitHmac: string;
  createdAt: Date;
  expiresAt: Date;
};

export type PersistVerificationResult =
  | { status: "created" }
  | { status: "resend_cooldown" }
  | { status: "email_limited" }
  | { status: "ip_limited" };

export type VerifyPersistInput = {
  id: string;
  emailHmac: string;
  purchaseDraftHash: string;
  otpHash: string;
  grantHash: string;
  grantExpiresAt: Date;
  now: Date;
};

export type ConsumePersistInput = {
  id: string;
  emailHmac: string;
  purchaseDraftHash: string;
  grantHash: string;
  paymentRequestId: string;
  now: Date;
};

export interface GuestCheckoutVerificationStore {
  reserveVerification(input: PersistVerificationInput): Promise<PersistVerificationResult>;
  setDeliveryState(
    id: string,
    state: VerificationDeliveryState,
    deliveredAt: Date,
  ): Promise<void>;
  verifyCode(input: VerifyPersistInput): Promise<
    | "verified"
    | "invalid_code"
    | "expired"
    | "locked"
    | "conflict"
    | "not_found"
  >;
  consumeGrant(input: ConsumePersistInput): Promise<
    "consumed" | "expired" | "conflict" | "not_found"
  >;
}

function hmac(secret: string, purpose: string, value: string): string {
  return createHmac("sha256", secret).update(`${purpose}\0${value}`).digest("hex");
}

function stableJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson(record[key])}`,
    ).join(",")}}`;
  }
  throw new GuestCheckoutVerificationError(
    "INVALID_INPUT",
    "The purchase draft must contain only JSON values.",
    400,
  );
}

function normalizeEmail(value: unknown): string {
  if (typeof value !== "string") {
    throw new GuestCheckoutVerificationError("INVALID_INPUT", "A valid email address is required.", 400);
  }
  const normalized = value.trim().toLowerCase();
  if (
    normalized.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
  ) {
    throw new GuestCheckoutVerificationError("INVALID_INPUT", "A valid email address is required.", 400);
  }
  return normalized;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function compareHexDigest(a: string, b: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(a) || !/^[a-f0-9]{64}$/.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

function throwForPersistenceError(error: unknown): never {
  if (error instanceof GuestCheckoutVerificationError) throw error;
  // Never fail open when PostgreSQL cannot apply the shared abuse limits or
  // persist the verification state.
  throw new GuestCheckoutVerificationError(
    "OTP_STORAGE_UNAVAILABLE",
    "Guest verification is temporarily unavailable. Please try again later.",
    503,
  );
}

/**
 * PostgreSQL-backed implementation. Rate-limit sends are serialized with
 * transaction-scoped advisory locks and stored as one-second buckets, so the
 * queries below enforce a true sliding 30-minute window across API instances.
 */
export class PostgresGuestCheckoutVerificationStore implements GuestCheckoutVerificationStore {
  async reserveVerification(input: PersistVerificationInput): Promise<PersistVerificationResult> {
    const windowStart = new Date(Math.floor(input.createdAt.getTime() / 1000) * 1000);
    const windowExpiresAt = new Date(windowStart.getTime() + HALF_HOUR_MS);
    const emailSince = new Date(input.createdAt.getTime() - HALF_HOUR_MS);
    const cooldownSince = new Date(input.createdAt.getTime() - GUEST_CHECKOUT_OTP_POLICY.resendCooldownMs);

    try {
      return await db.transaction(async (tx) => {
        // All issuance paths acquire the same lock order (email, then IP), so
        // concurrent application instances cannot overshoot either limit.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${EMAIL_LOCK_NAMESPACE}, hashtext(${input.emailLimitHmac}))`);
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${IP_LOCK_NAMESPACE}, hashtext(${input.ipLimitHmac}))`);

        const emailCooldown = await tx
          .select({ count: sql<number>`coalesce(sum(${abuseRateLimitBucketsTable.count}), 0)::int` })
          .from(abuseRateLimitBucketsTable)
          .where(and(
            eq(abuseRateLimitBucketsTable.action, EMAIL_SEND_ACTION),
            eq(abuseRateLimitBucketsTable.subjectType, "email"),
            eq(abuseRateLimitBucketsTable.subjectHmac, input.emailLimitHmac),
            eq(abuseRateLimitBucketsTable.keyVersion, HMAC_KEY_VERSION),
            gte(abuseRateLimitBucketsTable.windowStartedAt, cooldownSince),
          ));
        if ((emailCooldown[0]?.count ?? 0) > 0) return { status: "resend_cooldown" };

        const emailCount = await tx
          .select({ count: sql<number>`coalesce(sum(${abuseRateLimitBucketsTable.count}), 0)::int` })
          .from(abuseRateLimitBucketsTable)
          .where(and(
            eq(abuseRateLimitBucketsTable.action, EMAIL_SEND_ACTION),
            eq(abuseRateLimitBucketsTable.subjectType, "email"),
            eq(abuseRateLimitBucketsTable.subjectHmac, input.emailLimitHmac),
            eq(abuseRateLimitBucketsTable.keyVersion, HMAC_KEY_VERSION),
            gte(abuseRateLimitBucketsTable.windowStartedAt, emailSince),
            gt(abuseRateLimitBucketsTable.expiresAt, input.createdAt),
          ));
        if ((emailCount[0]?.count ?? 0) >= GUEST_CHECKOUT_OTP_POLICY.maxSendsPerEmail) {
          return { status: "email_limited" };
        }

        const ipSince = new Date(input.createdAt.getTime() - HALF_HOUR_MS);
        const ipCount = await tx
          .select({ count: sql<number>`coalesce(sum(${abuseRateLimitBucketsTable.count}), 0)::int` })
          .from(abuseRateLimitBucketsTable)
          .where(and(
            eq(abuseRateLimitBucketsTable.action, IP_SEND_ACTION),
            eq(abuseRateLimitBucketsTable.subjectType, "ip"),
            eq(abuseRateLimitBucketsTable.subjectHmac, input.ipLimitHmac),
            eq(abuseRateLimitBucketsTable.keyVersion, HMAC_KEY_VERSION),
            gte(abuseRateLimitBucketsTable.windowStartedAt, ipSince),
            gt(abuseRateLimitBucketsTable.expiresAt, input.createdAt),
          ));
        if ((ipCount[0]?.count ?? 0) >= GUEST_CHECKOUT_OTP_POLICY.maxSendsPerIp) {
          return { status: "ip_limited" };
        }

        const incrementBucket = async (
          action: string,
          subjectType: "email" | "ip",
          subjectHmac: string,
        ) => tx
          .insert(abuseRateLimitBucketsTable)
          .values({
            action,
            subjectType,
            subjectHmac,
            keyVersion: HMAC_KEY_VERSION,
            windowStartedAt: windowStart,
            windowSeconds: Math.floor(HALF_HOUR_MS / 1000),
            count: 1,
            firstSeenAt: input.createdAt,
            lastSeenAt: input.createdAt,
            expiresAt: windowExpiresAt,
          })
          .onConflictDoUpdate({
            target: [
              abuseRateLimitBucketsTable.action,
              abuseRateLimitBucketsTable.subjectType,
              abuseRateLimitBucketsTable.subjectHmac,
              abuseRateLimitBucketsTable.keyVersion,
              abuseRateLimitBucketsTable.windowStartedAt,
              abuseRateLimitBucketsTable.windowSeconds,
            ],
            set: {
              count: sql`${abuseRateLimitBucketsTable.count} + 1`,
              lastSeenAt: input.createdAt,
            },
          });

        await incrementBucket(EMAIL_SEND_ACTION, "email", input.emailLimitHmac);
        await incrementBucket(IP_SEND_ACTION, "ip", input.ipLimitHmac);

        await tx
          .update(checkoutEmailVerificationsTable)
          .set({ status: "expired" })
          .where(and(
            eq(checkoutEmailVerificationsTable.emailHmac, input.emailHmac),
            eq(checkoutEmailVerificationsTable.emailHmacVersion, HMAC_KEY_VERSION),
            eq(checkoutEmailVerificationsTable.purpose, input.purpose),
            eq(checkoutEmailVerificationsTable.status, "pending"),
          ));

        await tx.insert(checkoutEmailVerificationsTable).values({
          id: input.id,
          purpose: input.purpose,
          emailHmac: input.emailHmac,
          emailHmacVersion: HMAC_KEY_VERSION,
          purchaseDraftHash: input.purchaseDraftHash,
          purchaseDraftHashVersion: HMAC_KEY_VERSION,
          otpHash: input.otpHash,
          otpHashVersion: HMAC_KEY_VERSION,
          status: "pending",
          sendCount: 1,
          failedAttemptCount: 0,
          lastDeliveryState: "unknown",
          createdAt: input.createdAt,
          expiresAt: input.expiresAt,
          lastDeliveryAt: input.createdAt,
          retentionExpiresAt: input.expiresAt,
        });
        return { status: "created" };
      });
    } catch (error) {
      return throwForPersistenceError(error);
    }
  }

  async setDeliveryState(id: string, state: VerificationDeliveryState, deliveredAt: Date): Promise<void> {
    try {
      await db
        .update(checkoutEmailVerificationsTable)
        .set({ lastDeliveryState: state, lastDeliveryAt: deliveredAt })
        .where(eq(checkoutEmailVerificationsTable.id, id));
    } catch (error) {
      return throwForPersistenceError(error);
    }
  }

  async verifyCode(input: VerifyPersistInput): Promise<
    "verified" | "invalid_code" | "expired" | "locked" | "conflict" | "not_found"
  > {
    try {
      return await db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(checkoutEmailVerificationsTable)
          .where(eq(checkoutEmailVerificationsTable.id, input.id))
          .for("update");
        if (!row) return "not_found";
        if (
          !compareHexDigest(row.emailHmac, input.emailHmac) ||
          !compareHexDigest(row.purchaseDraftHash, input.purchaseDraftHash)
        ) return "conflict";
        if (row.status === "locked") return "locked";
        if (row.status === "consumed" || row.status === "expired") return "expired";
        if (row.expiresAt <= input.now) {
          await tx.update(checkoutEmailVerificationsTable)
            .set({ status: "expired" })
            .where(eq(checkoutEmailVerificationsTable.id, input.id));
          return "expired";
        }
        // A code is single-use: once verified, replaying it cannot mint or
        // rotate another payment authorization grant.
        if (row.status !== "pending") return "conflict";
        if (!compareHexDigest(row.otpHash, input.otpHash)) {
          const failedAttemptCount = row.failedAttemptCount + 1;
          await tx.update(checkoutEmailVerificationsTable)
            .set({
              failedAttemptCount,
              ...(failedAttemptCount >= GUEST_CHECKOUT_OTP_POLICY.maxFailedAttempts
                ? { status: "locked" as const, lockedAt: input.now }
                : {}),
            })
            .where(eq(checkoutEmailVerificationsTable.id, input.id));
          return failedAttemptCount >= GUEST_CHECKOUT_OTP_POLICY.maxFailedAttempts
            ? "locked"
            : "invalid_code";
        }

        await tx.update(checkoutEmailVerificationsTable)
          .set({
            status: "verified",
            verifiedAt: input.now,
            grantHash: input.grantHash,
            grantHashVersion: HMAC_KEY_VERSION,
            grantExpiresAt: input.grantExpiresAt,
            retentionExpiresAt: input.grantExpiresAt,
          })
          .where(eq(checkoutEmailVerificationsTable.id, input.id));
        return "verified";
      });
    } catch (error) {
      return throwForPersistenceError(error);
    }
  }

  async consumeGrant(input: ConsumePersistInput): Promise<
    "consumed" | "expired" | "conflict" | "not_found"
  > {
    try {
      return await db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(checkoutEmailVerificationsTable)
          .where(eq(checkoutEmailVerificationsTable.id, input.id))
          .for("update");
        if (!row) return "not_found";
        if (
          !compareHexDigest(row.emailHmac, input.emailHmac) ||
          !compareHexDigest(row.purchaseDraftHash, input.purchaseDraftHash)
        ) return "conflict";
        if (row.status === "consumed") return "conflict";
        if (row.status !== "verified") return row.status === "expired" || row.status === "locked"
          ? "expired"
          : "conflict";
        if (!row.grantExpiresAt || row.grantExpiresAt <= input.now) {
          await tx.update(checkoutEmailVerificationsTable)
            .set({ status: "expired" })
            .where(eq(checkoutEmailVerificationsTable.id, input.id));
          return "expired";
        }
        if (!row.grantHash || !compareHexDigest(row.grantHash, input.grantHash)) return "conflict";

        const [paymentRequest] = await tx
          .select({
            principalType: paymentCreationRequestsTable.principalType,
            principalHmac: paymentCreationRequestsTable.principalHmac,
            principalHmacVersion: paymentCreationRequestsTable.principalHmacVersion,
            operation: paymentCreationRequestsTable.operation,
          })
          .from(paymentCreationRequestsTable)
          .where(eq(paymentCreationRequestsTable.id, input.paymentRequestId));
        if (
          !paymentRequest ||
          paymentRequest.principalType !== "verified_guest" ||
          paymentRequest.operation !== row.purpose ||
          !compareHexDigest(paymentRequest.principalHmac, input.emailHmac) ||
          paymentRequest.principalHmacVersion !== HMAC_KEY_VERSION
        ) return "conflict";

        await tx.update(checkoutEmailVerificationsTable)
          .set({
            status: "consumed",
            consumedAt: input.now,
            consumedByRequestId: input.paymentRequestId,
            retentionExpiresAt: row.grantExpiresAt,
          })
          .where(and(
            eq(checkoutEmailVerificationsTable.id, input.id),
            eq(checkoutEmailVerificationsTable.status, "verified"),
          ));
        return "consumed";
      });
    } catch (error) {
      return throwForPersistenceError(error);
    }
  }
}

export type GuestCheckoutOtpServiceDependencies = {
  store: GuestCheckoutVerificationStore;
  secret: string;
  now?: () => Date;
  createId?: () => string;
  createCode?: () => string;
  createGrantToken?: () => string;
};

export function createGuestCheckoutOtpService(deps: GuestCheckoutOtpServiceDependencies) {
  const now = deps.now ?? (() => new Date());
  const createId = deps.createId ?? randomUUID;
  const createCode = deps.createCode ?? (() => String(randomInt(0, 1_000_000)).padStart(6, "0"));
  const createGrantToken = deps.createGrantToken ?? (() => randomBytes(32).toString("base64url"));

  function requestHashes(email: string, draft: unknown, ipAddress?: string) {
    if (deps.secret.length < 32) {
      throw new GuestCheckoutVerificationError(
        "OTP_SECURITY_NOT_CONFIGURED",
        "Guest verification is temporarily unavailable.",
        503,
      );
    }
    const normalizedEmail = normalizeEmail(email);
    let canonicalDraft: string;
    try {
      canonicalDraft = stableJson(draft);
    } catch (error) {
      if (error instanceof GuestCheckoutVerificationError) throw error;
      throw new GuestCheckoutVerificationError("INVALID_INPUT", "The purchase draft is invalid.", 400);
    }
    if (canonicalDraft.length > 20_000) {
      throw new GuestCheckoutVerificationError("INVALID_INPUT", "The purchase draft is too large.", 400);
    }
    return {
      normalizedEmail,
      emailHmac: hmac(deps.secret, "guest-email", normalizedEmail),
      purchaseDraftHash: hmac(deps.secret, "guest-purchase-draft", canonicalDraft),
      ...(ipAddress !== undefined ? { ipLimitHmac: hmac(deps.secret, "guest-ip", ipAddress) } : {}),
    };
  }

  return {
    async issue(
      input: IssueVerificationInput,
      deliverCode: (normalizedEmail: string, code: string) => Promise<void>,
    ): Promise<{ verificationId: string }> {
      if (input.purpose !== "charging_checkout" && input.purpose !== "charging_payment_intent") {
        throw new GuestCheckoutVerificationError("INVALID_INPUT", "Unsupported guest verification purpose.", 400);
      }
      if (typeof input.ipAddress !== "string" || isIP(input.ipAddress) === 0) {
        throw new GuestCheckoutVerificationError("INVALID_INPUT", "A valid request IP is required.", 400);
      }
      const hashes = requestHashes(input.email, input.purchaseDraft, input.ipAddress);
      const code = createCode();
      if (!/^\d{6}$/.test(code)) throw new Error("OTP generator returned an invalid code");
      const createdAt = now();
      const id = createId();
      let persisted: PersistVerificationResult;
      try {
        persisted = await deps.store.reserveVerification({
          id,
          purpose: input.purpose,
          emailHmac: hashes.emailHmac,
          purchaseDraftHash: hashes.purchaseDraftHash,
          otpHash: hmac(deps.secret, `guest-otp:${id}`, code),
          emailLimitHmac: hmac(deps.secret, "guest-email-send-limit", hashes.normalizedEmail),
          ipLimitHmac: hashes.ipLimitHmac!,
          createdAt,
          expiresAt: new Date(createdAt.getTime() + GUEST_CHECKOUT_OTP_POLICY.validityMs),
        });
      } catch (error) {
        return throwForPersistenceError(error);
      }
      if (persisted.status !== "created") {
        const cooldown = persisted.status === "resend_cooldown";
        throw new GuestCheckoutVerificationError(
          cooldown ? "OTP_RESEND_COOLDOWN" : "OTP_RATE_LIMITED",
          cooldown
            ? "Please wait before requesting another verification code."
            : "Too many verification codes have been requested. Please try again later.",
          429,
        );
      }

      try {
        await deliverCode(hashes.normalizedEmail, code);
      } catch {
        try {
          await deps.store.setDeliveryState(id, "unknown", now());
        } catch {
          // The durable pending row remains evidence; never retry delivery or
          // continue payment automatically after an ambiguous mail outcome.
        }
        throw new GuestCheckoutVerificationError(
          "OTP_DELIVERY_UNAVAILABLE",
          "The verification message could not be confirmed. Please wait before trying again.",
          503,
        );
      }
      try {
        await deps.store.setDeliveryState(id, "accepted", now());
      } catch (error) {
        return throwForPersistenceError(error);
      }
      return { verificationId: id };
    },

    async verify(input: VerifyCodeInput): Promise<VerificationResult> {
      if (
        !isUuid(input.verificationId) ||
        typeof input.code !== "string" ||
        !/^\d{6}$/.test(input.code)
      ) return { status: "invalid_code" };
      const hashes = requestHashes(input.email, input.purchaseDraft);
      const grantToken = createGrantToken();
      const nowAt = now();
      let result: Awaited<ReturnType<GuestCheckoutVerificationStore["verifyCode"]>>;
      try {
        result = await deps.store.verifyCode({
          id: input.verificationId,
          emailHmac: hashes.emailHmac,
          purchaseDraftHash: hashes.purchaseDraftHash,
          otpHash: hmac(deps.secret, `guest-otp:${input.verificationId}`, input.code),
          grantHash: hmac(deps.secret, `guest-grant:${input.verificationId}`, grantToken),
          grantExpiresAt: new Date(nowAt.getTime() + GUEST_CHECKOUT_OTP_POLICY.grantValidityMs),
          now: nowAt,
        });
      } catch (error) {
        return throwForPersistenceError(error);
      }
      if (result !== "verified") return { status: result };
      return {
        status: "verified",
        grantToken,
        grantExpiresAt: new Date(nowAt.getTime() + GUEST_CHECKOUT_OTP_POLICY.grantValidityMs),
      };
    },

    async consumeGrant(input: ConsumeGrantInput): Promise<GrantConsumptionResult> {
      if (
        !isUuid(input.verificationId) ||
        !isUuid(input.paymentRequestId) ||
        typeof input.grantToken !== "string" ||
        input.grantToken.length < 32
      ) return { status: "conflict" };
      const hashes = requestHashes(input.email, input.purchaseDraft);
      let status: Awaited<ReturnType<GuestCheckoutVerificationStore["consumeGrant"]>>;
      try {
        status = await deps.store.consumeGrant({
          id: input.verificationId,
          emailHmac: hashes.emailHmac,
          purchaseDraftHash: hashes.purchaseDraftHash,
          grantHash: hmac(deps.secret, `guest-grant:${input.verificationId}`, input.grantToken),
          paymentRequestId: input.paymentRequestId,
          now: now(),
        });
      } catch (error) {
        return throwForPersistenceError(error);
      }
      return {
        status,
      };
    },
  };
}

/**
 * Guest charging/receipt endpoints are deliberately not wired to this service
 * yet. Existing payment routes do not reserve a durable request before their
 * Stripe call, and receipt sending uses a live mail adapter. Wiring either
 * here would bypass the new payment state machine or send real email.
 */
let defaultService: ReturnType<typeof createGuestCheckoutOtpService> | undefined;

export function getGuestCheckoutOtpService() {
  defaultService ??= createGuestCheckoutOtpService({
    store: new PostgresGuestCheckoutVerificationStore(),
    secret: process.env.PAYMENT_ABUSE_HMAC_SECRET ?? "",
  });
  return defaultService;
}
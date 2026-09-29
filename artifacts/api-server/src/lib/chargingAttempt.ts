import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export type ChargingPrincipalType = "clerk_user" | "verified_guest";
export type ChargingOperation = "charging_checkout" | "charging_payment_intent";
export type ChargingMode = "kwh" | "time" | "dollars";
export type ChargingAttemptState =
  | "issued"
  | "processing"
  | "succeeded"
  | "failed"
  | "reconciling"
  | "manual_review";
export type ChargingReconciliationState =
  | "none"
  | "required"
  | "in_progress"
  | "resolved"
  | "manual_review";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type ChargingAttemptPrincipal = {
  type: ChargingPrincipalType;
  /** Verified Clerk ID or the server-verified guest principal reference. */
  reference: string;
};

export type LockedChargingQuoteInput = {
  operation: ChargingOperation;
  stationId: number;
  chargeMode: ChargingMode;
  quantity: number;
  unit: string;
  currency: string;
  energyCents: number;
  platformFeeCents: number;
  totalCents: number;
  pricingVersion: string;
  quoteVersion: number;
  /** Already HMACed by the receipt-verification authority; never raw email. */
  receiptEmailHmac?: string | null;
  receiptEmailHmacVersion?: number | null;
  /** Canonical server-resolved membership details, if they affect the price. */
  planId?: string | null;
  priceId?: string | null;
  /** All remaining Stripe-affecting quote terms, built by the server. */
  terms: Record<string, JsonValue>;
};

export type LockedChargingQuote = Readonly<{
  operation: ChargingOperation;
  principalType: ChargingPrincipalType;
  principalReferenceHmac: string;
  principalReferenceVersion: number;
  stationId: number;
  chargeMode: ChargingMode;
  quantity: number;
  unit: string;
  currency: string;
  energyCents: number;
  platformFeeCents: number;
  totalCents: number;
  pricingVersion: string;
  quoteVersion: number;
  quoteCreatedAt: string;
  receiptEmailHmac: string | null;
  receiptEmailHmacVersion: number | null;
  planId: string | null;
  priceId: string | null;
  terms: Readonly<Record<string, JsonValue>>;
}>;

export type ChargingAttemptRecord = {
  id: string;
  principalType: ChargingPrincipalType;
  principalHmac: string;
  principalHmacVersion: number;
  operation: ChargingOperation;
  stationId: number;
  paymentCreationRequestId: string | null;
  chargingSessionId: number | null;
  requestHash: string;
  requestHashVersion: number;
  transactionFingerprint: string;
  fingerprintKeyVersion: number;
  quoteVersion: number;
  quoteCreatedAt: Date;
  quote: LockedChargingQuote;
  currency: string;
  chargeMode: ChargingMode;
  quantity: number;
  unit: string;
  energyCents: number;
  platformFeeCents: number;
  totalCents: number;
  receiptEmailHmac: string | null;
  receiptEmailHmacVersion: number | null;
  planId: string | null;
  priceId: string | null;
  pricingVersion: string;
  state: ChargingAttemptState;
  reconciliationState: ChargingReconciliationState;
  reconciliationReason: string | null;
  stripePaymentIntentId: string | null;
  stripeCheckoutSessionId: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  expiresAt: Date | null;
};

export type AttemptHashCandidate = {
  keyVersion: number;
  principalHmac: string;
  requestHash: string;
  transactionFingerprint: string;
};

export type AttemptInsert = Omit<
  ChargingAttemptRecord,
  | "paymentCreationRequestId"
  | "chargingSessionId"
  | "state"
  | "reconciliationState"
  | "reconciliationReason"
  | "stripePaymentIntentId"
  | "stripeCheckoutSessionId"
  | "createdAt"
  | "updatedAt"
  | "completedAt"
  | "expiresAt"
> & {
  paymentCreationRequestId: null;
  chargingSessionId: null;
  state: "issued";
  reconciliationState: "none";
  reconciliationReason: null;
  stripePaymentIntentId: null;
  stripeCheckoutSessionId: null;
};

export interface ChargingAttemptTransaction {
  findByIdForUpdate(id: string): Promise<ChargingAttemptRecord | null>;
  findEquivalentForUpdate(
    candidates: readonly AttemptHashCandidate[],
    createdAfter: Date,
  ): Promise<ChargingAttemptRecord | null>;
  insert(record: AttemptInsert): Promise<ChargingAttemptRecord>;
  markReconciliationRequired(id: string, reason: string): Promise<void>;
  attachPaymentRequest(id: string, paymentRequestId: string): Promise<boolean>;
  attachStripeObject(
    id: string,
    object: { type: "payment_intent" | "checkout_session"; id: string },
  ): Promise<boolean>;
}

export interface ChargingAttemptStore {
  withAdvisoryLocks<T>(
    lockKeys: readonly string[],
    callback: (tx: ChargingAttemptTransaction) => Promise<T>,
  ): Promise<T>;
}

export class ChargingAttemptConflictError extends Error {
  readonly code = "CHARGING_ATTEMPT_CONFLICT";
  readonly statusCode = 409;

  constructor(message = "Charging Attempt ID is bound to a different principal or request.") {
    super(message);
    this.name = "ChargingAttemptConflictError";
  }
}

export class ChargingAttemptNotFoundError extends Error {
  readonly code = "CHARGING_ATTEMPT_NOT_FOUND";
  readonly statusCode = 404;

  constructor() {
    super("Charging Attempt was not found for this principal.");
    this.name = "ChargingAttemptNotFoundError";
  }
}

export type EstablishAttemptResult =
  | { kind: "created" | "recovered"; attempt: ChargingAttemptRecord }
  | { kind: "completed"; attempt: ChargingAttemptRecord }
  | {
      kind: "reconciliation_required";
      attempt: ChargingAttemptRecord;
      reason: string;
    };

export type EstablishChargingAttemptInput =
  | {
      principal: ChargingAttemptPrincipal;
      attemptId: string;
      /** Optional on recovery: omit it to reuse the original immutable quote. */
      quote?: LockedChargingQuoteInput;
    }
  | {
      principal: ChargingAttemptPrincipal;
      attemptId?: undefined;
      quote: LockedChargingQuoteInput;
    };

export type ChargingAttemptHashConfig = {
  activeKeyVersion: number;
  /** Retain prior key versions for the full attempt-evidence retention period. */
  hmacKeys: Readonly<Record<number, string>>;
};

type ServiceOptions = {
  now?: () => Date;
  equivalentAttemptWindowMs?: number;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_EQUIVALENT_WINDOW_MS = 15 * 60 * 1000;

function stableJson(value: JsonValue | Record<string, JsonValue>): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  const object = value as Record<string, JsonValue>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(object[key]!)}`)
    .join(",")}}`;
}

function normalizeJsonObject(value: Record<string, JsonValue>): Record<string, JsonValue> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Quote terms must be an object.");
  }
  const encoded = stableJson(value);
  if (Buffer.byteLength(encoded, "utf8") > 32_768) {
    throw new TypeError("Locked quote terms exceed the supported size.");
  }
  return JSON.parse(encoded) as Record<string, JsonValue>;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}

function fixedQuantity(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError("Charging quantity must be a positive finite number.");
  }
  const normalized = Number(value.toFixed(4));
  if (normalized <= 0) throw new TypeError("Charging quantity is below precision.");
  return normalized;
}

function validateQuote(input: LockedChargingQuoteInput): void {
  if (!Number.isSafeInteger(input.stationId) || input.stationId <= 0) {
    throw new TypeError("A valid server-resolved station ID is required.");
  }
  if (!["charging_checkout", "charging_payment_intent"].includes(input.operation)) {
    throw new TypeError("Charging operation must be canonical.");
  }
  if (!["kwh", "time", "dollars"].includes(input.chargeMode)) {
    throw new TypeError("Charging mode must be normalized.");
  }
  const expectedUnit = { kwh: "kwh", time: "minutes", dollars: "usd" }[input.chargeMode];
  if (input.unit.trim().toLowerCase() !== expectedUnit) {
    throw new TypeError(`Normalized ${input.chargeMode} mode requires ${expectedUnit} units.`);
  }
  if (!/^[a-z]{3}$/.test(input.currency)) {
    throw new TypeError("Currency must be a lowercase ISO currency code.");
  }
  if (
    !Number.isSafeInteger(input.energyCents)
    || !Number.isSafeInteger(input.platformFeeCents)
    || !Number.isSafeInteger(input.totalCents)
    || input.energyCents < 0
    || input.platformFeeCents < 0
    || input.totalCents !== input.energyCents + input.platformFeeCents
  ) {
    throw new TypeError("Charging quote amounts are invalid or inconsistent.");
  }
  if (!Number.isSafeInteger(input.quoteVersion) || input.quoteVersion < 1) {
    throw new TypeError("A positive quote version is required.");
  }
  if (!input.pricingVersion.trim()) throw new TypeError("Pricing version is required.");
  if (!input.unit.trim()) throw new TypeError("Charging quantity unit is required.");
  if (
    (input.receiptEmailHmac == null) !== (input.receiptEmailHmacVersion == null)
    || (input.receiptEmailHmacVersion != null
      && (!Number.isSafeInteger(input.receiptEmailHmacVersion)
        || input.receiptEmailHmacVersion < 1))
  ) {
    throw new TypeError("Receipt-email HMAC and version must be supplied together.");
  }
  if (input.planId != null && !["explorer", "driver", "family", "fleet"].includes(input.planId)) {
    throw new TypeError("Membership plan ID must be canonical.");
  }
  if (input.priceId != null && !input.planId) {
    throw new TypeError("A price ID requires its canonical plan ID.");
  }
  normalizeJsonObject(input.terms);
}

function hmac(key: string, purpose: string, value: string): string {
  return createHmac("sha256", key).update(`${purpose}\0${value}`).digest("hex");
}

function hashesForVersion(
  principal: ChargingAttemptPrincipal,
  input: LockedChargingQuoteInput,
  config: ChargingAttemptHashConfig,
  keyVersion: number,
  at: Date,
): { candidate: AttemptHashCandidate; quote: LockedChargingQuote } {
  const key = config.hmacKeys[keyVersion];
  if (!key || key.length < 32) {
    throw new Error(`Charging Attempt HMAC key version ${keyVersion} is unavailable.`);
  }
  const principalHmac = hmac(key, `principal-v${keyVersion}`, `${principal.type}\0${principal.reference}`);
  const terms = normalizeJsonObject(input.terms);
  const quote: LockedChargingQuote = deepFreeze({
    operation: input.operation,
    principalType: principal.type,
    principalReferenceHmac: principalHmac,
    principalReferenceVersion: keyVersion,
    stationId: input.stationId,
    chargeMode: input.chargeMode,
    quantity: fixedQuantity(input.quantity),
    unit: input.unit.trim(),
    currency: input.currency,
    energyCents: input.energyCents,
    platformFeeCents: input.platformFeeCents,
    totalCents: input.totalCents,
    pricingVersion: input.pricingVersion.trim(),
    quoteVersion: input.quoteVersion,
    quoteCreatedAt: at.toISOString(),
    receiptEmailHmac: input.receiptEmailHmac ?? null,
    receiptEmailHmacVersion: input.receiptEmailHmacVersion ?? null,
    planId: input.planId ?? null,
    priceId: input.priceId ?? null,
    terms,
  });

  // Creation time belongs to the immutable quote but not the material request
  // identity; a retry minutes later must hash to the same request.
  const { quoteCreatedAt: _created, ...materialQuote } = quote;
  const materialJson = stableJson(materialQuote as unknown as Record<string, JsonValue>);
  return {
    candidate: {
      keyVersion,
      principalHmac,
      requestHash: hmac(key, `request-v${keyVersion}`, materialJson),
      transactionFingerprint: hmac(key, `fingerprint-v${keyVersion}`, materialJson),
    },
    quote,
  };
}

function safeHashEqual(left: string, right: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(left) || !/^[0-9a-f]{64}$/i.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function asInsert(
  id: string,
  principal: ChargingAttemptPrincipal,
  candidate: AttemptHashCandidate,
  quote: LockedChargingQuote,
): AttemptInsert {
  return {
    id,
    principalType: principal.type,
    principalHmac: candidate.principalHmac,
    principalHmacVersion: candidate.keyVersion,
    operation: quote.operation,
    stationId: quote.stationId,
    paymentCreationRequestId: null,
    chargingSessionId: null,
    requestHash: candidate.requestHash,
    requestHashVersion: candidate.keyVersion,
    transactionFingerprint: candidate.transactionFingerprint,
    fingerprintKeyVersion: candidate.keyVersion,
    quoteVersion: quote.quoteVersion,
    quoteCreatedAt: new Date(quote.quoteCreatedAt),
    quote,
    currency: quote.currency,
    chargeMode: quote.chargeMode,
    quantity: quote.quantity,
    unit: quote.unit,
    energyCents: quote.energyCents,
    platformFeeCents: quote.platformFeeCents,
    totalCents: quote.totalCents,
    receiptEmailHmac: quote.receiptEmailHmac,
    receiptEmailHmacVersion: quote.receiptEmailHmacVersion,
    planId: quote.planId,
    priceId: quote.priceId,
    pricingVersion: quote.pricingVersion,
    state: "issued",
    reconciliationState: "none",
    reconciliationReason: null,
    stripePaymentIntentId: null,
    stripeCheckoutSessionId: null,
  };
}

function requestMatches(
  existing: ChargingAttemptRecord,
  principal: ChargingAttemptPrincipal,
  input: LockedChargingQuoteInput,
  config: ChargingAttemptHashConfig,
  now: Date,
): boolean {
  if (!principalMatches(existing, principal, config)) return false;
  const expected = hashesForVersion(
    principal,
    input,
    config,
    existing.principalHmacVersion,
    now,
  ).candidate;
  return existing.principalHmacVersion === expected.keyVersion
    && existing.requestHashVersion === expected.keyVersion
    && existing.fingerprintKeyVersion === expected.keyVersion
    && safeHashEqual(existing.principalHmac, expected.principalHmac)
    && safeHashEqual(existing.requestHash, expected.requestHash)
    && safeHashEqual(existing.transactionFingerprint, expected.transactionFingerprint);
}

function principalMatches(
  existing: ChargingAttemptRecord,
  principal: ChargingAttemptPrincipal,
  config: ChargingAttemptHashConfig,
): boolean {
  if (existing.principalType !== principal.type) return false;
  const key = config.hmacKeys[existing.principalHmacVersion];
  if (!key) return false;
  const expected = hmac(
    key,
    `principal-v${existing.principalHmacVersion}`,
    `${principal.type}\0${principal.reference}`,
  );
  return safeHashEqual(existing.principalHmac, expected);
}

export function createChargingAttemptService(
  store: ChargingAttemptStore,
  hashConfig: ChargingAttemptHashConfig,
  options: ServiceOptions = {},
) {
  const now = options.now ?? (() => new Date());
  const equivalentWindowMs = options.equivalentAttemptWindowMs
    ?? DEFAULT_EQUIVALENT_WINDOW_MS;

  if (
    !Number.isSafeInteger(hashConfig.activeKeyVersion)
    || hashConfig.activeKeyVersion < 1
    || !hashConfig.hmacKeys[hashConfig.activeKeyVersion]
    || hashConfig.hmacKeys[hashConfig.activeKeyVersion]!.length < 32
  ) {
    throw new Error("A configured server-side Charging Attempt HMAC key is required.");
  }
  if (!Number.isSafeInteger(equivalentWindowMs) || equivalentWindowMs <= 0) {
    throw new TypeError("Equivalent-attempt window must be a positive integer.");
  }

  return {
    async establish(input: EstablishChargingAttemptInput): Promise<EstablishAttemptResult> {
      if (!input.principal.reference.trim()) {
        throw new TypeError("A verified charging principal is required.");
      }
      if (input.attemptId && !UUID_PATTERN.test(input.attemptId)) {
        throw new TypeError("Charging Attempt ID must be a valid server-issued UUID.");
      }

      const createdAt = now();
      if (input.attemptId) {
        return store.withAdvisoryLocks(
          [`charging-attempt:id:${input.attemptId}`],
          async (tx) => {
            const existing = await tx.findByIdForUpdate(input.attemptId);
            // A client-supplied unknown ID is never accepted as server-issued.
            if (!existing) throw new ChargingAttemptNotFoundError();
            if (!principalMatches(existing, input.principal, hashConfig)) {
              throw new ChargingAttemptConflictError();
            }
            // A retry without new material reuses the original row verbatim.
            // If the caller does send material, verify it against the immutable
            // hashes; never replace/recompute the persisted quote.
            if (input.quote) {
              validateQuote(input.quote);
              if (!requestMatches(existing, input.principal, input.quote, hashConfig, createdAt)) {
                throw new ChargingAttemptConflictError();
              }
            }
            if (existing.state === "succeeded") return { kind: "completed", attempt: existing };
            if (existing.state === "failed") return { kind: "recovered", attempt: existing };
            if (
              existing.state === "issued"
              && existing.reconciliationState === "none"
              && !existing.stripePaymentIntentId
              && !existing.stripeCheckoutSessionId
            ) {
              return { kind: "recovered", attempt: existing };
            }
            if (existing.state === "reconciling" || existing.state === "manual_review") {
              return {
                kind: "reconciliation_required",
                attempt: existing,
                reason: existing.reconciliationReason ?? "Attempt already requires reconciliation.",
              };
            }
            const reason = "Attempt has an incomplete Stripe operation; retrieve and verify its Stripe disposition before retry.";
            await tx.markReconciliationRequired(existing.id, reason);
            return {
              kind: "reconciliation_required",
              attempt: {
                ...existing,
                state: "reconciling",
                reconciliationState: "required",
                reconciliationReason: reason,
              },
              reason,
            };
          },
        );
      }
      if (!input.quote) throw new TypeError("A server-resolved quote is required for a new Attempt.");
      validateQuote(input.quote);
      const quoteInput = input.quote;
      const candidates = Object.keys(hashConfig.hmacKeys)
        .map(Number)
        .filter((version) => Number.isSafeInteger(version) && version > 0)
        .sort((a, b) => a - b)
        .map((version) => hashesForVersion(
          input.principal,
          quoteInput,
          hashConfig,
          version,
          createdAt,
        ));
      const activeCandidate = candidates.find(
        ({ candidate }) => candidate.keyVersion === hashConfig.activeKeyVersion,
      );
      if (!activeCandidate) throw new Error("Active Charging Attempt HMAC key is unavailable.");

      const id = input.attemptId ?? randomUUID();
      const locks = [
        `charging-attempt:id:${id}`,
        ...candidates.map(({ candidate }) =>
          `charging-attempt:equivalent:${candidate.keyVersion}:${candidate.principalHmac}:${candidate.transactionFingerprint}`,
        ),
      ];

      return store.withAdvisoryLocks(locks, async (tx) => {
        const matchingCandidates = candidates.map(({ candidate }) => candidate);
        const equivalent = await tx.findEquivalentForUpdate(
          matchingCandidates,
          new Date(createdAt.getTime() - equivalentWindowMs),
        );
        if (equivalent) {
          const versionCandidate = candidates.find(({ candidate }) =>
            candidate.keyVersion === equivalent.fingerprintKeyVersion,
          );
          if (
            !versionCandidate
            || !requestMatches(equivalent, input.principal, quoteInput, hashConfig, createdAt)
          ) {
            const reason = "Equivalent-attempt fingerprint matched without verified request identity; manual review required.";
            await tx.markReconciliationRequired(equivalent.id, reason);
            return {
              kind: "reconciliation_required",
              attempt: { ...equivalent, state: "reconciling", reconciliationState: "required", reconciliationReason: reason },
              reason,
            };
          }

          if (
            equivalent.state === "issued"
            && equivalent.reconciliationState === "none"
            && !equivalent.stripePaymentIntentId
            && !equivalent.stripeCheckoutSessionId
          ) {
            // Recovery returns the original server ID; it does not link/merge
            // the newly generated candidate ID into the persisted attempt.
            return { kind: "recovered", attempt: equivalent };
          }

          const reason = "Equivalent incomplete Attempt has a prior or ambiguous Stripe operation; verify identity, state, and Stripe disposition.";
          if (
            equivalent.state !== "reconciling"
            && equivalent.state !== "manual_review"
          ) {
            await tx.markReconciliationRequired(equivalent.id, reason);
          }
          return {
            kind: "reconciliation_required",
            attempt: {
              ...equivalent,
              state: "reconciling",
              reconciliationState: "required",
              reconciliationReason: reason,
            },
            reason,
          };
        }

        const row = await tx.insert(asInsert(id, input.principal, activeCandidate.candidate, activeCandidate.quote));
        return { kind: "created", attempt: row };
      });
    },

    async attachPaymentRequest(input: {
      attemptId: string;
      principal: ChargingAttemptPrincipal;
      paymentRequestId: string;
    }): Promise<void> {
      const attempt = await this.getForPrincipal(input.attemptId, input.principal);
      if (!attempt) throw new ChargingAttemptNotFoundError();
      if (!UUID_PATTERN.test(input.paymentRequestId)) {
        throw new TypeError("Payment creation request ID must be a UUID.");
      }
      if (attempt.state !== "issued" && attempt.paymentCreationRequestId !== input.paymentRequestId) {
        throw new ChargingAttemptConflictError("Payment request cannot be changed after payment processing begins.");
      }
      if (!await store.withAdvisoryLocks([`charging-attempt:id:${attempt.id}`], (tx) =>
        tx.attachPaymentRequest(attempt.id, input.paymentRequestId))) {
        throw new ChargingAttemptConflictError("Payment request conflicts with the existing Charging Attempt.");
      }
    },

    async attachStripeObject(input: {
      attemptId: string;
      principal: ChargingAttemptPrincipal;
      object: { type: "payment_intent" | "checkout_session"; id: string };
    }): Promise<void> {
      if (!input.object.id.trim()) throw new TypeError("Stripe object ID is required.");
      const result = await store.withAdvisoryLocks(
        [`charging-attempt:id:${input.attemptId}`],
        async (tx) => {
          const attempt = await tx.findByIdForUpdate(input.attemptId);
          if (!attempt || !principalMatches(attempt, input.principal, hashConfig)) {
            return "not_found" as const;
          }
          if (!attempt.paymentCreationRequestId) return "unbound_request" as const;
          const expectedStripeType = attempt.operation === "charging_checkout"
            ? "checkout_session"
            : "payment_intent";
          if (input.object.type !== expectedStripeType) return "wrong_type" as const;
          if (
            !["issued", "processing"].includes(attempt.state)
            || !["none", "resolved"].includes(attempt.reconciliationState)
          ) {
            return "invalid_state" as const;
          }
          const linked = await tx.attachStripeObject(attempt.id, input.object);
          if (linked) return "linked" as const;
          await tx.markReconciliationRequired(
            attempt.id,
            "A conflicting Stripe object identifier was returned; preserve the existing link and reconcile.",
          );
          return "conflict" as const;
        },
      );
      if (result === "not_found") throw new ChargingAttemptNotFoundError();
      if (result === "unbound_request") {
        throw new ChargingAttemptConflictError("A payment creation request must be bound before attaching a Stripe object.");
      }
      if (result === "wrong_type") {
        throw new ChargingAttemptConflictError("Stripe object type does not match the immutable charging operation.");
      }
      if (result === "invalid_state") {
        throw new ChargingAttemptConflictError("Stripe object cannot be attached in the current attempt or reconciliation state.");
      }
      if (result === "conflict") {
        throw new ChargingAttemptConflictError("Stripe object conflicts with existing attempt evidence; reconciliation is required.");
      }
    },

    async getForPrincipal(
      attemptId: string,
      principal: ChargingAttemptPrincipal,
    ): Promise<ChargingAttemptRecord | null> {
      if (!UUID_PATTERN.test(attemptId) || !principal.reference.trim()) return null;
      return store.withAdvisoryLocks([`charging-attempt:id:${attemptId}`], async (tx) => {
        const attempt = await tx.findByIdForUpdate(attemptId);
        if (!attempt) return null;
        const versionKey = hashConfig.hmacKeys[attempt.principalHmacVersion];
        if (!versionKey || attempt.principalType !== principal.type) return null;
        const expected = hmac(
          versionKey,
          `principal-v${attempt.principalHmacVersion}`,
          `${principal.type}\0${principal.reference}`,
        );
        if (!safeHashEqual(attempt.principalHmac, expected)) return null;
        return attempt;
      });
    },
  };
}

function rowFromDatabase(row: Record<string, unknown>): ChargingAttemptRecord {
  return {
    id: String(row.id),
    principalType: row.principal_type as ChargingPrincipalType,
    principalHmac: String(row.principal_hmac),
    principalHmacVersion: Number(row.principal_hmac_version),
    operation: row.operation as ChargingOperation,
    stationId: Number(row.station_id),
    paymentCreationRequestId: row.payment_creation_request_id == null ? null : String(row.payment_creation_request_id),
    chargingSessionId: row.charging_session_id == null ? null : Number(row.charging_session_id),
    requestHash: String(row.request_hash),
    requestHashVersion: Number(row.request_hash_version),
    transactionFingerprint: String(row.transaction_fingerprint),
    fingerprintKeyVersion: Number(row.fingerprint_key_version),
    quoteVersion: Number(row.quote_version),
    quoteCreatedAt: new Date(String(row.quote_created_at)),
    quote: row.quote as LockedChargingQuote,
    currency: String(row.currency),
    chargeMode: row.charge_mode as ChargingMode,
    quantity: Number(row.quantity),
    unit: String(row.unit),
    energyCents: Number(row.energy_cents),
    platformFeeCents: Number(row.platform_fee_cents),
    totalCents: Number(row.total_cents),
    receiptEmailHmac: row.receipt_email_hmac == null ? null : String(row.receipt_email_hmac),
    receiptEmailHmacVersion: row.receipt_email_hmac_version == null ? null : Number(row.receipt_email_hmac_version),
    planId: row.plan_id == null ? null : String(row.plan_id),
    priceId: row.price_id == null ? null : String(row.price_id),
    pricingVersion: String(row.pricing_version),
    state: row.state as ChargingAttemptState,
    reconciliationState: row.reconciliation_state as ChargingReconciliationState,
    reconciliationReason: row.reconciliation_reason == null ? null : String(row.reconciliation_reason),
    stripePaymentIntentId: row.stripe_payment_intent_id == null ? null : String(row.stripe_payment_intent_id),
    stripeCheckoutSessionId: row.stripe_checkout_session_id == null ? null : String(row.stripe_checkout_session_id),
    createdAt: new Date(String(row.created_at)),
    updatedAt: new Date(String(row.updated_at)),
    completedAt: row.completed_at == null ? null : new Date(String(row.completed_at)),
    expiresAt: row.expires_at == null ? null : new Date(String(row.expires_at)),
  };
}

async function one(
  client: PgClientLike,
  query: string,
  values: readonly unknown[],
): Promise<ChargingAttemptRecord | null> {
  const result = await client.query(query, [...values]);
  return result.rows[0] ? rowFromDatabase(result.rows[0] as Record<string, unknown>) : null;
}

type PgClientLike = {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>;
  release(): void;
};

type PgPoolLike = {
  connect(): Promise<PgClientLike>;
};

/** PostgreSQL-backed advisory-locked repository for durable Attempt operations. */
export class PostgresChargingAttemptStore implements ChargingAttemptStore {
  constructor(private readonly pool: PgPoolLike) {}

  async withAdvisoryLocks<T>(
    lockKeys: readonly string[],
    callback: (tx: ChargingAttemptTransaction) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const key of [...new Set(lockKeys)].sort()) {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [key]);
      }
      const transaction: ChargingAttemptTransaction = {
        findByIdForUpdate: (id) => one(
          client,
          "SELECT * FROM charging_attempts WHERE id = $1::uuid FOR UPDATE",
          [id],
        ),
        findEquivalentForUpdate: async (candidates, createdAfter) => {
          if (!candidates.length) return null;
          const predicates: string[] = [];
          const values: unknown[] = [createdAfter];
          for (const candidate of candidates) {
            const start = values.length + 1;
            values.push(candidate.keyVersion, candidate.principalHmac, candidate.transactionFingerprint);
            predicates.push(
              `(principal_hmac_version = $${start} AND principal_hmac = $${start + 1} AND transaction_fingerprint = $${start + 2})`,
            );
          }
          return one(
            client,
            `SELECT * FROM charging_attempts
             WHERE created_at >= $1
               AND state IN ('issued', 'processing', 'reconciling', 'manual_review')
               AND (${predicates.join(" OR ")})
             ORDER BY created_at DESC
             LIMIT 1 FOR UPDATE`,
            values,
          );
        },
        insert: async (record) => {
          const result = await client.query(
            `INSERT INTO charging_attempts (
              id, principal_type, principal_hmac, principal_hmac_version, operation,
              station_id, payment_creation_request_id, charging_session_id,
              request_hash, request_hash_version, transaction_fingerprint,
              fingerprint_key_version, quote_version, quote_created_at, quote,
              currency, charge_mode, quantity, unit, energy_cents, platform_fee_cents,
              total_cents, receipt_email_hmac, receipt_email_hmac_version, plan_id,
              price_id, pricing_version, state, reconciliation_state
            ) VALUES (
              $1::uuid, $2::payment_principal_type, $3, $4, $5, $6, $7::uuid,
              $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16, $17, $18, $19,
              $20, $21, $22, $23, $24, $25, $26, $27, $28::charging_attempt_state,
              $29::charging_attempt_reconciliation_state
            ) RETURNING *`,
            [
              record.id,
              record.principalType,
              record.principalHmac,
              record.principalHmacVersion,
              record.operation,
              record.stationId,
              record.paymentCreationRequestId,
              record.chargingSessionId,
              record.requestHash,
              record.requestHashVersion,
              record.transactionFingerprint,
              record.fingerprintKeyVersion,
              record.quoteVersion,
              record.quoteCreatedAt,
              JSON.stringify(record.quote),
              record.currency,
              record.chargeMode,
              record.quantity,
              record.unit,
              record.energyCents,
              record.platformFeeCents,
              record.totalCents,
              record.receiptEmailHmac,
              record.receiptEmailHmacVersion,
              record.planId,
              record.priceId,
              record.pricingVersion,
              record.state,
              record.reconciliationState,
            ],
          );
          return rowFromDatabase(result.rows[0] as Record<string, unknown>);
        },
        markReconciliationRequired: async (id, reason) => {
          await client.query(
            `UPDATE charging_attempts
             SET state = 'reconciling',
                 reconciliation_state = 'required',
                 reconciliation_reason = $2,
                 updated_at = NOW()
             WHERE id = $1::uuid AND state NOT IN ('succeeded', 'failed')`,
            [id, reason],
          );
        },
        attachPaymentRequest: async (id, paymentRequestId) => {
          const result = await client.query(
            `UPDATE charging_attempts
             SET payment_creation_request_id = $2::uuid, updated_at = NOW()
             WHERE id = $1::uuid
               AND state = 'issued'
               AND reconciliation_state IN ('none', 'resolved')
               AND (
                 payment_creation_request_id IS NULL
                 OR payment_creation_request_id = $2::uuid
               )`,
            [id, paymentRequestId],
          );
          return result.rowCount === 1;
        },
        attachStripeObject: async (id, object) => {
          const field = object.type === "payment_intent"
            ? "stripe_payment_intent_id"
            : "stripe_checkout_session_id";
          const counterpart = object.type === "payment_intent"
            ? "stripe_checkout_session_id"
            : "stripe_payment_intent_id";
          const result = await client.query(
            `UPDATE charging_attempts
             SET ${field} = $2, state = 'processing', updated_at = NOW()
             WHERE id = $1::uuid
               AND payment_creation_request_id IS NOT NULL
               AND state IN ('issued', 'processing')
               AND reconciliation_state IN ('none', 'resolved')
               AND ${counterpart} IS NULL
               AND (${field} IS NULL OR ${field} = $2)`,
            [id, object.id],
          );
          return result.rowCount === 1;
        },
      };
      const value = await callback(transaction);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

export function readChargingAttemptHashConfig(
  env: NodeJS.ProcessEnv = process.env,
): ChargingAttemptHashConfig {
  const secret = env.CHARGING_ATTEMPT_HMAC_KEY;
  const version = Number(env.CHARGING_ATTEMPT_HMAC_KEY_VERSION);
  if (!secret || secret.length < 32 || !Number.isSafeInteger(version) || version < 1) {
    throw new Error(
      "CHARGING_ATTEMPT_HMAC_KEY (at least 32 characters) and positive CHARGING_ATTEMPT_HMAC_KEY_VERSION are required.",
    );
  }
  return { activeKeyVersion: version, hmacKeys: { [version]: secret } };
}
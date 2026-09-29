import { pgEnum } from "drizzle-orm/pg-core";

export const checkoutVerificationStatusEnum = pgEnum(
  "checkout_verification_status",
  ["pending", "verified", "locked", "expired", "consumed"],
);

export const paymentRequestOperationEnum = pgEnum("payment_request_operation", [
  "charging_checkout",
  "charging_payment_intent",
  "subscription_checkout",
]);

export const paymentRequestStateEnum = pgEnum("payment_request_state", [
  "processing",
  "stripe_succeeded",
  "completed",
  "retryable_failure",
  "reconciling",
  "terminal_failure",
  "expired",
  "superseded",
  "manual_review",
]);

export const paymentPrincipalTypeEnum = pgEnum("payment_principal_type", [
  "clerk_user",
  "verified_guest",
]);

export const stripeObjectTypeEnum = pgEnum("stripe_object_type", [
  "checkout_session",
  "payment_intent",
]);

export const paymentRetentionClassEnum = pgEnum("payment_retention_class", [
  "active",
  "successful",
  "failed",
  "reconciliation_evidence",
]);

export const rateLimitSubjectTypeEnum = pgEnum("rate_limit_subject_type", [
  "email",
  "ip",
  "principal",
  "installation",
]);

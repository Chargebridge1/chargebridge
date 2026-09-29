import { Router } from "express";
import { getAuth } from "@clerk/express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { getUncachableStripeClient } from "../stripeClient";
import { logger } from "../lib/logger";
import {
  getMembershipPlan,
  getPublicMembershipCatalog,
} from "../lib/membershipCatalog";

const router = Router();

// GET /api/billing/plans — public, returns the server-authoritative catalog.
router.get("/billing/plans", async (_req, res) => {
  return res.json({ plans: getPublicMembershipCatalog() });
});

function developmentCheckoutUnavailable(res: import("express").Response) {
  if (process.env.NODE_ENV === "development") return false;
  res.status(503).json({
    code: "MEMBERSHIP_CHECKOUT_NOT_ENABLED",
    error: "Membership checkout is enabled only in the development environment.",
  });
  return true;
}

async function createMembershipCheckout(
  req: import("express").Request,
  res: import("express").Response,
) {
  if (developmentCheckoutUnavailable(res)) return;

  const plan = getMembershipPlan(req.body?.planId);
  if (!plan || plan.id === "explorer" || !plan.priceId) {
    return res.status(400).json({
      code: "INVALID_MEMBERSHIP_PLAN",
      error: "A supported paid plan ID is required.",
    });
  }

  // Fleet billing cannot safely start until the organization-to-subscription
  // ownership link and durable quantity reconciliation workflow are approved
  // and implemented. In particular, never infer Fleet quantity from a
  // Clerk-user-owned vehicle count.
  if (plan.id === "fleet") {
    return res.status(409).json({
      code: "FLEET_BILLING_NOT_READY",
      error: "Fleet checkout is unavailable until organization billing and quantity reconciliation are implemented.",
    });
  }

  // A Stripe-level subscription lookup cannot serialize two simultaneous
  // Checkout Session requests. Until an approved durable in-flight checkout
  // reservation/idempotency contract exists, reject every new paid checkout
  // before making any Stripe Price, Customer, or Session API calls.
  return res.status(409).json({
    code: "MEMBERSHIP_CHECKOUT_NOT_READY",
    error: "New paid membership checkout is temporarily unavailable until duplicate checkout protection is ready. No Stripe operation was attempted.",
  });
}

// Paid membership checkout accepts only canonical plan IDs; every billing
// attribute is resolved from MEMBERSHIP_CATALOG and the authenticated user.
router.post("/billing/checkout", requireAuth, createMembershipCheckout);

// POST /api/billing/portal — open Stripe Customer Portal to manage subscription
router.post("/billing/portal", requireAuth, async (req, res) => {
  const clerkUserId = (req as any).clerkUserId as string;

  try {
    const user = await db.query.usersTable.findFirst({
      where: eq(usersTable.clerkId, clerkUserId),
    });

    if (!user?.stripeCustomerId) {
      return res.status(400).json({ error: "No billing account found" });
    }

    const stripe = await getUncachableStripeClient();
    const baseUrl = `https://${process.env.REPLIT_DOMAINS?.split(",")[0]}`;
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${baseUrl}/plans`,
    });

    return res.json({ url: portalSession.url });
  } catch (err) {
    logger.error({ err }, "Failed to create portal session");
    return res.status(500).json({ error: "Failed to create portal session" });
  }
});

// Legacy mobile compatibility endpoint. Reject anonymous clients explicitly
// before evaluating request data so no Stripe object can be created as a side
// effect; authenticated callers use the exact same server catalog checkout.
router.post(
  "/billing/checkout-plan",
  (req, res, next) => {
    if (!getAuth(req)?.userId) {
      return res.status(401).json({
        code: "AUTHENTICATION_REQUIRED",
        error: "Sign in to your ChargeBridge account before starting a membership.",
      });
    }
    return next();
  },
  requireAuth,
  createMembershipCheckout,
);

// GET /api/billing/subscription — current user's subscription status
router.get("/billing/subscription", requireAuth, async (req, res) => {
  const clerkUserId = (req as any).clerkUserId as string;

  try {
    const user = await db.query.usersTable.findFirst({
      where: eq(usersTable.clerkId, clerkUserId),
    });

    if (!user?.stripeSubscriptionId) {
      return res.json({ subscription: null });
    }

    const stripe = await getUncachableStripeClient();
    const subscription = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
    return res.json({ subscription });
  } catch (err) {
    logger.error({ err }, "Failed to fetch subscription");
    return res.status(500).json({ error: "Failed to fetch subscription" });
  }
});

export default router;

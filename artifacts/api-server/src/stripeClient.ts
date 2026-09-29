import Stripe from "stripe";

/**
 * Returns a fresh authenticated Stripe client using the STRIPE_SECRET_KEY env var.
 * Not cached — call fresh on every request.
 */
export async function getUncachableStripeClient(): Promise<Stripe> {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error(
      "STRIPE_SECRET_KEY environment variable is required. " +
      "Add your Stripe secret key to the project secrets."
    );
  }
  return new Stripe(secretKey);
}

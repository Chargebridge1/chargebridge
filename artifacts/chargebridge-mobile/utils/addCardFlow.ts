/**
 * Core logic for the "Add Card" flow, extracted from AddCardModal so it can be
 * unit-tested without a React rendering environment.
 *
 * All external dependencies are injected as callbacks so tests can mock them
 * without touching module-level mocks.
 */

export interface PaymentMethodResult {
  id: string;
  type: "card" | "bank" | "carrier";
  label: string;
  last4: string;
  subLabel: string;
}

export interface SetupIntentResponse {
  setupIntentClientSecret: string;
  customerId: string;
  ephemeralKeySecret: string;
}

export interface PaymentMethodsResponse {
  methods: Array<{
    id: string;
    brand: string;
    last4: string;
    expMonth: number;
    expYear: number;
  }>;
}

export interface AddCardFlowDeps {
  /** Returns the current Clerk session token, or null if the session has expired. */
  getToken: () => Promise<string | null>;
  /**
   * Calls POST /api/setup-intent with the bearer token and returns the Stripe
   * client secrets. Throws on non-OK responses.
   */
  createSetupIntent: (
    token: string,
    email?: string | null,
    name?: string | null,
  ) => Promise<SetupIntentResponse>;
  /** Calls Stripe initPaymentSheet. */
  initPaymentSheet: (params: {
    merchantDisplayName: string;
    customerId: string;
    customerEphemeralKeySecret: string;
    setupIntentClientSecret: string;
    allowsDelayedPaymentMethods: boolean;
    appearance: { colors: { primary: string } };
  }) => Promise<{ error: { message: string } | null }>;
  /** Calls Stripe presentPaymentSheet. */
  presentPaymentSheet: () => Promise<{
    error: { code: string; message: string } | null;
  }>;
  /**
   * Calls GET /api/payment-methods with the bearer token and returns the user's
   * saved methods. Returns an empty methods array on failure rather than throwing.
   */
  fetchPaymentMethods: (token: string) => Promise<PaymentMethodsResponse>;
  /** Called with `(message)` to surface an error in the UI. */
  onError: (msg: string) => void;
  /** Called with `true` when an async operation starts and `false` when it ends. */
  onLoading: (loading: boolean) => void;
  /** Called with the newly added payment method on success. */
  onSave: (method: PaymentMethodResult) => void;
  /** Fire-and-forget analytics event (must never throw). */
  trackEvent: (event: string, props: Record<string, unknown>) => void;
  /** Trigger a success haptic. */
  hapticSuccess: () => void;
  /**
   * Called whenever getToken() returns null, at either checkpoint.
   * The UI should use this to replace the primary CTA with a "Sign in again"
   * action so the user cannot re-tap a button that will always fail.
   *
   * `checkpoint` distinguishes the two failure sites so the UI can show
   * context-appropriate wording:
   *   1 → session expired before the card was submitted (card NOT saved)
   *   2 → session expired after presentPaymentSheet succeeded (card WAS saved)
   */
  onSessionExpired?: (checkpoint: 1 | 2) => void;
  /** Cardholder email (used when creating the Stripe customer). */
  email?: string | null;
  /** Cardholder display name. */
  name?: string | null;
}

/**
 * Runs the full "Add Card" flow.
 *
 * Checkpoints where a null `getToken()` result causes a visible error:
 *   1. Before creating the setup intent  → tracks `add_card_no_token`
 *   2. After `presentPaymentSheet` returns OK → tracks `add_card_refresh_no_token`
 */
export async function runAddCardFlow(deps: AddCardFlowDeps): Promise<void> {
  const {
    getToken,
    createSetupIntent,
    initPaymentSheet,
    presentPaymentSheet,
    fetchPaymentMethods,
    onError,
    onLoading,
    onSave,
    trackEvent,
    hapticSuccess,
    onSessionExpired,
    email,
    name,
  } = deps;

  onError("");
  onLoading(true);

  try {
    // ── Checkpoint 1: token before setup-intent ────────────────────────────
    const token = await getToken();
    if (!token) {
      trackEvent("add_card_no_token", {});
      onError(
        "Your session has expired. Please sign in again to add a card.",
      );
      onSessionExpired?.(1);
      onLoading(false);
      return;
    }

    const { setupIntentClientSecret, customerId, ephemeralKeySecret } =
      await createSetupIntent(token, email, name);

    const { error: initErr } = await initPaymentSheet({
      merchantDisplayName: "ChargeBridge",
      customerId,
      customerEphemeralKeySecret: ephemeralKeySecret,
      setupIntentClientSecret,
      allowsDelayedPaymentMethods: false,
      appearance: { colors: { primary: "#0D9E7E" } },
    });
    if (initErr) {
      onError(initErr.message);
      onLoading(false);
      return;
    }

    const { error: presentErr } = await presentPaymentSheet();
    onLoading(false);
    if (presentErr) {
      if (presentErr.code !== "Canceled") onError(presentErr.message);
      return;
    }

    // ── Checkpoint 2: token after payment sheet completes ──────────────────
    const token2 = await getToken();
    if (!token2) {
      trackEvent("add_card_refresh_no_token", {});
      onError(
        "Card added, but session expired — please reopen this screen to see your updated payment methods.",
      );
      onSessionExpired?.(2);
      return;
    }

    const { methods } = await fetchPaymentMethods(token2);
    const newest = methods?.[0];
    const brand = newest?.brand ?? "card";
    const brandLabel = brand.charAt(0).toUpperCase() + brand.slice(1);
    const label = newest ? `${brandLabel} ···· ${newest.last4}` : "Saved Card";
    const subLabel = newest
      ? `Expires ${String(newest.expMonth).padStart(2, "0")}/${String(newest.expYear).slice(-2)}`
      : "Verified by Stripe";

    hapticSuccess();
    onSave({
      id: newest?.id ?? String(Date.now()),
      type: "card",
      label,
      last4: newest?.last4 ?? "****",
      subLabel,
    });
  } catch (e: unknown) {
    const msg =
      e instanceof Error ? e.message : "Could not load payment setup. Please try again.";
    onError(msg);
    onLoading(false);
  }
}

/**
 * Unit tests for the "Add Card" flow logic (runAddCardFlow).
 *
 * These tests exercise the two null-token checkpoints:
 *   1. getToken() returns null before the setup-intent request
 *      → user sees a session-expired error and add_card_no_token is tracked
 *   2. getToken() returns null after presentPaymentSheet succeeds
 *      → user sees a softer session-expired error and add_card_refresh_no_token is tracked
 */

import { runAddCardFlow, type AddCardFlowDeps } from "../utils/addCardFlow";

// ── Shared stub builders ──────────────────────────────────────────────────────

function makeSetupIntentOk() {
  return jest.fn().mockResolvedValue({
    setupIntentClientSecret: "seti_secret",
    customerId: "cus_123",
    ephemeralKeySecret: "ek_secret",
  });
}

function makeInitPaymentSheetOk() {
  return jest.fn().mockResolvedValue({ error: null });
}

function makePresentPaymentSheetOk() {
  return jest.fn().mockResolvedValue({ error: null });
}

function makeFetchPaymentMethodsOk() {
  return jest.fn().mockResolvedValue({
    methods: [
      { id: "pm_1", brand: "visa", last4: "4242", expMonth: 12, expYear: 2028 },
    ],
  });
}

function baseDeps(overrides: Partial<AddCardFlowDeps> = {}): AddCardFlowDeps {
  return {
    getToken: jest.fn().mockResolvedValue("tok_valid"),
    createSetupIntent: makeSetupIntentOk(),
    initPaymentSheet: makeInitPaymentSheetOk(),
    presentPaymentSheet: makePresentPaymentSheetOk(),
    fetchPaymentMethods: makeFetchPaymentMethodsOk(),
    onError: jest.fn(),
    onLoading: jest.fn(),
    onSave: jest.fn(),
    trackEvent: jest.fn(),
    hapticSuccess: jest.fn(),
    email: "user@example.com",
    name: "Test User",
    ...overrides,
  };
}

// ── Checkpoint 1: null token before setup-intent ──────────────────────────────

describe("runAddCardFlow — checkpoint 1 (null token before setup-intent)", () => {
  it("sets the session-expired error message", async () => {
    const deps = baseDeps({ getToken: jest.fn().mockResolvedValue(null) });
    await runAddCardFlow(deps);

    expect(deps.onError).toHaveBeenCalledWith(
      "Your session has expired. Please sign in again to add a card.",
    );
  });

  it("fires the add_card_no_token analytics event", async () => {
    const deps = baseDeps({ getToken: jest.fn().mockResolvedValue(null) });
    await runAddCardFlow(deps);

    expect(deps.trackEvent).toHaveBeenCalledWith("add_card_no_token", {});
  });

  it("does not fire add_card_refresh_no_token", async () => {
    const deps = baseDeps({ getToken: jest.fn().mockResolvedValue(null) });
    await runAddCardFlow(deps);

    const calls = (deps.trackEvent as jest.Mock).mock.calls.map(
      ([event]) => event,
    );
    expect(calls).not.toContain("add_card_refresh_no_token");
  });

  it("clears loading and never opens the payment sheet", async () => {
    const deps = baseDeps({ getToken: jest.fn().mockResolvedValue(null) });
    await runAddCardFlow(deps);

    // loading must end at false
    const loadingCalls = (deps.onLoading as jest.Mock).mock.calls.map(
      ([v]) => v,
    );
    expect(loadingCalls[loadingCalls.length - 1]).toBe(false);
    expect(deps.createSetupIntent).not.toHaveBeenCalled();
    expect(deps.presentPaymentSheet).not.toHaveBeenCalled();
  });

  it("does not call onSave", async () => {
    const deps = baseDeps({ getToken: jest.fn().mockResolvedValue(null) });
    await runAddCardFlow(deps);

    expect(deps.onSave).not.toHaveBeenCalled();
  });
});

// ── Checkpoint 2: null token after presentPaymentSheet succeeds ───────────────

describe("runAddCardFlow — checkpoint 2 (null token after payment sheet)", () => {
  function depsWithExpiredTokenAfterSheet() {
    // First call returns a valid token; second returns null.
    const getToken = jest
      .fn()
      .mockResolvedValueOnce("tok_valid")
      .mockResolvedValueOnce(null);
    return baseDeps({ getToken });
  }

  it("sets the softer session-expired error message", async () => {
    const deps = depsWithExpiredTokenAfterSheet();
    await runAddCardFlow(deps);

    expect(deps.onError).toHaveBeenCalledWith(
      "Card added, but session expired — please reopen this screen to see your updated payment methods.",
    );
  });

  it("fires the add_card_refresh_no_token analytics event", async () => {
    const deps = depsWithExpiredTokenAfterSheet();
    await runAddCardFlow(deps);

    expect(deps.trackEvent).toHaveBeenCalledWith("add_card_refresh_no_token", {});
  });

  it("does not fire add_card_no_token", async () => {
    const deps = depsWithExpiredTokenAfterSheet();
    await runAddCardFlow(deps);

    const calls = (deps.trackEvent as jest.Mock).mock.calls.map(
      ([event]) => event,
    );
    expect(calls).not.toContain("add_card_no_token");
  });

  it("does not call onSave (card may be saved in Stripe but refresh failed)", async () => {
    const deps = depsWithExpiredTokenAfterSheet();
    await runAddCardFlow(deps);

    expect(deps.onSave).not.toHaveBeenCalled();
  });

  it("does not call fetchPaymentMethods (token was null so fetch is skipped)", async () => {
    const deps = depsWithExpiredTokenAfterSheet();
    await runAddCardFlow(deps);

    expect(deps.fetchPaymentMethods).not.toHaveBeenCalled();
  });
});

// ── Happy path: both tokens valid ─────────────────────────────────────────────

describe("runAddCardFlow — happy path (both tokens valid)", () => {
  it("calls onSave with the newest payment method details", async () => {
    const deps = baseDeps();
    await runAddCardFlow(deps);

    expect(deps.onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "pm_1",
        type: "card",
        last4: "4242",
        label: "Visa ···· 4242",
        subLabel: "Expires 12/28",
      }),
    );
  });

  it("does not track any no-token events", async () => {
    const deps = baseDeps();
    await runAddCardFlow(deps);

    const events = (deps.trackEvent as jest.Mock).mock.calls.map(
      ([event]) => event,
    );
    expect(events).not.toContain("add_card_no_token");
    expect(events).not.toContain("add_card_refresh_no_token");
  });

  it("fires hapticSuccess on completion", async () => {
    const deps = baseDeps();
    await runAddCardFlow(deps);

    expect(deps.hapticSuccess).toHaveBeenCalledTimes(1);
  });

  it("does not surface any error", async () => {
    const deps = baseDeps();
    await runAddCardFlow(deps);

    // The first call clears error (""), subsequent calls would carry an actual error.
    const errorCalls = (deps.onError as jest.Mock).mock.calls.map(([m]) => m);
    expect(errorCalls.every((m) => m === "")).toBe(true);
  });
});

// ── Edge: user cancels the Stripe payment sheet ───────────────────────────────

describe("runAddCardFlow — user cancels Stripe sheet", () => {
  it("does not set an error for Canceled code", async () => {
    const presentPaymentSheet = jest
      .fn()
      .mockResolvedValue({ error: { code: "Canceled", message: "Canceled" } });
    const deps = baseDeps({ presentPaymentSheet });
    await runAddCardFlow(deps);

    const errorCalls = (deps.onError as jest.Mock).mock.calls.map(([m]) => m);
    expect(errorCalls.every((m) => m === "")).toBe(true);
  });

  it("does not call onSave on cancel", async () => {
    const presentPaymentSheet = jest
      .fn()
      .mockResolvedValue({ error: { code: "Canceled", message: "Canceled" } });
    const deps = baseDeps({ presentPaymentSheet });
    await runAddCardFlow(deps);

    expect(deps.onSave).not.toHaveBeenCalled();
  });
});

// ── Edge: initPaymentSheet returns an error ───────────────────────────────────

describe("runAddCardFlow — Stripe initPaymentSheet error", () => {
  it("surfaces the Stripe error message", async () => {
    const initPaymentSheet = jest
      .fn()
      .mockResolvedValue({ error: { message: "Card declined" } });
    const deps = baseDeps({ initPaymentSheet });
    await runAddCardFlow(deps);

    expect(deps.onError).toHaveBeenCalledWith("Card declined");
  });

  it("stops loading and does not open the payment sheet", async () => {
    const initPaymentSheet = jest
      .fn()
      .mockResolvedValue({ error: { message: "Card declined" } });
    const deps = baseDeps({ initPaymentSheet });
    await runAddCardFlow(deps);

    expect(deps.presentPaymentSheet).not.toHaveBeenCalled();
    const loadingCalls = (deps.onLoading as jest.Mock).mock.calls.map(
      ([v]) => v,
    );
    expect(loadingCalls[loadingCalls.length - 1]).toBe(false);
  });
});

// ── Edge: createSetupIntent throws (network error, 5xx, etc.) ─────────────────

describe("runAddCardFlow — createSetupIntent throws", () => {
  it("surfaces the error message and stops loading", async () => {
    const createSetupIntent = jest
      .fn()
      .mockRejectedValue(new Error("Network request failed"));
    const deps = baseDeps({ createSetupIntent });
    await runAddCardFlow(deps);

    expect(deps.onError).toHaveBeenCalledWith("Network request failed");
    const loadingCalls = (deps.onLoading as jest.Mock).mock.calls.map(
      ([v]) => v,
    );
    expect(loadingCalls[loadingCalls.length - 1]).toBe(false);
  });
});

// ── onSessionExpired callback: button-state contract ─────────────────────────
//
// After a session-expiry error the UI must replace "Add Card Securely" with a
// "Sign in again" action so the user cannot re-tap a button that will always
// fail.  The hook for this is the optional `onSessionExpired` callback, which
// runAddCardFlow calls at both null-token checkpoints before returning.

describe("runAddCardFlow — onSessionExpired callback", () => {
  it("checkpoint 1: calls onSessionExpired when getToken returns null", async () => {
    const onSessionExpired = jest.fn();
    const deps = baseDeps({
      getToken: jest.fn().mockResolvedValue(null),
      onSessionExpired,
    });
    await runAddCardFlow(deps);

    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });

  it("checkpoint 1: onSessionExpired is called after the error message is set", async () => {
    const callOrder: string[] = [];
    const onError = jest.fn(() => callOrder.push("onError"));
    const onSessionExpired = jest.fn(() => callOrder.push("onSessionExpired"));
    const deps = baseDeps({
      getToken: jest.fn().mockResolvedValue(null),
      onError,
      onSessionExpired,
    });
    await runAddCardFlow(deps);

    // The error must be visible before the UI replaces the button.
    expect(callOrder.indexOf("onError")).toBeLessThan(
      callOrder.indexOf("onSessionExpired"),
    );
  });

  it("checkpoint 2: calls onSessionExpired when token expires after payment sheet", async () => {
    const onSessionExpired = jest.fn();
    const getToken = jest
      .fn()
      .mockResolvedValueOnce("tok_valid")
      .mockResolvedValueOnce(null);
    const deps = baseDeps({ getToken, onSessionExpired });
    await runAddCardFlow(deps);

    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });

  it("does not call onSessionExpired on a successful flow", async () => {
    const onSessionExpired = jest.fn();
    const deps = baseDeps({ onSessionExpired });
    await runAddCardFlow(deps);

    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  it("does not call onSessionExpired when onSessionExpired is omitted (no crash)", async () => {
    // Regression: omitting the optional callback must not throw.
    const deps = baseDeps({ getToken: jest.fn().mockResolvedValue(null) });
    // `onSessionExpired` is intentionally absent from baseDeps — verify no error.
    await expect(runAddCardFlow(deps)).resolves.toBeUndefined();
  });

  it("does not call onSessionExpired for a non-auth error (Stripe initPaymentSheet)", async () => {
    const onSessionExpired = jest.fn();
    const initPaymentSheet = jest
      .fn()
      .mockResolvedValue({ error: { message: "Card declined" } });
    const deps = baseDeps({ initPaymentSheet, onSessionExpired });
    await runAddCardFlow(deps);

    expect(onSessionExpired).not.toHaveBeenCalled();
  });
});

// ── Timing: error message must survive a same-cycle handleClose reset ─────────
//
// AddCardModal.handleClose() used to call setError("") before onClose().
// If the parent triggers onClose() right after openSheet() resolves with an
// error, the error state would be wiped before React commits the render that
// shows it.  These tests pin the contract that runAddCardFlow always emits the
// error message as the *last* onError call, and that loading is already false
// when the flow resolves — so the component fix is simply to stop calling
// setError("") inside handleClose and reset state on modal open instead.

describe("runAddCardFlow — error is the last onError emission (survives a post-resolve clear)", () => {
  it("checkpoint 1: session-expired message is the last non-empty onError call", async () => {
    const emissions: string[] = [];
    const onError = jest.fn((msg: string) => emissions.push(msg));
    const deps = baseDeps({ getToken: jest.fn().mockResolvedValue(null), onError });

    await runAddCardFlow(deps);

    // Exactly one non-empty emission; it must be the last call overall so a
    // post-resolve setError("") from handleClose would still lose the race.
    const nonEmpty = emissions.filter(Boolean);
    expect(nonEmpty).toHaveLength(1);
    expect(nonEmpty[0]).toBe(
      "Your session has expired. Please sign in again to add a card.",
    );
    expect(emissions[emissions.length - 1]).toBe(
      "Your session has expired. Please sign in again to add a card.",
    );
  });

  it("checkpoint 1: loading is already false when the promise resolves", async () => {
    const loadingStates: boolean[] = [];
    const onLoading = jest.fn((v: boolean) => loadingStates.push(v));
    const deps = baseDeps({
      getToken: jest.fn().mockResolvedValue(null),
      onLoading,
    });

    await runAddCardFlow(deps);

    expect(loadingStates[loadingStates.length - 1]).toBe(false);
  });

  it("checkpoint 2: softer message is the last non-empty onError call", async () => {
    const emissions: string[] = [];
    const onError = jest.fn((msg: string) => emissions.push(msg));
    const getToken = jest
      .fn()
      .mockResolvedValueOnce("tok_valid")
      .mockResolvedValueOnce(null);
    const deps = baseDeps({ getToken, onError });

    await runAddCardFlow(deps);

    const nonEmpty = emissions.filter(Boolean);
    expect(nonEmpty).toHaveLength(1);
    expect(nonEmpty[0]).toBe(
      "Card added, but session expired — please reopen this screen to see your updated payment methods.",
    );
    expect(emissions[emissions.length - 1]).toBe(
      "Card added, but session expired — please reopen this screen to see your updated payment methods.",
    );
  });

  it("checkpoint 2: loading is already false when the promise resolves", async () => {
    const loadingStates: boolean[] = [];
    const onLoading = jest.fn((v: boolean) => loadingStates.push(v));
    const getToken = jest
      .fn()
      .mockResolvedValueOnce("tok_valid")
      .mockResolvedValueOnce(null);
    const deps = baseDeps({ getToken, onLoading });

    await runAddCardFlow(deps);

    expect(loadingStates[loadingStates.length - 1]).toBe(false);
  });

  it("Stripe initPaymentSheet error: message is the last non-empty onError call", async () => {
    const emissions: string[] = [];
    const onError = jest.fn((msg: string) => emissions.push(msg));
    const initPaymentSheet = jest
      .fn()
      .mockResolvedValue({ error: { message: "Configuration error" } });
    const deps = baseDeps({ initPaymentSheet, onError });

    await runAddCardFlow(deps);

    const nonEmpty = emissions.filter(Boolean);
    expect(nonEmpty).toHaveLength(1);
    expect(nonEmpty[0]).toBe("Configuration error");
    expect(emissions[emissions.length - 1]).toBe("Configuration error");
  });

  it("createSetupIntent throws: message is the last non-empty onError call", async () => {
    const emissions: string[] = [];
    const onError = jest.fn((msg: string) => emissions.push(msg));
    const createSetupIntent = jest
      .fn()
      .mockRejectedValue(new Error("Network request failed"));
    const deps = baseDeps({ createSetupIntent, onError });

    await runAddCardFlow(deps);

    const nonEmpty = emissions.filter(Boolean);
    expect(nonEmpty).toHaveLength(1);
    expect(nonEmpty[0]).toBe("Network request failed");
    expect(emissions[emissions.length - 1]).toBe("Network request failed");
  });
});

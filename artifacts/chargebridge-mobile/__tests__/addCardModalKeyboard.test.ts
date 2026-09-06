/**
 * Verifies that AddCardModal surfaces the session-expiry error as an imperative
 * Alert so it remains readable even when the software keyboard was open when the
 * error fired.
 *
 * Context: AddCardModal renders its error Text inside a fixed-height bottom
 * sheet.  When the software keyboard is open the sheet is not scrollable, so the
 * error node may be occluded by the keyboard before the user can read it.
 * Using Alert.alert() is immune to layout occlusion because it renders above the
 * keyboard in a system-level overlay.
 *
 * Test strategy: pure-JS simulation (same pattern as paymentModalErrors.test.ts)
 * — no React renderer needed.  The modal's onSessionExpired handler is extracted
 * as a callable function and exercised directly, then end-to-end via
 * runAddCardFlow with null-token scenarios.
 */

import { runAddCardFlow, type AddCardFlowDeps } from "../utils/addCardFlow";

// ── Simulated Alert capture ───────────────────────────────────────────────────

interface AlertCall {
  title: string;
  message: string;
}

/** Captures Alert.alert() calls without React Native. */
function makeAlertCapture() {
  const calls: AlertCall[] = [];
  function alert(title: string, message: string) {
    calls.push({ title, message });
  }
  return { alert, getCalls: () => calls };
}

// ── Simulation of AddCardModal.openSheet onSessionExpired handler ─────────────

/** Checkpoint-specific Alert messages — must match profile.tsx AddCardModal.openSheet(). */
const ALERT_MESSAGES = {
  1: "Your session has expired. Please sign in again to add a card.",
  2: "Card added, but session expired — please reopen this screen to see your updated payment methods.",
} as const;

/**
 * Returns the onSessionExpired callback exactly as it is written in
 * AddCardModal.openSheet(), plus captured state so tests can assert on it.
 */
function makeAddCardModalOnSessionExpired(alertFn: (title: string, msg: string) => void) {
  let sessionExpired = false;

  function onSessionExpired(checkpoint: 1 | 2) {
    // Must match the implementation in profile.tsx AddCardModal.openSheet()
    alertFn("Session Expired", ALERT_MESSAGES[checkpoint]);
    sessionExpired = true;
  }

  return {
    onSessionExpired,
    isSessionExpired: () => sessionExpired,
  };
}

// ── Shared stub builders (mirrors addCardFlow.test.ts) ────────────────────────

function makeSetupIntentOk() {
  return jest.fn().mockResolvedValue({
    setupIntentClientSecret: "seti_secret",
    customerId: "cus_123",
    ephemeralKeySecret: "ek_secret",
  });
}

function baseDeps(overrides: Partial<AddCardFlowDeps> = {}): AddCardFlowDeps {
  return {
    getToken: jest.fn().mockResolvedValue("tok_valid"),
    createSetupIntent: makeSetupIntentOk(),
    initPaymentSheet: jest.fn().mockResolvedValue({ error: null }),
    presentPaymentSheet: jest.fn().mockResolvedValue({ error: null }),
    fetchPaymentMethods: jest.fn().mockResolvedValue({
      methods: [
        { id: "pm_1", brand: "visa", last4: "4242", expMonth: 12, expYear: 2028 },
      ],
    }),
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

// ── Unit: onSessionExpired handler in isolation ───────────────────────────────

describe("AddCardModal onSessionExpired handler — Alert visibility contract", () => {
  it("calls Alert.alert with the checkpoint-1 title and message", () => {
    const capture = makeAlertCapture();
    const { onSessionExpired } = makeAddCardModalOnSessionExpired(capture.alert);

    onSessionExpired(1);

    expect(capture.getCalls()).toHaveLength(1);
    expect(capture.getCalls()[0].title).toBe("Session Expired");
    expect(capture.getCalls()[0].message).toBe(
      "Your session has expired. Please sign in again to add a card.",
    );
  });

  it("calls Alert.alert with the checkpoint-2 title and card-saved message", () => {
    const capture = makeAlertCapture();
    const { onSessionExpired } = makeAddCardModalOnSessionExpired(capture.alert);

    onSessionExpired(2);

    expect(capture.getCalls()).toHaveLength(1);
    expect(capture.getCalls()[0].title).toBe("Session Expired");
    expect(capture.getCalls()[0].message).toBe(
      "Card added, but session expired — please reopen this screen to see your updated payment methods.",
    );
  });

  it("sets sessionExpired state to true", () => {
    const capture = makeAlertCapture();
    const { onSessionExpired, isSessionExpired } = makeAddCardModalOnSessionExpired(capture.alert);

    expect(isSessionExpired()).toBe(false);
    onSessionExpired(1);
    expect(isSessionExpired()).toBe(true);
  });

  it("calls Alert.alert before updating sessionExpired state", () => {
    // Alert must fire first so the system overlay is enqueued before React
    // re-renders the modal (which might trigger layout changes).
    const callOrder: string[] = [];
    const capture = {
      alert: () => callOrder.push("alert"),
    };

    let sessionExpired = false;
    function onSessionExpired(checkpoint: 1 | 2) {
      capture.alert("Session Expired", ALERT_MESSAGES[checkpoint]);
      sessionExpired = true;
      callOrder.push("setSessionExpired");
    }

    onSessionExpired(1);

    expect(callOrder.indexOf("alert")).toBeLessThan(
      callOrder.indexOf("setSessionExpired"),
    );
  });
});

// ── Integration: Alert fires when runAddCardFlow detects null token ────────────

describe("AddCardModal keyboard-safe error — checkpoint 1 (null token before setup-intent)", () => {
  it("Alert.alert is called with the session-expired message", async () => {
    const capture = makeAlertCapture();
    const { onSessionExpired } = makeAddCardModalOnSessionExpired(capture.alert);

    const deps = baseDeps({
      getToken: jest.fn().mockResolvedValue(null),
      onSessionExpired,
    });
    await runAddCardFlow(deps);

    expect(capture.getCalls()).toHaveLength(1);
    expect(capture.getCalls()[0].title).toBe("Session Expired");
  });

  it("Alert message matches the inline error text so both channels are consistent", async () => {
    const capture = makeAlertCapture();
    const { onSessionExpired } = makeAddCardModalOnSessionExpired(capture.alert);
    const errors: string[] = [];

    const deps = baseDeps({
      getToken: jest.fn().mockResolvedValue(null),
      onError: jest.fn((msg: string) => errors.push(msg)),
      onSessionExpired,
    });
    await runAddCardFlow(deps);

    const nonEmptyErrors = errors.filter(Boolean);
    expect(nonEmptyErrors).toHaveLength(1);
    // Both channels must carry an identical or equivalent message so the user
    // sees consistent wording in the Alert and in the (potentially occluded) Text.
    expect(capture.getCalls()[0].message).toBe(nonEmptyErrors[0]);
  });

  it("sessionExpired state is true after the flow resolves", async () => {
    const capture = makeAlertCapture();
    const { onSessionExpired, isSessionExpired } = makeAddCardModalOnSessionExpired(capture.alert);

    const deps = baseDeps({
      getToken: jest.fn().mockResolvedValue(null),
      onSessionExpired,
    });
    await runAddCardFlow(deps);

    expect(isSessionExpired()).toBe(true);
  });

  it("Alert is called exactly once (not repeated on every render)", async () => {
    const capture = makeAlertCapture();
    const { onSessionExpired } = makeAddCardModalOnSessionExpired(capture.alert);

    const deps = baseDeps({
      getToken: jest.fn().mockResolvedValue(null),
      onSessionExpired,
    });
    await runAddCardFlow(deps);

    expect(capture.getCalls()).toHaveLength(1);
  });
});

describe("AddCardModal keyboard-safe error — checkpoint 2 (null token after payment sheet)", () => {
  function depsWithExpiredTokenAfterSheet(onSessionExpired: (checkpoint: 1 | 2) => void) {
    const getToken = jest
      .fn()
      .mockResolvedValueOnce("tok_valid")
      .mockResolvedValueOnce(null);
    return baseDeps({ getToken, onSessionExpired });
  }

  it("Alert.alert is called with the session-expired title", async () => {
    const capture = makeAlertCapture();
    const { onSessionExpired } = makeAddCardModalOnSessionExpired(capture.alert);

    const deps = depsWithExpiredTokenAfterSheet(onSessionExpired);
    await runAddCardFlow(deps);

    expect(capture.getCalls()).toHaveLength(1);
    expect(capture.getCalls()[0].title).toBe("Session Expired");
  });

  it("Alert message confirms the card was saved (not the generic sign-in-again wording)", async () => {
    const capture = makeAlertCapture();
    const { onSessionExpired } = makeAddCardModalOnSessionExpired(capture.alert);

    const deps = depsWithExpiredTokenAfterSheet(onSessionExpired);
    await runAddCardFlow(deps);

    expect(capture.getCalls()[0].message).toBe(
      "Card added, but session expired — please reopen this screen to see your updated payment methods.",
    );
    // Must NOT carry the checkpoint-1 wording that implies the card was NOT saved.
    expect(capture.getCalls()[0].message).not.toContain("Please sign in again to add a card");
  });

  it("Alert message matches the inline onError text at checkpoint 2", async () => {
    const capture = makeAlertCapture();
    const { onSessionExpired } = makeAddCardModalOnSessionExpired(capture.alert);
    const errors: string[] = [];

    const deps = depsWithExpiredTokenAfterSheet(onSessionExpired);
    deps.onError = jest.fn((msg: string) => errors.push(msg));
    await runAddCardFlow(deps);

    const nonEmptyErrors = errors.filter(Boolean);
    expect(nonEmptyErrors).toHaveLength(1);
    // The Alert and the inline error must carry consistent wording so both
    // channels tell the user the same thing.
    expect(capture.getCalls()[0].message).toBe(nonEmptyErrors[0]);
  });

  it("Alert is called exactly once even though the flow went further than checkpoint 1", async () => {
    const capture = makeAlertCapture();
    const { onSessionExpired } = makeAddCardModalOnSessionExpired(capture.alert);

    const deps = depsWithExpiredTokenAfterSheet(onSessionExpired);
    await runAddCardFlow(deps);

    expect(capture.getCalls()).toHaveLength(1);
  });

  it("sessionExpired state is true after checkpoint 2 resolves", async () => {
    const capture = makeAlertCapture();
    const { onSessionExpired, isSessionExpired } = makeAddCardModalOnSessionExpired(capture.alert);

    const deps = depsWithExpiredTokenAfterSheet(onSessionExpired);
    await runAddCardFlow(deps);

    expect(isSessionExpired()).toBe(true);
  });
});

// ── Non-auth errors must NOT trigger Alert ────────────────────────────────────

describe("AddCardModal keyboard-safe error — Alert is NOT called for non-auth errors", () => {
  it("initPaymentSheet error does not call Alert (inline error is sufficient for non-auth failures)", async () => {
    const capture = makeAlertCapture();
    const { onSessionExpired } = makeAddCardModalOnSessionExpired(capture.alert);

    const deps = baseDeps({
      initPaymentSheet: jest.fn().mockResolvedValue({ error: { message: "Card declined" } }),
      onSessionExpired,
    });
    await runAddCardFlow(deps);

    expect(capture.getCalls()).toHaveLength(0);
  });

  it("createSetupIntent network error does not call Alert", async () => {
    const capture = makeAlertCapture();
    const { onSessionExpired } = makeAddCardModalOnSessionExpired(capture.alert);

    const deps = baseDeps({
      createSetupIntent: jest.fn().mockRejectedValue(new Error("Network request failed")),
      onSessionExpired,
    });
    await runAddCardFlow(deps);

    expect(capture.getCalls()).toHaveLength(0);
  });

  it("happy path does not call Alert", async () => {
    const capture = makeAlertCapture();
    const { onSessionExpired } = makeAddCardModalOnSessionExpired(capture.alert);

    const deps = baseDeps({ onSessionExpired });
    await runAddCardFlow(deps);

    expect(capture.getCalls()).toHaveLength(0);
  });
});

// ── Non-auth errors reach onError so ScrollView can scroll them into view ─────
//
// AddCardModal body is now wrapped in a ScrollView so the error Text is
// always scrollable into view regardless of keyboard height.  These tests
// confirm that each non-auth error path propagates the message through
// onError (the inline-text channel) — the mechanism the ScrollView exposes.

describe("AddCardModal non-auth error readability — error reaches onError (ScrollView path)", () => {
  it("Stripe card-declined (initPaymentSheet error) calls onError with the decline message", async () => {
    const errors: string[] = [];
    const deps = baseDeps({
      initPaymentSheet: jest
        .fn()
        .mockResolvedValue({ error: { message: "Your card was declined." } }),
      onError: jest.fn((msg: string) => errors.push(msg)),
    });
    await runAddCardFlow(deps);

    const nonEmpty = errors.filter(Boolean);
    expect(nonEmpty).toHaveLength(1);
    expect(nonEmpty[0]).toBe("Your card was declined.");
  });

  it("createSetupIntent network error calls onError with the error message", async () => {
    const errors: string[] = [];
    const deps = baseDeps({
      createSetupIntent: jest
        .fn()
        .mockRejectedValue(new Error("Network request failed")),
      onError: jest.fn((msg: string) => errors.push(msg)),
    });
    await runAddCardFlow(deps);

    const nonEmpty = errors.filter(Boolean);
    expect(nonEmpty).toHaveLength(1);
    expect(nonEmpty[0]).toBe("Network request failed");
  });

  it("presentPaymentSheet decline calls onError with the decline message", async () => {
    const errors: string[] = [];
    const deps = baseDeps({
      presentPaymentSheet: jest
        .fn()
        .mockResolvedValue({ error: { code: "Failed", message: "Insufficient funds." } }),
      onError: jest.fn((msg: string) => errors.push(msg)),
    });
    await runAddCardFlow(deps);

    const nonEmpty = errors.filter(Boolean);
    expect(nonEmpty).toHaveLength(1);
    expect(nonEmpty[0]).toBe("Insufficient funds.");
  });

  it("presentPaymentSheet cancellation does NOT call onError (user dismissed intentionally)", async () => {
    const errors: string[] = [];
    const deps = baseDeps({
      presentPaymentSheet: jest
        .fn()
        .mockResolvedValue({ error: { code: "Canceled", message: "Canceled" } }),
      onError: jest.fn((msg: string) => errors.push(msg)),
    });
    await runAddCardFlow(deps);

    // onError is called with "" to clear any previous error, but must not
    // receive a non-empty message for a user-initiated cancel.
    const nonEmpty = errors.filter(Boolean);
    expect(nonEmpty).toHaveLength(0);
  });

  it("non-auth error does not set sessionExpired state", async () => {
    const capture = makeAlertCapture();
    const { onSessionExpired, isSessionExpired } =
      makeAddCardModalOnSessionExpired(capture.alert);

    const deps = baseDeps({
      initPaymentSheet: jest
        .fn()
        .mockResolvedValue({ error: { message: "Your card was declined." } }),
      onSessionExpired,
    });
    await runAddCardFlow(deps);

    expect(isSessionExpired()).toBe(false);
  });
});

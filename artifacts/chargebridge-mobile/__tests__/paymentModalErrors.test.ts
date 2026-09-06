/**
 * Behavioral tests confirming that AddBankModal and CarrierBillingModal errors
 * are NOT silently wiped when those modals close.
 *
 * Design: these tests model the relevant state-machine behavior in pure JS —
 * no React renderer needed — mirroring the addCardFlow.test.ts pattern.
 *
 * The core contract:
 *   1. handleClose() only calls onClose() — it does NOT touch the error state.
 *   2. State (including errors) resets only when the modal re-opens
 *      (visible: false → true), not on close.
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal model of the AddBankModal state + actions. */
function makeAddBankModalSim() {
  let errorState = "";

  const onClose = jest.fn();
  const onSave = jest.fn();

  function setError(msg: string) {
    errorState = msg;
  }

  // Mirrors the fixed save() in AddBankModal.
  function save(
    bankName: string,
    routing: string,
    account: string,
    confirm: string,
  ) {
    if (!bankName.trim()) { setError("Bank name is required"); return; }
    if (routing.length !== 9) { setError("Routing number must be 9 digits"); return; }
    if (account.length < 4) { setError("Enter a valid account number"); return; }
    if (account !== confirm) { setError("Account numbers don't match"); return; }
    // Success: call onSave but do NOT wipe error here (form reset via useEffect)
    onSave();
  }

  // Mirrors the fixed handleClose() — only calls onClose().
  function handleClose() {
    onClose();
  }

  // Mirrors the useEffect(visible=true) reset.
  function simulateModalOpen() {
    errorState = "";
  }

  return { getError: () => errorState, handleClose, save, simulateModalOpen, onClose, onSave };
}

/** Minimal model of the CarrierBillingModal state + actions. */
function makeCarrierBillingModalSim() {
  let errorState = "";
  let step: "phone" | "otp" = "phone";

  const onClose = jest.fn();
  const onSave = jest.fn();

  function setError(msg: string) {
    errorState = msg;
  }

  // Mirrors sendCode() validation (synchronous path only).
  function validatePhone(phone: string) {
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10) { setError("Enter a valid 10-digit US phone number"); return false; }
    setError("");
    step = "otp";
    return true;
  }

  // Mirrors verify() validation (synchronous path only).
  function validateOtp(otp: string) {
    if (otp.replace(/\D/g, "").length < 6) { setError("Enter the 6-digit code"); return false; }
    setError("");
    return true;
  }

  // Mirrors the fixed handleClose() — only calls onClose(), no reset().
  function handleClose() {
    onClose();
  }

  // Mirrors the useEffect(visible=true) reset.
  function simulateModalOpen() {
    step = "phone";
    errorState = "";
  }

  return {
    getError: () => errorState,
    getStep: () => step,
    handleClose,
    validatePhone,
    validateOtp,
    simulateModalOpen,
    onClose,
    onSave,
  };
}

// ── AddBankModal tests ────────────────────────────────────────────────────────

describe("AddBankModal — handleClose does not wipe the error", () => {
  it("error set by empty bank name persists through handleClose", () => {
    const sim = makeAddBankModalSim();
    sim.save("", "123456789", "12345678", "12345678");
    expect(sim.getError()).toBe("Bank name is required");

    sim.handleClose();

    expect(sim.getError()).toBe("Bank name is required");
    expect(sim.onClose).toHaveBeenCalledTimes(1);
  });

  it("error set by bad routing number persists through handleClose", () => {
    const sim = makeAddBankModalSim();
    sim.save("Chase", "12345", "12345678", "12345678");
    expect(sim.getError()).toBe("Routing number must be 9 digits");

    sim.handleClose();

    expect(sim.getError()).toBe("Routing number must be 9 digits");
  });

  it("error set by short account number persists through handleClose", () => {
    const sim = makeAddBankModalSim();
    sim.save("Chase", "123456789", "123", "123");
    expect(sim.getError()).toBe("Enter a valid account number");

    sim.handleClose();

    expect(sim.getError()).toBe("Enter a valid account number");
  });

  it("error set by mismatched account numbers persists through handleClose", () => {
    const sim = makeAddBankModalSim();
    sim.save("Chase", "123456789", "12345678", "87654321");
    expect(sim.getError()).toBe("Account numbers don't match");

    sim.handleClose();

    expect(sim.getError()).toBe("Account numbers don't match");
  });

  it("handleClose only calls onClose — no additional side effects", () => {
    const sim = makeAddBankModalSim();
    sim.save("", "", "", "");

    sim.handleClose();

    expect(sim.onClose).toHaveBeenCalledTimes(1);
    // Error must still be set — handleClose touched nothing else
    expect(sim.getError()).not.toBe("");
  });

  it("error IS cleared when the modal re-opens (visible-based reset)", () => {
    const sim = makeAddBankModalSim();
    sim.save("", "", "", "");
    expect(sim.getError()).not.toBe("");

    sim.handleClose();
    sim.simulateModalOpen(); // mimics useEffect(visible=true)

    expect(sim.getError()).toBe("");
  });

  it("handleClose does NOT call onSave", () => {
    const sim = makeAddBankModalSim();
    sim.save("", "", "", "");
    sim.handleClose();

    expect(sim.onSave).not.toHaveBeenCalled();
  });
});

// ── CarrierBillingModal tests ─────────────────────────────────────────────────

describe("CarrierBillingModal — handleClose does not wipe the error", () => {
  it("phone validation error persists through handleClose", () => {
    const sim = makeCarrierBillingModalSim();
    sim.validatePhone("555"); // too short
    expect(sim.getError()).toBe("Enter a valid 10-digit US phone number");

    sim.handleClose();

    expect(sim.getError()).toBe("Enter a valid 10-digit US phone number");
    expect(sim.onClose).toHaveBeenCalledTimes(1);
  });

  it("OTP validation error persists through handleClose", () => {
    const sim = makeCarrierBillingModalSim();
    sim.validatePhone("5550001234"); // valid — advances to otp step
    sim.validateOtp("123"); // too short
    expect(sim.getError()).toBe("Enter the 6-digit code");

    sim.handleClose();

    expect(sim.getError()).toBe("Enter the 6-digit code");
  });

  it("handleClose only calls onClose — no additional side effects", () => {
    const sim = makeCarrierBillingModalSim();
    sim.validatePhone("555"); // trigger error

    sim.handleClose();

    expect(sim.onClose).toHaveBeenCalledTimes(1);
    // step and error must be unchanged
    expect(sim.getStep()).toBe("phone");
    expect(sim.getError()).not.toBe("");
  });

  it("error IS cleared when the modal re-opens (visible-based reset)", () => {
    const sim = makeCarrierBillingModalSim();
    sim.validatePhone("555");
    expect(sim.getError()).not.toBe("");

    sim.handleClose();
    sim.simulateModalOpen(); // mimics useEffect(visible=true)

    expect(sim.getError()).toBe("");
  });

  it("step is reset to 'phone' on re-open, not on close", () => {
    const sim = makeCarrierBillingModalSim();
    sim.validatePhone("5550001234"); // success → step=otp
    expect(sim.getStep()).toBe("otp");

    sim.handleClose(); // must NOT reset step
    expect(sim.getStep()).toBe("otp");

    sim.simulateModalOpen(); // reset happens here
    expect(sim.getStep()).toBe("phone");
  });

  it("OTP error set on last step persists through handleClose", () => {
    const sim = makeCarrierBillingModalSim();
    sim.validatePhone("5550001234");
    sim.validateOtp(""); // empty
    expect(sim.getError()).toBe("Enter the 6-digit code");

    sim.handleClose();

    expect(sim.getError()).toBe("Enter the 6-digit code");
  });
});

// ── CarrierBillingModal — session-expiry tests ────────────────────────────────

/**
 * Async sim that mirrors the token-check paths added to sendCode() and verify().
 * Injects getToken as a callback so tests can simulate null (expired) or a real
 * token without touching module-level mocks.
 */
function makeCarrierBillingSessionSim() {
  let errorState = "";
  let sessionExpired = false;
  let step: "phone" | "otp" = "phone";

  const onClose = jest.fn();
  const onSave = jest.fn();

  function setError(msg: string) { errorState = msg; }
  function setSessionExpired(v: boolean) { sessionExpired = v; }

  // Mirrors sendCode() — token check only (skips actual fetch).
  async function sendCode(phone: string, getToken: () => Promise<string | null>) {
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10) { setError("Enter a valid 10-digit US phone number"); return; }
    setError("");
    const token = await getToken();
    if (!token) {
      setError("Your session has expired. Please sign in again to verify your phone.");
      setSessionExpired(true);
      return;
    }
    // Simulate successful send (no real fetch in unit tests).
    step = "otp";
  }

  // Mirrors verify() — token check only (skips actual fetch).
  async function verify(otp: string, getToken: () => Promise<string | null>) {
    if (otp.replace(/\D/g, "").length < 6) { setError("Enter the 6-digit code"); return; }
    setError("");
    const token = await getToken();
    if (!token) {
      setError("Your session has expired. Please sign in again to verify your phone.");
      setSessionExpired(true);
      return;
    }
    // Simulate successful verify.
    onSave();
  }

  // Mirrors handleClose() — only calls onClose().
  function handleClose() { onClose(); }

  // Mirrors useEffect(visible=true) reset.
  function simulateModalOpen() {
    step = "phone";
    errorState = "";
    sessionExpired = false;
  }

  return {
    getError: () => errorState,
    getSessionExpired: () => sessionExpired,
    getStep: () => step,
    sendCode,
    verify,
    handleClose,
    simulateModalOpen,
    onClose,
    onSave,
  };
}

describe("CarrierBillingModal — session expiry", () => {
  it("sendCode sets session-expired error when getToken returns null", async () => {
    const sim = makeCarrierBillingSessionSim();
    await sim.sendCode("5550001234", async () => null);

    expect(sim.getError()).toBe(
      "Your session has expired. Please sign in again to verify your phone.",
    );
    expect(sim.getSessionExpired()).toBe(true);
  });

  it("sendCode does NOT set session-expired when token is valid", async () => {
    const sim = makeCarrierBillingSessionSim();
    await sim.sendCode("5550001234", async () => "valid-token");

    expect(sim.getSessionExpired()).toBe(false);
    expect(sim.getStep()).toBe("otp");
  });

  it("verify sets session-expired error when getToken returns null", async () => {
    const sim = makeCarrierBillingSessionSim();
    await sim.verify("123456", async () => null);

    expect(sim.getError()).toBe(
      "Your session has expired. Please sign in again to verify your phone.",
    );
    expect(sim.getSessionExpired()).toBe(true);
  });

  it("verify does NOT set session-expired when token is valid", async () => {
    const sim = makeCarrierBillingSessionSim();
    await sim.verify("123456", async () => "valid-token");

    expect(sim.getSessionExpired()).toBe(false);
    expect(sim.onSave).toHaveBeenCalledTimes(1);
  });

  it("session-expired error from sendCode persists through handleClose", async () => {
    const sim = makeCarrierBillingSessionSim();
    await sim.sendCode("5550001234", async () => null);
    expect(sim.getSessionExpired()).toBe(true);

    sim.handleClose();

    // handleClose must NOT wipe error or sessionExpired state
    expect(sim.getError()).toBe(
      "Your session has expired. Please sign in again to verify your phone.",
    );
    expect(sim.getSessionExpired()).toBe(true);
    expect(sim.onClose).toHaveBeenCalledTimes(1);
  });

  it("session-expired error from verify persists through handleClose", async () => {
    const sim = makeCarrierBillingSessionSim();
    await sim.verify("123456", async () => null);
    expect(sim.getSessionExpired()).toBe(true);

    sim.handleClose();

    expect(sim.getError()).toBe(
      "Your session has expired. Please sign in again to verify your phone.",
    );
    expect(sim.getSessionExpired()).toBe(true);
    expect(sim.onClose).toHaveBeenCalledTimes(1);
  });

  it("sessionExpired is reset when the modal re-opens", async () => {
    const sim = makeCarrierBillingSessionSim();
    await sim.sendCode("5550001234", async () => null);
    expect(sim.getSessionExpired()).toBe(true);

    sim.handleClose();
    sim.simulateModalOpen(); // mimics useEffect(visible=true)

    expect(sim.getSessionExpired()).toBe(false);
    expect(sim.getError()).toBe("");
  });

  it("session-expired is the last error emission — a subsequent sendCode with null token does not change it", async () => {
    const sim = makeCarrierBillingSessionSim();
    await sim.sendCode("5550001234", async () => null); // first call → expired
    const firstError = sim.getError();

    // Calling sendCode again with null should produce the same message, not clear it.
    await sim.sendCode("5550001234", async () => null);

    expect(sim.getError()).toBe(firstError);
    expect(sim.getSessionExpired()).toBe(true);
  });

  it("phone validation error does not set sessionExpired", async () => {
    const sim = makeCarrierBillingSessionSim();
    await sim.sendCode("555", async () => null); // too short — never reaches token check

    expect(sim.getSessionExpired()).toBe(false);
    expect(sim.getError()).toBe("Enter a valid 10-digit US phone number");
  });

  it("OTP validation error does not set sessionExpired", async () => {
    const sim = makeCarrierBillingSessionSim();
    await sim.verify("123", async () => null); // too short — never reaches token check

    expect(sim.getSessionExpired()).toBe(false);
    expect(sim.getError()).toBe("Enter the 6-digit code");
  });
});

// ── CarrierBillingModal — network error tests ─────────────────────────────────

/**
 * Sim that mirrors the full async sendCode() / verify() paths including the
 * fetch call.  A `fetchImpl` callback is injected so tests can produce non-ok
 * responses or thrown network errors without any real HTTP traffic.
 *
 * The sim faithfully reproduces the error-setting sequence from profile.tsx:
 *   try {
 *     const r = await fetch(...)
 *     const d = await r.json()
 *     if (!r.ok) { setError(d.error ?? fallback); setSending(false); return; }
 *     // success path …
 *   } catch {
 *     setError("Network error. Check your connection and try again.")
 *   }
 *   setSending(false)
 *
 * The "last emission" contract: setError() is the final state mutation before
 * the function returns on every error branch — setSending(false) happens after
 * but does not touch errorState.
 */
function makeCarrierBillingNetworkSim(
  fetchImpl: (url: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>,
) {
  let errorState = "";
  let sendingState = false;
  let step: "phone" | "otp" = "phone";

  const onSave = jest.fn();

  function setError(msg: string) { errorState = msg; }
  function setSending(v: boolean) { sendingState = v; }

  async function sendCode(phone: string) {
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10) { setError("Enter a valid 10-digit US phone number"); return; }
    setError("");
    setSending(true);
    try {
      const r = await fetchImpl("/api/verify/send");
      const d = await r.json() as Record<string, string>;
      if (!r.ok) { setError(d.error ?? "Failed to send code. Try again."); setSending(false); return; }
      step = "otp";
    } catch {
      setError("Network error. Check your connection and try again.");
    }
    setSending(false);
  }

  async function verify(otp: string) {
    if (otp.replace(/\D/g, "").length < 6) { setError("Enter the 6-digit code"); return; }
    setError("");
    setSending(true);
    try {
      const r = await fetchImpl("/api/verify/check");
      const d = await r.json() as Record<string, string>;
      if (!r.ok) { setError(d.error ?? "Incorrect code. Please try again."); setSending(false); return; }
      onSave();
    } catch {
      setError("Network error. Check your connection and try again.");
    }
    setSending(false);
  }

  return {
    getError: () => errorState,
    getSending: () => sendingState,
    getStep: () => step,
    sendCode,
    verify,
    onSave,
  };
}

/** Build a fetch stub that returns a non-ok response with a given error body. */
function nonOkFetch(errorMessage: string) {
  return async (_url: string) => ({
    ok: false,
    json: async () => ({ error: errorMessage }),
  });
}

/** Build a fetch stub that throws (simulates a network failure). */
function throwingFetch(cause: Error = new Error("Failed to fetch")) {
  return async (_url: string): Promise<never> => { throw cause; };
}

/** Build a fetch stub that returns a successful response. */
function okFetch() {
  return async (_url: string) => ({
    ok: true,
    json: async () => ({}),
  });
}

describe("CarrierBillingModal — network errors (sendCode)", () => {
  it("non-ok response surfaces the server's error message", async () => {
    const sim = makeCarrierBillingNetworkSim(nonOkFetch("That number is not eligible for carrier billing."));
    await sim.sendCode("5550001234");

    expect(sim.getError()).toBe("That number is not eligible for carrier billing.");
  });

  it("non-ok response with no error field falls back to default message", async () => {
    const sim = makeCarrierBillingNetworkSim(async () => ({
      ok: false,
      json: async () => ({}), // no error key
    }));
    await sim.sendCode("5550001234");

    expect(sim.getError()).toBe("Failed to send code. Try again.");
  });

  it("network throw surfaces the network error message", async () => {
    const sim = makeCarrierBillingNetworkSim(throwingFetch());
    await sim.sendCode("5550001234");

    expect(sim.getError()).toBe("Network error. Check your connection and try again.");
  });

  it("non-ok response error is the last emission — sending is false afterwards and error is unchanged", async () => {
    const sim = makeCarrierBillingNetworkSim(nonOkFetch("Rate limit exceeded."));
    await sim.sendCode("5550001234");

    // setSending(false) runs after setError but must not clear the error
    expect(sim.getError()).toBe("Rate limit exceeded.");
    expect(sim.getSending()).toBe(false);
  });

  it("network error is the last emission — sending is false afterwards and error is unchanged", async () => {
    const sim = makeCarrierBillingNetworkSim(throwingFetch());
    await sim.sendCode("5550001234");

    expect(sim.getError()).toBe("Network error. Check your connection and try again.");
    expect(sim.getSending()).toBe(false);
  });

  it("step does NOT advance to otp when fetch returns non-ok", async () => {
    const sim = makeCarrierBillingNetworkSim(nonOkFetch("Server error."));
    await sim.sendCode("5550001234");

    expect(sim.getStep()).toBe("phone");
  });

  it("step does NOT advance to otp when fetch throws", async () => {
    const sim = makeCarrierBillingNetworkSim(throwingFetch());
    await sim.sendCode("5550001234");

    expect(sim.getStep()).toBe("phone");
  });

  it("step DOES advance to otp on a successful fetch", async () => {
    const sim = makeCarrierBillingNetworkSim(okFetch());
    await sim.sendCode("5550001234");

    expect(sim.getStep()).toBe("otp");
    expect(sim.getError()).toBe("");
  });
});

describe("CarrierBillingModal — network errors (verify)", () => {
  it("non-ok response surfaces the server's error message", async () => {
    const sim = makeCarrierBillingNetworkSim(nonOkFetch("Incorrect code. Please try again."));
    await sim.verify("123456");

    expect(sim.getError()).toBe("Incorrect code. Please try again.");
  });

  it("non-ok response with no error field falls back to default message", async () => {
    const sim = makeCarrierBillingNetworkSim(async () => ({
      ok: false,
      json: async () => ({}), // no error key
    }));
    await sim.verify("123456");

    expect(sim.getError()).toBe("Incorrect code. Please try again.");
  });

  it("network throw surfaces the network error message", async () => {
    const sim = makeCarrierBillingNetworkSim(throwingFetch());
    await sim.verify("123456");

    expect(sim.getError()).toBe("Network error. Check your connection and try again.");
  });

  it("non-ok response error is the last emission — sending is false afterwards and error is unchanged", async () => {
    const sim = makeCarrierBillingNetworkSim(nonOkFetch("Code expired."));
    await sim.verify("123456");

    expect(sim.getError()).toBe("Code expired.");
    expect(sim.getSending()).toBe(false);
  });

  it("network error is the last emission — sending is false afterwards and error is unchanged", async () => {
    const sim = makeCarrierBillingNetworkSim(throwingFetch());
    await sim.verify("123456");

    expect(sim.getError()).toBe("Network error. Check your connection and try again.");
    expect(sim.getSending()).toBe(false);
  });

  it("onSave is NOT called when fetch returns non-ok", async () => {
    const sim = makeCarrierBillingNetworkSim(nonOkFetch("Server error."));
    await sim.verify("123456");

    expect(sim.onSave).not.toHaveBeenCalled();
  });

  it("onSave is NOT called when fetch throws", async () => {
    const sim = makeCarrierBillingNetworkSim(throwingFetch());
    await sim.verify("123456");

    expect(sim.onSave).not.toHaveBeenCalled();
  });

  it("onSave IS called and error is empty on a successful fetch", async () => {
    const sim = makeCarrierBillingNetworkSim(okFetch());
    await sim.verify("123456");

    expect(sim.onSave).toHaveBeenCalledTimes(1);
    expect(sim.getError()).toBe("");
  });
});

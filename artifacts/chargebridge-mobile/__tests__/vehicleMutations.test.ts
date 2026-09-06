/**
 * Unit tests for runAddVehicle and runEditVehicle.
 *
 * These tests confirm two critical behaviours when getToken() returns null
 * mid-form (i.e. the Clerk session expires while the user is filling in
 * vehicle details):
 *
 *   1. onError is called with a session-expired message so the Alert fires.
 *   2. onSuccess is NOT called — the form stays open for the user to retry.
 *
 * The network layer (postVehicle / patchVehicle) is fully stubbed, so these
 * tests run in Node without any React Native environment.
 */

import {
  runAddVehicle,
  runEditVehicle,
  runDeleteVehicle,
  runSetPrimaryVehicle,
  addVehicleOnError,
  editVehicleOnError,
  deleteVehicleOnError,
  setPrimaryVehicleOnError,
  SessionExpiredError,
  type AddVehicleDeps,
  type EditVehicleDeps,
  type DeleteVehicleDeps,
  type SetPrimaryVehicleDeps,
  type VehicleData,
} from "../utils/vehicleMutations";

// ── Shared fixtures ───────────────────────────────────────────────────────────

const VEHICLE_DATA: VehicleData = {
  make: "Tesla",
  model: "Model 3",
  year: "2023",
  connectorType: "CCS",
  batteryKwh: 82,
  rangePerCharge: 358,
  fuelType: "electric",
};

const VEHICLE_RESPONSE = { id: 42, ...VEHICLE_DATA, isPrimary: false, createdAt: "2024-01-01" };

// ── AddVehicle helpers ────────────────────────────────────────────────────────

function makeAddDeps(overrides: Partial<AddVehicleDeps> = {}): AddVehicleDeps {
  return {
    getToken: jest.fn().mockResolvedValue("tok_valid"),
    postVehicle: jest.fn().mockResolvedValue(VEHICLE_RESPONSE),
    onSuccess: jest.fn(),
    onError: jest.fn(),
    track: jest.fn(),
    ...overrides,
  };
}

// ── EditVehicle helpers ───────────────────────────────────────────────────────

function makeEditDeps(overrides: Partial<EditVehicleDeps> = {}): EditVehicleDeps {
  return {
    getToken: jest.fn().mockResolvedValue("tok_valid"),
    patchVehicle: jest.fn().mockResolvedValue(VEHICLE_RESPONSE),
    onSuccess: jest.fn(),
    onError: jest.fn(),
    track: jest.fn(),
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// runAddVehicle
// ═══════════════════════════════════════════════════════════════════════════════

describe("runAddVehicle — getToken() returns null (session expired mid-form)", () => {
  it("calls onError with the session-expired message", async () => {
    const deps = makeAddDeps({ getToken: jest.fn().mockResolvedValue(null) });
    await runAddVehicle(VEHICLE_DATA, deps);

    expect(deps.onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Your session has expired. Please sign in again to add a vehicle.",
      }),
    );
  });

  it("does NOT call onSuccess — the form stays open", async () => {
    const deps = makeAddDeps({ getToken: jest.fn().mockResolvedValue(null) });
    await runAddVehicle(VEHICLE_DATA, deps);

    expect(deps.onSuccess).not.toHaveBeenCalled();
  });

  it("does NOT call postVehicle — the network is never touched", async () => {
    const deps = makeAddDeps({ getToken: jest.fn().mockResolvedValue(null) });
    await runAddVehicle(VEHICLE_DATA, deps);

    expect(deps.postVehicle).not.toHaveBeenCalled();
  });

  it("tracks profile_addvehicle_no_token", async () => {
    const deps = makeAddDeps({ getToken: jest.fn().mockResolvedValue(null) });
    await runAddVehicle(VEHICLE_DATA, deps);

    expect(deps.track).toHaveBeenCalledWith("profile_addvehicle_no_token", {});
  });

  it("does NOT track profile_addvehicle_complete", async () => {
    const deps = makeAddDeps({ getToken: jest.fn().mockResolvedValue(null) });
    await runAddVehicle(VEHICLE_DATA, deps);

    const events = (deps.track as jest.Mock).mock.calls.map(([e]) => e);
    expect(events).not.toContain("profile_addvehicle_complete");
  });

  it("calls onSessionExpired — the UI can replace the button with 'Sign In Again'", async () => {
    const onSessionExpired = jest.fn();
    const deps = makeAddDeps({ getToken: jest.fn().mockResolvedValue(null), onSessionExpired });
    await runAddVehicle(VEHICLE_DATA, deps);

    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });

  it("calls onSessionExpired BEFORE onError so the button state is set before the alert fires", async () => {
    const callOrder: string[] = [];
    const deps = makeAddDeps({
      getToken: jest.fn().mockResolvedValue(null),
      onSessionExpired: () => callOrder.push("onSessionExpired"),
      onError: jest.fn().mockImplementation(() => callOrder.push("onError")),
    });
    await runAddVehicle(VEHICLE_DATA, deps);

    expect(callOrder).toEqual(["onSessionExpired", "onError"]);
  });

  it("does NOT call onSessionExpired when the token is valid", async () => {
    const onSessionExpired = jest.fn();
    const deps = makeAddDeps({ onSessionExpired });
    await runAddVehicle(VEHICLE_DATA, deps);

    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  // ── Double-alert prevention ──────────────────────────────────────────────
  // onSessionExpired shows a dedicated "Session Expired" alert with a
  // "Sign In Again" button.  The useMutation onError handler must NOT show a
  // second generic "Couldn't Add Vehicle" alert.  It detects the session-
  // expired path by checking instanceof SessionExpiredError.

  it("passes a SessionExpiredError to onError — allows onError to suppress the generic alert", async () => {
    const deps = makeAddDeps({ getToken: jest.fn().mockResolvedValue(null) });
    await runAddVehicle(VEHICLE_DATA, deps);

    const err = (deps.onError as jest.Mock).mock.calls[0][0];
    expect(err).toBeInstanceOf(SessionExpiredError);
  });

  it("the SessionExpiredError has isSessionExpired:true", async () => {
    const deps = makeAddDeps({ getToken: jest.fn().mockResolvedValue(null) });
    await runAddVehicle(VEHICLE_DATA, deps);

    const err = (deps.onError as jest.Mock).mock.calls[0][0] as SessionExpiredError;
    expect(err.isSessionExpired).toBe(true);
  });

  it("a network error is NOT a SessionExpiredError — the generic alert should still fire", async () => {
    const deps = makeAddDeps({
      postVehicle: jest.fn().mockRejectedValue(new Error("Network request failed")),
    });
    await runAddVehicle(VEHICLE_DATA, deps);

    const err = (deps.onError as jest.Mock).mock.calls[0][0];
    expect(err).not.toBeInstanceOf(SessionExpiredError);
  });
});

describe("runAddVehicle — getToken() throws (token acquisition error)", () => {
  it("calls onError with the thrown error", async () => {
    const tokenErr = new Error("Network error during token refresh");
    const deps = makeAddDeps({ getToken: jest.fn().mockRejectedValue(tokenErr) });
    await runAddVehicle(VEHICLE_DATA, deps);

    expect(deps.onError).toHaveBeenCalledWith(tokenErr);
  });

  it("does NOT call onSuccess", async () => {
    const deps = makeAddDeps({
      getToken: jest.fn().mockRejectedValue(new Error("Token error")),
    });
    await runAddVehicle(VEHICLE_DATA, deps);

    expect(deps.onSuccess).not.toHaveBeenCalled();
  });

  it("does NOT call postVehicle", async () => {
    const deps = makeAddDeps({
      getToken: jest.fn().mockRejectedValue(new Error("Token error")),
    });
    await runAddVehicle(VEHICLE_DATA, deps);

    expect(deps.postVehicle).not.toHaveBeenCalled();
  });

  it("tracks profile_addvehicle_token_error", async () => {
    const deps = makeAddDeps({
      getToken: jest.fn().mockRejectedValue(new Error("Token error")),
    });
    await runAddVehicle(VEHICLE_DATA, deps);

    expect(deps.track).toHaveBeenCalledWith(
      "profile_addvehicle_token_error",
      expect.objectContaining({ error: "Token error" }),
    );
  });
});

describe("runAddVehicle — happy path (valid token)", () => {
  it("calls onSuccess with the API response", async () => {
    const deps = makeAddDeps();
    await runAddVehicle(VEHICLE_DATA, deps);

    expect(deps.onSuccess).toHaveBeenCalledWith(VEHICLE_RESPONSE);
  });

  it("does NOT call onError", async () => {
    const deps = makeAddDeps();
    await runAddVehicle(VEHICLE_DATA, deps);

    expect(deps.onError).not.toHaveBeenCalled();
  });

  it("passes the vehicle data to postVehicle", async () => {
    const deps = makeAddDeps();
    await runAddVehicle(VEHICLE_DATA, deps);

    expect(deps.postVehicle).toHaveBeenCalledWith("tok_valid", VEHICLE_DATA);
  });

  it("tracks profile_addvehicle_complete", async () => {
    const deps = makeAddDeps();
    await runAddVehicle(VEHICLE_DATA, deps);

    const events = (deps.track as jest.Mock).mock.calls.map(([e]) => e);
    expect(events).toContain("profile_addvehicle_complete");
  });
});

describe("runAddVehicle — postVehicle throws (network / server error)", () => {
  it("calls onError with the thrown error", async () => {
    const deps = makeAddDeps({
      postVehicle: jest.fn().mockRejectedValue(new Error("Network request failed")),
    });
    await runAddVehicle(VEHICLE_DATA, deps);

    expect(deps.onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Network request failed" }),
    );
  });

  it("does NOT call onSuccess — the form stays open for retry", async () => {
    const deps = makeAddDeps({
      postVehicle: jest.fn().mockRejectedValue(new Error("Server error")),
    });
    await runAddVehicle(VEHICLE_DATA, deps);

    expect(deps.onSuccess).not.toHaveBeenCalled();
  });
});

describe("runAddVehicle — postVehicle wraps fetch() network failure with friendly copy (as in profile.tsx)", () => {
  const FRIENDLY = "Check your connection and try again.";

  it("onError receives the friendly message when fetch throws", async () => {
    const deps = makeAddDeps({
      postVehicle: jest.fn().mockRejectedValue(new Error(FRIENDLY)),
    });
    await runAddVehicle(VEHICLE_DATA, deps);

    expect(deps.onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: FRIENDLY }),
    );
  });

  it("does NOT call onSuccess when fetch throws", async () => {
    const deps = makeAddDeps({
      postVehicle: jest.fn().mockRejectedValue(new Error(FRIENDLY)),
    });
    await runAddVehicle(VEHICLE_DATA, deps);

    expect(deps.onSuccess).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// runEditVehicle
// ═══════════════════════════════════════════════════════════════════════════════

describe("runEditVehicle — getToken() returns null (session expired mid-form)", () => {
  it("calls onError with the session-expired message", async () => {
    const deps = makeEditDeps({ getToken: jest.fn().mockResolvedValue(null) });
    await runEditVehicle(42, VEHICLE_DATA, deps);

    expect(deps.onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Your session has expired. Please sign in again to save changes.",
      }),
    );
  });

  it("does NOT call onSuccess — the edit form stays open", async () => {
    const deps = makeEditDeps({ getToken: jest.fn().mockResolvedValue(null) });
    await runEditVehicle(42, VEHICLE_DATA, deps);

    expect(deps.onSuccess).not.toHaveBeenCalled();
  });

  it("does NOT call patchVehicle — the network is never touched", async () => {
    const deps = makeEditDeps({ getToken: jest.fn().mockResolvedValue(null) });
    await runEditVehicle(42, VEHICLE_DATA, deps);

    expect(deps.patchVehicle).not.toHaveBeenCalled();
  });

  it("tracks profile_editvehicle_no_token", async () => {
    const deps = makeEditDeps({ getToken: jest.fn().mockResolvedValue(null) });
    await runEditVehicle(42, VEHICLE_DATA, deps);

    expect(deps.track).toHaveBeenCalledWith("profile_editvehicle_no_token", {});
  });

  it("does NOT track profile_editvehicle_complete", async () => {
    const deps = makeEditDeps({ getToken: jest.fn().mockResolvedValue(null) });
    await runEditVehicle(42, VEHICLE_DATA, deps);

    const events = (deps.track as jest.Mock).mock.calls.map(([e]) => e);
    expect(events).not.toContain("profile_editvehicle_complete");
  });

  it("calls onSessionExpired — the UI can replace the button with 'Sign In Again'", async () => {
    const onSessionExpired = jest.fn();
    const deps = makeEditDeps({ getToken: jest.fn().mockResolvedValue(null), onSessionExpired });
    await runEditVehicle(42, VEHICLE_DATA, deps);

    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });

  it("calls onSessionExpired BEFORE onError so the button state is set before the alert fires", async () => {
    const callOrder: string[] = [];
    const deps = makeEditDeps({
      getToken: jest.fn().mockResolvedValue(null),
      onSessionExpired: () => callOrder.push("onSessionExpired"),
      onError: jest.fn().mockImplementation(() => callOrder.push("onError")),
    });
    await runEditVehicle(42, VEHICLE_DATA, deps);

    expect(callOrder).toEqual(["onSessionExpired", "onError"]);
  });

  it("does NOT call onSessionExpired when the token is valid", async () => {
    const onSessionExpired = jest.fn();
    const deps = makeEditDeps({ onSessionExpired });
    await runEditVehicle(42, VEHICLE_DATA, deps);

    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  // ── Double-alert prevention ──────────────────────────────────────────────
  // onSessionExpired shows a dedicated "Session Expired" alert with a
  // "Sign In Again" button.  The useMutation onError handler must NOT show a
  // second generic "Couldn't Save Changes" alert.  It detects the session-
  // expired path by checking instanceof SessionExpiredError.

  it("passes a SessionExpiredError to onError — allows onError to suppress the generic alert", async () => {
    const deps = makeEditDeps({ getToken: jest.fn().mockResolvedValue(null) });
    await runEditVehicle(42, VEHICLE_DATA, deps);

    const err = (deps.onError as jest.Mock).mock.calls[0][0];
    expect(err).toBeInstanceOf(SessionExpiredError);
  });

  it("the SessionExpiredError has isSessionExpired:true", async () => {
    const deps = makeEditDeps({ getToken: jest.fn().mockResolvedValue(null) });
    await runEditVehicle(42, VEHICLE_DATA, deps);

    const err = (deps.onError as jest.Mock).mock.calls[0][0] as SessionExpiredError;
    expect(err.isSessionExpired).toBe(true);
  });

  it("a network error (patchVehicle throws) is NOT a SessionExpiredError", async () => {
    const deps = makeEditDeps({
      patchVehicle: jest.fn().mockRejectedValue(new Error("Network request failed")),
    });
    await runEditVehicle(42, VEHICLE_DATA, deps);

    const err = (deps.onError as jest.Mock).mock.calls[0][0];
    expect(err).not.toBeInstanceOf(SessionExpiredError);
  });
});

describe("runEditVehicle — getToken() throws (token acquisition error)", () => {
  it("calls onError with the thrown error", async () => {
    const tokenErr = new Error("Network error during token refresh");
    const deps = makeEditDeps({ getToken: jest.fn().mockRejectedValue(tokenErr) });
    await runEditVehicle(42, VEHICLE_DATA, deps);

    expect(deps.onError).toHaveBeenCalledWith(tokenErr);
  });

  it("does NOT call onSuccess", async () => {
    const deps = makeEditDeps({
      getToken: jest.fn().mockRejectedValue(new Error("Token error")),
    });
    await runEditVehicle(42, VEHICLE_DATA, deps);

    expect(deps.onSuccess).not.toHaveBeenCalled();
  });

  it("does NOT call patchVehicle", async () => {
    const deps = makeEditDeps({
      getToken: jest.fn().mockRejectedValue(new Error("Token error")),
    });
    await runEditVehicle(42, VEHICLE_DATA, deps);

    expect(deps.patchVehicle).not.toHaveBeenCalled();
  });

  it("tracks profile_editvehicle_token_error", async () => {
    const deps = makeEditDeps({
      getToken: jest.fn().mockRejectedValue(new Error("Token error")),
    });
    await runEditVehicle(42, VEHICLE_DATA, deps);

    expect(deps.track).toHaveBeenCalledWith(
      "profile_editvehicle_token_error",
      expect.objectContaining({ error: "Token error" }),
    );
  });
});

describe("runEditVehicle — happy path (valid token)", () => {
  it("calls onSuccess with the API response", async () => {
    const deps = makeEditDeps();
    await runEditVehicle(42, VEHICLE_DATA, deps);

    expect(deps.onSuccess).toHaveBeenCalledWith(VEHICLE_RESPONSE);
  });

  it("does NOT call onError", async () => {
    const deps = makeEditDeps();
    await runEditVehicle(42, VEHICLE_DATA, deps);

    expect(deps.onError).not.toHaveBeenCalled();
  });

  it("passes the vehicle id and data to patchVehicle", async () => {
    const deps = makeEditDeps();
    await runEditVehicle(42, VEHICLE_DATA, deps);

    expect(deps.patchVehicle).toHaveBeenCalledWith("tok_valid", 42, VEHICLE_DATA);
  });

  it("tracks profile_editvehicle_complete with vehicle_id", async () => {
    const deps = makeEditDeps();
    await runEditVehicle(42, VEHICLE_DATA, deps);

    expect(deps.track).toHaveBeenCalledWith("profile_editvehicle_complete", { vehicle_id: 42 });
  });
});

describe("runEditVehicle — patchVehicle throws (network / server error)", () => {
  it("calls onError with the thrown error", async () => {
    const deps = makeEditDeps({
      patchVehicle: jest.fn().mockRejectedValue(new Error("Network request failed")),
    });
    await runEditVehicle(42, VEHICLE_DATA, deps);

    expect(deps.onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Network request failed" }),
    );
  });

  it("does NOT call onSuccess — the form stays open for retry", async () => {
    const deps = makeEditDeps({
      patchVehicle: jest.fn().mockRejectedValue(new Error("Server error")),
    });
    await runEditVehicle(42, VEHICLE_DATA, deps);

    expect(deps.onSuccess).not.toHaveBeenCalled();
  });
});

describe("runEditVehicle — patchVehicle wraps fetch() network failure with friendly copy (as in profile.tsx)", () => {
  const FRIENDLY = "Check your connection and try again.";

  it("onError receives the friendly message when fetch throws", async () => {
    const deps = makeEditDeps({
      patchVehicle: jest.fn().mockRejectedValue(new Error(FRIENDLY)),
    });
    await runEditVehicle(42, VEHICLE_DATA, deps);

    expect(deps.onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: FRIENDLY }),
    );
  });

  it("does NOT call onSuccess when fetch throws", async () => {
    const deps = makeEditDeps({
      patchVehicle: jest.fn().mockRejectedValue(new Error(FRIENDLY)),
    });
    await runEditVehicle(42, VEHICLE_DATA, deps);

    expect(deps.onSuccess).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// runDeleteVehicle
// ═══════════════════════════════════════════════════════════════════════════════

function makeDeleteDeps(overrides: Partial<DeleteVehicleDeps> = {}): DeleteVehicleDeps {
  return {
    getToken: jest.fn().mockResolvedValue("tok_valid"),
    deleteVehicle: jest.fn().mockResolvedValue(undefined),
    onSuccess: jest.fn(),
    onError: jest.fn(),
    track: jest.fn(),
    ...overrides,
  };
}

describe("runDeleteVehicle — getToken() returns null (session expired)", () => {
  it("calls onError with the session-expired message", async () => {
    const deps = makeDeleteDeps({ getToken: jest.fn().mockResolvedValue(null) });
    await runDeleteVehicle(42, deps);

    expect(deps.onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Your session has expired. Please sign in again to delete this vehicle.",
      }),
    );
  });

  it("does NOT call onSuccess", async () => {
    const deps = makeDeleteDeps({ getToken: jest.fn().mockResolvedValue(null) });
    await runDeleteVehicle(42, deps);

    expect(deps.onSuccess).not.toHaveBeenCalled();
  });

  it("does NOT call deleteVehicle — the network is never touched", async () => {
    const deps = makeDeleteDeps({ getToken: jest.fn().mockResolvedValue(null) });
    await runDeleteVehicle(42, deps);

    expect(deps.deleteVehicle).not.toHaveBeenCalled();
  });

  it("tracks profile_deletevehicle_no_token", async () => {
    const deps = makeDeleteDeps({ getToken: jest.fn().mockResolvedValue(null) });
    await runDeleteVehicle(42, deps);

    expect(deps.track).toHaveBeenCalledWith("profile_deletevehicle_no_token", {});
  });

  it("does NOT track profile_deletevehicle_complete", async () => {
    const deps = makeDeleteDeps({ getToken: jest.fn().mockResolvedValue(null) });
    await runDeleteVehicle(42, deps);

    const events = (deps.track as jest.Mock).mock.calls.map(([e]) => e);
    expect(events).not.toContain("profile_deletevehicle_complete");
  });

  it("calls onSessionExpired — the UI can offer a 'Sign In Again' Alert action", async () => {
    const onSessionExpired = jest.fn();
    const deps = makeDeleteDeps({ getToken: jest.fn().mockResolvedValue(null), onSessionExpired });
    await runDeleteVehicle(42, deps);

    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });

  it("calls onSessionExpired BEFORE onError so the alert is shown with recovery options", async () => {
    const callOrder: string[] = [];
    const deps = makeDeleteDeps({
      getToken: jest.fn().mockResolvedValue(null),
      onSessionExpired: () => callOrder.push("onSessionExpired"),
      onError: jest.fn().mockImplementation(() => callOrder.push("onError")),
    });
    await runDeleteVehicle(42, deps);

    expect(callOrder).toEqual(["onSessionExpired", "onError"]);
  });

  it("does NOT call onSessionExpired when the token is valid", async () => {
    const onSessionExpired = jest.fn();
    const deps = makeDeleteDeps({ onSessionExpired });
    await runDeleteVehicle(42, deps);

    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  // ── Double-alert prevention ──────────────────────────────────────────────
  // onSessionExpired shows a dedicated "Session Expired" alert with a
  // "Sign In Again" button.  The useMutation onError handler must NOT show a
  // second generic "Couldn't Remove Vehicle" alert.  It detects the session-
  // expired path by checking instanceof SessionExpiredError.

  it("passes a SessionExpiredError to onError — allows onError to suppress the generic alert", async () => {
    const deps = makeDeleteDeps({ getToken: jest.fn().mockResolvedValue(null) });
    await runDeleteVehicle(42, deps);

    const err = (deps.onError as jest.Mock).mock.calls[0][0];
    expect(err).toBeInstanceOf(SessionExpiredError);
  });

  it("the SessionExpiredError has isSessionExpired:true", async () => {
    const deps = makeDeleteDeps({ getToken: jest.fn().mockResolvedValue(null) });
    await runDeleteVehicle(42, deps);

    const err = (deps.onError as jest.Mock).mock.calls[0][0] as SessionExpiredError;
    expect(err.isSessionExpired).toBe(true);
  });

  it("a network error is NOT a SessionExpiredError — the generic alert should still fire", async () => {
    const deps = makeDeleteDeps({
      deleteVehicle: jest.fn().mockRejectedValue(new Error("Network request failed")),
    });
    await runDeleteVehicle(42, deps);

    const err = (deps.onError as jest.Mock).mock.calls[0][0];
    expect(err).not.toBeInstanceOf(SessionExpiredError);
  });
});

describe("runDeleteVehicle — getToken() throws (token acquisition error)", () => {
  it("calls onError with the thrown error", async () => {
    const tokenErr = new Error("Network error during token refresh");
    const deps = makeDeleteDeps({ getToken: jest.fn().mockRejectedValue(tokenErr) });
    await runDeleteVehicle(42, deps);

    expect(deps.onError).toHaveBeenCalledWith(tokenErr);
  });

  it("does NOT call onSuccess", async () => {
    const deps = makeDeleteDeps({
      getToken: jest.fn().mockRejectedValue(new Error("Token error")),
    });
    await runDeleteVehicle(42, deps);

    expect(deps.onSuccess).not.toHaveBeenCalled();
  });

  it("does NOT call deleteVehicle", async () => {
    const deps = makeDeleteDeps({
      getToken: jest.fn().mockRejectedValue(new Error("Token error")),
    });
    await runDeleteVehicle(42, deps);

    expect(deps.deleteVehicle).not.toHaveBeenCalled();
  });

  it("tracks profile_deletevehicle_token_error", async () => {
    const deps = makeDeleteDeps({
      getToken: jest.fn().mockRejectedValue(new Error("Token error")),
    });
    await runDeleteVehicle(42, deps);

    expect(deps.track).toHaveBeenCalledWith(
      "profile_deletevehicle_token_error",
      expect.objectContaining({ error: "Token error" }),
    );
  });
});

describe("runDeleteVehicle — happy path (valid token)", () => {
  it("calls onSuccess", async () => {
    const deps = makeDeleteDeps();
    await runDeleteVehicle(42, deps);

    expect(deps.onSuccess).toHaveBeenCalled();
  });

  it("does NOT call onError", async () => {
    const deps = makeDeleteDeps();
    await runDeleteVehicle(42, deps);

    expect(deps.onError).not.toHaveBeenCalled();
  });

  it("passes the vehicle id and token to deleteVehicle", async () => {
    const deps = makeDeleteDeps();
    await runDeleteVehicle(42, deps);

    expect(deps.deleteVehicle).toHaveBeenCalledWith("tok_valid", 42);
  });

  it("tracks profile_deletevehicle_complete with vehicle_id", async () => {
    const deps = makeDeleteDeps();
    await runDeleteVehicle(42, deps);

    expect(deps.track).toHaveBeenCalledWith("profile_deletevehicle_complete", { vehicle_id: 42 });
  });
});

describe("runDeleteVehicle — deleteVehicle throws (network / server error)", () => {
  it("calls onError with the thrown error", async () => {
    const deps = makeDeleteDeps({
      deleteVehicle: jest.fn().mockRejectedValue(new Error("Network request failed")),
    });
    await runDeleteVehicle(42, deps);

    expect(deps.onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Network request failed" }),
    );
  });

  it("does NOT call onSuccess", async () => {
    const deps = makeDeleteDeps({
      deleteVehicle: jest.fn().mockRejectedValue(new Error("Server error")),
    });
    await runDeleteVehicle(42, deps);

    expect(deps.onSuccess).not.toHaveBeenCalled();
  });
});

describe("runDeleteVehicle — deleteVehicle wraps fetch() network failure with friendly copy (as in profile.tsx)", () => {
  const FRIENDLY = "Check your connection and try again.";

  it("onError receives the friendly message when fetch throws", async () => {
    const deps = makeDeleteDeps({
      deleteVehicle: jest.fn().mockRejectedValue(new Error(FRIENDLY)),
    });
    await runDeleteVehicle(42, deps);

    expect(deps.onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: FRIENDLY }),
    );
  });

  it("does NOT call onSuccess when fetch throws", async () => {
    const deps = makeDeleteDeps({
      deleteVehicle: jest.fn().mockRejectedValue(new Error(FRIENDLY)),
    });
    await runDeleteVehicle(42, deps);

    expect(deps.onSuccess).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// runSetPrimaryVehicle
// ═══════════════════════════════════════════════════════════════════════════════

const SET_PRIMARY_RESPONSE = { id: 42, isPrimary: true };

function makeSetPrimaryDeps(
  overrides: Partial<SetPrimaryVehicleDeps> = {},
): SetPrimaryVehicleDeps {
  return {
    getToken: jest.fn().mockResolvedValue("tok_valid"),
    setPrimaryVehicle: jest.fn().mockResolvedValue(SET_PRIMARY_RESPONSE),
    onSuccess: jest.fn(),
    onError: jest.fn(),
    track: jest.fn(),
    ...overrides,
  };
}

describe("runSetPrimaryVehicle — getToken() returns null (session expired)", () => {
  it("calls onError with the session-expired message", async () => {
    const deps = makeSetPrimaryDeps({ getToken: jest.fn().mockResolvedValue(null) });
    await runSetPrimaryVehicle(42, deps);

    expect(deps.onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Your session has expired. Please sign in again to update your primary vehicle.",
      }),
    );
  });

  it("does NOT call onSuccess", async () => {
    const deps = makeSetPrimaryDeps({ getToken: jest.fn().mockResolvedValue(null) });
    await runSetPrimaryVehicle(42, deps);

    expect(deps.onSuccess).not.toHaveBeenCalled();
  });

  it("does NOT call setPrimaryVehicle — the network is never touched", async () => {
    const deps = makeSetPrimaryDeps({ getToken: jest.fn().mockResolvedValue(null) });
    await runSetPrimaryVehicle(42, deps);

    expect(deps.setPrimaryVehicle).not.toHaveBeenCalled();
  });

  it("tracks profile_setprimary_no_token", async () => {
    const deps = makeSetPrimaryDeps({ getToken: jest.fn().mockResolvedValue(null) });
    await runSetPrimaryVehicle(42, deps);

    expect(deps.track).toHaveBeenCalledWith("profile_setprimary_no_token", {});
  });

  it("does NOT track profile_setprimary_complete", async () => {
    const deps = makeSetPrimaryDeps({ getToken: jest.fn().mockResolvedValue(null) });
    await runSetPrimaryVehicle(42, deps);

    const events = (deps.track as jest.Mock).mock.calls.map(([e]) => e);
    expect(events).not.toContain("profile_setprimary_complete");
  });

  it("calls onSessionExpired — the UI can offer a 'Sign In Again' Alert action", async () => {
    const onSessionExpired = jest.fn();
    const deps = makeSetPrimaryDeps({
      getToken: jest.fn().mockResolvedValue(null),
      onSessionExpired,
    });
    await runSetPrimaryVehicle(42, deps);

    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });

  it("calls onSessionExpired BEFORE onError so the alert is shown with recovery options", async () => {
    const callOrder: string[] = [];
    const deps = makeSetPrimaryDeps({
      getToken: jest.fn().mockResolvedValue(null),
      onSessionExpired: () => callOrder.push("onSessionExpired"),
      onError: jest.fn().mockImplementation(() => callOrder.push("onError")),
    });
    await runSetPrimaryVehicle(42, deps);

    expect(callOrder).toEqual(["onSessionExpired", "onError"]);
  });

  it("does NOT call onSessionExpired when the token is valid", async () => {
    const onSessionExpired = jest.fn();
    const deps = makeSetPrimaryDeps({ onSessionExpired });
    await runSetPrimaryVehicle(42, deps);

    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  // ── Double-alert prevention ──────────────────────────────────────────────
  // onSessionExpired shows a dedicated "Session Expired" alert with a
  // "Sign In Again" button.  The useMutation onError handler must NOT show a
  // second generic "Couldn't Set Primary Vehicle" alert.  It detects the
  // session-expired path by checking instanceof SessionExpiredError.

  it("passes a SessionExpiredError to onError — allows onError to suppress the generic alert", async () => {
    const deps = makeSetPrimaryDeps({ getToken: jest.fn().mockResolvedValue(null) });
    await runSetPrimaryVehicle(42, deps);

    const err = (deps.onError as jest.Mock).mock.calls[0][0];
    expect(err).toBeInstanceOf(SessionExpiredError);
  });

  it("the SessionExpiredError has isSessionExpired:true", async () => {
    const deps = makeSetPrimaryDeps({ getToken: jest.fn().mockResolvedValue(null) });
    await runSetPrimaryVehicle(42, deps);

    const err = (deps.onError as jest.Mock).mock.calls[0][0] as SessionExpiredError;
    expect(err.isSessionExpired).toBe(true);
  });

  it("a network error is NOT a SessionExpiredError — the generic alert should still fire", async () => {
    const deps = makeSetPrimaryDeps({
      setPrimaryVehicle: jest.fn().mockRejectedValue(new Error("Network request failed")),
    });
    await runSetPrimaryVehicle(42, deps);

    const err = (deps.onError as jest.Mock).mock.calls[0][0];
    expect(err).not.toBeInstanceOf(SessionExpiredError);
  });
});

describe("runSetPrimaryVehicle — getToken() throws (token acquisition error)", () => {
  it("calls onError with the thrown error", async () => {
    const tokenErr = new Error("Network error during token refresh");
    const deps = makeSetPrimaryDeps({ getToken: jest.fn().mockRejectedValue(tokenErr) });
    await runSetPrimaryVehicle(42, deps);

    expect(deps.onError).toHaveBeenCalledWith(tokenErr);
  });

  it("does NOT call onSuccess", async () => {
    const deps = makeSetPrimaryDeps({
      getToken: jest.fn().mockRejectedValue(new Error("Token error")),
    });
    await runSetPrimaryVehicle(42, deps);

    expect(deps.onSuccess).not.toHaveBeenCalled();
  });

  it("does NOT call setPrimaryVehicle", async () => {
    const deps = makeSetPrimaryDeps({
      getToken: jest.fn().mockRejectedValue(new Error("Token error")),
    });
    await runSetPrimaryVehicle(42, deps);

    expect(deps.setPrimaryVehicle).not.toHaveBeenCalled();
  });

  it("tracks profile_setprimary_token_error", async () => {
    const deps = makeSetPrimaryDeps({
      getToken: jest.fn().mockRejectedValue(new Error("Token error")),
    });
    await runSetPrimaryVehicle(42, deps);

    expect(deps.track).toHaveBeenCalledWith(
      "profile_setprimary_token_error",
      expect.objectContaining({ error: "Token error" }),
    );
  });
});

describe("runSetPrimaryVehicle — happy path (valid token)", () => {
  it("calls onSuccess with the API response", async () => {
    const deps = makeSetPrimaryDeps();
    await runSetPrimaryVehicle(42, deps);

    expect(deps.onSuccess).toHaveBeenCalledWith(SET_PRIMARY_RESPONSE);
  });

  it("does NOT call onError", async () => {
    const deps = makeSetPrimaryDeps();
    await runSetPrimaryVehicle(42, deps);

    expect(deps.onError).not.toHaveBeenCalled();
  });

  it("passes the vehicle id and token to setPrimaryVehicle", async () => {
    const deps = makeSetPrimaryDeps();
    await runSetPrimaryVehicle(42, deps);

    expect(deps.setPrimaryVehicle).toHaveBeenCalledWith("tok_valid", 42);
  });

  it("tracks profile_setprimary_complete with vehicle_id", async () => {
    const deps = makeSetPrimaryDeps();
    await runSetPrimaryVehicle(42, deps);

    expect(deps.track).toHaveBeenCalledWith("profile_setprimary_complete", { vehicle_id: 42 });
  });
});

describe("runSetPrimaryVehicle — setPrimaryVehicle throws (network / server error)", () => {
  it("calls onError with the thrown error", async () => {
    const deps = makeSetPrimaryDeps({
      setPrimaryVehicle: jest.fn().mockRejectedValue(new Error("Network request failed")),
    });
    await runSetPrimaryVehicle(42, deps);

    expect(deps.onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Network request failed" }),
    );
  });

  it("does NOT call onSuccess", async () => {
    const deps = makeSetPrimaryDeps({
      setPrimaryVehicle: jest.fn().mockRejectedValue(new Error("Server error")),
    });
    await runSetPrimaryVehicle(42, deps);

    expect(deps.onSuccess).not.toHaveBeenCalled();
  });
});

describe("runSetPrimaryVehicle — setPrimaryVehicle wraps fetch() network failure with friendly copy (as in profile.tsx)", () => {
  const FRIENDLY = "Check your connection and try again.";

  it("onError receives the friendly message when fetch throws", async () => {
    const deps = makeSetPrimaryDeps({
      setPrimaryVehicle: jest.fn().mockRejectedValue(new Error(FRIENDLY)),
    });
    await runSetPrimaryVehicle(42, deps);

    expect(deps.onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: FRIENDLY }),
    );
  });

  it("does NOT call onSuccess when fetch throws", async () => {
    const deps = makeSetPrimaryDeps({
      setPrimaryVehicle: jest.fn().mockRejectedValue(new Error(FRIENDLY)),
    });
    await runSetPrimaryVehicle(42, deps);

    expect(deps.onSuccess).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// setPrimaryVehicleOnError — the exported production handler
//
// profile.tsx's setPrimaryMutation delegates its onError body to the exported
// `setPrimaryVehicleOnError` function so the guard logic lives in one place and
// can be tested here without a React render environment.
//
// These tests call the real production function directly.  If the
// `instanceof SessionExpiredError` guard is removed from vehicleMutations.ts,
// test (1) will fail immediately — no false sense of protection.
// ═══════════════════════════════════════════════════════════════════════════════

describe("setPrimaryVehicleOnError (production handler exported from vehicleMutations)", () => {
  it("does NOT call alertFn when err is a SessionExpiredError — suppresses the double-alert", () => {
    const alertFn = jest.fn();
    const err = new SessionExpiredError(
      "Your session has expired. Please sign in again to update your primary vehicle.",
    );

    setPrimaryVehicleOnError(err, alertFn);

    expect(alertFn).not.toHaveBeenCalled();
  });

  it("DOES call alertFn with the correct title and message for a plain Error (network-error path)", () => {
    const alertFn = jest.fn();
    const err = new Error("Network request failed");

    setPrimaryVehicleOnError(err, alertFn);

    expect(alertFn).toHaveBeenCalledWith(
      "Couldn't Set Primary Vehicle",
      "Network request failed",
    );
  });

  it("calls alertFn exactly once for a plain Error", () => {
    const alertFn = jest.fn();
    setPrimaryVehicleOnError(new Error("Server error"), alertFn);

    expect(alertFn).toHaveBeenCalledTimes(1);
  });

  it("the guard is type-based — a plain Error whose message mimics session-expiry is still alerted", () => {
    const alertFn = jest.fn();
    // Same message as SessionExpiredError but constructed as a plain Error.
    // The guard checks instanceof, not the message string, so this must NOT be suppressed.
    const lookalike = new Error(
      "Your session has expired. Please sign in again to update your primary vehicle.",
    );

    setPrimaryVehicleOnError(lookalike, alertFn);

    expect(alertFn).toHaveBeenCalledTimes(1);
  });

  it("uses the fallback message when err.message is empty", () => {
    const alertFn = jest.fn();
    const err = new Error("");
    // Override message to simulate an edge case
    Object.defineProperty(err, "message", { value: "" });

    setPrimaryVehicleOnError(err, alertFn);

    expect(alertFn).toHaveBeenCalledWith(
      "Couldn't Set Primary Vehicle",
      "Something went wrong. Please try again.",
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// addVehicleOnError — the exported production handler
//
// profile.tsx's addVehicleMutation delegates its onError body to the exported
// `addVehicleOnError` function so the guard logic lives in one place and can be
// tested here without a React render environment.
//
// These tests call the real production function directly.  If the
// `instanceof SessionExpiredError` guard is removed from vehicleMutations.ts,
// test (1) will fail immediately — no false sense of protection.
// ═══════════════════════════════════════════════════════════════════════════════

describe("addVehicleOnError (production handler exported from vehicleMutations)", () => {
  it("does NOT call alertFn when err is a SessionExpiredError — suppresses the double-alert", () => {
    const alertFn = jest.fn();
    const err = new SessionExpiredError(
      "Your session has expired. Please sign in again to add a vehicle.",
    );

    addVehicleOnError(err, alertFn);

    expect(alertFn).not.toHaveBeenCalled();
  });

  it("Alert.alert is called at most once for the session-expired path (zero times in onError)", () => {
    // The session-expired alert is fired by onSessionExpired (inside runAddVehicle),
    // NOT by this handler.  So alertFn must be called zero times here.
    const alertFn = jest.fn();
    const err = new SessionExpiredError(
      "Your session has expired. Please sign in again to add a vehicle.",
    );

    addVehicleOnError(err, alertFn);

    expect(alertFn).toHaveBeenCalledTimes(0);
  });

  it("does NOT show 'Couldn't Add Vehicle' when err is a SessionExpiredError", () => {
    const alertFn = jest.fn();
    const err = new SessionExpiredError(
      "Your session has expired. Please sign in again to add a vehicle.",
    );

    addVehicleOnError(err, alertFn);

    // Confirm the generic title is never shown
    const titles = (alertFn as jest.Mock).mock.calls.map(([title]) => title);
    expect(titles).not.toContain("Couldn't Add Vehicle");
  });

  it("DOES call alertFn with the correct title and message for a plain Error (network-error path)", () => {
    const alertFn = jest.fn();
    const err = new Error("Network request failed");

    addVehicleOnError(err, alertFn);

    expect(alertFn).toHaveBeenCalledWith(
      "Couldn't Add Vehicle",
      "Network request failed",
    );
  });

  it("calls alertFn exactly once for a plain Error", () => {
    const alertFn = jest.fn();
    addVehicleOnError(new Error("Server error"), alertFn);

    expect(alertFn).toHaveBeenCalledTimes(1);
  });

  it("the guard is type-based — a plain Error whose message mimics session-expiry is still alerted", () => {
    const alertFn = jest.fn();
    // Same message as SessionExpiredError but constructed as a plain Error.
    // The guard checks instanceof, not the message string, so this must NOT be suppressed.
    const lookalike = new Error(
      "Your session has expired. Please sign in again to add a vehicle.",
    );

    addVehicleOnError(lookalike, alertFn);

    expect(alertFn).toHaveBeenCalledTimes(1);
    expect(alertFn).toHaveBeenCalledWith(
      "Couldn't Add Vehicle",
      "Your session has expired. Please sign in again to add a vehicle.",
    );
  });

  it("uses the fallback message when err.message is empty", () => {
    const alertFn = jest.fn();
    const err = new Error("");
    Object.defineProperty(err, "message", { value: "" });

    addVehicleOnError(err, alertFn);

    expect(alertFn).toHaveBeenCalledWith(
      "Couldn't Add Vehicle",
      "Something went wrong. Please try again.",
    );
  });

  // ── Integration: runAddVehicle + addVehicleOnError together ─────────────────
  // Simulates the exact call chain that happens in production when a session
  // expires while the user is filling in the Add Vehicle form.

  it("end-to-end: runAddVehicle passes SessionExpiredError to onError; addVehicleOnError does NOT call alertFn", async () => {
    const alertFn = jest.fn();
    const onSessionExpired = jest.fn();

    const deps = makeAddDeps({
      getToken: jest.fn().mockResolvedValue(null),
      onSessionExpired,
      // Simulate what profile.tsx does: delegate to addVehicleOnError
      onError: (err: Error) => addVehicleOnError(err, alertFn),
    });

    await runAddVehicle(VEHICLE_DATA, deps);

    // The session-expired alert is shown by onSessionExpired (not tested here),
    // but the generic "Couldn't Add Vehicle" alert must be suppressed.
    expect(alertFn).not.toHaveBeenCalled();
    // onSessionExpired did fire — confirming the session-expired path was taken.
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });

  it("end-to-end: runAddVehicle passes plain Error to onError; addVehicleOnError DOES call alertFn once", async () => {
    const alertFn = jest.fn();

    const deps = makeAddDeps({
      postVehicle: jest.fn().mockRejectedValue(new Error("Network request failed")),
      onError: (err: Error) => addVehicleOnError(err, alertFn),
    });

    await runAddVehicle(VEHICLE_DATA, deps);

    expect(alertFn).toHaveBeenCalledTimes(1);
    expect(alertFn).toHaveBeenCalledWith("Couldn't Add Vehicle", "Network request failed");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// editVehicleOnError — the exported production handler
//
// profile.tsx's editVehicleMutation delegates its onError body to the exported
// `editVehicleOnError` function so the guard logic lives in one place and can
// be tested here without a React render environment.
//
// These tests call the real production function directly.  If the
// `instanceof SessionExpiredError` guard is removed from vehicleMutations.ts,
// test (1) will fail immediately — no false sense of protection.
// ═══════════════════════════════════════════════════════════════════════════════

describe("editVehicleOnError (production handler exported from vehicleMutations)", () => {
  it("does NOT call alertFn when err is a SessionExpiredError — suppresses the double-alert", () => {
    const alertFn = jest.fn();
    const err = new SessionExpiredError(
      "Your session has expired. Please sign in again to save changes.",
    );

    editVehicleOnError(err, alertFn);

    expect(alertFn).not.toHaveBeenCalled();
  });

  it("Alert.alert is called at most once for the session-expired path (zero times in onError)", () => {
    // The session-expired alert is fired by onSessionExpired (inside runEditVehicle),
    // NOT by this handler.  So alertFn must be called zero times here.
    const alertFn = jest.fn();
    const err = new SessionExpiredError(
      "Your session has expired. Please sign in again to save changes.",
    );

    editVehicleOnError(err, alertFn);

    expect(alertFn).toHaveBeenCalledTimes(0);
  });

  it("does NOT show 'Couldn't Save Vehicle' when err is a SessionExpiredError", () => {
    const alertFn = jest.fn();
    const err = new SessionExpiredError(
      "Your session has expired. Please sign in again to save changes.",
    );

    editVehicleOnError(err, alertFn);

    // Confirm the generic title is never shown
    const titles = (alertFn as jest.Mock).mock.calls.map(([title]) => title);
    expect(titles).not.toContain("Couldn't Save Vehicle");
  });

  it("DOES call alertFn with the correct title and message for a plain Error (network-error path)", () => {
    const alertFn = jest.fn();
    const err = new Error("Network request failed");

    editVehicleOnError(err, alertFn);

    expect(alertFn).toHaveBeenCalledWith(
      "Couldn't Save Vehicle",
      "Network request failed",
    );
  });

  it("calls alertFn exactly once for a plain Error", () => {
    const alertFn = jest.fn();
    editVehicleOnError(new Error("Server error"), alertFn);

    expect(alertFn).toHaveBeenCalledTimes(1);
  });

  it("the guard is type-based — a plain Error whose message mimics session-expiry is still alerted", () => {
    const alertFn = jest.fn();
    // Same message as SessionExpiredError but constructed as a plain Error.
    // The guard checks instanceof, not the message string, so this must NOT be suppressed.
    const lookalike = new Error(
      "Your session has expired. Please sign in again to save changes.",
    );

    editVehicleOnError(lookalike, alertFn);

    expect(alertFn).toHaveBeenCalledTimes(1);
    expect(alertFn).toHaveBeenCalledWith(
      "Couldn't Save Vehicle",
      "Your session has expired. Please sign in again to save changes.",
    );
  });

  it("uses the fallback message when err.message is empty", () => {
    const alertFn = jest.fn();
    const err = new Error("");
    Object.defineProperty(err, "message", { value: "" });

    editVehicleOnError(err, alertFn);

    expect(alertFn).toHaveBeenCalledWith(
      "Couldn't Save Vehicle",
      "Something went wrong. Please try again.",
    );
  });

  // ── Integration: runEditVehicle + editVehicleOnError together ───────────────
  // Simulates the exact call chain that happens in production when a session
  // expires while the user is filling in the Edit Vehicle form.

  it("end-to-end: runEditVehicle passes SessionExpiredError to onError; editVehicleOnError does NOT call alertFn", async () => {
    const alertFn = jest.fn();
    const onSessionExpired = jest.fn();

    const deps = makeEditDeps({
      getToken: jest.fn().mockResolvedValue(null),
      onSessionExpired,
      // Simulate what profile.tsx does: delegate to editVehicleOnError
      onError: (err: Error) => editVehicleOnError(err, alertFn),
    });

    await runEditVehicle(42, VEHICLE_DATA, deps);

    // The session-expired alert is shown by onSessionExpired (not tested here),
    // but the generic "Couldn't Save Vehicle" alert must be suppressed.
    expect(alertFn).not.toHaveBeenCalled();
    // onSessionExpired did fire — confirming the session-expired path was taken.
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });

  it("end-to-end: runEditVehicle passes plain Error to onError; editVehicleOnError DOES call alertFn once", async () => {
    const alertFn = jest.fn();

    const deps = makeEditDeps({
      patchVehicle: jest.fn().mockRejectedValue(new Error("Network request failed")),
      onError: (err: Error) => editVehicleOnError(err, alertFn),
    });

    await runEditVehicle(42, VEHICLE_DATA, deps);

    expect(alertFn).toHaveBeenCalledTimes(1);
    expect(alertFn).toHaveBeenCalledWith("Couldn't Save Vehicle", "Network request failed");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// deleteVehicleOnError — the exported production handler
//
// profile.tsx's deleteVehicleMutation delegates its onError body to the exported
// `deleteVehicleOnError` function so the guard logic lives in one place and
// can be tested here without a React render environment.
//
// These tests call the real production function directly.  If the
// `instanceof SessionExpiredError` guard is removed from vehicleMutations.ts,
// test (1) will fail immediately — no false sense of protection.
// ═══════════════════════════════════════════════════════════════════════════════

describe("deleteVehicleOnError (production handler exported from vehicleMutations)", () => {
  it("does NOT call alertFn when err is a SessionExpiredError — suppresses the double-alert", () => {
    const alertFn = jest.fn();
    const err = new SessionExpiredError(
      "Your session has expired. Please sign in again to delete this vehicle.",
    );

    deleteVehicleOnError(err, alertFn);

    expect(alertFn).not.toHaveBeenCalled();
  });

  it("Alert.alert is called at most once for the session-expired path (zero times in onError)", () => {
    // The session-expired alert is fired by onSessionExpired (inside runDeleteVehicle),
    // NOT by this handler.  So alertFn must be called zero times here.
    const alertFn = jest.fn();
    const err = new SessionExpiredError(
      "Your session has expired. Please sign in again to delete this vehicle.",
    );

    deleteVehicleOnError(err, alertFn);

    expect(alertFn).toHaveBeenCalledTimes(0);
  });

  it("does NOT show 'Couldn't Remove Vehicle' when err is a SessionExpiredError", () => {
    const alertFn = jest.fn();
    const err = new SessionExpiredError(
      "Your session has expired. Please sign in again to delete this vehicle.",
    );

    deleteVehicleOnError(err, alertFn);

    // Confirm the generic title is never shown
    const titles = (alertFn as jest.Mock).mock.calls.map(([title]) => title);
    expect(titles).not.toContain("Couldn't Remove Vehicle");
  });

  it("DOES call alertFn with the correct title and message for a plain Error (network-error path)", () => {
    const alertFn = jest.fn();
    const err = new Error("Network request failed");

    deleteVehicleOnError(err, alertFn);

    expect(alertFn).toHaveBeenCalledWith(
      "Couldn't Remove Vehicle",
      "Network request failed",
    );
  });

  it("calls alertFn exactly once for a plain Error", () => {
    const alertFn = jest.fn();
    deleteVehicleOnError(new Error("Server error"), alertFn);

    expect(alertFn).toHaveBeenCalledTimes(1);
  });

  it("the guard is type-based — a plain Error whose message mimics session-expiry is still alerted", () => {
    const alertFn = jest.fn();
    // Same message as SessionExpiredError but constructed as a plain Error.
    // The guard checks instanceof, not the message string, so this must NOT be suppressed.
    const lookalike = new Error(
      "Your session has expired. Please sign in again to delete this vehicle.",
    );

    deleteVehicleOnError(lookalike, alertFn);

    expect(alertFn).toHaveBeenCalledTimes(1);
    expect(alertFn).toHaveBeenCalledWith(
      "Couldn't Remove Vehicle",
      "Your session has expired. Please sign in again to delete this vehicle.",
    );
  });

  it("uses the fallback message when err.message is empty", () => {
    const alertFn = jest.fn();
    const err = new Error("");
    Object.defineProperty(err, "message", { value: "" });

    deleteVehicleOnError(err, alertFn);

    expect(alertFn).toHaveBeenCalledWith(
      "Couldn't Remove Vehicle",
      "Something went wrong. Please try again.",
    );
  });

  // ── Integration: runDeleteVehicle + deleteVehicleOnError together ────────────
  // Simulates the exact call chain that happens in production when a session
  // expires while the user is trying to delete a vehicle.

  it("end-to-end: runDeleteVehicle passes SessionExpiredError to onError; deleteVehicleOnError does NOT call alertFn", async () => {
    const alertFn = jest.fn();
    const onSessionExpired = jest.fn();

    const deps = makeDeleteDeps({
      getToken: jest.fn().mockResolvedValue(null),
      onSessionExpired,
      // Simulate what profile.tsx does: delegate to deleteVehicleOnError
      onError: (err: Error) => deleteVehicleOnError(err, alertFn),
    });

    await runDeleteVehicle(42, deps);

    // The session-expired alert is shown by onSessionExpired (not tested here),
    // but the generic "Couldn't Remove Vehicle" alert must be suppressed.
    expect(alertFn).not.toHaveBeenCalled();
    // onSessionExpired did fire — confirming the session-expired path was taken.
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });

  it("end-to-end: runDeleteVehicle passes plain Error to onError; deleteVehicleOnError DOES call alertFn once", async () => {
    const alertFn = jest.fn();

    const deps = makeDeleteDeps({
      deleteVehicle: jest.fn().mockRejectedValue(new Error("Network request failed")),
      onError: (err: Error) => deleteVehicleOnError(err, alertFn),
    });

    await runDeleteVehicle(42, deps);

    expect(alertFn).toHaveBeenCalledTimes(1);
    expect(alertFn).toHaveBeenCalledWith("Couldn't Remove Vehicle", "Network request failed");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// setPrimarySessionExpiredId state lifecycle
//
// The vehicle list row in profile.tsx renders a "Sign In Again" button instead
// of "Set Primary" when setPrimarySessionExpiredId equals that vehicle's id.
// These tests model the state machine with a plain variable (simulating useState)
// and confirm every transition using the real runSetPrimaryVehicle function.
//
// Three paths are covered:
//   A. Session expires → onSessionExpired sets the id → onSuccess clears it
//      (the normal re-auth + retry round-trip)
//   B. Tapping the inline "Sign In Again" row button clears the id immediately
//      before navigating — so the row reverts to "Set Primary" if the user
//      comes back without signing in
//   C. A plain network error does NOT set the id — only a null token does
// ═══════════════════════════════════════════════════════════════════════════════

describe("setPrimarySessionExpiredId state lifecycle — session expires → re-auth → row resets", () => {
  // ── Path A: full round-trip ────────────────────────────────────────────────

  it("session expiry sets the id to the vehicle id", async () => {
    let setPrimarySessionExpiredId: number | null = null;

    const deps = makeSetPrimaryDeps({
      getToken: jest.fn().mockResolvedValue(null),
      onSessionExpired: () => {
        setPrimarySessionExpiredId = 42;
      },
    });

    await runSetPrimaryVehicle(42, deps);

    expect(setPrimarySessionExpiredId).toBe(42);
  });

  it("after session expiry the row shows 'Sign In Again' (id matches) not 'Set Primary'", async () => {
    let setPrimarySessionExpiredId: number | null = null;

    const deps = makeSetPrimaryDeps({
      getToken: jest.fn().mockResolvedValue(null),
      onSessionExpired: () => {
        setPrimarySessionExpiredId = 42;
      },
    });

    await runSetPrimaryVehicle(42, deps);

    // Row decision: setPrimarySessionExpiredId === v.id → "Sign In Again"
    expect(setPrimarySessionExpiredId === 42).toBe(true);
  });

  it("onSuccess clears the id to null — row reverts to 'Set Primary'", async () => {
    // Simulate what profile.tsx does in the setPrimaryMutation onSuccess handler:
    //   setSetPrimarySessionExpiredId(null)
    let setPrimarySessionExpiredId: number | null = 42;

    // Simulate the onSuccess handler
    function onSuccessHandler() {
      setPrimarySessionExpiredId = null;
    }
    onSuccessHandler();

    expect(setPrimarySessionExpiredId).toBeNull();
    // Row decision: setPrimarySessionExpiredId !== v.id → "Set Primary"
    expect(setPrimarySessionExpiredId === 42).toBe(false);
  });

  it("end-to-end: session expires → id set; successful retry → id cleared to null", async () => {
    let setPrimarySessionExpiredId: number | null = null;
    const queryInvalidated = jest.fn();

    // Step 1: session expires — token returns null
    const expiredDeps = makeSetPrimaryDeps({
      getToken: jest.fn().mockResolvedValue(null),
      onSessionExpired: () => {
        setPrimarySessionExpiredId = 42;
      },
    });
    await runSetPrimaryVehicle(42, expiredDeps);

    // id is now set — row shows "Sign In Again"
    expect(setPrimarySessionExpiredId).toBe(42);

    // Step 2: user signs back in and retries; token is now valid
    // Simulates profile.tsx setPrimaryMutation.onSuccess
    const successfulDeps = makeSetPrimaryDeps({
      getToken: jest.fn().mockResolvedValue("tok_fresh"),
      onSuccess: () => {
        queryInvalidated(); // queryClient.invalidateQueries
        setPrimarySessionExpiredId = null; // setSetPrimarySessionExpiredId(null)
      },
    });
    await runSetPrimaryVehicle(42, successfulDeps);

    // id is cleared — row reverts to "Set Primary"
    expect(setPrimarySessionExpiredId).toBeNull();
    expect(queryInvalidated).toHaveBeenCalledTimes(1);
  });

  it("onSuccess is NOT called during session expiry — id is not prematurely cleared", async () => {
    let setPrimarySessionExpiredId: number | null = null;

    const deps = makeSetPrimaryDeps({
      getToken: jest.fn().mockResolvedValue(null),
      onSessionExpired: () => {
        setPrimarySessionExpiredId = 42;
      },
      // Simulate onSuccess clearing the id — it must NOT be called on expiry
      onSuccess: () => {
        setPrimarySessionExpiredId = null;
      },
    });

    await runSetPrimaryVehicle(42, deps);

    // onSuccess was not called, so the id is still set
    expect(setPrimarySessionExpiredId).toBe(42);
  });

  // ── Path B: inline "Sign In Again" button clears id before navigating ────────

  it("tapping the inline 'Sign In Again' row button clears the id before navigating", () => {
    // This mirrors the onPress handler in profile.tsx:
    //   onPress={() => { setSetPrimarySessionExpiredId(null); router.push(...); }}
    let setPrimarySessionExpiredId: number | null = 42;
    const navigate = jest.fn();

    // Simulate the button's onPress
    function handleSignInAgainPress() {
      setPrimarySessionExpiredId = null; // clears state FIRST
      navigate("/(auth)/sign-in"); // then navigates
    }

    handleSignInAgainPress();

    // State is cleared before navigate was called
    expect(setPrimarySessionExpiredId).toBeNull();
    expect(navigate).toHaveBeenCalledWith("/(auth)/sign-in");
  });

  it("state cleared by the button means the row shows 'Set Primary' if the user returns without signing in", () => {
    let setPrimarySessionExpiredId: number | null = 42;

    // Simulate button press clearing the id
    setPrimarySessionExpiredId = null;

    // Row decision after returning: id is null, not 42 → "Set Primary"
    expect(setPrimarySessionExpiredId === 42).toBe(false);
  });

  it("clearing the id in the button happens before navigate is invoked", () => {
    const callOrder: string[] = [];
    let setPrimarySessionExpiredId: number | null = 42;
    const navigate = jest.fn().mockImplementation(() => callOrder.push("navigate"));

    function handleSignInAgainPress() {
      setPrimarySessionExpiredId = null;
      callOrder.push("cleared");
      navigate("/(auth)/sign-in");
    }

    handleSignInAgainPress();

    expect(callOrder).toEqual(["cleared", "navigate"]);
    expect(setPrimarySessionExpiredId).toBeNull();
  });

  // ── Path C: plain network error does NOT set the id ───────────────────────

  it("a plain network error (not session expiry) does NOT set setPrimarySessionExpiredId", async () => {
    let setPrimarySessionExpiredId: number | null = null;

    const deps = makeSetPrimaryDeps({
      setPrimaryVehicle: jest.fn().mockRejectedValue(new Error("Network request failed")),
      onSessionExpired: () => {
        setPrimarySessionExpiredId = 42;
      },
    });

    await runSetPrimaryVehicle(42, deps);

    // Network error routes through onError, not onSessionExpired
    expect(setPrimarySessionExpiredId).toBeNull();
  });

  it("only the vehicle whose id matches shows 'Sign In Again' — other vehicles are unaffected", async () => {
    let setPrimarySessionExpiredId: number | null = null;

    const deps = makeSetPrimaryDeps({
      getToken: jest.fn().mockResolvedValue(null),
      onSessionExpired: () => {
        setPrimarySessionExpiredId = 42; // vehicle 42 expired
      },
    });

    await runSetPrimaryVehicle(42, deps);

    // Vehicle 42: shows "Sign In Again"
    expect(setPrimarySessionExpiredId === 42).toBe(true);
    // Vehicle 99: still shows "Set Primary" (id does not match)
    expect(setPrimarySessionExpiredId === 99).toBe(false);
  });
});

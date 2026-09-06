/**
 * Unit tests for guardedOTAReload — session-safe OTA reload gate.
 *
 * Confirms that reloadAsync() is never called while a charging session is
 * active (SessionContext.isActive === true), and is called immediately when
 * no session is in progress.
 */

import { guardedOTAReload } from "../utils/otaReloadGuard";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeDeps(isSessionActive: boolean) {
  return {
    isSessionActive,
    reloadAsync: jest.fn().mockResolvedValue(undefined),
    onDeferred: jest.fn(),
  };
}

// ── When no session is active — reload fires immediately ──────────────────────

describe("guardedOTAReload — no active session", () => {
  it("calls reloadAsync when session is idle", async () => {
    const deps = makeDeps(false);
    await guardedOTAReload(deps);
    expect(deps.reloadAsync).toHaveBeenCalledTimes(1);
  });

  it("returns 'reloaded'", async () => {
    const deps = makeDeps(false);
    const result = await guardedOTAReload(deps);
    expect(result).toBe("reloaded");
  });

  it("does not call onDeferred when session is idle", async () => {
    const deps = makeDeps(false);
    await guardedOTAReload(deps);
    expect(deps.onDeferred).not.toHaveBeenCalled();
  });
});

// ── When a session IS active — reload must be blocked ────────────────────────

describe("guardedOTAReload — session is active", () => {
  it("does NOT call reloadAsync when session is active", async () => {
    const deps = makeDeps(true);
    await guardedOTAReload(deps);
    expect(deps.reloadAsync).not.toHaveBeenCalled();
  });

  it("calls onDeferred when session is active", async () => {
    const deps = makeDeps(true);
    await guardedOTAReload(deps);
    expect(deps.onDeferred).toHaveBeenCalledTimes(1);
  });

  it("returns 'deferred' when session is active", async () => {
    const deps = makeDeps(true);
    const result = await guardedOTAReload(deps);
    expect(result).toBe("deferred");
  });

  it("onDeferred is called before the function resolves", async () => {
    // Ensures the UI indicator is set synchronously before awaiting completes.
    const callOrder: string[] = [];
    const onDeferred = jest.fn(() => callOrder.push("onDeferred"));
    const reloadAsync = jest.fn(async () => { callOrder.push("reloadAsync"); });
    const deps = { isSessionActive: true, reloadAsync, onDeferred };
    await guardedOTAReload(deps);
    expect(callOrder).toContain("onDeferred");
    expect(callOrder).not.toContain("reloadAsync");
  });
});

// ── Transition: session was active then ends ──────────────────────────────────
//
// The component uses a useEffect to watch session state and call reloadAsync
// once the session ends. This test verifies the guard correctly defers when
// active (the component's useEffect covers the retry after session ends).

describe("guardedOTAReload — session-active-then-idle transition", () => {
  it("blocks reload during active session", async () => {
    const deps = makeDeps(true);
    await guardedOTAReload(deps);
    expect(deps.reloadAsync).not.toHaveBeenCalled();
  });

  it("fires reload after session ends (isSessionActive=false on second call)", async () => {
    // Simulate: first call while active → deferred. Session ends → component
    // calls guardedOTAReload again with isSessionActive=false.
    const reloadAsync = jest.fn().mockResolvedValue(undefined);
    const onDeferred = jest.fn();

    // First invocation — session active
    const r1 = await guardedOTAReload({ isSessionActive: true, reloadAsync, onDeferred });
    expect(r1).toBe("deferred");
    expect(reloadAsync).not.toHaveBeenCalled();

    // Session ends — second invocation
    const r2 = await guardedOTAReload({ isSessionActive: false, reloadAsync, onDeferred });
    expect(r2).toBe("reloaded");
    expect(reloadAsync).toHaveBeenCalledTimes(1);
  });
});

// ── Periodic background checker path (OtaUpdateContext) ──────────────────────
//
// OtaUpdateContext uses the same guardedOTAReload path when the tester taps
// "Restart to update" on the background-check Alert. These tests pin that the
// guard behaves identically regardless of which UI surface triggers the reload.

describe("guardedOTAReload — periodic background checker path (OtaUpdateContext)", () => {
  it("blocks reload when session is active (background check prompt accepted)", async () => {
    const deps = makeDeps(true);
    const result = await guardedOTAReload(deps);
    expect(result).toBe("deferred");
    expect(deps.reloadAsync).not.toHaveBeenCalled();
  });

  it("calls onDeferred to queue the pending-reload indicator", async () => {
    // Simulates: tester accepts the "Restart to update" Alert mid-session.
    // OtaUpdateContext stores pendingReloadRef=true via onDeferred.
    const deps = makeDeps(true);
    await guardedOTAReload(deps);
    expect(deps.onDeferred).toHaveBeenCalledTimes(1);
  });

  it("fires reload immediately when background check fires while no session", async () => {
    // Simulates: periodic check runs, tester accepts, no active session.
    const deps = makeDeps(false);
    const result = await guardedOTAReload(deps);
    expect(result).toBe("reloaded");
    expect(deps.reloadAsync).toHaveBeenCalledTimes(1);
  });

  it("does not call onDeferred when no session is active", async () => {
    const deps = makeDeps(false);
    await guardedOTAReload(deps);
    expect(deps.onDeferred).not.toHaveBeenCalled();
  });
});

// ── Deferred UI state transitions ─────────────────────────────────────────────
//
// Confirms the guard correctly signals the difference between "deferred" and
// "reloaded" so UI callers can set the right status (never flip to "Restarting"
// when reload was deferred).

describe("guardedOTAReload — deferred UI state transitions", () => {
  it("returns 'reloaded' (not 'deferred') when session is idle — UI can safely show Restarting", async () => {
    const deps = makeDeps(false);
    const result = await guardedOTAReload(deps);
    expect(result).toBe("reloaded");
  });

  it("returns 'deferred' (not 'reloaded') when session is active — UI must NOT show Restarting", async () => {
    const deps = makeDeps(true);
    const result = await guardedOTAReload(deps);
    expect(result).toBe("deferred");
  });

  it("guard is idempotent — calling again with session still active still defers", async () => {
    const deps = makeDeps(true);
    const r1 = await guardedOTAReload(deps);
    const r2 = await guardedOTAReload(deps);
    expect(r1).toBe("deferred");
    expect(r2).toBe("deferred");
    expect(deps.reloadAsync).not.toHaveBeenCalled();
    expect(deps.onDeferred).toHaveBeenCalledTimes(2);
  });
});

// ── reloadAsync error propagation ─────────────────────────────────────────────

describe("guardedOTAReload — reloadAsync error propagation", () => {
  it("propagates errors thrown by reloadAsync when session is idle", async () => {
    const deps = {
      isSessionActive: false,
      reloadAsync: jest.fn().mockRejectedValue(new Error("OTA reload failed")),
      onDeferred: jest.fn(),
    };
    await expect(guardedOTAReload(deps)).rejects.toThrow("OTA reload failed");
  });

  it("does not reach reloadAsync (no error) when session is active", async () => {
    const deps = {
      isSessionActive: true,
      reloadAsync: jest.fn().mockRejectedValue(new Error("should not throw")),
      onDeferred: jest.fn(),
    };
    // Must not throw — reloadAsync is never called.
    await expect(guardedOTAReload(deps)).resolves.toBe("deferred");
  });
});

/**
 * Unit tests for runSavePillLayout — signed-out behaviour.
 *
 * When isSignedIn is false the function must perform a local-only save.
 * The save-failure toast (setSaveErrorVisible) must NEVER be called
 * regardless of whether AsyncStorage succeeds or fails — a signed-out
 * user can only save locally, and that is expected behaviour, not an error.
 */

import { runSavePillLayout, SavePillLayoutDeps } from "../utils/savePillLayout";
import { NavPillLayout, PillId } from "../constants/navPills";

// ── Shared helpers ────────────────────────────────────────────────────────────

const ORDER: PillId[] = ["home", "map", "charge", "activity", "account"];
const HIDDEN: PillId[] = [];
const LAYOUT: NavPillLayout = { order: ORDER, hidden: HIDDEN, savedAt: 1000000 };

function baseDeps(overrides: Partial<SavePillLayoutDeps> = {}): SavePillLayoutDeps {
  return {
    isSignedIn: false,
    getToken: jest.fn().mockResolvedValue(null),
    writeLocal: jest.fn().mockResolvedValue(true),
    patchServer: jest.fn().mockResolvedValue({ ok: true, status: 200 }),
    setSaveErrorVisible: jest.fn(),
    track: jest.fn(),
    invalidateProfile: jest.fn(),
    ...overrides,
  };
}

// ── Signed out + AsyncStorage succeeds ───────────────────────────────────────

describe("runSavePillLayout — signed out, AsyncStorage succeeds", () => {
  it("never calls setSaveErrorVisible", async () => {
    const deps = baseDeps({ writeLocal: jest.fn().mockResolvedValue(true) });
    await runSavePillLayout(LAYOUT, deps);

    expect(deps.setSaveErrorVisible).not.toHaveBeenCalled();
  });

  it("does not attempt a server PATCH", async () => {
    const deps = baseDeps({ writeLocal: jest.fn().mockResolvedValue(true) });
    await runSavePillLayout(LAYOUT, deps);

    expect(deps.patchServer).not.toHaveBeenCalled();
  });

  it("does not call getToken", async () => {
    const deps = baseDeps({ writeLocal: jest.fn().mockResolvedValue(true) });
    await runSavePillLayout(LAYOUT, deps);

    expect(deps.getToken).not.toHaveBeenCalled();
  });

  it("tracks navpill_save_complete with signed_in: false", async () => {
    const deps = baseDeps({ writeLocal: jest.fn().mockResolvedValue(true) });
    await runSavePillLayout(LAYOUT, deps);

    expect(deps.track).toHaveBeenCalledWith("navpill_save_complete", {
      signed_in: false,
    });
  });

  it("does not track navpill_save_failed", async () => {
    const deps = baseDeps({ writeLocal: jest.fn().mockResolvedValue(true) });
    await runSavePillLayout(LAYOUT, deps);

    const events = (deps.track as jest.Mock).mock.calls.map(([e]) => e);
    expect(events).not.toContain("navpill_save_failed");
  });
});

// ── Signed out + AsyncStorage fails ──────────────────────────────────────────

describe("runSavePillLayout — signed out, AsyncStorage fails", () => {
  it("never calls setSaveErrorVisible", async () => {
    const deps = baseDeps({ writeLocal: jest.fn().mockResolvedValue(false) });
    await runSavePillLayout(LAYOUT, deps);

    expect(deps.setSaveErrorVisible).not.toHaveBeenCalled();
  });

  it("does not attempt a server PATCH", async () => {
    const deps = baseDeps({ writeLocal: jest.fn().mockResolvedValue(false) });
    await runSavePillLayout(LAYOUT, deps);

    expect(deps.patchServer).not.toHaveBeenCalled();
  });

  it("tracks navpill_save_failed with stage: asyncstorage and signed_in: false", async () => {
    const deps = baseDeps({ writeLocal: jest.fn().mockResolvedValue(false) });
    await runSavePillLayout(LAYOUT, deps);

    expect(deps.track).toHaveBeenCalledWith("navpill_save_failed", {
      stage: "asyncstorage",
      signed_in: false,
    });
  });

  it("does not track navpill_save_complete", async () => {
    const deps = baseDeps({ writeLocal: jest.fn().mockResolvedValue(false) });
    await runSavePillLayout(LAYOUT, deps);

    const events = (deps.track as jest.Mock).mock.calls.map(([e]) => e);
    expect(events).not.toContain("navpill_save_complete");
  });
});

// ── Session expires mid-drag ──────────────────────────────────────────────────
// The specific failure scenario this task verifies:
//   1. User is signed-in when the drag starts.
//   2. The session expires before the drag gesture completes.
//   3. savePillLayout is called with isSignedIn=true (stale Clerk state) but
//      getToken() resolves to null (token already gone from the keychain).
//
// Expected outcome:
//   • The save-failure toast fires  (setSaveErrorVisible(true)).
//   • The server is never contacted (patchServer must not be called).
//   • navpill_save_failed is tracked with reason:"no_token".
//   • navpill_patch_request is NOT tracked (no request was attempted).

describe("runSavePillLayout — session expires mid-drag", () => {
  function midDragDeps(overrides: Partial<SavePillLayoutDeps> = {}): SavePillLayoutDeps {
    return baseDeps({
      isSignedIn: true,
      getToken: jest.fn().mockResolvedValue(null), // token gone after drag started
      writeLocal: jest.fn().mockResolvedValue(true),
      ...overrides,
    });
  }

  it("calls setSaveErrorVisible(true) — toast is shown", async () => {
    const deps = midDragDeps();
    await runSavePillLayout(LAYOUT, deps);

    expect(deps.setSaveErrorVisible).toHaveBeenCalledWith(true);
  });

  it("never calls patchServer — no headerless PATCH reaches the server", async () => {
    const deps = midDragDeps();
    await runSavePillLayout(LAYOUT, deps);

    expect(deps.patchServer).not.toHaveBeenCalled();
  });

  it("tracks navpill_save_failed with stage:patch and reason:no_token", async () => {
    const deps = midDragDeps();
    await runSavePillLayout(LAYOUT, deps);

    expect(deps.track).toHaveBeenCalledWith("navpill_save_failed", {
      stage: "patch",
      reason: "no_token",
    });
  });

  it("does not track navpill_patch_request — request was never attempted", async () => {
    const deps = midDragDeps();
    await runSavePillLayout(LAYOUT, deps);

    const events = (deps.track as jest.Mock).mock.calls.map(([e]) => e);
    expect(events).not.toContain("navpill_patch_request");
  });

  it("still writes to local storage before bailing — optimistic layout is persisted", async () => {
    const deps = midDragDeps();
    await runSavePillLayout(LAYOUT, deps);

    expect(deps.writeLocal).toHaveBeenCalledWith(LAYOUT);
  });

  it("does not call invalidateProfile", async () => {
    const deps = midDragDeps();
    await runSavePillLayout(LAYOUT, deps);

    expect(deps.invalidateProfile).not.toHaveBeenCalled();
  });

  it("calls onSessionExpired — the UI can surface a 'Sign In Again' action alongside the toast", async () => {
    const onSessionExpired = jest.fn();
    const deps = midDragDeps({ onSessionExpired });
    await runSavePillLayout(LAYOUT, deps);

    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });

  it("calls onSessionExpired BEFORE setSaveErrorVisible so the alert precedes the toast", async () => {
    const callOrder: string[] = [];
    const deps = midDragDeps({
      onSessionExpired: () => callOrder.push("onSessionExpired"),
      setSaveErrorVisible: jest.fn().mockImplementation((v) => {
        if (v) callOrder.push("setSaveErrorVisible");
      }),
    });
    await runSavePillLayout(LAYOUT, deps);

    expect(callOrder).toEqual(["onSessionExpired", "setSaveErrorVisible"]);
  });

  it("does NOT call onSessionExpired when the token is valid", async () => {
    const onSessionExpired = jest.fn();
    const deps = midDragDeps({
      getToken: jest.fn().mockResolvedValue("tok_valid"),
      patchServer: jest.fn().mockResolvedValue({ ok: true, status: 200 }),
      onSessionExpired,
    });
    await runSavePillLayout(LAYOUT, deps);

    expect(onSessionExpired).not.toHaveBeenCalled();
  });
});

// ── Reset flow — toast appears after edit sheet closes ────────────────────────
//
// The onReset handler in CustomTabBar now follows the same pattern as onDone:
//
//   onReset={() => {
//     exitEditMode();        // ← sheet closes immediately (synchronous)
//     void resetToDefault(); // ← PATCH fires in background (async)
//     return Promise.resolve();
//   }}
//
// resetToDefault() delegates to savePillLayout(DEFAULT_LAYOUT.order,
// DEFAULT_LAYOUT.hidden) → runSavePillLayout(), so the same error-handling
// path applies.  The NavSaveErrorToast lives in NavPillProvider, which is
// mounted ABOVE the navigation stack, so it stays alive and visible on
// whatever tab the user lands on after the sheet closes — even though the
// EditableTabBar component is already gone.
//
// These tests confirm that all three failure modes (no token / non-ok PATCH /
// network throw) still set setSaveErrorVisible(true), i.e. the toast fires on
// the screen the user reaches after the Reset action.

describe("runSavePillLayout — Reset flow: save error appears after edit sheet closes", () => {
  // Model DEFAULT_LAYOUT (the layout that resetToDefault passes)
  const DEFAULT_ORDER: PillId[] = ["home", "map", "charge", "activity", "account"];
  const DEFAULT_HIDDEN: PillId[] = [];
  const DEFAULT_NAV_LAYOUT: NavPillLayout = { order: DEFAULT_ORDER, hidden: DEFAULT_HIDDEN };

  function resetDeps(overrides: Partial<SavePillLayoutDeps> = {}): SavePillLayoutDeps {
    return baseDeps({
      isSignedIn: true,
      getToken: jest.fn().mockResolvedValue("tok_valid"),
      writeLocal: jest.fn().mockResolvedValue(true),
      patchServer: jest.fn().mockResolvedValue({ ok: true, status: 200 }),
      ...overrides,
    });
  }

  // ── [1] PATCH returns a server error (e.g. 500 Internal Server Error) ──────
  // The edit sheet is already closed when the response arrives.
  // setSaveErrorVisible(true) must still be called so the toast appears
  // on the current tab.

  it("calls setSaveErrorVisible(true) when PATCH returns a non-ok status", async () => {
    const deps = resetDeps({
      patchServer: jest.fn().mockResolvedValue({ ok: false, status: 500 }),
    });
    await runSavePillLayout(DEFAULT_NAV_LAYOUT, deps);

    expect(deps.setSaveErrorVisible).toHaveBeenCalledWith(true);
  });

  it("does not call invalidateProfile when PATCH returns non-ok", async () => {
    const deps = resetDeps({
      patchServer: jest.fn().mockResolvedValue({ ok: false, status: 500 }),
    });
    await runSavePillLayout(DEFAULT_NAV_LAYOUT, deps);

    expect(deps.invalidateProfile).not.toHaveBeenCalled();
  });

  // ── [2] Network-level error (fetch throws) ─────────────────────────────────
  // A timeout or connectivity drop while the sheet is already gone.
  // The catch branch must set setSaveErrorVisible(true).

  it("calls setSaveErrorVisible(true) when patchServer throws a network error", async () => {
    const deps = resetDeps({
      patchServer: jest.fn().mockRejectedValue(new Error("Network request failed")),
    });
    await runSavePillLayout(DEFAULT_NAV_LAYOUT, deps);

    expect(deps.setSaveErrorVisible).toHaveBeenCalledWith(true);
  });

  it("tracks navpill_save_failed with error message when patchServer throws", async () => {
    const deps = resetDeps({
      patchServer: jest.fn().mockRejectedValue(new Error("Network request failed")),
    });
    await runSavePillLayout(DEFAULT_NAV_LAYOUT, deps);

    expect(deps.track).toHaveBeenCalledWith("navpill_save_failed", {
      stage: "patch",
      error: "Network request failed",
    });
  });

  // ── [3] Session expires mid-reset (no token) ───────────────────────────────
  // The user was signed in when they tapped Reset, but the token expired
  // before getToken() resolved.  The PATCH must NOT be attempted, and the
  // toast must still fire.

  it("calls setSaveErrorVisible(true) when the session expires during reset (no token)", async () => {
    const deps = resetDeps({
      getToken: jest.fn().mockResolvedValue(null),
    });
    await runSavePillLayout(DEFAULT_NAV_LAYOUT, deps);

    expect(deps.setSaveErrorVisible).toHaveBeenCalledWith(true);
  });

  it("never calls patchServer when the session token is missing during reset", async () => {
    const deps = resetDeps({
      getToken: jest.fn().mockResolvedValue(null),
    });
    await runSavePillLayout(DEFAULT_NAV_LAYOUT, deps);

    expect(deps.patchServer).not.toHaveBeenCalled();
  });

  // ── [4] Happy path — successful Reset should NOT show the toast ───────────

  it("does NOT call setSaveErrorVisible when the Reset PATCH succeeds", async () => {
    const deps = resetDeps();
    await runSavePillLayout(DEFAULT_NAV_LAYOUT, deps);

    expect(deps.setSaveErrorVisible).not.toHaveBeenCalled();
  });

  it("calls invalidateProfile after a successful Reset PATCH", async () => {
    const deps = resetDeps();
    await runSavePillLayout(DEFAULT_NAV_LAYOUT, deps);

    expect(deps.invalidateProfile).toHaveBeenCalled();
  });
});

// ── onReset handler — exitEditMode fires before patchServer ──────────────────
//
// makeResetHandler (exported from CustomTabBar) is the exact function that
// is passed as the `onReset` prop to EditableTabBar.  Testing it directly
// means a future refactor that reorders the calls (e.g. awaiting exitEditMode
// or moving resetToDefault before exitEditMode) will break this test.
//
// The ordering guarantee:
//   exitEditMode()        — synchronous, fires first
//   void resetToDefault() — starts async chain: getToken → writeLocal → PATCH
//
// Because patchServer is only reached after several awaits, it is always
// scheduled after exitEditMode has already returned.

import { makeResetHandler } from "../utils/makeResetHandler";
import { makeDoneHandler } from "../utils/makeDoneHandler";

describe("makeResetHandler (CustomTabBar onReset) — exitEditMode fires before patchServer", () => {
  const DEFAULT_ORDER: PillId[] = ["home", "map", "charge", "activity", "account"];
  const DEFAULT_HIDDEN: PillId[] = [];
  const DEFAULT_NAV_LAYOUT: NavPillLayout = { order: DEFAULT_ORDER, hidden: DEFAULT_HIDDEN };

  it("records exitEditMode before patchServer in the call-order log", async () => {
    const callOrder: string[] = [];

    const exitEditMode = jest.fn(() => {
      callOrder.push("exitEditMode");
    });

    const patchServer = jest.fn(async () => {
      callOrder.push("patchServer");
      return { ok: true, status: 200 };
    });

    const deps = baseDeps({
      isSignedIn: true,
      getToken: jest.fn().mockResolvedValue("tok_valid"),
      writeLocal: jest.fn().mockResolvedValue(true),
      patchServer,
    });

    // resetToDefault mirrors NavPillContext: delegates to runSavePillLayout.
    // We capture the inner promise so we can await it after the handler fires.
    // (The handler uses `void resetToDefault()` — it does not await the chain,
    //  so `await handler()` alone would resolve before patchServer ever runs.)
    let resetSettled!: Promise<void>;
    const resetToDefault = async () => {
      resetSettled = runSavePillLayout(DEFAULT_NAV_LAYOUT, deps);
      await resetSettled;
    };

    // Invoke the REAL production handler from makeResetHandler, then wait for
    // the full async chain (getToken → writeLocal → patchServer) to complete.
    const handler = makeResetHandler(exitEditMode, resetToDefault);
    handler(); // fire the handler — exitEditMode runs synchronously here
    await resetSettled; // wait for the full async save chain to settle

    expect(callOrder.indexOf("exitEditMode")).toBeLessThan(
      callOrder.indexOf("patchServer"),
    );
  });

  it("exitEditMode is already called before any microtask in resetToDefault settles", async () => {
    // Verify the synchronous-first property: by the time the first await
    // inside resetToDefault yields, exitEditMode has already been recorded.
    const callOrder: string[] = [];

    const exitEditMode = jest.fn(() => {
      callOrder.push("exitEditMode");
    });

    // getToken is the very first await; record "getToken_start" at that point.
    const getToken = jest.fn(async () => {
      callOrder.push("getToken_start");
      return "tok_valid";
    });

    const deps = baseDeps({
      isSignedIn: true,
      getToken,
      writeLocal: jest.fn().mockResolvedValue(true),
      patchServer: jest.fn().mockResolvedValue({ ok: true, status: 200 }),
    });

    const resetToDefault = async () => {
      await runSavePillLayout(DEFAULT_NAV_LAYOUT, deps);
    };

    const handler = makeResetHandler(exitEditMode, resetToDefault);
    await handler();

    // exitEditMode must have been recorded before the first await in
    // resetToDefault even yielded.
    expect(callOrder.indexOf("exitEditMode")).toBeLessThan(
      callOrder.indexOf("getToken_start"),
    );
  });
});

// ── Retry happy path — PATCH succeeds on the second attempt ──────────────────
//
// After a failed save the NavPillProvider stores the layout in
// lastAttemptedLayoutRef.  When the user taps Retry the ref's value is passed
// back to savePillLayout (via runSavePillLayout) unchanged, so the exact same
// order/hidden pair is sent to the server.
//
// This suite verifies:
//   a) The layout forwarded to patchServer matches what was passed to
//      runSavePillLayout (i.e. lastAttemptedLayoutRef is replayed correctly).
//   b) When the PATCH succeeds, setSaveErrorVisible is NOT called with true —
//      the toast must remain hidden after a successful retry.
//   c) invalidateProfile is called after a successful retry PATCH.
//   d) When the PATCH fails a second time, setSaveErrorVisible(true) is called
//      again so the toast reappears with the Retry button still available.

describe("runSavePillLayout — Retry happy path (PATCH succeeds on retry)", () => {
  const RETRY_ORDER: PillId[] = ["map", "charge", "home", "activity", "account"];
  const RETRY_HIDDEN: PillId[] = ["activity"];
  const RETRY_LAYOUT: NavPillLayout = {
    order: RETRY_ORDER,
    hidden: RETRY_HIDDEN,
    savedAt: 2000000,
  };

  function retryDeps(overrides: Partial<SavePillLayoutDeps> = {}): SavePillLayoutDeps {
    return baseDeps({
      isSignedIn: true,
      getToken: jest.fn().mockResolvedValue("tok_refreshed"),
      writeLocal: jest.fn().mockResolvedValue(true),
      patchServer: jest.fn().mockResolvedValue({ ok: true, status: 200 }),
      ...overrides,
    });
  }

  it("passes the exact order/hidden from lastAttemptedLayoutRef to patchServer", async () => {
    const deps = retryDeps();
    await runSavePillLayout(RETRY_LAYOUT, deps);

    expect(deps.patchServer).toHaveBeenCalledWith(
      "tok_refreshed",
      expect.objectContaining({
        order: RETRY_ORDER,
        hidden: RETRY_HIDDEN,
      }),
    );
  });

  it("does NOT call setSaveErrorVisible when the retry PATCH succeeds", async () => {
    const deps = retryDeps();
    await runSavePillLayout(RETRY_LAYOUT, deps);

    expect(deps.setSaveErrorVisible).not.toHaveBeenCalled();
  });

  it("calls invalidateProfile after the retry PATCH succeeds", async () => {
    const deps = retryDeps();
    await runSavePillLayout(RETRY_LAYOUT, deps);

    expect(deps.invalidateProfile).toHaveBeenCalledTimes(1);
  });

  it("tracks navpill_save_complete with signed_in: true on successful retry", async () => {
    const deps = retryDeps();
    await runSavePillLayout(RETRY_LAYOUT, deps);

    expect(deps.track).toHaveBeenCalledWith("navpill_save_complete", {
      signed_in: true,
    });
  });
});

// ── Retry failure path — PATCH fails again on the second attempt ──────────────
//
// If the server is still unhappy on retry, setSaveErrorVisible(true) must fire
// again so the toast reappears and the Retry button remains accessible.

describe("runSavePillLayout — Retry failure path (PATCH fails again)", () => {
  const RETRY_ORDER: PillId[] = ["map", "charge", "home", "activity", "account"];
  const RETRY_HIDDEN: PillId[] = ["activity"];
  const RETRY_LAYOUT: NavPillLayout = {
    order: RETRY_ORDER,
    hidden: RETRY_HIDDEN,
    savedAt: 2000000,
  };

  function retryFailDeps(overrides: Partial<SavePillLayoutDeps> = {}): SavePillLayoutDeps {
    return baseDeps({
      isSignedIn: true,
      getToken: jest.fn().mockResolvedValue("tok_refreshed"),
      writeLocal: jest.fn().mockResolvedValue(true),
      patchServer: jest.fn().mockResolvedValue({ ok: false, status: 503 }),
      ...overrides,
    });
  }

  it("calls setSaveErrorVisible(true) so the toast reappears with Retry still available", async () => {
    const deps = retryFailDeps();
    await runSavePillLayout(RETRY_LAYOUT, deps);

    expect(deps.setSaveErrorVisible).toHaveBeenCalledWith(true);
  });

  it("does NOT call invalidateProfile when the retry PATCH fails", async () => {
    const deps = retryFailDeps();
    await runSavePillLayout(RETRY_LAYOUT, deps);

    expect(deps.invalidateProfile).not.toHaveBeenCalled();
  });

  it("calls setSaveErrorVisible(true) when the retry patchServer throws", async () => {
    const deps = retryFailDeps({
      patchServer: jest.fn().mockRejectedValue(new Error("still offline")),
    });
    await runSavePillLayout(RETRY_LAYOUT, deps);

    expect(deps.setSaveErrorVisible).toHaveBeenCalledWith(true);
  });
});

// ── onDone handler — exitEditMode fires before patchServer ───────────────────
//
// makeDoneHandler (exported from utils/makeDoneHandler) is the exact function
// that is passed as the `onDone` prop to EditableTabBar.  Testing it directly
// means a future refactor that reorders the calls (e.g. awaiting exitEditMode
// or moving savePillLayout before exitEditMode) will break this test.
//
// The ordering guarantee (mirrors the onReset guarantee):
//   exitEditMode()              — synchronous, fires first
//   void savePillLayout(o, h)  — starts async chain: getToken → writeLocal → PATCH
//
// Because patchServer is only reached after several awaits, it is always
// scheduled after exitEditMode has already returned.

describe("makeDoneHandler (CustomTabBar onDone) — exitEditMode fires before patchServer", () => {
  const DONE_ORDER: PillId[] = ["charge", "map", "home", "activity", "account"];
  const DONE_HIDDEN: PillId[] = ["activity"];
  const DONE_NAV_LAYOUT: NavPillLayout = { order: DONE_ORDER, hidden: DONE_HIDDEN };

  it("records exitEditMode before patchServer in the call-order log", async () => {
    const callOrder: string[] = [];

    const exitEditMode = jest.fn(() => {
      callOrder.push("exitEditMode");
    });

    const patchServer = jest.fn(async () => {
      callOrder.push("patchServer");
      return { ok: true, status: 200 };
    });

    const deps = baseDeps({
      isSignedIn: true,
      getToken: jest.fn().mockResolvedValue("tok_valid"),
      writeLocal: jest.fn().mockResolvedValue(true),
      patchServer,
    });

    // savePillLayout mirrors NavPillContext: delegates to runSavePillLayout.
    // We capture the inner promise so we can await it after the handler fires.
    // (The handler uses `void savePillLayout(o, h)` — it does not await the
    //  chain, so `await handler(o, h)` alone would resolve before patchServer
    //  ever runs.)
    let saveSettled!: Promise<void>;
    const savePillLayout = async (order: PillId[], hidden: PillId[]) => {
      saveSettled = runSavePillLayout(DONE_NAV_LAYOUT, deps);
      await saveSettled;
    };

    // Invoke the REAL production handler from makeDoneHandler, then wait for
    // the full async chain (getToken → writeLocal → patchServer) to complete.
    const handler = makeDoneHandler(exitEditMode, savePillLayout);
    handler(DONE_ORDER, DONE_HIDDEN); // fire handler — exitEditMode runs synchronously here
    await saveSettled; // wait for the full async save chain to settle

    expect(callOrder.indexOf("exitEditMode")).toBeLessThan(
      callOrder.indexOf("patchServer"),
    );
  });

  it("exitEditMode is already called before any microtask in savePillLayout settles", async () => {
    // Verify the synchronous-first property: by the time the first await
    // inside savePillLayout yields, exitEditMode has already been recorded.
    const callOrder: string[] = [];

    const exitEditMode = jest.fn(() => {
      callOrder.push("exitEditMode");
    });

    // getToken is the very first await; record "getToken_start" at that point.
    const getToken = jest.fn(async () => {
      callOrder.push("getToken_start");
      return "tok_valid";
    });

    const deps = baseDeps({
      isSignedIn: true,
      getToken,
      writeLocal: jest.fn().mockResolvedValue(true),
      patchServer: jest.fn().mockResolvedValue({ ok: true, status: 200 }),
    });

    const savePillLayout = async (order: PillId[], hidden: PillId[]) => {
      await runSavePillLayout(DONE_NAV_LAYOUT, deps);
    };

    const handler = makeDoneHandler(exitEditMode, savePillLayout);
    await handler(DONE_ORDER, DONE_HIDDEN);

    // exitEditMode must have been recorded before the first await in
    // savePillLayout even yielded.
    expect(callOrder.indexOf("exitEditMode")).toBeLessThan(
      callOrder.indexOf("getToken_start"),
    );
  });
});

// ── Signed in sanity check: toast fires on server error ───────────────────────
// These are not the focus of this task but confirm setSaveErrorVisible is
// wired correctly so the signed-out suppression is meaningful.

describe("runSavePillLayout — signed in, server PATCH fails", () => {
  it("calls setSaveErrorVisible(true) when the PATCH returns non-ok", async () => {
    const deps = baseDeps({
      isSignedIn: true,
      getToken: jest.fn().mockResolvedValue("tok_valid"),
      writeLocal: jest.fn().mockResolvedValue(true),
      patchServer: jest.fn().mockResolvedValue({ ok: false, status: 500 }),
    });
    await runSavePillLayout(LAYOUT, deps);

    expect(deps.setSaveErrorVisible).toHaveBeenCalledWith(true);
  });

  it("calls setSaveErrorVisible(true) when getToken returns null", async () => {
    const deps = baseDeps({
      isSignedIn: true,
      getToken: jest.fn().mockResolvedValue(null),
      writeLocal: jest.fn().mockResolvedValue(true),
    });
    await runSavePillLayout(LAYOUT, deps);

    expect(deps.setSaveErrorVisible).toHaveBeenCalledWith(true);
  });

  it("calls setSaveErrorVisible(true) when patchServer throws", async () => {
    const deps = baseDeps({
      isSignedIn: true,
      getToken: jest.fn().mockResolvedValue("tok_valid"),
      writeLocal: jest.fn().mockResolvedValue(true),
      patchServer: jest.fn().mockRejectedValue(new Error("Network error")),
    });
    await runSavePillLayout(LAYOUT, deps);

    expect(deps.setSaveErrorVisible).toHaveBeenCalledWith(true);
  });
});

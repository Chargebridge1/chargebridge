/**
 * Unit tests for runUpdateReview.
 *
 * These tests confirm two critical behaviours when getToken() returns null
 * mid-form (i.e. the Clerk session expires while the user is editing a review):
 *
 *   1. onSessionExpired is called so the UI can replace Save with "Sign In Again".
 *   2. onError is called with a session-expired message so the Alert fires.
 *   3. onSuccess is NOT called — the edit form stays open for the user to retry.
 *
 * The network layer (patchReview) is fully stubbed, so these tests run in Node
 * without any React Native environment.
 */

import {
  runUpdateReview,
  type UpdateReviewDeps,
  type ReviewData,
} from "../utils/reviewMutations";

// ── Shared fixtures ───────────────────────────────────────────────────────────

const REVIEW_DATA: ReviewData = {
  rating: 4,
  comment: "Great charger, fast and reliable.",
};

const REVIEW_RESPONSE = { id: 7, stationId: 3, rating: 4, comment: "Great charger, fast and reliable." };

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeDeps(overrides: Partial<UpdateReviewDeps> = {}): UpdateReviewDeps {
  return {
    getToken: jest.fn().mockResolvedValue("tok_valid"),
    patchReview: jest.fn().mockResolvedValue(REVIEW_RESPONSE),
    onSuccess: jest.fn(),
    onError: jest.fn(),
    track: jest.fn(),
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// getToken() returns null — session expired mid-edit
// ═══════════════════════════════════════════════════════════════════════════════

describe("runUpdateReview — getToken() returns null (session expired mid-edit)", () => {
  it("calls onError with the session-expired message", async () => {
    const deps = makeDeps({ getToken: jest.fn().mockResolvedValue(null) });
    await runUpdateReview(7, REVIEW_DATA, deps);

    expect(deps.onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Your session has expired. Please sign in again to save your review.",
      }),
    );
  });

  it("does NOT call onSuccess — the edit form stays open", async () => {
    const deps = makeDeps({ getToken: jest.fn().mockResolvedValue(null) });
    await runUpdateReview(7, REVIEW_DATA, deps);

    expect(deps.onSuccess).not.toHaveBeenCalled();
  });

  it("does NOT call patchReview — the network is never touched", async () => {
    const deps = makeDeps({ getToken: jest.fn().mockResolvedValue(null) });
    await runUpdateReview(7, REVIEW_DATA, deps);

    expect(deps.patchReview).not.toHaveBeenCalled();
  });

  it("tracks profile_editreview_no_token", async () => {
    const deps = makeDeps({ getToken: jest.fn().mockResolvedValue(null) });
    await runUpdateReview(7, REVIEW_DATA, deps);

    expect(deps.track).toHaveBeenCalledWith("profile_editreview_no_token", {});
  });

  it("does NOT track profile_editreview_complete", async () => {
    const deps = makeDeps({ getToken: jest.fn().mockResolvedValue(null) });
    await runUpdateReview(7, REVIEW_DATA, deps);

    const events = (deps.track as jest.Mock).mock.calls.map(([e]) => e);
    expect(events).not.toContain("profile_editreview_complete");
  });

  it("calls onSessionExpired — the UI can replace the button with 'Sign In Again'", async () => {
    const onSessionExpired = jest.fn();
    const deps = makeDeps({ getToken: jest.fn().mockResolvedValue(null), onSessionExpired });
    await runUpdateReview(7, REVIEW_DATA, deps);

    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });

  it("calls onSessionExpired BEFORE onError so the button state is set before the alert fires", async () => {
    const callOrder: string[] = [];
    const deps = makeDeps({
      getToken: jest.fn().mockResolvedValue(null),
      onSessionExpired: () => callOrder.push("onSessionExpired"),
      onError: jest.fn().mockImplementation(() => callOrder.push("onError")),
    });
    await runUpdateReview(7, REVIEW_DATA, deps);

    expect(callOrder).toEqual(["onSessionExpired", "onError"]);
  });

  it("does NOT call onSessionExpired when the token is valid", async () => {
    const onSessionExpired = jest.fn();
    const deps = makeDeps({ onSessionExpired });
    await runUpdateReview(7, REVIEW_DATA, deps);

    expect(onSessionExpired).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getToken() throws — token acquisition error
// ═══════════════════════════════════════════════════════════════════════════════

describe("runUpdateReview — getToken() throws (token acquisition error)", () => {
  it("calls onError with the thrown error", async () => {
    const tokenErr = new Error("Network error during token refresh");
    const deps = makeDeps({ getToken: jest.fn().mockRejectedValue(tokenErr) });
    await runUpdateReview(7, REVIEW_DATA, deps);

    expect(deps.onError).toHaveBeenCalledWith(tokenErr);
  });

  it("does NOT call onSuccess", async () => {
    const deps = makeDeps({
      getToken: jest.fn().mockRejectedValue(new Error("Token error")),
    });
    await runUpdateReview(7, REVIEW_DATA, deps);

    expect(deps.onSuccess).not.toHaveBeenCalled();
  });

  it("does NOT call patchReview", async () => {
    const deps = makeDeps({
      getToken: jest.fn().mockRejectedValue(new Error("Token error")),
    });
    await runUpdateReview(7, REVIEW_DATA, deps);

    expect(deps.patchReview).not.toHaveBeenCalled();
  });

  it("tracks profile_editreview_token_error", async () => {
    const deps = makeDeps({
      getToken: jest.fn().mockRejectedValue(new Error("Token error")),
    });
    await runUpdateReview(7, REVIEW_DATA, deps);

    expect(deps.track).toHaveBeenCalledWith(
      "profile_editreview_token_error",
      expect.objectContaining({ error: "Token error" }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Happy path — valid token
// ═══════════════════════════════════════════════════════════════════════════════

describe("runUpdateReview — happy path (valid token)", () => {
  it("calls onSuccess after a successful patch", async () => {
    const deps = makeDeps();
    await runUpdateReview(7, REVIEW_DATA, deps);

    expect(deps.onSuccess).toHaveBeenCalledTimes(1);
  });

  it("does NOT call onError", async () => {
    const deps = makeDeps();
    await runUpdateReview(7, REVIEW_DATA, deps);

    expect(deps.onError).not.toHaveBeenCalled();
  });

  it("passes the token, review id, and data to patchReview", async () => {
    const deps = makeDeps();
    await runUpdateReview(7, REVIEW_DATA, deps);

    expect(deps.patchReview).toHaveBeenCalledWith("tok_valid", 7, REVIEW_DATA);
  });

  it("tracks profile_editreview_complete with review_id", async () => {
    const deps = makeDeps();
    await runUpdateReview(7, REVIEW_DATA, deps);

    expect(deps.track).toHaveBeenCalledWith("profile_editreview_complete", { review_id: 7 });
  });

  it("does NOT call onSessionExpired on success", async () => {
    const onSessionExpired = jest.fn();
    const deps = makeDeps({ onSessionExpired });
    await runUpdateReview(7, REVIEW_DATA, deps);

    expect(onSessionExpired).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// patchReview throws — network / server error
// ═══════════════════════════════════════════════════════════════════════════════

describe("runUpdateReview — patchReview throws (network / server error)", () => {
  it("calls onError with the thrown error", async () => {
    const deps = makeDeps({
      patchReview: jest.fn().mockRejectedValue(new Error("Network request failed")),
    });
    await runUpdateReview(7, REVIEW_DATA, deps);

    expect(deps.onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Network request failed" }),
    );
  });

  it("does NOT call onSuccess — the edit form stays open for retry", async () => {
    const deps = makeDeps({
      patchReview: jest.fn().mockRejectedValue(new Error("Server error")),
    });
    await runUpdateReview(7, REVIEW_DATA, deps);

    expect(deps.onSuccess).not.toHaveBeenCalled();
  });

  it("does NOT call onSessionExpired on a network error", async () => {
    const onSessionExpired = jest.fn();
    const deps = makeDeps({
      patchReview: jest.fn().mockRejectedValue(new Error("Network request failed")),
      onSessionExpired,
    });
    await runUpdateReview(7, REVIEW_DATA, deps);

    expect(onSessionExpired).not.toHaveBeenCalled();
  });
});

describe("runUpdateReview — patchReview wraps fetch() network failure with friendly copy", () => {
  const FRIENDLY = "Check your connection and try again.";

  it("onError receives the friendly message when fetch throws", async () => {
    const deps = makeDeps({
      patchReview: jest.fn().mockRejectedValue(new Error(FRIENDLY)),
    });
    await runUpdateReview(7, REVIEW_DATA, deps);

    expect(deps.onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: FRIENDLY }),
    );
  });

  it("does NOT call onSuccess when fetch throws", async () => {
    const deps = makeDeps({
      patchReview: jest.fn().mockRejectedValue(new Error(FRIENDLY)),
    });
    await runUpdateReview(7, REVIEW_DATA, deps);

    expect(deps.onSuccess).not.toHaveBeenCalled();
  });
});

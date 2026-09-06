import {
  AuthFinalizeError,
  finalizeCompletedSignIn,
  type FinalizableSignIn,
} from "../utils/finalizeSignIn";

function completedSignIn(
  options: {
    finalizeError?: unknown;
    sessionId?: string | null;
  } = {},
): FinalizableSignIn {
  const { finalizeError = null, sessionId = "session_123" } = options;
  return {
    status: "complete",
    finalize: jest.fn(async (params) => {
      if (sessionId) {
        await params?.navigate?.({
          session: { id: sessionId },
          decorateUrl: (url) => url,
        });
      }
      return { error: finalizeError };
    }),
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("finalizeCompletedSignIn", () => {
  it("finalizes, confirms the active session, then starts the existing profile-loading route", async () => {
    const signIn = completedSignIn();
    const onAuthenticated = jest.fn();

    await finalizeCompletedSignIn({
      signIn,
      getActiveSessionId: () => "session_123",
      onAuthenticated,
      waitForSession: async () => {},
    });

    expect(signIn.finalize).toHaveBeenCalledWith({
      navigate: expect.any(Function),
    });
    expect(onAuthenticated).toHaveBeenCalledTimes(1);
  });

  it("surfaces an incomplete sign-in status and does not finalize or load the profile", async () => {
    const signIn: FinalizableSignIn = {
      status: "needs_second_factor",
      finalize: jest.fn(),
    };
    const onAuthenticated = jest.fn();

    await expect(finalizeCompletedSignIn({
      signIn,
      getActiveSessionId: () => null,
      onAuthenticated,
      waitForSession: async () => {},
    })).rejects.toMatchObject({
      category: "incomplete_sign_in",
    });

    expect(signIn.finalize).not.toHaveBeenCalled();
    expect(onAuthenticated).not.toHaveBeenCalled();
  });

  it("surfaces finalization failure and does not load the profile", async () => {
    const signIn = completedSignIn({
      finalizeError: new Error("Clerk finalization failed"),
    });
    const onAuthenticated = jest.fn();

    await expect(finalizeCompletedSignIn({
      signIn,
      getActiveSessionId: () => "session_123",
      onAuthenticated,
      waitForSession: async () => {},
    })).rejects.toEqual(expect.objectContaining({
      category: "finalization_failed",
    }));

    expect(onAuthenticated).not.toHaveBeenCalled();
  });

  it("surfaces a missing active session after finalization", async () => {
    const signIn = completedSignIn();
    const onAuthenticated = jest.fn();

    await expect(finalizeCompletedSignIn({
      signIn,
      getActiveSessionId: () => null,
      onAuthenticated,
      waitForSession: async () => {},
      maxSessionChecks: 2,
    })).rejects.toMatchObject({
      category: "missing_active_session",
    });

    expect(onAuthenticated).not.toHaveBeenCalled();
  });

  it("waits for authentication before starting the profile-loading route", async () => {
    const signIn = completedSignIn();
    const onAuthenticated = jest.fn();
    const observedSessionIds = [null, null, "session_123"];
    let sessionCheck = 0;

    await finalizeCompletedSignIn({
      signIn,
      getActiveSessionId: () => observedSessionIds[sessionCheck++] ?? null,
      onAuthenticated,
      waitForSession: async () => {},
      maxSessionChecks: observedSessionIds.length,
    });

    expect(sessionCheck).toBe(3);
    expect(onAuthenticated).toHaveBeenCalledTimes(1);
  });
});
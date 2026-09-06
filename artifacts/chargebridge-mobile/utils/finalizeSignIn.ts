type SignInStatus = string | null;

type FinalizeSession = {
  id: string;
};

type FinalizeNavigateParams = {
  session: FinalizeSession;
  decorateUrl: (url: string) => string;
};

export type FinalizableSignIn = {
  status: SignInStatus;
  finalize: (params?: {
    navigate?: (params: FinalizeNavigateParams) => void | Promise<unknown>;
  }) => Promise<{ error: unknown | null }>;
};

export type AuthFinalizeErrorCategory =
  | "incomplete_sign_in"
  | "finalization_failed"
  | "missing_active_session";

export class AuthFinalizeError extends Error {
  constructor(
    readonly category: AuthFinalizeErrorCategory,
    message: string,
  ) {
    super(message);
    this.name = "AuthFinalizeError";
  }
}

type FinalizeCompletedSignInOptions = {
  signIn: FinalizableSignIn;
  getActiveSessionId: () => string | null | undefined;
  onAuthenticated: () => void | Promise<void>;
  waitForSession?: () => Promise<void>;
  maxSessionChecks?: number;
};

const SESSION_CHECK_DELAY_MS = 50;
const DEFAULT_MAX_SESSION_CHECKS = 20;

function incompleteStatusMessage(status: SignInStatus): string {
  if (status === "needs_second_factor" || status === "needs_client_trust") {
    return "Additional verification is required to finish sign-in.";
  }
  if (status === "needs_new_password") {
    return "A password update is required before sign-in can finish. Please use another sign-in method.";
  }
  return "Sign-in needs an additional step that is not supported here. Please use another sign-in method.";
}

function defaultWaitForSession(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, SESSION_CHECK_DELAY_MS));
}

/**
 * Finalizes a completed Clerk sign-in and invokes the existing post-auth route
 * only after the session supplied by Clerk is observable as the active session.
 */
export async function finalizeCompletedSignIn({
  signIn,
  getActiveSessionId,
  onAuthenticated,
  waitForSession = defaultWaitForSession,
  maxSessionChecks = DEFAULT_MAX_SESSION_CHECKS,
}: FinalizeCompletedSignInOptions): Promise<void> {
  if (signIn.status !== "complete") {
    console.warn("[AuthFinalize]", {
      complete: false,
      sessionActive: false,
      errorCategory: "incomplete_sign_in",
    });
    throw new AuthFinalizeError(
      "incomplete_sign_in",
      incompleteStatusMessage(signIn.status),
    );
  }

  let finalizedSessionId: string | null = null;
  const { error } = await signIn.finalize({
    navigate: ({ session }) => {
      finalizedSessionId = session?.id ?? null;
    },
  });

  if (error) {
    console.warn("[AuthFinalize]", {
      complete: true,
      sessionActive: false,
      errorCategory: "finalization_failed",
    });
    throw new AuthFinalizeError(
      "finalization_failed",
      "We could not finish signing you in. Please try again.",
    );
  }

  for (let check = 0; check < maxSessionChecks; check += 1) {
    const activeSessionId = getActiveSessionId();
    if (finalizedSessionId && activeSessionId === finalizedSessionId) {
      console.info("[AuthFinalize]", {
        complete: true,
        sessionActive: true,
        errorCategory: null,
      });
      await onAuthenticated();
      return;
    }
    await waitForSession();
  }

  console.warn("[AuthFinalize]", {
    complete: true,
    sessionActive: false,
    errorCategory: "missing_active_session",
  });
  throw new AuthFinalizeError(
    "missing_active_session",
    "Sign-in completed, but your session was not ready. Please try again.",
  );
}
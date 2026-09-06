export type AdditionalVerificationMethod = "email_code" | "totp";
export type AdditionalVerificationReason =
  | "needs_second_factor"
  | "needs_client_trust";

type SupportedSecondFactor = {
  strategy: string;
};

type ClerkOperationResult = Promise<{ error: unknown | null }>;

export type AdditionalVerificationSignIn = {
  status: string | null;
  supportedSecondFactors: SupportedSecondFactor[];
  mfa: {
    sendEmailCode: () => ClerkOperationResult;
    verifyEmailCode: (params: { code: string }) => ClerkOperationResult;
    verifyTOTP: (params: { code: string }) => ClerkOperationResult;
  };
};

export type AdditionalVerificationState = {
  method: AdditionalVerificationMethod;
  reason: AdditionalVerificationReason;
};

export type AuthContinuationErrorCategory =
  | "unsupported_sign_in_status"
  | "unsupported_verification_method"
  | "verification_send_failed"
  | "verification_failed"
  | "verification_incomplete";

export class AuthContinuationError extends Error {
  constructor(
    readonly category: AuthContinuationErrorCategory,
    message: string,
  ) {
    super(message);
    this.name = "AuthContinuationError";
  }
}

function isAdditionalVerificationReason(
  status: string | null,
): status is AdditionalVerificationReason {
  return status === "needs_second_factor" || status === "needs_client_trust";
}

export async function beginAdditionalVerification(
  signIn: AdditionalVerificationSignIn,
): Promise<AdditionalVerificationState | null> {
  if (signIn.status === "complete") return null;

  if (!isAdditionalVerificationReason(signIn.status)) {
    console.warn("[AuthContinuation]", {
      statusCategory: signIn.status ?? "unknown",
      verificationAvailable: false,
      errorCategory: "unsupported_sign_in_status",
    });
    throw new AuthContinuationError(
      "unsupported_sign_in_status",
      "Sign-in needs an additional step that is not supported here.",
    );
  }

  const reason = signIn.status;
  const supportsEmailCode = signIn.supportedSecondFactors.some(
    ({ strategy }) => strategy === "email_code",
  );
  const supportsTotp = signIn.supportedSecondFactors.some(
    ({ strategy }) => strategy === "totp",
  );

  if (supportsEmailCode) {
    const { error } = await signIn.mfa.sendEmailCode();
    if (error) {
      console.warn("[AuthContinuation]", {
        statusCategory: reason,
        verificationAvailable: true,
        errorCategory: "verification_send_failed",
      });
      throw new AuthContinuationError(
        "verification_send_failed",
        "We could not send the verification code. Please try again.",
      );
    }
    console.info("[AuthContinuation]", {
      statusCategory: reason,
      verificationAvailable: true,
      errorCategory: null,
    });
    return { method: "email_code", reason };
  }

  if (supportsTotp) {
    console.info("[AuthContinuation]", {
      statusCategory: reason,
      verificationAvailable: true,
      errorCategory: null,
    });
    return { method: "totp", reason };
  }

  console.warn("[AuthContinuation]", {
    statusCategory: reason,
    verificationAvailable: false,
    errorCategory: "unsupported_verification_method",
  });
  throw new AuthContinuationError(
    "unsupported_verification_method",
    "This account requires a verification method that is not supported in this version.",
  );
}

export async function verifyAdditionalVerification(
  signIn: AdditionalVerificationSignIn,
  method: AdditionalVerificationMethod,
  code: string,
): Promise<void> {
  const trimmedCode = code.trim();
  const result = method === "email_code"
    ? await signIn.mfa.verifyEmailCode({ code: trimmedCode })
    : await signIn.mfa.verifyTOTP({ code: trimmedCode });

  if (result.error) {
    console.warn("[AuthContinuation]", {
      statusCategory: signIn.status ?? "unknown",
      verificationAvailable: true,
      errorCategory: "verification_failed",
    });
    throw new AuthContinuationError(
      "verification_failed",
      "The verification code was not accepted. Check the code and try again.",
    );
  }

  if (signIn.status !== "complete") {
    console.warn("[AuthContinuation]", {
      statusCategory: signIn.status ?? "unknown",
      verificationAvailable: true,
      errorCategory: "verification_incomplete",
    });
    throw new AuthContinuationError(
      "verification_incomplete",
      "Additional verification is still required to finish sign-in.",
    );
  }
}
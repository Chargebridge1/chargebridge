import {
  AuthContinuationError,
  beginAdditionalVerification,
  verifyAdditionalVerification,
  type AdditionalVerificationSignIn,
} from "../utils/continueSignIn";

function makeMutableSignIn(
  status: string | null,
  factors: string[],
): AdditionalVerificationSignIn {
  const signIn: AdditionalVerificationSignIn = {
    status,
    supportedSecondFactors: factors.map((strategy) => ({ strategy })),
    mfa: {
      sendEmailCode: jest.fn().mockResolvedValue({ error: null }),
      verifyEmailCode: jest.fn().mockImplementation(async () => {
        signIn.status = "complete";
        return { error: null };
      }),
      verifyTOTP: jest.fn().mockImplementation(async () => {
        signIn.status = "complete";
        return { error: null };
      }),
    },
  };
  return signIn;
}

describe("additional Clerk verification", () => {
  it.each(["needs_second_factor", "needs_client_trust"])(
    "starts email verification for %s",
    async (status) => {
      const signIn = makeMutableSignIn(status, ["email_code"]);

      await expect(beginAdditionalVerification(signIn)).resolves.toEqual({
        method: "email_code",
        reason: status,
      });
      expect(signIn.mfa.sendEmailCode).toHaveBeenCalledTimes(1);
    },
  );

  it("uses an authenticator code when TOTP is the available factor", async () => {
    const signIn = makeMutableSignIn("needs_second_factor", ["totp"]);

    await expect(beginAdditionalVerification(signIn)).resolves.toEqual({
      method: "totp",
      reason: "needs_second_factor",
    });
    expect(signIn.mfa.sendEmailCode).not.toHaveBeenCalled();
  });

  it("surfaces an unsupported additional-verification method", async () => {
    const signIn = makeMutableSignIn("needs_second_factor", ["backup_code"]);

    await expect(beginAdditionalVerification(signIn)).rejects.toMatchObject({
      category: "unsupported_verification_method",
    });
  });

  it("verifies an email code and reaches complete", async () => {
    const signIn = makeMutableSignIn("needs_client_trust", ["email_code"]);

    await verifyAdditionalVerification(signIn, "email_code", " 123456 ");

    expect(signIn.mfa.verifyEmailCode).toHaveBeenCalledWith({ code: "123456" });
    expect(signIn.status).toBe("complete");
  });

  it("verifies a TOTP code and reaches complete", async () => {
    const signIn = makeMutableSignIn("needs_second_factor", ["totp"]);

    await verifyAdditionalVerification(signIn, "totp", "654321");

    expect(signIn.mfa.verifyTOTP).toHaveBeenCalledWith({ code: "654321" });
    expect(signIn.status).toBe("complete");
  });

  it("does not finalize when verification remains incomplete", async () => {
    const signIn = makeMutableSignIn("needs_second_factor", ["email_code"]);
    signIn.mfa.verifyEmailCode = jest.fn().mockResolvedValue({ error: null });

    await expect(
      verifyAdditionalVerification(signIn, "email_code", "123456"),
    ).rejects.toEqual(expect.objectContaining({
      category: "verification_incomplete",
    }));
  });
});
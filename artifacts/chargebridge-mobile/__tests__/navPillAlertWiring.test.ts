/**
 * Unit tests for makeSessionExpiredAlert — the "Sign In Again" Alert wiring
 * that NavPillProvider passes as onSessionExpired to runSavePillLayout.
 *
 * These tests confirm:
 *   – Alert.alert is called when the returned callback is invoked
 *   – The alert title is "Session Expired"
 *   – The alert message mentions the session and sign-in recovery
 *   – A "Sign In Again" button is present in the button array
 *   – A "Later" cancel button is present in the button array
 *   – Pressing "Sign In Again" calls router.push("/(auth)/sign-in")
 *   – Pressing "Later" does NOT call router.push
 *
 * Consistent with the onSessionExpired tests in savePillLayout.test.ts:
 * no React rendering required — the utility under test is a plain function.
 */

// ── react-native mock (must precede imports) ───────────────────────────────────
// Note: jest.mock factories are hoisted before variable declarations, so the
// mock fn must be defined inline and accessed via the imported module reference.

jest.mock("react-native", () => ({
  Alert: {
    alert: jest.fn(),
  },
}));

// ── Imports ────────────────────────────────────────────────────────────────────

import { Alert } from "react-native";
import { makeSessionExpiredAlert } from "../utils/makeSessionExpiredAlert";

// ── Helpers ────────────────────────────────────────────────────────────────────

const mockAlert = Alert.alert as jest.Mock;

/** Returns the button array from the single Alert.alert call already recorded. */
function capturedButtons(): Array<{
  text: string;
  style?: string;
  onPress?: () => void;
}> {
  expect(mockAlert).toHaveBeenCalledTimes(1);
  const [, , buttons] = mockAlert.mock.calls[0] as [
    string,
    string,
    Array<{ text: string; style?: string; onPress?: () => void }>,
  ];
  return buttons;
}

// ── Setup ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockAlert.mockClear();
});

// ── Suite: Alert.alert is called ──────────────────────────────────────────────

describe("makeSessionExpiredAlert — Alert.alert is called", () => {
  it("calls Alert.alert when the returned callback is invoked", () => {
    const router = { push: jest.fn() };
    const onSessionExpired = makeSessionExpiredAlert(router);

    onSessionExpired();

    expect(mockAlert).toHaveBeenCalledTimes(1);
  });

  it("does NOT call Alert.alert before the callback is invoked", () => {
    const router = { push: jest.fn() };
    makeSessionExpiredAlert(router); // create but do not invoke

    expect(mockAlert).not.toHaveBeenCalled();
  });
});

// ── Suite: Alert title and message ────────────────────────────────────────────

describe("makeSessionExpiredAlert — Alert title and message", () => {
  it("passes 'Session Expired' as the alert title", () => {
    const router = { push: jest.fn() };
    makeSessionExpiredAlert(router)();

    const [title] = mockAlert.mock.calls[0] as [string, string];
    expect(title).toBe("Session Expired");
  });

  it("alert message mentions session expiry", () => {
    const router = { push: jest.fn() };
    makeSessionExpiredAlert(router)();

    const [, message] = mockAlert.mock.calls[0] as [string, string];
    expect(message.toLowerCase()).toContain("session");
    expect(message.toLowerCase()).toContain("expired");
  });

  it("alert message mentions signing in again", () => {
    const router = { push: jest.fn() };
    makeSessionExpiredAlert(router)();

    const [, message] = mockAlert.mock.calls[0] as [string, string];
    expect(message.toLowerCase()).toContain("sign in");
  });
});

// ── Suite: button array structure ─────────────────────────────────────────────

describe("makeSessionExpiredAlert — button array structure", () => {
  it("alert has exactly two buttons", () => {
    const router = { push: jest.fn() };
    makeSessionExpiredAlert(router)();

    expect(capturedButtons()).toHaveLength(2);
  });

  it("includes a 'Sign In Again' button", () => {
    const router = { push: jest.fn() };
    makeSessionExpiredAlert(router)();

    const btn = capturedButtons().find((b) => b.text === "Sign In Again");
    expect(btn).toBeDefined();
  });

  it("includes a 'Later' button", () => {
    const router = { push: jest.fn() };
    makeSessionExpiredAlert(router)();

    const btn = capturedButtons().find((b) => b.text === "Later");
    expect(btn).toBeDefined();
  });

  it("'Later' button has style 'cancel'", () => {
    const router = { push: jest.fn() };
    makeSessionExpiredAlert(router)();

    const btn = capturedButtons().find((b) => b.text === "Later")!;
    expect(btn.style).toBe("cancel");
  });

  it("'Sign In Again' button has an onPress handler", () => {
    const router = { push: jest.fn() };
    makeSessionExpiredAlert(router)();

    const btn = capturedButtons().find((b) => b.text === "Sign In Again")!;
    expect(typeof btn.onPress).toBe("function");
  });
});

// ── Suite: navigation target ───────────────────────────────────────────────────

describe("makeSessionExpiredAlert — 'Sign In Again' navigation target", () => {
  it("calls router.push when 'Sign In Again' is pressed", () => {
    const router = { push: jest.fn() };
    makeSessionExpiredAlert(router)();

    const btn = capturedButtons().find((b) => b.text === "Sign In Again")!;
    btn.onPress!();

    expect(router.push).toHaveBeenCalledTimes(1);
  });

  it("navigates to '/(auth)/sign-in' when 'Sign In Again' is pressed", () => {
    const router = { push: jest.fn() };
    makeSessionExpiredAlert(router)();

    const btn = capturedButtons().find((b) => b.text === "Sign In Again")!;
    btn.onPress!();

    expect(router.push).toHaveBeenCalledWith("/(auth)/sign-in");
  });

  it("does NOT call router.push when the factory is called but the callback has not fired yet", () => {
    const router = { push: jest.fn() };
    makeSessionExpiredAlert(router); // factory — no invocation

    expect(router.push).not.toHaveBeenCalled();
  });

  it("does NOT call router.push when 'Later' is pressed", () => {
    const router = { push: jest.fn() };
    makeSessionExpiredAlert(router)();

    const btn = capturedButtons().find((b) => b.text === "Later")!;
    btn.onPress?.(); // 'Later' is a cancel button and may have no onPress

    expect(router.push).not.toHaveBeenCalled();
  });

  it("uses the router instance captured at factory-creation time", () => {
    // Regression guard: the router passed to makeSessionExpiredAlert is the
    // one used when the button is pressed, not any later replacement.
    const routerA = { push: jest.fn() };
    const routerB = { push: jest.fn() };
    const onSessionExpired = makeSessionExpiredAlert(routerA);

    onSessionExpired();
    capturedButtons().find((b) => b.text === "Sign In Again")!.onPress!();

    expect(routerA.push).toHaveBeenCalledWith("/(auth)/sign-in");
    expect(routerB.push).not.toHaveBeenCalled();
  });
});

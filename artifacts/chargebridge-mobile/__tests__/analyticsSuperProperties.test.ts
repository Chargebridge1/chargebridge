/**
 * Tests for analytics.ts super-property registration.
 *
 * Verifies that build_number and app_version are always registered as PostHog
 * super-properties at module init, and that those properties are present on
 * events captured before a flush — meaning offline captures already carry them
 * when the queue is drained once connectivity resumes.
 *
 * Implementation note: PostHog React Native merges super-properties into each
 * event at capture() time, not at flush time. So an event queued while offline
 * already has the properties embedded; the flush just ships the queue.
 * The mock below reproduces this behaviour so the tests are self-documenting.
 */

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Reset module registry so each test re-evaluates analytics.ts from scratch. */
beforeEach(() => {
  jest.resetModules();
});

afterEach(() => {
  // Clean up env mutation so tests are isolated.
  delete process.env.EXPO_PUBLIC_POSTHOG_API_KEY;
});

/**
 * Set up module mocks and require analytics.ts, returning the mocked PostHog
 * constructor + the single instance it produced.
 *
 * Using jest.doMock() (not jest.mock()) so the factory runs AFTER
 * jest.resetModules() and the env var is already set.
 */
function loadAnalytics({
  // Pass null explicitly to omit the env var entirely (simulates no key configured).
  // Omitting the field (or passing a string) sets it normally.
  apiKey = "phc_test_key_abc" as string | null,
  expoConfig,
}: {
  apiKey?: string | null;
  expoConfig?: {
    version?: string | null;
    ios?: { buildNumber?: string | null };
    android?: { versionCode?: number | null };
  } | null;
} = {}) {
  // Set the env var before module evaluation; null means "leave it unset".
  if (apiKey !== null) {
    process.env.EXPO_PUBLIC_POSTHOG_API_KEY = apiKey;
  }

  // Build the fake PostHog instance: register() stores super-props, capture()
  // merges them — exactly what the real SDK does at capture time.
  const superProps: Record<string, unknown> = {};
  const capturedEvents: Array<{
    event: string;
    properties: Record<string, unknown>;
  }> = [];

  const mockRegister = jest.fn((props: Record<string, unknown>) => {
    Object.assign(superProps, props);
  });
  const mockCapture = jest.fn(
    (event: string, props?: Record<string, unknown>) => {
      capturedEvents.push({
        event,
        properties: { ...superProps, ...(props ?? {}) },
      });
    },
  );
  const mockIdentify = jest.fn();
  // Simulate real PostHog behaviour: reset() wipes all registered super-props.
  const mockReset = jest.fn(() => {
    for (const key of Object.keys(superProps)) {
      delete superProps[key];
    }
  });

  const fakeInstance = {
    register: mockRegister,
    capture: mockCapture,
    identify: mockIdentify,
    reset: mockReset,
  };
  const MockPostHog = jest.fn(() => fakeInstance);

  jest.doMock("posthog-react-native", () => ({
    __esModule: true,
    default: MockPostHog,
    PostHogProvider: () => null,
  }));

  // expo-crypto uses ESM and isn't in transformIgnorePatterns; mock it so
  // the analytics module can be required in the Jest (Node) environment.
  jest.doMock("expo-crypto", () => ({
    __esModule: true,
    CryptoDigestAlgorithm: { SHA256: "SHA-256" },
    digestStringAsync: jest.fn(async (_algo: string, input: string) => input),
  }));

  jest.doMock("expo-constants", () => ({
    __esModule: true,
    default: {
      expoConfig:
        expoConfig !== undefined
          ? expoConfig
          : {
              version: "1.2.3",
              ios: { buildNumber: "45" },
              android: { versionCode: 46 },
            },
    },
  }));

  // Require after mocks are in place.
  const analytics = require("../lib/analytics") as typeof import("../lib/analytics");

  return {
    analytics,
    MockPostHog,
    mockRegister,
    mockCapture,
    capturedEvents,
    fakeInstance,
  };
}

// ── Suite 1: register() is always called when KEY is present ──────────────────

describe("register() fires at module init when EXPO_PUBLIC_POSTHOG_API_KEY is set", () => {
  it("calls register() exactly once during module initialisation", () => {
    const { mockRegister } = loadAnalytics();
    expect(mockRegister).toHaveBeenCalledTimes(1);
  });

  it("registers app_version from Constants.expoConfig.version", () => {
    const { mockRegister } = loadAnalytics({
      expoConfig: { version: "2.5.0", ios: { buildNumber: "100" } },
    });
    expect(mockRegister).toHaveBeenCalledWith(
      expect.objectContaining({ app_version: "2.5.0" }),
    );
  });

  it("registers build_number from iOS buildNumber when present", () => {
    const { mockRegister } = loadAnalytics({
      expoConfig: {
        version: "1.0.0",
        ios: { buildNumber: "77" },
        android: { versionCode: 78 },
      },
    });
    expect(mockRegister).toHaveBeenCalledWith(
      expect.objectContaining({ build_number: "77" }),
    );
  });

  it("falls back to android versionCode (as string) when iOS buildNumber is absent", () => {
    const { mockRegister } = loadAnalytics({
      expoConfig: {
        version: "1.0.0",
        ios: {},            // no buildNumber
        android: { versionCode: 99 },
      },
    });
    expect(mockRegister).toHaveBeenCalledWith(
      expect.objectContaining({ build_number: "99" }),
    );
  });

  it("uses 'unknown' for build_number when both ios.buildNumber and android.versionCode are absent", () => {
    const { mockRegister } = loadAnalytics({
      expoConfig: { version: "1.0.0", ios: {}, android: {} },
    });
    expect(mockRegister).toHaveBeenCalledWith(
      expect.objectContaining({ build_number: "unknown" }),
    );
  });

  it("uses 'unknown' for app_version when Constants.expoConfig.version is absent", () => {
    const { mockRegister } = loadAnalytics({
      expoConfig: { ios: { buildNumber: "10" } }, // no version
    });
    expect(mockRegister).toHaveBeenCalledWith(
      expect.objectContaining({ app_version: "unknown" }),
    );
  });
});

// ── Suite 2: register() still fires when Constants.expoConfig is null ─────────

describe("register() is not skipped when Constants.expoConfig is null", () => {
  it("still calls register() when expoConfig is null (graceful 'unknown' fallbacks)", () => {
    const { mockRegister } = loadAnalytics({ expoConfig: null });
    expect(mockRegister).toHaveBeenCalledTimes(1);
  });

  it("registers app_version: 'unknown' when expoConfig is null", () => {
    const { mockRegister } = loadAnalytics({ expoConfig: null });
    expect(mockRegister).toHaveBeenCalledWith(
      expect.objectContaining({ app_version: "unknown" }),
    );
  });

  it("registers build_number: 'unknown' when expoConfig is null", () => {
    const { mockRegister } = loadAnalytics({ expoConfig: null });
    expect(mockRegister).toHaveBeenCalledWith(
      expect.objectContaining({ build_number: "unknown" }),
    );
  });
});

// ── Suite 3: no KEY → no PostHog instance, no crash ──────────────────────────

describe("analytics module with no API key", () => {
  it("does not construct a PostHog instance when EXPO_PUBLIC_POSTHOG_API_KEY is absent", () => {
    const { MockPostHog } = loadAnalytics({ apiKey: null });
    expect(MockPostHog).not.toHaveBeenCalled();
  });

  it("track() is a no-op and does not throw when the key is absent", () => {
    const { analytics } = loadAnalytics({ apiKey: null });
    expect(() => analytics.track("some_event")).not.toThrow();
  });

  it("emits a console.warn in __DEV__ mode when EXPO_PUBLIC_POSTHOG_API_KEY is absent", () => {
    // Simulate __DEV__ === true (dev/staging build with a misconfigured EAS secret).
    (global as any).__DEV__ = true;
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    try {
      loadAnalytics({ apiKey: null });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("EXPO_PUBLIC_POSTHOG_API_KEY is not set"),
      );
    } finally {
      warnSpy.mockRestore();
      delete (global as any).__DEV__;
    }
  });

  it("does not emit a console.warn when __DEV__ is false (production build)", () => {
    (global as any).__DEV__ = false;
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    try {
      loadAnalytics({ apiKey: null });
      expect(warnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining("EXPO_PUBLIC_POSTHOG_API_KEY is not set"),
      );
    } finally {
      warnSpy.mockRestore();
      delete (global as any).__DEV__;
    }
  });
});

// ── Suite 4: super-properties are present on events captured while offline ────
//
// PostHog merges super-properties into events at capture() time, before they
// enter the flush queue. An event queued while offline already carries
// build_number and app_version; those properties travel with it to the server
// once connectivity resumes. This suite confirms the mock faithfully represents
// that contract and that the analytics module wires register() before any
// capture() call can occur.

describe("events captured before flush include build_number and app_version", () => {
  it("a single offline-captured event carries app_version in its properties", () => {
    const { analytics, capturedEvents } = loadAnalytics({
      expoConfig: { version: "3.0.0", ios: { buildNumber: "120" } },
    });

    // Simulate an event fired while offline (before any network flush).
    analytics.track("charger_viewed", { station_id: "s-001" });

    expect(capturedEvents).toHaveLength(1);
    expect(capturedEvents[0].properties).toMatchObject({ app_version: "3.0.0" });
  });

  it("a single offline-captured event carries build_number in its properties", () => {
    const { analytics, capturedEvents } = loadAnalytics({
      expoConfig: { version: "3.0.0", ios: { buildNumber: "120" } },
    });

    analytics.track("charger_viewed", { station_id: "s-001" });

    expect(capturedEvents).toHaveLength(1);
    expect(capturedEvents[0].properties).toMatchObject({ build_number: "120" });
  });

  it("caller-supplied properties are also present alongside super-properties", () => {
    const { analytics, capturedEvents } = loadAnalytics({
      expoConfig: { version: "3.0.0", ios: { buildNumber: "120" } },
    });

    analytics.track("charger_viewed", { station_id: "s-001" });

    expect(capturedEvents[0].properties).toMatchObject({
      station_id: "s-001",
      app_version: "3.0.0",
      build_number: "120",
    });
  });

  it("multiple offline events all carry build metadata (simulating a queue that flushes later)", () => {
    const { analytics, capturedEvents } = loadAnalytics({
      expoConfig: { version: "3.1.0", ios: { buildNumber: "125" } },
    });

    // Simulate several events fired while the device is offline.
    analytics.track("app_opened");
    analytics.track("map_viewed");
    analytics.track("charger_selected", { station_id: "s-002" });

    expect(capturedEvents).toHaveLength(3);
    for (const ev of capturedEvents) {
      expect(ev.properties).toMatchObject({
        app_version: "3.1.0",
        build_number: "125",
      });
    }
  });

  it("super-properties survive even when expoConfig is null (unknown fallbacks propagate to captured events)", () => {
    const { analytics, capturedEvents } = loadAnalytics({
      expoConfig: null,
    });

    analytics.track("app_opened");

    expect(capturedEvents[0].properties).toMatchObject({
      app_version: "unknown",
      build_number: "unknown",
    });
  });
});

// ── Suite 5: build metadata survives a sign-out / reset cycle ─────────────────
//
// PostHog reset() wipes all super-properties (the mock above faithfully clears
// superProps on reset). resetUser() must re-register build metadata immediately
// so events fired in the same app session after sign-out still carry them.

describe("build metadata survives resetUser() (sign-out cycle)", () => {
  it("app_version is present on an event captured after resetUser()", () => {
    const { analytics, capturedEvents } = loadAnalytics({
      expoConfig: { version: "4.0.0", ios: { buildNumber: "200" } },
    });

    analytics.resetUser();
    analytics.track("home_viewed");

    expect(capturedEvents).toHaveLength(1);
    expect(capturedEvents[0].properties).toMatchObject({ app_version: "4.0.0" });
  });

  it("build_number is present on an event captured after resetUser()", () => {
    const { analytics, capturedEvents } = loadAnalytics({
      expoConfig: { version: "4.0.0", ios: { buildNumber: "200" } },
    });

    analytics.resetUser();
    analytics.track("home_viewed");

    expect(capturedEvents).toHaveLength(1);
    expect(capturedEvents[0].properties).toMatchObject({ build_number: "200" });
  });

  it("both build metadata properties survive multiple reset cycles", () => {
    const { analytics, capturedEvents } = loadAnalytics({
      expoConfig: { version: "4.1.0", ios: { buildNumber: "210" } },
    });

    // Simulate sign-in → sign-out → sign-in → sign-out pattern.
    analytics.resetUser();
    analytics.resetUser();
    analytics.track("map_viewed");

    expect(capturedEvents).toHaveLength(1);
    expect(capturedEvents[0].properties).toMatchObject({
      app_version: "4.1.0",
      build_number: "210",
    });
  });

  it("events before and after resetUser() both carry build metadata", () => {
    const { analytics, capturedEvents } = loadAnalytics({
      expoConfig: { version: "4.2.0", ios: { buildNumber: "220" } },
    });

    analytics.track("pre_signout_event");
    analytics.resetUser();
    analytics.track("post_signout_event");

    expect(capturedEvents).toHaveLength(2);
    for (const ev of capturedEvents) {
      expect(ev.properties).toMatchObject({
        app_version: "4.2.0",
        build_number: "220",
      });
    }
  });

  it("build metadata uses android versionCode fallback and survives reset", () => {
    const { analytics, capturedEvents } = loadAnalytics({
      expoConfig: {
        version: "5.0.0",
        ios: {},               // no buildNumber
        android: { versionCode: 300 },
      },
    });

    analytics.resetUser();
    analytics.track("charger_selected", { station_id: "s-999" });

    expect(capturedEvents[0].properties).toMatchObject({
      app_version: "5.0.0",
      build_number: "300",
    });
  });

  it("'unknown' fallbacks are re-registered after reset when expoConfig is null", () => {
    const { analytics, capturedEvents } = loadAnalytics({ expoConfig: null });

    analytics.resetUser();
    analytics.track("app_opened");

    expect(capturedEvents[0].properties).toMatchObject({
      app_version: "unknown",
      build_number: "unknown",
    });
  });
});

// ── Suite 6: identity isolation between sign-in sessions ──────────────────────
//
// When two users share a device, signing out (resetUser) and back in as a new
// user (identifyUser) must send PostHog.identify() with the *new* user's hash,
// never the previous one. This prevents analytics identity from leaking across
// sessions — a privacy and data-accuracy requirement.
//
// The expo-crypto mock returns the raw input string as the "hash", so expected
// values are the raw Clerk user IDs — making assertions easy to read.

describe("identity isolation between sign-in sessions on a shared device", () => {
  it("identify() is called with the first user's hash after identifyUser()", async () => {
    const { analytics, fakeInstance } = loadAnalytics();

    analytics.identifyUser("user_a_clerk_id");
    // identifyUser is fire-and-forget; flush the promise microtask queue.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fakeInstance.identify).toHaveBeenCalledTimes(1);
    // The mock digestStringAsync returns the input unchanged, so hash === raw id.
    expect(fakeInstance.identify).toHaveBeenCalledWith("user_a_clerk_id");
  });

  it("identify() is called with the second user's hash after resetUser() + re-identify", async () => {
    const { analytics, fakeInstance } = loadAnalytics();

    // First session: user A signs in.
    analytics.identifyUser("user_a_clerk_id");
    await new Promise((resolve) => setTimeout(resolve, 0));

    // User A signs out on the shared device.
    analytics.resetUser();

    // Second session: user B signs in on the same device.
    analytics.identifyUser("user_b_clerk_id");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fakeInstance.identify).toHaveBeenCalledTimes(2);
    // The most-recent identify() call must carry user B's hash.
    expect(fakeInstance.identify).toHaveBeenLastCalledWith("user_b_clerk_id");
  });

  it("the last identify() call after a reset never uses the previous user's hash", async () => {
    const { analytics, fakeInstance } = loadAnalytics();

    analytics.identifyUser("user_a_clerk_id");
    await new Promise((resolve) => setTimeout(resolve, 0));

    analytics.resetUser();

    analytics.identifyUser("user_b_clerk_id");
    await new Promise((resolve) => setTimeout(resolve, 0));

    const lastCallArg = (fakeInstance.identify as jest.Mock).mock.calls.at(-1)?.[0];
    expect(lastCallArg).toBe("user_b_clerk_id");
    expect(lastCallArg).not.toBe("user_a_clerk_id");
  });

  it("identify() works correctly across three consecutive sessions on the same device", async () => {
    const { analytics, fakeInstance } = loadAnalytics();

    analytics.identifyUser("user_a_clerk_id");
    await new Promise((resolve) => setTimeout(resolve, 0));
    analytics.resetUser();

    analytics.identifyUser("user_b_clerk_id");
    await new Promise((resolve) => setTimeout(resolve, 0));
    analytics.resetUser();

    analytics.identifyUser("user_c_clerk_id");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fakeInstance.identify).toHaveBeenCalledTimes(3);
    expect(fakeInstance.identify).toHaveBeenLastCalledWith("user_c_clerk_id");
  });

  it("events captured between resetUser() and the next identifyUser() are not attributed to the previous user", async () => {
    const { analytics, fakeInstance, capturedEvents } = loadAnalytics();

    // User A signs in and is identified in PostHog.
    analytics.identifyUser("user_a_clerk_id");
    await new Promise((resolve) => setTimeout(resolve, 0));

    // User A signs out — identity is cleared by reset().
    analytics.resetUser();

    // An event fires before user B has authenticated (e.g. the sign-in screen).
    analytics.track("sign_in_screen_viewed");

    // identify() must have been called exactly once (for user A only).
    // No second identify() call means this event is not linked to user A.
    expect(fakeInstance.identify).toHaveBeenCalledTimes(1);
    expect(capturedEvents).toHaveLength(1);
    expect(capturedEvents[0].event).toBe("sign_in_screen_viewed");
    // The captured event must not carry any user-level identity property from user A.
    expect(capturedEvents[0].properties).not.toHaveProperty("user_id");
    expect(capturedEvents[0].properties).not.toHaveProperty("distinct_id");
  });

  it("identifyUser() is a no-op when called with null (signed-out guard)", async () => {
    const { analytics, fakeInstance } = loadAnalytics();

    analytics.identifyUser(null);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fakeInstance.identify).not.toHaveBeenCalled();
  });

  it("identifyUser() is a no-op when called with undefined", async () => {
    const { analytics, fakeInstance } = loadAnalytics();

    analytics.identifyUser(undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fakeInstance.identify).not.toHaveBeenCalled();
  });

  it("resetUser() does not trigger an additional identify() call", async () => {
    const { analytics, fakeInstance } = loadAnalytics();

    analytics.identifyUser("user_a_clerk_id");
    await new Promise((resolve) => setTimeout(resolve, 0));

    const callsBeforeReset = (fakeInstance.identify as jest.Mock).mock.calls.length;
    analytics.resetUser();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // resetUser() must not call identify() — it only calls reset() + register().
    expect(fakeInstance.identify).toHaveBeenCalledTimes(callsBeforeReset);
  });
});

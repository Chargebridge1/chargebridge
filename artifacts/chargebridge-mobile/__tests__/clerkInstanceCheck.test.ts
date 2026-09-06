/**
 * Tests for the Clerk instance alignment utility.
 *
 * These tests confirm that the check correctly detects the instance-mismatch
 * pattern that caused Build #205 to fail: every JWT was signed by the test
 * Clerk instance but the server validated against the production instance.
 *
 * DIAG fingerprint of a mismatch (from production logs):
 *   hasAuthHeader: true
 *   authHeaderPrefix: "Bearer eyJhbGci…"
 *   clerkUserId: null
 *   responseTime: 30–300 ms (Clerk crypto ran, but returned null userId)
 */

import {
  decodeClerkInstance,
  isTestPublishableKey,
  checkClerkAlignment,
} from "../utils/clerkInstanceCheck";

// ── Known key fixtures ────────────────────────────────────────────────────────

// pk_test_c2VsZWN0LXBhbmRhLTUzLmNsZXJrLmFjY291bnRzLmRldiQ
//   → select-panda-53.clerk.accounts.dev
const TEST_KEY = "pk_test_c2VsZWN0LXBhbmRhLTUzLmNsZXJrLmFjY291bnRzLmRldiQ";
const TEST_INSTANCE = "select-panda-53.clerk.accounts.dev";

// pk_live_Y2xlcmsud3d3LmNoYXJnZWJyaWRnZWFwcC5jb20k
//   → clerk.www.chargebridgeapp.com
const LIVE_KEY = "pk_live_Y2xlcmsud3d3LmNoYXJnZWJyaWRnZWFwcC5jb20k";
const LIVE_INSTANCE = "clerk.www.chargebridgeapp.com";

// ── decodeClerkInstance ───────────────────────────────────────────────────────

describe("decodeClerkInstance", () => {
  it("decodes a test publishable key to its instance domain", () => {
    expect(decodeClerkInstance(TEST_KEY)).toBe(TEST_INSTANCE);
  });

  it("decodes a live publishable key to its instance domain", () => {
    expect(decodeClerkInstance(LIVE_KEY)).toBe(LIVE_INSTANCE);
  });

  it("returns null for undefined input", () => {
    expect(decodeClerkInstance(undefined)).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(decodeClerkInstance("")).toBeNull();
  });

  it("returns null for a malformed key that can't be decoded", () => {
    expect(decodeClerkInstance("pk_live_!!!not-base64!!!")).toBeNull();
  });
});

// ── isTestPublishableKey ──────────────────────────────────────────────────────

describe("isTestPublishableKey", () => {
  it("returns true for a pk_test_ key", () => {
    expect(isTestPublishableKey(TEST_KEY)).toBe(true);
  });

  it("returns false for a pk_live_ key", () => {
    expect(isTestPublishableKey(LIVE_KEY)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isTestPublishableKey(undefined)).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(isTestPublishableKey("")).toBe(false);
  });
});

// ── checkClerkAlignment ───────────────────────────────────────────────────────

// The function fetches /api/version from the server. We stub global fetch.

function mockFetch(clerkInstance: string) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ clerkInstance }),
  });
}

function mockFetchFail() {
  global.fetch = jest.fn().mockRejectedValue(new Error("Network unavailable"));
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("checkClerkAlignment — aligned (matching instances)", () => {
  beforeEach(() => mockFetch(LIVE_INSTANCE));

  it("returns aligned:true when mobile key and server instance match", async () => {
    const result = await checkClerkAlignment("https://api.example.com", LIVE_KEY);
    expect(result.aligned).toBe(true);
  });

  it("reports the correct mobile instance", async () => {
    const result = await checkClerkAlignment("https://api.example.com", LIVE_KEY);
    expect(result.mobileInstance).toBe(LIVE_INSTANCE);
  });

  it("reports the correct server instance", async () => {
    const result = await checkClerkAlignment("https://api.example.com", LIVE_KEY);
    expect(result.serverInstance).toBe(LIVE_INSTANCE);
  });

  it("correctly identifies a live key as NOT a test key", async () => {
    const result = await checkClerkAlignment("https://api.example.com", LIVE_KEY);
    expect(result.isTestKey).toBe(false);
  });
});

describe("checkClerkAlignment — MISMATCH (the Build #205 scenario)", () => {
  // Server is production (clerk.www.chargebridgeapp.com)
  // Mobile was compiled with the test key (select-panda-53.clerk.accounts.dev)
  // → Every JWT the app produces is rejected by the server
  beforeEach(() => mockFetch(LIVE_INSTANCE));

  it("returns aligned:false when mobile key is test but server expects live instance", async () => {
    const result = await checkClerkAlignment("https://api.example.com", TEST_KEY);
    expect(result.aligned).toBe(false);
  });

  it("reports the test instance as mobileInstance", async () => {
    const result = await checkClerkAlignment("https://api.example.com", TEST_KEY);
    expect(result.mobileInstance).toBe(TEST_INSTANCE);
  });

  it("reports the live instance as serverInstance", async () => {
    const result = await checkClerkAlignment("https://api.example.com", TEST_KEY);
    expect(result.serverInstance).toBe(LIVE_INSTANCE);
  });

  it("correctly identifies the mismatched key as a test key (isTestKey:true)", async () => {
    const result = await checkClerkAlignment("https://api.example.com", TEST_KEY);
    expect(result.isTestKey).toBe(true);
  });
});

describe("checkClerkAlignment — network unavailable (offline)", () => {
  beforeEach(() => mockFetchFail());

  it("returns aligned:false when server is unreachable", async () => {
    const result = await checkClerkAlignment("https://api.example.com", LIVE_KEY);
    expect(result.aligned).toBe(false);
  });

  it("returns serverInstance:null when /api/version is unreachable", async () => {
    const result = await checkClerkAlignment("https://api.example.com", LIVE_KEY);
    expect(result.serverInstance).toBeNull();
  });

  it("still decodes mobileInstance correctly when offline", async () => {
    const result = await checkClerkAlignment("https://api.example.com", LIVE_KEY);
    expect(result.mobileInstance).toBe(LIVE_INSTANCE);
  });
});

describe("checkClerkAlignment — missing publishable key", () => {
  beforeEach(() => mockFetch(LIVE_INSTANCE));

  it("returns aligned:false when no publishable key is provided", async () => {
    const result = await checkClerkAlignment("https://api.example.com", undefined);
    expect(result.aligned).toBe(false);
  });

  it("returns mobileInstance:null when publishable key is undefined", async () => {
    const result = await checkClerkAlignment("https://api.example.com", undefined);
    expect(result.mobileInstance).toBeNull();
  });
});

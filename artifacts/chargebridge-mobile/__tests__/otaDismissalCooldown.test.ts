/**
 * Unit tests for otaDismissalCooldown — OTA "Not now" prompt cooldown.
 *
 * Confirms that:
 * - After recordOTADismissal(), the prompt is suppressed for the cooldown window.
 * - The cooldown expires correctly and allows re-checking afterward.
 * - formatRemaining() produces correct human-readable labels.
 * - clearOTADismissal() immediately lifts the cooldown.
 */

import {
  recordOTADismissal,
  clearOTADismissal,
  getOTADismissalState,
  formatRemaining,
  OTA_DISMISSAL_KEY,
  DEFAULT_COOLDOWN_MS,
} from "../utils/otaDismissalCooldown";

// ── AsyncStorage in-memory mock ───────────────────────────────────────────────

const store: Record<string, string> = {};

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(async (key: string) => store[key] ?? null),
  setItem: jest.fn(async (key: string, value: string) => { store[key] = value; }),
  removeItem: jest.fn(async (key: string) => { delete store[key]; }),
}));

beforeEach(() => {
  // Clear the in-memory store before each test.
  for (const key of Object.keys(store)) delete store[key];
  jest.clearAllMocks();
});

// ── formatRemaining ───────────────────────────────────────────────────────────

describe("formatRemaining", () => {
  it("formats hours and minutes when both are non-zero", () => {
    const ms = (23 * 60 + 45) * 60 * 1000;
    expect(formatRemaining(ms)).toBe("23h 45m");
  });

  it("formats hours only when minutes are zero", () => {
    expect(formatRemaining(5 * 60 * 60 * 1000)).toBe("5h");
  });

  it("formats minutes only when less than one hour", () => {
    expect(formatRemaining(45 * 60 * 1000)).toBe("45m");
  });

  it("returns '< 1m' when fewer than 60 seconds remain", () => {
    expect(formatRemaining(59 * 1000)).toBe("< 1m");
  });

  it("returns '< 1m' for 0 ms", () => {
    expect(formatRemaining(0)).toBe("< 1m");
  });

  it("formats 1h exactly", () => {
    expect(formatRemaining(60 * 60 * 1000)).toBe("1h");
  });

  it("formats 1m exactly", () => {
    expect(formatRemaining(60 * 1000)).toBe("1m");
  });
});

// ── No prior dismissal ────────────────────────────────────────────────────────

describe("getOTADismissalState — no prior dismissal", () => {
  it("returns isCoolingDown=false when nothing is stored", async () => {
    const state = await getOTADismissalState();
    expect(state.isCoolingDown).toBe(false);
  });

  it("returns null cooldownLabel when nothing is stored", async () => {
    const state = await getOTADismissalState();
    expect(state.cooldownLabel).toBeNull();
  });

  it("returns null expiresAt when nothing is stored", async () => {
    const state = await getOTADismissalState();
    expect(state.expiresAt).toBeNull();
  });
});

// ── recordOTADismissal then check within window ───────────────────────────────

describe("recordOTADismissal — within cooldown window", () => {
  it("sets isCoolingDown=true immediately after dismissal", async () => {
    const now = Date.now();
    await recordOTADismissal(now);
    const state = await getOTADismissalState(DEFAULT_COOLDOWN_MS, now + 1000);
    expect(state.isCoolingDown).toBe(true);
  });

  it("provides a non-null cooldownLabel within the window", async () => {
    const now = Date.now();
    await recordOTADismissal(now);
    const state = await getOTADismissalState(DEFAULT_COOLDOWN_MS, now + 1000);
    expect(state.cooldownLabel).not.toBeNull();
  });

  it("cooldownLabel reflects roughly 24h after fresh dismissal", async () => {
    const now = 0;
    await recordOTADismissal(now);
    // 1 second after dismissal → ~23h 59m remaining
    const state = await getOTADismissalState(DEFAULT_COOLDOWN_MS, now + 1000);
    expect(state.cooldownLabel).toBe("23h 59m");
  });

  it("expiresAt is dismissedAt + cooldownMs", async () => {
    const now = 1_000_000;
    await recordOTADismissal(now);
    const state = await getOTADismissalState(DEFAULT_COOLDOWN_MS, now + 1000);
    expect(state.expiresAt).toBe(now + DEFAULT_COOLDOWN_MS);
  });

  it("suppresses re-prompt immediately after dismissal (0 ms elapsed)", async () => {
    const now = Date.now();
    await recordOTADismissal(now);
    // Simulate checkForUpdate running 100 ms later — within cooldown.
    const state = await getOTADismissalState(DEFAULT_COOLDOWN_MS, now + 100);
    expect(state.isCoolingDown).toBe(true);
  });

  it("suppresses re-prompt 23 h after dismissal", async () => {
    const now = 0;
    await recordOTADismissal(now);
    const twentyThreeHoursLater = 23 * 60 * 60 * 1000;
    const state = await getOTADismissalState(DEFAULT_COOLDOWN_MS, twentyThreeHoursLater);
    expect(state.isCoolingDown).toBe(true);
  });
});

// ── Cooldown expiry ───────────────────────────────────────────────────────────

describe("getOTADismissalState — after cooldown expires", () => {
  it("returns isCoolingDown=false once cooldown has elapsed", async () => {
    const now = 0;
    await recordOTADismissal(now);
    // Check exactly at expiry (remaining === 0).
    const state = await getOTADismissalState(DEFAULT_COOLDOWN_MS, now + DEFAULT_COOLDOWN_MS);
    expect(state.isCoolingDown).toBe(false);
  });

  it("returns isCoolingDown=false after the cooldown window has passed", async () => {
    const now = 0;
    await recordOTADismissal(now);
    const afterExpiry = DEFAULT_COOLDOWN_MS + 1;
    const state = await getOTADismissalState(DEFAULT_COOLDOWN_MS, afterExpiry);
    expect(state.isCoolingDown).toBe(false);
  });

  it("cleans up AsyncStorage once the cooldown expires", async () => {
    const AsyncStorage = require("@react-native-async-storage/async-storage");
    const now = 0;
    await recordOTADismissal(now);
    await getOTADismissalState(DEFAULT_COOLDOWN_MS, now + DEFAULT_COOLDOWN_MS + 1);
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(OTA_DISMISSAL_KEY);
  });

  it("allows a second dismissal after the first cooldown has expired", async () => {
    const now = 0;
    await recordOTADismissal(now);
    // First cooldown expires.
    await getOTADismissalState(DEFAULT_COOLDOWN_MS, now + DEFAULT_COOLDOWN_MS + 1);
    // Tester dismisses again.
    const secondDismissal = now + DEFAULT_COOLDOWN_MS + 500;
    await recordOTADismissal(secondDismissal);
    const state = await getOTADismissalState(DEFAULT_COOLDOWN_MS, secondDismissal + 100);
    expect(state.isCoolingDown).toBe(true);
  });
});

// ── clearOTADismissal ─────────────────────────────────────────────────────────

describe("clearOTADismissal", () => {
  it("lifts the cooldown immediately", async () => {
    const now = 0;
    await recordOTADismissal(now);
    await clearOTADismissal();
    const state = await getOTADismissalState(DEFAULT_COOLDOWN_MS, now + 1000);
    expect(state.isCoolingDown).toBe(false);
  });

  it("is safe to call when no dismissal is stored", async () => {
    await expect(clearOTADismissal()).resolves.toBeUndefined();
  });

  it("removes the correct AsyncStorage key", async () => {
    const AsyncStorage = require("@react-native-async-storage/async-storage");
    await clearOTADismissal();
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(OTA_DISMISSAL_KEY);
  });
});

// ── Custom cooldown duration ──────────────────────────────────────────────────

describe("getOTADismissalState — custom cooldown duration", () => {
  it("respects a shorter cooldown (e.g. 1 hour)", async () => {
    const oneHour = 60 * 60 * 1000;
    const now = 0;
    await recordOTADismissal(now);
    // 30 minutes later — still within 1h cooldown.
    const stateMid = await getOTADismissalState(oneHour, now + 30 * 60 * 1000);
    expect(stateMid.isCoolingDown).toBe(true);
    // 61 minutes later — cooldown has expired.
    const stateAfter = await getOTADismissalState(oneHour, now + 61 * 60 * 1000);
    expect(stateAfter.isCoolingDown).toBe(false);
  });
});

// ── recordOTADismissal uses current time when no arg given ────────────────────

describe("recordOTADismissal — default timestamp", () => {
  it("stores a timestamp close to Date.now()", async () => {
    const AsyncStorage = require("@react-native-async-storage/async-storage");
    const before = Date.now();
    await recordOTADismissal();
    const after = Date.now();
    const stored = Number(store[OTA_DISMISSAL_KEY]);
    expect(stored).toBeGreaterThanOrEqual(before);
    expect(stored).toBeLessThanOrEqual(after);
  });
});

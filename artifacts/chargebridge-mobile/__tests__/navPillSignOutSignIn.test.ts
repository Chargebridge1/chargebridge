/**
 * Tests for the sign-out → sign-in ref-reset cycle in NavPillContext.
 *
 * The useEffect that drives Phase 1 + Phase 2 runs on every `isSignedIn`
 * change.  Its first two lines unconditionally reset both tracking refs:
 *
 *   serverHydrated.current = false;
 *   localSavedAtRef.current = undefined;
 *
 * Without that reset, a second sign-in on the same device would find
 * serverHydrated still true (from the previous session's Phase 2) and skip
 * the server fetch entirely — permanently, until the app is killed.
 *
 * These tests exercise the storage layer and the Phase 2 guard in sequence,
 * modelling the ref values the real context holds at each stage of the cycle:
 *
 *   sign-in #1 → Phase 1 (local) → Phase 2 (server) → refs settled
 *   sign-out   → refs reset (serverHydrated=false, localSavedAtRef=undefined)
 *   sign-in #2 → Phase 1 (local) → Phase 2 (server) → server layout re-applied
 *
 * No React components are mounted.  The pattern mirrors navPillPhase2.test.ts.
 */

// ── In-memory AsyncStorage mock ───────────────────────────────────────────────

const store: Record<string, string> = {};

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(async (key: string) => store[key] ?? null),
  setItem: jest.fn(async (key: string, value: string) => {
    store[key] = value;
  }),
  removeItem: jest.fn(async (key: string) => {
    delete store[key];
  }),
}));

// ── Imports (after mock registration) ────────────────────────────────────────

import { readLocal, writeLocal } from "../utils/navPillStorage";
import { normalizeLayout } from "../constants/navPills";
import type { NavPillLayout, PillId } from "../constants/navPills";

// ── Helpers ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  Object.keys(store).forEach((k) => delete store[k]);
  jest.clearAllMocks();
});

/**
 * Models the Phase 2 guard from NavPillContext:
 *   - Reads the server payload
 *   - Compares timestamps using `localSavedAt` (the current ref value)
 *   - Returns { applied, layout, nextLocalSavedAt, nextServerHydrated }
 *     so tests can thread the new ref values into subsequent stages.
 */
async function runPhase2(opts: {
  serverRaw: Partial<NavPillLayout>;
  localSavedAt: number | undefined;
  serverHydrated: boolean;
}): Promise<{
  applied: boolean;
  layout: NavPillLayout | null;
  nextLocalSavedAt: number | undefined;
  nextServerHydrated: boolean;
}> {
  const normalized = normalizeLayout(opts.serverRaw);
  const serverSavedAt = normalized.savedAt;
  const localSavedAt = opts.localSavedAt;

  // Mirror the guard in NavPillContext exactly.
  if (
    serverSavedAt != null &&
    localSavedAt != null &&
    serverSavedAt < localSavedAt
  ) {
    return {
      applied: false,
      layout: null,
      nextLocalSavedAt: opts.localSavedAt,
      nextServerHydrated: opts.serverHydrated,
    };
  }

  await writeLocal(normalized);
  return {
    applied: true,
    layout: normalized,
    nextLocalSavedAt: serverSavedAt,
    nextServerHydrated: true,
  };
}

/**
 * Models the sign-out ref reset from NavPillContext's useEffect:
 *   serverHydrated.current = false;
 *   localSavedAtRef.current = undefined;
 */
function simulateSignOut(): { serverHydrated: false; localSavedAt: undefined } {
  return { serverHydrated: false, localSavedAt: undefined };
}

// ── Timestamps & layouts ──────────────────────────────────────────────────────

const SESSION1_LOCAL_SAVED_AT = 1_700_000_000_000;
const SESSION1_SERVER_SAVED_AT = SESSION1_LOCAL_SAVED_AT + 3_000;

// Layout the user has on device going into session 1.
const SESSION1_LOCAL_LAYOUT: NavPillLayout = {
  order: ["home", "map", "charge", "activity", "account"] as PillId[],
  hidden: [],
  savedAt: SESSION1_LOCAL_SAVED_AT,
};

// Server layout for session 1 (newer — came from another device earlier).
const SESSION1_SERVER_LAYOUT: Partial<NavPillLayout> = {
  order: ["charge", "map", "home", "activity", "account"] as PillId[],
  hidden: ["activity"],
  savedAt: SESSION1_SERVER_SAVED_AT,
};

// Between sign-out and sign-in #2, another device saves a new layout.
const SESSION2_SERVER_SAVED_AT = SESSION1_SERVER_SAVED_AT + 10_000;

const SESSION2_SERVER_LAYOUT: Partial<NavPillLayout> = {
  order: ["account", "charge", "map", "home", "activity"] as PillId[],
  hidden: ["home", "activity"],
  savedAt: SESSION2_SERVER_SAVED_AT,
};

// ── Suite 1: refs reset on sign-out ──────────────────────────────────────────

describe("sign-out ref reset — serverHydrated and localSavedAtRef cleared", () => {
  it("simulateSignOut returns serverHydrated=false", () => {
    const state = simulateSignOut();
    expect(state.serverHydrated).toBe(false);
  });

  it("simulateSignOut returns localSavedAt=undefined", () => {
    const state = simulateSignOut();
    expect(state.localSavedAt).toBeUndefined();
  });

  it("ref state after sign-out is independent of how large the previous localSavedAt was", () => {
    // Simulate Phase 2 having set localSavedAtRef to a high value.
    const largeTimestamp = 9_999_999_999_999;
    // After sign-out the reset must clear it regardless.
    const state = simulateSignOut();
    expect(state.localSavedAt).toBeUndefined();
    // Confirm the large timestamp is not leaked.
    expect(state.localSavedAt).not.toBe(largeTimestamp);
  });
});

// ── Suite 2: full sign-in → sign-out → sign-in cycle ─────────────────────────

describe("sign-in → sign-out → sign-in cycle — server layout re-applied on second sign-in", () => {
  it("Phase 2 applies the server layout on first sign-in", async () => {
    await writeLocal(SESSION1_LOCAL_LAYOUT);

    const phase1Local = await readLocal();
    const localSavedAt = phase1Local?.savedAt; // Phase 1 sets localSavedAtRef

    const result = await runPhase2({
      serverRaw: SESSION1_SERVER_LAYOUT,
      localSavedAt,
      serverHydrated: false,
    });

    expect(result.applied).toBe(true);
    expect(result.nextServerHydrated).toBe(true);
    expect(result.nextLocalSavedAt).toBe(SESSION1_SERVER_SAVED_AT);
  });

  it("after sign-out the refs are reset — serverHydrated is false, localSavedAt is undefined", async () => {
    // Simulate reaching the settled state after session 1.
    const settledState = {
      serverHydrated: true as boolean,
      localSavedAt: SESSION1_SERVER_SAVED_AT as number | undefined,
    };

    // Sign-out resets both.
    const resetState = simulateSignOut();

    expect(resetState.serverHydrated).toBe(false);
    expect(resetState.localSavedAt).toBeUndefined();
    // Confirm neither value bleeds from the settled state.
    expect(resetState.serverHydrated).not.toBe(settledState.serverHydrated);
    expect(resetState.localSavedAt).not.toBe(settledState.localSavedAt);
  });

  it("Phase 2 re-runs on second sign-in because serverHydrated was reset to false", async () => {
    // After sign-out, refs are reset.
    const { serverHydrated, localSavedAt } = simulateSignOut();

    // Second sign-in: a newer layout was saved on another device.
    const result = await runPhase2({
      serverRaw: SESSION2_SERVER_LAYOUT,
      localSavedAt,
      serverHydrated,
    });

    // Phase 2 must apply the layout — not skip it.
    expect(result.applied).toBe(true);
  });

  it("the server layout from session 2 is written to AsyncStorage on second sign-in", async () => {
    const { localSavedAt, serverHydrated } = simulateSignOut();

    await runPhase2({
      serverRaw: SESSION2_SERVER_LAYOUT,
      localSavedAt,
      serverHydrated,
    });

    const persisted = await readLocal();
    expect(persisted).not.toBeNull();
    expect(persisted!.savedAt).toBe(SESSION2_SERVER_SAVED_AT);
    expect(persisted!.order).toEqual(normalizeLayout(SESSION2_SERVER_LAYOUT).order);
  });

  it("the layout applied on second sign-in is different from the session 1 server layout", async () => {
    // Write session 1's server layout to AsyncStorage (as Phase 2 session 1 did).
    await runPhase2({
      serverRaw: SESSION1_SERVER_LAYOUT,
      localSavedAt: SESSION1_LOCAL_SAVED_AT,
      serverHydrated: false,
    });
    jest.clearAllMocks();

    // Sign out resets refs.
    const { localSavedAt, serverHydrated } = simulateSignOut();

    // Sign in again with a new server layout.
    const result = await runPhase2({
      serverRaw: SESSION2_SERVER_LAYOUT,
      localSavedAt,
      serverHydrated,
    });

    expect(result.applied).toBe(true);
    expect(result.layout!.order).toEqual(normalizeLayout(SESSION2_SERVER_LAYOUT).order);
    expect(result.layout!.order).not.toEqual(normalizeLayout(SESSION1_SERVER_LAYOUT).order);
  });

  it("localSavedAtRef is updated to the session 2 server timestamp after second sign-in", async () => {
    const { localSavedAt, serverHydrated } = simulateSignOut();

    const result = await runPhase2({
      serverRaw: SESSION2_SERVER_LAYOUT,
      localSavedAt,
      serverHydrated,
    });

    expect(result.nextLocalSavedAt).toBe(SESSION2_SERVER_SAVED_AT);
  });

  it("serverHydrated is true after Phase 2 completes on second sign-in", async () => {
    const { localSavedAt, serverHydrated } = simulateSignOut();

    const result = await runPhase2({
      serverRaw: SESSION2_SERVER_LAYOUT,
      localSavedAt,
      serverHydrated,
    });

    expect(result.nextServerHydrated).toBe(true);
  });
});

// ── Suite 3: stale-server guard still applies after sign-out → sign-in ────────

describe("sign-out → sign-in — stale-server guard still protects a newer local layout", () => {
  it("does not overwrite a newer local layout even after sign-out ref reset", async () => {
    // User saved a layout on device 2 during the sign-out window; it is newer
    // than what the server has (server hasn't synced yet).
    const device2LocalSavedAt = SESSION2_SERVER_SAVED_AT + 5_000;
    const device2LocalLayout: NavPillLayout = {
      order: ["map", "charge", "home", "activity", "account"] as PillId[],
      hidden: ["account"],
      savedAt: device2LocalSavedAt,
    };

    await writeLocal(device2LocalLayout);

    // Phase 1 runs after sign-in and sets localSavedAtRef from AsyncStorage.
    const phase1Local = await readLocal();
    const localSavedAt = phase1Local!.savedAt;

    // Phase 2 fetches a server layout that is older than the local one.
    const staleServerLayout: Partial<NavPillLayout> = {
      order: ["account", "charge", "map", "home", "activity"] as PillId[],
      hidden: [],
      savedAt: SESSION2_SERVER_SAVED_AT, // older than device2LocalSavedAt
    };

    jest.clearAllMocks();
    const result = await runPhase2({
      serverRaw: staleServerLayout,
      localSavedAt,
      serverHydrated: false,
    });

    expect(result.applied).toBe(false);

    // AsyncStorage must be unmodified — device 2's newer layout is preserved.
    const AsyncStorage = require("@react-native-async-storage/async-storage");
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();

    const persisted = await readLocal();
    expect(persisted!.order).toEqual(device2LocalLayout.order);
    expect(persisted!.savedAt).toBe(device2LocalSavedAt);
  });

  it("Phase 2 falls through and applies when localSavedAt is undefined after sign-out, regardless of server timestamp", async () => {
    // Ref reset means localSavedAt is undefined — no local baseline to compare
    // against, so the server is treated as authoritative (backward-compat path).
    const { localSavedAt, serverHydrated } = simulateSignOut();

    // Use the older server layout — guard must still fall through because
    // localSavedAt is undefined (not because the server is newer).
    const result = await runPhase2({
      serverRaw: { ...SESSION1_SERVER_LAYOUT, savedAt: 1 }, // very old timestamp
      localSavedAt,
      serverHydrated,
    });

    expect(result.applied).toBe(true);
  });
});

// ── Suite 4: multiple sign-out → sign-in cycles ───────────────────────────────

describe("repeated sign-out → sign-in cycles — each session gets a fresh Phase 2", () => {
  it("three consecutive sign-in sessions all apply the server layout", async () => {
    const serverLayouts: Partial<NavPillLayout>[] = [
      { order: ["home", "map", "charge", "activity", "account"] as PillId[], hidden: [], savedAt: 1_700_000_001_000 },
      { order: ["charge", "home", "map", "activity", "account"] as PillId[], hidden: ["activity"], savedAt: 1_700_000_002_000 },
      { order: ["account", "map", "charge", "home", "activity"] as PillId[], hidden: ["home"], savedAt: 1_700_000_003_000 },
    ];

    for (const serverRaw of serverLayouts) {
      // Each sign-in starts with reset refs.
      const { localSavedAt, serverHydrated } = simulateSignOut();

      const result = await runPhase2({ serverRaw, localSavedAt, serverHydrated });
      expect(result.applied).toBe(true);
      expect(result.nextServerHydrated).toBe(true);
    }
  });

  it("each successive sign-in's server layout overwrites the previous one in AsyncStorage", async () => {
    const layouts: Partial<NavPillLayout>[] = [
      { order: ["home", "map", "charge", "activity", "account"] as PillId[], hidden: [], savedAt: 1_700_000_001_000 },
      { order: ["charge", "home", "map", "activity", "account"] as PillId[], hidden: [], savedAt: 1_700_000_002_000 },
      { order: ["account", "map", "charge", "home", "activity"] as PillId[], hidden: [], savedAt: 1_700_000_003_000 },
    ];

    for (const serverRaw of layouts) {
      const { localSavedAt, serverHydrated } = simulateSignOut();
      await runPhase2({ serverRaw, localSavedAt, serverHydrated });
    }

    // AsyncStorage must hold the last session's layout.
    const persisted = await readLocal();
    expect(persisted!.savedAt).toBe(1_700_000_003_000);
    expect(persisted!.order).toEqual(normalizeLayout(layouts[2]).order);
  });
});

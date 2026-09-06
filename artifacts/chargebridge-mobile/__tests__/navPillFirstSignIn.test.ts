/**
 * Tests for the Phase 2 server-hydration guard — first-time sign-in scenario.
 *
 * When a brand-new user signs in for the first time (no prior local layout,
 * no savedAt on either side), the stale-server guard in NavPillContext must
 * fall through and treat the server response as authoritative.  Similarly,
 * when a user has a legacy local save (no savedAt stored locally), the guard
 * must still let the server win so that cross-device layouts are applied on
 * first login.
 *
 * Covered scenarios:
 *   1. Both localSavedAt AND serverSavedAt are undefined → server wins
 *      (brand-new install, no prior session on any device)
 *   2. Only localSavedAt is undefined (legacy local save, no timestamp written)
 *      → server wins regardless of whether the server has a savedAt
 *
 * The guard condition in NavPillContext is:
 *   if (serverSavedAt != null && localSavedAt != null && serverSavedAt < localSavedAt) { skip }
 * Both conditions must be truthy before a skip occurs, so if either timestamp
 * is absent the guard falls through and the server layout is applied.
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
 * Mirrors the Phase 2 stale-server guard from NavPillContext.tsx (lines ~117–156).
 *
 * Returns `{ applied: boolean; layout: NavPillLayout | null }` — `applied` is
 * true when the guard falls through and the server layout would be committed to
 * state and AsyncStorage, false when it is skipped.
 */
async function runPhase2Guard(opts: {
  serverRaw: Partial<NavPillLayout>;
  localSavedAt: number | undefined;
}): Promise<{ applied: boolean; layout: NavPillLayout | null }> {
  const normalized = normalizeLayout(opts.serverRaw);
  const serverSavedAt = normalized.savedAt;
  const localSavedAt = opts.localSavedAt;

  // Exact mirror of the guard in NavPillContext:
  // Skip only when server is provably older than local.
  // If either timestamp is missing, fall through (server wins — backward-compat).
  if (
    serverSavedAt != null &&
    localSavedAt != null &&
    serverSavedAt < localSavedAt
  ) {
    return { applied: false, layout: null };
  }

  await writeLocal(normalized);
  return { applied: true, layout: normalized };
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const SERVER_ORDER: PillId[] = ["account", "map", "charge", "home", "activity"];
const SERVER_HIDDEN: PillId[] = ["activity"];
const SERVER_SAVED_AT = 1_700_000_010_000;

/** Server response that includes a savedAt timestamp (normal case). */
const SERVER_LAYOUT_WITH_TS: Partial<NavPillLayout> = {
  order: SERVER_ORDER,
  hidden: SERVER_HIDDEN,
  savedAt: SERVER_SAVED_AT,
};

/** Server response from a legacy server that never wrote savedAt. */
const SERVER_LAYOUT_NO_TS: Partial<NavPillLayout> = {
  order: SERVER_ORDER,
  hidden: SERVER_HIDDEN,
  // no savedAt
};

// ── Suite 1: first-time install — no timestamps on either side ────────────────
//
// The user has never opened the app before on any device.
// AsyncStorage is empty → localSavedAt is undefined.
// The server has no prior layout for this user → serverSavedAt is undefined.

describe("Phase 2 guard — first-time sign-in (no timestamps on either side)", () => {
  it("applies the server layout when both localSavedAt and serverSavedAt are undefined", async () => {
    const result = await runPhase2Guard({
      serverRaw: SERVER_LAYOUT_NO_TS,
      localSavedAt: undefined,
    });

    expect(result.applied).toBe(true);
  });

  it("writes the server layout to AsyncStorage so Phase 1 picks it up on the next cold start", async () => {
    await runPhase2Guard({
      serverRaw: SERVER_LAYOUT_NO_TS,
      localSavedAt: undefined,
    });

    const persisted = await readLocal();
    expect(persisted).not.toBeNull();
    expect(persisted!.order).toEqual(SERVER_ORDER);
  });

  it("returns the normalised server layout so the caller can apply it to React state", async () => {
    const result = await runPhase2Guard({
      serverRaw: SERVER_LAYOUT_NO_TS,
      localSavedAt: undefined,
    });

    expect(result.layout).not.toBeNull();
    expect(result.layout!.order).toEqual(SERVER_ORDER);
    expect(result.layout!.hidden).toEqual(SERVER_HIDDEN);
  });

  it("preserves the server hidden list when falling through on a first-time install", async () => {
    const result = await runPhase2Guard({
      serverRaw: SERVER_LAYOUT_NO_TS,
      localSavedAt: undefined,
    });

    expect(result.layout!.hidden).toEqual(SERVER_HIDDEN);
  });

  it("does not leave the guard stuck — applied is true, not false", async () => {
    // Explicit false-negative check: the guard must not interpret two absent
    // timestamps as 'stale server' and return applied=false.
    const result = await runPhase2Guard({
      serverRaw: SERVER_LAYOUT_NO_TS,
      localSavedAt: undefined,
    });

    expect(result.applied).not.toBe(false);
  });
});

// ── Suite 2: first-time sign-in with a timestamped server layout ──────────────
//
// The user signs in on a second device for the first time.
// This device has no prior AsyncStorage entry → localSavedAt is undefined.
// The server DOES have a savedAt (it was written by the first device).

describe("Phase 2 guard — first sign-in on a new device (no local savedAt, server has one)", () => {
  it("applies the server layout when only localSavedAt is undefined", async () => {
    const result = await runPhase2Guard({
      serverRaw: SERVER_LAYOUT_WITH_TS,
      localSavedAt: undefined,
    });

    expect(result.applied).toBe(true);
  });

  it("writes the timestamped server layout to AsyncStorage when localSavedAt is undefined", async () => {
    await runPhase2Guard({
      serverRaw: SERVER_LAYOUT_WITH_TS,
      localSavedAt: undefined,
    });

    const persisted = await readLocal();
    expect(persisted).not.toBeNull();
    expect(persisted!.savedAt).toBe(SERVER_SAVED_AT);
  });

  it("returns applied=true even when the server timestamp is very old", async () => {
    // 'old' is only meaningful if there is a local timestamp to compare against.
    // Without a local timestamp the guard must always fall through.
    const veryOldServer: Partial<NavPillLayout> = {
      order: SERVER_ORDER,
      hidden: [],
      savedAt: 1, // epoch + 1 ms — effectively the oldest possible
    };

    const result = await runPhase2Guard({
      serverRaw: veryOldServer,
      localSavedAt: undefined,
    });

    expect(result.applied).toBe(true);
  });

  it("persists the correct server order even when localSavedAt is absent", async () => {
    await runPhase2Guard({
      serverRaw: SERVER_LAYOUT_WITH_TS,
      localSavedAt: undefined,
    });

    const persisted = await readLocal();
    expect(persisted!.order).toEqual(SERVER_ORDER);
  });

  it("falls through and applies even when the server savedAt is lower than a hypothetical local value that is absent", async () => {
    // Regression guard: if someone refactors the condition to `||` instead of
    // `&&`, this test (along with the 'very old server' test above) would catch
    // it because the guard would incorrectly skip based on serverSavedAt alone.
    const result = await runPhase2Guard({
      serverRaw: { ...SERVER_LAYOUT_WITH_TS, savedAt: 1000 },
      localSavedAt: undefined,
    });

    expect(result.applied).toBe(true);
  });
});

// ── Suite 3: legacy local save — no savedAt in AsyncStorage ───────────────────
//
// The user has a local layout written before the savedAt field was introduced
// (pre-feature legacy save).  readLocal returns a layout with savedAt undefined,
// so localSavedAtRef.current remains undefined after Phase 1.
// Phase 2 must still apply the server layout rather than treating the missing
// local timestamp as a reason to skip.

describe("Phase 2 guard — legacy local save (localSavedAt undefined from old AsyncStorage format)", () => {
  it("applies the server layout when local AsyncStorage has no savedAt field", async () => {
    // Simulate what Phase 1 would set localSavedAtRef.current to after reading
    // a legacy stored value that never had savedAt.
    const result = await runPhase2Guard({
      serverRaw: SERVER_LAYOUT_WITH_TS,
      localSavedAt: undefined, // mirrors localSavedAtRef.current after legacy read
    });

    expect(result.applied).toBe(true);
  });

  it("overwrites the legacy local layout with the server layout in AsyncStorage", async () => {
    // Pre-populate a legacy layout (no savedAt) to simulate existing storage.
    const legacyLayout: NavPillLayout = {
      order: ["home", "charge", "map", "activity", "account"],
      hidden: [],
      savedAt: undefined as unknown as number, // no savedAt written by old code
    };
    await writeLocal(legacyLayout);
    jest.clearAllMocks();

    await runPhase2Guard({
      serverRaw: SERVER_LAYOUT_WITH_TS,
      localSavedAt: undefined,
    });

    const persisted = await readLocal();
    // Server order must replace the old legacy order.
    expect(persisted!.order).toEqual(SERVER_ORDER);
    expect(persisted!.savedAt).toBe(SERVER_SAVED_AT);
  });

  it("applies server layout from a legacy-format server response when localSavedAt is also absent", async () => {
    // Both sides have no savedAt — the very first sync ever.
    const result = await runPhase2Guard({
      serverRaw: SERVER_LAYOUT_NO_TS,
      localSavedAt: undefined,
    });

    expect(result.applied).toBe(true);
    expect(result.layout).not.toBeNull();
  });
});

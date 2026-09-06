/**
 * Integration-level tests for the Phase 1 rehydration path.
 *
 * Scenario: a signed-out user drags the nav pills into a custom order, saves
 * (writeLocal), then cold-restarts the app.  The Phase 1 read (readLocal)
 * must restore exactly what was written — including the savedAt timestamp —
 * before any server fetch fires.
 *
 * These tests use an in-memory AsyncStorage stand-in so they are fully
 * deterministic and require no native module bridging.
 */

// ── In-memory AsyncStorage mock ───────────────────────────────────────────────
// Must be registered before the module under test is imported so that
// @react-native-async-storage/async-storage resolves to this implementation.

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

import { readLocal, writeLocal, NAV_PILL_STORAGE_KEY } from "../utils/navPillStorage";
import { normalizeLayout } from "../constants/navPills";
import type { NavPillLayout, PillId } from "../constants/navPills";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Wipe the mock store between tests so state doesn't bleed across suites. */
beforeEach(() => {
  Object.keys(store).forEach((k) => delete store[k]);
  jest.clearAllMocks();
});

const CUSTOM_ORDER: PillId[] = ["charge", "map", "home", "activity", "account"];
const CUSTOM_HIDDEN: PillId[] = ["activity"];
const SAVED_AT = 1_700_000_000_000; // arbitrary but realistic Unix-ms timestamp

const SIGNED_OUT_LAYOUT: NavPillLayout = {
  order: CUSTOM_ORDER,
  hidden: CUSTOM_HIDDEN,
  savedAt: SAVED_AT,
};

// ── Suite 1: writeLocal → readLocal round-trip ────────────────────────────────

describe("Phase 1 rehydration — writeLocal → readLocal round-trip", () => {
  it("readLocal returns null when nothing has been written yet (cold start, no prior save)", async () => {
    const result = await readLocal();
    expect(result).toBeNull();
  });

  it("readLocal returns the layout that was written by writeLocal", async () => {
    await writeLocal(SIGNED_OUT_LAYOUT);
    const result = await readLocal();

    expect(result).not.toBeNull();
    expect(result!.order).toEqual(CUSTOM_ORDER);
    expect(result!.hidden).toEqual(CUSTOM_HIDDEN);
  });

  it("readLocal preserves the savedAt timestamp written while signed out", async () => {
    await writeLocal(SIGNED_OUT_LAYOUT);
    const result = await readLocal();

    expect(result!.savedAt).toBe(SAVED_AT);
  });

  it("writeLocal persists to the correct storage key", async () => {
    await writeLocal(SIGNED_OUT_LAYOUT);

    const raw = store[NAV_PILL_STORAGE_KEY];
    expect(raw).toBeDefined();
    const parsed = JSON.parse(raw) as NavPillLayout;
    expect(parsed.order).toEqual(CUSTOM_ORDER);
  });

  it("a second writeLocal overwrites the first — readLocal returns the latest layout", async () => {
    const firstLayout: NavPillLayout = {
      order: ["home", "map", "charge", "activity", "account"],
      hidden: [],
      savedAt: SAVED_AT - 1000,
    };
    const secondLayout: NavPillLayout = {
      order: CUSTOM_ORDER,
      hidden: CUSTOM_HIDDEN,
      savedAt: SAVED_AT,
    };

    await writeLocal(firstLayout);
    await writeLocal(secondLayout);
    const result = await readLocal();

    expect(result!.order).toEqual(CUSTOM_ORDER);
    expect(result!.savedAt).toBe(SAVED_AT);
  });

  it("writeLocal returns true on success", async () => {
    const ok = await writeLocal(SIGNED_OUT_LAYOUT);
    expect(ok).toBe(true);
  });

  it("readLocal returns null when the stored value is corrupt JSON", async () => {
    store[NAV_PILL_STORAGE_KEY] = "{ this is not valid json }}}";
    const result = await readLocal();
    expect(result).toBeNull();
  });
});

// ── Suite 2: normalizeLayout round-trip ──────────────────────────────────────

describe("normalizeLayout — round-trip fidelity", () => {
  it("preserves a valid order unchanged", () => {
    const result = normalizeLayout(SIGNED_OUT_LAYOUT);
    expect(result.order).toEqual(CUSTOM_ORDER);
  });

  it("preserves the hidden array for non-pinned pills", () => {
    const result = normalizeLayout(SIGNED_OUT_LAYOUT);
    expect(result.hidden).toContain("activity");
  });

  it("preserves the savedAt timestamp exactly", () => {
    const result = normalizeLayout(SIGNED_OUT_LAYOUT);
    expect(result.savedAt).toBe(SAVED_AT);
  });

  it("omits savedAt when the raw layout has none (backward-compat)", () => {
    const legacy: Partial<NavPillLayout> = {
      order: ["home", "map", "charge", "activity", "account"],
      hidden: [],
    };
    const result = normalizeLayout(legacy);
    expect(result.savedAt).toBeUndefined();
  });

  it("strips unknown pill IDs from order", () => {
    const raw = {
      order: ["home", "unknown_pill", "charge", "map", "activity", "account"] as PillId[],
      hidden: [] as PillId[],
      savedAt: SAVED_AT,
    };
    const result = normalizeLayout(raw);
    expect(result.order).not.toContain("unknown_pill");
  });

  it("adds any missing pill IDs to the end of order", () => {
    const raw: Partial<NavPillLayout> = {
      order: ["home", "charge"] as PillId[],
      hidden: [] as PillId[],
      savedAt: SAVED_AT,
    };
    const result = normalizeLayout(raw);
    // All five pills must be present
    expect(result.order).toHaveLength(5);
    expect(result.order).toContain("map");
    expect(result.order).toContain("activity");
    expect(result.order).toContain("account");
  });

  it("prevents pinned pills from appearing in hidden", () => {
    const raw: Partial<NavPillLayout> = {
      order: ["home", "map", "charge", "activity", "account"] as PillId[],
      // "charge" is pinned — it must be removed from hidden
      hidden: ["charge", "activity"] as PillId[],
      savedAt: SAVED_AT,
    };
    const result = normalizeLayout(raw);
    expect(result.hidden).not.toContain("charge");
    expect(result.hidden).toContain("activity");
  });

  it("round-trips a layout through JSON serialisation faithfully", () => {
    // Simulate what writeLocal + readLocal does: JSON.stringify → JSON.parse → normalizeLayout
    const serialised = JSON.parse(JSON.stringify(SIGNED_OUT_LAYOUT)) as Partial<NavPillLayout>;
    const result = normalizeLayout(serialised);

    expect(result.order).toEqual(SIGNED_OUT_LAYOUT.order);
    expect(result.hidden).toEqual(SIGNED_OUT_LAYOUT.hidden);
    expect(result.savedAt).toBe(SIGNED_OUT_LAYOUT.savedAt);
  });
});

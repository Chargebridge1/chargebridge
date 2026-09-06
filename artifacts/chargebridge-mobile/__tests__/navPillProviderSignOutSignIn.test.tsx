/**
 * Integration tests for the sign-out → sign-in ref-reset cycle in NavPillProvider.
 *
 * These tests mount the real NavPillProvider, drive isSignedIn through a full
 * sign-in → sign-out → sign-in cycle, and assert that the second sign-in applies
 * a fresh server layout — proving that the useEffect resets both
 * serverHydrated.current and localSavedAtRef.current on sign-out so Phase 2
 * runs again on the next sign-in.
 *
 * If either reset line were removed from NavPillContext's useEffect, the test
 * that checks the second server layout is applied would fail.
 */

// ─── Must be registered before any module under test is imported ──────────────

// 1. In-memory AsyncStorage
const store: Record<string, string> = {};
jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(async (k: string) => store[k] ?? null),
  setItem: jest.fn(async (k: string, v: string) => { store[k] = v; }),
  removeItem: jest.fn(async (k: string) => { delete store[k]; }),
}));

// 2. Clerk – isSignedIn and getToken are controlled per-test via module-level vars
let mockIsSignedIn = false;
const mockGetToken = jest.fn().mockResolvedValue("tok_test");
jest.mock("@clerk/expo", () => ({
  useAuth: () => ({ isSignedIn: mockIsSignedIn, getToken: mockGetToken }),
}));

// 3. expo-router – NavPillProvider only uses router in the save path, not Phase 1/2
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

// 4. react-query – provider only calls invalidateQueries in the save path
jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));

// 5. react-native – AppState for the foreground-retry listener; Alert for session expiry
jest.mock("react-native", () => ({
  AppState: {
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  },
  Alert: { alert: jest.fn() },
}));

// 6. analytics – avoid side-effects / unresolved native modules
jest.mock("@/lib/analytics", () => ({ track: jest.fn() }));

// 7. NavSaveErrorToast – stub away so we don't need full RN primitives
jest.mock("@/components/navigation/NavSaveErrorToast", () => ({
  NavSaveErrorToast: () => null,
}));

// ─── Imports (after mock registration) ────────────────────────────────────────

import React, { useEffect } from "react";
import { create, act } from "react-test-renderer";
import { NavPillProvider, useNavPills } from "../contexts/NavPillContext";
import { readLocal } from "../utils/navPillStorage";
import { normalizeLayout } from "../constants/navPills";
import type { NavPillLayout, PillId } from "../constants/navPills";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Drain all pending microtasks and macro-tasks so async effects can settle. */
const flushAsync = () =>
  act(async () => {
    await new Promise<void>((r) => setTimeout(r, 0));
  });

/**
 * A consumer that records every layout change into the supplied array.
 * useEffect([layout]) fires each time setLayout produces a new reference.
 */
function LayoutSpy({ record }: { record: NavPillLayout[] }) {
  const { layout } = useNavPills();
  useEffect(() => {
    record.push({ ...layout });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout]);
  return null;
}

/**
 * Wraps NavPillProvider + LayoutSpy, returning a helper that re-renders
 * the tree (so the useEffect dependency on isSignedIn is re-evaluated)
 * and the shared record array.
 */
function mountProvider() {
  const record: NavPillLayout[] = [];
  let renderer: ReturnType<typeof create>;

  act(() => {
    renderer = create(
      <NavPillProvider>
        <LayoutSpy record={record} />
      </NavPillProvider>,
    );
  });

  function rerender() {
    act(() => {
      renderer.update(
        <NavPillProvider>
          <LayoutSpy record={record} />
        </NavPillProvider>,
      );
    });
  }

  return { record, rerender };
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

// Session 1 server layout — returned by /api/me on the first sign-in
const S1_SAVED_AT = 1_700_000_010_000;
const S1_ORDER: PillId[] = ["charge", "map", "home", "activity", "account"];
const S1_HIDDEN: PillId[] = ["activity"];

const SESSION1_API_RESPONSE = {
  preferences: {
    navPillLayout: { order: S1_ORDER, hidden: S1_HIDDEN, savedAt: S1_SAVED_AT },
  },
};

// Session 2 server layout — returned by /api/me on the second device's sign-in
const S2_SAVED_AT = S1_SAVED_AT + 15_000; // saved later on another device
const S2_ORDER: PillId[] = ["account", "charge", "map", "home", "activity"];
const S2_HIDDEN: PillId[] = ["home", "activity"];

const SESSION2_API_RESPONSE = {
  preferences: {
    navPillLayout: { order: S2_ORDER, hidden: S2_HIDDEN, savedAt: S2_SAVED_AT },
  },
};

// ─── Per-test reset ────────────────────────────────────────────────────────────

beforeEach(() => {
  Object.keys(store).forEach((k) => delete store[k]);
  jest.clearAllMocks();
  mockIsSignedIn = false;
});

// ─── Suite 1: server layout is re-applied on second sign-in ───────────────────

describe("NavPillProvider — sign-out → sign-in re-applies server layout", () => {
  it("applies the session-1 server layout on first sign-in", async () => {
    // No prior local layout — Phase 1 reads nothing, Phase 2 applies server.
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => SESSION1_API_RESPONSE,
    } as Response);

    mockIsSignedIn = true;
    const { record, rerender } = mountProvider();
    rerender(); // re-render with isSignedIn=true so useEffect dependency fires
    await flushAsync();

    const lastLayout = record[record.length - 1];
    expect(lastLayout.order).toEqual(S1_ORDER);
    expect(lastLayout.savedAt).toBe(S1_SAVED_AT);
  });

  it("applies the session-2 server layout after sign-out → sign-in", async () => {
    // Set up fetch: session 1 on first call, session 2 on second call.
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => SESSION1_API_RESPONSE,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => SESSION2_API_RESPONSE,
      } as Response);

    // ── Sign in (session 1) ─────────────────────────────────────────
    mockIsSignedIn = true;
    const { record, rerender } = mountProvider();
    rerender();
    await flushAsync();

    // Confirm session 1 was applied before we continue.
    const afterSignIn1 = record[record.length - 1];
    expect(afterSignIn1.order).toEqual(S1_ORDER);

    // ── Sign out ────────────────────────────────────────────────────
    mockIsSignedIn = false;
    rerender();
    await flushAsync();

    // ── Sign in again (session 2) ───────────────────────────────────
    mockIsSignedIn = true;
    rerender();
    await flushAsync();

    // The layout must now reflect the session-2 server response.
    const afterSignIn2 = record[record.length - 1];
    expect(afterSignIn2.order).toEqual(S2_ORDER);
    expect(afterSignIn2.savedAt).toBe(S2_SAVED_AT);
  });

  it("session-2 layout is different from session-1 layout (regression: not stuck on stale state)", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => SESSION1_API_RESPONSE,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => SESSION2_API_RESPONSE,
      } as Response);

    mockIsSignedIn = true;
    const { record, rerender } = mountProvider();
    rerender();
    await flushAsync();

    mockIsSignedIn = false;
    rerender();
    await flushAsync();

    mockIsSignedIn = true;
    rerender();
    await flushAsync();

    const after1 = record.find((l) => l.savedAt === S1_SAVED_AT);
    const after2 = record[record.length - 1];

    // Both sessions must have been recorded
    expect(after1).toBeDefined();
    expect(after2.savedAt).toBe(S2_SAVED_AT);
    // And they must differ
    expect(after2.order).not.toEqual(after1!.order);
  });

  it("session-2 server layout is written to AsyncStorage after second sign-in", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => SESSION1_API_RESPONSE,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => SESSION2_API_RESPONSE,
      } as Response);

    mockIsSignedIn = true;
    const { rerender } = mountProvider();
    rerender();
    await flushAsync();

    mockIsSignedIn = false;
    rerender();
    await flushAsync();

    mockIsSignedIn = true;
    rerender();
    await flushAsync();

    const persisted = await readLocal();
    expect(persisted).not.toBeNull();
    expect(persisted!.savedAt).toBe(S2_SAVED_AT);
    expect(persisted!.order).toEqual(normalizeLayout(SESSION2_API_RESPONSE.preferences.navPillLayout).order);
  });

  it("fetch is called twice — once per sign-in session", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({
        ok: true,
        json: async () => SESSION2_API_RESPONSE,
      } as Response);

    mockIsSignedIn = true;
    const { rerender } = mountProvider();
    rerender();
    await flushAsync();

    mockIsSignedIn = false;
    rerender();
    await flushAsync();

    mockIsSignedIn = true;
    rerender();
    await flushAsync();

    // Each sign-in triggers a Phase 2 fetch.
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});

// ─── Suite 2: refs are truly reset — Phase 2 re-runs despite prior hydration ──

describe("NavPillProvider — serverHydrated reset confirms Phase 2 re-runs", () => {
  it("applies a server layout on both sign-ins even though serverHydrated was true after session 1", async () => {
    // If serverHydrated were NOT reset on sign-out, Phase 2 would be guarded by
    // the `if (!isSignedIn || serverHydrated.current) return` check in attemptPhase2
    // and the `if (!isSignedIn) return` guard in the main effect.
    // The test proves the reset happens by observing Phase 2's side effect (layout update).

    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => SESSION1_API_RESPONSE,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => SESSION2_API_RESPONSE,
      } as Response);

    mockIsSignedIn = true;
    const { record, rerender } = mountProvider();
    rerender();
    await flushAsync();

    // serverHydrated.current is now true inside the provider.
    // Sign-out → sign-in must reset it.
    mockIsSignedIn = false;
    rerender();
    await flushAsync();

    mockIsSignedIn = true;
    rerender();
    await flushAsync();

    // If serverHydrated was not reset, fetch would only be called once and
    // the layout would remain S1 forever.
    const last = record[record.length - 1];
    expect(last.savedAt).toBe(S2_SAVED_AT);
  });

  it("localSavedAtRef reset means Phase 2 falls through on a device with no prior local layout after sign-out", async () => {
    // Scenario: device has NO AsyncStorage entry for session 2 (e.g., cleared storage
    // or a fresh install on a second device).  Because localSavedAtRef is reset to
    // undefined on sign-out, Phase 1 finds nothing and leaves it undefined, so Phase 2
    // falls through regardless of the server's savedAt.
    //
    // If localSavedAtRef were NOT reset, it would still hold S1_SAVED_AT from the
    // previous session, causing the guard to block any server payload with a smaller
    // savedAt — which would be wrong because the local baseline is now empty.

    const oldTimestampS2: typeof SESSION2_API_RESPONSE = {
      preferences: {
        navPillLayout: {
          order: S2_ORDER,
          hidden: S2_HIDDEN,
          savedAt: S1_SAVED_AT - 1, // older than session-1's savedAt
        },
      },
    };

    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => SESSION1_API_RESPONSE,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => oldTimestampS2,
      } as Response);

    mockIsSignedIn = true;
    const { record, rerender } = mountProvider();
    rerender();
    await flushAsync();

    // Sign out — also wipe AsyncStorage to simulate a fresh/cleared device
    // for session 2 so Phase 1 finds nothing and localSavedAtRef stays undefined.
    mockIsSignedIn = false;
    rerender();
    await flushAsync();
    Object.keys(store).forEach((k) => delete store[k]); // clear storage between sessions

    mockIsSignedIn = true;
    rerender();
    await flushAsync();

    // localSavedAtRef was reset to undefined → Phase 1 finds no local data →
    // Phase 2 falls through → oldTimestampS2 is applied.
    const last = record[record.length - 1];
    expect(last.order).toEqual(S2_ORDER);
  });
});

// ─── Suite 3: sign-out clears state so next sign-in starts fresh ──────────────

describe("NavPillProvider — no stale ref bleed from prior session", () => {
  it("the session-1 server layout is not permanently stuck in state after sign-out → sign-in", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => SESSION1_API_RESPONSE,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => SESSION2_API_RESPONSE,
      } as Response);

    mockIsSignedIn = true;
    const { record, rerender } = mountProvider();
    rerender();
    await flushAsync();

    mockIsSignedIn = false;
    rerender();
    await flushAsync();

    mockIsSignedIn = true;
    rerender();
    await flushAsync();

    const last = record[record.length - 1];
    // Must have moved on from session-1; permanent S1 layout would be a ref bleed.
    expect(last.order).not.toEqual(S1_ORDER);
    expect(last.hidden).not.toEqual(S1_HIDDEN);
  });
});

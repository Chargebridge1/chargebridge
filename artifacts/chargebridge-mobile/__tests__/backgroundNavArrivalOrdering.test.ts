/**
 * backgroundNavArrivalOrdering.test.ts
 *
 * Integration-level tests for the arrival-ordering fix in backgroundNav.ts.
 *
 * Root cause (task-678): at highway speed (~29 m/tick) the background task's
 * arrival gate (distToDest < 60 m) and the step-advance threshold (65 m) both
 * trigger in the same GPS tick. Under the old ordering the arrival branch ran
 * first and called showArrivalNotification(), which immediately called
 * dismissNotificationAsync("chargebridge-nav-turn") — cancelling the turn
 * notification before the driver ever saw it.
 *
 * Fix: backgroundNav.ts now (a) runs step-advance BEFORE the arrival check so
 * the turn notification fires first, and (b) passes skipDismissTurn=true to
 * showArrivalNotification() when a turn fired in the same tick, preventing the
 * just-scheduled turn notification from being dismissed.
 *
 * Test approach
 * ─────────────
 * Suite A — Unit: showArrivalNotification(skipDismissTurn)
 *   Tests the new navNotifications.ts API directly: confirms skipDismissTurn
 *   controls whether dismissNotificationAsync is called.
 *
 * Suite B — Integration: backgroundNav task invocation
 *   Uses jest.isolateModules + dynamic require to load backgroundNav.ts fresh
 *   with all native modules mocked, then invokes the captured task callback
 *   with a synthetic GPS location and asserts the actual Notifications call
 *   sequence.
 */

// ── Static mocks (applied before any require in the test module) ──────────────
//
// These cover the modules that navNotifications.ts imports at the top level
// (Platform / Notifications). backgroundNav.ts mocks are registered inside
// jest.isolateModules in Suite B where timing is explicit.

jest.mock("expo-notifications", () => ({
  scheduleNotificationAsync: jest.fn().mockResolvedValue(undefined),
  dismissNotificationAsync: jest.fn().mockResolvedValue(undefined),
  setNotificationChannelAsync: jest.fn().mockResolvedValue(undefined),
  AndroidImportance: { HIGH: 5 },
  AndroidNotificationPriority: { HIGH: "high" },
}));

jest.mock("react-native", () => ({
  AppState: { currentState: "background" },
  Platform: { OS: "ios" },
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import * as Notifications from "expo-notifications";
import {
  showTurnNotification,
  showArrivalNotification,
  navState,
} from "../utils/navNotifications";

// ── Typed mock aliases ────────────────────────────────────────────────────────

const mockSchedule = Notifications.scheduleNotificationAsync as jest.MockedFunction<
  typeof Notifications.scheduleNotificationAsync
>;
const mockDismiss = Notifications.dismissNotificationAsync as jest.MockedFunction<
  typeof Notifications.dismissNotificationAsync
>;

// ── Helpers ───────────────────────────────────────────────────────────────────

const ORIGIN_LAT = 37.7749;
const ORIGIN_LNG = -122.4194;

function coordAt(distM: number) {
  return { latitude: ORIGIN_LAT + distM / 111320, longitude: ORIGIN_LNG };
}

function makeNavStep(distM: number) {
  return {
    instruction: `Turn in ${distM} m`,
    featherIcon: "arrow-right",
    coordinate: coordAt(distM),
  };
}

/** Return the ordered sequence of notification identifiers for each call. */
function scheduleOrder(): string[] {
  return mockSchedule.mock.calls.map(
    (c) => (c[0] as { identifier?: string }).identifier ?? "(unknown)",
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite A — Unit tests for showArrivalNotification(skipDismissTurn)
// ═══════════════════════════════════════════════════════════════════════════════
//
// These tests exercise the new API on navNotifications.ts directly, confirming
// that the skipDismissTurn flag correctly controls whether the turn notification
// is dismissed before arrival is scheduled.

describe("A — showArrivalNotification: skipDismissTurn flag", () => {
  // ── A1: default (false) — stale turn is dismissed ─────────────────────────

  it("A1 — default (skipDismissTurn=false): dismisses turn notification before scheduling arrival", async () => {
    await showArrivalNotification(); // skipDismissTurn defaults to false

    const dismissCalls = mockDismiss.mock.calls.map((c) => c[0] as string);
    expect(dismissCalls).toContain("chargebridge-nav-turn");

    expect(scheduleOrder()).toContain("chargebridge-nav-arrived");
  });

  it("A1b — dismiss fires before arrival is scheduled (call order)", async () => {
    await showArrivalNotification();

    const dismissOrder = mockDismiss.mock.invocationCallOrder[0];
    const scheduleCallOrder = mockSchedule.mock.invocationCallOrder[0];
    // dismiss must have been called before schedule
    expect(dismissOrder).toBeLessThan(scheduleCallOrder);
  });

  // ── A2: skipDismissTurn=true — turn notification is preserved ─────────────

  it("A2 — skipDismissTurn=true: does NOT dismiss the turn notification", async () => {
    await showArrivalNotification(true);

    const dismissCalls = mockDismiss.mock.calls.map((c) => c[0] as string);
    expect(dismissCalls).not.toContain("chargebridge-nav-turn");
  });

  it("A2b — skipDismissTurn=true: still schedules the arrival notification", async () => {
    await showArrivalNotification(true);

    expect(scheduleOrder()).toContain("chargebridge-nav-arrived");
  });

  it("A2c — skipDismissTurn=true: no dismissNotificationAsync calls at all", async () => {
    await showArrivalNotification(true);

    expect(mockDismiss).not.toHaveBeenCalled();
  });

  // ── A3: showTurnNotification then showArrivalNotification(true) ordering ───
  //
  // Simulates what the corrected backgroundNav.ts does in the overlapping tick:
  // turn fires first, then arrival with skipDismissTurn=true.

  it("A3 — turn scheduled before arrival, turn not dismissed when skipDismissTurn=true", async () => {
    const step = makeNavStep(55);
    const destCoord = coordAt(55);

    // Step 1: turn notification fires
    await showTurnNotification(step, null, 55);

    // Step 2: arrival fires with skipDismissTurn=true (same tick as turn)
    await showArrivalNotification(true);

    const order = scheduleOrder();
    const turnIdx = order.indexOf("chargebridge-nav-turn");
    const arrivedIdx = order.indexOf("chargebridge-nav-arrived");

    // Turn fires first
    expect(turnIdx).toBeGreaterThanOrEqual(0);
    expect(arrivedIdx).toBeGreaterThanOrEqual(0);
    expect(turnIdx).toBeLessThan(arrivedIdx);

    // Turn notification is NOT dismissed between the two schedule calls
    expect(mockDismiss).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite B — Integration: backgroundNav task callback invocation
// ═══════════════════════════════════════════════════════════════════════════════
//
// Uses jest.isolateModules + dynamic require to load backgroundNav.ts with
// a fresh module registry (avoiding the Babel import-hoisting / TDZ race that
// affects static imports), then calls the captured task callback directly with
// synthetic GPS data and asserts the real Notifications call sequence.

describe("B — backgroundNav task: notification call sequence at 55 m", () => {
  type TaskBody = {
    data: { locations: Array<{ coords: { latitude: number; longitude: number; speed: number | null } }> };
    error: null;
  };

  let taskCallback: ((body: TaskBody) => Promise<void>) | null = null;
  let bgNavState: typeof navState;
  // Captured inside isolateModules so the same mock instance is accessible
  // in test assertions without requiring expo-location from a different registry.
  let stopLocationMock: jest.MockedFunction<() => Promise<void>>;

  beforeAll(() => {
    // jest.isolateModules gives a fresh module registry; jest.doMock
    // (not hoisted) registers mocks synchronously before require() runs,
    // avoiding the static-import hoisting race.
    jest.isolateModules(() => {
      jest.doMock("expo-task-manager", () => ({
        defineTask: (_name: string, cb: (body: TaskBody) => Promise<void>) => {
          taskCallback = cb;
        },
      }));

      const stopMock = jest.fn().mockResolvedValue(undefined);
      stopLocationMock = stopMock;
      jest.doMock("expo-location", () => ({
        stopLocationUpdatesAsync: stopMock,
      }));

      // backgroundNav.ts calls TaskManager.defineTask at module load time.
      require("../tasks/backgroundNav");

      // Share the same navState singleton that backgroundNav.ts will read.
      bgNavState = require("../utils/navNotifications").navState;
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    expect(taskCallback).not.toBeNull();

    // Reset navState to an active two-step route.
    // Step 0: current position (origin) — already announced (lastNotifiedStepIdx=0)
    //   so any non-zero advance will trigger a turn notification.
    // Step 1: final maneuver + destination at 55 m (inside both the 60 m
    //         arrival gate and the 65 m highway step-advance threshold).
    //
    // lastNotifiedStepIdx=0 (not -1) simulates the steady state during
    // navigation where the driver has already heard the step-0 instruction.
    // Using -1 would cause a spurious turn-0 notification on every tick
    // because idx (which stays at 0 when no step advances) !== -1.
    bgNavState.isActive = true;
    bgNavState.currentStepIdx = 0;
    bgNavState.lastNotifiedStepIdx = 0;
    bgNavState.steps = [
      makeNavStep(0),   // step 0: current position
      makeNavStep(55),  // step 1: final maneuver at 55 m
    ];
    bgNavState.destLatitude = coordAt(55).latitude;
    bgNavState.destLongitude = ORIGIN_LNG;
    bgNavState.destLabel = "Test Destination";
  });

  // Helper: invoke the task with user at origin, highway speed.
  async function runTaskAt(distFromOriginM: number, speedMs: number) {
    await taskCallback!({
      data: {
        locations: [{
          coords: {
            latitude: ORIGIN_LAT + distFromOriginM / 111320,
            longitude: ORIGIN_LNG,
            speed: speedMs,
          },
        }],
      },
      error: null,
    });
  }

  // ── B1: overlapping tick — turn then arrival, turn not dismissed ───────────

  it("B1 — at 55 m (highway speed): turn notification fires before arrival", async () => {
    await runTaskAt(0, 65 / 2.237); // user at origin, 55 m to final step + dest

    const order = scheduleOrder();
    const turnIdx = order.indexOf("chargebridge-nav-turn");
    const arrivedIdx = order.indexOf("chargebridge-nav-arrived");

    expect(turnIdx).toBeGreaterThanOrEqual(0);   // turn was scheduled
    expect(arrivedIdx).toBeGreaterThanOrEqual(0); // arrival was scheduled
    expect(turnIdx).toBeLessThan(arrivedIdx);     // turn fired FIRST
  });

  it("B2 — at 55 m (highway speed): turn notification is NOT dismissed before arrival fires", async () => {
    await runTaskAt(0, 65 / 2.237);

    const order = scheduleOrder();
    const arrivedScheduleCallOrder =
      mockSchedule.mock.invocationCallOrder[order.indexOf("chargebridge-nav-arrived")];

    // Check that dismissNotificationAsync("chargebridge-nav-turn") was NOT
    // invoked before the arrival notification was scheduled.
    const prematureDismisses = mockDismiss.mock.calls.filter((c, i) => {
      return (
        (c[0] as string) === "chargebridge-nav-turn" &&
        mockDismiss.mock.invocationCallOrder[i] < arrivedScheduleCallOrder
      );
    });
    expect(prematureDismisses).toHaveLength(0);
  });

  it("B3 — at 55 m: navState.isActive becomes false and location updates stop", async () => {
    await runTaskAt(0, 65 / 2.237);

    expect(bgNavState.isActive).toBe(false);

    // Use the mock reference captured inside isolateModules (the same instance
    // that backgroundNav.ts received) — not require("expo-location"), which
    // would resolve from the outer static registry and be a different object.
    expect(stopLocationMock).toHaveBeenCalledTimes(1);
  });

  // ── B4: non-overlapping — step already notified, arrival alone ────────────
  //
  // When the final step was notified in a prior tick (lastNotifiedStepIdx = 1),
  // no turn fires in this tick. Arrival must dismiss the stale turn banner
  // (skipDismissTurn=false, the default).

  it("B4 — arrival-only tick (step already notified): stale turn banner IS dismissed", async () => {
    bgNavState.currentStepIdx = 1;
    bgNavState.lastNotifiedStepIdx = 1;

    await runTaskAt(0, 65 / 2.237);

    const dismissArgs = mockDismiss.mock.calls.map((c) => c[0] as string);
    expect(dismissArgs).toContain("chargebridge-nav-turn");

    // Arrival notification still fires
    expect(scheduleOrder()).toContain("chargebridge-nav-arrived");

    // Turn notification was NOT re-scheduled (step didn't change)
    expect(scheduleOrder()).not.toContain("chargebridge-nav-turn");
  });

  // ── B5: 62 m — inside step threshold (65 m), outside arrival gate (60 m) ──

  it("B5 — at 62 m: turn fires but arrival does NOT (> 60 m gate)", async () => {
    bgNavState.steps = [makeNavStep(0), makeNavStep(62)];
    bgNavState.destLatitude = coordAt(62).latitude;

    await runTaskAt(0, 65 / 2.237);

    expect(scheduleOrder()).toContain("chargebridge-nav-turn");
    expect(scheduleOrder()).not.toContain("chargebridge-nav-arrived");
    expect(bgNavState.isActive).toBe(true);
  });

  // ── B6: 300 m — neither threshold triggers ────────────────────────────────

  it("B6 — at 300 m: no notifications fire", async () => {
    bgNavState.steps = [makeNavStep(0), makeNavStep(300)];
    bgNavState.destLatitude = coordAt(300).latitude;

    await runTaskAt(0, 65 / 2.237);

    expect(mockSchedule).not.toHaveBeenCalled();
    expect(mockDismiss).not.toHaveBeenCalled();
    expect(bgNavState.isActive).toBe(true);
  });
});

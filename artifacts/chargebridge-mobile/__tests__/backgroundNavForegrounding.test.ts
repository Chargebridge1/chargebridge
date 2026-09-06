/**
 * backgroundNavForegrounding.test.ts
 *
 * Integration tests for the edge case in backgroundNav.ts where the app
 * transitions from background to foreground (AppState becomes "active") in the
 * same GPS tick that BOTH of the following conditions are true:
 *
 *   (a) The 65 m step-advance threshold is crossed — the final maneuver triggers,
 *       which would fire a turn push notification.
 *   (b) The 60 m arrival gate is crossed — showArrivalNotification() fires.
 *
 * At highway speed (~29 m/tick) these two thresholds overlap in a single location
 * batch.  If the app has just been foregrounded (AppState "active"), the foreground
 * GPS handler in map.tsx now owns currentStepIdx — so the background task must:
 *
 *   1. Still fire the turn notification (step-advance runs before arrival check).
 *   2. NOT write currentStepIdx (AppState guard: lines 62-64 of backgroundNav.ts).
 *   3. Still fire arrival (distToDest < 60 m gate: lines 129-134 of backgroundNav.ts).
 *   4. Pass skipDismissTurn=true to showArrivalNotification() so the just-shown
 *      turn notification is not immediately cancelled.
 *   5. NOT fire a duplicate turn notification if the step was already notified
 *      in a prior background tick (lastNotifiedStepIdx dedup guard).
 *
 * Test approach
 * ─────────────
 * Same pattern as backgroundNavArrivalOrdering.test.ts and
 * backgroundNavAppStateGuard.test.ts: jest.isolateModules + jest.doMock to load
 * the real backgroundNav.ts with native modules mocked, then invoke the captured
 * task callback with synthetic GPS locations.  AppState is controlled by mutating
 * capturedRN.AppState.currentState before each task invocation.
 *
 * Suite A — Foregrounding at 55 m (both thresholds overlap)
 *   Turn fires before arrival; currentStepIdx is NOT written; arrival fires with
 *   skipDismissTurn=true.
 *
 * Suite B — No duplicate turn after foregrounding
 *   When the step was already notified in a prior background tick, the foregrounded
 *   tick must NOT schedule a second turn notification.
 *
 * Suite C — Contrast: AppState "background" writes currentStepIdx normally
 *   Confirms the guard is gate-controlled; no regression on the non-active path.
 *
 * Suite D — Three-tick foregrounding sequence (realistic highway scenario)
 *   Tick 0: background, 90 m — no notifications, idx written (90 > 65 m threshold).
 *   Tick 1: active (foregrounded), 61 m — turn fires; arrival NOT yet (61 ≥ 60 m);
 *            currentStepIdx NOT written.
 *   Tick 2: active, 32 m — step already notified (no duplicate turn); arrival fires.
 */

// ── Static mocks (hoisted before any require) ─────────────────────────────────

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

// ── Imports ───────────────────────────────────────────────────────────────────

import * as Notifications from "expo-notifications";

// ── Typed aliases ─────────────────────────────────────────────────────────────

const mockSchedule = Notifications.scheduleNotificationAsync as jest.MockedFunction<
  typeof Notifications.scheduleNotificationAsync
>;
const mockDismiss = Notifications.dismissNotificationAsync as jest.MockedFunction<
  typeof Notifications.dismissNotificationAsync
>;

// ── Types ─────────────────────────────────────────────────────────────────────

type TaskBody = {
  data: {
    locations: Array<{
      coords: { latitude: number; longitude: number; speed: number | null };
    }>;
  };
  error: null;
};

type NavState = {
  isActive: boolean;
  steps: Array<{
    instruction: string;
    featherIcon: string;
    coordinate: { latitude: number; longitude: number };
  }>;
  currentStepIdx: number;
  destLatitude: number;
  destLongitude: number;
  destLabel: string;
  lastNotifiedStepIdx: number;
  notifiedStepIndices: Set<number>;
};

// ── Module-level shared state (populated inside isolateModules) ────────────────

let taskCallback: ((body: TaskBody) => Promise<void>) | null = null;
let bgNavState: NavState;
// capturedRN is mutated per-test to control AppState.currentState.
let capturedRN: { AppState: { currentState: string }; Platform: { OS: string } };
let stopLocationMock: jest.MockedFunction<() => Promise<void>>;

// ── Constants ─────────────────────────────────────────────────────────────────

const ORIGIN_LAT = 37.7749;
const ORIGIN_LNG = -122.4194;
const HIGHWAY_MS = 65 / 2.237; // ~29 m/s; navStepThreshold → 65 m

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

/** Ordered list of notification identifiers scheduled so far. */
function scheduleOrder(): string[] {
  return mockSchedule.mock.calls.map(
    (c) => (c[0] as { identifier?: string }).identifier ?? "(unknown)",
  );
}

// ── Module loading ────────────────────────────────────────────────────────────

beforeAll(() => {
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

    // Capture the react-native mock used by this isolated module graph.
    capturedRN = require("react-native");

    // Loading backgroundNav.ts causes defineTask to run, populating taskCallback.
    require("../tasks/backgroundNav");

    // Grab the shared navState singleton that backgroundNav.ts reads/writes.
    bgNavState = require("../utils/navNotifications").navState;
  });
});

// ── Per-test reset ────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  expect(taskCallback).not.toBeNull();

  // Two-step route: step 0 at origin, step 1 (final maneuver + destination)
  // 55 m north — inside both the 65 m highway step-advance threshold and the
  // 60 m arrival gate, so both conditions trigger in the same GPS tick.
  bgNavState.isActive = true;
  bgNavState.currentStepIdx = 0;
  bgNavState.lastNotifiedStepIdx = 0;
  bgNavState.steps = [makeNavStep(0), makeNavStep(55)];
  bgNavState.destLatitude = coordAt(55).latitude;
  bgNavState.destLongitude = ORIGIN_LNG;
  bgNavState.destLabel = "Test Destination";
  bgNavState.notifiedStepIndices = new Set();

  // Default AppState to background (tests that simulate foregrounding set it
  // to "active" explicitly before the task invocation).
  capturedRN.AppState.currentState = "background";
});

// ── Helper: invoke the background task with the user at `distFromOriginM` ─────

async function runTaskAt(
  distFromOriginM: number,
  speedMs: number = HIGHWAY_MS,
) {
  await taskCallback!({
    data: {
      locations: [
        {
          coords: {
            latitude: ORIGIN_LAT + distFromOriginM / 111320,
            longitude: ORIGIN_LNG,
            speed: speedMs,
          },
        },
      ],
    },
    error: null,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Suite A — Foregrounding at 55 m (step-advance threshold + arrival gate overlap)
// ═══════════════════════════════════════════════════════════════════════════════
//
// The app has just foregrounded (AppState "active") at the exact tick where the
// final maneuver is 55 m away and distToDest < 60 m.  Both the turn and arrival
// conditions are true simultaneously.  The background task must fire the turn
// first, then arrival — and must NOT write currentStepIdx.

describe("A — Foregrounding at 55 m: turn fires before arrival, currentStepIdx not written", () => {
  beforeEach(() => {
    capturedRN.AppState.currentState = "active"; // app has been foregrounded
  });

  // ── A1: turn notification fires ───────────────────────────────────────────

  it("A1 — turn notification is scheduled when the final maneuver is 55 m away", async () => {
    await runTaskAt(0); // user at origin, 55 m to final step

    expect(scheduleOrder()).toContain("chargebridge-nav-turn");
  });

  // ── A2: arrival notification fires ───────────────────────────────────────

  it("A2 — arrival notification is scheduled (distToDest 55 m < 60 m gate)", async () => {
    await runTaskAt(0);

    expect(scheduleOrder()).toContain("chargebridge-nav-arrived");
  });

  // ── A3: turn fires BEFORE arrival ────────────────────────────────────────

  it("A3 — turn notification is scheduled before arrival notification", async () => {
    await runTaskAt(0);

    const order = scheduleOrder();
    const turnIdx = order.indexOf("chargebridge-nav-turn");
    const arrivedIdx = order.indexOf("chargebridge-nav-arrived");

    expect(turnIdx).toBeGreaterThanOrEqual(0);
    expect(arrivedIdx).toBeGreaterThanOrEqual(0);
    expect(turnIdx).toBeLessThan(arrivedIdx); // turn must precede arrival
  });

  // ── A4: turn notification NOT dismissed between turn and arrival ──────────
  //
  // showArrivalNotification(skipDismissTurn=true) must NOT call
  // dismissNotificationAsync("chargebridge-nav-turn") so the driver can see
  // the final maneuver banner before the arrival screen appears.

  it("A4 — turn notification is not dismissed before arrival fires (skipDismissTurn=true)", async () => {
    await runTaskAt(0);

    const order = scheduleOrder();
    const arrivedCallOrder =
      mockSchedule.mock.invocationCallOrder[order.indexOf("chargebridge-nav-arrived")];

    // No dismissNotificationAsync("chargebridge-nav-turn") call before arrival.
    const prematureDismisses = mockDismiss.mock.calls.filter((c, i) => {
      return (
        (c[0] as string) === "chargebridge-nav-turn" &&
        mockDismiss.mock.invocationCallOrder[i] < arrivedCallOrder
      );
    });
    expect(prematureDismisses).toHaveLength(0);
  });

  // ── A5: currentStepIdx is NOT written by the background task ─────────────
  //
  // The foreground GPS handler in map.tsx owns currentStepIdx when active.
  // Writing a potentially stale background index would race the foreground.

  it("A5 — currentStepIdx is NOT written by the background task when AppState is active", async () => {
    await runTaskAt(0);

    // Background computed idx=1 (advance triggered) but the AppState guard
    // must have suppressed the write — currentStepIdx remains 0.
    expect(bgNavState.currentStepIdx).toBe(0);
  });

  // ── A6: navState.isActive is set to false (route completed) ──────────────

  it("A6 — navState.isActive becomes false after arrival fires", async () => {
    await runTaskAt(0);

    expect(bgNavState.isActive).toBe(false);
  });

  // ── A7: location updates are stopped ─────────────────────────────────────

  it("A7 — stopLocationUpdatesAsync is called once when arrival fires", async () => {
    await runTaskAt(0);

    expect(stopLocationMock).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite B — No duplicate turn notification after foregrounding
// ═══════════════════════════════════════════════════════════════════════════════
//
// The background task may have already notified the final step in a prior tick
// while the app was backgrounded (lastNotifiedStepIdx === newIdx).  After the
// app foregrounds, a stale background batch must NOT schedule a second turn
// notification for the same step — the lastNotifiedStepIdx dedup guard prevents it.

describe("B — No duplicate turn when step was already notified before foregrounding", () => {
  beforeEach(() => {
    capturedRN.AppState.currentState = "active";

    // Simulate state after a prior background tick already notified step 1.
    bgNavState.currentStepIdx = 0;      // background never wrote (or was active)
    bgNavState.lastNotifiedStepIdx = 1; // already announced in a previous tick
    bgNavState.notifiedStepIndices = new Set([1]);
  });

  // ── B1: turn NOT re-scheduled ─────────────────────────────────────────────

  it("B1 — turn notification is NOT re-scheduled when step was already notified", async () => {
    await runTaskAt(0); // 55 m to step 1 — advance would fire, but dedup guard blocks it

    expect(scheduleOrder()).not.toContain("chargebridge-nav-turn");
  });

  // ── B2: arrival still fires ───────────────────────────────────────────────

  it("B2 — arrival notification still fires even when the turn dedup guard blocks the turn", async () => {
    await runTaskAt(0);

    expect(scheduleOrder()).toContain("chargebridge-nav-arrived");
  });

  // ── B3: stale turn banner dismissed (skipDismissTurn=false) ─────────────
  //
  // No turn fired this tick → skipDismissTurn=false → the arrival handler
  // calls dismissNotificationAsync("chargebridge-nav-turn") to clear any
  // stale turn banner from a prior tick.

  it("B3 — stale turn banner is dismissed before arrival (skipDismissTurn=false when no turn this tick)", async () => {
    await runTaskAt(0);

    const dismissArgs = mockDismiss.mock.calls.map((c) => c[0] as string);
    expect(dismissArgs).toContain("chargebridge-nav-turn");
  });

  // ── B4: currentStepIdx still not written when active ─────────────────────

  it("B4 — currentStepIdx is still not written even when the turn dedup guard fires", async () => {
    await runTaskAt(0);

    // currentStepIdx stays at its pre-tick value (0) — active guard applies
    // regardless of whether the turn notification fired.
    expect(bgNavState.currentStepIdx).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite C — Contrast: AppState "background" writes currentStepIdx normally
// ═══════════════════════════════════════════════════════════════════════════════
//
// Confirms the write gate is correctly controlled by AppState — when the app is
// backgrounded the background task owns currentStepIdx and writes it normally.
// This guards against a regression where the guard is made unconditional.

describe("C — Contrast: AppState background writes currentStepIdx (guard is gated)", () => {
  beforeEach(() => {
    capturedRN.AppState.currentState = "background";
  });

  it("C1 — AppState background at 55 m: turn fires AND currentStepIdx IS written", async () => {
    await runTaskAt(0);

    expect(scheduleOrder()).toContain("chargebridge-nav-turn");
    expect(bgNavState.currentStepIdx).toBe(1); // background wrote the advanced idx
  });

  it("C2 — AppState background at 55 m: arrival fires AND location updates stop", async () => {
    await runTaskAt(0);

    expect(scheduleOrder()).toContain("chargebridge-nav-arrived");
    expect(bgNavState.isActive).toBe(false);
    expect(stopLocationMock).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite D — Three-tick foregrounding sequence (realistic highway scenario)
// ═══════════════════════════════════════════════════════════════════════════════
//
// Replays three consecutive GPS ticks on a highway approach where the app
// foregrounds on tick 1.  Maneuver at 90 m north; ticks at 0, 29, 58 m north.
//
//   Tick 0: AppState "background", user 0 m north (90 m to maneuver).
//            90 m > 65 m threshold → no advance, no turn.
//            background writes idx (stays 0).
//   Tick 1: AppState "active" (foregrounded), user 29 m north (61 m to maneuver).
//            61 m < 65 m threshold → advance computed (idx → 1); turn fires.
//            61 m > 60 m → arrival does NOT fire.
//            Active guard: currentStepIdx NOT written (stays 0).
//   Tick 2: AppState "active", user 58 m north (32 m to destination).
//            Step 1 already notified → no duplicate turn.
//            32 m < 60 m → arrival fires.
//            Active guard: currentStepIdx still NOT written (stays 0).

describe("D — Three-tick foregrounding sequence: realistic highway approach", () => {
  beforeEach(() => {
    // Two-step route: step 1 (final maneuver) at 90 m.
    bgNavState.isActive = true;
    bgNavState.currentStepIdx = 0;
    bgNavState.lastNotifiedStepIdx = 0;
    bgNavState.steps = [makeNavStep(0), makeNavStep(90)];
    bgNavState.destLatitude = coordAt(90).latitude;
    bgNavState.destLongitude = ORIGIN_LNG;
    bgNavState.destLabel = "Test Destination";
    bgNavState.notifiedStepIndices = new Set();
  });

  it("D1 — Tick 0 (background, 90 m): no notifications fire", async () => {
    capturedRN.AppState.currentState = "background";

    await runTaskAt(0); // 90 m to maneuver — outside 65 m threshold

    expect(mockSchedule).not.toHaveBeenCalled();
    expect(bgNavState.currentStepIdx).toBe(0); // no advance, idx unchanged
    expect(bgNavState.isActive).toBe(true);
  });

  it("D2 — Tick 1 (active, 61 m): turn fires; arrival does NOT; currentStepIdx NOT written", async () => {
    capturedRN.AppState.currentState = "background";
    await runTaskAt(0); // tick 0 — no advance, establishes baseline

    jest.clearAllMocks();
    bgNavState.isActive = true; // ensure still active after tick 0 (no arrival)

    capturedRN.AppState.currentState = "active"; // foregrounded
    await runTaskAt(29); // 61 m to 90 m maneuver — inside 65 m threshold

    expect(scheduleOrder()).toContain("chargebridge-nav-turn");     // turn fires
    expect(scheduleOrder()).not.toContain("chargebridge-nav-arrived"); // 61 m > 60 m — no arrival
    expect(bgNavState.currentStepIdx).toBe(0); // active guard — NOT written
    expect(bgNavState.isActive).toBe(true);    // arrival not yet triggered
  });

  it("D3 — Tick 2 (active, 32 m to dest): no duplicate turn; arrival fires; currentStepIdx still not written", async () => {
    // Replay tick 0 and tick 1 to establish lastNotifiedStepIdx=1.
    capturedRN.AppState.currentState = "background";
    await runTaskAt(0); // tick 0

    bgNavState.isActive = true;
    capturedRN.AppState.currentState = "active";
    await runTaskAt(29); // tick 1 — turn fires, lastNotifiedStepIdx becomes 1

    jest.clearAllMocks();
    bgNavState.isActive = true; // reset — tick 1 did not trigger arrival

    // Tick 2: still active, 32 m from destination (< 60 m gate).
    await runTaskAt(58); // user 58 m north, 32 m to dest at 90 m

    expect(scheduleOrder()).not.toContain("chargebridge-nav-turn");   // dedup: already notified
    expect(scheduleOrder()).toContain("chargebridge-nav-arrived");    // 32 m < 60 m
    expect(bgNavState.currentStepIdx).toBe(0); // active guard — still not written
    expect(bgNavState.isActive).toBe(false);   // route complete
  });

  it("D4 — Full three-tick sequence: combined notification and currentStepIdx assertions", async () => {
    const notifications: Array<{ tick: number; id: string }> = [];
    let currentStepIdxSnapshots: number[] = [];

    // Tick 0: background, 90 m — no notifications.
    capturedRN.AppState.currentState = "background";
    await runTaskAt(0);
    scheduleOrder().forEach((id) => notifications.push({ tick: 0, id }));
    currentStepIdxSnapshots.push(bgNavState.currentStepIdx);
    jest.clearAllMocks();

    // Tick 1: active (foregrounded), 61 m — turn fires; no arrival.
    bgNavState.isActive = true;
    capturedRN.AppState.currentState = "active";
    await runTaskAt(29);
    scheduleOrder().forEach((id) => notifications.push({ tick: 1, id }));
    currentStepIdxSnapshots.push(bgNavState.currentStepIdx);
    jest.clearAllMocks();

    // Tick 2: active, 32 m — no duplicate turn; arrival fires.
    bgNavState.isActive = true;
    await runTaskAt(58);
    scheduleOrder().forEach((id) => notifications.push({ tick: 2, id }));
    currentStepIdxSnapshots.push(bgNavState.currentStepIdx);

    // Tick 0: nothing fires.
    expect(notifications.filter((n) => n.tick === 0)).toHaveLength(0);

    // Tick 1: exactly one turn notification, no arrival.
    const tick1 = notifications.filter((n) => n.tick === 1);
    expect(tick1.map((n) => n.id)).toContain("chargebridge-nav-turn");
    expect(tick1.map((n) => n.id)).not.toContain("chargebridge-nav-arrived");

    // Tick 2: no turn (dedup), exactly one arrival.
    const tick2 = notifications.filter((n) => n.tick === 2);
    expect(tick2.map((n) => n.id)).not.toContain("chargebridge-nav-turn");
    expect(tick2.map((n) => n.id)).toContain("chargebridge-nav-arrived");

    // currentStepIdx never written by the background while app is active.
    // After tick 0 (background, no advance): still 0.
    // After tick 1 (active): still 0 (guard suppressed write).
    // After tick 2 (active): still 0.
    expect(currentStepIdxSnapshots).toEqual([0, 0, 0]);
  });
});

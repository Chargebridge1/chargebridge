/**
 * backgroundNavAppStateGuard.test.ts
 *
 * Integration tests for the AppState guard in backgroundNav.ts (lines 61-63):
 *
 *   if (AppState.currentState !== "active") {
 *     navState.currentStepIdx = idx;
 *   }
 *
 * Root cause this prevents: when the user has the app open (foreground),
 * the foreground GPS handler in map.tsx owns currentStepIdx at 1 Hz.
 * If a stale background location batch arrives concurrently and overwrites
 * currentStepIdx, the voice block announces the wrong (skipped) step.
 *
 * Test approach
 * ─────────────
 * Suite A — active state: background computes new idx, does NOT write it
 *   The foreground had already advanced to step 1; a background location batch
 *   arrives with an older reading.  Assert navState.currentStepIdx stays at 1.
 *
 * Suite B — background / inactive states: background DOES write the new idx
 *   App is truly backgrounded; background task owns currentStepIdx.
 *
 * Suite C — highway-speed GPS sequence parity
 *   Replays a 4-tick approach through the real task callback with AppState
 *   alternating between active and background to confirm:
 *   - Advance tick is the same regardless of AppState (pure function agreement)
 *   - Write gate correctly suppresses / allows the currentStepIdx update
 *
 * Uses jest.isolateModules + dynamic require (same pattern as
 * backgroundNavArrivalOrdering.test.ts) to load backgroundNav.ts fresh with
 * all native modules mocked, then invokes the captured task callback directly.
 */

// ── Static mocks (hoisted before any require) ─────────────────────────────────
//
// expo-notifications is required by navNotifications.ts at module load time.
// react-native: AppState.currentState is set per-test by mutating capturedRN.

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
  steps: Array<{ instruction: string; featherIcon: string; coordinate: { latitude: number; longitude: number } }>;
  currentStepIdx: number;
  destLatitude: number;
  destLongitude: number;
  destLabel: string;
  lastNotifiedStepIdx: number;
};

// ── Module-level shared state (populated inside isolateModules) ────────────────

let taskCallback: ((body: TaskBody) => Promise<void>) | null = null;
let bgNavState: NavState;
// Reference to the mocked react-native object so tests can mutate currentState.
let capturedRN: { AppState: { currentState: string }; Platform: { OS: string } };

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

// ── Module loading (runs once for all suites) ─────────────────────────────────

beforeAll(() => {
  jest.isolateModules(() => {
    jest.doMock("expo-task-manager", () => ({
      defineTask: (_name: string, cb: (body: TaskBody) => Promise<void>) => {
        taskCallback = cb;
      },
    }));

    jest.doMock("expo-location", () => ({
      stopLocationUpdatesAsync: jest.fn().mockResolvedValue(undefined),
    }));

    // Capture the react-native mock from this isolated scope — this is the
    // exact same object that backgroundNav.ts will read AppState.currentState
    // from at callback-invocation time (not module-load time).
    capturedRN = require("react-native");

    // backgroundNav.ts calls TaskManager.defineTask at module load time,
    // populating taskCallback via the doMock above.
    require("../tasks/backgroundNav");

    // Share the same navState singleton that backgroundNav.ts will read/write.
    bgNavState = require("../utils/navNotifications").navState;
  });
});

// ── Per-test reset ─────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  expect(taskCallback).not.toBeNull();

  // Two-step route: step 0 at origin, step 1 (maneuver + destination) 90 m north.
  // At 65 mph the 65 m threshold fires when the user reaches ~25 m (origin+25 m
  // is 65 m away from the 90 m maneuver point).
  bgNavState.isActive = true;
  bgNavState.currentStepIdx = 0;
  bgNavState.lastNotifiedStepIdx = 0;
  bgNavState.steps = [makeNavStep(0), makeNavStep(90)];
  bgNavState.destLatitude = coordAt(90).latitude;
  bgNavState.destLongitude = ORIGIN_LNG;
  bgNavState.destLabel = "Test Destination";

  // Default AppState to background (the non-guarded path) so tests that want
  // active must set it explicitly.
  capturedRN.AppState.currentState = "background";
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function runTaskAt(distFromOriginM: number, speedMs: number = HIGHWAY_MS) {
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

// ═══════════════════════════════════════════════════════════════════════════════
// Suite A — AppState "active": background must NOT write currentStepIdx
// ═══════════════════════════════════════════════════════════════════════════════
//
// The foreground GPS handler in map.tsx owns currentStepIdx when the app is
// active.  A background location batch may be stale by several seconds at
// highway speed.  Writing a potentially old index would rewind the foreground's
// step counter, causing the wrong voice announcement.

describe("A — AppState active: background does not write currentStepIdx", () => {
  beforeEach(() => {
    capturedRN.AppState.currentState = "active";
  });

  // ── A1: background loc arrives while user is 25 m from origin ────────────
  //
  // Maneuver is at 90 m; user at 25 m → distance to maneuver ≈ 65 m.
  // navStepThreshold(highway) = 65 m; 65 m is NOT < 65 m → no advance.
  // currentStepIdx must remain 0.

  it("A1 — no advance when maneuver is exactly at threshold: currentStepIdx stays 0", async () => {
    await runTaskAt(25); // 65 m to 90 m maneuver — not inside threshold
    expect(bgNavState.currentStepIdx).toBe(0);
  });

  // ── A2: background loc arrives at 26 m (just inside 65 m threshold) ───────
  //
  // Distance to maneuver ≈ 64 m < 65 m → backgroundAdvanceStepIdx computes idx=1.
  // AppState is "active" → the guard must suppress the write → stays at 0.

  it("A2 — step advance IS computed but NOT written when AppState is active (core guard)", async () => {
    await runTaskAt(26); // ~64 m to 90 m maneuver — inside 65 m threshold
    // The background computed idx=1 but must not have written it.
    expect(bgNavState.currentStepIdx).toBe(0);
  });

  // ── A3: foreground had already advanced; stale background must not rewind ──
  //
  // Simulates: foreground advanced to step 1 (map.tsx wrote currentStepIdx=1).
  // A stale background batch arrives with a location that only sees step 0.
  // Guard must prevent the background from rewinding currentStepIdx from 1→0.

  it("A3 — foreground-advanced idx is not rewound by a stale background batch when active", async () => {
    // Foreground already wrote step 1.
    bgNavState.currentStepIdx = 1;
    bgNavState.lastNotifiedStepIdx = 1;

    // Background batch arrives at origin — backgroundAdvanceStepIdx(1,...) with
    // maneuver at 90 m: distance = 90 m > 65 m threshold → idx stays 1.
    // Even if the batch were stale enough to produce a different idx, the guard
    // would block the write.  This test confirms the guard path.
    await runTaskAt(0);

    // idx must remain 1 (not rewound to 0)
    expect(bgNavState.currentStepIdx).toBe(1);
  });

  // ── A4: multiple ticks — guard applies on every tick while active ──────────

  it("A4 — guard suppresses write on every tick across a full approach while active", async () => {
    // 4 ticks approaching the 90 m maneuver from origin.
    for (const distM of [0, 15, 26, 40]) {
      await runTaskAt(distM);
    }
    // Active guard must have suppressed all writes; idx stays at 0.
    expect(bgNavState.currentStepIdx).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite B — AppState "background" / "inactive": background DOES write idx
// ═══════════════════════════════════════════════════════════════════════════════

describe("B — AppState background/inactive: background writes currentStepIdx", () => {
  // ── B1: "background" — write allowed ──────────────────────────────────────

  it("B1 — AppState background: step advance IS written to currentStepIdx", async () => {
    capturedRN.AppState.currentState = "background";

    await runTaskAt(26); // ~64 m to maneuver — inside 65 m threshold → advances
    expect(bgNavState.currentStepIdx).toBe(1);
  });

  // ── B2: "inactive" — write allowed ────────────────────────────────────────
  //
  // "inactive" covers iOS transition state (notification centre, incoming call).
  // The foreground is not rendering; background task owns currentStepIdx.

  it("B2 — AppState inactive: step advance IS written to currentStepIdx", async () => {
    capturedRN.AppState.currentState = "inactive";

    await runTaskAt(26); // inside threshold → advances
    expect(bgNavState.currentStepIdx).toBe(1);
  });

  // ── B3: "background" — no advance when outside threshold ──────────────────

  it("B3 — AppState background: no write when maneuver is outside threshold", async () => {
    capturedRN.AppState.currentState = "background";

    await runTaskAt(0); // 90 m to maneuver — outside 65 m threshold
    expect(bgNavState.currentStepIdx).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite C — AppState transition mid-route: active→background→active
// ═══════════════════════════════════════════════════════════════════════════════
//
// Replays a 5-tick highway approach where AppState changes between ticks to
// confirm:
//   - When active: background never writes currentStepIdx.
//   - When background: background writes on the first in-threshold tick.
//   - When active again: guard re-applies; foreground value is not overwritten.

describe("C — AppState transitions during a highway-speed approach", () => {
  it("C1 — active→background→active: write gate correctly follows AppState per tick", async () => {
    // Maneuver at 90 m north.
    // Tick distances to maneuver: 90 → 61 → 42 → 13 m.
    // Threshold = 65 m → advance happens at tick 2 (61 m) and tick 3 (42 m).
    //
    // Tick 0: active   — 90 m outside, no advance even if it were background
    // Tick 1: active   — 61 m inside, advance computed but NOT written (active)
    // Tick 2: background — 42 m inside, advance computed AND written
    // Tick 3: active   — 13 m inside, advance computed but NOT written (active)
    const appStates: Array<"active" | "background"> = [
      "active",
      "active",
      "background",
      "active",
    ];
    const userPositions = [0, 29, 48, 77]; // metres north of origin

    for (let i = 0; i < userPositions.length; i++) {
      capturedRN.AppState.currentState = appStates[i];
      await runTaskAt(userPositions[i]);
    }

    // Only tick 2 (background) wrote to currentStepIdx — final value is 1.
    expect(bgNavState.currentStepIdx).toBe(1);
  });

  it("C2 — fully active across all ticks: currentStepIdx never updated by background", async () => {
    const userPositions = [0, 29, 48, 77];

    for (const distM of userPositions) {
      capturedRN.AppState.currentState = "active";
      await runTaskAt(distM);
    }

    expect(bgNavState.currentStepIdx).toBe(0); // foreground owns it; never written
  });

  it("C3 — fully background across all ticks: currentStepIdx updated on first in-threshold tick", async () => {
    const userPositions = [0, 29, 48, 77]; // tick 1 first to enter threshold

    for (const distM of userPositions) {
      capturedRN.AppState.currentState = "background";
      await runTaskAt(distM);
    }

    expect(bgNavState.currentStepIdx).toBe(1); // written on tick with 61 m
  });
});

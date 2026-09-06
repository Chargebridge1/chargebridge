/**
 * navReroute.test.ts
 *
 * Three targeted tests — one per reroute trigger path — that mirror the
 * branch-condition logic from map.tsx and verify that after resetRouteRefs
 * fires every shared ref is in the canonical post-reset state:
 *
 *   prevProgressIdx = 0
 *   wrongDirCount   = 0
 *   offRouteCount   = 0
 *   missedTurn      = null
 *   voiceAnnounced  = {}
 *   routeVersion    incremented by exactly 1
 *
 * The tests mirror the pure logic from map.tsx without mounting any React
 * component, following the same "mirror the contract" pattern used by
 * navRerouteReset.test.ts and navPillPhase2.test.ts.
 */

// ── Minimal type mirrors ──────────────────────────────────────────────────────

type LatLng = { latitude: number; longitude: number };

type RouteStep = {
  coordinate: LatLng;
  instruction: string;
  featherIcon: string;
  distanceM: number;
  durationS: number;
  streetName: string;
};

type RouteResult = {
  coordinates: LatLng[];
  steps: RouteStep[];
  distanceKm: number;
  durationMin: number;
};

// ── Ref-bag (mirrors the mutable refs from map.tsx) ───────────────────────────

type NavRefs = {
  routeVersion: number;
  routeCoord: LatLng[];
  routeSteps: RouteStep[];
  voiceAnnounced: Record<number, true>;
  offRouteCount: number;
  wrongDirCount: number;
  prevProgressIdx: number;
  missedTurn: { idx: number; minDist: number; wasClose: boolean } | null;
  isRecalculating: boolean;
  lastRecalcTime: number;
  offRouteStartMs: number;
};

// ── Mirrors of the three branch condition guards from map.tsx ─────────────────

/**
 * Wrong-direction guard (map.tsx ~line 3486–3537).
 * Returns true when the reroute should fire.
 * Mirror: wrongDirCountRef >= wdCountThresh && !isRecalculating && cooldown elapsed.
 */
function wrongDirShouldReroute(refs: NavRefs, speedMph: number, now: number): boolean {
  const wdCountThresh = speedMph > 30 ? 3 : 4;
  return (
    refs.wrongDirCount >= wdCountThresh &&
    !refs.isRecalculating &&
    now - refs.lastRecalcTime > 20_000
  );
}

/**
 * Simulates one GPS tick for the wrong-direction detector.
 * Increments wrongDirCount when idx regresses ≥ 4 steps from prevProgressIdx,
 * then resets it when progress moves forward.
 */
function tickWrongDir(refs: NavRefs, newIdx: number): void {
  const prev = refs.prevProgressIdx;
  if (prev >= 0 && newIdx < prev - 3) {
    refs.wrongDirCount += 1;
  } else {
    refs.wrongDirCount = 0;
  }
  refs.prevProgressIdx = newIdx;
}

/**
 * Off-route guard (map.tsx ~line 3545–3623).
 * Returns true when the reroute should fire.
 *
 * The production block is wrapped by `if (!isRecalculatingRef.current)`, so
 * neither the counter accumulation nor the fire check runs while a fetch is
 * already in progress — this mirrors that outer guard.
 */
function offRouteShouldReroute(
  refs: NavRefs,
  distToPolyM: number,
  speedMph: number,
  now: number,
): boolean {
  // Outer production guard (map.tsx line 3545): entire block skipped while recalculating
  if (refs.isRecalculating) return false;

  const offDistM = speedMph > 50 ? 55 : speedMph > 25 ? 65 : 80;
  const offCount = speedMph > 50 ? 3 : speedMph > 25 ? 4 : 5;
  const offCooldown = speedMph > 40 ? 25_000 : 35_000;
  const minOffRouteMs = speedMph > 50 ? 4_000 : speedMph > 25 ? 5_000 : 7_000;

  // Accumulate or clear off-route counter (mirrors map.tsx lines 3559–3565)
  if (distToPolyM > offDistM) {
    if (refs.offRouteCount === 0) refs.offRouteStartMs = now;
    refs.offRouteCount += 1;
  } else {
    refs.offRouteCount = 0;
    refs.offRouteStartMs = 0;
  }

  return (
    refs.offRouteCount >= offCount &&
    now - refs.offRouteStartMs >= minOffRouteMs &&
    now - refs.lastRecalcTime > offCooldown
  );
}

/**
 * One GPS tick of the missed-turn tracker (mirrors map.tsx ~3807–3863).
 *
 * The tracker operates in two distinct phases:
 *   Phase 1 — approaching (distM < nearZone): accumulate minDist; latch wasClose.
 *   Phase 2 — departed  (distM >= nearZone, same step, wasClose=true): fire reroute.
 *
 * Returns whether the reroute branch should fire on this tick.
 * Also mutates refs.missedTurn to reflect the new tracker state.
 */
function tickMissedTurnAndCheckReroute(
  refs: NavRefs,
  distM: number,
  nextStepIdx: number,
  threshold: number,
  now: number,
): boolean {
  const nearZone = threshold * 3.5;
  const wasCloseZone = threshold * 1.5;
  const mt = refs.missedTurn;

  if (distM < nearZone) {
    // Phase 1: approaching the maneuver point — update tracker, never fire
    if (!mt || mt.idx !== nextStepIdx) {
      refs.missedTurn = { idx: nextStepIdx, minDist: distM, wasClose: distM < wasCloseZone };
    } else {
      if (distM < mt.minDist) mt.minDist = distM;
      if (distM < wasCloseZone) mt.wasClose = true;
    }
    return false;
  } else if (mt && mt.idx === nextStepIdx && mt.wasClose) {
    // Phase 2: departed near zone after having been very close — missed the turn
    // Clear tracker unconditionally (production does this before the cooldown check)
    refs.missedTurn = null;
    // Only fire the reroute when not already recalculating and cooldown has elapsed
    if (!refs.isRecalculating && now - refs.lastRecalcTime > 20_000) {
      return true;
    }
    return false;
  } else if (mt && mt.idx !== nextStepIdx) {
    // Active step changed — stale tracker, reset
    refs.missedTurn = null;
  }
  return false;
}

// ── Mirror of resetRouteRefs from map.tsx ─────────────────────────────────────

function simulateResetRouteRefs(refs: NavRefs, primary: RouteResult): void {
  refs.routeVersion += 1;
  refs.routeCoord = primary.coordinates;
  refs.routeSteps = primary.steps;
  refs.voiceAnnounced = {};
  refs.offRouteCount = 0;
  refs.wrongDirCount = 0;
  refs.prevProgressIdx = 0;
  refs.missedTurn = null;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeRoute(): RouteResult {
  const instructions = ["Start", "Turn right onto CA-78 East", "Arrive at destination"];
  return {
    coordinates: instructions.map((_, i) => ({ latitude: 33 + i * 0.01, longitude: -117 + i * 0.01 })),
    steps: instructions.map((instr, i) => ({
      coordinate: { latitude: 33 + i * 0.01, longitude: -117 + i * 0.01 },
      instruction: instr,
      featherIcon: "arrow-up",
      distanceM: 500,
      durationS: 30,
      streetName: "Test Road",
    })),
    distanceKm: 5,
    durationMin: 10,
  };
}

/** Build refs pre-loaded with stale/accumulated state (the worst-case starting point). */
function makeRefs(overrides: Partial<NavRefs> = {}): NavRefs {
  return {
    routeVersion: 1,
    routeCoord: [{ latitude: 33.0, longitude: -117.0 }],
    routeSteps: [
      {
        coordinate: { latitude: 33, longitude: -117 },
        instruction: "Old step",
        featherIcon: "arrow-up",
        distanceM: 500,
        durationS: 30,
        streetName: "Old St",
      },
    ],
    voiceAnnounced: { 2: true, 5: true },   // stale announcements from old route
    offRouteCount: 0,
    wrongDirCount: 0,
    prevProgressIdx: 0,
    missedTurn: null,
    isRecalculating: false,
    lastRecalcTime: 0,   // epoch=0 → cooldown always satisfied unless overridden
    offRouteStartMs: 0,
    ...overrides,
  };
}

// ── Helper: assert canonical post-reset state ─────────────────────────────────

function assertResetState(refs: NavRefs, prevRouteVersion: number): void {
  expect(refs.routeVersion).toBe(prevRouteVersion + 1);
  expect(refs.prevProgressIdx).toBe(0);
  expect(refs.wrongDirCount).toBe(0);
  expect(refs.offRouteCount).toBe(0);
  expect(refs.missedTurn).toBeNull();
  expect(refs.voiceAnnounced).toEqual({});
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 1 — Wrong-direction reroute path
// ─────────────────────────────────────────────────────────────────────────────

describe("reroute path 1 — wrong-direction: branch fires and state resets correctly", () => {
  it("fires after 3 consecutive backward ticks at highway speed and leaves zero residual state", () => {
    const refs = makeRefs({
      // Pre-existing stale accumulated state from the outbound leg
      prevProgressIdx: 50,
      voiceAnnounced: { 1: true, 3: true, 4: true },
      offRouteCount: 1,  // minor off-route noise should be cleared too
      missedTurn: null,
    });
    const prevVersion = refs.routeVersion;
    const now = Date.now();
    const speedMph = 65; // highway — threshold is 3 ticks

    // Simulate 3 GPS ticks where the polyline index regresses (driver going backward)
    tickWrongDir(refs, 45); // tick 1: 50 → 45 (regressed by 5, > 3 threshold)
    expect(refs.wrongDirCount).toBe(1);
    tickWrongDir(refs, 40); // tick 2: backward again
    expect(refs.wrongDirCount).toBe(2);
    tickWrongDir(refs, 35); // tick 3: backward again
    expect(refs.wrongDirCount).toBe(3);

    // Branch condition should be satisfied
    expect(wrongDirShouldReroute(refs, speedMph, now)).toBe(true);

    // map.tsx clears wrongDirCount and missedTurn BEFORE fetching,
    // then resetRouteRefs runs when the fetch resolves.
    refs.wrongDirCount = 0;
    refs.missedTurn = null;
    refs.lastRecalcTime = now;
    refs.isRecalculating = true;

    // Fetch resolves → resetRouteRefs fires
    const newRoute = makeRoute();
    simulateResetRouteRefs(refs, newRoute);

    assertResetState(refs, prevVersion);
  });

  it("does NOT fire during cooldown (< 20 s since last reroute)", () => {
    const refs = makeRefs({ lastRecalcTime: Date.now() - 5_000 }); // only 5 s ago
    const speedMph = 65;
    const now = Date.now();

    // Accumulate enough ticks to cross the threshold
    tickWrongDir(refs, 45);
    tickWrongDir(refs, 40);
    tickWrongDir(refs, 35);

    // Despite 3 backward ticks the cooldown blocks the reroute
    expect(wrongDirShouldReroute(refs, speedMph, now)).toBe(false);
  });

  it("requires 4 ticks (not 3) at urban speed (≤30 mph)", () => {
    // Start at polyline idx 50 so the first tick (→45) is already a regression
    const refs = makeRefs({ prevProgressIdx: 50 });
    const speedMph = 20;
    const now = Date.now();

    tickWrongDir(refs, 45); // backward: wrongDirCount=1
    tickWrongDir(refs, 40); // backward: wrongDirCount=2
    tickWrongDir(refs, 35); // backward: wrongDirCount=3
    // 3 ticks — not enough at urban speed (threshold is 4)
    expect(wrongDirShouldReroute(refs, speedMph, now)).toBe(false);

    tickWrongDir(refs, 30); // backward: wrongDirCount=4
    // 4th tick — threshold reached
    expect(wrongDirShouldReroute(refs, speedMph, now)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 2 — Off-route reroute path
// ─────────────────────────────────────────────────────────────────────────────

describe("reroute path 2 — off-route: branch fires and state resets correctly", () => {
  it("fires after 3 readings ≥55 m off-route at highway speed and leaves zero residual state", () => {
    const refs = makeRefs({
      wrongDirCount: 2,    // stale wrong-dir noise (should be cleared by reset)
      voiceAnnounced: { 0: true, 1: true },
      missedTurn: { idx: 2, minDist: 60, wasClose: false }, // partial missed-turn state
    });
    const prevVersion = refs.routeVersion;
    const speedMph = 60; // highway: offDistM=55, offCount=3, cooldown=25 s, minOffRouteMs=4 s
    // Simulate 3 ticks at 5-second intervals, each 70 m off-route
    const t0 = 60_000; // arbitrary non-zero base to avoid epoch-zero edge cases
    refs.lastRecalcTime = 0;    // cooldown satisfied

    let shouldFire = false;
    for (let i = 0; i < 3; i++) {
      const now = t0 + i * 2_000; // 2 s between readings (3 readings = 4 s elapsed from first)
      shouldFire = offRouteShouldReroute(refs, 70, speedMph, now);
    }

    // After the third reading the branch condition must be satisfied
    expect(shouldFire).toBe(true);
    expect(refs.offRouteCount).toBe(3);

    // Simulate the code that runs synchronously before fetch (mirrors map.tsx ~3571–3576)
    refs.offRouteCount = 0;
    refs.missedTurn = null;
    refs.isRecalculating = true;

    // Fetch resolves → resetRouteRefs
    const newRoute = makeRoute();
    simulateResetRouteRefs(refs, newRoute);

    assertResetState(refs, prevVersion);
  });

  it("does NOT fire during cooldown (< 25 s at highway speed)", () => {
    const refs = makeRefs({ lastRecalcTime: Date.now() - 10_000 });
    const speedMph = 60;
    const t0 = Date.now();

    // Push 3 off-route readings
    for (let i = 0; i < 3; i++) {
      offRouteShouldReroute(refs, 70, speedMph, t0 + i * 2_000);
    }

    // Cooldown blocks despite enough readings
    expect(refs.offRouteCount).toBe(3);
    const fired = offRouteShouldReroute(refs, 70, speedMph, t0 + 3 * 2_000);
    expect(fired).toBe(false);
  });

  it("does NOT fire and does NOT accumulate counter while isRecalculating=true", () => {
    // The entire off-route block is skipped when isRecalculating (map.tsx line 3545)
    const refs = makeRefs({ isRecalculating: true, lastRecalcTime: 0 });
    const speedMph = 60;
    const t0 = 60_000;

    // Attempt 5 off-route ticks while recalculating — nothing should accumulate
    for (let i = 0; i < 5; i++) {
      const fired = offRouteShouldReroute(refs, 70, speedMph, t0 + i * 2_000);
      expect(fired).toBe(false);
    }
    expect(refs.offRouteCount).toBe(0); // counter must stay at 0
  });

  it("clears offRouteCount when driver returns to route between off-route readings", () => {
    const refs = makeRefs();
    const speedMph = 60;
    const t0 = 60_000;

    offRouteShouldReroute(refs, 70, speedMph, t0);           // 1 off-route tick
    offRouteShouldReroute(refs, 20, speedMph, t0 + 2_000);  // back on route → count resets
    expect(refs.offRouteCount).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 3 — Missed-turn reroute path
// ─────────────────────────────────────────────────────────────────────────────
//
// The production branch has two phases:
//   Phase 1 (distM < nearZone): accumulate tracker — never fire reroute
//   Phase 2 (distM >= nearZone, same step, wasClose=true): fire reroute
//
// Tests use tickMissedTurnAndCheckReroute which mirrors both phases.

describe("reroute path 3 — missed-turn: branch fires and state resets correctly", () => {
  // threshold=65 m (highway nav step threshold), nearZone=227.5 m, wasCloseZone=97.5 m
  const THRESHOLD = 65;
  const NEXT_STEP = 2;
  const NOW = 200_000; // far from epoch so cooldown (lastRecalcTime=0) is always satisfied

  it("fires after driver approaches to wasCloseZone then departs, leaving zero residual state", () => {
    const refs = makeRefs({
      wrongDirCount: 1,
      voiceAnnounced: { 0: true, 2: true },
      offRouteCount: 0,
      prevProgressIdx: 120,
    });
    const prevVersion = refs.routeVersion;

    // Phase 1 — approach: enter nearZone at 200 m, get within wasCloseZone at 80 m
    // None of these ticks should fire the reroute
    expect(tickMissedTurnAndCheckReroute(refs, 200, NEXT_STEP, THRESHOLD, NOW)).toBe(false);
    expect(refs.missedTurn?.wasClose).toBe(false); // 200 > 97.5
    expect(tickMissedTurnAndCheckReroute(refs, 80, NEXT_STEP, THRESHOLD, NOW)).toBe(false);
    expect(refs.missedTurn?.wasClose).toBe(true);  // 80 < 97.5 → latched

    // Phase 2 — departure: driver moves back outside nearZone without advancing the step
    // This tick should fire the reroute (distM >= nearZone=227.5, wasClose=true)
    const fired = tickMissedTurnAndCheckReroute(refs, 300, NEXT_STEP, THRESHOLD, NOW);
    expect(fired).toBe(true);
    // Tracker is cleared by the departure tick (production clears before cooldown check)
    expect(refs.missedTurn).toBeNull();

    // Simulate the pre-fetch synchronous reset (mirrors map.tsx ~3819–3823)
    refs.offRouteCount = 0;
    refs.wrongDirCount = 0;
    refs.isRecalculating = true;
    refs.lastRecalcTime = NOW;

    // Fetch resolves → resetRouteRefs clears all residual state
    const newRoute = makeRoute();
    simulateResetRouteRefs(refs, newRoute);

    assertResetState(refs, prevVersion);
  });

  it("does NOT fire while driver is still in nearZone — even after wasClose is latched", () => {
    const refs = makeRefs();

    // Approach: enter at 200 m, cross wasCloseZone at 80 m, then retreat to 120 m
    // — still inside nearZone (120 < 227.5), so no reroute yet
    tickMissedTurnAndCheckReroute(refs, 200, NEXT_STEP, THRESHOLD, NOW);
    tickMissedTurnAndCheckReroute(refs, 80, NEXT_STEP, THRESHOLD, NOW);
    expect(refs.missedTurn?.wasClose).toBe(true);

    // Still inside nearZone — must not fire
    const fired = tickMissedTurnAndCheckReroute(refs, 120, NEXT_STEP, THRESHOLD, NOW);
    expect(fired).toBe(false);
    // Tracker preserved (not cleared) because we're still in Phase 1
    expect(refs.missedTurn).not.toBeNull();
  });

  it("does NOT fire when driver was never within wasCloseZone (wasClose stays false)", () => {
    const refs = makeRefs();

    // Enter nearZone but only reach 150 m — never crosses wasCloseZone (97.5 m)
    tickMissedTurnAndCheckReroute(refs, 200, NEXT_STEP, THRESHOLD, NOW);
    tickMissedTurnAndCheckReroute(refs, 150, NEXT_STEP, THRESHOLD, NOW);
    expect(refs.missedTurn?.wasClose).toBe(false);

    // Departure tick: distM >= nearZone, but wasClose=false → must not fire
    const fired = tickMissedTurnAndCheckReroute(refs, 300, NEXT_STEP, THRESHOLD, NOW);
    expect(fired).toBe(false);
  });

  it("does NOT fire during cooldown (< 20 s since last reroute)", () => {
    const refs = makeRefs({ lastRecalcTime: NOW - 10_000 }); // only 10 s ago

    // Full approach→departure sequence
    tickMissedTurnAndCheckReroute(refs, 200, NEXT_STEP, THRESHOLD, NOW);
    tickMissedTurnAndCheckReroute(refs, 80,  NEXT_STEP, THRESHOLD, NOW);
    const fired = tickMissedTurnAndCheckReroute(refs, 300, NEXT_STEP, THRESHOLD, NOW);

    // wasClose was latched but cooldown blocks the reroute
    expect(fired).toBe(false);
  });

  it("does NOT fire while isRecalculating=true even if all other conditions are met", () => {
    const refs = makeRefs({ isRecalculating: true });

    tickMissedTurnAndCheckReroute(refs, 200, NEXT_STEP, THRESHOLD, NOW);
    tickMissedTurnAndCheckReroute(refs, 80,  NEXT_STEP, THRESHOLD, NOW);
    const fired = tickMissedTurnAndCheckReroute(refs, 300, NEXT_STEP, THRESHOLD, NOW);

    expect(fired).toBe(false);
  });

  it("does NOT fire when missedTurn is null (step already advanced before departure tick)", () => {
    // refs.missedTurn starts null — departure tick with no prior approach does nothing
    const refs = makeRefs({ missedTurn: null });
    const fired = tickMissedTurnAndCheckReroute(refs, 300, NEXT_STEP, THRESHOLD, NOW);
    expect(fired).toBe(false);
  });
});

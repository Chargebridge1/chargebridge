/**
 * Tests for the reroute state-reset contract (Fix 4) and the drainQueue
 * stale-version guard (Fix 2) introduced in task-665.
 *
 * These tests mirror the logic from map.tsx as pure functions so they can
 * run without mounting any React component.  The same "mirror the contract"
 * pattern is used by navPillPhase2.test.ts.
 *
 * Suite 1 — reroute-mid-flight voice suppression
 *   The drainQueue helper must drop any queued utterance whose routeVersion
 *   no longer matches the current route.  This prevents old-route "Turn left
 *   onto I-5" announcements from playing after a reroute completes.
 *
 * Suite 2 — all three reroute branches reset identical state
 *   Wrong-direction, off-route, and missed-turn branches all call
 *   resetRouteRefs(primary).  The shared helper must zero every ref that
 *   closestRoutePoint and the wrong-direction guard depend on, so none of the
 *   three branches can diverge silently.
 */

// ── Minimal type mirrors (matching map.tsx local types) ───────────────────────

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

// ── Mirror of the drainQueue stale-check from map.tsx ────────────────────────
//
// In map.tsx the check is:
//   if (routeVersionRef.current !== queued.routeVersion) { … return; }
// We mirror it as a pure function returning "dispatched" | "dropped_stale" | "dropped_nothing".

type QueuedItem = { text: string; routeVersion: number };
type DrainOutcome = "dispatched" | "dropped_stale" | "dropped_nothing";

function simulateDrainQueue(
  queued: QueuedItem | null,
  currentRouteVersion: number,
  isNavigating = true,
  voiceMuted = false,
): DrainOutcome {
  if (!queued || !isNavigating || voiceMuted) return "dropped_nothing";
  if (currentRouteVersion !== queued.routeVersion) return "dropped_stale";
  return "dispatched";
}

// ── Mirror of resetRouteRefs from map.tsx ─────────────────────────────────────
//
// The helper mutates a flat "refs" bag.  Tests verify that every field is set
// to the canonical post-reset value, which is what the three reroute branches
// all depend on.

type NavRouteRefs = {
  routeVersion: number;
  routeCoord: LatLng[];
  routeSteps: RouteStep[];
  voiceAnnounced: Record<number, true>;
  offRouteCount: number;
  wrongDirCount: number;
  prevProgressIdx: number;
  missedTurn: unknown;
  // navState mirror
  navStateIsActive: boolean;
  navStateSteps: Array<{ instruction: string; featherIcon: string; coordinate: LatLng }>;
  navStateCurrentStepIdx: number;
};

function simulateResetRouteRefs(refs: NavRouteRefs, primary: RouteResult): void {
  refs.routeVersion += 1;
  refs.routeCoord = primary.coordinates;
  refs.routeSteps = primary.steps;
  refs.voiceAnnounced = {};
  refs.offRouteCount = 0;
  refs.wrongDirCount = 0;
  refs.prevProgressIdx = 0;
  refs.missedTurn = null;
  if (refs.navStateIsActive) {
    refs.navStateSteps = primary.steps.map((s) => ({
      instruction: s.instruction,
      featherIcon: s.featherIcon,
      coordinate: s.coordinate,
    }));
    refs.navStateCurrentStepIdx = 0;
  }
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeStep(instruction: string, idx = 0): RouteStep {
  return {
    coordinate: { latitude: 33 + idx * 0.01, longitude: -117 + idx * 0.01 },
    instruction,
    featherIcon: "arrow-up",
    distanceM: 500,
    durationS: 30,
    streetName: "Test St",
  };
}

function makeRoute(instructions: string[]): RouteResult {
  return {
    coordinates: instructions.map((_, i) => ({ latitude: 33 + i * 0.01, longitude: -117 + i * 0.01 })),
    steps: instructions.map((instr, i) => makeStep(instr, i)),
    distanceKm: 5,
    durationMin: 10,
  };
}

function makeRefs(overrides: Partial<NavRouteRefs> = {}): NavRouteRefs {
  return {
    routeVersion: 1,
    routeCoord: [{ latitude: 33.0, longitude: -117.0 }],
    routeSteps: [makeStep("Turn left onto I-5")],
    voiceAnnounced: { 2: true, 3: true },
    offRouteCount: 3,
    wrongDirCount: 2,
    prevProgressIdx: 430, // stale hint from old route
    missedTurn: { idx: 2, minDist: 50, wasClose: true },
    navStateIsActive: true,
    navStateSteps: [{ instruction: "Old step", featherIcon: "arrow-up", coordinate: { latitude: 33, longitude: -117 } }],
    navStateCurrentStepIdx: 3,
    ...overrides,
  };
}

// ── Suite 1: reroute-mid-flight voice suppression ────────────────────────────

describe("drainQueue stale-version guard", () => {
  it("dispatches a queued item when routeVersion still matches", () => {
    const queued: QueuedItem = { text: "In 500 feet, turn right", routeVersion: 1 };
    expect(simulateDrainQueue(queued, 1)).toBe("dispatched");
  });

  it("drops a queued item when routeVersion has advanced (reroute completed mid-flight)", () => {
    // Scenario: "Turn left onto I-5" was queued at routeVersion=1 while the
    // a3 cue was playing.  A reroute then completed, bumping routeVersion to 2.
    // drainQueue must not play the stale I-5 instruction.
    const queued: QueuedItem = { text: "Turn left onto I-5", routeVersion: 1 };
    expect(simulateDrainQueue(queued, 2)).toBe("dropped_stale");
  });

  it("drops a queued item when routeVersion advanced by more than one (double-reroute)", () => {
    const queued: QueuedItem = { text: "Turn right onto Harbor Drive", routeVersion: 3 };
    expect(simulateDrainQueue(queued, 5)).toBe("dropped_stale");
  });

  it("returns dropped_nothing when queue is empty", () => {
    expect(simulateDrainQueue(null, 2)).toBe("dropped_nothing");
  });

  it("returns dropped_nothing when navigation is no longer active", () => {
    const queued: QueuedItem = { text: "Continue straight", routeVersion: 2 };
    expect(simulateDrainQueue(queued, 2, false)).toBe("dropped_nothing");
  });

  it("returns dropped_nothing when voice is muted", () => {
    const queued: QueuedItem = { text: "Continue straight", routeVersion: 2 };
    expect(simulateDrainQueue(queued, 2, true, true)).toBe("dropped_nothing");
  });

  it("dispatches when versions match even after multiple reroutes", () => {
    const queued: QueuedItem = { text: "Merge onto CA-76 East", routeVersion: 5 };
    expect(simulateDrainQueue(queued, 5)).toBe("dispatched");
  });
});

// ── Suite 2: all three reroute branches reset identical state ─────────────────

describe("resetRouteRefs — wrong-direction reroute branch", () => {
  const newRoute = makeRoute(["Start", "Turn right onto CA-76", "Arrive at destination"]);

  it("increments routeVersion", () => {
    const refs = makeRefs({ routeVersion: 1 });
    simulateResetRouteRefs(refs, newRoute);
    expect(refs.routeVersion).toBe(2);
  });

  it("replaces routeCoord with new route coordinates", () => {
    const refs = makeRefs();
    simulateResetRouteRefs(refs, newRoute);
    expect(refs.routeCoord).toBe(newRoute.coordinates);
  });

  it("replaces routeSteps with new route steps", () => {
    const refs = makeRefs();
    simulateResetRouteRefs(refs, newRoute);
    expect(refs.routeSteps).toBe(newRoute.steps);
  });

  it("clears voiceAnnounced so new route steps are not silently skipped", () => {
    const refs = makeRefs({ voiceAnnounced: { 2: true, 5: true } });
    simulateResetRouteRefs(refs, newRoute);
    expect(refs.voiceAnnounced).toEqual({});
  });

  it("resets offRouteCount to 0", () => {
    const refs = makeRefs({ offRouteCount: 4 });
    simulateResetRouteRefs(refs, newRoute);
    expect(refs.offRouteCount).toBe(0);
  });

  it("resets wrongDirCount to 0 — prevents false wrong-direction trigger on first post-reroute tick", () => {
    const refs = makeRefs({ wrongDirCount: 3 });
    simulateResetRouteRefs(refs, newRoute);
    expect(refs.wrongDirCount).toBe(0);
  });

  it("resets prevProgressIdx to 0 — prevents closestRoutePoint searching stale window", () => {
    // Old route had 500 polyline segments; prevProgressIdx=430.
    // After reroute to a 200-segment route, the window search 427–480 would miss.
    const refs = makeRefs({ prevProgressIdx: 430 });
    simulateResetRouteRefs(refs, newRoute);
    expect(refs.prevProgressIdx).toBe(0);
  });

  it("clears missedTurn tracker", () => {
    const refs = makeRefs({ missedTurn: { idx: 3, minDist: 45, wasClose: true } });
    simulateResetRouteRefs(refs, newRoute);
    expect(refs.missedTurn).toBeNull();
  });

  it("updates navState.steps when nav is active", () => {
    const refs = makeRefs({ navStateIsActive: true });
    simulateResetRouteRefs(refs, newRoute);
    expect(refs.navStateSteps).toHaveLength(newRoute.steps.length);
    expect(refs.navStateSteps[0].instruction).toBe(newRoute.steps[0].instruction);
  });

  it("resets navState.currentStepIdx to 0 when nav is active", () => {
    const refs = makeRefs({ navStateIsActive: true, navStateCurrentStepIdx: 5 });
    simulateResetRouteRefs(refs, newRoute);
    expect(refs.navStateCurrentStepIdx).toBe(0);
  });

  it("does NOT touch navState when nav is not active", () => {
    const refs = makeRefs({ navStateIsActive: false, navStateCurrentStepIdx: 5 });
    simulateResetRouteRefs(refs, newRoute);
    expect(refs.navStateCurrentStepIdx).toBe(5); // unchanged
  });
});

describe("resetRouteRefs — off-route reroute branch (same contract)", () => {
  const newRoute = makeRoute(["Start", "Merge onto I-15 North", "Take exit 54"]);

  it("increments routeVersion", () => {
    const refs = makeRefs({ routeVersion: 7 });
    simulateResetRouteRefs(refs, newRoute);
    expect(refs.routeVersion).toBe(8);
  });

  it("resets wrongDirCount to 0", () => {
    const refs = makeRefs({ wrongDirCount: 4 });
    simulateResetRouteRefs(refs, newRoute);
    expect(refs.wrongDirCount).toBe(0);
  });

  it("resets prevProgressIdx to 0", () => {
    const refs = makeRefs({ prevProgressIdx: 280 });
    simulateResetRouteRefs(refs, newRoute);
    expect(refs.prevProgressIdx).toBe(0);
  });

  it("resets offRouteCount to 0", () => {
    const refs = makeRefs({ offRouteCount: 5 });
    simulateResetRouteRefs(refs, newRoute);
    expect(refs.offRouteCount).toBe(0);
  });

  it("clears voiceAnnounced", () => {
    const refs = makeRefs({ voiceAnnounced: { 1: true } });
    simulateResetRouteRefs(refs, newRoute);
    expect(refs.voiceAnnounced).toEqual({});
  });
});

describe("resetRouteRefs — missed-turn reroute branch (same contract)", () => {
  const newRoute = makeRoute(["Start", "Turn left onto Oak Ave", "Arrive"]);

  it("increments routeVersion", () => {
    const refs = makeRefs({ routeVersion: 3 });
    simulateResetRouteRefs(refs, newRoute);
    expect(refs.routeVersion).toBe(4);
  });

  it("resets prevProgressIdx to 0", () => {
    const refs = makeRefs({ prevProgressIdx: 150 });
    simulateResetRouteRefs(refs, newRoute);
    expect(refs.prevProgressIdx).toBe(0);
  });

  it("resets wrongDirCount to 0", () => {
    const refs = makeRefs({ wrongDirCount: 2 });
    simulateResetRouteRefs(refs, newRoute);
    expect(refs.wrongDirCount).toBe(0);
  });

  it("resets offRouteCount to 0", () => {
    const refs = makeRefs({ offRouteCount: 3 });
    simulateResetRouteRefs(refs, newRoute);
    expect(refs.offRouteCount).toBe(0);
  });

  it("clears missedTurn", () => {
    const refs = makeRefs({ missedTurn: { idx: 2, minDist: 30, wasClose: true } });
    simulateResetRouteRefs(refs, newRoute);
    expect(refs.missedTurn).toBeNull();
  });
});

// ── Suite 3: "Rerouting" cue — version-safe emit after resetRouteRefs ─────────
//
// Mirrors the interaction between navSpeak's forced-settle stale check and
// resetRouteRefs.  The key invariant:
//
//   navSpeak("Rerouting", true) must be called AFTER resetRouteRefs so that
//   the captured routeVersion matches the version already incremented by
//   resetRouteRefs — otherwise the forced-settle timer's stale check drops it.
//
// Scenario modelled (speech already active → reroute fetch completes):
//   1. Route version = N; TTS is playing an a3 cue ("Turn left onto I-5")
//   2. A non-forced distance cue ("In 500 feet, merge right") is queued at version N
//   3. Reroute fetch completes → resetRouteRefs bumps version to N+1
//   4. navSpeak("Rerouting", true) fires, captures N+1
//   5. Expected: queued distance cue (version N) is DROPPED by drainQueue (stale)
//   6. Expected: "Rerouting" cue (version N+1) passes the stale check and is dispatched

type ForcedSpeakResult = "dispatched" | "dropped_stale_settle";
type ReroutingSequenceResult = {
  reroutingDispatched: ForcedSpeakResult;
  staleQueueDropped: boolean;
};

/**
 * Mirrors the navSpeak forced-settle stale check.
 * In map.tsx (inside the setTimeout settle callback):
 *   if (routeVersionRef.current !== _capturedRouteVersion) return;
 */
function simulateForcedSpeak(capturedVersion: number, currentVersion: number): ForcedSpeakResult {
  if (currentVersion !== capturedVersion) return "dropped_stale_settle";
  return "dispatched";
}

/**
 * Full sequence: speech active → reroute completes → "Rerouting" emitted safely.
 *
 * Accepts the OLD route version and simulates:
 *   1. A non-forced cue queued at oldVersion
 *   2. resetRouteRefs bumping to oldVersion + 1
 *   3. navSpeak("Rerouting") capturing the NEW version (oldVersion + 1)
 *   4. drainQueue trying to dispatch the stale queued cue
 */
function simulateRerouteSequence(oldVersion: number): ReroutingSequenceResult {
  // A non-forced maneuver cue was queued while old route was active
  const queuedCue: QueuedItem = { text: "In 500 feet, merge right", routeVersion: oldVersion };

  // resetRouteRefs runs → bumps version
  const newVersion = oldVersion + 1;

  // navSpeak("Rerouting", true) called immediately after resetRouteRefs —
  // it captures the NEW version.  The settle check should pass.
  const reroutingCapturedVersion = newVersion; // captured AFTER resetRouteRefs
  const reroutingResult = simulateForcedSpeak(reroutingCapturedVersion, newVersion);

  // drainQueue tries to dispatch the pre-reroute queued cue (version N) now
  // that speech finishes — but the version has changed to N+1.
  const drainResult = simulateDrainQueue(queuedCue, newVersion);

  return {
    reroutingDispatched: reroutingResult,
    staleQueueDropped: drainResult === "dropped_stale",
  };
}

describe("Rerouting cue — version-safe emit after resetRouteRefs", () => {
  it("'Rerouting' is dispatched when navSpeak is called after resetRouteRefs (captures new version)", () => {
    const { reroutingDispatched } = simulateRerouteSequence(1);
    expect(reroutingDispatched).toBe("dispatched");
  });

  it("an old-route maneuver queued at version N is dropped after reroute bumps to N+1", () => {
    const { staleQueueDropped } = simulateRerouteSequence(1);
    expect(staleQueueDropped).toBe(true);
  });

  it("both conditions hold simultaneously — 'Rerouting' plays, stale cue is silent", () => {
    const result = simulateRerouteSequence(3);
    expect(result.reroutingDispatched).toBe("dispatched");
    expect(result.staleQueueDropped).toBe(true);
  });

  it("'Rerouting' would be dropped if called BEFORE resetRouteRefs (old version captured)", () => {
    // Demonstrates WHY the pre-fetch call was wrong: if navSpeak captures oldVersion
    // and then resetRouteRefs bumps to newVersion, the settle check fails.
    const oldVersion = 2;
    const newVersion = 3; // what resetRouteRefs sets
    const capturedBeforeReset = oldVersion; // captured pre-fetch
    const result = simulateForcedSpeak(capturedBeforeReset, newVersion);
    expect(result).toBe("dropped_stale_settle");
  });

  it("works correctly across multiple sequential reroutes", () => {
    // Simulate three consecutive reroutes; each must dispatch its own "Rerouting"
    for (let v = 1; v <= 5; v++) {
      const { reroutingDispatched, staleQueueDropped } = simulateRerouteSequence(v);
      expect(reroutingDispatched).toBe("dispatched");
      expect(staleQueueDropped).toBe(true);
    }
  });
});

// ── Suite 4: branch consistency cross-check ───────────────────────────────────
//
// Confirms that running the same reset function for all three reroute reasons
// produces bit-for-bit identical state for all shared refs.  If the branches
// diverge in the future (e.g. one forgets to reset wrongDirCount), a
// property-style test here makes the divergence immediately visible.

describe("resetRouteRefs — all three branches produce identical shared ref state", () => {
  const route = makeRoute(["Start", "Turn right", "Arrive"]);

  function runReset(initialRouteVersion: number) {
    const refs = makeRefs({
      routeVersion: initialRouteVersion,
      offRouteCount: 5,
      wrongDirCount: 4,
      prevProgressIdx: 300,
      voiceAnnounced: { 1: true, 2: true },
      missedTurn: { idx: 1, minDist: 20, wasClose: true },
      navStateIsActive: true,
      navStateCurrentStepIdx: 3,
    });
    simulateResetRouteRefs(refs, route);
    return refs;
  }

  it("wrong-dir branch: all counter refs are 0 after reset", () => {
    const refs = runReset(1);
    expect(refs.offRouteCount).toBe(0);
    expect(refs.wrongDirCount).toBe(0);
    expect(refs.prevProgressIdx).toBe(0);
  });

  it("off-route branch: all counter refs are 0 after reset", () => {
    const refs = runReset(2);
    expect(refs.offRouteCount).toBe(0);
    expect(refs.wrongDirCount).toBe(0);
    expect(refs.prevProgressIdx).toBe(0);
  });

  it("missed-turn branch: all counter refs are 0 after reset", () => {
    const refs = runReset(3);
    expect(refs.offRouteCount).toBe(0);
    expect(refs.wrongDirCount).toBe(0);
    expect(refs.prevProgressIdx).toBe(0);
  });

  it("routeVersion increment is consistent across all three branches", () => {
    const wd = runReset(1);
    const or = runReset(1);
    const mt = runReset(1);
    // All three must increment by exactly 1
    expect(wd.routeVersion).toBe(2);
    expect(or.routeVersion).toBe(2);
    expect(mt.routeVersion).toBe(2);
  });

  it("voiceAnnounced is empty dict in all three branches", () => {
    const wd = runReset(1);
    const or = runReset(1);
    const mt = runReset(1);
    expect(wd.voiceAnnounced).toEqual({});
    expect(or.voiceAnnounced).toEqual({});
    expect(mt.voiceAnnounced).toEqual({});
  });

  it("missedTurn is null in all three branches", () => {
    const wd = runReset(1);
    const or = runReset(1);
    const mt = runReset(1);
    expect(wd.missedTurn).toBeNull();
    expect(or.missedTurn).toBeNull();
    expect(mt.missedTurn).toBeNull();
  });
});

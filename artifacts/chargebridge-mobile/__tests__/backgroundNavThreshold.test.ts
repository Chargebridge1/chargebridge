/**
 * Tests for the speed-adaptive step-advance threshold shared between the
 * foreground GPS handler (map.tsx) and backgroundNav.ts.
 *
 * Root cause (task-670): backgroundNav.ts used a fixed 40 m threshold
 * regardless of speed.  At 65 mph (~29 m/tick on iOS BestForNavigation),
 * the background task advanced currentStepIdx at a different location than the
 * foreground, causing the wrong push notification to fire.
 *
 * Fix: both paths now call navStepThreshold() (utils/navSpeedThreshold.ts),
 * which applies Math.round() normalisation before the breakpoint comparisons,
 * identical to the foreground's speedMphSA calculation.
 *
 * Test approach: import the real production helper so that any change to the
 * breakpoints or rounding in navSpeedThreshold.ts causes these tests to fail.
 */

import { navStepThreshold } from "../utils/navSpeedThreshold";
import {
  foregroundAdvanceStepIdx,
  backgroundAdvanceStepIdx,
  navMissedTurnThreshold,
  haversineMeters as haversineMetersUtil,
} from "../utils/navStepAdvance";
import { navOffRouteThreshold } from "../utils/navOffRouteThreshold";

// ── Helper: haversineMeters (mirrors backgroundNav.ts) ───────────────────────

function haversineMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const R = 6371000;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const dLat = lat2 - lat1;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

// ── Helper: step-advance loop (mirrors backgroundNav.ts) ─────────────────────

type LatLng = { latitude: number; longitude: number };
type Step = { coordinate: LatLng };

function simulateStepAdvance(
  currentIdx: number,
  steps: Step[],
  loc: LatLng,
  speedMs: number,
): number {
  const threshold = navStepThreshold(speedMs); // production helper
  let idx = currentIdx;
  while (idx + 1 < steps.length) {
    const d = haversineMeters(loc, steps[idx + 1].coordinate);
    if (d < threshold) idx++;
    else break;
  }
  return idx;
}

// ── Helper: build a step whose maneuver point is `distM` metres north ────────

function stepAtDistance(origin: LatLng, distM: number): Step {
  return {
    coordinate: {
      latitude: origin.latitude + distM / 111320,
      longitude: origin.longitude,
    },
  };
}

// ── Helper: LatLng `distM` metres north of origin (for tick loc arrays) ───────

function locAtDistance(origin: LatLng, distM: number): LatLng {
  return {
    latitude: origin.latitude + distM / 111320,
    longitude: origin.longitude,
  };
}

// ── Suite 1: navStepThreshold() breakpoints ───────────────────────────────────

describe("navStepThreshold — breakpoints (production helper)", () => {
  // Speeds just above each boundary
  it("returns 65 m at highway speed (65 mph / ~29.06 m/s)", () => {
    expect(navStepThreshold(65 / 2.237)).toBe(65);
  });

  it("returns 50 m at urban speed (40 mph / ~17.88 m/s)", () => {
    expect(navStepThreshold(40 / 2.237)).toBe(50);
  });

  it("returns 35 m at medium speed (20 mph / ~8.94 m/s)", () => {
    expect(navStepThreshold(20 / 2.237)).toBe(35);
  });

  it("returns 25 m at slow speed (10 mph / ~4.47 m/s)", () => {
    expect(navStepThreshold(10 / 2.237)).toBe(25);
  });

  it("returns 25 m when speed is 0 m/s (stationary)", () => {
    expect(navStepThreshold(0)).toBe(25);
  });

  it("threshold at exactly 50 mph boundary is 50 m (> 50 required for 65 m)", () => {
    // Math.round(50 / 2.237 * 2.237) = Math.round(50) = 50 → NOT > 50 → 50 m bucket
    expect(navStepThreshold(50 / 2.237)).toBe(50);
  });

  it("threshold just above 50 mph boundary is 65 m", () => {
    expect(navStepThreshold(51 / 2.237)).toBe(65);
  });

  it("is strictly greater than the old fixed 40 m at highway speed", () => {
    expect(navStepThreshold(65 / 2.237)).toBeGreaterThan(40);
  });
});

// ── Suite 2: Math.round() normalisation — identical to foreground ─────────────
//
// The foreground computes speedMphSA = Math.round(speed * 2.237) before
// comparing against breakpoints.  navStepThreshold() must do the same so
// background and foreground produce identical thresholds at every speed.
// A raw 50.4 mph reading rounds to 50 → 50 m; 50.5 rounds to 51 → 65 m.

describe("navStepThreshold — Math.round normalisation matches foreground speedMphSA", () => {
  it("50.4 mph raw (rounds to 50 mph) → 50 m bucket, NOT 65 m", () => {
    const speedMs = 50.4 / 2.237;
    const speedMphRounded = Math.round(speedMs * 2.237); // foreground formula
    expect(speedMphRounded).toBe(50);
    expect(navStepThreshold(speedMs)).toBe(50);
  });

  it("50.6 mph raw (rounds to 51 mph) → 65 m bucket", () => {
    const speedMs = 50.6 / 2.237;
    const speedMphRounded = Math.round(speedMs * 2.237);
    expect(speedMphRounded).toBe(51);
    expect(navStepThreshold(speedMs)).toBe(65);
  });

  it("30.4 mph raw (rounds to 30 mph) → 35 m bucket (30 > 15 but NOT > 30, so not 50 m)", () => {
    const speedMs = 30.4 / 2.237;
    const speedMphRounded = Math.round(speedMs * 2.237);
    expect(speedMphRounded).toBe(30);
    // 30 is NOT > 30, falls to > 15 branch → 35 m
    expect(navStepThreshold(speedMs)).toBe(35);
  });

  it("30.6 mph raw (rounds to 31 mph) → 50 m bucket", () => {
    const speedMs = 30.6 / 2.237;
    const speedMphRounded = Math.round(speedMs * 2.237);
    expect(speedMphRounded).toBe(31);
    expect(navStepThreshold(speedMs)).toBe(50);
  });
});

// ── Suite 3: regression — old fixed 40 m threshold vs new 65 m at highway ────
//
// At highway speed the new threshold is 65 m.  A maneuver point at 40–64 m is
// inside the new trigger window, so the step advances and the push notification
// fires with correct lead time (matching the foreground).
// Old code (fixed 40 m): 40 < 40 = false → NO advance (too late).
// New code (65 m):        40 < 65 = true  → DOES advance (matches foreground).

describe("step advance — new 65 m threshold fires where old fixed-40 m did not", () => {
  const origin: LatLng = { latitude: 37.7749, longitude: -122.4194 };
  const highwayMs = 65 / 2.237;

  it("step DOES advance at 40 m (old fixed-40 m code would NOT have advanced)", () => {
    const steps: Step[] = [{ coordinate: origin }, stepAtDistance(origin, 40)];
    expect(simulateStepAdvance(0, steps, origin, highwayMs)).toBe(1);
  });

  it("step DOES advance at 50 m with 65 m threshold", () => {
    const steps: Step[] = [{ coordinate: origin }, stepAtDistance(origin, 50)];
    expect(simulateStepAdvance(0, steps, origin, highwayMs)).toBe(1);
  });

  it("step DOES advance at 64 m (just inside the 65 m trigger window)", () => {
    const steps: Step[] = [{ coordinate: origin }, stepAtDistance(origin, 64)];
    expect(simulateStepAdvance(0, steps, origin, highwayMs)).toBe(1);
  });

  it("step does NOT advance at 70 m (outside the 65 m window)", () => {
    const steps: Step[] = [{ coordinate: origin }, stepAtDistance(origin, 70)];
    expect(simulateStepAdvance(0, steps, origin, highwayMs)).toBe(0);
  });
});

// ── Suite 4: task spec — advances at >= 50 m at 65 mph ───────────────────────

describe("step advance — background at 65 mph advances step at >= 50 m (task spec)", () => {
  const origin: LatLng = { latitude: 37.7749, longitude: -122.4194 };
  const highwayMs = 65 / 2.237;

  it("threshold returned by navStepThreshold at 65 mph is >= 50 m", () => {
    expect(navStepThreshold(highwayMs)).toBeGreaterThanOrEqual(50);
  });

  it("step advances when maneuver is 55 m away at 65 mph (inside >= 50 m window)", () => {
    const steps: Step[] = [{ coordinate: origin }, stepAtDistance(origin, 55)];
    expect(simulateStepAdvance(0, steps, origin, highwayMs)).toBe(1);
  });
});

// ── Suite 5: lower-speed thresholds apply correctly ──────────────────────────

describe("step advance — correct thresholds at lower speeds", () => {
  const origin: LatLng = { latitude: 37.7749, longitude: -122.4194 };

  it("25 m threshold at slow speed — does NOT advance at 26 m away", () => {
    const steps: Step[] = [{ coordinate: origin }, stepAtDistance(origin, 26)];
    expect(simulateStepAdvance(0, steps, origin, 10 / 2.237)).toBe(0);
  });

  it("25 m threshold at slow speed — DOES advance at 20 m away", () => {
    const steps: Step[] = [{ coordinate: origin }, stepAtDistance(origin, 20)];
    expect(simulateStepAdvance(0, steps, origin, 10 / 2.237)).toBe(1);
  });

  it("35 m threshold at medium speed — does NOT advance at 36 m away", () => {
    const steps: Step[] = [{ coordinate: origin }, stepAtDistance(origin, 36)];
    expect(simulateStepAdvance(0, steps, origin, 20 / 2.237)).toBe(0);
  });

  it("35 m threshold at medium speed — DOES advance at 30 m away", () => {
    const steps: Step[] = [{ coordinate: origin }, stepAtDistance(origin, 30)];
    expect(simulateStepAdvance(0, steps, origin, 20 / 2.237)).toBe(1);
  });

  it("50 m threshold at urban speed — does NOT advance at 51 m away", () => {
    const steps: Step[] = [{ coordinate: origin }, stepAtDistance(origin, 51)];
    expect(simulateStepAdvance(0, steps, origin, 40 / 2.237)).toBe(0);
  });

  it("50 m threshold at urban speed — DOES advance at 45 m away", () => {
    const steps: Step[] = [{ coordinate: origin }, stepAtDistance(origin, 45)];
    expect(simulateStepAdvance(0, steps, origin, 40 / 2.237)).toBe(1);
  });
});

// ── Suite 6: multi-step advance in a single tick ─────────────────────────────

describe("step advance — multi-step advance respects threshold per hop", () => {
  const origin: LatLng = { latitude: 37.7749, longitude: -122.4194 };

  it("advances through two consecutive steps that are both within threshold", () => {
    const step1 = stepAtDistance(origin, 10);
    const step2 = stepAtDistance(origin, 18);
    const steps: Step[] = [{ coordinate: origin }, step1, step2];
    expect(simulateStepAdvance(0, steps, origin, 10 / 2.237)).toBe(2);
  });

  it("stops advancing at the first step outside the threshold", () => {
    const step1 = stepAtDistance(origin, 10); // inside 25 m window
    const step2 = stepAtDistance(origin, 30); // outside 25 m window
    const steps: Step[] = [{ coordinate: origin }, step1, step2];
    expect(simulateStepAdvance(0, steps, origin, 10 / 2.237)).toBe(1);
  });

  it("does not advance past the final step", () => {
    const step1 = stepAtDistance(origin, 10);
    const steps: Step[] = [{ coordinate: origin }, step1];
    expect(simulateStepAdvance(0, steps, origin, 65 / 2.237)).toBe(1);
  });
});

// ── Suite 7: co-advance parity — production functions, same GPS tick ─────────
//
// This suite imports the REAL production step-advance functions from
// utils/navStepAdvance.ts — the same module imported by both map.tsx
// (foregroundAdvanceStepIdx) and backgroundNav.ts (backgroundAdvanceStepIdx).
//
// Any change to either production function that alters its threshold or advance
// condition will cause these tests to fail.  Swapping out the shared utility
// for a different inline formula in either production file must also update
// this test.
//
// Design difference captured here:
//   foregroundAdvanceStepIdx — advances AT MOST ONE step per GPS tick.
//     map.tsx calls it once per 1 Hz location update; voice fires per step.
//   backgroundAdvanceStepIdx — advances through ALL consecutive in-threshold
//     steps in one call (while loop), because background location batches can
//     cover multiple steps.
//
// For single-maneuver highway approaches (the regression case) both functions
// advance on the same GPS tick — that is the parity this suite confirms.

// Adapter: run foregroundAdvanceStepIdx across a tick sequence, stepping forward.
function fgFirstAdvanceTick(
  steps: Step[],
  ticks: Array<{ loc: LatLng; speedMs: number }>,
): number {
  let currentIdx = 0;
  for (let i = 0; i < ticks.length; i++) {
    const next = foregroundAdvanceStepIdx(
      currentIdx, steps, ticks[i].loc, ticks[i].speedMs,
    );
    if (next !== currentIdx) return i;
    currentIdx = next;
  }
  return -1;
}

// Adapter: run backgroundAdvanceStepIdx across a tick sequence, stepping forward.
function bgFirstAdvanceTick(
  steps: Step[],
  ticks: Array<{ loc: LatLng; speedMs: number }>,
): number {
  let currentIdx = 0;
  for (let i = 0; i < ticks.length; i++) {
    const next = backgroundAdvanceStepIdx(
      currentIdx, steps, ticks[i].loc, ticks[i].speedMs,
    );
    if (next !== currentIdx) return i;
    currentIdx = next;
  }
  return -1;
}

describe("co-advance parity — production foreground & background functions, same GPS tick", () => {
  const origin: LatLng = { latitude: 37.7749, longitude: -122.4194 };

  // ── 7a: haversineMeters from navStepAdvance matches internal test helper ──
  //
  // Both production functions use haversineMeters from navStepAdvance.ts.
  // Confirm the exported utility returns the same value as the test's local copy.

  it("haversineMeters utility matches the local test helper for a 50 m separation", () => {
    const a = origin;
    const b = locAtDistance(origin, 50);
    const localDist = haversineMeters(a, b);
    const utilDist  = haversineMetersUtil(a, b);
    expect(Math.abs(localDist - utilDist)).toBeLessThan(0.001); // <1 mm
  });

  // ── 7b: threshold parity at each motorised speed bucket ──────────────────
  //
  // foregroundAdvanceStepIdx (motorised, non-walking/cycling) and
  // backgroundAdvanceStepIdx both call navStepThreshold() for their distance
  // boundary.  Assert the returned threshold for a single-step advance matches
  // the expected bucket at representative speeds.

  it.each([
    // Breakpoints (navStepThreshold): > 50 mph → 65 m | > 30 mph → 50 m | > 15 mph → 35 m | else → 25 m
    ["10 mph (slow/stationary, 25 m bucket)", 10 / 2.237, 25],
    ["20 mph (residential, 35 m bucket)",     20 / 2.237, 35],
    ["40 mph (urban, 50 m bucket)",           40 / 2.237, 50],
    ["65 mph (highway, 65 m bucket)",         65 / 2.237, 65],
  ])(
    "both functions advance at the %s boundary",
    (_label, speedMs, thresholdM) => {
      // Place maneuver just inside the threshold: foreground and background both advance.
      const justInside = stepAtDistance(origin, thresholdM - 1);
      const steps: Step[] = [{ coordinate: origin }, justInside];
      expect(foregroundAdvanceStepIdx(0, steps, origin, speedMs)).toBe(1);
      expect(backgroundAdvanceStepIdx(0, steps, origin, speedMs)).toBe(1);

      // Place maneuver just outside: neither advances.
      const justOutside = stepAtDistance(origin, thresholdM + 1);
      const stepsOut: Step[] = [{ coordinate: origin }, justOutside];
      expect(foregroundAdvanceStepIdx(0, stepsOut, origin, speedMs)).toBe(0);
      expect(backgroundAdvanceStepIdx(0, stepsOut, origin, speedMs)).toBe(0);
    },
  );

  // ── 7c: co-advance at highway speed (65 mph / 65 m bucket) ───────────────
  //
  // At 65 mph (~29 m/s) iOS BestForNavigation fires roughly 1 Hz.
  // Maneuver is 90 m ahead; ticks: 90 m → 61 m (inside) → 32 m.
  // Both production functions must advance on tick 1.

  it("highway 65 mph — both advance on the same tick approaching a maneuver 90 m away", () => {
    const maneuver = stepAtDistance(origin, 90);
    const steps: Step[] = [{ coordinate: origin }, maneuver];
    const highwayMs = 65 / 2.237;

    const ticks = [
      { loc: origin,                    speedMs: highwayMs }, // 90 m — outside
      { loc: locAtDistance(origin, 29), speedMs: highwayMs }, // ~61 m — inside 65 m
      { loc: locAtDistance(origin, 58), speedMs: highwayMs }, // ~32 m — inside
    ];

    const fgTick = fgFirstAdvanceTick(steps, ticks);
    const bgTick = bgFirstAdvanceTick(steps, ticks);

    expect(fgTick).toBe(1);
    expect(bgTick).toBe(1);
    expect(fgTick).toBe(bgTick);
  });

  // ── 7d: co-advance at urban speed (40 mph / 50 m bucket) ─────────────────

  it("urban 40 mph — both advance on the same tick approaching a maneuver 70 m away", () => {
    const maneuver = stepAtDistance(origin, 70);
    const steps: Step[] = [{ coordinate: origin }, maneuver];
    const urbanMs = 40 / 2.237;

    // ~18 m per tick at 40 mph; 70 → 52 (outside) → 34 (inside 50 m)
    const ticks = [
      { loc: origin,                    speedMs: urbanMs },
      { loc: locAtDistance(origin, 18), speedMs: urbanMs }, // 52 m — outside
      { loc: locAtDistance(origin, 36), speedMs: urbanMs }, // 34 m — inside
    ];

    const fgTick = fgFirstAdvanceTick(steps, ticks);
    const bgTick = bgFirstAdvanceTick(steps, ticks);

    expect(fgTick).toBe(2);
    expect(bgTick).toBe(2);
    expect(fgTick).toBe(bgTick);
  });

  // ── 7e: co-advance at residential speed (20 mph / 35 m bucket) ───────────

  it("residential 20 mph — both advance on the same tick approaching a maneuver 50 m away", () => {
    const maneuver = stepAtDistance(origin, 50);
    const steps: Step[] = [{ coordinate: origin }, maneuver];
    const residMs = 20 / 2.237;

    // ~9 m per tick at 20 mph; 50 → 41 (outside) → 32 (inside 35 m)
    const ticks = [
      { loc: origin,                   speedMs: residMs },
      { loc: locAtDistance(origin, 9), speedMs: residMs }, // 41 m — outside
      { loc: locAtDistance(origin, 18), speedMs: residMs }, // 32 m — inside
    ];

    const fgTick = fgFirstAdvanceTick(steps, ticks);
    const bgTick = bgFirstAdvanceTick(steps, ticks);

    expect(fgTick).toBe(2);
    expect(bgTick).toBe(2);
    expect(fgTick).toBe(bgTick);
  });

  // ── 7f: co-advance at slow speed (10 mph / 25 m bucket) ──────────────────

  it("slow 10 mph — both advance on the same tick approaching a maneuver 40 m away", () => {
    const maneuver = stepAtDistance(origin, 40);
    const steps: Step[] = [{ coordinate: origin }, maneuver];
    const slowMs = 10 / 2.237;

    // 10 m ticks; 40 → 30 (outside) → 20 (inside 25 m)
    const ticks = [
      { loc: origin,                    speedMs: slowMs },
      { loc: locAtDistance(origin, 10), speedMs: slowMs }, // 30 m — outside
      { loc: locAtDistance(origin, 20), speedMs: slowMs }, // 20 m — inside
    ];

    const fgTick = fgFirstAdvanceTick(steps, ticks);
    const bgTick = bgFirstAdvanceTick(steps, ticks);

    expect(fgTick).toBe(2);
    expect(bgTick).toBe(2);
    expect(fgTick).toBe(bgTick);
  });

  // ── 7g: no advance when location never enters the threshold window ────────

  it("both agree when location never enters the threshold window", () => {
    const maneuver = stepAtDistance(origin, 200);
    const steps: Step[] = [{ coordinate: origin }, maneuver];
    const highwayMs = 65 / 2.237;

    const ticks = [
      { loc: origin,                    speedMs: highwayMs },
      { loc: locAtDistance(origin, 29), speedMs: highwayMs }, // 171 m — outside
      { loc: locAtDistance(origin, 58), speedMs: highwayMs }, // 142 m — outside
    ];

    expect(fgFirstAdvanceTick(steps, ticks)).toBe(-1);
    expect(bgFirstAdvanceTick(steps, ticks)).toBe(-1);
  });

  // ── 7h: behavioral difference — background multi-step, foreground single ──
  //
  // This is a DOCUMENTED design difference, not a bug.  When two consecutive
  // maneuver points are both within the threshold (e.g. two tight turns close
  // together), the background advances through both in one location update
  // (while loop), whereas the foreground advances only one step and picks up
  // the second on the next GPS tick.
  //
  // Confirming this asymmetry here prevents a future refactor from accidentally
  // collapsing the background while-loop into a single-step check (which would
  // cause the wrong push notification to fire on multi-step segments).

  it("background advances through two consecutive in-threshold steps in one tick; foreground advances only one", () => {
    const highwayMs = 65 / 2.237; // threshold = 65 m

    // Place step1 and step2 both within 65 m of origin.
    const step1 = stepAtDistance(origin, 20); // 20 m away — inside 65 m
    const step2 = stepAtDistance(origin, 40); // 40 m away — inside 65 m
    const steps: Step[] = [{ coordinate: origin }, step1, step2];

    // Foreground: at most one advance per call
    const fgResult = foregroundAdvanceStepIdx(0, steps, origin, highwayMs);
    expect(fgResult).toBe(1); // advances one step

    // Background: advances through both
    const bgResult = backgroundAdvanceStepIdx(0, steps, origin, highwayMs);
    expect(bgResult).toBe(2); // advances two steps in one tick
  });
});

// ── Suite 8: arrival ordering — final turn fires before arrival ───────────────
//
// Root cause (task-678): the background task checked arrival (< 60 m) BEFORE
// the step-advance loop. At highway speed (~29 m/tick) the 65 m step-advance
// threshold overlaps the 60 m arrival gate. A position 55 m from both the
// final maneuver and the destination caused the arrival branch to return early,
// skipping the final-turn push notification entirely.
//
// Fix: backgroundNav.ts now runs the step-advance block BEFORE the arrival
// check, guaranteeing the final turn notification fires in the same tick.
//
// These tests validate the ordering using the production helper functions that
// backgroundNav.ts delegates to, so any change to either the threshold or the
// step-advance logic breaks the tests.

describe("arrival ordering — final turn fires before arrival at highway speed", () => {
  const origin: LatLng = { latitude: 37.7749, longitude: -122.4194 };
  const highwayMs = 65 / 2.237; // ~29 m/s, threshold = 65 m

  // ── 8a: step-advance triggers at 55 m (inside 65 m threshold) ────────────

  it("at 55 m from final maneuver the step-advance check fires (turn notification triggers)", () => {
    // Final maneuver point coincides with the destination at 55 m.
    const finalManeuver = stepAtDistance(origin, 55);
    const steps: Step[] = [{ coordinate: origin }, finalManeuver];

    // backgroundAdvanceStepIdx runs first in the re-ordered task.
    // 55 m < 65 m threshold → step advances from 0 → 1.
    const newIdx = backgroundAdvanceStepIdx(0, steps, origin, highwayMs);
    expect(newIdx).toBe(1); // final step reached — turn notification would fire
  });

  // ── 8b: arrival gate also triggers at 55 m ───────────────────────────────

  it("at 55 m from destination the arrival gate (< 60 m) is also true", () => {
    const destCoord = locAtDistance(origin, 55);
    const distToDest = haversineMeters(origin, destCoord);
    // Confirms both conditions overlap — the ordering in backgroundNav.ts
    // matters because both are true in the same tick.
    expect(distToDest).toBeLessThan(60);
    expect(distToDest).toBeGreaterThan(50); // realistic, not zero
  });

  // ── 8c: old ordering (arrival-first) would have skipped the turn ─────────

  it("old arrival-first ordering would have returned before step-advance ran", () => {
    // Under the old code, distToDest < 60 fired FIRST and returned early,
    // meaning backgroundAdvanceStepIdx was never called.  The step index stayed
    // at 0 and lastNotifiedStepIdx was never updated, so no turn notification.
    //
    // Simulate the old ordering: check arrival before step-advance.
    const destCoord = locAtDistance(origin, 55);
    const distToDest = haversineMeters(origin, destCoord);
    const finalManeuver = stepAtDistance(origin, 55);
    const steps: Step[] = [{ coordinate: origin }, finalManeuver];

    let turnFired = false;
    let arrivalFired = false;

    // OLD ordering: arrival gate first
    if (distToDest < 60) {
      arrivalFired = true;
      // old code returned here — step-advance never ran
    } else {
      const newIdx = backgroundAdvanceStepIdx(0, steps, origin, highwayMs);
      if (newIdx !== 0) turnFired = true;
    }

    // Old code: arrival fires but turn is silently skipped
    expect(arrivalFired).toBe(true);
    expect(turnFired).toBe(false); // BUG: final turn notification never fired
  });

  // ── 8d: new ordering (step-advance-first) fires turn THEN arrival ─────────

  it("new step-advance-first ordering fires turn notification before arrival", () => {
    // Simulate the corrected ordering from backgroundNav.ts.
    const destCoord = locAtDistance(origin, 55);
    const distToDest = haversineMeters(origin, destCoord);
    const finalManeuver = stepAtDistance(origin, 55);
    const steps: Step[] = [{ coordinate: origin }, finalManeuver];

    const callOrder: string[] = [];

    // NEW ordering: step-advance first
    const newIdx = backgroundAdvanceStepIdx(0, steps, origin, highwayMs);
    if (newIdx !== 0) callOrder.push("turn");

    // Arrival check runs after
    if (distToDest < 60) callOrder.push("arrival");

    // Turn fires first, then arrival — correct order
    expect(callOrder).toEqual(["turn", "arrival"]);
  });

  // ── 8e: just outside arrival gate — turn fires, arrival does not ──────────

  it("at 62 m from destination the turn fires (inside 65 m threshold) but arrival does not (> 60 m)", () => {
    const destCoord = locAtDistance(origin, 62);
    const distToDest = haversineMeters(origin, destCoord);
    const finalManeuver = stepAtDistance(origin, 62);
    const steps: Step[] = [{ coordinate: origin }, finalManeuver];

    const newIdx = backgroundAdvanceStepIdx(0, steps, origin, highwayMs);
    expect(newIdx).toBe(1);          // turn notification fires (62 < 65 m)
    expect(distToDest).toBeGreaterThanOrEqual(60); // arrival NOT yet triggered
  });
});

// ── Suite 9: AppState guard — background must not write idx when app is active ─
//
// backgroundNav.ts lines 61-63:
//   if (AppState.currentState !== "active") {
//     navState.currentStepIdx = idx;
//   }
//
// When the user has the app open (AppState.currentState === "active") the
// foreground GPS handler in map.tsx owns currentStepIdx.  The background task
// still computes a new index (backgroundAdvanceStepIdx) so it can fire the
// turn notification, but it must NOT write that value into navState because the
// background location batch may be stale relative to the 1 Hz foreground stream.
//
// These tests simulate the full background-tick write gate using a local
// navState mock (currentStepIdx mutable field), identical to how Suite 8
// simulates the arrival/step-advance ordering.  No RN module mocking is
// needed — the guard is pure conditional logic on the AppState string.

describe("AppState guard — background does not write currentStepIdx when app is active", () => {
  const origin: LatLng = { latitude: 37.7749, longitude: -122.4194 };
  const highwayMs = 65 / 2.237; // threshold = 65 m

  // Minimal mutable navState for these tests.
  function makeNavState(initialIdx: number) {
    return { currentStepIdx: initialIdx };
  }

  // Simulate the background task's write gate from backgroundNav.ts lines 61-63.
  function applyBackgroundWriteGate(
    appState: "active" | "background" | "inactive",
    navStateMock: { currentStepIdx: number },
    newIdx: number,
  ): void {
    if (appState !== "active") {
      navStateMock.currentStepIdx = newIdx;
    }
  }

  // ── 9a: background does NOT update currentStepIdx when app is "active" ───
  //
  // This is the core regression guard: if a background location batch arrives
  // while the user is looking at the map, the foreground handler has already
  // advanced the step (at 1 Hz).  Writing the (possibly older) background idx
  // would race the foreground and rewind the step counter.

  it("when AppState is 'active', background computes new idx but does NOT write to currentStepIdx", () => {
    const maneuver = stepAtDistance(origin, 50); // inside 65 m threshold
    const steps: Step[] = [{ coordinate: origin }, maneuver];

    const navStateMock = makeNavState(0);

    // Background computes the new index.
    const computedIdx = backgroundAdvanceStepIdx(0, steps, origin, highwayMs);
    expect(computedIdx).toBe(1); // advance IS computed

    // Apply the write gate — app is active, so write must be suppressed.
    applyBackgroundWriteGate("active", navStateMock, computedIdx);
    expect(navStateMock.currentStepIdx).toBe(0); // NOT updated
  });

  // ── 9b: background DOES update currentStepIdx when app is "background" ────

  it("when AppState is 'background', background writes the new idx to currentStepIdx", () => {
    const maneuver = stepAtDistance(origin, 50);
    const steps: Step[] = [{ coordinate: origin }, maneuver];

    const navStateMock = makeNavState(0);

    const computedIdx = backgroundAdvanceStepIdx(0, steps, origin, highwayMs);
    expect(computedIdx).toBe(1);

    applyBackgroundWriteGate("background", navStateMock, computedIdx);
    expect(navStateMock.currentStepIdx).toBe(1); // updated correctly
  });

  // ── 9c: background DOES update currentStepIdx when app is "inactive" ─────
  //
  // "inactive" covers the iOS transition state (notification centre open, call
  // overlay etc.).  The app is not in the foreground, so the background task
  // owns currentStepIdx.

  it("when AppState is 'inactive', background writes the new idx to currentStepIdx", () => {
    const maneuver = stepAtDistance(origin, 50);
    const steps: Step[] = [{ coordinate: origin }, maneuver];

    const navStateMock = makeNavState(0);

    const computedIdx = backgroundAdvanceStepIdx(0, steps, origin, highwayMs);
    applyBackgroundWriteGate("inactive", navStateMock, computedIdx);
    expect(navStateMock.currentStepIdx).toBe(1); // updated correctly
  });

  // ── 9d: full highway-speed GPS sequence — idx parity and write-gate ───────
  //
  // Replays a 5-tick highway approach through both production step-advance
  // functions and asserts they produce the same new index on every tick.
  // Then applies the AppState guard to the background result:
  //   - active   → currentStepIdx stays at foreground value
  //   - background → currentStepIdx matches the computed index
  //
  // This is the integration scenario the task specification requires.

  it("highway-speed GPS sequence: foreground and background advance at the same tick; write-gate controls who owns currentStepIdx", () => {
    // Route: origin → maneuver 100 m north.
    // At 65 mph (~29 m/s), ticks close in at ~29 m steps.
    // Threshold = 65 m → advance happens when maneuver is < 65 m away.
    // Tick distances to maneuver: 100 → 71 → 42 → 13.
    // Advance on tick 2 (42 m < 65 m).

    const maneuver = stepAtDistance(origin, 100);
    const steps: Step[] = [{ coordinate: origin }, maneuver];

    const ticks = [
      { loc: origin,                     speedMs: highwayMs }, // 100 m — outside
      { loc: locAtDistance(origin, 29),  speedMs: highwayMs }, // ~71 m — outside
      { loc: locAtDistance(origin, 58),  speedMs: highwayMs }, // ~42 m — inside 65 m
      { loc: locAtDistance(origin, 87),  speedMs: highwayMs }, // ~13 m — inside
    ];

    // Track state independently for foreground and two AppState scenarios.
    let fgIdx = 0;
    const bgBgState = makeNavState(0); // simulates app-is-background path

    // Record which tick triggers the first advance — should be the same for both.
    let fgAdvanceTick = -1;
    let bgAdvanceTick = -1;

    for (let i = 0; i < ticks.length; i++) {
      const { loc, speedMs } = ticks[i];

      // Foreground: single-step advance.
      const fgNext = foregroundAdvanceStepIdx(fgIdx, steps, loc, speedMs);

      // Background: multi-step advance (same threshold, different advance limit).
      const bgNext = backgroundAdvanceStepIdx(bgBgState.currentStepIdx, steps, loc, speedMs);

      // Both production functions must agree on the new index for each tick.
      expect(fgNext).toBe(bgNext);

      // Record first advance tick index for parity assertion after the loop.
      if (fgNext !== fgIdx && fgAdvanceTick === -1) fgAdvanceTick = i;
      if (bgNext !== bgBgState.currentStepIdx && bgAdvanceTick === -1) bgAdvanceTick = i;

      // Apply write gate: background path (not active) allows write.
      applyBackgroundWriteGate("background", bgBgState, bgNext);

      fgIdx = fgNext;
    }

    // Both paths advance on the same tick — core parity assertion.
    expect(fgAdvanceTick).toBe(2);  // tick 2: ~42 m, inside 65 m threshold
    expect(bgAdvanceTick).toBe(2);
    expect(fgAdvanceTick).toBe(bgAdvanceTick);

    // After the full sequence both paths have advanced to step 1.
    expect(fgIdx).toBe(1);
    expect(bgBgState.currentStepIdx).toBe(1);
  });

  it("active write-gate suppresses ALL background writes across the full sequence", () => {
    // Same route, but AppState stays 'active' the entire time.
    // The background task computes a new idx on tick 2 but MUST NOT write it.

    const maneuver = stepAtDistance(origin, 100);
    const steps: Step[] = [{ coordinate: origin }, maneuver];

    const ticks = [
      { loc: origin,                    speedMs: highwayMs },
      { loc: locAtDistance(origin, 29), speedMs: highwayMs },
      { loc: locAtDistance(origin, 58), speedMs: highwayMs }, // advance tick
      { loc: locAtDistance(origin, 87), speedMs: highwayMs },
    ];

    const bgActiveState = makeNavState(0);

    for (const { loc, speedMs } of ticks) {
      const bgNext = backgroundAdvanceStepIdx(bgActiveState.currentStepIdx, steps, loc, speedMs);
      // Active guard — write is suppressed on every tick.
      applyBackgroundWriteGate("active", bgActiveState, bgNext);
    }

    // The background task never wrote to currentStepIdx while app was active.
    expect(bgActiveState.currentStepIdx).toBe(0);
  });

  // ── 9e: foreground always updates regardless of AppState ─────────────────
  //
  // The foreground GPS handler runs unconditionally in the location subscription
  // callback and always writes the returned index.  There is no AppState guard
  // on the foreground path.  This test documents that contract so a future
  // refactor cannot accidentally add one.

  it("foreground advance is not gated by AppState — it always returns the new idx for the caller to write", () => {
    const maneuver = stepAtDistance(origin, 50); // inside 65 m threshold
    const steps: Step[] = [{ coordinate: origin }, maneuver];

    // foregroundAdvanceStepIdx is a pure function — it returns the new idx
    // and leaves the write decision to map.tsx.  The absence of an AppState
    // check inside it is by design.
    const newIdx = foregroundAdvanceStepIdx(0, steps, origin, highwayMs);
    expect(newIdx).toBe(1); // always advances when condition is met

    // Calling it again with the same inputs (regardless of app state) returns
    // the same result — there is no guard that could suppress the return value.
    expect(foregroundAdvanceStepIdx(0, steps, origin, highwayMs)).toBe(newIdx);
  });
});

// ── Suite 10: walking and cycling foreground overrides ────────────────────────
//
// map.tsx applies fixed thresholds before calling foregroundAdvanceStepIdx:
//   isWalking = true  → 20 m  (regardless of GPS speed)
//   isCycling = true  → 25 m  (regardless of GPS speed)
//   neither           → navStepThreshold(speedMs)  (motorised path)
//
// These thresholds are intentionally lower than the slowest motorised bucket
// (25 m at < 15 mph) for cycling, and lower still for walking, because
// pedestrians and cyclists approach maneuver points more slowly and need
// the banner to flip only when they are already very close.
//
// backgroundAdvanceStepIdx now accepts the same isWalking/isCycling flags
// (defaults false) and internally calls navMissedTurnThreshold() — the same
// helper as foregroundAdvanceStepIdx — so both paths use the same threshold
// for a given activity type.  backgroundNav.ts passes travelMode flags from
// navState, ensuring a background location during a walking session uses 20 m
// rather than the motorised 25–65 m range.
//
// Suite 10d tests the motorised default path (no flags → navStepThreshold).
// Suite 17 tests the walking/cycling background paths explicitly.
//
// A refactor that accidentally drops the isWalking/isCycling guard inside
// foregroundAdvanceStepIdx — or removes the navMissedTurnThreshold delegation
// inside backgroundAdvanceStepIdx — will cause these tests to fail.

describe("foreground walking/cycling overrides — 20 m and 25 m fixed thresholds", () => {
  const origin: LatLng = { latitude: 37.7749, longitude: -122.4194 };

  // ── 10a: walking override — 20 m at any speed ────────────────────────────
  //
  // A maneuver 19 m away (< 20 m) MUST advance; one 21 m away must NOT.
  // Speed is set to highway (65 mph) to prove the override ignores speedMs.

  it("isWalking=true: advances when maneuver is 19 m away regardless of GPS speed", () => {
    const steps: Step[] = [{ coordinate: origin }, stepAtDistance(origin, 19)];
    const result = foregroundAdvanceStepIdx(0, steps, origin, 65 / 2.237, true, false);
    expect(result).toBe(1);
  });

  it("isWalking=true: does NOT advance when maneuver is 21 m away (outside 20 m threshold)", () => {
    const steps: Step[] = [{ coordinate: origin }, stepAtDistance(origin, 21)];
    const result = foregroundAdvanceStepIdx(0, steps, origin, 65 / 2.237, true, false);
    expect(result).toBe(0);
  });

  it("isWalking=true: threshold is exactly 20 m — advances at any speed (slow 4 mph shown)", () => {
    const steps: Step[] = [{ coordinate: origin }, stepAtDistance(origin, 15)];
    // 4 mph → navStepThreshold would return 25 m, but walking override = 20 m
    // 15 m < 20 m → should still advance
    const result = foregroundAdvanceStepIdx(0, steps, origin, 4 / 2.237, true, false);
    expect(result).toBe(1);
  });

  // ── 10b: cycling override — 25 m at any speed ────────────────────────────

  it("isCycling=true: advances when maneuver is 24 m away regardless of GPS speed", () => {
    const steps: Step[] = [{ coordinate: origin }, stepAtDistance(origin, 24)];
    const result = foregroundAdvanceStepIdx(0, steps, origin, 65 / 2.237, false, true);
    expect(result).toBe(1);
  });

  it("isCycling=true: does NOT advance when maneuver is 26 m away (outside 25 m threshold)", () => {
    const steps: Step[] = [{ coordinate: origin }, stepAtDistance(origin, 26)];
    const result = foregroundAdvanceStepIdx(0, steps, origin, 65 / 2.237, false, true);
    expect(result).toBe(0);
  });

  it("isCycling=true: threshold is exactly 25 m — advances at urban speed (40 mph would be 50 m)", () => {
    // At 40 mph navStepThreshold = 50 m; cycling override = 25 m.
    // A maneuver at 30 m is outside the 25 m cycling window.
    const steps: Step[] = [{ coordinate: origin }, stepAtDistance(origin, 30)];
    const result = foregroundAdvanceStepIdx(0, steps, origin, 40 / 2.237, false, true);
    expect(result).toBe(0); // 30 > 25 → no advance (cycling threshold, not motorised)
  });

  it("isCycling=true: advances at 20 m (inside 25 m cycling threshold), ignoring urban 50 m motorised value", () => {
    const steps: Step[] = [{ coordinate: origin }, stepAtDistance(origin, 20)];
    const result = foregroundAdvanceStepIdx(0, steps, origin, 40 / 2.237, false, true);
    expect(result).toBe(1); // 20 < 25 → advances
  });

  // ── 10c: neither flag — foreground uses navStepThreshold (motorised) ──────

  it("isWalking=false, isCycling=false: foreground uses navStepThreshold at highway speed (65 m)", () => {
    // 60 m < 65 m → should advance with motorised threshold
    const steps: Step[] = [{ coordinate: origin }, stepAtDistance(origin, 60)];
    const result = foregroundAdvanceStepIdx(0, steps, origin, 65 / 2.237, false, false);
    expect(result).toBe(1);
  });

  it("isWalking=false, isCycling=false: does NOT advance at 70 m from maneuver at highway speed", () => {
    const steps: Step[] = [{ coordinate: origin }, stepAtDistance(origin, 70)];
    const result = foregroundAdvanceStepIdx(0, steps, origin, 65 / 2.237, false, false);
    expect(result).toBe(0); // 70 > 65 m threshold
  });

  // ── 10d: background motorised default (no flags) — still uses navStepThreshold ──
  //
  // backgroundAdvanceStepIdx defaults isWalking=false, isCycling=false, so calling
  // it without flags exercises the same navStepThreshold() motorised path as before.
  // These tests confirm the default behaviour is unchanged: the motorised path
  // returns a larger threshold than walking/cycling foreground overrides.
  //
  // When called WITH isWalking=true or isCycling=true (see Suite 17) the
  // background function uses the same fixed thresholds as the foreground.

  it("background (motorised default) at highway speed uses 65 m — advances at 60 m where walking foreground does not", () => {
    const steps: Step[] = [{ coordinate: origin }, stepAtDistance(origin, 60)];
    // No walking flag → motorised path → navStepThreshold(65 mph) = 65 m.
    const bgResult = backgroundAdvanceStepIdx(0, steps, origin, 65 / 2.237);
    expect(bgResult).toBe(1); // background (motorised): 60 < 65 m → advances

    // Confirm foreground with walking flag does NOT advance at 60 m
    const fgWalkResult = foregroundAdvanceStepIdx(0, steps, origin, 65 / 2.237, true, false);
    expect(fgWalkResult).toBe(0); // walking foreground: 60 > 20 m → no advance
  });

  it("background (motorised default) at slow speed uses 25 m; foreground walking override stays at 20 m", () => {
    // Maneuver at 22 m: inside background motorised 25 m window, outside walking 20 m window.
    const steps: Step[] = [{ coordinate: origin }, stepAtDistance(origin, 22)];
    const slowMs = 4 / 2.237; // ~4 mph → navStepThreshold returns 25 m

    // No walking flag → motorised → 22 < 25 m → advances.
    const bgResult = backgroundAdvanceStepIdx(0, steps, origin, slowMs);
    expect(bgResult).toBe(1); // background (motorised default): 22 < 25 m → advances

    const fgWalkResult = foregroundAdvanceStepIdx(0, steps, origin, slowMs, true, false);
    expect(fgWalkResult).toBe(0); // walking: 22 > 20 m → no advance (tighter threshold)
  });

  it("cycling foreground at highway speed has a lower threshold than motorised background by design", () => {
    // At 65 mph: motorised background threshold = 65 m; cycling foreground = 25 m.
    // When called with isCycling=true (see Suite 17) the background also uses 25 m.
    const motorisedBgThreshold = navStepThreshold(65 / 2.237); // 65 m
    const cyclingFgThreshold = 25;                              // fixed
    expect(cyclingFgThreshold).toBeLessThan(motorisedBgThreshold);
  });

  // ── 10e: isWalking takes precedence over isCycling if both are set ────────
  //
  // In practice map.tsx sets only one at a time, but the implementation's
  // evaluation order (isWalking checked first) should be documented.

  it("when both isWalking and isCycling are true, 20 m walking threshold applies (checked first)", () => {
    // 19 m < 20 m → advance if walking wins; 19 m < 25 m so both would advance here — use 21 m instead
    const steps: Step[] = [{ coordinate: origin }, stepAtDistance(origin, 21)];
    const result = foregroundAdvanceStepIdx(0, steps, origin, 4 / 2.237, true, true);
    // isWalking=true → threshold 20 m; 21 > 20 → no advance
    // If isCycling had priority, threshold would be 25 m and 21 < 25 → advance
    expect(result).toBe(0); // walking (20 m) wins — 21 m is outside
  });
});

// ── Suite 11: foregrounding mid-route — integration tests in dedicated file ────
//
// The foregrounding edge case (AppState transitions to "active" in the same tick
// that both the 65 m step-advance threshold and the 60 m arrival gate are crossed)
// is covered by the integration test suite in:
//
//   __tests__/backgroundNavForegrounding.test.ts
//
// That file uses jest.isolateModules + jest.doMock to load the real backgroundNav.ts
// callback and mutate AppState.currentState, asserting on the actual Notifications
// call sequence and navState.currentStepIdx — not on a local reimplementation.
// See that file for Suites A–D covering the core foregrounding scenario.

// ── Suite 12: arrival gate vs step-advance ordering invariant ─────────────────
//
// INVARIANT: ARRIVAL_GATE_METERS must always be strictly less than the maximum
// value returned by navStepThreshold() (currently 65 m at highway speed > 50 mph).
//
// Why: backgroundNav.ts runs the step-advance block BEFORE the arrival check so
// that the final-turn push notification is guaranteed to fire even when the user
// crosses the arrival gate in the same GPS tick as the final maneuver point (see
// Suite 8).  This ordering fix only holds if the arrival gate is narrower than
// the maximum step-advance threshold — i.e. there is always a tick where the
// step-advance fires but the arrival gate does not.
//
// If ARRIVAL_GATE_METERS is raised above the maximum step threshold (currently
// 65 m) the ordering fix becomes ineffective: a position inside the arrival gate
// could never have been inside the step-advance threshold on a prior tick, so
// the final turn notification would be silently skipped.
//
// This test imports ARRIVAL_GATE_METERS directly from backgroundNav.ts, so any
// future change to the constant (in either direction) is immediately visible.

import { ARRIVAL_GATE_METERS } from "../utils/navConstants";

describe("arrival gate vs step-advance ordering invariant", () => {
  // The maximum motorised threshold is returned at highway speed (> 50 mph).
  // Use a safely-above-50-mph value to guarantee we hit the 65 m bucket.
  const MAX_HIGHWAY_SPEED_MS = 65 / 2.237; // ~29.06 m/s ≈ 65 mph
  const maxStepThreshold = navStepThreshold(MAX_HIGHWAY_SPEED_MS);

  it("navStepThreshold at maximum motorised speed is 65 m", () => {
    expect(maxStepThreshold).toBe(65);
  });

  it("ARRIVAL_GATE_METERS is strictly less than the max step-advance threshold (65 m)", () => {
    // Enforces the ordering invariant: the arrival gate must sit inside the
    // step-advance window at highway speed so the final-turn notification
    // always fires before the arrival branch returns early.
    expect(ARRIVAL_GATE_METERS).toBeLessThan(maxStepThreshold);
  });

  it("ARRIVAL_GATE_METERS is 60 m (documents the current value so regressions are visible)", () => {
    // If someone changes the constant, this test fails immediately — prompting
    // them to re-check the ordering invariant above and update the comment in
    // backgroundNav.ts accordingly.
    expect(ARRIVAL_GATE_METERS).toBe(60);
  });

  it("the gap between ARRIVAL_GATE_METERS and the max threshold is at least 1 m (strict, not equal)", () => {
    // Guards against accidentally setting ARRIVAL_GATE_METERS === maxStepThreshold,
    // which would make the arrival check fire in the exact same tick as step-advance
    // (the < comparisons are strict), eliminating the ordering buffer.
    expect(maxStepThreshold - ARRIVAL_GATE_METERS).toBeGreaterThanOrEqual(1);
  });
});

// ── Suite 13: mid-approach deceleration — threshold bucket switches mid-sequence ──
//
// Root cause scenario (task-693): when the driver brakes from highway to urban
// speed mid-approach (e.g. 65 mph → 40 mph as they exit a ramp), navStepThreshold()
// switches from the 65 m bucket to the 50 m bucket in the same GPS tick.  Both the
// foreground handler (map.tsx) and the background task (backgroundNav.ts) call
// navStepThreshold() per-tick, so the threshold switch must be identical in both
// paths in the same tick — otherwise one path fires the step advance early (while
// still reading the stale 65 m threshold) and the step indices drift apart.
//
// Scenario geometry — maneuver 120 m north, ticks closing in:
//
//   tick 0: origin,      120 m to maneuver, highway (65 mph → 65 m threshold) → no advance
//   tick 1: +29 m,        91 m to maneuver, highway (65 mph → 65 m threshold) → no advance
//   tick 2: +58 m,        62 m to maneuver, SPEED DROPS to urban (40 mph → 50 m threshold)
//           → 62 m > 50 m → no advance (if threshold stayed at 65 m, 62 < 65 → premature advance)
//   tick 3: +76 m,        44 m to maneuver, urban (40 mph → 50 m threshold) → 44 < 50 → ADVANCE
//   tick 4: +94 m,        26 m to maneuver, urban (40 mph → 50 m threshold) → already advanced
//
// Key invariant:
//   • Both functions must agree (same idx) on every tick — especially tick 2 where
//     the threshold switches and tick 3 where the advance fires.
//   • The advance tick must be identical for both (±0 ticks tolerance).

describe("mid-approach deceleration — highway to urban speed switch stays in sync", () => {
  const origin: LatLng = { latitude: 37.7749, longitude: -122.4194 };
  const highwayMs = 65 / 2.237; // ~29.06 m/s, threshold = 65 m
  const urbanMs   = 40 / 2.237; // ~17.88 m/s, threshold = 50 m

  // 5-tick sequence: speed drops between ticks 1→2.
  // Distances to maneuver per tick: 120 → 91 → 62 → 44 → 26 m.
  const maneuverDistM = 120;

  function makeTicks(): Array<{ loc: LatLng; speedMs: number }> {
    return [
      { loc: origin,                    speedMs: highwayMs }, // tick 0: 120 m away
      { loc: locAtDistance(origin, 29), speedMs: highwayMs }, // tick 1:  91 m away
      { loc: locAtDistance(origin, 58), speedMs: urbanMs   }, // tick 2:  62 m away — threshold switches
      { loc: locAtDistance(origin, 76), speedMs: urbanMs   }, // tick 3:  44 m away — advance fires
      { loc: locAtDistance(origin, 94), speedMs: urbanMs   }, // tick 4:  26 m away — already advanced
    ];
  }

  // ── 13a: both functions return the same idx on every tick ────────────────
  //
  // Replays the full 5-tick sequence through both production functions and
  // asserts they agree on the resulting step index at every GPS tick,
  // including tick 2 (threshold switch) and tick 3 (advance fires).

  it("both functions return the same new idx on every tick of the 5-tick sequence", () => {
    const maneuver = stepAtDistance(origin, maneuverDistM);
    const steps: Step[] = [{ coordinate: origin }, maneuver];
    const ticks = makeTicks();

    let fgIdx = 0;
    let bgIdx = 0;

    for (let i = 0; i < ticks.length; i++) {
      const { loc, speedMs } = ticks[i];
      const fgNext = foregroundAdvanceStepIdx(fgIdx, steps, loc, speedMs);
      const bgNext = backgroundAdvanceStepIdx(bgIdx, steps, loc, speedMs);
      // Both production functions must agree on the resulting index every tick.
      expect(fgNext).toBe(bgNext);
      fgIdx = fgNext;
      bgIdx = bgNext;
    }

    // After all 5 ticks both should have advanced to step 1.
    expect(fgIdx).toBe(1);
    expect(bgIdx).toBe(1);
  });

  // ── 13b: advance fires on tick 3 for both — same tick, ±0 tolerance ──────
  //
  // Uses fgFirstAdvanceTick / bgFirstAdvanceTick from Suite 7 to find which
  // tick each production function first moves past idx 0.  Both must agree.

  it("advance fires on tick 3 for both — same tick, ±0 ticks tolerance", () => {
    const maneuver = stepAtDistance(origin, maneuverDistM);
    const steps: Step[] = [{ coordinate: origin }, maneuver];
    const ticks = makeTicks();

    const fgTick = fgFirstAdvanceTick(steps, ticks);
    const bgTick = bgFirstAdvanceTick(steps, ticks);

    // Advance fires on tick 3 — the tick where the 44 m gap enters the 50 m window.
    expect(fgTick).toBe(3);
    expect(bgTick).toBe(3);
    // Core parity assertion: must be the same tick for both.
    expect(fgTick).toBe(bgTick);
  });

  // ── 13c: tick 2 does NOT advance — confirms the threshold switch applied ──
  //
  // At tick 2 the driver has just braked to 40 mph.  The GPS location is 62 m
  // from the maneuver point.  The new urban threshold is 50 m, so no advance
  // should fire.  However, if the threshold erroneously stayed at the highway
  // value (65 m), 62 < 65 would cause a premature advance.
  //
  // This test isolates tick 2 and asserts:
  //   a) both functions do NOT advance with urban threshold (correct post-brake)
  //   b) both functions WOULD advance with highway threshold (proving the
  //      threshold switch is the deciding factor)

  it("tick 2 (62 m to maneuver, threshold just switched to 50 m): both functions do NOT advance", () => {
    const maneuver = stepAtDistance(origin, maneuverDistM);
    const steps: Step[] = [{ coordinate: origin }, maneuver];
    const locTick2 = locAtDistance(origin, 58); // 62 m to maneuver

    // Urban threshold (40 mph → 50 m): 62 > 50 → no advance.
    expect(foregroundAdvanceStepIdx(0, steps, locTick2, urbanMs)).toBe(0);
    expect(backgroundAdvanceStepIdx(0, steps, locTick2, urbanMs)).toBe(0);
  });

  it("tick 2 at highway threshold (65 m) WOULD have advanced — proving threshold switch is decisive", () => {
    const maneuver = stepAtDistance(origin, maneuverDistM);
    const steps: Step[] = [{ coordinate: origin }, maneuver];
    const locTick2 = locAtDistance(origin, 58); // 62 m to maneuver

    // Highway threshold (65 mph → 65 m): 62 < 65 → WOULD advance (premature).
    // This confirms the threshold switch at tick 2 is what keeps the step in sync.
    expect(foregroundAdvanceStepIdx(0, steps, locTick2, highwayMs)).toBe(1);
    expect(backgroundAdvanceStepIdx(0, steps, locTick2, highwayMs)).toBe(1);
  });

  // ── 13d: tick 3 DOES advance — both functions agree ───────────────────────
  //
  // After the threshold switch (tick 2 → 50 m bucket), the driver is now 44 m
  // from the maneuver at tick 3.  44 < 50 triggers the advance in both paths.

  it("tick 3 (44 m to maneuver, urban 50 m threshold): both functions advance from idx 0 to 1", () => {
    const maneuver = stepAtDistance(origin, maneuverDistM);
    const steps: Step[] = [{ coordinate: origin }, maneuver];
    const locTick3 = locAtDistance(origin, 76); // 44 m to maneuver

    expect(foregroundAdvanceStepIdx(0, steps, locTick3, urbanMs)).toBe(1);
    expect(backgroundAdvanceStepIdx(0, steps, locTick3, urbanMs)).toBe(1);
  });

  // ── 13e: navStepThreshold bucket values used in this scenario ────────────
  //
  // Documents the exact threshold values the sequence relies on, so a future
  // change to the breakpoints (navSpeedThreshold.ts) causes an explicit failure
  // here rather than a silent geometry mismatch in the tick assertions above.

  it("navStepThreshold at 65 mph is 65 m and at 40 mph is 50 m (bucket values used in this suite)", () => {
    expect(navStepThreshold(highwayMs)).toBe(65);
    expect(navStepThreshold(urbanMs)).toBe(50);
  });
});

// ── Suite 14: null / undefined GPS speed — stationary fallback (task-694) ────
//
// iOS and Android GPS occasionally omit the speed field, returning null.
// expo-location types LocationObject.coords.speed as `number | null`.
//
// backgroundNav.ts routes these through normalizeSpeed() (utils/navNormalizeSpeed.ts),
// which applies `speed ?? 0`.  If that call is removed, the raw null/undefined
// would be passed to navStepThreshold, where:
//   • null      → JS coerces to 0 in arithmetic (null * 2.237 = 0), so
//                 Math.round(0) = 0 → threshold happens to be 25 m (stationary).
//   • undefined → undefined * 2.237 = NaN; Math.round(NaN) = NaN; all
//                 comparisons (NaN > 50, NaN > 30 …) are false → falls
//                 through to the final else branch → also returns 25 m.
//
// The normalizeSpeed() helper makes the 0 fallback EXPLICIT for both cases
// so the intent is clear and the path cannot be silently broken by a future
// breakpoint reorder that changes which branch NaN falls through to.
//
// These tests import normalizeSpeed directly (the production boundary) so
// removing or changing it causes an immediate test failure.

import { normalizeSpeed } from "../utils/navNormalizeSpeed";

describe("null/undefined GPS speed — normalizeSpeed + stationary 25 m fallback (task-694)", () => {
  const origin: LatLng = { latitude: 37.7749, longitude: -122.4194 };

  // ── 14a: normalizeSpeed — production boundary ─────────────────────────────
  //
  // normalizeSpeed is the typed helper used by backgroundNav.ts at every call
  // site that receives a GPS speed field.  These tests pin its contract so any
  // future change to the ?? 0 logic fails immediately.

  it("normalizeSpeed(null) returns 0 — null GPS speed treated as stationary", () => {
    const gpsSpeed: number | null = null; // typed as expo-location returns it
    expect(normalizeSpeed(gpsSpeed)).toBe(0);
  });

  it("normalizeSpeed(undefined) returns 0 — missing GPS speed treated as stationary", () => {
    const gpsSpeed: number | null | undefined = undefined;
    expect(normalizeSpeed(gpsSpeed)).toBe(0);
  });

  it("normalizeSpeed(29.06) passes through the real speed unchanged", () => {
    const gpsSpeed: number | null = 29.06; // ~65 mph
    expect(normalizeSpeed(gpsSpeed)).toBe(29.06);
  });

  it("normalizeSpeed(0) returns 0 — explicit stationary reading passes through", () => {
    const gpsSpeed: number | null = 0;
    expect(normalizeSpeed(gpsSpeed)).toBe(0);
  });

  // ── 14b: navStepThreshold canonical fallback ──────────────────────────────
  //
  // navStepThreshold(0) is the canonical stationary bucket.  Both
  // normalizeSpeed(null) and normalizeSpeed(undefined) produce 0, so the
  // downstream threshold is always 25 m regardless of which absent value
  // the GPS platform returns.

  it("navStepThreshold(0) === 25 — canonical stationary fallback value", () => {
    expect(navStepThreshold(0)).toBe(25);
  });

  it("navStepThreshold(normalizeSpeed(null)) === 25", () => {
    const gpsSpeed: number | null = null;
    expect(navStepThreshold(normalizeSpeed(gpsSpeed))).toBe(25);
  });

  it("navStepThreshold(normalizeSpeed(undefined)) === 25", () => {
    const gpsSpeed: number | null | undefined = undefined;
    expect(navStepThreshold(normalizeSpeed(gpsSpeed))).toBe(25);
  });

  // ── 14c: foregroundAdvanceStepIdx with null/undefined speed ──────────────
  //
  // Simulate the foreground caller's normalized-speed path:
  //   const speedMs = normalizeSpeed(coords.speed);  // coords.speed: number | null
  //   foregroundAdvanceStepIdx(idx, steps, loc, speedMs);

  it("foreground: normalizeSpeed(null) → does NOT advance when maneuver is 26 m away (outside 25 m)", () => {
    const gpsSpeed: number | null = null;
    const steps: Step[] = [{ coordinate: origin }, stepAtDistance(origin, 26)];
    expect(foregroundAdvanceStepIdx(0, steps, origin, normalizeSpeed(gpsSpeed))).toBe(0);
  });

  it("foreground: normalizeSpeed(null) → DOES advance when maneuver is 20 m away (inside 25 m)", () => {
    const gpsSpeed: number | null = null;
    const steps: Step[] = [{ coordinate: origin }, stepAtDistance(origin, 20)];
    expect(foregroundAdvanceStepIdx(0, steps, origin, normalizeSpeed(gpsSpeed))).toBe(1);
  });

  it("foreground: normalizeSpeed(undefined) → does NOT advance when maneuver is 26 m away", () => {
    const gpsSpeed: number | null | undefined = undefined;
    const steps: Step[] = [{ coordinate: origin }, stepAtDistance(origin, 26)];
    expect(foregroundAdvanceStepIdx(0, steps, origin, normalizeSpeed(gpsSpeed))).toBe(0);
  });

  it("foreground: normalizeSpeed(undefined) → DOES advance when maneuver is 20 m away", () => {
    const gpsSpeed: number | null | undefined = undefined;
    const steps: Step[] = [{ coordinate: origin }, stepAtDistance(origin, 20)];
    expect(foregroundAdvanceStepIdx(0, steps, origin, normalizeSpeed(gpsSpeed))).toBe(1);
  });

  // ── 14d: backgroundAdvanceStepIdx with null/undefined speed ──────────────
  //
  // Simulate the background caller's path from backgroundNav.ts:
  //   const idx = backgroundAdvanceStepIdx(…, normalizeSpeed(pos.speed));
  // where pos.speed: number | null from the LocationObject.

  it("background: normalizeSpeed(null) → does NOT advance when maneuver is 26 m away (outside 25 m)", () => {
    const gpsSpeed: number | null = null;
    const steps: Step[] = [{ coordinate: origin }, stepAtDistance(origin, 26)];
    expect(backgroundAdvanceStepIdx(0, steps, origin, normalizeSpeed(gpsSpeed))).toBe(0);
  });

  it("background: normalizeSpeed(null) → DOES advance when maneuver is 20 m away (inside 25 m)", () => {
    const gpsSpeed: number | null = null;
    const steps: Step[] = [{ coordinate: origin }, stepAtDistance(origin, 20)];
    expect(backgroundAdvanceStepIdx(0, steps, origin, normalizeSpeed(gpsSpeed))).toBe(1);
  });

  it("background: normalizeSpeed(undefined) → does NOT advance when maneuver is 26 m away", () => {
    const gpsSpeed: number | null | undefined = undefined;
    const steps: Step[] = [{ coordinate: origin }, stepAtDistance(origin, 26)];
    expect(backgroundAdvanceStepIdx(0, steps, origin, normalizeSpeed(gpsSpeed))).toBe(0);
  });

  it("background: normalizeSpeed(undefined) → DOES advance when maneuver is 20 m away", () => {
    const gpsSpeed: number | null | undefined = undefined;
    const steps: Step[] = [{ coordinate: origin }, stepAtDistance(origin, 20)];
    expect(backgroundAdvanceStepIdx(0, steps, origin, normalizeSpeed(gpsSpeed))).toBe(1);
  });

  // ── 14e: both functions agree on null/undefined speed — same threshold ────

  it("foreground and background both use 25 m threshold when speed is null", () => {
    const gpsSpeed: number | null = null;
    const speedMs = normalizeSpeed(gpsSpeed);
    const stepsIn: Step[]  = [{ coordinate: origin }, stepAtDistance(origin, 20)];
    const stepsOut: Step[] = [{ coordinate: origin }, stepAtDistance(origin, 26)];
    expect(foregroundAdvanceStepIdx(0, stepsIn,  origin, speedMs)).toBe(1);
    expect(backgroundAdvanceStepIdx(0, stepsIn,  origin, speedMs)).toBe(1);
    expect(foregroundAdvanceStepIdx(0, stepsOut, origin, speedMs)).toBe(0);
    expect(backgroundAdvanceStepIdx(0, stepsOut, origin, speedMs)).toBe(0);
  });

  it("foreground and background both use 25 m threshold when speed is undefined", () => {
    const gpsSpeed: number | null | undefined = undefined;
    const speedMs = normalizeSpeed(gpsSpeed);
    const stepsIn: Step[]  = [{ coordinate: origin }, stepAtDistance(origin, 20)];
    const stepsOut: Step[] = [{ coordinate: origin }, stepAtDistance(origin, 26)];
    expect(foregroundAdvanceStepIdx(0, stepsIn,  origin, speedMs)).toBe(1);
    expect(backgroundAdvanceStepIdx(0, stepsIn,  origin, speedMs)).toBe(1);
    expect(foregroundAdvanceStepIdx(0, stepsOut, origin, speedMs)).toBe(0);
    expect(backgroundAdvanceStepIdx(0, stepsOut, origin, speedMs)).toBe(0);
  });

  // ── 14f: NaN behaviour without the normalizeSpeed guard ──────────────────
  //
  // Without normalizeSpeed, passing undefined through JS arithmetic gives NaN
  // (undefined * 2.237 = NaN; Math.round(NaN) = NaN).  All NaN comparisons
  // are false, so navStepThreshold falls through to the final 25 m branch —
  // accidentally returning the correct value via an implicit path.
  //
  // null behaves differently: null * 2.237 = 0 (JS coerces null to 0 in
  // arithmetic), so Math.round(0) = 0, and 0 > 50/30/15 are all false → 25.
  //
  // Both accidentally return 25, but through fragile implicit routes.
  // normalizeSpeed() makes the 0 fallback explicit for both cases and
  // insulates the threshold from any future breakpoint reordering that might
  // change which NaN branch is hit.

  it("navStepThreshold(NaN) returns 25 (NaN comparisons all false — implicit fallback, not canonical path)", () => {
    // Documents the accidental-correctness of the unguarded undefined case.
    // The existence of this test motivates using normalizeSpeed() instead of
    // relying on this implicit behaviour.
    expect(navStepThreshold(NaN)).toBe(25);
  });
});

// ── Suite 15: missed-turn nearZone uses activity threshold, not motorised ─────
//
// map.tsx computes:
//   const threshold = isWalking ? 20 : isCycling ? 25 : navStepThreshold(speed);
//   const nearZone     = threshold * 3.5;
//   const wasCloseZone = threshold * 1.5;
//
// navMissedTurnThreshold() is the single-source helper that encapsulates this
// formula.  If someone accidentally wires the motorised navStepThreshold() for
// all modes, the walking nearZone would be 65 × 3.5 = 227.5 m instead of 70 m,
// and the cycling nearZone would be 65 × 3.5 = 227.5 m instead of 87.5 m —
// firing missed-turn reroutes far too early for pedestrians and cyclists.
//
// These tests pin the threshold, nearZone, and wasCloseZone values for all
// three activity modes so any accidental revert to the motorised path is caught.

describe("missed-turn threshold — walking/cycling use activity override, not motorised distance", () => {
  const highwayMs = 65 / 2.237; // ~29 m/s — would give 65 m if motorised path were used

  // ── 15a: walking threshold is 20 m ───────────────────────────────────────

  it("walking threshold is 20 m (not the 65 m motorised highway threshold)", () => {
    expect(navMissedTurnThreshold(highwayMs, true, false)).toBe(20);
  });

  it("walking nearZone evaluates to 20 × 3.5 = 70 m (not 65 × 3.5 = 227.5 m)", () => {
    const threshold = navMissedTurnThreshold(highwayMs, true, false);
    const nearZone  = threshold * 3.5;
    expect(nearZone).toBeCloseTo(70, 5);
  });

  it("walking wasCloseZone evaluates to 20 × 1.5 = 30 m", () => {
    const threshold    = navMissedTurnThreshold(highwayMs, true, false);
    const wasCloseZone = threshold * 1.5;
    expect(wasCloseZone).toBeCloseTo(30, 5);
  });

  // ── 15b: cycling threshold is 25 m ───────────────────────────────────────

  it("cycling threshold is 25 m (not the 65 m motorised highway threshold)", () => {
    expect(navMissedTurnThreshold(highwayMs, false, true)).toBe(25);
  });

  it("cycling nearZone evaluates to 25 × 3.5 = 87.5 m (not 65 × 3.5 = 227.5 m)", () => {
    const threshold = navMissedTurnThreshold(highwayMs, false, true);
    const nearZone  = threshold * 3.5;
    expect(nearZone).toBeCloseTo(87.5, 5);
  });

  it("cycling wasCloseZone evaluates to 25 × 1.5 = 37.5 m", () => {
    const threshold    = navMissedTurnThreshold(highwayMs, false, true);
    const wasCloseZone = threshold * 1.5;
    expect(wasCloseZone).toBeCloseTo(37.5, 5);
  });

  // ── 15c: motorised path still uses navStepThreshold ──────────────────────
  //
  // Confirm that when neither flag is set the helper delegates to the
  // speed-adaptive motorised threshold, so the walking/cycling override is not
  // accidentally applied to all modes.

  it("motorised at highway speed still returns the 65 m navStepThreshold value", () => {
    expect(navMissedTurnThreshold(highwayMs, false, false)).toBe(65);
  });

  it("motorised nearZone at highway speed is 65 × 3.5 = 227.5 m", () => {
    const threshold = navMissedTurnThreshold(highwayMs, false, false);
    expect(threshold * 3.5).toBeCloseTo(227.5, 5);
  });

  it("motorised at slow speed (10 mph) returns the 25 m threshold (not walking 20 m)", () => {
    const slowMs = 10 / 2.237;
    expect(navMissedTurnThreshold(slowMs, false, false)).toBe(25);
  });

  // ── 15d: foregroundAdvanceStepIdx uses the same activity threshold ────────
  //
  // Confirm foregroundAdvanceStepIdx advances at < 20 m when walking (not at
  // the motorised boundary), proving the step-advance and missed-turn code
  // share the same threshold source and that a change to one propagates to both.

  const origin: LatLng = { latitude: 37.7749, longitude: -122.4194 };

  it("foreground walking: advances at 19 m (inside 20 m walking threshold)", () => {
    const steps: Step[] = [{ coordinate: origin }, stepAtDistance(origin, 19)];
    expect(foregroundAdvanceStepIdx(0, steps, origin, highwayMs, true, false)).toBe(1);
  });

  it("foreground walking: does NOT advance at 21 m (outside 20 m walking threshold)", () => {
    const steps: Step[] = [{ coordinate: origin }, stepAtDistance(origin, 21)];
    expect(foregroundAdvanceStepIdx(0, steps, origin, highwayMs, true, false)).toBe(0);
  });

  it("foreground cycling: advances at 24 m (inside 25 m cycling threshold)", () => {
    const steps: Step[] = [{ coordinate: origin }, stepAtDistance(origin, 24)];
    expect(foregroundAdvanceStepIdx(0, steps, origin, highwayMs, false, true)).toBe(1);
  });

  it("foreground cycling: does NOT advance at 26 m (outside 25 m cycling threshold)", () => {
    const steps: Step[] = [{ coordinate: origin }, stepAtDistance(origin, 26)];
    expect(foregroundAdvanceStepIdx(0, steps, origin, highwayMs, false, true)).toBe(0);
  });
});

// ── Suite 16: off-route tolerance — walking and cycling vs motorised ──────────
//
// navOffRouteThreshold() returns a larger offDistM for walking and cycling than
// for motorised traffic travelling at an equivalent (slow) speed.  This prevents
// false-positive reroutes when pedestrians and cyclists deviate from
// road-centred routes via footpaths and cycle lanes.
//
// The "motorised value" used as the comparison baseline is the threshold
// returned when isWalking=false and isCycling=false at 0 m/s (stationary /
// slow bucket), which is the same speed bracket that covers typical walking and
// cycling speeds (~3–11 mph → rounds to < 15 mph → slow bucket → 80 m).
//
// Test approach: import the real production helper so that any reduction of the
// walking/cycling values below the motorised slow bucket causes these tests to
// fail immediately, preventing a silent regression in future refactors.

describe("off-route tolerance — walking and cycling exceed motorised slow-speed threshold", () => {
  // Representative speeds for each mode.
  const walkingSpeedMs  = 1.5;  // ~3.4 mph → slow motorised bucket (≤ 15 mph → 80 m)
  const cyclingSpeedMs  = 4.5;  // ~10 mph  → slow motorised bucket (≤ 15 mph → 80 m)
  const motorisedSlowMs = 0;    // 0 m/s    → slow motorised bucket          → 80 m

  // ── 16a: walking offDistM is larger than the motorised slow-bucket value ───
  //
  // Walkers take footpaths that can be metres away from the road centreline;
  // the wider threshold prevents a reroute on every footpath deviation.

  it("walking offDistM is larger than the motorised value at the same speed", () => {
    const walking   = navOffRouteThreshold(walkingSpeedMs,  true,  false, 1.0);
    const motorised = navOffRouteThreshold(walkingSpeedMs,  false, false, 1.0);
    expect(walking.offDistM).toBeGreaterThan(motorised.offDistM);
  });

  it("walking offDistM is larger than the motorised slow-bucket value (0 m/s)", () => {
    const walking   = navOffRouteThreshold(walkingSpeedMs,  true,  false, 1.0);
    const motorised = navOffRouteThreshold(motorisedSlowMs, false, false, 1.0);
    expect(walking.offDistM).toBeGreaterThan(motorised.offDistM);
  });

  // ── 16b: cycling offDistM is larger than the motorised slow-bucket value ───
  //
  // Cyclists ride in dedicated lanes set back from the road centreline;
  // the wider threshold mirrors this physical separation.

  it("cycling offDistM is larger than the motorised value at the same speed", () => {
    const cycling   = navOffRouteThreshold(cyclingSpeedMs,  false, true,  1.0);
    const motorised = navOffRouteThreshold(cyclingSpeedMs,  false, false, 1.0);
    expect(cycling.offDistM).toBeGreaterThan(motorised.offDistM);
  });

  it("cycling offDistM is larger than the motorised slow-bucket value (0 m/s)", () => {
    const cycling   = navOffRouteThreshold(cyclingSpeedMs,  false, true,  1.0);
    const motorised = navOffRouteThreshold(motorisedSlowMs, false, false, 1.0);
    expect(cycling.offDistM).toBeGreaterThan(motorised.offDistM);
  });

  // ── 16c: absolute values — lock in the concrete thresholds ───────────────
  //
  // Pinning the exact metre values ensures any future change to the constants
  // in navOffRouteThreshold.ts breaks these tests, making the adjustment
  // visible in the test run rather than silently affecting live navigation.

  it("walking offDistM is 95 m (sensitivity = 1.0)", () => {
    expect(navOffRouteThreshold(walkingSpeedMs, true, false, 1.0).offDistM).toBe(95);
  });

  it("cycling offDistM is 85 m (sensitivity = 1.0)", () => {
    expect(navOffRouteThreshold(cyclingSpeedMs, false, true, 1.0).offDistM).toBe(85);
  });

  it("motorised slow-bucket offDistM is 80 m (sensitivity = 1.0)", () => {
    expect(navOffRouteThreshold(motorisedSlowMs, false, false, 1.0).offDistM).toBe(80);
  });

  // ── 16d: sensitivity multiplier applies to walking/cycling in the same way ─
  //
  // The sensitivity multiplier is used by the adaptive recalc algorithm.
  // It must scale the walking/cycling raw distance identically to the motorised
  // path so the recalc-sensitivity tuning code does not need mode-specific logic.

  it("walking offDistM scales correctly with sensitivity 0.5", () => {
    const result = navOffRouteThreshold(walkingSpeedMs, true, false, 0.5);
    expect(result.offDistM).toBe(Math.round(95 * 0.5)); // 48 m
  });

  it("cycling offDistM scales correctly with sensitivity 2.0", () => {
    const result = navOffRouteThreshold(cyclingSpeedMs, false, true, 2.0);
    expect(result.offDistM).toBe(Math.round(85 * 2.0)); // 170 m
  });

  // ── 16e: walking/cycling do not accidentally inherit motorised speed tiers ──
  //
  // When isWalking or isCycling is true, the speed-adaptive motorised branches
  // (> 50 mph → 55 m, > 25 mph → 65 m, else → 80 m) must be bypassed.
  // Pass a highway-speed input; the returned distance must still be the
  // walking/cycling constant, not the 55 m motorised highway value.

  it("walking at highway GPS speed still returns the walking offDistM (not motorised 55 m)", () => {
    const highwayMs = 65 / 2.237;
    const result    = navOffRouteThreshold(highwayMs, true, false, 1.0);
    expect(result.offDistM).toBe(95); // walking constant, not 55 m motorised
  });

  it("cycling at highway GPS speed still returns the cycling offDistM (not motorised 55 m)", () => {
    const highwayMs = 65 / 2.237;
    const result    = navOffRouteThreshold(highwayMs, false, true, 1.0);
    expect(result.offDistM).toBe(85); // cycling constant, not 55 m motorised
  });
});

// ── Suite 17: background walking/cycling thresholds — task-714 ───────────────
//
// Investigation result: backgroundNav.ts IS invoked during walking and cycling
// sessions — it guards on navState.isActive but has NO travelMode gate.
// navState.travelMode is already available (used by backgroundOffRouteTick) and
// is now also passed to backgroundAdvanceStepIdx as isWalking/isCycling flags.
//
// backgroundAdvanceStepIdx now calls navMissedTurnThreshold() — the same helper
// as foregroundAdvanceStepIdx — so:
//   isWalking = true  → 20 m  (regardless of GPS speed)
//   isCycling = true  → 25 m  (regardless of GPS speed)
//   neither (default) → navStepThreshold(speedMs) — motorised 25–65 m
//
// The while-loop multi-step advance in backgroundAdvanceStepIdx applies the
// walking/cycling threshold on every hop, so the tighter boundary is respected
// across batched location updates as well as single ticks.
//
// These tests import the REAL production helpers so any change to threshold
// values or the navMissedTurnThreshold delegation causes an immediate failure.

describe("background walking/cycling thresholds — backgroundAdvanceStepIdx respects mode flags (task-714)", () => {
  const origin: LatLng = { latitude: 37.7749, longitude: -122.4194 };
  // Use highway GPS speed to confirm thresholds are mode-driven, not speed-driven.
  const highwayMs = 65 / 2.237; // ~29 m/s — motorised threshold would be 65 m

  // ── 17a: backgroundNav.ts is invoked during walking/cycling sessions ────────
  //
  // Confirms the design contract: backgroundNav.ts has no travelMode gate and
  // passes isWalking/isCycling flags from navState.travelMode so the correct
  // threshold is applied even for background location batches.

  it("background walking session: advances at 19 m (inside 20 m walking threshold) even at highway GPS speed", () => {
    // If background still used navStepThreshold(highwayMs)=65 m, the advance
    // would be valid for a completely different reason. Test with a distance
    // that is only inside the 20 m window, not the 65 m motorised window,
    // by choosing 19 m < 20 m.
    const steps: Step[] = [{ coordinate: origin }, stepAtDistance(origin, 19)];
    const result = backgroundAdvanceStepIdx(0, steps, origin, highwayMs, true, false);
    expect(result).toBe(1); // walking: 19 < 20 m → advances
  });

  it("background walking session: does NOT advance at 21 m (outside 20 m walking threshold)", () => {
    // 21 m is inside the motorised 65 m window but outside the 20 m walking
    // window. The background must respect the walking threshold.
    const steps: Step[] = [{ coordinate: origin }, stepAtDistance(origin, 21)];
    const result = backgroundAdvanceStepIdx(0, steps, origin, highwayMs, true, false);
    expect(result).toBe(0); // walking: 21 > 20 m → no advance
  });

  it("background cycling session: advances at 24 m (inside 25 m cycling threshold) even at highway GPS speed", () => {
    const steps: Step[] = [{ coordinate: origin }, stepAtDistance(origin, 24)];
    const result = backgroundAdvanceStepIdx(0, steps, origin, highwayMs, false, true);
    expect(result).toBe(1); // cycling: 24 < 25 m → advances
  });

  it("background cycling session: does NOT advance at 26 m (outside 25 m cycling threshold)", () => {
    // 26 m is inside the motorised 65 m window but outside the 25 m cycling
    // window. The background must respect the cycling threshold.
    const steps: Step[] = [{ coordinate: origin }, stepAtDistance(origin, 26)];
    const result = backgroundAdvanceStepIdx(0, steps, origin, highwayMs, false, true);
    expect(result).toBe(0); // cycling: 26 > 25 m → no advance
  });

  // ── 17b: walking background threshold matches walking foreground threshold ──
  //
  // Foreground and background now use the same navMissedTurnThreshold() helper,
  // so both walking paths have identical advance conditions.

  it("background walking and foreground walking advance at the same distance (19 m)", () => {
    const steps: Step[] = [{ coordinate: origin }, stepAtDistance(origin, 19)];
    const bgResult = backgroundAdvanceStepIdx(0, steps, origin, highwayMs, true, false);
    const fgResult = foregroundAdvanceStepIdx(0, steps, origin, highwayMs, true, false);
    expect(bgResult).toBe(1);
    expect(fgResult).toBe(1);
    expect(bgResult).toBe(fgResult);
  });

  it("background walking and foreground walking agree at the reject boundary (21 m — both hold)", () => {
    const steps: Step[] = [{ coordinate: origin }, stepAtDistance(origin, 21)];
    const bgResult = backgroundAdvanceStepIdx(0, steps, origin, highwayMs, true, false);
    const fgResult = foregroundAdvanceStepIdx(0, steps, origin, highwayMs, true, false);
    expect(bgResult).toBe(0);
    expect(fgResult).toBe(0);
    expect(bgResult).toBe(fgResult);
  });

  it("background cycling and foreground cycling advance at the same distance (24 m)", () => {
    const steps: Step[] = [{ coordinate: origin }, stepAtDistance(origin, 24)];
    const bgResult = backgroundAdvanceStepIdx(0, steps, origin, highwayMs, false, true);
    const fgResult = foregroundAdvanceStepIdx(0, steps, origin, highwayMs, false, true);
    expect(bgResult).toBe(1);
    expect(fgResult).toBe(1);
    expect(bgResult).toBe(fgResult);
  });

  // ── 17c: while-loop respects walking threshold across multiple hops ─────────
  //
  // The background while-loop must apply the walking 20 m threshold on every
  // iteration, not just the first.  Two consecutive steps at 10 m and 18 m are
  // both inside the 20 m window → background advances through both.
  // A step at 22 m is outside the 20 m window → the loop stops there.

  it("background walking: advances through two consecutive steps both inside 20 m threshold", () => {
    const step1 = stepAtDistance(origin, 10); // 10 m — inside 20 m
    const step2 = stepAtDistance(origin, 18); // 18 m — inside 20 m
    const steps: Step[] = [{ coordinate: origin }, step1, step2];
    const result = backgroundAdvanceStepIdx(0, steps, origin, highwayMs, true, false);
    expect(result).toBe(2); // advances through both
  });

  it("background walking: stops at first step outside 20 m threshold", () => {
    const step1 = stepAtDistance(origin, 10); // 10 m — inside 20 m
    const step2 = stepAtDistance(origin, 22); // 22 m — outside 20 m
    const steps: Step[] = [{ coordinate: origin }, step1, step2];
    const result = backgroundAdvanceStepIdx(0, steps, origin, highwayMs, true, false);
    expect(result).toBe(1); // advances to step 1 only
  });

  it("background cycling: advances through two consecutive steps both inside 25 m threshold", () => {
    const step1 = stepAtDistance(origin, 15); // 15 m — inside 25 m
    const step2 = stepAtDistance(origin, 23); // 23 m — inside 25 m
    const steps: Step[] = [{ coordinate: origin }, step1, step2];
    const result = backgroundAdvanceStepIdx(0, steps, origin, highwayMs, false, true);
    expect(result).toBe(2);
  });

  // ── 17d: low GPS speed doesn't accidentally inflate the walking threshold ───
  //
  // At slow speed (4 mph) navStepThreshold() returns 25 m.  With isWalking=true
  // the threshold must still be 20 m — the walking override takes priority over
  // the speed-adaptive motorised path.  If navMissedTurnThreshold is wired
  // incorrectly (e.g. speed branch evaluated before the mode flag), this test
  // will catch it.

  it("background walking at slow GPS speed (4 mph) still uses 20 m, not the 25 m navStepThreshold value", () => {
    const slowMs = 4 / 2.237; // navStepThreshold(slowMs) = 25 m; walking override = 20 m
    // 22 m is inside 25 m but outside 20 m — only the motorised path would advance here.
    const steps: Step[] = [{ coordinate: origin }, stepAtDistance(origin, 22)];
    const result = backgroundAdvanceStepIdx(0, steps, origin, slowMs, true, false);
    expect(result).toBe(0); // walking threshold (20 m) applies — 22 > 20 → no advance
  });

  it("background walking at slow GPS speed advances at 18 m (inside both 20 m and 25 m windows)", () => {
    const slowMs = 4 / 2.237;
    const steps: Step[] = [{ coordinate: origin }, stepAtDistance(origin, 18)];
    const result = backgroundAdvanceStepIdx(0, steps, origin, slowMs, true, false);
    expect(result).toBe(1); // 18 < 20 m walking threshold → advances
  });

  // ── 17e: motorised default is unchanged — no regression ─────────────────────
  //
  // Calling backgroundAdvanceStepIdx without mode flags (or with both false)
  // must produce exactly the same result as before: navStepThreshold(speedMs).
  // This guards against the fix accidentally narrowing the motorised path.

  it("motorised default (no flags) at highway speed still uses 65 m threshold", () => {
    // 60 m is inside the motorised 65 m window. With no walking/cycling flag it advances.
    const steps: Step[] = [{ coordinate: origin }, stepAtDistance(origin, 60)];
    const result = backgroundAdvanceStepIdx(0, steps, origin, highwayMs);
    expect(result).toBe(1); // motorised: 60 < 65 m → advances
  });

  it("motorised default (no flags) does NOT advance at 70 m (outside 65 m motorised threshold)", () => {
    const steps: Step[] = [{ coordinate: origin }, stepAtDistance(origin, 70)];
    const result = backgroundAdvanceStepIdx(0, steps, origin, highwayMs);
    expect(result).toBe(0); // 70 > 65 m → no advance
  });
});

// ── Suite 18: off-route sensitivity scaling — walking/cycling always wider than motorised ──
//
// navOffRouteThreshold() applies `sensitivity` as a direct multiplier to the raw
// distance (offDistM = Math.round(rawDistM * sensitivity)).  Raw distances are:
//   Walking:          95 m
//   Cycling:          85 m
//   Motorised highway: 55 m  (> 50 mph — the narrowest motorised bucket)
//   Motorised urban:   65 m  (> 25 mph)
//   Motorised slow:    80 m  (≤ 25 mph — the widest motorised bucket)
//
// Because 95 > 85 > 80 ≥ 65 > 55, the walking and cycling raw distances are
// strictly greater than every motorised raw distance.  Multiplying all by the
// same positive sensitivity preserves the ordering, so:
//   walking offDistM > motorised offDistM  at any sensitivity
//   cycling offDistM > motorised offDistM  at any sensitivity
//
// These parameterised tests confirm the ordering holds across the entire
// documented sensitivity range [0.5, 2.0].  They import the real production
// helper, so any change to a raw threshold or the Math.round() computation
// will cause an immediate test failure.
//
// Suite 18c confirms that navOffRouteThreshold does NOT clamp sensitivity
// itself — the calling code is responsible for enforcing [0.5, 2.0].  Passing
// a value outside the range returns an unmodified scaled result, not a clamped one.

describe("off-route sensitivity scaling — walking/cycling offDistM stays wider than motorised", () => {
  // Representative speeds for each motorised bucket (Math.round(speedMs * 2.237) gives the mph).
  //   slow   ≤ 25 mph → raw 80 m  (widest motorised bucket)
  //   urban  > 25 mph → raw 65 m
  //   highway > 50 mph → raw 55 m (narrowest motorised bucket)
  const SLOW_SPEED_MS    = 10 / 2.237;  // ~4.47 m/s → 10 mph → slow bucket   (80 m raw)
  const URBAN_SPEED_MS   = 40 / 2.237;  // ~17.88 m/s → 40 mph → urban bucket (65 m raw)
  const HIGHWAY_SPEED_MS = 65 / 2.237;  // ~29.06 m/s → 65 mph → highway bucket (55 m raw)

  // ── 18a: walking offDistM > motorised offDistM across all buckets ─────────
  //
  // Walking raw = 95 m.  Every motorised bucket is ≤ 80 m raw, so
  // Math.round(95 * s) must be strictly greater than Math.round(bucketRaw * s)
  // for every documented sensitivity and every speed bucket.
  //
  // The tightest case is the slow bucket (80 m): gap = 95 − 80 = 15 m raw.
  // At sensitivity 0.5: Math.round(47.5) = 48 vs Math.round(40) = 40 → 48 > 40 ✓

  it.each([
    ["slow (80 m raw)",    0.50, SLOW_SPEED_MS],
    ["slow (80 m raw)",    0.75, SLOW_SPEED_MS],
    ["slow (80 m raw)",    1.00, SLOW_SPEED_MS],
    ["slow (80 m raw)",    1.50, SLOW_SPEED_MS],
    ["slow (80 m raw)",    2.00, SLOW_SPEED_MS],
    ["urban (65 m raw)",   0.50, URBAN_SPEED_MS],
    ["urban (65 m raw)",   0.75, URBAN_SPEED_MS],
    ["urban (65 m raw)",   1.00, URBAN_SPEED_MS],
    ["urban (65 m raw)",   1.50, URBAN_SPEED_MS],
    ["urban (65 m raw)",   2.00, URBAN_SPEED_MS],
    ["highway (55 m raw)", 0.50, HIGHWAY_SPEED_MS],
    ["highway (55 m raw)", 0.75, HIGHWAY_SPEED_MS],
    ["highway (55 m raw)", 1.00, HIGHWAY_SPEED_MS],
    ["highway (55 m raw)", 1.50, HIGHWAY_SPEED_MS],
    ["highway (55 m raw)", 2.00, HIGHWAY_SPEED_MS],
  ])(
    "walking offDistM > motorised %s offDistM at sensitivity %s",
    (_bucketLabel, sensitivity, speedMs) => {
      const walking   = navOffRouteThreshold(0, true, false, sensitivity);
      const motorised = navOffRouteThreshold(speedMs, false, false, sensitivity);
      expect(walking.offDistM).toBeGreaterThan(motorised.offDistM);
    },
  );

  // ── 18b: cycling offDistM > motorised offDistM across all buckets ─────────
  //
  // Cycling raw = 85 m.  The tightest case is the slow bucket (80 m):
  // gap = 85 − 80 = 5 m raw.
  // At sensitivity 0.5: Math.round(42.5) = 43 vs Math.round(40) = 40 → 43 > 40 ✓
  // At sensitivity 2.0: Math.round(170) = 170 vs Math.round(160) = 160 → 170 > 160 ✓

  it.each([
    ["slow (80 m raw)",    0.50, SLOW_SPEED_MS],
    ["slow (80 m raw)",    0.75, SLOW_SPEED_MS],
    ["slow (80 m raw)",    1.00, SLOW_SPEED_MS],
    ["slow (80 m raw)",    1.50, SLOW_SPEED_MS],
    ["slow (80 m raw)",    2.00, SLOW_SPEED_MS],
    ["urban (65 m raw)",   0.50, URBAN_SPEED_MS],
    ["urban (65 m raw)",   0.75, URBAN_SPEED_MS],
    ["urban (65 m raw)",   1.00, URBAN_SPEED_MS],
    ["urban (65 m raw)",   1.50, URBAN_SPEED_MS],
    ["urban (65 m raw)",   2.00, URBAN_SPEED_MS],
    ["highway (55 m raw)", 0.50, HIGHWAY_SPEED_MS],
    ["highway (55 m raw)", 0.75, HIGHWAY_SPEED_MS],
    ["highway (55 m raw)", 1.00, HIGHWAY_SPEED_MS],
    ["highway (55 m raw)", 1.50, HIGHWAY_SPEED_MS],
    ["highway (55 m raw)", 2.00, HIGHWAY_SPEED_MS],
  ])(
    "cycling offDistM > motorised %s offDistM at sensitivity %s",
    (_bucketLabel, sensitivity, speedMs) => {
      const cycling   = navOffRouteThreshold(0, false, true, sensitivity);
      const motorised = navOffRouteThreshold(speedMs, false, false, sensitivity);
      expect(cycling.offDistM).toBeGreaterThan(motorised.offDistM);
    },
  );

  // ── 18c: navOffRouteThreshold does NOT clamp sensitivity ──────────────────
  //
  // The function's JSDoc states "Must be clamped to [0.5, 2.0] by the caller
  // before passing here."  The function itself performs no clamping — it uses
  // the value as-is.  These tests confirm that behaviour by passing values
  // outside the documented range and asserting the unmodified scaled result
  // is returned (not a value that would be produced by clamping to 0.5 or 2.0).
  //
  // Walking raw = 95 m.  At sensitivity 0.1:
  //   Clamped (0.5) result: Math.round(95 * 0.5) = 48
  //   Unclamped result:     Math.round(95 * 0.1) = 10
  //
  // At sensitivity 3.0:
  //   Clamped (2.0) result: Math.round(95 * 2.0) = 190
  //   Unclamped result:     Math.round(95 * 3.0) = 285

  it("sensitivity below 0.5 is used as-is (not clamped to 0.5) — walking raw 95 m at 0.1", () => {
    const result = navOffRouteThreshold(0, true, false, 0.1);
    const expectedUnclamped = Math.round(95 * 0.1); // 10
    const clampedValue      = Math.round(95 * 0.5); // 48
    expect(result.offDistM).toBe(expectedUnclamped);
    expect(result.offDistM).not.toBe(clampedValue);
  });

  it("sensitivity above 2.0 is used as-is (not clamped to 2.0) — walking raw 95 m at 3.0", () => {
    const result = navOffRouteThreshold(0, true, false, 3.0);
    const expectedUnclamped = Math.round(95 * 3.0); // 285
    const clampedValue      = Math.round(95 * 2.0); // 190
    expect(result.offDistM).toBe(expectedUnclamped);
    expect(result.offDistM).not.toBe(clampedValue);
  });

  // ── 18d: raw distance values are documented (change-detector) ────────────
  //
  // These snapshot tests document the exact raw threshold for each mode at
  // sensitivity = 1.0.  Any change to navOffRouteThreshold.ts that alters a
  // raw distance (95 m, 85 m, 55 m) will cause an immediate failure here,
  // making silent regressions to the ordering proofs above impossible.

  it("walking raw distance at sensitivity 1.0 is 95 m", () => {
    expect(navOffRouteThreshold(0, true, false, 1.0).offDistM).toBe(95);
  });

  it("cycling raw distance at sensitivity 1.0 is 85 m", () => {
    expect(navOffRouteThreshold(0, false, true, 1.0).offDistM).toBe(85);
  });

  it("motorised highway raw distance at sensitivity 1.0 is 55 m", () => {
    expect(navOffRouteThreshold(HIGHWAY_SPEED_MS, false, false, 1.0).offDistM).toBe(55);
  });

  it("motorised urban raw distance at sensitivity 1.0 is 65 m", () => {
    expect(navOffRouteThreshold(URBAN_SPEED_MS, false, false, 1.0).offDistM).toBe(65);
  });

  it("motorised slow raw distance at sensitivity 1.0 is 80 m", () => {
    expect(navOffRouteThreshold(SLOW_SPEED_MS, false, false, 1.0).offDistM).toBe(80);
  });

  // ── 18e: cycling vs slow bucket gap — the 5 m raw gap can't silently invert ─
  //
  // Cycling raw (85 m) vs motorised slow raw (80 m) is the tightest ordering
  // in the whole threshold table — a gap of only 5 m.  Suite 18b confirms the
  // direction (cycling > slow) but does not name or bound the gap.
  //
  // These tests assert that the scaled gap (cycling offDistM − slow offDistM)
  // is ≥ 1 m at every sensitivity in the documented range [0.5, 2.0].  If
  // someone nudges the slow threshold upward (e.g. 80 → 85 m) the gap collapses
  // to 0 and these tests fail immediately, making the risk visible before any
  // production code ships.
  //
  // Worked examples at the sensitivity extremes:
  //   sensitivity 0.5: Math.round(85 × 0.5) = 43, Math.round(80 × 0.5) = 40 → gap = 3 ✓
  //   sensitivity 2.0: Math.round(85 × 2.0) = 170, Math.round(80 × 2.0) = 160 → gap = 10 ✓
  //
  // If slow raw were raised to 85 m (equal to cycling):
  //   sensitivity 0.5: Math.round(85 × 0.5) = 43, Math.round(85 × 0.5) = 43 → gap = 0 ✗
  //   sensitivity 1.0: 85 − 85 = 0 ✗

  it.each([
    [0.50],
    [0.75],
    [1.00],
    [1.25],
    [1.50],
    [1.75],
    [2.00],
  ])(
    // The test name calls out both raw constants so a future author sees exactly
    // which values they are narrowing when this test starts to fail.
    "cycling raw (85 m) offDistM exceeds slow raw (80 m) offDistM by ≥ 1 m at sensitivity %s [5 m raw gap must not invert]",
    (sensitivity) => {
      const cycling = navOffRouteThreshold(0, false, true, sensitivity);
      const slow    = navOffRouteThreshold(SLOW_SPEED_MS, false, false, sensitivity);
      const gap     = cycling.offDistM - slow.offDistM;
      expect(gap).toBeGreaterThanOrEqual(1);
    },
  );
});
